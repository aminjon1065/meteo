# Meteoportal Runbook (operations)

Version 1.1 · 17 October 2026 · Русская версия: [runbook.md](runbook.md)

For the IT service of the Agency for Hydrometeorology. Environment: a single Ubuntu 24.04 LTS host, Docker Compose
(`infra/compose/compose.prod.yml`), services caddy, web, worker, migrate, postgres (TimescaleDB + PostGIS), redis,
backup. Architecture — `docs/02-architecture.md`, security — `docs/security-checklist.md`, archive import —
`docs/import-history.md`, working in the panel — `docs/manuals/admin/en.md`.

All commands run from the repository directory on the server (`/opt/meteoportal`) as a user allowed to run Docker.
Shorthand: `dc = docker compose --env-file .env -f infra/compose/compose.prod.yml`
(add to `~/.bashrc`: `alias dc='docker compose --env-file .env -f infra/compose/compose.prod.yml'`).

Server requirements: 4 vCPU, 8 GB RAM, 100 GB SSD (room for 5 years of data), static IP, a domain (subdomain)
with DNS control, open ports 80/443, outbound access to SmartMet Server, FMI THREDDS (`thredds.silam.fmi.fi`),
the CAP feed and the SMTP server.

| What | Where |
|---|---|
| Code, compose, Caddyfile, scripts | `/opt/meteoportal` (repository clone) |
| Secrets | `/opt/meteoportal/.env` (mode 600, not in the repository) |
| Database | volume `pgdata` (`docker volume inspect meteo_pgdata`) |
| CMS uploads, SILAM layers, map tiles | volumes `uploads`, `silam`, `tiles` |
| Backups | volume `backups` (`/backups` inside the backup container) + off‑site restic |
| TLS certificates | volumes `caddy_data`, `caddy_config` (issued automatically) |
| Logs | `dc logs <service>` (Docker json-file, rotation 5 × 10 MB) |

## 1. Initial deployment

### 1.1. Server preparation

```bash
# Ubuntu 24.04: Docker Engine + Compose plugin (official Docker repository)
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"            # log in again
sudo timedatectl set-timezone UTC          # containers run in UTC; the portal displays Asia/Dushanbe
# Firewall: only SSH, HTTP, HTTPS (PostgreSQL and Redis are not published)
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp && sudo ufw enable
sudo mkdir -p /opt/meteoportal && sudo chown "$USER" /opt/meteoportal
git clone <repository address> /opt/meteoportal && cd /opt/meteoportal
```

`git clone` and `dc pull` from a private repository/GHCR registry need a token with the `read:packages` scope
(`docker login ghcr.io`), valid ≤ 1 year, kept in the password manager.

### 1.2. DNS and TLS

1. Create `A` (and `AAAA` if IPv6 exists) records for the portal domain, e.g. `portal.meteo.tj → <server IP>`.
   Check: `dig +short portal.meteo.tj`.
2. Caddy obtains a Let's Encrypt certificate automatically on the first request (ACME HTTP‑01/TLS‑ALPN — ports 80 and
   443 must be reachable from the internet) and renews it 30 days before expiry. The Let's Encrypt notification
   address is set in `infra/compose/Caddyfile` (`email admin@meteo.tj`) — replace it with the IT service address.
3. HTTP → HTTPS and HSTS are enabled in Caddy; nothing else is needed.
4. Staging without a public domain: add a `tls internal` block after the site address in the `Caddyfile`
   (Caddy self‑signed certificate) or use an IP with `http://` in `SITE_ADDRESS` (no TLS — internal network only).

Check after start‑up (section 1.7): `curl -I https://portal.meteo.tj/` → `200`, headers
`strict-transport-security`, `content-security-policy`.

### 1.3. Environment variables `.env`

`cp .env.example .env && chmod 600 .env`. Required values:

| Variable | Value | Note |
|---|---|---|
| `SITE_ADDRESS` | `portal.meteo.tj` | domain for Caddy; `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` (`https://…`) derive from it |
| `POSTGRES_PASSWORD` | `openssl rand -base64 24` | password of the `meteo` role |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` | session signing; changing it ends all sessions |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | address and a password ≥ 10 characters | first administrator; used once by seed while the users table is empty |
| `SMTP_URL` | `smtp://user:pass@mail.meteo.tj:587` or `smtps://…:465` | without it e‑mails only go to the worker log; URL‑encode special characters in the password (`@` → `%40`) |
| `MAIL_FROM` | `"Meteoportal <noreply@meteo.tj>"` | the sender domain must pass SPF/DKIM/DMARC (section 1.8) |
| `IMAGE_TAG` | `latest` or a commit SHA | image version from GHCR |

Integrations (can be set later, section 9): `SMARTMET_URL`, `SMARTMET_PRODUCER`, `SMARTMET_API_KEY`,
`SMARTMET_HOURLY_STEPS`, `SMARTMET_DAILY_DAYS`; `SILAM_NCSS_URL`, `SILAM_DATASET`, `SILAM_KEEP_RUNS`;
`CAP_FEED_URL`, `CAP_TIMEOUT_MS`. Resilience and notifications: `INTEGRATION_ALERT_FAILURES` (3),
`INTEGRATION_CIRCUIT_FAILURES` (3), `INTEGRATION_CIRCUIT_COOLDOWN_MIN` (30), `INTEGRATION_CIRCUIT_MAX_COOLDOWN_MIN` (240),
`ADMIN_ALERT_EMAILS` (extra addresses, comma‑separated). Security: `RATE_LIMIT_API_PER_MINUTE` (120),
`RATE_LIMIT_AUTH_PER_MINUTE` (30), `EMBED_FRAME_ANCESTORS` (who may embed the widgets).
Backups: `RESTIC_PASSWORD` (`openssl rand -base64 32`, **store it in the password manager separately from the server**),
`RESTIC_REPOSITORY`, `RESTIC_AWS_ACCESS_KEY_ID`/`RESTIC_AWS_SECRET_ACCESS_KEY`, `BACKUP_TIME_UTC`, `BACKUP_KEEP_*`.
The paths `SILAM_DIR`, `UPLOADS_DIR`, `TILES_DIR` are set by compose (volumes) in production — do not change them.

### 1.4. Images

Option A — ready images from GHCR (CI publishes `ghcr.io/<owner>/meteoportal-{web,worker,backup}` with the tags
`latest` and the commit SHA after lint/tests/Trivy pass):

```bash
docker login ghcr.io          # token with read:packages
dc pull
```

After the repository moves to the Customer's GitHub, replace the owner in the `image:` lines of the three services in `compose.prod.yml`.

Option B — build on the server (no GHCR access or local changes needed):

```bash
./infra/data/fetch-map-assets.sh   # map fonts and sprites into apps/web/public/basemaps (git‑ignored, so they must
                                   # exist BEFORE the web image is built) + tiles into infra/data/tiles
dc build
```

The build takes 10–15 minutes and needs ~4 GB of free space. The `backup` image is built from `infra/backup`.

### 1.5. Volumes and map data

Named volumes are created on the first `dc up`. The map tiles (`tajikistan.pmtiles`, ~210 MB) are not part of the images —
copy them into the `tiles` volume that Caddy serves at `/tiles/*`:

```bash
./infra/data/fetch-map-assets.sh                     # if not run yet (needs internet, ~225 MB)
docker volume create meteo_tiles
docker run --rm -v meteo_tiles:/t -v "$PWD/infra/data/tiles:/src:ro" alpine \
  sh -c 'cp /src/tajikistan.pmtiles /t/ && ls -la /t'
```

The volumes `silam` (forecast layers) and `uploads` (CMS files) are filled by the application; `backups` — by the backup service.
Directory owners inside the volumes are set by the images (user `app`); no manual permission changes are needed.

### 1.6. Start, migrations, reference data

```bash
dc up -d postgres redis                 # database and Redis
dc up -d migrate && dc logs -f migrate  # Drizzle migrations + TimescaleDB/PostGIS SQL; wait for Exited (0)
dc run --rm worker node dist/seed.js    # reference data (pollutants, scales, limit values, regions, forecast points) and the first administrator
dc up -d                                # web, worker, caddy, backup
dc ps                                   # all services healthy
```

Region and district boundaries (for the warning map, filters and station assignment) are loaded by a script from the
repository clone (Node.js 22 and pnpm 12 on the server, or on a workstation with database access):

```bash
pnpm install --frozen-lockfile
DATABASE_URL=postgres://meteo:<password>@127.0.0.1:5432/meteo pnpm --filter @meteo/db boundaries
```

PostgreSQL is not published: from a workstation open an SSH tunnel
(`ssh -L 5432:<postgres container IP>:5432 server`; IP — `docker inspect meteo-postgres-1 | grep IPAddress`)
or temporarily publish the port on `127.0.0.1` only through a compose override file. Details and boundary sources —
`infra/data/boundaries/README.md`.

### 1.7. First sign‑in

1. Open `https://<domain>/admin`, sign in as `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
2. Complete the mandatory 2FA setup (QR code in an authenticator app), **save the backup codes**.
3. Create a second administrator (protection against losing access), operators and editors — "Users".
4. "Settings" → "Mail" → test e‑mail; "Branding" → the Agency's name and contacts.
5. Remove `SEED_ADMIN_PASSWORD` from `.env` (it is no longer needed) or change the administrator's password in the panel.

### 1.8. SMTP and the sender domain (SPF, DKIM, DMARC)

E‑mails are sent by the worker through the Agency's SMTP server or an external provider; the portal itself does not add a
DKIM signature — the mail server (relay) signs. To keep messages out of spam, the domain in `MAIL_FROM` (e.g. `meteo.tj`)
needs these DNS records:

| Record | Example | Purpose |
|---|---|---|
| SPF (`TXT` on the domain) | `v=spf1 ip4:<mail server IP> include:<provider> -all` | which servers may send mail for the domain |
| DKIM (`TXT` on `<selector>._domainkey.meteo.tj`) | public key issued by the mail server/provider | message signature; the relay generates the selector and key |
| DMARC (`TXT` on `_dmarc.meteo.tj`) | `v=DMARC1; p=quarantine; rua=mailto:dmarc@meteo.tj; adkim=s; aspf=s` | policy for mismatches and reports |
| PTR | reverse record of the mail server IP → its name | required by most receivers |

Portal side: `SMTP_URL=smtp://<login>:<password>@<host>:587` (STARTTLS) or `smtps://…:465`, `MAIL_FROM` with an address
on the same domain. Check: `dc up -d worker`, admin panel → "Settings" → "Send test e‑mail" → status "sent"; the message
should arrive with `DKIM: pass`, `SPF: pass` (visible in the message headers, e.g. "Show original" in Gmail). Typical
problems: self‑signed relay certificate (use a valid certificate or an internal relay without TLS in a trusted network),
wrong port (587 — STARTTLS, 465 — TLS), special characters in the password (URL‑encode). Messages contain an unsubscribe
link and go only to confirmed subscribers (double opt‑in), which reduces spam complaints.

### 1.9. Post‑deployment checklist

```bash
curl -fsS https://<domain>/api/healthz                      # {"status":"ok","db":"ok",...}
dc exec worker wget -qO- http://127.0.0.1:3001/healthz      # worker: {"status":"ok","queue":"ok",...}
curl -I https://<domain>/ | grep -i -E 'strict-transport|content-security'
curl -s https://<domain>/api/v1/stations | head -c 300      # station JSON
dc exec backup cat /backups/last-backup.json                # first backup ran at start‑up
dc ps                                                       # all healthy
```

In the admin panel: dashboard — background service "running", SmartMet/SILAM integrations "up to date" (CAP — after
`CAP_FEED_URL` is set), mail queue without errors. On the portal: home page, map (tiles and labels), `/weather`, `/warnings`.

## 2. Upgrading

Images are built by CI (GHCR, tags `latest` and commit SHA); before publishing they pass lint, unit/E2E, Lighthouse,
`pnpm audit`, Trivy. An upgrade means ~1 minute of web downtime during the restart (Caddy returns 502 meanwhile).

```bash
cd /opt/meteoportal
git pull                                   # compose, Caddyfile, scripts
dc exec backup sh -c 'BACKUP_ONCE=1 sh /backup/run.sh'   # backup before upgrading
dc pull                                    # or dc build when building on the server
dc up -d migrate                           # migrations (idempotent); wait for Exited (0)
dc up -d                                   # restart web/worker/backup on the new images
dc ps                                      # healthy
curl -fsS https://<domain>/api/healthz
```

Rollback: `IMAGE_TAG=<previous commit sha> dc up -d` (migrations are not rolled back automatically: the schema is
backward compatible within one delivery week; if needed restore the database from a backup — section 3).

Upgrading Caddy/Postgres/Redis (major image versions) — only under a separate plan with a backup; a PostgreSQL major
upgrade requires `pg_dump` → new version → `pg_restore` (section 3.3).

## 3. Backup and restore

### 3.1. How the backup works

The `backup` service (image `infra/backup/Dockerfile`: alpine + pg_dump 17 + restic) runs daily at `BACKUP_TIME_UTC`
(21:00 UTC = 02:00 Dushanbe) and at start‑up:

1. `pg_dump -Fc` of the whole database → volume `backups` (`/backups/db/meteo-<UTC>.dump`), kept for `BACKUP_KEEP_DAYS` (30).
2. If `RESTIC_PASSWORD` is set — a restic snapshot of the dumps and the `uploads` (CMS files) and `silam` (raster layers)
   volumes into `RESTIC_REPOSITORY` (local `/backups/restic` by default, encrypted), policy `--keep-daily 30 --keep-monthly 12`,
   `prune`, `check`.
3. Status in `/backups/last-backup.json` (`result`, `dump`, `sizeBytes`, `restic`); the container healthcheck turns red
   if the file is older than 25 hours.

Off‑site copy (mandatory in production): set `RESTIC_REPOSITORY=s3:https://<endpoint>/<bucket>` and
`RESTIC_AWS_ACCESS_KEY_ID`/`RESTIC_AWS_SECRET_ACCESS_KEY` (any S3‑compatible storage, including MinIO in another Agency
data centre) or `sftp:user@host:/path`. Keep the restic password away from the server: without it the copies are unreadable.

Check: `dc exec backup cat /backups/last-backup.json`; `dc exec backup restic snapshots`.
Manual run: `dc exec backup sh -c 'BACKUP_ONCE=1 sh /backup/run.sh'`.

### 3.2. Monthly restore test (mandatory)

The script `infra/backup/restore-test.sh` starts a clean TimescaleDB container, restores the dump following the TimescaleDB
procedure (`timescaledb_pre_restore()` → `pg_restore` → `timescaledb_post_restore()`), checks the extensions, the
`measurements` hypertable, row counts of key tables (compared with the source) and the continuous‑aggregate refresh.
Only Docker is needed.

```bash
# on the server: a fresh dump from the stack's postgres container
SOURCE_CONTAINER=meteo-postgres-1 sh infra/backup/restore-test.sh
# or a specific file (e.g. restored from restic)
dc exec backup restic restore latest --target /tmp/restore --include /backups/db   # inside the container
sh infra/backup/restore-test.sh /path/to/meteo-20261017T210000Z.dump
```

Record the result in the operations log (date, file, `OK`). Local run on 17 October 2026 on the development database:
see `docs/04-delivery-plan.md`, week 8. Per the M8 acceptance checklist the test is run on staging at hand‑over.

### 3.3. Restoring production from a backup

Scenario: corrupted database / accidental deletion / move to a new server.

```bash
dc stop web worker backup                              # stop writes
# 1. Get the dump: local /backups/db/*.dump or from restic:
dc run --rm backup sh -c 'restic restore latest --target /tmp/r --include /backups/db && ls /tmp/r/backups/db'
# 2. Recreate the database (postgres container running)
dc exec postgres psql -U meteo -d postgres -c "DROP DATABASE meteo WITH (FORCE);" -c "CREATE DATABASE meteo;"
dc exec postgres psql -U meteo -d meteo -c "CREATE EXTENSION IF NOT EXISTS timescaledb;" -c "SELECT timescaledb_pre_restore();"
docker cp meteo-YYYYMMDD.dump meteo-postgres-1:/tmp/restore.dump
dc exec postgres pg_restore -U meteo -d meteo --no-owner --no-privileges /tmp/restore.dump   # "already exists" warnings are fine
dc exec postgres psql -U meteo -d meteo -c "SELECT timescaledb_post_restore();"
# 3. Files: restore the uploads/silam volumes from restic (restore --include /srv/uploads) into the volumes, then
dc up -d migrate && dc up -d
```

Verify: `/api/healthz`, a station page (history), admin panel → audit. The restored database contains user sessions —
revoke them in "Users" if compromise is suspected.

Note: TimescaleDB warns about circular FKs in `continuous_agg` during `pg_dump` — expected; always restore the full
dump, never `--data-only`.

### 3.4. Moving to another server

1. On the new server perform sections 1.1–1.5 (same `.env`, same `RESTIC_PASSWORD`).
2. On the old one: `dc stop web worker`, final backup (`BACKUP_ONCE=1`), copy the `backups` volume (or use the off‑site restic repository).
3. On the new one: restore the database and volumes per section 3.3, `dc up -d`, check per section 1.9.
4. Point DNS to the new IP; Caddy issues the certificate automatically. Stop the old server a day later.

## 4. Secret rotation and access restriction

| Secret | Where | How to change | Consequences |
|---|---|---|---|
| `POSTGRES_PASSWORD` | `.env`, postgres | `dc exec postgres psql -U meteo -c "ALTER USER meteo PASSWORD '<new>';"`, update `.env`, `dc up -d` (web, worker, backup, migrate read `DATABASE_URL`/`PGPASSWORD` from `.env`) | short restart |
| `BETTER_AUTH_SECRET` | `.env` | new `openssl rand -base64 48`, `dc up -d web` | all sessions and 2FA "trusted devices" become invalid — users sign in again (backup codes and TOTP keys remain) |
| `RESTIC_PASSWORD` | `.env` + password manager | `dc exec backup restic key add` (new password), then `restic key remove <old-id>`, update `.env` | old snapshots readable with the new password |
| `SMTP_URL`, `SMARTMET_API_KEY` | `.env` | update, `dc up -d worker web`; verify with a test e‑mail in "Settings" | — |
| Station API keys | admin panel → station → "Generate key" | shown once; hand over to the sensor operator | the old key stops working immediately (API ingestion — next version) |
| Administrator passwords | admin panel → "Users" → "Reset password" | the reset ends the user's sessions | — |
| Administrator 2FA | "Users" → "Reset 2FA" | mandatory re‑setup at the next sign‑in | — |
| TLS certificate | Caddy | automatic (Let's Encrypt, 30 days before expiry); check `dc logs caddy` | — |
| GHCR token for `dc pull` | `docker login ghcr.io` on the server | personal token with `read:packages`, validity ≤ 1 year | — |

Application role without DDL (planned): create a `meteo_app` role with `SELECT/INSERT/UPDATE/DELETE` on the `public`
schema and use it in the `DATABASE_URL` of web/worker; `migrate` keeps the owner role. Do it after the first stable
release on the Customer's server.

### 4.1. Restricting `/admin` by IP (optional)

If the panel must be reachable only from the Agency network, add to `infra/compose/Caddyfile` before the
`handle { reverse_proxy … }` block (panel paths are `/admin` for Tajik and `/ru/admin`, `/en/admin`; sign‑in API — `/api/auth/*`):

```caddyfile
	@adminOutside {
		path /admin* /tg/admin* /ru/admin* /en/admin* /api/auth/*
		not remote_ip 203.0.113.0/24 10.0.0.0/8
	}
	respond @adminOutside 403
```

Then `dc exec caddy caddy reload --config /etc/caddy/Caddyfile` (or `dc restart caddy`). Public pages and `/api/v1`
stay open. Keep VPN and mobile access of administrators in mind.

## 5. Monitoring and operational checks

| What | How to check | Normal |
|---|---|---|
| Web liveness | `curl -fsS https://<domain>/api/healthz` | `{"status":"ok","db":"ok"}`, code 200; 503 — no database connection |
| Worker liveness | `dc exec worker wget -qO- http://127.0.0.1:3001/healthz` | `status: ok`, `queue: ok`, `lastHeartbeatAt` not older than 3 minutes |
| Container state | `dc ps` | all `healthy`/`running`; `migrate` — `exited (0)` |
| Integrations | admin dashboard → "Integrations" | SmartMet/SILAM/CAP "up to date"; on "failure"/"paused" — section 6 |
| Station data freshness | dashboard → "Data freshness" | share of stations without data for 24 h close to 0 % |
| Mail queue | dashboard → "Mail queue" | `failed` = 0; otherwise SMTP |
| Backup | `dc exec backup cat /backups/last-backup.json` | `result: ok`, time < 25 h, `restic: ok` |
| Disk | `df -h /var/lib/docker`, `docker system df` | ≥ 20 % free; if short — `docker image prune -a` and backup retention |
| Certificate | `curl -vI https://<domain> 2>&1 \| grep -i expire` or `dc logs caddy \| grep -i certificate` | validity > 14 days (renewal is automatic) |
| Log errors | `dc logs --since 24h worker \| grep -i -E '"level":(50\|60)'` (pino: 50 — error, 60 — fatal), `dc logs --since 24h web \| grep -i error` | isolated network errors are acceptable; repeated ones — investigate |

Automatic notifications: e‑mails to administrators (all users with the admin role + `ADMIN_ALERT_EMAILS`) about an
integration failure after `INTEGRATION_ALERT_FAILURES` consecutive failures and about recovery. External monitoring
(recommended): Uptime Kuma or similar — HTTPS check of `/api/healthz` every minute and a certificate‑expiry check;
optionally a cron job checking `last-backup.json` via `docker exec` and e‑mailing on failure.

Routine:

- Daily (automatic): compose healthchecks, `last-backup.json`, integration failure e‑mails.
- Weekly: the whole table above, the admin dashboard, the QC queue (operator).
- Monthly: restore test (3.2), `dc pull && dc up -d` when updates exist, CI reports (audit/Trivy), log rotation (automatic),
  free disk space.
- Load and limits: `docs/perf.md`; if legitimate integrations get 429 — raise `RATE_LIMIT_API_PER_MINUTE` in `.env`
  or move the integration to a separate IP.

## 6. Incidents by data source

General procedure: dashboard → "Integrations" (status, last error, source address) → `dc logs --since 2h worker`
→ check the source from the server (`curl`) → fix → wait for the schedule or run the job manually (section 7).
Statuses: "failure, in a row N" — the source returns errors; "paused until …" — circuit breaker after
`INTEGRATION_CIRCUIT_FAILURES` failures, pause `INTEGRATION_CIRCUIT_COOLDOWN_MIN` minutes doubling up to
`INTEGRATION_CIRCUIT_MAX_COOLDOWN_MIN`; a manual run with `{"force":true}` bypasses the pause; restarting the worker resets it.

| Symptom | Diagnostics | Action |
|---|---|---|
| No forecast / "forecast is stale" on `/weather` | dashboard → SmartMet; `dc logs worker \| grep smartmet`; from the server: `curl -fsS "$SMARTMET_URL/timeseries?format=json&producer=$SMARTMET_PRODUCER&latlon=38.56,68.79&param=Temperature&timesteps=2"` | the Agency's SmartMet Server is down — contact the SmartMet/FMI administrator; temporarily switch to the sandbox `SMARTMET_URL=https://opendata.fmi.fi` (`SMARTMET_PRODUCER=ecmwf`, no weather symbols); after recovery `dc up -d worker` and a manual `smartmet-sync` run |
| No SILAM layer / "SILAM forecast is stale" | dashboard → SILAM; `curl -fsS "${SILAM_NCSS_URL}${SILAM_DATASET}/dataset.xml" \| head`; free space of the `silam` volume (`docker system df -v`) | FMI THREDDS lagging 1–2 days is normal; if the dataset changed, fix `SILAM_DATASET`; if space is short, lower `SILAM_KEEP_RUNS`; manual `silam-sync` with `force` |
| CAP warnings do not update | dashboard → CAP and `/admin/cap` → "Synchronisation" (parsing errors per file); `curl -fsS "$CAP_FEED_URL" \| head` | check `CAP_FEED_URL` (Atom/RSS/HTTP directory/`file://`), availability of the SmartMet Alert editor, certificate; errors in individual XML files — report to the issuer; manual `cap-sync` with `force` |
| E‑mails not sent (queue "failed" grows) | dashboard → mail queue; `dc logs worker \| grep -i -E 'mail\|smtp'`; test in "Settings" | SMTP access (login/port/TLS), the domain's SPF/DKIM/DMARC, `MAIL_FROM`; after the fix `dc up -d worker` — the queue delivers pending messages itself (retries) |
| Index "no data" although measurements exist | admin panel → QC queue; `select max(time) from station_index` | suspect/invalid values are excluded — decide in QC; measurements older than 6 h are stale; recalculation — `index-compute` every 10 min (manual run — section 7) |
| Worker "not responding" on the dashboard | `dc ps worker`, `dc logs --since 30m worker`, Redis: `dc exec redis redis-cli ping` | `dc restart worker`; if Redis is down — `dc restart redis worker`; if Redis memory is full (`maxmemory 256mb`, `noeviction`) — `dc exec redis redis-cli info memory` |
| Map without labels / grey | `curl -I https://<domain>/tiles/tajikistan.pmtiles` (206/200), `curl -I https://<domain>/basemaps/fonts/…` | the `tiles` volume is empty (section 1.5) or the web image was built without `basemaps` (section 1.4) |
| 502 from Caddy | `dc ps web`, `dc logs --since 10m web` | web is restarting or crashed: `dc restart web`; check `.env` (`BETTER_AUTH_SECRET` ≥ 32 characters, `DATABASE_URL`) |
| 429 for an integration/media outlet | `X-RateLimit-*` headers | raise `RATE_LIMIT_API_PER_MINUTE` (`dc up -d web`) or agree on client‑side caching |
| Archive import | `docs/import-history.md` | `--dry-run` → report → import; the index is recalculated by the script (section 11) |

## 7. Running background jobs manually

Worker jobs (BullMQ, queue `meteo-jobs`) and schedule: `heartbeat` 1 min; `mailer` 1 min; `index-compute` 10 min;
`threshold-eval` 10 min; `station-pull` 10 min; `qc-batch` 15 min; `smartmet-sync` 15 min; `cap-sync` 5 min; `silam-sync` hourly at :20.
Interval jobs also run right after the worker starts (`dc restart worker` is the simple way to "run everything now");
the cron‑based `silam-sync` runs only on schedule or manually.

On the server (the worker container has no `pnpm`, but it has `bullmq` and `ioredis`):

```bash
dc exec worker node -e "const R=require('ioredis'),{Queue}=require('bullmq');const q=new Queue('meteo-jobs',{connection:new R(process.env.REDIS_URL,{maxRetriesPerRequest:null})});q.add(process.argv[1],JSON.parse(process.argv[2]||'{}'),{jobId:process.argv[1]+':manual:'+Date.now()}).then(j=>{console.log('job',j.id);return q.close()}).then(()=>process.exit(0))" silam-sync '{"force":true}'
```

Replace `silam-sync '{"force":true}'` with the job and parameters you need:

| Job | Parameters | When |
|---|---|---|
| `smartmet-sync` | `{"force":true}`; `{"slugs":["dushanbe"]}` — only the listed points | after changing `SMARTMET_*`, adding a forecast point |
| `silam-sync` | `{"force":true}` — re‑download the current run, bypass the circuit breaker | after a THREDDS failure, dataset change |
| `cap-sync` | `{"force":true}`; `{"url":"file:///…/feed.atom","force":true}` — one‑off source (e.g. the `infra/data/cap` fixtures) | after changing `CAP_FEED_URL`, for testing |
| `station-pull` | `{}`; `{"sourceId":5,"force":true}` — one SFTP/FTP/HTTP source, even a disabled one, re-reading the newest file | after configuring a source in the station card (the "Check now" button does the same) |
| `index-compute` | `{}` | after a bulk import or scale changes (the panel does it itself) |
| `qc-batch`, `threshold-eval`, `mailer` | `{}` | speed up queue processing |

On a developer machine the same is done by `pnpm --filter @meteo/worker enqueue <job> '<json>'`. Results — in
`dc logs -f worker` (`job completed` / `job failed` lines) and on the dashboard.

## 8. Adding a station, forecast point, language, warning region

### 8.1. Station

Admin panel → "Stations" → "Add" (code, coordinates, region, pollutants and input units) — `docs/manuals/admin/en.md`, section 4.
Data: manual entry, CSV import in the panel, archive import (section 11) or automatic intake from the station (section 9.4). The station appears on the map and in the API
within a minute, the index — after the first valid measurements; the SILAM point forecast for its coordinates — at the next
`silam-sync` (or a manual run with `force`).

### 8.2. Forecast point (city/district)

Forecast points are not edited in the panel — add them to the `forecast_locations` table:

```bash
dc exec postgres psql -U meteo -d meteo -c "
insert into forecast_locations (slug, name, geom, region_id, kind, sort_order, featured, active)
values ('panjakent', '{\"tg\":\"Панҷакент\",\"ru\":\"Пенджикент\",\"en\":\"Panjakent\"}',
        ST_SetSRID(ST_MakePoint(67.6094, 39.4953), 4326),
        (select id from regions where code = 'SU'), 'city', 9, false, true);"
```

`slug` — Latin letters, used in `/weather/<slug>`, the API and widgets; `featured=true` shows the point in "Major cities"
and on the home page; `smartmet_place` (optional) — the place name in SmartMet if the forecast should be requested by name
rather than coordinates; `active=false` hides the point temporarily. Then run `smartmet-sync` manually with
`{"slugs":["panjakent"]}` and `silam-sync` with `force` (or wait for the schedule). The sitemap updates automatically.

### 8.3. Interface language

`packages/i18n`: a new `messages/<lang>.json`, `locales` and `localeTags` in `src/index.ts`, routing in
`apps/web/src/i18n/routing.ts`, check with `pnpm --filter @meteo/i18n check:messages`; database content is stored as jsonb
`{tg, ru, en}` — a new language requires changes to the admin forms (a developer task). This is a code change delivered
with a new release, not a server setting.

### 8.4. Warning regions

The `warning_regions` table (code as in the geocode of SmartMet Alert CAP messages, name, geometry) is filled from the regions
(`DU`, `RRP`, `SU`, `KT`, `GB`). If the SmartMet Alert editor uses other codes, add rows with those codes and geometry
(can be copied from `regions`/`districts`):

```sql
insert into warning_regions (code, name, geom)
select 'TJ-SU', name, geom from regions where code = 'SU';
```

Messages without a matching geocode are assigned by intersecting the CAP polygon with the regions.

## 9. Connecting external sources through `.env`

After any `.env` change: `dc up -d worker web` (only the affected services are recreated), then check the dashboard and
run the job manually (section 7).

### 9.1. SmartMet Server (weather forecast)

| Variable | Value |
|---|---|
| `SMARTMET_URL` | server address with the timeseries plugin, e.g. `https://smartmet.meteo.tj` (default: the sandbox `https://opendata.fmi.fi`) |
| `SMARTMET_PRODUCER` | model producer on the Agency's server (ask the SmartMet administrator); for opendata — `ecmwf` |
| `SMARTMET_API_KEY` | if the server requires a key (sent with the request) |
| `SMARTMET_HOURLY_STEPS` / `SMARTMET_DAILY_DAYS` | hourly (72) and daily (10) forecast horizon |

Check from the server: `curl -fsS "$SMARTMET_URL/timeseries?format=json&producer=$SMARTMET_PRODUCER&latlon=38.56,68.79&param=Temperature,WindSpeedMS,SmartSymbol&timesteps=3"`.
Weather symbols appear when the producer provides `SmartSymbol`/`WeatherSymbol3`. Points are requested by the coordinates
from `forecast_locations` (or by `smartmet_place`).

### 9.2. SILAM (air‑quality forecast)

| Variable | Value |
|---|---|
| `SILAM_NCSS_URL` | base address of the NetCDF Subset Service, default `https://thredds.silam.fmi.fi/thredds/ncss/grid/` |
| `SILAM_DATASET` | dataset path, default global `silam_glob_v6_1_sfc/silam_glob_v6_1_sfc_best.ncd`; replace when a regional Central Asia domain becomes available (D4) |
| `SILAM_KEEP_RUNS` | how many runs to keep in the `silam` volume (3; ~50–100 MB per run) |

Check: `curl -fsS "${SILAM_NCSS_URL}${SILAM_DATASET}/dataset.xml" | grep -o 'name="[^"]*"' | head`. The hourly job
checks for a new run, downloads NetCDF for the Tajikistan bbox, renders PNG layers and computes point forecasts for cities
and stations.

### 9.3. SmartMet Alert (CAP)

| Variable | Value |
|---|---|
| `CAP_FEED_URL` | the editor's Atom/RSS feed (`https://alert.meteo.tj/cap/feed.atom`), an HTTP directory with `*.xml`, or `file:///…` (the `infra/data/cap` fixtures for testing); without a value the job is skipped and the dashboard shows "source not configured" |
| `CAP_TIMEOUT_MS` | request timeout (15000) |

Check: `curl -fsS "$CAP_FEED_URL" | head -20`; then a manual `cap-sync` run with `force` and `/admin/cap` →
"Synchronisation". Messages with status `Test`/`Exercise` are visible only in the panel. Region codes in `<geocode>` must
match `warning_regions.code` (section 8.4); otherwise assignment is by polygon intersection. The `event` translation
dictionary — `/admin/cap/events`.

### 9.4. Automatic data intake from stations (ingest API, agent, SFTP/FTP/HTTP)

Three vendor-independent ways to connect an air-quality station (`docs/02-architecture.md` §8.4):

| Method | When it fits | What the station side needs |
|---|---|---|
| **Station agent** `apps/station-agent` | the vendor software writes CSV/TSV files to a folder on the station computer | Node.js 22, one file `station-agent.mjs` + `config.json`, outbound HTTPS |
| **Direct upload** to `POST /api/v1/ingest/{code}` | the logger/controller can send HTTP requests with JSON itself | outbound HTTPS, the station key |
| **Pull source** (SFTP/FTP/FTPS/HTTP) | the data is already published on a vendor's or the Agency's server | the worker can reach that server (outbound TCP 22/21/443 from the portal) |

**Network requirements.** Agent and loggers: outbound HTTPS only (TCP 443) from the station computer to the portal
address (from the Agency DMZ or through a proxy; no inbound ports). Pull sources: outbound access from the portal server
to the vendor server (SFTP 22, FTP 21 + passive ports, HTTPS 443); if the vendor server restricts access by IP, the
portal server's external IP goes on its whitelist. The station key and source passwords are secrets: the key is shown
once and only its hash is stored; source passwords are encrypted with `STATION_SOURCES_KEY` (`.env`,
`openssl rand -base64 32`; without it `BETTER_AUTH_SECRET` is used — after rotating that secret the passwords must be
re-entered) or given as `env:NAME` references to a worker environment variable.

**Step by step (agent or direct upload):**

1. Admin panel → "Stations" → station card: tick the measured pollutants and input units (values in other units are
   rejected with `pollutantNotConfigured`/`unit`), set the data source to "API" or "Automatic sensor" (then the dashboard
   and e-mails watch for missing intake), click "Generate key" in "Station API key" and copy the key immediately.
2. On the station computer: install Node.js 22 LTS, copy `apps/station-agent/station-agent.mjs` and a suitable config
   from `apps/station-agent/examples/`, fill in `portalUrl`, `stationCode`, `watchDir`, `mapping` (delimiter, time column
   and format, pollutant columns) and the key (`apiKey` or the variable named in `apiKeyEnv`).
3. Check: `node station-agent.mjs --config config.json --check` (folder and format of the newest file), then
   `--dry-run` and `--once`. Parse errors are logged with line numbers; the portal's rejection reasons are in the
   response and in the agent log.
4. Service: Windows — `service\install-task.cmd` (Task Scheduler, every 5 minutes, `--once`) or
   `service\nssm-install.cmd` (permanent NSSM service); Linux — `service/meteo-station-agent.service` (systemd).
   Details: `apps/station-agent/README.md`.
5. Check on the portal: station card → "Automatic data intake" (time, channel, accepted/rejected, period), dashboard →
   "Automatic intake" column; audit log — `measurements.ingest` entries by `station:<code>`.
   Direct upload without the agent: `curl -X POST "$PORTAL/api/v1/ingest/DU-01" -H "Authorization: Bearer $KEY"
   -H "Content-Type: application/json" -d '[{"time":"2026-10-18T07:00:00Z","pollutant":"PM25","value":42.5}]'`
   (format reference — `/data/api`).

**Step by step (pull source):**

1. `.env`: set `STATION_SOURCES_KEY` and, if needed, `STATION_PULL_TIMEOUT_MS`, `STATION_PULL_MAX_FILE_MB`,
   `STATION_PULL_LOOKBACK_DAYS` (depth of the first pass), then `dc up -d worker web`.
2. Station card → "File sources" → "Add source": type, server/port, user and password (or an SSH private key and the host
   key fingerprint `SHA256:…` from `ssh-keyscan host | ssh-keygen -lf -`), directory and file mask, column mapping
   (templates "column per pollutant" / "pollutant per row" / "separate date and time"; same format as the agent), the
   "notify when no data for longer than N minutes" threshold.
3. "Check now" → within a minute the card shows the status, success/data times and a summary (files, accepted,
   rejected, first errors); the worker log has `station-pull: file processed` / `source failed` lines.
4. From then on the worker fetches new and changed files every 10 minutes (re-processing is safe: upsert by the
   time/pollutant/averaging key). Changing the address or mask resets the registry of processed files.

**Monitoring.** An e-mail to administrators (template `stationData`, same recipients as integration failures) is sent
when a source delivers no value for longer than its threshold or a station with API intake stays silent longer than
`STATION_INGEST_STALE_MIN` (180 min); a recovery e-mail follows when data resumes. The `POST /api/v1/ingest` limit is
`RATE_LIMIT_INGEST_PER_MINUTE` (60 requests per minute per station + IP, up to 1000 records per request). To revoke a
station's access, "Rotate key" in the card (the old key stops working immediately) or set the status "suspended"
(response 403).

## 10. Restoring administrator access and resetting 2FA

Use the first option that applies:

1. **Another administrator exists** — in "Users" they run "Reset password" and/or "Reset 2FA"; this is the normal path.
2. **Only one administrator, but an operator/editor exists** — temporarily promote them to administrator in the database;
   they restore access through the panel, then revert the role (everything is recorded in the audit log):

   ```bash
   dc exec postgres psql -U meteo -d meteo -c "update users set role = 'admin' where email = 'operator@meteo.tj';"
   dc exec postgres psql -U meteo -d meteo -c "delete from sessions where user_id = (select id from users where email = 'operator@meteo.tj');"
   # after recovery: update users set role = 'operator' where email = 'operator@meteo.tj';
   ```

   The new administrator must set up 2FA at the first sign‑in.
3. **No user can sign in** — reset through the database (server access required):

   ```bash
   # 3a. Reset the administrator's 2FA and sessions
   dc exec postgres psql -U meteo -d meteo -c "
     update users set two_factor_enabled = false where email = 'admin@meteo.tj';
     delete from two_factors where user_id = (select id from users where email = 'admin@meteo.tj');
     delete from sessions where user_id = (select id from users where email = 'admin@meteo.tj');"
   # 3b. New password: the hash is computed with the application's algorithm (better-auth, scrypt)
   HASH=$(dc exec -T worker node -e "import('better-auth/crypto').then(async m => process.stdout.write(await m.hashPassword(process.argv[1])))" 'New-password-12345')
   dc exec postgres psql -U meteo -d meteo -c "
     update accounts set password = '$HASH'
     where provider_id = 'credential' and user_id = (select id from users where email = 'admin@meteo.tj');"
   # 3c. Remove a block, if any
   dc exec postgres psql -U meteo -d meteo -c "update users set banned = false, ban_reason = null, ban_expires = null where email = 'admin@meteo.tj';"
   ```

   Sign in with the new password, set up 2FA again, change the temporary password and record the action in the operations
   log (direct database changes are not reflected in the application audit log).

Do not delete users through the database: the audit log keeps only an e‑mail reference, and related records
(sessions, 2FA) are deleted in cascade only through the panel.

## 11. Measurement archive import

Historical data (the Agency's CSV/XLSX) is loaded by the script `packages/db/src/scripts/import-history.ts` using a column
mapping — format, mapping and report are described in `docs/import-history.md`. The script is not part of the images: run it
from the repository clone on the server (`pnpm install --frozen-lockfile`, Node.js 22) or from a workstation through an SSH
tunnel to PostgreSQL:

```bash
DATABASE_URL=postgres://meteo:<password>@127.0.0.1:5432/meteo \
  pnpm db:import-history -- --file ~/archive/du-2023.xlsx --mapping ~/archive/mapping.json --dry-run
DATABASE_URL=… pnpm db:import-history -- --file ~/archive/du-2023.xlsx --mapping ~/archive/mapping.json
```

Re‑running is idempotent; the index for the affected months is recalculated by the script. Back up before a large import
(section 3.1) and check the station page for the period afterwards.

## 12. Acceptance and hand‑over

At hand‑over to the Customer: `.env` and the restic password handed over by protocol through a password manager; at least two
administrators with 2FA set up; the restore test (3.2) performed on staging with a log entry; external monitoring of
`/api/healthz` configured; DNS/TLS and mail (SPF/DKIM/DMARC) verified with a test e‑mail from "Settings"; documentation —
`docs/manuals` (HTML/PDF: `pnpm docs:build`).

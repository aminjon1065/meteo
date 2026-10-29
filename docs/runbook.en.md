# Meteoportal Runbook (operations)

Version 1.1 · 17 October 2026 · Русская версия: [runbook.md](runbook.md)

For the IT service of the Agency for Hydrometeorology. Environment: a single Ubuntu 24.04 LTS host, Docker Compose
(`infra/compose/compose.prod.yml`), services caddy, web, worker, migrate, postgres (TimescaleDB + PostGIS), redis,
backup. Architecture — `docs/02-architecture.md`, security — `docs/security-checklist.md`, archive import —
`docs/import-history.md`, working in the panel — `docs/manuals/admin/en.md`.

All commands run from the repository directory on the server (`/opt/meteoportal`) as a user allowed to run Docker.
Shorthand: `dc = docker compose --env-file .env -f infra/compose/compose.prod.yml`
(add to `~/.bashrc`: `alias dc='docker compose --env-file .env -f infra/compose/compose.prod.yml'`).

A host shared with other applications, with deployment from GitHub Actions (the current `havo.tj` VPS), is
described in section 13: per‑environment directories `/opt/meteo/<environment>`, the shared proxy `/opt/edge` and a
`dc` command per environment.

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
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` | password of the `meteo` role; hex only — it is part of `DATABASE_URL`, and `/ + =` from base64 break the URL |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` | session signing; changing it ends all sessions |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` | address and a password ≥ 10 characters | first administrator; used once by seed while the users table is empty |
| `SMTP_URL` | `smtp://user:pass@mail.meteo.tj:587` or `smtps://…:465` | without it e‑mails only go to the worker log; URL‑encode special characters in the password (`@` → `%40`) |
| `MAIL_FROM` | `"Meteoportal <noreply@meteo.tj>"` | the sender domain must pass SPF/DKIM/DMARC (section 1.8) |
| `IMAGE_TAG` | `latest` or a commit SHA | image version from GHCR |
| `IMAGE_REPO` | `ghcr.io/aminjon1065` (default) | registry and owner of the `meteoportal-*` images |

Integrations (can be set later, section 9): `SMARTMET_URL`, `SMARTMET_PRODUCER`, `SMARTMET_API_KEY`,
`SMARTMET_HOURLY_STEPS`, `SMARTMET_DAILY_DAYS`; `SILAM_NCSS_URL`, `SILAM_DATASET`, `SILAM_KEEP_RUNS`;
`CAP_FEED_URL`, `CAP_TIMEOUT_MS`. Resilience and notifications: `INTEGRATION_ALERT_FAILURES` (3),
`INTEGRATION_CIRCUIT_FAILURES` (3), `INTEGRATION_CIRCUIT_COOLDOWN_MIN` (30), `INTEGRATION_CIRCUIT_MAX_COOLDOWN_MIN` (240),
`ADMIN_ALERT_EMAILS` (extra addresses, comma‑separated). Security: `RATE_LIMIT_API_PER_MINUTE` (120),
`RATE_LIMIT_AUTH_PER_MINUTE` (30), `EMBED_FRAME_ANCESTORS` (who may embed the widgets).
Backups: `RESTIC_PASSWORD` (`openssl rand -base64 32`, **store it in the password manager separately from the server**),
`RESTIC_REPOSITORY`, `RESTIC_AWS_ACCESS_KEY_ID`/`RESTIC_AWS_SECRET_ACCESS_KEY`, `BACKUP_TIME_UTC`, `BACKUP_KEEP_*`.
The paths `SILAM_DIR`, `UPLOADS_DIR`, `TILES_DIR` are set by compose (volumes) in production — do not change them.
Containers receive only the variables listed in `infra/compose/compose.prod.yml` (the whole `.env` is not passed
through): a new variable must be added both to `.env.example` and to compose. An unset variable arrives as an empty
string, which the applications treat as absent. `STATION_SOURCES_KEY` must be identical for web and worker (it is a
single value in `.env`).

### 1.4. Images

Option A — ready images from GHCR (CI publishes `ghcr.io/<owner>/meteoportal-{web,worker,backup}` with the tags
`latest` and the commit SHA after lint/tests/Trivy pass):

```bash
docker login ghcr.io          # token with read:packages
dc pull
```

After the repository moves to the Customer's GitHub, set `IMAGE_REPO=ghcr.io/<new owner>` in `.env`.

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
# reference data (pollutants, scales, limit values, regions, forecast points) and the first administrator; SEED_ADMIN_* are
# passed explicitly — compose gives the container only the variables listed in compose.prod.yml, without -e no admin is created
dc run --rm -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD -e SEED_ADMIN_NAME worker node dist/seed.js
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
dc run --rm worker node dist/seed.js       # reference data: new pollutants, scales, seed limit values (administrator edits are kept)
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
| `silam-sync` | `{"force":true}` — re‑download the current run, bypass the circuit breaker; the previous run stays on the map until the new one is downloaded and rendered (a THREDDS failure mid-download deletes nothing) | after a THREDDS failure, dataset change |
| `cap-sync` | `{"force":true}`; `{"url":"file:///…/feed.atom","force":true}` — one‑off source (e.g. the `infra/data/cap` fixtures) | after changing `CAP_FEED_URL`, for testing |
| `station-pull` | `{}`; `{"sourceId":5,"force":true}` — one SFTP/FTP/HTTP source, even a disabled one, re-reading the newest file | after configuring a source in the station card (the "Check now" button does the same) |
| `index-compute` | `{}` | after a bulk import or scale changes (the panel does it itself) |
| `qc-batch`, `threshold-eval`, `mailer` | `{}` | speed up queue processing (`mailer` runs under a lock: a concurrent run is skipped, no email is sent twice) |

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
| `SMARTMET_URL` | server address with the timeseries plugin: the SmartMet on the portal server — `http://smartmet:8080` (§14); default: the sandbox `https://opendata.fmi.fi` |
| `SMARTMET_PRODUCER` | model producer: `gfs` for the portal's SmartMet; `ecmwf` for opendata |
| `SMARTMET_WMS_URL` | SmartMet with the WMS plugin for weather layers on the map (web) — `http://smartmet:8080`; empty — no layer |
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
| `CAP_FEED_URL` | the SmartMet Alert feed on the portal server — `http://smartalert/capfeed.php` (§14); or the editor's Atom/RSS feed, an HTTP directory with `*.xml`, or `file:///…` (the `infra/data/cap` fixtures for testing); without a value the job is skipped and the dashboard shows "source not configured" |
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
| **JSON API source** (several stations behind one address) | a sensor network publishes JSON over HTTP(S) — the primary data channel of the Agency's PM sensor network (wwcs.tj API) | outbound HTTPS from the portal to the API |

**Network requirements.** Agent and loggers: outbound HTTPS only (TCP 443) from the station computer to the portal
address (from the Agency DMZ or through a proxy; no inbound ports). Pull sources: outbound access from the portal server
to the vendor server (SFTP 22, FTP 21 + passive ports, HTTPS 443); if the vendor server restricts access by IP, the
portal server's external IP goes on its whitelist. The station key and source passwords are secrets: the key is shown
once and only its hash is stored; source passwords are encrypted with `STATION_SOURCES_KEY` (`.env`,
`openssl rand -base64 32`; without it `BETTER_AUTH_SECRET` is used — after rotating that secret the passwords must be
re-entered) or given as `env:NAME` references to a worker environment variable.

**Allowed pull-source addresses.** Private networks are allowed (station servers on the Agency LAN, short names such as
`station-pc`). Forbidden: loopback, link-local (the cloud metadata address `169.254.169.254`), multicast,
`*.localhost`/`*.internal` names and — when the worker runs in Docker — the subnets of its own interfaces (compose
services `postgres`, `redis`, `web`). The check covers not only the configured address but also what the name resolves
to in DNS, and every HTTP redirect (at most 5; on a redirect to another host the source login and password are not
sent). A source with such an address gets the "failed" status with the reason `Адрес источника запрещён: <name> → <address>`.

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

**The Agency's PM sensor network (open contractor API wwcs.tj) — a "JSON API" source, the primary
data channel of this network on the portal (a regular connection, no separate consent needed).**
The `json` source type polls a sensor-network JSON API: one request for the latest records of all stations
(`GET https://wwcs.tj/services/airquality/stations` — an array of `{stationID, siteName, latitude, longitude, altitude,
timestamp, PM25, PM10, temperature, humidity, wind_speed, wind_dir, aqi}`, local time UTC+5 without offset, data every
10 minutes) and, on the first run, on a manual check or when a station has a gap — the series for the past hours
(`…/airquality/history?hours=N`, up to 72 h, ≈ 0.35 MB). Records are distributed to portal stations by the `stationID`
field (code in the source = portal station code; otherwise a mapping is given in `stations` of the field description);
a per-station cursor of the last accepted timestamp means repeated responses create no duplicates and do not extend
`last_data_at`, so a "frozen" station triggers the "no data" e-mail after its threshold. Suspended stations and unknown
codes are skipped with a note in the summary (`stationInactive:suspended`, `unknownStation`). Temperature and humidity
are not taken (the portal stores pollutants only); the site's `aqi` is not used — the portal computes the index itself.

1. **Stations and the source** are created by an idempotent script: first `pnpm --filter @meteo/db import-wwcs -- --dry-run`,
   then `pnpm --filter @meteo/db import-wwcs`. It creates 9 stations (code = `stationID`, tg/ru/en names from the table
   in the script, coordinates and altitude from the API, region and district by PostGIS, automatic sensor,
   continuous series, PM2.5 and PM10 in µg/m³) and one `json` source "WWCS airquality API" in the card of station
   DYU01_ECO (**enabled**, "no data" threshold 60 min, 24 h history): the worker polls the API on the next `station-pull`
   cycle (every 10 minutes and at start-up) and backfills a day of history. The Agency building station DYU006_ECO is
   created **suspended** (its sensor reports 450–575 µg/m³ against 2–30 at neighbours — see the station description);
   after the sensor is repaired, lift the suspension in the card — data is accepted from the next cycle. Options:
   `--disabled` (create the source disabled), `--anchor CODE`, `--stale-min N`, `--history-hours N`, `--suspend A,B`,
   `--update` (refresh coordinates and names of existing stations), `--file stations.json` (a saved response, no
   network), `--no-source`.
2. **Managing the source** — station card DYU01_ECO → "Data sources" → "WWCS airquality API": "Check now" queues an
   extra run (with 24 h of history, ignoring cursors), the "Enabled" switch stops polling without deleting the settings;
   changing the address resets the cursors (the next run fetches the history again).
3. **Verification.** Run without the queue: `pnpm --filter @meteo/worker pull-source <source id> [--force]` (JSON result
   on stdout: `files` — requests, `accepted`, `rejected`; `--force` re-reads the history ignoring cursors). Worker log:
   `station-pull: json history fetched`, `json station processed` (per station: accepted/updated), `json source done`;
   the card shows "working" and the summary "requests N, stations 8, accepted …, rejected …"; the other stations show
   the "Automatic intake" block with the "data pull" channel; publicly — `/api/v1/stations` (a level for 8 stations)
   and `/air`. First run on 20.10.2026: 2 requests, 2134 values over 24 h for 8 stations in 2 s; the repeated run — 0 new
   (cursor), no history request; the worker ran the job at start-up and on schedule.
4. **No environment variables are needed**: addresses are in the source, the API has no authentication. Shared limits —
   `STATION_PULL_TIMEOUT_MS`, `STATION_PULL_MAX_FILE_MB`. `STATION_PULL_ALLOW_FILE_URLS=1` allows `file://` addresses to
   run a mapping against a saved response and for E2E — do not set it in production.
5. **Quality control and staleness.** The DYU006_ECO sensor values are within the `range` rule (0–2000 µg/m³) and change
   from record to record, so the `range`/`stuck`/`spike` rules do not reject them (to the portal they look like a dust
   storm) — hence the station is suspended until the sensor is repaired; afterwards lift the suspension in the card and
   press "Check now". Stuck values (one value for ≥ 12 h, i.e. 73 points of a 10-minute series) and single spikes of a
   10-minute series are caught (unit tests `qc.test.ts`). Staleness: a station index older than 6 h → "no data" on the
   map and in `/air` (this is how Kulob looks when its sensor goes silent).
6. **US AQI (EPA) scale** — the third table scale `US_AQI` (six categories, EPA colours, advice), not public by default.
   To show it to visitors: "Scales and thresholds" → "US AQI (EPA)" → "Default public scale" → "Save" (the index is
   recomputed; the legend and the "About the index" page switch to six levels). Thresholds — EPA 2024 in portal units;
   a calculation with the 2012 PM2.5 table on 10-minute values gives slightly different numbers
   (docs/02-architecture.md §6.5).

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

## 13. Shared host and deployment from GitHub Actions

The portal runs on a Hostinger KVM 4 VPS (`46.202.155.70`, Ubuntu 26.04) behind Cloudflare (`havo.tj`). Other
applications share the host, so ports 80/443 belong to a shared reverse proxy (`/opt/edge`, see `infra/edge/README.md`);
the portal has two environments, each with its own database and volumes:

| Environment | URL | Directory | Compose project | Name in the `edge` network |
|---|---|---|---|---|
| production | `https://havo.tj` | `/opt/meteo/production` | `meteo` | `meteo-prod` |
| staging | `https://staging.havo.tj` | `/opt/meteo/staging` | `meteo-staging` | `meteo-staging` |

Request path: visitor → Cloudflare → shared Caddy (Cloudflare Origin Certificate, client IP from `CF-Connecting-IP`
for Cloudflare addresses only) → the portal's Caddy (HTTP `:80` inside the `edge` network; `infra/compose/compose.edge.yml`)
→ web.

- **Host setup (once, as root):** `sh infra/deploy/setup-host.sh aminjon1065/meteo` (user `deploy`,
  `/usr/local/bin/meteo-deploy`, `/opt/meteo/*`, network `edge`); `sh infra/deploy/harden-host.sh` is run by the server
  administrator (key‑only SSH, fail2ban, unattended upgrades). Firewall — in hPanel (TCP 22/80/443, UDP 443).
- **Environment files:** `/opt/meteo/<environment>/.env` (owner `deploy`, mode 600) as in 1.3 plus `EDGE_ALIAS` and
  `IMAGE_REPO`; `IMAGE_TAG` is managed by the deployment (`.deploy.env`). Use `/opt/meteo/<environment>/dc` instead of `dc`.
- **GitHub:** environments `staging` and `production` (Required reviewers, branch `main` only), each with a secret
  `DEPLOY_SSH_KEY`. The matching public keys sit in `/home/deploy/.ssh/authorized_keys` with a forced command
  (`restrict,command="/usr/local/bin/meteo-deploy <environment>"`): a key can only deploy a commit to its own environment.
- **Cloudflare:** proxied `A` records for `havo.tj`, `www`, `staging`; SSL/TLS **Full (strict)**; Origin Certificate
  issued from the CSR generated on the server (`/opt/edge/certs/havo.tj.csr`; the key never leaves the server);
  Rocket Loader and Email Obfuscation off (CSP); WAF Skip rule for `/api/v1/ingest/*` and `/api/healthz`.
- **Flow:** push to `main` → CI → images `ghcr.io/aminjon1065/meteoportal-*:<sha>` → **Deploy → staging** automatically
  → **Deploy → production** after approval. On the server `infra/deploy/deploy.sh` pulls images, backs up (production),
  migrates, seeds, restarts, waits for health and rolls back to the previous version if the new one does not come up.
  Re‑deploy or roll back: Actions → Deploy → Run workflow (environment + full commit SHA). The public Actions log only
  shows the steps; service logs stay on the server (`/opt/meteo/<environment>/logs`).

## 14. SmartMet Server and SmartMet Alert

Under the Terms of Reference (module 2), SmartMet Server and SmartMet Alert are installed in the Customer's
infrastructure with FMI tooling. No separate AlmaLinux/Rocky Linux server was provided for SmartMet, so it runs on
the portal server (Ubuntu) in FMI's official containers. Data processing uses FMI's standard RPMs
(`smartmet-qdtools`, `smartmet-data-gfs` from the `smartmet-open` repository) inside a Rocky Linux 10 container.
`/smartmet` has the same layout as an installation made with `fmidev/smartmet-install`, so FMI documentation
applies. Decision and deviations from the Terms of Reference: `docs/adr/ADR-010-smartmet-server.md`.

### 14.1. Components

| Service (`/opt/smartmet/compose.yml`) | Image | Purpose | Address |
|---|---|---|---|
| `server` | `fmidev/smartmetserver:26.08.01` | SmartMet Server: timeseries, WMS (`/wms`, `/wmts`, `/tiles`) | `http://smartmet:8080` on Docker network `smartmet`; from the host `http://127.0.0.1:8180` |
| `data` | `smartmet-data:local` (built from `infra/smartmet/data`) | GFS 0.25° download for 58–82° E, 32–46° N, up to 240 h, at 03:15, 09:15, 15:15, 21:15 UTC; schedule — supercronic as the smartmet user (log: `docker compose logs data`) | — |
| `alert-web` | `fmidev/smartmetalert:26.10.21` | warnings map and CAP feed `capfeed.php` (tg/ru/en) | `http://smartalert` on network `smartmet`; from the host `http://127.0.0.1:8181` |

Nothing is exposed publicly (ports are bound to `127.0.0.1` only).

| What | Where |
|---|---|
| Configuration (copy of `infra/smartmet` from the repository) | `/opt/smartmet` |
| Model data (querydata) | `/smartmet/data/gfs/tajikistan/{surface,pressure}/querydata` |
| Download logs | `/smartmet/logs/data/gfs_tajikistan_<run hour>.log` |
| SmartMet Alert editor publications | `/smartmet/editor/smartalert/<source>/publishedCap/<date>/` |
| GFS area and forecast steps | `infra/smartmet/cnf/data/gfs.cnf` |
| Download schedule | `infra/smartmet/cnf/cron/cron.d/gfs.cron` |
| Server data sources | `infra/smartmet/etc/engines/querydata.conf` |
| Portal WMS layers | `infra/smartmet/wms/customers/tajikistan/products/*.json` |
| Warnings map (centre, languages, hazards) | `infra/smartmet/alert/capmap-config.js`, `index.html` |

Resources: ~130 MB of memory at runtime; ~160 MB of data per run (4 surface and 2 pressure-level runs are kept),
editor copies in `/smartmet/editor/in` (2 runs).

### 14.2. Installation and updates

```bash
# from a workstation, repository root
rsync -a --delete infra/smartmet/ root@46.202.155.70:/opt/smartmet/

# on the server
mkdir -p /smartmet/data /smartmet/logs /smartmet/tmp /smartmet/editor/smartalert
chown -R 101010:101010 /smartmet
cd /opt/smartmet && docker compose build data && docker compose up -d
```

- New FMI image version: change the tag in `compose.yml`, then `docker compose pull && docker compose up -d`.
- Configuration change: files are mounted one by one, so after `rsync` run
  `docker compose up -d --force-recreate <service>`.
- Update FMI packages in the download container: `docker compose build --pull --no-cache data && docker compose up -d data`.

### 14.3. Checks

```bash
cd /opt/smartmet
docker compose ps                                   # server healthy, data and alert-web Up
ls -l /smartmet/data/gfs/tajikistan/surface/querydata/
tail -20 /smartmet/logs/data/gfs_tajikistan_*.log

# forecast for Dushanbe
curl -fsS "http://127.0.0.1:8180/timeseries?producer=gfs&latlon=38.56,68.78&param=time,origintime,Temperature,WindSpeedMS,Precipitation1h,TotalCloudCover,SmartSymbol&timesteps=4&format=json"

# WMS layers and a temperature map
curl -fsS "http://127.0.0.1:8180/wms?service=WMS&request=GetCapabilities&version=1.3.0" | grep -o "<Name>tajikistan:[^<]*"
curl -fsS -o /tmp/t.png "http://127.0.0.1:8180/wms?service=WMS&request=GetMap&version=1.3.0&layers=tajikistan:temperature&styles=&crs=EPSG:3857&bbox=7402746,4369641,8404622,5086374&width=800&height=572&format=image/png&transparent=true"

# CAP feed
curl -fsS http://127.0.0.1:8181/capfeed.php | head -30
```

Out-of-schedule GFS download (for example after downtime):

```bash
docker compose -f /opt/smartmet/compose.yml exec -d data \
  env TERM=dumb /smartmet/run/data/gfs/bin/get_gfs.sh
```

The server picks up a new run within a minute. If GFS (NOAA NOMADS) is unavailable, the server keeps serving the
last downloaded run; the `origintime` field of the response shows its time.

### 14.4. WMS layers

Portal layers are the `tajikistan:*` products: `temperature`, `precipitation`, `windspeed`, `wind` (arrows),
`cloudcover`, `pressure` (isobars). Palettes and classes are FMI image resources (`/smartmet/share/wms/resources`);
smoothing uses the layer parameters `subdivide` and `smoother`. Parameter reference: `docs/reference.md` in
[fmidev/smartmet-plugin-wms](https://github.com/fmidev/smartmet-plugin-wms). Time is the `time` parameter
(ISO 8601, UTC); available times are listed in GetCapabilities (`<Dimension name="time">`).

### 14.5. SmartMet Alert editor

The CAP editor (Java, Liberica JRE 8 Full; FMI provides the package adapted for Tajikistan) is installed on an
Agency workstation and publishes files into `/smartmet/editor/smartalert` on the server. Access is SFTP/SSHFS with
a separate account restricted to that directory; Samba is not exposed to the internet. The account is created once
the workstation and the FMI package are ready. Check: `*_ALERT_*.xml` files appear in `publishedCap/<date>/` and
`capfeed.php` lists them.

### 14.6. Connecting the portal

The portal takes forecasts, weather layers and warnings from this SmartMet once its `web` and `worker` services join
the Docker network `smartmet` and the environment `.env` sets the variables below. Joining the network is done by
`infra/compose/compose.smartmet.yml`: `deploy.sh` and `dc` add it automatically when the `smartmet` network exists on
the host (i.e. the `/opt/smartmet` project was started before the portal). Production and staging join the same
network and use one SmartMet.

Order: start SmartMet (§14.2) → add the variables to `/opt/meteo/<environment>/.env` → deploy a version with
`compose.smartmet.yml` (or, for an already deployed one, `/opt/meteo/<environment>/dc up -d web worker`). Check:
`docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' meteo-worker-1` lists the `smartmet`
network; the admin dashboard shows the SmartMet and CAP integrations as "ok"; `/map?layer=weather` shows the weather
layer. To go back to the FMI sandbox, remove the variables from `.env` and run `dc up -d web worker`.

| Variable | Value |
|---|---|
| `SMARTMET_URL` | `http://smartmet:8080` |
| `SMARTMET_PRODUCER` | `gfs` |
| `SMARTMET_WMS_URL` | `http://smartmet:8080` |
| `CAP_FEED_URL` | `http://smartalert/capfeed.php` |

### 14.7. Backup

Configuration lives in the repository (`infra/smartmet`); model data is restored by the next download. The editor
publications in `/smartmet/editor/smartalert` must be kept. They are not yet part of the restic snapshots of the
`backup` service (section 3): mount the directory into `backup` and add it to the paths in `infra/backup/run.sh`.

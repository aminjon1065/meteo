# Meteoportal station agent

Русская версия: [README.ru.md](README.ru.md).

A single-file Node.js program for the station computer. It watches the export folder of the vendor
software (CSV/TSV files), parses new rows by a column mapping and sends them to the portal:
`POST /api/v1/ingest/{station}` with the station API key. It keeps a journal of what was sent, so
rows are never sent twice, retries on network errors, and runs as a service (Windows Task Scheduler,
NSSM or systemd). It works with any vendor export: the file format is described in `config.json`.

The same parser runs inside the portal worker (`station-pull`, SFTP/FTP/HTTP sources in the station
card), so a mapping written for the agent can be pasted into the admin panel unchanged.

## Requirements

- Node.js 22 LTS (Windows: <https://nodejs.org> → LTS installer or `winget install OpenJS.NodeJS.LTS`;
  Debian/Ubuntu: `apt install nodejs` from NodeSource 22.x). No other dependencies: the agent is one file.
- Outbound HTTPS (TCP 443) from the station computer to the portal address. No inbound ports.
- A station API key: admin panel → Stations → station card → "Station API key" → "Generate key"
  (the key is shown once; only its hash is stored on the portal).

## Install

1. Copy `station-agent.mjs` and a config from `examples/` to a folder, e.g. `C:\meteo-agent\` or
   `/opt/meteo-station-agent/`. Rename the config to `config.json`.
2. Edit `config.json`: `portalUrl`, `stationCode`, `watchDir`, `mapping`. Put the key either in
   `apiKey` (then restrict file access to the service account) or in an environment variable named
   in `apiKeyEnv`.
3. Check the folder and the format of the newest file:

   ```bash
   node station-agent.mjs --config config.json --check
   ```

4. See what would be sent without sending anything:

   ```bash
   node station-agent.mjs --config config.json --dry-run
   ```

5. Send once (`--once`) and look at the result in the station card ("Automatic data intake"):

   ```bash
   node station-agent.mjs --config config.json --once
   ```

Exit codes: 0 success, 1 config/folder error, 2 the portal rejected the station key, 3 the portal is
unreachable after retries.

## Config reference

| Field | Meaning | Default |
|---|---|---|
| `portalUrl` | portal address, e.g. `https://portal.meteo.tj` | required |
| `stationCode` | station code from the registry (`DU-01`) | required |
| `apiKey` / `apiKeyEnv` | station API key, or the name of an environment variable holding it | one of them |
| `watchDir` | export folder (absolute, or relative to `config.json`) | required |
| `filePattern` | file mask: `*.csv`, `DU-01_*.txt`, `????-??-??.csv` | `*.csv` |
| `recursive` | also look into sub-folders | `false` |
| `mapping` | file format (see below) | required |
| `pollIntervalSec` | polling interval in daemon mode; `0` — one pass and exit | `60` |
| `batchSize` | records per request (max 1000) | `500` |
| `timeoutMs`, `retries` | request timeout and number of retries (network errors, 5xx, 429) | `30000`, `5` |
| `maxFileMb` | larger files are skipped | `20` |
| `lookbackDays` | on the first run only files modified within N days are sent; `0` — all | `7` |
| `settleSec` | files modified less than N seconds ago are left for the next pass (still being written) | `5` |
| `stateFile` | journal of sent rows | `station-agent.state.json` next to the config |
| `logFile`, `logMaxMb` | optional log file with rotation (`.1` copy) | stdout only, `5` |

### Mapping (`mapping`)

| Field | Meaning |
|---|---|
| `delimiter` | `;`, `,`, `tab`, `pipe`; omitted — auto-detected from the header line |
| `encoding` | `utf-8` (default), `windows-1251`, `utf-16le` … |
| `headerRow` | header line number (1); `0` — no header, columns are referenced by index from 0 |
| `skipRows` | extra lines after the header to skip (units, descriptions) |
| `commentPrefix` | lines starting with it are ignored (`#`) |
| `layout` | `wide` — a column per pollutant; `long` — pollutant / value / unit in each row |
| `time` | `{ "column", "format", "timezone" }` or `{ "dateColumn", "timeColumn", "format", "timeFormat", "defaultTime", "timezone" }`. Format tokens: `YYYY MM DD HH mm ss` (`DD.MM.YYYY HH:mm`); without a format ISO 8601, `DD.MM.YYYY HH:mm` and `YYYY-MM-DD HH:mm` are recognised. `timezone`: `Asia/Dushanbe` (default), `UTC` or `+05:00` |
| `pollutants` (wide) | `{ "PM2.5": { "column": "PM2.5 (ug/m3)", "unit": "µg/m³", "scale": 1, "flagColumn": "PM2.5 Status" } }` — the key is a pollutant code or any synonym (`pm2.5`, `Ozone`, `NO₂`, `Диоксид серы` …) |
| `pollutantColumn`, `valueColumn`, `unitColumn`, `flagColumn`, `defaultUnit` (long) | columns of the long layout |
| `pollutantAliases` | extra synonyms: `{ "Ch1": "PM25", "Ozone 1h": "O3" }` |
| `missingValues` | strings meaning "no value": `["", "-", "-999", "NaN"]` |
| `statusColumn`, `invalidStatuses`, `validStatuses` | row status column; rows with an invalid status are sent with the flag `invalid` (kept on the portal, excluded from the index) |
| `averagingMin` | averaging period of the rows in minutes (default: station setting) |

Units: when a column has no `unit`, the portal uses the station's input unit for that pollutant
(station card → "Pollutants"). Values like `<5` (below detection limit) are accepted. The portal
converts ppb/ppm/mg/m³ to the pollutant unit, applies the QC range rule and recalculates the index.

Example configs in `examples/`: `config.wide-semicolon.json` (Russian-locale export, `;`,
`DD.MM.YYYY HH:mm`), `config.long-format.json` (parameter/value/unit rows, UTC),
`config.tsv-iso-utc.json` (TSV with a units line, status columns, ppb), `config.split-date-time.json`
(separate date and time columns, windows-1251, title line above the header). Sample files are in
`examples/data/`.

## How sending works

- Every pass lists files matching the mask. A file is processed when it is new or its size/mtime
  changed. If the file was only appended (same first line, larger size), only rows after the last
  sent row are sent; if it was rewritten, the whole file is sent again — the portal stores by the
  key "time + pollutant + averaging", so re-sending never creates duplicates.
- Records go in batches (`batchSize`). The portal answers with the number of accepted and rejected
  records and a reason per record (`unknownPollutant:X`, `pollutantNotConfigured:PM10`, `time`,
  `unit:x`, `futureTime` …); the agent logs the reasons with file line numbers.
- Network errors, 5xx and 429 are retried with exponential back-off (2, 4, 8 … s, `Retry-After`
  is honoured); after `retries` attempts the pass stops and resumes at the next poll. 401/403 means a
  wrong key or station code — fix the config. 413 splits the batch in half.
- The journal (`stateFile`) is written after every batch; delete it to resend everything within
  `lookbackDays`.

## Run as a service

### Windows — Task Scheduler (recommended, `--once` every 5 minutes)

Run `service\install-task.cmd` as Administrator from the agent folder, or create the task by hand:

```bat
schtasks /Create /F /SC MINUTE /MO 5 /TN "Meteoportal station agent" /RU SYSTEM /RL LIMITED ^
  /TR "\"C:\Program Files\nodejs\node.exe\" \"C:\meteo-agent\station-agent.mjs\" --config \"C:\meteo-agent\config.json\" --once"
```

Set `pollIntervalSec: 0` in the config (or keep `--once`). To pass the key through the environment
of the task, store it with `apiKeyEnv` and set the system variable (`setx /M METEO_STATION_API_KEY mst_…`).

### Windows — NSSM (permanent service)

Download NSSM (<https://nssm.cc>), put `nssm.exe` next to the agent and run `service\nssm-install.cmd`
as Administrator. The service restarts the agent on failure; logs go to `service-stdout.log`.
`nssm edit MeteoStationAgent` opens the settings, `nssm remove MeteoStationAgent confirm` removes it.

### Linux — systemd

```bash
sudo useradd -r -s /usr/sbin/nologin meteo-agent
sudo mkdir -p /opt/meteo-station-agent && sudo cp station-agent.mjs config.json /opt/meteo-station-agent/
echo 'METEO_STATION_API_KEY=mst_…' | sudo tee /opt/meteo-station-agent/agent.env && sudo chmod 600 /opt/meteo-station-agent/agent.env
sudo chown -R meteo-agent:meteo-agent /opt/meteo-station-agent
sudo cp service/meteo-station-agent.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now meteo-station-agent
journalctl -u meteo-station-agent -f
```

The service account must be able to read the export folder (`ReadWritePaths` in the unit covers the
agent folder only; add the export folder there if the vendor software writes it elsewhere and the
unit's `ProtectSystem=strict` blocks it — reading does not need it).

## Troubleshooting

| Symptom | What to do |
|---|---|
| `Портал отклонил ключ станции (401)` | wrong `stationCode` or key; generate a new key in the station card |
| `(403 station_inactive)` | the station is suspended or decommissioned on the portal |
| rows rejected with `pollutantNotConfigured:PM10` | tick the pollutant in the station card ("Pollutants") |
| `unknownPollutant:TEMP` | the column is not a pollutant: remove it from `mapping.pollutants` or add `pollutantAliases` |
| `time:…` | wrong `time.format`; run `--check` and compare with the sample rows |
| `Портал недоступен` | check HTTPS access from the station (proxy, firewall); the agent retries automatically |
| nothing is sent | `--dry-run`; check `filePattern`, `lookbackDays` (first run) and `settleSec` |
| self-signed portal certificate | add the CA to the system store or run with `NODE_EXTRA_CA_CERTS=/path/ca.pem` |

Security: keep the key out of shared folders; the agent needs only outbound HTTPS; the portal limits
`/api/v1/ingest` to 60 requests per minute per station (the agent sends at most one request per batch).

## Development

Source: `src/agent.ts`; the parser is `@meteo/core/station-feed`. `pnpm --filter @meteo/station-agent build`
bundles everything into `station-agent.mjs` (esbuild, committed to the repository);
`pnpm --filter @meteo/station-agent test` runs the unit tests (journal, retries, batching).

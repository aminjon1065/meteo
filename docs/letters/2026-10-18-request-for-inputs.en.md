# Request for inputs under Agreement 06102026_68673 (FINTAJ Meteoportal)

**Ref. No. ___ of 18 October 2026**

**To:** Agency for Hydrometeorology of the Committee for Environmental Protection under the Government of the Republic of Tajikistan — _[name, position]_
**Copy:** Finnish Meteorological Institute (FMI), FINTAJ project — _[contact person]_
**From:** VOYAGE LLC, Director General Orzubeg Izzatov
**Subject:** Agreement 06102026_68673 of 6 October 2026 — status of the Meteoportal and request for inputs

Dear _[name]_,

Under Agreement 06102026_68673 for the development of the FINTAJ Meteoportal, we report on the status of the work and request the inputs and access rights without which the integrations with the Agency's and FMI's systems cannot be completed and the portal cannot be put into operation.

## 1. Status of the work

Implemented and verified in the Contractor's test environment:

- **M1. Air quality monitoring:** index for PM2.5, PM10, NO₂, SO₂, CO, O₃ with a five-level colour scale, charts for 24 hours / 7 days / 30 days / 1 year, CSV export, portal and e‑mail notifications, health advice panel for six population groups, data quality control with an audit log.
- **M2. SmartMet Server:** the integration is implemented and runs in test mode on FMI open data (ECMWF global model). Connection to the Agency's server follows once its address is provided (item D2).
- **M3. SmartMet Alert (CAP):** ingestion, processing and display of warnings are implemented and verified on test CAP messages. Connection to the real source follows item D3.
- **M5. SILAM:** forecast layer on the map with pollutant selector and time slider, air quality forecast for cities and stations based on FMI open data.
- **M6. Public portal (Tajik/Russian/English):** map with stations and layers, station pages, city weather, warnings, news and bulletins, subscriptions, embeddable widgets for meteo.tj, open API with documentation.
- **M7. Administration:** roles (administrator, operator, editor), two-factor authentication, station registry, manual entry and import of measurements, quality control, audit log, scales and thresholds, health advice, content management, settings.
- **M8. Documentation:** administrator and user guides in three languages, operations runbook, training materials.

We are ready to give a demonstration at your convenience.

Not started for reasons beyond the Contractor's control: **M4 — modifications of the existing meteo.tj website** (no access, item D1) and **deployment on the Customer's server** (no server and no mail service, item D8).

## 2. Requested inputs and access

| # | Requested item | Purpose | Proposed date |
|---|---|---|---|
| D1 | Access to the code, control panel and hosting of meteo.tj; clarification of "icon lines 28–29" from the ToR | meteo.tj modifications (M4) | 24 Oct 2026 |
| D2 | Address of the Agency's SmartMet Server (timeseries plugin, WMS if available), producer names, list of parameters, agreed list of forecast locations (cities/districts) | Weather forecast (M2) | 24 Oct 2026 |
| D3 | Source of SmartMet Alert CAP messages (Atom feed or CAP file directory URL), list of warning regions with codes and geometry | Warnings (M3) | 24 Oct 2026 |
| D4 | Decision on SILAM data: FMI global domain (open data, currently used) or a regional Central Asia domain if FMI provides one | Air quality forecast (M5) | 31 Oct 2026 |
| D5 | Register of air monitoring stations and details for connecting them (questions in section 3) | Monitoring (M1), registry (M7) | 24 Oct 2026 |
| D6 | Official methodology of the national index and the table of limit values (MPC), or confirmation of our defaults: operational five-level scale (modelled on the FMI index), MPC ratio and the IZA index per RD 52.04.186‑89 | Air quality index (M1) | 31 Oct 2026 |
| D7 | Texts of health advice by level and population group, or review of our drafts by medical experts | Health advice (M1) | 7 Nov 2026 |
| D8 | Server for the portal (or confirmation of a VPS), domain/subdomain, TLS certificate or the right to issue one, SMTP mail service for newsletters with SPF/DKIM/DMARC configured | Commissioning | 24 Oct 2026 |
| D9 | Official boundaries of regions and districts (shapefile/GeoJSON). If unavailable, we propose the open geoBoundaries dataset (CC BY licence) instead of GADM, whose licence excludes commercial use | Map (M6) | 7 Nov 2026 |
| D10 | Contact of a translator or reviewer for the Tajik texts of the interface, documentation and advice | All modules | 31 Oct 2026 |
| D11 | Agency logo, brand colours, rules for mentioning FMI/FINTAJ, official contact details for the portal | Portal (M6) | 31 Oct 2026 |

The dates follow the contract schedule; please let us know if they need to be adjusted.

## 3. Questions on connecting the monitoring stations (item D5)

To receive measurements automatically, we kindly ask for answers to the following questions (with the IT service and equipment specialists involved where needed):

1. **List of stations:** names, coordinates, region and district, elevation, commissioning date, status.
2. **Type of stations:** automatic (continuous analysers) or sampling posts with laboratory analysis; pollutants measured at each station (PM2.5, PM10, NO₂, SO₂, CO, O₃, others), availability of meteorological parameters.
3. **Equipment and software:** analyser manufacturers and models, station software or data logger, version, who administers and maintains it.
4. **Current data collection:** where measurements go (station PC, the Agency's central server, vendor cloud), format (CSV, XML, database, API), frequency (minute, hourly, discrete samples), units, availability of quality flags and calibration records.
5. **Export options:** outbound HTTP(S) requests, file export to a folder, FTP/SFTP, Modbus/OPC, e‑mail.
6. **Network conditions:** whether stations and servers are in a closed network or DMZ of the Agency; whether outbound HTTPS to the Internet is allowed; whether the portal's static IP address must be whitelisted; VPN availability; IT contact person.
7. **Historical data:** period available and format (our CSV/XLSX importer is ready for a one-off import).
8. **Pilot station:** one station on which the connection can be set up first.

We propose the following scheme. The primary option is data transfer from inside the Agency's network to the portal over HTTPS: the station software or our small agent installed on the station PC sends measurements to the portal's interface with an individual station key; only outbound HTTPS connections need to be allowed, and no inbound access to the network is required. The fallback option is file export to the Agency's SFTP server with periodic collection by the portal. An adapter for the specific station software will be prepared once question 3 is answered.

## 4. Questions requiring a written decision

1. Placement of the portal: a separate subdomain (e.g. portal.meteo.tj) with links and widgets on meteo.tj, or inside meteo.tj. We recommend a subdomain.
2. What constitutes the national index: the composite IZA index, the operational "MPC ratio" index, or both scales. We recommend both, plus the five-level operational scale as the primary one for the public.
3. Whether the SmartMet Alert warning regions coincide with the regions and districts of the republic.
4. Who will administer SmartMet Server and SmartMet Alert after handover (for the operations runbook).
5. Confirmation that the "3 weeks" term for M6 means the first public beta version, with all work completed by the end of the contract.
6. Whether push notifications or a Telegram bot are required (not in the ToR; a possible extension by separate agreement).

## 5. Proposed next steps

1. After receiving D8 — deployment of a staging environment on the Customer's server within three working days, followed by a demonstration.
2. After receiving D2, D3 and D5 — connection of the real data sources and a two-week trial operation.
3. Training session for the Agency's staff (2–3 hours) and handover of the documentation.
4. Acceptance against the module checklist and signing of the acceptance certificate.

Yours sincerely,

Director General, VOYAGE LLC
Orzubeg Izzatov
Tel.: _[phone]_ · E‑mail: _[e‑mail]_
5/3 Shamsi Street, Dushanbe, Republic of Tajikistan

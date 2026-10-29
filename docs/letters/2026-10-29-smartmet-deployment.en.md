# Installation of SmartMet Server and SmartMet Alert on the portal server (FINTAJ Meteoportal)

**Ref. No. ___ of 29 October 2026**

**To:** Agency for Hydrometeorology of the Committee for Environmental Protection under the Government of the Republic of Tajikistan — _[name, position]_; Finnish Meteorological Institute (FMI), FINTAJ project — _[contact person]_
**From:** VOYAGE LLC, Director General Orzubeg Izzatov
**Subject:** Agreement 06102026_68673 of 6 October 2026, modules 2 and 3 — deployment of SmartMet Server and SmartMet Alert

Dear colleagues,

Thank you, FMI, for your recommendations after reviewing havo.tj (the SmartMet Server WMS and TimeSeries plugins).
We report how SmartMet has been installed under modules 2 and 3 and ask you to approve the arrangement.

## 1. Starting point

Under the Terms of Reference, SmartMet Server and SmartMet Alert are installed in the Customer's infrastructure on a
separate server running AlmaLinux or Rocky Linux 9–10 (at least 4 cores, 8 GB RAM, 100 GB for `/smartmet`) provided
by the Customer. No separate server has been allocated, and the Agency has no SmartMet server in operation.

## 2. What has been done (29 October 2026)

To avoid delaying modules 2 and 3, SmartMet has been deployed on the havo.tj portal server in FMI's official
containers:

- **SmartMet Server** (`fmidev/smartmetserver` 26.08.01): TimeSeries and WMS interfaces.
- **GFS 0.25° data** for Tajikistan and the surrounding area (58–82° E, 32–46° N), forecasts up to 10 days, updated
  four times a day. Data is downloaded with FMI's standard packages `smartmet-qdtools` and `smartmet-data-gfs` from
  the `smartmet-open` repository (Rocky Linux 10).
- **WMS layers:** temperature, precipitation, wind speed and direction, cloud cover, pressure.
- **SmartMet Alert web** (`fmidev/smartmetalert` 26.10.21): warnings map with FMI's Tajik, Russian and English
  translations and the `capfeed.php` CAP feed, from which the portal will take warnings.
- `/smartmet` has the same layout as an installation made with `smartmet-install`, so FMI documentation and the
  training of the Agency's specialists remain applicable. Maintenance is described in the operations runbook.

## 3. Differences from the Terms of Reference

1. The server runs Ubuntu instead of AlmaLinux/Rocky Linux; SmartMet runs in FMI containers rather than being
   installed with `smartmet-install`. Server resources meet the Terms of Reference: 4 cores, 15 GB RAM, 190 GB disk.
2. SELinux and Samba are not used. The SmartMet Alert editor will publish files to the server over SFTP/SSHFS
   (SSHFS is allowed by the Terms of Reference) so that Samba is not exposed to the internet.
3. The autocomplete plugin is not enabled: it requires a geographic names database; place search on the portal
   uses its own implementation.

## 4. Requests

1. **Agency and FMI:** approve this installation arrangement in writing (clause 4 of the Agreement) or provide a
   separate server as specified in the Terms of Reference, in which case the configuration will be moved there
   unchanged.
2. **FMI:** provide the SmartMet Alert installation package adapted for Tajikistan (as foreseen in the Terms of
   Reference) and instructions for connecting the editor to the publication directory; confirm the hazard types
   and region codes used by the editor.
3. **FMI:** advise whether you recommend other models or data for Tajikistan (for example ECMWF or SILAM in
   SmartMet) and any ready WMS products for the region.
4. **Agency:** designate a workstation for the SmartMet Alert editor and a responsible staff member.

## 5. Next steps

1. Connecting the portal to the installed SmartMet: forecasts with weather symbols, weather maps on the interactive
   map, warnings from the CAP feed.
2. Installing the SmartMet Alert editor on the Agency workstation once the FMI package is received.
3. Demonstration to the Agency and FMI.

Yours sincerely,

Director General, VOYAGE LLC
Orzubeg Izzatov
Tel.: _[phone]_ · E‑mail: _[e‑mail]_
5/3 Shamsi Street, Dushanbe, Republic of Tajikistan

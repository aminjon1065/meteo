# ADR-010: SmartMet Server и SmartMet Alert - контейнеры FMI на сервере портала

**Status:** Accepted (29.10.2026; отступление от ТЗ согласуется письменно с Заказчиком и FMI) · **Date:** 2026-10-29

## Context
По договору модуль 2 - «Installing and Configuring SmartMet», модуль 3 - «Installing and Configuring SmartMet Alert»;
runbook должен включать развёртывание сервера SmartMet. Подробное ТЗ (v2) предписывает установку на отдельный
сервер Заказчика с AlmaLinux/Rocky Linux 9–10 официальным скриптом FMI (`fmidev/smartmet-install`, метапакет
`smartmet-base-international`), загрузку GFS по территории РТ, сервисы timeseries/WMS/autocomplete для портала,
веб‑модуль smartalert-web с CAP‑лентой и редактор SmartMet Alert на рабочей станции Агентства. Отдельный сервер не
выделен; Агентство передало всё, что имело, адреса SmartMet и SmartMet Alert у него нет. FMI после просмотра
havo.tj указали на плагины smartmet-plugin-wms и smartmet-plugin-timeseries. Сервер портала (VPS, Ubuntu 26.04,
4 vCPU, 15 ГБ RAM, 193 ГБ) по ресурсам проходит минимальные требования ТЗ (4/8/100), но не по ОС.

## Decision
SmartMet разворачивается на сервере портала отдельным compose‑проектом `/opt/smartmet` (`infra/smartmet`):
- `server` - официальный образ `fmidev/smartmetserver` (timeseries, WMS/WMTS/OGC API Tiles);
- `data` - Rocky Linux 10 с репозиторием FMI `smartmet-open` и штатными пакетами `smartmet-qdtools`,
  `smartmet-data-gfs`, утилиты `utcrun`/`cleaner` из `smartmet-base-international`; расписание - supercronic от
  пользователя smartmet (без root) по тем же файлам `/smartmet/cnf/cron`, корневая ФС только для чтения;
- `alert-web` - официальный образ `fmidev/smartmetalert` (smartalert-web) с настройками для Таджикистана и
  нашей правкой `capfeed.php` (см. ниже); `alert-web-test` - такой же экземпляр с тестовой лентой для staging.
Каталог `/smartmet` повторяет штатную раскладку FMI.

**CAP‑лента и отмена предупреждений (02.11.2026).** Проверено на образе `fmidev/smartmetalert:26.10.21`:
`capfeed.php` перечисляет только файлы `*_ALERT_*`/`*_UPDATE_*` последнего выпуска редактора
(`publishedCap/<год>/<месяц>/<YYYYMMDDHHmmss>/`), пропускает сообщения без `<expires>` и на одном битом XML отдаёт
HTTP 500 (Fatal error). Cancel до портала не доходил, и снятое синоптиком предупреждение держалось на сайте до
`expires`. Решение - оставить интерфейсом `capfeed.php` (так в FR3.2), но:
1. монтировать нашу версию `infra/smartmet/alert/capfeed.php` (README образа разрешает настраивать этот файл):
   `*_CANCEL_*` в ленте, сообщения без `<info>`/`<expires>` не истекают, битые файлы пропускаются с записью в журнал;
2. в портале (`cap-sync`) считать Atom‑ленту по HTTP списком действующих предупреждений: пропавшее из ленты
   сообщение снимается с публикации (`cap_alerts.withdrawn_at`, функция `reconcileCapFeed`), вернувшееся -
   публикуется снова. Так работает и отзыв без Cancel - синоптик просто не включает предупреждение в новый выпуск,
   как это показывает карта SmartAlert.
Рассматривался вариант «worker читает каталог редактора напрямую (file://, рекурсивно)»: он обходит интерфейс FR3.2
и привязывает портал к раскладке каталогов редактора; отклонён. При обновлении образа FMI - сравнить его
`capfeed.php` с нашей правкой.

**Тестовая лента.** Staging читает `http://smartalert-test/capfeed.php` (каталог `/smartmet/editor/smartalert-test`):
приёмка M3 (генератор `alert/test-feed/cap-chain.mjs`) и пробные выпуски синоптиков не попадают на havo.tj.

**Публикация из редактора - SFTP** (`infra/smartmet/sftp/setup-editor-sftp.sh`): пользователь `smartalert` только с
ключом, `internal-sftp`, chroot в `/smartmet/editor`, без перенаправлений; проверено в контейнере Ubuntu 24.04. Наружу сервисы не публикуются; портал обращается к ним по сети
Docker `smartmet`.

## Options Considered
| Вариант | Complexity | Cost | Соответствие ТЗ | Итог |
|---|---|---|---|---|
| A. Контейнеры FMI на сервере портала (выбрано) | Med | 0 | Те же пакеты и раскладка; ОС Ubuntu, без SELinux/Samba | Ресурсов хватает, без нового сервера |
| B. Отдельный VPS с AlmaLinux 10 + `smartmet-install` | Med | аренда VPS | Полное | Нет сервера от Заказчика; лишняя машина в сопровождении |
| C. Сборка SmartMet из исходников под Ubuntu | High | 0 | Низкое | Десятки C++ библиотек, сборки FMI, нет поддержки - отклонено |
| D. Ждать сервер Агентства | Low | 0 | - | Блокирует M2/M3 и карты погоды - отклонено |

## Consequences
- Проще: один хост, общие мониторинг и резервное копирование; портал получает GFS с облачностью и SmartSymbol
  (песочница opendata.fmi.fi их для Таджикистана не отдаёт), слои WMS для карты и CAP‑ленту.
- Сложнее: портал и SmartMet делят сервер (ограничения памяти/CPU в compose); образы FMI только amd64; web и worker production и staging находятся в одной сети `smartmet` (базы и Redis в неё не входят).
- Отступления от ТЗ: ОС Ubuntu вместо RHEL, нет скрипта `smartmet-install`, SELinux и Samba не используются
  (доступ редактора - SFTP/SSHFS), плагин autocomplete не включён (нужна база geonames). Требуют письменного
  согласования (п. 4 договора) - письмо `docs/letters/2026-10-29-smartmet-deployment.*.md`.
- При выделении отдельного сервера RHEL перенос - установка скриптом FMI и копирование `infra/smartmet/cnf`,
  `etc`, `wms`, `alert` в штатные каталоги.

## Action Items
1. [x] Сервер, загрузка GFS, слои WMS, smartalert-web на VPS (29.10.2026).
2. [ ] Письменное согласование схемы с Агентством и FMI.
3. [ ] Подключить портал: сеть `smartmet` (`compose.smartmet.yml`), `SMARTMET_URL`, `SMARTMET_PRODUCER=gfs`, `SMARTMET_WMS_URL`, `CAP_FEED_URL`; слои WMS на карте через маршрут `/wms` портала. Staging - 29.10.2026 (локальная сборка), production - после коммита и выкатки.
4. [ ] Учётная запись SFTP для редактора SmartMet Alert: скрипт и runbook §14.5 готовы (02.11.2026); выполнить на
   сервере, когда готовы рабочая станция и пакет FMI (нужен открытый ключ синоптика и, желательно, статический IP).
5. [x] Каталог `/smartmet/editor/smartalert` в резервное копирование (`compose.smartmet.yml` → `/srv/smartalert`, 02.11.2026).
6. [x] Отмена и снятие предупреждений через `capfeed.php`, тестовая лента для staging (02.11.2026).
7. [ ] Подтвердить у FMI, как редактор для Таджикистана называет файлы отмены (`*_CANCEL_*`?) и коды регионов
   (geocode) - портал понимает и Cancel, и снятие без Cancel.

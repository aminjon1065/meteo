# SmartMet Server и SmartMet Alert

Отдельный compose‑проект на сервере портала (`/opt/smartmet`): официальные образы FMI `fmidev/smartmetserver`
и `fmidev/smartmetalert`, плюс контейнер Rocky Linux 10 со штатными пакетами FMI для загрузки GFS.
Данные — в `/smartmet` хоста в раскладке FMI.

| Каталог | Что внутри |
|---|---|
| `compose.yml` | сервисы `server`, `data`, `alert-web`, сеть `smartmet` |
| `data/` | образ загрузки данных (репозиторий `smartmet-open`, `smartmet-qdtools`, `smartmet-data-gfs`); расписание — supercronic от пользователя smartmet по файлам `cnf/cron` |
| `cnf/` | `/smartmet/cnf`: область и шаги GFS, расписание |
| `etc/` | файлы `/etc/smartmet`, заменяющие файлы образа: движки, плагины, источники данных |
| `wms/customers/tajikistan/` | слои WMS для портала (`tajikistan:temperature` и др.) |
| `alert/` | настройки карты SmartAlert для Таджикистана (центр, языки tg/ru/en, типы явлений); `capfeed.php` — наша правка ленты FMI (Cancel, битые файлы; ADR‑010); `vendor/` — библиотеки страницы вместо CDN |
| `alert/test-feed/` | `cap-chain.mjs` — тестовая цепочка CAP (Alert → Update → Cancel, снятие) для ленты staging |
| `sftp/` | `setup-editor-sftp.sh` — SFTP‑доступ редактора SmartMet Alert (только ключ, chroot `/smartmet/editor`) |

Установка, обновление и проверки — `docs/runbook.md`, раздел 14. Решение — `docs/adr/ADR-010-smartmet-server.md`.

Библиотеки `alert/vendor/` (раньше грузились с code.jquery.com и cdn.jsdelivr.net; версии — те, что работали с CDN):

| Файл | Источник | sha256 |
|---|---|---|
| `jquery-1.9.1.min.js` | code.jquery.com | `c12f6098e641aaca96c60215800f18f5671039aecf812217fab3c0d152f6adb4` |
| `dayjs-1.11.23.min.js` | npm dayjs@1.11.23 | `0198dd0b1f760cded169c7e7ff7eaf56bc36c4c22c7c9b7c683e59437ed8700e` |
| `dayjs-plugin-utc-1.10.7.js` | npm dayjs@1.10.7 | `08dddf96c015c0f2daaf7d21c985e10d46189ebae35e850dd45aae628b317a31` |
| `dayjs-plugin-timezone-1.10.7.js` | npm dayjs@1.10.7 | `bbab80ab88515eb37391e007545ddb7b1ea6f3350b423d3e9760604319e89047` |
| `dayjs-plugin-customParseFormat-1.10.7.js` | npm dayjs@1.10.7 | `370910790b4b116432859203e4a4d7ab6bc4991d1497a739a86ef686e3822694` |

Страница SmartAlert внутренняя (порт только на 127.0.0.1); подложка её карты — тайлы OpenStreetMap.


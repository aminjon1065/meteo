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
| `alert/` | настройки карты SmartAlert для Таджикистана (центр, языки tg/ru/en, типы явлений) |

Установка, обновление и проверки — `docs/runbook.md`, раздел 14. Решение — `docs/adr/ADR-010-smartmet-server.md`.

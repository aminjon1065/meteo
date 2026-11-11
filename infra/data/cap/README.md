# Тестовые CAP‑сообщения (SmartMet Alert)

Набор для локальной проверки задачи `cap-sync` и приёмки M3 («Alert → Update → Cancel»):

| Файл | Что проверяет |
|---|---|
| `wind-alert.xml` | Actual/Alert на трёх языках (tg/ru/en), polygon + circle + geocode DU, RRP; severity Severe (оранжевый) |
| `frost-alert.xml` | Alert только на английском с префиксом `cap:`, CDATA; geocode SU; Minor (зелёный) |
| `frost-update.xml` | Update, заменяет `frost-alert.xml` через `<references>`; en + ru; Moderate (жёлтый); SU + RRP |
| `dust-alert.xml` | Alert Extreme (красный) с незамкнутым полигоном и двумя category; KT |
| `dust-cancel.xml` | Cancel: отменяет `dust-alert.xml` - исчезает с портала, остаётся в админке |
| `test-alert.xml` | status=Test - не публикуется, виден только в админке |
| `feed.atom` | Atom‑фид со ссылками на все файлы (относительные пути) |

Запуск в режиме файлов (в `.env`):

```
CAP_FEED_URL=file:///абсолютный/путь/к/infra/data/cap/feed.atom
```

или каталог целиком (`CAP_FEED_URL=file:///…/infra/data/cap/` - берутся все `*.xml`).
Ручной запуск: `pnpm --filter @meteo/worker enqueue cap-sync '{"force":true}'`.
Даты в файлах - 16–18 октября 2026 г.: после `expires` предупреждения скрываются с портала, поэтому набор
годится для разработки и тестов (`packages/core`), а не для показа. Приёмка M3 на сервере - свежая цепочка
от генератора `infra/smartmet/alert/test-feed/cap-chain.mjs` в тестовой ленте staging (runbook §14.6):
путь тот же, что у настоящих предупреждений (редактор → `capfeed.php` → `cap-sync`).

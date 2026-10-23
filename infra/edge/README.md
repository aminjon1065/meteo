# Общий обратный прокси хоста (`/opt/edge`)

Один Caddy на сервере занимает порты 80/443 и раздаёт домены приложениям. Приложения портов наружу
не публикуют: каждое — свой compose‑проект, публичный сервис которого подключён к сети Docker `edge`
под понятным именем. Так на одном VPS живут портал (production и staging) и другие приложения, не
мешая друг другу. Подробности эксплуатации портала — `docs/runbook.md` §13.

```
Cloudflare ──► :443 edge-caddy-1 ──(сеть edge)──► meteo-prod:80    ─► web / worker / postgres (проект meteo)
                                 └──────────────► meteo-staging:80 ─► … (проект meteo-staging)
                                 └──────────────► <другое-приложение>:<порт>
```

| Что | Где на сервере |
|---|---|
| compose прокси | `/opt/edge/compose.yml` |
| Общие настройки (доверенные адреса Cloudflare, сниппет `proxy_to`) | `/opt/edge/conf/Caddyfile` |
| Сайты: один файл на домен/приложение | `/opt/edge/conf/sites/*.caddy` |
| Сертификаты Origin CA Cloudflare и др. (только root) | `/opt/edge/certs/` |
| Выпущенные Let's Encrypt сертификаты, состояние Caddy | тома `edge_data`, `edge_config` |

## Добавить приложение

1. В compose приложения подключите публичный сервис к сети `edge` и дайте ему уникальное имя;
   порты 80/443 не публикуйте:

   ```yaml
   services:
     app:
       networks:
         default: {}
         edge:
           aliases: [myapp]
   networks:
     edge:
       external: true
   ```

2. Создайте `/opt/edge/conf/sites/myapp.example.com.caddy`:

   ```caddy
   myapp.example.com {
   	import proxy_to myapp:3000
   }
   ```

   Без строки `tls` Caddy сам выпустит сертификат Let's Encrypt (DNS домена должен указывать на
   сервер; за проксированием Cloudflare удобнее Origin Certificate — как у `havo.tj.caddy`).

3. Проверьте и перечитайте конфигурацию без простоя остальных сайтов:

   ```bash
   docker compose -f /opt/edge/compose.yml exec caddy caddy validate --config /etc/caddy/Caddyfile
   docker compose -f /opt/edge/compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```

После замены только файла сертификата в `certs/` (Caddyfile не менялся) нужен `caddy reload --force` —
иначе Caddy считает конфигурацию неизменной и продолжает отдавать прежний сертификат.

Сервисы на самом хосте (не в Docker) доступны прокси как `host.docker.internal` после добавления
`extra_hosts: ["host.docker.internal:host-gateway"]` к сервису `caddy` в `compose.yml`.

## Замечания

- Любой контейнер в сети `edge` может обратиться к приложениям напрямую (в обход прокси) и
  подставить свой `X-Forwarded-For`: держите в `edge` только публичные сервисы доверенных приложений,
  базы данных и внутренние сервисы — в сетях своих проектов.
- Список адресов Cloudflare в `conf/Caddyfile` меняется редко; сверять с
  <https://www.cloudflare.com/ips/> раз в квартал.

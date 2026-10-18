# Architecture Decision Records

| ADR | Решение | Статус |
|---|---|---|
| [ADR-001](ADR-001-application-stack.md) | Монолит Next.js + отдельный worker на TypeScript | Accepted |
| [ADR-002](ADR-002-database.md) | PostgreSQL + TimescaleDB + PostGIS | Accepted |
| [ADR-003](ADR-003-maps.md) | MapLibre GL + self‑hosted PMTiles | Proposed |
| [ADR-004](ADR-004-silam-integration.md) | SILAM через THREDDS NCSS → worker → PNG‑слои и точечные ряды | Proposed |
| [ADR-005](ADR-005-cap-alerts.md) | Собственный рендер CAP вместо web‑компонента FMI | Proposed |
| [ADR-006](ADR-006-auth.md) | better-auth для аутентификации и RBAC | Accepted |
| [ADR-007](ADR-007-deployment.md) | Docker Compose на одном хосте + Caddy | Accepted |
| [ADR-008](ADR-008-i18n.md) | next-intl + jsonb/таблицы переводов, tg по умолчанию | Accepted |
| [ADR-009](ADR-009-aqi-engine.md) | Табличный движок индекса с тремя шкалами | Accepted |

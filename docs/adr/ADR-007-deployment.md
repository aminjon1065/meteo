# ADR-007: Развёртывание — Docker Compose на одном хосте + Caddy

**Status:** Accepted (16.10.2026) · **Date:** 2026-10-16

## Context
Сопровождать будет IT‑служба Агентства; сервер — у Заказчика (или VPS); бюджет на инфраструктуру минимален; нагрузка — тысячи пользователей в сутки, пики при смоге/предупреждениях.

## Decision
Один Linux‑хост (Ubuntu 24.04 LTS), `docker compose` с сервисами caddy, web, worker, migrate, postgres, redis, backup. Caddy — TLS автоматом, статика, заголовки. CI собирает образы в GHCR; деплой — `compose pull && up -d` по SSH. Staging — тот же compose на отдельном хосте/проекте.

## Options Considered
| Вариант | Complexity | Cost | Передаваемость | Итог |
|---|---|---|---|---|
| A. Compose + Caddy (выбрано) | Low | Один сервер | Высокая (runbook на 10 страниц) | Достаточно для нагрузки |
| B. Kubernetes (k3s) | High | Один+ сервер | Низкая для Заказчика | Избыточно |
| C. PaaS (Vercel + managed PG) | Low | 50–200 USD/мес, внешние провайдеры | Средняя | Данные за рубежом, зависимость, worker отдельно |

## Consequences
- Проще: воспроизводимость, один файл конфигурации, бэкапы томов.
- Сложнее: нет авто‑масштабирования (не требуется); обновления ОС — по runbook.

## Action Items
1. [ ] `infra/compose` с `.env.example`, healthchecks, лимитами ресурсов.
2. [ ] Backup‑контейнер (restic) + ежемесячный тест восстановления в runbook.

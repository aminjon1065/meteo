# ADR-006: Аутентификация и RBAC — better-auth

**Status:** Accepted (16.10.2026) · **Date:** 2026-10-16

## Context
Админка с тремя ролями (admin / operator / editor), логин по e‑mail+пароль, желательно 2FA, защита от перебора, аудит входов. Внешних IdP у Заказчика нет.

## Decision
better-auth 1.x: email/password (Argon2id), сессии в cookies, плагины `admin` (роли, бан), `twoFactor` (TOTP), rate limiting; Drizzle‑адаптер. Проверка прав — на сервере в каждом server action / route handler через единый `authorize(action, resource)`.

## Options Considered
| Вариант | Complexity | Maturity | Итог |
|---|---|---|---|
| A. better-auth (выбрано) | Low | Стабильный 1.x, активная разработка | Роли/2FA из коробки |
| B. Auth.js (next-auth) | Med | v4 стабилен, v5 — долгая бета | Ориентирован на OAuth; credentials‑флоу второстепенен |
| C. Самописные сессии (по гайду Lucia) | Med | — | Больше кода на нас, нет 2FA/rate‑limit бесплатно |
| D. Keycloak | High | Высокая | Отдельный сервис, избыточно для 10–20 пользователей |

## Consequences
- Проще: быстрый старт, типизированный клиент, готовые экраны можно стилизовать под дизайн‑систему.
- Сложнее: привязка к API библиотеки; миграция при смене — таблицы стандартные.

## Action Items
1. [ ] Схема better-auth в `packages/db`, seed первого администратора через CLI.
2. [ ] Матрица прав в `packages/core/authz` + тесты.

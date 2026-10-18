# ADR-001: Стек приложения — монолит Next.js + worker на TypeScript

**Status:** Accepted (16.10.2026) · **Date:** 2026-10-16 · **Deciders:** Исполнитель (tech lead), согласование с IT‑службой Заказчика

## Context
Нужно за 10 недель поставить публичный SSR‑портал (SEO, 3 языка), админку с RBAC и CMS, фоновые интеграции (SmartMet, CAP, SILAM), e‑mail‑уведомления. Команда 1–2 человека; после сдачи сопровождает IT‑служба Агентства.

## Decision
Один Next.js 16 (App Router) для портала, админки и JSON API; отдельный Node‑процесс `worker` (BullMQ + croner) для фоновых задач; общий домен в `packages/core`, общая схема в `packages/db`. Весь код — TypeScript.

## Options Considered

### A. Next.js монолит + Node worker (выбрано)
| Dimension | Assessment |
|---|---|
| Complexity | Low–Med |
| Cost | Низкая: один язык, общие типы |
| Scalability | Достаточная (горизонтально web, 1 worker) |
| Team familiarity | Высокая |

**Pros:** SSR/ISR из коробки, один деплой, shadcn/Tailwind для качественного UI быстро, общие Zod‑схемы для форм/API/worker. **Cons:** фоновые задачи нельзя держать внутри Next — нужен worker; админку собираем сами (нет «готовой админки»).

### B. Django + DRF (Python) + Next.js фронт
| Dimension | Assessment |
|---|---|
| Complexity | Med–High (два языка, два деплоя) |
| Cost | Выше: дублирование моделей/валидации |
| Scalability | Хорошая |
| Team familiarity | Средняя |

**Pros:** Django admin, Python удобен для NetCDF/науки, Celery. **Cons:** Django admin не даёт «очень хороший» трёхъязычный UX без переписывания; два стека для сопровождения.

### C. NestJS API + Next.js фронт
**Pros:** строгая модульность, guards. **Cons:** больше кода и инфраструктуры ради тех же задач; для команды 1–2 человека — лишний слой.

### D. Laravel + Filament (PHP)
**Pros:** Filament — быстрая и красивая админка; meteo.tj, вероятно, на Laravel. **Cons:** карта/графики/SSR‑портал слабее; Node всё равно нужен для SSR; i18n‑CMS в Filament — дополнительная работа.

## Trade-off Analysis
Главные драйверы — срок, размер команды и передача. A минимизирует число технологий и даёт лучший UX‑инструментарий. Потеря «готовой админки» компенсируется shadcn + TanStack Table + генераторами форм из Zod.

## Consequences
- Проще: общие типы, один CI, одна документация по стеку.
- Сложнее: дисциплина разделения «домен без I/O» (core) и приложений; worker должен быть идемпотентным.
- Пересмотреть: если появится тяжёлая научная обработка (большие NetCDF/GRIB) — вынести Python‑микросервис.

## Action Items
1. [ ] Скаффолд монорепо (pnpm + turbo), `apps/web`, `apps/worker`, `packages/*`.
2. [ ] Шаблон CI и compose.

# syntax=docker/dockerfile:1.7
# Сборка из корня монорепозитория: docker build -f apps/worker/Dockerfile .
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat && npm install -g pnpm@12.5.1
WORKDIR /repo
ENV CI=1

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @meteo/worker...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/db ./packages/db
COPY packages/i18n ./packages/i18n
COPY apps/worker ./apps/worker
RUN pnpm --filter @meteo/worker build
# Самодостаточная prod-копия пакета: только runtime-зависимости, без симлинков
# в .pnpm-стор монорепозитория (их нельзя скопировать в образ по отдельности).
# --no-optional: pnpm (auto-install-peers) подставляет better-auth все его опциональные
# peer-зависимости, которые есть где-либо в lockfile монорепо (next, react, vitest,
# drizzle-kit), и записывает их как optionalDependencies — без флага они попадают
# в образ (+850 МБ). Нужных worker-у optionalDependencies нет: msgpackr-extract — лишь
# нативный ускоритель msgpackr с JS-fallback. Появится нужная optional-зависимость —
# пересмотреть флаг.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm --filter @meteo/worker deploy --prod --no-optional --frozen-lockfile /deploy

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# postgresql17-client — pg_dump для сервиса backup (тот же образ).
# Менеджеры пакетов базового образа в рантайме не нужны (запуск — node напрямую), а встроенные
# зависимости npm (brace-expansion, pacote, sigstore…) — постоянный источник CVE в скане Trivy.
# /app/silam и /backups создаются заранее с владельцем app: именованные тома
# при первом монтировании наследуют владельца каталога из образа.
RUN apk add --no-cache postgresql17-client \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/silam /backups && chown app:app /app/silam /backups
COPY --from=build --chown=app:app /deploy/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/apps/worker/dist ./dist
COPY --from=build --chown=app:app /repo/apps/worker/package.json ./package.json
COPY --from=build --chown=app:app /repo/packages/db/drizzle ./db/drizzle
COPY --from=build --chown=app:app /repo/packages/db/sql ./db/sql
USER app
EXPOSE 3001
CMD ["node", "dist/index.js"]

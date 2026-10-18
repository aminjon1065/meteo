# syntax=docker/dockerfile:1.7
# Сборка из корня монорепозитория: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat && npm install -g pnpm@12.5.1
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1 CI=1

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @meteo/web...

FROM deps AS build
COPY tsconfig.base.json biome.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm --filter @meteo/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
# /app/uploads и /app/silam создаются заранее с владельцем app: именованные тома
# при первом монтировании наследуют владельца каталога из образа.
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/uploads /app/silam && chown app:app /app/uploads /app/silam
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

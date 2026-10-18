# syntax=docker/dockerfile:1.7
# Образ резервного копирования: pg_dump 17 + restic. Запускается от непривилегированного пользователя,
# корневая ФС только для чтения (compose.prod.yml), пишет только в том /backups.
FROM alpine:3.22
RUN apk add --no-cache postgresql17-client restic tzdata ca-certificates \
    && addgroup -S backup && adduser -S backup -G backup \
    && mkdir -p /backups /backup && chown backup:backup /backups
COPY --chown=backup:backup run.sh /backup/run.sh
USER backup
ENV RESTIC_CACHE_DIR=/tmp/restic-cache TZ=UTC
HEALTHCHECK --interval=5m --timeout=10s --start-period=2m \
  CMD test -n "$(find /backups/last-backup.json -mmin -1500 2>/dev/null)" || exit 1
ENTRYPOINT ["/bin/sh", "/backup/run.sh"]

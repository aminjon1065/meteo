#!/usr/bin/env bash
# Подготовка самостоятельного хостинга карт (ADR-003):
#  1. pmtiles CLI (go-pmtiles) — во временную папку;
#  2. экстракт векторных тайлов Protomaps по bbox Таджикистана → infra/data/tiles/tajikistan.pmtiles;
#  3. шрифты и спрайты стиля Protomaps → apps/web/public/basemaps (гитигнорируются).
# Переменные: BBOX (lon_min,lat_min,lon_max,lat_max), MAXZOOM, BUILD (YYYYMMDD.pmtiles);
# SKIP_TILES=1 — только шрифты и спрайты (CI перед сборкой образа web), SKIP_ASSETS=1 — только тайлы
# (сервер: тайлы кладутся в том tiles, docs/runbook.md §1.5).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TILES_DIR="$ROOT/infra/data/tiles"
ASSETS_DIR="$ROOT/apps/web/public/basemaps"
TMP="${MAP_TMP:-${TMPDIR:-/tmp}/meteo-map-assets}"
BBOX="${BBOX:-66.5,36.5,75.5,41.5}"
MAXZOOM="${MAXZOOM:-14}"
mkdir -p "$TMP/bin" "$TMP/dl"
[ "${SKIP_TILES:-0}" = "1" ] || mkdir -p "$TILES_DIR"
[ "${SKIP_ASSETS:-0}" = "1" ] || mkdir -p "$ASSETS_DIR"

log() { printf '[map-assets] %s\n' "$*"; }

if [ "${SKIP_TILES:-0}" != "1" ]; then
# 1. pmtiles CLI
if ! command -v pmtiles >/dev/null 2>&1 && [ ! -x "$TMP/bin/pmtiles" ]; then
  OS="$(uname -s)"; ARCH="$(uname -m)"
  case "$ARCH" in x86_64|amd64) ARCH="x86_64" ;; arm64|aarch64) ARCH="arm64" ;; esac
  # Версия закреплена (воспроизводимость, лимиты GitHub API); PMTILES_VERSION=latest — взять последнюю
  TAG="${PMTILES_VERSION:-v1.31.2}"
  if [ "$TAG" = "latest" ]; then
    TAG="$(curl -fsSL https://api.github.com/repos/protomaps/go-pmtiles/releases/latest | python3 -c 'import sys,json;print(json.load(sys.stdin)["tag_name"])')"
  fi
  VER="${TAG#v}"
  log "скачиваю pmtiles CLI ${TAG} (${OS}/${ARCH})"
  if [ "$OS" = "Darwin" ]; then
    URL="https://github.com/protomaps/go-pmtiles/releases/download/${TAG}/go-pmtiles-${VER}_Darwin_${ARCH}.zip"
    curl -fSL --retry 3 "$URL" -o "$TMP/dl/pmtiles.zip"
    (cd "$TMP/bin" && unzip -q -o "$TMP/dl/pmtiles.zip" pmtiles && chmod +x pmtiles)
  else
    URL="https://github.com/protomaps/go-pmtiles/releases/download/${TAG}/go-pmtiles_${VER}_Linux_${ARCH}.tar.gz"
    curl -fSL --retry 3 "$URL" -o "$TMP/dl/pmtiles.tar.gz"
    tar -xzf "$TMP/dl/pmtiles.tar.gz" -C "$TMP/bin" pmtiles && chmod +x "$TMP/bin/pmtiles"
  fi
fi
PMTILES="$(command -v pmtiles || echo "$TMP/bin/pmtiles")"

# 2. Тайлы: последняя ежедневная сборка Protomaps (OpenStreetMap, ODbL)
if [ ! -s "$TILES_DIR/tajikistan.pmtiles" ]; then
  if [ -z "${BUILD:-}" ]; then
    # индекс сборок — maps.protomaps.com/builds/; если недоступен, пробуем последние даты
    BUILD="$(curl -fsSL https://maps.protomaps.com/builds/ 2>/dev/null | grep -oE '[0-9]{8}\.pmtiles' | sort -u | tail -1 || true)"
    if [ -z "$BUILD" ]; then
      for d in $(python3 -c 'import datetime as d; print(" ".join((d.date.today()-d.timedelta(days=i)).strftime("%Y%m%d") for i in range(0,10)))'); do
        if curl -fsI "https://build.protomaps.com/${d}.pmtiles" >/dev/null 2>&1; then BUILD="${d}.pmtiles"; break; fi
      done
    fi
  fi
  [ -n "$BUILD" ] || { echo "не удалось определить сборку Protomaps" >&2; exit 1; }
  log "экстракт из ${BUILD}, bbox=${BBOX}, maxzoom=${MAXZOOM}"
  "$PMTILES" extract "https://build.protomaps.com/${BUILD}" "$TILES_DIR/tajikistan.pmtiles" --bbox="$BBOX" --maxzoom="$MAXZOOM"
  printf '{"source":"https://build.protomaps.com/%s","bbox":"%s","maxzoom":%s,"attribution":"© OpenStreetMap contributors, Protomaps","extractedAt":"%s"}\n' \
    "$BUILD" "$BBOX" "$MAXZOOM" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TILES_DIR/tajikistan.json"
else
  log "тайлы уже есть: $TILES_DIR/tajikistan.pmtiles"
fi
"$PMTILES" show "$TILES_DIR/tajikistan.pmtiles" | head -20
fi

# 3. Шрифты и спрайты стиля
if [ "${SKIP_ASSETS:-0}" = "1" ]; then
  log "шрифты и спрайты пропущены (SKIP_ASSETS=1)"
elif [ ! -d "$ASSETS_DIR/fonts" ]; then
  log "скачиваю basemaps-assets (шрифты и спрайты)"
  curl -fsSL https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.zip -o "$TMP/dl/assets.zip"
  rm -rf "$TMP/assets" && mkdir -p "$TMP/assets" && (cd "$TMP/assets" && unzip -q -o "$TMP/dl/assets.zip")
  SRC="$(find "$TMP/assets" -maxdepth 1 -type d -name 'basemaps-assets-*' | head -1)"
  mkdir -p "$ASSETS_DIR/fonts" "$ASSETS_DIR/sprites"
  for face in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
    [ -d "$SRC/fonts/$face" ] && cp -R "$SRC/fonts/$face" "$ASSETS_DIR/fonts/"
  done
  cp -R "$SRC/sprites/." "$ASSETS_DIR/sprites/"
  log "ассеты: $(du -sh "$ASSETS_DIR" | cut -f1)"
else
  log "ассеты уже есть: $ASSETS_DIR"
fi
log "готово"

#!/usr/bin/env bash
# Подложки «Рельеф» и «Спутник» для главной карты (ADR-003: только открытые данные, на своём сервере).
#  1. Рельеф — infra/data/build-terrain.mjs: тайлы высот Mapterhorn (Copernicus DEM GLO-30, лицензия
#     Copernicus — свободная, с указанием источника) по bbox → $TILES_DIR/terrain.pmtiles (~120 МБ).
#  2. Спутник — безоблачный годовой композит Sentinel-2 2021 проекта ESA WorldCover (CC BY 4.0,
#     AWS Open Data s3://esa-worldcover-s2, COG 1×1°). GDAL в Docker читает по сети только обзорный
#     уровень 40 м нужных тайлов (≈ 30 МБ на тайл вместо 650 МБ), склеивает их, переводит в Web Mercator,
#     растягивает цвета и пишет MBTiles (WebP, до z12 ≈ 30 м/пиксель) с обзорными уровнями; затем
#     mbtiles-to-pmtiles.mjs переносит тайлы как есть в $TILES_DIR/satellite.pmtiles (~120 МБ).
# Переменные: TILES_DIR (infra/data/tiles), MAP_TMP (временный каталог), BBOX и TERRAIN_MAXZOOM — для
# рельефа (см. build-terrain.mjs); SAT_BBOX (67.3,36.6,75.2,41.1), SAT_MAXZOOM (12), SAT_QUALITY (78),
# SAT_SCALE_MAX (3200 — отражение ×10 000, которое станет белым), SAT_GAMMA (0.85), GDAL_IMAGE;
# SKIP_TERRAIN=1 / SKIP_SATELLITE=1 — только одна подложка; FORCE=1 — пересобрать готовое.
# Сервер: TILES_DIR — каталог тома tiles (docs/runbook.md §1.5); нужны Node 22 (или запуск из репозитория)
# и Docker. Повторный запуск спутника с другими SAT_SCALE_MAX/SAT_GAMMA берёт склейку из MAP_TMP.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TILES_DIR="${TILES_DIR:-$ROOT/infra/data/tiles}"
TMP="${MAP_TMP:-${TMPDIR:-/tmp}/meteo-basemap-layers}"
GDAL_IMAGE="${GDAL_IMAGE:-ghcr.io/osgeo/gdal:alpine-small-3.12.0}"
SAT_BBOX="${SAT_BBOX:-67.3,36.6,75.2,41.1}"
SAT_MAXZOOM="${SAT_MAXZOOM:-12}"
SAT_QUALITY="${SAT_QUALITY:-78}"
SAT_SCALE_MAX="${SAT_SCALE_MAX:-3200}"
SAT_GAMMA="${SAT_GAMMA:-0.85}"
COG_BASE="https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/rgbnir/2021"
mkdir -p "$TILES_DIR" "$TMP"
TILES_DIR="$(cd "$TILES_DIR" && pwd)"
TMP="$(cd "$TMP" && pwd)"

log() { printf '[basemap-layers] %s\n' "$*"; }

# 1. Рельеф
if [ "${SKIP_TERRAIN:-0}" = "1" ]; then
  log "рельеф пропущен (SKIP_TERRAIN=1)"
elif [ -s "$TILES_DIR/terrain.pmtiles" ] && [ "${FORCE:-0}" != "1" ]; then
  log "рельеф уже есть: $TILES_DIR/terrain.pmtiles (FORCE=1 — пересобрать)"
else
  TILES_DIR="$TILES_DIR" node "$ROOT/infra/data/build-terrain.mjs"
fi

# 2. Спутник
if [ "${SKIP_SATELLITE:-0}" = "1" ]; then
  log "спутник пропущен (SKIP_SATELLITE=1)"
  exit 0
fi
if [ -s "$TILES_DIR/satellite.pmtiles" ] && [ "${FORCE:-0}" != "1" ]; then
  log "спутник уже есть: $TILES_DIR/satellite.pmtiles (FORCE=1 — пересобрать)"
  exit 0
fi
command -v docker >/dev/null 2>&1 || { echo "нужен Docker (образ $GDAL_IMAGE)" >&2; exit 1; }

IFS=, read -r W S E N <<<"$SAT_BBOX"
floor() { awk -v v="$1" 'BEGIN { f = int(v); if (v < f) f--; print f }'; }
LIST="$TMP/cogs.txt"
: >"$LIST"
for lat in $(seq "$(floor "$S")" "$(floor "$N")"); do
  for lon in $(seq "$(floor "$W")" "$(floor "$E")"); do
    tile=$(printf 'N%02dE%03d' "$lat" "$lon")
    url="$COG_BASE/$(printf 'N%02d' "$lat")/ESA_WorldCover_10m_2021_v200_${tile}_S2RGBNIR.tif"
    if curl -fsI --retry 3 "$url" >/dev/null 2>&1; then
      echo "/vsicurl/$url" >>"$LIST"
    fi
  done
done
log "тайлов композита: $(wc -l <"$LIST" | tr -d ' ') (bbox $SAT_BBOX)"
[ -s "$LIST" ] || { echo "нет ни одного тайла композита для bbox" >&2; exit 1; }

RES=$(awk -v z="$SAT_MAXZOOM" 'BEGIN { printf "%.8f", 156543.03392804097 / (2 ^ z) }')
STAMP="$SAT_BBOX z$SAT_MAXZOOM"
log "GDAL ($GDAL_IMAGE): склейка в Web Mercator ${RES} м/пиксель, затем PMTiles"
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$TMP:/work" \
  -e GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR -e GDAL_HTTP_MULTIRANGE=YES \
  -e GDAL_HTTP_MAX_RETRY=5 -e GDAL_HTTP_RETRY_DELAY=3 -e GDAL_CACHEMAX=1024 \
  -e W="$W" -e S="$S" -e E="$E" -e N="$N" -e RES="$RES" -e STAMP="$STAMP" \
  -e QUALITY="$SAT_QUALITY" -e SCALE_MAX="$SAT_SCALE_MAX" -e GAMMA="$SAT_GAMMA" -e MAXZOOM="$SAT_MAXZOOM" \
  "$GDAL_IMAGE" sh -euc '
cd /work
# Склейка дорогая (сеть), поэтому кэшируется: повторный запуск с другими цветами её не повторяет.
if [ ! -s s2_3857.tif ] || [ "$(cat s2_3857.stamp 2>/dev/null)" != "$STAMP" ]; then
  gdalbuildvrt -q -overwrite -b 1 -b 2 -b 3 -input_file_list cogs.txt s2.vrt
  # -ovr AUTO: GDAL сам берёт обзорный уровень COG под целевое разрешение — по сети идут только они.
  gdalwarp -q -overwrite -t_srs EPSG:3857 -te_srs EPSG:4326 -te "$W" "$S" "$E" "$N" \
    -tr "$RES" "$RES" -tap -r average -ovr AUTO -multi -wo NUM_THREADS=ALL_CPUS \
    -dstnodata 0 -co TILED=YES -co COMPRESS=DEFLATE -co PREDICTOR=2 -co BIGTIFF=IF_SAFER \
    s2.vrt s2_3857.tif
  echo "$STAMP" > s2_3857.stamp
fi
# Отражение ×10 000 → 1..255 с гаммой (0 — нет данных); тайлы WebP на z$MAXZOOM и обзорные уровни
# (×2…×128 → z$MAXZOOM-1…z$MAXZOOM-7). Запись PMTiles растра в GDAL 3.12 ещё нет — её делает Node ниже.
gdal_translate -q -of VRT -ot Byte -scale 0 "$SCALE_MAX" 1 255 -exponent "$GAMMA" -a_nodata 0 \
  s2_3857.tif s2_8bit.vrt
rm -f satellite.mbtiles
gdal_translate -q -of MBTILES -co TILE_FORMAT=WEBP -co QUALITY="$QUALITY" -co RESAMPLING=AVERAGE \
  -co NAME=satellite -co TYPE=baselayer s2_8bit.vrt satellite.mbtiles
gdaladdo -q -r average satellite.mbtiles 2 4 8 16 32 64 128
'
SAT_ATTRIBUTION="ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium, CC BY 4.0"
node "$ROOT/infra/data/mbtiles-to-pmtiles.mjs" "$TMP/satellite.mbtiles" "$TILES_DIR/satellite.pmtiles" "$SAT_ATTRIBUTION"
printf '{"source":"%s","product":"ESA WorldCover Sentinel-2 median L2A (RGBNIR) composite 2021, v200","bbox":"%s","maxzoom":%s,"scale":"0-%s gamma %s","attribution":"ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium, CC BY 4.0","builtAt":"%s"}\n' \
  "$COG_BASE" "$SAT_BBOX" "$SAT_MAXZOOM" "$SAT_SCALE_MAX" "$SAT_GAMMA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$TILES_DIR/satellite.json"
log "готово: $TILES_DIR/satellite.pmtiles ($(du -h "$TILES_DIR/satellite.pmtiles" | cut -f1))"

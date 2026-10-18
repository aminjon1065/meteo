#!/usr/bin/env bash
# Символы погоды FMI SmartSymbol (MIT, github.com/fmidev/opendata-resources) → apps/web/public/weather-symbols/{light,dark}.
# Файлы маленькие и хранятся в репозитории; скрипт нужен только для обновления набора.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/apps/web/public/weather-symbols"
BASE="https://raw.githubusercontent.com/fmidev/opendata-resources/master/symbols/SmartSymbol"
for theme in light dark; do
  mkdir -p "$DEST/$theme"
  LIST="$(curl -fsSL "https://api.github.com/repos/fmidev/opendata-resources/contents/symbols/SmartSymbol/$theme" | python3 -c 'import sys,json; print("\n".join(x["name"] for x in json.load(sys.stdin) if x["name"].endswith(".svg")))')"
  count=0
  for name in $LIST; do
    curl -fsSL "$BASE/$theme/$name" -o "$DEST/$theme/$name" && count=$((count+1))
  done
  echo "[weather-symbols] $theme: $count файлов"
done
curl -fsSL "https://raw.githubusercontent.com/fmidev/opendata-resources/master/symbols/SmartSymbol/README.md" -o "$DEST/README.md" || true

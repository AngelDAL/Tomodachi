#!/usr/bin/env bash
# Prueba del service worker contra una instancia (Chrome headless + CDP).
#
# Comprueba lo que las suites de curl no pueden ver: que el service worker se
# instale, se ACTIVE y deje el precache completo. Nace de TAB-35: el precache
# declaraba dos CSS inexistentes y el `addAll` atómico tumbaba el install
# entero, así que el SW nunca se activaba (0 registros, controller null).
#
# Uso:
#   bash docker/test_service_worker.sh [base_url] [página]
#   bash docker/test_service_worker.sh http://127.0.0.1:8091 /public/sales.html
#
# Opciones extra se pasan a tests/sw/verify_service_worker.mjs
# (--json <ruta>, --allow-missing <activo>, --expect fail, --timeout <ms>).
#
# Requiere Chrome/Chromium y node ≥ 22 (WebSocket nativa). Si falta alguno,
# sale con SKIP sin fallar la batería.
set -uo pipefail

BASE="${1:-http://127.0.0.1:8091}"
PAGINA="${2:-/public/sales.html}"
if [ "$#" -ge 1 ]; then shift; fi
if [ "$#" -ge 1 ]; then shift; fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "SKIP | node no está instalado: no se puede probar el service worker"
  exit 0
fi

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROME" ]; then
  echo "SKIP | no hay Chrome/Chromium: no se puede probar el service worker"
  exit 0
fi

echo "===== Service worker — $BASE$PAGINA (Chrome: $CHROME) ====="
exec node "$RAIZ/tests/sw/verify_service_worker.mjs" \
  --url "$BASE" --page "$PAGINA" --chrome "$CHROME" "$@"

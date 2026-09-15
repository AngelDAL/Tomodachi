#!/usr/bin/env bash
# Pruebas de unidad de Tomodachi (node, sin dependencias).
#
# Corre todos los tests/*_test.js — reglas de negocio que viven en el navegador
# (promociones, umbral de existencias) y que, si se rompen, se rompen en silencio.
#
# La batería HTTP (docker/test_suite.sh) prueba la API con sesión; esto prueba las
# reglas puras, que es otra cosa y corre en un segundo. Las dos se complementan.
#
# Uso: bash docker/unit_tests.sh
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

if ! command -v node >/dev/null 2>&1; then
  echo "SKIP | node no está instalado: no se pueden correr las pruebas de unidad"
  exit 0
fi

ARCHIVOS=(tests/*_test.js)
if [ ! -e "${ARCHIVOS[0]}" ]; then
  echo "SKIP | no hay pruebas de unidad en tests/"
  exit 0
fi

TOTAL=0; FALLARON=0
for archivo in "${ARCHIVOS[@]}"; do
  echo "--- $archivo"
  if node "$archivo"; then
    TOTAL=$((TOTAL+1))
  else
    TOTAL=$((TOTAL+1)); FALLARON=$((FALLARON+1))
  fi
done

echo
echo "===== Pruebas de unidad: $((TOTAL-FALLARON)) de $TOTAL archivos en verde ====="
exit $FALLARON

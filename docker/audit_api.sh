#!/bin/bash
# Audit API — Tomodachi POS
# Cuenta y lista endpoints por módulo para mantener docs/API.md al día.
# Uso: bash docker/audit_api.sh [ruta]
set -e
API_DIR="${1:-api}"

echo "== Total archivos de endpoint en ${API_DIR} =="
find "${API_DIR}" -name "*.php" | wc -l
echo
echo "== Por módulo =="
for d in "${API_DIR}"/*/; do
  [ -d "$d" ] || continue
  n=$(find "$d" -name "*.php" | wc -l)
  [ "$n" -gt 0 ] && printf "  %-24s %s\n" "$(basename "$d"):" "$n"
done | sort

#!/usr/bin/env bash
# Pruebas de la ESTACIÓN de preparación por producto (mitad restante de T2.4).
#
#   GET/POST/PUT api/inventory/products.php   (campo station_id)
#   GET      api/dining/stations.php
#
# Qué comprueba:
#   1. Un producto se crea YA asignado a una estación (POST con station_id).
#   2. La edición cambia la estación (PUT) y la puede quitar (station_id null).
#   3. Una estación inexistente o ajena se RECHAZA con error de validación — nunca 500.
#   4. El GET devuelve station_id (para que la pantalla sepa qué marcar).
#   5. Aislamiento multi-tienda: la estación de otra tienda no se puede asignar.
#
# Uso: bash docker/test_product_station.sh [base_url]
set -u
BASE="${1:-http://localhost:8091}"
PASS=0; FAIL=0; SKIP=0
CJ=$(mktemp)

ok()   { echo "PASS | $1"; PASS=$((PASS+1)); }
mal()  { echo "FAIL | $1"; FAIL=$((FAIL+1)); }
salt() { echo "SKIP | $1"; SKIP=$((SKIP+1)); }
api()  { curl -s -b "$CJ" -H 'Content-Type: application/json' "$@"; }
jq_()  { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
for k in '$1'.split('.'):
    d = (d or {}).get(k) if isinstance(d, dict) else None
print('' if d is None else d)" 2>/dev/null; }
# station_id de un producto por id, o la cadena 'null'
station_de() { python3 -c "
import json,sys
d=json.load(sys.stdin).get('data')
items = d if isinstance(d,list) else ((d or {}).get('products') or (d or {}).get('productos') or [])
for p in items:
    if str(p.get('product_id'))=='$1': print(p.get('station_id'))" 2>/dev/null; }

echo "===== Estación de preparación por producto — $BASE ====="
curl -s -o /dev/null -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
perfil=$(api "$BASE/api/users/profile.php")
if echo "$perfil" | grep -q "must_change_password"; then
  fn=$(echo "$perfil" | jq_ data.full_name); em=$(echo "$perfil" | jq_ data.email)
  api -o /dev/null -X POST "$BASE/api/users/profile.php" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"${fn:-Admin}\",\"email\":\"${em:-a@example.com}\",\"password\":\"admin123\",\"current_password\":\"admin123\"}"
fi
if [ "$(api "$BASE/api/users/profile.php" | jq_ data.role)" != "admin" ]; then
  mal "no hay sesión de admin: no se puede probar"; echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron, $SKIP omitidas ====="; exit 1
fi

suf=$RANDOM

# Dos estaciones propias para poder mover el producto de una a otra.
E1=$(api -X POST "$BASE/api/dining/stations.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"guardar\",\"name\":\"Cocina ZZ $suf\"}" | jq_ data.station_id)
E2=$(api -X POST "$BASE/api/dining/stations.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"guardar\",\"name\":\"Barra ZZ $suf\"}" | jq_ data.station_id)
if [ -z "$E1" ] || [ -z "$E2" ]; then
  mal "no se pudieron crear las estaciones de prueba"; echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron, $SKIP omitidas ====="; exit 1
fi
ok "prepara dos estaciones ($E1 cocina, $E2 barra)"

# 1. Crear el producto YA asignado a una estación
PROD=$(api -X POST "$BASE/api/inventory/products.php" -H 'Content-Type: application/json' \
  -d "{\"product_name\":\"ZZ Estacion $suf\",\"price\":35,\"cost\":1,\"stock\":10,\"station_id\":$E1}" | jq_ data.product_id)
if [ -n "$PROD" ]; then ok "crea el producto con su estación en el mismo alta"; else mal "crear producto con estación"; fi

en_bd=$(api "$BASE/api/inventory/products.php?context=pos" | station_de "$PROD")
if [ "$en_bd" = "$E1" ]; then ok "el GET devuelve la estación asignada ($en_bd)"; else mal "station_id tras crear (leído='$en_bd', esperado=$E1)"; fi

# 2. Editar: mover a la otra estación
api -o /dev/null -X PUT "$BASE/api/inventory/products.php" -H 'Content-Type: application/json' \
  -d "{\"product_id\":$PROD,\"station_id\":$E2}"
en_bd=$(api "$BASE/api/inventory/products.php?context=pos" | station_de "$PROD")
if [ "$en_bd" = "$E2" ]; then ok "la edición mueve el producto a la otra estación"; else mal "mover estación (leído='$en_bd', esperado=$E2)"; fi

# 3. Quitarla con null (sin preparación)
api -o /dev/null -X PUT "$BASE/api/inventory/products.php" -H 'Content-Type: application/json' \
  -d "{\"product_id\":$PROD,\"station_id\":null}"
en_bd=$(api "$BASE/api/inventory/products.php?context=pos" | station_de "$PROD")
if [ "$en_bd" = "None" ] || [ "$en_bd" = "" ] || [ "$en_bd" = "null" ]; then
  ok "se puede dejar SIN preparación (station_id null)"
else
  mal "quitar la estación (leído='$en_bd')"
fi

# 4. Una estación que no existe se rechaza con validación, no con 500
r=$(api -X PUT "$BASE/api/inventory/products.php" -H 'Content-Type: application/json' \
  -d "{\"product_id\":$PROD,\"station_id\":999999}")
cod=$(curl -s -o /dev/null -w '%{http_code}' -b "$CJ" -H 'Content-Type: application/json' \
  -X PUT "$BASE/api/inventory/products.php" -d "{\"product_id\":$PROD,\"station_id\":999999}")
if [ "$cod" = "422" ]; then ok "estación inexistente = 422 (validación, no 500)"; else mal "estación inexistente (http=$cod, resp=$r)"; fi

# 5. Aislamiento multi-tienda: una estación de OTRA tienda no se puede asignar
OTRA=$(docker exec tm-test-db mariadb -uroot -ptomodachi_root_secret tomodachi_pos -N -e \
  "SELECT station_id FROM stations WHERE store_id <> 1 LIMIT 1;" 2>/dev/null | head -1)
if [ -z "$OTRA" ]; then
  salt "aislamiento multi-tienda: esta instancia solo tiene la tienda 1 (nada que probar)"
else
  cod=$(curl -s -o /dev/null -w '%{http_code}' -b "$CJ" -H 'Content-Type: application/json' \
    -X PUT "$BASE/api/inventory/products.php" -d "{\"product_id\":$PROD,\"station_id\":$OTRA}")
  if [ "$cod" = "422" ]; then ok "la estación de otra tienda se rechaza"; else mal "estación ajena (http=$cod)"; fi
fi

# 6. El aislamiento no se rompió en el resto del endpoint: la tienda sigue siendo la de sesión
r=$(api "$BASE/api/inventory/products.php?context=pos")
if [ "$(echo "$r" | jq_ success)" = "True" ]; then ok "el listado sigue respondiendo igual"; else mal "el listado se rompió ($r)"; fi

echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron, $SKIP omitidas ====="
rm -f "$CJ"
[ "$FAIL" -eq 0 ]

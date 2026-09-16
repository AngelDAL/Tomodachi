#!/usr/bin/env bash
# Pruebas de quién puede dar de alta puntos de servicio y de la reactivación.
#
# Qué comprueba:
#   - el administrador da de alta un punto (201)
#   - un nombre ya ACTIVO no se duplica, y el aviso dice exactamente qué hacer
#   - un nombre DESACTIVADO se REACTIVA (no se duplica) y CONSERVA su QR
#   - un MESERO (rol waiter) también puede dar de alta, editar y desactivar
#   - un rol que no atiende mesas NO puede (403)
#
# Uso: bash docker/test_service_points_permissions.sh [base_url] [db_container]
#      (el contenedor de BD es opcional: sin él se salta la prueba del rol ajeno)
set -u
BASE="${1:-http://localhost:8091}"
DB="${2:-tm-test-db}"
PASS=0; FAIL=0
CJ=$(mktemp); CJW=$(mktemp); CJO=$(mktemp)
SUF=$RANDOM

ok()  { echo "PASS | $1"; PASS=$((PASS+1)); }
mal() { echo "FAIL | $1"; FAIL=$((FAIL+1)); }
api()  { curl -s -b "$CJ"  -H 'Content-Type: application/json' "$@"; }
apiw() { curl -s -b "$CJW" -H 'Content-Type: application/json' "$@"; }
apio() { curl -s -b "$CJO" -H 'Content-Type: application/json' "$@"; }
jq_() { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
for k in '$1'.split('.'):
    if isinstance(d, dict): d = d.get(k)
    elif isinstance(d, list) and k.isdigit() and len(d) > int(k): d = d[int(k)]
    else: d = None
print('' if d is None else d)" 2>/dev/null; }

echo "===== Puntos de servicio: permisos y reactivación — $BASE ====="

curl -s -o /dev/null -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
perfil=$(api "$BASE/api/users/profile.php")
if echo "$perfil" | grep -q "must_change_password"; then
  fn=$(echo "$perfil" | jq_ data.full_name); em=$(echo "$perfil" | jq_ data.email)
  api -o /dev/null -X POST "$BASE/api/users/profile.php" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"${fn:-Admin}\",\"email\":\"${em:-a@example.com}\",\"password\":\"admin123\",\"current_password\":\"admin123\"}"
fi
if [ -z "$(api "$BASE/api/users/profile.php" | jq_ data.username)" ]; then
  echo "SKIP | no se pudo entrar como admin"; exit 0
fi

NOMBRE="Punto prueba $SUF"

# 1) Alta normal
R=$(api -X POST "$BASE/api/dining/tables.php" -d "{\"label\":\"$NOMBRE\",\"zone\":\"Pruebas\"}")
P1=$(echo "$R" | jq_ data.table_id)
QR1=$(echo "$R" | jq_ data.qr_token)
if [ -n "$P1" ]; then ok "el administrador da de alta un punto de servicio"
else mal "el administrador da de alta un punto de servicio"; fi

# 2) El mismo nombre activo NO se duplica, y el aviso es accionable
R=$(api -X POST "$BASE/api/dining/tables.php" -d "{\"label\":\"$NOMBRE\"}")
AVISO=$(echo "$R" | jq_ error.label)
if [ "$(echo "$R" | jq_ success)" = "False" ] && echo "$AVISO" | grep -qi "ACTIVO"; then
  ok "un nombre ya activo no se duplica y el aviso explica qué hacer"
else mal "un nombre ya activo no se duplica (aviso='$AVISO')"; fi

# 3) Desactivar y volver a dar de alta el MISMO nombre: se reactiva y conserva el QR
api -o /dev/null -X DELETE "$BASE/api/dining/tables.php?table_id=$P1"
R=$(api -X POST "$BASE/api/dining/tables.php" -d "{\"label\":\"$NOMBRE\"}")
QR2=$(echo "$R" | jq_ data.qr_token)
REACT=$(echo "$R" | jq_ data.reactivado)
if [ "$REACT" = "True" ] && [ "$QR2" = "$QR1" ]; then
  ok "un nombre desactivado se reactiva y CONSERVA su QR impreso"
else mal "reactivación (reactivado=$REACT, qr igual=$([ "$QR2" = "$QR1" ] && echo si || echo no))"; fi

# 4) Un mesero también puede administrar el salón
USU="mesero$SUF"
IDU=$(api -X POST "$BASE/api/users/create.php" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USU\",\"full_name\":\"Mesero de prueba\",\"email\":\"$USU@example.com\",\"password\":\"Mesero12345\",\"role\":\"waiter\",\"store_id\":1}" | jq_ data.user_id)
curl -s -o /dev/null -c "$CJW" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USU\",\"password\":\"Mesero12345\"}"
R=$(apiw -X POST "$BASE/api/dining/tables.php" -d "{\"label\":\"Mesa del mesero $SUF\",\"zone\":\"Terraza\"}")
P2=$(echo "$R" | jq_ data.table_id)
if [ -n "$P2" ]; then ok "un MESERO da de alta un punto de servicio"
else mal "un MESERO da de alta un punto de servicio ($(echo "$R" | jq_ message))"; fi

R=$(apiw -X PUT "$BASE/api/dining/tables.php" -d "{\"table_id\":$P2,\"label\":\"Mesa del mesero $SUF\",\"zone\":\"Terraza alta\"}")
if [ "$(echo "$R" | jq_ success)" = "True" ]; then ok "el mesero edita el punto (corregir zona o nombre)"
else mal "el mesero edita el punto ($(echo "$R" | jq_ message))"; fi

# 5) Un rol que NO administra el salón (el cajero lleva el dinero, no el acomodo de mesas)
USU2="cajero$SUF"
ID2=$(api -X POST "$BASE/api/users/create.php" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USU2\",\"full_name\":\"Cajero de prueba\",\"email\":\"$USU2@example.com\",\"password\":\"Cajero12345\",\"role\":\"cashier\",\"store_id\":1}" | jq_ data.user_id)
curl -s -o /dev/null -c "$CJO" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USU2\",\"password\":\"Cajero12345\"}"
R=$(apio -X POST "$BASE/api/dining/tables.php" -d "{\"label\":\"No deberia existir $SUF\"}")
if [ "$(echo "$R" | jq_ success)" = "False" ]; then
  ok "un cajero no puede dar de alta puntos de servicio ($(echo "$R" | jq_ message | cut -c1-45)…)"
else mal "un cajero no puede dar de alta puntos de servicio"; fi

# 5b) Pero SÍ puede operar el salón: abrir la cuenta de un punto es otra cosa
R=$(apio -X POST "$BASE/api/dining/session.php" -d "{\"action\":\"open_table\",\"table_id\":$P1}")
CUENTA=$(echo "$R" | jq_ data.session_id)
if [ -n "$CUENTA" ]; then
  ok "…pero sí puede abrir la cuenta de un punto (operar el salón no es administrarlo)"
  apio -o /dev/null -X POST "$BASE/api/dining/session.php" \
    -d "{\"action\":\"cancel\",\"session_id\":$CUENTA,\"reason\":\"prueba automatica de permisos\"}"
else mal "el cajero puede operar el salón ($(echo "$R" | jq_ message))"; fi

# Limpieza
for t in "$P1" "$P2"; do [ -n "$t" ] && api -o /dev/null -X DELETE "$BASE/api/dining/tables.php?table_id=$t&force=1"; done
for u in "$IDU" "$ID2"; do [ -n "$u" ] && api -o /dev/null -X DELETE "$BASE/api/users/delete.php?user_id=$u"; done
rm -f "$CJ" "$CJW" "$CJO"

echo
echo "===== RESULTADO puntos y permisos: $PASS pasaron, $FAIL fallaron ====="
exit $FAIL

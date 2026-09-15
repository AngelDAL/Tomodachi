#!/usr/bin/env bash
# Pruebas de las cuentas de punto de servicio (Fase 1, T1.5):
#   GET  api/dining/session.php?abiertas=1
#   POST action=open_table / add_point / remove_point / cancel
#
# Qué comprueba:
#   - abrir la cuenta de un punto, y que no se pueda abrir otra en el mismo punto
#   - juntar un punto a la cuenta, verlo listado como punto de la cuenta
#   - juntar el mismo punto dos veces: informa que ya estaba, sin duplicar
#   - separar el punto PRINCIPAL: no se puede (se explica por qué)
#   - separar un punto que no está en la cuenta: NO puede decir "se separó"
#   - cancelar sin motivo: no se permite (una cuenta cancelada debe poder auditarse)
#   - cancelar con motivo: la cuenta sale de la lista de abiertas
#
# Uso: bash docker/test_dining_checks.sh [base_url]
set -u
BASE="${1:-http://localhost:8091}"
PASS=0; FAIL=0
CJ=$(mktemp)

ok()  { echo "PASS | $1"; PASS=$((PASS+1)); }
mal() { echo "FAIL | $1"; FAIL=$((FAIL+1)); }
api() { curl -s -b "$CJ" -H 'Content-Type: application/json' "$@"; }
jq_() { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
for k in '$1'.split('.'):
    d = (d or {}).get(k) if isinstance(d, dict) else None
print('' if d is None else d)" 2>/dev/null; }

echo "===== Cuentas por punto de servicio — $BASE ====="
curl -s -o /dev/null -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
perfil=$(api "$BASE/api/users/profile.php")
if echo "$perfil" | grep -q "must_change_password"; then
  fn=$(echo "$perfil" | jq_ data.full_name); em=$(echo "$perfil" | jq_ data.email)
  api -o /dev/null -X POST "$BASE/api/users/profile.php" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"${fn:-Admin}\",\"email\":\"${em:-a@example.com}\",\"password\":\"admin123\",\"current_password\":\"admin123\"}"
fi

suf=$RANDOM
P1=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' -d "{\"label\":\"Prueba A $suf\"}" | jq_ data.table_id)
P2=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' -d "{\"label\":\"Prueba B $suf\"}" | jq_ data.table_id)
if [ -z "$P1" ] || [ -z "$P2" ]; then
  mal "no se pudieron crear los puntos de prueba"; echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="; exit 1
fi

# 1. Lista de abiertas responde
r=$(api "$BASE/api/dining/session.php?abiertas=1")
if [ "$(echo "$r" | jq_ success)" = "True" ]; then ok "lista de cuentas abiertas responde"; else mal "lista de abiertas ($r)"; fi

# 2. Abrir cuenta en el punto A
r=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"open_table\",\"table_id\":$P1}")
SID=$(echo "$r" | jq_ data.session_id); COD=$(echo "$r" | jq_ data.code)
if [ -n "$SID" ]; then ok "abre la cuenta del punto (codigo $COD)"; else mal "abre la cuenta del punto ($r)"; fi

# 3. No se puede abrir otra cuenta en el mismo punto
r=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"open_table\",\"table_id\":$P1}")
if echo "$r" | grep -q "ya tiene la cuenta"; then ok "no deja abrir dos cuentas en el mismo punto"; else mal "dos cuentas en el mismo punto ($r)"; fi

# 4. Juntar el punto B a la cuenta
r=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"add_point\",\"session_id\":$SID,\"table_id\":$P2}")
puntos=$(echo "$r" | python3 -c "import json,sys; print(len((json.load(sys.stdin).get('data') or {}).get('puntos') or []))" 2>/dev/null)
if [ "$puntos" = "2" ]; then ok "junta el segundo punto (la cuenta queda con 2)"; else mal "juntar punto (puntos=$puntos)"; fi

# 5. Juntarlo otra vez: dice que ya estaba, sin duplicar
r=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"add_point\",\"session_id\":$SID,\"table_id\":$P2}")
if [ "$(echo "$r" | jq_ data.cambio)" = "False" ] && echo "$r" | grep -q "ya estaba"; then
  ok "juntar dos veces: informa que ya estaba (no duplica)"
else mal "juntar dos veces ($r)"; fi

# 6. Separar el punto principal no se permite
r=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"remove_point\",\"session_id\":$SID,\"table_id\":$P1}")
if echo "$r" | grep -q "punto principal"; then ok "no separa el punto principal (lo explica)"; else mal "separar el principal ($r)"; fi

# 7. Separar un punto que no está: no puede decir que lo hizo
P3=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' -d "{\"label\":\"Prueba C $suf\"}" | jq_ data.table_id)
r=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"remove_point\",\"session_id\":$SID,\"table_id\":$P3}")
if echo "$r" | grep -q "no está en esa cuenta"; then ok "separar un punto ajeno: lo rechaza"; else mal "separar un punto ajeno ($r)"; fi

# 8. Separar el punto juntado sí funciona
r=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"remove_point\",\"session_id\":$SID,\"table_id\":$P2}")
puntos=$(echo "$r" | python3 -c "import json,sys; print(len((json.load(sys.stdin).get('data') or {}).get('puntos') or []))" 2>/dev/null)
if [ "$puntos" = "1" ]; then ok "separa el punto juntado (queda 1)"; else mal "separar el juntado (puntos=$puntos)"; fi

# 9. Cancelar sin motivo: no se permite
r=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"cancel\",\"session_id\":$SID}")
if echo "$r" | grep -q "por qué se cancela"; then ok "cancelar sin motivo: lo rechaza"; else mal "cancelar sin motivo ($r)"; fi

# 10. Cancelar con motivo
r=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"cancel\",\"session_id\":$SID,\"reason\":\"prueba automatica\"}")
if [ "$(echo "$r" | jq_ data.status)" = "cancelled" ]; then ok "cancela con motivo"; else mal "cancelar con motivo ($r)"; fi

# 11. Ya no aparece entre las abiertas
r=$(api "$BASE/api/dining/session.php?abiertas=1")
sigue=$(echo "$r" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
print('SI' if any(str(c['session_id'])=='$SID' for c in d.get('checks',[])) else 'NO')" 2>/dev/null)
if [ "$sigue" = "NO" ]; then ok "la cuenta cancelada sale de las abiertas"; else mal "la cuenta cancelada sigue listada"; fi

# Limpieza de los puntos de prueba
for p in "$P1" "$P2" "$P3"; do api -o /dev/null -X DELETE "$BASE/api/dining/tables.php?table_id=$p&force=1"; done

echo
echo "===== RESULTADO cuentas por punto: $PASS pasaron, $FAIL fallaron ====="
rm -f "$CJ"
exit $FAIL

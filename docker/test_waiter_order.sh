#!/usr/bin/env bash
# Pruebas del pedido anotado por el PERSONAL (el mesero anota por los clientes).
#
# Qué comprueba:
#   - el mesero agrega a la cuenta sin tener el join_token del comensal (autoriza por tienda)
#   - lo que agrega queda a nombre del personal, con sus notas ("sin cebolla")
#   - el mesero puede QUITAR una línea que aún no se manda a cocina
#   - una vez enviada a cocina ya no se quita en silencio: se avisa que hay que cancelarla
#   - sin sesión no se puede anotar ni quitar en una cuenta ajena
#   - el comensal NO puede quitar una línea que no es suya
#
# Uso: bash docker/test_waiter_order.sh [base_url] [usuario] [clave]
set -u
BASE="${1:-http://localhost:8091}"
USUARIO="${2:-admin}"
CLAVE="${3:-admin123}"
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
    if isinstance(d, dict):
        d = d.get(k)
    elif isinstance(d, list) and k.isdigit() and len(d) > int(k):
        d = d[int(k)]
    else:
        d = None
print('' if d is None else d)" 2>/dev/null; }

echo "===== Pedido del personal — $BASE ====="

curl -s -o /dev/null -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USUARIO\",\"password\":\"$CLAVE\"}"
perfil=$(api "$BASE/api/users/profile.php")
if echo "$perfil" | grep -q "must_change_password"; then
    fn=$(echo "$perfil" | jq_ data.full_name); em=$(echo "$perfil" | jq_ data.email)
    api -o /dev/null -X POST "$BASE/api/users/profile.php" -H 'Content-Type: application/json' \
        -d "{\"full_name\":\"${fn:-Admin}\",\"email\":\"${em:-a@example.com}\",\"password\":\"$CLAVE\",\"current_password\":\"$CLAVE\"}"
fi
ACTOR=$(api "$BASE/api/users/profile.php" | jq_ data.username)
if [ -z "$ACTOR" ]; then echo "SKIP | no se pudo entrar como $USUARIO"; exit 0; fi

PRODUCTO=$(api "$BASE/api/inventory/products.php?context=pos" | jq_ data.0.product_id)
if [ -z "$PRODUCTO" ]; then echo "SKIP | la tienda no tiene productos activos"; exit 0; fi

PUNTO=$(api -X POST "$BASE/api/dining/tables.php" -d "{\"label\":\"Prueba mesero $RANDOM\"}" | jq_ data.table_id)
CUENTA=$(api -X POST "$BASE/api/dining/session.php" -d "{\"action\":\"open_table\",\"table_id\":$PUNTO}" | jq_ data.session_id)
if [ -z "$CUENTA" ]; then echo "FAIL | no se pudo abrir la cuenta de prueba"; exit 1; fi

# 1) El mesero anota sin join_token, con notas
R=$(api -X POST "$BASE/api/dining/order.php" \
    -d "{\"session_id\":$CUENTA,\"items\":[{\"product_id\":$PRODUCTO,\"quantity\":2,\"notes\":\"sin cebolla\"}]}")
QUIEN=$(echo "$R" | jq_ data.items.0.added_by)
NOTAS=$(echo "$R" | jq_ data.items.0.notes)
TOTAL=$(echo "$R" | jq_ data.totals.total)
LINEA=$(echo "$R" | jq_ data.items.0.order_item_id)
if [ "$QUIEN" = "staff" ]; then ok "el mesero anota en la cuenta (queda a nombre del personal)"
else mal "el mesero anota en la cuenta (added_by=$QUIEN)"; fi
if [ "$NOTAS" = "sin cebolla" ]; then ok "las notas del mesero se conservan"
else mal "las notas del mesero se conservan (notas='$NOTAS')"; fi

# 2) Quitar una línea pendiente
R=$(api -X POST "$BASE/api/dining/order.php" -d "{\"session_id\":$CUENTA,\"action\":\"remove\",\"order_item_id\":$LINEA}")
NUEVO=$(echo "$R" | jq_ data.totals.total)
if [ "$(echo "$R" | jq_ success)" = "True" ] && [ "$NUEVO" != "$TOTAL" ]; then
    ok "el mesero quita una línea que no se ha enviado (total bajó a $NUEVO)"
else mal "el mesero quita una línea pendiente (total=$NUEVO, antes=$TOTAL)"; fi

# 3) Enviar a cocina y comprobar que ya no se puede quitar en silencio
api -X POST "$BASE/api/dining/order.php" \
    -d "{\"session_id\":$CUENTA,\"items\":[{\"product_id\":$PRODUCTO,\"quantity\":1}]}" >/dev/null
api -X POST "$BASE/api/dining/order.php" -d "{\"session_id\":$CUENTA,\"action\":\"send\"}" >/dev/null
LINEA_ENVIADA=$(api "$BASE/api/dining/session.php?cuenta=$CUENTA" | jq_ data.session.items.0.order_item_id)
ESTADO=$(api "$BASE/api/dining/session.php?cuenta=$CUENTA" | jq_ data.session.items.0.status)
if [ "$ESTADO" = "sent" ]; then ok "enviar a preparación deja la línea en 'sent'"
else mal "enviar a preparación (estado=$ESTADO)"; fi

R=$(api -X POST "$BASE/api/dining/order.php" -d "{\"action\":\"remove\",\"order_item_id\":$LINEA_ENVIADA}")
if [ "$(echo "$R" | jq_ success)" = "False" ]; then
    ok "lo ya enviado a cocina no se quita en silencio (se avisa que hay que cancelarlo)"
else mal "lo ya enviado a cocina no se quita en silencio"; fi

# 4) Sin sesión, no se anota ni se quita
SIN=$(curl -s -X POST "$BASE/api/dining/order.php" -H 'Content-Type: application/json' \
    -d "{\"session_id\":$CUENTA,\"items\":[{\"product_id\":$PRODUCTO,\"quantity\":1}]}")
if [ "$(echo "$SIN" | jq_ success)" = "False" ]; then ok "sin sesión no se anota en una cuenta (no autorizado)"
else mal "sin sesión no se anota en una cuenta"; fi

# 5) El comensal no puede quitar lo que no es suyo
CODIGO=$(api "$BASE/api/dining/session.php?cuenta=$CUENTA" | jq_ data.session.code)
UNION=$(curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/session.php" \
    -d "{\"action\":\"join\",\"code\":\"$CODIGO\",\"display_name\":\"Invitado de prueba\"}")
JTOKEN=$(echo "$UNION" | jq_ data.join_token)
if [ -n "$JTOKEN" ]; then
    R=$(curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
        -d "{\"join_token\":\"$JTOKEN\",\"action\":\"remove\",\"order_item_id\":$LINEA_ENVIADA}")
    if [ "$(echo "$R" | jq_ success)" = "False" ]; then
        ok "el comensal no puede quitar una línea del personal ($(echo "$R" | jq_ message))"
    else mal "el comensal no puede quitar una línea que no es suya"; fi
else
    echo "SKIP | no se pudo unir un invitado a la cuenta de prueba"
fi

# Limpieza: la cuenta de prueba se cancela con motivo y el punto no queda
api -X POST "$BASE/api/dining/session.php" \
    -d "{\"action\":\"cancel\",\"session_id\":$CUENTA,\"reason\":\"prueba automatica de pedido del personal\"}" >/dev/null
api -X DELETE "$BASE/api/dining/tables.php?table_id=$PUNTO&force=1" >/dev/null
rm -f "$CJ"

echo
echo "===== RESULTADO pedido del personal: $PASS pasaron, $FAIL fallaron ====="
exit $FAIL

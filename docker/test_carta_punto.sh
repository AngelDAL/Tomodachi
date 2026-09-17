#!/usr/bin/env bash
# Pruebas del punto de servicio en la carta del comensal y del pedido "de uno en uno".
#
#   POST api/dining/session.php {action:open, menu_token, table_token}   el QR de la mesa
#   GET  api/dining/session.php?cuenta=N                                 el detalle del personal
#   GET  api/dining/tables.php                                           el mapa del salón
#   POST api/dining/order.php   {join_token, items:[{product_id,quantity,notes}]}
#   POST api/dining/order.php   {join_token, action:set_quantity, order_item_id, quantity}
#
# Qué comprueba (esto es lo que estaba roto y lo que hay que cuidar):
#   1. La cuenta que abre el comensal desde el QR impreso de la mesa NACE ligada a ese
#      punto de servicio (antes nacía suelta y el mapa la mostraba como "(sin punto)").
#   2. Si el personal ya abrió la cuenta de esa mesa, el comensal entra a ESA: no se abren
#      dos cuentas paralelas en la misma mesa.
#   3. Pedir "de uno en uno" SUMA en la misma línea (un toque, un platillo) y no llena la
#      cuenta de renglones idénticos.
#   4. Con notas distintas sí son líneas distintas, y la cantidad se cambia POR LÍNEA:
#      bajar de dos a uno un platillo anotado no toca al de al lado.
#   5. Una vez enviado a preparación, la línea ya no se edita (409).
#
# Uso: bash docker/test_carta_punto.sh [base_url]
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
# Cuenta cuántas líneas con ese producto hay en la cuenta (data.items del pedido).
lineas_de() { python3 -c "
import json,sys
d=(json.load(sys.stdin).get('data') or {})
items=[i for i in (d.get('items') or []) if str(i.get('product_id'))=='$1']
print('|'.join(str(i.get('quantity')) + ':' + (i.get('notes') or '-') + ':' + str(i.get('order_item_id')) for i in items))" 2>/dev/null; }

echo "===== Carta: punto de servicio y pedido de uno en uno — $BASE ====="
curl -s -o /dev/null -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
perfil=$(api "$BASE/api/users/profile.php")
if echo "$perfil" | grep -q "must_change_password"; then
  fn=$(echo "$perfil" | jq_ data.full_name); em=$(echo "$perfil" | jq_ data.email)
  api -o /dev/null -X POST "$BASE/api/users/profile.php" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"${fn:-Admin}\",\"email\":\"${em:-a@example.com}\",\"password\":\"admin123\",\"current_password\":\"admin123\"}"
fi

suf=$RANDOM

# Una carta publicada y un punto de servicio con su QR.
MENU=$(api "$BASE/api/menu/menus.php" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
ms=d.get('menus') if isinstance(d,dict) else d
for m in (ms or []):
    if m.get('is_active'): print(m.get('menu_id'), m.get('public_token')); break" 2>/dev/null)
MID=$(echo "$MENU" | awk '{print $1}')
MTOKEN=$(echo "$MENU" | awk '{print $2}')
if [ -z "$MTOKEN" ]; then
  mal "no hay carta activa en esta tienda: no se puede probar el flujo del comensal"
  echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="; exit 1
fi

PUNTO=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"label\":\"Carta prueba $suf\"}" | jq_ data.table_id)
QRT=$(api "$BASE/api/dining/tables.php" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
for p in (d.get('puntos') or d.get('tables') or []):
    if str(p.get('table_id'))=='$PUNTO': print(p.get('qr_token'))" 2>/dev/null)
if [ -z "$QRT" ]; then mal "no se consiguió el qr_token del punto"; echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="; exit 1; fi
ok "prepara carta ($MID) y punto de servicio ($PUNTO)"

# 1. El comensal abre desde el QR impreso del punto
r=$(curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/session.php" \
  -d "{\"action\":\"open\",\"menu_token\":\"$MTOKEN\",\"table_token\":\"$QRT\"}")
SID=$(echo "$r" | jq_ data.session_id)
COD=$(echo "$r" | jq_ data.code)
if [ -n "$SID" ]; then ok "el comensal abre la cuenta desde el QR del punto (codigo $COD)"; else mal "abrir desde el QR del punto ($r)"; fi
if [ "$(echo "$r" | jq_ data.punto)" = "Carta prueba $suf" ]; then ok "la respuesta dice en que punto esta"; else mal "punto en la respuesta ($r)"; fi

# 2. La cuenta queda ligada al punto: el mapa del salon la ve ocupada, con su etiqueta
punto_de_cuenta=$(api "$BASE/api/dining/session.php?cuenta=$SID" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
print('|'.join(p.get('label','') for p in (d.get('puntos') or [])))" 2>/dev/null)
if echo "$punto_de_cuenta" | grep -q "Carta prueba $suf"; then
  ok "la cuenta del comensal NACE ligada al punto (ya no aparece 'sin punto')"
else
  mal "la cuenta quedo sin punto ('$punto_de_cuenta')"
fi

# 3. Abrir otra vez desde el mismo QR entra a la MISMA cuenta (no se duplica la mesa)
r=$(curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/session.php" \
  -d "{\"action\":\"open\",\"menu_token\":\"$MTOKEN\",\"table_token\":\"$QRT\"}")
if [ "$(echo "$r" | jq_ data.session_id)" = "$SID" ] && [ "$(echo "$r" | jq_ data.existente)" = "True" ]; then
  ok "el segundo comensal entra a la cuenta YA abierta de esa mesa"
else
  mal "una sola cuenta por mesa ($r)"
fi

# 4. Pedir de uno en uno SUMA en la misma línea
PROD=$(api -X POST "$BASE/api/inventory/products.php" -H 'Content-Type: application/json' \
  -d "{\"product_name\":\"ZZ Carta $suf\",\"price\":20,\"cost\":1,\"stock\":50}" | jq_ data.product_id)
if [ -z "$PROD" ]; then mal "no se pudo crear el producto de prueba"; echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="; exit 1; fi

# El comensal se une con su nombre (aquí no hay join_token: se pide con el código)
JOIN=$(curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/session.php" \
  -d "{\"action\":\"join\",\"code\":\"$COD\",\"display_name\":\"Prueba\"}")
JT=$(echo "$JOIN" | jq_ data.join_token)
if [ -n "$JT" ]; then ok "el comensal se une a la cuenta con su nombre"; else mal "unirse ($JOIN)"; fi

for i in 1 2 3; do
  curl -s -o /dev/null -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
    -d "{\"join_token\":\"$JT\",\"items\":[{\"product_id\":$PROD,\"quantity\":1}]}"
done
r=$(curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
  -d "{\"join_token\":\"$JT\",\"items\":[{\"product_id\":$PROD,\"quantity\":1}]}")
lista=$(echo "$r" | lineas_de "$PROD")
if [ "$lista" = "4:-:$(echo "$lista" | cut -d: -f3)" ]; then
  ok "cuatro toques = UNA linea con cantidad 4 (no cuatro renglones)"
else
  mal "fusion de lineas repetidas ('$lista')"
fi
LINEA=$(echo "$lista" | cut -d: -f3)

# 5. Con notas distintas SI son lineas distintas
r=$(curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
  -d "{\"join_token\":\"$JT\",\"items\":[{\"product_id\":$PROD,\"quantity\":1,\"notes\":\"sin cebolla\"}]}")
lista=$(echo "$r" | lineas_de "$PROD")
if [ "$(echo "$lista" | tr '|' '\n' | wc -l)" = "2" ]; then
  ok "un platillo con nota es OTRA linea (se prepara distinto)"
else
  mal "linea con nota ('$lista')"
fi
LINEA_NOTA=$(echo "$lista" | tr '|' '\n' | grep 'sin cebolla' | cut -d: -f3)

# 6. La cantidad se cambia POR LÍNEA y no toca a la otra
r=$(curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
  -d "{\"join_token\":\"$JT\",\"action\":\"set_quantity\",\"order_item_id\":$LINEA,\"quantity\":1}")
lista=$(echo "$r" | lineas_de "$PROD")
if echo "$lista" | grep -q "1:-:" && echo "$lista" | grep -q "1:sin cebolla:"; then
  ok "bajar la cantidad toca SOLO esa linea (la anotada sigue igual)"
else
  mal "set_quantity por linea ('$lista')"
fi

# 7. Cantidad 0 quita la linea
r=$(curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
  -d "{\"join_token\":\"$JT\",\"action\":\"set_quantity\",\"order_item_id\":$LINEA,\"quantity\":0}")
lista=$(echo "$r" | lineas_de "$PROD")
if [ "$lista" = "1:sin cebolla:$LINEA_NOTA" ]; then ok "cantidad 0 quita la linea, sin dejar rastro"; else mal "set_quantity 0 ('$lista')"; fi

# 8. Lo enviado a preparacion ya no se edita
curl -s -o /dev/null -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
  -d "{\"join_token\":\"$JT\",\"action\":\"send\"}"
r=$(curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
  -d "{\"join_token\":\"$JT\",\"action\":\"set_notes\",\"order_item_id\":$LINEA_NOTA,\"notes\":\"otra cosa\"}")
if echo "$r" | grep -q "ya se mandó a preparación"; then ok "una linea enviada ya no se edita (es anulacion, no nota)"; else mal "editar linea enviada ($r)"; fi

echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="
rm -f "$CJ"
[ "$FAIL" -eq 0 ]

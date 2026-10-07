#!/usr/bin/env bash
# Pruebas de los pedidos de MOSTRADOR (clientes de paso, sin mesa).
#
#   POST api/dining/counter.php {action:create, customer_name, items:[...]}
#   GET  api/dining/counter.php                       pedidos del día
#   POST api/dining/counter.php {action:status, ...}  completed | cancelled
#   GET  api/counter/track.php?t=<token>              seguimiento público (sin sesión)
#
# Qué comprueba:
#   1. Se crea un pedido con folio del día, nombre, artículos y total calculado.
#   2. El listado lo reporta (pendiente primero).
#   3. El seguimiento público devuelve el pedido por token, SIN exponer tienda ni token.
#   4. completed y cancelled cambian el estado (cancelar con motivo).
#   5. Un token inventado responde 404.
#
# Uso: bash docker/test_counter.sh [base_url]
set -u
BASE="${1:-http://localhost:8091}"
PASS=0; FAIL=0
CJ=$(mktemp)

ok()  { echo "PASS | $1"; PASS=$((PASS+1)); }
mal() { echo "FAIL | $1"; FAIL=$((FAIL+1)); }
api() { curl -s -b "$CJ" -H 'Content-Type: application/json' "$@"; }
# petición SIN sesión (público)
pub() { curl -s -H 'Content-Type: application/json' "$@"; }
jq_() { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
for k in '$1'.split('.'):
    d = (d or {}).get(k) if isinstance(d, dict) else None
print('' if d is None else d)" 2>/dev/null; }

echo "===== Pedidos de mostrador — $BASE ====="
curl -s -o /dev/null -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
perfil=$(api "$BASE/api/users/profile.php")
if echo "$perfil" | grep -q "must_change_password"; then
  fn=$(echo "$perfil" | jq_ data.full_name); em=$(echo "$perfil" | jq_ data.email)
  api -o /dev/null -X POST "$BASE/api/users/profile.php" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"${fn:-Admin}\",\"email\":\"${em:-a@example.com}\",\"password\":\"admin123\",\"current_password\":\"admin123\"}"
fi

suf=$RANDOM

crear_producto() {
  api -X POST "$BASE/api/inventory/products.php" -H 'Content-Type: application/json' \
    -d "{\"product_name\":\"ZZ Contador $1 $suf\",\"price\":$2,\"cost\":1,\"stock\":50}" | jq_ data.product_id
}
P1=$(crear_producto A 30)
P2=$(crear_producto B 45)
if [ -z "$P1" ] || [ -z "$P2" ]; then
  mal "no se pudieron crear los productos de prueba ($P1/$P2)"; echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="; exit 1
fi
ok "crea dos productos de prueba"

# 1. Crear pedido
CREA=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"create\",\"customer_name\":\"María $suf\",\"items\":[{\"product_id\":$P1,\"quantity\":2},{\"product_id\":$P2,\"quantity\":1}]}")
OID=$(echo "$CREA" | jq_ data.counter_order_id)
NUM=$(echo "$CREA" | jq_ data.number)
TOKEN=$(echo "$CREA" | jq_ data.tracking_token)
URL=$(echo "$CREA" | jq_ data.tracking_url)
TOTAL=$(echo "$CREA" | jq_ data.total)
EST=$(echo "$CREA" | jq_ data.status)
NIT=$(echo "$CREA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len((d.get('data') or {}).get('items') or []))" 2>/dev/null)

if [ -n "$OID" ] && [ -n "$TOKEN" ] && [ -n "$URL" ] && [ "$EST" = "pending" ]; then ok "crea un pedido con folio, token y estado pendiente"; else mal "crear pedido ($CREA)"; fi
if [ "$NIT" = "2" ]; then ok "registra los dos artículos"; else mal "artículos ($NIT)"; fi
if [ "$TOTAL" = "105.0" ] || [ "$TOTAL" = "105" ]; then ok "calcula el total (2×30 + 45 = 105)"; else mal "total ($TOTAL)"; fi

# 2. Listado
LISTA=$(api "$BASE/api/dining/counter.php")
if echo "$LISTA" | grep -q "$OID"; then ok "el listado reporta el pedido"; else mal "listado ($LISTA)"; fi

# 3. Seguimiento público (sin sesión)
TRACK=$(pub "$BASE/api/counter/track.php?t=$TOKEN")
TSTAT=$(echo "$TRACK" | jq_ data.order.status)
TTOTAL=$(echo "$TRACK" | jq_ data.order.total)
if [ "$TSTAT" = "pending" ]; then ok "seguimiento público devuelve el estado"; else mal "track estado ($TRACK)"; fi
if echo "$TRACK" | grep -q "tracking_token"; then mal "el seguimiento expone el token"; else ok "el seguimiento NO expone el token"; fi
if echo "$TRACK" | grep -q "store_id"; then mal "el seguimiento expone la tienda"; else ok "el seguimiento NO expone la tienda"; fi

# 4. Completar
COMP=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"status\",\"counter_order_id\":$OID,\"status\":\"completed\"}")
if [ "$(echo "$COMP" | jq_ data.status)" = "completed" ]; then ok "completa el pedido"; else mal "completar ($COMP)"; fi
if [ "$(pub "$BASE/api/counter/track.php?t=$TOKEN" | jq_ data.order.status)" = "completed" ]; then ok "el cliente ve 'listo' tras completar"; else mal "track tras completar"; fi

# 5. Cancelar (con motivo)
CREA2=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"create\",\"customer_name\":\"Juan $suf\",\"items\":[{\"product_id\":$P1,\"quantity\":1}]}")
OID2=$(echo "$CREA2" | jq_ data.counter_order_id)
CANC=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"status\",\"counter_order_id\":$OID2,\"status\":\"cancelled\",\"reason\":\"Se arrepintió\"}")
if [ "$(echo "$CANC" | jq_ data.status)" = "cancelled" ] && [ "$(echo "$CANC" | jq_ data.cancel_reason)" = "Se arrepintió" ]; then ok "cancela con motivo"; else mal "cancelar ($CANC)"; fi

# 6. Token inventado -> 404
COD=$(pub -o /dev/null -w "%{http_code}" "$BASE/api/counter/track.php?t=00000000-0000-4000-8000-000000000000")
if [ "$COD" = "404" ]; then ok "token inventado responde 404"; else mal "token inventado ($COD)"; fi

echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="
rm -f "$CJ"
[ "$FAIL" -eq 0 ]

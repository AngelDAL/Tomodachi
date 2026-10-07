#!/usr/bin/env bash
# Pruebas de los pedidos de MOSTRADOR (clientes de paso, sin mesa) — flujo completo.
#
#   POST api/dining/counter.php {action:create, ...}     crear el pedido
#   POST api/dining/counter.php {action:preview, ...}    total con promociones, sin guardar
#   POST api/dining/counter.php {action:status, ...}     ready | completed | cancelled
#   POST api/dining/counter.php {action:payment, ...}    unpaid | partial | paid
#   GET  api/dining/counter.php                          pedidos del día (personal)
#   GET  api/counter/track.php?t=<token>                 seguimiento público (sin sesión)
#   POST api/counter/presence.php                        presencia del cliente + suscripción push
#
# Qué comprueba (además del alta básica):
#   * Las PROMOCIONES entran en el total (preview y al guardar), con la línea descontada.
#   * El estado "listo" (ready) existe y NO se puede entregar sin avisar antes (409).
#   * El cobro: por cobrar / adelanto / pagado, y lo que ve el cliente.
#   * Presencia: el latido del cliente marca "está viendo" y su suscripción push.
#   * El seguimiento público NO expone token ni tienda, y trae los colores del negocio.
#
# Uso: bash docker/test_counter.sh [base_url]
set -u
BASE="${1:-http://localhost:8091}"
PASS=0; FAIL=0
CJ=$(mktemp)

ok()  { echo "PASS | $1"; PASS=$((PASS+1)); }
mal() { echo "FAIL | $1"; FAIL=$((FAIL+1)); }
api() { curl -s -b "$CJ" -H 'Content-Type: application/json' "$@"; }
pub() { curl -s -H 'Content-Type: application/json' "$@"; }
codigo() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
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

mismo() { python3 -c "import sys; a=float('$1' or 0); b=float('$2'); print('si' if abs(a-b)<0.001 else 'no')" 2>/dev/null; }

suf=$RANDOM
HOY=$(date +%Y-%m-%d)
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

# Promoción del 50% sobre P1 → 2×30 pasan a costar 30 (ahorro 30).
PROMO=$(api -X POST "$BASE/api/promotions/create.php" -H 'Content-Type: application/json' \
  -d "{\"name\":\"ZZ Promo mostrador $suf\",\"type\":\"simple_discount\",\"discount_type\":\"percentage\",\"discount_value\":50,\"start_date\":\"$HOY 00:00:00\",\"end_date\":\"$HOY 23:59:59\",\"targets\":[{\"type\":\"product\",\"id\":$P1}]}")
if [ -n "$(echo "$PROMO" | jq_ data.promotion_id)" ]; then ok "crea una promoción del 50% sobre el producto A"; else mal "crear promoción ($PROMO)"; fi

ITEMS="[{\"product_id\":$P1,\"quantity\":2},{\"product_id\":$P2,\"quantity\":1}]"

# 1. Vista previa con promociones aplicadas
PREV=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"preview\",\"items\":$ITEMS}")
PSUB=$(echo "$PREV" | jq_ data.subtotal); PDESC=$(echo "$PREV" | jq_ data.discount); PTOT=$(echo "$PREV" | jq_ data.total)
if [ "$(mismo "$PSUB" 105)" = "si" ]; then ok "vista previa: subtotal 105 (sin descuentos)"; else mal "preview subtotal ($PSUB)"; fi
if [ "$(mismo "$PDESC" 30)" = "si" ]; then ok "vista previa: la promoción descuenta 30"; else mal "preview descuento ($PDESC)"; fi
if [ "$(mismo "$PTOT" 75)" = "si" ]; then ok "vista previa: total 75 con promoción"; else mal "preview total ($PTOT)"; fi
if echo "$PREV" | grep -q "ZZ Promo mostrador $suf"; then ok "vista previa: nombra la promoción aplicada"; else mal "preview sin nombre de promoción"; fi
PREV_VACIO=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' -d '{"action":"preview","items":[]}')
if [ "$(echo "$PREV_VACIO" | jq_ data.total)" = "0.0" ] || [ "$(echo "$PREV_VACIO" | jq_ data.total)" = "0" ]; then ok "vista previa vacía: ceros, sin error"; else mal "preview vacío ($PREV_VACIO)"; fi

# 2. Crear el pedido (el total debe respetar la promoción)
CREA=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"create\",\"customer_name\":\"María $suf\",\"items\":$ITEMS}")
OID=$(echo "$CREA" | jq_ data.counter_order_id)
NUM=$(echo "$CREA" | jq_ data.number)
TOKEN=$(echo "$CREA" | jq_ data.tracking_token)
TOTAL=$(echo "$CREA" | jq_ data.total)
EST=$(echo "$CREA" | jq_ data.status)
NIT=$(echo "$CREA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len((d.get('data') or {}).get('items') or []))" 2>/dev/null)
if [ -n "$OID" ] && [ -n "$TOKEN" ] && [ "$EST" = "pending" ]; then ok "crea un pedido con folio, token y estado pendiente"; else mal "crear pedido ($CREA)"; fi
if [ "$NIT" = "2" ]; then ok "registra los dos artículos"; else mal "artículos ($NIT)"; fi
if [ "$(mismo "$TOTAL" 75)" = "si" ]; then ok "guarda el total con la promoción (75)"; else mal "total guardado ($TOTAL)"; fi
if [ "$(echo "$CREA" | jq_ data.payment_status)" = "unpaid" ]; then ok "nace como 'por cobrar'"; else mal "estado de pago inicial"; fi

# 3. Listado del personal
LISTA=$(api "$BASE/api/dining/counter.php")
if echo "$LISTA" | grep -q "$OID"; then ok "el listado reporta el pedido"; else mal "listado ($LISTA)"; fi

# 4. No se puede entregar sin avisar antes
SALTAR=$(codigo -b "$CJ" -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"status\",\"counter_order_id\":$OID,\"status\":\"completed\"}")
if [ "$SALTAR" = "409" ]; then ok "no deja entregar sin avisar al cliente (409)"; else mal "entregar sin avisar ($SALTAR)"; fi

# 5. Avisar (listo) → llega al cliente
AVISO=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"status\",\"counter_order_id\":$OID,\"status\":\"ready\"}")
if [ "$(echo "$AVISO" | jq_ data.status)" = "ready" ] && [ -n "$(echo "$AVISO" | jq_ data.notified_at)" ]; then ok "avisa al cliente y marca la hora del aviso"; else mal "avisar ($AVISO)"; fi
TRACK=$(pub "$BASE/api/counter/track.php?t=$TOKEN")
if [ "$(echo "$TRACK" | jq_ data.order.status)" = "ready" ]; then ok "el cliente ve 'listo para recoger'"; else mal "track tras avisar ($TRACK)"; fi

# 6. Seguimiento público: datos completos sin filtrar lo privado
if echo "$TRACK" | grep -q "tracking_token"; then mal "el seguimiento expone el token"; else ok "el seguimiento NO expone el token"; fi
if echo "$TRACK" | grep -q "store_id"; then mal "el seguimiento expone la tienda"; else ok "el seguimiento NO expone la tienda"; fi
if [ -n "$(echo "$TRACK" | jq_ data.order.subtotal)" ] && [ -n "$(echo "$TRACK" | jq_ data.order.discount)" ]; then ok "el seguimiento trae subtotal y descuento"; else mal "track sin importes"; fi
if [ -n "$(echo "$TRACK" | jq_ data.order.esperando_seg)" ]; then ok "el seguimiento trae los segundos de espera (reloj del cliente sin depender de su zona horaria)"; else mal "track sin esperando_seg"; fi
if echo "$TRACK" | grep -q "tema"; then ok "el seguimiento trae los colores del negocio"; else mal "track sin tema"; fi
if echo "$TRACK" | grep -q "vapid_public_key"; then ok "el seguimiento trae la llave pública de avisos"; else mal "track sin vapid_public_key"; fi

# 7. Cobro con adelanto → lo que ve el cliente
PAGO=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"payment\",\"counter_order_id\":$OID,\"payment_status\":\"partial\",\"paid_amount\":25}")
if [ "$(echo "$PAGO" | jq_ data.payment_status)" = "partial" ] && [ "$(mismo "$(echo "$PAGO" | jq_ data.paid_amount)" 25)" = "si" ]; then ok "registra un adelanto de 25"; else mal "adelanto ($PAGO)"; fi
if [ "$(pub "$BASE/api/counter/track.php?t=$TOKEN" | jq_ data.order.payment_status)" = "partial" ]; then ok "el cliente ve que dio adelanto"; else mal "track del adelanto"; fi
PAGADO=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"payment\",\"counter_order_id\":$OID,\"payment_status\":\"paid\"}")
if [ "$(echo "$PAGADO" | jq_ data.payment_status)" = "paid" ] && [ "$(mismo "$(echo "$PAGADO" | jq_ data.paid_amount)" 75)" = "si" ]; then ok "marcar pagado completo cubre el total"; else mal "pagado completo ($PAGADO)"; fi
INVALIDO=$(codigo -b "$CJ" -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"payment\",\"counter_order_id\":$OID,\"payment_status\":\"regalado\"}")
if [ "$INVALIDO" = "422" ]; then ok "rechaza un estado de pago inventado (422)"; else mal "pago inválido ($INVALIDO)"; fi

# 8. Presencia y suscripción push del cliente
PT=$(python3 -c "import base64; print(base64.urlsafe_b64encode(bytes.fromhex('04' + '6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296' + '4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')).decode().rstrip('='))")
AUTH=$(python3 -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(16)).decode().rstrip('='))")
pub -o /dev/null -X POST "$BASE/api/counter/presence.php" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"notify_granted\":true}"
LISTA2=$(api "$BASE/api/dining/counter.php")
if echo "$LISTA2" | grep -q '"cliente_presente":true'; then ok "el latido marca que el cliente está viendo"; else mal "presencia no registrada"; fi
pub -o /dev/null -X POST "$BASE/api/counter/presence.php" -H 'Content-Type: application/json' \
  -d "{\"subscribe\":true,\"token\":\"$TOKEN\",\"endpoint\":\"https://ejemplo.test/push/$suf\",\"p256dh\":\"$PT\",\"auth\":\"$AUTH\"}"
LISTA3=$(api "$BASE/api/dining/counter.php")
if echo "$LISTA3" | grep -q '"push_dispositivos":1'; then ok "guarda la suscripción push del cliente"; else mal "suscripción push no registrada"; fi
if echo "$LISTA3" | grep -q '"notify_granted":true'; then ok "recuerda que el cliente autorizó los avisos"; else mal "notify_granted no registrado"; fi
SUS_INVALIDA=$(codigo -X POST "$BASE/api/counter/presence.php" -H 'Content-Type: application/json' \
  -d "{\"subscribe\":true,\"token\":\"$TOKEN\",\"endpoint\":\"https://ejemplo.test/x\",\"p256dh\":\"corto\",\"auth\":\"$AUTH\"}")
if [ "$SUS_INVALIDA" = "422" ]; then ok "rechaza una suscripción mal formada (422)"; else mal "suscripción inválida ($SUS_INVALIDA)"; fi

# 9. Entregar (ya avisado) y ver el histórico
ENT=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"status\",\"counter_order_id\":$OID,\"status\":\"completed\"}")
if [ "$(echo "$ENT" | jq_ data.status)" = "completed" ]; then ok "entrega el pedido ya avisado"; else mal "entregar ($ENT)"; fi
HIST=$(api "$BASE/api/dining/counter.php?historico=1")
if echo "$HIST" | grep -q "$OID"; then ok "el histórico del día conserva el pedido"; else mal "histórico ($HIST)"; fi

# 10. Cancelar con motivo
CREA2=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"create\",\"customer_name\":\"Juan $suf\",\"items\":[{\"product_id\":$P2,\"quantity\":1}]}")
OID2=$(echo "$CREA2" | jq_ data.counter_order_id)
CANC=$(api -X POST "$BASE/api/dining/counter.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"status\",\"counter_order_id\":$OID2,\"status\":\"cancelled\",\"reason\":\"Se arrepintió\"}")
if [ "$(echo "$CANC" | jq_ data.status)" = "cancelled" ] && [ "$(echo "$CANC" | jq_ data.cancel_reason)" = "Se arrepintió" ]; then ok "cancela con motivo"; else mal "cancelar ($CANC)"; fi

# 11. Token inventado -> 404
COD=$(codigo "$BASE/api/counter/track.php?t=00000000-0000-4000-8000-000000000000")
if [ "$COD" = "404" ]; then ok "token inventado responde 404"; else mal "token inventado ($COD)"; fi

echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="
rm -f "$CJ"
[ "$FAIL" -eq 0 ]

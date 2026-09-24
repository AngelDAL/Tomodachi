#!/usr/bin/env bash
# Batería del COBRO DE LA CUENTA (Fase 4 del plan del salón).
#
# Cubre el ciclo completo tal como pasa en el local:
#   el mesero abre la cuenta → los comensales piden desde su celular → se manda a
#   preparación → se divide → se cobra, con todas las variaciones de pago.
#
#   GET  api/dining/charge.php?cuenta=N
#   POST api/dining/charge.php  {session_id, payments[...], cash_received?, tip_amount?,
#                                customer_id?, discount?}
#   GET  api/dining/split.php?cuenta=N
#   POST api/dining/split.php   {session_id, mode, partes/resto_partes}
#
# No se comprueba solo la respuesta: se comprueba LO QUE QUEDA ESCRITO EN LA BASE —
# venta, pagos, movimientos de caja, inventario y el estado de la cuenta. Un 200 que no
# deja el dinero bien registrado no sirve de nada.
#
# Uso: bash docker/test_cobro_cuenta.sh [base_url]   (escribe datos: usar la instancia de
# pruebas, nunca producción)
set -u
BASE="${1:-http://127.0.0.1:18099}"
PASS=0; FAIL=0
CJ=$(mktemp)
DB(){ docker exec tm-test-db mariadb -uroot -ptomodachi_root_secret tomodachi_pos -N -B -e "$1" 2>/dev/null; }

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
# ¿coinciden dos montos al centavo? (vacío = no)
cen() { python3 -c "
import sys
try: print('si' if abs(float('$1')-float('$2'))<0.011 else 'no')
except Exception: print('no')" 2>/dev/null; }

echo "===== Cobro de la cuenta — $BASE ====="
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
    -d "{\"product_name\":\"ZZ Cobro $1 $suf\",\"price\":$2,\"cost\":1,\"stock\":100}" | jq_ data.product_id
}
P1=$(crear_producto A 50)     # platillo de 50
P2=$(crear_producto B 30)     # bebida de 30
PUNTO=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
        -d "{\"label\":\"ZZ Cobro Mesa $suf\"}" | jq_ data.table_id)
if [ -z "$P1" ] || [ -z "$P2" ] || [ -z "$PUNTO" ]; then
  echo "FAIL | no se pudieron crear los datos de prueba (productos $P1/$P2, punto $PUNTO)"
  echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="; exit 1
fi
abrir_cuenta() {
  api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' \
    -d "{\"action\":\"open_table\",\"table_id\":$PUNTO}"
}

# ─────────────────────────────────────────────────────────────
# 1. El mesero abre la cuenta del punto
# ─────────────────────────────────────────────────────────────
R=$(abrir_cuenta)
SID=$(echo "$R" | jq_ data.session_id); COD=$(echo "$R" | jq_ data.code)
if [ -n "$SID" ]; then ok "el mesero abre la cuenta (código $COD)"; else mal "abrir cuenta ($R)"; fi

VENCE=$(DB "SELECT IFNULL(expires_at,'SIN LIMITE') FROM dining_sessions WHERE session_id=$SID")
if [ "$VENCE" = "SIN LIMITE" ]; then ok "la cuenta nace SIN límite de tiempo"; else mal "nació con vencimiento ($VENCE)"; fi

# ─────────────────────────────────────────────────────────────
# 2. Cada comensal pide desde su celular (cada quien lo suyo)
# ─────────────────────────────────────────────────────────────
JA=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' \
     -d "{\"action\":\"join\",\"code\":\"$COD\",\"display_name\":\"Ana\"}")
JB=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' \
     -d "{\"action\":\"join\",\"code\":\"$COD\",\"display_name\":\"Beto\"}")
TA=$(echo "$JA" | jq_ data.join_token); TB=$(echo "$JB" | jq_ data.join_token)
if [ -n "$TA" ] && [ -n "$TB" ]; then ok "dos comensales se unen a la cuenta"; else mal "unirse a la cuenta ($JA / $JB)"; fi

curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
  -d "{\"join_token\":\"$TA\",\"items\":[{\"product_id\":$P1,\"quantity\":2,\"notes\":\"sin cebolla\"}]}" >/dev/null
curl -s -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
  -d "{\"join_token\":\"$TB\",\"items\":[{\"product_id\":$P2,\"quantity\":1}]}" >/dev/null
R=$(api -X POST "$BASE/api/dining/order.php" -d "{\"session_id\":$SID,\"action\":\"send\"}")
if [ "$(echo "$R" | jq_ success)" = "True" ]; then ok "el pedido se manda a preparación"; else mal "enviar a preparación ($R)"; fi

# ─────────────────────────────────────────────────────────────
# 3. Lo que hay que cobrar
# ─────────────────────────────────────────────────────────────
R=$(api "$BASE/api/dining/charge.php?cuenta=$SID")
TOTAL=$(echo "$R" | jq_ data.total); PIEZAS=$(echo "$R" | jq_ data.piezas)
COBRADA=$(echo "$R" | jq_ data.cobrada); SINENV=$(echo "$R" | jq_ data.sin_enviar)
if [ "$(cen "$TOTAL" 130)" = "si" ]; then ok "el resumen cobra 130.00 (2×50 + 1×30)"; else mal "total del resumen ($TOTAL)"; fi
if [ "$PIEZAS" = "3" ]; then ok "el resumen lista 3 platillos"; else mal "piezas ($PIEZAS)"; fi
if [ "$COBRADA" = "False" ]; then ok "todavía aparece como NO cobrada"; else mal "cobrada ($COBRADA)"; fi
if [ "$SINENV" = "0" ]; then ok "no hay platillos sin mandar a preparación"; else mal "sin enviar ($SINENV)"; fi

# ─────────────────────────────────────────────────────────────
# 4. Las cuatro formas de dividir
# ─────────────────────────────────────────────────────────────
# 4a. Partes iguales entre 3
R=$(api -X POST "$BASE/api/dining/split.php" -d "{\"session_id\":$SID,\"mode\":\"equal\",\"partes\":3}")
SUMA=$(echo "$R" | jq_ data.suma)
if [ "$(cen "$SUMA" 130)" = "si" ]; then ok "partes iguales cuadran exacto ($SUMA)"; else mal "partes iguales ($R)"; fi
DETALLE=$(DB "SELECT GROUP_CONCAT(amount ORDER BY share_id) FROM dining_split_shares WHERE session_id=$SID")
if [ "$DETALLE" = "43.34,43.33,43.33" ]; then ok "los centavos se reparten ($DETALLE)"; else mal "desglose guardado ($DETALLE)"; fi

# 4b. Por persona: Ana 100, Beto 30
R=$(api -X POST "$BASE/api/dining/split.php" -d "{\"session_id\":$SID,\"mode\":\"by_person\"}")
SUMA=$(echo "$R" | jq_ data.suma)
PERSONAS=$(DB "SELECT GROUP_CONCAT(CONCAT(label,':',amount) ORDER BY share_id) FROM dining_split_shares WHERE session_id=$SID")
if [ "$(cen "$SUMA" 130)" = "si" ] && [ "$PERSONAS" = "Ana:100.00,Beto:30.00" ]; then
  ok "por persona queda Ana 100 y Beto 30 ($PERSONAS)"
else mal "por persona ($PERSONAS / suma $SUMA)"; fi

# 4c. Por monto: Ana pone 100 y el resto entre 2
R=$(api -X POST "$BASE/api/dining/split.php" \
  -d "{\"session_id\":$SID,\"mode\":\"by_amount\",\"partes\":[{\"label\":\"Ana\",\"amount\":100}],\"resto_partes\":2}")
SUMA=$(echo "$R" | jq_ data.suma)
MONTOS=$(DB "SELECT GROUP_CONCAT(amount ORDER BY share_id) FROM dining_split_shares WHERE session_id=$SID")
if [ "$(cen "$SUMA" 130)" = "si" ] && [ "$MONTOS" = "100.00,15.00,15.00" ]; then
  ok "'yo pongo 100 y el resto entre 2' queda 100 + 15 + 15"
else mal "por monto ($MONTOS / suma $SUMA)"; fi

# 4d. Manual por platillos: se dice qué ítems paga cada quien y queda el rastro
LINEAS=$(DB "SELECT GROUP_CONCAT(order_item_id ORDER BY order_item_id) FROM dining_order_items WHERE session_id=$SID AND status<>'cancelled'")
L1=$(echo "$LINEAS" | cut -d, -f1); L2=$(echo "$LINEAS" | cut -d, -f2)
if [ -n "$L1" ] && [ -n "$L2" ]; then
  R=$(api -X POST "$BASE/api/dining/split.php" -H 'Content-Type: application/json' -d "{\"session_id\":$SID,\"mode\":\"by_items\",\"partes\":[{\"label\":\"Ana\",\"items\":[{\"order_item_id\":$L1}]},{\"label\":\"Beto\",\"items\":[{\"order_item_id\":$L2}]}]}")
  SUMA=$(echo "$R" | jq_ data.suma)
  RASTRO=$(DB "SELECT COUNT(*) FROM share_items si JOIN dining_split_shares s ON s.share_id=si.share_id WHERE s.session_id=$SID")
  if [ "$(cen "$SUMA" 130)" = "si" ] && [ "$RASTRO" = "2" ]; then
    ok "reparto manual por platillos cuadra y deja rastro ($SUMA)"
  else mal "reparto por ítems ($R / rastro=$RASTRO)"; fi
else mal "no se pudieron leer las líneas de la cuenta ($LINEAS)"; fi

# 4e. Un desglose que no cuadra se rechaza
R=$(api -X POST "$BASE/api/dining/split.php" \
  -d "{\"session_id\":$SID,\"mode\":\"manual\",\"partes\":[{\"label\":\"Ana\",\"amount\":80},{\"label\":\"Beto\",\"amount\":20}]}")
if echo "$R" | grep -q "no cuadra"; then ok "un desglose que no cuadra se rechaza"; else mal "desglose inválido aceptado ($R)"; fi

# ─────────────────────────────────────────────────────────────
# 5. Cobros que NO se deben permitir
# ─────────────────────────────────────────────────────────────
R=$(api -X POST "$BASE/api/dining/charge.php" -d "{\"session_id\":$SID,\"payments\":[{\"method\":\"cash\",\"amount\":100}]}")
if echo "$R" | grep -q "no cuadran"; then ok "un cobro que no cuadra se rechaza"; else mal "cobro incompleto aceptado ($R)"; fi

R=$(api -X POST "$BASE/api/dining/charge.php" -H 'Content-Type: application/json' \
  -d "{\"session_id\":$SID,\"payments\":[{\"method\":\"cash\",\"amount\":130},{\"method\":\"credit\",\"amount\":20,\"is_tip\":true}],\"tip_amount\":20}")
if echo "$R" | grep -qi "no puede quedar fiada"; then ok "la propina fiada se rechaza"; else mal "propina fiada aceptada ($R)"; fi

R=$(api -X POST "$BASE/api/dining/charge.php" -d "{\"session_id\":$SID,\"payments\":[{\"method\":\"credit\",\"amount\":130}]}")
if echo "$R" | grep -qi "cliente"; then ok "el fiado exige cliente"; else mal "fiado sin cliente ($R)"; fi

# ─────────────────────────────────────────────────────────────
# 6. El cobro real: mixto (100 en efectivo + 30 por transferencia)
# ─────────────────────────────────────────────────────────────
R=$(api -X POST "$BASE/api/dining/charge.php" -H 'Content-Type: application/json' -d "{
  \"session_id\":$SID,
  \"payments\":[
    {\"method\":\"cash\",\"amount\":100},
    {\"method\":\"transfer\",\"amount\":30,\"reference\":\"CLABE-1234-ABC\",\"verified\":true}
  ]}")
VENTA=$(echo "$R" | jq_ data.sale_id); CAMBIO=$(echo "$R" | jq_ data.change)
if [ -n "$VENTA" ]; then ok "la cuenta se cobra (venta #$VENTA)"; else mal "cobro mixto ($R)"; fi
if [ "$(cen "${CAMBIO:-x}" 0)" = "si" ]; then ok "sin sobrar efectivo, el cambio es cero"; else mal "cambio ($CAMBIO)"; fi

FILA=$(DB "SELECT CONCAT(subtotal,'|',total,'|',tip_amount,'|',amount_paid,'|',payment_method) FROM sales WHERE sale_id=$VENTA")
if [ "$FILA" = "130.00|130.00|0.00|130.00|mixed" ]; then ok "la venta quedó: consumo 130, propina 0, pagado 130, mixta"; else mal "venta mal escrita ($FILA)"; fi

PAGOS=$(DB "SELECT COUNT(*) FROM sale_payments WHERE sale_id=$VENTA")
SUMA_PAGOS=$(DB "SELECT SUM(amount) FROM sale_payments WHERE sale_id=$VENTA AND is_tip=0")
REFS=$(DB "SELECT reference FROM sale_payments WHERE sale_id=$VENTA AND method='transfer'")
if [ "$PAGOS" = "2" ] && [ "$(cen "$SUMA_PAGOS" 130)" = "si" ]; then ok "los 2 pagos quedan registrados y suman 130"; else mal "pagos ($PAGOS pagos, suma $SUMA_PAGOS)"; fi
if [ "$REFS" = "CLABE-1234-ABC" ]; then ok "la clave de rastreo de la transferencia se guarda"; else mal "referencia ($REFS)"; fi

CAJA=$(DB "SELECT SUM(amount) FROM cash_movements WHERE description LIKE 'Venta #$VENTA%'")
if [ "$(cen "$CAJA" 100)" = "si" ]; then ok "a la caja solo entra el efectivo (100)"; else mal "efectivo en caja ($CAJA)"; fi

ESTADO=$(DB "SELECT CONCAT(status,'|',IFNULL(sale_id,'NULL')) FROM dining_sessions WHERE session_id=$SID")
if [ "$ESTADO" = "closed|$VENTA" ]; then ok "la cuenta queda cerrada y ligada a su venta"; else mal "estado de la cuenta ($ESTADO)"; fi

EXIS=$(DB "SELECT current_stock FROM products WHERE product_id=$P1")
if [ "$EXIS" = "98.000" ]; then ok "el inventario se descontó una sola vez (2 piezas)"; else mal "existencias ($EXIS)"; fi

PARTES=$(DB "SELECT COUNT(*) FROM dining_split_shares WHERE session_id=$SID AND paid=1")
if [ "$PARTES" -ge 1 ]; then ok "las partes del desglose quedan marcadas como pagadas"; else mal "partes sin marcar ($PARTES)"; fi

# ─────────────────────────────────────────────────────────────
# 7. Doble cobro
# ─────────────────────────────────────────────────────────────
R=$(api -X POST "$BASE/api/dining/charge.php" -d "{\"session_id\":$SID,\"payments\":[{\"method\":\"cash\",\"amount\":130}]}")
if echo "$R" | grep -q "ya se cobró"; then ok "cobrar dos veces se rechaza con mensaje claro"; else mal "segundo cobro permitido ($R)"; fi
VENTAS=$(DB "SELECT COUNT(*) FROM sales WHERE sale_id=$VENTA")
if [ "$VENTAS" = "1" ]; then ok "no se generó una segunda venta"; else mal "ventas de este cobro ($VENTAS)"; fi

# ─────────────────────────────────────────────────────────────
# 8. Efectivo con cambio y propina (el caso del mostrador y de la mesa)
#    Cuenta de 100; el cliente entrega 130 y deja 20 de propina → cambio 10
# ─────────────────────────────────────────────────────────────
R=$(abrir_cuenta); SID2=$(echo "$R" | jq_ data.session_id)
if [ -z "$SID2" ]; then
  mal "no se pudo abrir la cuenta del efectivo con propina ($R)"
else
  ANOT=$(curl -s -b "$CJ" -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
    -d "{\"session_id\":$SID2,\"items\":[{\"product_id\":$P1,\"quantity\":2}]}")
  if [ "$(echo "$ANOT" | jq_ success)" != "True" ]; then
    mal "no se pudo anotar en la cuenta del efectivo ($ANOT)"
  fi
  R=$(api -X POST "$BASE/api/dining/charge.php" -H 'Content-Type: application/json' \
    -d "{\"session_id\":$SID2,\"payment_method\":\"cash\",\"cash_received\":130,\"tip_amount\":20}")
  VENTA2=$(echo "$R" | jq_ data.sale_id); CAMBIO2=$(echo "$R" | jq_ data.change); TIP2=$(echo "$R" | jq_ data.tip_amount)
  if [ -n "$VENTA2" ] && [ "$(cen "$CAMBIO2" 10)" = "si" ] && [ "$(cen "$TIP2" 20)" = "si" ]; then
    ok "efectivo 130 por cuenta de 100 + propina 20 → cambio 10"
  else mal "efectivo con cambio ($R)"; fi

  CONSUMO2=$(DB "SELECT total FROM sales WHERE sale_id=${VENTA2:-0}")
  if [ "$(cen "$CONSUMO2" 100)" = "si" ]; then ok "la venta reporta el consumo (100), no la propina"; else mal "consumo de la venta ($CONSUMO2)"; fi
  TIPA=$(DB "SELECT IFNULL(SUM(amount),0) FROM sale_payments WHERE sale_id=${VENTA2:-0} AND is_tip=1")
  if [ "$(cen "$TIPA" 20)" = "si" ]; then ok "la propina queda como pago aparte (is_tip)"; else mal "pago de propina ($TIPA)"; fi
  CAJA2=$(DB "SELECT IFNULL(SUM(amount),0) FROM cash_movements WHERE description LIKE '%#${VENTA2:-0}%'")
  if [ "$(cen "$CAJA2" 120)" = "si" ]; then ok "el efectivo de la caja incluye propina (120 = 100 + 20)"; else mal "caja con propina ($CAJA2)"; fi
  PROPMOV=$(DB "SELECT COUNT(*) FROM cash_movements WHERE description LIKE 'Propina venta #${VENTA2:-0}%'")
  if [ "$PROPMOV" = "1" ]; then ok "la propina se ve como movimiento propio en la caja"; else mal "movimiento de propina ($PROPMOV)"; fi

  # 8b. La misma cuenta con el pago EXACTO (sin propina) sigue funcionando
  R=$(abrir_cuenta); SID5=$(echo "$R" | jq_ data.session_id)
  if [ -n "$SID5" ]; then
    curl -s -b "$CJ" -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
      -d "{\"session_id\":$SID5,\"items\":[{\"product_id\":$P2,\"quantity\":1}]}" >/dev/null
    R=$(api -X POST "$BASE/api/dining/charge.php" -d "{\"session_id\":$SID5,\"payment_method\":\"cash\",\"payments\":[{\"method\":\"cash\",\"amount\":30}]}")
    if [ -n "$(echo "$R" | jq_ data.sale_id)" ]; then ok "sin propina, se cobra el importe exacto"; else mal "cobro sin propina ($R)"; fi
  fi
fi

# ─────────────────────────────────────────────────────────────
# 9. Fiado: la cuenta se va a la deuda del cliente
# ─────────────────────────────────────────────────────────────
CLI=$(api -X POST "$BASE/api/customers/customers.php" -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"ZZ Cobro Cliente $suf\",\"credit_limit\":500}" | jq_ data.customer_id)
[ -z "$CLI" ] && CLI=$(DB "SELECT customer_id FROM customers WHERE store_id=1 ORDER BY customer_id DESC LIMIT 1")
if [ -z "$CLI" ]; then mal "no se pudo crear el cliente de prueba"; else
  R=$(abrir_cuenta); SID3=$(echo "$R" | jq_ data.session_id)
  if [ -z "$SID3" ]; then mal "no se pudo abrir la cuenta del fiado ($R)"; else
  ANOT3=$(curl -s -b "$CJ" -H 'Content-Type: application/json' -X POST "$BASE/api/dining/order.php" \
    -d "{\"session_id\":$SID3,\"items\":[{\"product_id\":$P2,\"quantity\":1}]}")
  if [ "$(echo "$ANOT3" | jq_ success)" != "True" ]; then mal "no se pudo anotar en la cuenta del fiado ($ANOT3)"; fi
  R=$(api -X POST "$BASE/api/dining/charge.php" -H 'Content-Type: application/json' \
    -d "{\"session_id\":$SID3,\"payments\":[{\"method\":\"credit\",\"amount\":30}],\"customer_id\":$CLI}")
  VENTA3=$(echo "$R" | jq_ data.sale_id); DEUDA=$(echo "$R" | jq_ data.debt)
  SALDO=$(DB "SELECT balance FROM customers WHERE customer_id=$CLI")
  if [ -n "$VENTA3" ] && [ "$(cen "$DEUDA" 30)" = "si" ] && [ "$(cen "$SALDO" 30)" = "si" ]; then
    ok "el fiado sube la deuda del cliente (30)"
  else mal "fiado ($R / saldo $SALDO)"; fi
  CAJA3=$(DB "SELECT IFNULL(SUM(amount),0) FROM cash_movements WHERE description LIKE '%#${VENTA3:-0}%'")
  if [ "$(cen "$CAJA3" 0)" = "si" ]; then ok "un fiado no mete dinero a la caja"; else mal "caja con fiado ($CAJA3)"; fi
  fi
fi

# ─────────────────────────────────────────────────────────────
# 10. Cuenta vacía, cuenta inexistente y sin sesión
# ─────────────────────────────────────────────────────────────
R=$(abrir_cuenta); SID4=$(echo "$R" | jq_ data.session_id)
if [ -n "$SID4" ]; then
  R=$(api -X POST "$BASE/api/dining/charge.php" -d "{\"session_id\":$SID4,\"payments\":[{\"method\":\"cash\",\"amount\":10}]}")
  if echo "$R" | grep -qi "no tiene platillos"; then ok "una cuenta vacía no se cobra (se cancela con motivo)"; else mal "cuenta vacía cobrada ($R)"; fi
  api -o /dev/null -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' \
    -d "{\"action\":\"cancel\",\"session_id\":$SID4,\"reason\":\"prueba automatica\"}"
else mal "no se pudo abrir la cuenta vacía"; fi

R=$(api "$BASE/api/dining/charge.php?cuenta=999999")
if echo "$R" | grep -qi "no existe"; then ok "una cuenta inexistente responde claro"; else mal "cuenta inexistente ($R)"; fi

R=$(curl -s -X POST "$BASE/api/dining/charge.php" -H 'Content-Type: application/json' \
  -d "{\"session_id\":$SID2,\"payments\":[{\"method\":\"cash\",\"amount\":100}]}")
if echo "$R" | grep -qi "no autorizado\|Autenticación\|sesión"; then ok "sin sesión no se cobra una cuenta"; else mal "cobro sin sesión ($R)"; fi

# ─────────────────────────────────────────────────────────────
# 11. La venta de la cuenta entra al corte igual que las del POS
# ─────────────────────────────────────────────────────────────
R=$(api "$BASE/api/sales/get_sales.php?limit=5")
if echo "$R" | grep -q "\"sale_id\":\"\?$VENTA\"\?"; then ok "la venta de la cuenta aparece en el listado de ventas"; else mal "la venta no aparece en el listado"; fi

echo
echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="
rm -f "$CJ"
[ "$FAIL" -eq 0 ]

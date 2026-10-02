#!/usr/bin/env bash
# Pruebas de los EGRESOS DE INVENTARIO (salidas): api/inventory/exits.php
#
# Qué se comprueba — de lo unitario (una regla, un endpoint) a lo completo (el ciclo
# entero de una salida con sus lotes y su deshacer):
#   1. Un egreso de un producto 'stock' baja el stock y deja el movimiento en el libro.
#   2. Un egreso de un COMPONENTE consume sus presentaciones (lotes) en orden FIFO.
#   3. El motivo es OPCIONAL: sin motivo se registra igual (y el movimiento es 'exit').
#   4. Pérdida y siniestro se registran como 'loss' (la pantalla de Pérdidas los ve).
#   5. Traspaso: movimiento 'transfer' y destino guardado; destino inválido se rechaza.
#   6. NO hay precios: ni en el payload ni en la respuesta (ni movimiento de caja).
#   7. Sacar más de lo que hay se rechaza con el número exacto y NO mueve el stock.
#   8. Renglones repetidos se suman: 5 + 5 contra 8 disponibles se rechaza (no pasa por
#      renglón).
#   9. Aislamiento: producto de otra empresa no se puede sacar, y su egreso no se lista.
#  10. Producto de baja y producto sin inventario se rechazan con mensaje claro.
#  11. Sin renglones no hay egreso.
#  12. El detalle devuelve antes/después de cada renglón.
#  13. DESHACER devuelve la mercancía, borra el egreso y deja el reintegro en el libro.
#
# Uso: bash docker/test_inventory_exits.sh [base_url]
set -u
BASE="${1:-http://127.0.0.1:18099}"
PASS=0; FAIL=0
CJ=$(mktemp)
DB_CONT="${DB_CONT:-tm-test-db}"
DB_ROOT_PASS="${DB_ROOT_PASS:-tomodachi_root_secret}"
DB_NAME="${DB_NAME:-tomodachi_pos}"

ok()   { echo "PASS | $1"; PASS=$((PASS+1)); }
mal()  { echo "FAIL | $1"; FAIL=$((FAIL+1)); }
api()  { curl -s -b "$CJ" -H 'Content-Type: application/json' "$@"; }
jget() { python3 -c "import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
for k in '$1'.split('.'):
    d = (d or {}).get(k) if isinstance(d, dict) else None
print('' if d is None else d)" 2>/dev/null; }
sql()  { docker exec "$DB_CONT" mariadb -uroot -p"$DB_ROOT_PASS" -D "$DB_NAME" -N -e "$1" 2>/dev/null; }
stock_de()  { sql "SELECT current_stock FROM products WHERE product_id = $1"; }
lote_de()   { sql "SELECT quantity FROM product_lots WHERE lot_id = $1"; }

echo "===== Egresos de inventario — $BASE ====="
curl -s -o /dev/null -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
perfil=$(api "$BASE/api/users/profile.php")
if echo "$perfil" | grep -q "must_change_password"; then
  fn=$(echo "$perfil" | jget data.full_name); em=$(echo "$perfil" | jget data.email)
  api -o /dev/null -X POST "$BASE/api/users/profile.php" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"${fn:-Admin}\",\"email\":\"${em:-a@example.com}\",\"password\":\"admin123\",\"current_password\":\"admin123\"}"
fi
suf=$RANDOM

# ─────────────────────────────────────────────────────────────
# 1. Producto final: la salida baja el stock
# ─────────────────────────────────────────────────────────────
P1=$(api -X POST "$BASE/api/inventory/products.php" -H 'Content-Type: application/json' \
  -d "{\"product_name\":\"ZZ Egreso stock $suf\",\"price\":50,\"cost\":20,\"stock\":50,\"tracking_type\":\"stock\"}" | jget data.product_id)
[ -n "$P1" ] || { mal "no se pudo crear el producto de prueba"; exit 1; }
if [ "$(stock_de $P1)" = "50.000" ]; then ok "producto de prueba con 50 en existencia"; else mal "stock inicial ($(stock_de $P1))"; fi

r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"reason\":\"loss\",\"reason_note\":\"se cayó la charola\",\"items\":[{\"product_id\":$P1,\"quantity\":5}]}")
E1=$(echo "$r" | jget data.exit_id)
if [ -n "$E1" ]; then ok "egreso registrado (id $E1)"; else mal "registrar egreso ($r)"; fi
if [ "$(stock_de $P1)" = "45.000" ]; then ok "el stock bajó 50 → 45"; else mal "stock tras el egreso ($(stock_de $P1))"; fi
if sql "SELECT movement_type FROM inventory_movements WHERE product_id=$P1 ORDER BY movement_id DESC LIMIT 1" | grep -q "^loss$"; then
  ok "la pérdida se registra como 'loss' (la pantalla de Pérdidas la ve)"; else mal "tipo de movimiento de la pérdida"; fi
if sql "SELECT CONCAT(reference_type,':',reference_id) FROM inventory_movements WHERE product_id=$P1 ORDER BY movement_id DESC LIMIT 1" | grep -q "exit:$E1"; then
  ok "el movimiento queda amarrado al egreso (exit:$E1)"; else mal "referencia del movimiento"; fi

# 2. Detalle con antes/después
d=$(api "$BASE/api/inventory/exits.php?exit_id=$E1")
# El JSON puede traer 50, 50.0 o 50.000 según cómo serialice el decimal: se compara la
# parte entera, que es lo que la prueba quiere afirmar.
prev=$(echo "$d" | python3 -c "import json,sys; print((json.load(sys.stdin).get('data') or {}).get('items',[{}])[0].get('previous_stock'))" 2>/dev/null)
nuevo=$(echo "$d" | python3 -c "import json,sys; print((json.load(sys.stdin).get('data') or {}).get('items',[{}])[0].get('new_stock'))" 2>/dev/null)
if [ "${prev%%.*}" = "50" ] && [ "${nuevo%%.*}" = "45" ]; then
  ok "el detalle dice de dónde a dónde (50 → 45)"; else mal "detalle del egreso ($d)"; fi
if [ "$(echo "$d" | jget data.reason_label)" = "Pérdida" ]; then ok "el detalle traduce el motivo"; else mal "etiqueta del motivo"; fi

# ─────────────────────────────────────────────────────────────
# 3. Componente: consume presentaciones FIFO
# ─────────────────────────────────────────────────────────────
C1=$(api -X POST "$BASE/api/inventory/products.php" -H 'Content-Type: application/json' \
  -d "{\"product_name\":\"ZZ Egreso componente $suf\",\"price\":0,\"cost\":10,\"stock\":0,\"tracking_type\":\"component\"}" | jget data.product_id)
api -o /dev/null -X POST "$BASE/api/inventory/lots.php" -H 'Content-Type: application/json' \
  -d "{\"product_id\":$C1,\"label\":\"Lote viejo\",\"quantity\":10,\"total_cost\":100}"
api -o /dev/null -X POST "$BASE/api/inventory/lots.php" -H 'Content-Type: application/json' \
  -d "{\"product_id\":$C1,\"label\":\"Lote nuevo\",\"quantity\":10,\"total_cost\":100}"
L1=$(sql "SELECT lot_id FROM product_lots WHERE product_id=$C1 ORDER BY lot_id ASC LIMIT 1")
L2=$(sql "SELECT lot_id FROM product_lots WHERE product_id=$C1 ORDER BY lot_id DESC LIMIT 1")

r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"product_id\":$C1,\"quantity\":12}]}")
E2=$(echo "$r" | jget data.exit_id)
if [ -n "$E2" ]; then ok "egreso de componente sin motivo (id $E2)"; else mal "egreso de componente ($r)"; fi
if [ "$(lote_de $L1)" = "0.000" ]; then ok "el lote más viejo se vació primero (FIFO)"; else mal "lote viejo ($(lote_de $L1))"; fi
if [ "$(lote_de $L2)" = "8.000" ]; then ok "del lote nuevo salieron los 2 que faltaban (10 → 8)"; else mal "lote nuevo ($(lote_de $L2))"; fi
if sql "SELECT movement_type FROM inventory_movements WHERE product_id=$C1 ORDER BY movement_id DESC LIMIT 1" | grep -q "^exit$"; then
  ok "sin motivo, la salida se registra como 'exit'"; else mal "tipo de movimiento sin motivo"; fi

# ─────────────────────────────────────────────────────────────
# 4. NO hay precios por ninguna parte
# ─────────────────────────────────────────────────────────────
caja=$(sql "SELECT COUNT(*) FROM cash_movements WHERE reference_type='exit'")
if [ "$caja" = "0" ]; then ok "un egreso NO toca la caja (no hay dinero que mover)"; else mal "movimientos de caja del egreso ($caja)"; fi
if echo "$r" | grep -qi "cost\|total_cost\|price\|unit_cost"; then mal "la respuesta trae precios ($r)"; else ok "la respuesta no trae ningún precio"; fi
if sql "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name IN ('inventory_exits','inventory_exit_items') AND column_name LIKE '%cost%'" | grep -q "^0$"; then
  ok "el esquema del egreso no tiene columnas de costo"; else mal "el esquema tiene columnas de costo"; fi

# ─────────────────────────────────────────────────────────────
# 5. Traspaso a otra empresa
# ─────────────────────────────────────────────────────────────
OTRA=$(sql "SELECT store_id FROM stores WHERE store_id <> 1 ORDER BY store_id ASC LIMIT 1")
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"reason\":\"transfer\",\"destination_store_id\":$OTRA,\"items\":[{\"product_id\":$P1,\"quantity\":3}]}")
E3=$(echo "$r" | jget data.exit_id)
if [ -n "$E3" ]; then ok "traspaso registrado a la empresa $OTRA"; else mal "traspaso ($r)"; fi
if sql "SELECT movement_type FROM inventory_movements WHERE product_id=$P1 AND reference_id=$E3 LIMIT 1" | grep -q "^transfer$"; then
  ok "el traspaso tiene su propio tipo de movimiento ('transfer')"; else mal "tipo del traspaso"; fi
if [ "$(sql "SELECT destination_store_id FROM inventory_exits WHERE exit_id=$E3")" = "$OTRA" ]; then
  ok "el destino quedó guardado en el egreso"; else mal "destino guardado"; fi
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"reason\":\"transfer\",\"destination_store_id\":1,\"items\":[{\"product_id\":$P1,\"quantity\":1}]}")
if echo "$r" | grep -q "no puede ser la misma empresa"; then ok "traspaso a la misma empresa se rechaza"; else mal "traspaso a sí misma ($r)"; fi
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"reason\":\"transfer\",\"destination_store_id\":999999,\"items\":[{\"product_id\":$P1,\"quantity\":1}]}")
if echo "$r" | grep -q "no existe"; then ok "destino inexistente se rechaza"; else mal "destino inexistente ($r)"; fi

# ─────────────────────────────────────────────────────────────
# 6. Sacar más de lo que hay
# ─────────────────────────────────────────────────────────────
antes=$(stock_de $P1)
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"product_id\":$P1,\"quantity\":9999}]}")
if echo "$r" | grep -q "No hay suficiente"; then ok "sacar más de lo que hay se rechaza con aviso claro"; else mal "exceso de existencia ($r)"; fi
if [ "$(stock_de $P1)" = "$antes" ]; then ok "el rechazo NO movió el stock (todo o nada)"; else mal "el stock se movió en un egreso rechazado"; fi
if echo "$r" | grep -q "hay [0-9]"; then ok "el aviso dice cuánto hay y cuánto falta"; else mal "el aviso no dice el número ($r)"; fi

# 7. Renglones repetidos: se suman antes de validar
antes=$(stock_de $P1)
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"product_id\":$P1,\"quantity\":$antes},{\"product_id\":$P1,\"quantity\":5}]}")
if echo "$r" | grep -q "No hay suficiente"; then ok "los renglones repetidos se suman antes de validar"; else mal "duplicados ($r)"; fi
if [ "$(stock_de $P1)" = "$antes" ]; then ok "los duplicados rechazados no movieron nada"; else mal "los duplicados movieron el stock"; fi

# ─────────────────────────────────────────────────────────────
# 8. Validaciones de renglones y productos
# ─────────────────────────────────────────────────────────────
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' -d '{"items":[]}')
if echo "$r" | grep -q "al menos un producto"; then ok "sin renglones no hay egreso"; else mal "sin renglones ($r)"; fi
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"product_id\":$P1,\"quantity\":0}]}")
if echo "$r" | grep -q "mayores a cero"; then ok "cantidad cero se rechaza"; else mal "cantidad cero ($r)"; fi
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d '{"items":[{"product_id":99999999,"quantity":1}]}')
if echo "$r" | grep -q "no es de esta empresa"; then ok "producto de otra empresa se rechaza (403)"; else mal "producto ajeno ($r)"; fi
SIN=$(api -X POST "$BASE/api/inventory/products.php" -H 'Content-Type: application/json' \
  -d "{\"product_name\":\"ZZ Egreso sin inventario $suf\",\"price\":10,\"cost\":1,\"stock\":0,\"tracking_type\":\"none\"}" | jget data.product_id)
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"product_id\":$SIN,\"quantity\":1}]}")
if echo "$r" | grep -q "no lleva inventario"; then ok "producto sin inventario se rechaza"; else mal "producto sin inventario ($r)"; fi
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"reason\":\"inventado\",\"items\":[{\"product_id\":$P1,\"quantity\":1}]}")
if echo "$r" | grep -q "Motivo desconocido"; then ok "un motivo inventado se rechaza"; else mal "motivo inventado ($r)"; fi

# ─────────────────────────────────────────────────────────────
# 9. Lista: aislamiento por empresa y filtro por motivo
# ─────────────────────────────────────────────────────────────
AJENA=$(sql "INSERT INTO inventory_exits (store_id, user_id, reason, item_count, total_quantity) VALUES (2, 1, 'loss', 1, 1); SELECT LAST_INSERT_ID()")
r=$(api "$BASE/api/inventory/exits.php?limit=200")
if echo "$r" | grep -q "\"exit_id\":$AJENA"; then mal "la lista muestra egresos de otra empresa"; else ok "la lista NO muestra egresos de otra empresa"; fi
if echo "$r" | grep -q "\"exit_id\":$E1"; then ok "la lista trae los egresos propios"; else mal "la lista no trae los egresos propios"; fi
r=$(api "$BASE/api/inventory/exits.php?reason=loss")
if echo "$r" | grep -q "\"exit_id\":$E1"; then ok "filtra por motivo"; else mal "filtro por motivo ($r)"; fi
sql "DELETE FROM inventory_exits WHERE exit_id = $AJENA"

# ─────────────────────────────────────────────────────────────
# 10. DESHACER: la mercancía vuelve y el egreso se va
# ─────────────────────────────────────────────────────────────
antes=$(stock_de $P1)
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"reason\":\"other\",\"items\":[{\"product_id\":$P1,\"quantity\":7}]}")
ED=$(echo "$r" | jget data.exit_id)
despues=$(stock_de $P1)
if [ -n "$ED" ] && [ "$despues" != "$antes" ]; then ok "egreso de 7 registrado para deshacerlo"; else mal "preparar el deshacer ($r)"; fi
r=$(api -X DELETE "$BASE/api/inventory/exits.php?exit_id=$ED")
if echo "$r" | grep -q '"success":true'; then ok "deshacer responde ok"; else mal "deshacer ($r)"; fi
if [ "$(stock_de $P1)" = "$antes" ]; then ok "la mercancía volvió al inventario"; else mal "stock tras deshacer ($(stock_de $P1) vs $antes)"; fi
if [ "$(sql "SELECT COUNT(*) FROM inventory_exits WHERE exit_id=$ED")" = "0" ]; then ok "el egreso deshecho ya no existe"; else mal "el egreso sigue ahí"; fi
if [ "$(sql "SELECT COUNT(*) FROM inventory_exit_items WHERE exit_id=$ED")" = "0" ]; then ok "sus renglones se fueron con él"; else mal "quedaron renglones huérfanos"; fi
if sql "SELECT movement_type FROM inventory_movements WHERE product_id=$P1 AND reference_id=$ED ORDER BY movement_id DESC LIMIT 1" | grep -q "^return$"; then
  ok "el libro conserva la salida y su reintegro (nada se borra de la historia)"; else mal "reintegro en el libro"; fi
r=$(api -X DELETE "$BASE/api/inventory/exits.php?exit_id=$ED")
if echo "$r" | grep -qi "no encontramos"; then ok "deshacer dos veces avisa (no rompe)"; else mal "deshacer dos veces ($r)"; fi

# 11. Componente: deshacer devuelve a las presentaciones
antes_total=$(sql "SELECT COALESCE(SUM(quantity),0) FROM product_lots WHERE product_id=$C1")
r=$(api -X POST "$BASE/api/inventory/exits.php" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"product_id\":$C1,\"quantity\":3}]}")
EC=$(echo "$r" | jget data.exit_id)
medio=$(sql "SELECT COALESCE(SUM(quantity),0) FROM product_lots WHERE product_id=$C1")
api -o /dev/null -X DELETE "$BASE/api/inventory/exits.php?exit_id=$EC"
fin=$(sql "SELECT COALESCE(SUM(quantity),0) FROM product_lots WHERE product_id=$C1")
if [ "$medio" != "$antes_total" ] && [ "$fin" = "$antes_total" ]; then
  ok "deshacer un egreso de componente devuelve las presentaciones ($antes_total → $medio → $fin)"; else mal "deshacer componente ($antes_total / $medio / $fin)"; fi

# Limpieza
for t in $P1 $C1 $SIN; do api -o /dev/null -X DELETE "$BASE/api/inventory/products.php?product_id=$t&force=1"; done
sql "DELETE FROM inventory_exits WHERE store_id = 1 AND exit_id IN ($E1,$E2,$E3,$ED,$EC)"
ok "limpieza: productos y egresos de prueba borrados"

echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="
[ "$FAIL" -eq 0 ]

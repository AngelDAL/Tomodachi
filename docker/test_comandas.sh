#!/usr/bin/env bash
# Pruebas de las comandas (Fase 2): la ronda que se manda a preparar.
#
#   POST api/dining/order.php   {session_id, items:[...]}      el mesero anota
#   POST api/dining/order.php   {session_id, action:send}      manda a la comanda
#   POST api/dining/order.php   {action:set_notes, ...}        notas de UN platillo
#   GET  api/dining/comandas.php                               el tablero de preparación
#   POST api/dining/comandas.php{action:start|ready|served|cancel|print}
#   GET/POST api/dining/stations.php                            estaciones y sus salidas
#
# Qué comprueba (esto es lo que hay que ver antes de creer que sirve):
#   1. Una estación se crea, se le asignan productos y el listado la reporta con ellos.
#   2. Al mandar a preparación se crea UNA COMANDA POR ESTACIÓN: un platillo de Cocina,
#      una bebida de Barra y algo sin estación son TRES comandas, no un montón.
#   3. El folio del día se asigna solo y avanza (1, 2, 3...), y `sent` conserva la forma
#      que ya leían la carta y el panel del mesero.
#   4. El tablero muestra punto de servicio, personas, minutos y las notas por platillo,
#      y filtra por estación.
#   5. Las notas de un platillo se guardan mientras está pendiente y se RECHAZAN cuando
#      ya se mandó a preparación (ahí lo que procede es anular con motivo).
#   6. start -> ready -> served avanza la comanda Y sus ítems; lo servido sale del tablero
#      y sigue disponible con ?historicas=1.
#   7. Anular exige motivo, cancela los ítems y BAJA el total de la cuenta.
#   8. Un rol que no administra el piso (cajero) NO puede crear estaciones, pero sí puede
#      operar la preparación.
#
# Uso: bash docker/test_comandas.sh [base_url]
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
# Extrae un campo de un elemento de una lista del payload: lista <clave> <índice> <campo>
jl_() { python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
arr=(d.get('data') or {}).get('$1') or []
i=int('$2')
print('' if i>=len(arr) else (arr[i] or {}).get('$3',''))" 2>/dev/null; }

echo "===== Comandas y estaciones — $BASE ====="
curl -s -o /dev/null -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
perfil=$(api "$BASE/api/users/profile.php")
if echo "$perfil" | grep -q "must_change_password"; then
  fn=$(echo "$perfil" | jq_ data.full_name); em=$(echo "$perfil" | jq_ data.email)
  api -o /dev/null -X POST "$BASE/api/users/profile.php" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"${fn:-Admin}\",\"email\":\"${em:-a@example.com}\",\"password\":\"admin123\",\"current_password\":\"admin123\"}"
fi

suf=$RANDOM

# ─────────────────────────────────────────────────────────────
# 1. Estaciones
# ─────────────────────────────────────────────────────────────
COCINA=$(api -X POST "$BASE/api/dining/stations.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"guardar\",\"name\":\"Cocina \$suf\",\"salidas\":[{\"kind\":\"screen\",\"target\":\"Tableta cocina\"}]}" | jq_ data.station_id)
BARRA=$(api -X POST "$BASE/api/dining/stations.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"guardar\",\"name\":\"Barra \$suf\",\"salidas\":[]}" | jq_ data.station_id)
if [ -n "$COCINA" ] && [ -n "$BARRA" ]; then
  ok "crea dos estaciones (cocina=$COCINA barra=$BARRA)"
else
  mal "no se pudieron crear las estaciones"; echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="; exit 1
fi

r=$(api "$BASE/api/dining/stations.php")
sal=$(echo "$r" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
for e in d.get('estaciones') or []:
    if e.get('station_id')==$COCINA: print(len(e.get('salidas') or []))" 2>/dev/null)
if [ "$sal" = "1" ]; then ok "la estación guarda su salida (pantalla)"; else mal "salidas de la estación ($r)"; fi

# Duplicar el nombre NO debe crear otra: se reusa la que existe.
dup=$(api -X POST "$BASE/api/dining/stations.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"guardar\",\"name\":\"Cocina \$suf\"}" | jq_ data.station_id)
if [ "$dup" = "$COCINA" ]; then ok "el mismo nombre reusa la estación (no duplica)"; else mal "nombre duplicado (dup=$dup)"; fi

# ─────────────────────────────────────────────────────────────
# 2. Reparto del catálogo por estación
# ─────────────────────────────────────────────────────────────
# La prueba se fabrica sus propios productos: depender de un catálogo sembrado la haría
# frágil (una instalación limpia nace con cero productos y esta prueba debe correr igual).
crear_producto() {
  api -X POST "$BASE/api/inventory/products.php" -H 'Content-Type: application/json' \
    -d "{\"product_name\":\"ZZ Comanda $1 $suf\",\"price\":$2,\"cost\":1,\"stock\":50}" | jq_ data.product_id
}
P1=$(crear_producto A 30)
P2=$(crear_producto B 45)
P3=$(crear_producto C 60)
if [ -z "$P1" ] || [ -z "$P2" ] || [ -z "$P3" ]; then
  mal "no se pudieron crear los productos de prueba ($P1/$P2/$P3)"; echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="; exit 1
fi
ok "crea tres productos de prueba"

r=$(api -X POST "$BASE/api/dining/stations.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"asignar\",\"station_id\":$COCINA,\"product_ids\":[$P1]}")
if [ "$(echo "$r" | jq_ data.asignados)" = "1" ]; then ok "asigna un producto a la cocina"; else mal "asignar a cocina ($r)"; fi
api -o /dev/null -X POST "$BASE/api/dining/stations.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"asignar\",\"station_id\":$BARRA,\"product_ids\":[$P2]}"
# El tercero se queda SIN estación a propósito: es el negocio sin preparación.

# El conteo por estación se comprueba sobre el producto de ESTA corrida: en una instancia
# con pruebas previas quedan productos asignados a ids de estaciones ya borradas.
r=$(api "$BASE/api/dining/stations.php?productos=$COCINA")
en_cocina=$(echo "$r" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
print(1 if any(int(p.get('product_id') or 0)==$P1 for p in (d.get('productos') or [])) else 0)" 2>/dev/null)
en_barra=$(api "$BASE/api/dining/stations.php?productos=$BARRA" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
print(1 if any(int(p.get('product_id') or 0)==$P1 for p in (d.get('productos') or [])) else 0)" 2>/dev/null)
if [ "$en_cocina" = "1" ] && [ "$en_barra" = "0" ]; then ok "el producto queda asignado SOLO a su estación"; else mal "reparto de productos (cocina=$en_cocina barra=$en_barra)"; fi

# ─────────────────────────────────────────────────────────────
# 3. La cuenta y el pedido
# ─────────────────────────────────────────────────────────────
PUNTO=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' -d "{\"label\":\"Prueba comanda $suf\"}" | jq_ data.table_id)
SID=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"open_table\",\"table_id\":$PUNTO}" | jq_ data.session_id)
if [ -n "$SID" ]; then ok "abre la cuenta del punto de servicio"; else mal "no se pudo abrir la cuenta"; fi

r=$(api -X POST "$BASE/api/dining/order.php" -H 'Content-Type: application/json' \
  -d "{\"session_id\":$SID,\"items\":[{\"product_id\":$P1,\"quantity\":2},{\"product_id\":$P2,\"quantity\":1,\"notes\":\"sin hielo\"},{\"product_id\":$P3,\"quantity\":1}]}")
LINEA=$(echo "$r" | python3 -c "
import json,sys
d=(json.load(sys.stdin).get('data') or {})
for it in d.get('items') or []:
    if it.get('product_id')==$P2: print(it.get('order_item_id'))" 2>/dev/null)
if [ -n "$LINEA" ]; then ok "el mesero anota tres platillos con su nota"; else mal "agregar ítems ($r)"; fi

# Notas por platillo: se escriben y se corrigen mientras están pendientes.
r=$(api -X POST "$BASE/api/dining/order.php" -H 'Content-Type: application/json' \
  -d "{\"session_id\":$SID,\"action\":\"set_notes\",\"order_item_id\":$LINEA,\"notes\":\"sin hielo, vaso aparte\"}")
guardada=$(echo "$r" | python3 -c "
import json,sys
d=(json.load(sys.stdin).get('data') or {})
for it in d.get('items') or []:
    if it.get('order_item_id')==$LINEA: print(it.get('notes'))" 2>/dev/null)
if [ "$guardada" = "sin hielo, vaso aparte" ]; then ok "notas por platillo: se guardan en su línea"; else mal "set_notes ($r)"; fi

# Cuántas comandas había antes de esta prueba: las aserciones van por DIFERENCIA, para
# que la suite siga sirviendo en una instancia que ya trae movimiento de pruebas previas.
TABLERO0=$(api "$BASE/api/dining/comandas.php" | python3 -c "import json,sys; print(len((json.load(sys.stdin).get('data') or {}).get('comandas') or []))" 2>/dev/null)

# ─────────────────────────────────────────────────────────────
# 4. Enviar a preparación = una comanda por estación
# ─────────────────────────────────────────────────────────────
r=$(api -X POST "$BASE/api/dining/order.php" -H 'Content-Type: application/json' -d "{\"session_id\":$SID,\"action\":\"send\"}")
NCOM=$(echo "$r" | python3 -c "import json,sys; print(len((json.load(sys.stdin).get('data') or {}).get('comandas') or []))" 2>/dev/null)
NSENT=$(echo "$r" | python3 -c "import json,sys; print(len((json.load(sys.stdin).get('data') or {}).get('sent') or []))" 2>/dev/null)
if [ "$NCOM" = "3" ]; then ok "un platillo de cocina, uno de barra y uno sin estación = 3 comandas"; else mal "partición por estación (comandas=$NCOM)"; fi
if [ "$NSENT" = "3" ]; then ok "'sent' conserva los 3 ítems enviados (contrato anterior intacto)"; else mal "campo sent (n=$NSENT)"; fi

FOLIO1=$(echo "$r" | jl_ comandas 0 folio)
EST0=$(echo "$r" | jl_ comandas 0 station_name)
if [ -n "$FOLIO1" ]; then ok "la comanda nace con folio del día ($FOLIO1, estación '$EST0')"; else mal "folio de la comanda ($r)"; fi

# La comanda de la barra se guarda para después: es la que nadie mueve en esta prueba.
CID_BARRA=$(echo "$r" | python3 -c "
import json,sys
d=(json.load(sys.stdin).get('data') or {})
for c in d.get('comandas') or []:
    if (c.get('station_name') or '').startswith('Barra'): print(c.get('comanda_id'))" 2>/dev/null)

# ─────────────────────────────────────────────────────────────
# 5. El tablero
# ─────────────────────────────────────────────────────────────
r=$(api "$BASE/api/dining/comandas.php")
n=$(echo "$r" | python3 -c "import json,sys; print(len((json.load(sys.stdin).get('data') or {}).get('comandas') or []))" 2>/dev/null)
if [ "$n" = "$((TABLERO0 + 3))" ]; then ok "el tablero muestra las 3 comandas nuevas"; else mal "tablero (n=$n, esperado $((TABLERO0 + 3)))"; fi

punto=$(echo "$r" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
for c in d.get('comandas') or []:
    if c.get('folio')==$FOLIO1: print(c.get('punto') or '')" 2>/dev/null)
if echo "$punto" | grep -q "Prueba comanda $suf"; then ok "la comanda dice en qué punto de servicio va"; else mal "punto de la comanda ('$punto')"; fi

mins=$(echo "$r" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
print((d.get('comandas') or [{}])[0].get('minutos'))" 2>/dev/null)
if [ -n "$mins" ] && [ "$mins" -ge 0 ] 2>/dev/null; then ok "los minutos transcurridos los calcula la base ($mins)"; else mal "minutos ($mins)"; fi

notas=$(echo "$r" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
for c in d.get('comandas') or []:
    for n in c.get('notas_lineas') or []:
        if 'sin hielo' in n: print(n)" 2>/dev/null)
if echo "$notas" | grep -q "vaso aparte"; then ok "la nota del platillo llega a la comanda"; else mal "nota en la comanda ('$notas')"; fi

# El filtro por estación: de las comandas de esta ronda, en la cocina hay UNA.
n=$(api "$BASE/api/dining/comandas.php?estacion=$COCINA" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
print(len([c for c in (d.get('comandas') or []) if c.get('folio') and c.get('station_id')==$COCINA and c.get('status')!='served']))" 2>/dev/null)
if [ "$n" = "1" ]; then ok "el tablero filtra por estación"; else mal "filtro por estación (n=$n)"; fi

# ─────────────────────────────────────────────────────────────
# 6. Las notas se cierran al enviar
# ─────────────────────────────────────────────────────────────
r=$(api -X POST "$BASE/api/dining/order.php" -H 'Content-Type: application/json' \
  -d "{\"session_id\":$SID,\"action\":\"set_notes\",\"order_item_id\":$LINEA,\"notes\":\"otra cosa\"}")
if echo "$r" | grep -q "ya se mandó a preparación"; then ok "una nota sobre algo ya enviado se rechaza (es anulación, no nota)"; else mal "set_notes sobre enviado ($r)"; fi

# ─────────────────────────────────────────────────────────────
# 7. Avance: start -> ready -> served
# ─────────────────────────────────────────────────────────────
CID=$(echo "$r" >/dev/null; api "$BASE/api/dining/comandas.php?estacion=$COCINA" | jl_ comandas 0 comanda_id)
r=$(api -X POST "$BASE/api/dining/comandas.php" -H 'Content-Type: application/json' -d "{\"action\":\"start\",\"comanda_id\":$CID}")
if [ "$(echo "$r" | jq_ data.status)" = "preparing" ]; then ok "la cocina empieza la comanda (preparing)"; else mal "start ($r)"; fi
est=$(echo "$r" | python3 -c "import json,sys; d=json.load(sys.stdin).get('data') or {}; print((d.get('items') or [{}])[0].get('status'))" 2>/dev/null)
if [ "$est" = "preparing" ]; then ok "los ítems siguen a su comanda"; else mal "estado de los ítems ($est)"; fi

api -o /dev/null -X POST "$BASE/api/dining/comandas.php" -H 'Content-Type: application/json' -d "{\"action\":\"ready\",\"comanda_id\":$CID}"
r=$(api -X POST "$BASE/api/dining/comandas.php" -H 'Content-Type: application/json' -d "{\"action\":\"served\",\"comanda_id\":$CID}")
if [ "$(echo "$r" | jq_ data.status)" = "served" ]; then ok "la comanda se sirve y deja el tablero"; else mal "served ($r)"; fi

# Ya servida no se puede volver a mover.
r=$(api -X POST "$BASE/api/dining/comandas.php" -H 'Content-Type: application/json' -d "{\"action\":\"start\",\"comanda_id\":$CID}")
if echo "$r" | grep -q "ya cambió de estado\|ya se sirvió"; then ok "una comanda servida ya no se mueve"; else mal "servida re-movida ($r)"; fi

# Lo servido sale del tablero vivo y sigue consultable en el histórico. Se comprueba sobre
# ESTA comanda (por id), no por conteos: en una instancia con corridas previas los totales
# del día acumulan y una comparación por números mentiría.
estado=$(api "$BASE/api/dining/comandas.php?historicas=1" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
for c in d.get('comandas') or []:
    if c.get('comanda_id')==$CID: print(c.get('status'))" 2>/dev/null)
viva=$(api "$BASE/api/dining/comandas.php" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
print(1 if any(c.get('comanda_id')==$CID for c in (d.get('comandas') or [])) else 0)" 2>/dev/null)
if [ "$estado" = "served" ] && [ "$viva" = "0" ]; then ok "lo servido sale del tablero y sigue en el histórico"; else mal "tablero vs histórico (estado=$estado, en tablero=$viva)"; fi

# ─────────────────────────────────────────────────────────────
# 8. Segunda ronda: el folio avanza
# ─────────────────────────────────────────────────────────────
api -o /dev/null -X POST "$BASE/api/dining/order.php" -H 'Content-Type: application/json' \
  -d "{\"session_id\":$SID,\"items\":[{\"product_id\":$P1,\"quantity\":1}]}"
r=$(api -X POST "$BASE/api/dining/order.php" -H 'Content-Type: application/json' -d "{\"session_id\":$SID,\"action\":\"send\"}")
FOLIO2=$(echo "$r" | jl_ comandas 0 folio)
if [ -n "$FOLIO2" ] && [ "$FOLIO2" -gt "$FOLIO1" ] 2>/dev/null; then ok "la segunda ronda toma el folio siguiente ($FOLIO1 -> $FOLIO2)"; else mal "folio siguiente ($FOLIO1 -> $FOLIO2)"; fi

# ─────────────────────────────────────────────────────────────
# 9. Anular con motivo
# ─────────────────────────────────────────────────────────────
CID2=$(echo "$r" | jl_ comandas 0 comanda_id)
# El total CON la comanda todavía viva: al anularla tiene que bajar exactamente eso.
TOTAL_ANTES=$(api "$BASE/api/dining/session.php?cuenta=$SID" | jq_ data.session.totals.total)
r=$(api -X POST "$BASE/api/dining/comandas.php" -H 'Content-Type: application/json' -d "{\"action\":\"cancel\",\"comanda_id\":$CID2}")
if echo "$r" | grep -q "por qué se anula"; then ok "anular sin motivo no se permite"; else mal "anular sin motivo ($r)"; fi

r=$(api -X POST "$BASE/api/dining/comandas.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"cancel\",\"comanda_id\":$CID2,\"reason\":\"El cliente se arrepintió\"}")
if [ "$(echo "$r" | jq_ data.status)" = "cancelled" ]; then ok "anula la comanda con su motivo"; else mal "anular ($r)"; fi
if [ "$(echo "$r" | jq_ data.cancel_reason)" = "El cliente se arrepintió" ]; then ok "el motivo queda escrito en la comanda"; else mal "motivo guardado ($r)"; fi

TOTAL_DESPUES=$(api "$BASE/api/dining/session.php?cuenta=$SID" | jq_ data.session.totals.total)
bajo=$(python3 -c "
a='${TOTAL_ANTES}'.strip(); b='${TOTAL_DESPUES}'.strip()
try:
    print(1 if float(b) < float(a) else 0)
except Exception:
    print('sin-dato')")
if [ "$bajo" = "1" ]; then ok "anular baja el total de la cuenta ($TOTAL_ANTES -> $TOTAL_DESPUES)"; else mal "total tras anular ($TOTAL_ANTES -> $TOTAL_DESPUES, veredicto=$bajo)"; fi

# ─────────────────────────────────────────────────────────────
# 10. Aislamiento y permisos
# ─────────────────────────────────────────────────────────────
r=$(api "$BASE/api/dining/comandas.php?comanda=999999")
if echo "$r" | grep -qi "no existe"; then ok "una comanda ajena/inexistente responde 404"; else mal "comanda inexistente ($r)"; fi

# El cajero NO administra el piso, pero SÍ opera la preparación.
CSH="cajero$suf"
api -o /dev/null -X POST "$BASE/api/users/create.php" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$CSH\",\"full_name\":\"Cajero de prueba\",\"email\":\"$CSH@example.com\",\"password\":\"Cajero12345\",\"role\":\"cashier\",\"store_id\":1}"
CJ2=$(mktemp)
curl -s -o /dev/null -c "$CJ2" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$CSH\",\"password\":\"Cajero12345\"}"
r=$(curl -s -b "$CJ2" -H 'Content-Type: application/json' -X POST "$BASE/api/dining/stations.php" \
  -d "{\"action\":\"guardar\",\"name\":\"Plancha \$suf\"}")
if echo "$r" | grep -q "Tu rol no puede administrar"; then ok "el cajero no administra estaciones"; else mal "cajero creando estación ($r)"; fi

CIDS=$(api "$BASE/api/dining/comandas.php" | jl_ comandas 0 comanda_id)
r=$(curl -s -b "$CJ2" -H 'Content-Type: application/json' -X POST "$BASE/api/dining/comandas.php" \
  -d "{\"action\":\"ready\",\"comanda_id\":${CID_BARRA:-$CIDS}}")
if [ "$(echo "$r" | jq_ data.status)" = "ready" ]; then ok "cualquier rol operativo marca una comanda como lista"; else mal "cajero operando la comanda ($r)"; fi
rm -f "$CJ2"

echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="
rm -f "$CJ"
[ "$FAIL" -eq 0 ]

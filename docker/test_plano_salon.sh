#!/usr/bin/env bash
# Pruebas del PLANO DEL SALÓN (Fase 3): acomodo, forma, asientos y el tope por asientos.
#
# Qué comprueba:
#   1. Un punto se crea con forma y asientos, y la lista los devuelve.
#   2. Editar (PUT) cambia forma y asientos; una forma inventada se rechaza.
#   3. El acomodo guarda VARIOS puntos de un golpe y el mapa los devuelve.
#   4. Un punto con posición 0 queda SIN lugar (NULL), no en la esquina.
#   5. Una forma inválida en el acomodo no rompe: cae a la de siempre (rect).
#   6. Aislamiento: el acomodo de otra tienda NO se toca (store_id en el WHERE).
#   7. TOPE POR ASIENTOS: una mesa de 2 asientos no deja entrar al tercer celular.
#   8. El tope EXPLÍCITO de la empresa manda sobre los asientos.
#
# Uso: bash docker/test_plano_salon.sh [base_url]
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
sql()  { docker exec "$DB_CONT" mariadb -uroot -p"$DB_ROOT_PASS" -N -e "$1" 2>/dev/null; }
pos_de() { api "$BASE/api/dining/tables.php" | python3 -c "
import json,sys
d=(json.load(sys.stdin).get('data') or {})
for t in d.get('tables') or []:
    if str(t.get('table_id'))=='$1':
        print(('NULL' if t.get('pos_x') is None else t.get('pos_x')), (('NULL' if t.get('pos_y') is None else t.get('pos_y'))), t.get('shape'), t.get('seats'))
        break" 2>/dev/null; }

echo "===== Plano del salón (Fase 3) — $BASE ====="
curl -s -o /dev/null -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
perfil=$(api "$BASE/api/users/profile.php")
if echo "$perfil" | grep -q "must_change_password"; then
  fn=$(echo "$perfil" | jget data.full_name); em=$(echo "$perfil" | jget data.email)
  api -o /dev/null -X POST "$BASE/api/users/profile.php" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"${fn:-Admin}\",\"email\":\"${em:-a@example.com}\",\"password\":\"admin123\",\"current_password\":\"admin123\"}"
fi

sufijo=$RANDOM

# 1. Crear con forma y asientos
r=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"label\":\"Plano A $sufijo\",\"zone\":\"Salón\",\"shape\":\"round\",\"seats\":4}")
A=$(echo "$r" | jget data.table_id)
linea=$(pos_de "$A")
if echo "$linea" | grep -q "round 4"; then ok "crear con forma y asientos (id $A: $linea)"; else mal "crear con forma y asientos ($r / $linea)"; fi
if echo "$linea" | grep -q "^NULL NULL"; then ok "un punto nuevo nace SIN lugar en el plano"; else mal "nace sin lugar ($linea)"; fi

# 2. Editar forma y asientos, y rechazar una forma inventada
api -o /dev/null -X PUT "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"table_id\":\"$A\",\"shape\":\"bar\",\"seats\":6}"
linea=$(pos_de "$A")
if echo "$linea" | grep -q "bar 6"; then ok "editar forma y asientos ($linea)"; else mal "editar forma y asientos ($linea)"; fi

r=$(api -X PUT "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"table_id\":\"$A\",\"shape\":\"triangulo\"}")
if echo "$r" | grep -qi "forma no válida"; then ok "rechaza una forma inventada"; else mal "rechaza forma inventada ($r)"; fi

# 3. Acomodo de varios puntos de un golpe
r=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"label\":\"Plano B $sufijo\",\"shape\":\"rect\",\"seats\":2}")
B=$(echo "$r" | jget data.table_id)
r=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"label\":\"Plano C $sufijo\",\"shape\":\"rect\",\"seats\":0}")
C=$(echo "$r" | jget data.table_id)

r=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"acomodo\",\"puntos\":[{\"table_id\":$A,\"pos_x\":100,\"pos_y\":80,\"shape\":\"round\",\"seats\":4},{\"table_id\":$B,\"pos_x\":300,\"pos_y\":220,\"shape\":\"bar\",\"seats\":8},{\"table_id\":$C,\"pos_x\":500,\"pos_y\":360,\"shape\":\"rect\",\"seats\":2}]}")
if echo "$r" | grep -q '"success":true'; then ok "el acomodo responde ok"; else mal "el acomodo responde ($r)"; fi
pa=$(pos_de "$A"); pb=$(pos_de "$B"); pc=$(pos_de "$C")
if [ "$pa" = "100 80 round 4" ]; then ok "A quedó en 100,80 redonda de 4"; else mal "posición de A ($pa)"; fi
if [ "$pb" = "300 220 bar 8" ]; then ok "B quedó en 300,220 barra de 8"; else mal "posición de B ($pb)"; fi
if [ "$pc" = "500 360 rect 2" ]; then ok "C quedó en 500,360"; else mal "posición de C ($pc)"; fi

# 4. Sin lugar: 0 en las dos coordenadas deja NULL (no la esquina)
api -o /dev/null -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"acomodo\",\"puntos\":[{\"table_id\":$C,\"pos_x\":0,\"pos_y\":0,\"shape\":\"rect\",\"seats\":2}]}"
pc=$(pos_de "$C")
if [ "$pc" = "NULL NULL rect 2" ]; then ok "0,0 lo deja SIN lugar (NULL), no pegado a la esquina"; else mal "sin lugar ($pc)"; fi

# 5. Forma inválida dentro del acomodo: no rompe, cae a la de siempre
api -o /dev/null -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"acomodo\",\"puntos\":[{\"table_id\":$C,\"pos_x\":700,\"pos_y\":140,\"shape\":\"estrella\",\"seats\":2}]}"
pc=$(pos_de "$C")
if [ "$pc" = "700 140 rect 2" ]; then ok "una forma inválida en el acomodo cae a rect (no rompe)"; else mal "forma inválida en acomodo ($pc)"; fi

# 6. Aislamiento por tienda: un id ajeno no se acomoda.
# Se crea un punto de OTRA tienda (la 2) para que la prueba sea real y no un "no había nada
# que comprobar": el aislamiento multi-tienda se rompe sin avisar.
AJENA=$(sql "SELECT table_id FROM $DB_NAME.dining_tables WHERE store_id <> 1 ORDER BY table_id ASC LIMIT 1")
if [ -z "$AJENA" ]; then
  sql "INSERT INTO $DB_NAME.dining_tables (store_id, label, qr_token, is_active, shape, seats)
       VALUES (2, 'Ajena plano $sufijo', 'ajenaplano$sufijo', 1, 'rect', 0)"
  AJENA=$(sql "SELECT table_id FROM $DB_NAME.dining_tables WHERE qr_token = 'ajenaplano$sufijo'")
fi
antes=$(sql "SELECT CONCAT(IFNULL(pos_x,'NULL'),' ',IFNULL(pos_y,'NULL')) FROM $DB_NAME.dining_tables WHERE table_id = $AJENA")
api -o /dev/null -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"acomodo\",\"puntos\":[{\"table_id\":$AJENA,\"pos_x\":500,\"pos_y\":500}]}"
despues=$(sql "SELECT CONCAT(IFNULL(pos_x,'NULL'),' ',IFNULL(pos_y,'NULL')) FROM $DB_NAME.dining_tables WHERE table_id = $AJENA")
if [ "$antes" = "$despues" ]; then ok "el acomodo NO toca puntos de otra tienda (id $AJENA)"; else mal "aislamiento por tienda ($antes -> $despues)"; fi
if [ "$antes" = "NULL NULL" ]; then
  sql "DELETE FROM $DB_NAME.dining_tables WHERE table_id = $AJENA"
fi

# 7. TOPE POR ASIENTOS: la mesa B quedó con 8 asientos; se baja a 2 para la prueba
api -o /dev/null -X PUT "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"table_id\":\"$B\",\"seats\":2}"
sql "UPDATE $DB_NAME.stores SET settings = JSON_SET(settings, '\$.dining.max_devices_per_check', 0) WHERE store_id = 1"
r=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' \
  -d "{\"action\":\"open_table\",\"table_id\":$B}")
sid=$(echo "$r" | jget data.session_id); cod=$(echo "$r" | jget data.code)
if [ -n "$sid" ]; then ok "cuenta abierta en la mesa de 2 asientos (código $cod)"; else mal "abrir cuenta en la mesa ($r)"; fi

# Unir 3 celulares: los dos primeros entran, el tercero NO
j1=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"join\",\"code\":\"$cod\",\"display_name\":\"Uno\"}")
j2=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"join\",\"code\":\"$cod\",\"display_name\":\"Dos\"}")
j3=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"join\",\"code\":\"$cod\",\"display_name\":\"Tres\"}")
if echo "$j1" | grep -q '"success":true' && echo "$j2" | grep -q '"success":true'; then ok "los dos primeros celulares entran"; else mal "entrar los dos primeros ($j1 / $j2)"; fi
if echo "$j3" | grep -qi "tope para esta mesa"; then ok "el tercer celular se rechaza por el tope de 2 asientos"; else mal "tercer celular ($j3)"; fi

# 8. El tope explícito de la empresa manda sobre los asientos
sql "UPDATE $DB_NAME.stores SET settings = JSON_SET(settings, '$.dining.max_devices_per_check', 3) WHERE store_id = 1"
j4=$(api -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"join\",\"code\":\"$cod\",\"display_name\":\"Cuatro\"}")
if echo "$j4" | grep -q '"success":true'; then ok "con tope explícito de 3, el tercer celular sí entra (manda la empresa)"; else mal "tope explícito ($j4)"; fi

# Limpieza: se cierra la cuenta y se sueltan los puntos de prueba
api -o /dev/null -X POST "$BASE/api/dining/session.php" -H 'Content-Type: application/json' -d "{\"action\":\"cancel\",\"session_id\":$sid,\"reason\":\"prueba del plano\"}"
sql "UPDATE $DB_NAME.stores SET settings = JSON_SET(settings, '\$.dining.max_devices_per_check', 0) WHERE store_id = 1"
for t in $A $B $C; do api -o /dev/null -X DELETE "$BASE/api/dining/tables.php?table_id=$t&force=1"; done
ok "limpieza: cuenta cancelada y puntos de prueba borrados"

echo "===== RESULTADO: $PASS pasaron, $FAIL fallaron ====="
[ "$FAIL" -eq 0 ]

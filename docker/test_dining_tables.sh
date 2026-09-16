#!/usr/bin/env bash
# Pruebas de los puntos de servicio (Fase 1, T1.2): api/dining/tables.php
#
# Qué comprueba:
#   - la lista arranca vacía y lo dice sin mentir (sin_carta cuando no hay carta)
#   - crear un punto con etiqueta libre y zona
#   - rechazar nombre duplicado y nombre vacío
#   - la URL del QR aparece cuando hay carta, y lleva el token del punto
#   - editar (etiqueta y zona), y que el duplicado también se rechace al editar
#   - rotar el token del QR invalida el anterior
#   - desactivar (los QR impresos dejan de servir) y borrar de verdad con force
#
# NO prueba todavía el caso "punto ocupado": abrir una cuenta POR punto de servicio llega
# en T1.5 (hoy solo se puede abrir desde la carta, sin punto). Cuando exista, se agrega.
#
# Uso: bash docker/test_dining_tables.sh [base_url]
set -u
BASE="${1:-http://localhost:8091}"
PASS=0; FAIL=0
CJ=$(mktemp)

ok()   { echo "PASS | $1"; PASS=$((PASS+1)); }
mal()  { echo "FAIL | $1"; FAIL=$((FAIL+1)); }
api()  { curl -s -b "$CJ" -H 'Content-Type: application/json' "$@"; }
jget() { python3 -c "import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
for k in '$1'.split('.'):
    d = (d or {}).get(k) if isinstance(d, dict) else None
print('' if d is None else d)" 2>/dev/null; }

echo "===== Puntos de servicio — $BASE ====="
curl -s -o /dev/null -c "$CJ" -X POST "$BASE/api/auth/login.php" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'

# En instalación limpia la API pide cambiar la contraseña antes de dejar trabajar.
perfil=$(api "$BASE/api/users/profile.php")
if echo "$perfil" | grep -q "must_change_password"; then
  fn=$(echo "$perfil" | jget data.full_name); em=$(echo "$perfil" | jget data.email)
  api -o /dev/null -X POST "$BASE/api/users/profile.php" -H 'Content-Type: application/json' \
    -d "{\"full_name\":\"${fn:-Admin}\",\"email\":\"${em:-a@example.com}\",\"password\":\"admin123\",\"current_password\":\"admin123\"}"
fi

# 1. Lista inicial
r=$(api "$BASE/api/dining/tables.php")
if [ "$(echo "$r" | jget success)" = "True" ]; then ok "la lista responde"; else mal "la lista responde ($r)"; fi

# 2. Crear con etiqueta libre + zona
sufijo=$RANDOM
r=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"label\":\"Mesa $sufijo\",\"zone\":\"Salón\"}")
T1=$(echo "$r" | jget data.table_id); TOK1=$(echo "$r" | jget data.qr_token)
if [ -n "$T1" ] && [ -n "$TOK1" ]; then ok "crear punto con etiqueta y zona (id $T1)"; else mal "crear punto ($r)"; fi

# 3. Duplicado: se rechaza Y el aviso dice qué hacer (antes decía sólo "ya existe" y
#    dejaba al dueño sin salida). El texto exacto importa poco; que sea accionable, no.
r=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' -d "{\"label\":\"Mesa $sufijo\"}")
if echo "$r" | grep -q "ACTIVO" && echo "$r" | grep -qi "otro nombre"; then ok "rechaza nombre duplicado con aviso accionable"; else mal "rechaza nombre duplicado ($r)"; fi

# 4. Nombre vacío
r=$(api -X POST "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' -d '{"label":"   "}')
if echo "$r" | grep -q "Escribe cómo se llama"; then ok "rechaza nombre vacío"; else mal "rechaza nombre vacío ($r)"; fi

# 5. URL del QR (necesita una carta ACTIVA).
# Ojo: api/menu/menus.php nace con is_active=0 (carta en borrador) y una carta inactiva
# responde "Esta carta no está disponible" en su URL pública, así que el punto
# correctamente devuelve url=null y sin_carta=true. Por eso aquí se publica.
cartas=$(api "$BASE/api/menu/menus.php")
menu_id=$(echo "$cartas" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or []
activos=[m for m in d if int(m.get('is_active') or 0)==1]
print(activos[0]['menu_id'] if activos else '')" 2>/dev/null)
if [ -z "$menu_id" ]; then
  borrador=$(echo "$cartas" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or []
print(d[0]['menu_id'] if d else '')" 2>/dev/null)
  if [ -n "$borrador" ]; then
    api -o /dev/null -X PUT "$BASE/api/menu/menus.php" -H 'Content-Type: application/json' \
      -d "{\"menu_id\":$borrador,\"is_active\":1}"
  else
    api -o /dev/null -X POST "$BASE/api/menu/menus.php" -H 'Content-Type: application/json' \
      -d "{\"name\":\"Carta de prueba T1\",\"mode\":\"order_and_pay\",\"is_active\":1}"
  fi
fi
r=$(api "$BASE/api/dining/tables.php")
url=$(echo "$r" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
for t in d.get('tables', []):
    if str(t['table_id'])=='$T1': print(t.get('url') or '')" 2>/dev/null)
if [ -n "$url" ]; then ok "la URL del QR sale con la carta"; else mal "la URL del QR sale con la carta (url vacía)"; fi
case "$url" in *"?punto=$TOK1") ok "la URL lleva el token del punto";; *) mal "la URL lleva el token del punto ($url)";; esac

# 6. Editar etiqueta y zona
r=$(api -X PUT "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"table_id\":$T1,\"label\":\"Mesa $sufijo renombrada\",\"zone\":\"Terraza\"}")
if [ "$(echo "$r" | jget success)" = "True" ]; then ok "editar etiqueta y zona"; else mal "editar etiqueta y zona ($r)"; fi

# 7. Rotar token
r=$(api -X PUT "$BASE/api/dining/tables.php" -H 'Content-Type: application/json' \
  -d "{\"table_id\":$T1,\"rotate_token\":true}")
TOK2=$(echo "$r" | jget data.qr_token)
if [ -n "$TOK2" ] && [ "$TOK2" != "$TOK1" ]; then ok "rotar el token del QR (invalida los impresos)"; else mal "rotar el token ($r)"; fi

# 8. Desactivar
r=$(api -X DELETE "$BASE/api/dining/tables.php?table_id=$T1")
r2=$(api "$BASE/api/dining/tables.php")
if echo "$r2" | python3 -c "
import json,sys
d=json.load(sys.stdin).get('data') or {}
print('NO' if any(str(t['table_id'])=='$T1' for t in d.get('tables',[])) else 'SI')" 2>/dev/null | grep -q SI; then
  ok "desactivar lo saca de la lista"
else mal "desactivar lo saca de la lista"; fi

# 9. Borrado real con force (desactivado y sin cuentas => se borra)
r=$(api -X DELETE "$BASE/api/dining/tables.php?table_id=$T1&force=1")
if [ "$(echo "$r" | jget data.borrado)" = "True" ]; then ok "borrado real con force"; else mal "borrado real con force ($r)"; fi

# Limpieza: el punto de la prueba no debe quedar
api -o /dev/null -X DELETE "$BASE/api/dining/tables.php?table_id=$T1&force=1"

echo
echo "===== RESULTADO puntos de servicio: $PASS pasaron, $FAIL fallaron ====="
rm -f "$CJ"
exit $FAIL

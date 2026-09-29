#!/usr/bin/env bash
# Puerta de verificación de SALUD (TAB-38) SIN Docker.
#
# El espacio de trabajo del agente no alcanza el socket de Docker, así que esta
# puerta reproduce los criterios de aceptación que NO necesitan el contenedor,
# con binarios reales (php-cli) sobre una COPIA desechable del repo:
#
#   1. `ready.php` con la BD caída (config apuntando a un puerto cerrado) → 503.
#   2. La línea EXACTA del HEALTHCHECK (`curl -fsS --max-time 3 …`) sale != 0
#      con 503, o sea que el orquestador declararía el contenedor `unhealthy`.
#   3. Ninguno de los dos endpoints manda `Set-Cookie`: el chequeo cada 30 s ya
#      no crea un archivo de sesión (antes: 2,880/día).
#   4. Desde otra IP y sin token, el cuerpo no trae `checks`; con `X-Health-Token`
#      correcto sí; con el equivocado no.
#   5. `?store_id=…` no cambia la respuesta (no lee ni acepta store_id).
#   6. `live.php` → 200 y presupuesto de latencia < 3 s.
#
# Lo que esta puerta NO puede probar (hace falta Docker; lo verifica QA en la
# instancia desechable): `docker inspect … .State.Health.Status`, el conteo de
# sesiones dentro del contenedor y el arranque real de la imagen.
#
# Uso: bash docker/verify_health_nodocker.sh [dir_desechable]
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCR="${1:-$(mktemp -d)}"
INST="$SCR/inst"
PORT_LOOP=18199
PORT_EXT=18198
TOKEN=token-de-prueba-tab38
PASS=0; FAIL=0
ok(){ echo "PASS | $1"; PASS=$((PASS+1)); }
mal(){ echo "FAIL | $1"; FAIL=$((FAIL+1)); }
BODY=$(mktemp)

jget(){ python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
for k in '$1'.split('.'):
    d = (d or {}).get(k) if isinstance(d, dict) else None
print('' if d is None else d)"; }

# ---------- instancia desechable (copia, no el repo) ----------
rm -rf "$INST"; mkdir -p "$INST/api" "$INST/includes" "$INST/config" "$INST/database" "$SCR/sessions"
cp -r "$REPO/api/health" "$INST/api/health"
cp "$REPO/includes/HealthCheck.class.php" "$INST/includes/"
cp "$REPO/config/constants.php" "$INST/config/"
cp -r "$REPO/database/migrations" "$INST/database/migrations"

# config/database.php con la BD CAÍDA (puerto cerrado): criterio 1.
cat > "$INST/config/database.php" <<'PHP'
<?php
define('DB_HOST', '127.0.0.1;port=34567'); // puerto cerrado a propósito: BD caída
define('DB_NAME', 'tomodachi_pos');
define('DB_USER', 'tomodachi');
define('DB_PASS', 'no_se_usa');
define('DB_CHARSET', 'utf8mb4');
define('DEBUG_MODE', false);
define('APP_VERSION', 'community-edition');
PHP

PIDS=""
cleanup(){ for p in $PIDS; do kill "$p" 2>/dev/null; done; rm -f "$BODY"; }
trap cleanup EXIT

PHPSESS="$SCR/sessions"
HEALTH_TOKEN="$TOKEN" php -d session.save_path="$PHPSESS" -S "127.0.0.1:$PORT_LOOP" -t "$INST" >"$SCR/php_loop.log" 2>&1 &
PIDS="$PIDS $!"
# La segunda instancia escucha en el bridge de Docker (no en la IP pública) para
# poder entrar con un REMOTE_ADDR que NO es loopback.
IP_EXT="${HEALTH_EXT_IP:-172.17.0.1}"
HEALTH_TOKEN="$TOKEN" php -d session.save_path="$PHPSESS" -S "$IP_EXT:$PORT_EXT" -t "$INST" >"$SCR/php_ext.log" 2>&1 &
PIDS="$PIDS $!"
sleep 2
LOOP="http://127.0.0.1:$PORT_LOOP"
EXT="http://$IP_EXT:$PORT_EXT"

echo "===== 0. Instancia desechable ====="
echo "copia: $INST"
c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 "$LOOP/api/health/live.php")
if [ "$c" = 200 ]; then ok "la copia desechable responde (live.php=$c)"; else mal "la copia no responde (code=$c): revisar $SCR/php_loop.log"; fi

echo
echo "===== 1. Liveness ====="
c=$(curl -s -o "$BODY" -D "$SCR/h.txt" -w '%{http_code}' --max-time 6 "$LOOP/api/health/live.php")
s=$(jget status < "$BODY")
if [ "$c" = 200 ] && [ "$s" = live ]; then ok "live.php → 200 {\"status\":\"live\"}"; else mal "live.php code=$c body=$(cat "$BODY")"; fi
if grep -qi '^set-cookie:' "$SCR/h.txt"; then mal "live.php mandó Set-Cookie"; else ok "live.php sin Set-Cookie"; fi

echo
echo "===== 2. Criterio 1: BD caída → 503 ====="
c=$(curl -s -o "$BODY" -D "$SCR/h.txt" -w '%{http_code}' --max-time 6 "$LOOP/api/health/ready.php")
s=$(jget status < "$BODY"); dbc=$(jget checks.db.status < "$BODY"); cfgs=$(jget checks.config.status < "$BODY")
if [ "$c" = 503 ] && [ "$s" = down ]; then ok "ready.php → 503 (status=down) con la BD caída"; else mal "ready.php code=$c status=$s body=$(cat "$BODY")"; fi
echo "INFO | check db=$dbc config=$cfgs"
if [ "$dbc" = down ]; then ok "el check 'db' reporta down (no miente)"; else mal "check db=$dbc (se esperaba down)"; fi
if grep -qi '^set-cookie:' "$SCR/h.txt"; then mal "ready.php mandó Set-Cookie (crearía sesión cada 30 s)"; else ok "ready.php sin Set-Cookie (el healthcheck ya no crea sesiones)"; fi

echo
echo "===== 3. Criterio 2 (equivalente sin Docker): el HEALTHCHECK sale != 0 con 503 ====="
curl -fsS --max-time 3 "$LOOP/api/health/ready.php" >/dev/null 2>&1
rc=$?
if [ "$rc" != 0 ]; then ok "curl -fsS (la línea exacta del HEALTHCHECK) → exit $rc con 503 ⇒ Docker 'unhealthy'"; else mal "curl -fsS salió 0 con 503: el HEALTHCHECK no detectaría la caída"; fi
echo "INFO | comando del Dockerfile: curl -fsS --max-time 3 http://localhost/api/health/ready.php || exit 1"

echo
echo "===== 4. Criterio 4: sin token y desde otra IP, el cuerpo no trae checks ====="
c=$(curl -s -o "$BODY" -w '%{http_code}' --max-time 6 "$EXT/api/health/ready.php")
echo "INFO | desde $EXT code=$c body=$(cat "$BODY")"
if [ "$(jget checks < "$BODY")" = "" ]; then ok "desde otra IP y sin token: solo {\"status\":…}, sin checks"; else mal "desde otra IP sin token llegó el detalle: $(cat "$BODY")"; fi
curl -s -o "$BODY" --max-time 6 -H "X-Health-Token: $TOKEN" "$EXT/api/health/ready.php"
if [ -n "$(jget checks.db.status < "$BODY")" ]; then ok "desde otra IP CON X-Health-Token: llega el detalle (checks.db=$(jget checks.db.status < "$BODY"))"; else mal "con el token correcto no llegó el detalle"; fi
curl -s -o "$BODY" --max-time 6 -H "X-Health-Token: token-malo" "$EXT/api/health/ready.php"
if [ "$(jget checks < "$BODY")" = "" ]; then ok "desde otra IP con token EQUIVOCADO: sin detalle"; else mal "con token equivocado llegó el detalle"; fi

echo
echo "===== 5. Criterio 3: los chequeos NO crean archivos de sesión ====="
antes=$(find "$PHPSESS" -type f | wc -l)
for _ in 1 2 3 4 5 6; do curl -s -o /dev/null --max-time 6 "$LOOP/api/health/ready.php"; done
echo "INFO | sesiones antes=$antes tras 6 chequeos=$(find "$PHPSESS" -type f | wc -l); esperando 35 s (más de un intervalo de 30 s)…"
sleep 35
for _ in 1 2 3; do curl -s -o /dev/null --max-time 6 "$LOOP/api/health/ready.php"; done
despues=$(find "$PHPSESS" -type f | wc -l)
if [ "$antes" = "$despues" ]; then ok "conteo de archivos de sesión igual antes/después: $antes"; else mal "creció de $antes a $despues (el healthcheck crea sesiones)"; fi

echo
echo "===== 6. store_id no se lee ni se acepta ====="
a=$(curl -s --max-time 6 "$LOOP/api/health/ready.php" | python3 -c "import json,sys;d=json.load(sys.stdin);d.pop('time',None);print(json.dumps(d,sort_keys=True))")
b=$(curl -s --max-time 6 "$LOOP/api/health/ready.php?store_id=2&store_id=999" | python3 -c "import json,sys;d=json.load(sys.stdin);d.pop('time',None);print(json.dumps(d,sort_keys=True))")
if [ -n "$a" ] && [ "$a" = "$b" ]; then ok "?store_id=… no cambia la respuesta"; else mal "la respuesta cambió con store_id"; fi

echo
echo "===== 7. Presupuesto de latencia (< 3 s del HEALTHCHECK) ====="
t=$(curl -s -o /dev/null -w '%{time_total}' --max-time 6 "$LOOP/api/health/ready.php")
if python3 -c "import sys;sys.exit(0 if float('$t')<3.0 else 1)"; then ok "ready.php en ${t}s"; else mal "ready.php tardó ${t}s"; fi

echo
echo "NOTA | lo que esta puerta NO cubre (requiere Docker, lo verifica QA):"
echo "       docker inspect --format '{{.State.Health.Status}}' <contenedor>"
echo "       docker compose exec app sh -c 'find /var/lib/php/sessions -type f | wc -l'"
echo "===== RESULTADO: $PASS en verde, $FAIL en rojo ====="
exit $(( FAIL > 0 ? 1 : 0 ))

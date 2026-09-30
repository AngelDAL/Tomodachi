#!/usr/bin/env bash
# =============================================================================
# Puerta de los raíles del SSE anónimo del carrito — TAB-25-X2 (P0-2)
# =============================================================================
# Mide, SIN Docker, sobre un rig real (nginx 1.24 + php-fpm 8.3 + el pool del
# repo) cuántas conexiones anónimas admite `api/sales/cart_sse.php` a la vez y
# si la instalación sigue atendiendo mientras esas conexiones ocupan workers.
#
# Qué comprueba (un PASS/FAIL por criterio; exit != 0 si algo falla):
#   C1  la conf declara la location del SSE con los dos raíles y 429
#   C2  la location trae `fastcgi_read_timeout` explícito y `fastcgi_buffering off`
#   C3  `nginx -t` limpio (con 5 substituciones ambientales, ver abajo)
#   C4  N=48 conexiones con la MISMA sesión de carrito  -> raíl por sesión
#   C5  N=48 conexiones con sesiones DISTINTAS, una IP  -> raíl por IP
#   C6  N=12 conexiones (por debajo del umbral) se sirven completas
#   C7  saturación del pool: hijos de php-fpm en vuelo + sonda a
#       `api/health/live.php` con las N conexiones abiertas
#
# Uso (el conf "viejo" y el árbol inmutable se sacan del commit con git, fuera
# de este script: dentro de un script el `git` del sandbox es un shim roto):
#   sha=$(git -C REPO rev-parse HEAD)
#   git -C REPO archive "$sha" api includes config | tar -x -C /tmp/arbol58
#   git -C REPO show 571d597:docker/nginx.conf > /tmp/nginx_viejo.conf
#   bash docker/verify_sse_rails_nodocker.sh --conf docker/nginx.conf --tree /tmp/arbol58
#   bash docker/verify_sse_rails_nodocker.sh --conf /tmp/nginx_viejo.conf --tree /tmp/arbol58   # DEBE fallar
#   bash docker/verify_sse_rails_nodocker.sh --conf /tmp/nginx_viejo.conf --tree /tmp/arbol58 --expect none
#
# `--expect none` invierte la expectativa: sirve para CONFIRMAR la línea base
# vulnerable (48/48 admitidas, la sonda no responde). Con `--expect rails` (por
# defecto) la misma medición falla en el conf viejo, que es lo que exige la
# puerta: una puerta que nunca falla no prueba nada.
#
# Substituciones ambientales que se aplican al conf del commit (todas dichas en
# la evidencia; ninguna toca la política del SSE, son entorno del sandbox):
#   1. `proxy_pass http://ws:8765/` -> `http://127.0.0.1:8765/` (fuera de la red
#      de docker `ws` no resuelve: `host not found in upstream "ws"`)
#   2. `access_log /var/log/nginx/access.log` -> archivo del rig (no hay permiso)
#   3. `pid /run/nginx.pid` -> pid del rig (sin root no se puede escribir ahí)
#   4. `listen 80` -> puerto del rig 18090+ (bind a :80 sin root = EACCES)
#   5. `upstream php { server 127.0.0.1:9000; }` -> puerto del php-fpm del rig
#      (el 9000 del contenedor puede estar ocupado en el sandbox)
#   Y el rig añade en su propia copia: `root` -> docroot del rig, temp paths y
#   `error_log` a archivo. `include fastcgi_params;` se resuelve con un symlink
#   al lado del conf (nginx resuelve los include relativos contra el dir del conf).
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF=""
EXPECT="rails"
POOL_MAX=48
PORT=""
FPM_PORT=""
WORK=""
JSON_OUT=""
TREE_DIR=""
KEEP=0
N=48
HOLD=8
SAT_HOLD=95
PROBE_TIMEOUT=75
PROBE_URL="/api/health/live.php"
SSE_URL="/api/sales/cart_sse.php?session={session}"

while [ $# -gt 0 ]; do
  case "$1" in
    --conf) CONF="$2"; shift 2 ;;
    --tree) TREE_DIR="$2"; shift 2 ;;
    --expect) EXPECT="$2"; shift 2 ;;
    --pool-max) POOL_MAX="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --fpm-port) FPM_PORT="$2"; shift 2 ;;
    --work) WORK="$2"; shift 2 ;;
    --json) JSON_OUT="$2"; shift 2 ;;
    --n) N="$2"; shift 2 ;;
    --sat-hold) SAT_HOLD="$2"; shift 2 ;;
    --probe-timeout) PROBE_TIMEOUT="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -nE 's/^# ?//p' "$0" | sed -n '1,45p'; exit 0 ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

[ -n "$CONF" ] || { echo "--conf <archivo nginx.conf> es obligatorio" >&2; exit 2; }
[ -f "$CONF" ] || { echo "no existe el conf: $CONF" >&2; exit 2; }
# Árbol que sirve el rig. Por defecto el repo, PERO el checkout es compartido:
# otro agente puede tener `api/sales/cart_sse.php` a medio cambiar (TAB-25-X3) y
# el rig mediría un endpoint que no es el del commit. Para la evidencia se pasa
# un árbol inmutable: git archive <sha> | tar -x -C <dir>.
TREE_DIR="${TREE_DIR:-$REPO}"
[ -f "$TREE_DIR/api/sales/cart_sse.php" ] || { echo "el árbol no tiene api/sales/cart_sse.php: $TREE_DIR" >&2; exit 2; }
case "$EXPECT" in rails|none) ;; *) echo "--expect debe ser rails|none" >&2; exit 2 ;; esac

PASS=0; FAIL=0
ok()    { PASS=$((PASS+1)); printf 'PASS  %s\n' "$*"; }
bad()   { FAIL=$((FAIL+1)); printf 'FAIL  %s\n' "$*"; }
check() { # <desc> <esperado> <medido>
  if [ "$2" = "$3" ]; then ok "$1 (= $3)"; else bad "$1: esperado $2, medido $3"; fi
}
check_lt() { # <desc> <techo_s> <medido_s>
  if awk -v a="$3" -v b="$2" 'BEGIN{exit !(a<b)}'; then ok "$1 (${3}s < ${2}s)";
  else bad "$1: esperado < ${2}s, medido ${3}s"; fi
}
norm_number() { case "$1" in ''|null) echo 0 ;; *) echo "$1" ;; esac; }

json_count() { # <archivo> <status>
  jq --argjson s "$2" '[.results[] | select(.status == $s)] | length' "$1"
}
json_probe_status() { jq -r 'if .probe == null then "none" else (.probe.status | if . == null then "no-answer" else tostring end) end' "$1"; }
json_probe_t()      { jq -r 'if .probe.t == null then 999999 else .probe.t end' "$1"; }

free_port() {
  local p
  for p in $(seq "${1:-18090}" "${2:-18160}"); do
    if ! (exec 3<>/dev/tcp/127.0.0.1/"$p") 2>/dev/null; then echo "$p"; return 0; fi
  done
  echo "SIN_PUERTO_LIBRE" >&2; return 1
}
wait_port() {
  local i=0
  while [ "$i" -lt 100 ]; do
    (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null && return 0
    sleep 0.2; i=$((i+1))
  done
  return 1
}

# -----------------------------------------------------------------------------
# Rig
# -----------------------------------------------------------------------------
WORK="${WORK:-$(mktemp -d /tmp/tab58-sse-rails.XXXXXX)}"
mkdir -p "$WORK/conf" "$WORK/measure" "$WORK/tmp" "$WORK/docroot/temp/sessions"
DOCROOT="$WORK/docroot"
[ -n "$PORT" ] || PORT="$(free_port)"
[ -n "$FPM_PORT" ] || FPM_PORT="$(free_port $((PORT+1)))"
FPM_PID=""; NGINX_PID=""

cleanup() {
  stop_nginx; stop_fpm
  if [ "$KEEP" = 0 ]; then rm -rf "$WORK/conf" "$WORK/tmp" 2>/dev/null; fi
}

stop_fpm() {
  [ -n "$FPM_PID" ] || return 0
  local kids
  kids="$(pgrep -P "$FPM_PID" 2>/dev/null | tr '\n' ' ')"
  # Los workers del SSE no notan que el cliente se fue hasta que escriben
  # (cart_sse.php:103 `connection_aborted()`): hay que matarlos explícitamente
  # o quedan ocupando CPU/puerto y ensucian la medición siguiente.
  [ -n "$kids" ] && kill -KILL $kids 2>/dev/null
  kill -TERM "$FPM_PID" 2>/dev/null
  local i=0; while [ "$i" -lt 30 ] && kill -0 "$FPM_PID" 2>/dev/null; do sleep 0.1; i=$((i+1)); done
  kill -KILL "$FPM_PID" 2>/dev/null
  FPM_PID=""
  sleep 0.2
}

stop_nginx() {
  [ -n "$NGINX_PID" ] || return 0
  kill -TERM "$NGINX_PID" 2>/dev/null
  local i=0; while [ "$i" -lt 30 ] && kill -0 "$NGINX_PID" 2>/dev/null; do sleep 0.1; i=$((i+1)); done
  kill -KILL "$NGINX_PID" 2>/dev/null
  NGINX_PID=""
}

prepare_docroot() {
  # Copia del árbol bajo prueba para el docroot del rig. Directorios COMPLETOS:
  # copiar archivos sueltos revienta cuando el endpoint depende de una clase
  # nueva (lección de TAB-38).
  rm -rf "$DOCROOT/api" "$DOCROOT/includes" "$DOCROOT/config"
  mkdir -p "$DOCROOT/api" "$DOCROOT/includes" "$DOCROOT/config"
  cp -a "$TREE_DIR/api/." "$DOCROOT/api/"
  cp -a "$TREE_DIR/includes/." "$DOCROOT/includes/"
  cp -a "$TREE_DIR/config/constants.php" "$DOCROOT/config/constants.php"
  # `config/database.php` es gitignored: el rig trae el suyo desde la plantilla.
  # El SSE de `571d597` nunca abre conexión (sólo usa temp/sessions), así que
  # basta. Si el endpoint empieza a necesitar BD, el rig lo dice con un 500.
  cp -a "$TREE_DIR/config/database.php.example" "$DOCROOT/config/database.php"
  mkdir -p "$DOCROOT/temp/sessions"
  echo "tab58-rig" > "$DOCROOT/IDENTIDAD.txt"
}

build_pool_conf() {
  # Copia LITERAL del pool del repo (docker/fpm-tuning.conf) cambiando sólo lo
  # que el sandbox exige: `listen`, y fuera `user`/`group`/`listen.owner` porque
  # no somos root. `pm.max_children` se deja en el valor del repo salvo --pool-max.
  sed -E \
    -e "s#^listen = .*#listen = 127.0.0.1:${FPM_PORT}#" \
    -e "s#^listen\.(owner|group) = .*#; quitado por el rig (sin root)#" \
    -e "s#^user = .*#; quitado por el rig (sin root)#" \
    -e "s#^group = .*#; quitado por el rig (sin root)#" \
    -e "s#^pm\.max_children = .*#pm.max_children = ${POOL_MAX}#" \
    -e "s#^pm\.start_servers = .*#pm.start_servers = 1#" \
    -e "s#^pm\.min_spare_servers = .*#pm.min_spare_servers = 1#" \
    -e "s#^pm\.max_spare_servers = .*#pm.max_spare_servers = 3#" \
    "$REPO/docker/fpm-tuning.conf" > "$WORK/pool.conf"
  cat > "$WORK/fpm.conf" <<EOF
[global]
error_log = $WORK/fpm_error.log
daemonize = no
pid = $WORK/fpm.pid
include = $WORK/pool.conf
EOF
}

start_fpm() {
  stop_fpm
  build_pool_conf
  if ! /usr/sbin/php-fpm8.3 -y "$WORK/fpm.conf" -t >>"$WORK/fpm_test.log" 2>&1; then
    bad "php-fpm -t sobre el pool del rig"
    return 1
  fi
  /usr/sbin/php-fpm8.3 -y "$WORK/fpm.conf" >>"$WORK/fpm.log" 2>&1 &
  FPM_PID=$!
  if ! wait_port "$FPM_PORT"; then bad "php-fpm no escucha en $FPM_PORT"; return 1; fi
  return 0
}

fpm_children_count() { pgrep -P "$FPM_PID" 2>/dev/null | wc -l | tr -d ' '; }

build_confs() {
  # 1) conf "de commit": sólo substituciones ambientales (las 5 documentadas)
  #    -> es la que se pasa a `nginx -t`.
  sed -e "s|http://ws:8765/|http://127.0.0.1:8765/|" \
      -e "s|upstream php { server 127.0.0.1:9000; }|upstream php { server 127.0.0.1:${FPM_PORT}; }|" \
      -e "s|access_log /var/log/nginx/access.log|access_log /dev/stderr|" \
      -e "s|pid /run/nginx.pid;|pid $WORK/conf/nginx.pid;|" \
      -e "s|listen 80;|listen $PORT;|" \
      "$CONF" > "$WORK/conf/t.conf"
  grep -q "127.0.0.1:${FPM_PORT}" "$WORK/conf/t.conf" \
    || { bad "no pude redirigir el upstream php al puerto del rig"; return 1; }
  ln -sf /etc/nginx/fastcgi_params "$WORK/conf/fastcgi_params"
  ln -sf /etc/nginx/mime.types     "$WORK/conf/mime.types"
  # 2) conf de corrida: además docroot, logs y temp paths del rig
  sed -e "s|access_log /dev/stderr tomodachi;|access_log $WORK/conf/access.log tomodachi;|" \
      -e "s|error_log /dev/stderr warn;|error_log $WORK/conf/error.log warn;|" \
      -e "s|root /var/www/html;|root $DOCROOT;|" \
      "$WORK/conf/t.conf" > "$WORK/conf/run.conf"
  awk -v w="$WORK" '
    /^http \{/ {
      print
      print "    client_body_temp_path " w "/tmp/client_body;"
      print "    proxy_temp_path       " w "/tmp/proxy;"
      print "    fastcgi_temp_path     " w "/tmp/fastcgi;"
      print "    uwsgi_temp_path       " w "/tmp/uwsgi;"
      print "    scgi_temp_path        " w "/tmp/scgi;"
      next
    }
    { print }
  ' "$WORK/conf/run.conf" > "$WORK/conf/run2.conf" && mv "$WORK/conf/run2.conf" "$WORK/conf/run.conf"
  mkdir -p "$WORK/tmp/client_body" "$WORK/tmp/proxy" "$WORK/tmp/fastcgi" "$WORK/tmp/uwsgi" "$WORK/tmp/scgi"
}

start_nginx() {
  stop_nginx
  /usr/sbin/nginx -c "$WORK/conf/run.conf" -g 'daemon off;' \
      >"$WORK/conf/nginx.out.log" 2>&1 &
  NGINX_PID=$!
  if ! wait_port "$PORT"; then bad "nginx no escucha en $PORT"; return 1; fi
  return 0
}

# Una medición por llamada, SIEMPRE con el pool recién arrancado: una conexión
# SSE que el cliente abandona deja el worker ocupado (el endpoint sólo descubre
# el abort cuando escribe), así que reutilizar el pool contaminaría la medición.
medir() { # <nombre> <n> <sessions> <hold> <json-out> [probe-url] [probe-timeout]
  local name="$1" n="$2" sessions="$3" hold="$4" out="$5"
  local probe_url="${6:-}" probe_timeout="${7:-}"
  start_fpm || return 1
  local antes; antes="$(fpm_children_count)"
  local args=(--port "$PORT" --url "$SSE_URL" --n "$n" --sessions "$sessions"
              --hold "$hold" --read-timeout 20 --json "$WORK/measure/$out")
  [ -n "$probe_url" ] && args+=(--probe-url "$probe_url" --probe-timeout "$probe_timeout")
  if ! python3 "$REPO/docker/sse_rails_probe.py" "${args[@]}" > "$WORK/measure/$out.txt"; then
    bad "la medición $name no corrió"
    return 1
  fi
  local despues; despues="$(fpm_children_count)"
  printf '  [%s] hijos php-fpm en vuelo: %s (antes %s / pool %s)\n' "$name" "$despues" "$antes" "$POOL_MAX"
  echo "$despues" > "$WORK/measure/$name.children"
  stop_fpm
  return 0
}

echo "== Rig SSE raíles =="
echo "repo           : $REPO"
SSE_SHA="$(sha256sum "$TREE_DIR/api/sales/cart_sse.php" | cut -d' ' -f1)"
echo "árbol servido  : $TREE_DIR"
echo "endpoint SSE   : api/sales/cart_sse.php sha256=$SSE_SHA"
echo "conf bajo prueba: $CONF"
echo "expectativa    : $EXPECT"
echo "work           : $WORK"
echo "puertos        : http=$PORT fpm=$FPM_PORT   pool pm.max_children=$POOL_MAX"
echo

prepare_docroot
build_confs

# --- C3: nginx -t sobre el conf del commit (substituciones ambientales) ------
if /usr/sbin/nginx -t -c "$WORK/conf/t.conf" >"$WORK/nginx_t.log" 2>&1; then
  ok "C3 nginx -t limpio sobre el conf del commit (5 substituciones ambientales)"
else
  bad "C3 nginx -t: $(tail -1 "$WORK/nginx_t.log")"
fi

# --- C1/C2: los raíles declarados en el conf --------------------------------
BLOCK="$(awk '/^[[:space:]]*location = \/api\/sales\/cart_sse\.php[[:space:]]*\{/,/^[[:space:]]*\}/' "$CONF")"
SESSION_MAX="$(printf '%s\n' "$BLOCK" | sed -nE 's/^[[:space:]]*limit_conn[[:space:]]+sse_session[[:space:]]+([0-9]+);.*/\1/p' | head -1)"
IP_MAX="$(printf '%s\n' "$BLOCK" | sed -nE 's/^[[:space:]]*limit_conn[[:space:]]+sse_ip[[:space:]]+([0-9]+);.*/\1/p' | head -1)"
HAS_LOC=0; [ -n "$BLOCK" ] && HAS_LOC=1
HAS_STATUS=0; printf '%s\n' "$BLOCK" | grep -qE '^[[:space:]]*limit_conn_status[[:space:]]+429' && HAS_STATUS=1
HAS_READ_TIMEOUT=0; printf '%s\n' "$BLOCK" | grep -qE '^[[:space:]]*fastcgi_read_timeout[[:space:]]' && HAS_READ_TIMEOUT=1
HAS_BUF_OFF=0;      printf '%s\n' "$BLOCK" | grep -qE '^[[:space:]]*fastcgi_buffering[[:space:]]+off' && HAS_BUF_OFF=1
ZONAS=$(grep -cE '^[[:space:]]*limit_conn_zone[[:space:]]+\$(sse_session_key|binary_remote_addr)' "$CONF")

if [ "$EXPECT" = rails ]; then
  check "C1a location exacta del SSE declarada" "1" "$(grep -c 'location = /api/sales/cart_sse.php' "$CONF")"
  check "C1b zonas limit_conn_zone (sesión + IP)" "2" "$ZONAS"
  check "C1c raíl por sesión declarado (limit_conn sse_session)" "si" "$([ -n "$SESSION_MAX" ] && echo si || echo no)"
  check "C1d raíl por IP declarado (limit_conn sse_ip)" "si" "$([ -n "$IP_MAX" ] && echo si || echo no)"
  check "C1e limit_conn_status 429" "1" "$HAS_STATUS"
  check "C2a fastcgi_read_timeout explícito en la location" "1" "$HAS_READ_TIMEOUT"
  check "C2b fastcgi_buffering off en la location" "1" "$HAS_BUF_OFF"
else
  check "C1' conf viejo: sin location propia del SSE" "0" "$HAS_LOC"
  check "C1'' conf viejo: sin zonas limit_conn_zone del SSE" "0" "$ZONAS"
  check "C2' conf viejo: sin fastcgi_read_timeout explícito en el SSE" "0" "$HAS_READ_TIMEOUT"
fi
SESSION_MAX="$(norm_number "$SESSION_MAX")"
IP_MAX="$(norm_number "$IP_MAX")"
echo "  umbrales leídos del conf: por sesión=$SESSION_MAX  por IP=$IP_MAX"

start_nginx || { cleanup; exit 2; }

# --- C4: N con la MISMA sesión (amplificación) ------------------------------
echo
echo "no... medición C4: $N conexiones concurrentes, MISMA sesión de carrito"
medir c4_same_session "$N" same "$HOLD" c4.json
C4_200=$(norm_number "$(json_count "$WORK/measure/c4.json" 200)")
C4_429=$(norm_number "$(json_count "$WORK/measure/c4.json" 429)")
C4_CT=$(jq -r '[.results[] | select(.status==200) | .ct] | unique | join("|")' "$WORK/measure/c4.json")
echo "  admitidas 200=$C4_200  429=$C4_429  content-type de las admitidas: $C4_CT"
if [ "$EXPECT" = rails ]; then
  check "C4a admitidas == umbral por sesión" "$SESSION_MAX" "$C4_200"
  check "C4b rechazadas con 429 == resto" "$((N - SESSION_MAX))" "$C4_429"
else
  check "C4a' conf viejo: admitidas == N (sin raíl por sesión)" "$N" "$C4_200"
  check "C4b' conf viejo: ningún 429" "0" "$C4_429"
fi
check "C4c las admitidas son text/event-stream" "text/event-stream" "$C4_CT"

# --- C5: N con sesiones DISTINTAS desde una IP ------------------------------
echo
echo "medición C5: $N conexiones concurrentes, sesiones DISTINTAS, una sola IP"
medir c5_unique_sessions "$N" unique "$HOLD" c5.json
C5_200=$(norm_number "$(json_count "$WORK/measure/c5.json" 200)")
C5_429=$(norm_number "$(json_count "$WORK/measure/c5.json" 429)")
echo "  admitidas 200=$C5_200  429=$C5_429"
if [ "$EXPECT" = rails ]; then
  check "C5a admitidas == umbral por IP" "$IP_MAX" "$C5_200"
  check "C5b rechazadas con 429 == resto" "$((N - IP_MAX))" "$C5_429"
else
  check "C5a' conf viejo: admitidas == N (sin raíl por IP)" "$N" "$C5_200"
  check "C5b' conf viejo: ningún 429" "0" "$C5_429"
fi

# --- C6: por debajo del umbral (tráfico legítimo) ---------------------------
LEGIT=12
echo
echo "medición C6: $LEGIT conexiones concurrentes, sesiones distintas (uso legítimo)"
medir c6_below_threshold "$LEGIT" unique 6 c6.json
C6_200=$(norm_number "$(json_count "$WORK/measure/c6.json" 200)")
C6_429=$(norm_number "$(json_count "$WORK/measure/c6.json" 429)")
C6_CT=$(jq -r '[.results[] | select(.status==200) | .ct] | unique | join("|")' "$WORK/measure/c6.json")
echo "  admitidas 200=$C6_200  429=$C6_429  content-type: $C6_CT"
check "C6a el tráfico legítimo se sirve completo" "$LEGIT" "$C6_200"
check "C6b sin 429 por debajo del umbral" "0" "$C6_429"
check "C6c son text/event-stream" "text/event-stream" "$C6_CT"

# --- C7: saturación del pool + sonda de instalación viva --------------------
echo
echo "medición C7: $N conexiones (sesiones distintas) + sonda $PROBE_URL con las $N abiertas"
medir c7_saturation "$N" unique "$SAT_HOLD" c7.json "$PROBE_URL" "$PROBE_TIMEOUT"
C7_CHILDREN="$(norm_number "$(cat "$WORK/measure/c7_saturation.children" 2>/dev/null)")"
C7_PROBE_STATUS="$(json_probe_status "$WORK/measure/c7.json")"
C7_PROBE_T="$(json_probe_t "$WORK/measure/c7.json")"
C7_429=$(norm_number "$(json_count "$WORK/measure/c7.json" 429)")
echo "  hijos php-fpm ocupados=$C7_CHILDREN (pool=$POOL_MAX)  429=$C7_429"
echo "  sonda: status=$C7_PROBE_STATUS  t=${C7_PROBE_T}s"
if [ "$EXPECT" = rails ]; then
  check "C7a una sola IP no puede ocupar todo el pool" "$IP_MAX" "$C7_CHILDREN"
  check "C7b la instalación sigue atendiendo (sonda 200)" "200" "$C7_PROBE_STATUS"
  check_lt "C7c la sonda responde rápido" "5" "$C7_PROBE_T"
else
  check "C7a' conf viejo: una IP ocupa TODO el pool" "$POOL_MAX" "$C7_CHILDREN"
  check "C7b' conf viejo: la sonda no obtiene respuesta (instalación sin workers)" "no-answer" "$C7_PROBE_STATUS"
fi

cleanup

echo
echo "=========================================================================="
echo "RESUMEN ($EXPECT)  conf=$CONF"
echo "  $N conexiones anónimas al SSE, misma sesión      : 200=$C4_200  429=$C4_429"
echo "  $N conexiones anónimas, sesiones distintas, 1 IP : 200=$C5_200  429=$C5_429"
echo "  $LEGIT conexiones (uso legítimo)                  : 200=$C6_200  429=$C6_429"
echo "  conexiones simultáneas para saturar el pool      : $C7_CHILDREN (pool $POOL_MAX)"
echo "  sonda api/health/live.php con el pool ocupado    : status=$C7_PROBE_STATUS t=${C7_PROBE_T}s"
echo "  criterios: ok=$PASS fallidos=$FAIL"
echo "=========================================================================="

if [ -n "$JSON_OUT" ]; then
  jq -n \
    --arg conf "$CONF" --arg expect "$EXPECT" --argjson pool "$POOL_MAX" \
    --arg tree "$TREE_DIR" --arg sse_sha "$SSE_SHA" \
    --argjson port "$PORT" --argjson fpm_port "$FPM_PORT" \
    --argjson n "$N" --argjson legit "$LEGIT" \
    --argjson session_max "$SESSION_MAX" --argjson ip_max "$IP_MAX" \
    --argjson c4_200 "$C4_200" --argjson c4_429 "$C4_429" \
    --argjson c5_200 "$C5_200" --argjson c5_429 "$C5_429" \
    --argjson c6_200 "$C6_200" --argjson c6_429 "$C6_429" \
    --argjson c7_children "$C7_CHILDREN" --arg c7_probe "$C7_PROBE_STATUS" \
    --argjson c7_probe_t "$C7_PROBE_T" \
    --argjson pass "$PASS" --argjson fail "$FAIL" \
    '{conf:$conf, expect:$expect, tree:$tree, sse_endpoint_sha256:$sse_sha,
      pool_max_children:$pool, http_port:$port, fpm_port:$fpm_port,
      n:$n, legit:$legit, session_max:$session_max, ip_max:$ip_max,
      c4_same_session:{ok:$c4_200, http_429:$c4_429},
      c5_unique_sessions_one_ip:{ok:$c5_200, http_429:$c5_429},
      c6_below_threshold:{ok:$c6_200, http_429:$c6_429},
      c7_saturation:{workers_pinned:$c7_children, probe_status:$c7_probe, probe_t_s:$c7_probe_t},
      pass:$pass, fail:$fail}' > "$JSON_OUT"
  echo "json: $JSON_OUT"
fi
echo "evidencia cruda: $WORK"
[ "$FAIL" -eq 0 ] || exit 1
exit 0

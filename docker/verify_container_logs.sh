#!/bin/bash
# Tomodachi POS - Puerta de verificación: los logs del contenedor llegan a
# `docker logs` (TAB-37).
#
# El espacio de trabajo del agente no alcanza el socket de Docker, así que la
# puerta reproduce el camino COMPLETO de logs con binarios reales:
#
#   nginx (error_log /dev/stderr) --+
#                                   +--> stderr de cada programa
#   php-fpm (error log del pool)  --+        |
#                                            v
#   supervisord (programas) --> stdout/stderr del PID 1 --> FIFO (pipe no
#                                                          seekable, igual que el
#                                                          log driver) = "docker logs"
#
# CONTROLES DE FIDELIDAD (lo que la puerta NO replica, y por qué):
#   - Binarios del sistema (php-fpm 8.3 / nginx 1.24 / supervisord 4.3) en vez de
#     los de la imagen (php:8.2-fpm / nginx bookworm / supervisor 4.2). Las
#     directivas que se prueban son las mismas en ambas versiones.
#   - La raíz del sitio, los puertos, el pidfile y el access_log de nginx se
#     reescriben a rutas/puertos del usuario sin privilegios. Ninguna línea de
#     LOG (error_log, redirect_stderr, stdout_logfile*, catch_workers_output) se
#     toca: esas se prueban verbatim, tal como están en el repo.
#   - nginx no puede hacer setuid: la línea `user www-data;` se comenta.
#   - php-fpm no corre como root: se comentan user/group/listen.owner/listen.group
#     del pool (no afectan los logs).
#   - El relay /ws/ apunta a otro servicio del contenedor: se elimina esa location.
#
# Uso:
#   verify_container_logs.sh --profile <p> --configs <dir> --work <dir> --port <n> [opciones]
#
#   --profile  bug | fixed | fpm-capture | seek-probe | devnull-gate
#   --configs  árbol con fpm-tuning.conf, supervisord.conf, nginx.conf, entrypoint.sh
#   --base-docker-conf yes|no   incluye el 00-docker.conf de la imagen php:8.2-fpm
#                               (por defecto yes: es el que trae la imagen real)
#   --report   archivo donde dejar el informe (también se imprime en stdout)
# Salida: un PASS/FAIL por criterio, resumen, y exit != 0 si algún criterio falla.

set -u

PROFILE=""; CONFIGS=""; WORK=""; PORT=""; BASE_CONF="yes"; REPORT=""; APP_SRC=""
PHP_FPM_BIN="${PHP_FPM_BIN:-/usr/sbin/php-fpm8.3}"
NGINX_BIN="${NGINX_BIN:-/usr/sbin/nginx}"
SUPERVISORD_BIN="${SUPERVISORD_BIN:-supervisord}"

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --configs) CONFIGS="$2"; shift 2 ;;
    --work)    WORK="$2"; shift 2 ;;
    --port)    PORT="$2"; shift 2 ;;
    --base-docker-conf) BASE_CONF="$2"; shift 2 ;;
    --report)  REPORT="$2"; shift 2 ;;
    --app-src) APP_SRC="$2"; shift 2 ;;
    --php-fpm) PHP_FPM_BIN="$2"; shift 2 ;;
    --nginx)   NGINX_BIN="$2"; shift 2 ;;
    --supervisord) SUPERVISORD_BIN="$2"; shift 2 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

[ -n "$PROFILE" ] && [ -n "$CONFIGS" ] && [ -n "$WORK" ] || { echo "Faltan --profile/--configs/--work" >&2; exit 2; }
[ -n "$PORT" ] || PORT=$((17000 + RANDOM % 2000))
FPM_PORT=$((PORT + 1))

FPM_CONF="$CONFIGS/fpm-tuning.conf"
SUP_CONF="$CONFIGS/supervisord.conf"
NGX_CONF="$CONFIGS/nginx.conf"
ENTRY="$CONFIGS/entrypoint.sh"

FAILED=0
REPORT_LINES=()

say() { REPORT_LINES+=("$1"); echo "$1"; }
check() { # check <descripción> <valor> <esperado>
  if [ "$2" = "$3" ]; then say "PASS  $1 (valor=$2)"; else say "FAIL  $1 (valor=$2, esperado=$3)"; FAILED=1; fi
}
check_ge() { # check_ge <descripción> <valor>
  if [ "$2" -ge 1 ] 2>/dev/null; then say "PASS  $1 (valor=$2, esperado>=1)"; else say "FAIL  $1 (valor=$2, esperado>=1)"; FAILED=1; fi
}
finish() {
  if [ -n "$REPORT" ]; then printf '%s\n' "${REPORT_LINES[@]}" > "$REPORT"; fi
  exit $FAILED
}
panic() { say "FAIL  el rig no arrancó: $1"; finish; }

rm -rf "$WORK"; mkdir -p "$WORK/fpm/pool.d" "$WORK/nginx" "$WORK/logs" "$WORK/app"

# ---------------------------------------------------------------- árbol de app
# El endpoint de prueba usa el MISMO bloque de php.ini que el entrypoint genera
# en config/database.php: se extrae del propio archivo bajo prueba.
if [ -n "$APP_SRC" ] && [ -d "$APP_SRC" ]; then cp -r "$APP_SRC/." "$WORK/app/" 2>/dev/null || true; fi
{
  echo "<?php"
  awk '/^define\(.DEBUG_MODE., false\);$/{f=1} f{if (!/^PHP$/) print} f&&/^PHP$/{exit}' "$ENTRY" 2>/dev/null
} > "$WORK/app/rig_ini.php"

cat > "$WORK/app/logcheck.php" <<'PHP'
<?php
require_once __DIR__ . '/rig_ini.php';
// 1) llamada explícita (lo que ya hace la app: api/**/error_log(...))
error_log('[TAB-37] marcador: error_log() desde un worker de php-fpm');
// 2) aviso no fatal (el volumen que decide error_reporting)
$tab37_suma = $tab37_var_indefinida + 1;
// 3) error fatal (la línea que el operador necesita leer completa)
tab37_funcion_inexistente();
PHP

# ------------------------------------------------------------ pool de php-fpm
# php-fpm.d/*.conf se incluye en orden alfabético: 00-docker.conf < 50-www.conf.
if [ "$BASE_CONF" = "yes" ]; then
  cat > "$WORK/fpm/pool.d/00-docker.conf" <<'CONF'
; Réplica verbatim del docker.conf que genera la imagen php:8.2-fpm
[global]
error_log = /proc/self/fd/2
log_limit = 8192

[www]
access.log = /proc/self/fd/2
clear_env = no
catch_workers_output = yes
decorate_workers_output = no
listen = 9000
CONF
fi
{
  echo "; Copia del pool del repo; solo ajustes de rig (rutas/puertos, sin root)."
  sed -e 's|^user = .*|; rig: user (sin root)|' \
      -e 's|^group = .*|; rig: group (sin root)|' \
      -e 's|^listen\.owner = .*|; rig: listen.owner|' \
      -e 's|^listen\.group = .*|; rig: listen.group|' \
      -e "s|^listen = .*|listen = 127.0.0.1:${FPM_PORT}|" "$FPM_CONF"
} > "$WORK/fpm/pool.d/50-www.conf"
cat > "$WORK/fpm/pool.d/90-zz-docker.conf" <<'CONF'
[global]
daemonize = no

[www]
CONF
if [ "$BASE_CONF" = "yes" ]; then
  echo "[global]" > "$WORK/fpm/php-fpm.conf"
  echo "include = $WORK/fpm/pool.d/*.conf" >> "$WORK/fpm/php-fpm.conf"
else
  { echo "[global]";
    echo "; rig: sin el docker.conf de la imagen base. Se replica a mano SOLO la raíz";
    echo "; del error log del maestro (=/proc/self/fd/2, stderr) porque el php-fpm.conf";
    echo "; por defecto de la imagen apunta a /var/log/php-fpm.log (no escribible sin";
    echo "; root). Es el único ajuste: `catch_workers_output` NO se replica — es lo que";
    echo "; se está midiendo (el repo lo declara en el pool; la imagen en docker.conf).";
    echo "error_log = /proc/self/fd/2";
    echo "daemonize = no";
    echo "include = $WORK/fpm/pool.d/*.conf"; } > "$WORK/fpm/php-fpm.conf"
fi

# ------------------------------------------------------------------- nginx
# Se conservan verbatim TODAS las líneas de log; solo se reescriben rutas y puerto
# para poder correr sin privilegios. `prefix` apunta al directorio propio del rig
# para que los `include` relativos del repo (fastcgi_params, mime.types) se
# resuelvan ahí: el rig copia los del sistema, que son los mismos de la imagen.
mkdir -p "$WORK/nginx/conf"
cp -f /etc/nginx/fastcgi_params "$WORK/nginx/conf/fastcgi_params" 2>/dev/null || true
cp -f /etc/nginx/mime.types "$WORK/nginx/conf/mime.types" 2>/dev/null || true
sed -e 's|^user www-data;|# rig: user www-data|' \
    -e "s|^pid /run/nginx.pid;|pid $WORK/nginx/nginx.pid;|" \
    -e "s|^    upstream php { server 127.0.0.1:9000; }|    upstream php { server 127.0.0.1:$FPM_PORT; }|" \
    -e "s|^        listen 80;|        listen $PORT;|" \
    -e "s|^        root /var/www/html;.*|        root $WORK/app;|" \
    -e "s|^    server_tokens off;|    server_tokens off;\n    access_log off;|" \
    "$NGX_CONF" > "$WORK/nginx/nginx.conf"
sed -i -e '/proxy_pass http:\/\/ws:8765\/;/d' \
       -e "s|include /etc/nginx/mime.types;|include conf/mime.types;|" \
       -e "s|include fastcgi_params;|include conf/fastcgi_params;|" \
       -e "s|^    access_log /var/log/nginx/access.log tomodachi;|    access_log off;|" \
       -e "s|^    log_format tomodachi |    # rig: log_format del repo (inerte con access_log off)\n    # log_format tomodachi |" \
       "$WORK/nginx/nginx.conf"
chmod -R a+rX "$WORK/app" "$WORK/nginx/conf"

# --------------------------------------------------------------- supervisord
# Se conservan verbatim los bloques [supervisord] y las directivas de log de cada
# programa; solo se reescriben los `command=` a los binarios del rig.
sed -e "s|^command=/usr/local/sbin/php-fpm -F|command=$PHP_FPM_BIN -F -y $WORK/fpm/php-fpm.conf|" \
    -e "s|^command=/usr/sbin/nginx -g \"daemon off;\"|command=$NGINX_BIN -c $WORK/nginx/nginx.conf -g \"daemon off;\"|" \
    -e "s|^pidfile=/tmp/supervisord.pid|pidfile=$WORK/supervisord.pid|" \
    "$SUP_CONF" > "$WORK/supervisord.conf"

if [ "$PROFILE" = "seek-probe" ]; then
  # Variante de control: mismo conf pero con el rollover por defecto (50MB) y el
  # log de supervisord a un archivo, para poder leer el "Illegal seek".
  sed -i -e 's|^stdout_logfile_maxbytes=0|; rig: stdout_logfile_maxbytes (default 50MB)|' \
         -e "s|^logfile=/dev/null|logfile=$WORK/logs/supervisord.log|" "$WORK/supervisord.conf"
fi

if [ "$PROFILE" = "fpm-capture" ]; then
  # Control diagnóstico: se desvían las RUTAS de log de los programas a un
  # archivo del rig para ver qué emiten antes de que supervisord los publique o
  # los descarte. maxbytes=0 se conserva.
  sed -i -e "s|^stdout_logfile=/dev/stdout|stdout_logfile=$WORK/logs/fpm-capture.out|" \
         -e "s|^stdout_logfile=/dev/null|stdout_logfile=$WORK/logs/fpm-capture.out|" \
         -e "s|^stderr_logfile=/dev/null|stderr_logfile=$WORK/logs/fpm-capture.out|" \
         "$WORK/supervisord.conf"
  : > "$WORK/logs/fpm-capture.out"
fi

say "# Perfil: $PROFILE   base-docker-conf: $BASE_CONF"
say "# sha256 (16): supervisord.conf=$(sha256sum "$SUP_CONF" | cut -c1-16) fpm-tuning.conf=$(sha256sum "$FPM_CONF" | cut -c1-16) nginx.conf=$(sha256sum "$NGX_CONF" | cut -c1-16) entrypoint.sh=$(sha256sum "$ENTRY" | cut -c1-16)"

# ------------------------------------------------- criterio 6 (supervisord)
DEVNULL=$(grep -c 'dev/null' "$SUP_CONF")
if [ "$PROFILE" = "fixed" ] || [ "$PROFILE" = "devnull-gate" ]; then
  check "criterio 6: líneas con dev/null en supervisord.conf (solo el logfile principal)" "$DEVNULL" "1"
fi
if [ "$PROFILE" = "devnull-gate" ]; then finish; fi

# ============================ perfiles con supervisord =====================
# `docker logs` = stdout/stderr del PID 1 por un pipe no seekable (FIFO).
mkfifo "$WORK/dockerlogs.pipe"
cat "$WORK/dockerlogs.pipe" > "$WORK/logs/docker_logs.txt" &
READER=$!
exec 3>"$WORK/dockerlogs.pipe"

"$SUPERVISORD_BIN" -c "$WORK/supervisord.conf" >&3 2>&3 &
SUP_PID=$!

READY=0
wait_ready() { # wait_ready <url> <codigo-aceptable|*>
  local url="$1" want="$2" i code
  for i in $(seq 1 60); do
    code=$(curl -sS -o /dev/null -m 3 -w '%{http_code}' "$url" 2>/dev/null || true)
    if [ -n "$code" ] && [ "$code" != "000" ] && { [ "$want" = "*" ] || [ "$code" = "$want" ]; }; then
      READY=1; return 0
    fi
    sleep 0.5
  done
  return 1
}

# nginx y php-fpm arrancan en paralelo: se espera a nginx (que responde 404 en la
# ruta base) y ADEMÁS a php-fpm (un endpoint PHP que devuelve 200).
wait_ready "http://127.0.0.1:$PORT/nada-tab37.html" 404 || true
if [ "$READY" = "1" ]; then
  READY=0
  wait_ready "http://127.0.0.1:$PORT/rig_ini.php" 200 || true
fi
if [ "$READY" != "1" ]; then
  say "# el rig no quedó listo; salida cruda del surrogate:"
  sed -n '1,25p' "$WORK/logs/docker_logs.txt"
  # Diagnóstico: ¿php-fpm/nginx arrancan bien aparte?
  {
    echo "== nginx -t =="; "$NGINX_BIN" -t -c "$WORK/nginx/nginx.conf" 2>&1 | tail -3
    echo "== php-fpm -t =="; "$PHP_FPM_BIN" -t -y "$WORK/fpm/php-fpm.conf" 2>&1 | tail -3
    echo "== php-fpm arranque directo (5s) =="
    timeout 5 "$PHP_FPM_BIN" -F -y "$WORK/fpm/php-fpm.conf" 2>&1 | tail -5
    echo "== nginx arranque directo (5s) =="
    timeout 5 "$NGINX_BIN" -c "$WORK/nginx/nginx.conf" -g "daemon off;" 2>&1 | tail -5
  } >> "$WORK/logs/diag.txt" 2>&1
  while IFS= read -r line; do say "    $line"; done < "$WORK/logs/diag.txt"
  kill "$SUP_PID" 2>/dev/null
  exec 3>&-
  wait "$READER" 2>/dev/null
  panic "nginx/php-fpm no quedaron listos en el puerto $PORT"
fi
sleep 1

# Golpe: endpoint que hace error_log() + warning + fatal, y un 404 (error de nginx)
HTTP=$(curl -sS -o "$WORK/logs/http_body.txt" -w '%{http_code}' "http://127.0.0.1:$PORT/logcheck.php" 2>/dev/null || true)
curl -sS -o /dev/null "http://127.0.0.1:$PORT/no-existe-tab37.html" 2>/dev/null || true
sleep 2

kill -TERM "$SUP_PID" 2>/dev/null
wait "$SUP_PID" 2>/dev/null
exec 3>&-
wait "$READER" 2>/dev/null

LOGS="$WORK/logs/docker_logs.txt"
MSG=$(grep -c 'PHP message' "$LOGS" || true)
FATAL=$(grep -c 'PHP Fatal error' "$LOGS" || true)
WARN=$(grep -cE 'Warning:[[:space:]]+Undefined' "$LOGS" || true)
NGXERR=$(grep -c '\[error\]' "$LOGS" || true)
SEEK=$(grep -c 'Illegal seek' "$LOGS" || true)
LEAK=$(grep -cE 'Fatal error|Warning:|Stack trace' "$WORK/logs/http_body.txt" 2>/dev/null || true)

say "# HTTP de logcheck.php: ${HTTP:-sin-respuesta} (500 esperado: el fatal no se muestra al cliente)"
say "# Líneas del surrogate de docker logs: $(wc -l < "$LOGS")"
grep -E 'PHP message|PHP Fatal error|PHP Warning|\[error\]' "$LOGS" 2>/dev/null | head -6 | sed 's/^/    /' >> "$WORK/logs/sample.txt" || true

case "$PROFILE" in
  bug)
    check "criterio 1: 'PHP message' en docker logs ANTES del arreglo" "$MSG" "0"
    check "criterio 2: 'PHP Fatal error' en docker logs ANTES del arreglo" "$FATAL" "0"
    check "criterio 4: 'Illegal seek' en docker logs" "$SEEK" "0"
    check "error de nginx visible en docker logs ANTES del arreglo" "$NGXERR" "0"
    check "baseline: la respuesta HTTP tampoco filtra el error (display_errors=0)" "$LEAK" "0"
    ;;
  fixed)
    check_ge "criterio 2: 'PHP message' en docker logs DESPUÉS del arreglo" "$MSG"
    check_ge "criterio 2: 'PHP Fatal error' completo en docker logs" "$FATAL"
    check_ge "criterio 5: avisos no fatales registrados (volumen de E_ALL)" "$WARN"
    check_ge "error de nginx (open() failed) visible en docker logs" "$NGXERR"
    check "criterio 4: 'Illegal seek' en docker logs" "$SEEK" "0"
    check "entrypoint: E_ALL no filtra rutas ni stack al cliente (display_errors=0)" "$LEAK" "0"
    ;;
  fpm-capture)
    # Se mide SOLO lo que el worker saca por el log de php-fpm: con
    # catch_workers_output=no el pool lo reporta como "child N said into stderr";
    # con el docker.conf de la imagen (decorate_workers_output=no) sale pelado
    # como "NOTICE: PHP message: ...". Las líneas que empiezan con fecha son de
    # nginx (el relay "FastCGI sent in stderr") y NO cuentan como prueba de que el
    # worker emita: nginx las publica aunque el pool descarte el stream.
    CAP=$(grep -cE '^(NOTICE|WARNING): PHP message|said into stderr' "$WORK/logs/fpm-capture.out" || true)
    if [ "$BASE_CONF" = "yes" ]; then
      check_ge "control: con el docker.conf de la imagen php-fpm el worker SÍ emite al log del pool (el descarte era de supervisord)" "$CAP"
    elif grep -qE '^[[:space:]]*catch_workers_output[[:space:]]*=[[:space:]]*yes' "$FPM_CONF"; then
      check_ge "control: el pool del repo declara catch_workers_output = yes -> el worker emite SIN ayuda del docker.conf de la imagen" "$CAP"
    else
      check "control: el pool sin catch_workers_output no deja salir el stream del worker (0 líneas de 'child ... said into stderr')" "$CAP" "0"
    fi
    ;;
  seek-probe)
    SEEKSUP=$(grep -c 'Illegal seek' "$WORK/logs/supervisord.log" 2>/dev/null || echo 0)
    check_ge "control: con el rollover por defecto (50MB) SÍ aparece 'Illegal seek'" "$SEEKSUP"
    say "# 'Illegal seek' en el surrogate de docker logs con rollover por defecto: $SEEK"
    ;;
esac

if [ -f "$WORK/logs/sample.txt" ]; then
  say "# Muestra (hasta 6 líneas PHP/[error]):"
  while IFS= read -r line; do REPORT_LINES+=("$line"); done < "$WORK/logs/sample.txt"
fi

finish

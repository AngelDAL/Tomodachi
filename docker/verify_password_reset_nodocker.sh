#!/usr/bin/env bash
# Puerta de verificación del RESET DE CONTRASEÑA (TAB-60 · P0-4 de TAB-25) SIN Docker.
#
# POR QUÉ EXISTE
# P0-4 son DOS defectos que se tapan entre sí, y arreglar sólo uno empeora la
# situación (arreglar la caducidad sin el enlace confiable convierte un bug de
# disponibilidad en una toma de cuentas). Por eso esta puerta los mide JUNTOS,
# con binarios reales y sin contenedor:
#
#   - un MariaDB 10.11 REAL (el mismo major que la imagen `mariadb:10.11`) que
#     arranca en UTC — que es exactamente la mitad del defecto de caducidad;
#   - los endpoints reales `api/auth/forgot_password.php` y
#     `api/auth/reset_password.php` por HTTP real (`php -S`) sobre una COPIA
#     desechable del repo, con `TZ=America/Mexico_City` en el servidor (la otra
#     mitad), igual que el contenedor (`docker/entrypoint.sh`).
#
# Criterios cubiertos (los numerados son los del issue TAB-60)
#   1. Con el servidor en America/Mexico_City y la BD en UTC, un token RECIÉN
#      emitido valida: la fila la escribió `DATE_ADD(NOW(), INTERVAL 1 HOUR)`
#      (comprobado contra NOW() de la BD) y `reset_password.php`, por HTTP real y
#      con el token en claro, NO responde «inválido o ha expirado».
#   2. Con APP_URL fija y `Host: evil.com`, el enlace que se habría enviado no
#      contiene `evil.com` (se imprime el valor capturado).
#   3. Con APP_URL vacía: no se envía correo, no se emite token, y la respuesta
#      es idéntica para un correo existente y uno inexistente.
#   4. Ambas mitades en el mismo commit (la puerta no lo puede saber, pero mide
#      las dos y falla si falta cualquiera).
#   5. Regresión: la sección 5 reproduce el valor temporal que guardaba la
#      versión anterior (calculado en PHP, hora de México) y comprueba que SÍ
#      nace caducado. Es lo que hace esta puerta no-vacua: si alguien vuelve a
#      calcular la caducidad en PHP, la sección 5 vuelve a verde y la 2 a rojo.
#
# LO QUE ESTA PUERTA NO PUEDE PROBAR (hace falta Docker; lo verifica QA en la
# instancia desechable): que el contenedor real arranque con `APP_URL` inyectada
# por `docker-compose.yml`, y que el correo salga por SMTP de verdad (aquí
# `includes/Mail.class.php` se sustituye por un DOBLE de prueba en la copia
# desechable — el repo no se toca para eso).
#
# Uso:
#   MARIADB_BIN=/ruta/con/bin bash docker/verify_password_reset_nodocker.sh [dir_desechable]
# Variables:
#   MARIADB_BIN   (obligatoria) directorio con el cliente `mysql` de MariaDB 10.11
#   MARIADB_HOST  (127.0.0.1)   MARIADB_PORT (13306)
#   MARIADB_USER  (tomodachi)   MARIADB_PASS (tomodachi_secret)
#   ENDPOINT_OVERRIDE (opcional) ruta a otra copia de forgot_password.php para
#                     correr la puerta contra ella. Sirve para demostrar que la
#                     puerta NO es vacua: apúntala a la versión anterior
#                     (`git show <sha>:api/auth/forgot_password.php > /tmp/x.php`)
#                     y debe salir en ROJO.
# La puerta crea y BORRA su propia base desechable en cada corrida y usa un
# puerto libre elegido en runtime (una corrida muerta deja un `php -S` huérfano
# escuchando: un puerto fijo haría que la siguiente midiera OTRO servidor).
# Identidad del servidor: un nonce que sólo existe en ESTA copia desechable.
#
# EL DESFASE DE RELOJES SE ARREGLA AQUÍ, NO SE ASUME
# El defecto se reproduce con el reloj de la app en hora de México y `NOW()` de la
# BD en UTC, igual que el contenedor (la app fija su zona con
# `date_default_timezone_set(${TZ:-America/Mexico_City})` — docker/entrypoint.sh — y
# el servicio `db` no fija TZ, luego corre UTC). Dos relojes que NO se pueden dar
# por sentados:
#   - PHP: la config de la copia desechable llama a `date_default_timezone_set`,
#     exactamente como el entrypoint. (El `TZ` del entorno NO basta: php.ini trae
#     `date.timezone=UTC` y gana.)
#   - MaríaDB: el servidor del rig hereda la zona del host, que en este espacio de
#     trabajo es CST, no UTC. La puerta fija `time_zone='+00:00'` para que la BD
#     mida como la del contenedor y RESTAURA el valor anterior al salir; además
#     AFIRMA el desfase resultante (sección 0), de modo que si algún día el rig
#     cambia de zona, la puerta lo dice en vez de medir otra cosa.
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCR="${1:-$(mktemp -d)}"
RUN="$$-$RANDOM"
DB="tab25_x4_${RUN//-/}"

MARIADB_BIN="${MARIADB_BIN:?falta MARIADB_BIN (directorio con el cliente `mysql` de MariaDB 10.11)}"
MARIADB_HOST="${MARIADB_HOST:-127.0.0.1}"
MARIADB_PORT="${MARIADB_PORT:-13306}"
DB_USER="${MARIADB_USER:-tomodachi}"
DB_PASS="${MARIADB_PASS:-tomodachi_secret}"
APP_URL_BUENA="https://pos.midominio.com"

MYSQL="$MARIADB_BIN/mysql -h${MARIADB_HOST} -P${MARIADB_PORT} -u${DB_USER} -p${DB_PASS} --skip-ssl --default-character-set=utf8mb4"
q(){ # q <SQL> → valor escalar
  $MYSQL "$DB" -N -B -e "$1" 2>/dev/null
}
INST="$SCR/inst"
INST_B="$SCR/inst_sin_appurl"
CAPTURA="$SCR/correo_capturado.txt"
BODY="$SCR/body.json"
BODY_B="$(mktemp)"
PASS=0; FAIL=0
ok(){ echo "PASS | $1"; PASS=$((PASS + 1)); }
mal(){ echo "FAIL | $1"; FAIL=$((FAIL + 1)); }
comprobar(){ # <descripción> <esperado> <obtenido>
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else mal "$1 — esperado [$2], obtenido [$3]"; fi
}
no_contiene(){ case "$2" in *"$3"*) mal "$1 — sí aparece [$3]" ;; *) ok "$1" ;; esac; }
contiene(){ case "$2" in *"$3"*) ok "$1" ;; *) mal "$1 — no aparece [$3] en: $(printf '%s' "$2" | head -c 200)" ;; esac; }
jget(){ python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
for k in '$1'.split('.'):
    d = (d.get(k) if isinstance(d, dict) else None)
print(json.dumps(d) if isinstance(d, bool) else ('' if d is None else d))"; }
# Cuenta una aguja SÓLO en código: los comentarios del propio endpoint nombran a
# propósito `HTTP_HOST` y `strtotime` (explican por qué NO se usan), y contar un
# grep crudo se contaría a sí mismo.
codigo(){ grep -v '^[[:space:]]*\(//\|\*\|/\*\)' "$1" | grep -c "$2" || true; }

PIDS=""
TZ_GLOBAL_PREV=""
cleanup(){
  for p in $PIDS; do kill "$p" 2>/dev/null; done
  if [ -n "$TZ_GLOBAL_PREV" ]; then
    $MYSQL -e "SET GLOBAL time_zone='${TZ_GLOBAL_PREV}';" 2>/dev/null || true
    echo "INFO | time_zone global del rig restaurada a '${TZ_GLOBAL_PREV}'"
  fi
  rm -f "$BODY_B" "$BODY"
}
trap cleanup EXIT

puerto_libre(){ # primer puerto del rango que nadie escucha
  local base=$1 p
  for p in $(seq "$base" $((base + 150))); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return 0; fi
  done
  echo ""; return 1
}
# Levanta php -S sobre la copia y espera a que SÍ sea esa copia (nonce).
arrancar(){ # arrancar <dir> <puerto> <app_url|VACIO> <log>
  local dir=$1 puerto=$2 app=$3 log=$4
  # La zona horaria de la app la fija config/database.php de la copia
  # (`date_default_timezone_set(...)`, igual que docker/entrypoint.sh), no el
  # entorno: php.ini trae date.timezone=UTC y ese gana sobre `TZ`.
  if [ "$app" = "VACIO" ]; then
    ( cd "$dir" && exec env -u APP_URL \
        MAIL_CAPTURE_FILE="$CAPTURA" \
        php -d session.save_path="$SCR/sessions" -S "127.0.0.1:$puerto" -t "$dir" ) >"$log" 2>&1 &
  else
    ( cd "$dir" && exec env APP_URL="$app" \
        MAIL_CAPTURE_FILE="$CAPTURA" \
        php -d session.save_path="$SCR/sessions" -S "127.0.0.1:$puerto" -t "$dir" ) >"$log" 2>&1 &
  fi
  PIDS="$PIDS $!"
  local i
  for i in $(seq 1 40); do
    if [ "$(curl -s --max-time 2 "http://127.0.0.1:$puerto/identidad.txt")" = "$NONCE" ]; then return 0; fi
    sleep 0.25
  done
  return 1
}
pedir(){ # pedir <puerto> <ruta> <json> [host] → escribe $BODY, imprime el código HTTP
  local extra=()
  if [ -n "${4:-}" ]; then extra=(-H "Host: $4"); fi
  curl -s -o "$BODY" -w '%{http_code}' --max-time 8 -X POST \
    -H 'Content-Type: application/json' "${extra[@]}" --data "$3" \
    "http://127.0.0.1:$1/$2"
}

echo "===== TAB-60 · reset de contraseña sin Docker ($($MARIADB_BIN/mysql --version | head -1)) ====="
echo "repositorio: $REPO"
echo "desechable:  $SCR"
echo

# ---------------------------------------------------------------------------
# Preparación: base desechable con el recorte REAL del esquema (database/schema.sql)
# ---------------------------------------------------------------------------
rm -rf "$INST" "$INST_B" "$SCR/sessions"
mkdir -p "$INST" "$INST_B" "$SCR/sessions"

python3 - "$REPO/database/schema.sql" "$SCR/esquema.sql" <<'PY' || exit 2
# Recorte del esquema: lo que este flujo toca (stores/users por el reset y
# login_attempts por el rate limiter). Se toma TAL CUAL de schema.sql para que la
# puerta use el esquema de verdad, no una imitación que podría divergir.
import re, sys
src = open(sys.argv[1], encoding='utf-8').read()
partes = []
for t in ('stores', 'users', 'login_attempts'):
    m = re.search(r'CREATE TABLE ' + t + r' \(.*?\n\)[^\n]*;', src, re.S)
    if not m:
        sys.exit('no encontré CREATE TABLE ' + t + ' en schema.sql')
    partes.append(m.group(0))
open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(partes) + '\n')
PY

$MYSQL -e "DROP DATABASE IF EXISTS \`${DB}\`; CREATE DATABASE \`${DB}\`;" \
  || { echo "no se pudo crear la base; ¿está mariadbd corriendo?" >&2; exit 2; }
$MYSQL "$DB" < "$SCR/esquema.sql" || { echo "no se pudo cargar el esquema" >&2; exit 2; }

# La BD del contenedor corre en UTC (el servicio `db` no fija TZ); el servidor del
# rig hereda la zona del host. Se iguala al contenedor y se RESTAURA al salir
# (cleanup). Sólo afecta a conexiones nuevas: las sesiones ya abiertas conservan su
# desfase.
TZ_GLOBAL_PREV="$($MYSQL -N -B -e 'SELECT @@global.time_zone;' 2>/dev/null)"
$MYSQL -e "SET GLOBAL time_zone='+00:00';" || { echo "no se pudo fijar la zona de la BD en UTC" >&2; exit 2; }

# Semilla: una tienda y tres usuarios (dos para el caso APP_URL vacía, uno para la
# sección 5). Las contraseñas son bcrypt reales porque reset_password.php reescribe
# la columna y la puerta comprueba el OLD y el NEW.
HASH_SEED="$(php -r 'echo password_hash("PasswordVieja1", PASSWORD_BCRYPT);')"
$MYSQL "$DB" -e "
INSERT INTO stores (store_id, store_name) VALUES (1, 'ZZ P0-4');
INSERT INTO users (store_id, username, password_hash, full_name, email, role, status) VALUES
  (1, 'zz_reset_a', '$HASH_SEED', 'ZZ Reset A', 'zz-reset-a@ejemplo.test', 'admin', 'active'),
  (1, 'zz_reset_existe', '$HASH_SEED', 'ZZ Reset Existe', 'zz-reset-existe@ejemplo.test', 'admin', 'active'),
  (1, 'zz_reset_php', '$HASH_SEED', 'ZZ Reset PHP', 'zz-reset-php@ejemplo.test', 'admin', 'active');
" || { echo "no se pudo sembrar" >&2; exit 2; }

# ---- copia desechable: el código REAL del repo (incluye/ completo + api/auth) ----
for D in "$INST" "$INST_B"; do
  mkdir -p "$D/api/auth" "$D/config"
  cp -r "$REPO/includes/." "$D/includes/"
  cp "$REPO/api/auth/forgot_password.php" "$REPO/api/auth/reset_password.php" "$D/api/auth/"
  cp "$REPO/config/constants.php" "$D/config/"
done
# Doble de Mail (sólo en la copia): captura el enlace que se habría enviado. Sin
# `vendor/` ni PHPMailer, el endpoint real no podría ni construirse aquí.
for D in "$INST" "$INST_B"; do
  cat > "$D/includes/Mail.class.php" <<'PHP'
<?php
/**
 * DOBLE DE PRUEBA — NO ES PARTE DEL REPO.
 * Vive sólo en la copia desechable que arma docker/verify_password_reset_nodocker.sh
 * para capturar el enlace que el endpoint habría enviado, sin SMTP.
 */
class Mail {
    public function sendPasswordResetEmail($toEmail, $toName, $resetLink) {
        $destino = getenv('MAIL_CAPTURE_FILE') ?: '/dev/null';
        file_put_contents($destino, $toEmail . "\t" . $resetLink . "\n", FILE_APPEND);
        return true;
    }
}
PHP
  cat > "$D/config/database.php" <<PHP
<?php
// Copia desechable: apunta a la base efímera de esta corrida ($DB) en el rig real.
define('DB_HOST', '${MARIADB_HOST};port=${MARIADB_PORT}');
define('DB_NAME', '${DB}');
define('DB_USER', '${DB_USER}');
define('DB_PASS', '${DB_PASS}');
define('DB_CHARSET', 'utf8mb4');

// Igual que docker/entrypoint.sh con el contenedor: la app va en hora de México.
// Es una de las dos mitades del defecto (la otra es la BD en UTC).
date_default_timezone_set('America/Mexico_City');

define('DEBUG_MODE', false);
define('APP_VERSION', 'community-edition');
PHP
done

# La versión del endpoint que se mide: la del repo, salvo override explícito.
if [ -n "${ENDPOINT_OVERRIDE:-}" ]; then
  echo "INFO | ENDPOINT_OVERRIDE=$ENDPOINT_OVERRIDE (la puerta mide ESA copia)"
  cp "$ENDPOINT_OVERRIDE" "$INST/api/auth/forgot_password.php"
  cp "$ENDPOINT_OVERRIDE" "$INST_B/api/auth/forgot_password.php"
else
  ENDPOINT_OVERRIDE=""
fi

NONCE="identidad-$(date +%s)-$RANDOM"
printf '%s\n' "$NONCE" > "$INST/identidad.txt"
printf '%s\n' "$NONCE" > "$INST_B/identidad.txt"

PHP_LOCAL="$(php -d date.timezone=America/Mexico_City -r 'echo date("Y-m-d H:i:s");')"
PORT_A="$(puerto_libre 18300)" || { echo "sin puerto libre" >&2; exit 2; }
PORT_B="$(puerto_libre 18400)" || { echo "sin puerto libre" >&2; exit 2; }
LOG_A="$SCR/php_appurl.log"; LOG_B="$SCR/php_sin_appurl.log"

echo "===== 0. Instancias desechables ($APP_URL_BUENA / APP_URL vacía) ====="
if arrancar "$INST" "$PORT_A" "$APP_URL_BUENA" "$LOG_A"; then
  ok "instancia A arriba en 127.0.0.1:$PORT_A y con la identidad de ESTA corrida"
else
  mal "la instancia A no responde; revisar $LOG_A"; cat "$LOG_A"; exit 1
fi
if arrancar "$INST_B" "$PORT_B" VACIO "$LOG_B"; then
  ok "instancia B (APP_URL vacía) arriba en 127.0.0.1:$PORT_B y con identidad propia"
else
  mal "la instancia B no responde; revisar $LOG_B"; cat "$LOG_B"; exit 1
fi
echo "INFO | relojes: app en America/Mexico_City = $PHP_LOCAL  |  MaríaDB NOW() = $(q 'SELECT NOW()')  |  UTC_TIMESTAMP() = $(q 'SELECT UTC_TIMESTAMP()')"
# El escenario tiene que ser el del contenedor: si la BD NO está en UTC o el
# desfase no es el de México, la evidencia de abajo mediría otra cosa.
comprobar "la BD mide en UTC (NOW() == UTC_TIMESTAMP())" 0 \
  "$(q 'SELECT TIMESTAMPDIFF(MINUTE, NOW(), UTC_TIMESTAMP())')"
DESFASE="$(q "SELECT TIMESTAMPDIFF(MINUTE, NOW(), '$PHP_LOCAL')")"
comprobar "el reloj de la app va 360 min por detrás de NOW() (México vs UTC)" -360 "$DESFASE"

echo
echo "===== 1. Guardarraíles estáticos (lo que el endpoint NO debe volver a hacer) ====="
comprobar "forgot_password.php ya no calcula tiempo en PHP (sin strtotime en código)" 0 \
  "$(codigo "$INST/api/auth/forgot_password.php" 'strtotime')"
comprobar "forgot_password.php calcula la caducidad en SQL (DATE_ADD(NOW(), INTERVAL 1 HOUR))" 1 \
  "$(codigo "$INST/api/auth/forgot_password.php" 'DATE_ADD(NOW(), INTERVAL 1 HOUR)')"
comprobar "forgot_password.php no arma la base con HTTP_HOST en código" 0 \
  "$(codigo "$INST/api/auth/forgot_password.php" 'HTTP_HOST')"
comprobar "forgot_password.php usa UrlHelper::base() en código" 1 \
  "$(codigo "$INST/api/auth/forgot_password.php" 'UrlHelper::base()')"
comprobar "APP_URL documentada en .env.example" 1 \
  "$(grep -c '^APP_URL=' "$REPO/.env.example" || true)"

echo
echo "===== 2. Criterio 1: un token recién emitido VALIDA (contenedor en México, BD en UTC) ====="
rm -f "$CAPTURA"; : > "$CAPTURA"
CODIGO="$(pedir "$PORT_A" api/auth/forgot_password.php '{"email":"zz-reset-a@ejemplo.test"}' evil.com)"
comprobar "forgot_password → 200" 200 "$CODIGO"
comprobar "respuesta success=true" true "$(jget success < "$BODY")"
FILA="$(q "SELECT reset_token_hash, reset_token_expires_at FROM users WHERE email='zz-reset-a@ejemplo.test'")"
echo "INFO | fila: $FILA"
VIGENTE="$(q "SELECT (reset_token_expires_at > NOW()) FROM users WHERE email='zz-reset-a@ejemplo.test'")"
comprobar "reset_token_expires_at > NOW() (la BD la ve vigente)" 1 "$VIGENTE"
SEG="$(q "SELECT TIMESTAMPDIFF(SECOND, NOW(), reset_token_expires_at) FROM users WHERE email='zz-reset-a@ejemplo.test'")"
if [ "$SEG" -gt 3500 ] && [ "$SEG" -le 3600 ]; then
  ok "caduca en $SEG s (≈1 h desde NOW() de la BD, no 6 h de desfase)"
else
  mal "caduca en $SEG s: no son los ~3600 s esperados desde NOW()"
fi
ENLACE="$(cut -f2 "$CAPTURA" | head -1)"
TOKEN="$(printf '%s' "$ENLACE" | python3 -c "
import re,sys
m = re.search(r'token=([0-9a-f]{64})', sys.stdin.read())
print(m.group(1) if m else '')")"
comprobar "el enlace capturado trae un token de 64 hex" 64 "${#TOKEN}"
comprobar "la BD guarda sha256(token), no el token" "$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)" \
  "$(q "SELECT reset_token_hash FROM users WHERE email='zz-reset-a@ejemplo.test'")"

CODIGO="$(pedir "$PORT_A" api/auth/reset_password.php "{\"token\":\"$TOKEN\",\"password\":\"PasswordNueva2\"}")"
comprobar "reset_password con el token en claro → 200" 200 "$CODIGO"
comprobar "respuesta success=true" true "$(jget success < "$BODY")"
contiene "mensaje de contraseña actualizada (NO «inválido o ha expirado»)" \
  "$(jget message < "$BODY")" "Contraseña actualizada correctamente"
no_contiene "el mensaje no es el de token caducado" "$(jget message < "$BODY")" "inválido o ha expirado"
comprobar "la contraseña nueva verifica contra el hash guardado" true \
  "$(php -r 'echo (password_verify("PasswordNueva2", $argv[1]) ? "true" : "false");' \
      "$(q "SELECT password_hash FROM users WHERE email='zz-reset-a@ejemplo.test'")")"
comprobar "el token quedó limpio tras usarlo" "NULL" \
  "$(q "SELECT IFNULL(reset_token_hash,'NULL') FROM users WHERE email='zz-reset-a@ejemplo.test'")"

echo
echo "===== 3. Criterio 2: con Host: evil.com el enlace NO es del atacante ====="
echo "INFO | valor que se habría enviado: $ENLACE"
no_contiene "el enlace no contiene evil.com" "$ENLACE" "evil.com"
contiene "el enlace empieza por APP_URL" "$ENLACE" "$APP_URL_BUENA/public/reset_password.html?token="
comprobar "el enlace no usa esquema http:// (APP_URL es https)" 1 \
  "$(case "$ENLACE" in https://*) echo 1;; *) echo 0;; esac)"

echo
echo "===== 4. Criterio 3: con APP_URL vacía no hay correo, ni token, ni diferencia ====="
rm -f "$CAPTURA"; : > "$CAPTURA"
COD_E="$(pedir "$PORT_B" api/auth/forgot_password.php '{"email":"zz-reset-existe@ejemplo.test"}')"
cp "$BODY" "$BODY_B"
COD_N="$(pedir "$PORT_B" api/auth/forgot_password.php '{"email":"zz-no-existe@ejemplo.test"}')"
comprobar "correo existente → 500 (error de configuración)" 500 "$COD_E"
comprobar "correo inexistente → 500" 500 "$COD_N"
comprobar "mismo código HTTP en ambos casos" "$COD_E" "$COD_N"
if cmp -s "$BODY_B" "$BODY"; then ok "la respuesta es byte a byte la misma (sin enumeración)"; else mal "las respuestas difieren: $(cat "$BODY_B") vs $(cat "$BODY")"; fi
comprobar "success=false" false "$(jget success < "$BODY")"
comprobar "error.code=app_url_missing" app_url_missing "$(jget error.code < "$BODY")"
comprobar "no se envió correo (captura vacía)" 0 "$(wc -c < "$CAPTURA" | tr -d ' ')"
comprobar "no se emitió token (reset_token_hash NULL)" "NULL" \
  "$(q "SELECT IFNULL(reset_token_hash,'NULL') FROM users WHERE email='zz-reset-existe@ejemplo.test'")"
LOG_APPURL="$(grep -c 'APP_URL no está definida' "$LOG_B" || true)"
if [ "$LOG_APPURL" -ge 1 ]; then
  ok "quedó registro con RequestContext::error ($LOG_APPURL veces, una por petición)"
else
  mal "el endpoint no registró la configuración incompleta con RequestContext::error"
fi
if grep -q 'req=' "$LOG_B"; then ok "el log trae el contexto de la petición (req=… route=…)"; else mal "el log no trae el contexto de RequestContext"; fi

echo
echo "===== 5. Regresión no-vacua: el valor temporal de la versión ANTERIOR sí nace caducado ====="
TOKEN5="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
EXP_PHP="$(php -d date.timezone=America/Mexico_City -r 'echo date("Y-m-d H:i:s", strtotime("+1 hour"));')"
$MYSQL "$DB" -e "UPDATE users SET reset_token_hash='$(printf '%s' "$TOKEN5" | sha256sum | cut -d' ' -f1)', reset_token_expires_at='$EXP_PHP' WHERE email='zz-reset-php@ejemplo.test';"
echo "INFO | PHP (México) guardaba $EXP_PHP ; MaríaDB NOW() = $(q 'SELECT NOW()')"
comprobar "ese valor NO supera a NOW() de la BD" 0 \
  "$(q "SELECT (reset_token_expires_at > NOW()) FROM users WHERE email='zz-reset-php@ejemplo.test'")"
CODIGO="$(pedir "$PORT_A" api/auth/reset_password.php "{\"token\":\"$TOKEN5\",\"password\":\"PasswordNueva3\"}")"
comprobar "y reset_password lo rechaza con 400 (el bug original, reproducido)" 400 "$CODIGO"
contiene "con el mensaje «inválido o ha expirado»" "$(jget message < "$BODY")" "inválido o ha expirado"

echo
$MYSQL -e "DROP DATABASE IF EXISTS \`${DB}\`;" 2>/dev/null
echo "===== RESULTADO: $PASS en verde, $FAIL en rojo ====="
exit $(( FAIL > 0 ? 1 : 0 ))

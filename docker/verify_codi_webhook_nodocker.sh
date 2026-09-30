#!/usr/bin/env bash
# Puerta de verificación de la FIRMA del webhook de CoDi (TAB-57 / punto P0-1 de TAB-25)
# SIN Docker.
#
# POR QUÉ EXISTE
# El hallazgo P0-1 es una ruta de dinero: un POST anónimo (sin sesión, sin token,
# sin firma) marcaba un pago CoDi como `paid`. El arreglo es la firma HMAC-SHA256
# del CUERPO CRUDO con el `webhook_secret` de la tienda (fail closed). Esta puerta
# reproduce los criterios de aceptación del issue sobre binarios reales, sin
# contenedor: MariaDB 10.11 real + HTTP real (`php -S`) + `curl` real, sobre una
# COPIA desechable del repo.
#
#   A. POST anónimo SIN firma ⇒ 401 y `codi_payments.status` intacto (y sin filas
#      nuevas en `codi_payment_events`). Se mide ANTES y DESPUÉS por SQL.
#   B. Firma calculada sobre `json_encode(json_decode($body))` ⇒ 401 (no se
#      re-serializa: el byte-string firmado es el que llegó).
#   C. Firma correcta sobre el cuerpo crudo ⇒ 200 y el pago pasa a `paid`.
#   D. Firma SÓLO dentro del payload (sin header) ⇒ 401 (el payload no autentica).
#   E. `webhook_secret` vacío/NULL ⇒ 401 aunque la firma venga y "peine".
#   F. CoDi deshabilitado ⇒ 403 (`enabled=0`) y nada se marca.
#   G. Coherencia de tienda: firma legítima de la tienda A sobre un folio de la
#      tienda B ⇒ 403 y el pago ajeno no cambia.
#   H. Folio inexistente con firma correcta ⇒ 200 con aviso (comportamiento que
#      NO cambia: no se convierte en un oráculo de folios).
#   I. Reenvío del MISMO evento ⇒ 200 y sin reprocesar (idempotencia).
#   J. `grep` del código: el camino de secreto vacío no puede tener `return true`.
#
# LO QUE ESTA PUERTA NO CUBRE (hace falta Docker/contenedor; lo verifica QA en la
# instancia desechable): nginx→php-fpm delante del endpoint, TLS, y que la imagen
# publique el arreglo.
#
# Uso:
#   MARIADB_BIN=/ruta/con/bin bash docker/verify_codi_webhook_nodocker.sh [dir_desechable]
# Variables: MARIADB_BIN (obligatoria: directorio con el cliente `mysql`),
#            MARIADB_HOST (127.0.0.1), MARIADB_PORT (13306),
#            MARIADB_USER (tomodachi), MARIADB_PASS (tomodachi_secret)
# La puerta crea y BORRA su propia base (`tab25_x1_gate_$$`): el rig de MariaDB es
# compartido entre corridas y con un nombre fijo dos corridas se pisan.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCR="${1:-$(mktemp -d)}"
INST="$SCR/inst"
RUN="$$"
DB="tab25_x1_gate_${RUN}"

MARIADB_BIN="${MARIADB_BIN:?falta MARIADB_BIN (directorio con el cliente `mysql` de MariaDB 10.11)}"
MARIADB_HOST="${MARIADB_HOST:-127.0.0.1}"
MARIADB_PORT="${MARIADB_PORT:-13306}"
DB_USER="${MARIADB_USER:-tomodachi}"
DB_PASS="${MARIADB_PASS:-tomodachi_secret}"
MYSQL="$MARIADB_BIN/mysql -h${MARIADB_HOST} -P${MARIADB_PORT} -u${DB_USER} -p${DB_PASS} --skip-ssl --default-character-set=utf8mb4"

S1='SECRETO-TIENDA-1'
S2='SECRETO-TIENDA-2'
S3='SECRETO-TIENDA-3'

PASS=0; FAIL=0
ok(){ echo "PASS | $1"; PASS=$((PASS+1)); }
mal(){ echo "FAIL | $1"; FAIL=$((FAIL+1)); }

jget(){ python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d={}
for k in '$1'.split('.'):
    d = (d or {}).get(k) if isinstance(d, dict) else None
print('' if d is None else d)"; }

estado(){ $MYSQL "$DB" -N -B -e "SELECT status FROM codi_payments WHERE folio_codi='$1'"; }
eventos(){ $MYSQL "$DB" -N -B -e "SELECT COUNT(*) FROM codi_payment_events WHERE codi_payment_id=(SELECT payment_id FROM codi_payments WHERE folio_codi='$1')"; }
hmac(){ php -r 'echo hash_hmac("sha256", file_get_contents($argv[1]), $argv[2]);' "$1" "$2"; }

# ---------- instancia desechable (copia del árbol de trabajo) ----------
rm -rf "$INST"; mkdir -p "$INST" "$SCR/sessions"
# Sólo archivos versionados (el arreglo entra desde el working tree, y no se
# arrastran restos de otras corridas que compartan el checkout).
(cd "$REPO" && git ls-files -z | tar --null -T - -cf -) | tar -xf - -C "$INST"
cat > "$INST/config/database.php" <<PHP
<?php
define('DB_HOST', '${MARIADB_HOST};port=${MARIADB_PORT}');
define('DB_NAME', '$DB');
define('DB_USER', '$DB_USER');
define('DB_PASS', '$DB_PASS');
define('DB_CHARSET', 'utf8mb4');
define('DEBUG_MODE', false);
define('APP_VERSION', 'community-edition');
PHP

PIDS=""; BODY="$SCR/body.json"
cleanup(){ for p in $PIDS; do kill "$p" 2>/dev/null; done; $MYSQL -e "DROP DATABASE IF EXISTS $DB" 2>/dev/null; }
trap cleanup EXIT

$MYSQL -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
$MYSQL "$DB" < "$REPO/database/schema.sql" || { echo "FAIL | no se pudo cargar database/schema.sql"; exit 1; }

# Semilla: 4 tiendas con combinaciones distintas de `enabled`/`webhook_secret`.
$MYSQL "$DB" <<SQL
INSERT INTO stores (store_name, status) VALUES
  ('Tienda 2', 'active'), ('Tienda 3 CoDi apagado', 'active'), ('Tienda 4 sin secreto', 'active');
INSERT INTO codi_settings (store_id, enabled, environment, webhook_secret) VALUES
  (1, 1, 'sandbox', '$S1'),
  (2, 1, 'sandbox', '$S2'),
  (3, 0, 'sandbox', '$S3'),
  (4, 1, 'sandbox', NULL);
INSERT INTO codi_payments (store_id, user_id, amount, concept, folio_codi, payment_method, status) VALUES
  (1, 1, 100.00, 'A sin firma',    'CODI-T1-SINFIRMA', 'qr', 'pending'),
  (1, 1, 100.00, 'B re-serial',    'CODI-T1-RESERIAL', 'qr', 'pending'),
  (1, 1, 100.00, 'C firma ok',     'CODI-T1-OK',       'qr', 'pending'),
  (1, 1, 100.00, 'D firma payload','CODI-T1-PAYLOAD',  'qr', 'pending'),
  (1, 1, 100.00, 'G folio ajeno',  'CODI-T1-AJENO',    'qr', 'pending'),
  (2, 1, 100.00, 'sanity tienda 2','CODI-T2-OK',       'qr', 'pending'),
  (3, 1, 100.00, 'F CoDi apagado', 'CODI-T3-APAGADO',  'qr', 'pending'),
  (4, 1, 100.00, 'E sin secreto',  'CODI-T4-VACIO',    'qr', 'pending');
SQL

PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
php -d session.save_path="$SCR/sessions" -S "127.0.0.1:$PORT" -t "$INST" > "$SCR/php.log" 2>&1 &
PIDS="$PIDS $!"
URL="http://127.0.0.1:$PORT/api/codi/webhook.php"

echo "===== 0. Instancia desechable ====="
echo "repo: $REPO @ $(cd "$REPO" && git rev-parse --short HEAD) (árbol de trabajo)"
echo "copia: $INST   puerto: $PORT   base: $DB"
for i in $(seq 1 40); do
  curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/health/live.php" && break
  sleep 0.25
done
c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/api/health/live.php")
if [ "$c" = 200 ] && grep -q 'api/health/live.php' "$SCR/php.log"; then
  ok "el servidor que contesta es el MÍO (live.php=$c y la petición está en $SCR/php.log)"
else
  mal "identidad del servidor dudosa (live.php=$c): revisar $SCR/php.log"; exit 1
fi

echo
echo "===== Estado de la BD ANTES (SQL) ====="
$MYSQL "$DB" -e "SELECT payment_id, store_id, folio_codi, status FROM codi_payments ORDER BY payment_id;"

# Uso: caso <folio> <store_id> <cuerpo> <firma|""> [header de firma alternativo]
caso(){
  local folio="$1" store="$2" raw="$3" sig="$4" hdr="${5:-X-Webhook-Signature}"
  printf '%s' "$raw" > "$SCR/raw.json"
  local args=(-s -o "$BODY" -w '%{http_code}' --max-time 8 -X POST "$URL"
    -H 'Content-Type: application/json' -H 'X-Store-Case: '"$folio")
  [ -n "$sig" ] && args+=(-H "$hdr: $sig")
  args+=(--data-binary @"$SCR/raw.json")
  curl "${args[@]}"
}

echo
echo "===== A. Sin firma ⇒ 401 y estado intacto ====="
antes=$(estado CODI-T1-SINFIRMA)
code=$(caso CODI-T1-SINFIRMA 1 '{"store_id":1,"folio_codi":"CODI-T1-SINFIRMA","event_type":"paid"}' '')
despues=$(estado CODI-T1-SINFIRMA)
msg=$(jget message < "$BODY"); ev=$(eventos CODI-T1-SINFIRMA)
echo "INFO | HTTP $code body=$(cat "$BODY")"
if [ "$code" = 401 ] && [ "$msg" = 'Firma de webhook inválida' ]; then
  ok "POST anónimo sin firma → 401 «$msg»"
else
  mal "sin firma: code=$code msg=$msg"
fi
if [ "$antes" = pending ] && [ "$despues" = pending ]; then
  ok "codi_payments.status sin cambio por SQL: $antes → $despues"
else
  mal "el status cambió: $antes → $despues"
fi
if [ "$ev" = 0 ]; then ok "sin filas nuevas en codi_payment_events (no se tocó estado)"; else mal "se insertaron $ev eventos"; fi

echo
echo "===== B. Firma sobre json_encode(json_decode(body)) ⇒ 401 ====="
RAW='{ "store_id": 1, "folio_codi": "CODI-T1-RESERIAL", "event_type": "paid" }'
printf '%s' "$RAW" > "$SCR/raw.json"
RESER=$(php -r '$d=json_decode(file_get_contents($argv[1]),true); echo json_encode($d);' "$SCR/raw.json")
echo "INFO | crudo   : $RAW"
echo "INFO | reserial: $RESER"
sig=$(hmac "$SCR/raw.json" "$S1"); printf '%s' "$RESER" > "$SCR/reser.json"
sigre=$(hmac "$SCR/reser.json" "$S1")
if [ "$sig" = "$sigre" ]; then mal "el fixture no distingue crudo de re-serializado"; fi
code=$(caso CODI-T1-RESERIAL 1 "$RAW" "$sigre")
echo "INFO | HTTP $code body=$(cat "$BODY")"
if [ "$code" = 401 ] && [ "$(estado CODI-T1-RESERIAL)" = pending ]; then ok "firma del re-serializado → 401 y sigue pending"; else mal "re-serializado: code=$code status=$(estado CODI-T1-RESERIAL)"; fi

echo
echo "===== C. Firma correcta sobre el cuerpo crudo ⇒ 200 y paid ====="
RAW='{"store_id":1,"folio_codi":"CODI-T1-OK","event_type":"paid","event_id":"evt-tab57-c"}'
printf '%s' "$RAW" > "$SCR/raw.json"
sig=$(hmac "$SCR/raw.json" "$S1")
code=$(caso CODI-T1-OK 1 "$RAW" "$sig")
echo "INFO | HTTP $code body=$(cat "$BODY")"
if [ "$code" = 200 ] && [ "$(jget data.processed < "$BODY")" = True ]; then
  ok "firma correcta → 200 {processed:true}"
else
  mal "firma correcta: code=$code body=$(cat "$BODY")"
fi
if [ "$(estado CODI-T1-OK)" = paid ]; then ok "el pago cambia de estado igual que antes: pending → paid"; else mal "el pago no quedó paid ($(estado CODI-T1-OK))"; fi

echo
echo "===== D. Firma SÓLO en el payload ⇒ 401 (el payload no autentica) ====="
RAW='{"store_id":1,"folio_codi":"CODI-T1-PAYLOAD","event_type":"paid"}'
printf '%s' "$RAW" > "$SCR/raw.json"
sig=$(hmac "$SCR/raw.json" "$S1")
PAY=$(python3 - "$RAW" "$sig" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); d['signature']=sys.argv[2]; print(json.dumps(d))
PY
)
code=$(caso CODI-T1-PAYLOAD 1 "$PAY" '')
echo "INFO | HTTP $code body=$(cat "$BODY")"
if [ "$code" = 401 ] && [ "$(estado CODI-T1-PAYLOAD)" = pending ]; then ok "firma dentro del payload → 401 y sigue pending"; else mal "firma en payload: code=$code status=$(estado CODI-T1-PAYLOAD)"; fi

echo
echo "===== E. webhook_secret vacío/NULL ⇒ 401 (fail closed) ====="
RAW='{"store_id":4,"folio_codi":"CODI-T4-VACIO","event_type":"paid"}'
printf '%s' "$RAW" > "$SCR/raw.json"
sig=$(hmac "$SCR/raw.json" 'lo-que-sea')
code=$(caso CODI-T4-VACIO 4 "$RAW" "$sig")
echo "INFO | HTTP $code body=$(cat "$BODY")"
if [ "$code" = 401 ] && [ "$(estado CODI-T4-VACIO)" = pending ]; then ok "sin secreto configurado → 401 aunque venga firma"; else mal "secreto vacío: code=$code status=$(estado CODI-T4-VACIO)"; fi
echo "INFO | secretos en la BD (SQL): $($MYSQL "$DB" -N -B -e "SELECT store_id, IFNULL(webhook_secret,'<NULL>') FROM codi_settings ORDER BY store_id" | tr '\n' ' ')"

echo
echo "===== F. CoDi deshabilitado ⇒ no procesa ====="
RAW='{"store_id":3,"folio_codi":"CODI-T3-APAGADO","event_type":"paid"}'
printf '%s' "$RAW" > "$SCR/raw.json"
sig=$(hmac "$SCR/raw.json" "$S3")
code=$(caso CODI-T3-APAGADO 3 "$RAW" "$sig")
echo "INFO | HTTP $code body=$(cat "$BODY")"
if [ "$code" = 403 ] && [ "$(estado CODI-T3-APAGADO)" = pending ] && [ "$(eventos CODI-T3-APAGADO)" = 0 ]; then
  ok "CoDi apagado (enabled=0) → 403 y el pago NO se marca"
else
  mal "CoDi apagado: code=$code status=$(estado CODI-T3-APAGADO) eventos=$(eventos CODI-T3-APAGADO)"
fi

echo
echo "===== G. Coherencia de tienda: firma de la tienda 2 sobre folio de la 1 ⇒ 403 ====="
RAW='{"store_id":2,"folio_codi":"CODI-T1-AJENO","event_type":"paid"}'
printf '%s' "$RAW" > "$SCR/raw.json"
sig=$(hmac "$SCR/raw.json" "$S2")
code=$(caso CODI-T1-AJENO 2 "$RAW" "$sig")
echo "INFO | HTTP $code body=$(cat "$BODY")"
if [ "$code" = 403 ] && [ "$(estado CODI-T1-AJENO)" = pending ]; then
  ok "folio de otra tienda → 403 y el pago ajeno no cambia"
else
  mal "coherencia de tienda: code=$code status=$(estado CODI-T1-AJENO)"
fi
if grep -q 'el folio no pertenece a la tienda del webhook' "$SCR/php.log"; then
  ok "el rechazo quedó en el log con RequestContext (store_id y dueño, sin payload)"
else
  mal "el rechazo por tienda no se registró en el log"
fi

echo
echo "===== Sanity: la tienda 2 con SU firma procesa su propio folio ====="
RAW='{"store_id":2,"folio_codi":"CODI-T2-OK","event_type":"paid","event_id":"evt-tab57-s2"}'
printf '%s' "$RAW" > "$SCR/raw.json"
sig=$(hmac "$SCR/raw.json" "$S2")
code=$(caso CODI-T2-OK 2 "$RAW" "$sig")
if [ "$code" = 200 ] && [ "$(estado CODI-T2-OK)" = paid ]; then ok "tienda 2: firma con su secreto → 200 y paid"; else mal "tienda 2: code=$code status=$(estado CODI-T2-OK)"; fi

echo
echo "===== H. Folio inexistente con firma correcta ⇒ 200 con aviso (sin cambio) ====="
RAW='{"store_id":1,"folio_codi":"CODI-T1-NADA","event_type":"paid"}'
printf '%s' "$RAW" > "$SCR/raw.json"
sig=$(hmac "$SCR/raw.json" "$S1")
code=$(caso CODI-T1-NADA 1 "$RAW" "$sig")
w=$(jget data.warning < "$BODY")
echo "INFO | HTTP $code body=$(cat "$BODY")"
if [ "$code" = 200 ] && [ -n "$w" ]; then ok "folio inexistente → 200 con aviso «$w» (no es oráculo de folios)"; else mal "folio inexistente: code=$code body=$(cat "$BODY")"; fi

echo
echo "===== I. Reenvío del MISMO evento ⇒ 200 sin reprocesar ====="
ev_antes=$(eventos CODI-T1-OK)
# Se reenvía exactamente el cuerpo del caso C (mismo provider_event_id).
RAW_C='{"store_id":1,"folio_codi":"CODI-T1-OK","event_type":"paid","event_id":"evt-tab57-c"}'
printf '%s' "$RAW_C" > "$SCR/raw.json"
sig_c=$(hmac "$SCR/raw.json" "$S1")
code=$(caso CODI-T1-OK 1 "$RAW_C" "$sig_c")
ev_despues=$(eventos CODI-T1-OK)
echo "INFO | HTTP $code body=$(cat "$BODY")  eventos: $ev_antes → $ev_despues"
if [ "$code" = 200 ] && [ "$ev_antes" = "$ev_despues" ] && [ "$(estado CODI-T1-OK)" = paid ]; then
  ok "reenvío del mismo provider_event_id ⇒ 200 y sin evento duplicado"
else
  mal "reenvío: code=$code eventos $ev_antes→$ev_despues status=$(estado CODI-T1-OK)"
fi

echo
echo "===== J. grep: sin el atajo fail-open en el camino de la firma ====="
n=$(sed -n '/public function getWebhookSecret/,/^    }/p;/private function validateWebhookSignature/,/^    }/p' \
    "$REPO/codi/includes/CodiService.class.php" | grep -c 'return true')
if [ "$n" = 0 ]; then ok "0 ocurrencias de «return true» en getWebhookSecret/validateWebhookSignature"; else mal "$n ocurrencias de «return true» (fail open)"; fi
if grep -q 'file_get_contents(.php://input.)' "$REPO/codi/includes/CodiService.class.php"; then ok "el servicio documenta/lee el cuerpo crudo (php://input)"; else mal "no se ve php://input en el servicio"; fi
if grep -q 'HTTP_X_WEBHOOK_SIGNATURE' "$REPO/api/codi/webhook.php" && ! grep -q "payload\['signature'\]" "$REPO/api/codi/webhook.php"; then
  ok "webhook.php: firma del header X-Webhook-Signature y NO del payload"
else
  mal "webhook.php sigue mirando la firma del payload"
fi

echo
echo "===== Estado de la BD DESPUÉS (SQL) ====="
$MYSQL "$DB" -e "SELECT p.payment_id, p.store_id, p.folio_codi, p.status, (SELECT COUNT(*) FROM codi_payment_events e WHERE e.codi_payment_id=p.payment_id) AS eventos FROM codi_payments p ORDER BY p.payment_id;"

echo
echo "===== RESULTADO: $PASS en verde, $FAIL en rojo ====="
exit $(( FAIL > 0 ? 1 : 0 ))

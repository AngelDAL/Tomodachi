#!/usr/bin/env bash
# Puerta de verificación de MIGRACIONES (TAB-39) SIN Docker.
#
# POR QUÉ EXISTE
# Los criterios de aceptación de TAB-39 hablan de "instancia desechable" y "el
# contenedor arranca", pero el espacio de trabajo del agente no alcanza el socket
# de Docker (`/var/run/docker.sock` es root:docker y `sudo` está bloqueado), así
# que aquí se reproduce lo que SÍ es verificable sin contenedor, con binarios
# reales:
#
#   - un MariaDB 10.11 REAL (el mismo major que la imagen `mariadb:10.11`), en un
#     directorio de datos desechable y un puerto local;
#   - la MISMA fase de migraciones que corre el contenedor: `docker/migrations.sh`
#     se carga y se ejercita tal cual (no hay copia del código en este script);
#   - el endpoint real `api/health/ready.php` por HTTP real (`php -S`), contra esa
#     base, en una COPIA desechable del repo.
#
# Criterios cubiertos (los numerados son los del issue)
#   1. migración inválida nueva (`999_test_falla.sql`) → la fase NO aborta y queda
#      UNA fila `status='failed'` con `error_text` (y el resto sigue su curso).
#   2. `ready.php` → 200 `degraded` con `migrations_failed.failed == 1`.
#   3. arreglado el SQL + re-arranque → `status='applied'`, `error_text` NULL,
#      `ready.php` → 200 `ok`, y lo ya aplicado sigue en `[skip]`.
#   4. `grep -c 'INSERT IGNORE INTO schema_migrations' docker/entrypoint.sh` → 0
#      (y tampoco quedan `INSERT IGNORE` en `docker/migrations.sh`).
#   5. la migración de columnas (048) ejecutada dos veces no falla.
#   6. nada temporal calculado en PHP (el sello de tiempo lo pone `NOW()` de SQL) y
#      el camino de dinero no se toca.
#   Además: reintento acotado a MIGRATION_MAX_ATTEMPTS, `docker/schema_status.sh`,
#   el caso `not_ready` (migración pendiente) y la tabla de control nueva.
#
# Guardarraíles de los hallazgos del veredicto de TAB-47 (secciones 7 y 8, y 0.a-bis):
#   H2  `error_text` empieza por el `ERROR …` del cliente también cuando la sentencia
#       es larga (el cliente la ecoa antes del error y se comía el diagnóstico).
#   H3  la clasificación no depende de que el llamador haya corrido
#       `migrations_ensure_columns`: sin eso, una que FALLA quedaba como `applied`.
#   R1  el índice de `status` lo crean las DOS cohortes (arranque y 048).
#
# LO QUE ESTA PUERTA NO PUEDE PROBAR (hace falta Docker, lo verifica QA en la
# instancia desechable): que la imagen arranque (`docker compose up`), el
# HEALTHCHECK de `docker inspect`, y el `exec supervisord` del final.
#
# Uso:
#   MARIADB_BIN=/ruta/con/bin bash docker/verify_migrations_nodocker.sh [dir_desechable]
# Variables: MARIADB_BIN (obligatoria, contiene `mysql`), MARIADB_HOST (127.0.0.1),
#            MARIADB_PORT (13306), MARIADB_USER (tomodachi), MARIADB_PASS (tomodachi_secret)
# La puerta crea y BORRA sus propias bases desechables en cada corrida: el usuario
# necesita permiso para crear/escribir bases (el rig de TAB-39 se prepara con
# `provision.sh`, adjunto al issue).
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCR="${1:-$(mktemp -d)}"
# Nombres de base POR CORRIDA: el rig de MariaDB es compartido (varios agentes a la
# vez) y con nombres fijos dos corridas de esta puerta se pisan — una DROP/CREATE
# mientras la otra mide. Se veía como fallidas de migraciones reales (filas
# `Duplicate column name`) y como un [retry] en la PRIMERA corrida: era la BD de otro
# run. Es la misma clase de fallo que el puerto fijo de `php -S` (más abajo).
RUN="$$"
DB="tomodachi_pos_tab39_${RUN}"
DB048="tomodachi_pos_tab39_048_${RUN}"
# Base aparte para el camino del ARRANQUE (tabla de control + columnas): así la
# aserción del índice de la 048 (sección 5) sigue midiendo la 048 y no el arranque.
DB_FRESCA="tomodachi_pos_tab39_fresca_${RUN}"

MARIADB_BIN="${MARIADB_BIN:?falta MARIADB_BIN (directorio con el cliente `mysql` de MariaDB 10.11)}"
MARIADB_HOST="${MARIADB_HOST:-127.0.0.1}"
MARIADB_PORT="${MARIADB_PORT:-13306}"
DB_USER="${MARIADB_USER:-tomodachi}"
DB_PASS="${MARIADB_PASS:-tomodachi_secret}"

MYSQL="$MARIADB_BIN/mysql -h${MARIADB_HOST} -P${MARIADB_PORT} -u${DB_USER} -p${DB_PASS} --skip-ssl --default-character-set=utf8mb4"
DB_NAME="$DB"
MIGRATIONS_DIR="$SCR/migrations"
MIGRATION_MAX_ATTEMPTS=3
SCHEMA_SQL="$REPO/database/schema.sql"

mkdir -p "$SCR"
# El directorio desechable se REUSA entre corridas para conservar la evidencia, pero
# sus subdirectorios de trabajo no: restos de una corrida anterior (una 999 ya
# "arreglada", por ejemplo) se registrarían como baseline y la puerta mediría otra
# cosa. Se limpian siempre.
rm -rf "$SCR/migrations" "$SCR/inst"
mkdir -p "$SCR/migrations"

PASS=0; FAIL=0
ok(){ echo "PASS | $1"; PASS=$((PASS + 1)); }
mal(){ echo "FAIL | $1"; FAIL=$((FAIL + 1)); }
comprobar(){ # comprobar <descripción> <esperado> <obtenido>
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else mal "$1 — esperado [$2], obtenido [$3]"; fi
}
contiene(){ # contiene <descripción> <texto> <aguja>
  case "$2" in *"$3"*) ok "$1" ;; *) mal "$1 — no aparece [$3] en: $(printf '%s' "$2" | head -c 300)" ;; esac
}
no_contiene(){
  case "$2" in *"$3"*) mal "$1 — sí aparece [$3]" ;; *) ok "$1" ;; esac
}
q(){ # q <SQL> [base] → valor escalar
  # shellcheck disable=SC2086
  $MYSQL "${2:-$DB}" -N -B -e "$1" 2>/dev/null
}
jw(){ # jw <archivo.json> <filtro jq>
  jq -r "$2" "$1" 2>/dev/null
}
# Cuenta una aguja ignorando las líneas de comentario: los propios archivos
# documentan "nada de `INSERT IGNORE`", y un grep crudo se contaría a sí mismo.
contar_codigo(){
  grep -v '^[[:space:]]*#' "$1" | grep -c "$2" || true
}

echo "===== TAB-39 · migraciones sin Docker ($($MARIADB_BIN/mysql --version | head -1)) ====="
echo "repositorio: $REPO"
echo "desechable:  $SCR"
echo

# ---------------------------------------------------------------------------
# Preparación: bases desechables + copia del directorio de migraciones del repo
# ---------------------------------------------------------------------------
$MYSQL -e "DROP DATABASE IF EXISTS \`${DB}\`; CREATE DATABASE \`${DB}\`; DROP DATABASE IF EXISTS \`${DB048}\`; CREATE DATABASE \`${DB048}\`; DROP DATABASE IF EXISTS \`${DB_FRESCA}\`; CREATE DATABASE \`${DB_FRESCA}\`;" \
  || { echo "no se pudo crear la base; ¿está mariadbd corriendo?" >&2; exit 2; }
cp "$REPO"/database/migrations/*.sql "$MIGRATIONS_DIR/"
N_VERSIONADAS=$(ls -1 "$MIGRATIONS_DIR"/*.sql | wc -l)

# La fase de migraciones del contenedor, sin copiarla: esta es la misma.
# shellcheck source=docker/migrations.sh
. "$REPO/docker/migrations.sh"

# ---------------------------------------------------------------------------
# 0. Instalación que ya existía (tabla de control con la forma VIEJA) y tabla
#    nueva tal como la crea el arranque en una base vacía.
# ---------------------------------------------------------------------------
echo "--- 0. instalación existente (schema.sql + control table vieja) ---"

# 0.a DNI fresco: `migrations_ensure_control_table` crea la tabla ya con estado.
# (En subshell: la función lee DB_NAME/MIGRATIONS_TABLE del entorno y no queremos
# dejar la base desechable apuntada para el resto de la puerta.)
( DB_NAME="$DB048" migrations_ensure_control_table >/dev/null )
comprobar "base nueva: la tabla de control nace con 6 columnas" "6" \
  "$(q "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB048' AND table_name='schema_migrations';" "$DB048")"
comprobar "base nueva: status/error_text/attempts/last_attempt_at presentes" "4" \
  "$(q "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB048' AND table_name='schema_migrations' AND column_name IN ('status','error_text','attempts','last_attempt_at');" "$DB048")"
comprobar "base nueva: el default de status es 'applied'" "'applied'" \
  "$(q "SELECT COLUMN_DEFAULT FROM information_schema.columns WHERE table_schema='$DB048' AND table_name='schema_migrations' AND column_name='status';" "$DB048")"

# 0.a-bis El índice que crea la 048 (`idx_schema_migrations_status`) también lo crea el
# ARRANQUE. La 048 NO se ejecuta en una instalación nueva (las versionadas se registran
# como `baseline` sin ejecutarse), así que si el índice solo viviera en la 048 las
# instalaciones nuevas se quedarían sin él y las que actualizan sí lo tendrían: dos
# esquemas para el mismo `schema.sql` (riesgo 1 del veredicto de TAB-47).
( DB_NAME="$DB_FRESCA" migrations_ensure_control_table >/dev/null; DB_NAME="$DB_FRESCA" migrations_ensure_columns >/dev/null )
comprobar "base nueva: el arranque deja el índice idx_schema_migrations_status" "1" \
  "$(q "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema='$DB_FRESCA' AND table_name='schema_migrations' AND index_name='idx_schema_migrations_status';" "$DB_FRESCA")"
if ( DB_NAME="$DB_FRESCA" migrations_ensure_columns >/dev/null 2>"$SCR/fresca_repetir.err" ); then
  ok "base nueva: repetir el arranque sobre la tabla ya preparada no falla"
else
  mal "base nueva: repetir el arranque falló (ver $SCR/fresca_repetir.err)"
fi
comprobar "base nueva: sigue habiendo UN índice (idempotente)" "1" \
  "$(q "SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema='$DB_FRESCA' AND index_name='idx_schema_migrations_status';" "$DB_FRESCA")"
no_contiene "base nueva: sin 'Duplicate key name' al repetir" "$(cat "$SCR/fresca_repetir.err" 2>/dev/null)" "Duplicate"

# 0.b Instalación existente en la base principal.
if ! $MYSQL "$DB" < "$SCHEMA_SQL" 2>"$SCR/schema.import.err"; then
  mal "schema.sql se importa (ver $SCR/schema.import.err)"
  tail -3 "$SCR/schema.import.err"
else
  ok "schema.sql importado ($(q "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB';") tablas)"
fi
# La tabla de control también existía ya, CON la forma vieja (sin columnas de
# estado): es el caso real de una instalación que actualiza.
q "CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);" >/dev/null
comprobar "control table vieja: sin columna status" "0" "$(q "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB' AND table_name='schema_migrations' AND column_name='status';")"
# Una fila que YA estaba en la tabla antes de TAB-39: de ella no se sabe si se
# ejecutó o venía del schema.sql, así que se queda en el DEFAULT ('applied').
q "INSERT INTO schema_migrations (version) VALUES ('zzz_historica_pre_tab39.sql');" >/dev/null

migrations_ensure_control_table >/dev/null
migrations_ensure_columns >/dev/null
comprobar "instalación vieja: el arranque añade la columna status" "1" "$(q "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB' AND table_name='schema_migrations' AND column_name='status';")"
comprobar "instalación vieja: attempts / error_text / last_attempt_at presentes" "3" "$(q "SELECT COUNT(*)-1 FROM information_schema.columns WHERE table_schema='$DB' AND table_name='schema_migrations' AND column_name IN ('attempts','error_text','last_attempt_at','status');")"
comprobar "instalación vieja: la fila histórica queda 'applied' (no se inventa historia)" "applied" \
  "$(q "SELECT status FROM schema_migrations WHERE version='zzz_historica_pre_tab39.sql';")"

migrations_register_baseline "$MIGRATIONS_DIR" >/dev/null
comprobar "baseline: ${N_VERSIONADAS} filas registradas" "$N_VERSIONADAS" "$(q "SELECT COUNT(*) FROM schema_migrations WHERE status='baseline';")"
comprobar "baseline: ninguna versionada queda como 'applied' (no se finge haber ejecutado)" "0" \
  "$(q "SELECT COUNT(*) FROM schema_migrations WHERE status='applied' AND version <> 'zzz_historica_pre_tab39.sql';")"

# ---------------------------------------------------------------------------
# 1. Migración NUEVA inválida (criterio 1)
# ---------------------------------------------------------------------------
echo
echo "--- 1. migración inválida nueva (999_test_falla.sql) ---"
cat > "$MIGRATIONS_DIR/999_test_falla.sql" <<'SQL'
-- Migración de prueba: SQL inválido a propósito (TAB-39).
ALTER TABLE no_existe_esta_tabla ADD COLUMN imposible INT;
SQL
SALIDA1=$(migrations_apply_pending "$MIGRATIONS_DIR" 2>&1); RC1=$?
printf '%s\n' "$SALIDA1" > "$SCR/run1.txt"
comprobar "criterio 1: la fase de migraciones NO aborta el arranque (exit)" "0" "$RC1"
contiene "criterio 1: la corrida reporta la fallida" "$SALIDA1" "[ERROR] 999_test_falla.sql FALLÓ"
comprobar "criterio 1: UNA fila status='failed'" "1" "$(q "SELECT COUNT(*) FROM schema_migrations WHERE status='failed';")"
comprobar "criterio 1: la fila es la de la migración nueva" "999_test_falla.sql" "$(q "SELECT version FROM schema_migrations WHERE status='failed';")"
comprobar "criterio 1: attempts=1" "1" "$(q "SELECT attempts FROM schema_migrations WHERE version='999_test_falla.sql';")"
ERROR_GUARDADO=$(q "SELECT LEFT(error_text,80) FROM schema_migrations WHERE version='999_test_falla.sql';")
contiene "criterio 1: LEFT(error_text,80) ya trae el error del cliente" "$ERROR_GUARDADO" "ERROR"
contiene "criterio 1: el error nombra la tabla que no existe" "$ERROR_GUARDADO" "no_existe_esta_tabla"
comprobar "criterio 1: last_attempt_at lo puso la BD (NOW())" "1" "$(q "SELECT COUNT(*) FROM schema_migrations WHERE version='999_test_falla.sql' AND last_attempt_at IS NOT NULL;")"
comprobar "criterio 1: el resto sigue registrado (las ya registradas no se tocan)" "$N_VERSIONADAS" "$(q "SELECT COUNT(*) FROM schema_migrations WHERE status='baseline';")"
contiene "criterio 1: el resumen desglosa" "$SALIDA1" "fallida(s) en esta corrida"

# ---------------------------------------------------------------------------
# 2. ready.php con la migración fallida → 200 degraded / migrations_failed:1
# ---------------------------------------------------------------------------
echo
echo "--- 2. ready.php (HTTP real) con 1 fallida ---"
INST="$SCR/inst"
mkdir -p "$INST" "$SCR/sessions"
cp -r "$REPO/includes" "$REPO/api" "$REPO/config" "$INST/"
cp -r "$REPO/database" "$INST/"
rm -f "$INST/config/database.php"
# El check `storage` exige que las rutas por defecto existan y sean escribibles:
# en el contenedor las crea el entrypoint; en la copia desechable, el rig.
mkdir -p "$INST/public/assets/images"
# DB_HOST con puerto embebido: es la forma en que PDO recibe el puerto, y la usa
# también `php -S` (misma constante que lee HealthCheck::connect()).
cat > "$INST/config/database.php" <<PHP
<?php
define('DB_HOST', '${MARIADB_HOST};port=${MARIADB_PORT}');
define('DB_NAME', '${DB}');
define('DB_USER', '${DB_USER}');
define('DB_PASS', '${DB_PASS}');
define('DB_CHARSET', 'utf8mb4');
PHP

# Puerto para `php -S`: se busca uno LIBRE. Con un puerto fijo, un servidor
# huérfano de una corrida anterior (que nadie mató porque la corrida murió antes)
# contesta y la puerta mide el árbol de OTRO run — ya pasó y da falsos PASS/FAIL.
PHP_PORT=""
for p in $(seq 18311 18399); do
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then PHP_PORT="$p"; break; fi
done
if [ -z "$PHP_PORT" ]; then echo "no hay puerto libre para php -S en 18311-18399" >&2; exit 2; fi

php -d session.save_path="$SCR/sessions" -S "127.0.0.1:${PHP_PORT}" -t "$INST" >"$SCR/php.log" 2>&1 &
PHP_PID=$!
# Marca de identidad: el primer GET comprueba que quien responde es ESTE servidor
# sirviendo ESTE directorio, no un huérfano de otro run.
echo "$SCR" > "$INST/tab39_rig.txt"
IDENT=""
for i in $(seq 1 40); do
  IDENT=$(curl -s --max-time 2 "http://127.0.0.1:${PHP_PORT}/tab39_rig.txt" 2>/dev/null || true)
  [ "$IDENT" = "$SCR" ] && break
  sleep 0.5
done
if [ "$IDENT" = "$SCR" ]; then
  ok "php -S sirve este directorio desechable (puerto ${PHP_PORT})"
else
  mal "php -S no respondió como este rig (respuesta [$IDENT]); ver $SCR/php.log"
  kill "$PHP_PID" 2>/dev/null || true
  echo "===== TAB-39: abortado, el rig no arrancó =====" >&2
  exit 2
fi

# `-f`: fuera de loopback el detalle no se expone; aquí vamos por loopback y el
# cuerpo trae `checks`, así que se lee el JSON entero y se afirma campo por campo
# (no por texto: `"status":"ok"` aparece también dentro de un check).
ready(){ # ready <prefijo>
  local p="$1"
  READY_CODE=$(curl -s --max-time 5 -o "$SCR/$p.json" -w '%{http_code}' "http://127.0.0.1:${PHP_PORT}/api/health/ready.php")
}
ready ready_degraded
comprobar "criterio 2: ready.php responde 200" "200" "$READY_CODE"
comprobar "criterio 2: el status GLOBAL es degraded" "degraded" "$(jw "$SCR/ready_degraded.json" '.status')"
comprobar "criterio 2: migrations_failed.failed = 1" "1" "$(jw "$SCR/ready_degraded.json" '.checks.migrations_failed.failed')"
comprobar "criterio 2: el check de fallidas es degraded" "degraded" "$(jw "$SCR/ready_degraded.json" '.checks.migrations_failed.status')"
contiene "criterio 2: el detalle apunta a schema_status.sh" \
  "$(jw "$SCR/ready_degraded.json" '.checks.migrations_failed.detail')" "schema_status.sh"

# ---------------------------------------------------------------------------
# 3. Reintento, arreglo del SQL y vuelta a la salud (criterio 3)
# ---------------------------------------------------------------------------
echo
echo "--- 3. reintento, arreglo y vuelta a ok ---"
SALIDA2=$(migrations_apply_pending "$MIGRATIONS_DIR" 2>&1)
printf '%s\n' "$SALIDA2" > "$SCR/run2.txt"
comprobar "reintento: attempts=2" "2" "$(q "SELECT attempts FROM schema_migrations WHERE version='999_test_falla.sql';")"
contiene "reintento: se anuncia el reintento" "$SALIDA2" "[retry] 999_test_falla.sql"
comprobar "reintento: sigue siendo UNA fallida" "1" "$(q "SELECT COUNT(*) FROM schema_migrations WHERE status='failed';")"

# Arreglada: el siguiente arranque la aplica (attempts=2 < MIGRATION_MAX_ATTEMPTS)
cat > "$MIGRATIONS_DIR/999_test_falla.sql" <<'SQL'
-- 999 — ya arreglada: crea su propia tabla de prueba.
CREATE TABLE IF NOT EXISTS tab39_prueba_migracion (id INT PRIMARY KEY);
SQL
SALIDA3=$(migrations_apply_pending "$MIGRATIONS_DIR" 2>&1)
printf '%s\n' "$SALIDA3" > "$SCR/run3.txt"
comprobar "criterio 3: arreglada → status='applied'" "applied" "$(q "SELECT status FROM schema_migrations WHERE version='999_test_falla.sql';")"
comprobar "criterio 3: error_text limpio" "" "$(q "SELECT IFNULL(error_text,'') FROM schema_migrations WHERE version='999_test_falla.sql';")"
comprobar "criterio 3: la tabla que crea la migración existe de verdad" "1" \
  "$(q "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB' AND table_name='tab39_prueba_migracion';")"
contiene "criterio 3: se dice que fue tras intentos fallidos" "$SALIDA3" "tras 2 intento(s)"
comprobar "criterio 3: cero fallidas" "0" "$(q "SELECT COUNT(*) FROM schema_migrations WHERE status='failed';")"

# Lo ya aplicado sigue en [skip] en el arranque siguiente.
SALIDA4=$(migrations_apply_pending "$MIGRATIONS_DIR" 2>&1)
printf '%s\n' "$SALIDA4" > "$SCR/run4.txt"
contiene "criterio 3: lo ya aplicado sigue en [skip]" "$SALIDA4" "[skip] 999_test_falla.sql (applied)"
contiene "criterio 3: y el baseline también" "$SALIDA4" "[skip] 048_schema_migrations_status.sql (baseline)"

ready ready_ok
comprobar "criterio 3: ready.php → 200" "200" "$READY_CODE"
comprobar "criterio 3: el status GLOBAL es ok" "ok" "$(jw "$SCR/ready_ok.json" '.status')"
comprobar "criterio 3: migrations_failed.failed = 0" "0" "$(jw "$SCR/ready_ok.json" '.checks.migrations_failed.failed')"

# ---------------------------------------------------------------------------
# 4. Tope de reintentos (MIGRATION_MAX_ATTEMPTS) con una migración propia
# ---------------------------------------------------------------------------
echo
echo "--- 4. tope de reintentos ---"
cat > "$MIGRATIONS_DIR/997_siempre_falla.sql" <<'SQL'
-- 997 — de prueba: falla siempre (TAB-39, tope de reintentos).
ALTER TABLE tampoco_existe ADD COLUMN nope INT;
SQL
for i in 1 2 3; do
  SALIDA_T=$(migrations_apply_pending "$MIGRATIONS_DIR" 2>&1)
  printf '%s\n' "$SALIDA_T" > "$SCR/run_tope${i}.txt"
  comprobar "tope: intento ${i} → attempts=${i}" "${i}" "$(q "SELECT attempts FROM schema_migrations WHERE version='997_siempre_falla.sql';")"
done
SALIDA_T4=$(migrations_apply_pending "$MIGRATIONS_DIR" 2>&1)
printf '%s\n' "$SALIDA_T4" > "$SCR/run_tope4.txt"
comprobar "tope: no hay 4.º intento (attempts sigue en 3)" "3" "$(q "SELECT attempts FROM schema_migrations WHERE version='997_siempre_falla.sql';")"
contiene "tope: se omite con motivo explícito" "$SALIDA_T4" "[skip] 997_siempre_falla.sql (fallida, 3/3 intentos"
contiene "tope: dice cómo re-armarla" "$SALIDA_T4" "attempts=0"
comprobar "tope: 999 (ya aplicada) no se reintenta" "applied" "$(q "SELECT status FROM schema_migrations WHERE version='999_test_falla.sql';")"
ready ready_tope
comprobar "tope: con 1 fallida ready.php vuelve a degraded / 200" "200" "$READY_CODE"
comprobar "tope: y lo dice en el status global" "degraded" "$(jw "$SCR/ready_tope.json" '.status')"

# Estado de reposo: el operador arregla y re-arma (borra la fila) como indica el log.
q "DELETE FROM schema_migrations WHERE version='997_siempre_falla.sql';" >/dev/null
rm -f "$MIGRATIONS_DIR/997_siempre_falla.sql"
ready ready_final
comprobar "reposo: sin fallidas → ok / 200" "200" "$READY_CODE"
comprobar "reposo: status global ok" "ok" "$(jw "$SCR/ready_final.json" '.status')"

# not_ready: una migración del repo sin registrar (el contenedor no reinició)
cat > "$INST/database/migrations/998_pendiente_prueba.sql" <<'SQL'
-- 998 — pendiente de prueba: nunca se registró (TAB-39).
SQL
ready ready_pending
comprobar "extra: migración pendiente → 503 not_ready" "503" "$READY_CODE"
comprobar "extra: el status global lo dice" "not_ready" "$(jw "$SCR/ready_pending.json" '.status')"
rm -f "$INST/database/migrations/998_pendiente_prueba.sql"

# ---------------------------------------------------------------------------
# 5. Estáticas y de contrato (criterios 4, 5, 6)
# ---------------------------------------------------------------------------
echo
echo "--- 5. estáticas ---"
N_IGNORE=$(contar_codigo "$REPO/docker/entrypoint.sh" 'INSERT IGNORE INTO schema_migrations')
comprobar "criterio 4: cero 'INSERT IGNORE INTO schema_migrations' en entrypoint.sh" "0" "$N_IGNORE"
N_IGNORE_LIB=$(contar_codigo "$REPO/docker/migrations.sh" 'INSERT IGNORE')
comprobar "criterio 4: cero 'INSERT IGNORE' en migrations.sh (sin contar comentarios)" "0" "$N_IGNORE_LIB"
N_ON_DUP=$(contar_codigo "$REPO/docker/migrations.sh" 'ON DUPLICATE KEY UPDATE')
[ "$N_ON_DUP" -ge 2 ] && ok "criterio 4: el registro usa ON DUPLICATE KEY UPDATE (${N_ON_DUP} veces)" \
  || mal "criterio 4: falta el ON DUPLICATE KEY UPDATE en migrations.sh"
bash -n "$REPO/docker/entrypoint.sh" && ok "entrypoint.sh parsea (bash -n)" || mal "entrypoint.sh no parsea"
bash -n "$REPO/docker/migrations.sh" && ok "migrations.sh parsea (bash -n)" || mal "migrations.sh no parsea"
bash -n "$REPO/docker/schema_status.sh" && ok "schema_status.sh parsea (bash -n)" || mal "schema_status.sh no parsea"
comprobar "criterio 6: nada de NOW() en PHP (el sello lo pone SQL)" "0" "$(grep -rc 'NOW()' "$REPO/includes/HealthCheck.class.php" || true)"
comprobar "criterio 6: el camino del dinero no se toca" "0" \
  "$(git -C "$REPO" diff --name-only -- api/sales/create_sale.php includes/SaleService.class.php includes/CashRegister.class.php | wc -l)"
comprobar "criterio 6: se trabaja en community-edition (main intacta)" "community-edition" \
  "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)"

# Criterio 5: la 048 en una base con la tabla VIEJA, dos veces seguidas.
OUT5=$(sed '/^[[:space:]]*USE[[:space:]]/Id' "$REPO/database/migrations/048_schema_migrations_status.sql" | $MYSQL "$DB048" 2>&1); RC5=$?
OUT5B=$(sed '/^[[:space:]]*USE[[:space:]]/Id' "$REPO/database/migrations/048_schema_migrations_status.sql" | $MYSQL "$DB048" 2>&1); RC5B=$?
comprobar "criterio 5: 048 sobre tabla vieja, 1.ª vez sin error" "0" "$RC5"
comprobar "criterio 5: 048 2.ª vez sin error" "0" "$RC5B"
comprobar "criterio 5: columna status añadida una sola vez" "1" \
  "$(q "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB048' AND table_name='schema_migrations' AND column_name='status';" "$DB048")"
comprobar "criterio 5: índice por status presente" "1" \
  "$(q "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema='$DB048' AND table_name='schema_migrations' AND index_name='idx_schema_migrations_status';" "$DB048")"
no_contiene "criterio 5: sin 'Duplicate column' en la 2.ª corrida" "$OUT5B" "Duplicate column"
# Y con las columnas ya puestas por el arranque (no por la 048): tampoco falla.
OUT5C=$(sed '/^[[:space:]]*USE[[:space:]]/Id' "$REPO/database/migrations/048_schema_migrations_status.sql" | $MYSQL "$DB" 2>&1); RC5C=$?
comprobar "criterio 5: 048 sobre la tabla que ya preparó el arranque, sin error" "0" "$RC5C"

# ---------------------------------------------------------------------------
# 6. schema_status.sh: la vista del operador
# ---------------------------------------------------------------------------
echo
echo "--- 6. docker/schema_status.sh ---"
# El entorno del sandbox inyecta `BASH_ENV` con un shim que fija su propio `PATH`,
# así que un `bash script` hijo pierde el directorio del cliente `mysql`. Con
# `env -u BASH_ENV` se prueba el script como lo vería el contenedor.
status_run(){ # status_run <archivo-salida> → deja STATUS_OUT / STATUS_RC
  STATUS_OUT=$(env -u BASH_ENV DB_HOST="${MARIADB_HOST};port=${MARIADB_PORT}" DB_NAME="$DB" DB_USER="$DB_USER" DB_PASS="$DB_PASS" MIGRATIONS_DIR="$MIGRATIONS_DIR" PATH="$MARIADB_BIN:$PATH" bash "$REPO/docker/schema_status.sh" 2>&1); STATUS_RC=$?
  printf '%s\n' "$STATUS_OUT" > "$SCR/$1"
}
q "UPDATE schema_migrations SET status='failed', error_text='ERROR 1146 (42S02) at line 2: Table no_existe.tabla does not exist' WHERE version='999_test_falla.sql';" >/dev/null
status_run schema_status_failed.txt
contiene "schema_status: imprime la columna version" "$STATUS_OUT" "version"
contiene "schema_status: imprime status y attempts" "$STATUS_OUT" "attempts"
contiene "schema_status: imprime last_attempt_at" "$STATUS_OUT" "last_attempt_at"
contiene "schema_status: imprime LEFT(error_text,200)" "$STATUS_OUT" "Table no_existe.tabla does not exist"
contiene "schema_status: hay fallidas" "$STATUS_OUT" "1 fallida(s)"
comprobar "schema_status: exit 1 con fallidas" "1" "$STATUS_RC"

q "UPDATE schema_migrations SET status='applied', error_text=NULL WHERE version='999_test_falla.sql';" >/dev/null
status_run schema_status_ok.txt
comprobar "schema_status: exit 0 al día" "0" "$STATUS_RC"
contiene "schema_status: resumen sin fallidas" "$STATUS_OUT" "0 fallida(s)"

# ---------------------------------------------------------------------------
# 7. H2 (veredicto de TAB-47): el diagnóstico empieza por el `ERROR …` también con
#    sentencia larga. El cliente `mysql` ECOA el enunciado antes del error, así que
#    con sentencias largas `LEFT(error_text,80)` mostraba la sentencia y NINGÚN
#    mensaje de error: el operador no veía la causa.
# ---------------------------------------------------------------------------
echo
echo "--- 7. H2: error_text con una sentencia larga ---"
{
  printf -- "-- 996 — de prueba: sentencia LARGA con error de sintaxis (H2).\n"
  printf "SELECT '%s\n" "$(printf 'a%.0s' $(seq 1 240))"
} > "$MIGRATIONS_DIR/996_larga_falla.sql"
SALIDA_H2=$(migrations_apply_pending "$MIGRATIONS_DIR" 2>&1); RC_H2=$?
printf '%s\n' "$SALIDA_H2" > "$SCR/run_h2.txt"
comprobar "H2: la sentencia larga falla y se registra como 'failed'" "failed" \
  "$(q "SELECT status FROM schema_migrations WHERE version='996_larga_falla.sql';")"
comprobar "H2: la fase de migraciones no aborta el arranque" "0" "$RC_H2"
LARGO_POS=$(q "SELECT LOCATE('ERROR', error_text) FROM schema_migrations WHERE version='996_larga_falla.sql';")
if [ "${LARGO_POS:-0}" -ge 1 ] && [ "${LARGO_POS:-0}" -le 80 ]; then
  ok "H2: el 'ERROR' cae dentro de LEFT(error_text,80) (posición ${LARGO_POS})"
else
  mal "H2: el 'ERROR' queda fuera del diagnóstico (posición [${LARGO_POS:-?}])"
fi
LARGO_TXT=$(q "SELECT LEFT(error_text,80) FROM schema_migrations WHERE version='996_larga_falla.sql';")
contiene "H2: el diagnóstico trae el código de error del cliente" "$LARGO_TXT" "ERROR 1064"
no_contiene "H2: ya no arrastra el enunciado ecoado" "$LARGO_TXT" "SELECT 'aaa"
LARGO_200=$(q "SELECT LEFT(error_text,200) FROM schema_migrations WHERE version='996_larga_falla.sql';")
contiene "H2: la vista del operador (LEFT 200) también lo ve" "$LARGO_200" "ERROR 1064"
q "DELETE FROM schema_migrations WHERE version='996_larga_falla.sql';" >/dev/null
rm -f "$MIGRATIONS_DIR/996_larga_falla.sql"

# ---------------------------------------------------------------------------
# 8. H3 (veredicto de TAB-47): clasificar NO puede depender de que el llamador haya
#    corrido `migrations_ensure_columns`. Si el flag se asume "sin estado", la fase
#    re-ejecuta lo ya registrado y guarda como `applied` una migración que FALLÓ: el
#    comportamiento viejo que TAB-39 elimina. Aquí se llama la fase sin ese paso.
# ---------------------------------------------------------------------------
echo
echo "--- 8. H3: la fase sin resolver el flag de estado ---"
cat > "$MIGRATIONS_DIR/995_h3_falla.sql" <<'SQL'
-- 995 — de prueba: falla a propósito, sin pasar por ensure_columns (H3).
ALTER TABLE tampoco_existe_h3 ADD COLUMN nope INT;
SQL
SALIDA_H3=$( ( unset MIGRATIONS_HAS_STATUS; migrations_apply_pending "$MIGRATIONS_DIR" ) 2>&1 )
printf '%s\n' "$SALIDA_H3" > "$SCR/run_h3.txt"
comprobar "H3: una fallida se registra como 'failed' aunque nadie resolvió el flag" "failed" \
  "$(q "SELECT status FROM schema_migrations WHERE version='995_h3_falla.sql';")"
contiene "H3: y su error se guarda" \
  "$(q "SELECT LEFT(error_text,80) FROM schema_migrations WHERE version='995_h3_falla.sql';")" "ERROR"
contiene "H3: lo ya registrado sigue en [skip] (no se re-ejecuta todo)" "$SALIDA_H3" \
  "[skip] 048_schema_migrations_status.sql (baseline)"
no_contiene "H3: la 048 no se vuelve a ejecutar" "$SALIDA_H3" "[ok] 048_schema_migrations_status.sql"
q "DELETE FROM schema_migrations WHERE version='995_h3_falla.sql';" >/dev/null
rm -f "$MIGRATIONS_DIR/995_h3_falla.sql"
ready ready_hallazgos_final
comprobar "H2/H3: estado de reposo → 200" "200" "$READY_CODE"
comprobar "H2/H3: sin fallidas al final" "0" "$(jw "$SCR/ready_hallazgos_final.json" '.checks.migrations_failed.failed')"

# ---------------------------------------------------------------------------
# Cierre
# ---------------------------------------------------------------------------
kill "$PHP_PID" 2>/dev/null || true
echo
echo "Evidencia en: $SCR (run1..run4, run_tope1..4, ready_*.json, schema_status_*.txt)"
echo "===== TAB-39: ${PASS} en verde, ${FAIL} en rojo ====="
exit "$([ "$FAIL" = "0" ] && echo 0 || echo 1)"

#!/bin/bash
# Tomodachi POS — FASE DE MIGRACIONES del arranque (la llama docker/entrypoint.sh)
#
# POR QUÉ ES UN ARCHIVO APARTE
# Esta lógica vivía incrustada en `docker/entrypoint.sh`, que empieza esperando a
# la BD y termina con `exec` del PID 1: no había forma de ejercitarla sin Docker y
# un fallo aquí solo se veía en producción. Aquí es lo mismo, pero en funciones,
# con el cliente `mysql` y las rutas en variables: `docker/verify_migrations_nodocker.sh`
# (y una persona con un MariaDB a mano) la corren tal cual, sin copiar el código.
#
# QUÉ CAMBIA (TAB-39)
# Antes, una migración fallida se registraba con `INSERT IGNORE`: la fila quedaba
# IDÉNTICA a una aplicada, el arranque siguiente la saltaba por `version` y el
# desfase era invisible para siempre. Ahora la tabla de control distingue estados:
#
#   status = 'applied'   se ejecutó con éxito. `attempts` cuenta los intentos.
#   status = 'baseline'  ya venía en `database/schema.sql` (primer arranque): no se
#                        ejecutó ni se ejecutará. Se dice tal cual, no se finge.
#   status = 'failed'    falló. Se guarda el error del cliente en `error_text` y se
#                        REINTENTA hasta MIGRATION_MAX_ATTEMPTS (default 3); al
#                        agotarse se omite con motivo explícito, nunca en silencio.
#
# INVARIANTES
# - Una migración que falla NO bloquea el arranque (misma decisión de siempre: el
#   negocio abre aunque el esquema traiga un desfase conocido). Lo que cambia es que
#   el desfase deja de ser invisible: lo dicen `docker/schema_status.sh` y
#   `api/health/ready.php` (estado `degraded`).
# - Nada de `INSERT IGNORE` para registrar resultados.
# - Ningún valor temporal se calcula en PHP: `NOW()` lo pone la BD.
#
# VARIABLES QUE ESPERA (las pone el entrypoint; el rig de verificación las sustituye)
#   MYSQL                cliente ya armado: "mysql -hHOST -uUSER -pPASS --skip-ssl ..."
#   DB_NAME              base de datos donde viven los datos
#   MIGRATIONS_DIR       directorio con los *.sql versionados
#   MIGRATION_MAX_ATTEMPTS  opcional, default 3

MIGRATIONS_TABLE="${MIGRATIONS_TABLE:-schema_migrations}"
MIGRATIONS_MAX_ATTEMPTS="${MIGRATION_MAX_ATTEMPTS:-3}"
# Recorte del error guardado: suficiente para diagnosticar, no una copia del dump.
MIGRATIONS_ERROR_MAX_CHARS="${MIGRATIONS_ERROR_MAX_CHARS:-2000}"
# 1 si la tabla de control tiene la columna `status`, 0 si no. VACÍO = nadie lo
# resolvió todavía (`migrations_ensure_columns` lo fija en el arranque); en ese caso
# lo resuelve `migrations_resolve_status_flag` la primera vez que hace falta.
# A propósito NO se asume "sin estado": asumirlo re-ejecuta migraciones ya
# registradas y guarda como `applied` una que falló — el comportamiento que TAB-39
# elimina (H3 del veredicto de TAB-47).
MIGRATIONS_HAS_STATUS="${MIGRATIONS_HAS_STATUS:-}"
# Estado por versión, cacheado en una sola consulta: "version|status|attempts" por línea.
MIGRATIONS_ROWS=""

# Ejecuta SQL contra la BD de la app con el cliente configurado.
migrations_mysql() {
  # shellcheck disable=SC2086 # $MYSQL es una orden con argumentos, a propósito
  $MYSQL "$DB_NAME" "$@"
}

# ¿Existe la columna? (information_schema: portable y sin efectos)
migrations_column_exists() {
  local table="$1" column="$2" n
  n=$(migrations_mysql -N -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = '${DB_NAME}' AND table_name = '${table}' AND column_name = '${column}';" 2>/dev/null || echo "0")
  [ "${n:-0}" != "0" ]
}

# ¿Existe el índice? (misma guarda portable que para las columnas)
migrations_index_exists() {
  local table="$1" index="$2" n
  n=$(migrations_mysql -N -e "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = '${DB_NAME}' AND table_name = '${table}' AND index_name = '${index}';" 2>/dev/null || echo "0")
  [ "${n:-0}" != "0" ]
}

# Resuelve MIGRATIONS_HAS_STATUS si nadie lo hizo antes. Lo fija
# `migrations_ensure_columns` en el arranque, pero quien sourcee este archivo y
# llame directo a la fase (un rig, un mantenimiento) no pasó por ahí: sin esto,
# 0 = "no hay estados" y todo se clasificaría con el camino viejo.
migrations_resolve_status_flag() {
  if [ -n "${MIGRATIONS_HAS_STATUS:-}" ]; then
    return 0
  fi
  if migrations_column_exists "${MIGRATIONS_TABLE}" "status"; then
    MIGRATIONS_HAS_STATUS=1
  else
    MIGRATIONS_HAS_STATUS=0
  fi
}

# Tabla de control, ya con la forma nueva. Idempotente: si existe, no la toca.
migrations_ensure_control_table() {
  migrations_mysql -e "CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
  version VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status ENUM('applied','baseline','failed') NOT NULL DEFAULT 'applied',
  error_text TEXT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_attempt_at DATETIME NULL
);"
}

# Instalaciones que ya existían: la tabla está, pero sin las columnas de estado.
# Se añaden una por una, comprobando antes: repetir el arranque no debe fallar.
migrations_ensure_columns() {
  local table="${MIGRATIONS_TABLE}"
  if ! migrations_column_exists "$table" "status"; then
    migrations_mysql -e "ALTER TABLE \`${table}\` ADD COLUMN status ENUM('applied','baseline','failed') NOT NULL DEFAULT 'applied';" \
      || { echo "[Tomodachi] AVISO: no se pudo añadir ${table}.status; las migraciones se registrarán sin estado." >&2; MIGRATIONS_HAS_STATUS=0; return 0; }
  fi
  if ! migrations_column_exists "$table" "error_text"; then
    migrations_mysql -e "ALTER TABLE \`${table}\` ADD COLUMN error_text TEXT NULL;" || true
  fi
  if ! migrations_column_exists "$table" "attempts"; then
    migrations_mysql -e "ALTER TABLE \`${table}\` ADD COLUMN attempts INT NOT NULL DEFAULT 0;" || true
  fi
  if ! migrations_column_exists "$table" "last_attempt_at"; then
    migrations_mysql -e "ALTER TABLE \`${table}\` ADD COLUMN last_attempt_at DATETIME NULL;" || true
  fi
  # El MISMO índice que crea la migración versionada 048 (`idx_schema_migrations_status`),
  # y aquí por una razón concreta: la 048 NO se ejecuta en una instalación nueva (las
  # versionadas se registran como `baseline` sin ejecutarse, `migrations_register_baseline`),
  # así que sin esto las instalaciones nuevas se quedaban sin el índice y las que
  # actualizan sí lo tenían: dos esquemas distintos para el mismo `schema.sql`
  # (riesgo 1 del veredicto de TAB-47). Idempotente: si ya está, no se toca.
  if ! migrations_index_exists "${table}" "idx_schema_migrations_status"; then
    migrations_mysql -e "ALTER TABLE \`${table}\` ADD KEY \`idx_schema_migrations_status\` (\`status\`);" \
      || echo "[Tomodachi] AVISO: no se pudo añadir el índice idx_schema_migrations_status; el arranque continúa." >&2
  fi
  MIGRATIONS_HAS_STATUS=1
}

# Estado + intentos de cada versión, en UNA consulta (la usan los [skip]).
migrations_load_rows() {
  migrations_resolve_status_flag
  if [ "${MIGRATIONS_HAS_STATUS}" = "1" ]; then
    MIGRATIONS_ROWS=$(migrations_mysql -N -B -e "SELECT CONCAT(version, '|', status, '|', attempts) FROM \`${MIGRATIONS_TABLE}\`;" 2>/dev/null || true)
  else
    MIGRATIONS_ROWS=$(migrations_mysql -N -B -e "SELECT CONCAT(version, '|-|-') FROM \`${MIGRATIONS_TABLE}\`;" 2>/dev/null || true)
  fi
}

# Deja en MIG_STATUS / MIG_ATTEMPTS lo que se sabe de una versión.
# MIG_STATUS vacío  = no hay fila: nunca se intentó.
migrations_lookup() {
  local line
  line=$(printf '%s\n' "${MIGRATIONS_ROWS}" | grep -F "${1}|" | head -1 || true)
  if [ -z "${line}" ]; then
    MIG_STATUS=""
    MIG_ATTEMPTS=0
    return 0
  fi
  MIG_STATUS=$(printf '%s' "${line}" | cut -d'|' -f2)
  MIG_ATTEMPTS=$(printf '%s' "${line}" | cut -d'|' -f3)
  case "${MIG_ATTEMPTS}" in
    ''|*[!0-9]*) MIG_ATTEMPTS=0 ;;
  esac
}

# Texto de error listo para meter en un literal SQL de una línea.
# El cliente `mysql` ECOA el enunciado que falló antes del `ERROR …` y separa las
# partes con líneas de guiones. Si se guarda todo, con sentencias largas el enunciado
# se come los primeros caracteres y `LEFT(error_text,80)` (esta puerta, el
# diagnóstico) y `LEFT(error_text,200)` (`docker/schema_status.sh`) muestran la
# sentencia y NINGÚN mensaje de error: el operador no ve la causa (H2 del veredicto
# de TAB-47). Por eso se conserva la(s) línea(s) del propio error (`ERROR …`) y solo
# si no hay ninguna se cae al texto completo limpio.
migrations_error_text() {
  local raw="$1" err
  err=$(printf '%s\n' "$raw" | tr -d '\r' | grep -E '^[[:space:]]*ERROR' || true)
  if [ -z "$err" ]; then
    err=$(printf '%s' "$raw" | tr -d '\r' | sed '/^[[:space:]]*-\{3,\}[[:space:]]*$/d')
  fi
  printf '%s' "$err" \
    | tr '\n' ' ' \
    | sed -e 's/[[:space:]]\{1,\}/ /g' -e 's/^ //' -e 's/ $//' \
    -e 's/\\/\\\\/g' -e "s/'/''/g" \
    | cut -c1-"${MIGRATIONS_ERROR_MAX_CHARS}"
}

# Primer arranque: `schema.sql` ya trae estos cambios, así que NO se ejecutan.
# Se registran como `baseline` para poder distinguirlo de "aplicada".
migrations_register_baseline() {
  local dir="${1:-$MIGRATIONS_DIR}" f mig
  migrations_resolve_status_flag
  if [ "${MIGRATIONS_HAS_STATUS}" = "1" ]; then
    {
      for f in "${dir}"/*.sql; do
        [ -f "$f" ] || continue
        mig=$(basename "$f")
        echo "INSERT INTO \`${MIGRATIONS_TABLE}\` (version, status, attempts, last_attempt_at) VALUES ('${mig}', 'baseline', 0, NULL) ON DUPLICATE KEY UPDATE status = \`${MIGRATIONS_TABLE}\`.status;"
      done
    } | migrations_mysql || return 1
  else
    {
      for f in "${dir}"/*.sql; do
        [ -f "$f" ] || continue
        mig=$(basename "$f")
        echo "INSERT INTO \`${MIGRATIONS_TABLE}\` (version) VALUES ('${mig}') ON DUPLICATE KEY UPDATE version = \`${MIGRATIONS_TABLE}\`.version;"
      done
    } | migrations_mysql || return 1
  fi
  return 0
}

# BD existente: aplica lo que falta y CLASIFICA el resultado.
# Devuelve 0 siempre que la BD esté viva: una migración rota no tumba el arranque.
migrations_apply_pending() {
  local dir="${1:-$MIGRATIONS_DIR}"
  local total=0 pending=0 applied_now=0 failed=0 skipped=0 retried=0
  local f mig err detail

  migrations_load_rows
  for f in $(ls -1 "${dir}"/*.sql 2>/dev/null | sort -V); do
    mig=$(basename "$f")
    total=$((total + 1))
    migrations_lookup "${mig}"

    if [ "${MIG_STATUS}" = "applied" ] || [ "${MIG_STATUS}" = "baseline" ]; then
      echo "  [skip] ${mig} (${MIG_STATUS})"
      skipped=$((skipped + 1))
      continue
    fi
    if [ "${MIG_STATUS}" = "failed" ] && [ "${MIG_ATTEMPTS}" -ge "${MIGRATIONS_MAX_ATTEMPTS}" ]; then
      echo "  [skip] ${mig} (fallida, ${MIG_ATTEMPTS}/${MIGRATIONS_MAX_ATTEMPTS} intentos: ya no se reintenta)"
      echo "         si ya arreglaste el SQL, borra la fila o pon attempts=0 y reinicia el contenedor." >&2
      skipped=$((skipped + 1))
      continue
    fi
    if [ "${MIG_STATUS}" = "failed" ]; then
      echo "  [retry] ${mig} (fallida, intento ${MIG_ATTEMPTS}/${MIGRATIONS_MAX_ATTEMPTS})"
      retried=$((retried + 1))
    else
      pending=$((pending + 1))
    fi

    # Ya conectamos a ${DB_NAME}: se eliminan los 'USE <db>;' hardcodeados de los
    # archivos para que la migración aplique siempre sobre la BD correcta.
    # El error del cliente se captura para guardarlo en `error_text` (y se sigue
    # publicando en stderr, que es lo que recoge `docker logs`).
    if err=$(sed '/^[[:space:]]*USE[[:space:]]/Id' "$f" | $MYSQL "$DB_NAME" 2>&1 >/dev/null); then
      migrations_record_result "${mig}" "applied" "" || true
      if [ "${MIG_STATUS}" = "failed" ]; then
        echo "  [ok] ${mig} aplicada y registrada (tras ${MIG_ATTEMPTS} intento(s) fallido(s))"
      else
        echo "  [ok] ${mig} aplicada y registrada"
      fi
      applied_now=$((applied_now + 1))
    else
      failed=$((failed + 1))
      detail=$(printf '%s' "${err}" | tr -d '\r' | tr '\n' ' ' | cut -c1-400)
      migrations_record_result "${mig}" "failed" "${err}" || true
      {
        echo "  [ERROR] ${mig} FALLÓ: ${detail}"
        echo "          Queda registrada como 'failed' en ${MIGRATIONS_TABLE}"
        echo "          (attempts=${MIG_ATTEMPTS}, error_text guardado). El arranque"
        echo "          continúa; revisa docker/schema_status.sh y ready.php (degraded)."
        echo "          Reintento en el siguiente arranque hasta ${MIGRATIONS_MAX_ATTEMPTS} intentos."
      } >&2
    fi
  done

  echo "[Tomodachi] Resumen migraciones: ${total} versionada(s), ${pending} pendiente(s) -> ${applied_now} aplicada(s) ahora, ${retried} reintentada(s), ${failed} fallida(s) en esta corrida, ${skipped} omitida(s)."
  return 0
}

# Registra el desenlace. `attempts` se incrementa; `error_text` se guarda solo en fallo.
migrations_record_result() {
  local mig="$1" status="$2" err="$3" escaped
  migrations_resolve_status_flag
  if [ "${MIGRATIONS_HAS_STATUS}" != "1" ]; then
    migrations_mysql -e "INSERT INTO \`${MIGRATIONS_TABLE}\` (version) VALUES ('${mig}') ON DUPLICATE KEY UPDATE version = \`${MIGRATIONS_TABLE}\`.version;"
    return $?
  fi
  if [ "${status}" = "failed" ]; then
    escaped=$(migrations_error_text "${err}")
    migrations_mysql -e "INSERT INTO \`${MIGRATIONS_TABLE}\` (version, status, attempts, last_attempt_at, error_text) VALUES ('${mig}', 'failed', 1, NOW(), '${escaped}') ON DUPLICATE KEY UPDATE status = 'failed', attempts = attempts + 1, last_attempt_at = NOW(), error_text = '${escaped}';"
  else
    migrations_mysql -e "INSERT INTO \`${MIGRATIONS_TABLE}\` (version, status, attempts, last_attempt_at, error_text) VALUES ('${mig}', 'applied', 1, NOW(), NULL) ON DUPLICATE KEY UPDATE status = 'applied', attempts = attempts + 1, last_attempt_at = NOW(), error_text = NULL;"
  fi
}

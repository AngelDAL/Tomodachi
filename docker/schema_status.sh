#!/bin/bash
# Tomodachi POS — ¿en qué estado quedó el esquema?
#
# LA PREGUNTA QUE RESPONDE
# "¿El arranque aplicó todas las migraciones, y alguna quedó fallida?" Antes no se
# podía responder: una migración fallida se registraba igual que una aplicada
# (TAB-39). Ahora la tabla de control distingue `applied` / `baseline` / `failed` y
# este script es la vista para el operador (y para el healthcheck: ready.php marca
# `degraded` cuando hay fallidas).
#
# USO (dentro del contenedor de la app, donde viven las variables DB_*)
#   docker exec <contenedor> bash docker/schema_status.sh
#
#   version | status   | attempts | last_attempt_at     | error (200 caracteres)
#
# Salida: el listado, los PENDIENTES (migraciones del repo sin registrar) y un
# resumen. Códigos de salida pensados para alertar sin parsear texto:
#   0 = al día (nada fallido, nada pendiente)
#   1 = hay fallidas y/o pendientes  → el negocio atiende, pero el esquema no está al día
#   2 = no se pudo consultar la BD   → problema de conexión/configuración
#
# Variables: DB_HOST, DB_NAME, DB_USER, DB_PASS (las mismas del entrypoint);
# opcional MIGRATIONS_DIR (default: el del repo dentro de la imagen).

set -u

MIGRATIONS_TABLE="${MIGRATIONS_TABLE:-schema_migrations}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/var/www/html/database/migrations}"

if [ -z "${DB_HOST:-}" ] || [ -z "${DB_NAME:-}" ] || [ -z "${DB_USER:-}" ]; then
  echo "schema_status: faltan DB_HOST/DB_NAME/DB_USER en el entorno" >&2
  exit 2
fi

# `DB_HOST` es la misma variable que alimenta el DSN de PDO, y ahí el puerto viaja
# embebido (`host;port=3307`). El cliente `mysql` no lo entiende en `-h`, así que se
# separa: con `-h127.0.0.1 -P3307` el script sirve tanto dentro del contenedor (donde
# `DB_HOST` es un nombre pelado) como apuntando a una base en otro puerto.
DB_HOSTNAME="${DB_HOST}"
DB_PORT_ARG=""
case "${DB_HOST}" in
  *';port='*)
    DB_HOSTNAME="${DB_HOST%%;port=*}"
    DB_PORT_ARG="-P${DB_HOST#*;port=}"
    ;;
esac

MYSQL="mysql -h${DB_HOSTNAME} ${DB_PORT_ARG} -u${DB_USER} -p${DB_PASS:-} --skip-ssl --default-character-set=utf8mb4"
# shellcheck disable=SC2086 # $MYSQL es una orden con argumentos, a propósito
consulta() { $MYSQL "${DB_NAME}" "$@"; }

if ! consulta -N -e "SELECT 1;" >/dev/null 2>&1; then
  echo "schema_status: no se pudo consultar ${DB_NAME} en ${DB_HOST}" >&2
  exit 2
fi

if ! consulta -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${DB_NAME}' AND table_name = '${MIGRATIONS_TABLE}';" | grep -qx "1"; then
  echo "schema_status: no existe la tabla de control ${MIGRATIONS_TABLE} (esquema sin inicializar)" >&2
  exit 2
fi

HAS_STATUS=$(consulta -N -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = '${DB_NAME}' AND table_name = '${MIGRATIONS_TABLE}' AND column_name = 'status';")

echo "=== ${MIGRATIONS_TABLE} (${DB_NAME}@${DB_HOST}) ==="
if [ "${HAS_STATUS}" = "1" ]; then
  consulta -e "SELECT version, status, attempts, last_attempt_at, LEFT(error_text, 200) AS error FROM ${MIGRATIONS_TABLE} ORDER BY version;"
  FAILED=$(consulta -N -e "SELECT COUNT(*) FROM ${MIGRATIONS_TABLE} WHERE status = 'failed';")
  BASELINE=$(consulta -N -e "SELECT COUNT(*) FROM ${MIGRATIONS_TABLE} WHERE status = 'baseline';")
  APPLIED=$(consulta -N -e "SELECT COUNT(*) FROM ${MIGRATIONS_TABLE} WHERE status = 'applied';")
else
  # Instalación vieja (sin las columnas de estado): se dice lo que hay, sin inventar.
  echo "# Esta instalación no distingue estados (falta la columna status):"
  echo "#   reinicia el contenedor para que el entrypoint añada las columnas."
  consulta -e "SELECT version, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY version;"
  FAILED=0
  BASELINE=0
  APPLIED=$(consulta -N -e "SELECT COUNT(*) FROM ${MIGRATIONS_TABLE};")
fi

# Pendientes: las que están en el repo y no tienen fila en la tabla de control.
REGISTRADAS=$(consulta -N -B -e "SELECT version FROM ${MIGRATIONS_TABLE};" 2>/dev/null || true)
PENDIENTES=""
PENDIENTES_N=0
for f in $(ls -1 "${MIGRATIONS_DIR}"/*.sql 2>/dev/null | sort -V); do
  mig=$(basename "$f")
  if ! printf '%s\n' "${REGISTRADAS}" | grep -qxF "${mig}"; then
    PENDIENTES="${PENDIENTES}${mig}
"
    PENDIENTES_N=$((PENDIENTES_N + 1))
  fi
done

echo
if [ "${PENDIENTES_N}" = "0" ]; then
  echo "Pendientes: 0 (todas las migraciones del repo están registradas)"
else
  echo "Pendientes: ${PENDIENTES_N} (el arranque se saltó estas o el contenedor no reinició):"
  printf '%s' "${PENDIENTES}" | sed 's/^/  - /'
fi

echo
if [ "${HAS_STATUS}" = "1" ]; then
  echo "Resumen: ${APPLIED} aplicada(s), ${BASELINE} baseline, ${FAILED} fallida(s), ${PENDIENTES_N} pendiente(s)."
else
  echo "Resumen: ${APPLIED} registrada(s), estado desconocido (falta la columna status), ${PENDIENTES_N} pendiente(s)."
fi
if [ "${FAILED}" != "0" ] || [ "${PENDIENTES_N}" != "0" ]; then
  echo "AVISO: el esquema NO está al día. ready.php responde 'degraded' (fallidas) o 'not_ready' (pendientes)." >&2
  exit 1
fi
exit 0

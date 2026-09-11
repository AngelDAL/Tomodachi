#!/bin/bash
# Tomodachi POS - Entrypoint
# Espera a la base de datos, genera config/database.php, importa esquema si es
# la primera vez, aplica migraciones pendientes automáticamente y arranca Apache.
#
# === Sistema de migraciones automáticas ===
# El despliegue es 100% automático: `docker compose up -d --build` deja la BD
# lista (esquema + migraciones + datos demo) sin SQL manual.
#
#   - La tabla de control `schema_migrations`
#     (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT
#     CURRENT_TIMESTAMP) registra qué migraciones ya se aplicaron.
#   - BD vacía (primer arranque): se importa database/schema.sql (baseline
#     consolidado) y TODAS las migraciones de database/migrations/*.sql se
#     registran como aplicadas (INSERT IGNORE): el schema.sql ya incluye esos
#     cambios, re-ejecutarlos solo provocaría errores de columna duplicada.
#   - BD existente: se consulta schema_migrations y se aplican SOLO las
#     migraciones pendientes, en orden numérico (sort -V). Cada migración se
#     registra (INSERT IGNORE) justo después de aplicarse, así nunca se
#     re-ejecuta una ya aplicada.
#   - Si una migración falla: se loguea el error con detalle, se registra como
#     aplicada de todas formas (INSERT IGNORE) y se continúa con la siguiente.
#     DECISIÓN DOCUMENTADA: registrar igualmente evita reintentar una
#     migración quebrada en cada boot y no bloquea el arranque del contenedor.
#     El caso típico es un cambio que ya existía en la BD (aplicado a mano
#     antes de este sistema, p. ej. ALTER ADD COLUMN duplicado o DROP INDEX
#     inexistente). El log indica claramente qué migración falló y qué verificar.

set -e

echo "[Tomodachi] Esperando base de datos en ${DB_HOST}:3306..."
until mysqladmin ping -h"${DB_HOST}" -u"${DB_USER}" -p"${DB_PASS}" --skip-ssl --silent 2>/dev/null; do
  echo "[Tomodachi] DB no disponible, reintentando en 3s..."
  sleep 3
done
echo "[Tomodachi] Base de datos lista."

MYSQL="mysql -h${DB_HOST} -u${DB_USER} -p${DB_PASS} --skip-ssl --default-character-set=utf8mb4"
MIGRATIONS_DIR="/var/www/html/database/migrations"

# ---------------------------------------------------------------------------
# Fotos de producto: tienen que vivir en el volumen persistente.
#
# El directorio public/assets/images/products/ está DENTRO de la imagen, o sea
# en la capa efímera del contenedor: todo lo subido ahí se perdía en cada
# despliegue (así se perdieron las fotos que ya estaban cargadas). El volumen
# persistente es public/uploads/, así que ahí se guardan de verdad y este
# directorio pasa a ser un enlace hacia él.
#
# Idempotente: en el primer arranque se lleva las imágenes que trae la imagen
# (semillas) y deja el enlace; en los siguientes no hace nada.
# ---------------------------------------------------------------------------
FOTOS_DIR="/var/www/html/public/assets/images/products"
FOTOS_PERSISTENTE="/var/www/html/public/uploads/products"

mkdir -p "${FOTOS_PERSISTENTE}"
if [ ! -L "${FOTOS_DIR}" ]; then
  if [ -d "${FOTOS_DIR}" ]; then
    # -n: no sobrescribir lo que ya exista en el volumen
    cp -rn "${FOTOS_DIR}/." "${FOTOS_PERSISTENTE}/" 2>/dev/null || true
    rm -rf "${FOTOS_DIR}"
  fi
  ln -sfn "${FOTOS_PERSISTENTE}" "${FOTOS_DIR}"
  echo "[Tomodachi] Fotos de producto enlazadas al volumen persistente."
else
  echo "[Tomodachi] Fotos de producto ya persistentes."
fi
chown -R www-data:www-data "${FOTOS_PERSISTENTE}" 2>/dev/null || true

# Generar config/database.php a partir de variables de entorno
if [ ! -f /var/www/html/config/database.php ]; then
  echo "[Tomodachi] Generando config/database.php..."

  # Escapar valores para cadenas PHP entre comillas simples: una contraseña
  # con comillas simples o backslashes no debe romper (ni inyectar código en)
  # el archivo de configuración generado.
  php_single_quote_escape() {
    printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g"
  }

  cat > /var/www/html/config/database.php <<PHP
<?php
// Generado automáticamente por el entrypoint de Docker
define('DB_HOST', '$(php_single_quote_escape "${DB_HOST}")');
define('DB_NAME', '$(php_single_quote_escape "${DB_NAME}")');
define('DB_USER', '$(php_single_quote_escape "${DB_USER}")');
define('DB_PASS', '$(php_single_quote_escape "${DB_PASS}")');
define('DB_CHARSET', '$(php_single_quote_escape "${DB_CHARSET:-utf8mb4}")');

date_default_timezone_set('$(php_single_quote_escape "${TZ:-America/Mexico_City}")');

define('DEBUG_MODE', false);

error_reporting(0);
ini_set('display_errors', 0);
PHP
fi

# Detectar BD vacía ANTES de crear schema_migrations (para no alterar el conteo)
TABLE_COUNT=$($MYSQL "${DB_NAME}" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${DB_NAME}';" 2>/dev/null || echo "0")

# Tabla de control de migraciones (idempotente)
echo "[Tomodachi] Garantizando tabla de control schema_migrations..."
$MYSQL "${DB_NAME}" -e "CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);"

if [ "${TABLE_COUNT}" = "0" ] || [ -z "${TABLE_COUNT}" ]; then
  # ================== PRIMER ARRANQUE (BD vacía) ==================
  echo "[Tomodachi] Base vacía — importando schema.sql (baseline)..."
  $MYSQL "${DB_NAME}" < /var/www/html/database/schema.sql
  echo "[Tomodachi] Esquema importado. Usuario inicial: admin / admin123 (se pedirá cambiar la contraseña en el primer acceso)"

  # schema.sql es el baseline consolidado: ya incluye los cambios de todas las
  # migraciones, así que se registran todas como aplicadas sin re-ejecutarlas.
  echo "[Tomodachi] Registrando migraciones como aplicadas (ya incluidas en schema.sql)..."
  {
    for f in "${MIGRATIONS_DIR}"/*.sql; do
      [ -f "$f" ] || continue
      echo "INSERT IGNORE INTO schema_migrations (version) VALUES ('$(basename "$f")');"
    done
  } | $MYSQL "${DB_NAME}"
  REGISTERED=$($MYSQL "${DB_NAME}" -N -e "SELECT COUNT(*) FROM schema_migrations;")
  echo "[Tomodachi] ${REGISTERED} migraciones registradas en schema_migrations."

  # Datos demo opcionales (SEED_DEMO=true por defecto; false para instalación limpia)
  if [ "${SEED_DEMO:-true}" = "true" ]; then
    echo "[Tomodachi] SEED_DEMO activo — cargando datos de demostración..."
    $MYSQL "${DB_NAME}" < /var/www/html/database/seed_demo.sql
    echo "[Tomodachi] Datos demo cargados. Usuario demo: demo / demo123 (tienda 2)"
  else
    echo "[Tomodachi] SEED_DEMO=false — instalación limpia (solo datos base del schema)."
  fi
else
  # ================== BD EXISTENTE (actualización) ==================
  echo "[Tomodachi] Base existente (${TABLE_COUNT} tablas) — aplicando migraciones pendientes..."
  APPLIED=$($MYSQL "${DB_NAME}" -N -e "SELECT version FROM schema_migrations;" 2>/dev/null || true)
  PENDING=0
  APPLIED_NOW=0
  FAILED=0
  for f in $(ls -1 "${MIGRATIONS_DIR}"/*.sql 2>/dev/null | sort -V); do
    MIG_NAME=$(basename "$f")
    if printf '%s\n' "${APPLIED}" | grep -qxF "${MIG_NAME}"; then
      echo "  [skip] ${MIG_NAME} (ya aplicada)"
      continue
    fi
    PENDING=$((PENDING + 1))
    # Ya conectamos a ${DB_NAME}; se eliminan los 'USE <db>;' hardcodeados de
    # los archivos para que la migración aplique siempre sobre la BD correcta.
    if sed '/^[[:space:]]*USE[[:space:]]/Id' "$f" | $MYSQL "${DB_NAME}"; then
      $MYSQL "${DB_NAME}" -e "INSERT IGNORE INTO schema_migrations (version) VALUES ('${MIG_NAME}');"
      echo "  [ok] ${MIG_NAME} aplicada y registrada"
      APPLIED_NOW=$((APPLIED_NOW + 1))
    else
      FAILED=$((FAILED + 1))
      echo "  [ERROR] ${MIG_NAME} FALLÓ (revisa el detalle del error arriba)." >&2
      echo "          Se registra como aplicada para no reintentarla en cada boot" >&2
      echo "          y no bloquear el arranque. Si el cambio NO estaba realmente" >&2
      echo "          aplicado, aplícalo manualmente o borra la fila de" >&2
      echo "          schema_migrations y reinicia el contenedor." >&2
      $MYSQL "${DB_NAME}" -e "INSERT IGNORE INTO schema_migrations (version) VALUES ('${MIG_NAME}');"
    fi
  done
  echo "[Tomodachi] Resumen migraciones: ${PENDING} pendiente(s), ${APPLIED_NOW} aplicada(s) correctamente, ${FAILED} con error (registradas como aplicadas)."
fi

# Asegurar permisos de escritura para uploads
mkdir -p /var/www/html/public/assets/images/products
mkdir -p /var/www/html/public/assets/images/logos
mkdir -p /var/www/html/public/assets/images/backgrounds
mkdir -p /var/www/html/uploads/digital_signage
# Sembrar assets por defecto en el volumen (sin sobreescribir los del usuario)
if [ -f /opt/tomodachi-assets/default-logo.png ] && [ ! -f /var/www/html/public/assets/images/default-logo.png ]; then
  cp /opt/tomodachi-assets/default-logo.png /var/www/html/public/assets/images/default-logo.png
fi
if [ -f /opt/tomodachi-assets/products/default-product.svg ] && [ ! -f /var/www/html/public/assets/images/products/default-product.svg ]; then
  cp /opt/tomodachi-assets/products/default-product.svg /var/www/html/public/assets/images/products/default-product.svg
fi
chown -R www-data:www-data /var/www/html/public/assets/images
chown -R www-data:www-data /var/www/html/uploads

# Endurecer directorios de subida: nada de lo que sube un usuario debe poder
# ejecutarse como código (se re-escribe en cada arranque para cubrir también
# volúmenes Docker ya existentes, donde el .htaccess de la imagen no llega).
write_upload_htaccess() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  cat > "${dir}/.htaccess" <<'HTACCESS'
# Tomodachi POS - directorio de archivos subidos: solo contenido estático
<IfModule mod_php.c>
    php_flag engine off
</IfModule>
<IfModule mod_php7.c>
    php_flag engine off
</IfModule>
<IfModule mod_php8.c>
    php_flag engine off
</IfModule>
<FilesMatch "\.(php|phtml|php[0-9]|phar|cgi|pl|py|sh|shtml|htaccess|ini)$">
    Require all denied
</FilesMatch>
<IfModule mod_mime.c>
    RemoveHandler .php .phtml .phar
    RemoveType .php .phtml .phar
</IfModule>
Options -Indexes -ExecCGI
HTACCESS
  chown www-data:www-data "${dir}/.htaccess" 2>/dev/null || true
}

write_upload_htaccess /var/www/html/public/assets/images
write_upload_htaccess /var/www/html/uploads
write_upload_htaccess /var/www/html/uploads/digital_signage

echo "[Tomodachi] Iniciando Apache..."
exec "$@"

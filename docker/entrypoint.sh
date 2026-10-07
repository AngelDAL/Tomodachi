#!/bin/bash
# Tomodachi POS - Entrypoint
# Espera a la base de datos, genera config/database.php, importa esquema si es
# la primera vez, aplica migraciones pendientes automáticamente y arranca Apache.
#
# === Sistema de migraciones automáticas ===
# El despliegue es 100% automático: `docker compose up -d --build` deja la BD
# lista (esquema + migraciones) sin SQL manual. La fase de migraciones vive en
# `docker/migrations.sh` (se puede correr fuera de Docker: ver
# `docker/verify_migrations_nodocker.sh`); aquí solo se decide en qué rama entrar.
#
#   - Tabla de control `schema_migrations` (version PRIMARY KEY, applied_at,
#     status ENUM('applied','baseline','failed'), error_text, attempts,
#     last_attempt_at) en `docker/migrations.sh`, que también añade las columnas
#     de estado a las instalaciones que venían de la versión anterior.
#   - BD vacía (primer arranque): se importa database/schema.sql (baseline
#     consolidado) y TODAS las migraciones de database/migrations/*.sql se
#     registran como `baseline`: el schema.sql ya incluye esos cambios, así que
#     re-ejecutarlas solo provocaría errores de columna duplicada. Se distinguen
#     de `applied` para no fingir que se ejecutaron.
#   - BD existente: se aplican SOLO las migraciones pendientes, en orden
#     numérico (sort -V), y cada resultado se clasifica: `applied` con su
#     `attempts` y `last_attempt_at`, o `failed` con el error del cliente.
#   - Si una migración falla: se loguea el error, se registra como `failed` y se
#     continúa con la siguiente. NO bloquea el arranque (decisión documentada:
#     el negocio abre aunque el esquema traiga un desfase conocido). A diferencia
#     de antes, el desfase deja de ser invisible: `docker/schema_status.sh` y
#     `api/health/ready.php` (estado `degraded`) lo dicen. Se reintenta solo,
#     como mucho MIGRATION_MAX_ATTEMPTS veces (default 3) por migración.

set -e

echo "[Tomodachi] Esperando base de datos en ${DB_HOST}:3306..."
until mysqladmin ping -h"${DB_HOST}" -u"${DB_USER}" -p"${DB_PASS}" --skip-ssl --silent 2>/dev/null; do
  echo "[Tomodachi] DB no disponible, reintentando en 3s..."
  sleep 3
done
echo "[Tomodachi] Base de datos lista."

MYSQL="mysql -h${DB_HOST} -u${DB_USER} -p${DB_PASS} --skip-ssl --default-character-set=utf8mb4"
MIGRATIONS_DIR="/var/www/html/database/migrations"
SCHEMA_SQL="/var/www/html/database/schema.sql"
# shellcheck source=docker/migrations.sh
. "$(dirname "${BASH_SOURCE[0]}")/migrations.sh"

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
#
# 7-oct-2026: lo mismo para los LOGOS y los FONDOS (papel tapiz). El logo vivía
# en la capa efímera: uno subido desde la interfaz se perdía en el siguiente
# despliegue, igual que pasaba con las fotos de producto antes de este arreglo.
# ---------------------------------------------------------------------------
for SUBDIR in products logos wallpapers; do
  DIR="/var/www/html/public/assets/images/${SUBDIR}"
  PERSISTENTE="/var/www/html/public/uploads/${SUBDIR}"

  mkdir -p "${PERSISTENTE}"
  if [ ! -L "${DIR}" ]; then
    if [ -d "${DIR}" ]; then
      # -n: no sobrescribir lo que ya exista en el volumen
      cp -rn "${DIR}/." "${PERSISTENTE}/" 2>/dev/null || true
      rm -rf "${DIR}"
    fi
    ln -sfn "${PERSISTENTE}" "${DIR}"
    echo "[Tomodachi] ${SUBDIR}: enlazado al volumen persistente."
  fi
  chown -R www-data:www-data "${PERSISTENTE}" 2>/dev/null || true
done

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

// Observabilidad: los errores de la aplicación se REGISTRAN (salen por el error
// log de php-fpm y supervisord los publica en docker logs) pero NO se muestran
// al cliente: ni rutas ni consultas SQL en la respuesta HTTP.
error_reporting(E_ALL);
ini_set('log_errors', '1');
ini_set('display_errors', '0');
PHP
fi

# Detectar BD vacía ANTES de crear schema_migrations (para no alterar el conteo)
TABLE_COUNT=$($MYSQL "${DB_NAME}" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${DB_NAME}';" 2>/dev/null || echo "0")

# Tabla de control de migraciones (idempotente; le añade las columnas de estado a
# las instalaciones que venían de la versión anterior)
echo "[Tomodachi] Garantizando tabla de control ${MIGRATIONS_TABLE}..."
migrations_ensure_control_table
migrations_ensure_columns

if [ "${TABLE_COUNT}" = "0" ] || [ -z "${TABLE_COUNT}" ]; then
  # ================== PRIMER ARRANQUE (BD vacía) ==================
  echo "[Tomodachi] Base vacía — importando schema.sql (baseline)..."
  $MYSQL "${DB_NAME}" < "${SCHEMA_SQL}"
  echo "[Tomodachi] Esquema importado. Usuario inicial: admin / admin123 (se pedirá cambiar la contraseña en el primer acceso)"

  # schema.sql es el baseline consolidado: ya incluye los cambios de todas las
  # migraciones, así que se registran como `baseline` sin re-ejecutarlas.
  echo "[Tomodachi] Registrando migraciones como baseline (ya incluidas en schema.sql)..."
  migrations_register_baseline "${MIGRATIONS_DIR}" || echo "[Tomodachi] AVISO: no se pudieron registrar todas las migraciones como baseline" >&2
  REGISTERED=$($MYSQL "${DB_NAME}" -N -e "SELECT COUNT(*) FROM ${MIGRATIONS_TABLE};")
  echo "[Tomodachi] ${REGISTERED} migraciones registradas en ${MIGRATIONS_TABLE}."

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
  migrations_apply_pending "${MIGRATIONS_DIR}"
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
# Fondos demo del editor de Pantallas Digitales (localizados, ya no Unsplash)
for bg in demo-cafe.jpg demo-city.jpg demo-mountain.jpg; do
  if [ -f "/opt/tomodachi-assets/backgrounds/$bg" ] && [ ! -f "/var/www/html/public/assets/images/backgrounds/$bg" ]; then
    cp "/opt/tomodachi-assets/backgrounds/$bg" "/var/www/html/public/assets/images/backgrounds/$bg"
  fi
done
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

echo "[Tomodachi] Arrancando servicios (supervisord: nginx + php-fpm)…"
exec "$@"

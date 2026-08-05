#!/bin/bash
# Tomodachi POS - Entrypoint
# Espera a la base de datos, genera config/database.php, importa esquema si es
# la primera vez, y arranca Apache.

set -e

echo "[Tomodachi] Esperando base de datos en ${DB_HOST}:3306..."
until mysqladmin ping -h"${DB_HOST}" -u"${DB_USER}" -p"${DB_PASS}" --skip-ssl --silent 2>/dev/null; do
  echo "[Tomodachi] DB no disponible, reintentando en 3s..."
  sleep 3
done
echo "[Tomodachi] Base de datos lista."

MYSQL="mysql -h${DB_HOST} -u${DB_USER} -p${DB_PASS} --skip-ssl --default-character-set=utf8mb4"

# Generar config/database.php a partir de variables de entorno
if [ ! -f /var/www/html/config/database.php ]; then
  echo "[Tomodachi] Generando config/database.php..."
  cat > /var/www/html/config/database.php <<PHP
<?php
// Generado automáticamente por el entrypoint de Docker
define('DB_HOST', '${DB_HOST}');
define('DB_NAME', '${DB_NAME}');
define('DB_USER', '${DB_USER}');
define('DB_PASS', '${DB_PASS}');
define('DB_CHARSET', '${DB_CHARSET:-utf8mb4}');

date_default_timezone_set('${TZ:-America/Mexico_City}');

define('DEBUG_MODE', false);

error_reporting(0);
ini_set('display_errors', 0);
PHP
fi

# Importar esquema solo si la BD está vacía (primera ejecución)
TABLE_COUNT=$($MYSQL "${DB_NAME}" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '${DB_NAME}';" 2>/dev/null || echo "0")
if [ "${TABLE_COUNT}" = "0" ] || [ -z "${TABLE_COUNT}" ]; then
  echo "[Tomodachi] Base vacía — importando schema.sql..."
  $MYSQL "${DB_NAME}" < /var/www/html/database/schema.sql
  echo "[Tomodachi] Esquema importado. Usuario inicial: admin / admin123"

  # Datos demo opcionales (SEED_DEMO=true por defecto; false para instalación limpia)
  if [ "${SEED_DEMO:-true}" = "true" ]; then
    echo "[Tomodachi] SEED_DEMO activo — cargando datos de demostración..."
    $MYSQL "${DB_NAME}" < /var/www/html/database/seed_demo.sql
    echo "[Tomodachi] Datos demo cargados. Usuario demo: demo / demo123 (tienda 2)"
  else
    echo "[Tomodachi] SEED_DEMO=false — instalación limpia (solo datos base del schema)."
  fi
else
  echo "[Tomodachi] Base ya inicializada (${TABLE_COUNT} tablas). Omitiendo importación."
fi

# Asegurar permisos de escritura para uploads
mkdir -p /var/www/html/public/assets/images/products
mkdir -p /var/www/html/public/assets/images/logos
mkdir -p /var/www/html/public/assets/images/backgrounds
chown -R www-data:www-data /var/www/html/public/assets/images

echo "[Tomodachi] Iniciando Apache..."
exec "$@"

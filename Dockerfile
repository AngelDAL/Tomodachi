# Tomodachi POS - Community Edition
# Imagen self-hosted: PHP 8.2 + Apache + extensiones necesarias
FROM php:8.2-apache

# Extensiones requeridas por el sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpng-dev \
        libjpeg-dev \
        libfreetype6-dev \
        libzip-dev \
        libonig-dev \
        default-mysql-client \
        curl \
        unzip \
        git \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        pdo_mysql \
        mysqli \
        mbstring \
        exif \
        zip \
        gd \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*

# Composer (para dependencias PHP)
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Código de la aplicación
WORKDIR /var/www/html
COPY . .

# Dependencias PHP (phpmailer)
RUN if [ -f composer.json ]; then composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader || true; fi

# Configuración de Apache: DocumentRoot en la raíz del proyecto
# (el .htaccess existente redirige a public/ y protege config/includes/database)
COPY docker/apache-tomodachi.conf /etc/apache2/sites-available/000-default.conf
RUN a2enmod rewrite

# Permisos
RUN chown -R www-data:www-data /var/www/html \
    && chmod +x /var/www/html/docker/entrypoint.sh

# Variables de entorno configurables (con defaults)
ENV DB_HOST=db \
    DB_NAME=tomodachi_pos \
    DB_USER=tomodachi \
    DB_PASS=tomodachi_secret \
    DB_CHARSET=utf8mb4 \
    APP_MODE=OPEN_SOURCE \
    SEED_DEMO=true \
    TZ=America/Mexico_City

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost/api/auth/permissions.php || exit 1

ENTRYPOINT ["/var/www/html/docker/entrypoint.sh"]
CMD ["apache2-foreground"]

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

# Assets por defecto (fuera del volumen app_uploads para poder sembrarlos al arranque)
RUN mkdir -p /opt/tomodachi-assets/products
COPY public/assets/images/default-logo.png /opt/tomodachi-assets/default-logo.png
COPY public/assets/images/products/default-product.svg /opt/tomodachi-assets/products/default-product.svg

# Sesiones persistentes: guardar las sesiones PHP en un directorio propio
# montado como volumen Docker (sobreviven a rebuilds/recreación del contenedor).
RUN mkdir -p /var/lib/php/sessions \
    && chown www-data:www-data /var/lib/php/sessions \
    && echo "session.save_path = /var/lib/php/sessions" > /usr/local/etc/php/conf.d/99-sessions.ini \
    && echo "session.gc_maxlifetime = 31536000" >> /usr/local/etc/php/conf.d/99-sessions.ini

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
# rebuild-css 1786474963
# rebuild-cleanup 1786475685
# rebuild-inv 1786476339
# rebuild-inv2 1786476443
# rebuild-white 1786476737
# rebuild-cust 1786477109
# rebuild-promo 1786477498
# rebuild-promo2 1786477961
# rebuild-print 1786478514
# rebuild-btns 1786478930
# rebuild-btns2 1786479007
# rebuild-profile 1786487358
# rebuild-customers 1786489299
# rebuild-profile2 1786489634
# rebuild-sep 1786489721
# rebuild-sep2 1786489772
# rebuild-themefix 1786490096
# rebuild-final 1786490157
# rebuild-promo3 1786490460
# rebuild-roles 1786490922
# rebuild-pdf 1786491251

# Tomodachi POS - Community Edition
# Imagen self-hosted: PHP 8.2 + nginx + php-fpm + supervisord + extensiones necesarias
# (migrado desde Apache/mod_php a nginx+php-fpm: misma imagen única, menos RAM,
#  más estable bajo concurrencia y ~igual rendimiento. Ver docker/nginx.conf)
FROM php:8.2-fpm

# Extensiones requeridas por el sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpng-dev \
        libjpeg-dev \
        libfreetype6-dev \
        libwebp-dev \
        libzip-dev \
        libonig-dev \
        default-mysql-client \
        curl \
        unzip \
        git \
        nginx \
        supervisor \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install -j$(nproc) \
        pdo_mysql \
        mysqli \
        mbstring \
        exif \
        zip \
        gd \
    && rm -rf /var/lib/apt/lists/*

# Composer (para dependencias PHP)
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Código de la aplicación
WORKDIR /var/www/html
COPY . .

# Dependencias PHP (phpmailer)
RUN if [ -f composer.json ]; then composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader || true; fi

# Assets por defecto (fuera del volumen app_uploads para poder sembrarlos al arranque)
RUN mkdir -p /opt/tomodachi-assets/products /opt/tomodachi-assets/backgrounds
COPY public/assets/images/default-logo.png /opt/tomodachi-assets/default-logo.png
COPY public/assets/images/products/default-product.svg /opt/tomodachi-assets/products/default-product.svg
COPY public/assets/images/backgrounds/demo-cafe.jpg /opt/tomodachi-assets/backgrounds/demo-cafe.jpg
COPY public/assets/images/backgrounds/demo-city.jpg /opt/tomodachi-assets/backgrounds/demo-city.jpg
COPY public/assets/images/backgrounds/demo-mountain.jpg /opt/tomodachi-assets/backgrounds/demo-mountain.jpg

# Límites PHP (upload 100MB + compresión GD + OPcache): se aplica como .ini de conf.d
COPY docker/php.ini /usr/local/etc/php/conf.d/98-tomodachi.ini

# php-fpm: pool sintonizado para hardware modesto (Raspberry Pi, 4 núcleos).
# Sobrescribe el www.conf por defecto de la imagen.
COPY docker/fpm-tuning.conf /usr/local/etc/php-fpm.d/www.conf

# Sesiones persistentes: guardar las sesiones PHP en un directorio propio
# montado como volumen Docker (sobreviven a rebuilds/recreación del contenedor).
RUN mkdir -p /var/lib/php/sessions \
    && chown www-data:www-data /var/lib/php/sessions \
    && echo "session.save_path = /var/lib/php/sessions" > /usr/local/etc/php/conf.d/100-sessions.ini

# nginx + supervisord (en vez de Apache/mod_php): contenedor único
COPY docker/nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /etc/nginx/html  # evita warning si falta
COPY docker/supervisord.conf /etc/supervisor/supervisord.conf

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
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
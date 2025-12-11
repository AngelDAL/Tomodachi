# Tomodachi POS System

Sistema de Punto de Venta (POS) web, open source, diseñado para pequeñas y medianas empresas. Permite la gestión de inventarios, ventas, usuarios y múltiples tiendas.

## 🚀 Características

- **Gestión de Ventas**: Interfaz de caja rápida e intuitiva.
- **Inventario**: Control de stock, categorías y productos.
- **Multitienda**: Soporte para múltiples sucursales.
- **Usuarios**: Roles y permisos (Admin, Gerente, Cajero).
- **Reportes**: Estadísticas de ventas y movimientos.
- **Personalización**: Configuración de logo y datos de la tienda en tickets.

## 📋 Requisitos

- **Servidor Web**: Apache o Nginx.
- **PHP**: 8.0 o superior.
- **Base de Datos**: MySQL 8.0 o MariaDB 10.5+.
- **Extensiones PHP**: PDO, pdo_mysql, json, mbstring, xml, curl.

## 🛠️ Instalación

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/tu-usuario/tomodachi.git
   cd tomodachi
   ```

2. **Configurar la Base de Datos**
   - Cree una base de datos vacía (ej. `tomodachi_pos`).
   - Importe el esquema base:
     ```bash
     mysql -u root -p tomodachi_pos < database/schema.sql
     ```
   - **Importante**: Ejecute las migraciones en orden para tener la estructura actualizada:
     ```bash
     mysql -u root -p tomodachi_pos < database/migrations/001_add_product_image.sql
     mysql -u root -p tomodachi_pos < database/migrations/002_add_store_id_to_products.sql
     mysql -u root -p tomodachi_pos < database/migrations/003_add_user_phone_and_store_theme.sql
     mysql -u root -p tomodachi_pos < database/migrations/004_add_store_settings.sql
     mysql -u root -p tomodachi_pos < database/migrations/005_add_onboarding_setting.sql
     ```

3. **Configurar la Conexión**
   - Copie el archivo de configuración de ejemplo:
     ```bash
     cp config/database.php.example config/database.php
     ```
   - Edite `config/database.php` con sus credenciales de base de datos.
   - Para producción, asegúrese de establecer `define('DEBUG_MODE', false);`.

4. **Configurar Correo (SMTP)**
   - Copie el archivo de configuración de ejemplo:
     ```bash
     cp config/mail.php.example config/mail.php
     ```
   - Edite `config/mail.php` con sus credenciales SMTP (Host, Puerto, Usuario, Contraseña).
   - Esto es necesario para el envío de correos de bienvenida y notificaciones.

5. **Configurar Permisos**
   - Asegúrese de que el servidor web tenga permisos de escritura en la carpeta de imágenes si planea subir logos o fotos de productos:
     ```bash
     chmod -R 755 public/assets/images
     ```

## 🖥️ Uso

1. Acceda a la aplicación desde su navegador (ej. `http://localhost/tomodachi/public/login.html`).
2. Inicie sesión con las credenciales por defecto:
   - **Usuario**: `admin`
   - **Contraseña**: `admin123`
3. **¡Importante!** Cambie la contraseña del administrador inmediatamente después del primer inicio de sesión.

## 📄 Licencia

Este proyecto está bajo la Licencia Apache 2.0. Ver el archivo `LICENSE` para más detalles.
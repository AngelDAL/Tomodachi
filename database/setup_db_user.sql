-- Script para crear usuario de base de datos dedicado para la aplicación
-- Ejecutar este script como root de MySQL/MariaDB:
-- sudo mysql < database/setup_db_user.sql

-- 1. Crear el usuario (si no existe) o actualizar contraseña
CREATE USER IF NOT EXISTS 'tomodachi_user'@'localhost' IDENTIFIED BY 'tomodachi';
ALTER USER 'tomodachi_user'@'localhost' IDENTIFIED BY 'tomodachi';

-- 2. Otorgar permisos sobre la base de datos del proyecto
GRANT ALL PRIVILEGES ON tomodachi_pos.* TO 'tomodachi_user'@'localhost';

-- 3. Aplicar cambios
FLUSH PRIVILEGES;

-- Verificación (opcional)
SHOW GRANTS FOR 'tomodachi_user'@'localhost';

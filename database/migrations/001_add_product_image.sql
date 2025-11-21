-- Migración: agregar columna para imagen de producto
ALTER TABLE products ADD COLUMN image_path VARCHAR(255) NULL AFTER description;

-- Nota: Ejecutar esta migración en la base de datos existente.
-- Ejemplo:
-- USE tomodachi_pos;
-- SOURCE c:/wamp64/www/Tomodachi/database/migrations/001_add_product_image.sql;

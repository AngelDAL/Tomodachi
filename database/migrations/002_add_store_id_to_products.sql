-- 1. Agregar columna (con valor por defecto 1 para evitar problemas de integridad iniciales)
ALTER TABLE products ADD COLUMN store_id INT NOT NULL DEFAULT 1 AFTER product_id;

-- 2. Asegurar que los datos sean válidos (asignar a tienda 1) ANTES de crear la restricción
-- Si la columna se creó sin default anteriormente, tendrá 0s. Esto los corrige.
UPDATE products SET store_id = 1 WHERE store_id = 0;

-- 3. Crear la restricción de clave foránea
ALTER TABLE products ADD CONSTRAINT fk_products_store FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE;

-- 4. Crear índice
CREATE INDEX idx_products_store ON products(store_id);

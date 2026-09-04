-- Añade visibilidad y trazabilidad de productos retirados sin borrar el registro.
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS hidden_in_pos TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
    ADD COLUMN IF NOT EXISTS discontinued_at DATETIME NULL AFTER hidden_in_pos,
    ADD INDEX IF NOT EXISTS idx_products_hidden_pos (hidden_in_pos);

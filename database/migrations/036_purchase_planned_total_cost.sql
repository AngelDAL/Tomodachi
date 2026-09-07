-- Migración 036: costo total planeado por línea de compra
-- Conserva unit_cost para compatibilidad histórica y ejecución; la interfaz usa total_cost.
ALTER TABLE purchase_items
    ADD COLUMN IF NOT EXISTS planned_total_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00
    COMMENT 'Costo total planeado de la línea (cantidad × costo de compra)' AFTER planned_quantity;

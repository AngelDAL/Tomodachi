-- Migración 035: Sistema de Compras / Reabastecimiento
-- Crea tablas purchases y purchase_items
-- Extiende cash_movements e inventory_movements con campos de referencia

-- Tabla: purchases (Órdenes de compra)
CREATE TABLE IF NOT EXISTS purchases (
    purchase_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    user_id INT NOT NULL COMMENT 'Creador de la orden',
    supplier_name VARCHAR(150) NULL COMMENT 'Nombre del proveedor (texto libre)',
    status ENUM('draft','pending','executed','cancelled') NOT NULL DEFAULT 'draft',
    notes TEXT NULL,
    total_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    executed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    INDEX idx_store_status (store_id, status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: purchase_items (Detalle de cada orden de compra)
CREATE TABLE IF NOT EXISTS purchase_items (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_id INT NOT NULL,
    product_id INT NOT NULL COMMENT 'Producto o componente a comprar',
    planned_quantity DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT 'Cantidad planeada (lista de compras)',
    actual_quantity DECIMAL(12,3) NULL COMMENT 'Cantidad real recibida (al ejecutar)',
    unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'Costo unitario pagado',
    total_cost DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'actual_quantity * unit_cost',
    lot_id INT NULL COMMENT 'Lote creado/asociado (solo componentes)',
    notes VARCHAR(255) NULL,
    FOREIGN KEY (purchase_id) REFERENCES purchases(purchase_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT,
    INDEX idx_purchase (purchase_id),
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extender cash_movements con campos de referencia
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reference_id INT NULL AFTER description;
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS reference_type VARCHAR(30) NULL COMMENT 'purchase,sale,loss' AFTER reference_id;

-- Extender inventory_movements con campos de referencia
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS reference_id INT NULL AFTER notes;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS reference_type VARCHAR(30) NULL COMMENT 'purchase,sale,loss,adjustment' AFTER reference_id;
-- Agregar nuevos tipos de movimiento al ENUM
ALTER TABLE inventory_movements MODIFY COLUMN movement_type ENUM('entry','exit','adjustment','sale','return','purchase','loss') NOT NULL;

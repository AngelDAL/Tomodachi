-- =============================================================
-- 048 — EGRESOS DE INVENTARIO (salidas)
-- =============================================================
-- El espejo de las compras: si el ingreso mete mercancía y dinero, el egreso
-- SOLO saca mercancía. Sirve para todo lo que no es una venta:
--   traspaso a otra empresa · pérdida · siniestro · caducidad · consumo interno · otro
--
-- Decisiones que se leen en el esquema:
--   * El MOTIVO es opcional (`reason` NULL = sin especificar). Preguntar el motivo no
--     puede ser un candado para sacar algo del inventario.
--   * NO hay dinero: ni costos, ni totales, ni movimiento de caja. Un egreso no cobra
--     ni paga: solo descuenta.
--   * NO hay confirmación: no existen estados borrador/pendiente. La fila nace ejecutada,
--     porque el stock se movió en la misma transacción que la insertó.
--   * El destino es INFORMACIÓN (a qué empresa/tercero salió). No acredita nada en la
--     otra empresa: cada empresa es dueña de su inventario y allá se registra su entrada.

CREATE TABLE IF NOT EXISTS inventory_exits (
    exit_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL COMMENT 'Empresa que saca la mercancía',
    user_id INT NOT NULL COMMENT 'Quién lo registró',
    reason ENUM('transfer','loss','damage','expiry','internal','other') NULL
        COMMENT 'NULL = sin especificar. transfer=traspaso, loss=pérdida, damage=siniestro, expiry=caducidad, internal=consumo interno',
    reason_note VARCHAR(255) NULL COMMENT 'Texto libre del motivo ("se cayó la charola", "robo")',
    destination_store_id INT NULL COMMENT 'Traspaso: a qué empresa del sistema sale (informativo)',
    destination_note VARCHAR(150) NULL COMMENT 'Sale a un tercero que no está en el sistema (informativo)',
    notes TEXT NULL,
    item_count INT NOT NULL DEFAULT 0,
    total_quantity DECIMAL(12,3) NOT NULL DEFAULT 0.000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    FOREIGN KEY (destination_store_id) REFERENCES stores(store_id) ON DELETE SET NULL,
    INDEX idx_exit_store_date (store_id, created_at),
    INDEX idx_exit_reason (reason),
    INDEX idx_exit_destination (destination_store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_exit_items (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    exit_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity DECIMAL(12,3) NOT NULL COMMENT 'Lo que salió, en la unidad del producto',
    previous_stock DECIMAL(12,3) NOT NULL DEFAULT 0.000 COMMENT 'Existencia antes de sacarlo',
    new_stock DECIMAL(12,3) NOT NULL DEFAULT 0.000 COMMENT 'Existencia después',
    notes VARCHAR(255) NULL,
    FOREIGN KEY (exit_id) REFERENCES inventory_exits(exit_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT,
    INDEX idx_exit_item_exit (exit_id),
    INDEX idx_exit_item_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El traspaso merece su propio tipo de movimiento: en los reportes no es lo mismo
-- que una pérdida ni que un ajuste, y "exit" ya significa "salida por venta/consumo".
ALTER TABLE inventory_movements
    MODIFY COLUMN movement_type ENUM('entry','exit','adjustment','sale','return','purchase','loss','transfer')
    NOT NULL COMMENT 'transfer=traspaso a otra empresa';

-- Migración: devoluciones/rembolsos parciales (C4)
-- Registra devoluciones de items individuales de una venta sin cancelarla,
-- con reingreso de stock y movimiento de caja negativo.
USE tomodachi_pos;
SET NAMES utf8mb4;

ALTER TABLE sales
    ADD COLUMN refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00
        COMMENT 'Monto total devuelto acumulado (devoluciones parciales)' AFTER total;

CREATE TABLE IF NOT EXISTS sale_refunds (
    refund_id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    store_id INT NOT NULL,
    user_id INT NOT NULL,
    reason VARCHAR(255) NULL,
    total_refunded DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    INDEX idx_sale (sale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_refund_items (
    refund_item_id INT AUTO_INCREMENT PRIMARY KEY,
    refund_id INT NOT NULL,
    sale_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity DECIMAL(12,3) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (refund_id) REFERENCES sale_refunds(refund_id) ON DELETE CASCADE,
    FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT,
    INDEX idx_refund (refund_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

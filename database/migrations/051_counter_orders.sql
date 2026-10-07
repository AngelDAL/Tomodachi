-- 051_counter_orders.sql — Pedidos de mostrador (clientes de paso, sin mesa)
--
-- El puesto ambulante / mostrador: la cajera anota lo que pide una persona (a nombre de
-- quién), la cocina lo ve en una pantalla de solo lectura y el cliente sigue su pedido por
-- un enlace/QR. No hay mesa ni cuenta: un pedido de mostrador es UNA orden con su folio del
-- día, su nombre de cliente y su estado (pendiente -> completado, o cancelado).
--
-- No se toca dinero ni inventario aquí: el pedido es informativo y de flujo. El cobro (si
-- procede) entra por el camino de venta existente cuando se quiera; ver AGENTS.md.

CREATE TABLE IF NOT EXISTS counter_orders (
    counter_order_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    business_date DATE NOT NULL,
    number INT NOT NULL COMMENT 'Folio del día, por tienda',
    customer_name VARCHAR(80) NULL COMMENT 'A nombre de quién va el pedido',
    tracking_token CHAR(36) NOT NULL COMMENT 'UUID v4: llave del enlace de seguimiento y canal WS del cliente',
    status ENUM('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
    notes VARCHAR(255) NULL,
    cancel_reason VARCHAR(255) NULL,
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    UNIQUE KEY uk_counter_folio (store_id, business_date, number),
    UNIQUE KEY uk_counter_token (tracking_token),
    INDEX idx_counter_store (store_id, status, business_date),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS counter_order_items (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    counter_order_id INT NOT NULL,
    product_id INT NULL,
    product_name VARCHAR(150) NOT NULL COMMENT 'Guardado al momento: si el producto cambia, el pedido no',
    quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    notes VARCHAR(255) NULL,
    line_total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_coitem_order (counter_order_id),
    FOREIGN KEY (counter_order_id) REFERENCES counter_orders(counter_order_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

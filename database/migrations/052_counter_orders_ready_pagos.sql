-- 052_counter_orders_ready_pagos.sql
--
-- Refinamientos del mostrador (7-oct-2026), pedidos por Ángel:
--   * El pedido tiene un paso "listo" (ready) entre pendiente y completado: la cajera PRIMERO
--     avisa al cliente y luego cierra. Nunca se marca completado a ciegas.
--   * Estado de PAGO del pedido: por cobrar / con adelanto / pagado completo.
--   * Presencia del cliente (¿tiene el enlace abierto?) y si activó avisos, para que la cajera
--     sepa si puede mandarle un push.
--   * Desglose de dinero: subtotal, descuento por promoción y total (las promociones aplican).

-- El estado gana 'ready'. MODIFY conserva los datos existentes.
ALTER TABLE counter_orders
    MODIFY COLUMN status ENUM('pending','ready','completed','cancelled') NOT NULL DEFAULT 'pending';

ALTER TABLE counter_orders
    ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER notes,
    ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER subtotal,
    ADD COLUMN IF NOT EXISTS payment_status ENUM('unpaid','partial','paid') NOT NULL DEFAULT 'unpaid' AFTER discount,
    ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER payment_status,
    ADD COLUMN IF NOT EXISTS notified_at DATETIME NULL AFTER completed_at,
    ADD COLUMN IF NOT EXISTS customer_seen_at DATETIME NULL COMMENT 'Última señal del enlace del cliente (¿está viendo?)' AFTER notified_at,
    ADD COLUMN IF NOT EXISTS notify_granted TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'El cliente activó avisos en su dispositivo' AFTER customer_seen_at;

-- Los descuentos por promoción se guardan POR LÍNEA para que el ticket y el cliente vean el
-- ahorro; el total del pedido sale del motor de precios (Pricing), no de sumar a mano.
ALTER TABLE counter_order_items
    ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER unit_price,
    ADD COLUMN IF NOT EXISTS promotion_name VARCHAR(120) NULL AFTER discount;

-- Suscripciones push del CLIENTE (no son de un usuario del sistema). El token del pedido es
-- la llave: `push_subscriptions` exige user_id y no sirve para un cliente anónimo.
CREATE TABLE IF NOT EXISTS counter_push_subscriptions (
    sub_id INT AUTO_INCREMENT PRIMARY KEY,
    counter_order_id INT NOT NULL,
    endpoint VARCHAR(500) NOT NULL,
    p256dh VARCHAR(300) NOT NULL,
    auth VARCHAR(200) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_counter_endpoint (endpoint(255)),
    INDEX idx_counter_sub (counter_order_id),
    FOREIGN KEY (counter_order_id) REFERENCES counter_orders(counter_order_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

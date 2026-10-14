-- 054_folio_reiniciable.sql
--
-- Numeración de tickets del mostrador REINICIABLE (pedido por Ángel, 14-oct-2026):
-- cuando la cuenta se acerca al techo («voy por el 16 y tengo 20 tickets»), la cajera puede
-- reiniciarla y los siguientes tickets vuelven a empezar en 1, SIN romper los pedidos que ya
-- están activos con 16, 17 y 18.
--
-- Cómo funciona:
--   * `counter_orders.number` NO se toca: es la identidad del pedido y la llave de
--     `uk_counter_folio (store_id, business_date, number)`. El INSERT sigue calculando
--     `COALESCE(MAX(number), 0) + 1` como siempre.
--   * Lo que se reinicia es el número que VE el cliente, y se CONGELA por pedido en
--     `counter_orders.ticket_number` = `number - base`, donde `base` es el mayor `number` del
--     día en el momento del reinicio. Congelarlo importa: si se calculara al leer, un reinicio
--     posterior cambiaría retroactivamente el número de los pedidos viejos (el 16 activo
--     pasaría a verse como -2).
--   * Los pedidos anteriores a esta migración quedan con `ticket_number` NULL y se leen como
--     `COALESCE(ticket_number, number)`: mismo número que veían antes, sin tocar datos.

CREATE TABLE IF NOT EXISTS counter_folio_resets (
    reset_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    business_date DATE NOT NULL,
    base_number INT NOT NULL COMMENT 'Mayor `number` del día en el momento de reiniciar',
    created_by INT NULL COMMENT 'Usuario que reinició (para poder auditarlo)',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_folio_resets (store_id, business_date, base_number),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE counter_orders
    ADD COLUMN IF NOT EXISTS ticket_number INT NULL
        COMMENT 'Número visible al cliente; NULL = sin reinicio en ese día (se usa number)'
        AFTER number;

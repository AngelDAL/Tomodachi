-- 043: cobro de la cuenta
--
-- Por qué: hasta hoy NINGÚN camino convertía una cuenta del salón en una venta. La cuenta
-- se podía abrir, pedir, mandar a cocina y servir, pero al final no había forma de cobrarla:
-- el dinero no podía entrar al sistema. Esta migración crea lo que falta para cobrar.
--
-- Diseño (decidido con el dueño):
--   * UNA sola venta por cuenta, con N pagos. NO una venta por comensal: eso rompería los
--     cortes de caja y las promociones, y el reporte de ventas mentiría.
--   * `sale_payments` guarda cada pago por separado: método, monto, referencia (clave de
--     rastreo de transferencia) y qué caja lo recibió. Así el desglose es auditable y la
--     cancelación puede retirar de caja SOLO el efectivo, que es la deuda que quedó pendiente.
--   * La PROPINA es opcional y va aparte: `sales.tip_amount` y sus propios renglones en
--     `sale_payments` con `is_tip = 1`. No se mezcla con el importe de lo consumido, para que
--     los reportes de venta no aparezcan inflados por las propinas.
--   * `dining_split_shares.mode` dice CÓMO se dividió (por persona, iguales, manual, por
--     monto). `share_items` guarda el reparto manual ítem por ítem para que sea auditable:
--     "yo pagué estos dos platos" tiene que poder probarse.
--   * `dining_sessions.tip_amount` guarda la propina mientras la cuenta está abierta.
--
-- Sin límite de tiempo en las cuentas (decisión del dueño, 24-sep-2026): una cuenta puede
-- quedarse abierta porque el sistema también sirve para APARTADOS y solicitudes largas. El
-- tope de minutos por carta (`menus.max_open_minutes`) queda como ajuste OPCIONAL: 0 = sin
-- límite. Por eso se pone en 0 lo que ya existía con el tope viejo de 180.
--
-- Idempotente. Las mismas tablas y columnas van en database/schema.sql para instalaciones
-- nuevas (en una base limpia el entrypoint registra las migraciones sin ejecutarlas).

-- =============================================
-- Tabla: sale_payments — los pagos de una venta
-- =============================================
CREATE TABLE IF NOT EXISTS sale_payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    store_id INT NOT NULL,
    method ENUM('cash','card','transfer','mixed','credit','codi','stripe') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    is_tip TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = es propina, no consumo',
    register_id INT NULL COMMENT 'Caja que recibió el dinero',
    share_id INT NULL COMMENT 'Parte del desglose que saldó este pago',
    reference VARCHAR(80) NULL COMMENT 'Clave de rastreo / folio de transferencia',
    verified_at DATETIME NULL COMMENT 'Cuando se verificó el comprobante (CEP)',
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_pay_sale (sale_id),
    KEY idx_pay_store (store_id, created_at),
    KEY idx_pay_share (share_id),
    FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (share_id) REFERENCES dining_split_shares(share_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Tabla: share_items — el reparto manual, ítem por ítem
-- =============================================
-- Cuando alguien decide a mano qué paga cada quien, el reparto se guarda aquí y no se
-- recalcula al vuelo: la suma de las partes tiene que cuadrar con el total de la cuenta.
CREATE TABLE IF NOT EXISTS share_items (
    share_id INT NOT NULL,
    order_item_id INT NOT NULL,
    quantity DECIMAL(12,3) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (share_id, order_item_id),
    FOREIGN KEY (share_id) REFERENCES dining_split_shares(share_id) ON DELETE CASCADE,
    FOREIGN KEY (order_item_id) REFERENCES dining_order_items(order_item_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Propina y desglose
-- =============================================
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS tip_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total;

ALTER TABLE dining_sessions
    ADD COLUMN IF NOT EXISTS tip_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total;

ALTER TABLE dining_split_shares
    ADD COLUMN IF NOT EXISTS mode ENUM('by_person','equal','by_items','by_amount','manual')
        NOT NULL DEFAULT 'manual' COMMENT 'Cómo se calculó esta parte',
    ADD COLUMN IF NOT EXISTS sale_payment_id INT NULL COMMENT 'Pago que saldó esta parte';

-- =============================================
-- Cuentas sin límite de tiempo
-- =============================================
-- 0 = sin límite (lo normal). Si un negocio quiere tope, lo pone por carta.
UPDATE menus SET max_open_minutes = 0 WHERE max_open_minutes IS NULL OR max_open_minutes <> 0;

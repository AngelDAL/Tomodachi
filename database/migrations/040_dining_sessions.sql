-- =============================================
-- Migración 040: Cuenta por mesa (flujo de pedido del comensal)
-- =============================================
-- El flujo de pedido es APARTE del punto de venta: aquí el comensal pide y
-- consume, y la cuenta se cobra al final. Una cuenta abierta NO es una venta:
-- los reportes filtran por status='completed' en todas partes, así que meterla
-- en `sales` obligaría a revisar cada consulta. Al cerrar se genera la venta
-- real por el camino que ya existe.
--
-- Puntos que definen este modelo:
--   - Varios comensales comparten UNA cuenta y se van sumando.
--   - Cada platillo queda atribuido a quien lo pidió. Eso es lo que permite
--     separar la cuenta después sin adivinar.
--   - El ítem lleva su ciclo de vida completo: es la comanda, cuando exista.
--
-- Idempotente (CREATE TABLE IF NOT EXISTS). Las mismas tablas van en
-- database/schema.sql para instalaciones nuevas.
-- =============================================

-- Tabla: dining_tables
-- Mesas / puntos de servicio. NO se reutiliza `terminals`: esa tabla la usa la
-- caja, y meter "Mesa 1" ahí rompería el selector de caja.
CREATE TABLE IF NOT EXISTS dining_tables (
    table_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    label VARCHAR(50) NOT NULL,
    zone VARCHAR(50) NULL,
    qr_token VARCHAR(64) NOT NULL COMMENT 'Token público de la mesa (va en el QR)',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_table_qr_token (qr_token),
    KEY idx_table_store (store_id, is_active),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: dining_sessions
-- LA CUENTA. Abierta por el personal; a ella se suman los comensales.
CREATE TABLE IF NOT EXISTS dining_sessions (
    session_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    table_id INT NULL,
    menu_id INT NULL,
    opened_by INT NOT NULL COMMENT 'Usuario que abrió la mesa',
    customer_id INT NULL COMMENT 'Cliente registrado, si se quiere cargar a su cuenta',
    code VARCHAR(8) NOT NULL COMMENT 'Código corto que el mesero dicta a la mesa',
    status ENUM('open','awaiting_payment','closed','cancelled') NOT NULL DEFAULT 'open',
    ordering_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'El personal puede pausar pedidos',
    -- split_mode: cómo piensan pagar. Se puede cambiar hasta el cierre.
    --   none     -> una sola cuenta
    --   equal    -> partes iguales entre los comensales activos
    --   by_items -> cada quien paga lo que pidió (usa participant_id)
    split_mode ENUM('none','equal','by_items') NOT NULL DEFAULT 'none',
    notes VARCHAR(255) NULL,
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME NULL,
    closed_by INT NULL,
    expires_at DATETIME NULL COMMENT 'Caducidad para no dejar cuentas colgadas',
    sale_id INT NULL COMMENT 'Venta generada al cerrar',
    subtotal DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    discount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_session_store (store_id, status),
    KEY idx_session_table (table_id, status),
    KEY idx_session_code (store_id, code, status),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (table_id) REFERENCES dining_tables(table_id) ON DELETE SET NULL,
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE SET NULL,
    FOREIGN KEY (opened_by) REFERENCES users(user_id) ON DELETE RESTRICT,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: dining_participants
-- Los comensales que se suman a la cuenta (uno por celular).
-- join_token es el alcance mínimo que se le da al celular: sirve para ESTA
-- cuenta y nada más.
CREATE TABLE IF NOT EXISTS dining_participants (
    participant_id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    display_name VARCHAR(60) NULL COMMENT 'Nombre que elige el comensal',
    join_token VARCHAR(64) NOT NULL,
    device_hash VARCHAR(64) NULL COMMENT 'Hash del dispositivo, para el tope por cuenta',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uk_participant_token (join_token),
    KEY idx_participant_session (session_id, is_active),
    FOREIGN KEY (session_id) REFERENCES dining_sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: dining_order_items
-- Lo pedido. participant_id es lo que permite separar la cuenta al final sin
-- preguntar otra vez quién pidió qué.
CREATE TABLE IF NOT EXISTS dining_order_items (
    order_item_id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    participant_id INT NULL COMMENT 'Quién lo pidió (NULL si lo cargó el personal)',
    product_id INT NULL COMMENT 'NULL si el producto se borró del catálogo',
    product_name VARCHAR(150) NOT NULL COMMENT 'Se guarda el nombre: la comanda no debe cambiar si el producto se renombra',
    unit_price DECIMAL(10,2) NOT NULL,
    quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
    notes VARCHAR(255) NULL,
    line_total DECIMAL(10,2) NOT NULL,
    discount_applied DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    promotion_id INT NULL,
    status ENUM('pending','sent','preparing','ready','served','cancelled') NOT NULL DEFAULT 'pending',
    added_by ENUM('customer','staff') NOT NULL DEFAULT 'customer',
    cancel_reason VARCHAR(255) NULL,
    sent_at DATETIME NULL,
    served_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_item_session (session_id, status),
    KEY idx_item_participant (participant_id),
    FOREIGN KEY (session_id) REFERENCES dining_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES dining_participants(participant_id) ON DELETE SET NULL,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: dining_split_shares
-- Cómo se reparte el cobro. En 'equal' se calcula el monto por comensal activo;
-- en 'by_items' sale de sumar los ítems de cada participante. Se guarda el
-- desglose para el ticket y para saber quién ya pagó su parte.
CREATE TABLE IF NOT EXISTS dining_split_shares (
    share_id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    participant_id INT NULL COMMENT 'NULL si es un pago externo (no de un comensal)',
    label VARCHAR(60) NULL COMMENT 'Nombre para mostrar en el desglose',
    amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    paid TINYINT(1) NOT NULL DEFAULT 0,
    paid_at DATETIME NULL,
    payment_method VARCHAR(20) NULL COMMENT 'cash/card/stripe, al momento de pagar',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_share_session (session_id),
    FOREIGN KEY (session_id) REFERENCES dining_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES dining_participants(participant_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

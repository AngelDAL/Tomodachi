-- =============================================
-- Migración 041: comandas, estaciones y salidas
-- =============================================
-- Cierra la primera mitad del flujo de servicio en mesa. Hasta ahora la CUENTA y la
-- COMANDA estaban fundidas: los ítems pasaban de 'pending' a 'sent' y no existía la
-- ronda, ni folio, ni preparación por estación, ni forma de decidir cómo sale la
-- comanda (pantalla, impresora o ninguna).
--
-- Decisión estructural: **la comanda NO depende del punto de servicio**. `session_id`
-- es NULL-able y la comanda lleva `channel`. Un pedido de mostrador, para llevar o de
-- una plataforma de reparto entra por la misma puerta. Si el modelo naciera atado a
-- `table_id`, esa integración exigiría rehacerlo.
--
-- Idempotente: se puede aplicar sobre una base que ya tenga parte del esquema (usa
-- IF NOT EXISTS y guardas por information_schema, como la 008). Las mismas tablas están
-- en database/schema.sql para instalaciones nuevas.
-- =============================================

-- Tabla: stations — dónde se prepara cada cosa. Un negocio sin preparación no tiene ninguna.
CREATE TABLE IF NOT EXISTS stations (
    station_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(50) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_station_store_name (store_id, name),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: station_outputs — cómo sale cada comanda: pantalla, impresora... o ninguna (sin filas).
CREATE TABLE IF NOT EXISTS station_outputs (
    output_id INT AUTO_INCREMENT PRIMARY KEY,
    station_id INT NOT NULL,
    kind ENUM('screen','print') NOT NULL,
    target VARCHAR(120) NULL COMMENT 'Nombre del dispositivo o impresora, libre',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_output_station (station_id, is_active),
    FOREIGN KEY (station_id) REFERENCES stations(station_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: comandas — la ronda que se prepara. session_id NULL = no viene de un punto de servicio.
CREATE TABLE IF NOT EXISTS comandas (
    comanda_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    session_id INT NULL,
    channel ENUM('service_point','counter','phone','own_delivery','delivery_uber','delivery_didi','delivery_rappi','other','system') NOT NULL DEFAULT 'service_point',
    external_ref VARCHAR(80) NULL,
    business_date DATE NOT NULL,
    number INT NOT NULL COMMENT 'Folio del día, por tienda',
    station_id INT NULL,
    status ENUM('draft','sent','preparing','ready','served','dispatched','delivered','cancelled') NOT NULL DEFAULT 'draft',
    created_by_type ENUM('customer','staff','system') NOT NULL DEFAULT 'customer',
    created_by_id INT NULL,
    notes VARCHAR(255) NULL,
    printed_count INT NOT NULL DEFAULT 0,
    sent_at DATETIME NULL,
    ready_at DATETIME NULL,
    served_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    cancel_reason VARCHAR(255) NULL,
    delivery_name VARCHAR(120) NULL,
    delivery_phone VARCHAR(30) NULL,
    delivery_address VARCHAR(255) NULL,
    delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    courier_id INT NULL,
    promised_at DATETIME NULL,
    dispatched_at DATETIME NULL,
    delivered_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_comanda_folio (store_id, business_date, number),
    INDEX idx_comanda_session (session_id, status),
    INDEX idx_comanda_station (store_id, station_id, status),
    INDEX idx_comanda_channel (store_id, channel, status),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES dining_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (station_id) REFERENCES stations(station_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: check_service_points — una cuenta con varios puntos de servicio (juntar mesas).
CREATE TABLE IF NOT EXISTS check_service_points (
    session_id INT NOT NULL,
    table_id INT NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, table_id),
    FOREIGN KEY (session_id) REFERENCES dining_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (table_id) REFERENCES dining_tables(table_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: couriers — repartidores del propio negocio.
CREATE TABLE IF NOT EXISTS couriers (
    courier_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(80) NOT NULL,
    phone VARCHAR(30) NULL,
    user_id INT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_courier_store (store_id, is_active),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── products: estación donde se prepara el producto ────────────────────────
-- Sin FK a propósito: `stations` se crea en esta misma migración y la columna es opcional.
-- NULL = se usa la estación por defecto de la tienda.
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS station_id INT DEFAULT NULL AFTER category_id,
    ADD INDEX IF NOT EXISTS idx_products_station (station_id);

-- ─── dining_order_items: el ítem sabe de qué ronda salió y quién lo prepara ──
ALTER TABLE dining_order_items
    ADD COLUMN IF NOT EXISTS comanda_id INT NULL AFTER session_id,
    ADD COLUMN IF NOT EXISTS station_id INT NULL AFTER promotion_id,
    ADD COLUMN IF NOT EXISTS ready_at DATETIME NULL AFTER served_at,
    ADD INDEX IF NOT EXISTS idx_item_comanda (comanda_id);

-- FK del ítem hacia su comanda, solo si no existe (MariaDB no admite IF NOT EXISTS aquí).
SET @tiene_fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                  WHERE CONSTRAINT_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'dining_order_items'
                    AND CONSTRAINT_NAME = 'fk_item_comanda');
SET @stmt := IF(@tiene_fk = 0,
    'ALTER TABLE dining_order_items ADD CONSTRAINT fk_item_comanda FOREIGN KEY (comanda_id) REFERENCES comandas(comanda_id) ON DELETE SET NULL',
    'SELECT 1');
PREPARE alterFkIfNotExists FROM @stmt;
EXECUTE alterFkIfNotExists;
DEALLOCATE PREPARE alterFkIfNotExists;

-- ─── Sin estaciones por defecto, a propósito ────────────────────────────────
-- NO se crea una "Cocina" automática. Hay dos razones, y las dos importan:
--
-- 1. En una instalación nueva, schema.sql crea las tablas y el entrypoint registra las
--    migraciones como aplicadas SIN ejecutarlas, así que cualquier INSERT de datos
--    "semilla" en una migración no corre por ese camino. El estado limpio es cero
--    estaciones, y eso debe ser un estado válido, no un hueco.
-- 2. El producto es para giros distintos: una barbería o una tienda no tienen cocina.
--    Inventarles una estación sería ruido en su pantalla.
--
-- Sin estaciones, la comanda vive en un solo montón (station_id NULL) y el tablero de
-- preparación simplemente no filtra: es el modo "no preparo nada" de la modularidad.
-- El dueño crea sus estaciones (Cocina, Barra, Plancha) desde su pantalla cuando las
-- necesita, y a partir de ahí sí se reparten comandas.

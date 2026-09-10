-- =============================================
-- Módulo Stripe para Tomodachi POS
-- Cobros con tarjeta (Stripe Payment Intents)
-- =============================================

-- Tabla: stripe_settings
-- Credenciales y configuración de Stripe por tienda
CREATE TABLE IF NOT EXISTS stripe_settings (
    setting_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL UNIQUE,

    -- Configuración
    enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Módulo Stripe habilitado para esta tienda',
    currency VARCHAR(3) NOT NULL DEFAULT 'mxn' COMMENT 'Moneda de cobro (ISO 4217, minúsculas)',

    -- Credenciales (la secreta NUNCA se devuelve por la API una vez guardada)
    publishable_key VARCHAR(255) NULL COMMENT 'pk_live_... / pk_test_...',
    secret_key VARCHAR(255) NULL COMMENT 'sk_live_... / sk_test_... (solo escritura)',
    webhook_secret VARCHAR(255) NULL COMMENT 'whsec_... para validar firmas de webhook',

    -- Comportamiento
    auto_complete_sale TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Marcar pago como pagado al confirmar el PaymentIntent',

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: stripe_payments
-- Un registro por PaymentIntent creado desde el POS
CREATE TABLE IF NOT EXISTS stripe_payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    user_id INT NOT NULL,
    sale_id INT NULL COMMENT 'Venta asociada una vez cobrada',

    -- Datos Stripe
    stripe_payment_intent_id VARCHAR(100) NOT NULL COMMENT 'pi_...',
    stripe_charge_id VARCHAR(100) NULL COMMENT 'ch_... una vez cobrado',

    -- Datos del cobro
    amount DECIMAL(10,2) NOT NULL COMMENT 'Monto en unidades de moneda',
    amount_cents BIGINT NOT NULL COMMENT 'Monto en centavos (lo que se envía a Stripe)',
    currency VARCHAR(3) NOT NULL DEFAULT 'mxn',
    concept VARCHAR(150) NOT NULL DEFAULT 'Cobro en tienda',

    -- Estado (espejo de los estados del PaymentIntent)
    status ENUM('requires_payment_method','requires_confirmation','requires_action','processing','succeeded','canceled','failed') NOT NULL DEFAULT 'requires_payment_method',
    last_error VARCHAR(255) NULL COMMENT 'Último mensaje de error de Stripe (genérico)',

    -- Tarjeta (solo metadata no sensible)
    card_brand VARCHAR(20) NULL COMMENT 'visa, mastercard, etc.',
    card_last4 VARCHAR(4) NULL COMMENT 'Últimos 4 dígitos',

    paid_at DATETIME NULL COMMENT 'Fecha de cobro confirmado',

    -- Auditoría
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_stripe_pi (stripe_payment_intent_id),
    INDEX idx_store (store_id),
    INDEX idx_sale (sale_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at),

    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: stripe_payment_events
-- Log de eventos de webhook (auditoría e idempotencia)
CREATE TABLE IF NOT EXISTS stripe_payment_events (
    event_id INT AUTO_INCREMENT PRIMARY KEY,
    stripe_payment_id INT NULL,
    stripe_event_id VARCHAR(100) NOT NULL COMMENT 'evt_... (idempotencia)',
    event_type VARCHAR(80) NOT NULL COMMENT 'payment_intent.succeeded, etc.',
    payload MEDIUMTEXT NULL COMMENT 'Evento completo (JSON)',
    processed TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_stripe_event (stripe_event_id),
    INDEX idx_payment (stripe_payment_id),
    INDEX idx_event_type (event_type),

    FOREIGN KEY (stripe_payment_id) REFERENCES stripe_payments(payment_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: stripe_audit_log
-- Log de auditoría de operaciones del módulo
CREATE TABLE IF NOT EXISTS stripe_audit_log (
    audit_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    user_id INT NULL,
    stripe_payment_id INT NULL,
    action VARCHAR(50) NOT NULL COMMENT 'create_intent, confirm, webhook, cancel, config',
    request_payload TEXT NULL COMMENT 'Datos enviados (sin datos sensibles)',
    response_payload TEXT NULL COMMENT 'Respuesta (sin datos sensibles)',
    http_status INT NULL,
    error_message TEXT NULL,
    ip_address VARCHAR(45) NULL,
    duration_ms INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_store (store_id),
    INDEX idx_action (action),
    INDEX idx_payment (stripe_payment_id),
    INDEX idx_created (created_at),

    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vincular ventas con cobros Stripe
ALTER TABLE sales
ADD COLUMN IF NOT EXISTS stripe_payment_id INT NULL COMMENT 'ID del cobro Stripe asociado' AFTER payment_method,
ADD INDEX IF NOT EXISTS idx_stripe_payment (stripe_payment_id);

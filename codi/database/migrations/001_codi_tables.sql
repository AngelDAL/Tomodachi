-- =============================================
-- Módulo CoDi para Tomodachi POS
-- Implementación temprana / v1
-- Tablas para pagos CoDi (Cobro Digital)
-- =============================================

-- Tabla: codi_payments
-- Almacena todas las solicitudes de pago CoDi
CREATE TABLE IF NOT EXISTS codi_payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    user_id INT NOT NULL,
    sale_id INT NULL COMMENT 'Venta asociada (si se vinculó a una venta existente)',
    
    -- Datos del pago
    amount DECIMAL(10,2) NOT NULL COMMENT 'Monto del pago',
    concept VARCHAR(150) NOT NULL COMMENT 'Concepto/descripción del pago',
    reference VARCHAR(50) NULL COMMENT 'Referencia interna (ej. folio de venta)',
    
    -- Datos del cliente (para push notification)
    customer_phone VARCHAR(20) NULL COMMENT 'Teléfcelular del cliente para push notification',
    customer_name VARCHAR(100) NULL COMMENT 'Nombre del cliente',
    
    -- Datos CoDi de Banxico
    folio_codi VARCHAR(100) NULL COMMENT 'FolioCoDi generado por Banxico',
    qr_code TEXT NULL COMMENT 'Código QR en base64',
    payment_method ENUM('qr', 'push') NOT NULL DEFAULT 'qr' COMMENT 'Método: QR o push notification',
    
    -- Estado del pago
    status ENUM('pending', 'generated', 'paid', 'expired', 'cancelled', 'failed') NOT NULL DEFAULT 'pending' COMMENT 'Estado del pago CoDi',
    expires_at DATETIME NULL COMMENT 'Fecha de expiración del QR',
    paid_at DATETIME NULL COMMENT 'Fecha de pago confirmado',
    
    -- Respuesta de Banxico
    banxico_response TEXT NULL COMMENT 'Última respuesta de Banxico (JSON)',
    
    -- Auditoría
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Índices
    INDEX idx_store (store_id),
    INDEX idx_sale (sale_id),
    INDEX idx_status (status),
    INDEX idx_folio (folio_codi),
    INDEX idx_reference (reference),
    INDEX idx_created (created_at),
    
    -- Foráneas
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: codi_payment_events
-- Log de eventos del webhook (para auditoría e idempotencia)
CREATE TABLE IF NOT EXISTS codi_payment_events (
    event_id INT AUTO_INCREMENT PRIMARY KEY,
    codi_payment_id INT NOT NULL,
    event_type VARCHAR(50) NOT NULL COMMENT 'Tipo de evento: paid, expired, cancelled, etc.',
    provider_event_id VARCHAR(100) NULL COMMENT 'ID del evento del proveedor (idempotencia)',
    payload TEXT NULL COMMENT 'Payload del evento (JSON)',
    processed TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Si ya fue procesado',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_payment (codi_payment_id),
    INDEX idx_event_type (event_type),
    INDEX idx_provider_event (provider_event_id),
    
    FOREIGN KEY (codi_payment_id) REFERENCES codi_payments(payment_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: codi_settings
-- Configuración por tienda (credenciales Banxico, etc.)
CREATE TABLE IF NOT EXISTS codi_settings (
    setting_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL UNIQUE,
    
    -- Configuración
    environment ENUM('sandbox', 'production') NOT NULL DEFAULT 'sandbox' COMMENT 'Ambiente Banxico',
    enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Módulo CoDi habilitado para esta tienda',
    
    -- Configuración de notificaciones
    notify_on_payment TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Notificar al confirmar pago',
    auto_complete_sale TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Completar venta automáticamente al confirmar pago CoDi',
    
    -- Webhook
    webhook_secret VARCHAR(255) NULL COMMENT 'Secreto para validar webhooks',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: codi_audit_log
-- Log de auditoría de todas las operaciones CoDi
CREATE TABLE IF NOT EXISTS codi_audit_log (
    audit_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    user_id INT NULL,
    codi_payment_id INT NULL,
    action VARCHAR(50) NOT NULL COMMENT 'Acción: create_qr, create_push, check_status, webhook, cancel',
    request_payload TEXT NULL COMMENT 'Datos enviados (sin datos sensibles)',
    response_payload TEXT NULL COMMENT 'Respuesta recibida',
    http_status INT NULL COMMENT 'Código HTTP de la respuesta',
    error_message TEXT NULL COMMENT 'Mensaje de error si falló',
    ip_address VARCHAR(45) NULL COMMENT 'IP del request',
    duration_ms INT NULL COMMENT 'Duración en milisegundos',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_store (store_id),
    INDEX idx_action (action),
    INDEX idx_payment (codi_payment_id),
    INDEX idx_created (created_at),
    
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Actualizar tabla sales para soportar CoDi
-- =============================================

-- Agregar método de pago CoDi a la tabla de ventas
ALTER TABLE sales 
ADD COLUMN IF NOT EXISTS codi_payment_id INT NULL COMMENT 'ID del pago CoDi asociado' AFTER payment_method,
ADD INDEX IF NOT EXISTS idx_codi_payment (codi_payment_id);

-- Agregar constante para pago CoDi (se agrega en constants.php)
-- define('PAYMENT_CODI', 'codi');

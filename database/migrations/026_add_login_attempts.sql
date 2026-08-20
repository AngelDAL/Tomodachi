-- Migración 026: tabla login_attempts (rate limiter de login / anti fuerza bruta)
-- Gestionada por includes/LoginRateLimiter.class.php.
-- Idempotente: en instalaciones limpias la tabla ya está en schema.sql y esta
-- migración simplemente se registra como aplicada; en BDs existentes la crea.
CREATE TABLE IF NOT EXISTS login_attempts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    failed_attempts INT NOT NULL DEFAULT 0 COMMENT 'Contador de fallos consecutivos actuales',
    lock_count INT NOT NULL DEFAULT 0 COMMENT 'Número de veces que la IP ha sido bloqueada (para escalar el timeout)',
    locked_until DATETIME NULL COMMENT 'NULL = sin bloqueo; fecha-hora hasta la que está bloqueada',
    last_attempt_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    last_username VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_login_ip (ip_address),
    INDEX idx_locked (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

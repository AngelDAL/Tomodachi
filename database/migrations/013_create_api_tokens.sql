-- Migración: API Tokens para integraciones externas
-- Permite que agentes/IA y aplicaciones de terceros accedan a la API
-- con un token en lugar de sesión de navegador.
USE tomodachi_pos;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS api_tokens (
    token_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(100) NOT NULL COMMENT 'Identificador del token (ej. mi-agente-ia)',
    token_hash VARCHAR(255) NOT NULL COMMENT 'Hash SHA-256 del token (nunca guardar el token plano)',
    token_prefix VARCHAR(16) NOT NULL COMMENT 'Prefijo visible para identificar el token (td_...)',
    scopes VARCHAR(255) NOT NULL DEFAULT 'read' COMMENT 'read, write, custom, o lista separada por comas',
    last_used_at DATETIME NULL,
    expires_at DATETIME NULL COMMENT 'NULL = no expira',
    revoked TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    UNIQUE KEY unique_token_hash (token_hash),
    INDEX idx_store (store_id),
    INDEX idx_revoked (revoked)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

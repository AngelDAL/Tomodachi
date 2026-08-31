-- Migración: Fase B — clientes (fiado), pagos de clientes, suscripciones push
USE tomodachi_pos;
SET NAMES utf8mb4;

-- Tabla: customers (clientes)
CREATE TABLE IF NOT EXISTS customers (
    customer_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(30) NULL,
    email VARCHAR(150) NULL,
    address VARCHAR(255) NULL,
    balance DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Saldo pendiente (fiado)',
    credit_limit DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '0 = sin límite',
    notes VARCHAR(255) NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    INDEX idx_store (store_id),
    INDEX idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: customer_payments (abonos al fiado)
CREATE TABLE IF NOT EXISTS customer_payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    store_id INT NOT NULL,
    user_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_method ENUM('cash', 'card', 'transfer') DEFAULT 'cash',
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    INDEX idx_customer (customer_id),
    INDEX idx_store_date (store_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: push_subscriptions (notificaciones FCM por terminal/dispositivo)
CREATE TABLE IF NOT EXISTS push_subscriptions (
    sub_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    user_id INT NOT NULL,
    endpoint VARCHAR(500) NOT NULL,
    p256dh VARCHAR(300) NOT NULL,
    auth VARCHAR(200) NOT NULL,
    device_name VARCHAR(100) NULL,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    UNIQUE KEY uq_endpoint (endpoint(255)),
    INDEX idx_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sales: asociar venta a cliente + método 'credit' (fiado)
ALTER TABLE sales
    ADD COLUMN customer_id INT NULL AFTER user_id,
    ADD COLUMN amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00
        COMMENT 'Monto efectivamente pagado al momento de la venta (resto = fiado)'
        AFTER total,
    ADD CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL,
    ADD INDEX idx_customer (customer_id);

-- Extender payment_method con 'credit' (fiado) y 'none' (fiado total sin pago)
ALTER TABLE sales MODIFY COLUMN payment_method ENUM('cash', 'card', 'transfer', 'mixed', 'credit') NOT NULL;


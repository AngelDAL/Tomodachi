-- Base de datos Tomodachi POS System
-- MySQL Schema

SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS tomodachi_pos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tomodachi_pos;

-- Tabla: stores (Tiendas)
CREATE TABLE stores (
    store_id INT AUTO_INCREMENT PRIMARY KEY,
    store_name VARCHAR(100) NOT NULL,
    address VARCHAR(255),
    phone VARCHAR(20),
    theme_config TEXT NULL,
    theme_config_dark TEXT NULL,
    settings TEXT NULL,
    logo_url VARCHAR(255) NULL,
    subscription_plan ENUM('free', 'premium') DEFAULT 'free',
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_subscription_plan (subscription_plan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: users (Usuarios)
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(20) NULL,
    role ENUM('super_admin', 'admin', 'manager', 'cashier') NOT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    show_onboarding TINYINT(1) DEFAULT 1,
    reset_token_hash VARCHAR(255) NULL,
    reset_token_expires_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
    INDEX idx_username (username),
    INDEX idx_store (store_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: categories (Categorías de productos)
CREATE TABLE categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL DEFAULT 1,
    category_name VARCHAR(100) NOT NULL,
    description TEXT,
    icon_class VARCHAR(80) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    INDEX idx_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: products (Productos)
CREATE TABLE products (
    product_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    category_id INT DEFAULT NULL,
    product_name VARCHAR(150) NOT NULL,
    description TEXT,
    image_path VARCHAR(255) NULL,
    barcode VARCHAR(50),
    qr_code VARCHAR(100),
    price DECIMAL(10,2) NOT NULL,
    cost DECIMAL(10,2) DEFAULT 0.00,
    current_stock DECIMAL(12,3) DEFAULT 0.000,
    min_stock DECIMAL(12,3) DEFAULT 0.000,
    status ENUM('active', 'inactive') DEFAULT 'active',
    is_bulk TINYINT(1) DEFAULT 0 COMMENT 'Indica si el producto se vende a granel (por peso/volumen)',
    bulk_unit VARCHAR(20) DEFAULT 'kg' COMMENT 'Unidad de medida para granel: kg, g, L, mL, etc.',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    UNIQUE KEY unique_store_barcode (store_id, barcode),
    UNIQUE KEY unique_store_qr_code (store_id, qr_code),
    INDEX idx_product_name (product_name),
    INDEX idx_status (status),
    INDEX idx_store (store_id),
    INDEX idx_category (category_id),
    INDEX idx_is_bulk (is_bulk)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: inventory_movements (Movimientos de inventario)
CREATE TABLE inventory_movements (
    movement_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    product_id INT NOT NULL,
    user_id INT NOT NULL,
    movement_type ENUM('entry', 'exit', 'adjustment', 'sale', 'return') NOT NULL,
    quantity DECIMAL(12,3) NOT NULL,
    previous_stock DECIMAL(12,3) NOT NULL,
    new_stock DECIMAL(12,3) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    INDEX idx_store_date (store_id, created_at),
    INDEX idx_product (product_id),
    INDEX idx_movement_type (movement_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: terminals (Terminales / Puntos de Venta)
CREATE TABLE terminals (
    terminal_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    terminal_name VARCHAR(50) NOT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: cash_registers (Cajas registradoras)
CREATE TABLE cash_registers (
    register_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    terminal_id INT DEFAULT NULL,
    user_id INT NOT NULL,
    opening_date DATETIME NOT NULL,
    closing_date DATETIME,
    initial_amount DECIMAL(10,2) NOT NULL,
    final_amount DECIMAL(10,2),
    expected_amount DECIMAL(10,2),
    difference DECIMAL(10,2),
    status ENUM('open', 'closed') DEFAULT 'open',
    notes TEXT,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
    FOREIGN KEY (terminal_id) REFERENCES terminals(terminal_id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    INDEX idx_store_status (store_id, status),
    INDEX idx_opening_date (opening_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: sales (Ventas)
CREATE TABLE sales (
    sale_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    user_id INT NOT NULL,
    customer_id INT NULL,
    register_id INT NOT NULL,
    sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    subtotal DECIMAL(10,2) NOT NULL,
    tax DECIMAL(10,2) DEFAULT 0.00,
    discount DECIMAL(10,2) DEFAULT 0.00,
    total DECIMAL(10,2) NOT NULL,
    amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Monto efectivamente pagado al momento de la venta (resto = fiado)',
    payment_method ENUM('cash', 'card', 'transfer', 'mixed', 'credit') NOT NULL,
    status ENUM('completed', 'cancelled', 'refunded') DEFAULT 'completed',
    refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Monto total devuelto acumulado (devoluciones parciales)',
    created_via VARCHAR(10) NOT NULL DEFAULT 'session' COMMENT 'session = interfaz (humano), token = API/agente',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL,
    FOREIGN KEY (register_id) REFERENCES cash_registers(register_id) ON DELETE RESTRICT,
    INDEX idx_store_date (store_id, sale_date),
    INDEX idx_status (status),
    INDEX idx_customer (customer_id),
    INDEX idx_register (register_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: sale_details (Detalle de ventas)
CREATE TABLE sale_details (
    detail_id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity DECIMAL(12,3) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    unit_cost DECIMAL(10,2) NULL DEFAULT NULL COMMENT 'Costo unitario histórico al momento de la venta',
    subtotal DECIMAL(10,2) NOT NULL,
    discount DECIMAL(10,2) DEFAULT 0.00,
    promotion_id INT NULL DEFAULT NULL COMMENT 'Promoción aplicada a la línea (si aplicó)',
    total DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT,
    INDEX idx_sale (sale_id),
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: sale_refunds (Devoluciones/rembolsos parciales)
CREATE TABLE sale_refunds (
    refund_id INT AUTO_INCREMENT PRIMARY KEY,
    sale_id INT NOT NULL,
    store_id INT NOT NULL,
    user_id INT NOT NULL,
    reason VARCHAR(255) NULL,
    total_refunded DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    INDEX idx_sale (sale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: sale_refund_items (Items devueltos)
CREATE TABLE sale_refund_items (
    refund_item_id INT AUTO_INCREMENT PRIMARY KEY,
    refund_id INT NOT NULL,
    sale_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity DECIMAL(12,3) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (refund_id) REFERENCES sale_refunds(refund_id) ON DELETE CASCADE,
    FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT,
    INDEX idx_refund (refund_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: cash_movements (Movimientos de caja)
CREATE TABLE cash_movements (
    movement_id INT AUTO_INCREMENT PRIMARY KEY,
    register_id INT NOT NULL,
    user_id INT NOT NULL,
    movement_type ENUM('entry', 'withdrawal', 'sale') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (register_id) REFERENCES cash_registers(register_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    INDEX idx_register (register_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: customers (Clientes / fiado)
CREATE TABLE customers (
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

-- Tabla: customer_payments (Abonos al fiado)
CREATE TABLE customer_payments (
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

-- Tabla: push_subscriptions (Notificaciones FCM)
CREATE TABLE push_subscriptions (
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

-- Tabla: api_tokens (Tokens para integraciones externas / agentes IA)
CREATE TABLE api_tokens (
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

-- Tabla: promotions (Promociones)
CREATE TABLE promotions (
    promotion_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    start_date DATETIME NOT NULL,
    end_date DATETIME NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    type ENUM('simple_discount', 'bulk_discount', 'bundle', 'bill_discount') NOT NULL,
    discount_type ENUM('percentage', 'fixed_amount', 'fixed_price') NOT NULL,
    discount_value DECIMAL(10,2) NOT NULL,
    min_purchase_amount DECIMAL(10,2) DEFAULT 0,
    min_quantity INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: promotion_targets (Items/Objetivos de la Promoción)
CREATE TABLE promotion_targets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    promotion_id INT NOT NULL,
    product_id INT NULL,
    category_id INT NULL,
    FOREIGN KEY (promotion_id) REFERENCES promotions(promotion_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Datos iniciales

-- Insertar tienda principal
INSERT INTO stores (store_name, address, phone, status) VALUES
('Tienda Principal', 'Calle Principal #123, Ciudad', '555-1234', 'active');

-- Insertar terminal por defecto
INSERT INTO terminals (store_id, terminal_name) VALUES
(1, 'Caja Principal');

-- Insertar categorías de ejemplo
INSERT INTO categories (store_id, category_name, description, icon_class) VALUES
(1, 'Bebidas', 'Bebidas frías y calientes', 'fa-mug-hot'),
(1, 'Snacks', 'Botanas y dulces', 'fa-cookie-bite'),
(1, 'Abarrotes', 'Productos de despensa', 'fa-basket-shopping'),
(1, 'Lácteos', 'Productos lácteos y derivados', 'fa-cheese');

-- Insertar usuario administrador (password: admin123)
INSERT INTO users (store_id, username, password_hash, full_name, email, role, status) VALUES
(1, 'admin', '$2y$10$rDGCkOinf6RJ2ywtMU6QYeeTNkqq4/soMpsxdF4wO9lqIRTrjfP2a', 'Administrador', 'admin@tomodachi.com', 'admin', 'active');

-- Productos de ejemplo
INSERT INTO products (store_id, category_id, product_name, description, barcode, price, cost, current_stock, min_stock, status) VALUES
(1, 1, 'Coca Cola 600ml', 'Refresco de cola', '7501234567890', 15.50, 10.00, 50, 20, 'active'),
(1, 1, 'Agua Natural 1L', 'Agua purificada', '7501234567891', 10.00, 6.00, 60, 30, 'active'),
(1, 2, 'Sabritas Original 45g', 'Papas fritas', '7501234567892', 18.00, 12.00, 40, 25, 'active'),
(1, 2, 'Galletas Marías', 'Galletas tradicionales', '7501234567893', 12.00, 8.00, 35, 20, 'active'),
(1, 3, 'Arroz 1kg', 'Arroz blanco', '7501234567894', 25.00, 18.00, 30, 15, 'active'),
(1, 4, 'Leche Entera 1L', 'Leche pasteurizada', '7501234567895', 22.00, 16.00, 45, 20, 'active');

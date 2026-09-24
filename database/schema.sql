-- Base de datos Tomodachi POS System
-- MySQL Schema

SET NAMES utf8mb4;

-- Este archivo NO crea ni selecciona la base: se carga SOBRE una base ya elegida, y el
-- nombre lo decide quien instala (DB_NAME en docker-compose.yml). Antes traía
-- `CREATE DATABASE tomodachi_pos` + `USE tomodachi_pos` fijos, y eso rompía dos cosas:
-- una instalación con otro nombre de base quedaba vacía, y la herramienta que prueba el
-- schema en una base limpia escribía siempre en la base real.
--   Docker:   lo carga docker/entrypoint.sh con ${DB_NAME}
--   Manual:   mysql -u usuario -p nombre_de_la_base < database/schema.sql

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
    onboarding_seen TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'La bienvenida inicial global ya fue reclamada',
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
    role ENUM('super_admin', 'admin', 'manager', 'cashier', 'waiter') NOT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    show_onboarding TINYINT(1) DEFAULT 1,
    reset_token_hash VARCHAR(255) NULL,
    reset_token_expires_at DATETIME NULL,
    must_change_password TINYINT(1) NOT NULL DEFAULT 0,
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
    -- Estación donde se prepara (Cocina, Barra...). NULL = la estación por defecto de la
    -- tienda. Sin FK a propósito: `stations` se define más abajo en este mismo archivo y
    -- la columna es opcional (ver migración 041).
    station_id INT DEFAULT NULL,
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
    hidden_in_pos TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Producto oculto en el punto de venta',
    discontinued_at DATETIME NULL COMMENT 'Fecha de descontinuación (trazabilidad, no se borra el registro)',
    is_bulk TINYINT(1) DEFAULT 0 COMMENT 'Indica si el producto se vende a granel (por peso/volumen)',
    unit_type ENUM('unit', 'kg', 'g', 'l', 'ml', 'm') NOT NULL DEFAULT 'unit' COMMENT 'Unidad de venta: unit=pieza, kg/g/l/ml/m=medida',
    bulk_unit VARCHAR(20) DEFAULT 'kg' COMMENT 'Unidad de medida para granel: kg, g, L, mL, etc.',
    tracking_type ENUM('stock','recipe','component','none') NOT NULL DEFAULT 'stock' COMMENT 'stock=producto final, recipe=ensamblado (stock derivado de receta), component=materia prima con presentaciones, none=sin inventario',
    consume_mode ENUM('fifo','lifo','manual') NOT NULL DEFAULT 'fifo' COMMENT 'Orden de consumo de presentaciones: fifo (mas antiguo), lifo (mas reciente), manual (seleccion explicita)',
    pieces_per_box INT UNSIGNED NULL DEFAULT NULL COMMENT 'Piezas por unidad comercial (caja/lote). NULL o 0 = sin seguimiento por lotes',
    is_ingredient TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Puede usarse como ingrediente de recetas',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    UNIQUE KEY unique_store_barcode (store_id, barcode),
    UNIQUE KEY unique_store_qr_code (store_id, qr_code),
    INDEX idx_product_name (product_name),
    INDEX idx_status (status),
    INDEX idx_products_hidden_pos (hidden_in_pos),
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
    movement_type ENUM('entry', 'exit', 'adjustment', 'sale', 'return', 'purchase', 'loss') NOT NULL,
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

-- Tabla: product_ingredients (Recetas / BOM)
-- Relaciona un producto ensamblado (tracking_type='recipe') con los ingredientes
-- que lo componen y la cantidad de cada uno por UNA unidad del ensamblado.
CREATE TABLE IF NOT EXISTS product_ingredients (
    recipe_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL COMMENT 'Producto ensamblado (tracking_type=recipe)',
    component_id INT NOT NULL COMMENT 'Ingrediente que compone el producto',
    quantity DECIMAL(12,3) NOT NULL DEFAULT 1.000 COMMENT 'Cantidad del ingrediente por UNA unidad ensamblada',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_recipe_component (product_id, component_id),
    KEY idx_recipe_product (product_id),
    KEY idx_recipe_component (component_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (component_id) REFERENCES products(product_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: product_lots (Presentaciones / lotes de un componente)
-- Cada fila es una compra/presentación del componente con su cantidad (en la
-- unidad del componente) y su costo unitario propio. Disponible = Σ cantidades;
-- costo unitario = promedio ponderado (Σ qty×costo ÷ Σ qty); se consume FIFO.
CREATE TABLE IF NOT EXISTS product_lots (
    lot_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    product_id INT NOT NULL COMMENT 'Componente dueño de la presentación',
    label VARCHAR(120) NULL COMMENT 'Etiqueta de la presentación (p.ej. Granel 3kg, Bolsa 5kg)',
    quantity DECIMAL(12,3) NOT NULL DEFAULT 0.000 COMMENT 'Cantidad actual en la unidad del componente',
    unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Costo por unidad de este lote (valor pagado ÷ cantidad)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_lot_product (product_id),
    KEY idx_lot_store (store_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
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
    tip_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Propina, opcional. Va aparte del consumo para no inflar los reportes de venta',
    amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Monto efectivamente pagado al momento de la venta (resto = fiado)',
    payment_method ENUM('cash', 'card', 'transfer', 'mixed', 'credit', 'codi', 'stripe') NOT NULL,
    codi_payment_id INT NULL COMMENT 'ID del pago CoDi asociado (módulo CoDi)',
    stripe_payment_id INT NULL COMMENT 'ID del cobro Stripe asociado (módulo Stripe)',
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
    INDEX idx_register (register_id),
    INDEX idx_codi_payment (codi_payment_id),
    INDEX idx_stripe_payment (stripe_payment_id)
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

-- Tabla: login_attempts (Rate limiter de login / anti fuerza bruta)
-- Registra intentos de login fallidos por IP para bloquearla temporalmente.
-- La gestiona includes/LoginRateLimiter.class.php.
CREATE TABLE login_attempts (
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

-- Etiquetas reutilizables de productos (para filtros y promociones).
CREATE TABLE product_tags (
    tag_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(80) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_product_tag_store_name (store_id, name),
    INDEX idx_product_tags_store (store_id),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_tag_assignments (
    product_id INT NOT NULL,
    tag_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, tag_id),
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES product_tags(tag_id) ON DELETE CASCADE
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
    bulk_pay_quantity INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: promotion_targets (Items/Objetivos de la Promoción)
CREATE TABLE promotion_targets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    promotion_id INT NOT NULL,
    product_id INT NULL,
    category_id INT NULL,
    tag_id INT NULL,
    required_quantity INT NOT NULL DEFAULT 1,
    FOREIGN KEY (promotion_id) REFERENCES promotions(promotion_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES product_tags(tag_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Pantallas Digitales (contenido consolidad de migraciones 019-024)
-- Tabla: digital_boards (Boards / tableros de pantallas)
CREATE TABLE digital_boards (
    board_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 0,
    orientation ENUM('horizontal', 'vertical', 'auto') NOT NULL DEFAULT 'auto',
    slide_duration INT NOT NULL DEFAULT 10 COMMENT 'Segundos por slide',
    transition_animation ENUM('fade', 'slide_left', 'slide_up', 'zoom', 'none') NOT NULL DEFAULT 'fade',
    theme_config JSON NULL COMMENT 'Colores, fuentes, fondo',
    template VARCHAR(50) NULL COMMENT 'restaurant, retail, pharmacy, etc.',
    scheduled_start DATETIME NULL COMMENT 'Activación automática (null = manual)',
    scheduled_end DATETIME NULL COMMENT 'Desactivación automática (null = indefinido)',
    show_qr TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Mostrar QR en pantalla pública',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_store_active (store_id, is_active),
    INDEX idx_scheduled (scheduled_start, scheduled_end),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: board_slides (Diapositivas)
CREATE TABLE board_slides (
    slide_id INT AUTO_INCREMENT PRIMARY KEY,
    board_id INT NOT NULL,
    orientation ENUM('auto','horizontal','vertical') NOT NULL DEFAULT 'auto',
    layout_width INT NULL,
    layout_height INT NULL,
    position INT NOT NULL DEFAULT 0 COMMENT 'Orden de aparición',
    title VARCHAR(100) NULL,
    grid_cols INT NOT NULL DEFAULT 3,
    grid_rows INT NOT NULL DEFAULT 2,
    enter_animation ENUM('fade', 'slide_up', 'scale_in', 'none') NOT NULL DEFAULT 'fade',
    exit_animation ENUM('fade', 'slide_up', 'scale_out', 'none') NOT NULL DEFAULT 'fade',
    custom_duration INT NULL COMMENT 'Override de slide_duration (segundos)',
    background_color VARCHAR(20) NULL,
    background_image VARCHAR(500) NULL COMMENT 'URL de imagen de fondo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_board_position (board_id, position),
    FOREIGN KEY (board_id) REFERENCES digital_boards(board_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: slide_elements (Elementos de cada diapositiva)
CREATE TABLE slide_elements (
    element_id INT AUTO_INCREMENT PRIMARY KEY,
    slide_id INT NOT NULL,
    element_type ENUM('product_card', 'image', 'text', 'category_grid', 'banner', 'clock') NOT NULL,
    grid_col INT NOT NULL DEFAULT 1,
    grid_row INT NOT NULL DEFAULT 1,
    col_span INT NOT NULL DEFAULT 1,
    row_span INT NOT NULL DEFAULT 1,
    z_index INT NOT NULL DEFAULT 1,
    content JSON NOT NULL COMMENT 'Datos del elemento según tipo',
    animation ENUM('fade_in', 'slide_up', 'scale_in', 'stagger', 'none') NOT NULL DEFAULT 'fade_in',
    animation_delay FLOAT NOT NULL DEFAULT 0 COMMENT 'Segundos de delay antes de animar',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_slide_position (slide_id, grid_col, grid_row),
    FOREIGN KEY (slide_id) REFERENCES board_slides(slide_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: digital_signage_media (Medios subidos)
CREATE TABLE digital_signage_media (
    media_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    file_size INT NOT NULL,
    width INT NULL,
    height INT NULL,
    tags VARCHAR(255) NULL COMMENT 'Tags para organizar: navidad, halloween, etc.',
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_store (store_id),
    INDEX idx_tags (tags),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: digital_board_slide_assignments (Slides reutilizadas entre boards)
CREATE TABLE digital_board_slide_assignments (
    assignment_id INT AUTO_INCREMENT PRIMARY KEY,
    board_id INT NOT NULL,
    source_slide_id INT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    custom_duration INT NULL COMMENT 'Override opcional para este uso de la slide',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_board_source_slide (board_id, source_slide_id),
    KEY idx_board_position (board_id, position),
    KEY idx_source_slide (source_slide_id),
    CONSTRAINT fk_assignment_board FOREIGN KEY (board_id) REFERENCES digital_boards(board_id) ON DELETE CASCADE,
    CONSTRAINT fk_assignment_source_slide FOREIGN KEY (source_slide_id) REFERENCES board_slides(slide_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: display_groups (Escenas multi-pantalla sincronizadas)
CREATE TABLE display_groups (
    group_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(120) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 0,
    bg_color VARCHAR(20) NULL COMMENT 'color de fondo del lienzo del grupo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_store_group (store_id, is_active),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: display_group_screens (Pantallas de cada grupo/escena)
CREATE TABLE display_group_screens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT NOT NULL,
    label VARCHAR(100) NULL,
    pos_x FLOAT NOT NULL DEFAULT 0,
    pos_y FLOAT NOT NULL DEFAULT 0,
    w_pct FLOAT NOT NULL DEFAULT 33.33,
    h_pct FLOAT NOT NULL DEFAULT 100,
    orientation ENUM('horizontal','vertical') NOT NULL DEFAULT 'horizontal',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES display_groups(group_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: display_group_screen_slides (Rotación independiente por pantalla)
CREATE TABLE display_group_screen_slides (
    id INT AUTO_INCREMENT PRIMARY KEY,
    screen_id INT NOT NULL,
    position INT NOT NULL DEFAULT 0 COMMENT 'orden de la diapositiva en esa pantalla',
    source_slide_id INT NOT NULL COMMENT 'diapositiva maestra (board_slides) que se muestra en esa pantalla',
    custom_duration INT NULL COMMENT 'duracion en segundos (null = usar default del escenario)',
    transition VARCHAR(20) NOT NULL DEFAULT 'fade'
        COMMENT 'transición al mostrar esta diapositiva (fade, slide_left, slide_up, slide_right, zoom, none)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_screen_pos (screen_id, position),
    FOREIGN KEY (screen_id) REFERENCES display_group_screens(id) ON DELETE CASCADE,
    FOREIGN KEY (source_slide_id) REFERENCES board_slides(slide_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: display_group_steps (Secuencia coordinada global; legado de migración 022)
CREATE TABLE display_group_steps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT NOT NULL,
    step_order INT NOT NULL DEFAULT 0 COMMENT 'indice de la pasada coordinada',
    screen_id INT NOT NULL,
    source_slide_id INT NOT NULL COMMENT 'diapositiva maestra que muestra esta pantalla en este paso',
    custom_duration INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_group_step_screen (group_id, step_order, screen_id),
    FOREIGN KEY (group_id) REFERENCES display_groups(group_id) ON DELETE CASCADE,
    FOREIGN KEY (screen_id) REFERENCES display_group_screens(id) ON DELETE CASCADE,
    FOREIGN KEY (source_slide_id) REFERENCES board_slides(slide_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Sistema de Compras / Reabastecimiento (migración 035)
-- Tabla: purchases (Órdenes de compra)
CREATE TABLE IF NOT EXISTS purchases (
    purchase_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    user_id INT NOT NULL COMMENT 'Creador de la orden',
    supplier_name VARCHAR(150) NULL COMMENT 'Nombre del proveedor (texto libre)',
    status ENUM('draft','pending','executed','cancelled') NOT NULL DEFAULT 'draft',
    notes TEXT NULL,
    total_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    executed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    INDEX idx_store_status (store_id, status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: purchase_items (Detalle de cada orden de compra)
CREATE TABLE IF NOT EXISTS purchase_items (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    purchase_id INT NOT NULL,
    product_id INT NOT NULL COMMENT 'Producto o componente a comprar',
    planned_quantity DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT 'Cantidad planeada (lista de compras)',
    planned_total_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Costo total planeado de la línea',
    actual_quantity DECIMAL(12,3) NULL COMMENT 'Cantidad real recibida (al ejecutar)',
    unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'Costo unitario pagado',
    total_cost DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'actual_quantity * unit_cost',
    lot_id INT NULL COMMENT 'Lote creado/asociado (solo componentes)',
    notes VARCHAR(255) NULL,
    FOREIGN KEY (purchase_id) REFERENCES purchases(purchase_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT,
    INDEX idx_purchase (purchase_id),
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extender cash_movements con campos de referencia
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'cash_movements' AND column_name = 'reference_id');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE cash_movements ADD COLUMN reference_id INT NULL AFTER description, ADD COLUMN reference_type VARCHAR(30) NULL COMMENT \'purchase,sale,loss\' AFTER reference_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Extender inventory_movements con campos de referencia
SET @col_exists2 = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'reference_id');
SET @sql2 = IF(@col_exists2 = 0, 'ALTER TABLE inventory_movements ADD COLUMN reference_id INT NULL AFTER notes, ADD COLUMN reference_type VARCHAR(30) NULL COMMENT \'purchase,sale,loss,adjustment\' AFTER reference_id', 'SELECT 1');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- Datos iniciales

-- Insertar tienda principal
INSERT INTO stores (store_name, address, phone, status, theme_config, theme_config_dark) VALUES
(
    'Tienda Principal', 'Calle Principal #123, Ciudad', '555-1234', 'active',
    JSON_OBJECT(
        'primary_color', '#39C5BB', 'secondary_color', '#0E86A6',
        'success_color', '#4CAF50', 'danger_color', '#F44336',
        'warning_color', '#FF9800', 'info_color', '#0E86A6',
        'dark_color', '#1A1A2E', 'bg_body', '#F4F7F6',
        'text_color', '#1A1A2E', 'bg_card', '#FFFFFF',
        'border_color', '#E0E0E0', 'theme_mode', 'light', 'dark_mode', FALSE
    ),
    JSON_OBJECT(
        'primary_color', '#4FDDD2', 'secondary_color', '#61C2E8',
        'success_color', '#66BB6A', 'danger_color', '#EF5350',
        'warning_color', '#FFB74D', 'info_color', '#61C2E8',
        'dark_color', '#0C2B29', 'bg_body', '#0E2220',
        'text_color', '#E0F2F0', 'bg_card', '#16322F',
        'border_color', '#2A4D49'
    )
);

-- Insertar terminal por defecto
INSERT INTO terminals (store_id, terminal_name) VALUES
(1, 'Caja Principal');

-- Instalación limpia: no se siembran categorías ni productos de ejemplo.
-- El catálogo comienza vacío; el usuario los crea desde Inventario o al
-- registrarse con su propia empresa.
-- (Comentado para no crear datos demo)
-- INSERT INTO categories (store_id, category_name, description, icon_class) VALUES
-- (1, 'Bebidas', 'Bebidas frías y calientes', 'fa-mug-hot'),
-- (1, 'Snacks', 'Botanas y dulces', 'fa-cookie-bite'),
-- (1, 'Abarrotes', 'Productos de despensa', 'fa-basket-shopping'),
-- (1, 'Lácteos', 'Productos lácteos y derivados', 'fa-cheese');

-- Insertar usuario administrador (password: admin123, cambio obligatorio al primer acceso)
INSERT INTO users (store_id, username, password_hash, full_name, email, role, status, must_change_password) VALUES
(1, 'admin', '$2y$10$rDGCkOinf6RJ2ywtMU6QYeeTNkqq4/soMpsxdF4wO9lqIRTrjfP2a', 'Administrador', 'admin@tomodachi.com', 'admin', 'active', 1);

-- Configuración global de la instalación (no por navegador)
CREATE TABLE app_settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    setting_value TEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Beneficio inicial de la instalación: lo ve SOLO la primera persona que
-- accede (antes de crear cuenta); al mostrarse/terminarse se marca '1' en
-- BD y el resto (cualquier visitante o sesión) va directo a login.
INSERT INTO app_settings (setting_key, setting_value) VALUES ('welcome_seen', '0');

-- Productos de ejemplo: eliminados para una instalación completamente limpia.
-- El catálogo nace vacío (0 productos). La empresa se crea vía registro y sus
-- productos se añaden desde Inventario.
-- INSERT INTO products (...) VALUES (...);

-- =============================================
-- Módulo Stripe (cobros con tarjeta)
-- =============================================

-- Tabla: stripe_settings (credenciales y configuración por tienda)
CREATE TABLE stripe_settings (
    setting_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL UNIQUE,
    enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Módulo Stripe habilitado para esta tienda',
    currency VARCHAR(3) NOT NULL DEFAULT 'mxn' COMMENT 'Moneda de cobro (ISO 4217, minúsculas)',
    publishable_key VARCHAR(255) NULL COMMENT 'pk_live_... / pk_test_...',
    secret_key VARCHAR(255) NULL COMMENT 'sk_live_... / sk_test_... (solo escritura)',
    webhook_secret VARCHAR(255) NULL COMMENT 'whsec_... para validar firmas de webhook',
    auto_complete_sale TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Marcar pago como pagado al confirmar el PaymentIntent',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: stripe_payments (un registro por PaymentIntent creado desde el POS)
CREATE TABLE stripe_payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    user_id INT NOT NULL,
    sale_id INT NULL COMMENT 'Venta asociada una vez cobrada',
    stripe_payment_intent_id VARCHAR(100) NOT NULL COMMENT 'pi_...',
    stripe_charge_id VARCHAR(100) NULL COMMENT 'ch_... una vez cobrado',
    amount DECIMAL(10,2) NOT NULL COMMENT 'Monto en unidades de moneda',
    amount_cents BIGINT NOT NULL COMMENT 'Monto en centavos (lo que se envía a Stripe)',
    currency VARCHAR(3) NOT NULL DEFAULT 'mxn',
    concept VARCHAR(150) NOT NULL DEFAULT 'Cobro en tienda',
    status ENUM('requires_payment_method','requires_confirmation','requires_action','processing','succeeded','canceled','failed') NOT NULL DEFAULT 'requires_payment_method',
    last_error VARCHAR(255) NULL COMMENT 'Último mensaje de error de Stripe (genérico)',
    card_brand VARCHAR(20) NULL COMMENT 'visa, mastercard, etc.',
    card_last4 VARCHAR(4) NULL COMMENT 'Últimos 4 dígitos',
    paid_at DATETIME NULL COMMENT 'Fecha de cobro confirmado',
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

-- Tabla: stripe_payment_events (webhook: auditoría e idempotencia)
CREATE TABLE stripe_payment_events (
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

-- Tabla: stripe_audit_log (auditoría de operaciones del módulo)
CREATE TABLE stripe_audit_log (
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

-- =============================================
-- Módulo CoDi (cobros con QR / push)
-- =============================================

-- Tabla: codi_payments (solicitudes de pago CoDi)
CREATE TABLE codi_payments (
    payment_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    user_id INT NOT NULL,
    sale_id INT NULL COMMENT 'Venta asociada (si se vinculó a una venta existente)',
    amount DECIMAL(10,2) NOT NULL COMMENT 'Monto del pago',
    concept VARCHAR(150) NOT NULL COMMENT 'Concepto/descripción del pago',
    reference VARCHAR(50) NULL COMMENT 'Referencia interna (ej. folio de venta)',
    customer_phone VARCHAR(20) NULL COMMENT 'Teléfono del cliente para push notification',
    customer_name VARCHAR(100) NULL COMMENT 'Nombre del cliente',
    folio_codi VARCHAR(100) NULL COMMENT 'FolioCoDi generado por el proveedor',
    qr_code TEXT NULL COMMENT 'Código QR en base64',
    payment_method ENUM('qr', 'push') NOT NULL DEFAULT 'qr' COMMENT 'Método: QR o push notification',
    status ENUM('pending', 'generated', 'paid', 'expired', 'cancelled', 'failed') NOT NULL DEFAULT 'pending' COMMENT 'Estado del pago CoDi',
    expires_at DATETIME NULL COMMENT 'Fecha de expiración del QR',
    paid_at DATETIME NULL COMMENT 'Fecha de pago confirmado',
    banxico_response TEXT NULL COMMENT 'Última respuesta del proveedor (JSON)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_store (store_id),
    INDEX idx_sale (sale_id),
    INDEX idx_status (status),
    INDEX idx_folio (folio_codi),
    INDEX idx_reference (reference),
    INDEX idx_created (created_at),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
    FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: codi_payment_events (webhook: auditoría e idempotencia)
CREATE TABLE codi_payment_events (
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

-- Tabla: codi_settings (configuración por tienda)
CREATE TABLE codi_settings (
    setting_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL UNIQUE,
    environment ENUM('sandbox', 'production') NOT NULL DEFAULT 'sandbox' COMMENT 'Ambiente del proveedor',
    enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Módulo CoDi habilitado para esta tienda',
    notify_on_payment TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Notificar al confirmar pago',
    auto_complete_sale TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Completar venta automáticamente al confirmar pago CoDi',
    webhook_secret VARCHAR(255) NULL COMMENT 'Secreto para validar webhooks',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- Menú de clientes (carta digital por QR)
-- Ver database/migrations/039_customer_menu.sql
-- =============================================

-- Tabla: menus (la carta configurable que el dueño publica)
CREATE TABLE menus (
    menu_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    mode ENUM('menu_only','order_and_pay','open_tab') NOT NULL DEFAULT 'menu_only',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    public_token VARCHAR(64) NOT NULL COMMENT 'Token público que viaja en el QR',
    require_staff_unlock TINYINT(1) NOT NULL DEFAULT 0,
    allow_notes TINYINT(1) NOT NULL DEFAULT 1,
    max_open_minutes INT NOT NULL DEFAULT 0 COMMENT 'Tope de minutos de una cuenta abierta. 0 = SIN LÍMITE (lo normal: el sistema también sirve para apartados y solicitudes largas)',
    welcome_message VARCHAR(255) NULL,
    cover_image VARCHAR(255) NULL,
    show_promotions TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_menu_public_token (public_token),
    INDEX idx_menu_store (store_id, is_active),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: menu_items (qué entra en la carta: producto, categoría o etiqueta)
CREATE TABLE menu_items (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    menu_id INT NOT NULL,
    kind ENUM('product','category','tag') NOT NULL DEFAULT 'product',
    product_id INT NULL,
    category_id INT NULL,
    tag_id INT NULL,
    section VARCHAR(80) NULL,
    display_order INT NOT NULL DEFAULT 0,
    is_featured TINYINT(1) NOT NULL DEFAULT 0,
    is_hidden TINYINT(1) NOT NULL DEFAULT 0,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_menu_item_menu (menu_id, display_order),
    INDEX idx_menu_item_product (product_id),
    INDEX idx_menu_item_category (category_id),
    INDEX idx_menu_item_tag (tag_id),
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES product_tags(tag_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: menu_visits (conteo de accesos por QR)
CREATE TABLE menu_visits (
    visit_id INT AUTO_INCREMENT PRIMARY KEY,
    menu_id INT NOT NULL,
    origin_hash VARCHAR(64) NULL COMMENT 'Hash del origen (privacidad)',
    user_agent VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_menu_visit_menu (menu_id, created_at),
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: codi_audit_log (auditoría de operaciones)
CREATE TABLE codi_audit_log (
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
-- Cuenta por mesa (flujo de pedido del comensal)
-- Ver database/migrations/040_dining_sessions.sql
-- =============================================

CREATE TABLE dining_tables (
    table_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    label VARCHAR(50) NOT NULL,
    zone VARCHAR(50) NULL,
    qr_token VARCHAR(64) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_table_qr_token (qr_token),
    INDEX idx_table_store (store_id, is_active),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: dining_sessions
-- LA CUENTA. Abierta por el personal; a ella se suman los comensales.
CREATE TABLE dining_sessions (
    session_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    table_id INT NULL,
    menu_id INT NULL,
    opened_by INT NOT NULL,
    customer_id INT NULL,
    code VARCHAR(8) NOT NULL,
    status ENUM('open','awaiting_payment','closed','cancelled') NOT NULL DEFAULT 'open',
    ordering_enabled TINYINT(1) NOT NULL DEFAULT 1,
    -- split_mode: cómo piensan pagar. Se puede cambiar hasta el cierre.
    --   none     -> una sola cuenta
    --   equal    -> partes iguales entre los comensales activos
    --   by_items -> cada quien paga lo que pidió (usa participant_id)
    split_mode ENUM('none','equal','by_items') NOT NULL DEFAULT 'none',
    notes VARCHAR(255) NULL,
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME NULL,
    closed_by INT NULL,
    expires_at DATETIME NULL,
    sale_id INT NULL,
    subtotal DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    discount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    tip_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Propina acordada, opcional',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_session_store (store_id, status),
    INDEX idx_session_table (table_id, status),
    INDEX idx_session_code (store_id, code, status),
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
CREATE TABLE dining_participants (
    participant_id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    display_name VARCHAR(60) NULL,
    join_token VARCHAR(64) NOT NULL,
    device_hash VARCHAR(64) NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uk_participant_token (join_token),
    INDEX idx_participant_session (session_id, is_active),
    FOREIGN KEY (session_id) REFERENCES dining_sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: stations
-- Dónde se prepara cada cosa (Cocina, Barra, Plancha). Un negocio sin preparación no
-- necesita ninguna. Ver database/migrations/041_comandas_y_salidas.sql
CREATE TABLE stations (
    station_id INT AUTO_INCREMENT PRIMARY KEY,
    store_id INT NOT NULL,
    name VARCHAR(50) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_station_store_name (store_id, name),
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: station_outputs
-- Cómo sale cada comanda de cada estación: pantalla, impresora... o ninguna (sin filas).
CREATE TABLE station_outputs (
    output_id INT AUTO_INCREMENT PRIMARY KEY,
    station_id INT NOT NULL,
    kind ENUM('screen','print') NOT NULL,
    target VARCHAR(120) NULL COMMENT 'Nombre del dispositivo o impresora, libre',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_output_station (station_id, is_active),
    FOREIGN KEY (station_id) REFERENCES stations(station_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: comandas
-- LA RONDA que se prepara. No depende del punto de servicio: `session_id` es NULL cuando
-- el pedido viene de mostrador, para llevar o de una plataforma de reparto. Esa decisión
-- es lo que permite que el día de mañana entre un pedido de Uber Eats por la misma puerta.
CREATE TABLE comandas (
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

-- Tabla: check_service_points
-- Una cuenta puede abarcar varios puntos de servicio: juntar mesas es añadir el segundo
-- punto a la misma cuenta (un folio, un cobro), no fusionar dos cuentas.
CREATE TABLE check_service_points (
    session_id INT NOT NULL,
    table_id INT NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, table_id),
    FOREIGN KEY (session_id) REFERENCES dining_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (table_id) REFERENCES dining_tables(table_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: couriers
-- Repartidores del propio negocio (el reparto por plataforma lo asigna la plataforma).
CREATE TABLE couriers (
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

-- Tabla: dining_order_items
-- Lo pedido. participant_id es lo que permite separar la cuenta al final sin
-- preguntar otra vez quién pidió qué.
CREATE TABLE dining_order_items (
    order_item_id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    comanda_id INT NULL COMMENT 'Ronda a la que se envió. NULL = todavía no se manda',
    participant_id INT NULL,
    product_id INT NULL,
    product_name VARCHAR(150) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
    notes VARCHAR(255) NULL,
    line_total DECIMAL(10,2) NOT NULL,
    discount_applied DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    promotion_id INT NULL,
    station_id INT NULL COMMENT 'Estación que lo prepara (NULL = la del producto o la de la tienda)',
    status ENUM('pending','sent','preparing','ready','served','cancelled') NOT NULL DEFAULT 'pending',
    added_by ENUM('customer','staff') NOT NULL DEFAULT 'customer',
    cancel_reason VARCHAR(255) NULL,
    sent_at DATETIME NULL,
    served_at DATETIME NULL,
    ready_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_item_session (session_id, status),
    INDEX idx_item_participant (participant_id),
    INDEX idx_item_comanda (comanda_id),
    FOREIGN KEY (session_id) REFERENCES dining_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (comanda_id) REFERENCES comandas(comanda_id) ON DELETE SET NULL,
    FOREIGN KEY (participant_id) REFERENCES dining_participants(participant_id) ON DELETE SET NULL,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: dining_split_shares
-- Cómo se reparte el cobro. En 'equal' se calcula el monto por comensal activo;
-- en 'by_items' sale de sumar los ítems de cada participante. Se guarda el
-- desglose para el ticket y para saber quién ya pagó su parte.
CREATE TABLE dining_split_shares (
    share_id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    participant_id INT NULL,
    label VARCHAR(60) NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    paid TINYINT(1) NOT NULL DEFAULT 0,
    paid_at DATETIME NULL,
    payment_method VARCHAR(20) NULL,
    mode ENUM('by_person','equal','by_items','by_amount','manual') NOT NULL DEFAULT 'manual' COMMENT 'Cómo se calculó esta parte',
    sale_payment_id INT NULL COMMENT 'Pago que saldó esta parte',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_share_session (session_id),
    FOREIGN KEY (session_id) REFERENCES dining_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES dining_participants(participant_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla: share_items — el reparto manual, ítem por ítem
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

-- Tabla: sale_payments — los pagos de una venta
-- UNA venta por cuenta con N pagos. Cada renglón dice método, monto, la caja que lo
-- recibió, la referencia (clave de rastreo de transferencia) y si es propina.
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
    INDEX idx_pay_sale (sale_id),
    INDEX idx_pay_store (store_id, created_at),
    INDEX idx_pay_share (share_id),
    FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE,
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE,
    FOREIGN KEY (share_id) REFERENCES dining_split_shares(share_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

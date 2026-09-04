-- Tomodachi Community Edition - reconciliacion de esquema para BD heredada
-- Generado: 2026-09-03
--
-- Objetivo: llevar una BD existente de Hostinger al esquema actual de Community
-- sin borrar datos ni depender del nombre de la base de datos.
--
-- PRECAUCION: hacer un respaldo completo antes de ejecutar. Ejemplo:
--   mysqldump --single-transaction --routines --triggers BASE_DATOS > respaldo_antes_tomodachi.sql
--
-- EJECUCION: seleccionar la BD correcta en phpMyAdmin y ejecutar TODO este archivo,
-- o: mysql -u USUARIO -p BASE_DATOS < 032_reconcile_hostinger_community.sql
-- No incluye INSERTs de datos de demo ni elimina columnas/filas.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=1;


-- 1) Columnas nuevas y en el orden de Community Edition
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tracking_type ENUM('stock','recipe','component','none') NOT NULL DEFAULT 'stock' COMMENT 'stock=producto final, recipe=ensamblado (stock derivado de receta), component=materia prima con presentaciones, none=sin inventario' AFTER bulk_unit,
  ADD COLUMN IF NOT EXISTS consume_mode ENUM('fifo','lifo','manual') NOT NULL DEFAULT 'fifo' COMMENT 'Orden de consumo de presentaciones: fifo (mas antiguo), lifo (mas reciente), manual (seleccion explicita)' AFTER tracking_type,
  ADD COLUMN IF NOT EXISTS pieces_per_box INT UNSIGNED NULL DEFAULT NULL COMMENT 'Piezas por unidad comercial (caja/lote). NULL o 0 = sin seguimiento por lotes' AFTER consume_mode,
  ADD COLUMN IF NOT EXISTS is_ingredient TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Puede usarse como ingrediente de recetas' AFTER pieces_per_box;

ALTER TABLE sale_details
  ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(10,2) NULL DEFAULT NULL COMMENT 'Costo unitario historico al momento de la venta' AFTER unit_price,
  ADD COLUMN IF NOT EXISTS promotion_id INT NULL DEFAULT NULL COMMENT 'Promocion aplicada a la linea (si aplico)' AFTER discount;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS customer_id INT NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Monto efectivamente pagado al momento de la venta (resto = fiado)' AFTER total,
  ADD COLUMN IF NOT EXISTS refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Monto total devuelto acumulado (devoluciones parciales)' AFTER status,
  ADD COLUMN IF NOT EXISTS created_via VARCHAR(10) NOT NULL DEFAULT 'session' COMMENT 'session = interfaz (humano), token = API/agente' AFTER refunded_amount;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS theme_config_dark TEXT NULL AFTER theme_config,
  ADD COLUMN IF NOT EXISTS onboarding_seen TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'La bienvenida inicial global ya fue reclamada' AFTER subscription_plan;


-- 2) Ajustes de tipo necesarios para soportar el esquema actual (amplian capacidad; no reducen datos)
ALTER TABLE products
  MODIFY COLUMN current_stock DECIMAL(12,3) DEFAULT 0.000,
  MODIFY COLUMN min_stock DECIMAL(12,3) DEFAULT 0.000;

ALTER TABLE inventory_movements
  MODIFY COLUMN quantity DECIMAL(12,3) NOT NULL,
  MODIFY COLUMN previous_stock DECIMAL(12,3) NOT NULL,
  MODIFY COLUMN new_stock DECIMAL(12,3) NOT NULL;

ALTER TABLE sale_details
  MODIFY COLUMN quantity DECIMAL(12,3) NOT NULL;

ALTER TABLE sales
  MODIFY COLUMN payment_method ENUM('cash','card','transfer','mixed','credit') NOT NULL;

ALTER TABLE users
  MODIFY COLUMN role ENUM('super_admin','admin','manager','cashier') NOT NULL;


-- 3) Tablas que faltan en la BD heredada. IF NOT EXISTS permite re-ejecutar el archivo.

-- Tabla: customers (Clientes / fiado)
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

-- Tabla: customer_payments (Abonos al fiado)
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

-- Tabla: push_subscriptions (Notificaciones FCM)
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

-- Tabla: sale_refunds (Devoluciones/rembolsos parciales)
CREATE TABLE IF NOT EXISTS sale_refunds (
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
CREATE TABLE IF NOT EXISTS sale_refund_items (
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

-- Tabla: api_tokens (Tokens para integraciones externas / agentes IA)
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

-- Tabla: login_attempts (Rate limiter de login / anti fuerza bruta)
-- Registra intentos de login fallidos por IP para bloquearla temporalmente.
-- La gestiona includes/LoginRateLimiter.class.php.
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

-- Tabla: digital_boards (Boards / tableros de pantallas)
CREATE TABLE IF NOT EXISTS digital_boards (
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
CREATE TABLE IF NOT EXISTS board_slides (
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
CREATE TABLE IF NOT EXISTS slide_elements (
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
CREATE TABLE IF NOT EXISTS digital_signage_media (
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
CREATE TABLE IF NOT EXISTS digital_board_slide_assignments (
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
CREATE TABLE IF NOT EXISTS display_groups (
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
CREATE TABLE IF NOT EXISTS display_group_screens (
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
CREATE TABLE IF NOT EXISTS display_group_screen_slides (
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
CREATE TABLE IF NOT EXISTS display_group_steps (
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

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    setting_value TEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 4) Verificacion: estas consultas deben devolver 31 tablas en total y 0 filas
-- para cada bloque de columnas faltantes. Se dejan como SELECT para que phpMyAdmin
-- muestre el resultado y no se modifica ningun dato de negocio.
SELECT COUNT(*) AS tablas_tomodachi
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';

SELECT table_name, column_name, ordinal_position, column_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('products','sale_details','sales','stores')
ORDER BY table_name, ordinal_position;

SELECT required_table AS tabla_faltante
FROM (
  SELECT 'api_tokens' AS required_table UNION ALL SELECT 'app_settings' UNION ALL
  SELECT 'board_slides' UNION ALL SELECT 'customer_payments' UNION ALL SELECT 'customers' UNION ALL
  SELECT 'digital_board_slide_assignments' UNION ALL SELECT 'digital_boards' UNION ALL
  SELECT 'digital_signage_media' UNION ALL SELECT 'display_group_screen_slides' UNION ALL
  SELECT 'display_group_screens' UNION ALL SELECT 'display_group_steps' UNION ALL
  SELECT 'display_groups' UNION ALL SELECT 'login_attempts' UNION ALL
  SELECT 'product_ingredients' UNION ALL SELECT 'product_lots' UNION ALL
  SELECT 'push_subscriptions' UNION ALL SELECT 'sale_refund_items' UNION ALL SELECT 'sale_refunds' UNION ALL
  SELECT 'slide_elements'
) expected
LEFT JOIN information_schema.tables actual
  ON actual.table_schema = DATABASE() AND actual.table_name = expected.required_table
WHERE actual.table_name IS NULL;

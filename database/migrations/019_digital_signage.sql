-- Migración 019: Digital Signage (Pantallas Digitales)
-- Permite a cada tienda crear boards con slides y elementos
-- para mostrar menús, ofertas y contenido en pantallas/QR

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

CREATE TABLE IF NOT EXISTS board_slides (
    slide_id INT AUTO_INCREMENT PRIMARY KEY,
    board_id INT NOT NULL,
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

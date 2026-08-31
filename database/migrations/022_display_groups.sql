-- Migración 022: Grupos de pantallas (escenas multi-pantalla sincronizadas)
-- Permite componer VARIAS pantallas (ej. 2 verticales + 1 horizontal) en una
-- misma vista, con un layout (posición/tamaño de cada pantalla) y una
-- secuencia coordinada: una "pasada" muestra qué diapositiva va en cada
-- pantalla; todas avanzan juntas y hacen loop al terminar.
--
-- display_groups           : la escena/vista principal
-- display_group_screens    : cada pantalla del layout (posición/tamaño/orientación)
-- display_group_steps      : secuencia coordinada (step_order + screen + slide)
--
-- Una "vista" guardada = un display_groups. Reutilizarla/invocar/variante =
-- duplicar el grupo (layout + steps), manteniendo source_slide_id porque los
-- slides maestros persisten en board_slides y son reutilizables.

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

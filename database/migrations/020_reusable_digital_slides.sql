-- Migración 020: reutilización de slides entre Pantallas Digitales.
-- Una slide existente (board_slides) puede ser maestra y aparecer en varios boards.

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

-- Migración 023: Diapositivas por pantalla (rotación INDEPENDIENTE por pantalla)
-- El amo pidió que cada pantalla del escenario tenga SU PROPIA lista de
-- diapositivas que rote con su propio tiempo y se reinicie sola (no una
-- secuencia global sincronizada).
-- Reemplaza el concepto de display_group_steps (pasadas globales) por una
-- lista de slides POR PANTALLA.
--
-- display_group_screen_slides : cada fila = una diapositiva de una pantalla,
--   en su orden (position) y con duración opcional (custom_duration).
-- Una pantalla con una sola diapositiva la muestra estática (sin rotar).

CREATE TABLE IF NOT EXISTS display_group_screen_slides (
    id INT AUTO_INCREMENT PRIMARY KEY,
    screen_id INT NOT NULL,
    position INT NOT NULL DEFAULT 0 COMMENT 'orden de la diapositiva en esa pantalla',
    source_slide_id INT NOT NULL COMMENT 'diapositiva maestra (board_slides) que se muestra',
    custom_duration INT NULL COMMENT 'duracion en segundos (null = usar default del escenario)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_screen_pos (screen_id, position),
    FOREIGN KEY (screen_id) REFERENCES display_group_screens(id) ON DELETE CASCADE,
    FOREIGN KEY (source_slide_id) REFERENCES board_slides(slide_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

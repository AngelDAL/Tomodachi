-- Migración 024: transición de cada diapositiva de una pantalla
ALTER TABLE display_group_screen_slides
    ADD COLUMN transition VARCHAR(20) NOT NULL DEFAULT 'fade'
    COMMENT 'transición al mostrar esta diapositiva (fade, slide_left, slide_up, slide_right, zoom, none)';

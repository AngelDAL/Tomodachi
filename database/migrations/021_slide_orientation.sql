-- Migración 021: orientación y tamaño por slide (Pantallas Digitales).
-- Cada slide puede tener su propio tipo de vista (horizontal/vertical) y su
-- propio tamaño de lienzo, para separar las versiones H y V sin "efectos raros"
-- (antes la orientación era solo del board y cambiar el toggle recortaba el
-- mismo contenido de forma incorrecta).
--
-- orientation: 'auto' (hereda la orientación del board) | 'horizontal' | 'vertical'
-- layout_width / layout_height: tamaño lógico del lienzo en px.
--   NULL = usar el default según orientación (1600x900 H, 900x1600 V).

ALTER TABLE board_slides
    ADD COLUMN orientation ENUM('auto','horizontal','vertical') NOT NULL DEFAULT 'auto' AFTER position,
    ADD COLUMN layout_width INT NULL AFTER orientation,
    ADD COLUMN layout_height INT NULL AFTER layout_width;

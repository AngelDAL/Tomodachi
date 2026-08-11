-- Migración: costo histórico y promoción por línea en sale_details
-- C1: registrar qué promoción aplicó en cada línea de venta.
-- C5: guardar el costo unitario AL MOMENTO de la venta para reportes
--     de ganancia honestos (no el costo actual del producto).
USE tomodachi_pos;
SET NAMES utf8mb4;

ALTER TABLE sale_details
    ADD COLUMN unit_cost DECIMAL(10,2) NULL DEFAULT NULL
        COMMENT 'Costo unitario histórico al momento de la venta' AFTER unit_price,
    ADD COLUMN promotion_id INT NULL DEFAULT NULL
        COMMENT 'Promoción aplicada a la línea (si aplicó)' AFTER discount;

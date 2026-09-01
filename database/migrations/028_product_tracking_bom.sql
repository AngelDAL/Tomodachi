-- Migración 028: inventario por recetas (BOM) y unidades comerciales (cajas/lotes)
-- Añade a products: tracking_type (definir el tipo de inventario del producto),
-- pieces_per_box (tamaño de la unidad comercial para presentar "cajas completas +
-- lote abierto") e is_ingredient (puede usarse como ingrediente de recetas).
-- Para BD existentes. En schema.sql (baseline de primer arranque) estos cambios ya
-- están consolidados; migraciones nuevas NO se re-ejecutan en una instalación vacía.
USE tomodachi_pos;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tracking_type ENUM('stock','recipe','none') NOT NULL DEFAULT 'stock'
    COMMENT 'stock=existencia escalar, recipe=ensamblado (stock derivado de receta), none=sin inventario' AFTER is_bulk,
  ADD COLUMN IF NOT EXISTS pieces_per_box INT UNSIGNED NULL DEFAULT NULL
    COMMENT 'Piezas por unidad comercial (caja/lote). NULL o 0 = sin seguimiento por lotes' AFTER tracking_type,
  ADD COLUMN IF NOT EXISTS is_ingredient TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Puede usarse como ingrediente de recetas' AFTER pieces_per_box;
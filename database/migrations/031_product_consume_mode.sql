-- 031_product_consume_mode.sql
-- Modo de consumo de presentaciones por producto (componentes):
--   'fifo'   (DEFAULT) consume la presentación más antigua primero
--   'lifo'   consume la presentación más reciente primero ("usar el más reciente")
--   'manual' requiere selección explícita de presentación al vender (el POS la envía)
ALTER TABLE `products`
    ADD COLUMN `consume_mode` ENUM('fifo','lifo','manual') NOT NULL DEFAULT 'fifo'
    COMMENT 'Orden de consumo de presentaciones: fifo (mas antiguo), lifo (mas reciente), manual (seleccion explicita)' AFTER `tracking_type`;
-- 053_counter_orders_totales_historicos.sql
--
-- Los pedidos de mostrador creados ANTES de la migración 052 quedaron con `subtotal` y
-- `discount` en cero (las columnas todavía no existían), así que su total se veía como
-- $0.00 en la lista del mostrador aunque sí tuvieran artículos.
--
-- Aquí se rellena `subtotal` a partir de los importes de sus propias líneas. OJO: en
-- `counter_orders` NO hay columna `total`; el total es `subtotal - discount` y se calcula
-- al leer (ver `CounterService::armar()`, que además hace este mismo cálculo al vuelo si
-- se topa con una fila vieja en cero).

UPDATE counter_orders o
JOIN (
    SELECT counter_order_id, ROUND(SUM(line_total), 2) AS suma
      FROM counter_order_items
     GROUP BY counter_order_id
) i ON i.counter_order_id = o.counter_order_id
SET o.subtotal = i.suma
WHERE o.subtotal = 0
  AND o.discount = 0;

-- 044: índice de rendimiento para dashboard y reportes
--
-- Por qué: el dashboard y los reportes filtran SIEMPRE por
--   sales(store_id, sale_date, status='completed'). El índice existente
--   idx_store_date(store_id, sale_date) deja `status` como filtro post-índice:
--   MariaDB trae todas las ventas del store en el rango y filtra en memoria,
--   encareciendo las consultas a medida que crecen los datos. Este índice
--   compuesto cubre la cláusula WHERE completa (store_id, sale_date + status)
--   en un solo árbol, y de paso el ORDER BY sale_date DESC del reporte de
--   ventas (evita un filesort).
--
-- Nota: NO se indexa sale_details por store_id porque esa tabla no tiene
-- esa columna: el JOIN parte de `sales` (ya filtrada por el índice anterior)
-- y salta a sale_details por sale_id (idx_sale ya existe).
--
-- Idempotente en la práctica: si el índice ya existe, el CREATE INDEX falla
-- y el entrypoint lo registra como aplicado con un aviso (ver
-- docker/entrypoint.sh). Para instalaciones nuevas ya va incluido en
-- database/schema.sql como fuente de verdad de la migración.

CREATE INDEX idx_sales_store_date_status
    ON sales (store_id, sale_date, status);
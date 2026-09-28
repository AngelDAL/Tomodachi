-- 045 · Cada punto de servicio elige QUÉ carta abre su QR
--
-- Por qué: hasta hoy el QR de un punto abría "la primera carta activa de la tienda"
-- (ORDER BY menu_id ASC). Con más de una carta —una de solo consulta y otra para pedir—
-- el QR de la mesa terminaba abriendo la equivocada, y el comensal no podía pedir porque
-- su carta era `menu_only`. La elección existía solo como parámetro `?menu_id=` al imprimir
-- el QR: no se guardaba en ninguna parte.
--
-- `menu_id = NULL` significa "la carta de la tienda" (la primera activa), que es el
-- comportamiento de siempre: las instalaciones que ya existen no cambian de carta solas.
--
-- Sin FK a propósito (mismo criterio que `products.station_id`, migración 041): al borrar
-- una carta, `api/menu/menus.php` suelta los puntos que la usaban (los deja en NULL) en la
-- misma operación. Una FK con ON DELETE SET NULL también valdría, pero el esquema de esta
-- app no la usa en las tablas del piso y el borrado ya está resuelto en PHP.
ALTER TABLE dining_tables
    ADD COLUMN menu_id INT NULL DEFAULT NULL AFTER zone,
    ADD KEY idx_dining_tables_menu (menu_id);

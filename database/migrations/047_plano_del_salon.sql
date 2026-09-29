-- =============================================================
-- 047 — El PLANO del salón: dónde está cada punto, con qué forma y cuántos asientos
-- =============================================================
--
-- Fase 3 del pedido del comensal. Hasta ahora el mapa del salón era una rejilla que se
-- reacomodaba sola: el dueño no podía decir "la barra va junto a la puerta" ni "esa mesa
-- es para 6". Aquí se guarda el acomodo.
--
-- LAS COORDENADAS SON DE UN LIENZO VIRTUAL DE 1000 x 700 (no píxeles):
--   pos_x 0..1000  ->  0% a 100% del ancho del lienzo
--   pos_y 0..700   ->  0% a 100% del alto
-- Se guardan así para que el plano se vea igual de bien en un teléfono, en una tableta y en
-- un monitor: la pantalla escala, el acomodo no cambia. NULL (o 0) = todavía sin lugar.
--
-- shape: la forma de la mesa, para que el plano se RECONOZCA de un vistazo.
--   rect  -> cuadrada o rectangular (lo normal)
--   round -> redonda
--   bar   -> barra alargada
-- seats: asientos. Sirve de TOPE de dispositivos por cuenta cuando la empresa no fijó uno
--        (ver max_devices_per_check en stores.settings.dining); 0 = sin tope explícito.

ALTER TABLE dining_tables
    ADD COLUMN pos_x SMALLINT NULL DEFAULT NULL AFTER zone,
    ADD COLUMN pos_y SMALLINT NULL DEFAULT NULL AFTER pos_x,
    ADD COLUMN shape ENUM('rect','round','bar') NOT NULL DEFAULT 'rect' AFTER pos_y,
    ADD COLUMN seats TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER shape;

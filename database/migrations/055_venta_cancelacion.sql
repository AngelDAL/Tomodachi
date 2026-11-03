-- 055_venta_cancelacion.sql
--
-- Cancelación de una venta desde el historial (pedido por Ángel, 3-nov-2026):
-- hasta ahora `api/sales/cancel_sale.php` existía y funcionaba, pero NINGUNA pantalla
-- lo llamaba: no había dónde cancelar una venta. Esta migración añade el rastro que
-- esa cancelación necesita para ser auditable, con el mismo patrón que ya usan
-- `comandas` (cancel_reason + cancelled_at) y `counter_orders`.
--
-- Por qué cada columna:
--   * `cancel_reason`   — el motivo. En el resto del proyecto anular una comanda o una
--                         cuenta EXIGE motivo escrito (tables.js, comandas.js); una venta
--                         no puede ser la excepción: sin motivo, después nadie sabe por
--                         qué desapareció el dinero.
--   * `cancelled_at`    — cuándo. Sin esto no se distingue una venta cancelada hoy de
--                         una cancelada hace un mes, y los reportes no pueden recortar.
--   * `cancelled_by`    — quién. `sales.user_id` es quien VENDIÓ; cancelar es otra
--                         persona y otra acción. Se guarda aparte para no mentir sobre
--                         el original.
--
-- `cancelled_by` es UNSIGNED y va SIN foreign key a propósito: añadir un constraint en
-- una tabla ya poblada obliga a que ninguna fila violante rompa la migración (y el
-- entrypoint la marcaría `failed`, bloqueando el healthcheck). Se valida en el código,
-- igual que el resto de ids que maneja el proyecto.
--
-- Idempotente: `ADD COLUMN IF NOT EXISTS`, igual que 049/052/054.

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(255) NULL
        COMMENT 'Motivo de la cancelación (obligatorio en la interfaz)' AFTER refunded_amount,
    ADD COLUMN IF NOT EXISTS cancelled_at DATETIME NULL
        COMMENT 'Cuándo se canceló la venta' AFTER cancel_reason,
    ADD COLUMN IF NOT EXISTS cancelled_by INT UNSIGNED NULL
        COMMENT 'user_id de quien canceló (distinto de user_id, que es quien vendió)' AFTER cancelled_at;

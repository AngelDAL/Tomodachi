-- 042: rol de MESERO
--
-- Por qué: el mesero atiende el salón y necesita ser dueño de su trabajo en piso (dar de
-- alta y editar puntos de servicio, abrir cuentas, anotar por los clientes, enviar a
-- preparación) sin tener permiso sobre el dinero del negocio (precios, inventario,
-- compras ni usuarios).
--
-- Antes solo existían super_admin, admin, manager y cashier, así que un mesero tenía que
-- crearse como cajero y terminaba pudiendo abrir la caja y ver cortes que no le tocan.
--
-- El ENUM es la razón por la que crear un usuario con rol 'waiter' fallaba con
-- "Error interno del servidor": la API ya lo aceptaba, la columna todavía no.

ALTER TABLE users
    MODIFY COLUMN role ENUM('super_admin', 'admin', 'manager', 'cashier', 'waiter') NOT NULL;

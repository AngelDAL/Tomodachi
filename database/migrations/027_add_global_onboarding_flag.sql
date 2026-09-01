-- Migración 027: interruptor global de bienvenida inicial por tienda.
-- La bienvenida solo puede reclamarse una vez, incluso desde otro navegador.
ALTER TABLE stores
    ADD COLUMN onboarding_seen TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'La bienvenida inicial global ya fue reclamada'
    AFTER subscription_plan;

-- Conserva el estado de las tiendas existentes que ya habían completado el
-- onboarding individual: no deben recibir una nueva bienvenida tras actualizar.
UPDATE stores s
SET onboarding_seen = 1
WHERE NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE u.store_id = s.store_id
      AND u.role = 'admin'
      AND COALESCE(u.show_onboarding, 1) = 1
);

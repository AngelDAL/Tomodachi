-- 046 · Activación del comensal por DOS NÚMEROS (o su QR)
--
-- Cómo funciona: el dispositivo que quiere pedir pide activación y recibe un par de dígitos
-- (el QR del drawer codifica ESE par). El mesero lo teclea o lo escanea y autoriza a ESE
-- dispositivo. Es una prueba de PRESENCIA con el factor humano a cargo —no autenticación
-- fuerte— y por eso el par caduca, es de un solo uso y activa un dispositivo, no la mesa.
--
-- `require_activation = 0` (por defecto) conserva el comportamiento de siempre: se pide sin
-- verificación. La empresa lo enciende en Configuración cuando quiere la verificación; así
-- ninguna instalación que ya opera cambia de golpe.
ALTER TABLE dining_participants
    ADD COLUMN activation_code    CHAR(2)  NULL DEFAULT NULL AFTER join_token,
    ADD COLUMN activation_expires DATETIME NULL DEFAULT NULL AFTER activation_code,
    ADD COLUMN activated_at       DATETIME NULL DEFAULT NULL AFTER activation_expires,
    ADD COLUMN activated_by       INT      NULL DEFAULT NULL AFTER activated_at,
    ADD COLUMN rejected_at        DATETIME NULL DEFAULT NULL AFTER activated_by,
    -- Los dos números se buscan por tienda y solo entre solicitudes vivas.
    ADD KEY idx_participantes_activacion (activation_code, activation_expires);

-- La configuración NO vive aquí: los ajustes de una tienda son el JSON `stores.settings`, igual
-- que CoDi. La verificación se enciende con:
--
--     settings.dining.require_activation = 1   (por defecto 0: se pide sin verificación)
--     settings.dining.activation_minutes = 10  (cuánto viven los dos números)
--     settings.dining.max_devices_per_check = 0 (0 = sin tope de dispositivos por cuenta)
--
-- Se lee en api/dining/order.php (el candado), api/dining/session.php (la activación) y
-- public/configuracion.html (el interruptor). No hay tabla de ajustes que crear.

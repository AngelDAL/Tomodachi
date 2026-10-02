<?php
/**
 * Constantes del sistema
 * Tomodachi POS System
 */

// Versión del sistema
define('APP_VERSION', '1.0.0');
define('APP_NAME', 'Tomodachi');

// Configuración de sesión
define('SESSION_LIFETIME', 86400); // 24 horas en segundos
define('SESSION_NAME', 'tomodachi_session');

// Roles de usuario
define('ROLE_SUPER_ADMIN', 'super_admin');
define('ROLE_ADMIN', 'admin');
define('ROLE_MANAGER', 'manager');
define('ROLE_CASHIER', 'cashier');
// Mesero: atiende el salón. No administra la tienda (no toca inventario, precios ni
// usuarios), pero sí es dueño de su trabajo en piso: dar de alta y editar puntos de
// servicio, abrir cuentas, anotar a nombre del cliente y enviar a preparación.
define('ROLE_WAITER', 'waiter');
// Quien puede administrar los puntos de servicio (el salón: dar de alta, renombrar y
// desactivar mesas). Es la gente de piso y quien manda en la tienda; el cajero NO entra
// (su trabajo es el dinero, no el acomodo del salón). Se define aquí para que la pantalla
// y el endpoint usen exactamente la misma lista: si se cambia, se cambia en un solo lugar.
// OJO: operar el salón (abrir cuentas, anotar, enviar a preparación) es otra cosa y sigue
// abierto a cualquier rol de la tienda.
define('ROLES_PUNTOS_SERVICIO', 'super_admin,admin,manager,waiter');
// Quien puede mover dinero del negocio (inventario, precios, compras, cortes).
define('ROLES_ADMINISTRACION', 'super_admin,admin,manager,cashier');

// Estados
define('STATUS_ACTIVE', 'active');
define('STATUS_INACTIVE', 'inactive');

// Estados de venta
define('SALE_COMPLETED', 'completed');
define('SALE_CANCELLED', 'cancelled');
define('SALE_REFUNDED', 'refunded');

// Métodos de pago
define('PAYMENT_CASH', 'cash');
define('PAYMENT_CARD', 'card');
define('PAYMENT_TRANSFER', 'transfer');
define('PAYMENT_MIXED', 'mixed');
define('PAYMENT_CREDIT', 'credit');
define('PAYMENT_CODI', 'codi');
define('PAYMENT_STRIPE', 'stripe');

// Tipos de movimiento de inventario
define('MOVEMENT_ENTRY', 'entry');
define('MOVEMENT_EXIT', 'exit');
define('MOVEMENT_ADJUSTMENT', 'adjustment');
define('MOVEMENT_SALE', 'sale');
define('MOVEMENT_RETURN', 'return');
define('MOVEMENT_PURCHASE', 'purchase');
define('MOVEMENT_LOSS', 'loss');
define('MOVEMENT_TRANSFER', 'transfer');

// Motivos de un EGRESO de inventario (inventory_exits.reason). El motivo es OPCIONAL:
// NULL = sin especificar. 'loss', 'damage' y 'expiry' se registran como pérdida en el
// libro de movimientos; 'transfer' tiene su propio tipo; el resto como salida normal.
define('EXIT_REASON_TRANSFER', 'transfer');
define('EXIT_REASON_LOSS', 'loss');
define('EXIT_REASON_DAMAGE', 'damage');
define('EXIT_REASON_EXPIRY', 'expiry');
define('EXIT_REASON_INTERNAL', 'internal');
define('EXIT_REASON_OTHER', 'other');

// Estados de compra
define('PURCHASE_DRAFT', 'draft');
define('PURCHASE_PENDING', 'pending');
define('PURCHASE_EXECUTED', 'executed');
define('PURCHASE_CANCELLED', 'cancelled');

// Estados de caja
define('REGISTER_OPEN', 'open');
define('REGISTER_CLOSED', 'closed');

// Tipos de inventario (tracking_type)
define('TRACKING_STOCK', 'stock');     // producto final (existencia escalar)
define('TRACKING_RECIPE', 'recipe');   // receta/ensamblado (stock derivado de la receta)
define('TRACKING_COMPONENT', 'component'); // componente/materia prima con presentaciones (lotes)
define('TRACKING_NONE', 'none');       // servicio, sin inventario

// Modo de consumo de presentaciones de un componente (consume_mode)
define('CONSUME_FIFO', 'fifo');     // consumir la presentación más antigua primero (default)
define('CONSUME_LIFO', 'lifo');     // consumir la presentación más reciente primero
define('CONSUME_MANUAL', 'manual'); // requiere selección explícita de presentación al vender

// Paginación
define('RECORDS_PER_PAGE', 20);

// Planes de suscripción (Solo relevante en modo SAAS)
define('PLAN_FREE', 'free');
define('PLAN_PREMIUM', 'premium');

// Modo de Despliegue
// 'OPEN_SOURCE': Todas las features desbloqueadas por defecto (default, ideal para self-hosting)
// 'SAAS': Verifica suscripción y planes (para el proveedor que ofrece hosting gestionado)
$envAppMode = getenv('APP_MODE');
define('APP_MODE', in_array($envAppMode, ['OPEN_SOURCE', 'SAAS'], true) ? $envAppMode : 'OPEN_SOURCE');

// Notificaciones Push (Web Push / FCM) — Fase B
// Genera las llaves con: npx web-push generate-vapid-keys
// Formato esperado: 'B...' (base64url, sin padding '==')
// Si quedan vacías, el envío de notificaciones responde 503 (la suscripción
// de dispositivos sigue funcionando).
define('VAPID_PUBLIC_KEY', getenv('VAPID_PUBLIC_KEY') ?: '');
define('VAPID_PRIVATE_KEY', getenv('VAPID_PRIVATE_KEY') ?: '');
define('VAPID_SUBJECT', getenv('VAPID_SUBJECT') ?: 'mailto:admin@tomodachi.local');

// Rate limiter de login (anti fuerza bruta) — ver includes/LoginRateLimiter.class.php
define('LOGIN_MAX_ATTEMPTS',      (int)(getenv('LOGIN_MAX_ATTEMPTS') ?: 5));       // fallos consecutivos antes de bloquear la IP
define('LOGIN_LOCK_BASE_SECONDS', (int)(getenv('LOGIN_LOCK_BASE_SECONDS') ?: 60)); // duración del 1er bloqueo (seg)
define('LOGIN_LOCK_MAX_SECONDS',  (int)(getenv('LOGIN_LOCK_MAX_SECONDS') ?: 7200));// tope de duración de bloqueo (seg)
define('LOGIN_LOCK_MULTIPLIER',   (int)(getenv('LOGIN_LOCK_MULTIPLIER') ?: 5));    // factor de escalamiento por bloqueo

// Salud (liveness/readiness) — api/health/live.php, api/health/ready.php e
// includes/HealthCheck.class.php. Como el resto de la configuración, se inyecta
// en runtime (nunca se hornea en la imagen): por eso se leen con getenv().
$envHealthMinFreeMb = getenv('HEALTH_MIN_FREE_MB');
define('HEALTH_MIN_FREE_MB', (int)($envHealthMinFreeMb !== false && $envHealthMinFreeMb !== '' ? $envHealthMinFreeMb : 200));
// Token opcional para que un monitor EXTERNO pueda pedir el detalle de los
// checks (header X-Health-Token). Vacío = el detalle solo se expone a loopback.
define('HEALTH_TOKEN', getenv('HEALTH_TOKEN') ?: '');

// ─────────────────────────────────────────────────────────────────────────────
// Cola de impresión ESC/POS (TAB-22)
// ─────────────────────────────────────────────────────────────────────────────
// Interruptor de retroceso. En `false` el sistema se comporta EXACTAMENTE como
// antes de esta función: la comanda se manda igual, no se crea ningún job y la
// impresión sigue siendo la del navegador (ventana + window.print()). No hace
// falta migración inversa: las columnas añadidas son aditivas y se ignoran.
$envPrintQueue = getenv('PRINT_QUEUE_ENABLED');
define('PRINT_QUEUE_ENABLED', $envPrintQueue === false || $envPrintQueue === ''
    ? true
    : in_array(strtolower($envPrintQueue), ['1', 'true', 'yes', 'on'], true));

// Puerto ÚNICO del transporte. No hay columna `port` a propósito: un campo de
// usuario que decide a qué puerto del servidor se conecta es superficie SSRF, y
// 9100 (RAW/JetDirect) es el del protocolo. Se inyecta por entorno para poder
// medir en el banco sin pelear con una impresora real.
define('PRINT_PORT', (int)(getenv('PRINT_PORT') ?: 9100));

// Timeout de conexión/escritura, en segundos. Corto a propósito: el worker no
// puede quedarse colgado contra una IP que traga la conexión y no responde.
define('PRINT_CONNECT_TIMEOUT', (int)(getenv('PRINT_CONNECT_TIMEOUT') ?: 2));

// Intentos totales por job ANTES de darlo por fallido (4 = el inicial + 3
// reintentos con backoff 10/30/120 s, ver PRINT_BACKOFF_SECONDS).
define('PRINT_MAX_ATTEMPTS', (int)(getenv('PRINT_MAX_ATTEMPTS') ?: 4));

// Backoff entre intentos, en segundos. Al agotar la lista se repite el último.
define('PRINT_BACKOFF_SECONDS', getenv('PRINT_BACKOFF_SECONDS') ?: '10,30,120');

// Lease: un job en 'sending' cuyo `claimed_at` es más viejo que esto vuelve a
// 'pending' en el siguiente tick (worker muerto a media impresión). Se compara
// en SQL contra NOW(), nunca contra un valor calculado en PHP.
define('PRINT_LEASE_SECONDS', (int)(getenv('PRINT_LEASE_SECONDS') ?: 90));

// Loops de espera del worker cuando no hay trabajo, en segundos.
define('PRINT_WORKER_IDLE_SLEEP', (int)(getenv('PRINT_WORKER_IDLE_SLEEP') ?: 2));

// Excepción de banco: permite apuntar a 127.0.0.1, que NO es RFC1918. En falso
// (default, y lo que corre en el contenedor) el worker solo acepta IPv4 de rango
// privado; el banco de pruebas lo enciende para escuchar en loopback.
$envPrintLoopback = getenv('PRINT_ALLOW_LOOPBACK');
define('PRINT_ALLOW_LOOPBACK', $envPrintLoopback !== false && $envPrintLoopback !== ''
    && in_array(strtolower($envPrintLoopback), ['1', 'true', 'yes', 'on'], true));

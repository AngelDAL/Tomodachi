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

// Tipos de movimiento de inventario
define('MOVEMENT_ENTRY', 'entry');
define('MOVEMENT_EXIT', 'exit');
define('MOVEMENT_ADJUSTMENT', 'adjustment');
define('MOVEMENT_SALE', 'sale');
define('MOVEMENT_RETURN', 'return');

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

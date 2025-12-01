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

// Tipos de movimiento de inventario
define('MOVEMENT_ENTRY', 'entry');
define('MOVEMENT_EXIT', 'exit');
define('MOVEMENT_ADJUSTMENT', 'adjustment');
define('MOVEMENT_SALE', 'sale');
define('MOVEMENT_RETURN', 'return');

// Estados de caja
define('REGISTER_OPEN', 'open');
define('REGISTER_CLOSED', 'closed');

// Paginación
define('RECORDS_PER_PAGE', 20);


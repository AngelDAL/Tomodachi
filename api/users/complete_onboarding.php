<?php
/**
 * API: reclamar la única bienvenida inicial de una tienda.
 * POST /api/users/complete_onboarding.php
 *
 * El nombre se conserva por compatibilidad, pero no actualiza una preferencia
 * individual: cambia un interruptor global de `stores` de forma atómica.
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

try {
    $db = new Database();
    $auth = new Auth($db);

    if (!$auth->isLoggedIn()) {
        Response::unauthorized();
    }

    $currentUser = $auth->getCurrentUser();
    if (strtolower(trim((string)($currentUser['role'] ?? ''))) !== 'admin') {
        Response::error('La bienvenida inicial está reservada al administrador de la tienda.', 403);
    }

    $storeId = (int)($currentUser['store_id'] ?? 0);
    if ($storeId <= 0) {
        Response::error('No se encontró una tienda para el usuario actual.', 404);
    }

    // Es el seguro de una sola vez: únicamente el primer UPDATE de la tienda
    // puede afectar una fila. Ningún cliente puede reiniciar el interruptor.
    $claimed = $db->update(
        'UPDATE stores SET onboarding_seen = 1 WHERE store_id = ? AND onboarding_seen = 0',
        [$storeId]
    ) === 1;

    if ($claimed) {
        $_SESSION['show_onboarding'] = false; // compatibilidad de sesión heredada
    }

    Response::success(
        ['show' => $claimed],
        $claimed ? 'Bienvenida inicial reclamada.' : 'La bienvenida inicial ya fue mostrada para esta tienda.'
    );
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}

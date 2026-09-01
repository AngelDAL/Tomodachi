<?php
/**
 * Beneficio inicial de la instalación — controlado por BD, no por navegador.
 *
 * GET   /api/auth/welcome.php
 *   → { success, data: { show: bool } }   show=true si es el PRIMER acceso
 *     global de la instalación (app_settings.welcome_seen != '1').
 *
 * POST  /api/auth/welcome.php
 *   → reclamo atómico: marca la instalación como ya mostrada (welcome_seen='1')
 *     si aún no había sido reclamada. Devuelve data.show = true cuando lo logra.
 *
 * Propósito: la presentación de bienvenida de 8 diapositivas la ve SOLO la
 * primera persona que accede a la app (antes de crear cuenta). Todos los demás
 * visitantes/sesiones van directo a login. Nada se guarda en localStorage.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST');

$method = $_SERVER['REQUEST_METHOD'];

if (!in_array($method, ['GET', 'POST'], true)) {
    Response::error('Método no permitido', 405);
}

try {
    $db = new Database();

    if ($method === 'GET') {
        $row = $db->selectOne("SELECT setting_value FROM app_settings WHERE setting_key = 'welcome_seen'");
        $show = !$row || (string)$row['setting_value'] !== '1';
        Response::success(['show' => $show], 'Estado de bienvenida');
    }

    // POST — reclamo atómico de la única bienvenida global
    $claimed = $db->update(
        "UPDATE app_settings SET setting_value = '1' WHERE setting_key = 'welcome_seen' AND setting_value <> '1'"
    ) === 1;

    if (!$claimed) {
        // Red de seguridad: si por cualquier motivo la fila no existiera,
        // garantizarla como '1' (idempotente) para no quedar en bucle.
        $db->update("UPDATE app_settings SET setting_value = '1' WHERE setting_key = 'welcome_seen'");
    }

    Response::success(
        ['show' => $claimed],
        $claimed ? 'Bienvenida reclamada.' : 'La bienvenida ya fue mostrada para esta instalación.'
    );
} catch (Exception $e) {
    Response::error('Error en el servidor: ' . $e->getMessage(), 500);
}
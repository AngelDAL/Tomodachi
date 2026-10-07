<?php
/**
 * Activaciones: las solicitudes de pedido que esperan al mesero.
 *
 * GET /api/dining/activaciones.php      -> { dispositivos: [...], resumen: {esperando, activos} }
 * GET /api/dining/activaciones.php?session_id=N -> solo los dispositivos de ESA cuenta (el
 *      panel "Activar" del apartado de un punto). Sigue requiriendo scope read.
 *
 * Es para el PERSONAL (scope read): la pantalla "Activar" de la tablet del mesero. Devuelve,
 * por cuenta abierta de la tienda, cada dispositivo con su estado:
 *
 *   estado: 'pendiente' (pide permiso, con su par de números y cuánto lleva esperando)
 *         | 'activo'    (ya puede pedir: el mesero lo autorizó)
 *         | 'rechazado' (el mesero dijo que no)
 *
 * Lo que NUNCA sale de aquí: el join_token del comensal (con él se puede pedir en su nombre) ni
 * nada de otra tienda.
 */

require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/Auth.class.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    Response::error('Método no permitido', 405);
}

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);

    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'read');
    $store_id = (int)$actor['store_id'];
    $session_filtro = (int)($_GET['session_id'] ?? 0);
    if ($session_filtro < 0) $session_filtro = 0;
    $conn = $db->getConnection();

    $filtroSesion = '';
    $params = [':sid' => $store_id];
    if ($session_filtro > 0) {
        $filtroSesion = ' AND p.session_id = :sesion_filtro';
        $params[':sesion_filtro'] = $session_filtro;
    }

    $stmt = $conn->prepare("
        SELECT p.participant_id, p.display_name, p.activation_code, p.activation_expires,
               p.activated_at, p.rejected_at, p.joined_at, p.last_seen_at, p.is_active,
               p.session_id, s.code AS cuenta, s.status AS cuenta_estado,
               (SELECT GROUP_CONCAT(t.label ORDER BY t.label SEPARATOR ' + ')
                  FROM check_service_points csp
                  JOIN dining_tables t ON t.table_id = csp.table_id
                 WHERE csp.session_id = s.session_id) AS puntos,
               (SELECT t.table_id FROM dining_tables t WHERE t.table_id = s.table_id) AS table_id,
               (SELECT t.label    FROM dining_tables t WHERE t.table_id = s.table_id) AS punto,
               TIMESTAMPDIFF(MINUTE, p.joined_at, NOW())     AS esperando_min,
               TIMESTAMPDIFF(MINUTE, p.last_seen_at, NOW())  AS sin_latir_min
        FROM dining_participants p
        JOIN dining_sessions s ON s.session_id = p.session_id
        WHERE s.store_id = :sid
          AND s.status IN ('open','awaiting_payment')
          AND p.is_active = 1
          AND (p.activated_at IS NOT NULL
               OR p.rejected_at IS NOT NULL
               OR (p.activation_expires IS NOT NULL AND p.activation_expires > NOW()))
          " . $filtroSesion . "
        ORDER BY (p.activated_at IS NOT NULL), p.joined_at ASC
    ");
    $stmt->execute($params);
    $filas = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $dispositivos = [];
    $esperando = 0;
    $activos = 0;
    foreach ($filas as $f) {
        $estado = 'pendiente';
        $codigo = null;
        if ($f['activated_at'] !== null) {
            $estado = 'activo';
            $activos++;
        } elseif ($f['rejected_at'] !== null) {
            $estado = 'rechazado';
        } else {
            $esperando++;
            $codigo = $f['activation_code'];
        }
        $dispositivos[] = [
            'participant_id' => (int)$f['participant_id'],
            'session_id'     => (int)$f['session_id'],
            'cuenta'         => $f['cuenta'],
            'display_name'   => $f['display_name'],
            'estado'         => $estado,
            'codigo'         => $codigo,
            'table_id'       => (int)($f['table_id'] ?? 0),
            'punto'          => $f['punto'] ?: ($f['puntos'] ?: 'Sin punto'),
            'esperando_min'  => (int)$f['esperando_min'],
            'sin_latir_min'  => $f['sin_latir_min'] === null ? null : (int)$f['sin_latir_min'],
        ];
    }

    Response::success([
        'dispositivos' => $dispositivos,
        'resumen'      => ['esperando' => $esperando, 'activos' => $activos],
    ]);
} catch (Exception $e) {
    Response::error('Error al listar las activaciones: ' . $e->getMessage(), 500);
}

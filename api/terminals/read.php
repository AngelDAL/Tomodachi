<?php
/**
 * Listar terminales de la tienda
 * GET /api/terminals/read.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method !== 'GET') { Response::error('Método no permitido', 405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    if (!$auth->isLoggedIn()) { Response::unauthorized(); }
    
    $currentUser = $auth->getCurrentUser();
    $store_id = $currentUser['store_id'];

    $sql = "SELECT t.terminal_id, t.terminal_name, t.status as terminal_status,
                   cr.register_id as current_register_id,
                   cr.opening_date,
                   cr.initial_amount,
                   u.full_name as current_user_name
            FROM terminals t
            LEFT JOIN cash_registers cr ON t.terminal_id = cr.terminal_id AND cr.status = 'open'
            LEFT JOIN users u ON cr.user_id = u.user_id
            WHERE t.store_id = ? AND t.status = 'active'
            ORDER BY t.terminal_id ASC";

    $terminals = $db->select($sql, [$store_id]);

    // Calcular totales actuales para cajas abiertas
    foreach ($terminals as &$term) {
        if ($term['current_register_id']) {
            $rid = $term['current_register_id'];
            $movs = $db->selectOne('SELECT 
                COALESCE(SUM(CASE WHEN movement_type="entry" THEN amount ELSE 0 END),0) AS total_entries,
                COALESCE(SUM(CASE WHEN movement_type="withdrawal" THEN amount ELSE 0 END),0) AS total_withdrawals,
                COALESCE(SUM(CASE WHEN movement_type="sale" THEN amount ELSE 0 END),0) AS total_sales
                FROM cash_movements WHERE register_id=?', [$rid]);
            
            $term['current_balance'] = (float)$term['initial_amount'] + (float)$movs['total_entries'] - (float)$movs['total_withdrawals'] + (float)$movs['total_sales'];
        } else {
            $term['current_balance'] = 0;
        }
    }

    Response::success(['terminals' => $terminals], 'Lista de terminales');

} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}

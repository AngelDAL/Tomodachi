<?php
/**
 * Cerrar caja
 * POST /api/cash_register/close_register.php {"register_id":10, "counted_amount":1520.50, "notes":"Cierre sin incidencias"}
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';

require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST') { Response::error('Método no permitido',405); }

try {
    $db = new Database();
    $auth = new Auth($db);

    if (!$auth->isLoggedIn()) { Response::unauthorized(); }
    if (!$auth->hasRole([ROLE_ADMIN,ROLE_MANAGER,ROLE_CASHIER])) { Response::error('Permisos insuficientes',403); }

    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }

    $register_id = isset($data['register_id']) ? (int)$data['register_id'] : 0;
    $counted_amount = isset($data['counted_amount']) ? (float)$data['counted_amount'] : null;
    $notes = isset($data['notes']) ? substr(trim($data['notes']),0,255) : null;

    $errors = [];
    if ($register_id <= 0) { $errors['register_id'] = 'Requerido'; }
    if ($counted_amount === null || $counted_amount < 0) { $errors['counted_amount'] = 'Monto contado inválido'; }
    if ($errors) { Response::validationError($errors); }

    $register = $db->selectOne('SELECT register_id, initial_amount, status FROM cash_registers WHERE register_id=?',[ $register_id ]);
    if (!$register) { Response::error('Caja no encontrada',404); }
    if ($register['status'] !== REGISTER_OPEN) { Response::error('La caja ya está cerrada',409); }

    // Calcular expected
    $row = $db->selectOne('SELECT 
        COALESCE(SUM(CASE WHEN movement_type="entry" THEN amount WHEN movement_type="withdrawal" THEN -amount ELSE 0 END),0) AS manual_total,
        COALESCE(SUM(CASE WHEN movement_type="sale" THEN amount ELSE 0 END),0) AS sales_total
        FROM cash_movements WHERE register_id=?',[ $register_id ]);
    $manual_total = (float)$row['manual_total'];
    $sales_total = (float)$row['sales_total'];
    $expected = (float)$register['initial_amount'] + $manual_total + $sales_total;
    $difference = $counted_amount - $expected;

    $db->update('UPDATE cash_registers SET closing_date=NOW(), final_amount=?, expected_amount=?, difference=?, status=?, notes=? WHERE register_id=?',[
        $counted_amount,$expected,$difference,REGISTER_CLOSED,$notes,$register_id
    ]);

    // --- INICIO LÓGICA DE CORREO ---
    try {
        // 1. Obtener datos de la tienda y usuario actual
        $currentUser = $auth->getCurrentUser();
        $store_id = $currentUser['store_id'];
        
        $store = $db->selectOne("SELECT store_name FROM stores WHERE store_id = ?", [$store_id]);
        $storeName = $store ? $store['store_name'] : 'Tienda';

        // 2. Obtener email del administrador de la tienda
        // Buscamos un usuario con rol 'admin' o 'super_admin' de esta tienda
        $adminUser = $db->selectOne("SELECT email, full_name FROM users WHERE store_id = ? AND role IN ('admin', 'super_admin') AND status = 'active' LIMIT 1", [$store_id]);
        
        if ($adminUser && !empty($adminUser['email'])) {
            require_once '../../includes/Mail.class.php';
            $mail = new Mail();

            // 3. Calcular estadísticas para el reporte
            
            // Calcular Ganancia Total (Ventas - Costos)
            // Primero obtenemos el costo total de los productos vendidos en esta caja
            $costRow = $db->selectOne("
                SELECT SUM(sd.quantity * COALESCE(p.cost, 0)) as total_cost
                FROM sales s
                JOIN sale_details sd ON s.sale_id = sd.sale_id
                LEFT JOIN products p ON sd.product_id = p.product_id
                WHERE s.register_id = ? AND s.status = 'completed'
            ", [$register_id]);
            
            $total_cost = $costRow ? (float)$costRow['total_cost'] : 0;
            $total_profit = $sales_total - $total_cost;

            // Conteo transacciones
            $txCountRow = $db->selectOne("SELECT COUNT(*) as count FROM sales WHERE register_id = ? AND status = 'completed'", [$register_id]);
            $transaction_count = (int)$txCountRow['count'];

            // Calcular Ticket Promedio
            $ticket_average = $transaction_count > 0 ? ($sales_total / $transaction_count) : 0;

            // Producto Top
            $topProductRow = $db->selectOne("
                SELECT p.product_name, SUM(sd.quantity) as qty
                FROM sale_details sd
                JOIN sales s ON sd.sale_id = s.sale_id
                JOIN products p ON sd.product_id = p.product_id
                WHERE s.register_id = ? AND s.status = 'completed'
                GROUP BY p.product_id
                ORDER BY qty DESC
                LIMIT 1
            ", [$register_id]);

            $stats = [
                'total_sales' => $sales_total,
                'ticket_average' => $ticket_average,
                'total_profit' => $total_profit,
                'transaction_count' => $transaction_count,
                'top_product_name' => $topProductRow ? $topProductRow['product_name'] : 'N/A',
                'top_product_qty' => $topProductRow ? $topProductRow['qty'] : 0
            ];

            // 4. Enviar correo
            $mail->sendDailyReport(
                $adminUser['email'], 
                $adminUser['full_name'] ?: 'Administrador', 
                $storeName, 
                date('d/m/Y H:i'), 
                $stats
            );
        }
    } catch (Exception $e) {
        // No fallamos el request si falla el correo, solo lo logueamos
        error_log("Error enviando reporte de cierre: " . $e->getMessage());
    }
    // --- FIN LÓGICA DE CORREO ---

    Response::success([
        'register_id'=>$register_id,
        'expected_amount'=>$expected,
        'counted_amount'=>$counted_amount,
        'difference'=>$difference
    ],'Caja cerrada');

} catch (Exception $e) {
    Response::error('Error servidor: '.$e->getMessage(),500);
}

<?php
/**
 * Crear venta (POS)
 * POST /api/sales/create_sale.php
 * Body ejemplo:
 * {
 *   "store_id":1,
 *   "register_id":2, // opcional si se obtiene automáticamente
 *   "items":[{"product_id":1,"quantity":2,"price":15.50}],
 *   "payment_method":"cash", // cash|card|transfer|mixed|credit|codi|stripe
 *   "cash_amount":31.00,       // si mixed indica parte en efectivo
 *   "codi_payment_id":123,     // requerido si payment_method=codi
 *   "discount":0,
 *   "tax":0
 * }
 *
 * NOTA (24-sep-2026): la lógica de la venta se movió a `includes/SaleService.class.php`.
 * Aquí solo se valida la petición y se traduce la respuesta. El motivo: el cobro de una
 * cuenta del salón tiene que entrar por el MISMO camino del dinero, y duplicar este bloque
 * habría creado dos lugares donde se descuenta inventario y se mueve la caja.
 * El contrato de este endpoint NO cambió.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/FormatHelper.class.php';
require_once '../../includes/Validator.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/Pricing.class.php';
require_once '../../includes/BomHelper.class.php';
require_once '../../includes/SaleService.class.php';

$db = new Database();
$auth = new Auth($db);

$apiAuth = new ApiAuth($db);
$actor = $apiAuth->requireActor($auth);
if ($actor['via'] === 'session') {
    if (!in_array($actor['role'],[ROLE_ADMIN,ROLE_MANAGER,ROLE_CASHIER])) { Response::error('Permisos insuficientes',403); }
} else {
    $apiAuth->requireScope($actor, 'write');
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { Response::error('Método no permitido',405); }

try {
    $data = json_decode(file_get_contents('php://input'), true);
    if (!$data) { Response::validationError(['body'=>'JSON inválido']); }

    // Seguridad: el usuario solo puede facturar en su propia tienda
    $store_id = isset($data['store_id']) ? (int)$data['store_id'] : 0;
    if ($store_id !== (int)$actor['store_id']) {
        Response::error('No autorizado para facturar en otra tienda', 403);
    }

    $service = new SaleService($db);
    $resultado = $service->createSale([
        'store_id'        => $store_id,
        'actor'           => $actor,
        'items'           => isset($data['items']) ? $data['items'] : [],
        'register_id'     => isset($data['register_id']) ? (int)$data['register_id'] : 0,
        'payment_method'  => isset($data['payment_method']) ? Validator::sanitizeString($data['payment_method']) : '',
        'cash_amount'     => isset($data['cash_amount']) ? (float)$data['cash_amount'] : null,
        'discount'        => isset($data['discount']) ? (float)$data['discount'] : 0.0,
        'tax'             => isset($data['tax']) ? (float)$data['tax'] : 0.0,
        'customer_id'     => isset($data['customer_id']) ? (int)$data['customer_id'] : 0,
        'amount_paid'     => isset($data['amount_paid']) ? (float)$data['amount_paid'] : 0.0,
        'codi_payment_id' => isset($data['codi_payment_id']) ? (int)$data['codi_payment_id'] : null,
        'stripe_payment_intent' => isset($data['stripe_payment_intent']) ? Validator::sanitizeString($data['stripe_payment_intent']) : '',
        'tip_amount'      => isset($data['tip_amount']) ? (float)$data['tip_amount'] : 0.0,
        'origen'          => 'pos',
    ]);

    Response::success([
        'sale_id'         => $resultado['sale_id'],
        'total'           => $resultado['total'],
        'tip_amount'      => $resultado['tip_amount'],
        'amount_paid'     => $resultado['amount_paid'],
        'change'          => $resultado['change'],
        'payments'        => $resultado['payments'],
        'register_opened' => $resultado['register_opened'],
    ], 'Venta registrada');
} catch (SaleValidationException $e) {
    Response::validationError($e->getErrors());
} catch (Exception $e) {
    $codigo = (int)$e->getCode();
    if ($codigo < 400 || $codigo > 599) { $codigo = 500; }
    Response::error('Error servidor: ' . $e->getMessage(), $codigo);
}

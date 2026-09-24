<?php
/**
 * SaleService — el ÚNICO camino del dinero.
 *
 * Por qué existe: hasta hoy toda la lógica de venta vivía dentro de
 * `api/sales/create_sale.php`. Cuando llegó el salón hizo falta cobrar una CUENTA, y
 * duplicar ese bloque habría creado dos caminos del dinero: dos lugares donde el
 * inventario se descuenta, dos lugares que tocan la caja y dos maneras de equivocarse.
 * Este servicio es ese camino, una sola vez, para el POS y para la cuenta.
 *
 * Qué hace, en orden: valida la tienda, resuelve la CAJA, calcula precios e inventario
 * (Pricing/BomHelper), valida descuentos, verifica el cobro Stripe, valida el fiado
 * contra el límite del cliente, registra la venta, sus pagos (uno o varios), mueve el
 * inventario, deja los movimientos de caja y devuelve el resumen. Todo dentro de UNA
 * transacción.
 *
 * Dos caminos de precio, un solo destino:
 *   - POS:           `items` = [{product_id, quantity}] y el precio sale del servidor
 *                    (products.price + promociones activas) con Pricing.
 *   - Cuenta (salón): `lines` = las líneas YA guardadas en la cuenta, con el precio con
 *                    que se anotaron. No es precio del cliente: es precio que el servidor
 *                    guardó al anotar el platillo. Se sigue usando Pricing para costo,
 *                    inventario y validación de existencias, y se respeta lo anotado.
 *
 * Propina: opcional y SIEMPRE aparte del consumo. `sales.tip_amount` la guarda y cada
 * pago lleva `is_tip`. Así el reporte de ventas no aparece inflado por las propinas, pero
 * el efectivo de la propina SÍ entra a la caja, que es lo que el corte necesita.
 *
 * Pagos: `payments` = [{method, amount, reference?, is_tip?, share_id?}]. Si no se mandan,
 * se sintetiza UN pago con el método y el monto de siempre (compatibilidad total con el
 * POS actual, que manda payment_method y cash_amount). La suma de los pagos tiene que
 * cuadrar con el total: el servicio no acepta que falte o sobre dinero.
 *
 * Transacción externa: cuando el cobro de una cuenta necesita bloquear la fila de la
 * sesión (candado contra el doble cobro) y registrar la venta en la MISMA transacción,
 * pasa `transaccion_externa => true` y el llamador abre y cierra la transacción.
 *
 * Los errores de validación van en SaleValidationException (trae los campos), y el resto
 * como Exception con su código HTTP. Los endpoints los traducen a su respuesta.
 */

if (!class_exists('SaleValidationException')) {
    class SaleValidationException extends Exception {
        private $errors;
        public function __construct(array $errors, $message = 'Errores de validación') {
            parent::__construct($message, 422);
            $this->errors = $errors;
        }
        public function getErrors() { return $this->errors; }
    }
}

// Dependencias del servicio: se incluyen aquí para que cualquier endpoint que lo use
// (POS o cobro de cuenta) no tenga que acordarse de incluirlas en el orden correcto.
require_once __DIR__ . '/Pricing.class.php';
require_once __DIR__ . '/BomHelper.class.php';
require_once __DIR__ . '/FormatHelper.class.php';

class SaleService {

    /** Tolerancia de centavos al cuadrar pagos contra totales. */
    const TOLERANCIA = 0.01;

    /** Métodos de pago aceptados en un pago individual. */
    private static $METODOS = ['cash', 'card', 'transfer', 'mixed', 'credit', 'codi', 'stripe'];

    /** Los que dejan deuda (no entra dinero ahora). */
    private static $METODOS_DEUDA = ['credit'];

    private $db;
    private $pricing;
    private $bom;

    public function __construct($db) {
        $this->db = $db;
        $this->pricing = new Pricing($db);
        $this->bom = new BomHelper($db);
    }

    // =========================================================
    // Camino principal
    // =========================================================

    /**
     * Registra una venta completa.
     *
     * @param array $params
     *   store_id            int    requerido
     *   actor               array  ['user_id','via','store_id'?] requerido
     *   items               array  [['product_id','quantity','lot_id'?]]  (camino POS)
     *   lines               array  líneas ya anotadas en la cuenta (camino salón); si viene,
     *                              manda sobre items para el precio
     *   expected_total      float  total que espera el llamador (la cuenta); si difiere, se
     *                              rechaza el cobro en vez de cobrar otra cosa
     *   payment_method      string método único (POS). Con `payments` puede omitirse
     *   cash_amount         float  efectivo en pago mixto (POS)
     *   discount            float  descuento manual del cajero
     *   tax                 float
     *   customer_id         int    requerido si hay fiado
     *   amount_paid         float  apartado: lo que paga ahora
     *   codi_payment_id     int
     *   stripe_payment_intent string
     *   register_id         int    caja explícita (opcional)
     *   tip_amount          float  propina (opcional)
     *   payments            array  pagos desglosados (opcional)
     *   lot_overrides       array  product_id => lot_id (presentación manual)
     *   transaccion_externa bool   el llamador abrió la transacción
     *   origen              string 'pos' | 'cuenta'  (solo para descripciones)
     *
     * @return array ['sale_id','total','subtotal','discount','tax','tip_amount','amount_paid',
     *                'payment_method','register_id','register_opened','payments','change']
     */
    public function createSale(array $params) {
        $store_id = (int)($params['store_id'] ?? 0);
        $actor    = $params['actor'] ?? null;
        if ($store_id <= 0) { throw new SaleValidationException(['store_id' => 'Requerido']); }
        if (!is_array($actor) || (int)($actor['user_id'] ?? 0) <= 0) {
            throw new Exception('No se pudo identificar al usuario que cobra', 401);
        }
        $user_id = (int)$actor['user_id'];

        // ---- Tienda y configuración
        $storeInfo = $this->db->selectOne(
            'SELECT store_id, settings FROM stores WHERE store_id = ? AND status = ?',
            [$store_id, STATUS_ACTIVE]
        );
        if (!$storeInfo) { throw new Exception('Tienda no válida', 404); }
        $storeSettings = $storeInfo['settings'] ? json_decode($storeInfo['settings'], true) : [];
        $allowNegativeStock = !empty($storeSettings['allow_negative_stock']);
        $requireOpenRegister = !empty($storeSettings['require_open_register']);

        // ---- Caja
        $caja = $this->resolverCaja($store_id, $user_id, (int)($params['register_id'] ?? 0), $requireOpenRegister);
        $register_id = $caja['register_id'];

        // ---- Líneas y totales (fuente de verdad del servidor)
        $calculado = $this->construirLineas($store_id, $params, $allowNegativeStock);
        $lineas = $calculado['lines'];
        $subtotal = $calculado['subtotal'];

        // ---- Descuento manual: solo puede reducir, nunca pasarse del subtotal
        $manualDiscount = max(0.0, (float)($params['discount'] ?? 0));
        if ($manualDiscount > $subtotal) {
            throw new SaleValidationException(['discount' => 'El descuento no puede exceder el subtotal']);
        }
        $tax = (float)($params['tax'] ?? 0);
        $total = round($subtotal - $manualDiscount + $tax, 2);
        if ($total < 0) { throw new Exception('Total negativo', 400); }

        // ---- La cuenta no puede cambiar mientras se cobra
        if (isset($params['expected_total']) && $params['expected_total'] !== null) {
            if (abs(round((float)$params['expected_total'], 2) - $total) > self::TOLERANCIA) {
                throw new Exception(
                    'El total de la cuenta cambió mientras se cobraba. Vuelva a revisar la cuenta antes de cobrar.',
                    409
                );
            }
        }

        // ---- Propina: opcional, nunca fiada y nunca negativa
        $tip = round((float)($params['tip_amount'] ?? 0), 2);
        if ($tip < 0) { throw new SaleValidationException(['tip_amount' => 'La propina no puede ser negativa']); }

        // ---- Cobro Stripe (tarjeta): se verifica contra la API antes de tocar la base
        $payment_method = isset($params['payment_method']) ? (string)$params['payment_method'] : '';
        $stripe_intent = isset($params['stripe_payment_intent']) ? (string)$params['stripe_payment_intent'] : '';
        $stripePaymentId = null;
        $stripeService = null;
        if ($stripe_intent !== '') {
            if ($payment_method !== PAYMENT_CARD) {
                throw new SaleValidationException(['payment_method' => 'Un cobro Stripe solo aplica con método de pago tarjeta']);
            }
            require_once __DIR__ . '/../stripe/includes/StripeService.class.php';
            $stripeService = new StripeService($this->db, $store_id);
            try {
                $stripePaymentId = $stripeService->verifyIntentForSale($stripe_intent, $total);
            } catch (Exception $e) {
                throw new Exception($e->getMessage(), 402);
            }
        }

        // ---- Pagos: desglosados o sintetizados (POS)
        $cash_amount = isset($params['cash_amount']) ? (float)$params['cash_amount'] : null;
        $amount_paid_in = isset($params['amount_paid']) ? (float)$params['amount_paid'] : 0.0;
        $customer_id = (int)($params['customer_id'] ?? 0);
        $codi_payment_id = isset($params['codi_payment_id']) && (int)$params['codi_payment_id'] > 0
            ? (int)$params['codi_payment_id'] : null;

        $pagos = $this->normalizarPagos($params, $payment_method, $total, $tip, $cash_amount, $amount_paid_in, $customer_id);
        $payments = $pagos['payments'];

        // amount_paid = lo efectivamente pagado del CONSUMO (sin propina y sin lo fiado).
        // Así `total - amount_paid` sigue siendo la deuda, que es lo que el sistema ya usaba.
        $amount_paid = 0.0;
        $trae_fiado = false;
        $efectivo = 0.0;
        $no_efectivo = 0.0;
        foreach ($payments as $p) {
            if ($p['is_tip']) { continue; }
            if (in_array($p['method'], self::$METODOS_DEUDA, true)) { $trae_fiado = true; continue; }
            $amount_paid += $p['amount'];
            if ($p['method'] === PAYMENT_CASH) { $efectivo += $p['amount']; } else { $no_efectivo += $p['amount']; }
        }
        $amount_paid = round($amount_paid, 2);

        // ---- Cliente y fiado
        $customer = null;
        if ($customer_id > 0) {
            $customer = $this->db->selectOne(
                'SELECT customer_id, full_name, balance, credit_limit, status FROM customers WHERE customer_id = ? AND store_id = ?',
                [$customer_id, $store_id]
            );
            if (!$customer || $customer['status'] !== 'active') { throw new Exception('Cliente inválido', 404); }
            if ($trae_fiado) {
                $newBalance = (float)$customer['balance'] + ($total - $amount_paid);
                if ((float)$customer['credit_limit'] > 0 && $newBalance > (float)$customer['credit_limit']) {
                    $fmt = \FormatHelper::getFormat($this->db, $store_id);
                    throw new Exception(
                        'El saldo del cliente excede su límite de crédito (' .
                        \FormatHelper::currency($customer['credit_limit'], $fmt) . ')',
                        409
                    );
                }
            }
        } elseif ($trae_fiado) {
            throw new SaleValidationException(['customer_id' => 'Se requiere un cliente para dejar la cuenta fiada']);
        }

        // ---- Cambio (solo cuando el efectivo cubre de más)
        $cambio = 0.0;
        if ($efectivo > 0) {
            $por_cubrir = round($total + $tip - $no_efectivo, 2);
            $efectivo_total = $efectivo;
            foreach ($payments as $p) {
                if ($p['is_tip'] && $p['method'] === PAYMENT_CASH) { $efectivo_total += $p['amount']; }
            }
            $cambio = round(max(0.0, $efectivo_total - $por_cubrir), 2);
        }

        // ---- Inventario a mover (con costo histórico y promoción aplicada)
        $productsToUpdate = [];
        foreach ($lineas as $line) {
            $productsToUpdate[] = [
                'product_id'     => $line['product_id'],
                'quantity'       => $line['quantity'],
                'price'          => $line['unit_price'],
                'unit_cost'      => $line['unit_cost'],
                'discount'       => $line['discount'],
                'promotion_id'   => $line['promotion_id'],
                'tracking_type'  => $line['tracking_type'],
                'previous_stock' => $line['current_stock'],
                'new_stock'      => $line['current_stock'] - $line['quantity'],
            ];
        }

        // ---- Presentación manual (modo 'manual'): product_id => lot_id
        $lotOverrides = [];
        foreach (($params['items'] ?? []) as $it) {
            if (isset($it['lot_id'], $it['product_id']) && (int)$it['lot_id'] > 0) {
                $lotOverrides[(int)$it['product_id']] = (int)$it['lot_id'];
            }
        }
        if (!empty($params['lot_overrides']) && is_array($params['lot_overrides'])) {
            $lotOverrides = $params['lot_overrides'] + $lotOverrides;
        }

        // ---- Transacción
        $externa = !empty($params['transaccion_externa']);
        if (!$externa) { $this->db->beginTransaction(); }
        try {
            $createdVia = (($actor['via'] ?? 'session') === 'token') ? 'token' : 'session';
            $sale_id = $this->db->insert(
                'INSERT INTO sales
                    (store_id, user_id, customer_id, register_id, sale_date, subtotal, tax, discount,
                     total, tip_amount, amount_paid, payment_method, codi_payment_id, stripe_payment_id,
                     status, created_via, created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())',
                [
                    $store_id, $user_id, ($customer_id > 0 ? $customer_id : null), $register_id,
                    date('Y-m-d H:i:s'), $subtotal, $tax, (float)($params['discount'] ?? 0),
                    $total, $tip, $amount_paid, $pagos['metodo_venta'], $codi_payment_id, $stripePaymentId,
                    SALE_COMPLETED, $createdVia,
                ]
            );

            // Deuda del cliente (fiado / apartado)
            $deuda = round($total - $amount_paid, 2);
            if ($deuda > 0 && $customer_id > 0) {
                $this->db->update('UPDATE customers SET balance = balance + ? WHERE customer_id = ?', [$deuda, $customer_id]);
            }

            // Inventario y detalle
            foreach ($productsToUpdate as $p) {
                if ($p['tracking_type'] === TRACKING_STOCK) {
                    $this->db->update('UPDATE products SET current_stock = ?, updated_at = NOW() WHERE product_id = ?', [$p['new_stock'], $p['product_id']]);
                    $this->db->insert(
                        'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at) VALUES (?,?,?,?,?,?,?,?,NOW())',
                        [$store_id, $p['product_id'], $user_id, MOVEMENT_SALE, $p['quantity'], $p['previous_stock'], $p['new_stock'], 'Venta #' . $sale_id]
                    );
                } elseif (in_array($p['tracking_type'], [TRACKING_RECIPE, TRACKING_COMPONENT, TRACKING_NONE], true)) {
                    // Receta: consume los ingredientes hoja. Componente vendido directo: consume de sus
                    // presentaciones. Servicio: consume sus componentes si tiene composición (no-op si es puro).
                    $this->bom->consumeForSale($this->db, $store_id, $user_id, $sale_id, $p['product_id'], $p['quantity'], $lotOverrides);
                }
                $lineSubtotal = $p['quantity'] * $p['price'];
                $lineDiscount = round($p['quantity'] * $p['discount'], 2);
                $this->db->insert(
                    'INSERT INTO sale_details (sale_id, product_id, quantity, unit_price, unit_cost, subtotal, discount, promotion_id, total) VALUES (?,?,?,?,?,?,?,?,?)',
                    [$sale_id, $p['product_id'], $p['quantity'], $p['price'], $p['unit_cost'], $lineSubtotal, $lineDiscount, $p['promotion_id'], $lineSubtotal - $lineDiscount]
                );
            }

            // Pagos + movimientos de caja (el efectivo entra a la caja; la propina también)
            foreach ($payments as $p) {
                $this->db->insert(
                    'INSERT INTO sale_payments (sale_id, store_id, method, amount, is_tip, register_id, share_id, reference, verified_at, created_by, created_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,NOW())',
                    [
                        $sale_id, $store_id, $p['method'], $p['amount'], $p['is_tip'],
                        ($p['method'] === PAYMENT_CASH ? $register_id : null),
                        $p['share_id'], $p['reference'],
                        !empty($p['verified']) ? date('Y-m-d H:i:s') : null,
                        $user_id,
                    ]
                );

                if ($p['method'] === PAYMENT_CASH && $p['amount'] > 0) {
                    $this->db->insert(
                        'INSERT INTO cash_movements (register_id, user_id, movement_type, amount, description, created_at) VALUES (?,?,?,?,?,NOW())',
                        [$register_id, $user_id, 'sale', $p['amount'], $this->descripcionCaja($p, $sale_id)]
                    );
                }
            }

            if (!$externa) { $this->db->commit(); }
        } catch (Exception $e) {
            if (!$externa) { $this->db->rollback(); }
            throw $e;
        }

        // Vincular el cobro Stripe con la venta recién registrada (fuera de la transacción,
        // igual que antes: la venta ya quedó bien registrada aunque esto falle).
        if ($stripePaymentId !== null && $stripeService !== null) {
            try { $stripeService->linkToSale($stripePaymentId, $sale_id); } catch (Exception $e) { /* ya quedó la venta */ }
        }

        return [
            'sale_id'         => (int)$sale_id,
            'store_id'        => $store_id,
            'subtotal'        => $subtotal,
            'discount'        => round((float)($params['discount'] ?? 0), 2),
            'tax'             => $tax,
            'total'           => $total,
            'tip_amount'      => $tip,
            'amount_paid'     => $amount_paid,
            'debt'            => round($total - $amount_paid, 2),
            'payment_method'  => $pagos['metodo_venta'],
            'register_id'     => (int)$register_id,
            'register_opened' => $caja['abierta_automaticamente'],
            'payments'        => $payments,
            'change'          => $cambio,
        ];
    }

    // =========================================================
    // Piezas
    // =========================================================

    /**
     * Resuelve la caja donde entra el dinero.
     *
     * Prioridad: la que mandó el llamador, la del usuario, la única abierta de la tienda.
     * Si no hay ninguna y la tienda no exige apertura formal, se abre una automáticamente
     * (comportamiento que ya tenía el POS, y que el salón necesita para no dejar al mesero
     * sin poder cobrar).
     */
    private function resolverCaja($store_id, $user_id, $register_id, $requireOpenRegister) {
        if ($register_id > 0) {
            $open = $this->db->selectOne(
                'SELECT register_id FROM cash_registers WHERE register_id = ? AND store_id = ? AND status = ?',
                [$register_id, $store_id, REGISTER_OPEN]
            );
            if (!$open) { throw new Exception('La caja especificada no está abierta en esta tienda', 409); }
            return ['register_id' => (int)$open['register_id'], 'abierta_automaticamente' => false];
        }

        $open = $this->db->selectOne(
            'SELECT register_id FROM cash_registers WHERE store_id = ? AND user_id = ? AND status = ?',
            [$store_id, $user_id, REGISTER_OPEN]
        );
        if ($open) {
            return ['register_id' => (int)$open['register_id'], 'abierta_automaticamente' => false];
        }

        $abiertas = $this->db->select('SELECT register_id FROM cash_registers WHERE store_id = ? AND status = ?', [$store_id, REGISTER_OPEN]);
        if (count($abiertas) === 1) {
            return ['register_id' => (int)$abiertas[0]['register_id'], 'abierta_automaticamente' => false];
        }
        if (count($abiertas) > 1) {
            throw new Exception('Hay múltiples cajas abiertas. Por favor seleccione una terminal o abra su propia caja.', 409);
        }
        if ($requireOpenRegister) {
            throw new Exception('No hay caja abierta. Abra la caja (Finanzas → Abrir caja) antes de vender.', 409);
        }

        // Fallback: abrir caja automáticamente (una terminal de la tienda o una nueva).
        $terminals = $this->db->select('SELECT terminal_id FROM terminals WHERE store_id = ? AND status = "active"', [$store_id]);
        $terminal_id = count($terminals) > 0
            ? (int)$terminals[0]['terminal_id']
            : (int)$this->db->insert('INSERT INTO terminals (store_id, terminal_name) VALUES (?, ?)', [$store_id, 'Caja Automática']);

        $nueva = (int)$this->db->insert(
            'INSERT INTO cash_registers (store_id, user_id, terminal_id, opening_date, initial_amount, status) VALUES (?, ?, ?, NOW(), 0, ?)',
            [$store_id, $user_id, $terminal_id, REGISTER_OPEN]
        );
        return ['register_id' => $nueva, 'abierta_automaticamente' => true];
    }

    /**
     * Construye las líneas de la venta.
     *
     * Camino POS (`items`): precio del servidor con promociones, igual que siempre.
     * Camino cuenta (`lines`): se pide a Pricing el costo, el inventario y la validación de
     * existencias, y el PRECIO se toma de lo anotado en la cuenta.
     */
    private function construirLineas($store_id, array $params, $allowNegativeStock) {
        $items = isset($params['items']) && is_array($params['items']) ? $params['items'] : [];
        $lines = isset($params['lines']) && is_array($params['lines']) ? $params['lines'] : null;

        if ($lines === null && !$items) { throw new SaleValidationException(['items' => 'Lista vacía']); }

        // Para inventario y existencias siempre se pide el cálculo del servidor, con las
        // cantidades agregadas por producto (la cuenta puede tener el mismo platillo en
        // varias líneas por persona o por notas).
        $paraPricing = [];
        $fuente = $lines !== null ? $lines : $items;
        foreach ($fuente as $it) {
            $pid = (int)($it['product_id'] ?? 0);
            $qty = (float)($it['quantity'] ?? 0);
            if ($pid <= 0) { throw new SaleValidationException(['items' => 'Falta el producto en una de las líneas']); }
            if ($qty <= 0) { throw new SaleValidationException(['items' => 'La cantidad debe ser mayor que cero']); }
            if (!isset($paraPricing[$pid])) { $paraPricing[$pid] = 0.0; }
            $paraPricing[$pid] += $qty;
        }
        $itemsAgregados = [];
        foreach ($paraPricing as $pid => $qty) {
            $itemsAgregados[] = ['product_id' => $pid, 'quantity' => $qty];
        }

        $pricingResult = $this->pricing->calculate($store_id, $itemsAgregados, $allowNegativeStock);
        $porProducto = [];
        foreach ($pricingResult['lines'] as $line) {
            $porProducto[(int)$line['product_id']] = $line;
        }

        if ($lines === null) {
            // Camino POS: se usa el subtotal que ya calculó Pricing (promociones de línea
            // incluidas), exactamente como lo hacía create_sale.php antes de este servicio.
            return ['lines' => $pricingResult['lines'], 'subtotal' => (float)$pricingResult['subtotal']];
        }

        // Camino cuenta: precio y descuento de lo anotado; costo, inventario y tipo de
        // seguimiento del cálculo del servidor.
        $resultado = [];
        $subtotal = 0.0;
        $porProductoCuenta = [];
        foreach ($lines as $it) {
            $pid = (int)$it['product_id'];
            if (!isset($porProductoCuenta[$pid])) {
                $porProductoCuenta[$pid] = ['quantity' => 0.0, 'importe' => 0.0, 'unit_price' => (float)$it['unit_price']];
            }
            $qty = (float)$it['quantity'];
            $porProductoCuenta[$pid]['quantity'] += $qty;
            $porProductoCuenta[$pid]['importe'] += $qty * (float)$it['unit_price'];
            $porProductoCuenta[$pid]['unit_price'] = (float)$it['unit_price'];
        }
        foreach ($porProductoCuenta as $pid => $acc) {
            if (!isset($porProducto[$pid])) {
                throw new Exception('El producto ' . $pid . ' no está disponible en esta tienda', 404);
            }
            $line = $porProducto[$pid];
            $unit = (float)$acc['unit_price'];
            $qty  = (float)$acc['quantity'];
            $line['unit_price'] = $unit;
            $line['quantity']   = $qty;
            $line['discount']   = 0.0;
            $line['promotion_id'] = null;
            // Pricing nombra el importe de la línea 'total' (no 'line_total').
            $line['total'] = round($qty * $unit, 2);
            $subtotal += $line['total'];
            $resultado[] = $line;
        }
        return ['lines' => $resultado, 'subtotal' => round($subtotal, 2)];
    }

    /**
     * Normaliza los pagos: los desglosados que manda el llamador, o uno sintetizado con los
     * campos de siempre (POS). Valida que la suma cuadre con el total y con la propina.
     */
    private function normalizarPagos(array $params, $payment_method, $total, $tip, $cash_amount, $amount_paid_in, $customer_id) {
        $entrantes = isset($params['payments']) && is_array($params['payments']) && $params['payments']
            ? $params['payments'] : null;

        if ($entrantes !== null) {
            $payments = [];
            $sumaConsumo = 0.0;
            $sumaPropina = 0.0;
            $metodosConsumo = [];
            foreach ($entrantes as $p) {
                $m = isset($p['method']) ? (string)$p['method'] : '';
                if (!in_array($m, self::$METODOS, true)) {
                    throw new SaleValidationException(['payments' => 'Método de pago inválido: ' . $m]);
                }
                $amt = round((float)($p['amount'] ?? 0), 2);
                if ($amt < 0) { throw new SaleValidationException(['payments' => 'Un pago no puede ser negativo']); }
                $esTip = !empty($p['is_tip']);
                if ($esTip && in_array($m, self::$METODOS_DEUDA, true)) {
                    throw new SaleValidationException(['tip_amount' => 'La propina no puede quedar fiada: cóbrela en efectivo, tarjeta o transferencia']);
                }
                if ($esTip) { $sumaPropina += $amt; } else { $sumaConsumo += $amt; $metodosConsumo[$m] = true; }
                $payments[] = [
                    'method'    => $m,
                    'amount'    => $amt,
                    'is_tip'    => $esTip ? 1 : 0,
                    'reference' => isset($p['reference']) ? mb_substr((string)$p['reference'], 0, 80) : null,
                    'verified'  => !empty($p['verified']),
                    'share_id'  => isset($p['share_id']) && (int)$p['share_id'] > 0 ? (int)$p['share_id'] : null,
                ];
            }
            if (abs(round($sumaConsumo, 2) - $total) > self::TOLERANCIA) {
                throw new Exception(
                    'Los pagos no cuadran con la cuenta: suman ' . number_format($sumaConsumo, 2) .
                    ' y el total es ' . number_format($total, 2),
                    409
                );
            }
            if (abs(round($sumaPropina, 2) - $tip) > self::TOLERANCIA) {
                throw new Exception(
                    'La propina no cuadra: los pagos marcan ' . number_format($sumaPropina, 2) .
                    ' y la propina es ' . number_format($tip, 2),
                    409
                );
            }
            $metodo_venta = count($metodosConsumo) === 1 ? array_keys($metodosConsumo)[0] : PAYMENT_MIXED;
            return ['payments' => $payments, 'metodo_venta' => $metodo_venta];
        }

        // ---- Camino POS: un solo pago, como siempre
        if (!in_array($payment_method, [PAYMENT_CASH, PAYMENT_CARD, PAYMENT_TRANSFER, PAYMENT_MIXED, PAYMENT_CREDIT, PAYMENT_CODI, PAYMENT_STRIPE], true)) {
            throw new SaleValidationException(['payment_method' => 'Metodo invalido']);
        }
        if ($payment_method === PAYMENT_MIXED && ($cash_amount === null || $cash_amount < 0)) {
            throw new SaleValidationException(['cash_amount' => 'Requerido en pago mixto']);
        }
        if ($payment_method === PAYMENT_CREDIT && $customer_id <= 0) {
            throw new SaleValidationException(['customer_id' => 'Requerido para apartado']);
        }

        $payments = [];
        if ($payment_method === PAYMENT_CREDIT) {
            if ($amount_paid_in < 0 || $amount_paid_in > $total) {
                throw new SaleValidationException(['amount_paid' => 'Monto inválido para apartado']);
            }
            if ($amount_paid_in > 0) {
                $payments[] = [
                    'method' => PAYMENT_CASH, 'amount' => round($amount_paid_in, 2), 'is_tip' => 0,
                    'reference' => null, 'verified' => false, 'share_id' => null,
                    'descripcion' => 'apartado, pago parcial',
                ];
            }
            $resto = round($total - $amount_paid_in, 2);
            if ($resto > 0) {
                $payments[] = ['method' => PAYMENT_CREDIT, 'amount' => $resto, 'is_tip' => 0,
                    'reference' => null, 'verified' => false, 'share_id' => null];
            }
        } elseif ($payment_method === PAYMENT_MIXED) {
            $cash = round((float)$cash_amount, 2);
            $payments[] = ['method' => PAYMENT_CASH, 'amount' => $cash, 'is_tip' => 0,
                'reference' => null, 'verified' => false, 'share_id' => null];
            $resto = round($total - $cash, 2);
            if ($resto > 0) {
                $payments[] = ['method' => PAYMENT_CARD, 'amount' => $resto, 'is_tip' => 0,
                    'reference' => null, 'verified' => false, 'share_id' => null];
            }
        } else {
            $payments[] = ['method' => $payment_method, 'amount' => round($total, 2), 'is_tip' => 0,
                'reference' => null, 'verified' => false, 'share_id' => null];
        }

        if ($tip > 0) {
            $payments[] = ['method' => PAYMENT_CASH, 'amount' => round($tip, 2), 'is_tip' => 1,
                'reference' => null, 'verified' => false, 'share_id' => null];
        }

        return ['payments' => $payments, 'metodo_venta' => $payment_method];
    }

    /** Descripción del movimiento de caja. */
    private function descripcionCaja(array $p, $sale_id) {
        if (!empty($p['is_tip'])) { return 'Propina venta #' . $sale_id; }
        if (!empty($p['descripcion'])) { return 'Venta #' . $sale_id . ' (' . $p['descripcion'] . ')'; }
        return 'Venta #' . $sale_id;
    }
}

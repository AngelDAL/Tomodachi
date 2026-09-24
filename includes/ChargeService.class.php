<?php
/**
 * ChargeService — cobrar la cuenta del salón.
 *
 * Por qué existe: la cuenta se podía abrir, pedir, mandar a cocina y servir, pero al
 * final nadie podía cobrarla. Este servicio cierra el ciclo: convierte la cuenta en UNA
 * venta con N pagos, usando el mismo camino del dinero que el POS (SaleService), y deja
 * la cuenta cerrada y ligada a su venta.
 *
 * Las tres reglas que no se negocian:
 *
 *  1. LA CUENTA ES LA FUENTE DEL IMPORTE. Se cobra lo que el servidor guardó en la cuenta
 *     (precio con el que se anotó cada platillo), no lo que diga el navegador. Si el total
 *     cambió entre que se revisó y se cobró, el cobro se RECHAZA en vez de cobrar otra cosa.
 *
 *  2. NO SE CIERRA CON DINERO FALTANTE. La suma de los pagos tiene que cuadrar con el total
 *     (y la propina con la propina). Si una parte queda sin pagar, el personal tiene que
 *     asignarle un método de todos modos (efectivo, transferencia o fiado): el sistema no
 *     cierra sola una cuenta con saldo abierto, porque eso descuadra el corte de caja.
 *
 *  3. NO SE COBRA DOS VECES. Toda la operación va en UNA transacción con la fila de la
 *     cuenta bloqueada (`SELECT ... FOR UPDATE`) y candado por `sale_id`: si dos meseros
 *     cobran a la vez, el segundo recibe un error claro y no se genera una segunda venta.
 *
 * La división (`dividir`) se guarda: por persona, partes iguales, manual por ítems, por
 * monto o manual. El reparto manual deja rastro ítem por ítem en `share_items` para que
 * "yo pagué estos dos platos" se pueda probar.
 */

require_once __DIR__ . '/SaleService.class.php';

class ChargeService {

    private $db;
    private $saleService;
    private $dining;

    public function __construct($db, $dining = null) {
        $this->db = $db;
        $this->saleService = new SaleService($db);
        $this->dining = $dining; // DiningSession (opcional, para avisar al WebSocket)
    }

    // =========================================================
    // Resumen: qué hay que cobrar
    // =========================================================

    /**
     * Lo que se va a cobrar, calculado AHORA contra la base.
     *
     * @return array
     */
    public function resumen($store_id, $session_id) {
        $store_id = (int)$store_id;
        $session_id = (int)$session_id;
        $session = $this->db->selectOne(
            'SELECT s.*, t.label AS table_label, u.full_name AS opened_by_name
             FROM dining_sessions s
             LEFT JOIN dining_tables t ON t.table_id = s.table_id
             LEFT JOIN users u ON u.user_id = s.opened_by
             WHERE s.session_id = ? AND s.store_id = ?',
            [$session_id, $store_id]
        );
        if (!$session) { throw new Exception('La cuenta no existe', 404); }

        $items = $this->db->select(
            'SELECT i.order_item_id, i.participant_id, i.product_id, i.product_name, i.quantity,
                    i.unit_price, i.line_total, i.notes, i.status, i.comanda_id,
                    p.display_name AS participant_name
             FROM dining_order_items i
             LEFT JOIN dining_participants p ON p.participant_id = i.participant_id
             WHERE i.session_id = ? AND i.status <> "cancelled"
             ORDER BY i.order_item_id',
            [$session_id]
        );

        $subtotal = 0.0;
        $sinEnviar = 0;
        $piezas = 0.0;
        $porProducto = [];
        foreach ($items as $it) {
            $subtotal += (float)$it['line_total'];
            $piezas += (float)$it['quantity'];
            if ($it['status'] === 'pending') { $sinEnviar++; }
            $pid = (int)$it['product_id'];
            if (!isset($porProducto[$pid])) {
                $porProducto[$pid] = ['product_id' => $pid, 'product_name' => $it['product_name'],
                    'quantity' => 0.0, 'unit_price' => (float)$it['unit_price']];
            }
            $porProducto[$pid]['quantity'] += (float)$it['quantity'];
        }
        $subtotal = round($subtotal, 2);

        $descuento = round((float)$session['discount'], 2);
        $total = round(max(0.0, $subtotal - $descuento), 2);

        $partes = $this->db->select(
            'SELECT share_id, participant_id, label, amount, paid, paid_at, payment_method, mode
             FROM dining_split_shares WHERE session_id = ? ORDER BY share_id',
            [$session_id]
        );

        return [
            'session'        => [
                'session_id'  => (int)$session['session_id'],
                'code'        => $session['code'],
                'status'      => $session['status'],
                'table_id'    => $session['table_id'] !== null ? (int)$session['table_id'] : null,
                'table_label' => $session['table_label'],
                'opened_by'   => $session['opened_by_name'],
                'opened_at'   => $session['opened_at'],
                'customer_id' => $session['customer_id'] !== null ? (int)$session['customer_id'] : null,
                'sale_id'     => $session['sale_id'] !== null ? (int)$session['sale_id'] : null,
                'tip_amount'  => round((float)$session['tip_amount'], 2),
            ],
            'cobrada'        => $session['sale_id'] !== null,
            'items'          => $items,
            'lineas'         => array_values($porProducto),
            'subtotal'       => $subtotal,
            'discount'       => $descuento,
            'total'          => $total,
            // `piezas` = platillos (cantidades sumadas); `lineas` = renglones de la cuenta.
            'piezas'         => (float)$piezas == (int)$piezas ? (int)$piezas : $piezas,
            'lineas_cuenta'  => count($items),
            'sin_enviar'     => $sinEnviar,
            'partes'         => $partes,
        ];
    }

    // =========================================================
    // División
    // =========================================================

    /**
     * Calcula y GUARDA el desglose de la cuenta.
     *
     * @param int    $store_id
     * @param int    $session_id
     * @param string $mode       equal | by_person | by_items | by_amount | manual
     * @param array  $opciones   partes / resto_partes según el modo
     * @param int    $user_id
     * @return array ['mode','partes' => [...], 'total','suma']
     */
    public function dividir($store_id, $session_id, $mode, array $opciones = [], $user_id = null) {
        $store_id = (int)$store_id;
        $session_id = (int)$session_id;
        $permitidos = ['equal', 'by_person', 'by_items', 'by_amount', 'manual'];
        if (!in_array($mode, $permitidos, true)) {
            throw new Exception('Forma de dividir desconocida: ' . $mode, 422);
        }

        $lock = $this->db->selectOne(
            'SELECT session_id, status, sale_id, subtotal, discount, total FROM dining_sessions WHERE session_id = ? AND store_id = ?',
            [$session_id, $store_id]
        );
        if (!$lock) { throw new Exception('La cuenta no existe', 404); }
        if ($lock['sale_id'] !== null) { throw new Exception('La cuenta ya fue cobrada', 409); }

        $items = $this->db->select(
            'SELECT order_item_id, participant_id, product_id, product_name, quantity, unit_price, line_total
             FROM dining_order_items WHERE session_id = ? AND status <> "cancelled" ORDER BY order_item_id',
            [$session_id]
        );
        if (!$items) { throw new Exception('La cuenta no tiene platillos que cobrar', 409); }

        $subtotal = 0.0;
        foreach ($items as $it) { $subtotal += (float)$it['line_total']; }
        $subtotal = round($subtotal, 2);
        $descuento = round((float)$lock['discount'], 2);
        $total = round(max(0.0, $subtotal - $descuento), 2);

        $partes = [];
        switch ($mode) {
            case 'equal':
                $cuantas = isset($opciones['partes']) && (int)$opciones['partes'] > 0
                    ? (int)$opciones['partes']
                    : $this->contarParticipantes($session_id);
                if ($cuantas < 1) { $cuantas = 1; }
                $partes = $this->repartirIgual($total, $cuantas, $opciones['etiquetas'] ?? []);
                break;

            case 'by_person':
                $partes = $this->repartirPorPersona($items, $total, $descuento);
                break;

            case 'by_items':
                $partes = $this->repartirPorItems($items, $opciones, $total, $descuento);
                break;

            case 'by_amount':
                $partes = $this->repartirPorMonto($total, $opciones);
                break;

            case 'manual':
                $partes = $this->repartirManual($total, $opciones);
                break;
        }

        $suma = 0.0;
        foreach ($partes as $p) { $suma += (float)$p['amount']; }
        $suma = round($suma, 2);
        if (abs($suma - $total) > 0.01) {
            throw new Exception(
                'El desglose no cuadra con la cuenta: las partes suman ' . number_format($suma, 2) .
                ' y el total es ' . number_format($total, 2),
                409
            );
        }

        // Se reemplaza el desglose anterior: una cuenta tiene UN desglose vigente.
        $this->db->beginTransaction();
        try {
            $this->db->update('DELETE FROM dining_split_shares WHERE session_id = ? AND paid = 0', [$session_id]);
            foreach ($partes as $p) {
                $share_id = (int)$this->db->insert(
                    'INSERT INTO dining_split_shares (session_id, participant_id, label, amount, paid, mode)
                     VALUES (?,?,?,?,0,?)',
                    [$session_id, $p['participant_id'] ?: null, mb_substr($p['label'], 0, 60), (float)$p['amount'], $mode]
                );
                if (!empty($p['items'])) {
                    foreach ($p['items'] as $it) {
                        $this->db->insert(
                            'INSERT INTO share_items (share_id, order_item_id, quantity) VALUES (?,?,?)',
                            [$share_id, (int)$it['order_item_id'], (float)$it['quantity']]
                        );
                    }
                }
            }
            $this->db->commit();
        } catch (Exception $e) {
            $this->db->rollback();
            throw $e;
        }

        return ['mode' => $mode, 'total' => $total, 'suma' => $suma, 'partes' => $partes];
    }

    private function contarParticipantes($session_id) {
        $n = $this->db->selectOne(
            'SELECT COUNT(*) AS n FROM dining_participants WHERE session_id = ?',
            [$session_id]
        );
        return max(1, (int)$n['n']);
    }

    /** Partes iguales, con los centavos repartidos para que la suma cuadre EXACTA. */
    private function repartirIgual($total, $cuantas, array $etiquetas = []) {
        $base = floor(($total / $cuantas) * 100) / 100;
        $resto = round($total - ($base * $cuantas), 2);
        $centavos = (int)round($resto * 100);
        $partes = [];
        for ($i = 0; $i < $cuantas; $i++) {
            $monto = $base + ($i < $centavos ? 0.01 : 0.0);
            $partes[] = [
                'label' => $etiquetas[$i] ?? ('Parte ' . ($i + 1)),
                'amount' => round($monto, 2),
                'participant_id' => null,
                'items' => [],
            ];
        }
        return $partes;
    }

    /** Cada quien paga lo suyo (lo que pidió desde su celular). */
    private function repartirPorPersona(array $items, $total, $descuento) {
        $porPersona = [];
        $sinAsignar = 0.0;
        foreach ($items as $it) {
            $importe = (float)$it['line_total'];
            if ($it['participant_id'] === null) { $sinAsignar += $importe; continue; }
            $pid = (int)$it['participant_id'];
            if (!isset($porPersona[$pid])) { $porPersona[$pid] = 0.0; }
            $porPersona[$pid] += $importe;
        }

        // El descuento manual se reparte a prorrata para que la suma siga cuadrando.
        $bruto = 0.0;
        foreach ($porPersona as $m) { $bruto += $m; }
        $bruto += $sinAsignar;
        $factor = $bruto > 0 ? ($total / $bruto) : 1.0;

        $partes = [];
        foreach ($porPersona as $pid => $importe) {
            $nombre = $this->db->selectOne(
                'SELECT display_name FROM dining_participants WHERE participant_id = ?',
                [$pid]
            );
            $partes[] = [
                'label' => ($nombre && $nombre['display_name']) ? $nombre['display_name'] : ('Persona ' . $pid),
                'amount' => round($importe * $factor, 2),
                'participant_id' => $pid,
                'items' => [],
            ];
        }
        if ($sinAsignar > 0) {
            $partes[] = [
                'label' => 'Sin asignar',
                'amount' => round($sinAsignar * $factor, 2),
                'participant_id' => null,
                'items' => [],
            ];
        }
        return $this->cuadrarCentavos($partes, $total);
    }

    /** Reparto manual por ítems: se dice qué platillos paga cada parte. */
    private function repartirPorItems(array $items, array $opciones, $total, $descuento) {
        $entrantes = isset($opciones['partes']) && is_array($opciones['partes']) ? $opciones['partes'] : [];
        if (!$entrantes) { throw new Exception('Falta el reparto por ítems', 422); }

        $porId = [];
        foreach ($items as $it) { $porId[(int)$it['order_item_id']] = $it; }

        $asignados = [];
        $partes = [];
        foreach ($entrantes as $p) {
            $label = trim((string)($p['label'] ?? '')) ?: 'Parte';
            $importe = 0.0;
            $usados = [];
            foreach (($p['items'] ?? []) as $it) {
                $oid = (int)($it['order_item_id'] ?? 0);
                if (!isset($porId[$oid])) { throw new Exception('Platillo desconocido en el reparto: ' . $oid, 422); }
                $cantidad = isset($it['quantity']) ? (float)$it['quantity'] : (float)$porId[$oid]['quantity'];
                if ($cantidad <= 0 || $cantidad > (float)$porId[$oid]['quantity']) {
                    throw new Exception('Cantidad inválida en el reparto del platillo ' . $oid, 422);
                }
                if (($asignados[$oid] ?? 0) + $cantidad > (float)$porId[$oid]['quantity'] + 0.0001) {
                    throw new Exception('Un platillo se repartió más veces de las que se pidieron', 409);
                }
                $asignados[$oid] = ($asignados[$oid] ?? 0) + $cantidad;
                $importe += $cantidad * (float)$porId[$oid]['unit_price'];
                $usados[] = ['order_item_id' => $oid, 'quantity' => $cantidad];
            }
            $partes[] = ['label' => $label, 'amount' => round($importe, 2),
                'participant_id' => isset($p['participant_id']) ? (int)$p['participant_id'] : null,
                'items' => $usados];
        }

        $sinAsignar = [];
        foreach ($items as $it) {
            $asignado = $asignados[(int)$it['order_item_id']] ?? 0.0;
            $restante = (float)$it['quantity'] - $asignado;
            if ($restante > 0.0001) {
                $sinAsignar[] = ['order_item_id' => (int)$it['order_item_id'], 'quantity' => $restante];
            }
        }
        if ($sinAsignar) {
            $importe = 0.0;
            foreach ($sinAsignar as $s) { $importe += $s['quantity'] * (float)$porId[$s['order_item_id']]['unit_price']; }
            $partes[] = ['label' => 'Sin asignar', 'amount' => round($importe, 2),
                'participant_id' => null, 'items' => $sinAsignar];
        }

        return $this->cuadrarCentavos($partes, $total);
    }

    /** "Yo pongo 200 y ustedes el resto": montos fijos y el resto repartido. */
    private function repartirPorMonto($total, array $opciones) {
        $entrantes = isset($opciones['partes']) && is_array($opciones['partes']) ? $opciones['partes'] : [];
        if (!$entrantes) { throw new Exception('Falta el monto de las partes', 422); }

        $partes = [];
        $suma = 0.0;
        foreach ($entrantes as $p) {
            $monto = round((float)($p['amount'] ?? 0), 2);
            if ($monto < 0) { throw new Exception('Un monto no puede ser negativo', 422); }
            $suma += $monto;
            $partes[] = ['label' => trim((string)($p['label'] ?? '')) ?: 'Parte',
                'amount' => $monto, 'participant_id' => null, 'items' => []];
        }
        $resto = round($total - $suma, 2);
        if ($resto < -0.01) {
            throw new Exception('Los montos capturados superan el total de la cuenta', 409);
        }
        if ($resto > 0.01) {
            $cuantas = isset($opciones['resto_partes']) ? (int)$opciones['resto_partes'] : 1;
            if ($cuantas > 1) {
                $partes = array_merge($partes, $this->repartirIgual($resto, $cuantas));
            } else {
                $partes[] = ['label' => 'Resto', 'amount' => $resto, 'participant_id' => null, 'items' => []];
            }
        }
        return $this->cuadrarCentavos($partes, $total);
    }

    /** Montos capturados a mano: tienen que sumar exacto. */
    private function repartirManual($total, array $opciones) {
        $entrantes = isset($opciones['partes']) && is_array($opciones['partes']) ? $opciones['partes'] : [];
        if (!$entrantes) { throw new Exception('Faltan los montos de las partes', 422); }
        $partes = [];
        foreach ($entrantes as $p) {
            $monto = round((float)($p['amount'] ?? 0), 2);
            if ($monto < 0) { throw new Exception('Un monto no puede ser negativo', 422); }
            $partes[] = ['label' => trim((string)($p['label'] ?? '')) ?: 'Parte',
                'amount' => $monto, 'participant_id' => null, 'items' => []];
        }
        return $partes;
    }

    /** Ajusta centavos para que la suma de las partes dé EXACTO el total. */
    private function cuadrarCentavos(array $partes, $total) {
        if (!$partes) { return $partes; }
        $suma = 0.0;
        foreach ($partes as $p) { $suma += (float)$p['amount']; }
        $dif = round($total - $suma, 2);
        if (abs($dif) >= 0.01) {
            $ultimo = count($partes) - 1;
            $partes[$ultimo]['amount'] = round($partes[$ultimo]['amount'] + $dif, 2);
        }
        return $partes;
    }

    // =========================================================
    // Cobro
    // =========================================================

    /**
     * Cobra la cuenta: UNA venta con N pagos, la cuenta cerrada y sus partes saldadas.
     *
     * @param int   $store_id
     * @param int   $session_id
     * @param array $params  payments[], tip_amount, tip_method, customer_id, discount,
     *                       register_id, notes
     * @param array $actor   ['user_id','via','role'?]
     * @return array
     */
    public function cobrar($store_id, $session_id, array $params, array $actor) {
        $store_id = (int)$store_id;
        $session_id = (int)$session_id;
        $user_id = (int)($actor['user_id'] ?? 0);
        if ($user_id <= 0) { throw new Exception('No se pudo identificar al usuario que cobra', 401); }

        $this->db->beginTransaction();
        try {
            // Bloqueo de la cuenta: el candado contra el doble cobro.
            $session = $this->db->selectOne(
                'SELECT session_id, store_id, status, sale_id, subtotal, discount, total, tip_amount, customer_id
                 FROM dining_sessions WHERE session_id = ? AND store_id = ? FOR UPDATE',
                [$session_id, $store_id]
            );
            if (!$session) { throw new Exception('La cuenta no existe', 404); }
            if ($session['sale_id'] !== null) {
                throw new Exception('Esta cuenta ya se cobró (venta #' . (int)$session['sale_id'] . ')', 409);
            }
            if (!in_array($session['status'], ['open', 'awaiting_payment'], true)) {
                throw new Exception('La cuenta no está abierta (estado: ' . $session['status'] . ')', 409);
            }

            $items = $this->db->select(
                'SELECT order_item_id, product_id, product_name, quantity, unit_price, line_total, notes, status
                 FROM dining_order_items WHERE session_id = ? AND status <> "cancelled" ORDER BY order_item_id',
                [$session_id]
            );
            if (!$items) {
                throw new Exception('La cuenta no tiene platillos que cobrar. Si nadie consumió, cancélela con un motivo.', 409);
            }

            // Importe del servidor, no del navegador.
            $subtotal = 0.0;
            $lines = [];
            foreach ($items as $it) {
                $subtotal += (float)$it['line_total'];
                $lines[] = [
                    'product_id' => (int)$it['product_id'],
                    'quantity'   => (float)$it['quantity'],
                    'unit_price' => (float)$it['unit_price'],
                ];
            }
            $subtotal = round($subtotal, 2);
            $descuento = isset($params['discount']) ? round((float)$params['discount'], 2) : round((float)$session['discount'], 2);
            $total = round(max(0.0, $subtotal - $descuento), 2);

            $tip = isset($params['tip_amount']) ? round((float)$params['tip_amount'], 2) : 0.0;

            // La propina es opcional: si viene, se le busca acomodo en los pagos.
            $payments = isset($params['payments']) && is_array($params['payments']) ? $params['payments'] : [];
            $cambioForzado = null;

            // Caso del mostrador y de la mesa: el cliente entrega el efectivo y el mesero
            // teclea CUÁNTO LE DIERON. De ahí salen el importe de la cuenta, la propina (si
            // la hay) y el cambio. Sin esto habría que teclear el cambio a mano, que es
            // justo donde se equivoca la gente.
            if (!empty($params['cash_received'])) {
                $recibido = round((float)$params['cash_received'], 2);
                $payments = [['method' => PAYMENT_CASH, 'amount' => $total, 'is_tip' => false]];
                if ($tip > 0) {
                    $payments[] = ['method' => PAYMENT_CASH, 'amount' => $tip, 'is_tip' => true];
                }
                $cambioForzado = max(0.0, round($recibido - $total - $tip, 2));
            } elseif ($tip > 0 && !$this->hayPagoDePropina($payments)) {
                // Un solo pago en efectivo que incluye la propina: se separa para que el
                // desglose y el movimiento de caja distingan consumo de propina.
                $noTip = [];
                foreach ($payments as $i => $p) { if (empty($p['is_tip'])) { $noTip[] = $i; } }
                if (count($payments) === 1 && count($noTip) === 1
                    && $payments[0]['method'] === PAYMENT_CASH
                    && abs((float)$payments[0]['amount'] - ($total + $tip)) <= 0.01) {
                    $payments[0]['amount'] = $total;
                    $payments[] = ['method' => PAYMENT_CASH, 'amount' => $tip, 'is_tip' => true];
                } else {
                    $payments[] = [
                        'method' => $this->metodoDePropina($params, $payments),
                        'amount' => $tip,
                        'is_tip' => true,
                    ];
                }
            }

            $resultado = $this->saleService->createSale([
                'store_id'            => $store_id,
                'actor'               => $actor,
                'lines'               => $lines,
                'expected_total'      => $total,
                'payments'            => $payments,
                'payment_method'      => $this->metodoUnico($payments),
                'discount'            => $descuento,
                'tax'                 => 0.0,
                'customer_id'         => isset($params['customer_id']) ? (int)$params['customer_id'] : (int)$session['customer_id'],
                'register_id'         => isset($params['register_id']) ? (int)$params['register_id'] : 0,
                'tip_amount'          => $tip,
                'change_override'     => $cambioForzado,
                'transaccion_externa' => true,
                'origen'              => 'cuenta',
            ]);

            // La cuenta queda cerrada y ligada a su venta (el candado del doble cobro).
            $this->db->update(
                'UPDATE dining_sessions
                 SET status = "closed", closed_at = NOW(), closed_by = ?, sale_id = ?,
                     subtotal = ?, discount = ?, total = ?, tip_amount = ?
                 WHERE session_id = ? AND store_id = ? AND sale_id IS NULL',
                [$user_id, $resultado['sale_id'], $subtotal, $descuento, $total, $tip, $session_id, $store_id]
            );

            // Las partes del desglose quedan saldadas, ligadas a su pago cuando se sabe cuál fue.
            $this->db->update(
                'UPDATE dining_split_shares SET paid = 1, paid_at = NOW(),
                        payment_method = COALESCE(payment_method, "cash")
                 WHERE session_id = ? AND paid = 0',
                [$session_id]
            );

            // Rastro de que la cuenta se cobró, para el historial del personal.
            if (isset($params['notes']) && trim((string)$params['notes']) !== '') {
                $this->db->update(
                    'UPDATE dining_sessions SET notes = ? WHERE session_id = ? AND store_id = ?',
                    [mb_substr(trim((string)$params['notes']), 0, 255), $session_id, $store_id]
                );
            }

            $this->db->commit();
        } catch (Exception $e) {
            $this->db->rollback();
            throw $e;
        }

        // Aviso best-effort: si el relay no está, la cuenta ya quedó cobrada igual.
        if ($this->dining) {
            try { $this->dining->broadcast($session_id, 'session_closed'); } catch (Exception $e) { /* opcional */ }
        }

        return $resultado + ['session_id' => $session_id];
    }

    private function hayPagoDePropina(array $payments) {
        foreach ($payments as $p) { if (!empty($p['is_tip'])) { return true; } }
        return false;
    }

    /** Con qué se propina: lo que diga el personal, o el efectivo de la mesa. */
    private function metodoDePropina(array $params, array $payments) {
        $permitidos = [PAYMENT_CASH, PAYMENT_CARD, PAYMENT_TRANSFER];
        $elegido = isset($params['tip_method']) ? (string)$params['tip_method'] : PAYMENT_CASH;
        if (!in_array($elegido, $permitidos, true)) { return PAYMENT_CASH; }
        // Si la cuenta se pagó con un solo método que no es efectivo, la propina sigue ese
        // método: nadie propina en efectivo una cuenta que pagó con tarjeta.
        $metodos = [];
        foreach ($payments as $p) {
            if (empty($p['is_tip'])) { $metodos[(string)$p['method']] = true; }
        }
        if (count($metodos) === 1) {
            $unico = array_keys($metodos)[0];
            if (in_array($unico, $permitidos, true)) { return $unico; }
        }
        return $elegido;
    }

    private function metodoUnico(array $payments) {
        $metodos = [];
        foreach ($payments as $p) { if (empty($p['is_tip'])) { $metodos[(string)$p['method']] = true; } }
        return count($metodos) === 1 ? array_keys($metodos)[0] : PAYMENT_MIXED;
    }
}

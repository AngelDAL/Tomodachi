<?php
/**
 * CounterService — pedidos de mostrador (clientes de paso, sin mesa).
 *
 * La cajera anota lo que pide una persona (a nombre de quién), la cocina lo ve en una pantalla
 * de solo lectura y el cliente sigue su pedido por un enlace/QR. No hay mesa ni cuenta.
 *
 * DOS REGLAS DE ESTE MÓDULO (pedidas por el dueño):
 *  1. La cajera NO marca "completado" a ciegas: primero AVISA (estado `ready`) al cliente —push
 *     si tiene el enlace abierto con avisos, y siempre por el WebSocket— y hasta entonces puede
 *     entregar. Si no avisa, el cliente nunca se entera de que su pedido está listo.
 *  2. Los precios salen del MOTOR DE PROMOCIONES (`Pricing`), no de sumar a mano: el mostrador y
 *     el punto de venta cobran con la misma regla.
 */

require_once __DIR__ . '/DiningSession.class.php';
require_once __DIR__ . '/WsToken.class.php';
require_once __DIR__ . '/UrlHelper.class.php';
require_once __DIR__ . '/Pricing.class.php';
require_once __DIR__ . '/BomHelper.class.php';   // Pricing lo usa al construir (recetas/BOM)
require_once __DIR__ . '/WebPush.class.php';

class CounterService {

    /** Segundos sin señal del enlace tras los cuales el cliente ya no se considera "viendo". */
    const PRESENCIA_SEGUNDOS = 45;

    /** @var PDO */
    private $conn;

    /** @var Database */
    private $db;

    public function __construct($db) {
        $this->db   = $db;
        $this->conn = $db->getConnection();
    }

    public function fechaDeNegocio() {
        return date('Y-m-d');
    }

    /** UUID v4 (formato canónico): llave del enlace y canal WS del cliente. */
    public static function uuidv4() {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }

    // =========================================================
    // Alta
    // =========================================================

    /**
     * Crea un pedido de mostrador con sus artículos.
     *
     * @param array $items [{product_id, quantity, notes?}]
     * @return array el pedido armado (obtener())
     */
    public function crear($store_id, $customer_name, array $items, $notes = null, $created_by = null) {
        $items = array_values(array_filter($items, function ($i) {
            return is_array($i) && isset($i['product_id']) && (float)($i['quantity'] ?? 0) > 0;
        }));
        if (!$items) {
            throw new Exception('Agrega al menos un producto al pedido', 422);
        }

        $store_id = (int)$store_id;
        $nombre = $customer_name !== null ? trim(mb_substr((string)$customer_name, 0, 80)) : null;
        $nota   = $notes !== null ? trim(mb_substr((string)$notes, 0, 255)) : null;

        // El motor de precios aplica las promociones (paquetes, mayoreo, descuento de cuenta).
        // allowNegativeStock = true: un pedido de mostrador es informativo y no debe frenarse
        // porque las existencias estén justas; el stock se descuenta al cobrar, no aquí.
        $pricing = new Pricing($this->db);
        $calc = $pricing->calculate($store_id, $items, true);
        $lines = $calc['lines'] ?? [];
        if (!$lines) {
            throw new Exception('Ninguno de los productos está disponible', 422);
        }

        // Notas por línea: el motor de precios agrupa por producto, así que las notas del
        // formulario se recolocan por producto (una nota por producto en el mostrador).
        $notasPorProducto = [];
        foreach ($items as $it) {
            $pid = (int)$it['product_id'];
            $n = isset($it['notes']) ? trim(mb_substr((string)$it['notes'], 0, 255)) : '';
            if ($n !== '') $notasPorProducto[$pid] = $n;
        }

        $antes = 0.0;
        foreach ($lines as $l) {
            $antes += ((float)($l['original_price'] ?? $l['unit_price']) * (float)$l['quantity']);
        }
        $antes = round($antes, 2);
        $total = round((float)$calc['total'], 2);
        $descuento = round($antes - $total, 2);
        if ($descuento < 0) $descuento = 0.0;

        $token = self::uuidv4();
        $fecha = $this->fechaDeNegocio();
        $order_id = $this->insertarPedido($store_id, $fecha, $nombre, $token, $nota, $created_by, $antes, $descuento, $total);

        foreach ($lines as $l) {
            $pid = (int)$l['product_id'];
            $qty = (float)$l['quantity'];
            $unit = (float)$l['unit_price'];
            $lineDesc = round(((float)($l['original_price'] ?? $unit) - $unit) * $qty, 2);
            $stmt = $this->conn->prepare(
                "INSERT INTO counter_order_items
                    (counter_order_id, product_id, product_name, quantity, unit_price, discount,
                     promotion_name, notes, line_total)
                 VALUES (:oid, :pid, :name, :cant, :precio, :desc, :promo, :notas, :total)"
            );
            $stmt->execute([
                ':oid'    => $order_id,
                ':pid'    => $pid,
                ':name'   => $l['product_name'],
                ':cant'   => $qty,
                ':precio' => $unit,
                ':desc'   => $lineDesc,
                ':promo'  => $l['promotion_name'] ?? null,
                ':notas'  => $notasPorProducto[$pid] ?? null,
                ':total'  => round((float)$l['total'], 2),
            ]);
        }

        $this->avisar($store_id, $token, 'counter_created', $order_id);
        return $this->obtener($order_id, $store_id);
    }

    private function insertarPedido($store_id, $fecha, $nombre, $token, $nota, $created_by, $subtotal, $descuento, $total) {
        $sql = "INSERT INTO counter_orders
                    (store_id, business_date, number, customer_name, tracking_token, notes,
                     subtotal, discount, created_by)
                SELECT :store_id, :fecha, COALESCE(MAX(number), 0) + 1, :nombre, :token, :nota,
                       :subtotal, :descuento, :by
                  FROM counter_orders
                 WHERE store_id = :store_id_filtro AND business_date = :fecha_filtro";
        for ($intento = 1; $intento <= 4; $intento++) {
            try {
                $stmt = $this->conn->prepare($sql);
                $stmt->execute([
                    ':store_id'        => $store_id,
                    ':fecha'           => $fecha,
                    ':nombre'          => $nombre,
                    ':token'           => $token,
                    ':nota'            => $nota,
                    ':subtotal'        => $subtotal,
                    ':descuento'       => $descuento,
                    ':by'              => $created_by !== null ? (int)$created_by : null,
                    ':store_id_filtro' => $store_id,
                    ':fecha_filtro'    => $fecha,
                ]);
                return (int)$this->conn->lastInsertId();
            } catch (PDOException $e) {
                if ((string)$e->getCode() !== '23000' || $intento === 4) {
                    throw $e;
                }
            }
        }
        throw new Exception('No se pudo asignar el folio del pedido');
    }

    // =========================================================
    // Vista previa (promociones en vivo, antes de guardar)
    // =========================================================

    /**
     * Calcula el pedido SIN guardarlo, para que la cajera vea el efecto de las promociones
     * mientras arma la orden. Usa el mismo motor que el cobro (`Pricing`).
     */
    public function preview($store_id, array $items) {
        $items = array_values(array_filter($items, function ($i) {
            return is_array($i) && isset($i['product_id']) && (float)($i['quantity'] ?? 0) > 0;
        }));
        if (!$items) {
            return ['lines' => [], 'subtotal' => 0.0, 'discount' => 0.0, 'total' => 0.0];
        }
        $pricing = new Pricing($this->db);
        $calc = $pricing->calculate((int)$store_id, $items, true);
        $antes = 0.0;
        $lineas = [];
        foreach (($calc['lines'] ?? []) as $l) {
            $antes += ((float)($l['original_price'] ?? $l['unit_price']) * (float)$l['quantity']);
            $lineas[] = [
                'product_id'     => (int)$l['product_id'],
                'product_name'   => $l['product_name'],
                'quantity'       => (float)$l['quantity'],
                'unit_price'     => (float)$l['unit_price'],
                'original_price' => (float)($l['original_price'] ?? $l['unit_price']),
                'discount'       => round(((float)($l['original_price'] ?? $l['unit_price']) - (float)$l['unit_price']) * (float)$l['quantity'], 2),
                'promotion_name' => $l['promotion_name'] ?? null,
                'line_total'     => round((float)$l['total'], 2),
            ];
        }
        $antes = round($antes, 2);
        $total = round((float)$calc['total'], 2);
        return [
            'subtotal' => $antes,
            'discount' => max(0.0, round($antes - $total, 2)),
            'total'    => $total,
            'lines'    => $lineas,
            'promotion_name' => $calc['promotion_name'] ?? null,
        ];
    }

    // =========================================================
    // Lectura
    // =========================================================

    public function listar($store_id, $soloActivos = true) {
        $store_id = (int)$store_id;
        $fecha = $this->fechaDeNegocio();
        // "Activos" = lo que aún no se entrega ni se cancela (pendiente o listo).
        $filtro = $soloActivos ? "AND o.status IN ('pending','ready')" : '';
        $stmt = $this->conn->prepare(
            "SELECT o.*, TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) AS minutos
               FROM counter_orders o
              WHERE o.store_id = :sid AND o.business_date = :fecha $filtro
              ORDER BY (o.status IN ('pending','ready')) DESC, o.created_at ASC"
        );
        $stmt->execute([':sid' => $store_id, ':fecha' => $fecha]);
        $filas = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $pedidos = [];
        foreach ($filas as $f) {
            $pedidos[] = $this->armar($f);
        }
        return ['fecha' => $fecha, 'pedidos' => $pedidos];
    }

    public function obtener($counter_order_id, $store_id) {
        $stmt = $this->conn->prepare(
            "SELECT o.*, TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) AS minutos
               FROM counter_orders o
              WHERE o.counter_order_id = :id AND o.store_id = :sid"
        );
        $stmt->execute([':id' => (int)$counter_order_id, ':sid' => (int)$store_id]);
        $f = $stmt->fetch(PDO::FETCH_ASSOC);
        return $f ? $this->armar($f) : null;
    }

    /** Seguimiento público por token: no expone tienda ni el token. */
    public function track($token) {
        $token = trim((string)$token);
        if ($token === '') return null;
        $stmt = $this->conn->prepare(
            "SELECT o.*, TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) AS minutos
               FROM counter_orders o WHERE o.tracking_token = :token"
        );
        $stmt->execute([':token' => $token]);
        $f = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$f) {
            return null;
        }
        $pedido = $this->armar($f, true);
        // Los colores del negocio para que la página del cliente use SU identidad (dinámico).
        $pedido['tema'] = $this->temaDeTienda((int)$f['store_id']);
        return $pedido;
    }

    /**
     * Los colores del negocio (stores.theme_config / theme_config_dark) para la vista del
     * cliente. Se devuelve SOLO lo que pinta (colores), nunca datos internos de la tienda.
     */
    public function temaDeTienda($store_id) {
        $stmt = $this->conn->prepare("SELECT theme_config, theme_config_dark FROM stores WHERE store_id = :sid");
        $stmt->execute([':sid' => (int)$store_id]);
        $f = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $claro = json_decode((string)($f['theme_config'] ?? ''), true);
        $oscuro = json_decode((string)($f['theme_config_dark'] ?? ''), true);
        $llaves = ['primary_color', 'secondary_color', 'success_color', 'danger_color',
                   'warning_color', 'info_color', 'dark_color', 'bg_body', 'text_color',
                   'bg_card', 'border_color'];
        $filtrar = function ($cfg) use ($llaves) {
            if (!is_array($cfg)) return null;
            $out = [];
            foreach ($llaves as $k) {
                if (!empty($cfg[$k]) && is_string($cfg[$k])) $out[$k] = $cfg[$k];
            }
            if (!empty($cfg['theme_mode'])) $out['theme_mode'] = $cfg['theme_mode'];
            return $out ?: null;
        };
        return ['light' => $filtrar($claro), 'dark' => $filtrar($oscuro)];
    }

    /** Busca por token incluyendo el token (uso interno: presencia, avisos). */
    public function porToken($token) {
        $stmt = $this->conn->prepare("SELECT * FROM counter_orders WHERE tracking_token = :token");
        $stmt->execute([':token' => trim((string)$token)]);
        $f = $stmt->fetch(PDO::FETCH_ASSOC);
        return $f ?: null;
    }

    // =========================================================
    // Estado, aviso y pago
    // =========================================================

    /**
     * Cambia el estado. Reglas:
     *  - `ready`     = avisar que está listo (marca notified_at) y manda el aviso al cliente.
     *  - `completed` = entregar. SOLO se permite si ya se avisó (`ready`): si no, el cliente
     *                  nunca se enteraría de que su pedido salió.
     *  - `cancelled` = cancelar con motivo.
     */
    public function cambiarEstado($counter_order_id, $store_id, $status, $reason = null, $user_id = null) {
        $status = (string)$status;
        if (!in_array($status, ['ready', 'completed', 'cancelled'], true)) {
            throw new Exception('Estado no permitido', 422);
        }
        $pedido = $this->obtener((int)$counter_order_id, (int)$store_id);
        if (!$pedido) {
            throw new Exception('Ese pedido no existe en esta tienda', 404);
        }
        if ($pedido['status'] === 'cancelled') {
            throw new Exception('Un pedido cancelado no cambia de estado', 409);
        }
        if ($status === 'ready') {
            return $this->notificar((int)$counter_order_id, (int)$store_id);
        }
        if ($status === 'completed') {
            if ($pedido['status'] === 'completed') {
                return $pedido;   // idempotente: ya estaba entregado
            }
            if ($pedido['status'] !== 'ready') {
                throw new Exception('Primero avisa al cliente de que su pedido está listo', 409);
            }
            $stmt = $this->conn->prepare(
                "UPDATE counter_orders SET status = 'completed', completed_at = NOW()
                  WHERE counter_order_id = :id AND store_id = :sid"
            );
            $stmt->execute([':id' => (int)$counter_order_id, ':sid' => (int)$store_id]);
            $this->avisar((int)$store_id, $pedido['tracking_token'], 'counter_completed', (int)$counter_order_id);
            return $this->obtener((int)$counter_order_id, (int)$store_id);
        }

        // cancelled
        $motivo = $reason !== null ? trim(mb_substr((string)$reason, 0, 255)) : null;
        $stmt = $this->conn->prepare(
            "UPDATE counter_orders SET status = 'cancelled', cancel_reason = :motivo, cancelled_at = NOW()
              WHERE counter_order_id = :id AND store_id = :sid"
        );
        $stmt->execute([':motivo' => $motivo, ':id' => (int)$counter_order_id, ':sid' => (int)$store_id]);
        $this->avisar((int)$store_id, $pedido['tracking_token'], 'counter_cancelled', (int)$counter_order_id);
        return $this->obtener((int)$counter_order_id, (int)$store_id);
    }

    /**
     * Avisa al cliente de que su pedido está listo: lo deja en `ready`, manda PUSH a sus
     * dispositivos suscritos (si los hay) y avisa por WebSocket (la página abierta se actualiza
     * sola). Es idempotente por diseño: repetir el aviso no rompe nada.
     */
    public function notificar($counter_order_id, $store_id) {
        $pedido = $this->obtener((int)$counter_order_id, (int)$store_id);
        if (!$pedido) {
            throw new Exception('Ese pedido no existe en esta tienda', 404);
        }
        if ($pedido['status'] === 'cancelled') {
            throw new Exception('Un pedido cancelado no se avisa', 409);
        }
        if ($pedido['status'] === 'pending') {
            $stmt = $this->conn->prepare(
                "UPDATE counter_orders SET status = 'ready', notified_at = NOW()
                  WHERE counter_order_id = :id AND store_id = :sid"
            );
            $stmt->execute([':id' => (int)$counter_order_id, ':sid' => (int)$store_id]);
        } else {
            $stmt = $this->conn->prepare(
                "UPDATE counter_orders SET notified_at = NOW()
                  WHERE counter_order_id = :id AND store_id = :sid"
            );
            $stmt->execute([':id' => (int)$counter_order_id, ':sid' => (int)$store_id]);
        }

        // Push a los dispositivos suscritos (best-effort: si falla, el WebSocket ya avisó).
        $titulo = '¡Tu pedido está listo!' . ($pedido['number'] ? ' (#' . $pedido['number'] . ')' : '');
        $cuerpo = $pedido['customer_name']
            ? $pedido['customer_name'] . ', ya puedes pasar a recogerlo.'
            : 'Ya puedes pasar a recoger tu pedido.';
        $enviados = $this->enviarPush((int)$counter_order_id, $titulo, $cuerpo, $pedido['tracking_url']);

        $this->avisar((int)$store_id, $pedido['tracking_token'], 'counter_ready', (int)$counter_order_id);

        $resultado = $this->obtener((int)$counter_order_id, (int)$store_id);
        $resultado['push_enviados'] = $enviados;
        return $resultado;
    }

    /** Marca el estado de pago: por cobrar / con adelanto / pagado completo. */
    public function marcarPago($counter_order_id, $store_id, $payment_status, $paid_amount = null) {
        $payment_status = (string)$payment_status;
        if (!in_array($payment_status, ['unpaid', 'partial', 'paid'], true)) {
            throw new Exception('Estado de pago no permitido', 422);
        }
        $pedido = $this->obtener((int)$counter_order_id, (int)$store_id);
        if (!$pedido) {
            throw new Exception('Ese pedido no existe en esta tienda', 404);
        }
        if ($pedido['status'] === 'cancelled') {
            throw new Exception('Un pedido cancelado no cambia de pago', 409);
        }

        $total = (float)$pedido['total'];
        if ($payment_status === 'paid') {
            $monto = $total;
        } elseif ($payment_status === 'unpaid') {
            $monto = 0.0;
        } else { // partial
            $monto = $paid_amount !== null ? round((float)$paid_amount, 2) : (float)$pedido['paid_amount'];
            if ($monto <= 0) {
                throw new Exception('Escribe cuánto dio de adelanto', 422);
            }
            if ($monto >= $total) {
                // Un adelanto igual o mayor al total ES pagado.
                $payment_status = 'paid';
                $monto = $total;
            }
        }

        $stmt = $this->conn->prepare(
            "UPDATE counter_orders SET payment_status = :est, paid_amount = :monto
              WHERE counter_order_id = :id AND store_id = :sid"
        );
        $stmt->execute([':est' => $payment_status, ':monto' => $monto, ':id' => (int)$counter_order_id, ':sid' => (int)$store_id]);
        $this->avisar((int)$store_id, $pedido['tracking_token'], 'counter_payment', (int)$counter_order_id);
        return $this->obtener((int)$counter_order_id, (int)$store_id);
    }

    // =========================================================
    // Presencia del cliente y suscripción push (público por token)
    // =========================================================

    /**
     * Señal de vida del enlace del cliente: "estoy viendo mi pedido". La cajera ve con esto si
     * el cliente está al pendiente. `$notifyGranted` (true/false/null) informa si activó avisos.
     * @return array ['ok'=>true,'status'=>...] o null si el token no existe
     */
    public function presencia($token, $notifyGranted = null) {
        $pedido = $this->porToken($token);
        if (!$pedido) {
            return null;
        }
        if ($notifyGranted === true) {
            $stmt = $this->conn->prepare(
                "UPDATE counter_orders SET customer_seen_at = NOW(), notify_granted = 1
                  WHERE counter_order_id = :id"
            );
        } elseif ($notifyGranted === false) {
            $stmt = $this->conn->prepare(
                "UPDATE counter_orders SET customer_seen_at = NOW(), notify_granted = 0
                  WHERE counter_order_id = :id"
            );
        } else {
            $stmt = $this->conn->prepare(
                "UPDATE counter_orders SET customer_seen_at = NOW() WHERE counter_order_id = :id"
            );
        }
        $stmt->execute([':id' => (int)$pedido['counter_order_id']]);
        return ['ok' => true, 'status' => $pedido['status'], 'notify_granted' => (int)$pedido['notify_granted'] === 1];
    }

    /** Guarda la suscripción push de un dispositivo del cliente. */
    public function suscribir($token, $endpoint, $p256dh, $auth) {
        $pedido = $this->porToken($token);
        if (!$pedido) {
            throw new Exception('Ese pedido no existe', 404);
        }
        $endpoint = trim((string)$endpoint);
        $p256dh = trim((string)$p256dh);
        $auth = trim((string)$auth);
        if ($endpoint === '' || $p256dh === '' || $auth === '') {
            throw new Exception('Datos de suscripción incompletos', 422);
        }
        // El navegador manda un punto EC sin comprimir (65 bytes, empieza en 0x04)
        // y un secreto de 16 bytes. Si no cuadran, el aviso nunca se podría cifrar:
        // mejor rechazarlo aquí que fallar en silencio a la hora de avisar.
        if (strlen($endpoint) > 500 || !preg_match('#^https?://\S+$#', $endpoint)) {
            throw new Exception('La dirección de avisos no es válida', 422);
        }
        $punto = WebPush::b64urlDecode($p256dh);
        $secreto = WebPush::b64urlDecode($auth);
        if ($punto === null || strlen($punto) !== 65 || $punto[0] !== "\x04") {
            throw new Exception('La clave pública del dispositivo no es válida', 422);
        }
        if ($secreto === null || strlen($secreto) !== 16) {
            throw new Exception('El secreto del dispositivo no es válido', 422);
        }
        $oid = (int)$pedido['counter_order_id'];
        $existente = $this->conn->prepare("SELECT sub_id FROM counter_push_subscriptions WHERE endpoint = :e LIMIT 1");
        $existente->execute([':e' => $endpoint]);
        $sub_id = (int)$existente->fetchColumn();
        if ($sub_id > 0) {
            $this->conn->prepare(
                "UPDATE counter_push_subscriptions SET counter_order_id = :oid, p256dh = :p, auth = :a
                  WHERE sub_id = :id"
            )->execute([':oid' => $oid, ':p' => $p256dh, ':a' => $auth, ':id' => $sub_id]);
        } else {
            $this->conn->prepare(
                "INSERT INTO counter_push_subscriptions (counter_order_id, endpoint, p256dh, auth)
                 VALUES (:oid, :e, :p, :a)"
            )->execute([':oid' => $oid, ':e' => $endpoint, ':p' => $p256dh, ':a' => $auth]);
        }
        $this->conn->prepare("UPDATE counter_orders SET customer_seen_at = NOW(), notify_granted = 1 WHERE counter_order_id = :id")
            ->execute([':id' => $oid]);
        return ['ok' => true, 'dispositivos' => $this->contarSuscripciones($oid)];
    }

    public function contarSuscripciones($counter_order_id) {
        $stmt = $this->conn->prepare("SELECT COUNT(*) FROM counter_push_subscriptions WHERE counter_order_id = :id");
        $stmt->execute([':id' => (int)$counter_order_id]);
        return (int)$stmt->fetchColumn();
    }

    /** Manda el push a todos los dispositivos suscritos de un pedido. @return int enviados */
    private function enviarPush($counter_order_id, $titulo, $cuerpo, $url) {
        if (!WebPush::habilitado()) {
            return 0;
        }
        $stmt = $this->conn->prepare(
            "SELECT sub_id, endpoint, p256dh, auth FROM counter_push_subscriptions WHERE counter_order_id = :id"
        );
        $stmt->execute([':id' => (int)$counter_order_id]);
        $subs = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $enviados = 0;
        foreach ($subs as $s) {
            $r = WebPush::enviar($s, $titulo, $cuerpo, $url ?: '/');
            if (!empty($r['ok'])) {
                $enviados++;
            } elseif (in_array((int)$r['status'], [404, 410], true)) {
                // Suscripción muerta: se retira para no reintentar en cada aviso.
                $this->conn->prepare("DELETE FROM counter_push_subscriptions WHERE sub_id = :id")
                    ->execute([':id' => (int)$s['sub_id']]);
            }
        }
        return $enviados;
    }

    // =========================================================
    // Armado de la respuesta
    // =========================================================

    private function armar(array $f, $publico = false) {
        $id = (int)$f['counter_order_id'];
        $stmt = $this->conn->prepare(
            "SELECT item_id, product_id, product_name, quantity, unit_price, discount,
                    promotion_name, notes, line_total
               FROM counter_order_items
              WHERE counter_order_id = :id
              ORDER BY item_id ASC"
        );
        $stmt->execute([':id' => $id]);
        $items = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($items as &$it) {
            $it['quantity']   = (float)$it['quantity'];
            $it['unit_price'] = (float)$it['unit_price'];
            $it['discount']   = (float)$it['discount'];
            $it['line_total'] = (float)$it['line_total'];
        }
        unset($it);

        $visto = $f['customer_seen_at'] ?? null;
        $presente = false;
        if ($visto) {
            $stmt2 = $this->conn->prepare("SELECT TIMESTAMPDIFF(SECOND, :v, NOW())");
            $stmt2->execute([':v' => $visto]);
            $seg = (int)$stmt2->fetchColumn();
            $presente = $seg <= self::PRESENCIA_SEGUNDOS;
        }

        $pedido = [
            'counter_order_id' => (int)$f['counter_order_id'],
            'number'           => (int)$f['number'],
            'customer_name'    => $f['customer_name'],
            'status'           => $f['status'],
            'notes'            => $f['notes'],
            'subtotal'         => (float)$f['subtotal'],
            'discount'         => (float)$f['discount'],
            'total'            => round((float)$f['subtotal'] - (float)$f['discount'], 2),
            'payment_status'   => $f['payment_status'],
            'paid_amount'      => (float)$f['paid_amount'],
            'cancel_reason'    => $f['cancel_reason'],
            'minutos'          => (int)$f['minutos'],
            'created_at'       => $f['created_at'],
            'notified_at'      => $f['notified_at'] ?? null,
            'completed_at'     => $f['completed_at'],
            'cancelled_at'     => $f['cancelled_at'],
            'items'            => $items,
        ];

        if (!$publico) {
            $pedido['tracking_token']   = $f['tracking_token'];
            $pedido['tracking_url']     = UrlHelper::seguimiento($f['tracking_token']);
            $pedido['cliente_presente'] = $presente;
            $pedido['notify_granted']   = (int)($f['notify_granted'] ?? 0) === 1;
            $pedido['push_dispositivos'] = $this->contarSuscripciones($id);
        }
        return $pedido;
    }

    /** Aviso por WebSocket (best-effort): canal de la tienda + canal del token del cliente. */
    private function avisar($store_id, $token, $evento, $counter_order_id) {
        $payload = json_encode([
            'type'     => 'order_update',
            'counter'  => (int)$counter_order_id,
            'event'    => $evento,
            'store_id' => (int)$store_id,
        ], JSON_UNESCAPED_UNICODE);
        if ($payload === false) return;
        DiningSession::enviarAlRelay(WsToken::canalTienda($store_id), $payload);
        if ($token) {
            DiningSession::enviarAlRelay($token, $payload);
        }
    }
}

<?php
/**
 * CounterService — pedidos de mostrador (clientes de paso, sin mesa).
 *
 * El puesto ambulante / mostrador: la cajera anota lo que pide una persona (a nombre de
 * quién), la cocina lo ve en una pantalla de solo lectura y el cliente sigue su pedido por
 * un enlace/QR. No hay mesa ni cuenta: un pedido de mostrador es UNA orden con folio del
 * día, nombre y estado (pending -> completed, o cancelled).
 *
 * El estado lo cambia la CAJERA (no la cocina): los cocineros no tocan pantalla para no
 * contaminar. El tablero de cocina de mostrador es de solo lectura.
 *
 * No toca dinero ni inventario: es flujo e información. El cobro, si procede, entra por el
 * camino de venta existente.
 */

require_once __DIR__ . '/DiningSession.class.php';
require_once __DIR__ . '/WsToken.class.php';
require_once __DIR__ . '/UrlHelper.class.php';

class CounterService {

    /** @var PDO */
    private $conn;

    /** @var Database */
    private $db;

    public function __construct($db) {
        $this->db   = $db;
        $this->conn = $db->getConnection();
    }

    /** El día de negocio en hora local (config fija America/Mexico_City), igual que las comandas. */
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

    /**
     * Crea un pedido de mostrador con sus artículos.
     *
     * @param int    $store_id
     * @param string $customer_name  a nombre de quién va
     * @param array  $items          [{product_id, quantity, notes?}]
     * @param string $notes          nota libre del pedido
     * @param int    $created_by
     * @return array                 el pedido armado (obtener())
     */
    public function crear($store_id, $customer_name, array $items, $notes = null, $created_by = null) {
        $items = array_values(array_filter($items, function ($i) {
            return is_array($i) && isset($i['product_id']);
        }));
        if (!$items) {
            throw new Exception('Agrega al menos un producto al pedido', 422);
        }

        $store_id = (int)$store_id;
        $nombre   = $customer_name !== null ? trim(mb_substr((string)$customer_name, 0, 80)) : null;
        $nota     = $notes !== null ? trim(mb_substr((string)$notes, 0, 255)) : null;

        // Resolver cada producto: nombre y precio al momento, y que sea de esta tienda.
        $lineas = [];
        foreach ($items as $it) {
            $pid = (int)$it['product_id'];
            $cant = (float)($it['quantity'] ?? 1);
            if ($cant <= 0) $cant = 1;
            $notaItem = isset($it['notes']) ? trim(mb_substr((string)$it['notes'], 0, 255)) : null;

            $stmt = $this->conn->prepare(
                "SELECT product_id, product_name, price, status, is_ingredient, hidden_in_pos
                   FROM products
                  WHERE product_id = :pid AND store_id = :sid"
            );
            $stmt->execute([':pid' => $pid, ':sid' => $store_id]);
            $p = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$p || $p['status'] !== 'active' || (int)$p['is_ingredient'] === 1) {
                throw new Exception('Uno de los productos no está disponible', 422);
            }
            $precio = (float)$p['price'];
            $lineas[] = [
                'product_id'   => $pid,
                'product_name' => $p['product_name'],
                'quantity'     => $cant,
                'unit_price'   => $precio,
                'notes'        => $notaItem ?: null,
                'line_total'   => round($precio * $cant, 2),
            ];
        }

        $token = self::uuidv4();
        $fecha = $this->fechaDeNegocio();
        $order_id = $this->insertarPedido($store_id, $fecha, $nombre, $token, $nota, $created_by);

        foreach ($lineas as $l) {
            $stmt = $this->conn->prepare(
                "INSERT INTO counter_order_items
                    (counter_order_id, product_id, product_name, quantity, unit_price, notes, line_total)
                 VALUES (:oid, :pid, :name, :cant, :precio, :notas, :total)"
            );
            $stmt->execute([
                ':oid'    => $order_id,
                ':pid'    => $l['product_id'],
                ':name'   => $l['product_name'],
                ':cant'   => $l['quantity'],
                ':precio' => $l['unit_price'],
                ':notas'  => $l['notes'],
                ':total'  => $l['line_total'],
            ]);
        }

        $this->avisar($store_id, $token, 'counter_created', $order_id);

        return $this->obtener($order_id, $store_id);
    }

    /** Inserta el pedido con el folio del día (atómico, con reintento ante choque de folio). */
    private function insertarPedido($store_id, $fecha, $nombre, $token, $nota, $created_by) {
        $sql = "INSERT INTO counter_orders
                    (store_id, business_date, number, customer_name, tracking_token, notes, created_by)
                SELECT :store_id, :fecha, COALESCE(MAX(number), 0) + 1, :nombre, :token, :nota, :by
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

    /**
     * Los pedidos del día, activos primero (pending) y luego los ya cerrados (completed /
     * cancelled) para no perder de vista el histórico de la jornada.
     */
    public function listar($store_id, $soloActivos = true) {
        $store_id = (int)$store_id;
        $fecha = $this->fechaDeNegocio();
        $filtro = $soloActivos ? "AND o.status = 'pending'" : '';
        $stmt = $this->conn->prepare(
            "SELECT o.*, TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) AS minutos
               FROM counter_orders o
              WHERE o.store_id = :sid AND o.business_date = :fecha $filtro
              ORDER BY (o.status = 'pending') DESC, o.created_at ASC"
        );
        $stmt->execute([':sid' => $store_id, ':fecha' => $fecha]);
        $filas = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $pedidos = [];
        foreach ($filas as $f) {
            $pedidos[] = $this->armar($f);
        }
        return [
            'fecha'   => $fecha,
            'pedidos' => $pedidos,
        ];
    }

    /** Un pedido por id, con sus artículos. null si no existe en la tienda. */
    public function obtener($counter_order_id, $store_id) {
        $stmt = $this->conn->prepare(
            "SELECT o.*, TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) AS minutos
               FROM counter_orders o
              WHERE o.counter_order_id = :id AND o.store_id = :sid"
        );
        $stmt->execute([':id' => (int)$counter_order_id, ':sid' => (int)$store_id]);
        $f = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$f) {
            return null;
        }
        return $this->armar($f);
    }

    /** Seguimiento público por token: no expone tienda ni nada interno. */
    public function track($token) {
        $token = trim((string)$token);
        if ($token === '') {
            return null;
        }
        $stmt = $this->conn->prepare(
            "SELECT o.*, TIMESTAMPDIFF(MINUTE, o.created_at, NOW()) AS minutos
               FROM counter_orders o
              WHERE o.tracking_token = :token"
        );
        $stmt->execute([':token' => $token]);
        $f = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$f) {
            return null;
        }
        return $this->armar($f, true);
    }

    /** Cambia el estado (completed | cancelled). Lo hace la cajera; la cocina es solo lectura. */
    public function cambiarEstado($counter_order_id, $store_id, $status, $reason = null, $user_id = null) {
        $status = (string)$status;
        if (!in_array($status, ['completed', 'cancelled'], true)) {
            throw new Exception('Estado no permitido', 422);
        }
        $order = $this->obtener((int)$counter_order_id, (int)$store_id);
        if (!$order) {
            throw new Exception('Ese pedido no existe en esta tienda', 404);
        }
        if ($order['status'] === $status) {
            return $order;
        }
        if ($order['status'] === 'cancelled') {
            throw new Exception('Un pedido cancelado no cambia de estado', 409);
        }

        $motivo = $reason !== null ? trim(mb_substr((string)$reason, 0, 255)) : null;
        if ($status === 'cancelled') {
            $stmt = $this->conn->prepare(
                "UPDATE counter_orders SET status = 'cancelled', cancel_reason = :motivo, cancelled_at = NOW()
                  WHERE counter_order_id = :id AND store_id = :sid"
            );
            $stmt->execute([':motivo' => $motivo, ':id' => (int)$counter_order_id, ':sid' => (int)$store_id]);
        } else {
            $stmt = $this->conn->prepare(
                "UPDATE counter_orders SET status = 'completed', completed_at = NOW()
                  WHERE counter_order_id = :id AND store_id = :sid"
            );
            $stmt->execute([':id' => (int)$counter_order_id, ':sid' => (int)$store_id]);
        }

        $this->avisar((int)$store_id, $order['tracking_token'], $status === 'completed' ? 'counter_completed' : 'counter_cancelled', (int)$counter_order_id);

        return $this->obtener((int)$counter_order_id, (int)$store_id);
    }

    /** Arma el pedido con artículos, total y URL de seguimiento. */
    private function armar(array $f, $publico = false) {
        $id = (int)$f['counter_order_id'];
        $stmt = $this->conn->prepare(
            "SELECT item_id, product_id, product_name, quantity, unit_price, notes, line_total
               FROM counter_order_items
              WHERE counter_order_id = :id
              ORDER BY item_id ASC"
        );
        $stmt->execute([':id' => $id]);
        $items = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($items as &$it) {
            $it['quantity']   = (float)$it['quantity'];
            $it['unit_price'] = (float)$it['unit_price'];
            $it['line_total'] = (float)$it['line_total'];
        }
        unset($it);

        $total = array_reduce($items, function ($a, $it) { return $a + $it['line_total']; }, 0.0);

        $pedido = [
            'counter_order_id' => (int)$f['counter_order_id'],
            'number'           => (int)$f['number'],
            'customer_name'    => $f['customer_name'],
            'status'           => $f['status'],
            'notes'            => $f['notes'],
            'cancel_reason'    => $f['cancel_reason'],
            'minutos'          => (int)$f['minutos'],
            'created_at'       => $f['created_at'],
            'completed_at'     => $f['completed_at'],
            'cancelled_at'     => $f['cancelled_at'],
            'items'            => $items,
            'total'            => round($total, 2),
        ];
        if (!$publico) {
            $pedido['tracking_token'] = $f['tracking_token'];
            $pedido['tracking_url']   = UrlHelper::seguimiento($f['tracking_token']);
        }
        return $pedido;
    }

    /**
     * Avisa por WebSocket (best-effort, nunca rompe la operación):
     *  - canal de la tienda (`store:<id>`)  -> la pantalla de mostrador del personal.
     *  - canal del token (UUID)             -> el seguimiento del cliente.
     */
    private function avisar($store_id, $token, $evento, $counter_order_id) {
        $payload = json_encode([
            'type'     => 'order_update',
            'counter'  => (int)$counter_order_id,
            'event'    => $evento,
            'store_id' => (int)$store_id,
        ], JSON_UNESCAPED_UNICODE);
        if ($payload === false) {
            return;
        }
        DiningSession::enviarAlRelay(WsToken::canalTienda($store_id), $payload);
        if ($token) {
            DiningSession::enviarAlRelay($token, $payload);
        }
    }
}

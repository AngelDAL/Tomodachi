<?php
/**
 * DiningSession - Lógica compartida del flujo de pedido por mesa.
 *
 * Una cuenta por mesa NO es una venta: vive en las tablas `dining_*` y solo al
 * cerrarse se genera la venta real por el camino que ya existe. Esta clase
 * concentra las operaciones de la cuenta para que los endpoints (`api/dining/*`)
 * no repitan SQL ni reglas de negocio.
 *
 * Reglas firmes:
 *   - El precio de cada ítem se lee SIEMPRE de `products.price` en la BD.
 *     Nunca se confía en el precio que mande el cliente.
 *   - Solo se ofrecen productos vendibles: status='active', is_ingredient=0,
 *     hidden_in_pos=0, y de la MISMA tienda.
 *   - El `store_id` va siempre en el WHERE de cualquier UPDATE.
 *
 * El canal del WebSocket es el `session_id`: los clientes (comanda/comensal) se
 * suscriben al relay con `?session=<session_id>` y el evento viaja como
 * {"type":"order_update","session":"<session_id>","event":"..."}.
 * Ver broadcast() para la advertencia de integración con el relay.
 */
require_once __DIR__ . '/WsToken.class.php';

class DiningSession {

    /**
     * Alfabeto del código de mesa: sin caracteres ambiguos.
     * Se excluyen 0/O y 1/I/L para que el mesero pueda dictarlo sin errores.
     */
    const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const CODE_LENGTH = 4;
    const MAX_LINE_QUANTITY = 50;

    private $db;

    public function __construct($db) {
        $this->db = $db;
    }

    // =========================================================
    // Cuentas
    // =========================================================

    /**
     * Busca una cuenta ABIERTA por su código corto dentro de una tienda.
     * El código es único por tienda mientras la cuenta está viva, así que
     * alcanza con él; `$menu_id` es un filtro extra opcional.
     *
     * @return array|false fila de dining_sessions o false
     */
    public function getOrFindSession($store_id, $menu_id, $code) {
        $code = strtoupper(trim((string)$code));
        if ($code === '') {
            return false;
        }

        $sql = "SELECT * FROM dining_sessions
                WHERE store_id = :store_id
                  AND code = :code
                  AND status IN ('open','awaiting_payment')
                  AND (expires_at IS NULL OR expires_at > NOW())";
        $params = [':store_id' => (int)$store_id, ':code' => $code];

        if ($menu_id !== null && (int)$menu_id > 0) {
            $sql .= " AND menu_id = :menu_id";
            $params[':menu_id'] = (int)$menu_id;
        }
        $sql .= " ORDER BY opened_at DESC LIMIT 1";

        $stmt = $this->db->getConnection()->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: false;
    }

    /**
     * Abre una cuenta nueva.
     *
     * `opened_by` es NOT NULL con FK a users: si no llega un usuario (p. ej. un
     * comensal abriendo su propia cuenta en modo order_and_pay) se atribuye al
     * administrador de la tienda.
     *
     * @param int      $store_id
     * @param int      $menu_id
     * @param int|null $table_id
     * @param int|null $user_id  quién la abre (NULL => admin de la tienda)
     * @return array fila de la cuenta recién creada
     */
    public function openSession($store_id, $menu_id, $table_id = null, $user_id = null) {
        $store_id = (int)$store_id;
        $menu_id  = (int)$menu_id;

        $user_id = (int)$user_id;
        if ($user_id <= 0) {
            $user_id = $this->resolveStoreAdmin($store_id);
            if ($user_id <= 0) {
                throw new Exception('La tienda no tiene un usuario administrador para abrir la cuenta');
            }
        }

        // Caducidad: la define la carta (max_open_minutes). Se calcula en PHP
        // para no depender de INTERVAL con placeholder.
        $maxMinutes = 180;
        $stmt = $this->db->getConnection()->prepare(
            "SELECT max_open_minutes FROM menus WHERE menu_id = :menu_id AND store_id = :store_id LIMIT 1"
        );
        $stmt->execute([':menu_id' => $menu_id, ':store_id' => $store_id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row && (int)$row['max_open_minutes'] > 0) {
            $maxMinutes = (int)$row['max_open_minutes'];
        }
        // El vencimiento se calcula con el reloj de la BASE, no con el de PHP.
        // El contenedor de la app va en hora de México (CST) y la base en UTC:
        // una cuenta creada con time() + 3 h nacía vencida por el desfase de 6 h,
        // y el comensal no podía unirse nunca ("no encontramos una cuenta
        // abierta"). Usando NOW() + INTERVAL, todo queda con el mismo reloj.

        $code = $this->generateUniqueCode($store_id);

        $stmt = $this->db->getConnection()->prepare(
            "INSERT INTO dining_sessions
                (store_id, table_id, menu_id, opened_by, code, status, ordering_enabled, split_mode, opened_at, expires_at)
             VALUES
                (:store_id, :table_id, :menu_id, :opened_by, :code, 'open', 1, 'none', NOW(), DATE_ADD(NOW(), INTERVAL :minutos MINUTE))"
        );
        $stmt->execute([
            ':store_id'   => $store_id,
            ':table_id'   => $table_id !== null && (int)$table_id > 0 ? (int)$table_id : null,
            ':menu_id'    => $menu_id > 0 ? $menu_id : null,
            ':opened_by'  => $user_id,
            ':code'       => $code,
            ':minutos'    => $maxMinutes,
        ]);

        $session_id = (int)$this->db->getConnection()->lastInsertId();
        return $this->getSessionRow($session_id);
    }

    // =========================================================
    // Comensales
    // =========================================================

    /**
     * Suma un comensal a una cuenta abierta.
     *
     * @param int         $session_id
     * @param string|null $display_name  nombre elegido (opcional)
     * @param string|null $device_hash   hash del dispositivo (opcional)
     * @return array ['participant_id','join_token','display_name','session_id']
     */
    public function joinParticipant($session_id, $display_name = null, $device_hash = null) {
        $session_id = (int)$session_id;
        $session = $this->getSessionRow($session_id);
        if (!$session || !in_array($session['status'], ['open', 'awaiting_payment'], true)) {
            throw new Exception('La cuenta no está abierta');
        }

        $name = $this->clamp($display_name, 60);
        if ($name === '') {
            $stmt = $this->db->getConnection()->prepare(
                "SELECT COUNT(*) FROM dining_participants WHERE session_id = :sid AND is_active = 1"
            );
            $stmt->execute([':sid' => $session_id]);
            $name = 'Comensal ' . ((int)$stmt->fetchColumn() + 1);
        }

        $token = $this->generateJoinToken();
        $device_hash = $device_hash !== null ? $this->clamp($device_hash, 64) : null;
        if ($device_hash === '') {
            $device_hash = null;
        }

        $stmt = $this->db->getConnection()->prepare(
            "INSERT INTO dining_participants (session_id, display_name, join_token, device_hash, joined_at)
             VALUES (:session_id, :display_name, :join_token, :device_hash, NOW())"
        );
        $stmt->execute([
            ':session_id'   => $session_id,
            ':display_name' => $name,
            ':join_token'   => $token,
            ':device_hash'  => $device_hash,
        ]);

        return [
            'participant_id' => (int)$this->db->getConnection()->lastInsertId(),
            'join_token'     => $token,
            'display_name'   => $name,
            'session_id'     => $session_id,
        ];
    }

    /**
     * Resuelve la cuenta a la que pertenece un join_token.
     * Solo devuelve la cuenta si sigue abierta: un token de una cuenta cerrada
     * no sirve para nada.
     *
     * @return array|false fila de dining_sessions (+ participant_id del token) o false
     */
    public function findSessionByJoinToken($token) {
        $token = trim((string)$token);
        if ($token === '') {
            return false;
        }
        $stmt = $this->db->getConnection()->prepare(
            "SELECT s.*, p.participant_id AS token_participant_id, p.display_name AS token_display_name
             FROM dining_participants p
             JOIN dining_sessions s ON s.session_id = p.session_id
             WHERE p.join_token = :token
               AND p.is_active = 1
               AND s.status IN ('open','awaiting_payment')
               AND (s.expires_at IS NULL OR s.expires_at > NOW())
             LIMIT 1"
        );
        $stmt->execute([':token' => $token]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: false;
    }

    // =========================================================
    // Pedido
    // =========================================================

    /**
     * AGREGA ítems a la cuenta (no reemplaza: la cuenta se va sumando).
     *
     * El precio y el nombre salen del catálogo, nunca del cliente. Los ítems
     * entran como 'pending'; enviarlos a cocina es sendToKitchen().
     *
     * IMPORTANTE: este método NO abre transacción; el llamador (order.php) es
     * quien la maneja para que el pedido completo sea atómico.
     *
     * @param int         $session_id
     * @param int|null    $participant_id
     * @param array       $items [ ['product_id'=>N,'quantity'=>X,'notes'=>''], ... ]
     * @param string      $added_by 'customer' | 'staff'
     * @return array ítems insertados (con order_item_id)
     * @throws InvalidArgumentException si un ítem viene mal
     * @throws Exception si un producto no existe/no es vendible
     */
    public function addItems($session_id, $participant_id, array $items, $added_by = 'customer') {
        $session_id = (int)$session_id;
        $added_by = ($added_by === 'staff') ? 'staff' : 'customer';

        $session = $this->getSessionRow($session_id);
        if (!$session) {
            throw new Exception('La cuenta no existe', 404);
        }
        if (!in_array($session['status'], ['open', 'awaiting_payment'], true)) {
            throw new Exception('La cuenta no está abierta', 409);
        }
        $store_id = (int)$session['store_id'];

        foreach ($items as $it) {
            $qty = isset($it['quantity']) ? (float)$it['quantity'] : 0.0;
            if ($qty <= 0) {
                throw new InvalidArgumentException('La cantidad debe ser mayor que cero');
            }
            if ($qty > self::MAX_LINE_QUANTITY) {
                throw new InvalidArgumentException('La cantidad máxima por línea es ' . self::MAX_LINE_QUANTITY);
            }
            if ((int)($it['product_id'] ?? 0) <= 0) {
                throw new InvalidArgumentException('Falta el producto en una de las líneas');
            }
        }

        // Catálogo: solo productos vendibles de ESTA tienda. El precio es el de BD.
        $ids = [];
        foreach ($items as $it) {
            $ids[(int)$it['product_id']] = true;
        }
        $ids = array_keys($ids);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $rows = $this->db->select(
            "SELECT product_id, product_name, price
             FROM products
             WHERE store_id = ?
               AND product_id IN ($placeholders)
               AND status = 'active'
               AND is_ingredient = 0
               AND hidden_in_pos = 0",
            array_merge([$store_id], $ids)
        );
        $map = [];
        foreach ($rows as $r) {
            $map[(int)$r['product_id']] = $r;
        }

        $participant_id = (int)$participant_id > 0 ? (int)$participant_id : null;
        $conn = $this->db->getConnection();
        $insert = $conn->prepare(
            "INSERT INTO dining_order_items
                (session_id, participant_id, product_id, product_name, unit_price,
                 quantity, notes, line_total, discount_applied, promotion_id, status, added_by)
             VALUES
                (:session_id, :participant_id, :product_id, :product_name, :unit_price,
                 :quantity, :notes, :line_total, 0.00, NULL, 'pending', :added_by)"
        );

        $created = [];
        foreach ($items as $it) {
            $pid = (int)$it['product_id'];
            if (!isset($map[$pid])) {
                throw new Exception('El producto no está disponible en esta tienda', 404);
            }
            $p    = $map[$pid];
            $qty  = (float)$it['quantity'];
            $unit = (float)$p['price'];
            $notes = isset($it['notes']) ? $this->clamp($it['notes'], 255) : '';
            $notes = $notes !== '' ? $notes : null;

            /**
             * SE FUSIONA con la línea pendiente equivalente: mismo platillo, mismo comensal
             * y MISMAS notas.
             *
             * Sin esto, mandar el pedido "de uno en uno" (que es como se pide de verdad:
             * un toque, un platillo) creaba una línea por toque, y la cuenta del cliente se
             * llenaba de renglones idénticos. Con notas distintas SÍ son líneas distintas:
             * "sin cebolla" y "con todo" son dos platillos que la cocina prepara aparte.
             *
             * Lo ya enviado a preparación nunca se toca: se busca solo en 'pending'.
             */
            $condiciones = ["session_id = :sid", "status = 'pending'", "product_id = :pid"];
            $params = [':sid' => $session_id, ':pid' => $pid];
            if ($participant_id === null) {
                $condiciones[] = 'participant_id IS NULL';
            } else {
                $condiciones[] = 'participant_id = :p_id';
                $params[':p_id'] = $participant_id;
            }
            if ($notes === null) {
                $condiciones[] = 'notes IS NULL';
            } else {
                $condiciones[] = 'notes = :notas';
                $params[':notas'] = $notes;
            }

            $buscar = $conn->prepare(
                "SELECT order_item_id, quantity FROM dining_order_items
                  WHERE " . implode(' AND ', $condiciones) . "
                  ORDER BY order_item_id ASC LIMIT 1"
            );
            $buscar->execute($params);
            $existente = $buscar->fetch(PDO::FETCH_ASSOC);

            if ($existente) {
                $nueva = (float)$existente['quantity'] + $qty;
                if ($nueva > self::MAX_LINE_QUANTITY) {
                    throw new InvalidArgumentException(
                        'La cantidad máxima por línea es ' . self::MAX_LINE_QUANTITY
                    );
                }
                $lineTotal = round($nueva * $unit, 2);
                $conn->prepare(
                    "UPDATE dining_order_items
                        SET quantity = :qty, line_total = :line_total, product_name = :nombre
                      WHERE order_item_id = :oid AND session_id = :sid"
                )->execute([
                    ':qty'        => $nueva,
                    ':line_total' => $lineTotal,
                    ':nombre'     => substr((string)$p['product_name'], 0, 150),
                    ':oid'        => (int)$existente['order_item_id'],
                    ':sid'        => $session_id,
                ]);

                $created[] = [
                    'order_item_id' => (int)$existente['order_item_id'],
                    'product_id'    => $pid,
                    'product_name'  => $p['product_name'],
                    'unit_price'    => $unit,
                    'quantity'      => $nueva,
                    'notes'         => $notes,
                    'line_total'    => $lineTotal,
                    'status'        => 'pending',
                    'added_by'      => $added_by,
                    'fusionada'     => true,
                ];
                continue;
            }

            $insert->execute([
                ':session_id'     => $session_id,
                ':participant_id' => $participant_id,
                ':product_id'     => $pid,
                ':product_name'   => substr((string)$p['product_name'], 0, 150),
                ':unit_price'     => $unit,
                ':quantity'       => $qty,
                ':notes'          => $notes,
                ':line_total'     => $lineTotal = round($qty * $unit, 2),
                ':added_by'       => $added_by,
            ]);

            $created[] = [
                'order_item_id' => (int)$conn->lastInsertId(),
                'product_id'    => $pid,
                'product_name'  => $p['product_name'],
                'unit_price'    => $unit,
                'quantity'      => $qty,
                'notes'         => $notes,
                'line_total'    => $lineTotal,
                'status'        => 'pending',
                'added_by'      => $added_by,
            ];
        }

        return $created;
    }

    /**
     * Manda a preparación los ítems en 'pending' y devuelve los ítems enviados.
     *
     * DELEGA en ComandaService a propósito. Antes esto pasaba los ítems a 'sent' sin crear
     * la ronda: la cuenta y la comanda estaban fundidas, así que la cocina no tenía folio
     * ni estación que seguir. Si esta copia se quedara viva, quien la llamara mandaría
     * platillos a la cocina sin que aparecieran en el tablero — un fantasma silencioso.
     *
     * @return array ítems enviados
     */
    public function sendToKitchen($session_id) {
        if (!class_exists('ComandaService')) {
            require_once __DIR__ . '/ComandaService.class.php';
        }
        $svc = new ComandaService($this->db);
        $comandas = $svc->crearDesdeCuenta((int)$session_id, 'system', null);

        $items = [];
        foreach ($comandas as $c) {
            foreach ($c['items'] as $it) {
                $items[] = $it;
            }
        }
        return $items;
    }

    // =========================================================
    // Lectura / totales
    // =========================================================

    /**
     * La cuenta completa: sesión, comensales activos, TODOS los ítems y totales.
     * Los totales se calculan aquí mismo (no se confía en lo guardado) para que
     * la vista siempre cuadre con los ítems.
     *
     * @return array|null
     */
    public function listSession($session_id) {
        $session_id = (int)$session_id;
        $session = $this->getSessionRow($session_id);
        if (!$session) {
            return null;
        }

        $mode = null;
        if (!empty($session['menu_id'])) {
            $stmt = $this->db->getConnection()->prepare("SELECT mode FROM menus WHERE menu_id = :mid LIMIT 1");
            $stmt->execute([':mid' => (int)$session['menu_id']]);
            $m = $stmt->fetch(PDO::FETCH_ASSOC);
            $mode = $m ? $m['mode'] : null;
        }

        $stmt = $this->db->getConnection()->prepare(
            "SELECT participant_id, display_name, joined_at, last_seen_at
             FROM dining_participants
             WHERE session_id = :sid AND is_active = 1
             ORDER BY participant_id ASC"
        );
        $stmt->execute([':sid' => $session_id]);
        $participants = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $stmt = $this->db->getConnection()->prepare(
            "SELECT oi.order_item_id, oi.participant_id, p.display_name AS participant_name,
                    oi.product_id, oi.product_name, oi.unit_price, oi.quantity,
                    oi.notes, oi.line_total, oi.discount_applied, oi.promotion_id,
                    oi.status, oi.added_by, oi.cancel_reason, oi.sent_at, oi.served_at, oi.created_at
             FROM dining_order_items oi
             LEFT JOIN dining_participants p ON p.participant_id = oi.participant_id
             WHERE oi.session_id = :sid
             ORDER BY oi.created_at ASC, oi.order_item_id ASC"
        );
        $stmt->execute([':sid' => $session_id]);
        $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Totales: solo cuentan los ítems vigentes (los cancelados no se cobran).
        $subtotal = 0.0;
        $discount = 0.0;
        foreach ($items as $it) {
            if ($it['status'] === 'cancelled') {
                continue;
            }
            $subtotal += (float)$it['line_total'];
            $discount += (float)$it['discount_applied'];
        }
        $subtotal = round($subtotal, 2);
        $discount = round($discount, 2);
        $total = round(max(0.0, $subtotal - $discount), 2);

        return [
            // La sesión va ANIDADA: el cliente lee cuenta.session.ordering_enabled
            // (y cuenta.session.session_id para el canal del WebSocket). Antes
            // venían planos y la pausa de pedidos nunca se detectaba.
            // Los comensales, los ítems y los totales van al mismo nivel.
            'session'          => [
                'session_id'       => (int)$session['session_id'],
                'code'             => $session['code'],
                'status'           => $session['status'],
                'ordering_enabled' => (int)$session['ordering_enabled'] === 1,
                'split_mode'       => $session['split_mode'],
                'notes'            => $session['notes'],
                'opened_at'        => $session['opened_at'],
                'expires_at'       => $session['expires_at'],
                'mode'             => $mode,
            ],
            'participants'     => array_map(function ($p) {
                return [
                    'participant_id' => (int)$p['participant_id'],
                    'display_name'   => $p['display_name'],
                ];
            }, $participants),
            'items'            => array_map(function ($it) {
                return [
                    'order_item_id'    => (int)$it['order_item_id'],
                    'participant_id'   => $it['participant_id'] !== null ? (int)$it['participant_id'] : null,
                    'participant_name' => $it['participant_name'],
                    'product_id'       => $it['product_id'] !== null ? (int)$it['product_id'] : null,
                    'product_name'     => $it['product_name'],
                    'quantity'         => (float)$it['quantity'],
                    'unit_price'       => (float)$it['unit_price'],
                    'line_total'       => (float)$it['line_total'],
                    'notes'            => $it['notes'],
                    'status'           => $it['status'],
                    'added_by'         => $it['added_by'],
                    'cancel_reason'    => $it['cancel_reason'],
                    'sent_at'          => $it['sent_at'],
                ];
            }, $items),
            'totals'           => [
                'subtotal' => $subtotal,
                'discount' => $discount,
                'total'    => $total,
            ],
        ];
    }

    /**
     * Recalcula y GUARDA subtotal/discount/total de la cuenta.
     * Se llama tras agregar/enviar/cancelar ítems para que la fila de la sesión
     * refleje lo que vale la cuenta.
     *
     * @return array ['subtotal','discount','total']
     */
    public function recalcTotals($session_id) {
        $session_id = (int)$session_id;
        $session = $this->getSessionRow($session_id);
        if (!$session) {
            throw new Exception('La cuenta no existe', 404);
        }

        $stmt = $this->db->getConnection()->prepare(
            "SELECT COALESCE(SUM(line_total), 0) AS subtotal,
                    COALESCE(SUM(discount_applied), 0) AS discount
             FROM dining_order_items
             WHERE session_id = :sid AND status <> 'cancelled'"
        );
        $stmt->execute([':sid' => $session_id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        $subtotal = round((float)$row['subtotal'], 2);
        $discount = round((float)$row['discount'], 2);
        $total    = round(max(0.0, $subtotal - $discount), 2);

        $stmt = $this->db->getConnection()->prepare(
            "UPDATE dining_sessions
             SET subtotal = :subtotal, discount = :discount, total = :total
             WHERE session_id = :sid AND store_id = :store_id"
        );
        $stmt->execute([
            ':subtotal' => $subtotal,
            ':discount' => $discount,
            ':total'    => $total,
            ':sid'      => $session_id,
            ':store_id' => (int)$session['store_id'],
        ]);

        return ['subtotal' => $subtotal, 'discount' => $discount, 'total' => $total];
    }

    // =========================================================
    // Aviso al WebSocket
    // =========================================================

    /**
     * Avisa al relay WebSocket que algo cambió en una cuenta.
     *
     * El CANAL es el `session_id`: los clientes conectados al relay con
     * `?session=<session_id>` reciben el frame
     * {"type":"order_update","session":"<session_id>","event":"<evento>"}.
     *
     * Implementa el handshake WebSocket a mano (petición HTTP Upgrade + frame de
     * texto sin enmascarar, opcode 0x1). Es BEST-EFFORT: si el relay no está,
     * tarda demasiado o rechaza la conexión, se traga el error. La operación de
     * cocina (agregar/enviar/cancelar) NUNCA debe romperse porque el aviso no salga.
     *
     * NOTA DE INTEGRACIÓN: el relay actual (docker/customer_display_ws.py) valida
     * el canal contra un patrón UUID (`UUID_RE`). Los session_id son enteros, así
     * que un canal con session_id hoy recibe 400 y el mensaje no se propaga. Como
     * es best-effort, esto no rompe nada; para que las notificaciones lleguen hay
     * que relajar esa validación en el relay o mapear la cuenta a un UUID.
     *
     * @param int|string $session_id canal
     * @param string     $event      nombre del evento (ej. 'items_added','sent_to_kitchen')
     * @return void
     */
    public static function broadcast($session_id, $event) {
        $session_id = (int)$session_id;
        if ($session_id <= 0) {
            return;
        }

        $payload = json_encode([
            'type'    => 'order_update',
            'session' => (string)$session_id,
            'event'   => (string)$event,
        ], JSON_UNESCAPED_UNICODE);
        if ($payload === false) {
            return;
        }

        // 1) Canal de la cuenta: el comensal (o el mesero) viendo el pedido de esa mesa.
        self::enviarAlRelay((string)$session_id, $payload);

        // 2) Canal de la TIENDA: las pantallas del personal (mapa de puntos de servicio)
        //    ven los cambios de todo el salón sin refrescar ni sondear. Es el mismo aviso
        //    con el store_id añadido, para que la pantalla sepa de qué tienda es.
        $store_id = self::storeDeCuenta($session_id);
        if ($store_id > 0) {
            $payloadTienda = json_encode([
                'type'     => 'order_update',
                'session'  => (string)$session_id,
                'event'    => (string)$event,
                'store_id' => $store_id,
            ], JSON_UNESCAPED_UNICODE);
            if ($payloadTienda !== false) {
                self::enviarAlRelay(WsToken::canalTienda($store_id), $payloadTienda);
            }
        }
    }

    /** Tienda de una cuenta (para avisar a las pantallas del personal). */
    private static function storeDeCuenta($session_id) {
        try {
            $conn = self::conexion();
            if (!$conn) {
                return 0;
            }
            $stmt = $conn->prepare("SELECT store_id FROM dining_sessions WHERE session_id = :sid LIMIT 1");
            $stmt->execute([':sid' => (int)$session_id]);
            return (int)($stmt->fetchColumn() ?: 0);
        } catch (Throwable $e) {
            return 0;
        }
    }

    /** Conexión propia: broadcast() es estático y puede llamarse fuera de una petición. */
    private static function conexion() {
        static $conn = null;
        if ($conn !== null) {
            return $conn;
        }
        try {
            if (class_exists('Database')) {
                $db = new Database();
                $conn = $db->getConnection();
            }
        } catch (Throwable $e) {
            $conn = null;
        }
        return $conn;
    }

    /**
     * Manda un frame de texto al relay por el canal indicado.
     *
     * El canal viaja con token firmado (WsToken) porque el relay ya no acepta canales de
     * cuenta ni de tienda sin él: el session_id es un entero corto y adivinable.
     * Todo va envuelto en try/catch y en silencio a propósito: un aviso que no sale no puede
     * tumbar la operación que sí ocurrió.
     *
     * Es PÚBLICO porque las comandas avisan a canales que no son de una cuenta (el de la
     * tienda y el de una estación). Duplicar aquí el handshake WebSocket habría dejado dos
     * copias del mismo código para que una se quedara vieja.
     */
    public static function enviarAlRelay($canal, $payload) {
        try {
            $host = getenv('WS_HOST') ?: 'ws';
            $port = (int)(getenv('WS_PORT') ?: 8765);
            if ($host === '' || $port <= 0) {
                return;
            }

            $ruta = WsToken::urlRelay($canal);
            if ($ruta === null) {
                // Sin WS_SECRET no hay token: el relay rechazaría la conexión igual.
                return;
            }

            $fp = @stream_socket_client("tcp://{$host}:{$port}", $errno, $errstr, 2);
            if (!$fp) {
                return;
            }
            stream_set_timeout($fp, 2);

            $key = base64_encode(random_bytes(16));
            $request = "GET {$ruta} HTTP/1.1\r\n"
                     . "Host: {$host}:{$port}\r\n"
                     . "Upgrade: websocket\r\n"
                     . "Connection: Upgrade\r\n"
                     . "Sec-WebSocket-Key: {$key}\r\n"
                     . "Sec-WebSocket-Version: 13\r\n\r\n";
            @fwrite($fp, $request);

            // Leer la respuesta del handshake hasta el fin de cabeceras.
            $header = '';
            while (($line = @fgets($fp, 1024)) !== false) {
                $header .= $line;
                if (strlen($header) >= 4 && substr($header, -4) === "\r\n\r\n") {
                    break;
                }
            }

            // Solo enviamos el frame si el handshake fue aceptado (101).
            if (strpos($header, ' 101 ') !== false) {
                @fwrite($fp, self::encodeTextFrame($payload));
            }

            @fclose($fp);
        } catch (Throwable $e) {
            // Silencio a propósito: el aviso no puede tumbar la petición.
        }
    }

    /**
     * Frame WebSocket de texto SIN enmascarar (FIN + opcode 0x1) y longitud
     * de 7/16/64 bits. El relay actual acepta frames sin máscara.
     */
    private static function encodeTextFrame($payload) {
        $data = (string)$payload;
        $len  = strlen($data);
        $head = chr(0x81); // FIN (0x80) + text (0x1)
        if ($len < 126) {
            $head .= chr($len);
        } elseif ($len < 65536) {
            $head .= chr(126) . pack('n', $len);
        } else {
            $head .= chr(127) . pack('J', $len);
        }
        return $head . $data;
    }

    // =========================================================
    // Helpers internos
    // =========================================================

    /** Fila cruda de una cuenta. */
    private function getSessionRow($session_id) {
        $stmt = $this->db->getConnection()->prepare(
            "SELECT * FROM dining_sessions WHERE session_id = :sid LIMIT 1"
        );
        $stmt->execute([':sid' => (int)$session_id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: false;
    }

    /** Usuario administrador de la tienda (fallback de opened_by). */
    private function resolveStoreAdmin($store_id) {
        $stmt = $this->db->getConnection()->prepare(
            "SELECT user_id FROM users
             WHERE store_id = :store_id
               AND role IN (:r1, :r2)
               AND status = :status
             ORDER BY user_id ASC LIMIT 1"
        );
        $stmt->execute([
            ':store_id' => (int)$store_id,
            ':r1'       => ROLE_SUPER_ADMIN,
            ':r2'       => ROLE_ADMIN,
            ':status'   => STATUS_ACTIVE,
        ]);
        return (int)$stmt->fetchColumn();
    }

    /**
     * Código corto único por tienda entre las cuentas vivas. Se reintenta por
     * si choca; 4 chars del alfabeto sin ambigüedades dan margen de sobra.
     */
    private function generateUniqueCode($store_id) {
        $alphabet = self::CODE_ALPHABET;
        $max = strlen($alphabet) - 1;
        $check = $this->db->getConnection()->prepare(
            "SELECT 1 FROM dining_sessions
             WHERE store_id = :store_id AND code = :code
               AND status IN ('open','awaiting_payment') LIMIT 1"
        );
        for ($attempt = 0; $attempt < 30; $attempt++) {
            $code = '';
            for ($i = 0; $i < self::CODE_LENGTH; $i++) {
                $code .= $alphabet[random_int(0, $max)];
            }
            $check->execute([':store_id' => (int)$store_id, ':code' => $code]);
            if (!$check->fetchColumn()) {
                return $code;
            }
        }
        throw new Exception('No se pudo generar un código de mesa libre');
    }

    /** join_token: 32 bytes aleatorios en hex (64 chars), único global. */
    private function generateJoinToken() {
        $check = $this->db->getConnection()->prepare(
            "SELECT 1 FROM dining_participants WHERE join_token = :token LIMIT 1"
        );
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $token = bin2hex(random_bytes(32));
            $check->execute([':token' => $token]);
            if (!$check->fetchColumn()) {
                return $token;
            }
        }
        throw new Exception('No se pudo generar el acceso del comensal');
    }

    /** Recorta texto con seguridad (mbstring si está disponible). */
    private function clamp($text, $max) {
        $text = trim((string)$text);
        if ($text === '') {
            return '';
        }
        if (function_exists('mb_substr')) {
            return mb_substr($text, 0, $max);
        }
        return substr($text, 0, $max);
    }
}

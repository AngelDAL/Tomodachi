<?php
/**
 * Comandas — la ronda que se prepara.
 *
 * Quién es quién (glosario vinculante del proyecto):
 *   Carta    (menus / menu_items)      qué se ofrece
 *   Cuenta   (dining_sessions)         lo que consume un punto de servicio
 *   Comanda  (comandas)                la ronda que se manda a preparar  <- este archivo
 *   Cobro    (sales + sale_payments)   la venta real
 *
 * DECISIÓN ESTRUCTURAL (no revertir): la comanda NO depende del punto de servicio.
 * `comandas.session_id` es NULL-able y la comanda lleva `channel` ('service_point',
 * 'counter', 'phone', 'own_delivery', ...). Un pedido de mostrador, para llevar o de
 * una plataforma entra por esta misma puerta. Si el modelo naciera atado a `table_id`,
 * esa integración exigiría rehacerlo.
 *
 * Las comandas se parten POR ESTACIÓN: un platillo de Cocina y una bebida de Barra son
 * dos comandas, porque se preparan en dos lugares distintos y avanzan por separado. Si
 * el negocio no tiene estaciones (tienda, barbería), todo cae en un solo montón
 * (`station_id` NULL), el tablero no filtra y nadie prepara nada: es un estado válido.
 *
 * Los tiempos NUNCA se calculan en PHP: la app va en hora de México y MariaDB en UTC, y
 * comparar un valor hecho en PHP contra un `NOW()` de la base produce cuentas vencidas y
 * minutos en cero. Todo lo que sea hora o duración sale de SQL.
 */
class ComandaService {

    /** Estados en los que la comanda sigue viva en el tablero de preparación. */
    const ACTIVAS = ['sent', 'preparing', 'ready'];

    /** Cómo se avanza una comanda. Permisivo a propósito: la cocina va con prisa. */
    const TRANSICIONES = [
        'start' => ['desde' => ['sent'], 'hacia' => 'preparing'],
        'ready' => ['desde' => ['sent', 'preparing'], 'hacia' => 'ready'],
        'served' => ['desde' => ['sent', 'preparing', 'ready'], 'hacia' => 'served'],
    ];

    private $db;
    private $conn;

    public function __construct($db) {
        $this->db   = $db;
        $this->conn = $db->getConnection();
    }

    // =========================================================
    // Alta: de la cuenta a la comanda
    // =========================================================

    /**
     * Manda a preparación los ítems 'pending' de una cuenta y devuelve las comandas
     * creadas (una por estación).
     *
     * NO abre transacción: el llamador (order.php) es quien la maneja, para que el
     * envío completo sea atómico. Así el mismo camino sirve para el comensal y para
     * el mesero.
     *
     * @param int         $session_id
     * @param string      $by_type 'customer' | 'staff' | 'system'
     * @param int|null    $by_id   user_id cuando lo manda el personal
     * @return array comandas creadas (con sus ítems)
     */
    public function crearDesdeCuenta($session_id, $by_type = 'customer', $by_id = null) {
        $session_id = (int)$session_id;
        $session = $this->sesion($session_id);
        if (!$session) {
            throw new Exception('La cuenta no existe', 404);
        }
        $store_id = (int)$session['store_id'];

        // Los ítems pendientes, cada uno con la estación de SU producto.
        // Aquí se ve por qué la estación vive en el producto: el negocio la captura una
        // sola vez y todas las comandas futuras quedan repartidas sin volver a decidirlo.
        $stmt = $this->conn->prepare(
            "SELECT oi.order_item_id, oi.participant_id, p.display_name AS participant_name,
                    oi.product_id, oi.product_name, oi.quantity, oi.notes,
                    pr.station_id AS product_station_id
               FROM dining_order_items oi
               LEFT JOIN products pr ON pr.product_id = oi.product_id
               LEFT JOIN dining_participants p ON p.participant_id = oi.participant_id
              WHERE oi.session_id = :sid AND oi.status = 'pending'
              ORDER BY oi.created_at ASC, oi.order_item_id ASC"
        );
        $stmt->execute([':sid' => $session_id]);
        $items = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (!$items) {
            return [];
        }

        // Agrupar por estación. 0 = sin estación (el montón general).
        $grupos = [];
        foreach ($items as $it) {
            $clave = (int)($it['product_station_id'] ?? 0);
            $grupos[$clave][] = $it;
        }

        $fecha      = $this->fechaDeNegocio();
        $by_type    = in_array($by_type, ['customer', 'staff', 'system'], true) ? $by_type : 'customer';
        $creadas    = [];

        foreach ($grupos as $clave => $lineas) {
            $station_id = $clave > 0 ? $clave : null;

            // La estación pudo desactivarse entre que se capturó el producto y ahora:
            // una comanda a una estación apagada se quedaría invisible en el tablero.
            if ($station_id !== null && !$this->estacionViva($station_id, $store_id)) {
                $station_id = null;
            }

            $comanda_id = $this->insertarComanda($store_id, $session_id, $station_id, $fecha, $by_type, $by_id);

            $ids = array_map(function ($l) { return (int)$l['order_item_id']; }, $lineas);
            $marcadores = implode(',', array_fill(0, count($ids), '?'));
            $upd = $this->conn->prepare(
                "UPDATE dining_order_items
                    SET comanda_id = ?, station_id = ?, status = 'sent', sent_at = NOW()
                  WHERE order_item_id IN ($marcadores) AND status = 'pending'"
            );
            $upd->execute(array_merge([$comanda_id, $station_id], $ids));

            $creadas[] = $comanda_id;

            // La cola de impresión se alimenta AQUÍ, en la misma transacción que crea
            // la comanda. Si el INSERT del job falla, falla el `send` completo y el
            // mesero lo ve al instante: preferimos eso a una comanda enviada sin
            // trabajo de impresión (el ticket perdido en silencio es el modo de falla
            // que hay que evitar). No toca el camino del dinero: la comanda no es la
            // venta. Si la estación no tiene salida `print` con ruta, no hace nada.
            $this->encolarImpresion($comanda_id, $store_id);
        }

        return $this->varias($creadas, $store_id);
    }

    /**
     * Encola el ticket de una comanda recién creada (una fila por salida de impresión).
     *
     * @return array|null null si la cola está apagada o la comanda no se pudo leer
     */
    private function encolarImpresion($comanda_id, $store_id) {
        if (defined('PRINT_QUEUE_ENABLED') && !PRINT_QUEUE_ENABLED) {
            // Interruptor de retroceso: comportamiento de antes (impresión del navegador).
            return null;
        }
        require_once __DIR__ . '/EscPos.class.php';
        require_once __DIR__ . '/PrintQueue.class.php';

        $comanda = $this->obtener((int)$comanda_id, (int)$store_id);
        if (!$comanda) {
            return null;
        }
        $queue = new PrintQueue($this->db);
        return $queue->encolarComanda($comanda, (int)$store_id);
    }

    /**
     * Inserta la comanda con el folio del día.
     *
     * El folio se calcula DENTRO del INSERT (`MAX(number) + 1`) y la llave única
     * (store_id, business_date, number) es el candado: si dos meseros mandan a la vez,
     * uno choca y reintenta, en vez de quedarse con dos comandas con el mismo folio.
     *
     * Ojo con PDO: un marcador nombrado NO se puede repetir en la misma consulta.
     */
    private function insertarComanda($store_id, $session_id, $station_id, $fecha, $by_type, $by_id) {
        $sql = "INSERT INTO comandas
                    (store_id, session_id, channel, business_date, number, station_id, status,
                     created_by_type, created_by_id, sent_at)
                SELECT :store_id, :session_id, 'service_point', :fecha,
                       COALESCE(MAX(number), 0) + 1, :station_id, 'sent',
                       :by_type, :by_id, NOW()
                  FROM comandas
                 WHERE store_id = :store_id_filtro AND business_date = :fecha_filtro";

        for ($intento = 1; $intento <= 4; $intento++) {
            try {
                $stmt = $this->conn->prepare($sql);
                $stmt->execute([
                    ':store_id'        => $store_id,
                    ':session_id'      => $session_id,
                    ':fecha'           => $fecha,
                    ':station_id'      => $station_id,
                    ':by_type'         => $by_type,
                    ':by_id'           => $by_id !== null ? (int)$by_id : null,
                    ':store_id_filtro' => $store_id,
                    ':fecha_filtro'    => $fecha,
                ]);
                return (int)$this->conn->lastInsertId();
            } catch (PDOException $e) {
                // 23000 = choque con la llave única del folio: se reintenta y toma el siguiente.
                if ((string)$e->getCode() !== '23000' || $intento === 4) {
                    throw $e;
                }
            }
        }
        throw new Exception('No se pudo asignar el folio de la comanda');
    }

    // =========================================================
    // Lectura: el tablero de preparación
    // =========================================================

    /**
     * Lo que ve la pantalla de preparación.
     *
     * @param int   $store_id
     * @param array $opts station_id (0 = todas), historicas (incluye servidas/canceladas),
     *                    fecha (por defecto el día de negocio)
     * @return array ['fecha','comandas','estaciones','conteos']
     */
    public function tablero($store_id, array $opts = []) {
        $store_id   = (int)$store_id;
        // Antes de leer: los pedidos de mostrador creados ANTES de que existiera el enlace no
        // tienen comanda, y en cocina no aparecerían nunca. Se reparan al vuelo (normalmente no
        // hay nada que reparar) en vez de confiar en una migración de una sola vez.
        $this->repararComandasDeMostrador($store_id);
        $station_id = (int)($opts['station_id'] ?? 0);
        $fecha      = $opts['fecha'] ?? $this->fechaDeNegocio();
        $historicas = !empty($opts['historicas']);

        $estados = self::ACTIVAS;
        if ($historicas) {
            $estados = array_merge($estados, ['served', 'dispatched', 'delivered', 'cancelled']);
        }
        $marcadores = implode(',', array_fill(0, count($estados), '?'));

        // Los minutos y la fecha salen de la BASE (ver la nota de zonas horarias arriba).
        $sql = "SELECT c.comanda_id, c.session_id, c.channel, c.station_id, c.status,
                       c.number, c.business_date, c.notes, c.printed_count,
                       c.print_status, c.print_attempts, c.print_last_error, c.print_failed_at,
                       c.created_by_type, c.sent_at, c.ready_at, c.served_at,
                       c.cancelled_at, c.cancel_reason,
                       c.delivery_name, c.delivery_phone, c.delivery_address, c.delivery_fee,
                       st.name AS station_name,
                       s.code  AS session_code,
TIMESTAMPDIFF(MINUTE, COALESCE(c.sent_at, c.created_at), NOW()) AS minutos,
                        TIMESTAMPDIFF(SECOND, COALESCE(c.sent_at, c.created_at), NOW()) AS segundos,
                       (SELECT GROUP_CONCAT(DISTINCT COALESCE(t.label, 'Sin punto') ORDER BY t.label SEPARATOR ' + ')
                          FROM dining_tables t
                         WHERE t.table_id = s.table_id
                            OR t.table_id IN (SELECT csp.table_id FROM check_service_points csp
                                               WHERE csp.session_id = s.session_id)) AS puntos,
                       (SELECT GROUP_CONCAT(DISTINCT dp.display_name ORDER BY dp.display_name SEPARATOR ', ')
                          FROM dining_participants dp
                         WHERE dp.session_id = s.session_id AND dp.is_active = 1) AS personas
                  FROM comandas c
                  LEFT JOIN stations st ON st.station_id = c.station_id
                  LEFT JOIN dining_sessions s ON s.session_id = c.session_id
                 WHERE c.store_id = ?
                   AND c.status IN ($marcadores)
                   AND (c.business_date = ? OR c.status IN ('sent','preparing','ready'))";
        $params = array_merge([$store_id], $estados, [$fecha]);

        if ($station_id > 0) {
            $sql .= " AND c.station_id = ?";
            $params[] = $station_id;
        }
        // El más viejo primero: lo que lleva más tiempo esperando es lo urgente.
        $sql .= " ORDER BY COALESCE(c.sent_at, c.created_at) ASC, c.comanda_id ASC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);
        $filas = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $ids = array_map(function ($f) { return (int)$f['comanda_id']; }, $filas);
        $items = $this->itemsDeComandas($ids);

        $comandas = [];
        $conteos  = ['sent' => 0, 'preparing' => 0, 'ready' => 0, 'served' => 0, 'cancelled' => 0];
        foreach ($filas as $f) {
            $cid = (int)$f['comanda_id'];
            $comanda = $this->formatear($f, $items[$cid] ?? []);
            $comandas[] = $comanda;
            if (isset($conteos[$comanda['status']])) {
                $conteos[$comanda['status']]++;
            }
        }

        return [
            'fecha'       => $fecha,
            'comandas'    => $comandas,
            'estaciones'  => $this->estaciones($store_id, true),
            'sin_estacion' => $this->contarSinEstacion($store_id),
            'conteos'     => $conteos,
            // La pantalla necesita saber si la impresión sale del SERVIDOR (cola
            // ESC/POS) o sigue siendo la del navegador: con la cola apagada
            // (PRINT_QUEUE_ENABLED=false) el botón vuelve a ser "Imprimir" con
            // window.print(). El rollback es una constante, también en la UI.
            'impresion'   => [
                'enabled' => defined('PRINT_QUEUE_ENABLED') ? (bool)PRINT_QUEUE_ENABLED : false,
            ],
        ];
    }

    /** Una comanda con sus ítems, acotada a la tienda del que pregunta. */
    public function obtener($comanda_id, $store_id) {
        $fila = $this->filaComanda((int)$comanda_id, (int)$store_id);
        if (!$fila) {
            return null;
        }
        $items = $this->itemsDeComandas([(int)$comanda_id]);
        return $this->formatear($fila, $items[(int)$comanda_id] ?? []);
    }

    /** Varias comandas por id (con sus ítems), acotadas a la tienda. */
    private function varias(array $ids, $store_id) {
        $ids = array_values(array_filter(array_map('intval', $ids)));
        if (!$ids) {
            return [];
        }
        $marcadores = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->conn->prepare(
            "SELECT c.comanda_id, c.session_id, c.channel, c.station_id, c.status,
                    c.number, c.business_date, c.notes, c.printed_count,
                    c.print_status, c.print_attempts, c.print_last_error, c.print_failed_at,
                    c.created_by_type, c.sent_at, c.ready_at, c.served_at,
                    c.cancelled_at, c.cancel_reason,
                    c.delivery_name, c.delivery_phone, c.delivery_address, c.delivery_fee,
                    st.name AS station_name,
                    s.code  AS session_code,
                    TIMESTAMPDIFF(MINUTE, COALESCE(c.sent_at, c.created_at), NOW()) AS minutos,
                    TIMESTAMPDIFF(SECOND, COALESCE(c.sent_at, c.created_at), NOW()) AS segundos,
                    (SELECT GROUP_CONCAT(DISTINCT COALESCE(t.label, 'Sin punto') ORDER BY t.label SEPARATOR ' + ')
                       FROM dining_tables t
                      WHERE t.table_id = s.table_id
                         OR t.table_id IN (SELECT csp.table_id FROM check_service_points csp
                                            WHERE csp.session_id = s.session_id)) AS puntos,
                    (SELECT GROUP_CONCAT(DISTINCT dp.display_name ORDER BY dp.display_name SEPARATOR ', ')
                       FROM dining_participants dp
                      WHERE dp.session_id = s.session_id AND dp.is_active = 1) AS personas
               FROM comandas c
               LEFT JOIN stations st ON st.station_id = c.station_id
               LEFT JOIN dining_sessions s ON s.session_id = c.session_id
              WHERE c.store_id = ? AND c.comanda_id IN ($marcadores)
              ORDER BY c.comanda_id ASC"
        );
        $stmt->execute(array_merge([(int)$store_id], $ids));
        $filas = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $items = $this->itemsDeComandas($ids);
        $salida = [];
        foreach ($filas as $f) {
            $salida[] = $this->formatear($f, $items[(int)$f['comanda_id']] ?? []);
        }
        return $salida;
    }

    /**
     * Refleja en el pedido de mostrador lo que acaba de hacer la cocina.
     *
     * Al dar "entregar" en cocina, el pedido sale de su lista (el tablero no muestra las comandas
     * servidas) y además la caja y el cliente tienen que ver lo mismo: si no, el pedido seguiría
     * apareciendo como pendiente en el mostrador y el cliente nunca se enteraría.
     */
    private function sincronizarPedidoDeMostrador(array $comanda, $destino, $store_id) {
        if (($comanda['channel'] ?? '') !== 'counter' || empty($comanda['external_ref'])) {
            return;
        }
        // El `store_id` se recibe: la fila de la comanda no lo trae en su SELECT.
        $oid = (int)$comanda['external_ref'];
        try {
            if ($destino === 'ready') {
                $this->conn->prepare(
                    "UPDATE counter_orders SET status = 'ready', notified_at = COALESCE(notified_at, NOW())
                      WHERE counter_order_id = ? AND store_id = ? AND status = 'pending'"
                )->execute([$oid, $store_id]);
            } elseif ($destino === 'served' || $destino === 'delivered') {
                $this->conn->prepare(
                    "UPDATE counter_orders SET status = 'completed', completed_at = COALESCE(completed_at, NOW())
                      WHERE counter_order_id = ? AND store_id = ? AND status IN ('pending', 'ready')"
                )->execute([$oid, $store_id]);
            } elseif ($destino === 'cancelled') {
                $this->conn->prepare(
                    "UPDATE counter_orders SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW())
                      WHERE counter_order_id = ? AND store_id = ? AND status IN ('pending', 'ready')"
                )->execute([$oid, $store_id]);
            }
            // Se avisa por el canal de la tienda: la caja y el cliente lo ven al instante.
            $payload = json_encode([
                'type'     => 'order_update',
                'counter'  => $oid,
                'event'    => 'counter_' . $destino,
                'store_id' => $store_id,
            ], JSON_UNESCAPED_UNICODE);
            if ($payload !== false) {
                DiningSession::enviarAlRelay(WsToken::canalTienda($store_id), $payload);
            }
        } catch (Throwable $e) {
            // La comanda ya avanzó: esto es el espejo, no puede deshacer lo que hizo la cocina.
        }
    }

    /**
     * Les pone comanda a los pedidos de mostrador activos que no la tengan.
     *
     * Son los que se crearon antes de que el mostrador creara comandas. Sin esto, en cocina no
     * aparecerían nunca y el fallo seguiría viéndose con los pedidos ya existentes.
     */
    private function repararComandasDeMostrador($store_id) {
        try {
            // Sin `NOT EXISTS`: se piden los pedidos activos y `crearDesdeMostrador` ya devuelve
            // la comanda que exista en vez de duplicarla. La consulta con subconsulta sobre la
            // misma tabla fallaba en silencio (el catch se la tragaba) y no reparaba nada.
            $st = $this->conn->prepare(
                "SELECT counter_order_id, notes, created_by, status
                   FROM counter_orders
                  WHERE store_id = ? AND status IN ('pending', 'ready')"
            );
            $st->execute([(int)$store_id]);
            $faltan = $st->fetchAll(PDO::FETCH_ASSOC);
            if (!$faltan) {
                return;
            }
            foreach ($faltan as $o) {
                $this->crearDesdeMostrador($store_id, (int)$o['counter_order_id'], $o['notes'], $o['created_by']);
                if ((string)$o['status'] === 'ready') {
                    $this->sincronizarMostrador($store_id, (int)$o['counter_order_id'], 'ready');
                }
            }
        } catch (Throwable $e) {
            // La reparación es una red de seguridad: si falla, el tablero se lee igual.
        }
    }

    /** Los ítems de varias comandas, en una sola consulta. */
    private function itemsDeComandas(array $comanda_ids) {
        $comanda_ids = array_values(array_filter(array_map('intval', $comanda_ids)));
        if (!$comanda_ids) {
            return [];
        }
        $marcadores = implode(',', array_fill(0, count($comanda_ids), '?'));
        $stmt = $this->conn->prepare(
            "SELECT oi.comanda_id, oi.order_item_id, oi.participant_id,
                    p.display_name AS participant_name,
                    oi.product_id, oi.product_name, oi.quantity, oi.notes,
                    oi.status, oi.added_by, oi.station_id, oi.cancel_reason,
                    oi.sent_at, oi.ready_at, oi.served_at
               FROM dining_order_items oi
               LEFT JOIN dining_participants p ON p.participant_id = oi.participant_id
              WHERE oi.comanda_id IN ($marcadores)
              ORDER BY oi.order_item_id ASC"
        );
        $stmt->execute($comanda_ids);

        $por_comanda = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $it) {
            $por_comanda[(int)$it['comanda_id']][] = [
                'order_item_id'    => (int)$it['order_item_id'],
                'product_id'       => $it['product_id'] !== null ? (int)$it['product_id'] : null,
                'product_name'     => $it['product_name'],
                'quantity'         => (float)$it['quantity'],
                'notes'            => $it['notes'],
                'status'           => $it['status'],
                'added_by'         => $it['added_by'],
                'participant_id'   => $it['participant_id'] !== null ? (int)$it['participant_id'] : null,
                'participant_name' => $it['participant_name'],
                'station_id'       => $it['station_id'] !== null ? (int)$it['station_id'] : null,
                'cancel_reason'    => $it['cancel_reason'],
                'sent_at'          => $it['sent_at'],
                'ready_at'         => $it['ready_at'],
                'served_at'        => $it['served_at'],
            ];
        }
        // Las comandas de MOSTRADOR no tienen renglones en `dining_order_items`: viven en su
        // propia tabla. Se unen aquí para que quien pinta el tablero no tenga que saber de dónde
        // viene cada renglón.
        return $por_comanda + $this->itemsDeComandasMostrador($comanda_ids);
    }

    /**
     * Renglones de las comandas que vienen del mostrador.
     *
     * El eslabón es `comandas.external_ref`, que apunta al pedido de mostrador: así no hace falta
     * duplicar columnas en `counter_order_items` ni migrar nada.
     *
     * El estado del renglón se DEDUCE del de la comanda: en el mostrador un pedido se prepara
     * completo, no renglón por renglón.
     */
    private function itemsDeComandasMostrador(array $comanda_ids) {
        if (!$comanda_ids) {
            return [];
        }
        $marcadores = implode(',', array_fill(0, count($comanda_ids), '?'));
        try {
            $stmt = $this->conn->prepare(
                "SELECT c.comanda_id, i.item_id, i.product_id, i.product_name, i.quantity, i.notes,
                        c.status AS comanda_status
                   FROM comandas c
                   JOIN counter_order_items i ON i.counter_order_id = CAST(c.external_ref AS UNSIGNED)
                  WHERE c.comanda_id IN ($marcadores) AND c.channel = 'counter'
                  ORDER BY i.item_id ASC"
            );
            $stmt->execute($comanda_ids);
            $filas = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Throwable $e) {
            return [];   // sin mostrador en la comanda no se rompe el tablero de cocina
        }

        $equivalente = [
            'sent' => 'sent', 'preparing' => 'preparing', 'ready' => 'ready',
            'served' => 'served', 'dispatched' => 'sent', 'delivered' => 'served',
            'cancelled' => 'cancelled', 'draft' => 'sent',
        ];

        $por_comanda = [];
        foreach ($filas as $it) {
            $estado = $equivalente[$it['comanda_status']] ?? 'sent';
            $por_comanda[(int)$it['comanda_id']][] = [
                'order_item_id'    => (int)$it['item_id'],
                'product_id'       => $it['product_id'] !== null ? (int)$it['product_id'] : null,
                'product_name'     => $it['product_name'],
                'quantity'         => (float)$it['quantity'],
                'notes'            => $it['notes'],
                'status'           => $estado,
                'added_by'         => 'staff',
                'participant_id'   => null,
                'participant_name' => null,
                'station_id'       => null,
                'cancel_reason'    => null,
                'sent_at'          => null,
                'ready_at'         => null,
                'served_at'        => null,
            ];
        }
        return $por_comanda;
    }

    /**
     * Crea la comanda de un pedido de MOSTRADOR, para que aparezca en el tablero de cocina.
     *
     * Sin esto el pedido de mostrador se quedaba sólo en su tabla y en cocina no se veía nunca.
     * `channel = 'counter'` y `external_ref` = el id del pedido: con eso quien pregunta puede
     * volver al pedido (y sus renglones) sin duplicar datos.
     */
    public function crearDesdeMostrador($store_id, $counter_order_id, $notes = null, $by_id = null) {
        $store_id = (int)$store_id;
        $counter_order_id = (int)$counter_order_id;

        // Si ya tiene comanda (por un reintento de la caja), no se duplica.
        $stmt = $this->conn->prepare(
            "SELECT comanda_id FROM comandas
              WHERE store_id = ? AND channel = 'counter' AND external_ref = ?
              ORDER BY comanda_id DESC LIMIT 1"
        );
        $stmt->execute([$store_id, (string)$counter_order_id]);
        $ya = $stmt->fetchColumn();
        if ($ya) {
            return (int)$ya;
        }

        $fecha = $this->fechaDeNegocio();
        // Una sola comanda para todo el pedido, sin estación: el mostrador es un pedido completo
        // para un cliente, no renglones que se reparten entre barra y cocina.
        $sql = "INSERT INTO comandas
                    (store_id, session_id, channel, external_ref, business_date, number, station_id,
                     status, created_by_type, created_by_id, notes, sent_at)
                SELECT :store_id, NULL, 'counter', :ref, :fecha,
                       COALESCE(MAX(number), 0) + 1, NULL, 'sent', 'staff', :by, :notas, NOW()
                  FROM comandas
                 WHERE store_id = :store_id_filtro AND business_date = :fecha_filtro";

        for ($intento = 1; $intento <= 4; $intento++) {
            try {
                $stmt = $this->conn->prepare($sql);
                $stmt->execute([
                    ':store_id'        => $store_id,
                    ':ref'             => (string)$counter_order_id,
                    ':fecha'           => $fecha,
                    ':by'              => $by_id !== null ? (int)$by_id : null,
                    ':notas'           => ($notes !== null && trim((string)$notes) !== '') ? mb_substr(trim((string)$notes), 0, 255) : null,
                    ':store_id_filtro' => $store_id,
                    ':fecha_filtro'    => $fecha,
                ]);
                $comanda_id = (int)$this->conn->lastInsertId();
                $this->encolarImpresion($comanda_id, $store_id);
                return $comanda_id;
            } catch (PDOException $e) {
                if ((string)$e->getCode() !== '23000' || $intento === 4) {
                    throw $e;
                }
            }
        }
        throw new Exception('No se pudo asignar el folio de la comanda de mostrador');
    }

    /** Mantiene la comanda de mostrador al día con su pedido (avisar, entregar, cancelar). */
    public function sincronizarMostrador($store_id, $counter_order_id, $estado_pedido, $motivo = null, $notes = null) {
        $equivalente = [
            'pending'   => 'sent',
            'ready'     => 'ready',
            'completed' => 'served',
            'cancelled' => 'cancelled',
        ];
        $nuevo = $equivalente[$estado_pedido] ?? null;
        if ($nuevo === null) {
            return false;
        }
        try {
            $sets = ['status = :estado'];
            $params = [':estado' => $nuevo, ':sid' => (int)$store_id, ':ref' => (string)(int)$counter_order_id];
            if ($nuevo === 'ready')   { $sets[] = 'ready_at = COALESCE(ready_at, NOW())'; }
            if ($nuevo === 'served')  { $sets[] = 'served_at = COALESCE(served_at, NOW())'; }
            if ($nuevo === 'cancelled') {
                $sets[] = 'cancelled_at = COALESCE(cancelled_at, NOW())';
                $sets[] = 'cancel_reason = :motivo';
                $params[':motivo'] = $motivo !== null ? mb_substr((string)$motivo, 0, 255) : null;
            }
            if ($notes !== null) {
                $sets[] = 'notes = :notas';
                $params[':notas'] = trim((string)$notes) !== '' ? mb_substr(trim((string)$notes), 0, 255) : null;
            }
            $stmt = $this->conn->prepare(
                "UPDATE comandas SET " . implode(', ', $sets) . "
                  WHERE store_id = :sid AND channel = 'counter' AND external_ref = :ref"
            );
            $stmt->execute($params);
            return $stmt->rowCount() > 0;
        } catch (Throwable $e) {
            return false;
        }
    }

    /** Fila cruda de una comanda, acotada a la tienda. */
    private function filaComanda($comanda_id, $store_id) {
        $stmt = $this->conn->prepare(
            // `external_ref` es lo que enlaza la comanda con el pedido de mostrador: sin esta
            // columna, el espejo hacia la caja no encontraba el pedido y lo daba por ajeno.
            "SELECT c.comanda_id, c.session_id, c.channel, c.external_ref, c.station_id, c.status,
                    c.number, c.business_date, c.notes, c.printed_count,
                    c.print_status, c.print_attempts, c.print_last_error, c.print_failed_at,
                    c.created_by_type, c.sent_at, c.ready_at, c.served_at,
                    c.cancelled_at, c.cancel_reason,
                    c.delivery_name, c.delivery_phone, c.delivery_address, c.delivery_fee,
                    st.name AS station_name,
                    s.code  AS session_code,
                    TIMESTAMPDIFF(MINUTE, COALESCE(c.sent_at, c.created_at), NOW()) AS minutos,
                    TIMESTAMPDIFF(SECOND, COALESCE(c.sent_at, c.created_at), NOW()) AS segundos,
                    (SELECT GROUP_CONCAT(DISTINCT COALESCE(t.label, 'Sin punto') ORDER BY t.label SEPARATOR ' + ')
                       FROM dining_tables t
                      WHERE t.table_id = s.table_id
                         OR t.table_id IN (SELECT csp.table_id FROM check_service_points csp
                                            WHERE csp.session_id = s.session_id)) AS puntos,
                    (SELECT GROUP_CONCAT(DISTINCT dp.display_name ORDER BY dp.display_name SEPARATOR ', ')
                       FROM dining_participants dp
                      WHERE dp.session_id = s.session_id AND dp.is_active = 1) AS personas
               FROM comandas c
               LEFT JOIN stations st ON st.station_id = c.station_id
               LEFT JOIN dining_sessions s ON s.session_id = c.session_id
              WHERE c.comanda_id = :cid AND c.store_id = :store_id
              LIMIT 1"
        );
        $stmt->execute([':cid' => $comanda_id, ':store_id' => $store_id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    /** Da forma de contrato a una fila de comanda (lo que consume la pantalla). */
    private function formatear(array $f, array $items) {
        // Lo que de verdad importa para preparar: qué, cuánto y con qué anotación.
        $notas = [];
        foreach ($items as $it) {
            if (!empty($it['notes']) && $it['status'] !== 'cancelled') {
                $notas[] = $it['product_name'] . ': ' . $it['notes'];
            }
        }

        return [
            'comanda_id'   => (int)$f['comanda_id'],
            'folio'        => (int)$f['number'],
            'session_id'   => $f['session_id'] !== null ? (int)$f['session_id'] : null,
            'channel'      => $f['channel'],
            'status'       => $f['status'],
            'station_id'   => $f['station_id'] !== null ? (int)$f['station_id'] : null,
            'station_name' => $f['station_name'],
            'punto'        => $f['puntos'] ?: null,
            'code'         => $f['session_code'],
            'personas'     => $f['personas'],
            'personas_n'   => $f['personas'] ? count(explode(', ', $f['personas'])) : 0,
            'minutos'      => (int)$f['minutos'],
            'segundos'     => isset($f['segundos']) ? (int)$f['segundos'] : (int)$f['minutos'] * 60,
            'business_date' => $f['business_date'],
            'notes'        => $f['notes'],
            'notas_lineas' => $notas,
            'printed_count' => (int)$f['printed_count'],
            // La marca de impresión del servidor (TAB-22): con esto el tablero puede
            // pintar "En cola" / "Impresa" / "No salió" + motivo, en vez de un contador
            // que no distingue "salió 0 veces" de "falló 3 veces".
            'print_status'     => $f['print_status'] ?? 'none',
            'print_attempts'   => (int)($f['print_attempts'] ?? 0),
            'print_last_error' => $f['print_last_error'] ?? null,
            'print_failed_at'  => $f['print_failed_at'] ?? null,
            // La hora del ticket, en la hora LOCAL del negocio. `sent_at` es un
            // instante en UTC que pone la base; aquí solo se le cambia el reloj, no se
            // calcula ninguna diferencia (las diferencias sí van en SQL: minutos,
            // segundos y vencimientos, ver la nota de zonas horarias del encabezado).
            'hora_local'   => self::horaLocal($f['sent_at'] ?? null),
            'created_by_type' => $f['created_by_type'],
            'sent_at'      => $f['sent_at'],
            'ready_at'     => $f['ready_at'],
            'served_at'    => $f['served_at'],
            'cancelled_at' => $f['cancelled_at'],
            'cancel_reason' => $f['cancel_reason'],
            'entrega'      => [
                'nombre'    => $f['delivery_name'],
                'telefono'  => $f['delivery_phone'],
                'direccion' => $f['delivery_address'],
                'costo'     => (float)$f['delivery_fee'],
            ],
            'items'        => $items,
        ];
    }

    // =========================================================
    // Avance de la comanda
    // =========================================================

    /**
     * Mueve la comanda (y TODOS sus ítems) al siguiente estado.
     *
     * Se avanza la comanda completa a propósito: la pantalla es una tableta en una
     * cocina, con las manos ocupadas, y el que prepara la ronda la mueve entera. El
     * comensal y el mesero ven el avance en el estado de cada ítem.
     *
     * @param string $accion 'start' | 'ready' | 'served'
     */
    public function avanzar($comanda_id, $store_id, $accion, $user_id = null) {
        if (!isset(self::TRANSICIONES[$accion])) {
            throw new InvalidArgumentException('Acción de comanda desconocida');
        }
        $regla    = self::TRANSICIONES[$accion];
        $destino  = $regla['hacia'];
        $comanda  = $this->filaComanda((int)$comanda_id, (int)$store_id);
        if (!$comanda) {
            throw new Exception('La comanda no existe', 404);
        }
        if ($comanda['status'] === 'cancelled') {
            throw new Exception('La comanda está anulada', 409);
        }
        if (!in_array($comanda['status'], $regla['desde'], true)) {
            throw new Exception('La comanda ya cambió de estado; actualiza la pantalla', 409);
        }

        $this->conn->beginTransaction();
        try {
            $sql = "UPDATE comandas SET status = :status";
            $params = [':status' => $destino, ':cid' => (int)$comanda_id, ':store_id' => (int)$store_id];
            // Cada estado deja su marca de tiempo; es lo que después mide cuánto tardó la
            // cocina, así que no se inventa ni se deja pasar.
            if ($destino === 'ready') {
                $sql .= ", ready_at = NOW()";
            } elseif ($destino === 'served') {
                $sql .= ", served_at = NOW()";
            }
            $sql .= " WHERE comanda_id = :cid AND store_id = :store_id";
            $this->conn->prepare($sql)->execute($params);

            // Los ítems siguen a su comanda: el mismo nombre de estado, uno a uno.
            $item_status = ['preparing' => 'preparing', 'ready' => 'ready', 'served' => 'served'][$destino];
            $upd = "UPDATE dining_order_items SET status = :item_status";
            if ($item_status === 'ready') {
                $upd .= ", ready_at = NOW()";
            } elseif ($item_status === 'served') {
                $upd .= ", served_at = NOW()";
            }
            $upd .= " WHERE comanda_id = :cid AND status <> 'cancelled'";
            $this->conn->prepare($upd)->execute([':item_status' => $item_status, ':cid' => (int)$comanda_id]);

            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }

        $this->avisar((int)$store_id, $comanda['station_id'] !== null ? (int)$comanda['station_id'] : null,
                      'comanda_' . $destino, (int)$comanda_id);

        // El mesero y el comensal ven avanzar su pedido platillo por platillo.
        if ($comanda['session_id'] !== null) {
            DiningSession::broadcast((int)$comanda['session_id'], 'comanda_' . $destino);
        }

        // Si la comanda es de MOSTRADOR, lo que hizo la cocina tiene que verse igual en la caja y
        // en la página del cliente: son la misma cosa vista desde dos lados.
        $this->sincronizarPedidoDeMostrador($comanda, $destino, (int)$store_id);

        return $this->obtener((int)$comanda_id, (int)$store_id);
    }

    /**
     * Anula la comanda completa con motivo.
     *
     * Un platillo ya enviado NO lo cancela el comensal: lo anula el personal y con motivo
     * escrito. Los ítems quedan 'cancelled' (no se borran) y la cuenta baja de importe.
     */
    public function anular($comanda_id, $store_id, $motivo, $user_id = null) {
        $comanda = $this->filaComanda((int)$comanda_id, (int)$store_id);
        if (!$comanda) {
            throw new Exception('La comanda no existe', 404);
        }
        if (in_array($comanda['status'], ['served', 'cancelled'], true)) {
            throw new Exception('Esa comanda ya se sirvió o ya estaba anulada', 409);
        }

        $motivo = trim((string)$motivo);
        if ($motivo === '') {
            throw new InvalidArgumentException('Falta el motivo de la anulación');
        }
        if (function_exists('mb_substr')) {
            $motivo = mb_substr($motivo, 0, 255);
        } else {
            $motivo = substr($motivo, 0, 255);
        }

        $this->conn->beginTransaction();
        try {
            $this->conn->prepare(
                "UPDATE comandas
                    SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = :motivo
                  WHERE comanda_id = :cid AND store_id = :store_id"
            )->execute([':motivo' => $motivo, ':cid' => (int)$comanda_id, ':store_id' => (int)$store_id]);

            $this->conn->prepare(
                "UPDATE dining_order_items
                    SET status = 'cancelled', cancel_reason = :motivo
                  WHERE comanda_id = :cid AND status <> 'cancelled'"
            )->execute([':motivo' => $motivo, ':cid' => (int)$comanda_id]);

            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }

        // La cuenta baja de importe: se recalcula con su propia suma.
        if ($comanda['session_id'] !== null) {
            $dining = new DiningSession($this->db);
            $dining->recalcTotals((int)$comanda['session_id']);
            DiningSession::broadcast((int)$comanda['session_id'], 'comanda_cancelled');
        }

        $this->avisar((int)$store_id, $comanda['station_id'] !== null ? (int)$comanda['station_id'] : null,
                      'comanda_cancelled', (int)$comanda_id);

        return $this->obtener((int)$comanda_id, (int)$store_id);
    }

    /**
     * Marca que la comanda salió por la impresora DEL NAVEGADOR.
     *
     * Se queda tal cual para el camino viejo (una terminal sin impresora de red,
     * con la cola apagada o con el ticket impreso desde la pantalla). El camino
     * nuevo NO pasa por aquí: `scripts/print-worker.php` incrementa `printed_count`
     * y pone `print_status='printed'` en el mismo UPDATE que cierra el job.
     *
     * Ojo con lo que este contador significa: es el rastro de una INTENCIÓN. El
     * navegador pide confirmación salvo que se abra en modo kiosco, así que un
     * `printed_count` que sube aquí solo dice "el mesero aceptó el diálogo".
     */
    public function marcarImpreso($comanda_id, $store_id) {
        $comanda = $this->filaComanda((int)$comanda_id, (int)$store_id);
        if (!$comanda) {
            throw new Exception('La comanda no existe', 404);
        }
        $this->conn->prepare(
            "UPDATE comandas SET printed_count = printed_count + 1
              WHERE comanda_id = :cid AND store_id = :store_id"
        )->execute([':cid' => (int)$comanda_id, ':store_id' => (int)$store_id]);

        return $this->obtener((int)$comanda_id, (int)$store_id);
    }

    /**
     * Reimprime la comanda: pone su trabajo de vuelta en la cola del servidor.
     *
     * Es lo que hace el botón "Reintentar" del tablero cuando la marca dice que el
     * ticket NO salió. No imprime nada por sí misma: deja el job `pending` y el
     * worker lo toma en su siguiente vuelta (idioma del proyecto: nadie escribe
     * bytes desde una petición HTTP del navegador).
     *
     * @return array ['jobs' => int, 'motivo' => string|null]
     */
    public function reimprimir($comanda_id, $store_id) {
        require_once __DIR__ . '/EscPos.class.php';
        require_once __DIR__ . '/PrintQueue.class.php';

        $comanda = $this->filaComanda((int)$comanda_id, (int)$store_id);
        if (!$comanda) {
            throw new Exception('La comanda no existe', 404);
        }

        $queue = new PrintQueue($this->db);
        $r = $queue->reimprimir($comanda_id, $store_id);

        // El aviso al tablero es para que las OTRAS terminales sepan que se reintentó.
        try {
            $this->avisar((int)$store_id, $comanda['station_id'] !== null ? (int)$comanda['station_id'] : null,
                          'comanda_reimpresion', (int)$comanda_id);
        } catch (Throwable $e) {
            // Best-effort: que no salga el aviso no invalida el reintento encolado.
        }

        return $r;
    }

    // =========================================================
    // Estaciones y sus salidas (modularidad)
    // =========================================================

    /**
     * Dónde se prepara.
     *
     * Un negocio sin preparación (tienda, barbería) no tiene ninguna estación, y eso es
     * un estado válido, no un hueco: la comanda vive en un solo montón y el tablero no
     * filtra. No se inventa una "Cocina" por defecto.
     *
     * @param bool $soloActivas
     */
    public function estaciones($store_id, $soloActivas = false) {
        $sql = "SELECT station_id, name, sort_order, is_active
                  FROM stations
                 WHERE store_id = :store_id";
        if ($soloActivas) {
            $sql .= " AND is_active = 1";
        }
        $sql .= " ORDER BY sort_order ASC, station_id ASC";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':store_id' => (int)$store_id]);
        $estaciones = $stmt->fetchAll(PDO::FETCH_ASSOC);
        if (!$estaciones) {
            return [];
        }

        $ids = array_map(function ($e) { return (int)$e['station_id']; }, $estaciones);
        $marcadores = implode(',', array_fill(0, count($ids), '?'));

        // Salidas: cómo sale cada comanda de esta estación (pantalla, impresora... o nada).
        // Las columnas se nombran una por una: añadir una a la tabla no rompe esta lectura.
        $stmt = $this->conn->prepare(
            "SELECT output_id, station_id, kind, transport, target, host, paper_width, `charset`, has_drawer, is_active
               FROM station_outputs
              WHERE station_id IN ($marcadores)
              ORDER BY output_id ASC"
        );
        $stmt->execute($ids);
        $salidas = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $s) {
            $salidas[(int)$s['station_id']][] = [
                'output_id'   => (int)$s['output_id'],
                'kind'        => $s['kind'],
                'transport'   => $s['transport'],
                'target'      => $s['target'],
                'host'        => $s['host'],
                'paper_width' => $s['paper_width'],
                'charset'     => $s['charset'],
                'has_drawer'  => (int)$s['has_drawer'] === 1,
                'is_active'   => (int)$s['is_active'] === 1,
            ];
        }

        // Cuántos productos están asignados a cada estación: es la pregunta que se hace
        // quien acaba de crear una ("¿ya le llegó algo?").
        $stmt = $this->conn->prepare(
            "SELECT station_id, COUNT(*) AS n
               FROM products
              WHERE store_id = ? AND status <> 'inactive' AND station_id IN ($marcadores)
              GROUP BY station_id"
        );
        $stmt->execute(array_merge([(int)$store_id], $ids));
        $conteo = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $c) {
            $conteo[(int)$c['station_id']] = (int)$c['n'];
        }

        $out = [];
        foreach ($estaciones as $e) {
            $sid = (int)$e['station_id'];
            $out[] = [
                'station_id'    => $sid,
                'name'          => $e['name'],
                'sort_order'    => (int)$e['sort_order'],
                'is_active'     => (int)$e['is_active'] === 1,
                'salidas'       => $salidas[$sid] ?? [],
                'productos'     => $conteo[$sid] ?? 0,
            ];
        }
        return $out;
    }

    /** Cuántos productos no se preparan en ningún lado (el montón general). */
    public function contarSinEstacion($store_id) {
        $stmt = $this->conn->prepare(
            "SELECT COUNT(*) FROM products
              WHERE store_id = :store_id AND station_id IS NULL AND status <> 'inactive'"
        );
        $stmt->execute([':store_id' => (int)$store_id]);
        return (int)$stmt->fetchColumn();
    }

    /**
     * Crea o edita una estación.
     *
     * `salidas` es opcional: se manda una lista [['kind'=>'screen'|'print','target'=>'...']]
     * y se reemplazan las que hubiera. "Sin salida" (lista vacía) es válido y no estorba.
     */
    public function guardarEstacion($store_id, array $data) {
        $store_id   = (int)$store_id;
        $station_id = (int)($data['station_id'] ?? 0);
        $nombre     = trim((string)($data['name'] ?? ''));
        $orden      = (int)($data['sort_order'] ?? 0);

        if ($nombre === '') {
            throw new InvalidArgumentException('Falta el nombre de la estación');
        }
        if (function_exists('mb_substr')) {
            $nombre = mb_substr($nombre, 0, 50);
        } else {
            $nombre = substr($nombre, 0, 50);
        }

        $this->conn->beginTransaction();
        try {
            if ($station_id > 0) {
                $stmt = $this->conn->prepare(
                    "UPDATE stations SET name = :nombre, sort_order = :orden
                      WHERE station_id = :sid AND store_id = :store_id"
                );
                $stmt->execute([':nombre' => $nombre, ':orden' => $orden, ':sid' => $station_id, ':store_id' => $store_id]);
                if ($stmt->rowCount() === 0 && !$this->estacionDeTienda($station_id, $store_id)) {
                    throw new Exception('Esa estación no es de esta tienda', 404);
                }
            } else {
                // Reactivación sin querer: si ya existe una con ese nombre (aunque esté
                // apagada), se reusa en vez de reventar contra la llave única.
                $stmt = $this->conn->prepare(
                    "SELECT station_id FROM stations WHERE store_id = :store_id AND name = :nombre LIMIT 1"
                );
                $stmt->execute([':store_id' => $store_id, ':nombre' => $nombre]);
                $existente = $stmt->fetchColumn();

                if ($existente) {
                    $station_id = (int)$existente;
                    $this->conn->prepare(
                        "UPDATE stations SET is_active = 1, sort_order = :orden WHERE station_id = :sid"
                    )->execute([':orden' => $orden, ':sid' => $station_id]);
                } else {
                    $this->conn->prepare(
                        "INSERT INTO stations (store_id, name, sort_order, is_active)
                         VALUES (:store_id, :nombre, :orden, 1)"
                    )->execute([':store_id' => $store_id, ':nombre' => $nombre, ':orden' => $orden]);
                    $station_id = (int)$this->conn->lastInsertId();
                }
            }

            if (isset($data['salidas']) && is_array($data['salidas'])) {
                $this->reemplazarSalidas($station_id, $data['salidas']);
            }

            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            if ($e instanceof PDOException && (string)$e->getCode() === '23000') {
                throw new Exception('Ya existe una estación con ese nombre', 409);
            }
            throw $e;
        }

        return ['station_id' => $station_id];
    }

    /** Enciende o apaga una estación. Apagarla NO borra su historia. */
    public function activarEstacion($station_id, $store_id, $activa) {
        $station_id = (int)$station_id;
        if (!$this->estacionDeTienda($station_id, (int)$store_id)) {
            throw new Exception('Esa estación no es de esta tienda', 404);
        }
        $this->conn->prepare(
            "UPDATE stations SET is_active = :activa WHERE station_id = :sid AND store_id = :store_id"
        )->execute([':activa' => $activa ? 1 : 0, ':sid' => $station_id, ':store_id' => (int)$store_id]);
        return ['station_id' => $station_id, 'is_active' => $activa ? 1 : 0];
    }

    /**
     * Borra una estación de verdad, solo si nunca se usó.
     *
     * Si ya tiene comandas encima, borrarla dejaría esas comandas sin saber dónde se
     * prepararon (la FK las pondría en NULL y se perdería el rastro). En ese caso se
     * apaga, no se borra.
     */
    public function borrarEstacion($station_id, $store_id) {
        $station_id = (int)$station_id;
        $store_id   = (int)$store_id;
        if (!$this->estacionDeTienda($station_id, $store_id)) {
            throw new Exception('Esa estación no es de esta tienda', 404);
        }

        $stmt = $this->conn->prepare("SELECT COUNT(*) FROM comandas WHERE station_id = :sid");
        $stmt->execute([':sid' => $station_id]);
        if ((int)$stmt->fetchColumn() > 0) {
            throw new Exception('Esa estación ya tiene comandas: se apaga, no se borra', 409);
        }

        $this->conn->beginTransaction();
        try {
            $this->conn->prepare("UPDATE products SET station_id = NULL WHERE station_id = :sid AND store_id = :store_id")
                     ->execute([':sid' => $station_id, ':store_id' => $store_id]);
            $this->conn->prepare("DELETE FROM stations WHERE station_id = :sid AND store_id = :store_id")
                     ->execute([':sid' => $station_id, ':store_id' => $store_id]);
            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }
        return ['station_id' => $station_id];
    }

    /**
     * Reemplaza las salidas de una estación (pantalla / impresora / ninguna).
     *
     * En una salida `print`, `host` es la RUTA (a dónde se conecta el worker) y
     * `target` es la etiqueta humana. El host se valida AQUÍ, en el borde y en el
     * momento en que alguien lo escribe: es el único punto donde un error se puede
     * explicar y corregir. Un host inválido no se guarda (422 con motivo), así que la
     * cola nunca se encuentra un destino prohibido que ella no pueda explicar. El
     * worker vuelve a validar antes de conectar de todos modos (defensa en fondo).
     */
    private function reemplazarSalidas($station_id, array $salidas) {
        require_once __DIR__ . '/EscPos.class.php';
        require_once __DIR__ . '/PrintQueue.class.php';

        $this->conn->prepare("DELETE FROM station_outputs WHERE station_id = :sid")
                 ->execute([':sid' => (int)$station_id]);

        foreach ($salidas as $s) {
            if (!is_array($s)) {
                continue;
            }
            $kind = (string)($s['kind'] ?? '');
            if (!in_array($kind, ['screen', 'print'], true)) {
                continue;
            }
            $target = trim((string)($s['target'] ?? ''));
            if ($target !== '' && function_exists('mb_substr')) {
                $target = mb_substr($target, 0, 120);
            }

            $host = null;
            $transport = 'none';
            $paper_width = '80';
            $charset = 'cp850';
            $has_drawer = 0;

            if ($kind === 'print') {
                $host = trim((string)($s['host'] ?? ''));
                if ($host !== '') {
                    $motivo = PrintQueue::motivoHostInvalido($host);
                    if ($motivo !== null) {
                        // 422 explícito: es un dato del formulario, no un fallo del
                        // servidor. El endpoint ya traduce el código a la respuesta.
                        throw new InvalidArgumentException('Impresora: ' . $motivo, 422);
                    }
                    $transport = 'net9100';
                } else {
                    $host = null;
                }
                $paper_width = ((string)($s['paper_width'] ?? '80') === '58') ? '58' : '80';
                // `charset` es palabra reservada en el SQL de MariaDB dentro de comillas
                // dobles, así que se lee del request como `charset` y se escribe entre
                // acentos graves.
                $charset = (strtolower((string)($s['charset'] ?? 'cp850')) === 'cp437') ? 'cp437' : 'cp850';
                $has_drawer = !empty($s['has_drawer']) ? 1 : 0;
            }

            $this->conn->prepare(
                "INSERT INTO station_outputs (station_id, kind, transport, target, host, paper_width, `charset`, has_drawer, is_active)
                 VALUES (:sid, :kind, :transport, :target, :host, :paper_width, :charset, :has_drawer, 1)"
            )->execute([
                ':sid'         => (int)$station_id,
                ':kind'        => $kind,
                ':transport'   => $transport,
                ':target'      => $target !== '' ? $target : null,
                ':host'        => $host,
                ':paper_width' => $paper_width,
                ':charset'     => $charset,
                ':has_drawer'  => $has_drawer,
            ]);
        }
    }

    /**
     * Asigna (o quita) productos a una estación.
     *
     * La estación vive en el PRODUCTO: se captura una vez y todas las comandas futuras
     * quedan repartidas sin volver a preguntarlo. `station_id = NULL` = sin preparación.
     */
    public function asignarProductos($store_id, $station_id, array $product_ids, array $quitar_ids = []) {
        $store_id   = (int)$store_id;
        $station_id = (int)$station_id;

        if ($station_id <= 0) {
            throw new InvalidArgumentException('Elige una estación');
        }
        if (!$this->estacionDeTienda($station_id, $store_id)) {
            throw new Exception('Esa estación no es de esta tienda', 404);
        }

        $asignados = 0;
        $quitados  = 0;

        $this->conn->beginTransaction();
        try {
            // Ids siempre acotados a la tienda: un id de otra tienda no existe aquí.
            $product_ids = array_values(array_unique(array_filter(array_map('intval', $product_ids))));
            if ($product_ids) {
                $marcadores = implode(',', array_fill(0, count($product_ids), '?'));
                $stmt = $this->conn->prepare(
                    "UPDATE products SET station_id = ?
                      WHERE store_id = ? AND product_id IN ($marcadores)"
                );
                $stmt->execute(array_merge([$station_id, $store_id], $product_ids));
                $asignados = $stmt->rowCount();
            }

            $quitar_ids = array_values(array_unique(array_filter(array_map('intval', $quitar_ids))));
            if ($quitar_ids) {
                $marcadores = implode(',', array_fill(0, count($quitar_ids), '?'));
                // Solo se sueltan los que están EN ESTA estación: quitar de una no toca otra.
                $stmt = $this->conn->prepare(
                    "UPDATE products SET station_id = NULL
                      WHERE store_id = ? AND station_id = ? AND product_id IN ($marcadores)"
                );
                $stmt->execute(array_merge([$store_id, $station_id], $quitar_ids));
                $quitados = $stmt->rowCount();
            }

            $this->conn->commit();
        } catch (Throwable $e) {
            if ($this->conn->inTransaction()) {
                $this->conn->rollBack();
            }
            throw $e;
        }

        return ['asignados' => $asignados, 'quitados' => $quitados];
    }

    /** Los productos que se preparan en una estación. */
    public function productosDeEstacion($store_id, $station_id) {
        $stmt = $this->conn->prepare(
            "SELECT product_id, product_name, price, category_id, station_id, image_path
               FROM products
              WHERE store_id = :store_id AND station_id = :sid AND status <> 'inactive'
              ORDER BY product_name ASC"
        );
        $stmt->execute([':store_id' => (int)$store_id, ':sid' => (int)$station_id]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // =========================================================
    // Aviso a las pantallas
    // =========================================================

    /**
     * Avisa que una comanda cambió.
     *
     * Va a DOS canales, cada uno con su razón:
     *  - canal de la TIENDA  -> la pantalla de comandas (y el mapa del salón) de cualquier
     *    dispositivo del personal.
     *  - canal de la ESTACIÓN -> la tableta que vive en esa cocina/barra, que solo quiere
     *    lo suyo.
     *
     * Es best-effort y silencioso (ver DiningSession::enviarAlRelay): que no salga el aviso
     * no puede tumbar la comanda que sí se creó.
     */
    public function avisar($store_id, $station_id, $evento, $comanda_id) {
        $payload = json_encode([
            'type'       => 'comanda_update',
            'event'      => (string)$evento,
            'comanda_id' => (int)$comanda_id,
            'station_id' => $station_id !== null ? (int)$station_id : null,
            'store_id'   => (int)$store_id,
        ], JSON_UNESCAPED_UNICODE);

        if ($payload === false) {
            return;
        }
        if ($store_id > 0) {
            DiningSession::enviarAlRelay(WsToken::canalTienda($store_id), $payload);
        }
        if ($store_id > 0 && $station_id !== null) {
            DiningSession::enviarAlRelay(WsToken::canalEstacion($store_id, $station_id), $payload);
        }
    }

    // =========================================================
    // Helpers internos
    // =========================================================

    /**
     * El día de NEGOCIO del folio.
     *
     * Se toma de PHP (que va en hora de México, configurada en config/database.php) y no de
     * `CURDATE()`: MariaDB corre en UTC, así que a partir de las 18:00 locales CURDATE() ya
     * es "mañana" y el folio del día se reiniciaría en plena cena. El resto de los tiempos
     * (minutos, sent_at) SÍ se calculan en la base, que es donde se comparan.
     */
    private function fechaDeNegocio() {
        $fecha = date('Y-m-d');
        return $fecha;
    }

    /**
     * Un instante UTC de la base, en la hora local del negocio y en formato de ticket.
     *
     * NO es un cálculo de tiempo (no hay ninguna resta): es cambiarle el reloj a un
     * valor absoluto para poder imprimirlo. La regla de "los tiempos se calculan en
     * SQL" sigue intacta donde importa —minutos, segundos, vencimientos—, porque ahí
     * sí se compara un valor contra otro.
     */
    private static function horaLocal($sent_at) {
        $sent_at = trim((string)$sent_at);
        if ($sent_at === '' || $sent_at === '0000-00-00 00:00:00') {
            return null;
        }
        try {
            $dt = new DateTime($sent_at, new DateTimeZone('UTC'));
            $dt->setTimezone(new DateTimeZone(date_default_timezone_get()));
            return $dt->format('H:i');
        } catch (Throwable $e) {
            // Una fecha rara no puede tumbar el tablero ni el ticket.
            return null;
        }
    }

    /** La fila cruda de una cuenta. */
    private function sesion($session_id) {
        $stmt = $this->conn->prepare("SELECT * FROM dining_sessions WHERE session_id = :sid LIMIT 1");
        $stmt->execute([':sid' => (int)$session_id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    /** ¿La estación existe en esa tienda y está encendida? */
    private function estacionViva($station_id, $store_id) {
        $stmt = $this->conn->prepare(
            "SELECT 1 FROM stations WHERE station_id = :sid AND store_id = :store_id AND is_active = 1 LIMIT 1"
        );
        $stmt->execute([':sid' => (int)$station_id, ':store_id' => (int)$store_id]);
        return (bool)$stmt->fetchColumn();
    }

    /** ¿La estación es de esa tienda? (aislamiento multi-tienda) */
    private function estacionDeTienda($station_id, $store_id) {
        $stmt = $this->conn->prepare(
            "SELECT 1 FROM stations WHERE station_id = :sid AND store_id = :store_id LIMIT 1"
        );
        $stmt->execute([':sid' => (int)$station_id, ':store_id' => (int)$store_id]);
        return (bool)$stmt->fetchColumn();
    }
}

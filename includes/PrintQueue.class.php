<?php
/**
 * Cola de impresión ESC/POS (TAB-22).
 *
 * QUÉ RESUELVE
 * Hasta esta función, la impresora de cocina era una sugerencia: el ticket salía
 * del NAVEGADOR (`window.print()`), `printed_count` subía solo si el mesero
 * aceptaba un diálogo, y si cocina nunca vio el ticket nadie se enteraba. Aquí el
 * servidor se hace cargo: la comanda encola el ticket YA renderizado y un worker
 * lo escribe por TCP en el puerto RAW de la impresora.
 *
 * DECISIONES QUE NO SON OBVIAS
 * - El payload se guarda renderizado (`payload`), no una descripción: el worker
 *   nunca reinterpreta el contenido. Un cambio de precio entre el `send` y la
 *   impresión no puede hacer salir un ticket distinto al que se mandó.
 * - La idempotencia vive en la llave única `(comanda_id, output_id)`: reintentar
 *   ACTUALIZA la fila, nunca crea un segundo ticket.
 * - Tiempo: `next_attempt_at`, `claimed_at` y `done_at` se escriben y comparan con
 *   NOW() de SQL. La app va en hora de México y MariaDB en UTC: un vencimiento
 *   calculado en PHP reintentaría a destiempo (ver AGENTS.md).
 * - SSRF: `host` es un campo de usuario que decide a dónde se conecta el servidor.
 *   Solo se acepta IPv4 de rango privado (y loopback únicamente con la excepción
 *   de banco `PRINT_ALLOW_LOOPBACK`). El puerto no es configurable: un campo de
 *   usuario que elige el puerto es la misma superficie.
 * - "Impresa" significa que los bytes salieron de la máquina. El 9100 no confirma
 *   impresión física: con la tapa abierta o sin papel el socket acepta y traga.
 */
class PrintQueue {

    /** Estados del job que el worker considera terminados. */
    const TERMINALES = ['done', 'failed'];

    /** @var Database */
    private $db;

    /** @var PDO */
    private $conn;

    public function __construct($db) {
        $this->db   = $db;
        $this->conn = $db->getConnection();
    }

    // =========================================================
    // Validación del destino (barrera SSRF)
    // =========================================================

    /**
     * Motivo por el que un `host` no sirve como destino de impresión, o null si sirve.
     *
     * Se llama en el BORDE (cuando alguien escribe el dato) para poder explicar el
     * error, y otra vez antes de conectar (defensa en fondo).
     *
     * @return string|null
     */
    public static function motivoHostInvalido($host) {
        $host = trim((string)$host);
        if ($host === '') {
            return 'falta la dirección de la impresora';
        }
        if (strpbrk($host, "/:@ \t") !== false) {
            // Con esquema, puerto o ruta deja de ser una IP y se vuelve una URL:
            // exactamente lo que no queremos que el servidor intente abrir.
            return 'usa solo la dirección IP, sin puerto, sin esquema y sin ruta (el puerto lo fija el servidor)';
        }
        if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
            return 'debe ser una dirección IPv4; los nombres de host no se resuelven desde aquí';
        }

        $permitir_loopback = defined('PRINT_ALLOW_LOOPBACK') && PRINT_ALLOW_LOOPBACK;
        if ($host === '127.0.0.1' || strpos($host, '127.') === 0) {
            return $permitir_loopback ? null : 'no se permite loopback como impresora';
        }
        if (self::esIpPrivada($host)) {
            return null;
        }
        return 'debe ser una IP de red local (10.x, 172.16-31.x o 192.168.x)';
    }

    /** ¿Es una IPv4 de rango privado (RFC1918)? */
    private static function esIpPrivada($ip) {
        $partes = explode('.', $ip);
        if (count($partes) !== 4) {
            return false;
        }
        $a = (int)$partes[0];
        $b = (int)$partes[1];
        if ($a === 10) {
            return true;
        }
        if ($a === 172 && $b >= 16 && $b <= 31) {
            return true;
        }
        if ($a === 192 && $b === 168) {
            return true;
        }
        return false;
    }

    // =========================================================
    // Encolar
    // =========================================================

    /** Salidas de impresión ACTIVAS y con ruta de una estación. */
    private function salidasImpresion($station_id) {
        $stmt = $this->conn->prepare(
            "SELECT output_id, station_id, kind, transport, target, host,
                    paper_width, `charset`, has_drawer
               FROM station_outputs
              WHERE station_id = :sid
                AND kind = 'print'
                AND is_active = 1
                AND host IS NOT NULL
                AND host <> ''
              ORDER BY output_id ASC"
        );
        $stmt->execute([':sid' => (int)$station_id]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * Encola el ticket de una comanda: una fila por salida de impresión.
     *
     * @param array $comanda Estructura de ComandaService::formatear()
     * @return array|null ['jobs' => int] o null si no hay a dónde imprimir
     */
    public function encolarComanda(array $comanda, $store_id) {
        $comanda_id = (int)($comanda['comanda_id'] ?? 0);
        $station_id = isset($comanda['station_id']) ? (int)$comanda['station_id'] : 0;
        if ($comanda_id <= 0 || $station_id <= 0) {
            return null;
        }

        $salidas = $this->salidasImpresion($station_id);
        if (!$salidas) {
            // Una estación sin salida de impresión es un estado válido (pantalla,
            // o ningún destino): no es un error y no se encola nada.
            return null;
        }

        $jobs = 0;
        foreach ($salidas as $salida) {
            // Defensa en fondo: un destino que ya no pasa la validación no se encola.
            if (self::motivoHostInvalido($salida['host']) !== null) {
                continue;
            }

            // Si el ticket de esta (comanda, salida) ya SALIÓ, un `send` repetido no
            // debe reimprimirlo: eso es lo que hace el botón "Reintentar", a mano.
            $previo = $this->jobDe($comanda_id, (int)$salida['output_id']);
            if ($previo && $previo['status'] === 'done') {
                continue;
            }

            $payload = EscPos::ticketComanda($comanda, $salida);
            $this->guardarJob($comanda_id, (int)$salida['output_id'], (int)$store_id, $payload);
            $jobs++;
        }

        if ($jobs > 0) {
            $this->conn->prepare(
                "UPDATE comandas
                    SET print_status = 'queued', print_last_error = NULL
                  WHERE comanda_id = :cid AND store_id = :store_id"
            )->execute([':cid' => $comanda_id, ':store_id' => (int)$store_id]);
        }

        return ['jobs' => $jobs];
    }

    /** Fila del job de una (comanda, salida), o null. */
    private function jobDe($comanda_id, $output_id) {
        $stmt = $this->conn->prepare(
            "SELECT job_id, status, attempts FROM print_jobs
              WHERE comanda_id = :cid AND output_id = :oid LIMIT 1"
        );
        $stmt->execute([':cid' => (int)$comanda_id, ':oid' => (int)$output_id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    /** Inserta el job, o lo devuelve a la cola si ya existía (idempotencia). */
    private function guardarJob($comanda_id, $output_id, $store_id, $payload) {
        // PARAM_LOB: el payload son BYTES binarios (cp850), no texto. Como string
        // normal, el driver los re-escapa según el charset de la conexión y los
        // bytes altos se corrompen (o el INSERT falla con "Incorrect string value").
        $stmt = $this->conn->prepare(
            "INSERT INTO print_jobs
                (store_id, comanda_id, output_id, kind, payload, status, attempts, next_attempt_at)
             VALUES (:store_id, :cid, :oid, 'comanda', :payload, 'pending', 0, NOW())
             ON DUPLICATE KEY UPDATE
                payload         = VALUES(payload),
                status          = 'pending',
                attempts        = 0,
                last_error      = NULL,
                next_attempt_at = NOW(),
                claimed_at      = NULL,
                claimed_by      = NULL,
                done_at         = NULL"
        );
        $stmt->bindValue(':store_id', (int)$store_id, PDO::PARAM_INT);
        $stmt->bindValue(':cid', (int)$comanda_id, PDO::PARAM_INT);
        $stmt->bindValue(':oid', (int)$output_id, PDO::PARAM_INT);
        $stmt->bindValue(':payload', $payload, PDO::PARAM_LOB);
        $stmt->execute();
    }

    /**
     * Reencola el ticket de una comanda (botón "Reintentar").
     *
     * No imprime nada: deja el trabajo `pending` y el worker lo toma en su
     * siguiente vuelta. Nadie escribe bytes desde una petición HTTP del navegador.
     *
     * @return array ['jobs' => int, 'motivo' => string|null]
     */
    public function reimprimir($comanda_id, $store_id) {
        $comanda_id = (int)$comanda_id;
        $store_id   = (int)$store_id;

        if (defined('PRINT_QUEUE_ENABLED') && !PRINT_QUEUE_ENABLED) {
            return ['jobs' => 0, 'motivo' => 'La impresión por el servidor está apagada'];
        }

        $comanda = $this->comandaParaTicket($comanda_id, $store_id);
        if (!$comanda) {
            return ['jobs' => 0, 'motivo' => 'La comanda no existe'];
        }

        $station_id = (int)($comanda['station_id'] ?? 0);
        $salidas = $station_id > 0 ? $this->salidasImpresion($station_id) : [];
        if (!$salidas) {
            return ['jobs' => 0, 'motivo' => 'Esta comanda no tiene una impresora configurada'];
        }

        // El payload ya está en la fila (se renderizó al encolar): un reintento lo
        // devuelve a la cola tal cual, sin volver a interpretar la comanda.
        $ids = array_map(function ($s) { return (int)$s['output_id']; }, $salidas);
        $marcadores = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->conn->prepare(
            "UPDATE print_jobs
                SET status = 'pending', attempts = 0, last_error = NULL,
                    next_attempt_at = NOW(), claimed_at = NULL, claimed_by = NULL
              WHERE comanda_id = ? AND output_id IN ($marcadores)"
        );
        $stmt->execute(array_merge([$comanda_id], $ids));
        $jobs = $stmt->rowCount();

        if ($jobs === 0) {
            // La comanda se mandó cuando la cola estaba apagada (o sin impresora):
            // no había fila. Se renderiza ahora y se encola.
            foreach ($salidas as $salida) {
                if (self::motivoHostInvalido($salida['host']) !== null) {
                    continue;
                }
                $this->guardarJob($comanda_id, (int)$salida['output_id'], $store_id,
                                  EscPos::ticketComanda($comanda, $salida));
                $jobs++;
            }
        }

        if ($jobs > 0) {
            $this->conn->prepare(
                "UPDATE comandas
                    SET print_status = 'queued', print_last_error = NULL, print_failed_at = NULL
                  WHERE comanda_id = :cid AND store_id = :store_id"
            )->execute([':cid' => $comanda_id, ':store_id' => $store_id]);
        }

        return ['jobs' => $jobs, 'motivo' => null];
    }

    /**
     * La comanda con lo que el ticket necesita, leída en el momento de reintentar.
     *
     * Es una consulta propia (no reusa ComandaService) para no crear una
     * dependencia circular: ComandaService ya depende de esta clase.
     */
    private function comandaParaTicket($comanda_id, $store_id) {
        $stmt = $this->conn->prepare(
            "SELECT c.comanda_id, c.station_id, c.number AS folio, c.notes, c.status,
                    c.print_status, c.print_attempts, c.print_last_error, c.print_failed_at,
                    c.sent_at, c.created_at,
                    st.name AS station_name,
                    s.code  AS session_code,
                    (SELECT GROUP_CONCAT(DISTINCT COALESCE(t.label, 'Sin punto') ORDER BY t.label SEPARATOR ' + ')
                       FROM dining_tables t
                      WHERE t.table_id = s.table_id
                         OR t.table_id IN (SELECT csp.table_id FROM check_service_points csp
                                            WHERE csp.session_id = s.session_id)) AS puntos,
                    (SELECT COUNT(DISTINCT dp.participant_id)
                       FROM dining_participants dp
                      WHERE dp.session_id = s.session_id AND dp.is_active = 1) AS personas_n
               FROM comandas c
               LEFT JOIN stations st ON st.station_id = c.station_id
               LEFT JOIN dining_sessions s ON s.session_id = c.session_id
              WHERE c.comanda_id = :cid AND c.store_id = :store_id
              LIMIT 1"
        );
        $stmt->execute([
            ':cid'        => (int)$comanda_id,
            ':store_id'   => (int)$store_id,
        ]);
        $fila = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$fila) {
            return null;
        }

        $items = $this->conn->prepare(
            "SELECT product_name, quantity, notes, status
               FROM dining_order_items
              WHERE comanda_id = :cid
              ORDER BY order_item_id ASC"
        );
        $items->execute([':cid' => (int)$comanda_id]);

        $fila['punto']      = $fila['puntos'] ?: null;
        $fila['code']       = $fila['session_code'];
        $fila['hora_local'] = self::horaLocal($fila['sent_at'] ?: ($fila['created_at'] ?? null));
        $fila['items']      = $items->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return $fila;
    }

    /**
     * Hora del ticket en el reloj del negocio.
     *
     * No es un cálculo de tiempo (no hay restas): es cambiarle el reloj a un valor
     * absoluto para imprimirlo, igual que hace ComandaService. Las diferencias
     * (minutos, vencimientos) siguen yendo en SQL.
     */
    private static function horaLocal($sent_at) {
        $sent_at = trim((string)$sent_at);
        if ($sent_at === '' || $sent_at === '0000-00-00 00:00:00') {
            return null;
        }
        try {
            $dt = new DateTime($sent_at, new DateTimeZone('UTC'));
            $dt->setTimezone(new DateTimeZone(date_default_timezone_get()));
            return $dt->format('d/m H:i');
        } catch (Throwable $e) {
            // Una fecha rara no puede tumbar el ticket.
            return null;
        }
    }

    // =========================================================
    // Worker: lease, reclamo y envío
    // =========================================================

    /**
     * Devuelve a la cola los jobs que quedaron en `sending` con el lease vencido
     * (worker muerto a media impresión).
     */
    public function liberarVencidos() {
        $lease = defined('PRINT_LEASE_SECONDS') ? (int)PRINT_LEASE_SECONDS : 90;
        $lease = max(10, $lease);
        // `INTERVAL ?` no es fiable en MariaDB con sentencias preparadas: el valor es
        // un entero de una constante (nunca input de usuario), así que se interpola
        // ya casteado.
        $stmt = $this->conn->prepare(
            "UPDATE print_jobs
                SET status = 'pending', claimed_at = NULL, claimed_by = NULL
              WHERE status = 'sending'
                AND claimed_at IS NOT NULL
                AND claimed_at < DATE_SUB(NOW(), INTERVAL " . $lease . " SECOND)"
        );
        $stmt->execute();
        return $stmt->rowCount();
    }

    /**
     * Reclama hasta `$limite` jobs pendientes y los marca `sending`.
     *
     * El reclamo es una transacción con FOR UPDATE: dos workers a la vez no se
     * llevan el mismo ticket (la alternativa —UPDATE ... LIMIT sin bloqueo— deja
     * que ambos lean la misma fila).
     *
     * @return array Lista de jobs reclamados (con payload)
     */
    public function reclamar($worker_id, $limite = 1) {
        $limite = max(1, min(20, (int)$limite));
        $reclamados = [];

        for ($i = 0; $i < $limite; $i++) {
            $this->conn->beginTransaction();
            try {
                $sel = $this->conn->prepare(
                    "SELECT job_id, store_id, comanda_id, output_id, payload, attempts
                       FROM print_jobs
                      WHERE status = 'pending' AND next_attempt_at <= NOW()
                      ORDER BY job_id ASC
                      LIMIT 1
                      FOR UPDATE"
                );
                $sel->execute();
                $job = $sel->fetch(PDO::FETCH_ASSOC);
                if (!$job) {
                    $this->conn->rollBack();
                    break;
                }

                $upd = $this->conn->prepare(
                    "UPDATE print_jobs
                        SET status = 'sending', claimed_at = NOW(), claimed_by = :who,
                            attempts = attempts + 1
                      WHERE job_id = :id"
                );
                $upd->execute([':who' => $worker_id, ':id' => (int)$job['job_id']]);
                $this->conn->commit();

                $job['attempts'] = (int)$job['attempts'] + 1;
                $reclamados[] = $job;
            } catch (Throwable $e) {
                if ($this->conn->inTransaction()) {
                    $this->conn->rollBack();
                }
                throw $e;
            }
        }
        return $reclamados;
    }

    /** La salida (destino) de un job. */
    private function salidaDe($output_id) {
        $stmt = $this->conn->prepare(
            "SELECT output_id, station_id, transport, target, host, paper_width, `charset`, has_drawer
               FROM station_outputs WHERE output_id = :oid LIMIT 1"
        );
        $stmt->execute([':oid' => (int)$output_id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    /**
     * Escribe los bytes en la impresora (RAW/JetDirect, puerto del servidor).
     *
     * @throws RuntimeException si no hay destino válido o si falla la conexión
     */
    public function enviar(array $job) {
        $salida = $job['output_id'] !== null ? $this->salidaDe($job['output_id']) : null;
        if (!$salida) {
            throw new RuntimeException('La salida de impresión ya no existe');
        }
        $motivo = self::motivoHostInvalido($salida['host']);
        if ($motivo !== null) {
            throw new RuntimeException('Destino inválido: ' . $motivo);
        }

        $puerto  = defined('PRINT_PORT') ? (int)PRINT_PORT : 9100;
        $timeout = defined('PRINT_CONNECT_TIMEOUT') ? (int)PRINT_CONNECT_TIMEOUT : 2;
        $timeout = max(1, $timeout);
        $destino = 'tcp://' . $salida['host'] . ':' . $puerto;

        $errno  = 0;
        $errstr = '';
        $sock = @stream_socket_client($destino, $errno, $errstr, $timeout);
        if ($sock === false) {
            throw new RuntimeException('No se pudo conectar a la impresora (' . $salida['host'] . '): ' . ($errstr !== '' ? $errstr : 'error ' . $errno));
        }

        stream_set_timeout($sock, $timeout);
        $datos = (string)$job['payload'];
        $total = strlen($datos);
        $escritos = 0;
        while ($escritos < $total) {
            $n = @fwrite($sock, substr($datos, $escritos));
            if ($n === false || $n === 0) {
                $meta = stream_get_meta_data($sock);
                fclose($sock);
                throw new RuntimeException('La impresora cortó la conexión al escribir ('
                    . $escritos . '/' . $total . ' bytes'
                    . (!empty($meta['timed_out']) ? ', timeout' : '') . ')');
            }
            $escritos += $n;
        }
        fclose($sock);
        return $escritos;
    }

    /** Job entregado: el ticket salió y el contador auditable sube a la vez. */
    public function marcarHecho(array $job) {
        $this->conn->prepare(
            "UPDATE print_jobs SET status = 'done', done_at = NOW(), last_error = NULL
              WHERE job_id = :id"
        )->execute([':id' => (int)$job['job_id']]);

        if ($job['comanda_id'] !== null) {
            // `printed_count` se incrementa en el MISMO UPDATE que el estado: así el
            // contador y la marca no pueden divergir.
            $this->conn->prepare(
                "UPDATE comandas
                    SET print_status = 'printed',
                        printed_count = printed_count + 1,
                        print_attempts = :attempts,
                        print_last_error = NULL,
                        print_failed_at = NULL
                  WHERE comanda_id = :cid"
            )->execute([':attempts' => (int)$job['attempts'], ':cid' => (int)$job['comanda_id']]);
        }
    }

    /**
     * Job fallido: se reintenta con backoff hasta agotar PRINT_MAX_ATTEMPTS.
     * Al agotarse queda `failed` con el motivo visible en el tablero.
     */
    public function marcarFallo(array $job, $error) {
        $attempts = (int)$job['attempts'];
        $max      = defined('PRINT_MAX_ATTEMPTS') ? (int)PRINT_MAX_ATTEMPTS : 4;
        // El motivo va a una columna VARCHAR(255): se recorta antes de guardarlo.
        $error = (string)$error;
        if (function_exists('mb_substr')) {
            $error = mb_substr($error, 0, 255);
        } else {
            $error = substr($error, 0, 255);
        }

        if ($attempts >= $max) {
            $this->conn->prepare(
                "UPDATE print_jobs SET status = 'failed', last_error = :err, claimed_at = NULL, claimed_by = NULL
                  WHERE job_id = :id"
            )->execute([':err' => $error, ':id' => (int)$job['job_id']]);

            if ($job['comanda_id'] !== null) {
                $this->conn->prepare(
                    "UPDATE comandas
                        SET print_status = 'failed', print_attempts = :attempts,
                            print_last_error = :err, print_failed_at = NOW()
                      WHERE comanda_id = :cid"
                )->execute([':attempts' => $attempts, ':err' => $error, ':cid' => (int)$job['comanda_id']]);
            }
            return 'failed';
        }

        $espera = $this->backoffSegundos($attempts);
        $this->conn->prepare(
            "UPDATE print_jobs
                SET status = 'pending', last_error = :err, claimed_at = NULL, claimed_by = NULL,
                    next_attempt_at = DATE_ADD(NOW(), INTERVAL " . (int)$espera . " SECOND)
              WHERE job_id = :id"
        )->execute([':err' => $error, ':id' => (int)$job['job_id']]);

        if ($job['comanda_id'] !== null) {
            $this->conn->prepare(
                "UPDATE comandas
                    SET print_status = 'queued', print_attempts = :attempts, print_last_error = :err
                  WHERE comanda_id = :cid"
            )->execute([':attempts' => $attempts, ':err' => $error, ':cid' => (int)$job['comanda_id']]);
        }
        return 'retry';
    }

    /** Backoff entre intentos (10/30/120 s por defecto); al agotar la lista repite el último. */
    private function backoffSegundos($attempts) {
        $crudo = defined('PRINT_BACKOFF_SECONDS') ? (string)PRINT_BACKOFF_SECONDS : '10,30,120';
        $lista = array_values(array_filter(array_map('intval', explode(',', $crudo)), function ($n) {
            return $n > 0;
        }));
        if (!$lista) {
            return 10;
        }
        $i = max(0, $attempts - 1);
        return $lista[min($i, count($lista) - 1)];
    }
}

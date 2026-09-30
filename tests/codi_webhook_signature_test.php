<?php
/**
 * Test de regresión de la FIRMA del webhook de CoDi (P0-1 / TAB-57).
 *
 * Qué fija (y por qué es un test, no una revisión a ojo):
 *   1. Firma HMAC-SHA256 correcta sobre el CUERPO CRUDO ⇒ procesa y marca el pago.
 *   2. Sin firma ⇒ 401 y CERO escrituras.
 *   3. Firma calculada sobre `json_encode(json_decode($body))` ⇒ 401 (no se
 *      re-serializa: el byte-string firmado es el que llegó).
 *   4. `webhook_secret` vacío ⇒ 401 aunque venga una firma (fail closed).
 *   5. `grep` del código: el camino de secreto vacío NO puede tener `return true`.
 *   6. CoDi deshabilitado ⇒ 403 y cero escrituras.
 *   7. Folio de otra tienda ⇒ 403 (coherencia de tienda) y cero escrituras.
 *   8. El byte-string es exacto: cambiar un solo carácter del cuerpo ⇒ 401.
 *   9. El encabezado se acepta en hex con prefijo `sha256=` y en mayúsculas.
 *
 * NO necesita base de datos ni Docker: usa un doble de `Database` en memoria
 * (`FakeDatabase`), así que corre con `php tests/codi_webhook_signature_test.php`.
 *
 * Uso: php tests/codi_webhook_signature_test.php
 */

require_once __DIR__ . '/../includes/RequestContext.class.php';
require_once __DIR__ . '/../includes/Database.class.php';
require_once __DIR__ . '/../codi/includes/CodiService.class.php';

/**
 * Doble de `Database`: sin conexión, con las respuestas sembradas y registro de
 * las escrituras que el servicio intentó hacer.
 */
class FakeDatabase extends Database
{
    /** @var array store_id => ['enabled' => int, 'webhook_secret' => string] */
    public $settings = [];

    /** @var array folio => ['payment_id' => int, 'store_id' => int, 'status' => string] */
    public $payments = [];

    /** @var array Escrituras recibidas: [['sql' => …, 'params' => […]], …] */
    public $writes = [];

    public function __construct() {} // sin conexión: este test no usa la BD real

    public function selectOne($sql, $params = [])
    {
        if (strpos($sql, 'FROM codi_settings') !== false) {
            $storeId = (int)($params[0] ?? 0);
            if (!isset($this->settings[$storeId])) {
                return null;
            }
            return $this->settings[$storeId];
        }

        if (strpos($sql, 'FROM codi_payments WHERE folio_codi') !== false) {
            $folio = (string)($params[0] ?? '');
            if (!isset($this->payments[$folio])) {
                return null;
            }
            $p = $this->payments[$folio];
            return [
                'payment_id' => $p['payment_id'],
                'store_id' => $p['store_id'],
                'status' => $p['status'],
            ];
        }

        if (strpos($sql, 'FROM codi_payments WHERE payment_id') !== false) {
            $paymentId = (int)($params[0] ?? 0);
            foreach ($this->payments as $folio => $p) {
                if ($p['payment_id'] === $paymentId) {
                    return ['payment_id' => $p['payment_id'], 'store_id' => $p['store_id'],
                            'status' => $p['status'], 'sale_id' => null, 'folio_codi' => $folio];
                }
            }
            return null;
        }

        if (strpos($sql, 'FROM codi_payment_events') !== false) {
            return null; // ningún provider_event_id visto
        }

        return null;
    }

    public function select($sql, $params = []) { return []; }

    public function insert($sql, $params = [])
    {
        $this->writes[] = ['sql' => $sql, 'params' => $params];
        return 1;
    }

    public function update($sql, $params = [])
    {
        $this->writes[] = ['sql' => $sql, 'params' => $params];

        // Aplicar el cambio de estado para poder asertarlo después.
        if (strpos($sql, 'UPDATE codi_payments SET status = ?') !== false) {
            $newStatus = (string)($params[0] ?? '');
            $paymentId = (int)end($params);
            foreach ($this->payments as $folio => $p) {
                if ($p['payment_id'] === $paymentId) {
                    $this->payments[$folio]['status'] = $newStatus;
                }
            }
        }
        return 1;
    }

    public function beginTransaction() { return true; }
    public function commit() { return true; }
    public function rollback() { return true; }
}

$PASS = 0;
$FAIL = 0;

function ok(string $what): void
{
    global $PASS;
    $PASS++;
    echo "PASS | $what\n";
}

function mal(string $what): void
{
    global $FAIL;
    $FAIL++;
    echo "FAIL | $what\n";
}

/**
 * Ejecuta `handleWebhook` esperando un rechazo; devuelve [excepción, escrituras].
 */
function reject(FakeDatabase $db, array $payload, string $signature, string $rawBody): array
{
    $before = count($db->writes);
    try {
        (new CodiService($db, (int)$payload['store_id']))
            ->handleWebhook($payload, $signature, $rawBody);
    } catch (Exception $e) {
        return [$e, array_slice($db->writes, $before)];
    }
    return [null, array_slice($db->writes, $before)];
}

function seed(): FakeDatabase
{
    $db = new FakeDatabase();
    $db->settings = [
        1 => ['enabled' => 1, 'webhook_secret' => 's3cr3t0-tienda-1'],
        2 => ['enabled' => 1, 'webhook_secret' => ''],          // secreto vacío
        3 => ['enabled' => 0, 'webhook_secret' => 's3cr3t0-tienda-3'], // CoDi apagado
    ];
    $db->payments = [
        'CODI-T1-OK' => ['payment_id' => 101, 'store_id' => 1, 'status' => 'pending'],
        'CODI-T1-EXACTO' => ['payment_id' => 102, 'store_id' => 1, 'status' => 'pending'],
        'CODI-T2-AJENO' => ['payment_id' => 201, 'store_id' => 2, 'status' => 'pending'],
        'CODI-T3-APAGADO' => ['payment_id' => 301, 'store_id' => 3, 'status' => 'pending'],
    ];
    return $db;
}

function sign(string $rawBody, string $secret): string
{
    return hash_hmac('sha256', $rawBody, $secret);
}

echo "===== Firma del webhook de CoDi (PAPERCLIP: TAB-57 / P0-1) =====\n";

// --- 1. Firma correcta sobre el cuerpo crudo ⇒ procesa -----------------------
$db = seed();
$raw = '{"store_id":1,"folio_codi":"CODI-T1-OK","event_type":"paid","event_id":"evt-1"}';
$payload = json_decode($raw, true);
$sig = sign($raw, $db->settings[1]['webhook_secret']);
try {
    $ret = (new CodiService($db, 1))->handleWebhook($payload, $sig, $raw);
    if ($ret === true && $db->payments['CODI-T1-OK']['status'] === 'paid') {
        ok("firma correcta sobre el cuerpo crudo → procesa y el pago queda 'paid'");
    } else {
        mal("firma correcta no procesó (ret=" . var_export($ret, true)
            . ", status=" . $db->payments['CODI-T1-OK']['status'] . ")");
    }
} catch (Exception $e) {
    mal('firma correcta rechazada: ' . get_class($e) . ': ' . $e->getMessage());
}

// --- 2. Sin firma ⇒ 401 y cero escrituras -----------------------------------
$db = seed();
list($e, $writes) = reject($db, $payload, '', $raw);
if ($e instanceof CodiWebhookException && $e->getHttpCode() === 401
    && $e->getMessage() === 'Firma de webhook inválida') {
    ok('sin firma → CodiWebhookException 401 «Firma de webhook inválida»');
} else {
    mal('sin firma: ' . ($e ? get_class($e) . ': ' . $e->getMessage() : 'NO lanzó excepción'));
}
if ($writes === [] && $db->payments['CODI-T1-OK']['status'] === 'pending') {
    ok('sin firma → CERO escrituras y el pago sigue en pending');
} else {
    mal('sin firma escribió algo: ' . json_encode($writes));
}

// --- 3. Firma sobre el re-serializado ⇒ 401 ---------------------------------
$db = seed();
$rawConEspacios = '{ "store_id": 1, "folio_codi": "CODI-T1-EXACTO", "event_type": "paid" }';
$reSerializado = json_encode(json_decode($rawConEspacios));
if ($reSerializado === $rawConEspacios) {
    mal('el fixture no distingue crudo de re-serializado (revisar el test)');
} else {
    $sigRe = sign($reSerializado, $db->settings[1]['webhook_secret']);
    list($e, $writes) = reject($db, json_decode($rawConEspacios, true), $sigRe, $rawConEspacios);
    if ($e instanceof CodiWebhookException && $e->getHttpCode() === 401 && $writes === []) {
        ok('firma sobre json_encode(json_decode($body)) → 401 sin escrituras');
    } else {
        mal('firma re-serializada aceptada: ' . ($e ? get_class($e) . ': ' . $e->getMessage() : 'procesó'));
    }
}

// --- 4. Secreto vacío ⇒ 401 aunque la firma esté presente -------------------
$db = seed();
$rawT2 = '{"store_id":2,"folio_codi":"CODI-T2-AJENO","event_type":"paid"}';
list($e, $writes) = reject($db, json_decode($rawT2, true), sign($rawT2, 'secreto-de-otro'), $rawT2);
if ($e instanceof CodiWebhookException && $e->getHttpCode() === 401 && $writes === []) {
    ok('webhook_secret vacío → 401 (fail closed) con firma presente');
} else {
    mal('secreto vacío: ' . ($e ? get_class($e) . ': ' . $e->getMessage() : 'procesó'));
}

// --- 5. El código no puede tener el atajo `return true` ---------------------
$src = file_get_contents(__DIR__ . '/../codi/includes/CodiService.class.php');
preg_match('/public function getWebhookSecret\(\).*?\n    \}/s', $src, $mSecret);
preg_match('/private function validateWebhookSignature\(.*?\n    \}/s', $src, $mFirma);
$cuerpo = ($mSecret[0] ?? '') . "\n" . ($mFirma[0] ?? '');
if ($cuerpo === "\n" || strlen($cuerpo) < 200) {
    mal('no se pudo leer getWebhookSecret/validateWebhookSignature del fuente');
} else {
    if (strpos($cuerpo, 'return true') === false) {
        ok('grep: getWebhookSecret + validateWebhookSignature no contienen «return true»');
    } else {
        mal('el camino de la firma contiene «return true» (fail open)');
    }
    if (strpos($cuerpo, "if (\$secret === '' || \$signature === '')") !== false
        && strpos($cuerpo, 'hash_equals') !== false
        && strpos($cuerpo, 'json_encode') === false) {
        ok('grep: fail closed sobre el crudo (hash_equals, sin json_encode)');
    } else {
        mal('la validación no es la esperada (¿re-serializa? ¿fail open?)');
    }
}

// --- 6. CoDi deshabilitado ⇒ 403 sin procesar -------------------------------
$db = seed();
$rawT3 = '{"store_id":3,"folio_codi":"CODI-T3-APAGADO","event_type":"paid"}';
$sigT3 = sign($rawT3, $db->settings[3]['webhook_secret']);
list($e, $writes) = reject($db, json_decode($rawT3, true), $sigT3, $rawT3);
if ($e instanceof CodiWebhookException && $e->getHttpCode() === 403
    && stripos($e->getMessage(), 'deshabilitado') !== false
    && $writes === [] && $db->payments['CODI-T3-APAGADO']['status'] === 'pending') {
    ok('CoDi deshabilitado → 403 y el pago NO cambia (aunque la firma sea válida)');
} else {
    mal('CoDi deshabilitado: ' . ($e ? get_class($e) . ': ' . $e->getMessage() : 'procesó'));
}

// --- 7. Folio de otra tienda ⇒ 403 (coherencia de tienda) -------------------
$db = seed();
$rawAjeno = '{"store_id":1,"folio_codi":"CODI-T2-AJENO","event_type":"paid"}';
$sigAjeno = sign($rawAjeno, $db->settings[1]['webhook_secret']); // firma legítima de la tienda 1
list($e, $writes) = reject($db, json_decode($rawAjeno, true), $sigAjeno, $rawAjeno);
if ($e instanceof CodiWebhookException && $e->getHttpCode() === 403
    && stripos($e->getMessage(), 'Tienda no coincide') !== false
    && $writes === [] && $db->payments['CODI-T2-AJENO']['status'] === 'pending') {
    ok('folio de otra tienda → 403 y el pago ajeno NO cambia');
} else {
    mal('folio ajeno: ' . ($e ? get_class($e) . ': ' . $e->getMessage() : 'procesó')
        . ' writes=' . json_encode($writes));
}

// --- 8. Un byte de diferencia ⇒ 401 (el byte-string es exacto) --------------
$db = seed();
$raw2 = '{"store_id":1,"folio_codi":"CODI-T1-EXACTO","event_type":"paid"} ';
$payload2 = json_decode($raw2, true);
$sigExacta = sign('{"store_id":1,"folio_codi":"CODI-T1-EXACTO","event_type":"paid"}', $db->settings[1]['webhook_secret']);
list($e, $writes) = reject($db, $payload2, $sigExacta, $raw2);
if ($e instanceof CodiWebhookException && $e->getHttpCode() === 401) {
    ok('cuerpo con un espacio extra de más → 401 (firma del byte-string exacto)');
} else {
    mal('un byte de diferencia no invalidó la firma');
}

// --- 9. Header tolerante: prefijo sha256= y mayúsculas ---------------------
$db = seed();
$raw9 = '{"store_id":1,"folio_codi":"CODI-T1-EXACTO","event_type":"paid"}';
$sig9 = 'sha256=' . strtoupper(sign($raw9, $db->settings[1]['webhook_secret']));
try {
    $ret = (new CodiService($db, 1))->handleWebhook(json_decode($raw9, true), $sig9, $raw9);
    if ($ret === true && $db->payments['CODI-T1-EXACTO']['status'] === 'paid') {
        ok('header «sha256=» + hex en mayúsculas → válido');
    } else {
        mal('header con prefijo/mayúsculas rechazado');
    }
} catch (Exception $e) {
    mal('header con prefijo/mayúsculas: ' . $e->getMessage());
}

echo "===== RESULTADO: $PASS en verde, $FAIL en rojo =====\n";
exit($FAIL > 0 ? 1 : 0);

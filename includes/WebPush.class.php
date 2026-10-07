<?php
/**
 * WebPush — notificaciones push reales (RFC 8291 / RFC 8188 aes128gcm + VAPID RFC 8292).
 *
 * POR QUÉ EXISTE
 * El envío que había en `api/push/send.php` era una MAQUETA: derivaba la clave con
 * `sha256(auth . clientPub)` en vez del ECDH que exige la norma, así que el navegador no podía
 * descifrar nada — la notificación "se enviaba" y nunca aparecía. Aquí está el camino conforme
 * a la norma, sin dependencias externas (solo `openssl`, que ya viene con PHP).
 *
 * Quién lo usa: el aviso al cliente de un pedido de mostrador cuando su orden está lista
 * (`CounterService`), y el push del personal (`api/push/send.php`).
 *
 * CONFIGURACIÓN (env, ver config/constants.php):
 *   VAPID_PUBLIC_KEY  = base64url de la clave pública P-256 sin comprimir (65 bytes, empieza en 0x04)
 *   VAPID_PRIVATE_KEY = base64url del PEM de la clave privada EC
 *   VAPID_SUBJECT     = mailto:... o https://...
 * Sin las llaves, `habilitado()` es false y quien llama decide qué hacer (no revienta).
 */
class WebPush {

    /** Límite prudente del payload (los servicios rechazan >4 KB con el cifrado). */
    const MAX_PAYLOAD = 3000;

    public static function habilitado() {
        return defined('VAPID_PUBLIC_KEY') && trim((string)VAPID_PUBLIC_KEY) !== ''
            && defined('VAPID_PRIVATE_KEY') && trim((string)VAPID_PRIVATE_KEY) !== '';
    }

    /** La clave pública que el navegador necesita para suscribirse (applicationServerKey). */
    public static function clavePublica() {
        return defined('VAPID_PUBLIC_KEY') ? trim((string)VAPID_PUBLIC_KEY) : '';
    }

    /**
     * Envía una notificación a UNA suscripción.
     *
     * @param array  $sub    ['endpoint'=>, 'p256dh'=>, 'auth'=>]
     * @param string $titulo
     * @param string $cuerpo
     * @param string $url    a dónde lleva al tocarla
     * @return array ['ok'=>bool, 'status'=>int, 'error'=>?string]
     */
    public static function enviar(array $sub, $titulo, $cuerpo, $url = '/') {
        if (!self::habilitado()) {
            return ['ok' => false, 'status' => 0, 'error' => 'VAPID no configurado'];
        }
        $endpoint = (string)($sub['endpoint'] ?? '');
        if ($endpoint === '' || empty($sub['p256dh']) || empty($sub['auth'])) {
            return ['ok' => false, 'status' => 0, 'error' => 'suscripción incompleta'];
        }

        $payload = json_encode([
            'title' => mb_substr((string)$titulo, 0, 120),
            'body'  => mb_substr((string)$cuerpo, 0, 300),
            'url'   => (string)$url,
        ], JSON_UNESCAPED_UNICODE);
        if ($payload === false || strlen($payload) > self::MAX_PAYLOAD) {
            return ['ok' => false, 'status' => 0, 'error' => 'payload inválido'];
        }

        $cuerpoCifrado = self::cifrar($payload, (string)$sub['p256dh'], (string)$sub['auth']);
        if ($cuerpoCifrado === null) {
            return ['ok' => false, 'status' => 0, 'error' => 'no se pudo cifrar'];
        }
        $auth = self::vapidAuthorization($endpoint);
        if ($auth === null) {
            return ['ok' => false, 'status' => 0, 'error' => 'no se pudo firmar VAPID'];
        }

        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $cuerpoCifrado,
            CURLOPT_HTTPHEADER => [
                'TTL: 2419200',
                'Content-Encoding: aes128gcm',
                'Content-Type: application/octet-stream',
                'Authorization: ' . $auth,
            ],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        $respuesta = curl_exec($ch);
        $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        $ok = $http >= 200 && $http < 300;
        return ['ok' => $ok, 'status' => $http, 'error' => $ok ? null : ($err ?: 'HTTP ' . $http)];
    }

    // =========================================================
    // Cifrado RFC 8291 / RFC 8188 (aes128gcm)
    // =========================================================

    /**
     * Cifra un payload para una suscripción (aes128gcm, RFC 8291/8188).
     * PÚBLICO para poder probarlo con un cliente simulado: ver tests/webpush_test.php.
     *
     * @return string|null body listo para POST (cabecera aes128gcm + registro cifrado)
     */
    public static function cifrar($texto, $p256dhB64, $authB64) {
        $clientePub = self::b64urlDecode($p256dhB64);
        $authSecreto = self::b64urlDecode($authB64);
        if ($clientePub === null || strlen($clientePub) !== 65 || $authSecreto === null || strlen($authSecreto) < 16) {
            return null;
        }

        // 1. Par efímero del servidor (P-256).
        $efimera = openssl_pkey_new([
            'curve_name'       => 'prime256v1',
            'private_key_type' => OPENSSL_KEYTYPE_EC,
        ]);
        if (!$efimera) {
            return null;
        }
        $det = openssl_pkey_get_details($efimera);
        if (!isset($det['ec']['x'], $det['ec']['y'])) {
            return null;
        }
        $srvPub = "\x04" . $det['ec']['x'] . $det['ec']['y'];   // 65 bytes sin comprimir

        // 2. Secreto compartido ECDH(efímera_privada, cliente_pública).
        $clienteRes = self::publicaDesdePunto($clientePub);
        if (!$clienteRes) {
            return null;
        }
        $secreto = openssl_pkey_derive($clienteRes, $efimera, 32);
        if ($secreto === false || strlen($secreto) !== 32) {
            return null;
        }

        // 3. Claves (RFC 8291 §3.3-3.4 + RFC 8188 §2.2).
        $salt = random_bytes(16);
        $info = "WebPush: info\x00" . $clientePub . $srvPub;
        $prk = hash_hkdf('sha256', $secreto, 32, $info, $authSecreto);
        $cek = hash_hkdf('sha256', $prk, 16, "Content-Encoding: aes128gcm\x00", $salt);
        $nonce = hash_hkdf('sha256', $prk, 12, "Content-Encoding: nonce\x00", $salt);

        // 4. Registro = texto || 0x02 (delimitador de padding) y AES-128-GCM.
        $registro = $texto . "\x02";
        $etiqueta = '';
        $cifrado = openssl_encrypt($registro, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $etiqueta, '', 16);
        if ($cifrado === false) {
            return null;
        }

        // 5. Cabecera: salt(16) | rs(4) | idlen(1) | keyid(pública del servidor).
        $rs = max(4096, strlen($registro) + 17);
        return $salt . pack('N', $rs) . chr(strlen($srvPub)) . $srvPub . $cifrado . $etiqueta;
    }

    /** Convierte un punto P-256 sin comprimir (65 bytes) en una clave pública usable por openssl. */
    private static function publicaDesdePunto($punto) {
        // Prefijo DER fijo de SubjectPublicKeyInfo para id-ecPublicKey + prime256v1.
        $prefijo = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200');
        $der = $prefijo . $punto;
        $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
        $res = @openssl_pkey_get_public($pem);
        return $res ?: null;
    }

    // =========================================================
    // VAPID (RFC 8292)
    // =========================================================

    /** @return string|null "vapid t=<jwt>, k=<pública>" */
    private static function vapidAuthorization($endpoint) {
        $u = parse_url($endpoint);
        if (empty($u['scheme']) || empty($u['host'])) {
            return null;
        }
        $aud = $u['scheme'] . '://' . $u['host'];
        $sub = (defined('VAPID_SUBJECT') && trim((string)VAPID_SUBJECT) !== '')
            ? trim((string)VAPID_SUBJECT) : 'mailto:admin@tomodachi.local';

        $cabecera = self::b64url(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
        $cuerpo = self::b64url(json_encode(['aud' => $aud, 'exp' => time() + 43200, 'sub' => $sub]));
        if ($cabecera === null || $cuerpo === null) {
            return null;
        }

        $pem = self::b64urlDecode((string)VAPID_PRIVATE_KEY);
        if ($pem === null) {
            return null;
        }
        $llave = @openssl_pkey_get_private($pem);
        if (!$llave) {
            return null;
        }
        $der = '';
        if (!openssl_sign($cabecera . '.' . $cuerpo, $der, $llave, OPENSSL_ALGO_SHA256)) {
            return null;
        }
        $firma = self::firmaDerARaw($der);
        if ($firma === null) {
            return null;
        }
        $jwt = $cabecera . '.' . $cuerpo . '.' . self::b64url($firma);
        return 'vapid t=' . $jwt . ', k=' . self::clavePublica();
    }

    /** Firma ECDSA DER -> R||S de 64 bytes (lo que exige JWS ES256). */
    private static function firmaDerARaw($der) {
        if (!is_string($der) || strlen($der) < 8 || ord($der[0]) !== 0x30) {
            return null;
        }
        $off = 1;
        $len = ord($der[$off++]);
        if ($len & 0x80) {
            $n = $len & 0x7f;
            $len = 0;
            for ($i = 0; $i < $n; $i++) {
                $len = ($len << 8) | ord($der[$off++]);
            }
        }
        if (ord($der[$off++]) !== 0x02) return null;
        $rlen = ord($der[$off++]);
        $r = ltrim(substr($der, $off, $rlen), "\x00");
        $off += $rlen;
        if (ord($der[$off++]) !== 0x02) return null;
        $slen = ord($der[$off++]);
        $s = ltrim(substr($der, $off, $slen), "\x00");
        if (strlen($r) > 32 || strlen($s) > 32) return null;
        return str_pad($r, 32, "\x00", STR_PAD_LEFT) . str_pad($s, 32, "\x00", STR_PAD_LEFT);
    }

    // =========================================================
    // Utilidades base64url
    // =========================================================
    public static function b64url($datos) {
        return rtrim(strtr(base64_encode((string)$datos), '+/', '-_'), '=');
    }

    public static function b64urlDecode($texto) {
        $t = strtr(trim((string)$texto), '-_', '+/');
        $resto = strlen($t) % 4;
        if ($resto) {
            $t .= str_repeat('=', 4 - $resto);
        }
        $bin = base64_decode($t, true);
        return $bin === false ? null : $bin;
    }

    /**
     * Genera un par VAPID nuevo (para configurarlo en el entorno).
     * @return array ['public'=>base64url(65 bytes), 'private'=>base64url(PEM)]
     */
    public static function generarVapid() {
        $llave = openssl_pkey_new([
            'curve_name'       => 'prime256v1',
            'private_key_type' => OPENSSL_KEYTYPE_EC,
        ]);
        if (!$llave) {
            return null;
        }
        $det = openssl_pkey_get_details($llave);
        $pub = "\x04" . $det['ec']['x'] . $det['ec']['y'];
        $pem = '';
        openssl_pkey_export($llave, $pem);
        return ['public' => self::b64url($pub), 'private' => self::b64url($pem)];
    }
}

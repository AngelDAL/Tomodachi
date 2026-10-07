<?php
/**
 * Prueba del cifrado Web Push (RFC 8291 / 8188) y de la firma VAPID (RFC 8292).
 *
 * Qué hace: simula un NAVEGADOR (genera su par de llaves y su secreto auth), pide a
 * `WebPush::cifrar()` el cuerpo, y lo DESCIFRA como lo haría el navegador. Si el texto
 * vuelve intacto, el cifrado es correcto. También verifica la firma ES256 del JWT VAPID.
 *
 * No necesita red ni un servicio de push real: es la parte que de verdad puede fallar.
 *
 * Uso: php tests/webpush_test.php
 */
require_once __DIR__ . '/../includes/WebPush.class.php';

$pass = 0; $fail = 0;
function ok($t)  { global $pass; echo "PASS | $t\n"; $pass++; }
function mal($t) { global $fail; echo "FAIL | $t\n"; $fail++; }

function b64url($d) { return rtrim(strtr(base64_encode($d), '+/', '-_'), '='); }
function b64urlDec($t) {
    $t = strtr($t, '-_', '+/');
    $t .= str_repeat('=', (4 - strlen($t) % 4) % 4);
    return base64_decode($t, true);
}

// ---- VAPID: generar un par y dejarlo en las constantes que usa la clase -------------
$vapid = WebPush::generarVapid();
if ($vapid && !empty($vapid['public']) && !empty($vapid['private'])) {
    ok('genera un par VAPID');
} else {
    mal('generar VAPID');
    echo "===== RESULTADO: $pass pasaron, $fail fallaron =====\n";
    exit(1);
}
define('VAPID_PUBLIC_KEY', $vapid['public']);
define('VAPID_PRIVATE_KEY', $vapid['private']);
define('VAPID_SUBJECT', 'mailto:prueba@tomodachi.local');

$pubBin = WebPush::b64urlDecode(VAPID_PUBLIC_KEY);
if ($pubBin !== null && strlen($pubBin) === 65 && $pubBin[0] === "\x04") {
    ok('la clave pública VAPID es un punto P-256 sin comprimir (65 bytes)');
} else {
    mal('forma de la clave pública VAPID');
}

// ---- Cliente simulado (el "navegador") ---------------------------------------------
$cliente = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
$detCli = openssl_pkey_get_details($cliente);
$clientePub = "\x04" . $detCli['ec']['x'] . $detCli['ec']['y'];
$authSecreto = random_bytes(16);
$p256dh = b64url($clientePub);
$authB64 = b64url($authSecreto);

// ---- Cifrar como el servidor --------------------------------------------------------
$texto = json_encode(['title' => 'Tu pedido está listo', 'body' => 'Pasa a recogerlo', 'url' => '/public/seguimiento.html?t=x']);
$cuerpo = WebPush::cifrar($texto, $p256dh, $authB64);
if (!is_string($cuerpo) || strlen($cuerpo) < 100) {
    mal('cifrar el payload');
    echo "===== RESULTADO: $pass pasaron, $fail fallaron =====\n";
    exit(1);
}
ok('cifra el payload');

// ---- Descifrar como el navegador ----------------------------------------------------
$salt  = substr($cuerpo, 0, 16);
$rs    = unpack('N', substr($cuerpo, 16, 4))[1];
$idlen = ord($cuerpo[20]);
$srvPub = substr($cuerpo, 21, $idlen);
$registroCifrado = substr($cuerpo, 21 + $idlen);

if ($idlen === 65 && $srvPub[0] === "\x04") {
    ok('la cabecera aes128gcm trae la clave pública efímera del servidor');
} else {
    mal('cabecera aes128gcm (idlen=' . $idlen . ')');
}
if ($rs >= 4096) { ok('el tamaño de registro (rs) es válido'); } else { mal('rs=' . $rs); }

// ECDH del lado del cliente: clave privada del cliente con la pública efímera del servidor.
$prefijo = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200');
$srvPem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($prefijo . $srvPub), 64, "\n") . "-----END PUBLIC KEY-----\n";
$srvRes = openssl_pkey_get_public($srvPem);
$secreto = $srvRes ? openssl_pkey_derive($srvRes, $cliente, 32) : false;

if ($secreto !== false && strlen($secreto) === 32) {
    ok('el cliente deriva el mismo secreto ECDH');
} else {
    mal('ECDH del cliente');
    echo "===== RESULTADO: $pass pasaron, $fail fallaron =====\n";
    exit(1);
}

$info = "WebPush: info\x00" . $clientePub . $srvPub;
$prk = hash_hkdf('sha256', $secreto, 32, $info, $authSecreto);
$cek = hash_hkdf('sha256', $prk, 16, "Content-Encoding: aes128gcm\x00", $salt);
$nonce = hash_hkdf('sha256', $prk, 12, "Content-Encoding: nonce\x00", $salt);

$etiqueta = substr($registroCifrado, -16);
$cifrado = substr($registroCifrado, 0, -16);
$claro = openssl_decrypt($cifrado, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $etiqueta);
if ($claro === false) {
    mal('el cliente descifra (¿claves derivadas mal?)');
} else {
    ok('el cliente descifra el payload');
    // Se quita el delimitador de padding (0x02 y ceros posteriores).
    $plano = rtrim($claro, "\x00");
    $plano = rtrim($plano, "\x02");
    if ($plano === $texto) {
        ok('el texto descifrado es IDÉNTICO al original');
    } else {
        mal('texto distinto: ' . substr($plano, 0, 80));
    }
}

// ---- VAPID: estructura y firma ES256 del JWT ---------------------------------------
if (preg_match('/^vapid t=([^,]+), k=(.+)$/', (function () {
        $r = new ReflectionMethod('WebPush', 'vapidAuthorization');
        $r->setAccessible(true);
        return $r->invoke(null, 'https://fcm.googleapis.com/fcm/send/abc123');
    })(), $m)) {
    $jwt = $m[1];
    $partes = explode('.', $jwt);
    if (count($partes) === 3) {
        ok('el JWT VAPID tiene tres partes');
        $firmaRaw = b64urlDec($partes[2]);
        if ($firmaRaw !== null && strlen($firmaRaw) === 64) {
            ok('la firma es R||S de 64 bytes (ES256)');
        } else {
            mal('tamaño de la firma: ' . strlen((string)$firmaRaw));
        }
        // Convertir R||S a DER y verificar con la pública VAPID.
        $r = substr($firmaRaw, 0, 32); $s = substr($firmaRaw, 32, 32);
        // INTEGER DER mínimo: quitar ceros a la izquierda y añadir UN byte de signo si el
        // bit alto está puesto (lo contrario de `firmaDerARaw`, que va del DER al raw).
        $rInt = ltrim($r, "\x00"); if ($rInt === '') $rInt = "\x00";
        if (ord($rInt[0]) & 0x80) $rInt = "\x00" . $rInt;
        $sInt = ltrim($s, "\x00"); if ($sInt === '') $sInt = "\x00";
        if (ord($sInt[0]) & 0x80) $sInt = "\x00" . $sInt;
        $der = "\x30" . chr(strlen($rInt) + strlen($sInt) + 4)
             . "\x02" . chr(strlen($rInt)) . $rInt
             . "\x02" . chr(strlen($sInt)) . $sInt;
        $pubPem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($prefijo . $pubBin), 64, "\n") . "-----END PUBLIC KEY-----\n";
        $verif = openssl_verify($partes[0] . '.' . $partes[1], $der, openssl_pkey_get_public($pubPem), OPENSSL_ALGO_SHA256);
        if ($verif === 1) {
            ok('la firma VAPID verifica con la clave pública');
        } else {
            mal('la firma VAPID NO verifica');
        }
        $payload = json_decode(b64urlDec($partes[1]), true);
        if (!empty($payload['aud']) && $payload['aud'] === 'https://fcm.googleapis.com') {
            ok('el "aud" del JWT es el origen del endpoint');
        } else {
            mal('aud incorrecto: ' . json_encode($payload));
        }
    } else {
        mal('el JWT no tiene tres partes');
    }
} else {
    mal('no se pudo armar la cabecera VAPID');
}

echo "===== RESULTADO: $pass pasaron, $fail fallaron =====\n";
exit($fail === 0 ? 0 : 1);

<?php
/**
 * Verificación del ENVÍO real (no solo del cifrado): se hace pasar por el navegador,
 * llama a WebPush::enviar() contra un servidor local, y descifra lo que llegó.
 *
 * Comprueba: cabecera VAPID, Content-Encoding, TTL, y que el cuerpo se pueda descifrar
 * con la clave privada del "navegador" y devuelva el texto original.
 *
 * Uso:  python3 tests/push_fake_server.py 18998 &
 *       VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… php tests/webpush_envio_test.php
 */
require_once __DIR__ . '/../includes/WebPush.class.php';

// Las claves VAPID vienen del entorno (como en la app real).
if (!defined('VAPID_PUBLIC_KEY'))  define('VAPID_PUBLIC_KEY', getenv('VAPID_PUBLIC_KEY') ?: '');
if (!defined('VAPID_PRIVATE_KEY')) define('VAPID_PRIVATE_KEY', getenv('VAPID_PRIVATE_KEY') ?: '');
if (!defined('VAPID_SUBJECT'))     define('VAPID_SUBJECT', getenv('VAPID_SUBJECT') ?: 'mailto:admin@tomodachi.local');

$puerto = 18998;
$PASS = 0; $FAIL = 0;
function ok($t)  { global $PASS; echo "PASS | $t\n"; $PASS++; }
function mal($t) { global $FAIL; echo "FAIL | $t\n"; $FAIL++; }

// --- 1. "Navegador": su par de llaves y su secreto auth ---
$cli = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
$det = openssl_pkey_get_details($cli);
$cliPub = "\x04" . $det['ec']['x'] . $det['ec']['y'];
$auth   = random_bytes(16);
$p256dhB64 = WebPush::b64url($cliPub);
$authB64   = WebPush::b64url($auth);

// --- 2. Enviar como lo haría el servidor ---
$sub = ['endpoint' => "http://127.0.0.1:$puerto/push/abc123", 'p256dh' => $p256dhB64, 'auth' => $authB64];
$texto = 'Tu pedido #7 está listo';
$icono = 'https://pos.ejemplo.com/public/assets/app-icons/tomodachi-icon-192.png';
$res = WebPush::enviar($sub, 'Título de prueba', $texto, 'http://ejemplo/seguimiento.html?t=x', $icono);
if (!empty($res['ok'])) { ok("enviar() reporta éxito (HTTP {$res['status']})"); } else { mal('enviar() falló: ' . json_encode($res)); }

usleep(300000);
$cap = json_decode(@file_get_contents('/tmp/pushreq.json'), true);
if (!is_array($cap)) { mal('el servidor de prueba no recibió nada'); echo "RESULTADO: $PASS pasaron, $FAIL fallaron\n"; exit(1); }

// --- 3. Cabeceras que exige el servicio de push ---
$h = $cap['headers'];
if (isset($h['authorization']) && str_starts_with($h['authorization'], 'vapid t=')) { ok('manda la cabecera VAPID (vapid t=…, k=…)'); } else { mal('sin cabecera VAPID: ' . ($h['authorization'] ?? '(ninguna)')); }
if (($h['content-encoding'] ?? '') === 'aes128gcm') { ok('declara Content-Encoding: aes128gcm'); } else { mal('Content-Encoding incorrecto: ' . ($h['content-encoding'] ?? '(ninguno)')); }
if (!empty($h['ttl'])) { ok('manda TTL (' . $h['ttl'] . ')'); } else { mal('sin TTL'); }
if (isset($h['authorization'], $h['authorization']) && preg_match('/k=([A-Za-z0-9_\-]+)/', $h['authorization'], $m) && $m[1] === VAPID_PUBLIC_KEY) { ok('la llave pública de la cabecera es la VAPID'); } else { mal('k= no coincide con la llave pública'); }

// --- 4. Cuerpo descifrable por el navegador ---
$cuerpo = base64_decode($cap['body_b64']);
if (strlen($cuerpo) < 16 + 4 + 1 + 65) { mal('cuerpo demasiado corto'); echo "RESULTADO: $PASS pasaron, $FAIL fallaron\n"; exit(1); }
$salt = substr($cuerpo, 0, 16);
$rs   = unpack('N', substr($cuerpo, 16, 4))[1];
$idl  = ord($cuerpo[20]);
$srvPub = substr($cuerpo, 21, $idl);
$reg  = substr($cuerpo, 21 + $idl);

// ECDH desde el lado del cliente
$prefijo = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200');
$srvPem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($prefijo . $srvPub), 64, "\n") . "-----END PUBLIC KEY-----\n";
$srvRes = openssl_pkey_get_public($srvPem);
$secreto = openssl_pkey_derive($srvRes, $cli, 32);
$prk = hash_hkdf('sha256', $secreto, 32, "WebPush: info\x00" . $cliPub . $srvPub, $auth);
$cek = hash_hkdf('sha256', $prk, 16, "Content-Encoding: aes128gcm\x00", $salt);
$nonce = hash_hkdf('sha256', $prk, 12, "Content-Encoding: nonce\x00", $salt);
$tag = substr($reg, -16);
$ct  = substr($reg, 0, -16);
$claro = openssl_decrypt($ct, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
if ($claro === false) { mal('el navegador NO pudo descifrar el cuerpo'); }
else {
    $claro = rtrim($claro, "\x00");
    $claro = preg_replace('/\x02$/', '', $claro);
    $j = json_decode($claro, true);
    if (is_array($j) && ($j['title'] ?? '') === 'Título de prueba' && ($j['body'] ?? '') === $texto) {
        ok('el navegador descifra el aviso completo (título, cuerpo y url)');
    } else {
        mal('descifró pero el contenido no cuadra: ' . substr((string)$claro, 0, 120));
    }
    // El icono es lo que hacía falta para que la notificación no salga como cuadro roto.
    if (is_array($j) && ($j['icon'] ?? '') === $icono) {
        ok('el aviso lleva su icono (logo del negocio o el de Tomodachi)');
    } else {
        mal('el aviso NO llevó el icono: ' . json_encode($j['icon'] ?? null));
    }
}
if ($rs >= strlen($reg) + 16) { ok("el tamaño de registro declarado ($rs) es válido"); } else { mal("rs inválido: $rs"); }

echo "RESULTADO: $PASS pasaron, $FAIL fallaron\n";
exit($FAIL === 0 ? 0 : 1);

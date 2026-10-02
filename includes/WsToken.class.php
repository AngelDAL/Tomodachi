<?php
/**
 * Firma de tokens para suscribirse al relay de WebSocket y para leer el carrito en curso.
 *
 * POR QUÉ
 * El relay repartía mensajes a quien pidiera un canal, y el canal de una cuenta es su
 * `session_id`: un entero corto. Cualquiera que adivinara un número podía escuchar el pedido
 * de una mesa ajena. Ahora los canales de cuenta y de tienda exigen un token firmado con
 * `WS_SECRET` (el mismo valor que recibe el contenedor del WebSocket).
 *
 * Formato: token = HMAC-SHA256(secreto, "<canal>|<expiración>") en hex.
 * El relay valida firma y vigencia antes del handshake.
 *
 * CARRITO (TAB-25-X3): leer el carrito en curso (`api/sales/cart_sync.php` GET,
 * `api/sales/cart_sse.php`) tampoco acepta ya la UUID como credencial: exige sesión de
 * navegador O un token del canal `cart:<uuid>` firmado aquí. Ese token lo emite el POST
 * autenticado del punto de venta (el único que exige sesión, así que sólo lo tiene la tienda
 * dueña del carrito) y viaja al display en la URL (`&exp=&token=`). Sin `WS_SECRET` no hay
 * lectura por token (fail closed): el display del MISMO navegador sigue funcionando porque
 * lleva la sesión, el de otro dispositivo no.
 *
 * El UUID del carrito del display de cliente queda sin token a propósito en el RELAY de
 * WebSocket: ahí la UUID es sólo el nombre del canal y es aleatoria de 128 bits, no se puede
 * adivinar.
 *
 * Si `WS_SECRET` no está configurado, `firmar()` devuelve null y quien llame decide: sin
 * secreto no se finge un token (el relay lo rechazaría igual, y fallar cerrado es correcto).
 */
class WsToken {

    /** Segundos de vigencia por defecto de un token de suscripción. */
    const VIGENCIA = 3600;

    /**
     * Vigencia del token de lectura del carrito: una jornada de trabajo. El display de otro
     * dispositivo recibe la URL UNA vez y no la vuelve a pedir, así que una vigencia corta
     * apagaría la pantalla a media jornada; 12 h acotan el daño de una URL filtrada sin
     * obligar a re-enlazar la tablet en cada turno.
     */
    const VIGENCIA_CARRITO = 43200;

    public static function secreto() {
        return trim((string)(getenv('WS_SECRET') ?: ''));
    }

    /**
     * Firma un canal. Devuelve ['canal','token','exp'] o null si no hay secreto.
     */
    public static function firmar($canal, $vigencia = self::VIGENCIA) {
        $secreto = self::secreto();
        if ($secreto === '') {
            return null;
        }
        $canal = (string)$canal;
        $exp = time() + max(60, (int)$vigencia);
        return [
            'canal' => $canal,
            'token' => hash_hmac('sha256', $canal . '|' . $exp, $secreto),
            'exp'   => $exp,
        ];
    }

    /** Canal de las pantallas del personal. */
    public static function canalTienda($store_id) {
        return 'store:' . (int)$store_id;
    }

    /** Canal de una estación de preparación (pantalla de cocina/barra). */
    public static function canalEstacion($store_id, $station_id) {
        return 'store:' . (int)$store_id . ':station:' . (int)$station_id;
    }

    /**
     * Canal de LECTURA del carrito en curso. La UUID ya no es credencial por sí sola: este
     * canal es lo que se firma para que el display pueda leer el carrito sin sesión.
     */
    public static function canalCarrito($uuid) {
        return 'cart:' . (string)$uuid;
    }

    /**
     * Firma el canal de un carrito. Devuelve ['canal','token','exp'] o null si no hay
     * secreto (fail closed, igual que `firmar()`).
     */
    public static function firmarCarrito($uuid, $vigencia = self::VIGENCIA_CARRITO) {
        return self::firmar(self::canalCarrito($uuid), $vigencia);
    }

    /**
     * Valida un token contra su canal: firma exacta (comparación en tiempo constante) y
     * vigencia. Falla cerrado: sin secreto, sin token, con token malformado o con `exp`
     * vencido devuelve false. `$exp` lo manda el cliente, por eso forma parte de la firma:
     * no se puede estirar la vigencia sin secreto.
     */
    public static function validar($canal, $token, $exp) {
        $secreto = self::secreto();
        if ($secreto === '') {
            return false;
        }
        $token = is_string($token) ? strtolower(trim($token)) : '';
        if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
            return false;
        }
        if (!is_numeric($exp) || (int)$exp < time()) {
            return false;
        }
        $esperado = hash_hmac('sha256', (string)$canal . '|' . (int)$exp, $secreto);
        return hash_equals($esperado, $token);
    }

    /**
     * URL del relay lista para conectar (la usa el propio servidor para avisar).
     * Devuelve null si no se puede firmar.
     */
    public static function urlRelay($canal, $vigencia = self::VIGENCIA) {
        $f = self::firmar($canal, $vigencia);
        if (!$f) {
            return null;
        }
        return '/?session=' . rawurlencode($f['canal'])
             . '&token=' . rawurlencode($f['token'])
             . '&exp=' . (int)$f['exp'];
    }
}

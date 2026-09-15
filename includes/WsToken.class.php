<?php
/**
 * Firma de tokens para suscribirse al relay de WebSocket.
 *
 * POR QUÉ
 * El relay repartía mensajes a quien pidiera un canal, y el canal de una cuenta es su
 * `session_id`: un entero corto. Cualquiera que adivinara un número podía escuchar el pedido
 * de una mesa ajena. Ahora los canales de cuenta y de tienda exigen un token firmado con
 * `WS_SECRET` (el mismo valor que recibe el contenedor del WebSocket).
 *
 * Formato: token = HMAC-SHA256(secreto, "<canal>|<expiración>") en hex.
 * El relay valida firma y vigencia antes del handshake. El UUID del carrito del display de
 * cliente queda sin token a propósito: es aleatorio de 128 bits y no se puede adivinar.
 *
 * Si `WS_SECRET` no está configurado, `firmar()` devuelve null y quien llame decide: sin
 * secreto no se finge un token (el relay lo rechazaría igual, y fallar cerrado es correcto).
 */
class WsToken {

    /** Segundos de vigencia por defecto de un token de suscripción. */
    const VIGENCIA = 3600;

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

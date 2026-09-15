<?php
/**
 * URL pública de la instalación.
 *
 * POR QUÉ EXISTE
 * Detrás de un proxy (Cloudflare Tunnel, nginx, un balanceador) el servidor recibe la
 * petición por HTTP aunque el cliente haya entrado por HTTPS, así que `$_SERVER['HTTPS']`
 * no viene puesto y las URLs se generaban como `http://…`. Consecuencia real: el QR
 * impreso de una mesa apuntaba a `http://` en una instalación que sí tiene HTTPS.
 *
 * Orden de decisión:
 *   1. APP_URL, si el negocio la definió (es la forma explícita y la única que no depende
 *      de encabezados que el cliente controla).
 *   2. X-Forwarded-Proto, que es lo que manda el proxy cuando ya resolvió el TLS.
 *   3. HTTPS de PHP (instalación directa con certificado).
 *
 * Nota de seguridad: HTTP_HOST lo pone el cliente, así que sirve para armar el enlace de un
 * QR que imprime el propio dueño, pero para cualquier cosa firmada o enviada por correo se
 * debe fijar APP_URL.
 */
class UrlHelper {

    /** Base pública sin diagonal final: https://ejemplo.com */
    public static function base() {
        $appUrl = getenv('APP_URL');
        if ($appUrl !== false && trim($appUrl) !== '') {
            return rtrim(trim($appUrl), '/');
        }

        $esquema = 'http';

        $proto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
        if ($proto !== '') {
            // Puede venir encadenado: "https,http" — vale el primero.
            $primero = strtolower(trim(explode(',', $proto)[0]));
            if ($primero === 'https' || $primero === 'http') {
                $esquema = $primero;
            }
        } elseif (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off') {
            $esquema = 'https';
        }

        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        return $esquema . '://' . $host;
    }

    /**
     * URL de la carta pública. Con $tableToken el QR abre la carta sabiendo en qué punto de
     * servicio está el cliente (y la cuenta nace ligada a ese punto).
     */
    public static function carta($menuToken, $tableToken = null) {
        $url = self::base() . '/m/' . rawurlencode($menuToken);
        if ($tableToken !== null && $tableToken !== '') {
            $url .= '?punto=' . rawurlencode($tableToken);
        }
        return $url;
    }
}

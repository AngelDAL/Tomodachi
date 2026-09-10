<?php
/**
 * Clase Cors - Política CORS centralizada.
 *
 * Sustituye el comodín "Access-Control-Allow-Origin: *" por una lista blanca:
 *   - Si la petición no trae header Origin (curl, apps móviles, servidor a
 *     servidor): no se emiten cabeceras CORS; nada cambia para esos clientes.
 *   - Si trae Origin: solo se refleja cuando está permitido — en la lista
 *     ALLOWED_ORIGINS (separada por comas), coincide con el host de la
 *     petición (mismo origen, también a través de proxies) o proviene de la
 *     app empaquetada con Capacitor (capacitor://localhost).
 *   - Nunca se activa Access-Control-Allow-Credentials.
 *
 * Uso en un endpoint:  Cors::apply();
 */
class Cors {

    /** Gestiona únicamente la cabecera Origin (+Vary); el resto son del endpoint. */
    public static function apply() {
        // La respuesta depende del Origin: necesario para cachés intermedias
        header('Vary: Origin');

        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin === '') {
            return;
        }

        if (self::isAllowed($origin)) {
            header('Access-Control-Allow-Origin: ' . $origin);
        }
        // Si no está permitido no se emite la cabecera: el navegador
        // bloqueará la lectura de la respuesta (comportamiento deseado).
    }

    private static function isAllowed($origin) {
        // 1) Lista blanca explícita: ALLOWED_ORIGINS=https://a.com,https://b.com
        $env = getenv('ALLOWED_ORIGINS');
        if ($env) {
            foreach (explode(',', $env) as $allowed) {
                $allowed = trim($allowed);
                if ($allowed !== '' && strcasecmp($allowed, $origin) === 0) {
                    return true;
                }
            }
        }

        // 2) Mismo host que la petición (proxies incluidos)
        $originHost = parse_url($origin, PHP_URL_HOST);
        $originPort = parse_url($origin, PHP_URL_PORT);
        $reqHost = $_SERVER['HTTP_HOST'] ?? '';
        if ($originHost && $reqHost) {
            $reqHostName = explode(':', $reqHost)[0];
            $reqPort = (strpos($reqHost, ':') !== false) ? (int)substr(strrchr($reqHost, ':'), 1) : null;
            if (strcasecmp($originHost, $reqHostName) === 0) {
                if ($originPort === null || $reqPort === null || $originPort === $reqPort) {
                    return true;
                }
            }
        }

        // 3) App móvil empaquetada con Capacitor
        if (preg_match('#^(capacitor|ionic)://#i', $origin)) {
            return true;
        }

        return false;
    }
}

<?php
/**
 * Clase RequestContext - Correlación de peticiones (request id end-to-end).
 *
 * Un id por petición, disponible a la vez en los logs y en la respuesta:
 *
 *   - nginx genera `$request_id` y lo inyecta como HTTP_X_REQUEST_ID a PHP
 *     (fastcgi_param HTTP_X_REQUEST_ID $request_id) y como cabecera
 *     `X-Request-Id` al cliente (add_header ... always). Ver docker/nginx.conf.
 *   - Si PHP corre sin nginx (CLI, cron, tests, php -S) se genera un id propio
 *     para que el log nunca pierda la correlación.
 *   - Un id que venga del request se acepta sólo si pasa ID_PATTERN: así un
 *     cliente no puede inyectar texto arbitrario (o líneas falsas) en el log.
 *
 * Uso:
 *   RequestContext::bind($store_id, $user_id);  // DESPUÉS de autenticar
 *   RequestContext::error('Database::query - ' . $e->getMessage());
 *   RequestContext::info('[Digital Signage] Board activado: …');
 *
 * Regla: aquí sólo van ids (petición, tienda, usuario) y el nombre de la ruta.
 * Nunca datos de negocio (nombres de cliente/producto, correos, tokens).
 */
class RequestContext {

    /** Id aceptado desde fuera: acotado y sin caracteres de control/espacios. */
    const ID_PATTERN = '/^[A-Za-z0-9._-]{1,64}$/';

    /** @var string|null id de la petición (se fija la primera vez que se pide) */
    private static $id = null;

    /** @var int|null tienda de la petición (- si aún no se autenticó) */
    private static $storeId = null;

    /** @var int|null usuario de la petición (- si es por token o anónima) */
    private static $userId = null;

    /** @var string|null ruta de la petición (se calcula una vez) */
    private static $route = null;

    /**
     * Id de la petición. Toma el header que puso nginx si es válido; si no,
     * genera uno (12 hex = 48 bits, suficiente para correlacionar y corto para
     * leer en un log).
     *
     * @return string
     */
    public static function id() {
        if (self::$id !== null) {
            return self::$id;
        }

        $fromHeader = isset($_SERVER['HTTP_X_REQUEST_ID'])
            ? trim((string)$_SERVER['HTTP_X_REQUEST_ID'])
            : '';

        if (preg_match(self::ID_PATTERN, $fromHeader)) {
            self::$id = $fromHeader;
            return self::$id;
        }

        try {
            self::$id = bin2hex(random_bytes(6));
        } catch (Throwable $e) {
            // random_bytes sólo falla si no hay fuente de entropía; sin id la
            // correlación se pierde, así que dejamos una marca inconfundible.
            self::$id = 'noid-' . getmypid();
        }

        return self::$id;
    }

    /**
     * Fijar la tienda y el usuario de la petición actual.
     *
     * Se llama SÓLO después de autenticar y con ids ya validados contra la
     * sesión (Auth) o el token (ApiAuth): nunca con datos que vengan del
     * request. Es lo que convierte `store=- user=-` en algo buscable.
     *
     * @param int|null $storeId
     * @param int|null $userId
     * @return string prefijo de contexto resultante
     */
    public static function bind($storeId, $userId = null) {
        if ($storeId !== null && $storeId !== '' && is_numeric($storeId)) {
            self::$storeId = (int)$storeId;
        }
        if ($userId !== null && $userId !== '' && is_numeric($userId)) {
            self::$userId = (int)$userId;
        }
        return self::context();
    }

    /**
     * Ruta de la petición (sin query string: los parámetros pueden llevar
     * datos de negocio). Ej: `api/auth/login.php`.
     *
     * @return string
     */
    public static function route() {
        if (self::$route !== null) {
            return self::$route;
        }

        $path = isset($_SERVER['SCRIPT_NAME']) ? (string)$_SERVER['SCRIPT_NAME'] : '';
        if ($path === '' && isset($_SERVER['REQUEST_URI'])) {
            $path = (string)parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
        }
        $path = str_replace('\\', '/', $path);

        self::$route = ($path === '' || $path === '/') ? 'cli' : ltrim($path, '/');
        return self::$route;
    }

    /**
     * Prefijo común de todo log de este proceso: [req=… store=… user=… route=…]
     *
     * @return string
     */
    public static function context() {
        return '[req=' . self::id()
            . ' store=' . (self::$storeId === null ? '-' : self::$storeId)
            . ' user=' . (self::$userId === null ? '-' : self::$userId)
            . ' route=' . self::route() . ']';
    }

    /**
     * Cabecera de respuesta con el id (la emite Response en cada respuesta).
     *
     * @return string
     */
    public static function headerLine() {
        return 'X-Request-Id: ' . self::id();
    }

    /**
     * Error de servidor, con contexto de la petición. Sustituye a error_log()
     * en includes/ y api/: mismo destino (el error log de php-fpm, que
     * supervisord publica en `docker logs`) pero correlacionable.
     *
     * @param string $message
     */
    public static function error($message) {
        self::write($message);
    }

    /**
     * Evento informativo relevante para diagnóstico (p. ej. activaciones
     * automáticas de Pantallas Digitales). No es un error.
     *
     * @param string $message
     */
    public static function info($message) {
        self::write('[info] ' . $message);
    }

    /**
     * Único punto que escribe en el error log de PHP.
     *
     * @param string $message
     */
    private static function write($message) {
        error_log(self::context() . ' ' . $message);
    }

    /**
     * Reiniciar el contexto (tests). No usar en código de producción.
     */
    public static function reset() {
        self::$id = null;
        self::$storeId = null;
        self::$userId = null;
        self::$route = null;
    }
}

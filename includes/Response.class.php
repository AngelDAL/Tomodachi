<?php
/**
 * Clase Response - Manejo de respuestas JSON estandarizadas
 */

require_once __DIR__ . '/RequestContext.class.php';

class Response {
    
    /**
     * Enviar respuesta exitosa
     * @param mixed $data Datos a enviar
     * @param string $message Mensaje descriptivo
     * @param int $code Código HTTP
     */
    public static function success($data = null, $message = 'Operación exitosa', $code = 200) {
        http_response_code($code);
        self::requestIdHeader();
        self::noCacheHeaders();
        header('Content-Type: application/json; charset=utf-8');
        
        echo json_encode([
            'success' => true,
            'message' => $message,
            'data' => $data,
            'error' => null
        ], JSON_UNESCAPED_UNICODE);
        
        exit;
    }
    
    /**
     * Enviar respuesta de error
     * @param string $message Mensaje de error
     * @param int $code Código HTTP
     * @param mixed $details Detalles adicionales del error
     */
    public static function error($message = 'Error en la operación', $code = 400, $details = null) {
        http_response_code($code);
        self::requestIdHeader();
        self::noCacheHeaders();
        header('Content-Type: application/json; charset=utf-8');
        
        echo json_encode([
            'success' => false,
            'message' => $message,
            'data' => null,
            'error' => $details
        ], JSON_UNESCAPED_UNICODE);
        
        exit;
    }
    
    /**
     * Publicar el id de la petición en la respuesta. Sólo cabecera: el cuerpo
     * JSON no cambia, así que el frontend no se entera. Es la mitad "respuesta"
     * de la correlación: el usuario (o quien lea un ticket de soporte) puede
     * pegar este id y encontrar la línea exacta en los logs de nginx/php-fpm.
     */
    private static function requestIdHeader() {
        if (!headers_sent()) {
            header(RequestContext::headerLine());
        }
    }

    /**
     * Evitar que las respuestas de la API (dependientes de la sesión) se cacheen
     * en navegador, service worker o proxies/CDN. Sin esto, un proxy podría servir
     * una respuesta vieja "401/deslogueado" a peticiones que ya tienen sesión,
     * provocando errores intermitentes (settings.php, verify_session, etc.).
     */
    private static function noCacheHeaders() {
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');
        header('Expires: 0');
    }
    
    /**
     * Enviar respuesta de validación
     * @param array $errors Array de errores de validación
     */
    public static function validationError($errors) {
        self::error('Errores de validación', 422, $errors);
    }
    
    /**
     * Enviar respuesta de no autorizado
     */
    public static function unauthorized($message = 'No autorizado') {
        self::error($message, 401);
    }
    
    /**
     * Enviar respuesta de no encontrado
     */
    public static function notFound($message = 'Recurso no encontrado') {
        self::error($message, 404);
    }
}

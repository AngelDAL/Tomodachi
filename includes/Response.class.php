<?php
/**
 * Clase Response - Manejo de respuestas JSON estandarizadas
 */

class Response {
    
    /**
     * Enviar respuesta exitosa
     * @param mixed $data Datos a enviar
     * @param string $message Mensaje descriptivo
     * @param int $code Código HTTP
     */
    public static function success($data = null, $message = 'Operación exitosa', $code = 200) {
        http_response_code($code);
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

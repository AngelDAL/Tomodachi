<?php
/**
 * Clase Validator - Validación y sanitización de datos
 */

class Validator {
    
    /**
     * Sanitizar string
     * @param string $data Dato a sanitizar
     * @return string
     */
    public static function sanitizeString($data) {
        return htmlspecialchars(strip_tags(trim($data)), ENT_QUOTES, 'UTF-8');
    }
    
    /**
     * Validar email
     * @param string $email
     * @return bool
     */
    public static function validateEmail($email) {
        return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
    }
    
    /**
     * Validar número
     * @param mixed $number Número a validar
     * @param int|null $min Valor mínimo
     * @param int|null $max Valor máximo
     * @return bool
     */
    public static function validateNumeric($number, $min = null, $max = null) {
        if (!is_numeric($number)) {
            return false;
        }
        
        if ($min !== null && $number < $min) {
            return false;
        }
        
        if ($max !== null && $number > $max) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Validar longitud de string
     * @param string $string
     * @param int $min Longitud mínima
     * @param int $max Longitud máxima
     * @return bool
     */
    public static function validateLength($string, $min = 0, $max = 255) {
        $length = strlen($string);
        return $length >= $min && $length <= $max;
    }
    
    /**
     * Validar que un campo no esté vacío
     * @param mixed $value
     * @return bool
     */
    public static function required($value) {
        if (is_string($value)) {
            return trim($value) !== '';
        }
        return !empty($value);
    }
    
    /**
     * Validar formato de fecha
     * @param string $date
     * @param string $format Formato esperado (default: Y-m-d)
     * @return bool
     */
    public static function validateDate($date, $format = 'Y-m-d') {
        $d = DateTime::createFromFormat($format, $date);
        return $d && $d->format($format) === $date;
    }
    
    /**
     * Validar que un valor esté en un array de opciones
     * @param mixed $value
     * @param array $options
     * @return bool
     */
    public static function inArray($value, $options) {
        return in_array($value, $options, true);
    }
    
    /**
     * Validar precio/decimal
     * @param mixed $price
     * @return bool
     */
    public static function validatePrice($price) {
        return is_numeric($price) && $price >= 0;
    }
    
    /**
     * Validar contraseña segura
     * @param string $password
     * @param int $minLength Longitud mínima
     * @return bool
     */
    public static function validatePassword($password, $minLength = 6) {
        return strlen($password) >= $minLength;
    }
}

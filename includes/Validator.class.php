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
     * URL del papel tapiz de la tienda (imagen de fondo).
     *
     * La URL se pinta después dentro de un `url()` del tema, así que solo se
     * aceptan imágenes de la propia instalación, en ruta relativa y sin saltos
     * de directorio. Cadena vacía = sin papel tapiz (válido).
     *
     * @param mixed $url
     * @return string|null  La ruta normalizada, '' para quitar, o null si no es válida
     */
    public static function wallpaperUrl($url) {
        if (!is_string($url)) return null;
        $url = trim($url);
        if ($url === '') return '';
        if (strpos($url, '..') !== false) return null;
        if (strpos($url, '\\') !== false) return null;
        // Esquema (http:, data:, javascript:) o URL de otro sitio: fuera.
        if (preg_match('#^[a-zA-Z][a-zA-Z0-9+.\-]*:#', $url)) return null;
        if (strpos($url, '//') === 0) return null;
        $patron = '#^(assets/images/(wallpapers|backgrounds)|uploads/[A-Za-z0-9._/\-]+)/[A-Za-z0-9._\-]+\.(jpe?g|png|webp|avif)$#i';
        if (!preg_match($patron, $url)) return null;
        return $url;
    }

    /**
     * Normaliza las claves del papel tapiz dentro de un theme_config.
     * Las claves ausentes se dejan ausentes; las inválidas se descartan (no
     * tiene sentido rechazar todo el tema por un valor raro de opacidad).
     *
     * @param array $cfg
     * @return array
     */
    public static function wallpaperConfig($cfg) {
        if (!is_array($cfg)) return $cfg;

        if (array_key_exists('wallpaper_url', $cfg)) {
            if ($cfg['wallpaper_url'] === '') {
                // Quitar el fondo: se persiste vacío (no se borra la clave) para que el
                // cliente lo lea como "sin fondo" y lo quite de la pantalla de inmediato.
                $cfg['wallpaper_url'] = '';
            } else {
                $url = self::wallpaperUrl($cfg['wallpaper_url']);
                if ($url === null) unset($cfg['wallpaper_url']);
                else $cfg['wallpaper_url'] = $url;
            }
        }
        if (array_key_exists('wallpaper_opacity', $cfg)) {
            if (!is_numeric($cfg['wallpaper_opacity'])) {
                unset($cfg['wallpaper_opacity']);
            } else {
                $cfg['wallpaper_opacity'] = max(0, min(100, (int)round((float)$cfg['wallpaper_opacity'])));
            }
        }
        if (array_key_exists('wallpaper_size', $cfg)) {
            $cfg['wallpaper_size'] = ($cfg['wallpaper_size'] === 'fill') ? 'fill' : 'cover';
        }
        return $cfg;
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

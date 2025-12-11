<?php
/**
 * Script de prueba para envío de correos con parámetro GET
 * Uso: test_mail_get.php?email=destinatario@ejemplo.com
 */

// Mostrar todos los errores
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Detectar si estamos en CLI o Navegador para el salto de línea
$eol = (php_sapi_name() === 'cli') ? "\n" : "<br>";

echo "Iniciando script de prueba de correo...{$eol}";

// Verificar archivo de clase
if (!file_exists('includes/Mail.class.php')) {
    die("Error: No se encuentra includes/Mail.class.php{$eol}");
}

require_once 'includes/Mail.class.php';

// Obtener correo por GET
$email = isset($_GET['email']) ? trim($_GET['email']) : '';

if (empty($email)) {
    die("Error: Debes proporcionar un correo por GET. Ejemplo: ?email=tu@correo.com{$eol}");
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    die("Error: El correo proporcionado no es válido.{$eol}");
}

echo "Intentando enviar a: <strong>{$email}</strong> ... ";

try {
    $mailer = new Mail();
    
    // Usamos el método sendWelcomeEmail
    // Parametros: Email, Nombre Usuario, Nombre Tienda, Username
    $result = $mailer->sendWelcomeEmail($email, 'Usuario de Prueba GET', 'Baburu Test GET', 'usuario_prueba');
    
    if ($result) {
        echo "<span style='color:green'>ENVIADO CORRECTAMENTE</span>{$eol}";
    } else {
        echo "<span style='color:red'>FALLÓ EL ENVÍO</span> (Revisar logs de error de PHP){$eol}";
    }
    
} catch (Exception $e) {
    echo "<span style='color:red'>EXCEPCIÓN: " . $e->getMessage() . "</span>{$eol}";
}

echo "Prueba finalizada.{$eol}";

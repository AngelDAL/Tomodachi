<?php
require_once 'includes/Mail.class.php';

echo "Iniciando prueba de correo...\n";

try {
    $mail = new Mail();
    $result = $mail->sendSupportMessage(
        'testvalidator@example.com', 
        'Usuario Prueba', 
        'Prueba de Consola', 
        'Este es un mensaje de prueba enviado desde la consola para verificar la configuración SMTP.', 
        'Test'
    );

    if ($result) {
        echo "Exito: Correo enviado correctamente.\n";
    } else {
        echo "Error: El metodo devolvio false.\n";
    }
} catch (Exception $e) {
    echo "Excepcion capturada: " . $e->getMessage() . "\n";
}

<?php

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

class Mail {
    private $mailer;
    private $config;

    public function __construct() {
        $this->loadDependencies();
        $this->config = require __DIR__ . '/../config/mail.php';
        
        $this->mailer = new PHPMailer(true);
        $this->setup();
    }

    private function loadDependencies() {
        $autoloadPath = __DIR__ . '/../vendor/autoload.php';
        if (file_exists($autoloadPath)) {
            require_once $autoloadPath;
        } else {
            // Fallback if manual installation in lib/phpmailer
            // This is just a guess, user should use composer
            if (file_exists(__DIR__ . '/../lib/phpmailer/src/PHPMailer.php')) {
                require_once __DIR__ . '/../lib/phpmailer/src/Exception.php';
                require_once __DIR__ . '/../lib/phpmailer/src/PHPMailer.php';
                require_once __DIR__ . '/../lib/phpmailer/src/SMTP.php';
            }
        }
    }

    private function setup() {
        try {
            // Server settings
            $this->mailer->isSMTP();
            $this->mailer->Host       = $this->config['host'];
            $this->mailer->SMTPAuth   = true;
            $this->mailer->Username   = $this->config['username'];
            $this->mailer->Password   = $this->config['password'];
            $this->mailer->SMTPSecure = $this->config['encryption'];
            $this->mailer->Port       = $this->config['port'];
            $this->mailer->CharSet    = 'UTF-8';
            $this->mailer->Encoding   = 'base64';

            // Recipients
            $this->mailer->setFrom($this->config['from_email'], $this->config['from_name']);
        } catch (Exception $e) {
            error_log("Mailer Setup Error: {$this->mailer->ErrorInfo}");
        }
    }

    public function sendWelcomeEmail($toEmail, $toName, $storeName, $username) {
        try {
            $this->mailer->addAddress($toEmail, $toName);

            // Content
            $this->mailer->isHTML(true);
            $this->mailer->Subject = 'Bienvenido a Tomodachi POS';
            
            $body = "
            <div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;'>
                <div style='text-align: center; margin-bottom: 20px;'>
                    <h1 style='color: #E3057A;'>Tomodachi POS</h1>
                </div>
                <div style='background-color: #f9f9f9; padding: 20px; border-radius: 5px;'>
                    <h2>¡Hola, {$toName}!</h2>
                    <p>Gracias por registrarte en Tomodachi POS.</p>
                    <p>Tu tienda <strong>{$storeName}</strong> ha sido creada exitosamente.</p>
                    <p>Tus credenciales de acceso son:</p>
                    <ul>
                        <li><strong>Usuario:</strong> {$username}</li>
                    </ul>
                    <p>Ahora puedes comenzar a administrar tu inventario, ventas y reportes de manera fácil y rápida.</p>
                    <br>
                    <p>Si tienes alguna duda, no dudes en contactarnos.</p>
                    <br>
                    <p>Saludos,<br>El equipo de Tomodachi</p>
                </div>
                <div style='text-align: center; margin-top: 20px; font-size: 12px; color: #999;'>
                    &copy; " . date('Y') . " Tomodachi POS. Todos los derechos reservados.
                </div>
            </div>
            ";

            $this->mailer->Body = $body;
            $this->mailer->AltBody = "Hola {$toName}, Gracias por registrarte en Tomodachi POS. Tu tienda {$storeName} ha sido creada exitosamente. Tu usuario es: {$username}";

            $this->mailer->send();
            return true;
        } catch (Exception $e) {
            error_log("Message could not be sent. Mailer Error: {$this->mailer->ErrorInfo}");
            return false;
        }
    }

    public function sendNewUserEmail($toEmail, $toName, $storeName, $username, $password, $role) {
        try {
            $this->mailer->addAddress($toEmail, $toName);

            // Content
            $this->mailer->isHTML(true);
            $this->mailer->Subject = 'Nueva cuenta de usuario - Tomodachi POS';
            
            $body = "
            <div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;'>
                <div style='text-align: center; margin-bottom: 20px;'>
                    <h1 style='color: #E3057A;'>Tomodachi POS</h1>
                </div>
                <div style='background-color: #f9f9f9; padding: 20px; border-radius: 5px;'>
                    <h2>¡Hola, {$toName}!</h2>
                    <p>Se ha creado una nueva cuenta de usuario para ti en la tienda <strong>{$storeName}</strong>.</p>
                    <p>Tus credenciales de acceso son:</p>
                    <ul>
                        <li><strong>Usuario:</strong> {$username}</li>
                        <li><strong>Contraseña:</strong> {$password}</li>
                        <li><strong>Rol:</strong> " . ucfirst($role) . "</li>
                    </ul>
                    <p>Te recomendamos cambiar tu contraseña al iniciar sesión por primera vez.</p>
                    <br>
                    <p>Saludos,<br>El equipo de Tomodachi</p>
                </div>
                <div style='text-align: center; margin-top: 20px; font-size: 12px; color: #999;'>
                    &copy; " . date('Y') . " Tomodachi POS. Todos los derechos reservados.
                </div>
            </div>
            ";

            $this->mailer->Body = $body;
            $this->mailer->AltBody = "Hola {$toName}, Se ha creado una cuenta para ti en {$storeName}. Usuario: {$username}, Contraseña: {$password}";

            $this->mailer->send();
            return true;
        } catch (Exception $e) {
            error_log("Message could not be sent. Mailer Error: {$this->mailer->ErrorInfo}");
            return false;
        }
    }
}

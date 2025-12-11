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

    public function sendPasswordResetEmail($toEmail, $toName, $resetLink) {
        try {
            $this->mailer->addAddress($toEmail, $toName);

            // Content
            $this->mailer->isHTML(true);
            $this->mailer->Subject = 'Restablecer Contraseña - Tomodachi POS';
            
            $body = "
            <div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;'>
                <div style='text-align: center; margin-bottom: 20px;'>
                    <h1 style='color: #E3057A;'>Tomodachi POS</h1>
                </div>
                <div style='background-color: #f9f9f9; padding: 20px; border-radius: 5px;'>
                    <h2>Restablecer Contraseña</h2>
                    <p>Hola {$toName},</p>
                    <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta.</p>
                    <p>Haz clic en el siguiente botón para crear una nueva contraseña:</p>
                    <div style='text-align: center; margin: 30px 0;'>
                        <a href='{$resetLink}' style='background-color: #E3057A; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;'>Restablecer Contraseña</a>
                    </div>
                    <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
                    <p>Este enlace expirará en 1 hora.</p>
                    <br>
                    <p>Saludos,<br>El equipo de Tomodachi</p>
                </div>
                <div style='text-align: center; margin-top: 20px; font-size: 12px; color: #999;'>
                    &copy; " . date('Y') . " Tomodachi POS. Todos los derechos reservados.
                </div>
            </div>
            ";

            $this->mailer->Body = $body;
            $this->mailer->AltBody = "Hola {$toName}, Para restablecer tu contraseña visita: {$resetLink}";

            $this->mailer->send();
            return true;
        } catch (Exception $e) {
            error_log("Message could not be sent. Mailer Error: {$this->mailer->ErrorInfo}");
            return false;
        }
    }

    /**
     * Envía un reporte ejecutivo al realizar el corte de caja
     */
    public function sendDailyReport($toEmail, $toName, $storeName, $date, $stats) {
        try {
            $this->mailer->addAddress($toEmail, $toName);

            // Formatear moneda
            $totalSales = number_format($stats['total_sales'], 2);
            $ticketAvg = number_format($stats['ticket_average'], 2);
            $profitTotal = number_format($stats['total_profit'], 2);
            
            // Content
            $this->mailer->isHTML(true);
            $this->mailer->Subject = "📊 Reporte de Cierre - {$storeName} - {$date}";
            
            $body = "
            <div style=\"font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1);\">
                
                <!-- Header -->
                <div style=\"background: linear-gradient(135deg, #E3057A 0%, #b00460 100%); padding: 30px 20px; text-align: center; color: white;\">
                    <h1 style=\"margin: 0; font-size: 24px; font-weight: 700;\">Resumen del Día</h1>
                    <p style=\"margin: 5px 0 0 0; opacity: 0.9;\">{$storeName} | {$date}</p>
                </div>

                <!-- Main Stats -->
                <div style=\"padding: 30px 20px;\">
                    <div style=\"text-align: center; margin-bottom: 30px;\">
                        <span style=\"display: block; color: #666; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;\">Ventas Totales</span>
                        <span style=\"display: block; color: #333; font-size: 42px; font-weight: 800; margin-top: 5px;\">$ {$totalSales}</span>
                    </div>

                    <!-- Grid de detalles -->
                    <div style=\"display: flex; justify-content: space-between; margin-bottom: 30px; border-top: 1px solid #eee; border-bottom: 1px solid #eee; padding: 20px 0;\">
                        <div style=\"text-align: center; width: 33%;\">
                            <span style=\"display: block; font-size: 24px;\">🛒</span>
                            <strong style=\"display: block; color: #333; margin-top: 5px;\">{$stats['transaction_count']}</strong>
                            <span style=\"font-size: 12px; color: #888;\">Transacciones</span>
                        </div>
                        <div style=\"text-align: center; width: 33%; border-left: 1px solid #eee; border-right: 1px solid #eee;\">
                            <span style=\"display: block; font-size: 24px;\">🧾</span>
                            <strong style=\"display: block; color: #333; margin-top: 5px;\">$ {$ticketAvg}</strong>
                            <span style=\"font-size: 12px; color: #888;\">Ticket Promedio</span>
                        </div>
                        <div style=\"text-align: center; width: 33%;\">
                            <span style=\"display: block; font-size: 24px;\">📈</span>
                            <strong style=\"display: block; color: #27ae60; margin-top: 5px;\">$ {$profitTotal}</strong>
                            <span style=\"font-size: 12px; color: #888;\">Ganancia</span>
                        </div>
                    </div>

                    <!-- Top Product -->
                    <div style=\"background-color: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #E3057A;\">
                        <h3 style=\"margin: 0 0 10px 0; font-size: 16px; color: #333;\">🏆 Producto Estrella</h3>
                        <div style=\"display: flex; justify-content: space-between; align-items: center;\">
                            <span style=\"color: #555;\">{$stats['top_product_name']}</span>
                            <span style=\"font-weight: bold; color: #E3057A;\">{$stats['top_product_qty']} vendidos</span>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div style=\"background-color: #f1f1f1; padding: 20px; text-align: center; font-size: 12px; color: #888;\">
                    <p style=\"margin: 0;\">Reporte generado automáticamente por <strong>Tomodachi POS</strong></p>
                    <p style=\"margin: 5px 0 0 0;\">&copy; " . date('Y') . " Todos los derechos reservados.</p>
                </div>
            </div>
            ";

            $this->mailer->Body = $body;
            $this->mailer->AltBody = "Resumen del día {$date}: Ventas Totales: $ {$totalSales}. Transacciones: {$stats['transaction_count']}.";

            $this->mailer->send();
            return true;
        } catch (Exception $e) {
            error_log("Message could not be sent. Mailer Error: {$this->mailer->ErrorInfo}");
            return false;
        }
    }
}

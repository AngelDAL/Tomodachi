<?php
/**
 * Clase LoginRateLimiter - Protección contra ataques de fuerza bruta.
 *
 * Registra intentos de login fallidos por dirección IP y, tras superar un
 * umbral, bloquea esa IP durante un tiempo que ESCALA con cada bloqueo
 * (1min, 5min, 25min, 2h, ... hasta un tope). Un login exitoso limpia el
 * contador de la IP.
 *
 * Requiere la tabla `login_attempts` (ver database/schema.sql y la migración
 * 026_add_login_attempts.sql).
 *
 * Uso en un endpoint de login:
 *   $rl = new LoginRateLimiter($db);
 *   $st = $rl->check();
 *   if (!$st['allowed']) {
 *       http_response_code(429);
 *       echo json_encode(['success'=>false,'message'=>$st['message'],
 *                         'retry_after'=>$st['retry_after']]);
 *       exit;
 *   }
 *   ... validar credenciales ...
 *   if ($ok) { $rl->recordSuccess(); } else { $rl->recordFailure($username); }
 */
class LoginRateLimiter
{
    private $db;

    // Configuración (sobrescribible con constantes definidas en constants.php)
    private $maxAttempts;   // intentos fallidos antes de bloquear
    private $baseLockSeconds; // duración del 1er bloqueo
    private $maxLockSeconds;  // tope de duración de bloqueo
    private $lockMultiplier;  // factor de escalamiento por bloqueo

    public function __construct($database)
    {
        $this->db = $database;
        $this->maxAttempts      = defined('LOGIN_MAX_ATTEMPTS')     ? LOGIN_MAX_ATTEMPTS     : 5;
        $this->baseLockSeconds  = defined('LOGIN_LOCK_BASE_SECONDS')? LOGIN_LOCK_BASE_SECONDS: 60;
        $this->maxLockSeconds   = defined('LOGIN_LOCK_MAX_SECONDS') ? LOGIN_LOCK_MAX_SECONDS : 7200;
        $this->lockMultiplier   = defined('LOGIN_LOCK_MULTIPLIER')  ? LOGIN_LOCK_MULTIPLIER  : 5;
    }

    /**
     * Dirección IP del cliente con fallback seguro.
     */
    private function ip()
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        // normalizar a IP simple (evitar que un header/lista rompa la PK varchar)
        return substr($ip, 0, 45);
    }

    /**
     * Consulta el estado actual de la IP, calculando el tiempo restante de
     * bloqueo DENTRO de MariaDB (TIMESTAMPDIFF) para que sea consistente con
     * cómo se escribió locked_until (DATE_ADD(NOW(), ...)) y no depender de
     * la zona horaria del proceso PHP vs la del servidor de BD.
     * @return array{failed_attempts:int, remaining:int, lock_count:int}|null
     */
    private function fetch()
    {
        $row = $this->db->selectOne(
            "SELECT failed_attempts, lock_count,
                    COALESCE(TIMESTAMPDIFF(SECOND, NOW(), locked_until), 0) AS remaining
               FROM login_attempts WHERE ip_address = ?",
            [$this->ip()]
        );
        return $row ?: null;
    }

    /**
     * ¿Está permitido intentar login ahora?
     * @return array{allowed:bool, retry_after:int, message:string}
     */
    public function check()
    {
        $row = $this->fetch();
        if (!$row) {
            return ['allowed' => true, 'retry_after' => 0, 'message' => ''];
        }

        $remaining = (int)$row['remaining'];
        if ($remaining <= 0) {
            // Sin bloqueo activo (o el bloqueo expiró); permitir.
            return ['allowed' => true, 'retry_after' => 0, 'message' => ''];
        }

        $mins = max(1, (int)ceil($remaining / 60));
        return [
            'allowed'    => false,
            'retry_after'=> $remaining,
            'message'    => "Demasiados intentos fallidos. Inténtelo de nuevo en {$mins} minuto(s).",
        ];
    }

    /**
     * Registrar un intento fallido. Escala el bloqueo al superar el umbral.
     */
    public function recordFailure($username = '')
    {
        $username = substr((string)$username, 0, 100);
        $ip = $this->ip();
        $row = $this->fetch();

        if (!$row) {
            // primera vez
            $this->db->insert(
                "INSERT INTO login_attempts (ip_address, failed_attempts, last_attempt_at, last_username)
                 VALUES (?, 1, NOW(), ?)",
                [$ip, $username]
            );
            return;
        }

        $fail = (int)$row['failed_attempts'] + 1;

        if ($fail >= $this->maxAttempts) {
            $lockCount = (int)$row['lock_count'] + 1;
            $raw = (int)($this->baseLockSeconds * pow($this->lockMultiplier, $lockCount - 1));
            $lockSeconds = min($raw, $this->maxLockSeconds);
            $this->db->update(
                "UPDATE login_attempts
                    SET failed_attempts = 0,
                        lock_count = ?,
                        locked_until = DATE_ADD(NOW(), INTERVAL ? SECOND),
                        last_attempt_at = NOW(),
                        last_username = ?
                  WHERE ip_address = ?",
                [$lockCount, $lockSeconds, $username, $ip]
            );
        } else {
            $this->db->update(
                "UPDATE login_attempts
                    SET failed_attempts = ?, last_attempt_at = NOW(), last_username = ?
                  WHERE ip_address = ?",
                [$fail, $username, $ip]
            );
        }
    }

    /**
     * Login exitoso: limpia el registro de la IP (recupera su acceso completo).
     */
    public function recordSuccess()
    {
        $this->db->delete("DELETE FROM login_attempts WHERE ip_address = ?", [$this->ip()]);
    }
}

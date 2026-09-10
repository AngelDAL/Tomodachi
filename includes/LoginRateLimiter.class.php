<?php
/**
 * Clase LoginRateLimiter - Protección contra ataques de fuerza bruta.
 *
 * Registra intentos de login fallidos por dirección IP y por CUENTA, y tras
 * superar un umbral bloquea durante un tiempo que ESCALA con cada bloqueo
 * (1min, 5min, 25min, 2h, ... hasta un tope). Un login exitoso limpia ambos
 * contadores.
 *
 * El bloqueo por cuenta evita que un atacante que rota direcciones IP siga
 * probando contraseñas de un mismo usuario. El bloqueo por IP evita que un
 * atacante pruebe muchas cuentas desde la misma IP.
 *
 * Requiere la tabla `login_attempts` (ver database/schema.sql y la migración
 * 026_add_login_attempts.sql).
 *
 * Uso en un endpoint de login:
 *   $rl = new LoginRateLimiter($db);
 *   $st = $rl->check($username);
 *   if (!$st['allowed']) {
 *       http_response_code(429);
 *       echo json_encode(['success'=>false,'message'=>$st['message'],
 *                         'retry_after'=>$st['retry_after']]);
 *       exit;
 *   }
 *   ... validar credenciales ...
 *   if ($ok) { $rl->recordSuccess($username); } else { $rl->recordFailure($username); }
 *
 * Si el sitio está detrás de un proxy confiable (Cloudflare, Cloudflare
 * Tunnel, Nginx), definir la variable de entorno TRUSTED_PROXY_HEADER
 * (p. ej. "CF-Connecting-IP") para que se use la IP real del cliente en
 * lugar de la IP del proxy. Sin ella, se usa REMOTE_ADDR.
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
     * Dirección IP del cliente.
     *
     * Cuando el sitio está detrás de un proxy confiable, REMOTE_ADDR es la
     * IP del proxy (p. ej. todos los usuarios "son" 127.0.0.1 tras un túnel).
     * En ese caso se usa el header configurado (TRUSTED_PROXY_HEADER) y se
     * valida que sea una IP real antes de aceptarla.
     */
    private function ip()
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

        $header = getenv('TRUSTED_PROXY_HEADER');
        if ($header) {
            $name = 'HTTP_' . strtoupper(str_replace('-', '_', $header));
            $candidate = $_SERVER[$name] ?? '';
            if ($candidate !== '') {
                // Puede venir como lista (X-Forwarded-For): tomar el primero
                $candidate = trim(explode(',', $candidate)[0]);
                if (filter_var($candidate, FILTER_VALIDATE_IP)) {
                    $ip = $candidate;
                }
            }
        }

        // normalizar a IP simple (evitar que un header/lista rompa la PK varchar)
        return substr($ip, 0, 45);
    }

    /**
     * Clave de bloqueo por cuenta (no se guarda el usuario en claro).
     */
    private function userKey($username)
    {
        return 'u:' . substr(hash('sha256', 'login|' . strtolower(trim((string)$username))), 0, 42);
    }

    /**
     * Consulta el estado actual de la IP, calculando el tiempo restante de
     * bloqueo DENTRO de MariaDB (TIMESTAMPDIFF) para que sea consistente con
     * cómo se escribió locked_until (DATE_ADD(NOW(), ...)) y no depender de
     * la zona horaria del proceso PHP vs la del servidor de BD.
     * @return array{failed_attempts:int, remaining:int, lock_count:int}|null
     */
    private function fetch($key)
    {
        $row = $this->db->selectOne(
            "SELECT failed_attempts, lock_count,
                    COALESCE(TIMESTAMPDIFF(SECOND, NOW(), locked_until), 0) AS remaining
               FROM login_attempts WHERE ip_address = ?",
            [$key]
        );
        return $row ?: null;
    }

    /**
     * ¿Está permitido intentar login ahora?
     * @param string|null $username Si se indica, también se comprueba el
     *                              bloqueo por cuenta.
     * @return array{allowed:bool, retry_after:int, message:string}
     */
    public function check($username = null)
    {
        $retryAfter = 0;

        $row = $this->fetch($this->ip());
        if ($row) {
            $retryAfter = max($retryAfter, (int)$row['remaining']);
        }

        if (is_string($username) && $username !== '') {
            $rowUser = $this->fetch($this->userKey($username));
            if ($rowUser) {
                $retryAfter = max($retryAfter, (int)$rowUser['remaining']);
            }
        }

        if ($retryAfter <= 0) {
            // Sin bloqueo activo (o el bloqueo expiró); permitir.
            return ['allowed' => true, 'retry_after' => 0, 'message' => ''];
        }

        $mins = max(1, (int)ceil($retryAfter / 60));
        return [
            'allowed'    => false,
            'retry_after'=> $retryAfter,
            'message'    => "Demasiados intentos fallidos. Inténtelo de nuevo en {$mins} minuto(s).",
        ];
    }

    /**
     * Incrementar el contador de una clave y escalar el bloqueo si supera
     * el umbral.
     */
    private function bump($key, $username)
    {
        $row = $this->fetch($key);

        if (!$row) {
            // primera vez
            $this->db->insert(
                "INSERT INTO login_attempts (ip_address, failed_attempts, last_attempt_at, last_username)
                 VALUES (?, 1, NOW(), ?)",
                [$key, $username]
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
                [$lockCount, $lockSeconds, $username, $key]
            );
        } else {
            $this->db->update(
                "UPDATE login_attempts
                    SET failed_attempts = ?, last_attempt_at = NOW(), last_username = ?
                  WHERE ip_address = ?",
                [$fail, $username, $key]
            );
        }
    }

    /**
     * Registrar un intento fallido. Escala el bloqueo al superar el umbral.
     * Incrementa el contador de la IP y, si se indica, también el de la
     * cuenta (para que rotar IPs no permita seguir probando un usuario).
     */
    public function recordFailure($username = '')
    {
        $username = substr((string)$username, 0, 100);

        $this->bump($this->ip(), $username);

        if ($username !== '') {
            $this->bump($this->userKey($username), $username);
        }
    }

    /**
     * Login exitoso: limpia los registros de la IP y de la cuenta
     * (recupera su acceso completo).
     */
    public function recordSuccess($username = null)
    {
        $this->db->delete("DELETE FROM login_attempts WHERE ip_address = ?", [$this->ip()]);

        if (is_string($username) && $username !== '') {
            $this->db->delete(
                "DELETE FROM login_attempts WHERE ip_address = ?",
                [$this->userKey($username)]
            );
        }
    }
}

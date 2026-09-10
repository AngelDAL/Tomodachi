<?php
/**
 * Clase Auth - Manejo de autenticación y sesiones
 */

class Auth {
    private $db;
    
    public function __construct($database) {
        $this->db = $database;
        $this->initSession();
    }
    
    /**
     * Inicializar sesión segura
     */
    private function initSession() {
        if (session_status() === PHP_SESSION_NONE) {
            session_name(SESSION_NAME);

            // El recolector de basura de PHP borra los archivos de sesión del
            // servidor según session.gc_maxlifetime. Lo alineamos con la
            // duración máxima de la cookie persistente ("recordarme", 30 días)
            // para que las sesiones no se pierdan antes de tiempo.
            ini_set('session.gc_maxlifetime', 30 * 24 * 60 * 60);

            // Cookie de sesión: HttpOnly + SameSite=Lax, y Secure cuando el
            // sitio se sirve por HTTPS (incluye proxies confiables).
            session_set_cookie_params([
                'lifetime' => SESSION_LIFETIME,
                'path' => '/',
                'secure' => self::isHttpsRequest(),
                'httponly' => true,
                'samesite' => 'Lax'
            ]);
            
            session_start();
            
            // Regenerar ID de sesión periódicamente
            if (!isset($_SESSION['created'])) {
                $_SESSION['created'] = time();
            } else if (time() - $_SESSION['created'] > 1800) {
                session_regenerate_id(true);
                $_SESSION['created'] = time();
            }

            if ($this->isLoggedIn()) {
                // Revalidar contra la BD (usuario activo, rol, tienda y flags)
                // y aplicar el bloqueo por contraseña pendiente de cambio.
                $this->refreshSession();
                $this->enforcePasswordChange();
            }
        }
    }

    /**
     * ¿La petición actual llegó por HTTPS? Considera proxies confiables
     * (p. ej. Cloudflare Tunnel) cuando TRUSTED_PROXY_HEADER está definido.
     */
    private static function isHttpsRequest() {
        if (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off') {
            return true;
        }
        if ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443) {
            return true;
        }
        if (getenv('TRUSTED_PROXY_HEADER')) {
            $proto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '';
            if (strtolower(trim(explode(',', $proto)[0])) === 'https') {
                return true;
            }
        }
        return false;
    }

    /**
     * Revalidar la sesión contra la base de datos: si el usuario fue
     * desactivado/eliminado se cierra la sesión; si cambió de rol/tienda se
     * actualiza. También refresca el flag de cambio de contraseña.
     * Limitado a una vez por minuto por sesión para no consultar en cada
     * petición.
     */
    private function refreshSession() {
        $last = isset($_SESSION['_revalidated_at']) ? (int)$_SESSION['_revalidated_at'] : 0;
        if (time() - $last < 60) {
            return;
        }
        try {
            $row = $this->db->selectOne(
                'SELECT status, role, store_id, must_change_password FROM users WHERE user_id = ?',
                [$_SESSION['user_id']]
            );
        } catch (Exception $e) {
            // Si la consulta falla (p. ej. migración pendiente) no bloquear
            error_log('refreshSession: ' . $e->getMessage());
            return;
        }
        if (!$row || $row['status'] !== STATUS_ACTIVE) {
            // Usuario eliminado o desactivado: cerrar la sesión
            $this->logout();
            return;
        }
        $_SESSION['role'] = $row['role'];
        $_SESSION['store_id'] = (int)$row['store_id'];
        $_SESSION['must_change_password'] = ((int)$row['must_change_password'] === 1);
        $_SESSION['_revalidated_at'] = time();
    }

    /**
     * Si el usuario tiene una contraseña pendiente de cambio (p. ej. la
     * credencial por defecto del primer arranque), bloquear todo excepto lo
     * necesario para cambiarla: perfil, sesión, logout y login.
     */
    private function enforcePasswordChange() {
        if (empty($_SESSION['must_change_password'])) {
            return;
        }
        $script = isset($_SERVER['SCRIPT_NAME']) ? str_replace('\\', '/', $_SERVER['SCRIPT_NAME']) : '';
        $allowed = [
            '/api/users/profile.php',
            '/api/stores/settings.php',
            '/api/auth/verify_session.php',
            '/api/auth/logout.php',
            '/api/auth/login.php',
            '/api/auth/permissions.php',
        ];
        foreach ($allowed as $suffix) {
            if ($script !== '' && substr($script, -strlen($suffix)) === $suffix) {
                return;
            }
        }
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => false,
            'message' => 'Debes cambiar tu contraseña antes de continuar.',
            'data'    => null,
            'error'   => 'must_change_password'
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    /**
     * Leer el flag de cambio de contraseña obligatorio del usuario.
     * Devuelve false si la columna todavía no existe (migración pendiente).
     */
    private function fetchMustChangePassword($userId) {
        try {
            $row = $this->db->selectOne(
                'SELECT must_change_password FROM users WHERE user_id = ?',
                [$userId]
            );
            return $row && (int)$row['must_change_password'] === 1;
        } catch (Exception $e) {
            error_log('fetchMustChangePassword: ' . $e->getMessage());
            return false;
        }
    }
    
    /**
     * Autenticar usuario
     * @param string $username
     * @param string $password
     * @return array|false Datos del usuario o false
     */
    public function login($username, $password) {
        $sql = "SELECT u.user_id, u.username, u.password_hash, u.full_name, u.email, u.role, u.store_id, u.status, u.show_onboarding, s.logo_url, s.store_name, s.subscription_plan 
                FROM users u
                LEFT JOIN stores s ON u.store_id = s.store_id
                WHERE u.username = ? AND u.status = ?";
        
        $user = $this->db->selectOne($sql, [$username, STATUS_ACTIVE]);
        
        if ($user && password_verify($password, $user['password_hash'])) {
            // Evitar fijación de sesión: ID nuevo tras autenticarse
            session_regenerate_id(true);
            $_SESSION['created'] = time();

            // Crear sesión
            $_SESSION['user_id'] = $user['user_id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['full_name'] = $user['full_name'];
            $_SESSION['role'] = $user['role'];
            $_SESSION['store_id'] = $user['store_id'];
            $_SESSION['logo_url'] = $user['logo_url'];
            $_SESSION['store_name'] = $user['store_name'];
            $_SESSION['subscription_plan'] = $user['subscription_plan'] ?? PLAN_FREE;
            $_SESSION['show_onboarding'] = (bool)$user['show_onboarding'];
            $_SESSION['logged_in'] = true;

            // Cambio obligatorio de contraseña (credenciales por defecto)
            $_SESSION['must_change_password'] = $this->fetchMustChangePassword((int)$user['user_id']);
            $_SESSION['_revalidated_at'] = time();
            
            // Actualizar último login
            $this->updateLastLogin($user['user_id']);
            
            unset($user['password_hash']);
            return $user;
        }
        
        return false;
    }
    
    /**
     * Cerrar sesión
     */
    public function logout() {
        session_unset();
        session_destroy();
        return true;
    }
    
    /**
     * Verificar si hay sesión activa
     * @return bool
     */
    public function isLoggedIn() {
        return isset($_SESSION['logged_in']) && $_SESSION['logged_in'] === true;
    }
    
    /**
     * Obtener usuario actual
     * @return array|null
     */
    public function getCurrentUser() {
        if (!$this->isLoggedIn()) {
            return null;
        }
        
        return [
            'user_id' => $_SESSION['user_id'],
            'username' => $_SESSION['username'],
            'full_name' => $_SESSION['full_name'],
            'role' => $_SESSION['role'],
            'store_id' => $_SESSION['store_id'],
            'logo_url' => isset($_SESSION['logo_url']) ? $_SESSION['logo_url'] : null,
            'store_name' => isset($_SESSION['store_name']) ? $_SESSION['store_name'] : null,
            'show_onboarding' => isset($_SESSION['show_onboarding']) ? $_SESSION['show_onboarding'] : true,
            'must_change_password' => !empty($_SESSION['must_change_password'])
        ];
    }
    
    /**
     * Verificar si el usuario tiene un rol específico
     * @param string|array $roles Rol o array de roles
     * @return bool
     */
    public function hasRole($roles) {
        if (!$this->isLoggedIn()) {
            return false;
        }
        
        if (is_array($roles)) {
            return in_array($_SESSION['role'], $roles);
        }
        
        return $_SESSION['role'] === $roles;
    }
    
    /**
     * Actualizar último login del usuario
     * @param int $userId
     */
    private function updateLastLogin($userId) {
        $sql = "UPDATE users SET last_login = NOW() WHERE user_id = ?";
        $this->db->update($sql, [$userId]);
    }
    
    /**
     * Hash de contraseña
     * @param string $password
     * @return string
     */
    public static function hashPassword($password) {
        return password_hash($password, PASSWORD_BCRYPT);
    }
    
    /**
     * Verificar contraseña
     * @param string $password
     * @param string $hash
     * @return bool
     */
    public static function verifyPassword($password, $hash) {
        return password_verify($password, $hash);
    }

    /**
     * Obtener plan de suscripción actual
     * @return string
     */
    public function getSubscriptionPlan() {
        return $_SESSION['subscription_plan'] ?? PLAN_FREE;
    }

    /**
     * Verificar si la tienda es Premium
     * @return bool
     */
    public function isPremium() {
        return $this->getSubscriptionPlan() === PLAN_PREMIUM;
    }

    /**
     * Verifica si se requiere acceso Premium y detiene la ejecución si no lo tiene.
     * Útil para proteger endpoints API.
     * En modo OPEN_SOURCE nunca bloquea (todas las features desbloqueadas).
     */
    public function requirePremium() {
        if (APP_MODE === 'OPEN_SOURCE') {
            return true;
        }
        if (!$this->isPremium()) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Esta función requiere un plan Premium.']);
            exit;
        }
    }
}

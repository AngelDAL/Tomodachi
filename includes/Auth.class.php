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

            // CRÍTICO: el recolector de basura de sesiones de PHP borra los
            // archivos de sesión del servidor según session.gc_maxlifetime
            // (por defecto ~24 min). Aunque la cookie del cliente dure 1 año
            // (recordarme), si el archivo del servidor se borra, el usuario
            // "pierde la sesión" sin motivo. Lo subimos a 1 año para que las
            // sesiones con recordarme persistan de verdad.
            ini_set('session.gc_maxlifetime', 365 * 24 * 60 * 60);

            // Configurar parámetros de cookie para que sea accesible en todo el proyecto
            session_set_cookie_params([
                'lifetime' => SESSION_LIFETIME,
                'path' => '/',
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
            'show_onboarding' => isset($_SESSION['show_onboarding']) ? $_SESSION['show_onboarding'] : true
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

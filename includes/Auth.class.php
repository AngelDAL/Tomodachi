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
        $sql = "SELECT u.user_id, u.username, u.password_hash, u.full_name, u.email, u.role, u.store_id, u.status, s.logo_url 
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
            'logo_url' => isset($_SESSION['logo_url']) ? $_SESSION['logo_url'] : null
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
}

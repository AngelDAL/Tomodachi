<?php
/**
 * Clase ApiAuth - Autenticación por API Token (Bearer) para integraciones
 * 
 * Permite que agentes de IA y aplicaciones externas accedan a la API con
 * un token en lugar de sesión de navegador.
 * 
 * Uso en un endpoint:
 *   $apiAuth = new ApiAuth($db);
 *   $token = $apiAuth->authenticate(); // muere con 401 si no hay token válido
 *   $token['store_id']  // tienda del token
 *   $token['scopes']    // array de scopes: read, write, custom
 *   $apiAuth->requireScope('write'); // muere con 403 si no tiene el scope
 * 
 * Alternativa combinada (sesión O token):
 *   $auth = new Auth($db);
 *   $apiAuth = new ApiAuth($db);
 *   $actor = $apiAuth->getActor($auth); // ['store_id' => N, 'via' => 'session'|'token', 'scopes' => [...]]
 */

class ApiAuth {

    private $db;

    public function __construct($database) {
        $this->db = $database;
    }

    /**
     * Obtener el token Bearer del header Authorization
     * @return string|null token plano o null si no viene
     */
    public function getBearerToken() {
        $header = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
        if (!$header) {
            // Apache puede pasar el header como REDIRECT_HTTP_AUTHORIZATION
            $header = isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']) ? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] : '';
        }
        if (preg_match('/Bearer\s+(\S+)/i', $header, $m)) {
            return $m[1];
        }
        // También aceptar header X-API-Key para clientes simples
        if (isset($_SERVER['HTTP_X_API_KEY']) && $_SERVER['HTTP_X_API_KEY']) {
            return $_SERVER['HTTP_X_API_KEY'];
        }
        return null;
    }

    /**
     * Autenticar por token Bearer
     * @return array|null datos del token válido (store_id, scopes, token_id) o null
     */
    public function authenticate() {
        $token = $this->getBearerToken();
        if (!$token) {
            return null;
        }

        $hash = hash('sha256', $token);
        $row = $this->db->selectOne(
            'SELECT token_id, store_id, name, scopes, expires_at, revoked, last_used_at
             FROM api_tokens WHERE token_hash = ? LIMIT 1',
            [$hash]
        );

        if (!$row) {
            return null;
        }

        // Revocado
        if ((int)$row['revoked'] === 1) {
            return null;
        }

        // Expirado
        if ($row['expires_at'] !== null) {
            $expires = strtotime($row['expires_at']);
            if ($expires !== false && $expires < time()) {
                return null;
            }
        }

        // La tienda debe existir y estar activa
        $store = $this->db->selectOne(
            'SELECT store_id FROM stores WHERE store_id = ? AND status = ?',
            [$row['store_id'], STATUS_ACTIVE]
        );
        if (!$store) {
            return null;
        }

        // Actualizar last_used_at (sin fallar si la actualización falla)
        try {
            $this->db->update('UPDATE api_tokens SET last_used_at = NOW() WHERE token_id = ?', [$row['token_id']]);
        } catch (Exception $e) {
            // ignorar
        }

        // Parsear scopes: "read, write" -> ['read','write']
        $scopes = array_values(array_filter(array_map('trim', explode(',', $row['scopes']))));

        return [
            'token_id'   => (int)$row['token_id'],
            'store_id'   => (int)$row['store_id'],
            'name'       => $row['name'],
            'scopes'     => $scopes,
            'expires_at' => $row['expires_at'],
        ];
    }

    /**
     * Obtener el actor actual: sesión de navegador O token Bearer.
     * @param Auth $auth instancia de Auth (sesión)
     * @return array|null ['store_id' => int, 'via' => 'session'|'token', 'scopes' => array|null, 'user_id' => int|null]
     */
    public function getActor($auth) {
        // 1. Intentar sesión
        if ($auth && $auth->isLoggedIn()) {
            $user = $auth->getCurrentUser();
            return [
                'store_id' => (int)$user['store_id'],
                'user_id'  => isset($user['user_id']) ? (int)$user['user_id'] : null,
                'via'      => 'session',
                'scopes'   => ['read', 'write', 'custom'], // sesión tiene todos los permisos según rol
                'role'     => isset($user['role']) ? $user['role'] : null,
            ];
        }

        // 2. Intentar token
        $token = $this->authenticate();
        if ($token) {
            // Las ventas/movimientos exigen user_id NOT NULL con FK. Un token no
            // tiene usuario propio: las acciones se atribuyen al admin de la tienda.
            $admin = $this->db->selectOne(
                'SELECT user_id FROM users WHERE store_id = ? AND role IN (?, ?) AND status = ? ORDER BY user_id ASC LIMIT 1',
                [$token['store_id'], ROLE_SUPER_ADMIN, ROLE_ADMIN, STATUS_ACTIVE]
            );
            return [
                'store_id' => $token['store_id'],
                'user_id'  => $admin ? (int)$admin['user_id'] : null,
                'via'      => 'token',
                'scopes'   => $token['scopes'],
                'role'     => null,
            ];
        }

        return null;
    }

    /**
     * Obtener el actor (sesión O token) o responder 401 si no hay ninguno.
     * @param Auth $auth instancia de Auth (sesión)
     * @return array actor autenticado
     */
    public function requireActor($auth) {
        $actor = $this->getActor($auth);
        if (!$actor) {
            Response::unauthorized();
        }
        return $actor;
    }

    /**
     * Verificar que el actor tenga un scope específico.
     * @param array $actor resultado de getActor()
     * @param string $scope 'read', 'write' o 'custom'
     * @return bool
     */
    public function hasScope($actor, $scope) {
        if (!$actor) {
            return false;
        }
        // Sesión: tiene todos los permisos
        if ($actor['via'] === 'session') {
            return true;
        }
        // Token: debe incluir el scope
        return in_array($scope, $actor['scopes'], true);
    }

    /**
     * Generar un token nuevo (uso interno por el endpoint de creación).
     * @param int $storeId
     * @param string $name
     * @param array $scopes ['read'], ['write'], ['custom'], etc.
     * @param string|null $expiresAt 'YYYY-MM-DD HH:MM:SS' o null
     * @return array ['token' => string, 'prefix' => string, 'token_id' => int]
     */
    public function generateToken($storeId, $name, $scopes, $expiresAt = null) {
        // Prefijo identificable: td_<store>_<rand>
        $prefix = 'td_' . $storeId . '_' . substr(bin2hex(random_bytes(3)), 0, 6);
        $secret = bin2hex(random_bytes(32)); // 64 chars hex
        $token = $prefix . '.' . $secret;

        $token_id = $this->db->insert(
            'INSERT INTO api_tokens (store_id, name, token_hash, token_prefix, scopes, expires_at, revoked)
             VALUES (?, ?, ?, ?, ?, ?, 0)',
            [$storeId, $name, hash('sha256', $token), $prefix, implode(',', $scopes), $expiresAt]
        );

        return [
            'token'    => $token,
            'prefix'   => $prefix,
            'token_id' => (int)$token_id,
        ];
    }

    /**
     * Responder 401 si no hay token válido.
     * @return array actor autenticado por token
     */
    public function requireToken() {
        $token = $this->authenticate();
        if (!$token) {
            Response::error('Token de API inválido, expirado o revocado', 401);
        }
        return $token;
    }

    /**
     * Responder 403 si el actor no tiene el scope.
     */
    public function requireScope($actor, $scope) {
        if (!$this->hasScope($actor, $scope)) {
            Response::error('El token no tiene permiso: ' . $scope, 403);
        }
    }
}

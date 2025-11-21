<?php
/**
 * Clase Database - Manejo de conexión y consultas PDO
 * Implementa prepared statements para prevención de SQL injection
 */

class Database {
    private $host;
    private $dbName;
    private $username;
    private $password;
    private $charset;
    private $conn;
    
    public function __construct() {
        $this->host = DB_HOST;
        $this->dbName = DB_NAME;
        $this->username = DB_USER;
        $this->password = DB_PASS;
        $this->charset = DB_CHARSET;
        $this->connect();
    }
    
    /**
     * Establecer conexión con la base de datos
     */
    private function connect() {
        try {
            $dsn = "mysql:host={$this->host};dbname={$this->dbName};charset={$this->charset}";
            $options = [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ];
            
            $this->conn = new PDO($dsn, $this->username, $this->password, $options);
        } catch (PDOException $e) {
            throw new Exception("Error de conexión: " . $e->getMessage());
        }
    }
    
    /**
     * Obtener la conexión PDO
     */
    public function getConnection() {
        return $this->conn;
    }
    
    /**
     * Ejecutar consulta preparada
     * @param string $sql Consulta SQL con placeholders
     * @param array $params Parámetros para bind
     * @return PDOStatement
     */
    public function query($sql, $params = []) {
        try {
            $stmt = $this->conn->prepare($sql);
            $stmt->execute($params);
            return $stmt;
        } catch (PDOException $e) {
            throw new Exception("Error en consulta: " . $e->getMessage());
        }
    }
    
    /**
     * Seleccionar múltiples registros
     * @param string $sql Consulta SELECT
     * @param array $params Parámetros
     * @return array Array de registros
     */
    public function select($sql, $params = []) {
        $stmt = $this->query($sql, $params);
        return $stmt->fetchAll();
    }
    
    /**
     * Seleccionar un solo registro
     * @param string $sql Consulta SELECT
     * @param array $params Parámetros
     * @return array|false Registro o false
     */
    public function selectOne($sql, $params = []) {
        $stmt = $this->query($sql, $params);
        return $stmt->fetch();
    }
    
    /**
     * Insertar registro
     * @param string $sql Consulta INSERT
     * @param array $params Parámetros
     * @return int ID del registro insertado
     */
    public function insert($sql, $params = []) {
        $this->query($sql, $params);
        return $this->conn->lastInsertId();
    }
    
    /**
     * Actualizar registros
     * @param string $sql Consulta UPDATE
     * @param array $params Parámetros
     * @return int Número de filas afectadas
     */
    public function update($sql, $params = []) {
        $stmt = $this->query($sql, $params);
        return $stmt->rowCount();
    }
    
    /**
     * Eliminar registros
     * @param string $sql Consulta DELETE
     * @param array $params Parámetros
     * @return int Número de filas afectadas
     */
    public function delete($sql, $params = []) {
        $stmt = $this->query($sql, $params);
        return $stmt->rowCount();
    }
    
    /**
     * Iniciar transacción
     */
    public function beginTransaction() {
        return $this->conn->beginTransaction();
    }
    
    /**
     * Confirmar transacción
     */
    public function commit() {
        return $this->conn->commit();
    }
    
    /**
     * Revertir transacción
     */
    public function rollback() {
        return $this->conn->rollback();
    }
}

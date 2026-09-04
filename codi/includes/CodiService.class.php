<?php
/**
 * CoDi Service para Tomodachi POS
 * 
 * Módulo de pagos CoDi (Cobro Digital) del Banco de México.
 * Implementación temprana v1.
 * 
 * Soporta:
 * - Generación de códigos QR para pagos
 * - Notificaciones push a apps bancarias
 * - Consulta de estado de pagos
 * - Webhooks de confirmación
 * 
 * @package Tomodachi\CoDi
 */

class CodiService
{
    /** @var Database */
    private $db;
    
    /** @var int */
    private $storeId;
    
    /** @var array */
    private $config;
    
    /** @var string */
    private $environment;
    
    /** @var string|null */
    private $providerApiKey;
    
    /** @var string|null */
    private $providerEndpoint;
    
    // Constantes de estado
    const STATUS_PENDING = 'pending';
    const STATUS_GENERATED = 'generated';
    const STATUS_PAID = 'paid';
    const STATUS_EXPIRED = 'expired';
    const STATUS_CANCELLED = 'cancelled';
    const STATUS_FAILED = 'failed';
    
    // Constantes de evento
    const EVENT_PAID = 'paid';
    const EVENT_EXPIRED = 'expired';
    const EVENT_CANCELLED = 'cancelled';
    const EVENT_FAILED = 'failed';
    
    // Métodos de pago
    const METHOD_QR = 'qr';
    const METHOD_PUSH = 'push';
    
    // Ambientes
    const ENV_SANDBOX = 'sandbox';
    const ENV_PRODUCTION = 'production';
    
    /**
     * @param Database $db
     * @param int $storeId
     * @param array $config Configuración del módulo
     */
    public function __construct(Database $db, int $storeId, array $config = [])
    {
        $this->db = $db;
        $this->storeId = $storeId;
        $this->config = array_merge($this->getDefaultConfig(), $config);
        $this->environment = $this->config['environment'] ?? self::ENV_SANDBOX;
        $this->providerApiKey = $this->config['provider_api_key'] ?? null;
        $this->providerEndpoint = $this->config['provider_endpoint'] ?? null;
    }
    
    /**
     * Obtener configuración por defecto
     */
    private function getDefaultConfig(): array
    {
        return [
            'environment' => self::ENV_SANDBOX,
            'provider' => 'portfedh', // 'portfedh' o 'banxico_direct'
            'provider_api_key' => null,
            'provider_endpoint' => null,
            'qr_expiration_minutes' => 30,
            'max_amount' => 999999.99,
            'min_amount' => 0.01,
            'auto_complete_sale' => false,
            'notify_on_payment' => true,
            'default_concept' => 'Pago en tienda',
        ];
    }
    
    /**
     * Verificar si CoDi está habilitado para la tienda
     */
    public function isEnabled(): bool
    {
        $settings = $this->db->selectOne(
            'SELECT enabled FROM codi_settings WHERE store_id = ?',
            [$this->storeId]
        );
        return $settings && (int)$settings['enabled'] === 1;
    }
    
    /**
     * Habilitar CoDi para la tienda
     */
    public function enable(string $environment = 'sandbox'): bool
    {
        $existing = $this->db->selectOne(
            'SELECT setting_id FROM codi_settings WHERE store_id = ?',
            [$this->storeId]
        );
        
        if ($existing) {
            return $this->db->update(
                'UPDATE codi_settings SET enabled = 1, environment = ?, updated_at = NOW() WHERE store_id = ?',
                [$environment, $this->storeId]
            ) !== false;
        }
        
        return $this->db->insert(
            'INSERT INTO codi_settings (store_id, environment, enabled) VALUES (?, ?, 1)',
            [$this->storeId, $environment]
        ) !== false;
    }
    
    /**
     * Deshabilitar CoDi para la tienda
     */
    public function disable(): bool
    {
        return $this->db->update(
            'UPDATE codi_settings SET enabled = 0, updated_at = NOW() WHERE store_id = ?',
            [$this->storeId]
        ) !== false;
    }
    
    /**
     * Generar un pago QR CoDi
     * 
     * @param float $amount Monto del pago
     * @param string $concept Concepto/descripción
     * @param string|null $reference Referencia interna
     * @param int|null $userId ID del usuario que genera el pago
     * @param int|null $saleId ID de venta asociada
     * @return array Resultado con QR code y folio
     * @throws Exception
     */
    public function createQrPayment(
        float $amount,
        string $concept,
        ?string $reference = null,
        ?int $userId = null,
        ?int $saleId = null
    ): array {
        // Validaciones
        $this->validateAmount($amount);
        $this->validateConcept($concept);
        
        // Generar referencia si no se proporcionó
        if (!$reference) {
            $reference = $this->generateReference();
        }
        
        // Calcular expiración
        $expiresAt = date('Y-m-d H:i:s', strtotime("+{$this->config['qr_expiration_minutes']} minutes"));
        
        // Crear registro del pago
        $paymentId = $this->db->insert(
            'INSERT INTO codi_payments (store_id, user_id, sale_id, amount, concept, reference, payment_method, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$this->storeId, $userId, $saleId, $amount, $concept, $reference, self::METHOD_QR, self::STATUS_PENDING, $expiresAt]
        );
        
        if (!$paymentId) {
            throw new Exception('Error al crear el registro de pago CoDi');
        }
        
        // Llamar al proveedor para generar el QR
        $providerResult = $this->callProvider('create_qr', [
            'amount' => $amount,
            'concept' => $concept,
            'reference' => $reference,
            'expires_at' => $expiresAt,
        ]);
        
        // Actualizar registro con datos del proveedor
        $this->db->update(
            'UPDATE codi_payments SET folio_codi = ?, qr_code = ?, status = ?, banxico_response = ?, updated_at = NOW() WHERE payment_id = ?',
            [
                $providerResult['folio_codi'] ?? null,
                $providerResult['qr_code'] ?? null,
                self::STATUS_GENERATED,
                json_encode($providerResult),
                $paymentId
            ]
        );
        
        // Auditoría
        $this->logAudit('create_qr', $paymentId, $userId, [
            'amount' => $amount,
            'concept' => $concept,
            'reference' => $reference,
        ], $providerResult);
        
        return [
            'success' => true,
            'payment_id' => $paymentId,
            'folio_codi' => $providerResult['folio_codi'] ?? null,
            'qr_code' => $providerResult['qr_code'] ?? null,
            'reference' => $reference,
            'amount' => $amount,
            'concept' => $concept,
            'expires_at' => $expiresAt,
            'status' => self::STATUS_GENERATED,
        ];
    }
    
    /**
     * Crear pago por notificación push
     * 
     * @param float $amount Monto
     * @param string $concept Concepto
     * @param string $phone Teléfono del cliente (10 dígitos)
     * @param string|null $customerName Nombre del cliente
     * @param string|null $reference Referencia interna
     * @param int|null $userId ID del usuario
     * @param int|null $saleId ID de venta asociada
     * @return array
     * @throws Exception
     */
    public function createPushPayment(
        float $amount,
        string $concept,
        string $phone,
        ?string $customerName = null,
        ?string $reference = null,
        ?int $userId = null,
        ?int $saleId = null
    ): array {
        // Validaciones
        $this->validateAmount($amount);
        $this->validateConcept($concept);
        $this->validatePhone($phone);
        
        // Generar referencia si no se proporcionó
        if (!$reference) {
            $reference = $this->generateReference();
        }
        
        // Calcular expiración
        $expiresAt = date('Y-m-d H:i:s', strtotime("+{$this->config['qr_expiration_minutes']} minutes"));
        
        // Crear registro del pago
        $paymentId = $this->db->insert(
            'INSERT INTO codi_payments (store_id, user_id, sale_id, amount, concept, reference, customer_phone, customer_name, payment_method, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$this->storeId, $userId, $saleId, $amount, $concept, $reference, $phone, $customerName, self::METHOD_PUSH, self::STATUS_PENDING, $expiresAt]
        );
        
        if (!$paymentId) {
            throw new Exception('Error al crear el registro de pago CoDi');
        }
        
        // Llamar al proveedor para enviar push
        $providerResult = $this->callProvider('create_push', [
            'amount' => $amount,
            'concept' => $concept,
            'reference' => $reference,
            'phone' => $phone,
            'customer_name' => $customerName,
            'expires_at' => $expiresAt,
        ]);
        
        // Actualizar registro
        $this->db->update(
            'UPDATE codi_payments SET folio_codi = ?, status = ?, banxico_response = ?, updated_at = NOW() WHERE payment_id = ?',
            [
                $providerResult['folio_codi'] ?? null,
                self::STATUS_GENERATED,
                json_encode($providerResult),
                $paymentId
            ]
        );
        
        // Auditoría
        $this->logAudit('create_push', $paymentId, $userId, [
            'amount' => $amount,
            'concept' => $concept,
            'phone' => $phone,
            'reference' => $reference,
        ], $providerResult);
        
        return [
            'success' => true,
            'payment_id' => $paymentId,
            'folio_codi' => $providerResult['folio_codi'] ?? null,
            'reference' => $reference,
            'amount' => $amount,
            'concept' => $concept,
            'phone' => $phone,
            'expires_at' => $expiresAt,
            'status' => self::STATUS_GENERATED,
        ];
    }
    
    /**
     * Consultar estado de un pago CoDi
     * 
     * @param int $paymentId ID del pago
     * @return array|null
     */
    public function checkStatus(int $paymentId): ?array
    {
        $payment = $this->getPayment($paymentId);
        if (!$payment) {
            return null;
        }
        
        // Si ya está pagado o cancelado, no consultar al proveedor
        if (in_array($payment['status'], [self::STATUS_PAID, self::STATUS_CANCELLED, self::STATUS_EXPIRED])) {
            return $payment;
        }
        
        // Verificar expiración local
        if ($payment['expires_at'] && strtotime($payment['expires_at']) < time()) {
            $this->updateStatus($paymentId, self::STATUS_EXPIRED);
            $payment['status'] = self::STATUS_EXPIRED;
            return $payment;
        }
        
        // Consultar al proveedor si tiene folio
        if ($payment['folio_codi']) {
            $providerResult = $this->callProvider('check_status', [
                'folio_codi' => $payment['folio_codi'],
            ]);
            
            // Si el proveedor confirma pago
            if (isset($providerResult['status']) && $providerResult['status'] === 'paid') {
                $this->confirmPayment($paymentId, $providerResult);
                $payment['status'] = self::STATUS_PAID;
                $payment['paid_at'] = date('Y-m-d H:i:s');
            }
        }
        
        return $payment;
    }
    
    /**
     * Confirmar pago CoDi (llamado por webhook o consulta)
     * 
     * @param int $paymentId
     * @param array $providerData Datos del proveedor
     * @return bool
     */
    public function confirmPayment(int $paymentId, array $providerData = []): bool
    {
        $payment = $this->getPayment($paymentId);
        if (!$payment) {
            return false;
        }
        
        // Idempotencia: si ya está pagado, no volver a procesar
        if ($payment['status'] === self::STATUS_PAID) {
            return true;
        }
        
        $this->db->beginTransaction();
        try {
            // Actualizar estado del pago
            $this->db->update(
                'UPDATE codi_payments SET status = ?, paid_at = NOW(), banxico_response = ?, updated_at = NOW() WHERE payment_id = ?',
                [self::STATUS_PAID, json_encode($providerData), $paymentId]
            );
            
            // Registrar evento
            $this->db->insert(
                'INSERT INTO codi_payment_events (codi_payment_id, event_type, provider_event_id, payload, processed) VALUES (?, ?, ?, ?, 1)',
                [$paymentId, self::EVENT_PAID, $providerData['event_id'] ?? null, json_encode($providerData)]
            );
            
            // Auto-completar venta si está configurado
            if ($this->config['auto_complete_sale'] && $payment['sale_id']) {
                $this->db->update(
                    'UPDATE sales SET codi_payment_id = ?, payment_method = ? WHERE sale_id = ?',
                    [$paymentId, 'codi', $payment['sale_id']]
                );
            }
            
            $this->db->commit();
            
            // Auditoría
            $this->logAudit('payment_confirmed', $paymentId, null, [], $providerData);
            
            return true;
        } catch (Exception $e) {
            $this->db->rollback();
            throw $e;
        }
    }
    
    /**
     * Cancelar un pago CoDi
     * 
     * @param int $paymentId
     * @param int|null $userId
     * @return bool
     */
    public function cancelPayment(int $paymentId, ?int $userId = null): bool
    {
        $payment = $this->getPayment($paymentId);
        if (!$payment) {
            return false;
        }
        
        // Solo se pueden cancelar pagos pendientes o generados
        if (!in_array($payment['status'], [self::STATUS_PENDING, self::STATUS_GENERATED])) {
            throw new Exception('No se puede cancelar un pago en estado: ' . $payment['status']);
        }
        
        $this->db->beginTransaction();
        try {
            $this->db->update(
                'UPDATE codi_payments SET status = ?, updated_at = NOW() WHERE payment_id = ?',
                [self::STATUS_CANCELLED, $paymentId]
            );
            
            $this->db->insert(
                'INSERT INTO codi_payment_events (codi_payment_id, event_type, processed) VALUES (?, ?, 1)',
                [$paymentId, self::EVENT_CANCELLED]
            );
            
            $this->db->commit();
            
            $this->logAudit('cancel', $paymentId, $userId, [], ['cancelled' => true]);
            
            return true;
        } catch (Exception $e) {
            $this->db->rollback();
            throw $e;
        }
    }
    
    /**
     * Procesar webhook de Banxico/proveedor
     * 
     * @param array $payload Datos del webhook
     * @param string $signature Firma del webhook
     * @return bool
     * @throws Exception
     */
    public function handleWebhook(array $payload, string $signature = ''): bool
    {
        // Validar firma del webhook
        if (!$this->validateWebhookSignature($payload, $signature)) {
            throw new Exception('Firma de webhook inválida');
        }
        
        $folioCodi = $payload['folio_codi'] ?? $payload['folioCoDi'] ?? null;
        $eventType = $payload['event_type'] ?? $payload['resultado'] ?? 'unknown';
        
        if (!$folioCodi) {
            throw new Exception('Webhook sin folioCoDi');
        }
        
        // Buscar pago por folio
        $payment = $this->db->selectOne(
            'SELECT payment_id, status FROM codi_payments WHERE folio_codi = ? AND store_id = ?',
            [$folioCodi, $this->storeId]
        );
        
        if (!$payment) {
            throw new Exception('Pago no encontrado para folio: ' . $folioCodi);
        }
        
        // Idempotencia por provider_event_id
        $providerEventId = $payload['event_id'] ?? $payload['id'] ?? null;
        if ($providerEventId) {
            $existing = $this->db->selectOne(
                'SELECT event_id FROM codi_payment_events WHERE provider_event_id = ?',
                [$providerEventId]
            );
            if ($existing) {
                return true; // Ya procesado
            }
        }
        
        // Mapear evento
        switch ($eventType) {
            case 'paid':
            case 'exitoso':
            case 'completed':
                return $this->confirmPayment((int)$payment['payment_id'], $payload);
                
            case 'expired':
            case 'expirado':
                return $this->updateStatus((int)$payment['payment_id'], self::STATUS_EXPIRED);
                
            case 'cancelled':
            case 'cancelado':
                return $this->updateStatus((int)$payment['payment_id'], self::STATUS_CANCELLED);
                
            case 'failed':
            case 'fallido':
                return $this->updateStatus((int)$payment['payment_id'], self::STATUS_FAILED);
                
            default:
                // Registrar evento desconocido
                $this->db->insert(
                    'INSERT INTO codi_payment_events (codi_payment_id, event_type, provider_event_id, payload) VALUES (?, ?, ?, ?)',
                    [$payment['payment_id'], $eventType, $providerEventId, json_encode($payload)]
                );
                return true;
        }
    }
    
    /**
     * Obtener un pago por ID
     */
    public function getPayment(int $paymentId): ?array
    {
        return $this->db->selectOne(
            'SELECT * FROM codi_payments WHERE payment_id = ? AND store_id = ?',
            [$paymentId, $this->storeId]
        );
    }
    
    /**
     * Obtener pagos de una tienda con filtros
     */
    public function getPayments(array $filters = [], int $page = 1, int $perPage = 20): array
    {
        $where = ['store_id = ?'];
        $params = [$this->storeId];
        
        if (isset($filters['status'])) {
            $where[] = 'status = ?';
            $params[] = $filters['status'];
        }
        
        if (isset($filters['payment_method'])) {
            $where[] = 'payment_method = ?';
            $params[] = $filters['payment_method'];
        }
        
        if (isset($filters['date_from'])) {
            $where[] = 'created_at >= ?';
            $params[] = $filters['date_from'];
        }
        
        if (isset($filters['date_to'])) {
            $where[] = 'created_at <= ?';
            $params[] = $filters['date_to'];
        }
        
        if (isset($filters['search'])) {
            $where[] = '(concept LIKE ? OR reference LIKE ? OR folio_codi LIKE ? OR customer_name LIKE ?)';
            $search = '%' . $filters['search'] . '%';
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
        }
        
        $whereClause = implode(' AND ', $where);
        $offset = ($page - 1) * $perPage;
        
        // Total
        $total = $this->db->selectOne(
            "SELECT COUNT(*) as total FROM codi_payments WHERE $whereClause",
            $params
        );
        
        // Results
        $items = $this->db->select(
            "SELECT * FROM codi_payments WHERE $whereClause ORDER BY created_at DESC LIMIT $perPage OFFSET $offset",
            $params
        );
        
        return [
            'items' => $items,
            'total' => (int)$total['total'],
            'page' => $page,
            'per_page' => $perPage,
            'total_pages' => ceil((int)$total['total'] / $perPage),
        ];
    }
    
    /**
     * Obtener estadísticas de pagos CoDi
     */
    public function getStats(string $period = 'today'): array
    {
        $dateMatch = match($period) {
            'today' => 'DATE(created_at) = CURDATE()',
            'week' => 'YEARWEEK(created_at) = YEARWEEK(NOW())',
            'month' => 'YEAR(created_at) = YEAR(NOW()) AND MONTH(created_at) = MONTH(NOW())',
            default => 'DATE(created_at) = CURDATE()',
        };
        
        $stats = $this->db->selectOne(
            "SELECT 
                COUNT(*) as total_payments,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as paid_amount,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired_count,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count
            FROM codi_payments 
            WHERE store_id = ? AND $dateMatch",
            [$this->storeId]
        );
        
        return [
            'period' => $period,
            'total_payments' => (int)$stats['total_payments'],
            'paid_count' => (int)$stats['paid_count'],
            'paid_amount' => (float)$stats['paid_amount'],
            'pending_count' => (int)$stats['pending_count'],
            'expired_count' => (int)$stats['expired_count'],
            'cancelled_count' => (int)$stats['cancelled_count'],
        ];
    }
    
    // =========================================
    // Métodos privados
    // =========================================
    
    /**
     * Llamar al proveedor de CoDi (API de portfedh o Banxico directo)
     */
    private function callProvider(string $action, array $data): array
    {
        // Si no hay configuración de proveedor, simular respuesta (sandbox)
        if (!$this->providerEndpoint || !$this->providerApiKey) {
            return $this->simulateProviderResponse($action, $data);
        }
        
        // Llamar a la API de portfedh
        $endpoint = rtrim($this->providerEndpoint, '/') . '/v2/codi/' . str_replace('create_', '', $action);
        
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $endpoint,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($data),
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'x-api-key: ' . $this->providerApiKey,
            ],
            CURLOPT_TIMEOUT => 30,
        ]);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        
        if ($error) {
            throw new Exception('Error de conexión con proveedor CoDi: ' . $error);
        }
        
        $result = json_decode($response, true);
        
        if ($httpCode >= 400) {
            throw new Exception('Error del proveedor CoDi: ' . ($result['message'] ?? "HTTP $httpCode"));
        }
        
        return $result;
    }
    
    /**
     * Simular respuesta del proveedor (modo sandbox sin credenciales)
     */
    private function simulateProviderResponse(string $action, array $data): array
    {
        $folioCodi = 'CODI-' . strtoupper(substr(md5(uniqid()), 0, 12));
        
        switch ($action) {
            case 'create_qr':
                // Generar QR localmente
                $qrData = json_encode([
                    'folio' => $folioCodi,
                    'amount' => $data['amount'],
                    'concept' => $data['concept'],
                ]);
                $qrCode = $this->generateLocalQr($qrData);
                
                return [
                    'success' => true,
                    'folio_codi' => $folioCodi,
                    'qr_code' => $qrCode,
                    'message' => 'QR generado (modo sandbox)',
                    'sandbox' => true,
                ];
                
            case 'create_push':
                return [
                    'success' => true,
                    'folio_codi' => $folioCodi,
                    'message' => 'Push notification enviada (modo sandbox)',
                    'sandbox' => true,
                ];
                
            case 'check_status':
                return [
                    'status' => 'pending',
                    'folio_codi' => $data['folio_codi'],
                    'sandbox' => true,
                ];
                
            default:
                return ['success' => true, 'sandbox' => true];
        }
    }
    
    /**
     * Generar QR localmente (sin depender de API externa)
     */
    private function generateLocalQr(string $data): string
    {
        // Usar API pública para generar QR (solo para sandbox)
        $qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' . urlencode($data);
        
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $qrApiUrl,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
        ]);
        
        $qrImage = curl_exec($ch);
        curl_close($ch);
        
        if ($qrImage) {
            return 'data:image/png;base64,' . base64_encode($qrImage);
        }
        
        // Fallback: retornar URL del QR
        return $qrApiUrl;
    }
    
    /**
     * Actualizar estado de un pago
     */
    private function updateStatus(int $paymentId, string $status): bool
    {
        return $this->db->update(
            'UPDATE codi_payments SET status = ?, updated_at = NOW() WHERE payment_id = ?',
            [$status, $paymentId]
        ) !== false;
    }
    
    /**
     * Validar monto
     */
    private function validateAmount(float $amount): void
    {
        if ($amount <= 0) {
            throw new Exception('El monto debe ser mayor a 0');
        }
        if ($amount > $this->config['max_amount']) {
            throw new Exception('El monto excede el máximo permitido: ' . $this->config['max_amount']);
        }
        if ($amount < $this->config['min_amount']) {
            throw new Exception('El monto es menor al mínimo permitido: ' . $this->config['min_amount']);
        }
    }
    
    /**
     * Validar concepto
     */
    private function validateConcept(string $concept): void
    {
        if (strlen($concept) < 3) {
            throw new Exception('El concepto debe tener al menos 3 caracteres');
        }
        if (strlen($concept) > 150) {
            throw new Exception('El concepto no puede exceder 150 caracteres');
        }
    }
    
    /**
     * Validar teléfono (10 dígitos México)
     */
    private function validatePhone(string $phone): void
    {
        $phone = preg_replace('/[^0-9]/', '', $phone);
        if (strlen($phone) !== 10) {
            throw new Exception('El teléfono debe tener 10 dígitos');
        }
    }
    
    /**
     * Generar referencia única
     */
    private function generateReference(): string
    {
        return 'TMD-' . date('Ymd') . '-' . strtoupper(substr(uniqid(), -6));
    }
    
    /**
     * Validar firma del webhook
     */
    private function validateWebhookSignature(array $payload, string $signature): bool
    {
        $secret = $this->config['webhook_secret'] ?? '';
        
        // Si no hay secreto configurado, aceptar (solo desarrollo)
        if (!$secret) {
            return true;
        }
        
        $expected = hash_hmac('sha256', json_encode($payload), $secret);
        return hash_equals($expected, $signature);
    }
    
    /**
     * Registrar en auditoría
     */
    private function logAudit(
        string $action,
        ?int $paymentId,
        ?int $userId,
        array $request,
        array $response = [],
        ?string $error = null
    ): void {
        $this->db->insert(
            'INSERT INTO codi_audit_log (store_id, user_id, codi_payment_id, action, request_payload, response_payload, error_message, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $this->storeId,
                $userId,
                $paymentId,
                $action,
                json_encode($request),
                json_encode($response),
                $error,
                $_SERVER['REMOTE_ADDR'] ?? null,
            ]
        );
    }
}

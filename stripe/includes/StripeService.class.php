<?php
/**
 * Stripe Service para Tomodachi POS
 *
 * Módulo de cobros con tarjeta vía Stripe (Payment Intents).
 *
 * Flujo:
 *  1. El POS crea un PaymentIntent (createPaymentIntent) y recibe client_secret.
 *  2. El navegador cobra la tarjeta con Stripe.js (los datos de la tarjeta
 *     NUNCA pasan por este servidor — PCI SAQ-A).
 *  3. El POS registra la venta (create_sale) pasando el payment_intent_id;
 *     este servicio lo verifica contra la API de Stripe (monto y estado).
 *  4. El webhook de Stripe mantiene el estado local sincronizado.
 *
 * @package Tomodachi\Stripe
 */

class StripeService
{
    /** @var Database */
    private $db;

    /** @var int */
    private $storeId;

    /** @var array|null Config cacheada de stripe_settings */
    private $settings;

    /** @var \Stripe\StripeClient|null */
    private $client;

    // Monedas sin decimales (el monto se envía tal cual, sin multiplicar por 100)
    const ZERO_DECIMAL_CURRENCIES = ['bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','ugx','vnd','vuv','xaf','xof','xpf'];

    /**
     * @param Database $db
     * @param int $storeId
     */
    public function __construct(Database $db, int $storeId)
    {
        $this->db = $db;
        $this->storeId = $storeId;

        $autoloadPath = __DIR__ . '/../../vendor/autoload.php';
        if (file_exists($autoloadPath)) {
            require_once $autoloadPath;
        }
    }

    // ---------------------------------------------------------------
    // Configuración
    // ---------------------------------------------------------------

    /**
     * Configuración cruda de la tienda (incluye secret_key: NO exponer en API).
     */
    public function getSettings(): array
    {
        if ($this->settings === null) {
            $row = $this->db->selectOne(
                'SELECT * FROM stripe_settings WHERE store_id = ?',
                [$this->storeId]
            );
            $this->settings = $row ?: [
                'store_id' => $this->storeId,
                'enabled' => 0,
                'currency' => 'mxn',
                'publishable_key' => null,
                'secret_key' => null,
                'webhook_secret' => null,
                'auto_complete_sale' => 1,
            ];
        }
        return $this->settings;
    }

    /**
     * ¿El módulo está habilitado y con credenciales completas?
     */
    public function isEnabled(): bool
    {
        $s = $this->getSettings();
        return (int)$s['enabled'] === 1
            && !empty($s['publishable_key'])
            && !empty($s['secret_key']);
    }

    /**
     * Datos seguros para el frontend (nunca la clave secreta).
     */
    public function getPublicConfig(): array
    {
        $s = $this->getSettings();
        return [
            'enabled' => $this->isEnabled(),
            'publishable_key' => $this->isEnabled() ? $s['publishable_key'] : null,
            'currency' => $s['currency'] ?: 'mxn',
        ];
    }

    /**
     * Guardar configuración. Las claves vacías/null no pisan las existentes.
     */
    public function saveConfig(array $data): array
    {
        $enabled = !empty($data['enabled']) ? 1 : 0;
        $currency = isset($data['currency']) ? strtolower(preg_replace('/[^a-z]/', '', (string)$data['currency'])) : 'mxn';
        if (strlen($currency) !== 3) { $currency = 'mxn'; }
        $autoComplete = array_key_exists('auto_complete_sale', $data) ? (!empty($data['auto_complete_sale']) ? 1 : 0) : 1;

        $publishable = $this->validateKeyFormat($data['publishable_key'] ?? null, 'pk_');
        // Se aceptan claves secretas estándar (sk_) y restringidas (rk_): ambas
        // operan contra el API de Stripe; rk_ permite conceder únicamente los
        // permisos necesarios (payment_intents, webhook_endpoints).
        $secret = $this->validateKeyFormat($data['secret_key'] ?? null, ['sk_', 'rk_']);
        $whSecret = $this->validateKeyFormat($data['webhook_secret'] ?? null, 'whsec_');

        $existing = $this->db->selectOne(
            'SELECT setting_id FROM stripe_settings WHERE store_id = ?',
            [$this->storeId]
        );

        if ($existing) {
            $this->db->update(
                'UPDATE stripe_settings SET enabled = ?, currency = ?, auto_complete_sale = ?,
                    publishable_key = COALESCE(?, publishable_key),
                    secret_key = COALESCE(?, secret_key),
                    webhook_secret = COALESCE(?, webhook_secret),
                    updated_at = NOW()
                 WHERE store_id = ?',
                [$enabled, $currency, $autoComplete, $publishable, $secret, $whSecret, $this->storeId]
            );
        } else {
            $this->db->insert(
                'INSERT INTO stripe_settings (store_id, enabled, currency, auto_complete_sale, publishable_key, secret_key, webhook_secret)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$this->storeId, $enabled, $currency, $autoComplete, $publishable, $secret, $whSecret]
            );
        }

        $this->settings = null;
        $this->client = null;
        $this->audit('config', null, null, ['enabled' => $enabled, 'currency' => $currency], null, 200);

        return $this->getPublicConfig();
    }

    /**
     * Valida formato de clave; devuelve null si viene vacía (no pisar).
     * @param string|string[] $prefix Prefijo válido, o lista de prefijos válidos
     * @throws Exception si el formato es inválido
     */
    private function validateKeyFormat($key, $prefix): ?string
    {
        if ($key === null || $key === '') { return null; }
        $key = trim((string)$key);
        $prefixes = is_array($prefix) ? $prefix : [$prefix];
        $valid = false;
        foreach ($prefixes as $candidate) {
            if (strpos($key, $candidate) === 0) { $valid = true; break; }
        }
        if (!$valid || strlen($key) > 255) {
            throw new Exception('La clave debe comenzar con ' . implode(' o ', $prefixes));
        }
        return $key;
    }

    /**
     * Cliente Stripe inicializado con la clave secreta de la tienda.
     * @throws Exception si no hay credenciales
     */
    private function getClient(): \Stripe\StripeClient
    {
        if ($this->client === null) {
            $s = $this->getSettings();
            if (empty($s['secret_key'])) {
                throw new Exception('Stripe no está configurado para esta tienda');
            }
            if (!class_exists('\Stripe\StripeClient')) {
                throw new Exception('SDK de Stripe no instalado (composer install)');
            }
            $this->client = new \Stripe\StripeClient($s['secret_key']);
        }
        return $this->client;
    }

    // ---------------------------------------------------------------
    // Cobros
    // ---------------------------------------------------------------

    /**
     * Convertir monto a la unidad mínima que espera Stripe (centavos).
     */
    public function toStripeAmount(float $amount, ?string $currency = null): int
    {
        $currency = strtolower($currency ?: ($this->getSettings()['currency'] ?: 'mxn'));
        if (in_array($currency, self::ZERO_DECIMAL_CURRENCIES, true)) {
            return (int)round($amount);
        }
        return (int)round($amount * 100);
    }

    /**
     * Crear un PaymentIntent y registrarlo localmente.
     *
     * @return array {payment_id, payment_intent_id, client_secret, publishable_key, amount, currency}
     * @throws Exception
     */
    public function createPaymentIntent(float $amount, string $concept, int $userId, ?int $saleId = null): array
    {
        $start = microtime(true);
        $s = $this->getSettings();
        $currency = strtolower($s['currency'] ?: 'mxn');
        $amountCents = $this->toStripeAmount($amount, $currency);

        if ($amountCents < 50 && !in_array($currency, self::ZERO_DECIMAL_CURRENCIES, true)) {
            throw new Exception('El monto mínimo de cobro es 0.50');
        }

        $concept = mb_substr(trim($concept) !== '' ? trim($concept) : 'Cobro en tienda', 0, 150);

        try {
            $intent = $this->getClient()->paymentIntents->create([
                'amount' => $amountCents,
                'currency' => $currency,
                'description' => $concept,
                // allow_redirects=never: esto es un cobro presencial en el POS. Los
                // métodos con redirección (OXXO, transferencia bancaria) exigen
                // return_url y harían fallar la confirmación del PaymentIntent.
                'automatic_payment_methods' => ['enabled' => true, 'allow_redirects' => 'never'],
                'metadata' => [
                    'store_id' => (string)$this->storeId,
                    'source' => 'tomodachi_pos',
                ],
            ]);
        } catch (\Stripe\Exception\ApiErrorException $e) {
            $this->audit('create_intent', null, $userId,
                ['amount_cents' => $amountCents, 'currency' => $currency],
                null, $e->getHttpStatus() ?: 500, $e->getMessage(), $start);
            throw new Exception('No se pudo crear el cobro en Stripe');
        }

        $paymentId = $this->db->insert(
            'INSERT INTO stripe_payments (store_id, user_id, sale_id, stripe_payment_intent_id, amount, amount_cents, currency, concept, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$this->storeId, $userId, $saleId, $intent->id, $amount, $amountCents, $currency, $concept, $intent->status]
        );

        $this->audit('create_intent', $paymentId, $userId,
            ['amount_cents' => $amountCents, 'currency' => $currency],
            ['payment_intent' => $intent->id, 'status' => $intent->status], 200, null, $start);

        return [
            'payment_id' => $paymentId,
            'payment_intent_id' => $intent->id,
            'client_secret' => $intent->client_secret,
            'publishable_key' => $s['publishable_key'],
            'amount' => $amount,
            'currency' => $currency,
        ];
    }

    /**
     * Consultar el estado actual en Stripe y sincronizar el registro local.
     *
     * @return array Fila local actualizada + status
     * @throws Exception
     */
    public function syncPayment(string $paymentIntentId): array
    {
        $start = microtime(true);
        $payment = $this->db->selectOne(
            'SELECT * FROM stripe_payments WHERE stripe_payment_intent_id = ? AND store_id = ?',
            [$paymentIntentId, $this->storeId]
        );
        if (!$payment) {
            throw new Exception('Cobro no encontrado');
        }

        try {
            $intent = $this->getClient()->paymentIntents->retrieve($paymentIntentId, [
                'expand' => ['latest_charge'],
            ]);
        } catch (\Stripe\Exception\ApiErrorException $e) {
            $this->audit('sync', (int)$payment['payment_id'], null, null, null, $e->getHttpStatus() ?: 500, $e->getMessage(), $start);
            throw new Exception('No se pudo consultar el cobro en Stripe');
        }

        $this->applyIntentState($payment, $intent);
        $this->audit('sync', (int)$payment['payment_id'], null, null,
            ['status' => $intent->status], 200, null, $start);

        return $this->db->selectOne(
            'SELECT payment_id, stripe_payment_intent_id, amount, currency, concept, status, card_brand, card_last4, paid_at, sale_id, created_at
             FROM stripe_payments WHERE payment_id = ?',
            [$payment['payment_id']]
        );
    }

    /**
     * Verificar un PaymentIntent para amarrarlo a una venta.
     * Condiciones: existe, es de esta tienda, está cobrado (succeeded),
     * el monto coincide con el total de la venta y no está ligado a otra venta.
     * Si el estado local está desactualizado, consulta Stripe en vivo.
     *
     * @return int payment_id local
     * @throws Exception con mensaje seguro para el cajero
     */
    public function verifyIntentForSale(string $paymentIntentId, float $expectedTotal): int
    {
        $payment = $this->db->selectOne(
            'SELECT * FROM stripe_payments WHERE stripe_payment_intent_id = ? AND store_id = ?',
            [$paymentIntentId, $this->storeId]
        );
        if (!$payment) {
            throw new Exception('El cobro Stripe no existe en esta tienda');
        }
        if (!empty($payment['sale_id'])) {
            throw new Exception('Este cobro ya fue aplicado a otra venta');
        }

        if ($payment['status'] !== 'succeeded') {
            $payment = $this->syncPayment($paymentIntentId);
        }
        if ($payment['status'] !== 'succeeded') {
            throw new Exception('El pago con tarjeta no fue confirmado');
        }

        $expectedCents = $this->toStripeAmount($expectedTotal, $payment['currency']);
        if ((int)$payment['amount_cents'] !== $expectedCents) {
            throw new Exception('El monto cobrado no coincide con el total de la venta');
        }

        return (int)$payment['payment_id'];
    }

    /**
     * Vincular el cobro con la venta registrada.
     */
    public function linkToSale(int $paymentId, int $saleId): void
    {
        $this->db->update(
            'UPDATE stripe_payments SET sale_id = ?, updated_at = NOW() WHERE payment_id = ? AND store_id = ? AND sale_id IS NULL',
            [$saleId, $paymentId, $this->storeId]
        );
    }

    /**
     * Cancelar un PaymentIntent local (solo si no ha sido cobrado).
     * @throws Exception
     */
    public function cancelPayment(int $paymentId): array
    {
        $start = microtime(true);
        $payment = $this->db->selectOne(
            'SELECT * FROM stripe_payments WHERE payment_id = ? AND store_id = ?',
            [$paymentId, $this->storeId]
        );
        if (!$payment) {
            throw new Exception('Cobro no encontrado');
        }
        if (in_array($payment['status'], ['succeeded', 'canceled'], true)) {
            throw new Exception('El cobro ya no se puede cancelar');
        }

        try {
            $intent = $this->getClient()->paymentIntents->cancel($payment['stripe_payment_intent_id']);
        } catch (\Stripe\Exception\ApiErrorException $e) {
            $this->audit('cancel', $paymentId, null, null, null, $e->getHttpStatus() ?: 500, $e->getMessage(), $start);
            throw new Exception('No se pudo cancelar el cobro en Stripe');
        }

        $this->db->update(
            'UPDATE stripe_payments SET status = ?, updated_at = NOW() WHERE payment_id = ?',
            [$intent->status, $paymentId]
        );
        $this->audit('cancel', $paymentId, null, null, ['status' => $intent->status], 200, null, $start);

        return ['payment_id' => $paymentId, 'status' => $intent->status];
    }

    /**
     * Listar cobros de la tienda con filtros opcionales.
     */
    public function listPayments(array $filters = []): array
    {
        $where = ['store_id = ?'];
        $params = [$this->storeId];

        if (!empty($filters['status'])) {
            $where[] = 'status = ?';
            $params[] = $filters['status'];
        }
        if (!empty($filters['from'])) {
            $where[] = 'created_at >= ?';
            $params[] = $filters['from'] . ' 00:00:00';
        }
        if (!empty($filters['to'])) {
            $where[] = 'created_at <= ?';
            $params[] = $filters['to'] . ' 23:59:59';
        }

        $limit = isset($filters['limit']) ? min(200, max(1, (int)$filters['limit'])) : 50;

        return $this->db->select(
            'SELECT payment_id, sale_id, stripe_payment_intent_id, amount, currency, concept, status,
                    card_brand, card_last4, last_error, paid_at, created_at
             FROM stripe_payments
             WHERE ' . implode(' AND ', $where) . '
             ORDER BY payment_id DESC
             LIMIT ' . $limit,
            $params
        );
    }

    // ---------------------------------------------------------------
    // Webhook
    // ---------------------------------------------------------------

    /**
     * Procesar un webhook de Stripe con verificación de firma e idempotencia.
     *
     * @param string $rawBody Cuerpo crudo de la petición
     * @param string $signatureHeader Header Stripe-Signature
     * @throws Exception si la firma es inválida
     */
    public function handleWebhook(string $rawBody, string $signatureHeader): void
    {
        $start = microtime(true);
        $s = $this->getSettings();
        if (empty($s['webhook_secret'])) {
            throw new Exception('Firma de webhook no configurada');
        }

        try {
            $event = \Stripe\Webhook::constructEvent($rawBody, $signatureHeader, $s['webhook_secret']);
        } catch (\Stripe\Exception\SignatureVerificationException $e) {
            $this->audit('webhook', null, null, null, null, 401, 'Firma inválida', $start);
            throw new Exception('Firma de webhook inválida');
        } catch (\UnexpectedValueException $e) {
            $this->audit('webhook', null, null, null, null, 400, 'Payload inválido', $start);
            throw new Exception('Payload de webhook inválido');
        }

        // Idempotencia: el evento ya registrado no se reprocesa
        $existing = $this->db->selectOne(
            'SELECT event_id, processed FROM stripe_payment_events WHERE stripe_event_id = ?',
            [$event->id]
        );
        if ($existing) {
            return;
        }

        $intent = $event->data->object;
        $payment = null;
        if (isset($intent->id) && strpos((string)$intent->id, 'pi_') === 0) {
            $payment = $this->db->selectOne(
                'SELECT * FROM stripe_payments WHERE stripe_payment_intent_id = ? AND store_id = ?',
                [$intent->id, $this->storeId]
            );
        }

        $eventId = $this->db->insert(
            'INSERT INTO stripe_payment_events (stripe_payment_id, stripe_event_id, event_type, payload, processed)
             VALUES (?, ?, ?, ?, 0)',
            [$payment ? (int)$payment['payment_id'] : null, $event->id, $event->type, $rawBody]
        );

        $processed = false;
        if ($payment && in_array($event->type, [
            'payment_intent.succeeded',
            'payment_intent.payment_failed',
            'payment_intent.canceled',
            'payment_intent.processing',
            'payment_intent.requires_action',
        ], true)) {
            $this->applyIntentState($payment, $intent);
            $processed = true;
        }

        $this->db->update(
            'UPDATE stripe_payment_events SET processed = ? WHERE event_id = ?',
            [$processed ? 1 : 0, $eventId]
        );
        $this->audit('webhook', $payment ? (int)$payment['payment_id'] : null, null,
            ['event_type' => $event->type], ['event_id' => $event->id, 'processed' => $processed], 200, null, $start);
    }

    /**
     * Volcar el estado de un PaymentIntent de Stripe al registro local.
     * @param array $payment Fila local actual
     * @param object $intent PaymentIntent de Stripe
     */
    private function applyIntentState(array $payment, $intent): void
    {
        $status = in_array($intent->status, [
            'requires_payment_method','requires_confirmation','requires_action',
            'processing','succeeded','canceled',
        ], true) ? $intent->status : 'failed';

        $chargeId = null;
        $cardBrand = null;
        $cardLast4 = null;
        $charge = $intent->latest_charge ?? null;
        if (is_string($charge)) {
            $chargeId = $charge;
        } elseif ($charge) {
            $chargeId = $charge->id ?? null;
            $details = $charge->payment_method_details->card ?? null;
            if ($details) {
                $cardBrand = $details->brand ?? null;
                $cardLast4 = $details->last4 ?? null;
            }
        }

        $lastError = null;
        if (!empty($intent->last_payment_error) && !empty($intent->last_payment_error->message)) {
            $lastError = mb_substr((string)$intent->last_payment_error->message, 0, 255);
        } elseif ($status === 'failed') {
            $lastError = 'El pago no se completó';
        }

        $paidAt = ($status === 'succeeded' && empty($payment['paid_at'])) ? date('Y-m-d H:i:s') : null;

        $this->db->update(
            'UPDATE stripe_payments SET status = ?, stripe_charge_id = COALESCE(?, stripe_charge_id),
                card_brand = COALESCE(?, card_brand), card_last4 = COALESCE(?, card_last4),
                last_error = ?, paid_at = COALESCE(?, paid_at), updated_at = NOW()
             WHERE payment_id = ?',
            [$status, $chargeId, $cardBrand, $cardLast4, $lastError, $paidAt, (int)$payment['payment_id']]
        );
    }

    // ---------------------------------------------------------------
    // Auditoría (sin datos sensibles)
    // ---------------------------------------------------------------

    private function audit(string $action, ?int $paymentId, ?int $userId, $request, $response, ?int $httpStatus, ?string $error = null, ?float $start = null): void
    {
        try {
            $this->db->insert(
                'INSERT INTO stripe_audit_log (store_id, user_id, stripe_payment_id, action, request_payload, response_payload, http_status, error_message, ip_address, duration_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $this->storeId,
                    $userId,
                    $paymentId,
                    $action,
                    $request !== null ? json_encode($request, JSON_UNESCAPED_UNICODE) : null,
                    $response !== null ? json_encode($response, JSON_UNESCAPED_UNICODE) : null,
                    $httpStatus,
                    $error !== null ? mb_substr($error, 0, 500) : null,
                    $_SERVER['REMOTE_ADDR'] ?? null,
                    $start !== null ? (int)round((microtime(true) - $start) * 1000) : null,
                ]
            );
        } catch (Exception $e) {
            // La auditoría nunca debe romper el flujo del cobro
        }
    }
}

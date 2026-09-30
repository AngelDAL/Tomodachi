<?php
require_once __DIR__ . '/RequestContext.class.php';
/**
 * HealthCheck — liveness y readiness REALES de Tomodachi POS.
 * Lo consumen `api/health/live.php` y `api/health/ready.php`.
 *
 * POR QUÉ EXISTE
 * El HEALTHCHECK del contenedor apuntaba a `api/auth/permissions.php`, un
 * endpoint estático: no toca la base de datos, así que respondía 200 (exit 0)
 * incluso con la BD caída (verificado: `/api/auth/verify_session.php` daba 500
 * en el mismo servidor, en el mismo momento). Docker decía `healthy` de un
 * contenedor que no podía atender nada, y `restart: unless-stopped` no
 * reacciona a `unhealthy`, así que nadie se enteraba.
 * Además ese endpoint llama `session_start()`: el chequeo cada 30 s creaba un
 * archivo de sesión por corrida (2,880/día en el volumen `app_sessions`).
 *
 * QUÉ COMPRUEBA `ready`
 *   db                 SELECT 1 con PDO::ATTR_TIMEOUT = 2 s
 *   config             configuración inyectada en runtime (DB_* + config/database.php)
 *   schema_control     tabla de control de migraciones (`schema_migrations`)
 *   migrations_pending migraciones del repo sin registrar en la tabla de control
 *   migrations_failed  migraciones con `status='failed'` en la tabla de control
 *                      (desde TAB-39; antes se registraban como aplicadas)
 *   storage            escritura en uploads/sesiones + espacio libre > HEALTH_MIN_FREE_MB
 *
 * ESTADOS Y CÓDIGOS
 *   200 ok         todo bien
 *   200 degraded   algo se degradó pero la app atiende (p. ej. migración fallida)
 *   503 not_ready  falta esquema o hay migraciones pendientes: todavía no está listo
 *   503 down       BD, disco o configuración: no puede atender
 *   Los checks en `unknown` son informativos y NO cambian el código HTTP.
 *
 * INVARIANTES (no negociables, ver AGENTS.md)
 * - NO abre sesión: nada de `session_start()` (esto corre cada 30 s).
 * - NO lee, ni valida, ni acepta `store_id`: aquí no hay tienda en juego, así
 *   que el aislamiento multi-tienda no se toca (ni se puede tocar).
 * - Solo LEE: ninguna escritura, ningún DDL.
 * - El detalle de los checks solo se expone a loopback o con `X-Health-Token`
 *   (ver `detailAllowed()`); hacia fuera, el cuerpo es `{"status":"…"}`.
 * - Los detalles nunca llevan credenciales ni el DSN; el mensaje completo del
 *   error va al log del servidor (`error_log`).
 *
 * Es una CLASE y no código suelto en el endpoint para poder probar la matriz de
 * estados sin base de datos: `tests/health_check_test.php` (sin dependencias).
 */
class HealthCheck
{
    /** Todo en orden. */
    public const OK = 'ok';
    /** Degradado pero atendiendo (código 200). */
    public const DEGRADED = 'degraded';
    /** No listo para recibir tráfico todavía (código 503). */
    public const NOT_READY = 'not_ready';
    /** No puede atender: BD, disco o configuración (código 503). */
    public const DOWN = 'down';
    /** No se pudo determinar (informativo: no cambia el código HTTP). */
    public const UNKNOWN = 'unknown';

    /** Direcciones de loopback aceptadas (IPv4, IPv6 y IPv4 mapeada). */
    public const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1'];

    /** Tabla de control que crea `docker/entrypoint.sh`. */
    public const CONTROL_TABLE = 'schema_migrations';

    /** Tabla de fallos de migración de ediciones antiguas (compatibilidad). */
    public const FAILURE_TABLE = 'schema_migration_failures';

    /** Tope de espera al conectar a la BD, en segundos (el HEALTHCHECK corta a los 3 s). */
    public const DB_TIMEOUT = 2.0;

    /** Espacio libre mínimo por defecto en el disco de la app, en MB. */
    public const DEFAULT_MIN_FREE_MB = 200;

    /**
     * Severidad para resolver el estado global: el peor check gana.
     * `unknown` pesa como `ok` a propósito: no cambia el código HTTP.
     */
    private const SEVERITY = [
        self::OK => 0,
        self::UNKNOWN => 0,
        self::DEGRADED => 1,
        self::NOT_READY => 2,
        self::DOWN => 3,
    ];

    /** Código HTTP de cada estado. */
    private const HTTP_CODE = [
        self::OK => 200,
        self::UNKNOWN => 200,
        self::DEGRADED => 200,
        self::NOT_READY => 503,
        self::DOWN => 503,
    ];

    // ------------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------------

    /**
     * Resultado de un check individual.
     *
     * @param string $status Uno de OK / DEGRADED / NOT_READY / DOWN / UNKNOWN
     * @param string $detail Explicación corta para un operador (sin secretos)
     */
    public static function result(string $status, string $detail): array
    {
        return ['status' => $status, 'detail' => $detail];
    }

    /** Dirección de loopback (el healthcheck de Docker entra por aquí). */
    public static function isLoopback(?string $addr): bool
    {
        return $addr !== null && in_array($addr, self::LOOPBACK, true);
    }

    /**
     * ¿Se puede exponer el detalle de los checks?
     * Sí si la petición viene de loopback, o si trae `X-Health-Token` y ese
     * token coincide con `HEALTH_TOKEN` (comparación en tiempo constante).
     * Sin HEALTH_TOKEN configurado, un token cualquiera NO abre el detalle.
     */
    public static function detailAllowed(?string $remoteAddr, ?string $token, string $expectedToken): bool
    {
        if (self::isLoopback($remoteAddr)) {
            return true;
        }
        if ($expectedToken === '' || $token === null || $token === '') {
            return false;
        }
        return hash_equals($expectedToken, (string) $token);
    }

    /** Umbral de espacio libre (MB): constante de runtime, luego default. */
    public static function minFreeMb(?int $override = null): int
    {
        if ($override !== null) {
            return $override;
        }
        return defined('HEALTH_MIN_FREE_MB') ? (int) HEALTH_MIN_FREE_MB : self::DEFAULT_MIN_FREE_MB;
    }

    /** Directorio de migraciones del repo (relativo a esta clase). */
    public static function defaultMigrationsDir(): string
    {
        return dirname(__DIR__) . '/database/migrations';
    }

    /**
     * Directorio de sesiones PHP tal como lo ve este proceso.
     * `session.save_path` puede venir como "N;/ruta" o "2;/ruta;3;/otra".
     */
    public static function sessionDir(?string $savePath = null): string
    {
        $path = $savePath !== null ? $savePath : (string) ini_get('session.save_path');
        if ($path === '') {
            return sys_get_temp_dir();
        }
        $parts = explode(';', $path);
        $last = trim((string) end($parts));
        return $last !== '' ? $last : sys_get_temp_dir();
    }

    /**
     * Conexión a la BD para el chequeo.
     *
     * Usa EXACTAMENTE las mismas constantes que `includes/Database.class.php`
     * (DB_HOST, DB_NAME, DB_USER, DB_PASS, DB_CHARSET): si esa clase se conecta,
     * el healthcheck también; si el healthcheck no puede, la app tampoco.
     * (A propósito NO se añade una variable nueva tipo DB_PORT: un healthcheck
     * que se conecta distinto que la app miente.)
     *
     * @return array{pdo: ?PDO, code: ?string} `code` es el SQLSTATE del fallo.
     */
    public static function connect(float $timeout = self::DB_TIMEOUT): array
    {
        $host = defined('DB_HOST') ? (string) DB_HOST : '';
        $name = defined('DB_NAME') ? (string) DB_NAME : '';
        $user = defined('DB_USER') ? (string) DB_USER : '';
        $pass = defined('DB_PASS') ? (string) DB_PASS : '';
        $charset = defined('DB_CHARSET') && DB_CHARSET !== '' ? (string) DB_CHARSET : 'utf8mb4';

        if ($host === '' || $name === '' || $user === '') {
            return ['pdo' => null, 'code' => 'config'];
        }

        try {
            $dsn = "mysql:host={$host};dbname={$name};charset={$charset}";
            $pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                // Tope de espera al conectar: nunca se cuelga más que el
                // timeout del HEALTHCHECK.
                PDO::ATTR_TIMEOUT => (int) max(1, ceil($timeout)),
            ]);
            return ['pdo' => $pdo, 'code' => null];
        } catch (Throwable $e) {
            // Credenciales/host solo al log del servidor, nunca al cliente.
            RequestContext::error('HealthCheck::connect - ' . $e->getMessage());
            return ['pdo' => null, 'code' => $e->getCode() !== '' ? (string) $e->getCode() : 'error'];
        }
    }

    // ------------------------------------------------------------------
    // Checks individuales
    // ------------------------------------------------------------------

    /**
     * `db`: la base de datos responde.
     *
     * @param mixed $pdo Conexión PDO real, o un doble de prueba (tests/)
     * @param float $timeout Tope de conexión en segundos
     */
    public static function checkDb($pdo = null, float $timeout = self::DB_TIMEOUT): array
    {
        $code = null;
        if ($pdo === null) {
            $conn = self::connect($timeout);
            $pdo = $conn['pdo'];
            $code = $conn['code'];
        }
        if ($pdo === null) {
            return self::result(self::DOWN, $code === 'config'
                ? 'configuración de BD incompleta'
                : 'sin conexión a la base de datos' . ($code ? " (SQLSTATE {$code})" : ''));
        }
        try {
            $pdo->query('SELECT 1');
            return self::result(self::OK, 'SELECT 1 respondió');
        } catch (Throwable $e) {
            RequestContext::error('HealthCheck::checkDb - ' . $e->getMessage());
            return self::result(self::DOWN, 'la consulta de prueba falló'
                . ($e->getCode() !== '' ? ' (SQLSTATE ' . $e->getCode() . ')' : ''));
        }
    }

    /**
     * `config`: configuración que TIENE que venir inyectada en runtime.
     * Si falta `config/database.php` o alguna credencial, la app no arranca
     * bien y el contenedor no debe declararse listo.
     */
    public static function checkConfig(array $opts = []): array
    {
        $missing = [];
        foreach (['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_CHARSET'] as $const) {
            if (!defined($const) || (string) constant($const) === '') {
                $missing[] = $const;
            }
        }
        $configFile = $opts['config_file'] ?? (dirname(__DIR__) . '/config/database.php');
        if (!is_file($configFile)) {
            $missing[] = 'config/database.php';
        }
        if ($missing !== []) {
            return self::result(self::DOWN, 'falta configuración: ' . implode(', ', $missing));
        }
        return self::result(self::OK, 'configuración en runtime presente');
    }

    /** Consulta a information_schema: ¿existe la tabla en la BD actual? */
    private static function tableExists($pdo, string $table): bool
    {
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?'
        );
        $stmt->execute([$table]);
        return (int) $stmt->fetchColumn() > 0;
    }

    /** Consulta a information_schema: ¿existe la columna en esa tabla? */
    private static function columnExists($pdo, string $table, string $column): bool
    {
        $stmt = $pdo->prepare(
            'SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?'
        );
        $stmt->execute([$table, $column]);
        return (int) $stmt->fetchColumn() > 0;
    }

    /** `schema_control`: existe la tabla de control de migraciones. */
    public static function checkSchemaControl($pdo, string $table = self::CONTROL_TABLE): array
    {
        try {
            if (!self::tableExists($pdo, $table)) {
                return self::result(self::NOT_READY, "falta la tabla de control `{$table}` (esquema sin inicializar)");
            }
            return self::result(self::OK, "tabla de control `{$table}` presente");
        } catch (Throwable $e) {
            RequestContext::error('HealthCheck::checkSchemaControl - ' . $e->getMessage());
            return self::result(self::UNKNOWN, 'no se pudo consultar el esquema');
        }
    }

    /**
     * `migrations_pending`: migraciones versionadas en el repo que NO están
     * registradas como aplicadas. El entrypoint las aplica al arrancar; si
     * quedan pendientes con el contenedor arriba, algo se saltó el arranque.
     */
    public static function checkMigrationsPending($pdo, ?string $dir = null, string $table = self::CONTROL_TABLE): array
    {
        $dir = $dir ?? self::defaultMigrationsDir();
        if (!is_dir($dir)) {
            return self::result(self::DOWN, 'no se pudo leer el directorio de migraciones');
        }
        $files = glob(rtrim($dir, '/') . '/*.sql');
        if ($files === false) {
            return self::result(self::DOWN, 'no se pudo leer el directorio de migraciones');
        }
        $known = array_map('basename', $files);

        try {
            $stmt = $pdo->query("SELECT version FROM `{$table}`");
            $applied = $stmt->fetchAll(PDO::FETCH_COLUMN);
        } catch (Throwable $e) {
            RequestContext::error('HealthCheck::checkMigrationsPending - ' . $e->getMessage());
            return self::result(self::UNKNOWN, 'no se pudo leer la tabla de control');
        }
        $applied = array_map('strval', is_array($applied) ? $applied : []);
        $pending = array_values(array_diff($known, $applied));

        if ($pending !== []) {
            $muestra = implode(', ', array_slice($pending, 0, 5));
            $extra = count($pending) > 5 ? ' (+' . (count($pending) - 5) . ' más)' : '';
            return self::result(self::NOT_READY, count($pending) . ' migración(es) pendiente(s): ' . $muestra . $extra);
        }
        return self::result(self::OK, count($known) . ' migraciones versionadas, todas registradas');
    }

    /**
     * `migrations_failed`: migraciones que fallaron al aplicarse.
     *
     * Desde TAB-39 la tabla de control las distingue: `docker/migrations.sh` marca
     * la fila `status='failed'` y guarda el stderr del cliente en `error_text`
     * (además de loguearlo). Este check cuenta esas filas:
     *   > 0 filas → degraded (200)  ·  0 filas → ok
     * El número viaja en el campo `failed` del propio check, para que un monitor
     * pueda leerlo sin parsear el texto:
     *   {"status":"degraded","detail":"…","failed":1}
     *
     * COMPATIBILIDAD
     * - Esquema viejo (código nuevo con base que aún no tiene la columna `status`,
     *   p. ej. contenedor sin reiniciar): el dato NO existe, así que se responde
     *   `unknown` con la instrucción en vez de un `ok` que mentiría.
     * - Ediciones que registraban los fallos en una tabla aparte
     *   (`schema_migration_failures`): se sigue leyendo si esa tabla existe.
     */
    public static function checkMigrationsFailed($pdo, string $controlTable = self::CONTROL_TABLE, string $failureTable = self::FAILURE_TABLE): array
    {
        try {
            if (!self::tableExists($pdo, $controlTable)) {
                return self::result(self::UNKNOWN, "sin tabla de control `{$controlTable}`");
            }

            if (self::columnExists($pdo, $controlTable, 'status')) {
                $stmt = $pdo->prepare("SELECT COUNT(*) FROM `{$controlTable}` WHERE status = 'failed'");
                $stmt->execute();
                $failed = (int) $stmt->fetchColumn();
                if ($failed > 0) {
                    return self::result(
                        self::DEGRADED,
                        "{$failed} migración(es) fallida(s) en `{$controlTable}`: `docker/schema_status.sh` las lista con su error"
                    ) + ['failed' => $failed];
                }
                return self::result(self::OK, 'sin migraciones fallidas registradas') + ['failed' => 0];
            }

            if (self::tableExists($pdo, $failureTable)) {
                $stmt = $pdo->query("SELECT COUNT(*) FROM `{$failureTable}`");
                $failed = (int) $stmt->fetchColumn();
                if ($failed > 0) {
                    return self::result(self::DEGRADED, "{$failed} migración(es) fallida(s) registrada(s): revisar `{$failureTable}`") + ['failed' => $failed];
                }
                return self::result(self::OK, 'sin migraciones fallidas registradas') + ['failed' => 0];
            }

            return self::result(
                self::UNKNOWN,
                "la tabla de control `{$controlTable}` no distingue estados (falta la columna status): reinicia el contenedor para que el arranque añada las columnas"
            );
        } catch (Throwable $e) {
            RequestContext::error('HealthCheck::checkMigrationsFailed - ' . $e->getMessage());
            return self::result(self::UNKNOWN, 'no se pudo consultar el registro de fallos');
        }
    }

    /**
     * `storage`: la app puede escribir y le queda disco.
     * Por defecto revisa el volumen de uploads y el directorio de sesiones, y
     * mide el espacio libre en la raíz de la aplicación.
     * Un umbral de 0 desactiva el aviso de espacio (no el de escritura).
     */
    public static function checkStorage(array $opts = []): array
    {
        $raiz = dirname(__DIR__);
        $paths = $opts['storage_paths'] ?? [$raiz . '/public/assets/images', self::sessionDir($opts['session_dir'] ?? null)];
        $minMb = self::minFreeMb(isset($opts['min_free_mb']) ? (int) $opts['min_free_mb'] : null);

        $problemas = [];
        foreach ($paths as $path) {
            if (!is_dir($path) || !is_writable($path)) {
                $problemas[] = "{$path} no escribible";
            }
        }

        $free = @disk_free_space($opts['storage_root'] ?? $raiz);
        $freeMb = $free === false ? null : (int) floor($free / 1048576);
        if ($freeMb === null) {
            $problemas[] = 'no se pudo medir el espacio libre';
        } elseif ($minMb > 0 && $freeMb <= $minMb) {
            $problemas[] = "espacio libre {$freeMb} MB <= mínimo {$minMb} MB";
        }

        if ($problemas !== []) {
            return self::result(self::DOWN, implode('; ', $problemas));
        }
        return self::result(self::OK, 'escritura OK; libre ' . $freeMb . ' MB (mínimo ' . $minMb . ' MB)');
    }

    // ------------------------------------------------------------------
    // Evaluación completa
    // ------------------------------------------------------------------

    /**
     * Corre todos los checks y resuelve el estado global (el peor gana).
     *
     * @param array $opts pdo, timeout, migrations_dir, control_table, failure_table,
     *                    storage_paths, storage_root, session_dir, min_free_mb, config_file
     * @return array{status: string, http_code: int, checks: array<string, array{status: string, detail: string}>}
     */
    public static function evaluate(array $opts = []): array
    {
        $timeout = (float) ($opts['timeout'] ?? self::DB_TIMEOUT);
        $checks = [];

        $checks['config'] = self::checkConfig($opts);

        $pdo = $opts['pdo'] ?? null;
        $connectCode = null;
        if ($pdo === null) {
            $conn = self::connect($timeout);
            $pdo = $conn['pdo'];
            $connectCode = $conn['code'];
        }

        if ($pdo === null) {
            $checks['db'] = self::result(self::DOWN, $connectCode === 'config'
                ? 'configuración de BD incompleta'
                : 'sin conexión a la base de datos' . ($connectCode ? " (SQLSTATE {$connectCode})" : ''));
        } else {
            $checks['db'] = self::checkDb($pdo, $timeout);
        }

        if ($checks['db']['status'] === self::OK) {
            $checks['schema_control'] = self::checkSchemaControl($pdo, $opts['control_table'] ?? self::CONTROL_TABLE);
            if ($checks['schema_control']['status'] === self::OK) {
                $checks['migrations_pending'] = self::checkMigrationsPending(
                    $pdo,
                    $opts['migrations_dir'] ?? null,
                    $opts['control_table'] ?? self::CONTROL_TABLE
                );
                $checks['migrations_failed'] = self::checkMigrationsFailed(
                    $pdo,
                    $opts['control_table'] ?? self::CONTROL_TABLE,
                    $opts['failure_table'] ?? self::FAILURE_TABLE
                );
            } else {
                $checks['migrations_pending'] = self::result(self::UNKNOWN, 'sin tabla de control');
                $checks['migrations_failed'] = self::result(self::UNKNOWN, 'sin tabla de control');
            }
        } else {
            $checks['schema_control'] = self::result(self::UNKNOWN, 'BD no disponible');
            $checks['migrations_pending'] = self::result(self::UNKNOWN, 'BD no disponible');
            $checks['migrations_failed'] = self::result(self::UNKNOWN, 'BD no disponible');
        }

        // El almacenamiento no depende de la BD: se revisa siempre.
        $checks['storage'] = self::checkStorage($opts);

        $status = self::OK;
        foreach ($checks as $check) {
            if (self::SEVERITY[$check['status']] > self::SEVERITY[$status]) {
                $status = $check['status'];
            }
        }

        return [
            'status' => $status,
            'http_code' => self::HTTP_CODE[$status],
            'checks' => $checks,
        ];
    }
}

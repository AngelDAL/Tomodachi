<?php
/**
 * Pruebas de la matriz de estados de `HealthCheck` — sin base de datos y sin
 * red, salvo un intento de conexión a un puerto cerrado: ese ES el caso
 * "BD caída" (criterio 1 de la tarea).
 *
 * Cubre los cuatro estados del contrato: ok / degraded / not_ready / down, más
 * los invariantes que no queremos volver a romper (nada de session_start(),
 * nada de store_id, detalle solo a loopback o con token).
 *
 * Uso: php tests/health_check_test.php
 */

require_once __DIR__ . '/../config/constants.php';
require_once __DIR__ . '/../includes/HealthCheck.class.php';

// config/database.php NO vive en el repo (lo genera el entrypoint): para la
// prueba lo simulamos con las MISMAS constantes que define la plantilla.
// El host apunta a un puerto cerrado a propósito: es la BD caída del criterio 1.
define('DB_HOST', '127.0.0.1;port=34567');
define('DB_NAME', 'tomodachi_pos');
define('DB_USER', 'tomodachi');
define('DB_PASS', 'no_se_usa_en_esta_prueba');
define('DB_CHARSET', 'utf8mb4');

/** Doble de PDOStatement. */
class FakeStatement
{
    private array $params = [];

    public function __construct(private string $sql, private FakeDb $db) {}

    public function execute(array $params = []): bool
    {
        $this->params = $params;
        return true;
    }

    public function fetchColumn()
    {
        return $this->db->resolverColumna($this->sql, $this->params);
    }

    public function fetchAll(int $mode = 0): array
    {
        return $this->db->resolverTodo($this->sql);
    }
}

/** Doble de PDO: contesta solo lo que el healthcheck pregunta. */
class FakeDb
{
    public function __construct(
        private array $tables = [],
        private array $versions = [],
        private int $failures = 0,
        private bool $muerta = false
    ) {}

    public function query(string $sql): FakeStatement
    {
        if ($this->muerta) {
            throw new RuntimeException('MySQL server has gone away', 2006);
        }
        return new FakeStatement($sql, $this);
    }

    public function prepare(string $sql): FakeStatement
    {
        if ($this->muerta) {
            throw new RuntimeException('MySQL server has gone away', 2006);
        }
        return new FakeStatement($sql, $this);
    }

    public function resolverColumna(string $sql, array $params)
    {
        if (str_contains($sql, 'SELECT 1')) {
            return 1;
        }
        if (str_contains($sql, 'information_schema')) {
            return in_array($params[0] ?? '', $this->tables, true) ? 1 : 0;
        }
        if (str_contains($sql, HealthCheck::FAILURE_TABLE)) {
            return $this->failures;
        }
        return 0;
    }

    public function resolverTodo(string $sql): array
    {
        if (str_contains($sql, 'SELECT version')) {
            return array_map('strval', $this->versions);
        }
        return [];
    }
}

$PASS = 0;
$FAIL = 0;
function probar(string $nombre, bool $cond, string $extra = ''): void
{
    global $PASS, $FAIL;
    if ($cond) {
        echo "PASS | {$nombre}\n";
        $PASS++;
        return;
    }
    echo "FAIL | {$nombre}" . ($extra !== '' ? " ({$extra})" : '') . "\n";
    $FAIL++;
}

$raiz = dirname(__DIR__);
$migDir = $raiz . '/database/migrations';
$todas = array_map('basename', glob($migDir . '/*.sql') ?: []);
echo "===== HealthCheck — matriz de estados (" . count($todas) . " migraciones versionadas) =====\n";

// --- config ---------------------------------------------------------------
$cfg = HealthCheck::checkConfig(['config_file' => __FILE__]);
probar('config: presente → ok', $cfg['status'] === HealthCheck::OK, $cfg['detail']);

$cfgFalta = HealthCheck::checkConfig(['config_file' => $raiz . '/config/no-existe.php']);
probar('config: sin config/database.php → down', $cfgFalta['status'] === HealthCheck::DOWN, $cfgFalta['detail']);

// --- db -------------------------------------------------------------------
$t0 = microtime(true);
$caida = HealthCheck::checkDb(null, 2.0);
$dt = microtime(true) - $t0;
probar('db: puerto cerrado → down', $caida['status'] === HealthCheck::DOWN, $caida['detail']);
probar('db: no se cuelga (timeout 2 s, el HEALTHCHECK corta a los 3 s)', $dt <= 3.0, sprintf('%.2f s', $dt));

$viva = new FakeDb(['schema_migrations'], $todas);
probar('db: SELECT 1 responde → ok', HealthCheck::checkDb($viva)['status'] === HealthCheck::OK);

$perdida = new FakeDb([], [], 0, true);
probar('db: conexión perdida al consultar → down', HealthCheck::checkDb($perdida)['status'] === HealthCheck::DOWN);

// --- matriz completa ------------------------------------------------------
$opts = ['migrations_dir' => $migDir, 'config_file' => __FILE__, 'min_free_mb' => 0];

$todo = HealthCheck::evaluate($opts + ['pdo' => $viva]);
probar('ready: todo en orden → ok / 200', $todo['status'] === HealthCheck::OK && $todo['http_code'] === 200, json_encode($todo['checks'], JSON_UNESCAPED_UNICODE));
probar('ready: el cuerpo trae las 6 familias de checks', count($todo['checks']) === 6, implode(', ', array_keys($todo['checks'])));
probar('ready: control de migraciones presente → ok', $todo['checks']['schema_control']['status'] === HealthCheck::OK, $todo['checks']['schema_control']['detail']);
probar('ready: sin registro de fallos → unknown (informativo, no cambia el código)', $todo['checks']['migrations_failed']['status'] === HealthCheck::UNKNOWN, $todo['checks']['migrations_failed']['detail']);

$faltantes = array_slice($todas, 0, 2);
$parcial = new FakeDb(['schema_migrations'], array_values(array_diff($todas, $faltantes)));
$pendientes = HealthCheck::evaluate($opts + ['pdo' => $parcial]);
probar('ready: migraciones pendientes → not_ready / 503', $pendientes['status'] === HealthCheck::NOT_READY && $pendientes['http_code'] === 503, $pendientes['checks']['migrations_pending']['detail']);
probar('ready: el detalle nombra la migración pendiente', str_contains($pendientes['checks']['migrations_pending']['detail'], $faltantes[0]), $pendientes['checks']['migrations_pending']['detail']);

$conFallos = new FakeDb(['schema_migrations', HealthCheck::FAILURE_TABLE], $todas, 2);
$degradado = HealthCheck::evaluate($opts + ['pdo' => $conFallos]);
probar('ready: migración fallida → degraded / 200', $degradado['status'] === HealthCheck::DEGRADED && $degradado['http_code'] === 200, $degradado['checks']['migrations_failed']['detail']);

$sinControl = new FakeDb([], $todas);
$sinEsquema = HealthCheck::evaluate($opts + ['pdo' => $sinControl]);
probar('ready: esquema sin inicializar → not_ready / 503', $sinEsquema['status'] === HealthCheck::NOT_READY && $sinEsquema['http_code'] === 503, $sinEsquema['checks']['schema_control']['detail']);

$sinBd = HealthCheck::evaluate($opts); // conexión real al puerto cerrado
probar('ready: BD caída → down / 503', $sinBd['status'] === HealthCheck::DOWN && $sinBd['http_code'] === 503, $sinBd['checks']['db']['detail']);
probar('ready: con la BD caída los checks de BD quedan unknown', $sinBd['checks']['schema_control']['status'] === HealthCheck::UNKNOWN);

// --- storage --------------------------------------------------------------
$stOk = HealthCheck::checkStorage(['min_free_mb' => 0]);
probar('storage: uploads y sesiones escribibles → ok', $stOk['status'] === HealthCheck::OK, $stOk['detail']);
probar('storage: ruta no escribible → down', HealthCheck::checkStorage(['min_free_mb' => 0, 'storage_paths' => [$raiz . '/includes/no-existe-este-directorio']])['status'] === HealthCheck::DOWN);
probar('storage: por debajo del mínimo de disco → down', HealthCheck::checkStorage(['min_free_mb' => PHP_INT_MAX])['status'] === HealthCheck::DOWN);
probar('storage: el mínimo por defecto es 200 MB', HealthCheck::DEFAULT_MIN_FREE_MB === 200 && (int) HEALTH_MIN_FREE_MB === 200, (string) HEALTH_MIN_FREE_MB);

// --- detalle solo a loopback o con token ----------------------------------
probar('detalle: loopback → sí', HealthCheck::detailAllowed('127.0.0.1', null, '') === true);
probar('detalle: otra IP sin token → no', HealthCheck::detailAllowed('203.0.113.9', null, 'secreto') === false);
probar('detalle: otra IP con token correcto → sí', HealthCheck::detailAllowed('203.0.113.9', 'secreto', 'secreto') === true);
probar('detalle: otra IP con token equivocado → no', HealthCheck::detailAllowed('203.0.113.9', 'otro', 'secreto') === false);
probar('detalle: sin HEALTH_TOKEN configurado, cualquier token → no', HealthCheck::detailAllowed('203.0.113.9', 'lo-que-sea', '') === false);

// --- invariantes estáticos ------------------------------------------------
// Se inspecciona CÓDIGO, no comentarios: los docblocks EXPLICAN los invariantes
// y por eso nombran `session_start()` y `store_id` (para decir que no se usan).
// `php_strip_whitespace()` pasa el tokenizer y borra comentarios y espacios.
$endpoints = [$raiz . '/api/health/live.php', $raiz . '/api/health/ready.php', $raiz . '/includes/HealthCheck.class.php'];
$codigo = '';
foreach ($endpoints as $f) {
    $codigo .= (string) php_strip_whitespace($f);
}
probar('invariante: los endpoints de salud NO abren sesión (código, sin comentarios)', !str_contains($codigo, 'session_start'));
probar('invariante: los endpoints de salud NO leen store_id (código, sin comentarios)', !preg_match('/store_id/', $codigo));
probar('invariante: el healthcheck no escribe (sin INSERT/UPDATE/DELETE/DDL)', !preg_match('/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i', $codigo));

echo "\n===== HealthCheck: {$PASS} en verde, {$FAIL} en rojo =====\n";
exit($FAIL === 0 ? 0 : 1);

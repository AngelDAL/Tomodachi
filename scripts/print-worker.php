#!/usr/bin/env php
<?php
/**
 * Worker de la cola de impresión ESC/POS (TAB-22).
 *
 * QUÉ HACE
 * Toma los trabajos `pending` de `print_jobs` y los escribe por TCP en el puerto
 * RAW de la impresora de red. Es el ÚNICO lugar del sistema que habla con la
 * impresora: una petición HTTP del navegador nunca escribe bytes (el mesero no
 * puede quedarse colgado contra una IP que traga la conexión y no responde).
 *
 * CÓMO SE COMPORTA ANTE FALLOS
 * - Un fallo de IMPRESORA no mata el proceso: el job se reintenta con backoff
 *   (10/30/120 s por defecto) y, al agotar los intentos, queda `failed` con el
 *   motivo visible en el tablero. `autorestart` de supervisord es solo para que
 *   el proceso viva, no para reintentar tickets.
 * - Un fallo de BASE DE DATOS tampoco lo mata: espera y vuelve a intentar. El
 *   worker arranca junto con la app, y la app puede tardar en tener BD.
 *
 * POR QUÉ UN PROCESO APARTE Y NO UN CRON
 * El lease (`claimed_at`) está pensado para que varios workers no se peleen el
 * mismo ticket; un cron cada minuto con reintentos de 10 s no podría cumplir el
 * backoff. Y el operador ve los tickets salir en `docker logs` en vivo.
 *
 * Uso:
 *   php scripts/print-worker.php [--once] [--verbose] [--max=N]
 *
 *   --once     procesa lo pendiente y sale (verificación, no producción)
 *   --verbose  imprime también cada intento exitoso
 *   --max=N    jobs por vuelta (por defecto 5)
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/constants.php';
require_once __DIR__ . '/../includes/Database.class.php';
require_once __DIR__ . '/../includes/EscPos.class.php';
require_once __DIR__ . '/../includes/PrintQueue.class.php';

$opciones = ['once' => false, 'verbose' => false, 'max' => 5];
foreach (array_slice($argv, 1) as $arg) {
    if ($arg === '--once') {
        $opciones['once'] = true;
    } elseif ($arg === '--verbose' || $arg === '-v') {
        $opciones['verbose'] = true;
    } elseif (strpos($arg, '--max=') === 0) {
        $opciones['max'] = max(1, (int)substr($arg, 6));
    } elseif ($arg === '--help' || $arg === '-h') {
        fwrite(STDOUT, "Uso: php scripts/print-worker.php [--once] [--verbose] [--max=N]\n");
        exit(0);
    } else {
        fwrite(STDERR, "Opción desconocida: $arg\n");
        exit(2);
    }
}

/** Log con marca de tiempo. Va a stdout/stderr: supervisord lo lleva a `docker logs`. */
$log = function ($mensaje, $nivel = 'info') use ($opciones) {
    if ($nivel === 'debug' && !$opciones['verbose']) {
        return;
    }
    $linea = '[' . date('Y-m-d H:i:s') . '] print-worker ' . $nivel . ': ' . $mensaje . "\n";
    fwrite($nivel === 'error' ? STDERR : STDOUT, $linea);
};

// Salida limpia con SIGTERM (lo que manda `docker stop`/supervisord). Sin esto, el
// contenedor tarda el grace period completo en bajar.
if (function_exists('pcntl_signal')) {
    pcntl_async_signals(true);
    $parar = false;
    pcntl_signal(SIGTERM, function () use (&$parar, $log) {
        $log('SIGTERM: cerrando', 'info');
        $parar = true;
    });
    pcntl_signal(SIGINT, function () use (&$parar) {
        $parar = true;
    });
} else {
    $parar = false;
}
$parar = $parar ?? false;

$worker_id = (function_exists('gethostname') ? gethostname() : 'host') . ':' . getmypid();
$idle      = defined('PRINT_WORKER_IDLE_SLEEP') ? max(1, (int)PRINT_WORKER_IDLE_SLEEP) : 2;

if (defined('PRINT_QUEUE_ENABLED') && !PRINT_QUEUE_ENABLED) {
    $log('PRINT_QUEUE_ENABLED=false: la cola está apagada, no hay nada que imprimir', 'info');
    exit(0);
}

$log('arrancando (worker=' . $worker_id . ', puerto=' . (defined('PRINT_PORT') ? PRINT_PORT : 9100)
     . ', intentos=' . (defined('PRINT_MAX_ATTEMPTS') ? PRINT_MAX_ATTEMPTS : 4) . ')');

$cola = null;
$ciclos = 0;

while (!$parar) {
    $ciclos++;

    // La conexión se crea (y se recupera) dentro del bucle: la BD puede no estar
    // lista en el arranque y el worker no debe morir por eso.
    try {
        if ($cola === null) {
            $cola = new PrintQueue(new Database());
            $log('conectado a la base de datos', 'debug');
        }

        $recuperados = $cola->liberarVencidos();
        if ($recuperados > 0) {
            $log($recuperados . ' job(s) con lease vencido devueltos a la cola', 'info');
        }

        $jobs = $cola->reclamar($worker_id, $opciones['max']);
        if (!$jobs) {
            if ($opciones['once']) {
                break;
            }
            sleep($idle);
            continue;
        }

        foreach ($jobs as $job) {
            try {
                $bytes = $cola->enviar($job);
                $cola->marcarHecho($job);
                $log('job ' . $job['job_id'] . ' impreso (' . $bytes . ' bytes, intento ' . $job['attempts'] . ')', 'debug');
            } catch (Throwable $e) {
                $resultado = $cola->marcarFallo($job, $e->getMessage());
                // Un fallo de impresora es operación normal, no una caída: se informa
                // con el motivo real para que el piso sepa por qué no salió el ticket.
                $log('job ' . $job['job_id'] . ' falló (' . $resultado . '): ' . $e->getMessage(), 'error');
            }
        }
    } catch (Throwable $e) {
        // BD caída, permisos, lo que sea: no morir. Se pierde la conexión y se
        // vuelve a intentar en la siguiente vuelta.
        $cola = null;
        $log('error de cola: ' . $e->getMessage(), 'error');
        if ($opciones['once']) {
            exit(1);
        }
        sleep($idle);
    }
}

$log('cerrado (ciclos=' . $ciclos . ')');
exit(0);

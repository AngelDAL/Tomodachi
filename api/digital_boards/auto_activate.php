<?php
/**
 * Activación automática de boards por fecha
 * Se ejecuta via cron (cada hora) o manualmente
 * Verifica scheduled_start y scheduled_end para activar/desactivar boards
 */
require_once '../../config/database.php';
require_once '../../includes/Database.class.php';

// Solo ejecutable desde CLI o con flag especial
$is_cli = php_sapi_name() === 'cli';
$is_cron = isset($_GET['cron_secret']) && $_GET['cron_secret'] === getenv('CRON_SECRET');

if (!$is_cli && !$is_cron) {
    header('HTTP/1.1 403 Forbidden');
    exit('Acceso denegado');
}

try {
    $db = new Database();
    $now = date('Y-m-d H:i:s');
    
    // Activar boards cuyo scheduled_start ya pasó y están inactivos
    $boards_to_activate = $db->select(
        'SELECT board_id, name, store_id 
         FROM digital_boards 
         WHERE is_active = 0 
         AND scheduled_start IS NOT NULL 
         AND scheduled_start <= ?
         AND (scheduled_end IS NULL OR scheduled_end > ?)',
        [$now, $now]
    );
    
    foreach ($boards_to_activate as $board) {
        $db->update(
            'UPDATE digital_boards SET is_active = 1 WHERE board_id = ?',
            [$board['board_id']]
        );
        error_log("[Digital Signage] Board activado automáticamente: ID {$board['board_id']} '{$board['name']}' (Store {$board['store_id']})");
    }
    
    // Desactivar boards cuyo scheduled_end ya pasó
    $boards_to_deactivate = $db->select(
        'SELECT board_id, name, store_id 
         FROM digital_boards 
         WHERE is_active = 1 
         AND scheduled_end IS NOT NULL 
         AND scheduled_end <= ?',
        [$now]
    );
    
    foreach ($boards_to_deactivate as $board) {
        $db->update(
            'UPDATE digital_boards SET is_active = 0 WHERE board_id = ?',
            [$board['board_id']]
        );
        error_log("[Digital Signage] Board desactivado automáticamente (expiró): ID {$board['board_id']} '{$board['name']}' (Store {$board['store_id']})");
    }
    
    $result = [
        'activated' => count($boards_to_activate),
        'deactivated' => count($boards_to_deactivate),
        'timestamp' => $now
    ];
    
    if ($is_cli) {
        echo json_encode($result, JSON_PRETTY_PRINT) . "\n";
    } else {
        header('Content-Type: application/json');
        echo json_encode($result);
    }
    
} catch (Exception $e) {
    error_log("[Digital Signage] Error en auto-activation: " . $e->getMessage());
    if ($is_cli) {
        fwrite(STDERR, "Error: " . $e->getMessage() . "\n");
        exit(1);
    } else {
        header('HTTP/1.1 500 Internal Server Error');
        echo json_encode(['error' => $e->getMessage()]);
    }
}

<?php
/**
 * Listar imágenes de digital signage de la tienda
 * GET /api/digital_boards/list_media.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);
    
    $actor = $apiAuth->requireActor($auth);
    $apiAuth->requireScope($actor, 'read');
    
    $store_id = (int)$actor['store_id'];
    
    $media = $db->select(
        'SELECT media_id, filename, original_name, mime_type, file_size, width, height, tags, uploaded_at
         FROM digital_signage_media 
         WHERE store_id = ? 
         ORDER BY uploaded_at DESC',
        [$store_id]
    );
    
    // Agregar URL relativa
    foreach ($media as &$item) {
        $item['url'] = '/uploads/digital_signage/' . $item['filename'];
    }
    
    Response::success($media, 'Imágenes obtenidas');
} catch (Exception $e) {
    Response::error('Error del servidor: ' . $e->getMessage(), 500);
}

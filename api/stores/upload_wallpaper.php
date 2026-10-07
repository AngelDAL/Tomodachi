<?php
/**
 * Subir la imagen de fondo (papel tapiz) de la tienda — multipart/form-data
 * POST /api/stores/upload_wallpaper.php    campo: wallpaper
 *
 * Devuelve la URL relativa de la imagen; NO escribe la base de datos: el papel
 * tapiz se guarda con el resto del tema en api/stores/settings.php
 * (`theme_config.wallpaper_url`, `wallpaper_opacity`, `wallpaper_size`), igual
 * que los colores. Así "elegir imagen" y "guardar" son dos pasos explícitos y el
 * usuario puede descartar sin dejar el tema a medias.
 *
 * El archivo se re-encodea (ImageUpload): nunca se guarda lo que mandó el
 * cliente tal cual. Se guarda en public/assets/images/wallpapers, que el
 * entrypoint enlaza al volumen persistente (public/uploads/wallpapers).
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ImageUpload.class.php';
require_once __DIR__ . '/../../includes/RequestContext.class.php';

$db = new Database();
$auth = new Auth($db);

if (!$auth->isLoggedIn()) {
    Response::unauthorized();
}
if ($auth->getCurrentUser()['role'] !== ROLE_ADMIN) {
    Response::error('Permisos insuficientes', 403);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

try {
    if (!isset($_FILES['wallpaper']) || $_FILES['wallpaper']['error'] !== UPLOAD_ERR_OK) {
        Response::validationError(['wallpaper' => 'No se recibió archivo o hubo un error']);
    }

    $store_id = (int)$auth->getCurrentUser()['store_id'];

    try {
        $saved = ImageUpload::saveUploadedFile(
            $_FILES['wallpaper'],
            __DIR__ . '/../../public/assets/images/wallpapers',
            'store_' . $store_id,
            3 * 1024 * 1024,   // resultado máx. 3MB: es una imagen a pantalla completa
            25 * 1024 * 1024,  // entrada máx. 25MB (fotos de cámara)
            2560               // lado máximo: nítido en monitor y razonable en el teléfono
        );
    } catch (Exception $e) {
        Response::validationError(['wallpaper' => $e->getMessage()]);
    }

    $relativeUrl = 'assets/images/wallpapers/' . $saved['filename'];

    Response::success([
        'wallpaper_url' => $relativeUrl,
        'bytes'         => $saved['bytes'],
        'mime'          => $saved['mime'],
    ], 'Imagen de fondo lista');

} catch (Exception $e) {
    RequestContext::error('Error al subir imagen de fondo: ' . $e->getMessage());
    Response::error('Error interno del servidor', 500);
}

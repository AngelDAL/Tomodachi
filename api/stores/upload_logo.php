<?php
/**
 * Subir logo de la tienda (multipart/form-data)
 * POST /api/stores/upload_logo.php
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';

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
    if (!isset($_FILES['logo']) || $_FILES['logo']['error'] !== UPLOAD_ERR_OK) {
        Response::validationError(['logo' => 'No se recibió archivo o hubo un error']);
    }

    $file = $_FILES['logo'];
    $allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file($file['tmp_name']);

    if (!in_array($mime, $allowedTypes)) {
        Response::validationError(['logo' => 'Formato no permitido (JPG, PNG, WEBP)']);
    }

    $data_bin = file_get_contents($file['tmp_name']);
    $ext = pathinfo($file['name'], PATHINFO_EXTENSION);

    // Si la imagen excede 2MB, intentar comprimir
    if (strlen($data_bin) > 2 * 1024 * 1024) {
        if (extension_loaded('gd')) {
            $im = @imagecreatefromstring($data_bin);
            if ($im) {
                $width = imagesx($im);
                $height = imagesy($im);
                
                // Redimensionar si excede 1920px en algún lado
                $max_dim = 1920;
                if ($width > $max_dim || $height > $max_dim) {
                    $ratio = $width / $height;
                    if ($ratio > 1) {
                        $new_width = $max_dim;
                        $new_height = intval($max_dim / $ratio);
                    } else {
                        $new_height = $max_dim;
                        $new_width = intval($max_dim * $ratio);
                    }
                    
                    $new_im = imagecreatetruecolor($new_width, $new_height);
                    
                    // Preservar transparencia
                    imagealphablending($new_im, false);
                    imagesavealpha($new_im, true);
                    $transparent = imagecolorallocatealpha($new_im, 255, 255, 255, 127);
                    imagefilledrectangle($new_im, 0, 0, $new_width, $new_height, $transparent);
                    
                    imagecopyresampled($new_im, $im, 0, 0, 0, 0, $new_width, $new_height, $width, $height);
                    imagedestroy($im);
                    $im = $new_im;
                } else {
                    // Asegurar configuración de transparencia si no se redimensionó
                    imagealphablending($im, false);
                    imagesavealpha($im, true);
                }

                // Comprimir iterativamente
                $is_jpg = ($mime === 'image/jpeg' || $mime === 'image/jpg');
                $use_webp = !$is_jpg && function_exists('imagewebp');
                
                $quality = 90;
                $compressed = false;
                
                do {
                    ob_start();
                    if ($is_jpg) {
                        imagejpeg($im, null, $quality);
                    } elseif ($use_webp) {
                        imagewebp($im, null, $quality);
                    } else {
                        // Fallback PNG
                        imagepng($im, null, 9);
                        $quality = 0; 
                    }
                    $buffer = ob_get_clean();
                    
                    if (strlen($buffer) <= 2 * 1024 * 1024) {
                        $data_bin = $buffer;
                        if ($use_webp) {
                            $ext = 'webp';
                        }
                        $compressed = true;
                        break;
                    }
                    $quality -= 10;
                } while ($quality >= 30);

                imagedestroy($im);

                if (!$compressed) {
                    Response::validationError(['logo' => 'No se pudo comprimir la imagen a menos de 2MB.']);
                }
            } else {
                Response::validationError(['logo' => 'Imagen corrupta o no soportada para compresión']);
            }
        } else {
            Response::validationError(['logo' => 'Máximo 2MB (GD no disponible)']);
        }
    }

    $store_id = $auth->getCurrentUser()['store_id'];
    $filename = 'store_' . $store_id . '_' . time() . '.' . $ext;
    
    $targetDir = __DIR__ . '/../../public/assets/images/logos';
    if (!is_dir($targetDir)) {
        mkdir($targetDir, 0777, true);
    }
    
    $targetPath = $targetDir . '/' . $filename;
    
    if (!file_put_contents($targetPath, $data_bin)) {
        Response::error('Error al guardar el archivo', 500);
    }

    $relativeUrl = 'assets/images/logos/' . $filename;
    
    $db->update('UPDATE stores SET logo_url = ?, updated_at = NOW() WHERE store_id = ?', [$relativeUrl, $store_id]);
    
    // Actualizar sesión
    $_SESSION['logo_url'] = $relativeUrl;

    Response::success(['logo_url' => $relativeUrl], 'Logo actualizado');

} catch (Exception $e) {
    Response::error('Error servidor: ' . $e->getMessage(), 500);
}

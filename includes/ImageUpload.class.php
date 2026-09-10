<?php
/**
 * Clase ImageUpload - Procesamiento seguro de imágenes subidas.
 *
 * Reglas de seguridad (nunca confiar en el cliente):
 *   1. Valida el contenido real del binario con getimagesizefromstring()
 *      (no la extensión ni el MIME declarado).
 *   2. Solo acepta JPG, PNG y WEBP.
 *   3. Limita las dimensiones (protección anti "image bomb": una imagen
 *      pequeña puede descomprimirse a gigapíxeles y agotar la memoria).
 *   4. SIEMPRE re-encodea con GD: cualquier payload embebido en el archivo
 *      original (PHP, EXIF malicioso, etc.) se descarta.
 *   5. Genera el nombre de archivo en el servidor con sufijo aleatorio;
 *      el nombre enviado por el usuario jamás se usa en la ruta.
 */

class ImageUpload {

    /**
     * Máximo de píxeles totales aceptados (40 megapíxeles).
     * Protege contra "image bombs": un PNG de 100KB puede declarar
     * 65535x65535 y agotar la memoria al descomprimirse.
     */
    const MAX_PIXELS = 40000000;

    /**
     * Procesar y guardar una imagen desde su contenido binario.
     *
     * @param string $dataBin   Contenido binario de la imagen
     * @param string $targetDir Directorio destino (ruta absoluta)
     * @param string $prefix    Prefijo del nombre de archivo (ej. 'store_1')
     * @param int    $maxBytes  Tamaño máximo del archivo resultante (bytes)
     * @param int    $maxEdge   Lado máximo permitido tras redimensionar (px)
     * @return array{filename:string, mime:string, bytes:int}
     * @throws Exception con mensaje en español listo para mostrar al usuario
     */
    public static function save($dataBin, $targetDir, $prefix, $maxBytes = 2097152, $maxEdge = 1920) {
        if (!extension_loaded('gd')) {
            throw new Exception('El servidor no tiene soporte de imágenes (GD)');
        }

        // 1. Validar que sea una imagen real y obtener tipo/dimensiones del header
        $info = @getimagesizefromstring($dataBin);
        if ($info === false) {
            throw new Exception('El archivo no es una imagen válida');
        }

        $width  = (int)$info[0];
        $height = (int)$info[1];

        if ($width <= 0 || $height <= 0) {
            throw new Exception('La imagen tiene dimensiones inválidas');
        }
        if ($width * $height > self::MAX_PIXELS) {
            throw new Exception('La imagen es demasiado grande (máximo 40 megapíxeles)');
        }

        // 2. Solo formatos seguros y re-encodeables
        $allowed = [
            IMAGETYPE_JPEG => 'jpg',
            IMAGETYPE_PNG  => 'png',
            IMAGETYPE_WEBP => 'webp',
        ];
        $type = $info[2];
        if (!isset($allowed[$type])) {
            throw new Exception('Formato no permitido (solo JPG, PNG o WEBP)');
        }

        // 3. Cargar y re-encodear (descarta cualquier payload embebido)
        $im = @imagecreatefromstring($dataBin);
        if ($im === false) {
            throw new Exception('Imagen corrupta o no soportada');
        }

        // Redimensionar si excede el lado máximo
        if ($width > $maxEdge || $height > $maxEdge) {
            $ratio = $width / $height;
            if ($ratio > 1) {
                $newWidth  = $maxEdge;
                $newHeight = (int)round($maxEdge / $ratio);
            } else {
                $newHeight = $maxEdge;
                $newWidth  = (int)round($maxEdge * $ratio);
            }
            $newWidth  = max(1, $newWidth);
            $newHeight = max(1, $newHeight);

            $resized = imagecreatetruecolor($newWidth, $newHeight);
            imagealphablending($resized, false);
            imagesavealpha($resized, true);
            $transparent = imagecolorallocatealpha($resized, 255, 255, 255, 127);
            imagefilledrectangle($resized, 0, 0, $newWidth, $newHeight, $transparent);
            imagecopyresampled($resized, $im, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);
            imagedestroy($im);
            $im = $resized;
        } else {
            imagealphablending($im, false);
            imagesavealpha($im, true);
        }

        // 4. Elegir formato de salida: JPEG se mantiene JPEG; PNG/WEBP se
        //    prefieren como WEBP (mantiene transparencia y pesa menos).
        $isJpeg  = ($type === IMAGETYPE_JPEG);
        $useWebp = (!$isJpeg && function_exists('imagewebp'));
        $ext     = $isJpeg ? 'jpg' : ($useWebp ? 'webp' : 'png');

        $quality  = 90;
        $encoded  = null;
        do {
            ob_start();
            if ($isJpeg) {
                imagejpeg($im, null, $quality);
            } elseif ($useWebp) {
                imagewebp($im, null, $quality);
            } else {
                imagepng($im, null, 9);
                $quality = 0;
            }
            $buffer = ob_get_clean();

            if ($buffer !== false && strlen($buffer) <= $maxBytes) {
                $encoded = $buffer;
                break;
            }
            $quality -= 10;
        } while ($quality >= 30);

        imagedestroy($im);

        if ($encoded === null) {
            throw new Exception('No se pudo comprimir la imagen a menos de ' . round($maxBytes / 1048576) . 'MB');
        }

        // 5. Nombre generado por el servidor (sin input del usuario)
        $filename = $prefix . '_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;

        if (!is_dir($targetDir)) {
            if (!mkdir($targetDir, 0775, true) && !is_dir($targetDir)) {
                throw new Exception('No se pudo crear el directorio de destino');
            }
        }

        $targetPath = rtrim($targetDir, '/\\') . DIRECTORY_SEPARATOR . $filename;
        if (file_put_contents($targetPath, $encoded) === false) {
            throw new Exception('Error al guardar el archivo');
        }
        @chmod($targetPath, 0644);

        $mime = $isJpeg ? 'image/jpeg' : ($useWebp ? 'image/webp' : 'image/png');

        return [
            'filename' => $filename,
            'mime'     => $mime,
            'bytes'    => strlen($encoded),
        ];
    }

    /**
     * Procesar un archivo subido ($_FILES) con validaciones previas.
     *
     * @param array  $file          Entrada de $_FILES
     * @param string $targetDir     Directorio destino (ruta absoluta)
     * @param string $prefix        Prefijo del nombre de archivo
     * @param int    $maxBytes      Tamaño máximo del archivo resultante (bytes)
     * @param int    $maxBytesInput Tamaño máximo del archivo de entrada (bytes)
     * @param int    $maxEdge       Lado máximo permitido tras redimensionar (px)
     * @return array{filename:string, mime:string, bytes:int}
     * @throws Exception
     */
    public static function saveUploadedFile($file, $targetDir, $prefix, $maxBytes = 2097152, $maxBytesInput = 20971520, $maxEdge = 1920) {
        if (!is_array($file) || !isset($file['error']) || $file['error'] !== UPLOAD_ERR_OK) {
            throw new Exception('No se recibió archivo o hubo un error en la subida');
        }
        if (!isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
            throw new Exception('Archivo inválido');
        }
        if (isset($file['size']) && $file['size'] > $maxBytesInput) {
            throw new Exception('El archivo supera el tamaño máximo permitido (' . round($maxBytesInput / 1048576) . 'MB)');
        }

        $dataBin = file_get_contents($file['tmp_name']);
        if ($dataBin === false || $dataBin === '') {
            throw new Exception('No se pudo leer el archivo');
        }

        return self::save($dataBin, $targetDir, $prefix, $maxBytes, $maxEdge);
    }
}

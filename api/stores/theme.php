<?php
/**
 * API: Personalización de tema (autenticado por API Token O sesión)
 *
 * Permite que un agente de IA (con API key scope "custom") lea y modifique
 * el tema de la tienda: colores, logo, etc.
 *
 * GET  /api/stores/theme.php            -> lee el theme_config actual (scope read)
 * POST /api/stores/theme.php            -> guarda theme_config (scope custom)
 *   Body: { "theme_config": { "primary_color": "#E3057A", ... } }
 *
 * Autenticación:
 *   - Sesión de admin: permisos completos.
 *   - API token: requiere scope 'read' para GET, 'custom' (o 'write') para POST.
 */
require_once '../../config/database.php';
require_once '../../config/constants.php';
require_once '../../includes/Database.class.php';
require_once '../../includes/Response.class.php';
require_once '../../includes/Auth.class.php';
require_once '../../includes/ApiAuth.class.php';
require_once '../../includes/Validator.class.php';
require_once __DIR__ . '/../../includes/RequestContext.class.php';

header('Content-Type: application/json; charset=utf-8');

try {
    $db = new Database();
    $auth = new Auth($db);
    $apiAuth = new ApiAuth($db);

    $actor = $apiAuth->getActor($auth);
    if (!$actor) {
        Response::unauthorized();
    }
    $store_id = $actor['store_id'];

    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        // Leer tema: sesión o token con scope read
        if (!$apiAuth->hasScope($actor, 'read')) {
            Response::error('El token no tiene permiso: read', 403);
        }

        $store = $db->selectOne('SELECT store_id, store_name, logo_url, theme_config, theme_config_dark FROM stores WHERE store_id = ?', [$store_id]);
        if (!$store) { Response::notFound('Tienda no existe'); }

        $store['theme_config'] = $store['theme_config'] ? json_decode($store['theme_config'], true) : null;
        $store['theme_config_dark'] = $store['theme_config_dark'] ? json_decode($store['theme_config_dark'], true) : null;

        Response::success([
            'store_id'          => (int)$store['store_id'],
            'store_name'        => $store['store_name'],
            'logo_url'          => $store['logo_url'],
            'theme_config'      => $store['theme_config'],
            'theme_config_dark' => $store['theme_config_dark'],
            'via'               => $actor['via'],
        ], 'Tema de la tienda');
    } elseif ($method === 'POST') {
        // Escribir tema: sesión de admin, o token con scope 'custom' (la
        // personalización es exclusiva del scope 'custom'; un token
        // solo-write no puede tocar el tema)
        if ($actor['via'] === 'session') {
            if (!$auth->hasRole([ROLE_ADMIN, ROLE_SUPER_ADMIN])) {
                Response::error('Permisos insuficientes para modificar el tema', 403);
            }
        } elseif (!$apiAuth->hasScope($actor, 'custom')) {
            Response::error('El token no tiene permiso: custom', 403);
        }

        $raw = file_get_contents('php://input');
        $data = json_decode($raw, true);
        if (!$data) { Response::validationError(['body' => 'JSON inválido']); }

        $theme_config = isset($data['theme_config']) ? $data['theme_config'] : null;
        if ($theme_config === null) {
            Response::validationError(['theme_config' => 'Requerido']);
        }
        if (!is_array($theme_config)) {
            Response::validationError(['theme_config' => 'Debe ser un objeto JSON']);
        }

        // Tema oscuro personalizado (opcional): si llega, se guarda (fusionado con el que había);
        // si NO llega, se conserva el existente (null → el frontend deriva).
        // OJO con `isset()`: es falso también cuando la clave viene en null, así que "no lo
        // mandaron" y "lo mandan vacío" quedaban iguales y cualquier POST parcial BORRABA el tema
        // oscuro guardado. Con `array_key_exists` sí se distinguen.
        $traeTemaOscuro = array_key_exists('theme_config_dark', $data);
        $theme_config_dark = $traeTemaOscuro ? $data['theme_config_dark'] : null;
        if ($theme_config_dark !== null && !is_array($theme_config_dark)) {
            Response::validationError(['theme_config_dark' => 'Debe ser un objeto JSON']);
        }

        // Validar valores: colores hex, booleanos (dark_mode) o cadenas CSS
        // permitidas para variables de estilo (bg_card, border_color, etc.)
        $colorKeys = ['primary_color', 'secondary_color', 'success_color', 'danger_color',
                      'warning_color', 'info_color', 'dark_color', 'bg_body', 'text_color'];
        $sanitizeTheme = function ($cfg) use ($colorKeys) {
            foreach ($cfg as $key => $value) {
                if ($key === 'dark_mode') {
                    if (!is_bool($value) && $value !== 'true' && $value !== 'false' && $value !== '0' && $value !== '1') {
                        Response::validationError(['theme_config.dark_mode' => 'Debe ser true/false']);
                    }
                    continue;
                }
                if ($key === 'theme_mode') {
                    if (!in_array($value, ['light', 'dark', 'auto'], true)) {
                        Response::validationError(['theme_config.theme_mode' => 'Debe ser light/dark/auto']);
                    }
                    continue;
                }
                // Papel tapiz (imagen de fondo de la tienda)
                if ($key === 'wallpaper_url') {
                    $url = Validator::wallpaperUrl($value);
                    if ($url === null) { unset($cfg[$key]); } else { $cfg[$key] = $url; }
                    continue;
                }
                if ($key === 'wallpaper_opacity') {
                    if (!is_numeric($value)) { unset($cfg[$key]); }
                    else { $cfg[$key] = max(0, min(100, (int)round((float)$value))); }
                    continue;
                }
                if ($key === 'wallpaper_size') {
                    $cfg[$key] = ($value === 'fill') ? 'fill' : 'cover';
                    continue;
                }
                // Variables de superficie permitidas como colores
                $isColorKey = in_array($key, $colorKeys, true)
                    || in_array($key, ['bg_card', 'bg_light', 'border_color', 'primary_hover'], true);
                if ($isColorKey) {
                    if (!is_string($value) || !preg_match('/^#[0-9a-fA-F]{3,8}$/', $value)) {
                        Response::validationError(['theme_config.' . $key => 'Valor de color inválido (usa #RRGGBB)']);
                    }
                } else {
                    // Claves desconocidas: ignorar silenciosamente para no romper la API
                    unset($cfg[$key]);
                }
            }
            return $cfg;
        };

        $theme_config = $sanitizeTheme($theme_config);
        if ($theme_config_dark !== null) {
            $theme_config_dark = $sanitizeTheme($theme_config_dark);
        }

        // FUSIÓN, no reemplazo. Esta API es de uso parcial: un POST con sólo `primary_color`
        // —lo que manda un agente o un script— REEMPLAZABA el tema entero y borraba el papel
        // tapiz y las superficies de la tienda. Hallazgo de la revisión del 13-oct-2026:
        // cualquier equipo que después entrara a esa tienda heredaba el fondo de otra.
        // El panel de Personalización manda el objeto completo, así que para él el resultado
        // es el mismo; para un POST parcial, ahora se respeta lo que ya estaba guardado.
        // Para QUITAR una clave sigue habiendo camino: `wallpaper_url: ''` (y el tema oscuro
        // completo con `theme_config_dark: null`).
        $guardado = $db->selectOne(
            'SELECT theme_config, theme_config_dark FROM stores WHERE store_id = ?',
            [$store_id]
        );
        $previoClaro = [];
        if (!empty($guardado['theme_config'])) {
            $decodificado = json_decode($guardado['theme_config'], true);
            if (is_array($decodificado)) { $previoClaro = $decodificado; }
        }
        $theme_config = array_merge($previoClaro, $theme_config);

        if ($traeTemaOscuro) {
            $previoOscuro = [];
            if (!empty($guardado['theme_config_dark'])) {
                $decodificado = json_decode($guardado['theme_config_dark'], true);
                if (is_array($decodificado)) { $previoOscuro = $decodificado; }
            }
            if ($theme_config_dark !== null) {
                $theme_config_dark = array_merge($previoOscuro, $theme_config_dark);
                $dark_json = json_encode($theme_config_dark);
            } else {
                $dark_json = null;   // lo mandaron en null: se borra a propósito
            }
            $db->update(
                'UPDATE stores SET theme_config = ?, theme_config_dark = ?, updated_at = NOW() WHERE store_id = ?',
                [json_encode($theme_config), $dark_json, $store_id]
            );
        } else {
            // No hablaron del tema oscuro: se deja como está (antes se borraba).
            $theme_config_dark = null;
            if (!empty($guardado['theme_config_dark'])) {
                $decodificado = json_decode($guardado['theme_config_dark'], true);
                $theme_config_dark = is_array($decodificado) ? $decodificado : null;
            }
            $db->update(
                'UPDATE stores SET theme_config = ?, updated_at = NOW() WHERE store_id = ?',
                [json_encode($theme_config), $store_id]
            );
        }

        Response::success([
            'store_id'          => $store_id,
            'theme_config'      => $theme_config,
            'theme_config_dark' => $theme_config_dark,
            'via'               => $actor['via'],
        ], 'Tema actualizado');
    } else {
        Response::error('Método no permitido', 405);
    }
} catch (Exception $e) {
    RequestContext::error('Error en stores/theme: ' . $e->getMessage());
    Response::error('Error interno del servidor', 500);
}

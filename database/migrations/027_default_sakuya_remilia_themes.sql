-- Community Edition default palettes
-- Claro: Sakuya (azul). Oscuro: Remilia (carmesí).
-- Solo completa tiendas que aún no tienen una paleta personalizada.

UPDATE stores
SET theme_config = JSON_OBJECT(
    'primary_color', '#4C77AF',
    'secondary_color', '#2196F3',
    'success_color', '#4CAF50',
    'danger_color', '#F44336',
    'warning_color', '#FF9800',
    'info_color', '#2196F3',
    'dark_color', '#1A1A2E',
    'bg_body', '#F4F7F6',
    'text_color', '#1A1A2E',
    'bg_card', '#FFFFFF',
    'border_color', '#E0E0E0',
    'theme_mode', 'light',
    'dark_mode', FALSE
)
WHERE theme_config IS NULL OR theme_config = '';

UPDATE stores
SET theme_config_dark = JSON_OBJECT(
    'primary_color', '#C62828',
    'secondary_color', '#E53935',
    'success_color', '#66BB6A',
    'danger_color', '#EF5350',
    'warning_color', '#FFB74D',
    'info_color', '#EF5350',
    'dark_color', '#1A080B',
    'bg_body', '#120609',
    'text_color', '#FCE4EC',
    'bg_card', '#241015',
    'border_color', '#5C1E2A'
)
WHERE theme_config_dark IS NULL OR theme_config_dark = '';

-- 018: tema oscuro personalizable por el usuario
-- El usuario define el tema claro (theme_config) y puede definir su propio
-- tema oscuro (theme_config_dark). Si theme_config_dark es NULL, el modo
-- oscuro se deriva automáticamente del tema claro (sugerencia).
ALTER TABLE stores ADD COLUMN theme_config_dark TEXT NULL AFTER theme_config;

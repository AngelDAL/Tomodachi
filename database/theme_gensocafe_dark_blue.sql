-- Tema oscuro AZUL para Genso Cafe (store_id=2), respetando los colores del
-- tema principal (primario cian #43A39D, secundario azul marino #273857).
UPDATE stores
SET theme_config_dark = '{
  "primary_color": "#4FD2CB",
  "secondary_color": "#5B8DD9",
  "success_color": "#66BB6A",
  "danger_color": "#EF5350",
  "warning_color": "#FFB74D",
  "info_color": "#5B8DD9",
  "dark_color": "#0A1A26",
  "bg_body": "#0B1A26",
  "text_color": "#DCEAF3",
  "bg_card": "#14283A",
  "border_color": "#2B4C66"
}'
WHERE store_id = 2;
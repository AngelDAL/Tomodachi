-- Migración 029: tabla de recetas (Bill of Materials)
-- Define qué ingredientes componen un producto ensamblado (tracking_type='recipe')
-- y la cantidad de cada ingrediente por UNA unidad del ensamblado.
-- Se usa la misma tabla de products para ingredientes (component_id) y para
-- ensamblados (product_id): soporta recetas anidadas y ciclos (validados en la API).
USE tomodachi_pos;

CREATE TABLE IF NOT EXISTS product_ingredients (
  recipe_id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL COMMENT 'Producto ensamblado (tracking_type=recipe)',
  component_id INT NOT NULL COMMENT 'Ingrediente que compone el producto',
  quantity DECIMAL(12,3) NOT NULL DEFAULT 1.000 COMMENT 'Cantidad del ingrediente por UNA unidad ensamblada',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_recipe_component (product_id, component_id),
  KEY idx_recipe_product (product_id),
  KEY idx_recipe_component (component_id),
  CONSTRAINT fk_recipe_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
  CONSTRAINT fk_recipe_component FOREIGN KEY (component_id) REFERENCES products(product_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
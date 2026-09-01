-- Migración 030: tipo de inventario 'component' + presentaciones (product_lots)
-- Añade el cuarto tipo a tracking_type: product_final=stock, receta=recipe,
-- componente=component (materia prima con presentaciones), servicio=none.
-- Las presentaciones (product_lots) son cada compra/lote del componente, cada una
-- con etiqueta, cantidad (en la unidad del componente: kg, pieza, litro…) y costo
-- unitario. El disponible del componente = Σ cantidades; su costo unitario =
-- promedio ponderado (Σ qty×costo ÷ Σ qty). Se consume FIFO (lote más viejo primero).
USE tomodachi_pos;

ALTER TABLE products
  MODIFY COLUMN tracking_type ENUM('stock','recipe','component','none') NOT NULL DEFAULT 'stock'
  COMMENT 'stock=producto final, recipe=ensamblado (stock derivado de receta), component=materia prima con presentaciones, none=sin inventario';

CREATE TABLE IF NOT EXISTS product_lots (
  lot_id INT AUTO_INCREMENT PRIMARY KEY,
  store_id INT NOT NULL,
  product_id INT NOT NULL COMMENT 'Componente dueño de la presentación',
  label VARCHAR(120) NULL COMMENT 'Etiqueta de la presentación (p.ej. Granel 3kg, Bolsa 5kg)',
  quantity DECIMAL(12,3) NOT NULL DEFAULT 0.000 COMMENT 'Cantidad actual en la unidad del componente',
  unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Costo por unidad de este lote (valor pagado ÷ cantidad)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lot_product (product_id),
  KEY idx_lot_store (store_id),
  CONSTRAINT fk_lot_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
  CONSTRAINT fk_lot_store FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
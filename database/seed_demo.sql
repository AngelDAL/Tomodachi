-- Tomodachi POS - Datos demo opcionales
-- Se aplican SOLO en el primer arranque cuando SEED_DEMO=true (default).
-- Crea una tienda de ejemplo adicional, más productos y ventas históricas
-- para que quien instale entienda de inmediato qué hace el sistema.
USE tomodachi_pos;

-- ============================================================
-- Tienda demo adicional
-- ============================================================
INSERT INTO stores (store_id, store_name, address, phone, status)
VALUES (2, 'Cafetería Demo', 'Av. Ejemplo #456, Querétaro', '442-000-0000', 'active')
ON DUPLICATE KEY UPDATE store_name = VALUES(store_name);

-- Usuario demo para la tienda 2 (password: demo123)
INSERT INTO users (store_id, username, password_hash, full_name, email, role, status, show_onboarding)
VALUES (2, 'demo', '$2y$10$/rL//aH8v.qozqbpeH0R8eiJ/G8pGz0akZOQg.8oXj2I9FtItIKWm', 'Usuario Demo', 'demo@tomodachi.com', 'admin', 'active', 0)
ON DUPLICATE KEY UPDATE username = VALUES(username);

-- Categorías de la tienda demo
INSERT INTO categories (store_id, category_name, description, icon_class)
VALUES
(2, 'Cafés', 'Cafés calientes y fríos', 'fa-mug-hot'),
(2, 'Repostería', 'Pan dulce y postres', 'fa-cake-candles'),
(2, 'Bebidas', 'Refrescos y jugos', 'fa-glass-water')
ON DUPLICATE KEY UPDATE category_name = VALUES(category_name);

-- Productos demo
INSERT INTO products (store_id, category_id, product_name, description, barcode, price, cost, current_stock, min_stock, status)
SELECT 2, c.category_id, p.product_name, p.description, CONCAT('9', p.barcode), p.price + 5, p.cost + 2, 25, 5, 'active'
FROM products p
JOIN categories c ON c.store_id = 2 AND c.category_name = 'Cafés'
WHERE p.store_id = 1 AND p.product_id = 1
ON DUPLICATE KEY UPDATE product_name = VALUES(product_name);

INSERT INTO products (store_id, category_id, product_name, description, barcode, price, cost, current_stock, min_stock, status)
SELECT 2, c.category_id, 'Espresso', 'Café espresso sencillo', '900000000001', 28.00, 10.00, 40, 10, 'active'
FROM categories c WHERE c.store_id = 2 AND c.category_name = 'Cafés'
ON DUPLICATE KEY UPDATE product_name = VALUES(product_name);

INSERT INTO products (store_id, category_id, product_name, description, barcode, price, cost, current_stock, min_stock, status)
SELECT 2, c.category_id, 'Capuchino', 'Café con leche espumada', '900000000002', 38.00, 14.00, 35, 10, 'active'
FROM categories c WHERE c.store_id = 2 AND c.category_name = 'Cafés'
ON DUPLICATE KEY UPDATE product_name = VALUES(product_name);

INSERT INTO products (store_id, category_id, product_name, description, barcode, price, cost, current_stock, min_stock, status)
SELECT 2, c.category_id, 'Concha', 'Pan dulce tradicional', '900000000003', 15.00, 6.00, 30, 10, 'active'
FROM categories c WHERE c.store_id = 2 AND c.category_name = 'Repostería'
ON DUPLICATE KEY UPDATE product_name = VALUES(product_name);

INSERT INTO products (store_id, category_id, product_name, description, barcode, price, cost, current_stock, min_stock, status)
SELECT 2, c.category_id, 'Jugo de Naranja', 'Jugo natural 400ml', '900000000004', 22.00, 9.00, 20, 8, 'active'
FROM categories c WHERE c.store_id = 2 AND c.category_name = 'Bebidas'
ON DUPLICATE KEY UPDATE product_name = VALUES(product_name);

-- ============================================================
-- Ventas demo (histórico para reportes) - tienda 2
-- ============================================================
-- Terminal y caja de la tienda demo
INSERT INTO terminals (store_id, terminal_name)
VALUES (2, 'Caja Principal')
ON DUPLICATE KEY UPDATE terminal_name = VALUES(terminal_name);

-- Caja abierta de ejemplo (cerrada, con historial)
INSERT INTO cash_registers (store_id, terminal_id, user_id, opening_date, closing_date, initial_amount, final_amount, expected_amount, difference, status, notes)
SELECT 2, t.terminal_id, u.user_id,
       DATE_SUB(NOW(), INTERVAL 7 DAY),
       DATE_SUB(NOW(), INTERVAL 6 DAY),
       500.00, 1240.00, 1240.00, 0.00, 'closed',
       'Cierre demo (semana pasada)'
FROM terminals t, users u
WHERE t.store_id = 2 AND t.terminal_name = 'Caja Principal'
  AND u.store_id = 2 AND u.username = 'demo'
LIMIT 1;

-- Ventas demo (últimos 7 días)
INSERT INTO sales (store_id, user_id, register_id, sale_date, subtotal, tax, discount, total, payment_method, status)
SELECT 2, u.user_id, cr.register_id, DATE_SUB(NOW(), INTERVAL n DAY),
       ROUND(RAND() * 200 + 50, 2), 0, 0, 0, 'cash', 'completed'
FROM users u
JOIN cash_registers cr ON cr.store_id = 2 AND cr.status = 'closed'
CROSS JOIN (SELECT 1 n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7) days
WHERE u.store_id = 2 AND u.username = 'demo'
  AND cr.store_id = 2
  AND NOT EXISTS (SELECT 1 FROM sales s2 WHERE s2.store_id = 2 AND DATE(s2.sale_date) = DATE(DATE_SUB(NOW(), INTERVAL n DAY)));

-- Actualizar totales de ventas demo con los productos de la tienda
UPDATE sales s
JOIN (
    SELECT s2.sale_id, ROUND(SUM(p.price * (1 + (s2.sale_id % 3))), 2) AS calc_total
    FROM sales s2
    JOIN products p ON p.store_id = 2
    WHERE s2.store_id = 2
    GROUP BY s2.sale_id
) t ON t.sale_id = s.sale_id
SET s.total = t.calc_total,
    s.subtotal = t.calc_total
WHERE s.store_id = 2 AND s.total = 0;

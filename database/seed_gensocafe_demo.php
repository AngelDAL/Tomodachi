<?php
/**
 * Semilla demo — Genso Cafe (store_id=2)
 * Amplía el catálogo con productos nuevos y genera ventas ficticias con
 * detalle (sale_details), relativas a la fecha ACTUAL del sistema
 * (DATE_SUB(NOW(), ...)), de modo que al instalarse el historial "nace" el
 * mismo día de instalación y se ve vivo en dashboard/reportes.
 *
 * Idempotente: los productos se insertan solo si su barcode no existe; las
 * ventas se generan solo si no hay otra en la misma marca de tiempo.
 *
 * Uso (dentro del contenedor): php database/seed_gensocafe_demo.php
 */
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../includes/Database.class.php';

$storeId = 2;

// Página segura de imágenes: reutilizamos las temáticas locales y los
// avatares SVG nuevos (identidad Genso Cafe, sin descargas externas).
$imgBase = 'public/assets/images/products/genso-cafe/';

// [nombre, descrición, precio, costo, stock, min_stock, categoría_id, imagen]
$newProducts = [
    // Cafe de especialidad (6)
    ['Caramel Macchiato', 'Espresso con leche y caramelo', 72.00, 30.00, 30, 8, 6, 'avatar-espresso.svg'],
    ['Latte de Vainilla', 'Latte aromatizado de vainilla', 62.00, 25.00, 32, 8, 6, 'cafe-latte-art.jpg'],
    ['Flat White Doble', 'Espresso doble con microespuma', 60.00, 24.00, 28, 8, 6, 'cafe-latte-art.jpg'],
    ['Café de Olla', 'Café con canela y piloncillo', 54.00, 20.00, 26, 6, 6, 'avatar-espresso.svg'],
    ['Affogato', 'Espresso sobre helado de vainilla', 74.00, 32.00, 16, 4, 6, 'avatar-dessert.svg'],
    ['Cortado', 'Espresso con leche corta', 48.00, 18.00, 28, 6, 6, 'avatar-espresso.svg'],
    // Tés y tisanas (7)
    ['Matcha Latte Helado', 'Matcha con leche y hielo', 70.00, 28.00, 22, 6, 7, 'avatar-tea.svg'],
    ['Chai Latte', 'Té especiado con leche', 66.00, 26.00, 24, 6, 7, 'avatar-tea.svg'],
    ['Té de Jazmín', 'Té verde perfumado con jazmín', 42.00, 14.00, 28, 8, 7, 'avatar-tea.svg'],
    ['Tisana de Hibiscus', 'Infusión fría de hibiscus', 44.00, 15.00, 22, 6, 7, 'mango-drink.jpg'],
    // Panadería artesanal (8)
    ['Croissant de Almendras', 'Croissant relleno de almendra', 52.00, 20.00, 24, 6, 8, 'croissants.jpg'],
    ['Baguette Artesanal', 'Pan de masa madre alargado', 58.00, 22.00, 18, 5, 8, 'avatar-pastry.svg'],
    ['Concha de Vainilla', 'Pan dulce con costra de vainilla', 26.00, 9.00, 42, 12, 8, 'avatar-pastry.svg'],
    ['Dona Glaseada', 'Dona suave con glaseado', 36.00, 13.00, 26, 6, 8, 'cafe-pastries.jpg'],
    // Repostería chill (9)
    ['Cheesecake de Frutos Rojos', 'Cheesecake con frutos del bosque', 84.00, 38.00, 14, 4, 9, 'avatar-dessert.svg'],
    ['Tiramisú', 'Postre italiano de café y mascarpone', 90.00, 42.00, 12, 3, 9, 'chocolate-cake.jpg'],
    ['Flan de Coco', 'Flan cremoso de coco', 46.00, 18.00, 18, 5, 9, 'avatar-dessert.svg'],
    ['Marquesa de Galleta', 'Capas de galleta y crema', 58.00, 24.00, 14, 4, 9, 'chocolate-cookies.jpg'],
    // Brunch de la casa (10)
    ['Hot Cakes con Maple', 'Hot cakes con jarabe de maple', 92.00, 40.00, 16, 4, 10, 'pancakes.jpg'],
    ['Bagel de Salmón', 'Bagel con salmón ahumado y queso', 110.00, 48.00, 10, 3, 10, 'avatar-brunch.svg'],
    ['Bowl de Açaí', 'Açaí con granola y frutas', 98.00, 42.00, 12, 3, 10, 'avatar-brunch.svg'],
    ['Sandwich de Pavo', 'Torta de pavo con ensalada', 84.00, 36.00, 18, 4, 10, 'grilled-sandwich.jpg'],
    // Bebidas frías (11)
    ['Frappé de Caramelo', 'Bebida fría de café con caramelo', 72.00, 30.00, 24, 6, 11, 'avatar-iced.svg'],
    ['Smoothie de Fresa', 'Batido de fresa natural', 66.00, 27.00, 22, 6, 11, 'mango-drink.jpg'],
    ['Cold Brew Nitro', 'Café frío infusionado con nitrógeno', 68.00, 28.00, 18, 5, 11, 'latte-beans.jpg'],
    ['Limonada de Lavanda', 'Limonada artesanal de lavanda', 58.00, 22.00, 22, 6, 11, 'avatar-iced.svg'],
];

$db = new Database();

// ---- 1. Productos nuevos (idempotente por barcode) ----
$existing = array_flip(array_column(
    $db->select('SELECT barcode FROM products WHERE store_id = ? AND barcode IS NOT NULL', [$storeId]),
    'barcode'
));
$insertedProducts = 0;
$base = 9100000000000;
foreach ($newProducts as $i => $p) {
    $barcode = (string)($base + $i);
    if (isset($existing[$barcode])) continue;
    $productId = $db->insert(
        'INSERT INTO products (store_id, category_id, product_name, description, barcode, price, cost, current_stock, min_stock, status, image_path, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())',
        [$storeId, $p[6], $p[0], $p[1], $barcode, $p[2], $p[3], $p[4], $p[5], 'active', $imgBase . $p[7]]
    );
    if ($p[4] > 0) {
        $db->insert(
            'INSERT INTO inventory_movements (store_id, product_id, user_id, movement_type, quantity, previous_stock, new_stock, notes, created_at)
             VALUES (?,?,?,?,?,?,?,?,NOW())',
            [$storeId, $productId, 2, 'adjustment', $p[4], 0, $p[4], 'Stock inicial (seed demo)']
        );
    }
    $existing[$barcode] = true;
    $insertedProducts++;
}
echo "Productos nuevos insertados: {$insertedProducts}\n";

// ---- 2. Caja cerrada demo (para las ventas históricas) ----
$reg = $db->selectOne('SELECT register_id FROM cash_registers WHERE store_id = ? ORDER BY register_id DESC LIMIT 1', [$storeId]);
if (!$reg) {
    $term = $db->selectOne('SELECT terminal_id FROM terminals WHERE store_id = ? LIMIT 1', [$storeId]);
    $regId = $db->insert(
        'INSERT INTO cash_registers (store_id, terminal_id, user_id, opening_date, closing_date, initial_amount, final_amount, expected_amount, difference, status, notes)
         VALUES (?,?,?, DATE_SUB(NOW(), INTERVAL 7 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY), 500, 3200, 3200, 0, \'closed\', \'Caja demo (semana)\')',
        [$storeId, $term['terminal_id'], 2]
    );
    $registerId = $regId;
} else {
    $registerId = (int)$reg['register_id'];
}

// ---- 3. Ventas ficticias con detalle, relativas a HOY (install-relative) ----
$allProducts = $db->select('SELECT product_id, price, cost FROM products WHERE store_id = ? AND status = \'active\'', [$storeId]);
if (!$allProducts) { echo "Sin productos para ventas demo.\n"; exit(0); }

$totalSales = 0;
// Distribución: últimos 5 días, 3-4 ventas por día en horarios distintos.
for ($day = 0; $day <= 4; $day++) {
    $salesThatDay = 3 + ($day % 2); // 3 o 4
    for ($k = 0; $k < $salesThatDay; $k++) {
        $hour = 9 + $k * 2 + ($day % 3); // 9h..17h aprox
        $saleDate = sprintf('DATE_SUB(NOW(), INTERVAL %d DAY) + INTERVAL %d HOUR', $day, $hour);
        // Marca temporal única por (día, hora): evita duplicar si se re-corre.
        $dup = $db->selectOne(
            "SELECT sale_id FROM sales WHERE store_id = ? AND HOUR(DATE_ADD(sale_date, INTERVAL 0 SECOND)) = ? AND DATE(sale_date) = DATE(DATE_SUB(NOW(), INTERVAL ? DAY)) LIMIT 1",
            [$storeId, $hour, $day]
        );
        if ($dup) continue;

        // 1-3 líneas de productos aleatorios (nuevos o existentes)
        $nLines = mt_rand(1, 3);
        $picked = [];
        $n = count($allProducts);
        for ($li = 0; $li < $nLines; $li++) {
            $picked[] = $allProducts[mt_rand(0, $n - 1)];
        }
        // Cabecera de venta
        $subtotal = 0; $lines = [];
        foreach ($picked as $pp) {
            $qty = mt_rand(1, 3);
            $subtotal += round($qty * (float)$pp['price'], 2);
            $lines[] = [$pp, $qty];
        }
        $pay = ['cash', 'cash', 'cash', 'card', 'mixed'][mt_rand(0, 4)];
        $saleId = $db->insert(
            "INSERT INTO sales (store_id, user_id, register_id, sale_date, subtotal, tax, discount, total, amount_paid, payment_method, status)
             VALUES (?,?,?, {$saleDate}, ?, 0, 0, ?, ?, ?, 'completed')",
            [$storeId, 2, $registerId, $subtotal, $subtotal, $subtotal, $pay]
        );
        foreach ($lines as [$pp, $qty]) {
            $db->insert(
                'INSERT INTO sale_details (sale_id, product_id, quantity, unit_price, unit_cost, subtotal, discount, total)
                 VALUES (?,?,?,?,?,?,0,?)',
                [$saleId, $pp['product_id'], $qty, $pp['price'], $pp['cost'], round($qty * (float)$pp['price'], 2), round($qty * (float)$pp['price'], 2)]
            );
        }
        $totalSales++;
    }
}
echo "Ventas ficticias insertadas: {$totalSales}\n";
echo "Seed demo Genso Cafe completado.\n";
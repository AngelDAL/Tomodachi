<?php
/**
 * Focused regression tests for promotion quantities.
 * Run: php tests/promotion_rules_test.php
 */
require_once __DIR__ . '/../includes/PromotionRules.class.php';

$failures = 0;
function expectSame($expected, $actual, $message) {
    global $failures;
    if ($expected !== $actual) {
        $failures++;
        fwrite(STDERR, "FAIL: $message\nExpected: " . var_export($expected, true) . "\nActual: " . var_export($actual, true) . "\n");
    } else {
        fwrite(STDOUT, "PASS: $message\n");
    }
}

// 3x2: every complete group of three contains one free unit; extras keep normal price.
expectSame(2, PromotionRules::paidUnitsForBulk(3, 3, 2), '3x2 charges two units');
expectSame(4, PromotionRules::paidUnitsForBulk(6, 3, 2), 'two 3x2 groups charge four units');
expectSame(3, PromotionRules::paidUnitsForBulk(4, 3, 2), '3x2 leaves an extra unit at its normal price');
expectSame(2, PromotionRules::paidUnitsForBulk(2, 3, 2), '3x2 does not apply before three units');
expectSame(4, PromotionRules::paidUnitsForBulk(5, 5, 4), '5x4 charges four units');

// A bundle must honor the individually requested quantities, not merely one of each target.
$targets = [
    ['product_id' => 10, 'required_quantity' => 2],
    ['product_id' => 20, 'required_quantity' => 3],
    ['product_id' => 30, 'required_quantity' => 1],
];
$cart = [10 => 4, 20 => 6, 30 => 2];
expectSame(2, PromotionRules::completeBundles($cart, $targets), 'bundle 2+3+1 can form two complete sets');
$cart[20] = 5;
expectSame(1, PromotionRules::completeBundles($cart, $targets), 'bundle is limited by the target that lacks its requested quantity');

// Reparto del PAQUETE: las unidades sobrantes se cobran a precio original.
// Defecto corregido el 7-oct-2026: 3 almendras de $45 con paquete "2 x $30" se cobraban
// a $30 (el servidor metía la línea completa al paquete) en vez de a $75.
$simple = function ($qty, $bundlePrice) {
    return PromotionRules::bundleAllocation([[0]], [2], [0 => ['quantity' => $qty, 'original_price' => 45]], $bundlePrice);
};
$cobrado = function ($plan, $qty, $original) {
    $enPaquete = $plan['units'][0] ?? 0;
    return round(($plan['revenue'][0] ?? 0) + ($qty - $enPaquete) * $original, 2);
};
expectSame(0, $simple(1, 30)['bundles'], 'sin las dos piezas no hay paquete');
expectSame(45.0, $cobrado($simple(1, 30), 1, 45), 'una pieza se cobra a precio original');
expectSame(30.0, $cobrado($simple(2, 30), 2, 45), 'dos piezas son el paquete de $30');
expectSame(75.0, $cobrado($simple(3, 30), 3, 45), 'la tercera pieza se paga aparte: 30 + 45');
expectSame(60.0, $cobrado($simple(4, 30), 4, 45), 'cuatro piezas son dos paquetes');
expectSame(105.0, $cobrado($simple(5, 30), 5, 45), 'cinco piezas son dos paquetes + una suelta');
expectSame(0, PromotionRules::bundleAllocation([[0]], [2], [0 => ['quantity' => 3, 'original_price' => 45]], 200)['bundles'],
    'un paquete más caro que la suma de sus partes no se aplica');
// Un mismo producto en dos objetivos no aporta unidades por duplicado.
expectSame(0, PromotionRules::bundleAllocation([[0], [0]], [2, 2], [0 => ['quantity' => 3, 'original_price' => 45]], 30)['bundles'],
    'tres piezas no alcanzan para dos objetivos que piden dos cada uno');
expectSame(1, PromotionRules::bundleAllocation([[0], [0]], [2, 2], [0 => ['quantity' => 4, 'original_price' => 45]], 30)['bundles'],
    'cuatro piezas sí alcanzan para dos objetivos de dos');

// Dos objetivos con sus propias cantidades: el paquete se reparte entre las líneas.
$plan = PromotionRules::bundleAllocation([[0], [1]], [2, 1],
    [0 => ['quantity' => 3, 'original_price' => 20], 1 => ['quantity' => 2, 'original_price' => 15]], 45);
expectSame(1, $plan['bundles'], '2 refrescos + 1 papas arman un paquete');
$totalDosLineas = round(($plan['revenue'][0] + (3 - $plan['units'][0]) * 20) + ($plan['revenue'][1] + (2 - $plan['units'][1]) * 15), 2);
expectSame(80.0, $totalDosLineas, 'paquete de $45 + 1 refresco ($20) + 1 papas ($15) = $80');

if ($failures > 0) {
    exit(1);
}

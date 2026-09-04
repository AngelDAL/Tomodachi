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

if ($failures > 0) {
    exit(1);
}

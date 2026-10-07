const assert = require('assert');
const { bundleUnitPrice, completeBundles, bundleAllocation, roundMoney } = require('../public/js/promotion-client-rules.js');
assert.strictEqual(completeBundles(5, 5), 1);
assert.strictEqual(bundleUnitPrice(20, 5, 5, 50), 10);
assert.strictEqual(bundleUnitPrice(20, 10, 5, 50), 10);
assert.strictEqual(bundleUnitPrice(20, 6, 5, 50), (50 + 20) / 6);
// El reparto del paquete es el MISMO que PromotionRules::bundleAllocation() en PHP:
// el carrito que ve el cajero y lo que cobra el servidor no pueden diferir.
// Defecto corregido el 7-oct-2026: las unidades sobrantes salían gratis.
function cobrado(plan, key, qty, original) {
  const enPaquete = plan.units[key] || 0;
  return roundMoney((plan.revenue[key] || 0) + (qty - enPaquete) * original);
}
const simple = (qty, price) => bundleAllocation([[0]], [2], { 0: { quantity: qty, original_price: 45 } }, price);
assert.strictEqual(simple(1, 30).bundles, 0, 'sin las dos piezas no hay paquete');
assert.strictEqual(cobrado(simple(2, 30), 0, 2, 45), 30);
assert.strictEqual(cobrado(simple(3, 30), 0, 3, 45), 75, 'la tercera pieza se paga aparte');
assert.strictEqual(cobrado(simple(4, 30), 0, 4, 45), 60);
assert.strictEqual(cobrado(simple(5, 30), 0, 5, 45), 105, 'dos paquetes + una suelta');
assert.strictEqual(simple(3, 200).bundles, 0, 'un paquete más caro que el original no se aplica');
assert.strictEqual(bundleAllocation([[0], [0]], [2, 2], { 0: { quantity: 3, original_price: 45 } }, 30).bundles, 0,
  'un producto en dos objetivos no aporta unidades por duplicado');
assert.strictEqual(bundleAllocation([[0], [0]], [2, 2], { 0: { quantity: 4, original_price: 45 } }, 30).bundles, 1);

const plan = bundleAllocation([[0], [1]], [2, 1],
  { 0: { quantity: 3, original_price: 20 }, 1: { quantity: 2, original_price: 15 } }, 45);
assert.strictEqual(plan.bundles, 1);
assert.strictEqual(roundMoney(cobrado(plan, 0, 3, 20) + cobrado(plan, 1, 2, 15)), 80,
  'paquete + sobrantes de las dos líneas');

console.log('promotion bundle cart rules: 15 checks passed');

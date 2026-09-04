const assert = require('assert');
const { bundleUnitPrice, completeBundles } = require('../public/js/promotion-client-rules.js');
assert.strictEqual(completeBundles(5, 5), 1);
assert.strictEqual(bundleUnitPrice(20, 5, 5, 50), 10);
assert.strictEqual(bundleUnitPrice(20, 10, 5, 50), 10);
assert.strictEqual(bundleUnitPrice(20, 6, 5, 50), (50 + 20) / 6);
console.log('promotion bundle cart rules: 3 checks passed');

const assert = require('assert');
const { paidUnitsForBulk, bulkUnitPrice } = require('../public/js/promotion-client-rules.js');
assert.strictEqual(paidUnitsForBulk(5, 3, 2), 4);
assert.strictEqual(bulkUnitPrice(30, 5, 3, 2), 24);
assert.strictEqual(bulkUnitPrice(30, 2, 3, 2), 30);
console.log('promotion cart rules: 3 checks passed');

function paidUnitsForBulk(quantity, take, pay) {
  quantity = Math.max(0, Math.floor(Number(quantity) || 0));
  take = Math.floor(Number(take) || 0);
  pay = Math.floor(Number(pay) || 0);
  if (take < 1 || pay < 0 || pay >= take) return quantity;
  return Math.floor(quantity / take) * pay + (quantity % take);
}
function bulkUnitPrice(originalPrice, quantity, take, pay) {
  quantity = Number(quantity) || 0;
  if (quantity <= 0) return Number(originalPrice) || 0;
  return (Number(originalPrice) || 0) * paidUnitsForBulk(quantity, take, pay) / quantity;
}
function completeBundles(quantity, requiredQuantity) {
  quantity = Math.max(0, Math.floor(Number(quantity) || 0));
  requiredQuantity = Math.max(1, Math.floor(Number(requiredQuantity) || 1));
  return Math.floor(quantity / requiredQuantity);
}
function bundleUnitPrice(originalPrice, quantity, requiredQuantity, bundlePrice) {
  quantity = Number(quantity) || 0;
  if (quantity <= 0) return Number(originalPrice) || 0;
  const bundles = completeBundles(quantity, requiredQuantity);
  if (!bundles) return Number(originalPrice) || 0;
  const bundledQty = bundles * Math.max(1, Number(requiredQuantity) || 1);
  const regularQty = quantity - bundledQty;
  return (bundles * (Number(bundlePrice) || 0) + regularQty * (Number(originalPrice) || 0)) / quantity;
}
function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Reparto de un PAQUETE (precio fijo por set). Espejo exacto de
 * PromotionRules::bundleAllocation() en PHP: el carrito y el servidor tienen que
 * cobrar lo mismo.
 *
 * Solo las unidades que forman paquetes completos llevan descuento; las sobrantes
 * se pagan a precio original. (Defecto corregido el 7-oct-2026: 3 almendras de $45
 * con paquete "2 x $30" se cobraban a $30 en vez de a $75.)
 *
 * @param {Array<Array<string|number>>} coverage     objetivo => claves de línea que lo cumplen
 * @param {Array<number>} requirements               objetivo => unidades que pide por paquete
 * @param {Object} available                         clave de línea => { quantity, original_price }
 * @param {number} bundlePrice                       precio final de UN paquete completo
 * @returns {{bundles:number, units:Object, original:Object, revenue:Object}}
 */
function bundleAllocation(coverage, requirements, available, bundlePrice) {
  const empty = { bundles: 0, units: {}, original: {}, revenue: {} };
  if (!coverage || !coverage.length) return empty;

  const quantity = {}, price = {};
  Object.keys(available).forEach(function (key) {
    quantity[key] = Math.max(0, Number(available[key].quantity) || 0);
    price[key] = Number(available[key].original_price) || 0;
  });

  let setSize = 0;
  (requirements || []).forEach(function (required) {
    setSize += Math.max(1, Math.floor(Number(required) || 1));
  });
  if (setSize <= 0) return empty;

  const totalUnits = Object.keys(quantity).reduce(function (sum, key) { return sum + quantity[key]; }, 0);
  const maxSets = Math.floor(totalUnits / setSize) + 1;
  const claimed = {};
  let bundles = 0;

  // Se arman los paquetes DE UNO EN UNO consumiendo unidades: contar cada objetivo
  // por separado daría unidades por duplicado cuando un producto cumple dos objetivos.
  for (let attempt = 0; attempt < maxSets; attempt++) {
    const proposed = {};
    let complete = true;
    for (let i = 0; i < coverage.length; i++) {
      let needed = Math.max(1, Math.floor(Number(requirements[i]) || 1));
      const keys = coverage[i] || [];
      for (let j = 0; j < keys.length; j++) {
        if (needed <= 0) break;
        const key = keys[j];
        const free = (quantity[key] || 0) - (claimed[key] || 0) - (proposed[key] || 0);
        if (free <= 0) continue;
        const take = Math.min(free, needed);
        proposed[key] = (proposed[key] || 0) + take;
        needed -= take;
      }
      if (needed > 0) { complete = false; break; }
    }
    if (!complete) break;
    Object.keys(proposed).forEach(function (key) { claimed[key] = (claimed[key] || 0) + proposed[key]; });
    bundles++;
  }

  if (bundles <= 0) return empty;

  let pool = 0;
  Object.keys(claimed).forEach(function (key) { pool += claimed[key] * (price[key] || 0); });
  const cost = bundles * (Number(bundlePrice) || 0);
  // Un "paquete" más caro que la suma de sus partes no es una promoción.
  if (pool <= 0 || cost > pool) return empty;

  const ratio = cost / pool;
  const result = { bundles: bundles, units: {}, original: {}, revenue: {} };
  Object.keys(claimed).forEach(function (key) {
    const original = claimed[key] * (price[key] || 0);
    result.units[key] = claimed[key];
    result.original[key] = original;
    result.revenue[key] = original * ratio;
  });
  return result;
}

if (typeof module !== 'undefined') module.exports = { paidUnitsForBulk, bulkUnitPrice, completeBundles, bundleUnitPrice, roundMoney, bundleAllocation };

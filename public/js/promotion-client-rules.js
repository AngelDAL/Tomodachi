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
if (typeof module !== 'undefined') module.exports = { paidUnitsForBulk, bulkUnitPrice, completeBundles, bundleUnitPrice };

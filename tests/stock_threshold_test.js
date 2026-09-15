/**
 * Prueba del umbral de existencias (T0.1 — Fase 0).
 *
 * Lo que pidió el dueño: "el usuario define su rango mínimo de stock y a partir de ahí
 * es como que debería aparecer en rojo". Es decir: la marca roja sale del `min_stock`
 * QUE EL PRODUCTO DEFINE, no de un número fijo en el código. Antes el badge del punto
 * de venta usaba `< 5` escrito a mano, y por eso no coincidía con la ficha del producto.
 *
 * Se prueba la regla (una sola, compartida) y además el contrato: que los dos
 * consumidores la usen y que no vuelva a colarse un umbral fijo.
 *
 * Uso: node tests/stock_threshold_test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const regla = require('../public/js/stock-rule.js');
const { level, classes, tooltip } = regla;

let pasadas = 0;
function probar(nombre, fn) {
  try {
    fn();
    pasadas++;
    console.log('PASS | ' + nombre);
  } catch (e) {
    console.log('FAIL | ' + nombre + ' -> ' + e.message);
    process.exitCode = 1;
  }
}

// ─── 1. La regla, caso por caso ─────────────────────────────────────────────
probar('existencia muy por encima del mínimo: normal', () => {
  assert.strictEqual(level(10, 5), 'ok');
});
probar('existencia exactamente en el mínimo: rojo (a partir de ahí)', () => {
  assert.strictEqual(level(5, 5), 'low');
});
probar('existencia por debajo del mínimo: rojo', () => {
  assert.strictEqual(level(3, 5), 'low');
});
probar('sin mínimo definido (0) y existencia baja: NORMAL, no rojo', () => {
  // Éste es el caso que el dueño aclaró: si él no define mínimo, el sistema no inventa uno.
  assert.strictEqual(level(3, 0), 'ok');
});
probar('sin mínimo definido y existencia en cero: rojo', () => {
  assert.strictEqual(level(0, 0), 'out');
});
probar('existencia en cero: rojo', () => {
  assert.strictEqual(level(0, 5), 'out');
});
probar('existencia negativa: rojo', () => {
  assert.strictEqual(level(-7, 5), 'out');
});
probar('existencia negativa sin mínimo: rojo', () => {
  assert.strictEqual(level(-2, 0), 'out');
});
probar('cantidades decimales a granel: 1.5 con mínimo 2 → rojo', () => {
  assert.strictEqual(level(1.5, 2), 'low');
});
probar('cantidades decimales por encima del mínimo: 2.5 con mínimo 2 → normal', () => {
  assert.strictEqual(level(2.5, 2), 'ok');
});
probar('números que llegan como texto desde la API', () => {
  assert.strictEqual(level('3', '5'), 'low');
  assert.strictEqual(level('40', '5'), 'ok');
});
probar('existencia ausente: no se marca', () => {
  assert.strictEqual(level(null, 5), 'ok');
  assert.strictEqual(level(undefined, 5), 'ok');
  assert.strictEqual(level('', 5), 'ok');
});

// ─── 2. Clases CSS que pintan la marca ─────────────────────────────────────
probar('normal: sin clases', () => {
  assert.strictEqual(classes(10, 5), '');
  assert.strictEqual(classes(3, 0), '');
});
probar('bajo: clase low', () => {
  assert.strictEqual(classes(3, 5), 'low');
});
probar('negativo: low + negative (el triángulo)', () => {
  assert.strictEqual(classes(-7, 5), 'low negative');
  assert.strictEqual(classes(-7, 0), 'low negative');
});
probar('cero: low, sin triángulo', () => {
  assert.strictEqual(classes(0, 5), 'low');
});

// ─── 3. El tooltip explica qué es el número y cuál es el mínimo ────────────
probar('tooltip normal dice que son las existencias', () => {
  assert.ok(/Existencias disponibles: 10/.test(tooltip(10, 0)), 'esperaba el conteo');
});
probar('tooltip normal incluye el mínimo cuando está definido', () => {
  assert.ok(/mínimo 5/i.test(tooltip(10, 5)), 'esperaba la referencia al mínimo: ' + tooltip(10, 5));
});
probar('tooltip bajo avisa que conviene reabastecer', () => {
  const t = tooltip(3, 5);
  assert.ok(/Existencias disponibles: 3/.test(t), 'esperaba el conteo: ' + t);
  assert.ok(/mínimo 5/i.test(t), 'esperaba el mínimo: ' + t);
  assert.ok(/conviene reabastecer/i.test(t), 'esperaba el aviso: ' + t);
});
probar('tooltip en cero/negativo dice que no hay existencias', () => {
  assert.ok(/Sin existencias/.test(tooltip(0, 5)));
  assert.ok(/Sin existencias/.test(tooltip(-7, 5)));
});

// ─── 4. Contrato: una sola regla y ningún umbral fijo escondido ────────────
const dirJs = path.join(__dirname, '..', 'public', 'js');
const consumidores = [
  ['punto de venta (badge de las tarjetas)', 'sales.js'],
  ['compras (Próximas Compras)', 'purchases.js'],
];
for (const [etiqueta, archivo] of consumidores) {
  probar(etiqueta + ': usa la regla compartida', () => {
    const src = fs.readFileSync(path.join(dirJs, archivo), 'utf8');
    assert.ok(/stockLevel\(|stockClasses\(|stockTooltip\(/.test(src),
      archivo + ' no llama a la regla compartida de stock-rule.js');
  });
  probar(etiqueta + ': sin umbral fijo en el código', () => {
    const src = fs.readFileSync(path.join(dirJs, archivo), 'utf8');
    // Se busca una comparación de existencias contra un número escrito a mano. Comparar
    // contra 0 sí es legítimo ("hay o no hay"), y eso lo cubre la regla compartida; lo que
    // no puede pasar es un umbral como el viejo `< 5`.
    const sospechosas = src
      .split('\n')
      .map((linea, i) => [i + 1, linea])
      .filter(([, linea]) => /stock/i.test(linea) && /[<>]=?\s*[1-9]\d*/.test(linea) && !/min_stock|minStock|negative/.test(linea));
    assert.strictEqual(sospechosas.length, 0,
      'umbral fijo sospechoso en ' + archivo + ':' + sospechosas.map(([n]) => n).join(','));
  });
}

console.log('\nstock threshold: ' + pasadas + ' comprobaciones pasadas' +
  (process.exitCode ? ' — CON FALLAS' : ' — todo en verde'));

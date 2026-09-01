const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeDelta, buildMaterialLedgerRow, buildGoodsLedgerRow } = require('./InventoryLogic.js');

test('computeDelta returns null for blank input', () => {
  assert.equal(computeDelta(10, ''), null);
  assert.equal(computeDelta(10, undefined), null);
});

test('computeDelta returns null when fact equals current', () => {
  assert.equal(computeDelta(10, '10'), null);
});

test('computeDelta returns the signed difference', () => {
  assert.equal(computeDelta(10, '15'), 5);
  assert.equal(computeDelta(10, '4'), -6);
});

test('computeDelta returns null for non-numeric input', () => {
  assert.equal(computeDelta(10, 'abc'), null);
});

test('computeDelta handles a negative current stock (real data has these)', () => {
  assert.equal(computeDelta(-3, '5'), 8);
});

test('buildMaterialLedgerRow: positive delta is Приход', () => {
  const row = buildMaterialLedgerRow('XEROX Бумага', 8, '01.09.2026');
  assert.deepEqual(row, { type: 'Приход', quantity: 8, note: 'Инвентаризация от 01.09.2026' });
});

test('buildMaterialLedgerRow: negative delta is Списание with absolute quantity', () => {
  const row = buildMaterialLedgerRow('ПВХ', -3, '01.09.2026');
  assert.deepEqual(row, { type: 'Списание', quantity: 3, note: 'Инвентаризация от 01.09.2026' });
});

test('buildGoodsLedgerRow: positive delta goes to "Куда"', () => {
  const row = buildGoodsLedgerRow(5, 'Основной склад', '01.09.2026');
  assert.deepEqual(row, { type: 'Инвентаризация', from: '', to: 'Основной склад', quantity: 5, note: 'Инвентаризация от 01.09.2026' });
});

test('buildGoodsLedgerRow: negative delta goes to "Откуда"', () => {
  const row = buildGoodsLedgerRow(-2, 'Teplo Store (TAS)', '01.09.2026');
  assert.deepEqual(row, { type: 'Инвентаризация', from: 'Teplo Store (TAS)', to: '', quantity: 2, note: 'Инвентаризация от 01.09.2026' });
});

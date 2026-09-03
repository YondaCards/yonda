const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeDelta, buildMaterialLedgerRow, buildGoodsLedgerRow, classifyGoodsDelta } = require('./InventoryLogic.js');

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

test('buildGoodsLedgerRow: still defaults to Инвентаризация when no type given (back-compat)', () => {
  const row = buildGoodsLedgerRow(5, 'Основной склад', '01.09.2026');
  assert.equal(row.type, 'Инвентаризация');
  assert.equal(row.note, 'Инвентаризация от 01.09.2026');
});

test('buildGoodsLedgerRow: explicit Продажа type changes the note wording', () => {
  const row = buildGoodsLedgerRow(-4, 'Основной склад', '01.09.2026', 'Продажа');
  assert.deepEqual(row, { type: 'Продажа', from: 'Основной склад', to: '', quantity: 4, note: 'Сверка продаж от 01.09.2026' });
});

test('classifyGoodsDelta: positive delta on a postcard variety mirrors to the aggregate', () => {
  assert.deepEqual(classifyGoodsDelta(6, true, false), { type: 'Инвентаризация', mirrorToAggregate: true });
});

test('classifyGoodsDelta: positive delta on a regular product never mirrors', () => {
  assert.deepEqual(classifyGoodsDelta(6, false, true), { type: 'Инвентаризация', mirrorToAggregate: false });
});

test('classifyGoodsDelta: negative delta + reconciliation ON is a sale, no mirror (already deducted live at checkout)', () => {
  assert.deepEqual(classifyGoodsDelta(-3, true, true), { type: 'Продажа', mirrorToAggregate: false });
});

test('classifyGoodsDelta: negative delta + reconciliation OFF is a loss that still mirrors', () => {
  assert.deepEqual(classifyGoodsDelta(-3, true, false), { type: 'Инвентаризация', mirrorToAggregate: true });
});

test('classifyGoodsDelta: negative delta on a regular product is unaffected by the toggle', () => {
  assert.deepEqual(classifyGoodsDelta(-3, false, true), { type: 'Инвентаризация', mirrorToAggregate: false });
});

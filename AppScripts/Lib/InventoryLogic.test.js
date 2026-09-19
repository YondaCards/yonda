const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeDelta, buildMaterialLedgerRow, buildGoodsLedgerRow, classifyGoodsDelta, buildMovementRows, validateMovement } = require('./InventoryLogic.js');

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

test('validateMovement: rejects unknown action', () => {
  assert.match(validateMovement('foo', 'A', '', ''), /действие/i);
});

test('validateMovement: transfer needs two different warehouses', () => {
  assert.match(validateMovement('transfer', '', '', 'B'), /./);
  assert.match(validateMovement('transfer', '', 'A', ''), /./);
  assert.match(validateMovement('transfer', '', 'A', 'A'), /./);
  assert.equal(validateMovement('transfer', '', 'A', 'B'), null);
});

test('validateMovement: production and writeoff need a location', () => {
  assert.match(validateMovement('production', '', '', ''), /./);
  assert.match(validateMovement('writeoff', '', '', ''), /./);
  assert.equal(validateMovement('production', 'A', '', ''), null);
  assert.equal(validateMovement('writeoff', 'A', '', ''), null);
});

test('buildMovementRows: skips blank, zero, non-numeric and negative quantities', () => {
  const rows = buildMovementRows('writeoff', 'A', '', '', [
    { name: 'x', quantity: '' }, { name: 'y', quantity: '0' },
    { name: 'z', quantity: 'abc' }, { name: 'w', quantity: '-2' },
  ]);
  assert.deepEqual(rows, []);
});

test('buildMovementRows: writeoff is a Продажа from the location', () => {
  assert.deepEqual(buildMovementRows('writeoff', 'A', '', '', [{ name: 'x', quantity: '3' }]),
    [{ name: 'x', quantity: 3, vidDeistviya: 'Продажа', from: 'A', to: '' }]);
});

test('buildMovementRows: transfer is a Перемещение from -> to', () => {
  assert.deepEqual(buildMovementRows('transfer', '', 'A', 'B', [{ name: 'x', quantity: '2' }]),
    [{ name: 'x', quantity: 2, vidDeistviya: 'Перемещение', from: 'A', to: 'B' }]);
});

test('buildMovementRows: production is a Пополнение/Производство into the location', () => {
  assert.deepEqual(buildMovementRows('production', 'A', '', '', [{ name: 'x', quantity: '5' }]),
    [{ name: 'x', quantity: 5, vidDeistviya: 'Пополнение', opType: 'Производство', from: '', to: 'A' }]);
});

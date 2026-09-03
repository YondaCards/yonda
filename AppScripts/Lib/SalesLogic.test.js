const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeCartTotal, buildSaleGoodsRows, buildOperationsRow, buildTelegramSaleMessage } = require('./SalesLogic.js');

test('computeCartTotal sums price × qty across all items', () => {
  assert.equal(computeCartTotal([{ price: 15000, qty: 2 }, { price: 5000, qty: 1 }]), 35000);
});

test('computeCartTotal returns 0 for an empty cart', () => {
  assert.equal(computeCartTotal([]), 0);
});

test('buildSaleGoodsRows keeps only stock items, drops free-form services', () => {
  const rows = buildSaleGoodsRows([
    { name: 'Открытка', qty: 3, price: 15000, isCustom: false },
    { name: 'Гравировка на заказ', qty: 1, price: 20000, isCustom: true },
  ]);
  assert.deepEqual(rows, [{ name: 'Открытка', quantity: 3 }]);
});

test('buildOperationsRow uses the payment type directly as the account name', () => {
  const row = buildOperationsRow([{ name: 'Открытка', qty: 2, price: 15000 }], 'Карта (личная)');
  assert.deepEqual(row, {
    type: 'Доход',
    amount: 30000,
    account: 'Карта (личная)',
    category: 'Продажа товаров',
    note: 'Открытка x2 = 30000',
  });
});

test('buildOperationsRow lists every item, including services, with qty × price in the note', () => {
  const row = buildOperationsRow([
    { name: 'Открытка', qty: 2, price: 15000 },
    { name: 'Гравировка на заказ', qty: 1, price: 20000, isCustom: true },
  ], 'Наличка');
  assert.equal(row.note, 'Открытка x2 = 30000, Гравировка на заказ x1 = 20000');
  assert.equal(row.amount, 50000);
});

test('buildOperationsRow reflects a manually overridden line price in both the note and the total', () => {
  const row = buildOperationsRow([{ name: 'Открытка', qty: 2, price: 20000 }], 'Наличка'); // catalog price is 15000, cashier overrode this line's total to 40000 (20000/unit)
  assert.equal(row.note, 'Открытка x2 = 40000');
  assert.equal(row.amount, 40000);
});

test('buildOperationsRow: whole-cart totalOverride replaces amount without touching any line', () => {
  const items = [
    { name: 'Открытка', qty: 5, price: 25000 },       // 125000
    { name: 'Фотоальбом «Мгновения»', qty: 1, price: 75000 }, // 75000
    { name: 'Гравировка на заказ', qty: 1, price: 125000, isCustom: true }, // 125000
  ]; // subtotal 325000, cashier corrects it to 300000 for the whole order
  const row = buildOperationsRow(items, 'Наличка', 300000);
  assert.equal(row.amount, 300000);
  assert.equal(row.note, 'Открытка x5 = 125000, Фотоальбом «Мгновения» x1 = 75000, Гравировка на заказ x1 = 125000, Итого по позициям: 325000, к оплате: 300000');
});

test('buildOperationsRow: totalOverride equal to the subtotal is treated as no override', () => {
  const row = buildOperationsRow([{ name: 'Открытка', qty: 2, price: 15000 }], 'Наличка', 30000);
  assert.equal(row.amount, 30000);
  assert.equal(row.note, 'Открытка x2 = 30000');
});

test('buildTelegramSaleMessage lists every item with its line total, point, payment and grand total', () => {
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU') + ' сум';
  const msg = buildTelegramSaleMessage(
    [{ name: 'Открытка', qty: 2, price: 15000 }],
    'Маркеты',
    'Наличка',
    fmt
  );
  assert.match(msg, /Открытка × 2 — 30 000 сум/);
  assert.match(msg, /Точка: Маркеты/);
  assert.match(msg, /Оплата: Наличка/);
  assert.match(msg, /Итого: 30 000 сум/);
});

test('buildTelegramSaleMessage shows the corrected total when the whole cart was overridden', () => {
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU') + ' сум';
  const msg = buildTelegramSaleMessage(
    [{ name: 'Открытка', qty: 2, price: 15000 }],
    'Маркеты',
    'Наличка',
    fmt,
    25000
  );
  assert.match(msg, /Итого: 25 000 сум/);
});

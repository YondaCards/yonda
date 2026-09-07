const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateExpenseInput, buildExpenseRow, buildTelegramExpenseMessage } = require('./ExpenseLogic.js');

test('validateExpenseInput rejects a missing category', () => {
  assert.equal(validateExpenseInput('', 1000, 'Наличка'), 'Не выбрана категория расхода.');
});

test('validateExpenseInput rejects a missing payment type', () => {
  assert.equal(validateExpenseInput('Прочее', 1000, ''), 'Не выбран тип оплаты.');
});

test('validateExpenseInput rejects a zero amount', () => {
  assert.equal(validateExpenseInput('Прочее', 0, 'Наличка'), 'Сумма расхода должна быть больше нуля.');
});

test('validateExpenseInput rejects a negative amount', () => {
  assert.equal(validateExpenseInput('Прочее', -500, 'Наличка'), 'Сумма расхода должна быть больше нуля.');
});

test('validateExpenseInput rejects a non-numeric amount', () => {
  assert.equal(validateExpenseInput('Прочее', 'abc', 'Наличка'), 'Сумма расхода должна быть больше нуля.');
});

test('validateExpenseInput rejects an empty-string amount', () => {
  assert.equal(validateExpenseInput('Прочее', '', 'Наличка'), 'Сумма расхода должна быть больше нуля.');
});

test('validateExpenseInput rejects a null amount', () => {
  assert.equal(validateExpenseInput('Прочее', null, 'Наличка'), 'Сумма расхода должна быть больше нуля.');
});

test('validateExpenseInput rejects an undefined amount', () => {
  assert.equal(validateExpenseInput('Прочее', undefined, 'Наличка'), 'Сумма расхода должна быть больше нуля.');
});

test('validateExpenseInput rejects a non-finite amount', () => {
  assert.equal(validateExpenseInput('Прочее', Infinity, 'Наличка'), 'Сумма расхода должна быть больше нуля.');
});

test('validateExpenseInput accepts valid input', () => {
  assert.equal(validateExpenseInput('Прочее', 192000, 'Наличка'), null);
});

test('buildExpenseRow carries the already-resolved account straight through, defaulting note to empty string', () => {
  assert.deepEqual(
    buildExpenseRow('Расходные материалы', 400000, 'Личная карта', undefined),
    { category: 'Расходные материалы', amount: 400000, account: 'Личная карта', note: '' }
  );
});

test('buildExpenseRow keeps a given note as-is', () => {
  assert.deepEqual(
    buildExpenseRow('Аренда', 1500000, 'Расчётный счёт', 'Аренда за сентябрь'),
    { category: 'Аренда', amount: 1500000, account: 'Расчётный счёт', note: 'Аренда за сентябрь' }
  );
});

test('buildTelegramExpenseMessage formats the full message without a note', () => {
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU') + ' сум';
  const msg = buildTelegramExpenseMessage('Услуги полиграфии', 192000, 'Личная карта', fmt);
  assert.equal(msg, '💸 <b>Расход</b>\nКатегория: Услуги полиграфии\nСумма: 192 000 сум\nСчёт: Личная карта');
});

test('buildTelegramExpenseMessage appends the note when present', () => {
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU') + ' сум';
  const msg = buildTelegramExpenseMessage('Аренда', 1500000, 'Расчётный счёт', fmt, 'Аренда за сентябрь');
  assert.equal(msg, '💸 <b>Расход</b>\nКатегория: Аренда\nСумма: 1 500 000 сум\nСчёт: Расчётный счёт\nПримечание: Аренда за сентябрь');
});

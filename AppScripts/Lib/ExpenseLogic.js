// Validates expense input before any account lookup or sheet write. Pure —
// no SpreadsheetApp dependency — so every rejection path is cheap to test
// here, mirroring how resolveAccount's failure cases are tested in
// SalesLogic.test.js rather than against a live spreadsheet.
function validateExpenseInput(category, amount, paymentType) {
  if (!category) return 'Не выбрана категория расхода.';
  if (!paymentType) return 'Не выбран тип оплаты.';
  const num = Number(amount);
  if (amount === '' || amount === null || amount === undefined || isNaN(num) || num <= 0) {
    return 'Сумма расхода должна быть больше нуля.';
  }
  return null;
}

function buildExpenseRow(category, amount, account, note) {
  return { category: category, amount: amount, account: account, note: note || '' };
}

function buildTelegramExpenseMessage(category, amount, account, fmt) {
  return '💸 <b>Расход</b>\n' +
    'Категория: ' + category + '\n' +
    'Сумма: ' + fmt(amount) + '\n' +
    'Счёт: ' + account;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateExpenseInput, buildExpenseRow, buildTelegramExpenseMessage };
}

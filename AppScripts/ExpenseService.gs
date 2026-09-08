const FORM_COL_KATEGORIYA_RASHOD = 7;  // G: Категория (расход)
const FORM_COL_SUMMA_RASHOD = 8;       // H: Сумма (расход)
const FORM_COL_TIP_OPLATY_RASHOD = 9;  // I: Тип оплаты (расход) — stores the resolved account, not the raw payment-type label (same convention as appendIncomeRow_ in InventoryService.gs)
const FORM_COL_OPISANIE_RASHOD = 10;   // J: Примечание (расход)

// "Справочники" column G holds "Категории расходов" — read dynamically, same
// pattern as getLocations()/getPaymentTypes(), so the list stays in sync with
// the sheet without a code change.
function getExpenseCategories() {
  return getCachedReferenceData_('refcache_expenseCategories', function () {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_REFERENCES);
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const data = sheet.getRange(2, 7, lastRow - 1, 1).getValues(); // G
    return data
      .filter(function (row) { return row[0]; })
      .map(function (row) { return row[0]; });
  });
}

function appendExpenseRow_(ss, category, amount, account, note) {
  const formSheet = ss.getSheetByName(SHEET_FORM);
  const row = [];
  row[0] = new Date();
  row[FORM_COL_TIP_ZAPISI - 1] = 'Расход';
  row[FORM_COL_KATEGORIYA_RASHOD - 1] = category;
  row[FORM_COL_SUMMA_RASHOD - 1] = amount;
  row[FORM_COL_TIP_OPLATY_RASHOD - 1] = account;
  row[FORM_COL_OPISANIE_RASHOD - 1] = note;
  formSheet.appendRow(row);
}

function submitExpense(category, amount, paymentType, note) {
  const validationError = validateExpenseInput(category, amount, paymentType);
  if (validationError) {
    throw new Error(validationError);
  }

  // Resolve the account BEFORE writing anything — same defensive order as
  // submitSale: an unmapped payment type must refuse the expense outright,
  // not write an unvalidated string into a real financial ledger.
  const account = resolveAccount(getPaymentTypes(), paymentType);
  if (!account) {
    throw new Error('Тип оплаты "' + paymentType + '" не сопоставлен со счётом в Справочники!D:E — расход не записан.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const row = buildExpenseRow(category, Number(amount), account, note);
  appendExpenseRow_(ss, row.category, row.amount, row.account, row.note);

  sendTelegram(buildTelegramExpenseMessage(row.category, row.amount, row.account, fmt, row.note));

  return { written: true };
}

// Temporary — run once by hand from the Apps Script editor to verify a
// programmatic Расход row reaches "Операции" the same way the legacy form's
// Расход branch already does. Delete the synthetic row from
// "Ответы на форму (1)" (and, if it appears, from "Операции") after
// verifying. Safe to leave the function itself in the codebase as a reusable
// diagnostic. No trailing underscore — Apps Script hides underscore-suffixed
// functions from the editor's "Select function" dropdown, and this one needs
// to be runnable from there.
function testExpenseLayerWiring() {
  const result = submitExpense('Прочее', 1, 'Наличка', 'ТЕСТ проверка записи расхода');
  Logger.log('submitExpense вернул: ' + JSON.stringify(result) + '. Откройте "Ответы на форму (1)": должна появиться строка Тип="Расход", Категория="Прочее", Сумма=1, Тип оплаты="Наличка", Примечание="ТЕСТ проверка записи расхода". Проверьте также, что она попала в "Операции" тем же способом, что и любая другая строка Расход.');
}

const SHEET_GOODS_STOCK = 'Склад товаров';

// One-time (idempotent) maintenance: extends every cell of the
// "Остаток" grid in Склад товаров to also recognize Тип="Инвентаризация".
// Safe to re-run — it always sets the same formula text.
function extendGoodsStockFormulaForInventory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const totalColIndex = header.indexOf('Итого') + 1; // 1-based; 0 if absent
  const lastLocationCol = totalColIndex > 0 ? totalColIndex - 1 : lastCol;

  if (lastLocationCol < 2) {
    throw new Error('Не нашёл ни одной колонки-точки между "Товар" и "Итого" — проверь структуру листа перед повтором.');
  }

  const newFormula =
    "=СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Производство\";'Реестр товаров'!$H:$H;B$1)" +
    "+СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Перемещение\";'Реестр товаров'!$H:$H;B$1)" +
    "+СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Возврат\";'Реестр товаров'!$H:$H;B$1)" +
    "+СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Заказ у поставщиков\";'Реестр товаров'!$H:$H;B$1)" +
    "+СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Инвентаризация\";'Реестр товаров'!$H:$H;B$1)" +
    "-СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Перемещение\";'Реестр товаров'!$G:$G;B$1)" +
    "-СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Продажа\";'Реестр товаров'!$G:$G;B$1)" +
    "-СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Возврат\";'Реестр товаров'!$G:$G;B$1)" +
    "-СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Инвентаризация\";'Реестр товаров'!$G:$G;B$1)";

  sheet.getRange(2, 2).setFormula(newFormula); // B2
  sheet.getRange(2, 2).copyTo(sheet.getRange(2, 2, lastRow - 1, lastLocationCol - 1)); // fan out B2:<lastLocationCol><lastRow>

  Logger.log('✅ Формула остатка обновлена: ' + (lastLocationCol - 1) + ' точек × ' + (lastRow - 1) + ' товаров.');
}

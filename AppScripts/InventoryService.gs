function getLocations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const totalColIndex = header.indexOf('Итого'); // 0-based; -1 if absent
  const scanEnd = totalColIndex > 0 ? totalColIndex : header.length;
  const locations = [];
  for (let c = 1; c < scanEnd; c++) {
    const name = header[c];
    if (!name) continue;
    locations.push(name);
  }
  return locations;
}

function getMaterialsSnapshot() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_MATERIALS_STOCK);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 2, lastRow - 1, 3).getValues(); // B:D
  return data
    .filter((row) => row[0])
    .map((row) => ({ name: row[0], unit: row[1] || 'шт', current: Number(row[2]) || 0 }));
}

function getProductsSnapshot(location) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colIndex = header.indexOf(location); // 0-based
  if (colIndex < 1) throw new Error('Точка не найдена в Склад товаров: ' + location);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const names = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const values = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();

  const items = [];
  for (let i = 0; i < names.length; i++) {
    if (!names[i][0]) continue;
    items.push({ name: names[i][0], current: Number(values[i][0]) || 0 });
  }
  return items;
}

function submitInventory(kind, location, counts, newItems) {
  const dateStr = Utilities.formatDate(new Date(), 'Asia/Tashkent', 'dd.MM.yyyy');
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (kind === 'materials') return submitMaterialsInventory_(ss, counts, newItems, dateStr);
  if (kind === 'products') return submitProductsInventory_(ss, location, counts, newItems, dateStr);
  throw new Error('Неизвестный тип инвентаризации: ' + kind);
}

function submitMaterialsInventory_(ss, counts, newItems, dateStr) {
  const stockSheet = ss.getSheetByName(SHEET_MATERIALS_STOCK);
  const ledgerSheet = ss.getSheetByName(SHEET_MATERIALS_REGISTRY);
  const byName = {};
  getMaterialsSnapshot().forEach((it) => { byName[it.name] = it; });

  let written = 0;

  (counts || []).forEach((c) => {
    const item = byName[c.name];
    if (!item) return; // stale client-side data; skip rather than guess
    const delta = computeDelta(item.current, c.fact);
    if (delta === null) return;
    const row = buildMaterialLedgerRow(c.name, delta, dateStr);
    ledgerSheet.appendRow([new Date(), c.name, row.type, row.quantity, row.note]);
    written++;
  });

  (newItems || []).forEach((ni) => {
    const name = String(ni.name || '').trim();
    if (!name) return;
    if (byName[name]) {
      const delta = computeDelta(byName[name].current, ni.fact);
      if (delta === null) return;
      const row = buildMaterialLedgerRow(name, delta, dateStr);
      ledgerSheet.appendRow([new Date(), name, row.type, row.quantity, row.note]);
      written++;
      return;
    }
    const factNum = Number(ni.fact);
    if (Number.isNaN(factNum) || factNum === 0) return;
    const newRow = stockSheet.getLastRow() + 1;
    stockSheet.getRange(newRow, 2).setValue(name);  // B: Материал
    stockSheet.getRange(newRow, 3).setValue('шт');  // C: Ед.измерения (default — no unit picker in this tool)
    stockSheet.getRange('D2').copyTo(stockSheet.getRange(newRow, 4)); // D: Остаток formula
    const row = buildMaterialLedgerRow(name, factNum, dateStr);
    ledgerSheet.appendRow([new Date(), name, row.type, row.quantity, row.note]);
    written++;
  });

  return { written: written };
}

function submitProductsInventory_(ss, location, counts, newItems, dateStr) {
  const stockSheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const byName = {};
  getProductsSnapshot(location).forEach((it) => { byName[it.name] = it; });

  let written = 0;

  function appendGoodsRow(name, quantity, from, to) {
    const formSheet = ss.getSheetByName(SHEET_FORM);
    const FORM_COL_TIP_ZAPISI = 2;                  // B: Тип записи
    const FORM_COL_VID_DEISTVIYA = 20;              // T: Вид действия
    const FORM_COL_TOVAR_PEREMESCHENIE = 25;        // Y: Товар (перемещение)
    const FORM_COL_KOLICHESTVO_PEREMESCHENIE = 26;  // Z: Количество (перемещение)
    const FORM_COL_OTKUDA = 27;                     // AA: Откуда
    const FORM_COL_KUDA = 28;                       // AB: Куда

    const row = [];
    row[0] = new Date(); // A: Отметка времени
    row[FORM_COL_TIP_ZAPISI - 1] = 'Учет товаров';
    row[FORM_COL_VID_DEISTVIYA - 1] = 'Инвентаризация';
    row[FORM_COL_TOVAR_PEREMESCHENIE - 1] = name;
    row[FORM_COL_KOLICHESTVO_PEREMESCHENIE - 1] = quantity;
    row[FORM_COL_OTKUDA - 1] = from;
    row[FORM_COL_KUDA - 1] = to;
    formSheet.appendRow(row);
  }

  (counts || []).forEach((c) => {
    const item = byName[c.name];
    if (!item) return;
    const delta = computeDelta(item.current, c.fact);
    if (delta === null) return;
    const row = buildGoodsLedgerRow(delta, location, dateStr);
    appendGoodsRow(c.name, row.quantity, row.from, row.to);
    written++;
  });

  (newItems || []).forEach((ni) => {
    const name = String(ni.name || '').trim();
    if (!name) return;
    if (byName[name]) {
      const delta = computeDelta(byName[name].current, ni.fact);
      if (delta === null) return;
      const row = buildGoodsLedgerRow(delta, location, dateStr);
      appendGoodsRow(name, row.quantity, row.from, row.to);
      written++;
      return;
    }
    const factNum = Number(ni.fact);
    if (Number.isNaN(factNum) || factNum === 0) return;

    // "Склад товаров" column A is not a plain list — A2 holds a single ARRAYFORMULA
    // that spills the product list down from Справочники!A2:A (Справочник цен).
    // Writing directly into a new row of column A here blocks that spill range and
    // breaks the sheet's whole product list. Instead, append the new name to
    // Справочники!A (Справочник цен) and let the ARRAYFORMULA extend on its own.
    const referencesSheet = ss.getSheetByName(SHEET_REFERENCES); // declared in Уведомления через ТГ-бот.js -- reused, not redeclared
    const priceListLastRow = findLastNonEmptyRow_(referencesSheet, 1); // column A of Справочник цен
    const newRow = priceListLastRow + 1; // Справочники and Склад товаров are row-for-row aligned starting at row 2 (ARRAYFORMULA(IF(...))) -- no independent scan of Склад товаров needed; an earlier attempt scanned Склад товаров's own column A for the last non-blank row and landed on its trailing "Итого" summary row instead of the spilled name, corrupting it
    referencesSheet.getRange(newRow, 1).setValue(name); // A: Название товара -- triggers Склад товаров's ARRAYFORMULA to extend
    SpreadsheetApp.flush();

    // Defensive check: confirm the array formula actually spilled the name where expected before writing anything else there.
    const spilledName = stockSheet.getRange(newRow, 1).getValue();
    if (spilledName !== name) {
      throw new Error('Ожидал "' + name + '" в Склад товаров!A' + newRow + ' после добавления в Справочники, но нашёл "' + spilledName + '" -- проверь структуру листов вручную, ничего больше не менялось.');
    }

    const stockLastCol = stockSheet.getLastColumn();
    const stockHeader = stockSheet.getRange(1, 1, 1, stockLastCol).getValues()[0];
    const stockTotalColIndex = stockHeader.indexOf('Итого') + 1; // 1-based; 0 if absent
    const stockCopyWidth = stockTotalColIndex > 0 ? stockTotalColIndex - 1 : stockLastCol - 1; // through Итого inclusive (B..Итого), or to the sheet's last column if Итого is absent
    stockSheet.getRange(2, 2, 1, stockCopyWidth).copyTo(stockSheet.getRange(newRow, 2, 1, stockCopyWidth)); // B..Итого: formulas
    const row = buildGoodsLedgerRow(factNum, location, dateStr);
    appendGoodsRow(name, row.quantity, row.from, row.to);
    written++;
  });

  return { written: written };
}

function findLastNonEmptyRow_(sheet, col) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return 0;
  const values = sheet.getRange(1, col, lastRow, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i][0] !== '' && values[i][0] !== null) return i + 1; // 1-based row
  }
  return 0;
}

const SHEET_GOODS_REGISTRY     = 'Реестр товаров';
const SHEET_MATERIALS_REGISTRY = 'Реестр материалов';
const SHEET_MATERIALS_STOCK = 'Склад материалов';

// ──────────────────────────────────────────────────────────────
// ТРИГГЕР — форма (onFormSubmit)
// ──────────────────────────────────────────────────────────────
function handleProduction(e) {
  const row = e.values;

  // Колонки Реестра товаров (0-based)
  // A=0 Дата, B=1 Товар, C=2 Тип, D=3 Количество, E=4 Откуда, F=5 Куда, G=6 Примечание
  const timestamp = new Date(row[0]);
  const product   = row[1];
  const type      = row[2];
  const qty       = Number(row[3]) || 0;

  if (type !== 'Производство') return;

  writeOffMaterials(timestamp, product, qty);
}

// ──────────────────────────────────────────────────────────────
// ТРИГГЕР — ручной ввод (onEdit)
// ──────────────────────────────────────────────────────────────
function onEditProduction(e) {
  const sheet = e.source.getActiveSheet();

  if (sheet.getName() !== SHEET_GOODS_REGISTRY) return;

  const TYPE_COLUMN = 6; // F = "Тип" (not C = "Тип записи" — see Foundation plan Task 3)
  const col = e.range.getColumn();
  const row = e.range.getRow();

  // Срабатывает только если изменилась колонка F (Тип)
  if (col !== TYPE_COLUMN) return;
  if (e.value !== 'Производство') return;

  // Читаем всю строку
  const rowData   = sheet.getRange(row, 1, 1, 8).getValues()[0];
  const timestamp = rowData[1] || new Date();  // B = Дата
  const product   = rowData[3];                 // D = Товар
  const qty       = Number(rowData[4]) || 0;    // E = Количество

  if (!product || qty === 0) {
    SpreadsheetApp.getUi().alert('⚠️ Заполни Товар и Количество перед тем как ставить тип Производство');
    return;
  }

  writeOffMaterials(timestamp, product, qty);
}

// ──────────────────────────────────────────────────────────────
// ОБЩАЯ ЛОГИКА СПИСАНИЯ
// ──────────────────────────────────────────────────────────────
function writeOffMaterials(timestamp, product, qty) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const refSheet = ss.getSheetByName(SHEET_REFERENCES);
  const lastRow  = refSheet.getLastRow();

  const specData = refSheet.getRange(2, 13, lastRow - 1, 4).getValues();
  const specs    = specData.filter(r => r[1] === product);

  if (specs.length === 0) {
    Logger.log('⚠️ Спецификация не найдена для товара: ' + product);
    SpreadsheetApp.getUi().alert('⚠️ Спецификация для товара «' + product + '» не найдена в Справочниках');
    return;
  }

  // Читаем текущие остатки из Склада материалов
  // Структура: A=№, B=Материал, C=Ед.измерения, D=Остаток, E=Минимальный запас
  const matStockSheet = ss.getSheetByName(SHEET_MATERIALS_STOCK);
  const matStockData  = matStockSheet.getDataRange().getValues();

  // Проверяем хватает ли каждого материала
  const errors = [];

  specs.forEach(spec => {
    const material    = spec[2]; // O — Расходник
    const specQty     = Number(spec[3]) || 0;
    const neededQty   = specQty * qty;

    // Ищем материал в Складе материалов
    const stockRow = matStockData.find(r => r[1] === material);
    const inStock  = stockRow ? Number(stockRow[3]) || 0 : 0;

    if (inStock < neededQty) {
      errors.push(
        '• ' + material + ': нужно ' + neededQty + ', на складе ' + inStock
      );
    }
  });

  // Если есть нехватка — показываем ошибку и останавливаемся
  if (errors.length > 0) {
    SpreadsheetApp.getUi().alert(
      '❌ Недостаточно материалов для производства «' + product + '» × ' + qty + ':\n\n' +
      errors.join('\n') +
      '\n\nСписание не выполнено.'
    );
    return;
  }

  // Всё в порядке — пишем списания
  const matSheet = ss.getSheetByName(SHEET_MATERIALS_REGISTRY);

  specs.forEach(spec => {
    const material    = spec[2];
    const specQty     = Number(spec[3]) || 0;
    const writeOffQty = specQty * qty;

    matSheet.appendRow([
      timestamp,
      material,
      'Списание',
      writeOffQty,
      'Производство: ' + product + ' × ' + qty
    ]);
  });

  Logger.log('✅ Списано ' + specs.length + ' позиций для: ' + product + ' × ' + qty);
}

// ──────────────────────────────────────────────────────────────
// УСТАНОВКА ТРИГГЕРОВ — запусти один раз
// ──────────────────────────────────────────────────────────────
function createProductionTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t =>
      t.getHandlerFunction() === 'handleProduction' ||
      t.getHandlerFunction() === 'onEditProduction'
    )
    .forEach(t => ScriptApp.deleteTrigger(t));

  // Триггер для формы
  ScriptApp.newTrigger('handleProduction')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onFormSubmit()
    .create();

  // Триггер для ручного ввода
  ScriptApp.newTrigger('onEditProduction')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();

  Logger.log('✅ Оба триггера установлены');
}
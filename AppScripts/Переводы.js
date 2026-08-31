function handleTransfer(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const respSheet = ss.getSheetByName('Ответы на форму (1)');
  const row = e.range.getValues()[0];

  // Колонки входящей строки (0-based)
  const TYPE      = 1;
  const TIMESTAMP = 0;
  const FROM_ACC  = 14;
  const TO_ACC    = 15;
  const COMM_PCT  = 17;
  const COMM_SUM  = 18;
  const AMOUNT    = 16;

  if (row[TYPE] !== 'Переводы') return;

  const timestamp = row[TIMESTAMP];
  const fromAcc   = row[FROM_ACC];
  const toAcc     = row[TO_ACC];
  const amount    = Math.abs(Number(row[AMOUNT]));
  const commPct   = row[COMM_PCT] !== '' ? Number(row[COMM_PCT]) : null;
  const commSum   = row[COMM_SUM] !== '' ? Number(row[COMM_SUM]) : null;

  // Строка зачисления — FROM и TO меняются местами, сумма отрицательная
  const incomingRow = [];
  incomingRow[TYPE]      = 'Переводы';
  incomingRow[TIMESTAMP] = timestamp;
  incomingRow[FROM_ACC]  = toAcc;   // меняем местами
  incomingRow[TO_ACC]    = fromAcc; // меняем местами
  incomingRow[AMOUNT]    = -amount; // отрицательная
  respSheet.appendRow(incomingRow);

  // Строка комиссии
  let commission = 0;
  if (commSum !== null && commSum > 0) {
    commission = commSum;
  } else if (commPct !== null && commPct > 0) {
    commission = (amount / 100) * commPct;
  }

  if (commission > 0) {
    const commRow = [];
    commRow[0]  = timestamp;
    commRow[1]  = 'Расход';
    commRow[5] = 'Транзакционные расходы';
    commRow[6] = commission;
    commRow[7] = toAcc;
    commRow[9] = 'Комиссия за перевод';
    respSheet.appendRow(commRow);
  }
}

function createTransferTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('handleTransfer')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
  SpreadsheetApp.getUi().alert('Триггер для переводов установлен.');
}
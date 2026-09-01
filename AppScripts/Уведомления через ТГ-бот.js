const TG_TOKEN   = PropertiesService.getScriptProperties().getProperty('TG_TOKEN');
const TG_CHAT_ID = PropertiesService.getScriptProperties().getProperty('TG_CHAT_ID');

const SHEET_FORM        = "Ответы на форму (1)";
const SHEET_OPERATIONS  = "Операции";
const SHEET_ACCOUNTS    = "Счета";
const SHEET_REFERENCES  = "Справочники";

// ──────────────────────────────────────────────────────────────
// ТРИГГЕР — установи один раз запустив setupTrigger()
// ──────────────────────────────────────────────────────────────
function setupTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "onFormSubmit")
    .forEach(t => ScriptApp.deleteTrigger(t));

  SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger("onFormSubmit")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onFormSubmit()
    .create();

  Logger.log("✅ Триггер установлен");
}

// ──────────────────────────────────────────────────────────────
// ГЛАВНАЯ ФУНКЦИЯ
// ──────────────────────────────────────────────────────────────
function onFormSubmit(e) {
  const row       = e.values;
  const recordType = row[1] || "";

  if (recordType === "Продажа")                handleSaleNotification(row);
  else if (recordType === "Расход")            handleExpenseNotification(row);
  else if (recordType === "Доход")             handleIncomeNotification(row);
  else if (recordType === "Выплата")           handlePayoutNotification(row);
  else if (recordType === "Переводы")          handleTransferNotification(row);
  else if (recordType === "Учёт товаров") handleStockNotification(row);
}

// ──────────────────────────────────────────────────────────────
// УВЕДОМЛЕНИЯ
// ──────────────────────────────────────────────────────────────
function handleSaleNotification(row) {
  const item     = row[2]  || "";
  const qty      = Number(row[3]) || 1;
  const payment  = row[4]  || "";
  const note     = row[5] || "";
  const timestamp = new Date(row[0]);

  const price = getPriceByProduct(item);
  const total = price * qty;

  // Уведомление в Telegram
  sendTelegram(
    "🛍 <b>Продажа</b>\n" +
    "Товар: " + item + " × " + qty + "\n" +
    "Сумма: " + fmt(total) + "\n" +
    "Оплата: " + payment +
    (note ? "\nПримечание: " + note : "")
  );
}

function handleExpenseNotification(row) {
  const category = row[6]  || "";   // G — Категория
  const amount   = Number(row[7]) || 0; // H — Сумма
  const payment  = row[8]  || "";   // I — Тип оплаты
  const note     = row[9]  || "";   // J — Примечание

  sendTelegram(
    "💸 <b>Расход</b>\n" +
    "Категория: " + category + "\n" +
    "Сумма: " + fmt(amount) + "\n" +
    "Счёт: " + payment +
    (note ? "\nПримечание: " + note : "")
  );
}

function handleIncomeNotification(row) {
  const amount  = Number(row[10]) || 0; // K — Сумма дохода
  const payment = row[11] || "";        // L — Тип оплаты
  const category = row[12] || "";       // M = Категория  
  const desc    = row[13] || "";        // N — Описание

  sendTelegram(
    "💰 <b>Доход</b>\n" +
    "Сумма: " + fmt(amount) + "\n" +
    "Счёт: " + payment + "\n" +
    "Категория: " + category +
    (desc ? "\nОписание: " + desc : "")
  );
}

function handleTransferNotification(row) {
  const fromAcc  = row[14] || "";
  const toAcc    = row[15] || "";
  const commPct  = row[17] !== "" ? Number(row[16]) : null;
  const commSum  = row[18] !== "" ? Number(row[17]) : null;
  const amount   = Math.abs(Number(row[16]) || 0);

  let commission = 0;
  if (commSum !== null && commSum > 0)       commission = commSum;
  else if (commPct !== null && commPct > 0)  commission = (amount / 100) * commPct;

  // Ждём пока handleTransfer допишет строки и формулы пересчитаются
  Utilities.sleep(5000);

  // Балансы из листа Счета
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const accSheet = ss.getSheetByName(SHEET_ACCOUNTS);
  const accData  = accSheet.getDataRange().getValues();

  let accountLines = "";
  let total        = 0;

  const accountIcons = {
    "Наличка":           "💵",
    "Paynet":            "📱",
    "Карта (личная)":    "💳",
    "Расчётный счёт ИП": "🏦",
  };

  for (let i = 1; i < accData.length; i++) {
    const name    = accData[i][0];
    const balance = Number(accData[i][1]) || 0;
    if (!name) continue;
    if (name === "Итого") { total = balance; continue; }
    const icon = accountIcons[name] || "💰";
    accountLines += icon + " " + name + ": <b>" + fmt(balance) + "</b>\n";
  }

  sendTelegram(
    "🔄 <b>Перевод</b>\n" +
    "Из: " + fromAcc + " → " + toAcc + "\n" +
    "Сумма: " + fmt(amount) +
    (commission > 0 ? "\nКомиссия: " + fmt(commission) : "") +
    "\n\n━━━━━━━━━━━━━━━\n" +
    "💰 Баланс сейчас:\n" +
    accountLines +
    "━━━━━━━━━━━━━━━\n" +
    "💰 Итого: <b>" + fmt(total) + "</b>"
  );
}

// ──────────────────────────────────────────────────────────────
// ЕЖЕДНЕВНЫЙ ОТЧЁТ
// ──────────────────────────────────────────────────────────────
function createDailyReportTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "sendDailyReport")
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("sendDailyReport")
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .inTimezone("Asia/Tashkent")
    .create();

  Logger.log("✅ Ежедневный отчёт настроен на 8:00 по Ташкенту");
}

function sendDailyReport() {
  const ss         = SpreadsheetApp.getActiveSpreadsheet();
  const opsSheet   = ss.getSheetByName(SHEET_OPERATIONS);
  const accSheet   = ss.getSheetByName(SHEET_ACCOUNTS);

  // Вчерашняя дата
  const yesterday  = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const dayStart   = new Date(yesterday);
  const dayEnd     = new Date(yesterday);
  dayEnd.setHours(23, 59, 59, 999);

  // Данные из Операций
  const opsData    = opsSheet.getDataRange().getValues();
  let income = 0, expense = 0;

  for (let i = 1; i < opsData.length; i++) {
    const rowDate = new Date(opsData[i][1]);
    const amount  = Number(opsData[i][3]) || 0;
    const type    = opsData[i][1] || "";

    if (rowDate < dayStart || rowDate > dayEnd) continue;
    if (type === "Переводы") continue; // переводы не считаем

    if (amount > 0) income  += amount;
    else            expense += amount;
  }

  const profit = income + expense; // expense уже отрицательный

  // Балансы из листа Счета
  const accData     = accSheet.getDataRange().getValues();
  let accountLines  = "";
  let total         = 0;

  const accountIcons = {
    "Наличка":            "💵",
    "Paynet":             "📱",
    "Карта (личная)":     "💳",
    "Расчётный счёт ИП":  "🏦",
  };

  for (let i = 1; i < accData.length; i++) {
    const name    = accData[i][0];
    const balance = Number(accData[i][1]) || 0;
    if (!name) continue;
    if (name === "Итого") { total = balance; continue; }
    const icon = accountIcons[name] || "💰";
    accountLines += icon + " " + padRight(name + ":", 22) + " <b>" + fmt(balance) + "</b>\n";
  }

  const dateStr    = Utilities.formatDate(yesterday, "Asia/Tashkent", "dd.MM.yyyy");
  const profitIcon = profit >= 0 ? "📈" : "📉";

  // Заказы на сегодня
const ordersSheet = ss.getSheetByName(SHEET_ORDERS);
let ordersBlock = "";

if (ordersSheet) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const ordersData = ordersSheet.getDataRange().getValues();
  const todayOrders = [];

  for (let i = 1; i < ordersData.length; i++) {
    const deliveryDate = new Date(ordersData[i][6]); // G — Дата доставки
    const timeStr      = ordersData[i][7] || "";     // H — Время доставки
    if (isNaN(deliveryDate.getTime())) continue;
    if (deliveryDate < today || deliveryDate > todayEnd) continue;

    const deliveryTime = new Date(timeStr);
    const timeFormatted = !isNaN(deliveryTime.getTime())
      ? Utilities.formatDate(deliveryTime, "Asia/Tashkent", "HH:mm")
      : timeStr;

    todayOrders.push(
  "• " + timeFormatted + " — " +
  (ordersData[i][1]
    ? "<a href='https://instagram.com/" + ordersData[i][1].toString().replace('@', '') + "'>" + ordersData[i][2] + "</a>"
    : ordersData[i][2]) +
  " | " + ordersData[i][5]
);
  }

  if (todayOrders.length > 0) {
    ordersBlock =
      "\n━━━━━━━━━━━━━━━\n" +
      "🚚 <b>Доставки сегодня:</b>\n" +
      todayOrders.join("\n") + "\n";
  }
}
  
  sendTelegram(
    "☀️ <b>Доброе утро!</b>\n" +
    "📊 Итоги за вчера, " + dateStr + "\n\n" +
    "🟢 Доходы:   <b>" + fmt(income)        + "</b>\n" +
    "🔴 Расходы:  <b>" + fmt(Math.abs(expense)) + "</b>\n" +
    profitIcon + " Прибыль:  <b>" + fmt(profit) + "</b>\n\n" +
    "━━━━━━━━━━━━━━━\n" +
    "💰 Баланс сейчас:\n" +
    accountLines +
    "━━━━━━━━━━━━━━━\n" +
    "💰 Итого:  <b>" + fmt(total) + "</b>"+
    ordersBlock
  );
}

// ──────────────────────────────────────────────────────────────
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ──────────────────────────────────────────────────────────────
function getPriceByProduct(productName) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_REFERENCES);
  if (!sheet) return 0;
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === productName) return Number(data[i][1]) || 0;
  }
  return 0;
}

function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT_ID) {
    Logger.log('❌ TG_TOKEN/TG_CHAT_ID не заданы в Script Properties этого проекта');
    return;
  }
  try {
    UrlFetchApp.fetch("https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: text,
        parse_mode: "HTML"
      })
    });
  } catch (err) {
    Logger.log("❌ Telegram ошибка: " + err.message);
  }
}

function fmt(n) {
  return Math.round(n).toLocaleString("ru-RU") + " сум";
}

function padRight(str, len) {
  while (str.length < len) str += " ";
  return str;
}


// ──────────────────────────────────────────────────────────────
// WEBHOOK — принимает команды от Telegram
// ──────────────────────────────────────────────────────────────
function handleTelegramWebhook_(e) {
  try {

    Logger.log('doPost сработал');
    Logger.log('postData: ' + e.postData.contents);

    const update  = JSON.parse(e.postData.contents);
    const message = update.message || update.channel_post;

    Logger.log('message: ' + JSON.stringify(message));

    if (!message) {
      Logger.log('message пустой — выходим');
      return;
    }

    const chatId = message.chat.id;
    const text   = message.text || "";

    if (text.startsWith("/баланс") || text.startsWith("/balance")) {
      sendBalance(chatId);
    } else if (text.startsWith === "/отчет" || text.startsWith === "/report") {
      sendDailyReport();
    }
  } catch (err) {
    Logger.log("❌ doPost ошибка: " + err.message);
  }
}

function sendBalance(chatId) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const accSheet = ss.getSheetByName(SHEET_ACCOUNTS);
  const accData  = accSheet.getDataRange().getValues();

  let accountLines = "";
  let total        = 0;

  const accountIcons = {
    "Наличка":           "💵",
    "Paynet":            "📱",
    "Карта (личная)":    "💳",
    "Расчётный счёт ИП": "🏦",
  };

  for (let i = 1; i < accData.length; i++) {
    const name    = accData[i][0];
    const balance = Number(accData[i][1]) || 0;
    if (!name) continue;
    if (name === "Итого") { total = balance; continue; }
    const icon = accountIcons[name] || "💰";
    accountLines += icon + " " + name + ": <b>" + fmt(balance) + "</b>\n";
  }

  const now = Utilities.formatDate(new Date(), "Asia/Tashkent", "dd.MM.yyyy HH:mm");

  sendTelegramTo(chatId,
    "💰 <b>Баланс счетов</b>\n" +
    "<i>" + now + "</i>\n\n" +
    accountLines +
    "━━━━━━━━━━━━━━━\n" +
    "💰 Итого: <b>" + fmt(total) + "</b>"
  );
}

// Отправка в конкретный чат (не в общий TG_CHAT_ID)
function sendTelegramTo(chatId, text) {
  if (!TG_TOKEN || !TG_CHAT_ID) {
    Logger.log('❌ TG_TOKEN/TG_CHAT_ID не заданы в Script Properties этого проекта');
    return;
  }
  try {
    UrlFetchApp.fetch("https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML"
      })
    });
  } catch (err) {
    Logger.log("❌ Telegram ошибка: " + err.message);
  }
}

// ──────────────────────────────────────────────────────────────
// УСТАНОВКА WEBHOOK — запусти один раз
// ──────────────────────────────────────────────────────────────
function setWebhook() {
  const url = ScriptApp.getService().getUrl();
  const response = UrlFetchApp.fetch(
    "https://api.telegram.org/bot" + TG_TOKEN + "/setWebhook?url=" + url
  );
  Logger.log("Webhook: " + response.getContentText());
}

function checkWebhook() {
  const response = UrlFetchApp.fetch(
    "https://api.telegram.org/bot" + TG_TOKEN + "/getWebhookInfo"
  );
  Logger.log(response.getContentText());
}

function setWebhookManual() {
  const execUrl = "https://script.google.com/macros/s/AKfycbwkdCjlR8Z7NhwXqLSC-ABv70yNDHLAjRffsfyyyVlTsyTHQBvn6Vn_qZv_qAHwZg/exec";
  const response = UrlFetchApp.fetch(
    "https://api.telegram.org/bot" + TG_TOKEN + "/setWebhook?url=" + execUrl
  );
  Logger.log(response.getContentText());
}
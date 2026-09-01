const SHEET_ORDERS = 'Заказы клиентов';


function formatDeliveryDate(dt) {
  return Utilities.formatDate(dt, "Asia/Tashkent", "dd.MM.yyyy 'в' HH:mm");
}

// ──────────────────────────────────────────────────────────────
// ТРИГГЕР — срабатывает при отправке формы заказов
// ──────────────────────────────────────────────────────────────
function handleNewOrder(e) {
  
  const sheetName = e.range.getSheet().getName();
  if (sheetName !== SHEET_ORDERS) return;
  
  const row = e.values;

  Logger.log('e.values[6] raw: [' + row[6] + ']');
  Logger.log('e.values[6] тип: ' + typeof row[6]);
  Logger.log('e.values[7] raw: [' + row[7] + ']');
  Logger.log('e.values[7] тип: ' + typeof row[7]);

  // Колонки (0-based)
  // A=0 Отметка времени, B=1 Instagram, C=2 Имя, D=3 Телефон
  // E=4 Адрес, F=5 Заказ, G=6 Дата доставки, H=7 Время доставки

  const name     = row[2] || "";
  const phone    = row[3] || "";
  const address  = row[4] || "";
  const order    = row[5] || "";
  const dateStr  = row[6] || "";
  const timeStr  = row[7] || "";
  const username = row[1] || "";

  const deliveryDateTime = parseDeliveryDateTime(dateStr, timeStr);

  if (!deliveryDateTime) {
    Logger.log('⚠️ Не удалось распознать дату/время доставки: ' + dateStr + ' ' + timeStr);
    return;
  }
  
  Logger.log('row[6] тип: ' + typeof row[6] + ' значение: [' + row[6] + ']');
  Logger.log('row[7] тип: ' + typeof row[7] + ' значение: [' + row[7] + ']');
  Logger.log('итого: ' + deliveryDateTime);
  Logger.log('отформатировано: ' + (deliveryDateTime ? formatDeliveryDate(deliveryDateTime) : 'null'));
  Logger.log('Отправляем в TG: ' + formatDeliveryDate(deliveryDateTime));

  // Уведомление о новом заказе
  sendTelegram(
    "📦 <b>Новый заказ</b>\n" +
    "👤 " + name + (username ? " (<a href='https://instagram.com/" + username.replace('@', '') + "'>" + username + "</a>)" : "") + "\n" +
    "📱 " + phone + "\n" +
    "📍 " + address + "\n" +
    "🛍 " + order + "\n" +
    "🚚 Доставка: " + formatDeliveryDate(deliveryDateTime)
  );


  // Создаём триггер напоминания за 2 часа до доставки
  const reminderTime = new Date(deliveryDateTime.getTime() - 2 * 60 * 60 * 1000);
  const now          = new Date();

  if (reminderTime > now) {
    const trigger = ScriptApp.newTrigger('sendDeliveryReminder')
      .timeBased()
      .at(reminderTime)
      .create();

    const triggerKey = 'order_' + trigger.getUniqueId();
    PropertiesService.getScriptProperties().setProperty(triggerKey, JSON.stringify({
      triggerId: trigger.getUniqueId(),
      name:      name,
      username:  username,
      phone:     phone,
      address:   address,
      order:     order,
      delivery:  deliveryDateTime.getTime()
    }));

    Logger.log('✅ Триггер напоминания создан на: ' + reminderTime);
  } else {
    Logger.log('⚠️ Время напоминания уже прошло, триггер не создан');
  }
}

// ──────────────────────────────────────────────────────────────
// НАПОМИНАНИЕ ЗА 2 ЧАСА — вызывается триггером автоматически
// ──────────────────────────────────────────────────────────────
function sendDeliveryReminder(e) {
  const triggerId  = e.triggerUid;
  const triggerKey = 'order_' + triggerId;
  const props      = PropertiesService.getScriptProperties();
  const raw        = props.getProperty(triggerKey);

  if (!raw) {
    Logger.log('⚠️ Данные заказа не найдены для триггера: ' + triggerId);
    return;
  }

  const data             = JSON.parse(raw);
  const deliveryDateTime = new Date(data.delivery);

  sendTelegramWithButton(
    "⏰ <b>Напоминание о доставке через 2 часа</b>\n\n" +
    "👤 " + data.name + (data.username ? " (<a href='https://instagram.com/" + data.username.replace('@', '') + "'>" + data.username + "</a>)" : "") + "\n" +
    "📱 " + data.phone + "\n" +
    "📍 " + data.address + "\n" +
    "🛍 " + data.order + "\n" +
    "🚚 " + formatDeliveryDate(deliveryDateTime),
    "Перейти в Яндекс",
    "https://3.redirect.appmetrica.yandex.com/route?start-lat=41.276560&start-lon=69.246580&appmetrica_tracking_id=25395763362139037"
  );

  // Чистим триггер и данные после срабатывания
  props.deleteProperty(triggerKey);
  ScriptApp.getProjectTriggers()
    .filter(t => t.getUniqueId() === triggerId)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// ──────────────────────────────────────────────────────────────
// ОТПРАВКА С INLINE КНОПКОЙ
// ──────────────────────────────────────────────────────────────
function sendTelegramWithButton(text, buttonText, buttonUrl) {
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
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: buttonText, url: buttonUrl }
          ]]
        }
      })
    });
  } catch (err) {
    Logger.log("❌ Telegram ошибка: " + err.message);
  }
}

// ──────────────────────────────────────────────────────────────
// ВСПОМОГАТЕЛЬНЫЕ
// ──────────────────────────────────────────────────────────────
function parseDeliveryDateTime(dateStr, timeStr) {
  try {
    // Парсим дату формата "09.05.2026"
    const dateParts = dateStr.split('.');
    const day   = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]) - 1; // месяц 0-based
    const year  = parseInt(dateParts[2]);

    // Парсим время формата "19:39:00"
    const timeParts = timeStr.split(':');
    const hours   = parseInt(timeParts[0]);
    const minutes = parseInt(timeParts[1]);

    const result = new Date(year, month, day, hours, minutes, 0, 0);

    Logger.log('parseDeliveryDateTime result: ' + result);
    return result;
  } catch (err) {
    Logger.log('❌ parseDeliveryDateTime ошибка: ' + err.message);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// УСТАНОВКА ТРИГГЕРА — запусти один раз
// ──────────────────────────────────────────────────────────────
function createOrderTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'handleNewOrder')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('handleNewOrder')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onFormSubmit()
    .create();

  Logger.log('✅ Триггер заказов установлен');
}

function testOrderDateTime() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_ORDERS);
  const data  = sheet.getDataRange().getValues();

  // Берём последнюю заполненную строку
  const lastRow = data[data.length - 1];
}
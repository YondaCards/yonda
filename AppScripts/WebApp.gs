const ALLOWED_EMAILS = ['shuhratorifjonov29@gmail.com', 'nurakvlnk@gmail.com'];

function doGet(e) {
  if (e && e.parameter && e.parameter.action) {
    return handleApiGet_(e);
  }
  const email = Session.getActiveUser().getEmail();
  if (!isAllowedEmail(email, ALLOWED_EMAILS)) {
    return HtmlService.createTemplateFromFile('NoAccess').evaluate()
      .setTitle('Yonda — нет доступа');
  }
  const page = (e && e.parameter && e.parameter.page) || 'index';
  const file = page === 'inventory' ? 'Inventory' : 'Index';
  return HtmlService.createTemplateFromFile(file).evaluate()
    .setTitle('Yonda')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  let body = null;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    body = null;
  }
  if (body && typeof body.action === 'string') {
    return handleApiPost_(e);
  }
  return handleTelegramWebhook_(e);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

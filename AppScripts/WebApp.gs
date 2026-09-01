const ALLOWED_EMAILS = ['shuhratorifjonov29@gmail.com', 'nurakvlnk@gmail.com'];

function doGet(e) {
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

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

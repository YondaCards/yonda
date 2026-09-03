const OAUTH_CLIENT_ID = '22070188465-imf7lr80pmn2jet92ddt4937nccabu24.apps.googleusercontent.com';

function handleApiGet_(e) {
  try {
    const action = e.parameter.action;
    if (action === 'ping') {
      return jsonResponse_({ pong: true });
    }
    const auth = verifyRequestToken_(e.parameter.idToken);
    if (!auth.ok) {
      return jsonResponse_({ error: auth.reason });
    }
    if (action === 'getLocations') {
      return jsonResponse_(getLocations());
    }
    if (action === 'getMaterialsSnapshot') {
      return jsonResponse_(getMaterialsSnapshot());
    }
    if (action === 'getProductsSnapshot') {
      return jsonResponse_(getProductsSnapshot(e.parameter.location).filter(function (item) {
        return item.name !== POSTCARD_AGGREGATE_NAME;
      }));
    }
    if (action === 'getSalesCatalog') {
      return jsonResponse_(getSalesCatalog());
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + action });
  } catch (err) {
    return jsonResponse_({ error: 'Внутренняя ошибка' });
  }
}

function handleApiPost_(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'ping') {
      return jsonResponse_({ pong: true, received: body });
    }
    const auth = verifyRequestToken_(body.idToken);
    if (!auth.ok) {
      return jsonResponse_({ error: auth.reason });
    }
    if (body.action === 'submitInventory') {
      return jsonResponse_(submitInventory(body.kind, body.location, body.counts, body.newItems, body.isSaleReconciliation));
    }
    if (body.action === 'submitSale') {
      return jsonResponse_(submitSale(body.items, body.point, body.paymentType, body.totalOverride));
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + body.action });
  } catch (err) {
    return jsonResponse_({ error: 'Внутренняя ошибка' });
  }
}

function verifyRequestToken_(idToken) {
  if (!idToken) return { ok: false, reason: 'Токен не передан' };
  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) return { ok: false, reason: 'Токен недействителен' };
  const claims = JSON.parse(response.getContentText());
  return verifyIdTokenClaims(claims, OAUTH_CLIENT_ID, ALLOWED_EMAILS);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

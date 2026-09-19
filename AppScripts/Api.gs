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
    if (action === 'getPaymentTypes') {
      return jsonResponse_(getPaymentTypes());
    }
    if (action === 'getExpenseCategories') {
      return jsonResponse_(getExpenseCategories());
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
      return jsonResponse_(submitInventory(body.kind, body.location, body.counts, body.newItems, body.isSaleReconciliation, body.saleDate));
    }
    if (body.action === 'submitStockMovement') {
      return jsonResponse_(submitStockMovement(body.movement, body.location, body.from, body.to, body.items, body.newItems));
    }
    if (body.action === 'submitSale') {
      return jsonResponse_(submitSale(body.items, body.paymentType, body.totalOverride));
    }
    if (body.action === 'submitExpense') {
      return jsonResponse_(submitExpense(body.category, body.amount, body.paymentType, body.note));
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + body.action });
  } catch (err) {
    // submitSale throws a user-actionable Russian message (e.g. an unmapped
    // payment type) that the cashier needs to actually see, not a generic
    // "internal error" — this endpoint has exactly two allowed users (see
    // ALLOWED_EMAILS), so surfacing err.message here isn't an information
    // disclosure concern the way it would be on a public API.
    return jsonResponse_({ error: err && err.message ? err.message : 'Внутренняя ошибка' });
  }
}

// Verifying a token means a live call to Google's tokeninfo endpoint, which
// every apiGet/apiPost pays for separately (2-3 times per page load). Cache
// successful verifications in the script cache, keyed by a hash of the token
// (raw JWTs are too long for a cache key), for no longer than the token's own
// `exp` claim says it's valid — a cache hit can never outlive what a live
// check would have said. Failed verifications aren't cached: that path is
// rare and isn't the one this is optimizing for.
function verifyRequestToken_(idToken) {
  if (!idToken) return { ok: false, reason: 'Токен не передан' };

  const cache = CacheService.getScriptCache();
  const cacheKey = 'tokauth_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)
  );
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) return { ok: false, reason: 'Токен недействителен' };
  const claims = JSON.parse(response.getContentText());
  const auth = verifyIdTokenClaims(claims, OAUTH_CLIENT_ID, ALLOWED_EMAILS);

  if (auth.ok) {
    const remainingSeconds = Number(claims.exp) - Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.min(remainingSeconds, 3600);
    if (ttlSeconds > 0) cache.put(cacheKey, JSON.stringify(auth), ttlSeconds);
  }

  return auth;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

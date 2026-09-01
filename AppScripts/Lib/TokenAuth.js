if (typeof module !== 'undefined' && module.exports) {
  var { isAllowedEmail } = require('./Access.js');
}

function verifyIdTokenClaims(claims, expectedAud, allowedEmails) {
  if (!claims) return { ok: false, reason: 'Пустой ответ проверки токена' };
  if (claims.aud !== expectedAud) return { ok: false, reason: 'Токен выдан для другого приложения' };
  if (claims.email_verified !== 'true' && claims.email_verified !== true) {
    return { ok: false, reason: 'Email не подтверждён' };
  }
  const email = claims.email;
  if (!isAllowedEmail(email, allowedEmails)) return { ok: false, reason: 'Доступ запрещён: ' + email };
  return { ok: true, email: email };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { verifyIdTokenClaims };
}

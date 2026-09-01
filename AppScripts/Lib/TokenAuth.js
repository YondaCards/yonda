// var, not let/const: Apps Script concatenates every file in a project into
// one shared global scope, and Access.js already declares a global function
// isAllowedEmail(...). A top-level let/const of the same name would collide
// with that function declaration and throw "Identifier 'isAllowedEmail' has
// already been declared" the moment Apps Script evaluates the project — var
// is the one declaration form that coexists with an existing function of
// the same name. This guard body never runs in Apps Script anyway (module
// is undefined there); verifyIdTokenClaims calls the global isAllowedEmail
// from Access.js directly.
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

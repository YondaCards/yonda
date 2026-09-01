var OAUTH_CLIENT_ID = '22070188465-imf7lr80pmn2jet92ddt4937nccabu24.apps.googleusercontent.com';
var STORAGE_KEY = 'yonda_id_token';
var currentIdToken = null;

function getIdToken() {
  return currentIdToken;
}

function isTokenAuthError(err) {
  return /токен|доступ запрещ/i.test(err && err.message || '');
}

function signOut() {
  currentIdToken = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    // Storage unavailable (e.g. private browsing) — nothing to clear, proceed anyway.
  }
  location.reload();
}

function initAuth(onSignedIn) {
  var stored = null;
  try {
    stored = sessionStorage.getItem(STORAGE_KEY);
  } catch (err) {
    stored = null;
  }
  if (stored) {
    currentIdToken = stored;
    onSignedIn();
    return;
  }
  google.accounts.id.initialize({
    client_id: OAUTH_CLIENT_ID,
    callback: function (response) {
      currentIdToken = response.credential;
      try {
        sessionStorage.setItem(STORAGE_KEY, currentIdToken);
      } catch (err) {
        // Storage unavailable (e.g. private browsing) — keep the token in
        // memory only and let sign-in proceed regardless.
      }
      onSignedIn();
    }
  });
  google.accounts.id.renderButton(
    document.getElementById('signin-button'),
    { theme: 'outline', size: 'large' }
  );
}

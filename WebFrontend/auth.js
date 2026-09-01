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
  sessionStorage.removeItem(STORAGE_KEY);
  location.reload();
}

function initAuth(onSignedIn) {
  var stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored) {
    currentIdToken = stored;
    onSignedIn();
    return;
  }
  google.accounts.id.initialize({
    client_id: OAUTH_CLIENT_ID,
    callback: function (response) {
      currentIdToken = response.credential;
      sessionStorage.setItem(STORAGE_KEY, currentIdToken);
      onSignedIn();
    }
  });
  google.accounts.id.renderButton(
    document.getElementById('signin-button'),
    { theme: 'outline', size: 'large' }
  );
}

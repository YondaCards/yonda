var API_BASE_URL = 'https://script.google.com/macros/s/AKfycbzr729tXM0xKBacLuPbsrcTV4SM--WXpHns6HAGzO9WvgKgGUZrw05vuy_766xGRlv6aQ/exec';

function apiGet(action, params) {
  var url = API_BASE_URL + '?action=' + encodeURIComponent(action);
  Object.keys(params || {}).forEach(function (key) {
    url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  });
  url += '&idToken=' + encodeURIComponent(getIdToken() || '');
  return fetch(url).then(function (res) { return res.json(); }).then(function (data) {
    if (data && data.error) throw new Error(data.error);
    return data;
  });
}

function apiPost(action, body) {
  var payload = Object.assign({ action: action, idToken: getIdToken() }, body);
  return fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  }).then(function (res) { return res.json(); }).then(function (data) {
    if (data && data.error) throw new Error(data.error);
    return data;
  });
}

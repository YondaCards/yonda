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

// Reference data (locations, payment types, expense categories) is only
// ever edited by hand and rarely changes, but every apiGet still pays
// Apps Script's own web-app dispatch latency (container cold starts — this
// can run 2-60+ seconds regardless of what the call actually does, verified
// by timing a call that does zero server-side work). Caching this in the
// browser is the only layer that can hide that latency: return a cached
// copy instantly if one exists, and silently refresh it in the background
// for next time. Never use this for data that changes on its own (like
// stock counts) — only for sheets a human edits directly.
function apiGetCached(action, params, storageKey) {
  var cached = localStorage.getItem(storageKey);
  var fresh = apiGet(action, params).then(function (data) {
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch (e) {}
    return data;
  });
  if (cached) {
    fresh.catch(function () {});
    return Promise.resolve(JSON.parse(cached));
  }
  return fresh;
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

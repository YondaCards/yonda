# Inventory Tool GitHub Pages Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-host the Инвентаризация tool's frontend as a static page on GitHub Pages (private repo), talking to the existing Apps Script backend as a JSON API, to route around a phone-specific bug where Apps Script's `HtmlService` iframe never executes scripts.

**Architecture:** `AppScripts/WebApp.gs`'s `doGet`/`doPost` grow a second branch — a JSON API, gated by a Google ID token verified against the same `ALLOWED_EMAILS` list — alongside the existing, untouched HTML-serving branch. A new `WebFrontend/` folder holds a static copy of the tool's UI that calls this API via `fetch` and signs users in with Google Identity Services. GitHub Actions publishes `WebFrontend/` to GitHub Pages on every push to `main`.

**Tech Stack:** Google Apps Script (V8), Google Identity Services (client-side sign-in), plain HTML/CSS/JS (no build step), GitHub Actions + GitHub Pages, Node's built-in test runner for the reused/added `AppScripts/Lib/*.js` logic.

**Spec:** `docs/superpowers/specs/2026-09-01-github-pages-migration-design.md`

## Global Constraints

- Repo stays **private** on a paid GitHub plan (Pages needs that for a private repo) — the Telegram bot token is still readable in old git commits, so this repo must never go public. Confirm this explicitly with the owner before any push in Task 3.
- `ALLOWED_EMAILS = ['shuhratorifjonov29@gmail.com', 'nurakvlnk@gmail.com']` (already in `AppScripts/WebApp.gs`) — the API reuses this exact array; do not duplicate or hardcode it elsewhere.
- `.clasp.json`/`.claspignore` live at the repo root (`Yonda/`), not inside `AppScripts/` — `clasp push` runs from the repo root.
- Dual Node/Apps-Script files in `AppScripts/Lib/` end with: `if (typeof module !== 'undefined' && module.exports) { module.exports = { ... }; }` — this is what lets `npm test` (`node --test "AppScripts/Lib/**/*.test.js"`) run them and lets Apps Script load them as plain global functions (the guard body never executes there).
- New `.gs` files (Apps Script-only, not Node-testable) use `const`/`let`, matching `AppScripts/WebApp.gs`'s existing style.
- New `WebFrontend/*.html` files use `var`-based ES5 style, matching `AppScripts/Inventory.html`'s existing style — most of that file's state machine is being ported here close to verbatim.
- Exactly **one** Apps Script Web App deployment serves the API for this entire plan. Task 1 creates it once; Tasks 4 and 5 push new *versions* to that same deployment (Apps Script editor: Deploy → Manage deployments → pencil icon → New version → Deploy) so its `/exec` URL never changes. Never create a second "API" deployment — that would silently break whichever URL the frontend isn't using.
- Tasks involving a live Google/GitHub action the controller cannot perform (Apps Script deployment, GitHub repo/Pages setup, Google Cloud OAuth Console) are done by the owner, relayed through the controller — never delegated to an implementer subagent, which has no way to reach the user.

---

### Task 1: Minimal API endpoint + CORS validation

**Files:**
- Create: `AppScripts/Api.gs`
- Modify: `AppScripts/WebApp.gs`

**Interfaces:**
- Produces: `handleApiGet_(e)`, `handleApiPost_(e)`, `jsonResponse_(obj)` in `Api.gs` — Task 4 adds more `action` cases to `handleApiGet_`/`handleApiPost_` in this same file; it does not touch `WebApp.gs` again.
- Produces: `doGet(e)` in `WebApp.gs` now branches to `handleApiGet_(e)` when `e.parameter.action` is present, otherwise runs its existing HTML-serving logic unchanged. `doPost(e)` is new in `WebApp.gs` and always delegates to `handleApiPost_(e)`.

This task proves the riskiest technical assumption in the spec — that a browser on a different origin can read JSON back from an Apps Script Web App — before anything else is built on top of it.

- [ ] **Step 1: Create `AppScripts/Api.gs` with a ping-only API**

```javascript
function handleApiGet_(e) {
  try {
    const action = e.parameter.action;
    if (action === 'ping') {
      return jsonResponse_({ pong: true });
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + action });
  } catch (err) {
    return jsonResponse_({ error: err.message });
  }
}

function handleApiPost_(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'ping') {
      return jsonResponse_({ pong: true, received: body });
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + body.action });
  } catch (err) {
    return jsonResponse_({ error: err.message });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Step 2: Modify `AppScripts/WebApp.gs`'s `doGet` and add `doPost`**

Change the start of `doGet(e)` from:

```javascript
function doGet(e) {
  const email = Session.getActiveUser().getEmail();
```

to:

```javascript
function doGet(e) {
  if (e && e.parameter && e.parameter.action) {
    return handleApiGet_(e);
  }
  const email = Session.getActiveUser().getEmail();
```

Leave the rest of `doGet` exactly as it is. Add a new function anywhere in the file (after `doGet`, before `include`):

```javascript
function doPost(e) {
  return handleApiPost_(e);
}
```

- [ ] **Step 3: Push to Apps Script**

```bash
clasp push
```

Expected: confirms the files pushed, including the new `Api.gs`.

- [ ] **Step 4: Commit**

```bash
git add AppScripts/Api.gs AppScripts/WebApp.gs
git commit -m "feat: add minimal ping API endpoint (doGet/doPost JSON branch)"
```

- [ ] **Step 5: Report DONE_WITH_CONCERNS**

This task cannot be fully verified by the implementer — creating the Apps Script deployment and confirming cross-origin access needs the repo owner's Google login. Report status `DONE_WITH_CONCERNS` and note: "Code pushed and committed; live deployment + CORS verification needs the controller and owner."

**Live verification (controller + owner, after this task's code review — not part of the implementer's work):**

1. Owner opens the Apps Script project's editor, **Deploy → New deployment**, type **Web app**, description "Inventory API", **Execute as: Me**, **Who has access: Anyone**, clicks **Deploy**, and copies the resulting `/exec` URL. Give it to the controller.
2. Controller checks the CORS-relevant response headers directly (no browser needed for this first check):
   ```bash
   curl -s -D - -o /dev/null "<exec-url>?action=ping"
   ```
   Look for `Access-Control-Allow-Origin` in the response headers (Apps Script's `script.googleusercontent.com` redirect target typically sets this to `*` — confirm it's actually present; if absent, the browser-based test in the next step will fail and this is the point to stop and reconsider the CORS approach with the owner, per the spec's "if it doesn't work as expected, that's found in fifteen minutes" plan).
3. If the header is present, controller confirms it from an actual different-origin browser context (not just curl) using the Claude Browser tool: serve a trivial local static HTML file with a `fetch("<exec-url>?action=ping")` call and log the parsed JSON to the page, open it, and confirm `{"pong":true}` renders with no console CORS error.
4. Controller does the same for a POST: `fetch("<exec-url>", {method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"}, body: JSON.stringify({action:"ping"})})`, confirm `{"pong":true,"received":{"action":"ping"}}` comes back cleanly.
5. Record the exec URL and both results in the SDD ledger — later tasks reuse this exact URL and this exact request pattern.

---

### Task 2: Token verification logic

**Files:**
- Create: `AppScripts/Lib/TokenAuth.js`
- Test: `AppScripts/Lib/TokenAuth.test.js`

**Interfaces:**
- Consumes: `isAllowedEmail(email, allowlist)` from `AppScripts/Lib/Access.js` (existing, signature unchanged).
- Produces: `verifyIdTokenClaims(claims, expectedAud, allowedEmails)` — returns `{ ok: true, email: string }` or `{ ok: false, reason: string }`. Task 4 calls this from `Api.gs` after fetching `claims` from Google's `tokeninfo` endpoint.

This is the pure, Node-testable half of ID token verification — checking the *claims* an already-fetched token produced. The network call to Google (`UrlFetchApp`, Apps-Script-only) is Task 4's job; it cannot be unit tested and isn't part of this task.

- [ ] **Step 1: Write the failing tests**

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyIdTokenClaims } = require('./TokenAuth.js');

const AUD = '123-abc.apps.googleusercontent.com';
const ALLOWED = ['owner@example.com', 'partner@example.com'];

test('accepts a valid claims object for an allowed email', () => {
  const result = verifyIdTokenClaims(
    { aud: AUD, email: 'owner@example.com', email_verified: 'true' },
    AUD,
    ALLOWED
  );
  assert.deepEqual(result, { ok: true, email: 'owner@example.com' });
});

test('accepts email_verified as a boolean true (not just the string)', () => {
  const result = verifyIdTokenClaims(
    { aud: AUD, email: 'owner@example.com', email_verified: true },
    AUD,
    ALLOWED
  );
  assert.equal(result.ok, true);
});

test('rejects a token issued for a different OAuth client', () => {
  const result = verifyIdTokenClaims(
    { aud: 'someone-elses-client-id', email: 'owner@example.com', email_verified: 'true' },
    AUD,
    ALLOWED
  );
  assert.equal(result.ok, false);
});

test('rejects an unverified email', () => {
  const result = verifyIdTokenClaims(
    { aud: AUD, email: 'owner@example.com', email_verified: 'false' },
    AUD,
    ALLOWED
  );
  assert.equal(result.ok, false);
});

test('rejects an email not in the allowlist', () => {
  const result = verifyIdTokenClaims(
    { aud: AUD, email: 'stranger@example.com', email_verified: 'true' },
    AUD,
    ALLOWED
  );
  assert.equal(result.ok, false);
});

test('rejects a missing claims object', () => {
  const result = verifyIdTokenClaims(null, AUD, ALLOWED);
  assert.equal(result.ok, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './TokenAuth.js'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all 6 new tests plus the existing 13.

- [ ] **Step 5: Push to Apps Script and commit**

```bash
clasp push
git add AppScripts/Lib/TokenAuth.js AppScripts/Lib/TokenAuth.test.js
git commit -m "feat: add ID token claims verification logic"
```

- [ ] **Step 6: Report DONE**

Fully self-contained and testable — no live verification needed for this task.

---

### Task 3: Private GitHub repo + Pages publishing

**Files:**
- Create: `WebFrontend/index.html` (trivial placeholder — Task 5 replaces its content)
- Create: `.github/workflows/deploy-pages.yml`

**Interfaces:**
- Produces: a live GitHub Pages URL (form `https://<username>.github.io/<repo>/`), recorded in the SDD ledger — Task 4 needs it as the OAuth "Authorized JavaScript origin"; Task 5 needs it to give the owner the real link.

This task is almost entirely a live collaboration between the controller and the owner — an implementer subagent cannot create a GitHub repo, change its visibility, or upgrade a billing plan. Dispatch this task's file-creation half to an implementer, but perform the account/repo/Pages steps directly with the owner, not through a subagent.

- [ ] **Step 1: Create `WebFrontend/index.html`**

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yonda</title>
</head>
<body>
  <p>Yonda — скоро здесь будет инструмент инвентаризации.</p>
</body>
</html>
```

- [ ] **Step 2: Create `.github/workflows/deploy-pages.yml`**

```yaml
name: Deploy WebFrontend to GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - 'WebFrontend/**'
      - '.github/workflows/deploy-pages.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Pages
        uses: actions/configure-pages@v5
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: 'WebFrontend'
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Commit (do not push yet — no remote exists)**

```bash
git add WebFrontend/index.html .github/workflows/deploy-pages.yml
git commit -m "feat: add GitHub Pages placeholder and publish workflow"
```

- [ ] **Step 4: Report DONE_WITH_CONCERNS**

Note: "Files committed locally. Repo has no remote yet — creating it, pushing, and enabling Pages needs the owner and happens outside this task."

**Live setup (controller + owner, after this task's code review):**

1. Confirm with the owner: this repo is going to a **paid** GitHub plan so Pages can serve a **private** repo (per Global Constraints — the Telegram token in git history rules out public). Get their explicit go-ahead before creating anything.
2. Owner creates a new **private** repository on github.com (any name, e.g. `yonda-cards`) — empty, no README/`.gitignore`/license (this local repo already has history). Owner gives the controller the repo's URL.
3. Controller adds the remote and pushes:
   ```bash
   git remote add origin <repo-url>
   git push -u origin main
   ```
4. Owner (billing changes need the account holder) upgrades to a paid plan that includes private-repo Pages, then goes to the repo's **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. Owner confirms in the **Actions** tab that the "Deploy WebFrontend to GitHub Pages" workflow ran successfully, then opens the URL shown in **Settings → Pages** and confirms the placeholder text loads.
6. Record the live Pages URL in the SDD ledger.

---

### Task 4: OAuth Client ID + full API routing

**Files:**
- Modify: `AppScripts/Api.gs`

**Interfaces:**
- Consumes: `verifyIdTokenClaims` from `AppScripts/Lib/TokenAuth.js` (Task 2); `getLocations()`, `getMaterialsSnapshot()`, `getProductsSnapshot(location)`, `submitInventory(kind, location, counts, newItems)` from `AppScripts/InventoryService.gs` (existing, unchanged).
- Produces: `handleApiGet_`/`handleApiPost_` now route `getLocations`, `getMaterialsSnapshot`, `getProductsSnapshot`, and `submitInventory` (in addition to the existing `ping`), all gated behind `verifyRequestToken_`. Task 5's `WebFrontend/api.js` calls these exact action names.

This task needs the real GitHub Pages URL from Task 3 (as the OAuth client's authorized origin) — don't start it before Task 3's live setup is confirmed done.

- [ ] **Step 1: Create the OAuth Client ID (controller + owner, before writing any code)**

1. Owner opens [Google Cloud Console](https://console.cloud.google.com/) (same Google account that owns the Apps Script project is simplest, but any project works), **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. If prompted to configure the consent screen first: **User type: External**, fill in the required app name/support email, and under **Test users** add both `ALLOWED_EMAILS` addresses (this keeps the app in "Testing" mode, which needs no Google review for a handful of named users).
3. Application type: **Web application**. Name: e.g. "Yonda Inventory Web App".
4. **Authorized JavaScript origins**: add the exact GitHub Pages origin from Task 3 (scheme + host only, no path — e.g. `https://username.github.io`, not the full page URL).
5. Create, copy the **Client ID** (ends in `.apps.googleusercontent.com`). Give it to the controller.

- [ ] **Step 2: Add the routing to `AppScripts/Api.gs`**

Replace the file's contents with:

```javascript
const OAUTH_CLIENT_ID = 'PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com';

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
      return jsonResponse_(getProductsSnapshot(e.parameter.location));
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + action });
  } catch (err) {
    return jsonResponse_({ error: err.message });
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
      return jsonResponse_(submitInventory(body.kind, body.location, body.counts, body.newItems));
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + body.action });
  } catch (err) {
    return jsonResponse_({ error: err.message });
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
```

Replace `PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com` with the Client ID from Step 1 before pushing.

- [ ] **Step 3: Push to Apps Script**

```bash
clasp push
```

- [ ] **Step 4: Smoke-test the auth gate without a real token (no OAuth flow needed for this check)**

```bash
curl -s "<exec-url>?action=getLocations"
```

Expected: `{"error":"Токен не передан"}` — proves the gate rejects an unauthenticated request instead of leaking data or crashing. (A real, valid-token request isn't testable until Task 5's sign-in flow exists — this is deferred to Task 6's live end-to-end check.)

- [ ] **Step 5: Commit**

```bash
git add AppScripts/Api.gs
git commit -m "feat: route inventory API actions through ID token verification"
```

- [ ] **Step 6: Push a new deployment version**

Owner: Apps Script editor → **Deploy → Manage deployments** → pencil icon on the Task 1 deployment → **Version: New version** → **Deploy**. This keeps the same `/exec` URL from Task 1 (confirm with the owner it's unchanged) while running the updated code.

- [ ] **Step 7: Report DONE_WITH_CONCERNS**

Note which of Steps 1, 4, and 6 were completed live vs. deferred, and record the final Client ID and confirmed-unchanged exec URL in the SDD ledger.

---

### Task 5: WebFrontend build

**Files:**
- Modify: `WebFrontend/index.html` (replace Task 3's placeholder)
- Create: `WebFrontend/inventory.html`
- Create: `WebFrontend/styles.css`
- Create: `WebFrontend/auth.js`
- Create: `WebFrontend/api.js`
- Create: `.superpowers/sdd/2026-09-01-github-pages-migration/mock/inventory-mock.html` (mocked click-through harness — gitignored, not committed; see Step 7)

**Interfaces:**
- Consumes: the API from Task 4 — action names `getLocations`, `getMaterialsSnapshot`, `getProductsSnapshot`, `submitInventory`; the exec URL and OAuth Client ID recorded in the SDD ledger by Tasks 1/3/4.
- Produces: the live frontend Task 6 verifies end-to-end.

- [ ] **Step 1: Create `WebFrontend/styles.css`**

Port `AppScripts/Styles.html`'s CSS verbatim, dropping the surrounding `<style>...</style>` tags (this becomes a real stylesheet file instead of an inlined block):

```css
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; font-family: 'Manrope', system-ui, -apple-system, sans-serif; background: oklch(0.99 0.002 250); color: oklch(0.2 0.01 250); }
button { font-family: inherit; cursor: pointer; }
button:active { transform: scale(0.98); }
a { color: oklch(0.45 0.14 220); text-decoration: none; }
input::placeholder { color: oklch(0.72 0.005 250); }
.screen { display: flex; flex-direction: column; min-height: 100vh; }
.header { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid oklch(0.92 0.005 250); flex-shrink: 0; }
.back-btn { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 9px; border: none; background: transparent; padding: 0; color: oklch(0.2 0.01 250); }
.title { font-size: 16px; font-weight: 700; }
.subtitle { font-size: 12px; color: oklch(0.55 0.01 250); }
.list { flex: 1; overflow-y: auto; padding: 4px 20px 8px; display: flex; flex-direction: column; }
.row { display: flex; align-items: center; gap: 12px; padding: 14px 0; border-bottom: 1px solid oklch(0.94 0.004 250); }
.row-name { font-size: 15px; font-weight: 600; }
.row-stock { font-size: 12.5px; color: oklch(0.55 0.01 250); }
.fact-input { width: 76px; height: 44px; border-radius: 10px; border: 1.5px solid oklch(0.88 0.005 250); text-align: center; font-size: 16px; font-weight: 700; color: oklch(0.2 0.01 250); background: oklch(0.98 0.002 250); }
.name-input { flex: 1; min-width: 0; height: 44px; border-radius: 10px; border: 1.5px solid oklch(0.88 0.005 250); padding: 0 12px; font-size: 14px; font-weight: 600; background: oklch(0.98 0.002 250); }
.footer { padding: 14px 20px 22px; border-top: 1px solid oklch(0.92 0.005 250); background: white; flex-shrink: 0; }
.primary-btn { width: 100%; padding: 16px; border-radius: 13px; border: none; background: oklch(0.45 0.14 220); color: white; font-size: 15px; font-weight: 700; }
.dark-btn { width: 100%; padding: 16px; border-radius: 13px; border: none; background: oklch(0.2 0.01 250); color: white; font-size: 15px; font-weight: 700; }
.card-btn { display: flex; align-items: center; gap: 14px; padding: 20px; border-radius: 14px; border: 1.5px solid oklch(0.9 0.005 250); background: white; text-align: left; width: 100%; }
.add-row-btn { display: flex; align-items: center; gap: 8px; padding: 14px 4px; background: transparent; border: none; text-align: left; color: oklch(0.45 0.14 220); font-size: 14.5px; font-weight: 700; }
.remove-btn { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 9px; border: none; background: transparent; padding: 0; flex-shrink: 0; }
.change-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 11px; background: oklch(0.97 0.003 250); }
.spinner { text-align: center; padding: 40px 20px; color: oklch(0.55 0.01 250); font-size: 14px; }
.signin-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; min-height: 100vh; padding: 20px; }
```

(The last rule, `.signin-wrap`, is new — the old tool never needed a sign-in screen of its own.)

- [ ] **Step 2: Create `WebFrontend/api.js`**

```javascript
var API_BASE_URL = 'PASTE_EXEC_URL_HERE';

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
```

`API_BASE_URL` must use `text/plain` as the POST content type, not `application/json` — Task 1's live check confirmed only that avoids a CORS preflight Apps Script can't answer.

- [ ] **Step 3: Create `WebFrontend/auth.js`**

```javascript
var OAUTH_CLIENT_ID = 'PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com';
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
```

- [ ] **Step 4: Create `WebFrontend/inventory.html`**

Port `AppScripts/Inventory.html`'s state machine (all 4 screens, exactly as fixed in Plan 2 — type/location/counting/confirm, including the location-switch state reset and the server-`written`-count confirm screen) with three changes: (a) a sign-in gate before the tool renders; (b) `google.script.run.withSuccessHandler(...).withFailureHandler(...).<fn>(...)` calls replaced with the `apiGet`/`apiPost` calls from `api.js`; (c) a token-expiry check on API errors that signs the user out and re-prompts instead of just alerting.

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yonda — Инвентаризация</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script src="auth.js"></script>
  <script src="api.js"></script>
  <script>
    var state = { screen: 'type', type: null, location: null, locations: null, items: null, facts: {}, customItems: [], changes: [], written: 0 };

    function render() {
      var app = document.getElementById('app');
      if (state.screen === 'type') { app.innerHTML = renderType(); bindType(); return; }
      if (state.screen === 'location') { app.innerHTML = renderLocation(); bindLocation(); return; }
      if (state.screen === 'counting') { app.innerHTML = renderCounting(); bindCounting(); return; }
      if (state.screen === 'confirm') { app.innerHTML = renderConfirm(); bindConfirm(); return; }
    }

    function renderType() {
      return '' +
        '<div class="screen" style="padding:28px 20px 24px;gap:28px;">' +
          '<div><div style="font-size:12.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:oklch(0.55 0.01 250);">Yonda · Инвентаризация</div>' +
          '<div style="font-size:23px;font-weight:800;">Что считаем?</div></div>' +
          '<div style="display:flex;flex-direction:column;gap:12px;">' +
            '<button class="card-btn" id="pick-materials"><div style="flex:1;"><div style="font-size:16px;font-weight:700;">Материалы</div>' +
            '<div style="font-size:13px;color:oklch(0.55 0.01 250);">Склад материалов</div></div></button>' +
            '<button class="card-btn" id="pick-products"><div style="flex:1;"><div style="font-size:16px;font-weight:700;">Товары</div>' +
            '<div style="font-size:13px;color:oklch(0.55 0.01 250);">Основной склад и точки продаж</div></div></button>' +
          '</div>' +
        '</div>';
    }

    function bindType() {
      document.getElementById('pick-materials').onclick = function () {
        state.type = 'materials'; state.facts = {}; state.customItems = [];
        state.screen = 'counting'; state.items = null; render();
        apiGet('getMaterialsSnapshot', {}).then(function (items) { state.items = items; render(); }).catch(onError);
      };
      document.getElementById('pick-products').onclick = function () {
        state.type = 'products'; state.facts = {}; state.customItems = [];
        state.screen = 'location'; state.locations = null; render();
        apiGet('getLocations', {}).then(function (locations) { state.locations = locations; render(); }).catch(onError);
      };
    }

    function renderLocation() {
      if (state.locations === null) {
        return '<div class="screen"><div class="header"><button class="back-btn" id="back-to-type">' + backIcon() + '</button><div class="title">Выбрать точку</div></div><div class="spinner">Загрузка…</div></div>';
      }
      var rows = '';
      state.locations.forEach(function (loc) {
        rows += '<button class="card-btn" data-loc="' + escapeAttr(loc) + '" style="justify-content:space-between;margin-bottom:10px;"><div style="font-size:15px;font-weight:600;">' + escapeHtml(loc) + '</div></button>';
      });
      return '' +
        '<div class="screen">' +
          '<div class="header"><button class="back-btn" id="back-to-type">' + backIcon() + '</button><div class="title">Выбрать точку</div></div>' +
          '<div class="list">' + rows + '</div>' +
        '</div>';
    }

    function bindLocation() {
      document.getElementById('back-to-type').onclick = function () { state.screen = 'type'; state.type = null; render(); };
      if (state.locations === null) return;
      document.querySelectorAll('[data-loc]').forEach(function (btn) {
        btn.onclick = function () {
          state.location = btn.getAttribute('data-loc');
          state.facts = {}; state.customItems = [];
          state.screen = 'counting'; state.items = null; render();
          apiGet('getProductsSnapshot', { location: state.location }).then(function (items) { state.items = items; render(); }).catch(onError);
        };
      });
    }

    function renderCounting() {
      if (state.items === null) {
        return '<div class="screen"><div class="header"><button class="back-btn" id="back-from-counting">' + backIcon() + '</button><div><div class="title">' + (state.type === 'materials' ? 'Материалы' : 'Товары') + '</div></div></div><div class="spinner">Загрузка…</div></div>';
      }
      var rows = '';
      state.items.forEach(function (item) {
        var fact = state.facts[item.name] === undefined ? '' : state.facts[item.name];
        var stockLabel = 'Сейчас: ' + item.current + (item.unit ? (' ' + item.unit) : '');
        rows += '<div class="row"><div style="flex:1;"><div class="row-name">' + escapeHtml(item.name) + '</div>' +
          '<div class="row-stock">' + stockLabel + '</div></div>' +
          '<input class="fact-input" type="number" inputmode="decimal" placeholder="—" data-fact="' + escapeAttr(item.name) + '" value="' + escapeAttr(fact) + '"></div>';
      });
      state.customItems.forEach(function (ci) {
        rows += '<div class="row"><input class="name-input" type="text" placeholder="Название позиции" data-custom-name="' + ci.id + '" value="' + escapeAttr(ci.name) + '">' +
          '<input class="fact-input" style="width:64px;" type="number" inputmode="decimal" placeholder="—" data-custom-fact="' + ci.id + '" value="' + escapeAttr(ci.fact) + '">' +
          '<button class="remove-btn" data-remove-custom="' + ci.id + '">' + removeIcon() + '</button></div>';
      });
      var subtitle = state.type === 'materials' ? 'Основной склад' : state.location;
      return '' +
        '<div class="screen">' +
          '<div class="header"><button class="back-btn" id="back-from-counting">' + backIcon() + '</button>' +
          '<div><div class="title">' + (state.type === 'materials' ? 'Материалы' : 'Товары') + '</div><div class="subtitle">' + escapeHtml(subtitle) + '</div></div></div>' +
          '<div class="list">' + rows + '<button class="add-row-btn" id="add-custom">' + plusIcon() + ' Добавить позицию</button></div>' +
          '<div class="footer"><button class="primary-btn" id="save-counts">Сохранить</button></div>' +
        '</div>';
    }

    function bindCounting() {
      var backBtn = document.getElementById('back-from-counting');
      if (backBtn) backBtn.onclick = function () {
        if (state.type === 'products') { state.screen = 'location'; }
        else { state.screen = 'type'; state.type = null; }
        render();
      };
      if (state.items === null) return;
      document.querySelectorAll('[data-fact]').forEach(function (el) {
        el.onchange = function () { state.facts[el.getAttribute('data-fact')] = el.value; };
      });
      document.querySelectorAll('[data-custom-name]').forEach(function (el) {
        el.onchange = function () {
          var id = el.getAttribute('data-custom-name');
          state.customItems = state.customItems.map(function (c) { return c.id === id ? Object.assign({}, c, { name: el.value }) : c; });
        };
      });
      document.querySelectorAll('[data-custom-fact]').forEach(function (el) {
        el.onchange = function () {
          var id = el.getAttribute('data-custom-fact');
          state.customItems = state.customItems.map(function (c) { return c.id === id ? Object.assign({}, c, { fact: el.value }) : c; });
        };
      });
      document.querySelectorAll('[data-remove-custom]').forEach(function (el) {
        el.onclick = function () {
          var id = el.getAttribute('data-remove-custom');
          state.customItems = state.customItems.filter(function (c) { return c.id !== id; });
          render();
        };
      });
      document.getElementById('add-custom').onclick = function () {
        state.customItems.push({ id: 'c' + Date.now() + Math.floor(Math.random() * 1000), name: '', fact: '' });
        render();
      };
      document.getElementById('save-counts').onclick = onSave;
    }

    function onSave() {
      var counts = [];
      state.items.forEach(function (item) {
        var raw = state.facts[item.name];
        if (raw === undefined || raw === '') return;
        var factNum = Number(raw);
        if (isNaN(factNum)) return;
        var delta = factNum - item.current;
        if (delta === 0) return;
        counts.push({ name: item.name, fact: raw });
      });
      var newItems = state.customItems
        .filter(function (c) { return c.name && c.fact !== '' && !isNaN(Number(c.fact)) && Number(c.fact) !== 0; })
        .map(function (c) { return { name: c.name, fact: c.fact }; });

      state.changes = counts.map(function (c) {
        var item = state.items.filter(function (i) { return i.name === c.name; })[0];
        var delta = Number(c.fact) - item.current;
        var unit = item.unit ? (' ' + item.unit) : '';
        return { name: c.name, label: (delta > 0 ? '+' : '') + delta + unit };
      }).concat(newItems.map(function (ni) {
        return { name: ni.name, label: '+' + ni.fact + ' (новое)' };
      }));

      var btn = document.getElementById('save-counts');
      btn.setAttribute('disabled', 'true');
      btn.textContent = 'Сохраняем…';
      apiPost('submitInventory', { kind: state.type, location: state.location, counts: counts, newItems: newItems })
        .then(function (result) {
          state.written = result && typeof result.written === 'number' ? result.written : state.changes.length;
          state.screen = 'confirm'; render();
        })
        .catch(function (err) {
          btn.removeAttribute('disabled'); btn.textContent = 'Сохранить';
          onError(err);
        });
    }

    function renderConfirm() {
      var rows = '';
      state.changes.forEach(function (chg) {
        rows += '<div class="change-row"><div style="flex:1;font-size:14px;font-weight:600;">' + escapeHtml(chg.name) + '</div>' +
          '<div style="font-size:14px;font-weight:800;color:oklch(0.45 0.14 220);">' + escapeHtml(chg.label) + '</div></div>';
      });
      var summary = state.written === 0 ? 'Расхождений не найдено' : 'Обновлено позиций: ' + state.written;
      return '' +
        '<div class="screen">' +
          '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px 20px 22px;">' +
            '<div style="width:52px;height:52px;border-radius:50%;background:oklch(0.93 0.05 145);display:flex;align-items:center;justify-content:center;">' + checkIcon() + '</div>' +
            '<div style="font-size:18px;font-weight:800;">Инвентаризация сохранена</div>' +
            '<div style="font-size:13px;color:oklch(0.55 0.01 250);text-align:center;">' + summary + '</div>' +
          '</div>' +
          '<div class="list" style="gap:8px;">' + rows + '</div>' +
          '<div class="footer" style="border-top:none;"><button class="dark-btn" id="finish">Готово</button></div>' +
        '</div>';
    }

    function bindConfirm() {
      document.getElementById('finish').onclick = function () {
        state = { screen: 'type', type: null, location: null, locations: null, items: null, facts: {}, customItems: [], changes: [], written: 0 };
        render();
      };
    }

    function onError(err) {
      if (isTokenAuthError(err)) { signOut(); return; }
      alert('Ошибка: ' + (err && err.message ? err.message : err));
    }

    function escapeHtml(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
    function backIcon() { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"></path></svg>'; }
    function plusIcon() { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"></path></svg>'; }
    function removeIcon() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="oklch(0.55 0.18 25)" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"></path></svg>'; }
    function checkIcon() { return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="oklch(0.4 0.14 145)" stroke-width="2.4"><path d="M5 13l4 4L19 7"></path></svg>'; }

    function renderSignedOut() {
      document.getElementById('app').innerHTML = '<div class="signin-wrap"><div style="font-size:16px;font-weight:700;">Войдите, чтобы продолжить</div><div id="signin-button"></div></div>';
    }

    renderSignedOut();
  </script>
  <script src="https://accounts.google.com/gsi/client" async onload="initAuth(render)"></script>
</body>
</html>
```

- [ ] **Step 5: Replace `WebFrontend/index.html`'s placeholder with the real home screen**

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yonda</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script src="auth.js"></script>
  <script>
    function renderHome() {
      document.getElementById('app').innerHTML =
        '<div class="screen" style="padding:28px 20px 24px;gap:28px;">' +
          '<div><div style="font-size:12.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:oklch(0.55 0.01 250);">Yonda</div>' +
          '<div style="font-size:23px;font-weight:800;">Инструменты</div></div>' +
          '<a class="card-btn" href="inventory.html"><div style="flex:1;"><div style="font-size:16px;font-weight:700;">Инвентаризация</div>' +
          '<div style="font-size:13px;color:oklch(0.55 0.01 250);">Сверить фактические остатки</div></div></a>' +
        '</div>';
    }
    function renderSignedOut() {
      document.getElementById('app').innerHTML = '<div class="signin-wrap"><div style="font-size:16px;font-weight:700;">Войдите, чтобы продолжить</div><div id="signin-button"></div></div>';
    }
    renderSignedOut();
  </script>
  <script src="https://accounts.google.com/gsi/client" async onload="initAuth(renderHome)"></script>
</body>
</html>
```

- [ ] **Step 6: Fill in the real values**

Replace `PASTE_EXEC_URL_HERE` in `api.js` with the exec URL confirmed unchanged in Task 4, and `PASTE_REAL_CLIENT_ID_HERE.apps.googleusercontent.com` in `auth.js` with the Client ID from Task 4.

- [ ] **Step 7: Build and run a mocked desktop click-through**

Before any live deployment, verify the client state machine actually executes — the same technique used to verify `AppScripts/Inventory.html` in the previous plan. Create
`.superpowers/sdd/2026-09-01-github-pages-migration/mock/inventory-mock.html` (this directory is gitignored, per `.gitignore`'s `.superpowers/` rule — do not force-add it): copy `WebFrontend/inventory.html` verbatim, but replace the two `<script src="auth.js">`/`<script src="api.js">` includes and the Google Identity Services `<script>` tag with inline stubs: a fake `initAuth(cb)` that calls `cb()` immediately (skipping real sign-in), and fake `apiGet`/`apiPost` functions returning `Promise.resolve(...)` with made-up materials/locations/products data and a `submitInventory` stub mirroring the real server's zero-fact-skip logic (`Number.isNaN(factNum) || factNum === 0` skips the item). Open it with the Claude Browser tool (or any browser) and click through: Товары → pick a location → enter a count and a zero-fact custom item → Сохранить → confirm the "Обновлено позиций" count matches only the non-zero change → Готово resets to the type screen. Also click Материалы. Check the browser console for errors throughout.

- [ ] **Step 8: Commit**

```bash
git add WebFrontend/index.html WebFrontend/inventory.html WebFrontend/styles.css WebFrontend/auth.js WebFrontend/api.js
git commit -m "feat: build GitHub Pages frontend (Google sign-in + fetch-based API client)"
```

- [ ] **Step 9: Report DONE**

Include the mocked click-through's outcome in the report.

---

### Task 6: Live end-to-end verification + Production Hand-Off

**Files:**
- Modify: `docs/superpowers/plans/2026-09-01-github-pages-migration.md` (this file — add the Production Hand-Off section below)

**Interfaces:** None — this task is verification and documentation, no code changes.

- [ ] **Step 1: Push and let GitHub Actions deploy**

```bash
git push
```

Confirm in the repo's **Actions** tab that the deploy workflow succeeded.

- [ ] **Step 2: Live verification (owner, relayed through the controller)**

On the owner's phone (the same one that showed the blank screen on the old Apps Script HTML tool): open the GitHub Pages URL, sign in with Google, confirm the home screen shows the Инвентаризация card, click it, sign in again if prompted, and run a full stocktake for both Материалы and Товары (including a location switch, to confirm the state-reset fix carried over) through to the confirm screen. Also have the partner (`nurakvlnk@gmail.com`) open the same URL once and confirm they can sign in and aren't blocked by the allowlist — this was never actually tested in Plan 2 either.

- [ ] **Step 3: Write the Production Hand-Off section**

Once Step 2 passes, append this section to the end of this plan file:

```markdown
## Production Hand-Off

This plan was built and verified against the sandbox Google Sheet/Apps
Script project. To apply the same changes to the real production system:

1. **Copy the code**, using `git show` on this plan's commits as the
   reference: `AppScripts/Api.gs`, `AppScripts/Lib/TokenAuth.js`,
   `AppScripts/WebApp.gs`'s `doGet`/`doPost` changes, and the entire
   `WebFrontend/` folder.
2. **Create a second OAuth Client ID** in Google Cloud Console (same steps
   as Task 4, Step 1) — a fresh one scoped to production's GitHub Pages
   origin, with both production `ALLOWED_EMAILS` addresses as test users
   (confirm they match production's `WebApp.gs` — update if not).
3. **Create a second private GitHub repo** for production (or reuse this
   one if production and sandbox are meant to share a live site — decide
   with the owner; the sandbox and production Apps Script projects have
   different Script IDs, so they cannot share one exec URL regardless).
   Enable Pages the same way as Task 3.
4. **Create a new, separate Web App deployment** in the production Apps
   Script project for the API — same caution as always: don't touch
   whichever deployment already serves production's Telegram webhook or
   its existing HTML pages.
5. **Update `WebFrontend/api.js`'s `API_BASE_URL`** and `auth.js`'s
   `OAUTH_CLIENT_ID`** to production's values before pushing.
6. **Verify**: repeat Task 6, Step 2 against production, with both the
   owner and the partner.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-09-01-github-pages-migration.md
git commit -m "docs: add Production Hand-Off section"
```

- [ ] **Step 5: Report DONE**

# Расход (Expense Entry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mobile expense-entry tool (`WebFrontend/expense.html`) that lets the owner/partner record a business expense (category, amount, payment type, optional note) in one tap, writing it into the existing accounting ledger the same way the old Google Form's "Расход" branch did.

**Architecture:** Pure, Node-testable validation and row-shaping logic lives in `AppScripts/Lib/ExpenseLogic.js`. Thin Google Apps Script wiring in a new `AppScripts/ExpenseService.gs` calls that logic, reuses the existing `getPaymentTypes()`/`resolveAccount()` account-resolution pair (already generic, introduced for sales checkout), and appends one row to `Ответы на форму (1)` (Layer 1) — never writes `Операции` (Layer 2) directly, matching this project's established three-layer architecture. `WebFrontend/expense.html` is a new static page reusing the existing `api.js`/`auth.js`/`styles.css` pattern from `sales.html`/`inventory.html`.

**Tech Stack:** Google Apps Script (V8 runtime), Google Sheets formulas (owner-maintained, unmodified by this plan), static HTML/CSS/JS on GitHub Pages, Node's built-in test runner for `AppScripts/Lib/*.js`.

**Spec:** `docs/superpowers/specs/2026-09-05-expense-tool-design.md`

## Global Constraints

- `Ответы на форму (1)` is addressed via the existing global `SHEET_FORM` constant (`AppScripts/Уведомления через ТГ-бот.js:4`) and `Справочники` via `SHEET_REFERENCES` (`AppScripts/Уведомления через ТГ-бот.js:7`) — never redeclare either (Apps Script concatenates every project file into one shared global scope). `FORM_COL_TIP_ZAPISI = 2` (column B) is likewise already declared in `AppScripts/InventoryService.gs:100` — reuse it, don't redeclare.
- Confirmed live column layout of `Ответы на форму (1)`'s Расход branch (1-based, verified directly against the sheet, matches the legacy `Уведомления через ТГ-бот.js` indices): `G=7` Категория, `H=8` Сумма, `I=9` Тип оплаты, `J=10` Примечание.
- Confirmed live `Справочники!G2:G12` — 11 expense categories: Услуги полиграфии, Расходные материалы, Маркетинг, Оборудование, Налоги, Транзакционные расходы, Личные расходы, ФОТ, Аренда, Транспортные расходы, Прочее.
- Confirmed live `Справочники!D:E` (same table `getPaymentTypes()` already reads for sales) — 7 payment types: Наличка→Наличка, Paynet→Paynet, Перевод на карту→Личная карта, Click→Расчётный счёт, Payme→Расчётный счёт, Личная карта→Личная карта, Расчётный счёт→Расчётный счёт.
- **Column I (`Тип оплаты`) of the Расход row must hold the resolved account (`Справочники!E`), never the raw payment-type label the user picked (`Справочники!D`)** — confirmed by `appendIncomeRow_` in `AppScripts/InventoryService.gs:295-304`, which does the same for the Доход branch. The frontend must never render column E's value anywhere in the UI — it exists purely for this server-side write.
- `resolveAccount(paymentTypes, paymentType)` and `getPaymentTypes()` (`AppScripts/InventoryService.gs:319-329`, `AppScripts/Lib/SalesLogic.js:57-60`) are reused as-is — do not duplicate this lookup in the new files.
- `onFormSubmit` triggers (including the legacy `handleExpenseNotification` in `Уведомления через ТГ-бот.js`) only fire for real Google Form submissions, never for a programmatic `appendRow` — `submitExpense` must send its own Telegram message explicitly, the same way `submitSale` does.
- `clasp push` has previously reported success without the content reaching the server in this project — every push must be independently verified via the Apps Script API content endpoint before being trusted (see Task 2, Step 4 for the exact command).
- `clasp push` alone does **not** update the already-published, version-pinned Web App deployment that `WebFrontend/api.js`'s `API_BASE_URL` calls — a real redeploy needs `clasp deploy --deploymentId <id>` (Task 6).
- `.clasp.json` lives at the repo root (`Yonda/`), `scriptId` = `1yDdbX9Ovp5UwpnPX67WBzYVl5YDRreedcBJuHfR-2zukVGhC53unZDMC` — `clasp push`/`clasp deploy` run from there, not from `AppScripts/`.
- **The category, payment-type, and note fields all live on the same single form screen as the category/payment chips.** Since `render()` rebuilds the whole screen via `innerHTML` on every chip click, the amount and note `<input>`s must be driven from `state.amount`/`state.note` (rendered via `value="..."`) and updated in their own `oninput` handler **without** calling `render()` from that handler — otherwise a chip click elsewhere would wipe out whatever the user had already typed, and typing itself would lose focus after every keystroke. This is unlike `sales.html`'s free-text fields (service name/price, per-line price edit), which never share a screen with a chip picker, so this exact bug doesn't arise there.

---

### Task 1: `ExpenseLogic.js` — validation and row-shaping (pure logic)

**Files:**
- Create: `AppScripts/Lib/ExpenseLogic.js`
- Create: `AppScripts/Lib/ExpenseLogic.test.js`

**Interfaces:**
- Produces: `validateExpenseInput(category, amount, paymentType)` → `string | null` (an error message, or `null` if valid).
- Produces: `buildExpenseRow(category, amount, account, note)` → `{ category, amount, account, note }` (`note` defaults to `''`).
- Produces: `buildTelegramExpenseMessage(category, amount, account, fmt)` → `string`.

- [ ] **Step 1: Write the failing tests**

Create `AppScripts/Lib/ExpenseLogic.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateExpenseInput, buildExpenseRow, buildTelegramExpenseMessage } = require('./ExpenseLogic.js');

test('validateExpenseInput rejects a missing category', () => {
  assert.equal(validateExpenseInput('', 1000, 'Наличка'), 'Не выбрана категория расхода.');
});

test('validateExpenseInput rejects a missing payment type', () => {
  assert.equal(validateExpenseInput('Прочее', 1000, ''), 'Не выбран тип оплаты.');
});

test('validateExpenseInput rejects a zero amount', () => {
  assert.equal(validateExpenseInput('Прочее', 0, 'Наличка'), 'Сумма расхода должна быть больше нуля.');
});

test('validateExpenseInput rejects a negative amount', () => {
  assert.equal(validateExpenseInput('Прочее', -500, 'Наличка'), 'Сумма расхода должна быть больше нуля.');
});

test('validateExpenseInput rejects a non-numeric amount', () => {
  assert.equal(validateExpenseInput('Прочее', 'abc', 'Наличка'), 'Сумма расхода должна быть больше нуля.');
});

test('validateExpenseInput accepts valid input', () => {
  assert.equal(validateExpenseInput('Прочее', 192000, 'Наличка'), null);
});

test('buildExpenseRow carries the already-resolved account straight through, defaulting note to empty string', () => {
  assert.deepEqual(
    buildExpenseRow('Расходные материалы', 400000, 'Личная карта', undefined),
    { category: 'Расходные материалы', amount: 400000, account: 'Личная карта', note: '' }
  );
});

test('buildExpenseRow keeps a given note as-is', () => {
  assert.deepEqual(
    buildExpenseRow('Аренда', 1500000, 'Расчётный счёт', 'Аренда за сентябрь'),
    { category: 'Аренда', amount: 1500000, account: 'Расчётный счёт', note: 'Аренда за сентябрь' }
  );
});

test('buildTelegramExpenseMessage formats category, amount, and account', () => {
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU') + ' сум';
  const msg = buildTelegramExpenseMessage('Услуги полиграфии', 192000, 'Личная карта', fmt);
  assert.match(msg, /Категория: Услуги полиграфии/);
  assert.match(msg, /Сумма: 192 000 сум/);
  assert.match(msg, /Счёт: Личная карта/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module './ExpenseLogic.js'`.

- [ ] **Step 3: Implement `ExpenseLogic.js`**

Create `AppScripts/Lib/ExpenseLogic.js`:

```javascript
// Validates expense input before any account lookup or sheet write. Pure —
// no SpreadsheetApp dependency — so every rejection path is cheap to test
// here, mirroring how resolveAccount's failure cases are tested in
// SalesLogic.test.js rather than against a live spreadsheet.
function validateExpenseInput(category, amount, paymentType) {
  if (!category) return 'Не выбрана категория расхода.';
  if (!paymentType) return 'Не выбран тип оплаты.';
  const num = Number(amount);
  if (amount === '' || amount === null || amount === undefined || isNaN(num) || num <= 0) {
    return 'Сумма расхода должна быть больше нуля.';
  }
  return null;
}

function buildExpenseRow(category, amount, account, note) {
  return { category: category, amount: amount, account: account, note: note || '' };
}

function buildTelegramExpenseMessage(category, amount, account, fmt) {
  return '💸 <b>Расход</b>\n' +
    'Категория: ' + category + '\n' +
    'Сумма: ' + fmt(amount) + '\n' +
    'Счёт: ' + account;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateExpenseInput, buildExpenseRow, buildTelegramExpenseMessage };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `ExpenseLogic.test.js` tests green, and the full suite (`InventoryLogic.test.js` + `SalesLogic.test.js` + `ExpenseLogic.test.js`) still passes.

- [ ] **Step 5: Commit**

```bash
git add AppScripts/Lib/ExpenseLogic.js AppScripts/Lib/ExpenseLogic.test.js
git commit -m "$(cat <<'EOF'
feat: add pure validation/row-shaping logic for expense entry

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `ExpenseService.gs` — backend write path

**Files:**
- Create: `AppScripts/ExpenseService.gs`

**Interfaces:**
- Consumes: `SHEET_FORM`, `SHEET_REFERENCES`, `FORM_COL_TIP_ZAPISI` (globals, already declared elsewhere in the project), `getPaymentTypes()` and `resolveAccount()` (`AppScripts/InventoryService.gs`), `sendTelegram()` and `fmt()` (`AppScripts/Уведомления через ТГ-бот.js`), and `validateExpenseInput`/`buildExpenseRow`/`buildTelegramExpenseMessage` from Task 1.
- Produces: `getExpenseCategories()` → `string[]`; `submitExpense(category, amount, paymentType, note)` → `{ written: true }` (throws on validation/resolution failure).

There is no automated test for this file (it depends on `SpreadsheetApp`, unavailable outside the Apps Script runtime) — the "test cycle" for this task is the manual verification in Step 5, following the same pattern as `testProdazhaLayer2Wiring` in `AppScripts/InventoryService.gs`.

- [ ] **Step 1: Create the file**

Create `AppScripts/ExpenseService.gs`:

```javascript
const FORM_COL_KATEGORIYA_RASHOD = 7;  // G: Категория (расход)
const FORM_COL_SUMMA_RASHOD = 8;       // H: Сумма (расход)
const FORM_COL_TIP_OPLATY_RASHOD = 9;  // I: Тип оплаты (расход) — stores the resolved account, not the raw payment-type label (same convention as appendIncomeRow_ in InventoryService.gs)
const FORM_COL_OPISANIE_RASHOD = 10;   // J: Примечание (расход)

// "Справочники" column G holds "Категории расходов" — read dynamically, same
// pattern as getLocations()/getPaymentTypes(), so the list stays in sync with
// the sheet without a code change.
function getExpenseCategories() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_REFERENCES);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 7, lastRow - 1, 1).getValues(); // G
  return data
    .filter(function (row) { return row[0]; })
    .map(function (row) { return row[0]; });
}

function appendExpenseRow_(ss, category, amount, account, note) {
  const formSheet = ss.getSheetByName(SHEET_FORM);
  const row = [];
  row[0] = new Date();
  row[FORM_COL_TIP_ZAPISI - 1] = 'Расход';
  row[FORM_COL_KATEGORIYA_RASHOD - 1] = category;
  row[FORM_COL_SUMMA_RASHOD - 1] = amount;
  row[FORM_COL_TIP_OPLATY_RASHOD - 1] = account;
  row[FORM_COL_OPISANIE_RASHOD - 1] = note;
  formSheet.appendRow(row);
}

function submitExpense(category, amount, paymentType, note) {
  const validationError = validateExpenseInput(category, amount, paymentType);
  if (validationError) {
    throw new Error(validationError);
  }

  // Resolve the account BEFORE writing anything — same defensive order as
  // submitSale: an unmapped payment type must refuse the expense outright,
  // not write an unvalidated string into a real financial ledger.
  const account = resolveAccount(getPaymentTypes(), paymentType);
  if (!account) {
    throw new Error('Тип оплаты "' + paymentType + '" не сопоставлен со счётом в Справочники!D:E — расход не записан.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const row = buildExpenseRow(category, Number(amount), account, note);
  appendExpenseRow_(ss, row.category, row.amount, row.account, row.note);

  sendTelegram(buildTelegramExpenseMessage(row.category, row.amount, row.account, fmt));

  return { written: true };
}

// Temporary — run once by hand from the Apps Script editor to verify a
// programmatic Расход row reaches "Операции" the same way the legacy form's
// Расход branch already does. Delete the synthetic row from
// "Ответы на форму (1)" (and, if it appears, from "Операции") after
// verifying. Safe to leave the function itself in the codebase as a reusable
// diagnostic. No trailing underscore — Apps Script hides underscore-suffixed
// functions from the editor's "Select function" dropdown, and this one needs
// to be runnable from there.
function testExpenseLayerWiring() {
  const result = submitExpense('Прочее', 1, 'Наличка', 'ТЕСТ проверка записи расхода');
  Logger.log('submitExpense вернул: ' + JSON.stringify(result) + '. Откройте "Ответы на форму (1)": должна появиться строка Тип="Расход", Категория="Прочее", Сумма=1, Тип оплаты="Наличка", Примечание="ТЕСТ проверка записи расхода". Проверьте также, что она попала в "Операции" тем же способом, что и любая другая строка Расход.');
}
```

- [ ] **Step 2: Run the existing test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS — unchanged (this file has no `.test.js`, and doesn't modify any existing `Lib/*.js`).

- [ ] **Step 3: Commit**

```bash
git add AppScripts/ExpenseService.gs
git commit -m "$(cat <<'EOF'
feat: add expense backend service (categories lookup + submitExpense)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push and independently verify the push landed**

```bash
clasp push
```

Then verify via the Apps Script API directly (do not trust `clasp push`'s stdout alone — this project's pushes have silently failed before):

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME + '/.clasprc.json')).tokens.default.access_token)"
```

Take that token and:

```bash
curl -s -H "Authorization: Bearer <TOKEN>" "https://script.googleapis.com/v1/projects/1yDdbX9Ovp5UwpnPX67WBzYVl5YDRreedcBJuHfR-2zukVGhC53unZDMC/content" | node -e "
let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  const json = JSON.parse(data);
  const f = json.files.find(x => x.name === 'ExpenseService');
  console.log(f && f.source.includes('testExpenseLayerWiring') ? 'OK: new code present' : 'MISSING: push did not land');
});
"
```

Expected: `OK: new code present`. If it prints `MISSING`, re-push with `clasp push -f` and re-verify before continuing.

- [ ] **Step 5: Manual — run the diagnostic and confirm the ledger picks it up**

In the Apps Script editor, select and run `testExpenseLayerWiring` (owner/authorized account).

1. Open `Ответы на форму (1)` and confirm a new row landed with `Тип записи = "Расход"` (column B), `Категория = "Прочее"` (G), `Сумма = 1` (H), `Тип оплаты = "Наличка"` (I — this is the resolved account, which for "Наличка" happens to be the same string), `Примечание = "ТЕСТ проверка записи расхода"` (J).
2. Open `Операции` and confirm a corresponding row appeared with the same amount, account, and category — no formula changes should be needed here (unlike the goods-movement `Тип` formula from the sales-checkout plan), since the Расход branch's columns are the same ones the legacy Google Form already wrote into.
3. Confirm a Telegram message arrived matching the format: "💸 Расход / Категория: Прочее / Сумма: 1 сум / Счёт: Наличка".
4. **Test the rejection path**: temporarily change the `paymentType` argument in `testExpenseLayerWiring` from `'Наличка'` to an unmapped value (e.g. `'НесуществующийТип'`), save, run again. Confirm the execution log shows the thrown error ("Тип оплаты ... не сопоставлен со счётом...") and that **no** new row appears in `Ответы на форму (1)`. Then revert the argument back to `'Наличка'`.
5. Delete the synthetic `"ТЕСТ проверка записи расхода"` row from `Ответы на форму (1)` once confirmed (Layer 2/3 will recalculate the removal automatically).

---

### Task 3: Wire `getExpenseCategories`/`submitExpense` into `Api.gs`

**Files:**
- Modify: `AppScripts/Api.gs`

**Interfaces:**
- Consumes: `getExpenseCategories()`, `submitExpense(category, amount, paymentType, note)` (Task 2).
- Produces: GET action `getExpenseCategories`, POST action `submitExpense` — both auth-gated the same way every existing action is.

- [ ] **Step 1: Add the GET action**

In `AppScripts/Api.gs`, in `handleApiGet_`, replace:

```javascript
    if (action === 'getPaymentTypes') {
      return jsonResponse_(getPaymentTypes());
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + action });
```

with:

```javascript
    if (action === 'getPaymentTypes') {
      return jsonResponse_(getPaymentTypes());
    }
    if (action === 'getExpenseCategories') {
      return jsonResponse_(getExpenseCategories());
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + action });
```

- [ ] **Step 2: Add the POST action**

In `AppScripts/Api.gs`, in `handleApiPost_`, replace:

```javascript
    if (body.action === 'submitSale') {
      return jsonResponse_(submitSale(body.items, body.paymentType, body.totalOverride));
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + body.action });
```

with:

```javascript
    if (body.action === 'submitSale') {
      return jsonResponse_(submitSale(body.items, body.paymentType, body.totalOverride));
    }
    if (body.action === 'submitExpense') {
      return jsonResponse_(submitExpense(body.category, body.amount, body.paymentType, body.note));
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + body.action });
```

- [ ] **Step 3: Commit**

```bash
git add AppScripts/Api.gs
git commit -m "$(cat <<'EOF'
feat: expose getExpenseCategories and submitExpense over the API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Push and independently verify the push landed**

```bash
clasp push
```

Repeat the Task 2 Step 4 verification pattern, this time checking the `Api` file source for `getExpenseCategories` and `submitExpense`.

---

### Task 4: `WebFrontend/expense.html` + home-screen link

**Files:**
- Create: `WebFrontend/expense.html`
- Modify: `WebFrontend/index.html`

**Interfaces:**
- Consumes: `apiGet`/`apiPost` from `WebFrontend/api.js`, `initAuth`/`isTokenAuthError`/`signOut` from `WebFrontend/auth.js` (unchanged), `getExpenseCategories`/`getPaymentTypes` (GET), `submitExpense` (POST) from Task 3.

There is no automated test for this file — Apps Script Web pages in this project are verified by hand in the browser (same convention as `sales.html`/`inventory.html`). The "test cycle" for this task is the manual walkthrough in Step 3.

- [ ] **Step 1: Create the page**

Create `WebFrontend/expense.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yonda — Расход</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script src="auth.js"></script>
  <script src="api.js"></script>
  <script>
    var state = {
      categories: null,        // string[] from "Справочники" column G — fetched, not hardcoded
      categoriesError: null,
      paymentTypes: null,      // {type, account}[] from "Справочники" (Счета, D:E) — same source sales.html uses; only .type is ever shown
      paymentTypesError: null,
      category: null,
      amount: '',
      paymentType: null,
      note: '',
      submitting: false,
      screen: 'form',
      confirm: null
    };

    function render() {
      var app = document.getElementById('app');
      if (state.screen === 'form') { app.innerHTML = renderForm(); bindForm(); return; }
      if (state.screen === 'confirm') { app.innerHTML = renderConfirm(); bindConfirm(); return; }
    }

    function fmtSum(n) { return Math.round(n).toLocaleString('ru-RU') + ' сум'; }

    function renderForm() {
      var categorySection;
      if (state.categoriesError) {
        categorySection = '<div class="spinner">Не удалось загрузить категории расхода.</div>' +
          '<button class="btn-ghost" id="retry-categories">Повторить</button>';
      } else if (state.categories === null) {
        categorySection = '<div class="spinner">Загрузка…</div>';
      } else if (state.categories.length === 0) {
        categorySection = '<div class="spinner">Список категорий пуст — проверьте «Справочники», столбец G.</div>';
      } else {
        categorySection = '<div class="chip-row">' + state.categories.map(function (c) {
          return '<button class="chip' + (state.category === c ? ' selected' : '') + '" data-category="' + escapeAttr(c) + '">' + escapeHtml(c) + '</button>';
        }).join('') + '</div>';
      }

      var paymentSection;
      if (state.paymentTypesError) {
        paymentSection = '<div class="spinner">Не удалось загрузить типы оплаты.</div>' +
          '<button class="btn-ghost" id="retry-payment-types">Повторить</button>';
      } else if (state.paymentTypes === null) {
        paymentSection = '<div class="spinner">Загрузка…</div>';
      } else if (state.paymentTypes.length === 0) {
        paymentSection = '<div class="spinner">Список типов оплаты пуст — проверьте «Справочники» (Счета, D:E).</div>';
      } else {
        paymentSection = '<div class="chip-row">' + state.paymentTypes.map(function (p) {
          return '<button class="chip' + (state.paymentType === p.type ? ' selected' : '') + '" data-payment="' + escapeAttr(p.type) + '">' + escapeHtml(p.type) + '</button>';
        }).join('') + '</div>';
      }

      return '' +
        '<div class="screen">' +
          '<div class="header"><div class="title">Расход</div></div>' +
          '<div class="list">' +
            '<div style="font-size:13px;font-weight:700;margin:10px 0 8px;">Категория</div>' +
            categorySection +
            '<div style="font-size:13px;font-weight:700;margin:18px 0 8px;">Сумма</div>' +
            '<input class="name-input" style="width:100%;" type="number" inputmode="decimal" placeholder="Сумма" id="amount-input" value="' + escapeAttr(state.amount) + '">' +
            '<div style="font-size:13px;font-weight:700;margin:18px 0 8px;">Оплата</div>' +
            paymentSection +
            '<div style="font-size:13px;font-weight:700;margin:18px 0 8px;">Примечание</div>' +
            '<input class="name-input" style="width:100%;" type="text" placeholder="Необязательно" id="note-input" value="' + escapeAttr(state.note) + '">' +
          '</div>' +
          '<div class="footer">' +
            '<button class="primary-btn" id="submit-expense"' + (!state.category || !state.paymentType || state.submitting ? ' disabled' : '') + '>' + (state.submitting ? 'Записываем…' : 'Записать расход') + '</button>' +
          '</div>' +
        '</div>';
    }

    function bindForm() {
      document.querySelectorAll('[data-category]').forEach(function (btn) {
        btn.onclick = function () { state.category = btn.getAttribute('data-category'); render(); };
      });
      document.querySelectorAll('[data-payment]').forEach(function (btn) {
        btn.onclick = function () { state.paymentType = btn.getAttribute('data-payment'); render(); };
      });

      // Deliberately do NOT call render() from these two handlers: this
      // screen also has chip buttons whose click handlers DO call render(),
      // which rebuilds the whole screen via innerHTML. If amount/note typing
      // also triggered a full render on every keystroke, the input would be
      // replaced (and focus dropped) after every character — and if it did
      // NOT keep state in sync, a chip click mid-typing would wipe out
      // whatever had been typed. Keeping state in sync without re-rendering
      // solves both: focus survives typing, and any later chip-triggered
      // render restores the typed value via the value="..." attribute above.
      var amountInput = document.getElementById('amount-input');
      if (amountInput) amountInput.oninput = function () { state.amount = amountInput.value; };
      var noteInput = document.getElementById('note-input');
      if (noteInput) noteInput.oninput = function () { state.note = noteInput.value; };

      var submitBtn = document.getElementById('submit-expense');
      if (submitBtn) submitBtn.onclick = onSubmitExpense;
      var retryCategories = document.getElementById('retry-categories');
      if (retryCategories) retryCategories.onclick = loadCategories;
      var retryPaymentTypes = document.getElementById('retry-payment-types');
      if (retryPaymentTypes) retryPaymentTypes.onclick = loadPaymentTypes;
    }

    function onSubmitExpense() {
      if (!state.category || !state.paymentType || state.submitting) return;
      var amount = Number(state.amount);
      if (!state.amount || isNaN(amount) || amount <= 0) {
        alert('Введите сумму больше 0.');
        return;
      }
      state.submitting = true;
      render();
      apiPost('submitExpense', { category: state.category, amount: amount, paymentType: state.paymentType, note: state.note })
        .then(function () {
          state.confirm = { category: state.category, amount: amount, paymentType: state.paymentType };
          state.submitting = false;
          state.screen = 'confirm';
          render();
        })
        .catch(function (err) {
          state.submitting = false;
          render();
          onError(err);
        });
    }

    function renderConfirm() {
      return '' +
        '<div class="screen">' +
          '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:40px 20px 22px;">' +
            '<div style="width:52px;height:52px;border-radius:50%;background:oklch(0.93 0.05 145);display:flex;align-items:center;justify-content:center;">' + checkIcon() + '</div>' +
            '<div style="font-size:18px;font-weight:800;">Расход записан</div>' +
            '<div style="font-size:22px;font-weight:800;">' + fmtSum(state.confirm.amount) + '</div>' +
            '<div style="font-size:13px;color:oklch(0.55 0.01 250);text-align:center;">' + escapeHtml(state.confirm.category) + ' · ' + escapeHtml(state.confirm.paymentType) + '</div>' +
          '</div>' +
          '<div class="footer" style="border-top:none;"><button class="dark-btn" id="new-expense">Новый расход</button></div>' +
        '</div>';
    }

    function bindConfirm() {
      document.getElementById('new-expense').onclick = function () {
        var paymentType = state.paymentType;
        state = { categories: state.categories, categoriesError: null, paymentTypes: state.paymentTypes, paymentTypesError: null, category: null, amount: '', paymentType: paymentType, note: '', submitting: false, screen: 'form', confirm: null };
        render();
      };
    }

    function loadCategories() {
      state.categoriesError = null;
      render();
      apiGet('getExpenseCategories', {})
        .then(function (categories) { state.categories = categories; render(); })
        .catch(function (err) {
          if (isTokenAuthError(err)) { onError(err); return; }
          state.categoriesError = true;
          render();
        });
    }

    function loadPaymentTypes() {
      state.paymentTypesError = null;
      render();
      apiGet('getPaymentTypes', {})
        .then(function (types) { state.paymentTypes = types; render(); })
        .catch(function (err) {
          if (isTokenAuthError(err)) { onError(err); return; }
          state.paymentTypesError = true;
          render();
        });
    }

    function onError(err) {
      if (isTokenAuthError(err)) {
        alert('Сессия истекла — войдите заново. Введённые данные будут потеряны.');
        signOut();
        return;
      }
      alert('Ошибка: ' + (err && err.message ? err.message : err));
    }

    function escapeHtml(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
    function checkIcon() { return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="oklch(0.4 0.14 145)" stroke-width="2.4"><path d="M5 13l4 4L19 7"></path></svg>'; }

    function renderSignedOut() {
      document.getElementById('app').innerHTML = '<div class="signin-wrap"><div style="font-size:16px;font-weight:700;">Войдите, чтобы продолжить</div><div id="signin-button"></div></div>';
    }

    function onSignedIn() {
      render();
      loadCategories();
      loadPaymentTypes();
    }

    renderSignedOut();
  </script>
  <script src="https://accounts.google.com/gsi/client" async onload="initAuth(onSignedIn)"></script>
</body>
</html>
```

- [ ] **Step 2: Link it from the home screen**

In `WebFrontend/index.html`, replace:

```javascript
          '<a class="card-btn" href="inventory.html"><div style="flex:1;"><div style="font-size:16px;font-weight:700;">Инвентаризация</div>' +
          '<div style="font-size:13px;color:oklch(0.55 0.01 250);">Сверить фактические остатки</div></div></a>' +
        '</div>';
```

with:

```javascript
          '<a class="card-btn" href="inventory.html"><div style="flex:1;"><div style="font-size:16px;font-weight:700;">Инвентаризация</div>' +
          '<div style="font-size:13px;color:oklch(0.55 0.01 250);">Сверить фактические остатки</div></div></a>' +
          '<a class="card-btn" href="expense.html"><div style="flex:1;"><div style="font-size:16px;font-weight:700;">Расход</div>' +
          '<div style="font-size:13px;color:oklch(0.55 0.01 250);">Записать расход</div></div></a>' +
        '</div>';
```

- [ ] **Step 3: Manual — browser walkthrough**

Since GitHub Pages only redeploys on push to `main` (Task 6), test locally first: open `WebFrontend/expense.html` directly in a browser (or via a local static file server) with `WebFrontend/api.js`'s `API_BASE_URL` already pointing at the deployed Web App from Task 3.

1. Sign in with an allowed account. Confirm categories (11 chips) and payment types load without errors.
2. Type a multi-digit amount (e.g. `192000`) into the Сумма field, then click a category chip, then a payment-type chip — confirm the amount is **still shown** after these clicks (this is the specific bug the Global Constraints section calls out; if the amount disappears after a chip click, the `state.amount`/`value=` wiring from Step 1 is broken).
3. Type a note, leave a category and payment type unselected, and confirm the submit button stays disabled.
4. Select a category and payment type, leave amount empty, click "Записать расход" — confirm the alert "Введите сумму больше 0." appears and nothing is submitted.
5. Fill in a valid amount and submit. Confirm the confirmation screen shows the correct category, amount, and payment type, and that "Новый расход" resets the form (category/amount/note cleared) while keeping the last-used payment type selected.
6. Force a `getExpenseCategories`/`getPaymentTypes` load failure (e.g. temporarily point `API_BASE_URL` at a bad URL) and confirm the "Повторить" retry buttons appear and work once the URL is restored.

- [ ] **Step 4: Commit**

```bash
git add WebFrontend/expense.html WebFrontend/index.html
git commit -m "$(cat <<'EOF'
feat: add expense entry tool and link it from the home screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Deploy

**Files:** none (operational task)

- [ ] **Step 1: Push all Apps Script changes from the repo root**

```bash
clasp push
```

- [ ] **Step 2: Independently verify the push landed**

Repeat the Task 2 Step 4 verification pattern, checking the `ExpenseService` and `Api` file sources for `testExpenseLayerWiring`, `getExpenseCategories`, and `submitExpense`.

- [ ] **Step 3: Find the live deployment id and redeploy it**

```bash
clasp deployments
```

Find the deployment id that matches the exec URL in `WebFrontend/api.js`'s `API_BASE_URL`, then:

```bash
clasp deploy --deploymentId <that id> --description "Add expense entry tool"
```

- [ ] **Step 4: Verify the live Web App is actually running the new code**

```bash
curl -s "<API_BASE_URL from WebFrontend/api.js>?action=ping"
```

Expected: `{"pong":true}`. Then, signed in as an allowed account in a browser, call `?action=getExpenseCategories&idToken=<valid token>` against the same URL and confirm it returns the 11 categories — this proves the exec URL is serving the redeployed version, not a stale one.

- [ ] **Step 5: Push WebFrontend changes to `main`**

The existing `.github/workflows/deploy-pages.yml` workflow redeploys GitHub Pages automatically on every push to `main` that touches `WebFrontend/**` — no manual step beyond pushing the commits from Task 1–4.

```bash
git push origin main
```

- [ ] **Step 6: Confirm the GitHub Actions run succeeded**

```bash
gh run list --workflow=deploy-pages.yml --limit 1
```

Expected: the most recent run's status is `completed`/`success`. If it failed, run `gh run view <run-id> --log-failed` to see why before considering the deploy done.

---

### Task 6: Manual end-to-end QA against the spec's acceptance criteria

**Files:** none

- [ ] **Step 1: One expense per payment type**

On the deployed `expense.html`, submit one expense for each of the 7 payment types (Наличка, Paynet, Перевод на карту, Click, Payme, Личная карта, Расчётный счёт), using a distinct category and amount each time. For each, confirm in `Ответы на форму (1)` that the row's column I holds the **resolved account** (per the Global Constraints table), not the raw payment-type label the chip showed, and that `Операции` picked up a matching row. Confirm a Telegram message arrived for each.

- [ ] **Step 2: Unmapped payment type is refused server-side**

Using the browser devtools console (signed in), call `apiPost('submitExpense', { category: 'Прочее', amount: 1000, paymentType: 'НесуществующийТип', note: '' })` directly and confirm it rejects with the "не сопоставлен со счётом" error, and that no row was added to `Ответы на форму (1)`.

- [ ] **Step 3: Access control check**

Sign in with a Google account not in `ALLOWED_EMAILS` (`AppScripts/Api.gs`'s `OAUTH_CLIENT_ID` verification path) and confirm `expense.html` rejects the request the same way `sales.html`/`inventory.html` already do.

- [ ] **Step 4: Regression check on sales and inventory**

Run one normal sale through `sales.html` and one normal stocktake through `inventory.html`, confirming both still behave exactly as before this plan's changes (no shared code was modified — this is a pure addition — but worth confirming nothing about the deployment/redeploy step broke them).

- [ ] **Step 5: Record any follow-ups**

If any step surfaces a mismatch between the actual live spreadsheet and this plan's assumptions (most likely spot: the `Ответы на форму (1)` column numbers, or whether the linked spreadsheet is genuinely production rather than the "test Yonda фин учет" sandbox flagged in the design spec's open questions), fix it in place, update this plan's Global Constraints with the corrected facts, and re-run the affected steps before considering the feature done.

---

## Self-Review Notes

- **Spec coverage:** every requirement from the spec maps to a task — category list sourced live from `Справочники!G` (Task 2), payment types reused unchanged from the existing `getPaymentTypes()`/`resolveAccount()` (Task 2), column E never rendered in the UI (Task 4, and called out explicitly in Global Constraints), explicit Telegram send since `onFormSubmit` won't fire for API writes (Task 2), single-entry form UI with retry-on-load-failure (Task 4), unit tests for the pure logic (Task 1), deploy + manual QA (Tasks 5–6).
- **Placeholder scan:** no TBD/TODO; the one open question (production vs. sandbox spreadsheet) is explicitly carried into Task 6, Step 5 as something to confirm during QA, not a deferred implementation detail.
- **Type consistency:** `buildExpenseRow(category, amount, account, note)` is defined once (Task 1) and consumed identically in `submitExpense` (Task 2); `validateExpenseInput(category, amount, paymentType)`'s three parameters and return shape (`string | null`) match between Task 1's tests and Task 2's call site; `getExpenseCategories()`/`getPaymentTypes()`'s return shapes (`string[]` and `{type, account}[]`) match between Task 2/3's backend and Task 4's frontend consumption (`state.categories`, `state.paymentTypes`).

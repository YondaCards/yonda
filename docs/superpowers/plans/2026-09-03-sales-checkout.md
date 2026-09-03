# Sales Checkout ("Корзина продаж") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a mobile sales-checkout tool (`WebFrontend/sales.html`) that lets an owner/partner build a multi-item cart at exhibitions — stock items with catalog-price auto-fill and manual price override, plus free-form service positions — and submit it in one action, always writing stock off "Основной склад" regardless of the sales point/channel picked, while postcards are sold as a single aggregated position and reconciled by variety after the event through an extended "Инвентаризация" tool.

**Architecture:** Pure, Node-testable business logic (cart totals, ledger-row shaping, postcard delta classification) lives in `AppScripts/Lib/*.js`. Thin Google Apps Script wiring in `InventoryService.gs`/`Api.gs` calls that logic and appends rows to `Ответы на форму (1)` (Layer 1) — never writes `Реестр товаров` (Layer 2) or `Склад товаров` (Layer 3) directly, matching this project's established three-layer architecture. `WebFrontend/sales.html` is a new static page reusing the existing `api.js`/`auth.js`/`styles.css` pattern from `WebFrontend/inventory.html`.

**Tech Stack:** Google Apps Script (V8 runtime), Google Sheets formulas (owner-maintained `MAP`/`LAMBDA`/`SUMIFS`), static HTML/CSS/JS on GitHub Pages, Node's built-in test runner for `AppScripts/Lib/*.js`.

**Spec:** `docs/superpowers/specs/2026-08-31-inventory-and-sales-tools-design.md` (see "Инструмент 2: Корзина продаж" and "Особый случай: открытки")

## Global Constraints

- `Ответы на форму (1)` is addressed via the existing global `SHEET_FORM` constant, declared in `AppScripts/Уведомления через ТГ-бот.js:4` — never redeclare it (Apps Script concatenates every project file into one shared global scope).
- Confirmed live column layout of `Ответы на форму (1)` (1-based): B=2 `Тип записи`, T=20 `Вид действия`, Y=25 `Товар`, Z=26 `Количество`, AA=27 `Откуда`, AB=28 `Куда`; K=11 `Сумма`, L=12 `Тип оплаты`, M=13 `Категория`, N=14 `Описание` (Доход branch).
- `Тип записи` for any goods-movement row (existing "Инвентаризация", and this plan's new "Продажа") must be exactly `"Учет товаров"` — no `ё` — matching `Реестр товаров`'s `FILTER` formula and every existing write path.
- `Реестр товаров`'s (Layer 2) `MAP`/`LAMBDA` formulas are edited **only by the repo owner, by hand, in the Google Sheets UI** — never by Apps Script. This has broken live formulas twice already in this project.
- `AppScripts/Lib/InventoryLogic.js`'s existing exports (`computeDelta`, `buildGoodsLedgerRow`, `buildMaterialLedgerRow`) and their existing tests must keep passing unmodified in their 3-argument call form — only additive, backward-compatible changes.
- `clasp push` has previously reported success without the content reaching the server in this project — every push must be independently verified via the Apps Script API content endpoint before being trusted.
- `clasp push` alone does **not** update the already-published, version-pinned Web App deployment that `WebFrontend/api.js`'s `API_BASE_URL` calls — a real redeploy needs `clasp deploy --deploymentId <id>`.
- Stock write-off for every sale always targets `"Основной склад"`, regardless of the sales point/channel chosen at checkout — the point/channel is only an attribute of the "Операции" income row and the Telegram message.
- The one "Доход" row and the N "Продажа" goods-movement rows written per sale carry **no shared reference to each other** (no common order id) — confirmed by the owner as the intended design, not an oversight to fix.
- A cashier can correct a cart's final total in one number at checkout (a whole-order discount) without redistributing it across lines — `buildOperationsRow`/`buildTelegramSaleMessage`'s `totalOverride` parameter and `sales.html`'s "Итого" field. This is separate from, and composes with, editing a single line's own total.
- The "номер заказа" the owner expects on the Доход row is presumed to be the existing `ID` column already on `Операции` (parallel to `Реестр товаров`'s own `# ID`), populated by that sheet's own formula, not written by this plan's code — confirm this against the live sheet in Task 13, Step 1, and correct this assumption here if it's wrong.
- Payment types are the four account names already used system-wide (`Наличка`, `Paynet`, `Карта (личная)`, `Расчётный счёт ИП`, see `accountIcons` in `AppScripts/Уведомления через ТГ-бот.js`) — no separate payment→account mapping table.
- `.clasp.json` lives at the repo root (`Yonda/`) — `clasp push`/`clasp deploy` run from there, not from `AppScripts/`.

---

### Task 1: Postcard delta classification + explicit ledger type (pure logic)

**Files:**
- Modify: `AppScripts/Lib/InventoryLogic.js`
- Modify: `AppScripts/Lib/InventoryLogic.test.js`

**Interfaces:**
- Produces: `buildGoodsLedgerRow(delta, location, dateStr, type)` — `type` is a new **optional** 4th parameter; omitting it keeps today's exact behavior (`type: 'Инвентаризация'`, note `'Инвентаризация от ' + dateStr'`).
- Produces: `classifyGoodsDelta(delta, isPostcardVariety, isSaleReconciliation)` → `{ type: 'Инвентаризация' | 'Продажа', mirrorToAggregate: boolean }`.

- [ ] **Step 1: Write the failing tests for `buildGoodsLedgerRow`'s new `type` parameter**

Add to `AppScripts/Lib/InventoryLogic.test.js` (after the existing `buildGoodsLedgerRow` tests):

```javascript
test('buildGoodsLedgerRow: still defaults to Инвентаризация when no type given (back-compat)', () => {
  const row = buildGoodsLedgerRow(5, 'Основной склад', '01.09.2026');
  assert.equal(row.type, 'Инвентаризация');
  assert.equal(row.note, 'Инвентаризация от 01.09.2026');
});

test('buildGoodsLedgerRow: explicit Продажа type changes the note wording', () => {
  const row = buildGoodsLedgerRow(-4, 'Основной склад', '01.09.2026', 'Продажа');
  assert.deepEqual(row, { type: 'Продажа', from: 'Основной склад', to: '', quantity: 4, note: 'Сверка продаж от 01.09.2026' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `row.type` is `'Инвентаризация'` in both cases (the parameter doesn't exist yet), and the second test's `note` doesn't match.

- [ ] **Step 3: Implement the `type` parameter**

In `AppScripts/Lib/InventoryLogic.js`, replace:

```javascript
function buildGoodsLedgerRow(delta, location, dateStr) {
  return {
    type: 'Инвентаризация',
    from: delta < 0 ? location : '',
    to: delta > 0 ? location : '',
    quantity: Math.abs(delta),
    note: 'Инвентаризация от ' + dateStr,
  };
}
```

with:

```javascript
function buildGoodsLedgerRow(delta, location, dateStr, type) {
  const resolvedType = type || 'Инвентаризация';
  return {
    type: resolvedType,
    from: delta < 0 ? location : '',
    to: delta > 0 ? location : '',
    quantity: Math.abs(delta),
    note: (resolvedType === 'Продажа' ? 'Сверка продаж от ' : 'Инвентаризация от ') + dateStr,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, including every pre-existing `buildGoodsLedgerRow` test.

- [ ] **Step 5: Write the failing tests for `classifyGoodsDelta`**

Append to `AppScripts/Lib/InventoryLogic.test.js`:

```javascript
test('classifyGoodsDelta: positive delta on a postcard variety mirrors to the aggregate', () => {
  assert.deepEqual(classifyGoodsDelta(6, true, false), { type: 'Инвентаризация', mirrorToAggregate: true });
});

test('classifyGoodsDelta: positive delta on a regular product never mirrors', () => {
  assert.deepEqual(classifyGoodsDelta(6, false, true), { type: 'Инвентаризация', mirrorToAggregate: false });
});

test('classifyGoodsDelta: negative delta + reconciliation ON is a sale, no mirror (already deducted live at checkout)', () => {
  assert.deepEqual(classifyGoodsDelta(-3, true, true), { type: 'Продажа', mirrorToAggregate: false });
});

test('classifyGoodsDelta: negative delta + reconciliation OFF is a loss that still mirrors', () => {
  assert.deepEqual(classifyGoodsDelta(-3, true, false), { type: 'Инвентаризация', mirrorToAggregate: true });
});

test('classifyGoodsDelta: negative delta on a regular product is unaffected by the toggle', () => {
  assert.deepEqual(classifyGoodsDelta(-3, false, true), { type: 'Инвентаризация', mirrorToAggregate: false });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `classifyGoodsDelta is not defined`.

- [ ] **Step 7: Implement `classifyGoodsDelta` and export it**

In `AppScripts/Lib/InventoryLogic.js`, add the function and extend the export:

```javascript
function classifyGoodsDelta(delta, isPostcardVariety, isSaleReconciliation) {
  if (delta > 0) {
    return { type: 'Инвентаризация', mirrorToAggregate: !!isPostcardVariety };
  }
  if (isPostcardVariety && isSaleReconciliation) {
    return { type: 'Продажа', mirrorToAggregate: false };
  }
  return { type: 'Инвентаризация', mirrorToAggregate: !!isPostcardVariety };
}
```

Change the export line at the bottom of the file to:

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeDelta, buildMaterialLedgerRow, buildGoodsLedgerRow, classifyGoodsDelta };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `InventoryLogic.test.js` tests green.

- [ ] **Step 9: Commit**

```bash
git add AppScripts/Lib/InventoryLogic.js AppScripts/Lib/InventoryLogic.test.js
git commit -m "feat: add classifyGoodsDelta and an explicit ledger type for postcard sale reconciliation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Cart pure logic (`SalesLogic.js`)

**Files:**
- Create: `AppScripts/Lib/SalesLogic.js`
- Create: `AppScripts/Lib/SalesLogic.test.js`

**Interfaces:**
- Produces: `computeCartTotal(items)`, `buildSaleGoodsRows(items)`, `buildOperationsRow(items, paymentType, totalOverride)`, `buildTelegramSaleMessage(items, point, paymentType, fmt, totalOverride)`.
- Cart item shape consumed throughout: `{ name: string, qty: number, price: number, isCustom: boolean }`.
- `totalOverride` (both functions, optional — pass `null`/`undefined` when absent): the cashier can correct the whole cart's final total in one number (a round-number discount, decided per order) without touching any line's own price. Per-line prices, `buildSaleGoodsRows`'s quantities, and the audit note's per-line breakdown are **never** redistributed to match it — only `amount`/`Итого` changes, and the note gets one explanatory clause appended so it doesn't silently stop adding up to its own header. Income and goods write-off rows carry no shared id linking them (see Global Constraints) — this is the only place the "final charged total differs from the line subtotal" fact is recorded at all.

- [ ] **Step 1: Write the failing tests**

Create `AppScripts/Lib/SalesLogic.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeCartTotal, buildSaleGoodsRows, buildOperationsRow, buildTelegramSaleMessage } = require('./SalesLogic.js');

test('computeCartTotal sums price × qty across all items', () => {
  assert.equal(computeCartTotal([{ price: 15000, qty: 2 }, { price: 5000, qty: 1 }]), 35000);
});

test('computeCartTotal returns 0 for an empty cart', () => {
  assert.equal(computeCartTotal([]), 0);
});

test('buildSaleGoodsRows keeps only stock items, drops free-form services', () => {
  const rows = buildSaleGoodsRows([
    { name: 'Открытка', qty: 3, price: 15000, isCustom: false },
    { name: 'Гравировка на заказ', qty: 1, price: 20000, isCustom: true },
  ]);
  assert.deepEqual(rows, [{ name: 'Открытка', quantity: 3 }]);
});

test('buildOperationsRow uses the payment type directly as the account name', () => {
  const row = buildOperationsRow([{ name: 'Открытка', qty: 2, price: 15000 }], 'Карта (личная)');
  assert.deepEqual(row, {
    type: 'Доход',
    amount: 30000,
    account: 'Карта (личная)',
    category: 'Продажа товаров',
    note: 'Открытка x2 = 30000',
  });
});

test('buildOperationsRow lists every item, including services, with qty × price in the note', () => {
  const row = buildOperationsRow([
    { name: 'Открытка', qty: 2, price: 15000 },
    { name: 'Гравировка на заказ', qty: 1, price: 20000, isCustom: true },
  ], 'Наличка');
  assert.equal(row.note, 'Открытка x2 = 30000, Гравировка на заказ x1 = 20000');
  assert.equal(row.amount, 50000);
});

test('buildOperationsRow reflects a manually overridden line price in both the note and the total', () => {
  const row = buildOperationsRow([{ name: 'Открытка', qty: 2, price: 20000 }], 'Наличка'); // catalog price is 15000, cashier overrode this line's total to 40000 (20000/unit)
  assert.equal(row.note, 'Открытка x2 = 40000');
  assert.equal(row.amount, 40000);
});

test('buildOperationsRow: whole-cart totalOverride replaces amount without touching any line', () => {
  const items = [
    { name: 'Открытка', qty: 5, price: 25000 },       // 125000
    { name: 'Фотоальбом «Мгновения»', qty: 1, price: 75000 }, // 75000
    { name: 'Гравировка на заказ', qty: 1, price: 125000, isCustom: true }, // 125000
  ]; // subtotal 325000, cashier corrects it to 300000 for the whole order
  const row = buildOperationsRow(items, 'Наличка', 300000);
  assert.equal(row.amount, 300000);
  assert.equal(row.note, 'Открытка x5 = 125000, Фотоальбом «Мгновения» x1 = 75000, Гравировка на заказ x1 = 125000, Итого по позициям: 325000, к оплате: 300000');
});

test('buildOperationsRow: totalOverride equal to the subtotal is treated as no override', () => {
  const row = buildOperationsRow([{ name: 'Открытка', qty: 2, price: 15000 }], 'Наличка', 30000);
  assert.equal(row.amount, 30000);
  assert.equal(row.note, 'Открытка x2 = 30000');
});

test('buildTelegramSaleMessage lists every item with its line total, point, payment and grand total', () => {
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU') + ' сум';
  const msg = buildTelegramSaleMessage(
    [{ name: 'Открытка', qty: 2, price: 15000 }],
    'Маркеты',
    'Наличка',
    fmt
  );
  assert.match(msg, /Открытка × 2 — 30 000 сум/);
  assert.match(msg, /Точка: Маркеты/);
  assert.match(msg, /Оплата: Наличка/);
  assert.match(msg, /Итого: 30 000 сум/);
});

test('buildTelegramSaleMessage shows the corrected total when the whole cart was overridden', () => {
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU') + ' сум';
  const msg = buildTelegramSaleMessage(
    [{ name: 'Открытка', qty: 2, price: 15000 }],
    'Маркеты',
    'Наличка',
    fmt,
    25000
  );
  assert.match(msg, /Итого: 25 000 сум/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './SalesLogic.js'`.

- [ ] **Step 3: Implement `SalesLogic.js`**

Create `AppScripts/Lib/SalesLogic.js`:

```javascript
function computeCartTotal(items) {
  return (items || []).reduce(function (sum, item) {
    return sum + Number(item.price) * Number(item.qty);
  }, 0);
}

function buildSaleGoodsRows(items) {
  return (items || [])
    .filter(function (item) { return !item.isCustom; })
    .map(function (item) {
      return { name: item.name, quantity: Number(item.qty) };
    });
}

function buildOperationsRow(items, paymentType, totalOverride) {
  // Neither "Реестр товаров" (quantity-only, no price column) nor this row's
  // own Сумма (one grand total for the whole cart) preserve what a specific
  // line actually sold for. The note spells out qty × price per line — the
  // only place a per-line price override survives.
  //
  // totalOverride lets the cashier correct the whole order's final total
  // (e.g. a round-number discount) without redistributing it back across
  // lines — deliberately: proportionally rescaling every line raises more
  // questions (does it touch services too? how does it round?) than it's
  // worth when the goods-movement rows only ever cared about quantity
  // anyway. When it's used, the note gets one appended clause so it still
  // explains itself instead of silently disagreeing with its own header.
  const subtotal = computeCartTotal(items);
  const hasOverride = totalOverride !== null && totalOverride !== undefined && totalOverride !== subtotal;
  const lines = (items || []).map(function (item) {
    return item.name + ' x' + item.qty + ' = ' + (Number(item.price) * Number(item.qty));
  });
  if (hasOverride) {
    lines.push('Итого по позициям: ' + subtotal + ', к оплате: ' + totalOverride);
  }
  return {
    type: 'Доход',
    amount: hasOverride ? totalOverride : subtotal,
    account: paymentType,
    category: 'Продажа товаров',
    note: lines.join(', '),
  };
}

function buildTelegramSaleMessage(items, point, paymentType, fmt, totalOverride) {
  const subtotal = computeCartTotal(items);
  const hasOverride = totalOverride !== null && totalOverride !== undefined && totalOverride !== subtotal;
  const lines = (items || []).map(function (item) {
    return '• ' + item.name + ' × ' + item.qty + ' — ' + fmt(Number(item.price) * Number(item.qty));
  });
  return '🛍 <b>Продажа</b>\n' + lines.join('\n') + '\n' +
    'Точка: ' + point + '\n' +
    'Оплата: ' + paymentType + '\n' +
    'Итого: ' + fmt(hasOverride ? totalOverride : subtotal);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeCartTotal, buildSaleGoodsRows, buildOperationsRow, buildTelegramSaleMessage };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `SalesLogic.test.js` tests green, and the full suite (`InventoryLogic.test.js` + `SalesLogic.test.js`) still passes.

- [ ] **Step 5: Commit**

```bash
git add AppScripts/Lib/SalesLogic.js AppScripts/Lib/SalesLogic.test.js
git commit -m "feat: add pure cart logic for the sales checkout tool

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire a "Продажа" goods-movement row into Layer 1 → Layer 2

This is the highest-risk task: it touches the shared write path used by the existing, working "Инвентаризация" tool, and requires a hand-edit to owner-maintained spreadsheet formulas. Do not skip the verification steps.

**Files:**
- Modify: `AppScripts/InventoryService.gs`

**Interfaces:**
- Produces: `appendGoodsRow_(ss, name, quantity, vidDeistviya, from, to)` — file-scope (was a closure-local function inside `submitProductsInventory_` taking 4 params with `'Инвентаризация'` hardcoded; now file-scope, taking `vidDeistviya` explicitly so both Инвентаризация and the new sales tool can share it).
- Consumes: the global `SHEET_FORM` constant (`AppScripts/Уведомления через ТГ-бот.js:4`).

- [ ] **Step 1: Hoist `appendGoodsRow` out of `submitProductsInventory_` and parametrize the action**

In `AppScripts/InventoryService.gs`, find:

```javascript
function submitProductsInventory_(ss, location, counts, newItems, dateStr) {
  const stockSheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const byName = {};
  getProductsSnapshot(location).forEach((it) => { byName[it.name] = it; });

  let written = 0;

  function appendGoodsRow(name, quantity, from, to) {
    const formSheet = ss.getSheetByName(SHEET_FORM);
    const FORM_COL_TIP_ZAPISI = 2;                  // B: Тип записи
    const FORM_COL_VID_DEISTVIYA = 20;              // T: Вид действия
    const FORM_COL_TOVAR_PEREMESCHENIE = 25;        // Y: Товар (перемещение)
    const FORM_COL_KOLICHESTVO_PEREMESCHENIE = 26;  // Z: Количество (перемещение)
    const FORM_COL_OTKUDA = 27;                     // AA: Откуда
    const FORM_COL_KUDA = 28;                       // AB: Куда

    const row = [];
    row[0] = new Date(); // A: Отметка времени
    row[FORM_COL_TIP_ZAPISI - 1] = 'Учет товаров';
    row[FORM_COL_VID_DEISTVIYA - 1] = 'Инвентаризация';
    row[FORM_COL_TOVAR_PEREMESCHENIE - 1] = name;
    row[FORM_COL_KOLICHESTVO_PEREMESCHENIE - 1] = quantity;
    row[FORM_COL_OTKUDA - 1] = from;
    row[FORM_COL_KUDA - 1] = to;
    formSheet.appendRow(row);
  }
```

Replace it with (note `appendGoodsRow_` moves out of the function entirely — put it above `submitProductsInventory_` in the same file):

```javascript
const FORM_COL_TIP_ZAPISI = 2;                  // B: Тип записи
const FORM_COL_VID_DEISTVIYA = 20;              // T: Вид действия
const FORM_COL_TOVAR_PEREMESCHENIE = 25;        // Y: Товар (перемещение)
const FORM_COL_KOLICHESTVO_PEREMESCHENIE = 26;  // Z: Количество (перемещение)
const FORM_COL_OTKUDA = 27;                     // AA: Откуда
const FORM_COL_KUDA = 28;                       // AB: Куда

function appendGoodsRow_(ss, name, quantity, vidDeistviya, from, to) {
  const formSheet = ss.getSheetByName(SHEET_FORM);
  const row = [];
  row[0] = new Date(); // A: Отметка времени
  row[FORM_COL_TIP_ZAPISI - 1] = 'Учет товаров';
  row[FORM_COL_VID_DEISTVIYA - 1] = vidDeistviya;
  row[FORM_COL_TOVAR_PEREMESCHENIE - 1] = name;
  row[FORM_COL_KOLICHESTVO_PEREMESCHENIE - 1] = quantity;
  row[FORM_COL_OTKUDA - 1] = from;
  row[FORM_COL_KUDA - 1] = to;
  formSheet.appendRow(row);
}

function submitProductsInventory_(ss, location, counts, newItems, dateStr) {
  const stockSheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const byName = {};
  getProductsSnapshot(location).forEach((it) => { byName[it.name] = it; });

  let written = 0;
```

- [ ] **Step 2: Update both call sites inside `submitProductsInventory_` to the new signature**

Change:

```javascript
    const row = buildGoodsLedgerRow(delta, location, dateStr);
    appendGoodsRow(c.name, row.quantity, row.from, row.to);
    written++;
```

to:

```javascript
    const row = buildGoodsLedgerRow(delta, location, dateStr);
    appendGoodsRow_(ss, c.name, row.quantity, 'Инвентаризация', row.from, row.to);
    written++;
```

This appears twice in `submitProductsInventory_` (once in the `(counts || []).forEach(...)` block, once in the `(newItems || []).forEach(...)` block for existing items). Update both. The third call site, inside the "brand-new product" branch of `(newItems || []).forEach(...)`, also changes from `appendGoodsRow(name, row.quantity, row.from, row.to)` to `appendGoodsRow_(ss, name, row.quantity, 'Инвентаризация', row.from, row.to)`.

- [ ] **Step 3: Add a temporary diagnostic function to exercise the new "Продажа" action end to end**

Append to `AppScripts/InventoryService.gs`:

```javascript
// Temporary — run once by hand from the Apps Script editor to verify Layer 2
// recognizes "Продажа" the same way it already recognizes "Инвентаризация".
// Delete the synthetic row from "Ответы на форму (1)" (and, if it appears,
// from "Реестр товаров") after verifying. Safe to leave the function itself
// in the codebase as a reusable diagnostic.
function testProdazhaLayer2Wiring_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  appendGoodsRow_(ss, 'ТЕСТ Реестр Продажа', 1, 'Продажа', 'Основной склад', '');
  Logger.log('Синтетическая строка записана в "Ответы на форму (1)". Откройте "Реестр товаров": должна появиться строка с Тип="Продажа", Товар="ТЕСТ Реестр Продажа", Откуда="Основной склад", Количество=1. Если строка не появилась или Тип пуст/неверен, расширьте формулу Тип по образцу ветки "Инвентаризация".');
}
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
  const f = json.files.find(x => x.name === 'InventoryService');
  console.log(f.source.includes('testProdazhaLayer2Wiring_') ? 'OK: new code present' : 'MISSING: push did not land');
});
"
```

Expected: `OK: new code present`. If it prints `MISSING`, re-push with `clasp push -f` and re-verify before continuing.

- [ ] **Step 5: Manual — run the diagnostic and extend the owner-maintained Layer 2 formula**

In the Apps Script editor, run `testProdazhaLayer2Wiring_` once (owner/authorized account). Then, in the spreadsheet:

1. Open `Ответы на форму (1)` and confirm a new row landed with `Тип записи = "Учет товаров"` (column B) and `Вид действия = "Продажа"` (column T).
2. Open `Реестр товаров` and check whether a corresponding row appeared with `Тип = "Продажа"`, `Товар = "ТЕСТ Реестр Продажа"`, `Откуда = "Основной склад"`, `Количество = 1`.
3. If it did **not** appear (or `Тип` is blank for that row): open the `Тип` column's `MAP`/`LAMBDA` formula in `Реестр товаров`, find the `IFS` (or equivalent) branch that currently maps `Вид действия = "Инвентаризация"` → `"Инвентаризация"`, and add one more branch mapping `Вид действия = "Продажа"` → `"Продажа"` — same shape, same place, right next to the existing branch. Do this **by hand in the Sheets UI**; do not attempt it from Apps Script (see Global Constraints).
4. Re-run `testProdazhaLayer2Wiring_` (or just wait — Layer 2 recalculates automatically) and re-check `Реестр товаров` until the row appears correctly typed.
5. Delete the synthetic `"ТЕСТ Реестр Продажа"` row from `Ответы на форму (1)` once confirmed (Layer 2/3 will recalculate the removal automatically).

- [ ] **Step 6: Commit**

```bash
git add AppScripts/InventoryService.gs
git commit -m "feat: generalize appendGoodsRow to support a Продажа goods-movement action

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Sales catalog + `submitSale` (Apps Script)

**Files:**
- Modify: `AppScripts/InventoryService.gs`

**Interfaces:**
- Consumes: `buildSaleGoodsRows`, `buildOperationsRow`, `buildTelegramSaleMessage` from `AppScripts/Lib/SalesLogic.js` (Apps Script concatenates every project file into one scope — no `require` needed, call the globals directly, same as `computeDelta` is already called directly elsewhere in this file).
- Consumes: the global `fmt` function (`AppScripts/Уведомления через ТГ-бот.js`) and the global `sendTelegram` function (same file).
- Consumes: `appendGoodsRow_` from Task 3.
- Produces: `getSalesCatalog()` → array of `{ name, current, price }`; `submitSale(items, point, paymentType, totalOverride)` → `{ written, total }`. `totalOverride` is `null`/absent for a normal sale, or the cashier-corrected whole-cart total — forwarded straight to `buildOperationsRow`/`buildTelegramSaleMessage` untouched, never redistributed across `items`.
- Consumes (forward reference, filled in by Task 6): the constant `POSTCARD_VARIETY_NAMES` — until Task 6 adds it, declare a temporary empty array here so this task's code compiles and is independently testable; Task 6 replaces it with the real list.

- [ ] **Step 1: Add `getSalesCatalog`, `submitSale`, and the income-row writer**

Append to `AppScripts/InventoryService.gs`:

```javascript
const POSTCARD_VARIETY_NAMES = []; // filled in by Task 6 with the real list of postcard variety names

const FORM_COL_SUMMA_DOHOD = 11;       // K: Сумма дохода
const FORM_COL_TIP_OPLATY_DOHOD = 12;  // L: Тип оплаты
const FORM_COL_KATEGORIYA_DOHOD = 13;  // M: Категория
const FORM_COL_OPISANIE_DOHOD = 14;    // N: Описание

function appendIncomeRow_(ss, amount, account, category, note) {
  const formSheet = ss.getSheetByName(SHEET_FORM);
  const row = [];
  row[0] = new Date();
  row[FORM_COL_TIP_ZAPISI - 1] = 'Доход';
  row[FORM_COL_SUMMA_DOHOD - 1] = amount;
  row[FORM_COL_TIP_OPLATY_DOHOD - 1] = account;
  row[FORM_COL_KATEGORIYA_DOHOD - 1] = category;
  row[FORM_COL_OPISANIE_DOHOD - 1] = note;
  formSheet.appendRow(row);
}

function getSalesCatalog() {
  return getProductsSnapshot('Основной склад').filter(function (item) {
    return POSTCARD_VARIETY_NAMES.indexOf(item.name) === -1;
  });
}

function submitSale(items, point, paymentType, totalOverride) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const stockRows = buildSaleGoodsRows(items);
  stockRows.forEach(function (row) {
    appendGoodsRow_(ss, row.name, row.quantity, 'Продажа', 'Основной склад', '');
  });

  const opRow = buildOperationsRow(items, paymentType, totalOverride);
  appendIncomeRow_(ss, opRow.amount, opRow.account, opRow.category, opRow.note);

  sendTelegram(buildTelegramSaleMessage(items, point, paymentType, fmt, totalOverride));

  return { written: stockRows.length, total: opRow.amount };
}
```

Note: `getProductsSnapshot` currently returns `{ name, current }` (no `price`) — the price comes from `getPriceByProduct`, already defined globally in `AppScripts/Уведомления через ТГ-бот.js`. Update `getSalesCatalog` to include it:

```javascript
function getSalesCatalog() {
  return getProductsSnapshot('Основной склад')
    .filter(function (item) { return POSTCARD_VARIETY_NAMES.indexOf(item.name) === -1; })
    .map(function (item) {
      return { name: item.name, current: item.current, price: getPriceByProduct(item.name) };
    });
}
```

- [ ] **Step 2: Push and verify**

```bash
clasp push
```

Verify via the Apps Script API content endpoint exactly as in Task 3, Step 4, this time checking for `'getSalesCatalog'` in the `InventoryService` file source.

- [ ] **Step 3: Manual smoke test from the Apps Script editor**

Run `getSalesCatalog()` from the Apps Script editor's function picker, view the execution log, and confirm it returns an array of `{ name, current, price }` objects with sensible prices (non-zero for items present in "Справочник цен"). Do not call `submitSale` yet — it requires `Api.gs` wiring (Task 7) and real cart data; it is exercised end-to-end in Task 13.

- [ ] **Step 4: Commit**

```bash
git add AppScripts/InventoryService.gs
git commit -m "feat: add getSalesCatalog and submitSale to the Apps Script backend

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Manual — add the "Открытка" aggregate and collect variety names

No code in this task — it unblocks Task 6, which needs a real `POSTCARD_VARIETY_NAMES` list and a working aggregate row to mirror into.

- [ ] **Step 1: Add "Открытка" to "Справочник цен"**

Owner adds one new row to `Справочник цен` (inside `Справочники`): name `Открытка`, price = the standard postcard price (same for every variety).

- [ ] **Step 2: Add "Открытка" as a new product in "Склад товаров"**

Owner opens the existing "Инвентаризация" tool (`WebFrontend/inventory.html`), picks Товары → Основной склад, uses the "Добавить позицию" control to add a new item named exactly `Открытка` with a fact quantity equal to the current physical total across every postcard variety combined. This reuses the tool's existing new-item code path (`submitProductsInventory_`'s `newItems` branch), which already copies the остаток formula from another product row — no new mechanism needed.

- [ ] **Step 3: Collect the exact list of postcard variety names**

Owner reads the exact product names of every postcard variety as they appear in `Справочник цен` column A (e.g. the literal strings used there, not a paraphrase) and hands them to whoever does Task 6.

- [ ] **Step 4: Confirm**

Owner confirms in `Склад товаров` that the new `Открытка` row shows a остаток formula consistent with the other product rows (same formula shape, just a different `$A2` reference) before Task 6 starts relying on it.

---

### Task 6: Postcard reconciliation in `submitProductsInventory_`

**Files:**
- Modify: `AppScripts/InventoryService.gs`

**Interfaces:**
- Consumes: `classifyGoodsDelta` from `AppScripts/Lib/InventoryLogic.js` (Task 1).
- Modifies: `submitProductsInventory_(ss, location, counts, newItems, dateStr)` gains a 6th parameter `isSaleReconciliation`.
- Modifies: `submitInventory(kind, location, counts, newItems)` gains a 5th parameter `isSaleReconciliation`, passed through to `submitProductsInventory_`.

- [ ] **Step 1: Fill in the real `POSTCARD_VARIETY_NAMES` list from Task 5**

In `AppScripts/InventoryService.gs`, replace the placeholder from Task 4:

```javascript
const POSTCARD_VARIETY_NAMES = []; // filled in by Task 6 with the real list of postcard variety names
```

with the real list gathered in Task 5, for example (replace with the actual names supplied by the owner):

```javascript
const POSTCARD_VARIETY_NAMES = ['О маме', 'Про любовь', 'С днём рождения', 'Спасибо'];
const POSTCARD_AGGREGATE_NAME = 'Открытка';
```

- [ ] **Step 2: Update `submitInventory` to accept and forward the toggle**

Change:

```javascript
function submitInventory(kind, location, counts, newItems) {
  const dateStr = Utilities.formatDate(new Date(), 'Asia/Tashkent', 'dd.MM.yyyy');
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (kind === 'materials') return submitMaterialsInventory_(ss, counts, newItems, dateStr);
  if (kind === 'products') return submitProductsInventory_(ss, location, counts, newItems, dateStr);
  throw new Error('Неизвестный тип инвентаризации: ' + kind);
}
```

to:

```javascript
function submitInventory(kind, location, counts, newItems, isSaleReconciliation) {
  const dateStr = Utilities.formatDate(new Date(), 'Asia/Tashkent', 'dd.MM.yyyy');
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (kind === 'materials') return submitMaterialsInventory_(ss, counts, newItems, dateStr);
  if (kind === 'products') return submitProductsInventory_(ss, location, counts, newItems, dateStr, isSaleReconciliation);
  throw new Error('Неизвестный тип инвентаризации: ' + kind);
}
```

- [ ] **Step 3: Apply `classifyGoodsDelta` inside `submitProductsInventory_`'s counted-items loop**

Change:

```javascript
function submitProductsInventory_(ss, location, counts, newItems, dateStr) {
  const stockSheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const byName = {};
  getProductsSnapshot(location).forEach((it) => { byName[it.name] = it; });

  let written = 0;

  (counts || []).forEach((c) => {
    const item = byName[c.name];
    if (!item) return; // stale client-side data; skip rather than guess
    const delta = computeDelta(item.current, c.fact);
    if (delta === null) return;
    const row = buildGoodsLedgerRow(delta, location, dateStr);
    appendGoodsRow_(ss, c.name, row.quantity, 'Инвентаризация', row.from, row.to);
    written++;
  });
```

to:

```javascript
function submitProductsInventory_(ss, location, counts, newItems, dateStr, isSaleReconciliation) {
  const stockSheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const byName = {};
  getProductsSnapshot(location).forEach((it) => { byName[it.name] = it; });

  let written = 0;

  (counts || []).forEach((c) => {
    const item = byName[c.name];
    if (!item) return; // stale client-side data; skip rather than guess
    const delta = computeDelta(item.current, c.fact);
    if (delta === null) return;
    const isPostcard = POSTCARD_VARIETY_NAMES.indexOf(c.name) !== -1;
    const classification = classifyGoodsDelta(delta, isPostcard, !!isSaleReconciliation);
    const row = buildGoodsLedgerRow(delta, location, dateStr, classification.type);
    appendGoodsRow_(ss, c.name, row.quantity, classification.type, row.from, row.to);
    if (classification.mirrorToAggregate) {
      appendGoodsRow_(ss, POSTCARD_AGGREGATE_NAME, row.quantity, 'Инвентаризация', row.from, row.to);
    }
    written++;
  });
```

The `(newItems || []).forEach(...)` block is unchanged — brand-new products (including a brand-new postcard variety nobody has seen before) are out of scope for the reconciliation toggle; they go through the existing "add new product" path exactly as today.

- [ ] **Step 4: Push and verify**

```bash
clasp push
```

Verify via the Apps Script API content endpoint (Task 3, Step 4 pattern), checking for `'POSTCARD_AGGREGATE_NAME'` in the `InventoryService` source.

- [ ] **Step 5: Manual test — exercise all three postcard branches**

From the Apps Script editor, temporarily call `submitInventory('products', 'Основной склад', [{ name: '<a real postcard variety from POSTCARD_VARIETY_NAMES>', fact: '<current + 5>' }], [], false)` and confirm in `Ответы на форму (1)` that **two** rows landed: one `Вид действия="Инвентаризация"` for the specific variety, one `Вид действия="Инвентаризация"` for `Открытка`, both with quantity 5 and `Куда="Основной склад"`.

Then call it again with `fact` set to `<current − 5>` and `isSaleReconciliation = true` (5th argument `true`): confirm exactly **one** row landed, `Вид действия="Продажа"`, `Товар=<the variety>`, `Откуда="Основной склад"` — no mirrored `Открытка` row.

Then repeat the decrease with `isSaleReconciliation = false`: confirm **two** rows landed, both `Вид действия="Инвентаризация"` (one for the variety, one mirrored to `Открытка`), both `Откуда="Основной склад"`.

Delete the synthetic test rows from `Ответы на форму (1)` afterward.

- [ ] **Step 6: Commit**

```bash
git add AppScripts/InventoryService.gs
git commit -m "feat: reconcile postcard varieties against the Открытка aggregate after an exhibition

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Wire the new actions into `Api.gs`

**Files:**
- Modify: `AppScripts/Api.gs`

**Interfaces:**
- Adds GET action `getSalesCatalog`; POST action `submitSale` (forwarding `body.totalOverride`); extends the existing `submitInventory` POST action to pass `isSaleReconciliation` through; filters the `getProductsSnapshot` GET action to hide the postcard aggregate from the counting screen.

- [ ] **Step 1: Add the new GET actions and filter the existing one**

In `AppScripts/Api.gs`, change:

```javascript
    if (action === 'getProductsSnapshot') {
      return jsonResponse_(getProductsSnapshot(e.parameter.location));
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + action });
```

to:

```javascript
    if (action === 'getProductsSnapshot') {
      return jsonResponse_(getProductsSnapshot(e.parameter.location).filter(function (item) {
        return item.name !== POSTCARD_AGGREGATE_NAME;
      }));
    }
    if (action === 'getSalesCatalog') {
      return jsonResponse_(getSalesCatalog());
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + action });
```

- [ ] **Step 2: Add the `submitSale` POST action and forward `isSaleReconciliation`**

Change:

```javascript
    if (body.action === 'submitInventory') {
      return jsonResponse_(submitInventory(body.kind, body.location, body.counts, body.newItems));
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + body.action });
```

to:

```javascript
    if (body.action === 'submitInventory') {
      return jsonResponse_(submitInventory(body.kind, body.location, body.counts, body.newItems, body.isSaleReconciliation));
    }
    if (body.action === 'submitSale') {
      return jsonResponse_(submitSale(body.items, body.point, body.paymentType, body.totalOverride));
    }
    return jsonResponse_({ error: 'Неизвестное действие: ' + body.action });
```

- [ ] **Step 3: Push and verify**

```bash
clasp push
```

Verify via the Apps Script API content endpoint (Task 3, Step 4 pattern), checking for `'submitSale'` in the `Api` file source.

- [ ] **Step 4: Manual smoke test via `ping` + a real GET call**

From a terminal (replace `<EXEC_URL>` with the current deployment's exec URL from `WebFrontend/api.js`'s `API_BASE_URL`, and note this hits the currently-deployed **version**, not necessarily today's push — full verification happens after Task 12's redeploy):

```bash
curl -s "<EXEC_URL>?action=ping"
```

Expected: `{"pong":true}` — confirms the deployment responds at all before deeper testing in Task 13.

- [ ] **Step 5: Commit**

```bash
git add AppScripts/Api.gs
git commit -m "feat: expose getSalesCatalog/submitSale and hide the postcard aggregate from stocktakes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Sales-tool CSS additions

**Files:**
- Modify: `WebFrontend/styles.css`

- [ ] **Step 1: Add the new classes**

Append to `WebFrontend/styles.css`:

```css
.cart-pick { text-align: left; border: none; background: transparent; width: 100%; }
.price-btn { border: none; background: transparent; padding: 0; font-size: 12.5px; color: oklch(0.55 0.01 250); font-weight: 600; }
.badge-service { display: inline-block; padding: 1px 6px; border-radius: 6px; background: oklch(0.93 0.05 280); color: oklch(0.4 0.14 280); font-size: 10.5px; font-weight: 700; text-transform: uppercase; }
.badge-edited { display: inline-block; padding: 1px 6px; border-radius: 6px; background: oklch(0.93 0.08 60); color: oklch(0.4 0.14 60); font-size: 10.5px; font-weight: 700; }
.qty-stepper { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.qty-btn { width: 30px; height: 30px; border-radius: 8px; border: 1.5px solid oklch(0.88 0.005 250); background: white; font-size: 16px; font-weight: 700; }
.qty-value { min-width: 18px; text-align: center; font-size: 14px; font-weight: 700; }
.chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { padding: 9px 14px; border-radius: 20px; border: 1.5px solid oklch(0.88 0.005 250); background: white; font-size: 13px; font-weight: 600; }
.chip.selected { background: oklch(0.45 0.14 220); border-color: oklch(0.45 0.14 220); color: white; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; }
.cart-name-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.price-edit-input { width: 116px; height: 30px; border-radius: 8px; border: 1.5px solid oklch(0.45 0.14 220); background: oklch(0.98 0.002 250); font-size: 13px; font-weight: 700; padding: 0 8px; font-family: inherit; }
.total-edit-input { width: 140px; height: 38px; border-radius: 10px; border: 1.5px solid oklch(0.45 0.14 220); background: oklch(0.98 0.002 250); font-size: 16px; font-weight: 800; padding: 0 10px; font-family: inherit; }
.service-form { display: flex; flex-direction: column; gap: 8px; padding: 10px 0 6px; border-bottom: 1px solid oklch(0.92 0.005 250); }
.service-form-row { display: flex; gap: 8px; }
.service-input { flex: 1; height: 40px; border-radius: 10px; border: 1.5px solid oklch(0.88 0.005 250); padding: 0 12px; font-size: 13.5px; font-weight: 600; background: oklch(0.98 0.002 250); font-family: inherit; min-width: 0; }
.service-form-actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn-ghost { padding: 9px 14px; border-radius: 9px; border: none; background: none; color: oklch(0.55 0.01 250); font-size: 13px; font-weight: 700; }
.btn-accent-sm { padding: 9px 16px; border-radius: 9px; border: none; background: oklch(0.45 0.14 220); color: white; font-size: 13px; font-weight: 800; }
```

- [ ] **Step 2: Commit**

```bash
git add WebFrontend/styles.css
git commit -m "feat: add CSS for the sales cart UI (chips, stepper, badges)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `WebFrontend/sales.html`

**Files:**
- Create: `WebFrontend/sales.html`

**Interfaces:**
- Consumes: `apiGet`/`apiPost` from `WebFrontend/api.js`, `initAuth`/`isTokenAuthError`/`signOut` from `WebFrontend/auth.js` (both already loaded by every other tool page, unchanged).
- Cart item shape produced by this page and sent to `submitSale`: `{ name, qty, price, isCustom }` — matches what `AppScripts/Lib/SalesLogic.js`'s `buildSaleGoodsRows`/`buildOperationsRow` expect.

There is no automated test for this file — Apps Script Web pages in this project are verified by hand in the browser (same convention as `WebFrontend/inventory.html`). The "test cycle" for this task is the manual walkthrough in Step 2.

- [ ] **Step 1: Create the page**

Create `WebFrontend/sales.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yonda — Продажа</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script src="auth.js"></script>
  <script src="api.js"></script>
  <script>
    var POINTS = ['Основной склад', 'Instagram', 'Teplo Store (TAS)', 'Teplo Store (SKD)', 'Human House', 'UzPost', 'Ethno Gallery', 'Маркеты'];
    var PAYMENT_TYPES = ['Наличка', 'Paynet', 'Карта (личная)', 'Расчётный счёт ИП'];
    var state = {
      screen: 'catalog',
      catalog: null,
      search: '',
      cart: [],
      addingService: false,
      editingPriceId: null,
      editingTotal: false,
      totalOverride: null,
      point: null,
      paymentType: null,
      submitting: false,
      confirm: null
    };

    function render() {
      var app = document.getElementById('app');
      if (state.screen === 'catalog') { app.innerHTML = renderCatalog(); bindCatalog(); return; }
      if (state.screen === 'checkout') { app.innerHTML = renderCheckout(); bindCheckout(); return; }
      if (state.screen === 'confirm') { app.innerHTML = renderConfirm(); bindConfirm(); return; }
    }

    function cartTotal() {
      return state.cart.reduce(function (sum, item) { return sum + Number(item.price) * Number(item.qty); }, 0);
    }

    // What actually goes to the server: the honest per-line sum, unless the
    // cashier corrected the whole order's total (see renderTotalRow/bindCatalog) —
    // in which case that corrected number is used as-is, with no attempt to
    // redistribute it back across individual lines.
    function effectiveTotal() {
      var subtotal = cartTotal();
      return (state.totalOverride !== null && state.totalOverride !== subtotal) ? state.totalOverride : subtotal;
    }

    function fmtSum(n) { return Math.round(n).toLocaleString('ru-RU') + ' сум'; }

    function renderCatalog() {
      if (state.catalog === null) {
        return '<div class="screen"><div class="header"><div class="title">Продажа</div></div><div class="spinner">Загрузка…</div></div>';
      }
      var q = state.search.trim().toLowerCase();
      var visible = state.catalog.filter(function (item) {
        return !q || item.name.toLowerCase().indexOf(q) !== -1;
      });
      var catalogRows = visible.map(function (item) {
        return '<button class="row cart-pick" data-add="' + escapeAttr(item.name) + '" data-price="' + escapeAttr(String(item.price || 0)) + '">' +
          '<div style="flex:1;"><div class="row-name">' + escapeHtml(item.name) + '</div>' +
          '<div class="row-stock">Остаток: ' + escapeHtml(String(item.current)) + '</div></div>' +
          '<div style="font-size:14px;font-weight:700;">' + fmtSum(Number(item.price) || 0) + '</div>' +
        '</button>';
      }).join('');

      var cartRows = state.cart.map(function (item) {
        var lineTotal = item.price * item.qty;
        var priceBlock;
        if (state.editingPriceId === item.id) {
          priceBlock = '<input class="price-edit-input" type="number" inputmode="decimal" id="price-input-' + item.id + '" value="' + lineTotal + '">';
        } else {
          priceBlock = '<button class="price-btn" data-edit-price="' + item.id + '">' + fmtSum(lineTotal) +
            (item.qty > 1 ? ' <span style="font-weight:600;">(' + fmtSum(item.price) + '/шт)</span>' : '') +
            (item.priceEdited ? ' <span class="badge-edited">изменено</span>' : '') + '</button>';
        }
        return '<div class="row">' +
          '<div style="flex:1;min-width:0;">' +
            '<div class="cart-name-line"><span class="row-name">' + escapeHtml(item.name) + '</span>' +
            (item.isCustom ? '<span class="badge-service">услуга</span>' : '') + '</div>' +
            priceBlock +
          '</div>' +
          '<div class="qty-stepper">' +
            '<button class="qty-btn" data-qty-dec="' + item.id + '">−</button>' +
            '<span class="qty-value">' + item.qty + '</span>' +
            '<button class="qty-btn" data-qty-inc="' + item.id + '">+</button>' +
          '</div>' +
          '<button class="remove-btn" data-remove="' + item.id + '">' + removeIcon() + '</button>' +
        '</div>';
      }).join('');

      var serviceForm = state.addingService ? (
        '<div class="service-form">' +
          '<div class="service-form-row">' +
            '<input class="service-input" id="service-name" placeholder="Название услуги">' +
            '<input class="service-input" id="service-price" placeholder="Сумма" type="number" inputmode="decimal" style="max-width:110px;">' +
          '</div>' +
          '<div class="service-form-actions">' +
            '<button class="btn-ghost" id="service-cancel">Отмена</button>' +
            '<button class="btn-accent-sm" id="service-save">Добавить</button>' +
          '</div>' +
        '</div>'
      ) : '';

      return '' +
        '<div class="screen">' +
          '<div class="header"><div><div class="title">Продажа</div><div class="subtitle">Основной склад</div></div></div>' +
          '<div style="padding:10px 20px 0;"><input class="name-input" style="width:100%;" type="text" placeholder="Поиск товара" id="search-input" value="' + escapeAttr(state.search) + '"></div>' +
          '<div class="list" style="flex:0 1 auto;max-height:38vh;">' + (catalogRows || '<div class="spinner">Ничего не найдено</div>') + '</div>' +
          '<div class="list" style="border-top:1px solid oklch(0.92 0.005 250);">' +
            cartRows +
            serviceForm +
            (!state.addingService ? '<button class="add-row-btn" id="add-service">' + plusIcon() + ' Добавить услугу</button>' : '') +
          '</div>' +
          '<div class="footer">' +
            renderTotalRow() +
            '<button class="primary-btn" id="go-checkout"' + (state.cart.length === 0 ? ' disabled' : '') + '>Оформить продажу</button>' +
          '</div>' +
        '</div>';
    }

    function renderTotalRow() {
      var subtotal = cartTotal();
      var hasOverride = state.totalOverride !== null && state.totalOverride !== subtotal;
      if (state.editingTotal) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;">' +
          '<div style="font-size:13px;color:oklch(0.55 0.01 250);">Итого</div>' +
          '<input class="total-edit-input" type="number" inputmode="decimal" id="total-input" value="' + (hasOverride ? state.totalOverride : subtotal) + '">' +
        '</div>';
      }
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;">' +
        '<div style="font-size:13px;color:oklch(0.55 0.01 250);">Итого</div>' +
        '<div style="display:flex;align-items:baseline;gap:8px;">' +
          (hasOverride ? '<span style="font-size:12px;font-weight:700;color:oklch(0.55 0.01 250);text-decoration:line-through;">' + fmtSum(subtotal) + '</span>' : '') +
          '<button class="price-btn" id="edit-total" style="font-size:19px;font-weight:800;color:inherit;">' + fmtSum(hasOverride ? state.totalOverride : subtotal) + '</button>' +
          (hasOverride ? ' <span class="badge-edited">изменено</span>' : '') +
        '</div>' +
      '</div>';
    }

    function bindCatalog() {
      var search = document.getElementById('search-input');
      if (search) search.oninput = function () { state.search = search.value; render(); };
      document.querySelectorAll('[data-add]').forEach(function (btn) {
        btn.onclick = function () {
          var name = btn.getAttribute('data-add');
          var price = Number(btn.getAttribute('data-price')) || 0;
          var existing = state.cart.filter(function (i) { return i.name === name && !i.isCustom; })[0];
          if (existing) { existing.qty += 1; }
          else { state.cart.push({ id: 'i' + Date.now() + Math.floor(Math.random() * 1000), name: name, qty: 1, price: price, isCustom: false, priceEdited: false }); }
          render();
        };
      });
      document.querySelectorAll('[data-qty-inc]').forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute('data-qty-inc');
          state.cart = state.cart.map(function (i) { return i.id === id ? Object.assign({}, i, { qty: i.qty + 1 }) : i; });
          render();
        };
      });
      document.querySelectorAll('[data-qty-dec]').forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute('data-qty-dec');
          var item = state.cart.filter(function (i) { return i.id === id; })[0];
          if (item && item.qty <= 1) { state.cart = state.cart.filter(function (i) { return i.id !== id; }); }
          else { state.cart = state.cart.map(function (i) { return i.id === id ? Object.assign({}, i, { qty: i.qty - 1 }) : i; }); }
          render();
        };
      });
      document.querySelectorAll('[data-remove]').forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute('data-remove');
          state.cart = state.cart.filter(function (i) { return i.id !== id; });
          render();
        };
      });
      document.querySelectorAll('[data-edit-price]').forEach(function (btn) {
        btn.onclick = function () {
          state.editingPriceId = btn.getAttribute('data-edit-price');
          render();
          var input = document.getElementById('price-input-' + state.editingPriceId);
          if (input) { input.focus(); input.select(); }
        };
      });
      var priceInput = document.querySelector('.price-edit-input');
      if (priceInput) {
        var commitPrice = function () {
          var id = state.editingPriceId;
          var enteredTotal = Number(priceInput.value);
          if (!isNaN(enteredTotal) && enteredTotal >= 0) {
            state.cart = state.cart.map(function (i) {
              if (i.id !== id) return i;
              // The field edits this line's total, not a per-unit price — store
              // price as total ÷ qty so cartTotal (Σ price × qty) and the
              // Операции note (qty × price per line) keep matching what was typed.
              return Object.assign({}, i, { price: enteredTotal / i.qty, priceEdited: true });
            });
          }
          state.editingPriceId = null;
          render();
        };
        priceInput.onblur = commitPrice;
        priceInput.onkeydown = function (e) { if (e.key === 'Enter') priceInput.blur(); };
      }

      var addServiceBtn = document.getElementById('add-service');
      if (addServiceBtn) addServiceBtn.onclick = function () { state.addingService = true; render(); };
      var serviceCancel = document.getElementById('service-cancel');
      if (serviceCancel) serviceCancel.onclick = function () { state.addingService = false; render(); };
      var serviceSave = document.getElementById('service-save');
      if (serviceSave) serviceSave.onclick = function () {
        var name = document.getElementById('service-name').value.trim();
        var price = Number(document.getElementById('service-price').value);
        if (!name || isNaN(price) || price < 0) return;
        state.cart.push({ id: 'c' + Date.now() + Math.floor(Math.random() * 1000), name: name, qty: 1, price: price, isCustom: true, priceEdited: false });
        state.addingService = false;
        render();
      };

      var editTotalBtn = document.getElementById('edit-total');
      if (editTotalBtn) editTotalBtn.onclick = function () {
        state.editingTotal = true;
        render();
        var el = document.getElementById('total-input');
        if (el) { el.focus(); el.select(); }
      };
      var totalInput = document.getElementById('total-input');
      if (totalInput) {
        var commitTotal = function () {
          var num = Number(totalInput.value);
          var subtotal = cartTotal();
          if (!isNaN(num) && num >= 0) {
            state.totalOverride = (num === subtotal) ? null : num;
          }
          state.editingTotal = false;
          render();
        };
        totalInput.onblur = commitTotal;
        totalInput.onkeydown = function (e) { if (e.key === 'Enter') totalInput.blur(); };
      }

      var goCheckout = document.getElementById('go-checkout');
      if (goCheckout) goCheckout.onclick = function () {
        if (state.cart.length === 0) return;
        state.screen = 'checkout';
        render();
      };
    }

    function renderCheckout() {
      var pointChips = POINTS.map(function (p) {
        return '<button class="chip' + (state.point === p ? ' selected' : '') + '" data-point="' + escapeAttr(p) + '">' + escapeHtml(p) + '</button>';
      }).join('');
      var paymentChips = PAYMENT_TYPES.map(function (p) {
        return '<button class="chip' + (state.paymentType === p ? ' selected' : '') + '" data-payment="' + escapeAttr(p) + '">' + escapeHtml(p) + '</button>';
      }).join('');
      return '' +
        '<div class="screen">' +
          '<div class="header"><button class="back-btn" id="back-to-catalog">' + backIcon() + '</button><div class="title">Оформление</div></div>' +
          '<div class="list">' +
            '<div style="font-size:13px;font-weight:700;margin:10px 0 8px;">Точка / канал</div>' +
            '<div class="chip-row">' + pointChips + '</div>' +
            '<div style="font-size:13px;font-weight:700;margin:18px 0 8px;">Оплата</div>' +
            '<div class="chip-row">' + paymentChips + '</div>' +
          '</div>' +
          '<div class="footer">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;">' +
              '<div style="font-size:13px;color:oklch(0.55 0.01 250);">К оплате</div>' +
              '<div style="font-size:19px;font-weight:800;">' + fmtSum(effectiveTotal()) + '</div>' +
            '</div>' +
            '<button class="primary-btn" id="confirm-sale"' + (!state.point || !state.paymentType || state.submitting ? ' disabled' : '') + '>' + (state.submitting ? 'Оформляем…' : 'Подтвердить') + '</button>' +
          '</div>' +
        '</div>';
    }

    function bindCheckout() {
      document.getElementById('back-to-catalog').onclick = function () { state.screen = 'catalog'; render(); };
      document.querySelectorAll('[data-point]').forEach(function (btn) {
        btn.onclick = function () { state.point = btn.getAttribute('data-point'); render(); };
      });
      document.querySelectorAll('[data-payment]').forEach(function (btn) {
        btn.onclick = function () { state.paymentType = btn.getAttribute('data-payment'); render(); };
      });
      var confirmBtn = document.getElementById('confirm-sale');
      if (confirmBtn) confirmBtn.onclick = onConfirmSale;
    }

    function onConfirmSale() {
      if (!state.point || !state.paymentType || state.submitting) return;
      state.submitting = true;
      render();
      var total = effectiveTotal();
      var itemsLabel = state.cart.map(function (i) { return i.name + ' ×' + i.qty; }).join(', ');
      apiPost('submitSale', { items: state.cart, point: state.point, paymentType: state.paymentType, totalOverride: state.totalOverride })
        .then(function () {
          state.confirm = { total: total, itemsLabel: itemsLabel };
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
            '<div style="font-size:18px;font-weight:800;">Продажа оформлена</div>' +
            '<div style="font-size:22px;font-weight:800;">' + fmtSum(state.confirm.total) + '</div>' +
            '<div style="font-size:13px;color:oklch(0.55 0.01 250);text-align:center;">' + escapeHtml(state.confirm.itemsLabel) + '</div>' +
          '</div>' +
          '<div class="footer" style="border-top:none;"><button class="dark-btn" id="new-sale">Новая продажа</button></div>' +
        '</div>';
    }

    function bindConfirm() {
      document.getElementById('new-sale').onclick = function () {
        var point = state.point, paymentType = state.paymentType;
        state = { screen: 'catalog', catalog: state.catalog, search: '', cart: [], addingService: false, editingPriceId: null, editingTotal: false, totalOverride: null, point: point, paymentType: paymentType, submitting: false, confirm: null };
        render();
      };
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
    function backIcon() { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"></path></svg>'; }
    function plusIcon() { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"></path></svg>'; }
    function removeIcon() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="oklch(0.55 0.18 25)" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"></path></svg>'; }
    function checkIcon() { return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="oklch(0.4 0.14 145)" stroke-width="2.4"><path d="M5 13l4 4L19 7"></path></svg>'; }

    function renderSignedOut() {
      document.getElementById('app').innerHTML = '<div class="signin-wrap"><div style="font-size:16px;font-weight:700;">Войдите, чтобы продолжить</div><div id="signin-button"></div></div>';
    }

    function onSignedIn() {
      render();
      apiGet('getSalesCatalog', {}).then(function (items) { state.catalog = items; render(); }).catch(onError);
    }

    renderSignedOut();
  </script>
  <script src="https://accounts.google.com/gsi/client" async onload="initAuth(onSignedIn)"></script>
</body>
</html>
```

Design note for whoever reviews this: price and service entry use inline fields (a text input that appears in place, focused automatically) rather than `prompt()` dialogs, per the approved interactive prototype — this reads better on a real device and was validated with the owner before this task was written. Tapping a cart line's price edits **that line's total** (not a per-unit price); the stored `price` becomes `enteredTotal / qty` so `cartTotal`/`buildOperationsRow` keep working unchanged. Tapping the footer "Итого" edits the **whole order's total** independently of any line — a second, separate lever: line edits change what a specific position is worth (and still sum normally into the subtotal), while the order-level edit corrects the final charged amount in one step (e.g. a round-number discount) without touching any line, per the owner's own walkthrough: 5×25 000 + 1×75 000 + a 125 000 service = 325 000 subtotal, corrected to 300 000 for the whole order. Typing the current subtotal back into the total field clears the override.

- [ ] **Step 2: Manual walkthrough**

Open `sales.html` locally (or after Task 12's deploy, on the real GitHub Pages URL) and confirm:
1. Sign-in screen appears when signed out; after sign-in, the catalog loads and shows real products with real prices and remaining stock.
2. Typing in the search box filters the catalog list live.
3. Tapping a catalog item adds it to the cart below with quantity 1; tapping the same item again increments its quantity instead of adding a duplicate row.
4. The `+`/`−` steppers change quantity; decrementing a quantity-1 item removes it from the cart.
5. Tapping a cart line's price (for an item with qty > 1) opens an inline field pre-filled with the line's current total, not its per-unit price; committing a new value updates the line total, shows the "изменено" badge, and shows the resulting per-unit price in parentheses.
6. "Добавить услугу" opens an inline name+amount form; saving adds a service-badged row that is **not** in the catalog.
7. The footer total updates live as the cart changes; "Оформить продажу" is disabled while the cart is empty and enabled once it has at least one item.
8. Tapping the footer "Итого" itself (not a line) opens an inline field pre-filled with the current subtotal; entering a different number shows it with the original subtotal struck through beside it and an "изменено" badge, and the checkout screen's "К оплате" reflects the corrected number, not the subtotal.
9. Tapping "Оформить продажу" opens the checkout screen with point/payment chips; "Подтвердить" stays disabled until both are picked.
10. Confirming shows the confirmation screen with the corrected total (if one was set) and item list; "Новая продажа" returns to an empty cart on the same catalog, with point, payment, and any total override all reset.

- [ ] **Step 3: Commit**

```bash
git add WebFrontend/sales.html
git commit -m "feat: add the sales checkout tool (WebFrontend/sales.html)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Link the sales tool from the home screen

**Files:**
- Modify: `WebFrontend/index.html`

- [ ] **Step 1: Add the "Продажа" card**

In `WebFrontend/index.html`, change:

```javascript
          '<a class="card-btn" href="inventory.html"><div style="flex:1;"><div style="font-size:16px;font-weight:700;">Инвентаризация</div>' +
          '<div style="font-size:13px;color:oklch(0.55 0.01 250);">Сверить фактические остатки</div></div></a>' +
        '</div>';
```

to:

```javascript
          '<a class="card-btn" href="sales.html"><div style="flex:1;"><div style="font-size:16px;font-weight:700;">Продажа</div>' +
          '<div style="font-size:13px;color:oklch(0.55 0.01 250);">Оформить продажу на выставке</div></div></a>' +
          '<a class="card-btn" href="inventory.html"><div style="flex:1;"><div style="font-size:16px;font-weight:700;">Инвентаризация</div>' +
          '<div style="font-size:13px;color:oklch(0.55 0.01 250);">Сверить фактические остатки</div></div></a>' +
        '</div>';
```

- [ ] **Step 2: Manual check**

Open `index.html`, confirm the "Продажа" card appears above "Инвентаризация" and navigates to `sales.html`.

- [ ] **Step 3: Commit**

```bash
git add WebFrontend/index.html
git commit -m "feat: link the sales checkout tool from the home screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: "Это сверка продаж" toggle in the Инвентаризация tool

**Files:**
- Modify: `WebFrontend/inventory.html`

**Interfaces:**
- Adds `state.isSaleReconciliation` (boolean, defaults `false`); sent as `isSaleReconciliation` in the `submitInventory` POST body.

- [ ] **Step 1: Add the toggle to state and to `renderCounting`**

In `WebFrontend/inventory.html`, change the initial state object:

```javascript
    var state = { screen: 'type', type: null, location: null, locations: null, items: null, facts: {}, customItems: [], changes: [], written: 0 };
```

to:

```javascript
    var state = { screen: 'type', type: null, location: null, locations: null, items: null, facts: {}, customItems: [], changes: [], written: 0, isSaleReconciliation: false };
```

Then, in `renderCounting`, add the toggle right after the header and before the item list. Change:

```javascript
      var subtitle = state.type === 'materials' ? 'Основной склад' : state.location;
      return '' +
        '<div class="screen">' +
          '<div class="header"><button class="back-btn" id="back-from-counting">' + backIcon() + '</button>' +
          '<div><div class="title">' + (state.type === 'materials' ? 'Материалы' : 'Товары') + '</div><div class="subtitle">' + escapeHtml(subtitle) + '</div></div></div>' +
          '<div class="list">' + rows + '<button class="add-row-btn" id="add-custom">' + plusIcon() + ' Добавить позицию</button></div>' +
          '<div class="footer"><button class="primary-btn" id="save-counts">Сохранить</button></div>' +
        '</div>';
```

to:

```javascript
      var subtitle = state.type === 'materials' ? 'Основной склад' : state.location;
      var reconciliationToggle = state.type === 'products' ?
        '<div class="toggle-row" style="padding:10px 20px 0;"><label style="font-size:13.5px;font-weight:600;">Это сверка продаж</label>' +
        '<input type="checkbox" id="sale-reconciliation-toggle"' + (state.isSaleReconciliation ? ' checked' : '') + '></div>' : '';
      return '' +
        '<div class="screen">' +
          '<div class="header"><button class="back-btn" id="back-from-counting">' + backIcon() + '</button>' +
          '<div><div class="title">' + (state.type === 'materials' ? 'Материалы' : 'Товары') + '</div><div class="subtitle">' + escapeHtml(subtitle) + '</div></div></div>' +
          reconciliationToggle +
          '<div class="list">' + rows + '<button class="add-row-btn" id="add-custom">' + plusIcon() + ' Добавить позицию</button></div>' +
          '<div class="footer"><button class="primary-btn" id="save-counts">Сохранить</button></div>' +
        '</div>';
```

- [ ] **Step 2: Bind the toggle and send it with the submission**

In `bindCounting`, add (anywhere after the existing bindings, before the function's closing brace):

```javascript
      var reconciliationToggle = document.getElementById('sale-reconciliation-toggle');
      if (reconciliationToggle) reconciliationToggle.onchange = function () { state.isSaleReconciliation = reconciliationToggle.checked; };
```

In `onSave`, change:

```javascript
      apiPost('submitInventory', { kind: state.type, location: state.location, counts: counts, newItems: newItems })
```

to:

```javascript
      apiPost('submitInventory', { kind: state.type, location: state.location, counts: counts, newItems: newItems, isSaleReconciliation: state.isSaleReconciliation })
```

- [ ] **Step 3: Reset the toggle when returning to the type-picker**

In `bindConfirm`, the `finish` button already resets `state` entirely to its initial shape — no change needed there, since the initial shape from Step 1 already includes `isSaleReconciliation: false`.

- [ ] **Step 4: Manual walkthrough**

Open `inventory.html`, pick Товары → any location, confirm the "Это сверка продаж" toggle appears only for Товары (not Материалы), toggling it and submitting a count sends `isSaleReconciliation: true`/`false` correctly (check the Network tab), and finishing a session resets the toggle to unchecked.

- [ ] **Step 5: Commit**

```bash
git add WebFrontend/inventory.html
git commit -m "feat: add a sale-reconciliation toggle to the products stocktake screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Deploy

**Files:** none (operational task)

- [ ] **Step 1: Push all Apps Script changes from the repo root**

```bash
clasp push
```

- [ ] **Step 2: Independently verify the push landed**

Repeat the Task 3 Step 4 verification pattern, checking the `InventoryService` and `Api` file sources for `getSalesCatalog`, `submitSale`, and `POSTCARD_AGGREGATE_NAME`.

- [ ] **Step 3: Find the live deployment id and redeploy it**

```bash
clasp deployments
```

Find the deployment id that matches the exec URL in `WebFrontend/api.js`'s `API_BASE_URL`, then:

```bash
clasp deploy --deploymentId <that id> --description "Add sales checkout tool and postcard reconciliation"
```

- [ ] **Step 4: Verify the live Web App is actually running the new code**

```bash
curl -s "<API_BASE_URL from WebFrontend/api.js>?action=ping"
```

Expected: `{"pong":true}`. Then, signed in as an allowed account in a browser, load `sales.html` from the deployed GitHub Pages site and confirm the catalog loads real data — this proves the exec URL is serving the redeployed version, not a stale one (fetching HEAD source alone, as in Step 2, is not sufficient evidence the live Web App is running it).

- [ ] **Step 5: Push WebFrontend changes to `main`**

The existing `.github/workflows/deploy-pages.yml` workflow redeploys GitHub Pages automatically on every push to `main` that touches `WebFrontend/**` — no manual step beyond pushing the commits from Tasks 8–11.

```bash
git push origin main
```

- [ ] **Step 6: Confirm the GitHub Actions run succeeded**

```bash
gh run list --workflow=deploy-pages.yml --limit 1
```

Expected: the most recent run's status is `completed`/`success`. If it failed, run `gh run view <run-id> --log-failed` to see why before considering the deploy done.

---

### Task 13: Manual end-to-end QA against the spec's acceptance criteria

**Files:** none

- [ ] **Step 1: Multi-item sale reproducing the owner's own worked example**

On the deployed `sales.html`, reproduce the exact example the owner walked through during design: add 5× an item priced 25 000 (line total 125 000), add 1× a different item priced 75 000 (line total 75 000), add one free-form service at 125 000 — subtotal 325 000 — then tap the footer "Итого" and correct it to 300 000, and confirm the sale with a real point/payment.

For this cart of 2 stock items + 1 service, verify exactly **3** new rows landed in `Ответы на форму (1)`: 2 rows with `Вид действия="Продажа"` (one per stock item — quantities 5 and 1, no price at all, matching how `Реестр товаров`/`Склад товаров` have never carried price for any record type), plus exactly **1** `Тип записи="Доход"` row for the whole cart. The service does **not** get its own goods-movement row — it only exists inside that one Доход row. These two kinds of rows carry **no shared reference** to each other (no common order id) — confirm there isn't one, matching the design.

Verify the Доход row's `Сумма` is **300 000** (the corrected total, not the 325 000 subtotal), its `Тип оплаты` matches the chosen account, and its `Описание` reads `<item 1> x5 = 125000, <item 2> x1 = 75000, <service name> x1 = 125000, Итого по позициям: 325000, к оплате: 300000`. Verify `Реестр товаров` shows the 2 stock rows with `Тип="Продажа"` and quantities 5/1, `Склад товаров`'s "Основной склад" остаток for each stock item decreased by exactly that quantity (unaffected by the 300 000 vs 325 000 correction — the goods-movement rows never carried price to begin with), and the Telegram channel received one message listing every item (including the service) with its own line total, and an "Итого" of 300 000.

Also confirm whether the `Операции` sheet's `ID` column populated itself automatically for the new Доход row (expected, if it's formula-driven like `Реестр товаров`'s own `# ID` column) — if it did not, this plan's Task 4 `appendIncomeRow_` needs an explicit id-writing step added before this task can be considered done; record what you find in this plan's Global Constraints either way.

- [ ] **Step 2: Postcard sale + post-event reconciliation**

Sell one `Открытка` through `sales.html`; confirm the `Открытка` остаток decreased by the sold quantity and no specific variety's остаток changed. Then, in `inventory.html`, count Товары → Основной склад with "Это сверка продаж" checked: enter a fact for one postcard variety lower than its current остаток (simulating what sold) and a fact for another variety higher than its current остаток (simulating new stock received). Verify: the lower-count variety produced one `Тип="Продажа"` row and did **not** change `Открытка`'s остаток; the higher-count variety produced its usual `Тип="Инвентаризация"` row **plus** a mirrored `Тип="Инвентаризация"` row for `Открытка`, increasing its остаток by that amount.

- [ ] **Step 3: Regression check on the existing Инвентаризация flow**

Run a normal Материалы stocktake and a normal Товары stocktake (toggle off, non-postcard items) exactly as before this plan's changes, and confirm behavior is unchanged (correct deltas written, no extra rows, no postcard-specific side effects).

- [ ] **Step 4: Access control check**

Sign in with a Google account not in `ALLOWED_EMAILS` (`AppScripts/Api.gs`'s `OAUTH_CLIENT_ID` verification path) and confirm `sales.html` rejects the request the same way `inventory.html` already does.

- [ ] **Step 5: Record any follow-ups**

If Step 1 or 2 surfaces a mismatch between the actual live spreadsheet formulas and this plan's assumptions (most likely spot: the Layer 2 `Тип` formula extension from Task 3, or the exact `Ответы на форму (1)` column numbers), fix it in place, update this plan file's Global Constraints with the corrected facts, and re-run the affected steps before considering the feature done.

---

## Self-Review Notes

- **Spec coverage:** every requirement from the spec's "Инструмент 2: Корзина продаж" and "Особый случай: открытки" sections maps to a task — catalog/остаток always from Основной склад (Task 4), per-line price override + free-form services (Task 2, Task 9), whole-order total override without line redistribution (Task 2, Task 4, Task 7, Task 9), one-click checkout with point/payment defaults (Task 9), independent Операции + Реестр товаров + Telegram writes with no shared order id (Task 4), postcard aggregate and reconciliation toggle (Tasks 1, 5, 6, 11).
- **Placeholder scan:** the only literal placeholder-shaped array is `POSTCARD_VARIETY_NAMES = []` introduced in Task 4 — it is explicitly a forward reference resolved by name in Task 6, Step 1, with an owner-facing data-collection task (Task 5) producing the real values; this mirrors how `ALLOWED_EMAILS` is already a hand-filled array in this codebase and is not a deferred implementation.
- **Type consistency:** `appendGoodsRow_(ss, name, quantity, vidDeistviya, from, to)` signature is introduced once (Task 3) and used identically in Task 4, Task 6; `classifyGoodsDelta`'s `{ type, mirrorToAggregate }` shape is defined once (Task 1) and consumed once (Task 6) with matching field names; `buildOperationsRow`/`buildTelegramSaleMessage`'s `totalOverride` parameter is defined once (Task 2), threaded through `submitSale` (Task 4) and `Api.gs`'s `submitSale` action (Task 7) unchanged, and produced by `sales.html`'s `state.totalOverride` (Task 9); the cart item shape `{ name, qty, price, isCustom, priceEdited }` is produced by `sales.html` (Task 9) and consumed by `SalesLogic.js` (Task 2) using the same field names throughout.

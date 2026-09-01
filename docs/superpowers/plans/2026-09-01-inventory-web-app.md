# Inventory (Stocktake) Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first Google Apps Script Web App with one working
tool — Инвентаризация (stocktake) — that lets the owner or partner walk
through materials or products, enter actual counts, and have the delta
written automatically to the correct ledger, including registering brand
new items that aren't in the catalog yet.

**Architecture:** A new Apps Script Web App deployment (separate from the
existing Telegram-webhook deployment, so it doesn't disturb it), gated by
an email allowlist checked via `Session.getActiveUser().getEmail()`. Pure
business logic (delta math, ledger row shaping, access check) lives in
plain `.js` files runnable under Node for real unit tests; Apps Script
glue (`.gs` files) reads/writes the spreadsheet and serves the HTML.
Client-side is vanilla JS (no framework) matching the approved mockup.

**Tech Stack:** Google Apps Script (V8 runtime, HtmlService), `clasp`,
Node's built-in test runner (`node --test`), vanilla HTML/CSS/JS on the
client.

**Spec:** [docs/superpowers/specs/2026-08-31-inventory-and-sales-tools-design.md](../specs/2026-08-31-inventory-and-sales-tools-design.md)
**Foundation plan (prerequisite, already complete):** [docs/superpowers/plans/2026-08-31-foundation-security-and-bugfix.md](2026-08-31-foundation-security-and-bugfix.md)
**Approved mockup:** https://claude.ai/code/artifact/8291f972-4501-4129-bcec-78513cc763fb

## Global Constraints

- Sheet names: `Склад материалов`, `Реестр материалов`, `Склад товаров`,
  `Реестр товаров` (all already used as constants elsewhere — see
  "Existing constants, do not redeclare" below).
- `Склад материалов` columns (1-based): B=Материал, C=Ед.измерения,
  D=Остаток (formula).
- `Склад товаров` columns: A=Товар, then one column per location
  (`Основной склад`, `Teplo Store (TAS)`, `Human House`, `UzPost`,
  `Ethno Gallery`, `Teplo Store (SKD)`), then `Итого`.
- `Реестр товаров` columns (1-based): A=ID, B=Дата, C=Тип записи, D=Товар,
  E=Количество, F=Тип, G=Откуда, H=Куда.
- `Реестр материалов` columns (1-based): A=Дата, B=Материал, C=Тип
  (`Приход`/`Списание`), D=Количество, E=Примечание.
- Access allowlist (exact emails): `shuhratorifjonov29@gmail.com`
  (owner), `nurakvlnk@gmail.com` (partner).
- Timezone for all dates: `Asia/Tashkent`.
- **Existing constants, do not redeclare** (Apps Script shares one global
  scope across every file — a duplicate `const` name is a build-breaking
  syntax error): `SHEET_GOODS_REGISTRY` ('Реестр товаров'),
  `SHEET_MATERIALS_REGISTRY` ('Реестр материалов'),
  `SHEET_MATERIALS_STOCK` ('Склад материалов') — all three declared in
  `AppScripts/ProductionHandler.js:1-3`. `GOODS_COL` (the `{ID, DATE,
  REC_TYPE, PRODUCT, QTY, TYPE, FROM, TO}` column-index map for
  `Реестр товаров`) — declared in `AppScripts/ProductionHandler.js`.
  Reuse all four by name; do not redefine them.
- Never commit secrets to git (carried over from the Foundation plan —
  no new secrets are introduced here, but the rule still applies).
- All Apps Script changes are pushed via `clasp push` from `Yonda/`, not
  pasted into the browser editor.
- This spreadsheet/script project is a **sandbox copy**, not production.
  This plan's Production Hand-Off note (added at the end) documents what
  the user re-applies to the real project afterward.

---

### Task 1: Node test harness, `.claspignore`, and the access-check pure function

**Files:**
- Create: `Yonda/package.json`
- Create: `Yonda/AppScripts/.claspignore`
- Create: `Yonda/AppScripts/Lib/Access.js`
- Test: `Yonda/AppScripts/Lib/Access.test.js`

**Interfaces:**
- Produces: `isAllowedEmail(email, allowlist)` — `email: string|null|undefined`,
  `allowlist: string[]`, returns `boolean`. Case-insensitive, trims
  whitespace. Consumed by Task 5's `WebApp.gs`.

- [ ] **Step 1: Create the Node test harness**

Create `Yonda/package.json`:
```json
{
  "name": "yonda-appscripts",
  "private": true,
  "scripts": {
    "test": "node --test AppScripts/Lib"
  }
}
```

- [ ] **Step 2: Exclude Node test files from clasp push**

Apps Script's V8 runtime has no `require` — if a `.test.js` file gets
pushed, its top-level `require(...)` call throws during project
initialization and breaks every trigger and the web app alike. Create
`Yonda/AppScripts/.claspignore`:
```
**/*.test.js
```

- [ ] **Step 3: Write the failing test**

Create `Yonda/AppScripts/Lib/Access.test.js`:
```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedEmail } = require('./Access.js');

test('allows an email in the list, case-insensitively', () => {
  assert.equal(isAllowedEmail('Owner@Example.com', ['owner@example.com']), true);
});

test('rejects an email not in the list', () => {
  assert.equal(isAllowedEmail('stranger@example.com', ['owner@example.com']), false);
});

test('rejects empty or missing email', () => {
  assert.equal(isAllowedEmail('', ['owner@example.com']), false);
  assert.equal(isAllowedEmail(undefined, ['owner@example.com']), false);
  assert.equal(isAllowedEmail(null, ['owner@example.com']), false);
});

test('trims surrounding whitespace before comparing', () => {
  assert.equal(isAllowedEmail('  owner@example.com  ', ['owner@example.com']), true);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd Yonda && npm test`
Expected: FAIL — `Cannot find module './Access.js'`

- [ ] **Step 5: Write the minimal implementation**

Create `Yonda/AppScripts/Lib/Access.js`:
```javascript
function isAllowedEmail(email, allowlist) {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();
  return allowlist.some((allowed) => String(allowed).trim().toLowerCase() === normalized);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isAllowedEmail };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd Yonda && npm test`
Expected: PASS — 4 tests passing.

- [ ] **Step 7: Commit**

```bash
cd Yonda
git add package.json AppScripts/.claspignore AppScripts/Lib/Access.js AppScripts/Lib/Access.test.js
git commit -m "feat: add Node test harness and email-allowlist check for the inventory web app"
```

---

### Task 2: Inventory delta logic (pure, Node-testable)

**Files:**
- Create: `Yonda/AppScripts/Lib/InventoryLogic.js`
- Test: `Yonda/AppScripts/Lib/InventoryLogic.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (consumed by Task 4's `InventoryService.gs`):
  - `computeDelta(current: number, factRaw: string|number|undefined) -> number|null`
    — `null` when `factRaw` is blank, non-numeric, or equal to `current`
    (no change to write).
  - `buildMaterialLedgerRow(materialName: string, delta: number, dateStr: string) -> {type: 'Приход'|'Списание', quantity: number, note: string}`
  - `buildGoodsLedgerRow(delta: number, location: string, dateStr: string) -> {type: 'Инвентаризация', from: string, to: string, quantity: number, note: string}`
    — exactly one of `from`/`to` is the location name, the other `''`.

- [ ] **Step 1: Write the failing tests**

Create `Yonda/AppScripts/Lib/InventoryLogic.test.js`:
```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeDelta, buildMaterialLedgerRow, buildGoodsLedgerRow } = require('./InventoryLogic.js');

test('computeDelta returns null for blank input', () => {
  assert.equal(computeDelta(10, ''), null);
  assert.equal(computeDelta(10, undefined), null);
});

test('computeDelta returns null when fact equals current', () => {
  assert.equal(computeDelta(10, '10'), null);
});

test('computeDelta returns the signed difference', () => {
  assert.equal(computeDelta(10, '15'), 5);
  assert.equal(computeDelta(10, '4'), -6);
});

test('computeDelta returns null for non-numeric input', () => {
  assert.equal(computeDelta(10, 'abc'), null);
});

test('computeDelta handles a negative current stock (real data has these)', () => {
  assert.equal(computeDelta(-3, '5'), 8);
});

test('buildMaterialLedgerRow: positive delta is Приход', () => {
  const row = buildMaterialLedgerRow('XEROX Бумага', 8, '01.09.2026');
  assert.deepEqual(row, { type: 'Приход', quantity: 8, note: 'Инвентаризация от 01.09.2026' });
});

test('buildMaterialLedgerRow: negative delta is Списание with absolute quantity', () => {
  const row = buildMaterialLedgerRow('ПВХ', -3, '01.09.2026');
  assert.deepEqual(row, { type: 'Списание', quantity: 3, note: 'Инвентаризация от 01.09.2026' });
});

test('buildGoodsLedgerRow: positive delta goes to "Куда"', () => {
  const row = buildGoodsLedgerRow(5, 'Основной склад', '01.09.2026');
  assert.deepEqual(row, { type: 'Инвентаризация', from: '', to: 'Основной склад', quantity: 5, note: 'Инвентаризация от 01.09.2026' });
});

test('buildGoodsLedgerRow: negative delta goes to "Откуда"', () => {
  const row = buildGoodsLedgerRow(-2, 'Teplo Store (TAS)', '01.09.2026');
  assert.deepEqual(row, { type: 'Инвентаризация', from: 'Teplo Store (TAS)', to: '', quantity: 2, note: 'Инвентаризация от 01.09.2026' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd Yonda && npm test`
Expected: FAIL — `Cannot find module './InventoryLogic.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `Yonda/AppScripts/Lib/InventoryLogic.js`:
```javascript
function computeDelta(current, factRaw) {
  if (factRaw === undefined || factRaw === null || factRaw === '') return null;
  const factNum = Number(factRaw);
  if (Number.isNaN(factNum)) return null;
  const delta = factNum - Number(current);
  if (delta === 0) return null;
  return delta;
}

function buildMaterialLedgerRow(materialName, delta, dateStr) {
  return {
    type: delta > 0 ? 'Приход' : 'Списание',
    quantity: Math.abs(delta),
    note: 'Инвентаризация от ' + dateStr,
  };
}

function buildGoodsLedgerRow(delta, location, dateStr) {
  return {
    type: 'Инвентаризация',
    from: delta < 0 ? location : '',
    to: delta > 0 ? location : '',
    quantity: Math.abs(delta),
    note: 'Инвентаризация от ' + dateStr,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeDelta, buildMaterialLedgerRow, buildGoodsLedgerRow };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd Yonda && npm test`
Expected: PASS — 12 tests passing (4 from Task 1 + 8 here).

- [ ] **Step 5: Commit**

```bash
cd Yonda
git add AppScripts/Lib/InventoryLogic.js AppScripts/Lib/InventoryLogic.test.js
git commit -m "feat: add pure delta/ledger-row logic for the inventory tool"
```

---

### Task 3: Extend the "Склад товаров" formula for the new Инвентаризация type

**Files:**
- Create: `Yonda/AppScripts/MaintenanceScripts.js`

**Interfaces:**
- Consumes: `SHEET_GOODS_STOCK` (new constant this task declares — not
  defined anywhere yet; verified by grepping the existing 4 files, none
  of which reference "Склад товаров").
- Produces: the corrected formula text and column-bounds logic that
  Task 4's manual verification step re-checks. No other task calls this
  file's function — it's a one-time (idempotent) maintenance script run
  by hand.

**Context:** The spec requires the `Склад товаров` "Остаток" formula to
recognize a new `Тип` value, `"Инвентаризация"` — added the same way
`"Возврат"` already works (added on `Куда`, subtracted on `Откуда`). The
exact current formula (read directly from the live sandbox spreadsheet
earlier this session) is:
```
=СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;"Производство";'Реестр товаров'!$H:$H;B$1)
+СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;"Перемещение";'Реестр товаров'!$H:$H;B$1)
+СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;"Возврат";'Реестр товаров'!$H:$H;B$1)
+СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;"Заказ у поставщиков";'Реестр товаров'!$H:$H;B$1)
-СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;"Перемещение";'Реестр товаров'!$G:$G;B$1)
-СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;"Продажа";'Реестр товаров'!$G:$G;B$1)
-СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;"Возврат";'Реестр товаров'!$G:$G;B$1)
```
This lives in cell B2 of `Склад товаров` and is fanned out across every
`Товар` row and every location column (B through the column just before
`Итого`) via copy/fill — so fixing B2 and copying it across the same
footprint fixes every cell at once.

- [ ] **Step 1: Write the maintenance function**

Create `Yonda/AppScripts/MaintenanceScripts.js`:
```javascript
const SHEET_GOODS_STOCK = 'Склад товаров';

// One-time (idempotent) maintenance: extends every cell of the
// "Остаток" grid in Склад товаров to also recognize Тип="Инвентаризация".
// Safe to re-run — it always sets the same formula text.
function extendGoodsStockFormulaForInventory() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const totalColIndex = header.indexOf('Итого') + 1; // 1-based; 0 if absent
  const lastLocationCol = totalColIndex > 0 ? totalColIndex - 1 : lastCol;

  if (lastLocationCol < 2) {
    throw new Error('Не нашёл ни одной колонки-точки между "Товар" и "Итого" — проверь структуру листа перед повтором.');
  }

  const newFormula =
    "=СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Производство\";'Реестр товаров'!$H:$H;B$1)" +
    "+СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Перемещение\";'Реестр товаров'!$H:$H;B$1)" +
    "+СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Возврат\";'Реестр товаров'!$H:$H;B$1)" +
    "+СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Заказ у поставщиков\";'Реестр товаров'!$H:$H;B$1)" +
    "+СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Инвентаризация\";'Реестр товаров'!$H:$H;B$1)" +
    "-СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Перемещение\";'Реестр товаров'!$G:$G;B$1)" +
    "-СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Продажа\";'Реестр товаров'!$G:$G;B$1)" +
    "-СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Возврат\";'Реестр товаров'!$G:$G;B$1)" +
    "-СУММЕСЛИМН('Реестр товаров'!$E:$E;'Реестр товаров'!$D:$D;$A2;'Реестр товаров'!$F:$F;\"Инвентаризация\";'Реестр товаров'!$G:$G;B$1)";

  sheet.getRange(2, 2).setFormula(newFormula); // B2
  sheet.getRange(2, 2).copyTo(sheet.getRange(2, 2, lastRow - 1, lastLocationCol - 1)); // fan out B2:<lastLocationCol><lastRow>

  Logger.log('✅ Формула остатка обновлена: ' + (lastLocationCol - 1) + ' точек × ' + (lastRow - 1) + ' товаров.');
}
```

- [ ] **Step 2: Push**

```bash
cd Yonda/AppScripts && clasp push
```
(use `clasp push --force` if plain push reports "Skipping push.")

- [ ] **Step 3: ⚠️ MANUAL — run and verify no numbers moved**

Before running, note down 3-4 current values from `Склад товаров` (any
product/location cells, e.g. "О маме" × "Основной склад"). Then: open the
Apps Script editor, select `extendGoodsStockFormulaForInventory` from the
function dropdown, click Run, check the Execution log for the ✅ message.

Re-check the same 3-4 cells in `Склад товаров`. Expected: **identical
values** — since no `"Инвентаризация"` rows exist in `Реестр товаров`
yet, the two new SUMIFS terms contribute 0 everywhere. If any value
changed, STOP and report it — that means the formula text doesn't match
what's actually in this sandbox and needs re-deriving from a live cell
read, not a blind retry.

- [ ] **Step 4: Commit**

```bash
git add AppScripts/MaintenanceScripts.js
git commit -m "feat: extend Склад товаров Остаток formula to recognize Тип=Инвентаризация"
```

---

### Task 4: Inventory server functions (`InventoryService.gs`)

**Files:**
- Create: `Yonda/AppScripts/InventoryService.gs`

**Interfaces:**
- Consumes: `SHEET_GOODS_REGISTRY`, `SHEET_MATERIALS_REGISTRY`,
  `SHEET_MATERIALS_STOCK` (from `ProductionHandler.js`), `SHEET_GOODS_STOCK`
  (from Task 3's `MaintenanceScripts.js`), `GOODS_COL` (from
  `ProductionHandler.js`), `computeDelta`, `buildMaterialLedgerRow`,
  `buildGoodsLedgerRow` (from Task 2's `InventoryLogic.js` — same global
  scope, called directly, no `require`).
- Produces (consumed by Task 6's `Inventory.html` via `google.script.run`):
  - `getLocations() -> string[]` — every `Склад товаров` header column
    between "Товар" and "Итого".
  - `getMaterialsSnapshot() -> {name: string, unit: string, current: number}[]`
  - `getProductsSnapshot(location: string) -> {name: string, current: number}[]`
  - `submitInventory(kind: 'materials'|'products', location: string|null, counts: {name: string, fact: string}[], newItems: {name: string, fact: string}[]) -> {written: number}`

**Note on the `Реестр товаров` ID column (A):** its exact generation
mechanism (formula vs. manually-typed sequence) was not verified live
this session. Rather than guess an ID-assignment scheme that might
collide with an existing formula, this task deliberately leaves column A
blank (`''`) for rows it appends — consistent with "don't build what you
haven't confirmed is needed": nothing downstream reads the ID of an
`Инвентаризация` row. If a future task needs it, verify the column live
first.

- [ ] **Step 1: Write `getLocations`, `getMaterialsSnapshot`, `getProductsSnapshot`**

Create `Yonda/AppScripts/InventoryService.gs`:
```javascript
function getLocations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const locations = [];
  for (let c = 1; c < header.length; c++) {
    const name = header[c];
    if (!name || name === 'Итого') continue;
    locations.push(name);
  }
  return locations;
}

function getMaterialsSnapshot() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_MATERIALS_STOCK);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 2, lastRow - 1, 3).getValues(); // B:D
  return data
    .filter((row) => row[0])
    .map((row) => ({ name: row[0], unit: row[1] || 'шт', current: Number(row[2]) || 0 }));
}

function getProductsSnapshot(location) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colIndex = header.indexOf(location); // 0-based
  if (colIndex < 1) throw new Error('Точка не найдена в Склад товаров: ' + location);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const names = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const values = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();

  const items = [];
  for (let i = 0; i < names.length; i++) {
    if (!names[i][0]) continue;
    items.push({ name: names[i][0], current: Number(values[i][0]) || 0 });
  }
  return items;
}
```

- [ ] **Step 2: ⚠️ MANUAL — verify against the live sheet before continuing**

Push (`cd Yonda/AppScripts && clasp push`), open the Apps Script editor,
select `getLocations` from the function dropdown, click Run, check the
Execution log's return value via `Logger.log(getLocations())` — add a
one-line temporary wrapper if the dropdown doesn't show return values
directly:
```javascript
function debugGetLocations() { Logger.log(JSON.stringify(getLocations())); }
```
Run `debugGetLocations`, confirm the log shows the 6 expected location
names in order (Основной склад, Teplo Store (TAS), Human House, UzPost,
Ethno Gallery, Teplo Store (SKD)) with no "Итого" and no blanks. Delete
`debugGetLocations` afterward (don't push a debug helper permanently).

- [ ] **Step 3: Write `submitInventory` and its two kind-specific helpers**

Append to `Yonda/AppScripts/InventoryService.gs`:
```javascript
function submitInventory(kind, location, counts, newItems) {
  const dateStr = Utilities.formatDate(new Date(), 'Asia/Tashkent', 'dd.MM.yyyy');
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (kind === 'materials') return submitMaterialsInventory_(ss, counts, newItems, dateStr);
  if (kind === 'products') return submitProductsInventory_(ss, location, counts, newItems, dateStr);
  throw new Error('Неизвестный тип инвентаризации: ' + kind);
}

function submitMaterialsInventory_(ss, counts, newItems, dateStr) {
  const stockSheet = ss.getSheetByName(SHEET_MATERIALS_STOCK);
  const ledgerSheet = ss.getSheetByName(SHEET_MATERIALS_REGISTRY);
  const byName = {};
  getMaterialsSnapshot().forEach((it) => { byName[it.name] = it; });

  let written = 0;

  (counts || []).forEach((c) => {
    const item = byName[c.name];
    if (!item) return; // stale client-side data; skip rather than guess
    const delta = computeDelta(item.current, c.fact);
    if (delta === null) return;
    const row = buildMaterialLedgerRow(c.name, delta, dateStr);
    ledgerSheet.appendRow([new Date(), c.name, row.type, row.quantity, row.note]);
    written++;
  });

  (newItems || []).forEach((ni) => {
    const name = String(ni.name || '').trim();
    if (!name) return;
    if (byName[name]) {
      const delta = computeDelta(byName[name].current, ni.fact);
      if (delta === null) return;
      const row = buildMaterialLedgerRow(name, delta, dateStr);
      ledgerSheet.appendRow([new Date(), name, row.type, row.quantity, row.note]);
      written++;
      return;
    }
    const factNum = Number(ni.fact);
    if (Number.isNaN(factNum) || factNum === 0) return;
    const newRow = stockSheet.getLastRow() + 1;
    stockSheet.getRange(newRow, 2).setValue(name);  // B: Материал
    stockSheet.getRange(newRow, 3).setValue('шт');  // C: Ед.измерения (default — no unit picker in this tool)
    stockSheet.getRange('D2').copyTo(stockSheet.getRange(newRow, 4)); // D: Остаток formula
    const row = buildMaterialLedgerRow(name, factNum, dateStr);
    ledgerSheet.appendRow([new Date(), name, row.type, row.quantity, row.note]);
    written++;
  });

  return { written: written };
}

function submitProductsInventory_(ss, location, counts, newItems, dateStr) {
  const stockSheet = ss.getSheetByName(SHEET_GOODS_STOCK);
  const ledgerSheet = ss.getSheetByName(SHEET_GOODS_REGISTRY);
  const byName = {};
  getProductsSnapshot(location).forEach((it) => { byName[it.name] = it; });

  let written = 0;

  function appendGoodsRow(name, quantity, type, from, to) {
    const row = [];
    row[GOODS_COL.ID - 1] = '';
    row[GOODS_COL.DATE - 1] = new Date();
    row[GOODS_COL.REC_TYPE - 1] = 'Учёт товаров';
    row[GOODS_COL.PRODUCT - 1] = name;
    row[GOODS_COL.QTY - 1] = quantity;
    row[GOODS_COL.TYPE - 1] = type;
    row[GOODS_COL.FROM - 1] = from;
    row[GOODS_COL.TO - 1] = to;
    ledgerSheet.appendRow(row);
  }

  (counts || []).forEach((c) => {
    const item = byName[c.name];
    if (!item) return;
    const delta = computeDelta(item.current, c.fact);
    if (delta === null) return;
    const row = buildGoodsLedgerRow(delta, location, dateStr);
    appendGoodsRow(c.name, row.quantity, row.type, row.from, row.to);
    written++;
  });

  (newItems || []).forEach((ni) => {
    const name = String(ni.name || '').trim();
    if (!name) return;
    if (byName[name]) {
      const delta = computeDelta(byName[name].current, ni.fact);
      if (delta === null) return;
      const row = buildGoodsLedgerRow(delta, location, dateStr);
      appendGoodsRow(name, row.quantity, row.type, row.from, row.to);
      written++;
      return;
    }
    const factNum = Number(ni.fact);
    if (Number.isNaN(factNum) || factNum === 0) return;
    const newRow = stockSheet.getLastRow() + 1;
    stockSheet.getRange(newRow, 1).setValue(name); // A: Товар
    const lastCol = stockSheet.getLastColumn();
    stockSheet.getRange(2, 2, 1, lastCol - 1).copyTo(stockSheet.getRange(newRow, 2, 1, lastCol - 1)); // B..: formulas
    const row = buildGoodsLedgerRow(factNum, location, dateStr);
    appendGoodsRow(name, row.quantity, row.type, row.from, row.to);
    written++;
  });

  return { written: written };
}
```

- [ ] **Step 4: Push**

```bash
cd Yonda/AppScripts && clasp push
```

- [ ] **Step 5: ⚠️ MANUAL — verify with a temporary debug call**

In the Apps Script editor, temporarily add and run:
```javascript
function debugSubmitTest() {
  const result = submitInventory('materials', null, [], [{ name: 'Тестовый материал debugSubmitTest', fact: '3' }]);
  Logger.log(JSON.stringify(result));
}
```
Run it, confirm the log shows `{"written":1}`. Check the live sheet: a
new row named "Тестовый материал debugSubmitTest" should appear at the
bottom of `Склад материалов` with Остаток showing 3, and a matching
"Приход" row of quantity 3 in `Реестр материалов`. Delete both the test
row from `Склад материалов` and its ledger row from `Реестр материалов`
afterward, and delete the `debugSubmitTest` function before the next push.

- [ ] **Step 6: Commit**

```bash
git add AppScripts/InventoryService.gs
git commit -m "feat: add inventory server functions (snapshots + submitInventory)"
```

---

### Task 5: Web app shell — routing, access gate, shared styles

**Files:**
- Create: `Yonda/AppScripts/WebApp.gs`
- Create: `Yonda/AppScripts/Styles.html`
- Create: `Yonda/AppScripts/Index.html`
- Create: `Yonda/AppScripts/NoAccess.html`

**Interfaces:**
- Consumes: `isAllowedEmail` (from Task 1's `Access.js`).
- Produces: `doGet(e)` (Apps Script's web app entry point — not called
  directly by any other task, but this is what makes the deployment in
  Step 4 work), `include(filename)` (called from `<?!= include(...) ?>`
  scriptlets in every `.html` file, including Task 6's `Inventory.html`).

- [ ] **Step 1: Shared styles**

Create `Yonda/AppScripts/Styles.html`:
```html
<style>
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
</style>
```

- [ ] **Step 2: Access gate + routing**

Create `Yonda/AppScripts/WebApp.gs`:
```javascript
const ALLOWED_EMAILS = ['shuhratorifjonov29@gmail.com', 'nurakvlnk@gmail.com'];

function doGet(e) {
  const email = Session.getActiveUser().getEmail();
  if (!isAllowedEmail(email, ALLOWED_EMAILS)) {
    return HtmlService.createTemplateFromFile('NoAccess').evaluate()
      .setTitle('Yonda — нет доступа');
  }
  const page = (e && e.parameter && e.parameter.page) || 'index';
  const file = page === 'inventory' ? 'Inventory' : 'Index';
  return HtmlService.createTemplateFromFile(file).evaluate()
    .setTitle('Yonda')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
```

- [ ] **Step 3: Home screen**

Create `Yonda/AppScripts/Index.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <?!= include('Styles'); ?>
</head>
<body>
  <div class="screen" style="padding:28px 20px 24px;gap:28px;">
    <div>
      <div style="font-size:12.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:oklch(0.55 0.01 250);">Yonda</div>
      <div style="font-size:23px;font-weight:800;">Инструменты</div>
    </div>
    <a class="card-btn" href="?page=inventory">
      <div style="flex:1;">
        <div style="font-size:16px;font-weight:700;">Инвентаризация</div>
        <div style="font-size:13px;color:oklch(0.55 0.01 250);">Сверить фактические остатки</div>
      </div>
    </a>
  </div>
</body>
</html>
```

- [ ] **Step 4: Access-denied screen**

Create `Yonda/AppScripts/NoAccess.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <?!= include('Styles'); ?>
</head>
<body>
  <div class="screen" style="align-items:center;justify-content:center;padding:20px;text-align:center;gap:8px;">
    <div style="font-size:18px;font-weight:800;">Нет доступа</div>
    <div style="font-size:14px;color:oklch(0.55 0.01 250);">Этот инструмент доступен только владельцу и партнёру Yonda Cards.</div>
  </div>
</body>
</html>
```

- [ ] **Step 5: Push**

```bash
cd Yonda/AppScripts && clasp push
```

- [ ] **Step 6: ⚠️ MANUAL — create a NEW, separate deployment**

Do **not** edit or redeploy the existing deployment — it's what the
Telegram webhook (`doPost`) currently uses, configured as "Execute as:
me" / "Anyone, even anonymous" so Telegram's servers (which have no
Google identity) can call it. Reusing it for `doGet` would either break
the webhook or make the allowlist check meaningless (an anonymous caller
has no email to check).

In the Apps Script editor: **Deploy → New deployment**. Type: **Web app**.
Description: "Inventory tool". Execute as: **Me**. Who has access:
**Anyone with a Google account**. Deploy, copy the resulting `/exec` URL.

- [ ] **Step 7: ⚠️ MANUAL — verify the access gate**

Open the new URL while logged into the owner's Google account: expect the
Index screen with an "Инвентаризация" card. If a third Google account is
available, open the same URL there: expect the "Нет доступа" screen. If no
third account is available to test with, at minimum confirm the owner's
account sees Index (not NoAccess) — the negative case can be verified
later by the partner's own first open.

- [ ] **Step 8: Commit**

```bash
git add AppScripts/WebApp.gs AppScripts/Styles.html AppScripts/Index.html AppScripts/NoAccess.html
git commit -m "feat: add web app shell — email-allowlist gate, routing, home screen"
```

---

### Task 6: Inventory screen (client) — full flow, end-to-end verification

**Files:**
- Create: `Yonda/AppScripts/Inventory.html`

**Interfaces:**
- Consumes (via `google.script.run`): `getLocations()`,
  `getMaterialsSnapshot()`, `getProductsSnapshot(location)`,
  `submitInventory(kind, location, counts, newItems)` — all from Task 4's
  `InventoryService.gs`. Consumes `include('Styles')` from Task 5's
  `WebApp.gs`.
- Produces: nothing further consumes this file — it's the leaf of the
  dependency graph for this plan.

- [ ] **Step 1: Write the full client screen**

Create `Yonda/AppScripts/Inventory.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <?!= include('Styles'); ?>
</head>
<body>
  <div id="app"></div>
  <script>
    var state = { screen: 'type', type: null, location: null, locations: null, items: null, facts: {}, customItems: [], changes: [] };

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
        google.script.run.withSuccessHandler(function (items) { state.items = items; render(); })
          .withFailureHandler(onError).getMaterialsSnapshot();
      };
      document.getElementById('pick-products').onclick = function () {
        state.type = 'products'; state.facts = {}; state.customItems = [];
        state.screen = 'location'; state.locations = null; render();
        google.script.run.withSuccessHandler(function (locations) { state.locations = locations; render(); })
          .withFailureHandler(onError).getLocations();
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
          state.screen = 'counting'; state.items = null; render();
          google.script.run.withSuccessHandler(function (items) { state.items = items; render(); })
            .withFailureHandler(onError).getProductsSnapshot(state.location);
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
        .filter(function (c) { return c.name && c.fact !== '' && !isNaN(Number(c.fact)); })
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
      google.script.run.withSuccessHandler(function () {
        state.screen = 'confirm'; render();
      }).withFailureHandler(function (err) {
        btn.removeAttribute('disabled'); btn.textContent = 'Сохранить';
        onError(err);
      }).submitInventory(state.type, state.location, counts, newItems);
    }

    function renderConfirm() {
      var rows = '';
      state.changes.forEach(function (chg) {
        rows += '<div class="change-row"><div style="flex:1;font-size:14px;font-weight:600;">' + escapeHtml(chg.name) + '</div>' +
          '<div style="font-size:14px;font-weight:800;color:oklch(0.45 0.14 220);">' + escapeHtml(chg.label) + '</div></div>';
      });
      var summary = state.changes.length === 0 ? 'Расхождений не найдено' : 'Обновлено позиций: ' + state.changes.length;
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
        state = { screen: 'type', type: null, location: null, locations: null, items: null, facts: {}, customItems: [], changes: [] };
        render();
      };
    }

    function onError(err) {
      alert('Ошибка: ' + (err && err.message ? err.message : err));
    }

    function escapeHtml(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }
    function backIcon() { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"></path></svg>'; }
    function plusIcon() { return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"></path></svg>'; }
    function removeIcon() { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="oklch(0.55 0.18 25)" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"></path></svg>'; }
    function checkIcon() { return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="oklch(0.4 0.14 145)" stroke-width="2.4"><path d="M5 13l4 4L19 7"></path></svg>'; }

    render();
  </script>
</body>
</html>
```

- [ ] **Step 2: Push and redeploy**

```bash
cd Yonda/AppScripts && clasp push
```
New `.html`/`.gs` files require a **new deployment version** to reach the
existing `/exec` URL — pushing alone updates the "HEAD" (editor-preview)
version, not the deployed one. In the Apps Script editor: **Deploy →
Manage deployments** → select the "Inventory tool" deployment from Task 5
→ pencil/edit icon → Version: **New version** → Deploy.

- [ ] **Step 3: ⚠️ MANUAL — end-to-end verification, materials**

Open the deployment URL on a phone (or a narrow desktop browser window).
Tap "Материалы". Pick one real material and type a Факт value different
from its shown "Сейчас". Tap "Добавить позицию", type a throwaway test
name and a quantity. Tap "Сохранить". Expected: confirm screen lists both
changes; `Реестр материалов` has one new Приход/Списание row for the
edited material and one new Приход row for the test item; `Склад
материалов` has a new row for the test item showing the entered quantity
as its Остаток. Delete the test item's row from `Склад материалов` and
its ledger row from `Реестр материалов`, and add a matching correction row
for the edited material's ledger entry (or simply re-run the tool once
more with the original value as Факт) so real stock figures aren't left
skewed by this test.

- [ ] **Step 4: ⚠️ MANUAL — end-to-end verification, products**

From the home screen, tap "Инвентаризация" → "Товары" → pick "Основной
склад". Repeat the same pattern: edit one real product's Факт, add one
throwaway "Добавить позицию" test item, Сохранить. Expected: `Реестр
товаров` gets one "Инвентаризация" row per change (Куда/Откуда =
"Основной склад" depending on sign) and `Склад товаров`'s "Основной
склад" column for the edited product now equals what was typed — spot
check by opening the sheet. The test item gets a new row in `Склад
товаров` with formulas correctly filled across ALL location columns (not
just Основной склад — confirms the `copyTo` fan-out from Step 3 of
Task 4 worked for the full row width). Clean up the same way as Step 3.

- [ ] **Step 5: Commit**

```bash
git add AppScripts/Inventory.html
git commit -m "feat: add inventory client screen (type/location/counting/confirm flow)"
```

---

## Production Hand-Off Addendum

Append to the **end** of `Yonda/docs/superpowers/plans/2026-08-31-foundation-security-and-bugfix.md`'s existing "Production Hand-Off" section (added by that plan's final-review fix wave), as part of this plan's Task 6 commit or a small follow-up commit:

- Re-run Task 3's `extendGoodsStockFormulaForInventory()` once against
  production's `Склад товаров` (same before/after spot-check).
- Copy `InventoryService.gs`, `WebApp.gs` (remember to add production's
  own two allowlist emails — they may differ from the sandbox's), and all
  4 `.html` files by hand, the same way as the Foundation plan's two file
  diffs.
- Create production's own **separate** "Inventory tool" web app
  deployment (Task 5 Step 6) — do not touch whatever deployment already
  serves production's Telegram webhook.
- Run through Task 6 Steps 3-4's verification once against production.

## Self-Review Notes

- **Spec coverage:** Covers the spec's Раздел 2 (Инвентаризация) in full,
  including the "+ Добавить позицию" requirement the user added after
  seeing the mockup (not in the original written spec text — added here
  because it was explicitly requested and approved in the design step).
  Раздел 3 (Корзина продаж) is out of scope — that's Plan 3, which will
  add `Cart.html` and its server functions onto this same `WebApp.gs`
  shell (`Index.html` already has room for a second card).
- **Placeholder scan:** No TBD/TODO. The two genuinely unresolved
  technical questions (exact `Реестр товаров` ID-column mechanism; how
  many test Google accounts are available to verify the access-denied
  path) are handled as explicit, concrete steps — verify-then-decide, or
  a stated deliberate simplification — not deferred vagueness.
- **Type/name consistency:** `getMaterialsSnapshot`/`getProductsSnapshot`
  return shapes match what `Inventory.html`'s `bindType`/`bindLocation`
  handlers consume (`{name, unit, current}` / `{name, current}`).
  `submitInventory`'s `counts`/`newItems` parameter shapes
  (`{name, fact}`) match what `onSave()` in `Inventory.html` builds and
  what `submitMaterialsInventory_`/`submitProductsInventory_` destructure.
  `GOODS_COL` keys used in `appendGoodsRow` (`ID, DATE, REC_TYPE, PRODUCT,
  QTY, TYPE, FROM, TO`) match the exact keys defined in
  `ProductionHandler.js` from the Foundation plan.

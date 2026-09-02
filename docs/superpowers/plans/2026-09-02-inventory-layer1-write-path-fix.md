# Inventory Layer-1 Write Path Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `submitProductsInventory_` write stocktake events into `Ответы на форму (1)` (Layer 1) instead of directly into `Реестр товаров` (Layer 2), and extend `Реестр товаров`'s formulas with the missing `Инвентаризация` branch, so the tool respects the sheet's mandated three-layer architecture end to end.

**Architecture:** `InventoryService.gs` builds a synthetic form-response row (mirroring what `AppScripts/Переводы.js` already does for transfers) and appends it to Layer 1. `Реестр товаров`'s existing `MAP`/`LAMBDA` formulas (Layer 2, pulling from Layer 1) gain one new `IFS` branch per column, added by hand by the repo owner in the Sheets UI. `Склад товаров` (Layer 3) needs no change — it already recognizes `Инвентаризация` from an earlier plan.

**Tech Stack:** Google Apps Script (V8), Google Sheets formulas (`ARRAYFORMULA`/`FILTER`/`MAP`/`LAMBDA`), Node's built-in test runner for `AppScripts/Lib/*.js`.

**Spec:** `docs/superpowers/specs/2026-09-02-inventory-layered-architecture-fix-design.md`

## Global Constraints

- `Ответы на форму (1)` is addressed via the existing global `SHEET_FORM` constant, already declared in `AppScripts/Уведомления через ТГ-бот.js:4` as `"Ответы на форму (1)"` — reuse it, never redeclare it (Apps Script shares one global scope across all files in a project; a second `const SHEET_FORM = ...` would throw a redeclaration error).
- `Тип записи` for stocktake rows must be exactly `"Учет товаров"` — no `ё`. This must match byte-for-byte what the live `Реестр товаров` `FILTER` formula already checks for (`{"Продажа";"Учет товаров"}`), and what `AppScripts/Переводы.js`'s own usage of this sheet already assumes throughout the codebase.
- `AppScripts/Lib/InventoryLogic.js`'s `buildGoodsLedgerRow(delta, location, dateStr)` does **not** change — same signature, same return shape `{type, from, to, quantity, note}`, same tests in `AppScripts/Lib/InventoryLogic.test.js`. Only the caller stops using `.type`/`.note`.
- `Реестр товаров`'s six `MAP`/`LAMBDA` formulas (`Товар`, `Количество`, `Тип`, `Откуда`, `Куда`, `Примечание`) are edited by the **repo owner, by hand, in the Google Sheets UI** — never by Apps Script. This project has broken live `ARRAYFORMULA`/spill-range formulas twice already this session by editing them programmatically; there is no exception here.
- `Ответы на форму (1)` column layout (confirmed live, cross-validated against `AppScripts/Переводы.js`'s own column-index usage): A=Отметка времени, B=Тип записи, T=Вид действия, Y=Товар (перемещение), Z=Количество (перемещение), AA=Откуда, AB=Куда. 1-based column numbers: B=2, T=20, Y=25, Z=26, AA=27, AB=28.
- Do **not** touch `AppScripts/Уведомления через ТГ-бот.js:38`'s `"Учёт товаров"` (with `ё`) comparison, even though it looks like the same typo this plan fixes elsewhere. It isn't safe to fix here: the function it calls, `handleStockNotification`, is not defined anywhere in the codebase, so fixing the typo would make this branch start matching real data and then crash Apps Script's `onFormSubmit` trigger with "handleStockNotification is not defined" — for every future stocktake. This is tracked as a separate, already-flagged issue; leave the line exactly as it is.
- `Реестр материалов` and `submitMaterialsInventory_` are completely out of scope for this plan — no changes.

---

### Task 1: Rewrite the products inventory write path to target Layer 1

**Files:**
- Modify: `AppScripts/InventoryService.gs`

**Interfaces:**
- Produces: `appendGoodsRow(name, quantity, from, to)` — signature changes from the current `(name, quantity, type, from, to)`; the `type` parameter is dropped (Layer 1 encodes the record's meaning via `Вид действия`, not a `Тип` cell — the `"Инвентаризация"` value is now hardcoded inside `appendGoodsRow` itself). Both call sites in `submitProductsInventory_` update to match.
- Consumes: `buildGoodsLedgerRow(delta, location, dateStr)` from `AppScripts/Lib/InventoryLogic.js` — **unchanged**, still returns `{type, from, to, quantity, note}`; this task's code reads only `.from`, `.to`, and `.quantity` from it now.
- Consumes: the global `SHEET_FORM` constant (`AppScripts/Уведомления через ТГ-бот.js:4`) — not redeclared here.

- [ ] **Step 1: Replace `appendGoodsRow` and its two call sites in `submitProductsInventory_`**

In `AppScripts/InventoryService.gs`, `submitProductsInventory_` currently starts like this:

```javascript
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
```

Replace the whole block above (from `function submitProductsInventory_` through the closing `}` of the inner `appendGoodsRow`) with:

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

Note what changed: `ledgerSheet` is gone (no longer written to directly); `appendGoodsRow` now takes 4 params instead of 5 (`type` dropped); it writes into `SHEET_FORM` via a sparse array matching `Ответы на форму (1)`'s real column layout, the same sparse-array-plus-`appendRow` pattern `AppScripts/Переводы.js` already uses safely against this same sheet.

Now update both call sites later in the same function. Change:

```javascript
    appendGoodsRow(c.name, row.quantity, row.type, row.from, row.to);
```

to:

```javascript
    appendGoodsRow(c.name, row.quantity, row.from, row.to);
```

This appears twice in `submitProductsInventory_` — once in the `(counts || []).forEach(...)` block, once in the `(newItems || []).forEach(...)` block. Update both.

- [ ] **Step 2: Push to Apps Script**

```bash
clasp push
```

- [ ] **Step 3: Independently verify the push landed**

This project's `clasp push` has repeatedly reported success without the content reaching the server. Verify via the Apps Script API directly, bypassing clasp:

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
  console.log(f.source.includes('SHEET_FORM') ? 'OK: SHEET_FORM present' : 'MISSING: SHEET_FORM not found — push did not land');
  console.log(f.source.includes('Учёт товаров') ? 'BAD: old ё-spelling still present' : 'OK: no ё-spelling left');
});
"
```

Expected: `OK: SHEET_FORM present` and `OK: no ё-spelling left`. If either check fails, re-push with `clasp push -f` and re-verify — do not proceed until both checks pass.

- [ ] **Step 4: Commit**

```bash
git add AppScripts/InventoryService.gs
git commit -m "fix: write products inventory events into Ответы на форму (1) (Layer 1) instead of Реестр товаров (Layer 2)"
```

- [ ] **Step 5: Report DONE_WITH_CONCERNS**

This task's correctness can only be fully confirmed once Task 2's formula changes exist — before that, a live stocktake would produce a row in `Ответы на форму (1)` that `Реестр товаров` doesn't yet know how to pick up. Note this explicitly in the report; it's expected, not a defect in this task's own code.

---

### Task 2: Give the owner the new `Реестр товаров` formulas

**Files:** None (no repo files — this task is a live collaboration with the owner, editing formulas directly in the Google Sheets UI).

**Interfaces:**
- Consumes: the row shape Task 1's `appendGoodsRow` produces (`Тип записи`="Учет товаров", `Вид действия`="Инвентаризация", product in `Товар (перемещение)`, quantity in `Количество (перемещение)`, one of `Откуда`/`Куда` filled).
- Produces: `Реестр товаров` rows with `Тип`="Инвентаризация" — Task 3's live verification depends on this being done correctly.

This task has no code to write — it's the controller relaying exact formula text to the owner, who pastes each one into the correct cell. Do not delegate this task to an implementer subagent; it requires the owner's own Google account and browser.

- [ ] **Step 1: Give the owner the six replacement formulas**

Each formula below adds exactly one new `IFS` branch — `(type="Учет товаров")*(subtype="Инвентаризация")` — inserted immediately before the final `ИСТИНА;""` fallback that already exists in each column's current formula. The owner opens `Реестр товаров`, clicks the first data-row cell in each of these six columns, and replaces its formula with the corresponding block below (the row number in `A183:A`/`S183:S` may differ in the live sheet — the owner should keep whatever row number their current formula already uses, only adding the new branch, not retyping the whole formula from scratch).

**Товар:**

```
=MAP(A183:A;S183:S;LAMBDA(a;z;
  ЕСЛИ(a="";;
    LET(
      type; ИНДЕКС(тип_записи;z);
      subtype; ИНДЕКС(вид_учёта_товаров;z);
      IFS(
        type="Продажа";
          ИНДЕКС(категория_продажа;z);
        (type="Учет товаров")*(subtype="Пополнение");
          ИНДЕКС(товар_пополнение;z);
        (type="Учет товаров")*(subtype="Перемещение");
          ИНДЕКС(товар_перемещение;z);
        (type="Учет товаров")*(subtype="Инвентаризация");
          ИНДЕКС(товар_перемещение;z);
        ИСТИНА;""
      )
    )
  )
))
```

**Количество:**

```
=MAP(A183:A;S183:S;LAMBDA(a;z;
  ЕСЛИ(a="";;
    LET(
      type; ИНДЕКС(тип_записи;z);
      subtype; ИНДЕКС(вид_учёта_товаров;z);
      IFS(
        type="Продажа";
          ИНДЕКС(количество_продажа;z);
        (type="Учет товаров")*(subtype="Пополнение");
          ИНДЕКС(количество_пополнение;z);
        (type="Учет товаров")*(subtype="Перемещение");
          ИНДЕКС(количество_перемещение;z);
        (type="Учет товаров")*(subtype="Инвентаризация");
          ИНДЕКС(количество_перемещение;z);
        ИСТИНА;""
      )
    )
  )
))
```

**Тип:**

```
=MAP(A183:A;S183:S;LAMBDA(a;z;
  ЕСЛИ(a="";;
    LET(
      type; ИНДЕКС(тип_записи;z);
      subtype; ИНДЕКС(вид_учёта_товаров;z);
      IFS(
        type="Продажа";
         "Продажа";
        (type="Учет товаров")*(subtype="Пополнение");
          ИНДЕКС(тип_операции;z);
        (type="Учет товаров")*(subtype="Перемещение");
          "Перемещение";
        (type="Учет товаров")*(subtype="Инвентаризация");
          "Инвентаризация";
        ИСТИНА;""
      )
    )
  )
))
```

**Откуда:**

```
=MAP(A183:A;S183:S;LAMBDA(a;z;
  ЕСЛИ(a="";;
    LET(
      type; ИНДЕКС(тип_записи;z);
      subtype; ИНДЕКС(вид_учёта_товаров;z);
      IFS(
        type="Продажа";
          "Основной склад";
        (type="Учет товаров")*(subtype="Пополнение");
          "";
        (type="Учет товаров")*(subtype="Перемещение");
          ИНДЕКС(Form_Responses[Откуда];z);
        (type="Учет товаров")*(subtype="Инвентаризация");
          ИНДЕКС(Form_Responses[Откуда];z);
        ИСТИНА;""
      )
    )
  )
))
```

**Куда:**

```
=MAP(A183:A;S183:S;LAMBDA(a;z;
  ЕСЛИ(a="";;
    LET(
      type; ИНДЕКС(тип_записи;z);
      subtype; ИНДЕКС(вид_учёта_товаров;z);
      IFS(
        type="Продажа";
          "";
        (type="Учет товаров")*(subtype="Пополнение");
          "Основной склад";
        (type="Учет товаров")*(subtype="Перемещение");
          ИНДЕКС(Form_Responses[Куда];z);
        (type="Учет товаров")*(subtype="Инвентаризация");
          ИНДЕКС(Form_Responses[Куда];z);
        ИСТИНА;""
      )
    )
  )
))
```

**Примечание:**

```
=MAP(A183:A;S183:S;LAMBDA(a;z;
  ЕСЛИ(a="";;
    LET(type; ИНДЕКС(тип_записи;z);
      subtype; ИНДЕКС(вид_учёта_товаров;z);
      IFS(
        type="Продажа";
          ИНДЕКС(примечание_продажа;z);
        (type="Учет товаров")*(subtype="Пополнение");
          ИНДЕКС(Form_Responses[Примечание (пополнение)];z);
        (type="Учет товаров")*(subtype="Перемещение");
          "";
        (type="Учет товаров")*(subtype="Инвентаризация");
          "";
        ИСТИНА;""
      )
    )
  )
))
```

- [ ] **Step 2: Owner verifies existing rows are unaffected**

After pasting each formula, the owner spot-checks a few existing `Продажа`/`Пополнение`/`Перемещение` rows in `Реестр товаров` — same values as before the edit, for that specific column. This confirms the new branch was added without disturbing the existing ones (the new `IFS` branch only matches `subtype="Инвентаризация"`, which no existing row has, so nothing already there should change).

- [ ] **Step 3: Report back to the controller**

Owner confirms all six formulas are pasted and step 2's spot-check passed. No git commit for this task (nothing in the repo changes) — the controller records completion in its own tracking.

---

### Task 3: Live end-to-end verification + Production Hand-Off

**Files:**
- Modify: `docs/superpowers/plans/2026-09-02-inventory-layer1-write-path-fix.md` (this file — add the Production Hand-Off section below)

**Interfaces:** None — this task is verification and documentation, no further code changes.

- [ ] **Step 1: Live end-to-end test (owner)**

Through the already-deployed GitHub Pages tool (`https://yondacards.github.io/yonda/`), the owner runs a real stocktake for one product with a nonzero delta (either direction), for one location.

- [ ] **Step 2: Confirm the row landed in Layer 1, not Layer 2**

Owner opens `Ответы на форму (1)`, confirms the newest row has `Тип записи`="Учет товаров", `Вид действия`="Инвентаризация", the correct product name in `Товар (перемещение)`, the correct magnitude in `Количество (перемещение)`, and exactly one of `Откуда`/`Куда` filled (matching the direction of the count: `Куда` if the count went up, `Откуда` if it went down).

- [ ] **Step 3: Confirm Layer 2 picked it up automatically**

Owner opens `Реестр товаров`, confirms a new row appeared (no manual action needed — pure formula recalculation) with `Тип`="Инвентаризация" and the same product/quantity/Откуда-Куда as Layer 1.

- [ ] **Step 4: Confirm Layer 3 reflects the new stock**

Owner opens `Склад товаров`, confirms the product's stock in the counted location now matches what was entered as the physical count.

- [ ] **Step 5: Confirm no spurious trigger firing**

Owner opens the Apps Script project's **Executions** log (View → Executions, or the Executions icon in the left sidebar), filters to the last few minutes, and confirms neither `onEditProduction` nor `handleProduction` fired for this event (per the spec, they shouldn't — this step is confirming that expectation against the real system rather than trusting the reasoning alone).

- [ ] **Step 6: Write the Production Hand-Off section**

Once Steps 1-5 all pass, append this section to the end of this plan file:

```markdown
## Production Hand-Off

This plan was built and verified against the sandbox Google Sheet/Apps
Script project. To apply the same changes to the real production system:

1. **Copy the code**, using `git show` on this plan's commits as the
   reference: `AppScripts/InventoryService.gs`'s rewritten
   `submitProductsInventory_`/`appendGoodsRow`.
2. **Paste the same six formula changes** into production's own `Реестр
   товаров` — same process as Task 2 here: the owner edits them by hand
   in the Sheets UI, never via script. Confirm production's `Реестр
   товаров` already has the same `Продажа`/`Пополнение`/`Перемещение`
   formula structure this plan assumed for the sandbox before assuming
   the six blocks above apply unmodified — if production's formulas
   differ in any way (different named ranges, different row structure),
   adapt the new branch to match production's actual structure rather
   than copy-pasting blindly.
3. **Confirm production's `Склад товаров`** already recognizes
   `"Инвентаризация"` as a `Тип` value (per the earlier plan that added
   this) — if production never got that update, do it first (see that
   plan's own hand-off notes).
4. **Push and independently verify**, same as Task 1's Step 3 here —
   don't trust `clasp push`'s stdout alone.
5. **Verify**: repeat Task 3's Steps 1-5 against production, with the
   owner.
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-09-02-inventory-layer1-write-path-fix.md
git commit -m "docs: add Production Hand-Off section"
```

- [ ] **Step 8: Report DONE**

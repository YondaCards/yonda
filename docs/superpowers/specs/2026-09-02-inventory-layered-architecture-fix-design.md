# Inventory Tool: Layer-1 Write Path Fix — Design Spec

## Problem

The spreadsheet backing Yonda Cards' accounting has a strict three-layer
architecture the owner explicitly designed and expects all tooling to
respect:

- **Layer 1** (the only layer anything ever writes into directly):
  `Ответы на форму (1)` — every business event, from any source (the
  Google Form, or any Apps Script tool), is appended here as one raw row.
- **Layer 2** (formulas only, reading Layer 1): `Реестр товаров`,
  `Реестр материалов`, `Операции`.
- **Layer 3** (formulas only, reading Layer 2): `Склад товаров`,
  `Склад материалов`, `P&L`, `Счета`.

`AppScripts/InventoryService.gs`'s `submitProductsInventory_` (built in
the Inventory Web App plan) violates this: its `appendGoodsRow` helper
calls `ledgerSheet.appendRow(...)` directly against `Реестр товаров` — a
Layer 2 sheet — skipping Layer 1 entirely. This was discovered when the
owner ran a real stocktake and the resulting numbers didn't reconcile the
way the rest of the system does (the specific stocktake in question turned
out to be a client-side misunderstanding, not caused by this bug — but the
architecture violation is real regardless and needs fixing before it causes
an actual data problem).

A related, previously undiscovered gap: `Реестр товаров`'s Layer 1→2
formulas have never had a branch for stocktake events at all — `Тип
записи`="Учет товаров" splits into `Вид действия`="Пополнение" (covers
Производство/Возврат/Заказ у поставщиков, selected via `Тип операции`) and
`Вид действия`="Перемещение", but never "Инвентаризация". Meanwhile
`AppScripts/MaintenanceScripts.js`'s `extendGoodsStockFormulaForInventory()`
(from an earlier plan) already extended the Layer 3 `Склад товаров`
formula to recognize a `"Инвентаризация"` value in `Реестр товаров`'s
`Тип` column — that formula has been waiting for a Layer 2 producer that
never existed. `submitProductsInventory_`'s direct Layer 2 write was the
workaround that let the tool ship without that piece being built.

## Scope

**In scope:** fixing `Товары` (products) only. `Реестр товаров` already
has a working Layer 1→2 formula system (for `Продажа`, `Пополнение`,
`Перемещение`) that this plan extends with one more branch.

**Out of scope:** `Реестр материалов` has no Layer 1→2 formulas at all
yet — designing that system from scratch is a separate, later piece of
work. `submitMaterialsInventory_` keeps writing directly to `Реестр
материалов` unchanged, exactly as it does today. This is a known,
accepted gap for now, not silently ignored — it's tracked as future work.

Also out of scope, found while investigating this fix but unrelated to it
(flagged separately, not touched here): `AppScripts/ProductionHandler.js`'s
`handleProduction` reads `e.values` by column index using what looks like a
stale, pre-restructuring layout of `Ответы на форму (1)` — its
`type !== 'Производство'` check very likely never matches against the
current 28-column form, so automatic material write-off on production
probably doesn't fire via the form submission path anymore. This needs its
own investigation with the owner; not part of this fix.

## Architecture

```
Owner counts stock -> WebFrontend/GitHub Pages tool -> Apps Script API
                                                              |
                                                              v
                                              submitProductsInventory_
                                                              |
                                                              v
                                              appendRow into "Ответы на
                                              форму (1)" (Layer 1) --
                                              mimicking what a real Google
                                              Form submission would write
                                                              |
                                          (spreadsheet formula recalc --
                                           automatic, no trigger needed)
                                                              v
                                              "Реестр товаров" (Layer 2)
                                              picks up the new row via
                                              its existing FILTER +
                                              MAP/LAMBDA formulas, which
                                              gain one new branch
                                                              |
                                          (already-existing Layer 2->3
                                           formula, untouched)
                                                              v
                                              "Склад товаров" (Layer 3)
                                              -- already recognizes
                                              "Инвентаризация" as a Тип
                                              value; no change needed
```

This mirrors a pattern already established elsewhere in this codebase:
`AppScripts/Переводы.js`'s `handleTransfer` builds a synthetic row and
`appendRow`s it into `Ответы на форму (1)` to represent one money transfer
as two ledger entries. `submitProductsInventory_`'s fix follows the same
shape.

## Why this is safe against the sheet's existing triggers

Two installable triggers already watch parts of this data flow
(`AppScripts/ProductionHandler.js`):

- `onEditProduction` (`onEdit`, bound to `Реестр товаров`) fires only on a
  **manual, human edit** to that sheet's `Тип` column. Apps Script's
  `onEdit` never fires from formula recalculation — so neither the
  existing `Продажа`/`Пополнение`/`Перемещение` rows nor the new
  `Инвентаризация` rows (all formula-populated) can trigger it. Confirmed
  by reading the live code, not assumed.
- `handleProduction` (`onFormSubmit`) fires only on a genuine submission
  through the actual Google Form UI. `submitProductsInventory_`'s
  `appendRow` call against `Ответы на форму (1)` is a plain Apps Script
  write, not a Form submission, so this trigger does not fire for it
  either — confirmed via the same reasoning Apps Script applies to
  `Переводы.js`'s already-working `appendRow` calls into the same sheet.

So the new write path introduces no risk of misfiring either trigger, and
no change to either trigger is needed.

## Layer 1 row shape for a stocktake event

Confirmed against the live `Ответы на форму (1)` header row (28 columns,
cross-validated against `AppScripts/Переводы.js`'s existing column-index
usage, which matches exactly):

| Column | Letter | Value for an Инвентаризация row |
|---|---|---|
| Отметка времени | A | `new Date()` |
| Тип записи | B | `"Учет товаров"` (no `ё` — see below) |
| Вид действия | T | `"Инвентаризация"` (new value) |
| Товар (перемещение) | Y | product name |
| Количество (перемещение) | Z | `Math.abs(delta)` |
| Откуда | AA | the location, if `delta < 0`; else blank |
| Куда | AB | the location, if `delta > 0`; else blank |
| *(everything else)* | | blank |

**Reusing the existing `Товар (перемещение)`/`Количество (перемещение)`/
`Откуда`/`Куда` columns**, rather than adding dedicated form columns —
confirmed with the owner. A stocktake event has the identical shape to a
transfer (one product, one magnitude, one-sided from-or-to), and no single
form row is ever simultaneously a transfer and a stocktake, so there's no
collision. The two record types stay distinguishable downstream purely via
`Вид действия` (`"Перемещение"` vs `"Инвентаризация"`), which is what the
Layer 2 formula's new branch keys on.

**The `ё` fix:** the Layer 1→2 `FILTER` formula's accepted `Тип записи`
values are `{"Продажа";"Учет товаров"}` — no `ё`. The current
`InventoryService.gs` code writes `'Учёт товаров'` (with `ё`) directly
into `Реестр товаров`'s own `REC_TYPE` column — a value that was never
actually validated against this filter (since that write bypassed Layer 1
entirely). Fixing the write path to go through Layer 1 makes this
mismatch load-bearing: the plan must write `"Учет товаров"` (no `ё`) to
match the live, working formula, and the codebase's other reference(s) to
the `ё` spelling need to be found (grep) and reconciled during
implementation — matching the formula is the correct direction, since
that formula already works today for `Продажа` and can't safely be
hand-edited without risk (per this project's own hard-won lesson from
directly-scripted formula edits breaking spill ranges twice already).

## Layer 2 formula change

`Реестр товаров`'s existing `Товар`/`Количество`/`Тип`/`Откуда`/`Куда`/
`Примечание` columns are each a `MAP`/`LAMBDA` formula with an `IFS`
branching on `type` (Тип записи) and `subtype` (Вид действия). Each of
the six gets exactly one new branch, inserted before the final
`ИСТИНА;""` fallback:

```
(type="Учет товаров")*(subtype="Инвентаризация");
  <see per-column value below>;
```

| Column | New branch's value |
|---|---|
| Товар | `ИНДЕКС(товар_перемещение;z)` — same source as the Перемещение branch |
| Количество | `ИНДЕКС(количество_перемещение;z)` — same source as the Перемещение branch |
| Тип | `"Инвентаризация"` (hardcoded — this is what makes the new type distinguishable from Перемещение downstream, even though both branches read the same underlying form columns) |
| Откуда | `ИНДЕКС(Form_Responses[Откуда];z)` — same source as the Перемещение branch |
| Куда | `ИНДЕКС(Form_Responses[Куда];z)` — same source as the Перемещение branch |
| Примечание | `""` — matches what the Перемещение branch already outputs (blank); the `Тип` column already conveys that this is a stocktake adjustment, so no separate note is needed |

**These six formula edits are made by the owner, by hand, in the Google
Sheets UI** — not by Apps Script. This project has twice broken live
`ARRAYFORMULA`/spill-range formulas this session by editing them
programmatically; the plan gives the owner the exact, complete replacement
formula text for each of the six cells to paste in directly, with a
live before/after check after each one (matching the verification style
already established for `MaintenanceScripts.js`'s one-time formula
extension in an earlier plan).

## Apps Script changes

`AppScripts/InventoryService.gs`'s `submitProductsInventory_`:

- Drop the `ledgerSheet` variable (`Реестр товаров` is no longer written
  to directly).
- Rewrite `appendGoodsRow` to build the Layer 1 row shape above and
  `appendRow` it into the sheet named by the existing global
  `SHEET_FORM` constant (already declared in
  `AppScripts/Уведомления через ТГ-бот.js:4` as
  `"Ответы на форму (1)"` — reused, not redeclared, matching this
  project's established convention for shared Apps Script globals).
- `buildGoodsLedgerRow` (in `AppScripts/Lib/InventoryLogic.js`) is
  **unchanged** — it still returns `{type, from, to, quantity, note}`;
  the rewritten `appendGoodsRow` just stops using `.type` and `.note`
  (Layer 1 encodes the type via `Вид действия`, not a `Тип` cell, and the
  note is intentionally dropped to match the Перемещение branch's blank
  output). No test changes needed for `InventoryLogic.test.js` — its
  existing assertions on `buildGoodsLedgerRow`'s return shape stay valid.
- Every other reference to `'Учёт товаров'` (with `ё`) in `AppScripts/`
  needs to be found (grep, project-wide) and reconciled to `'Учет
  товаров'` (no `ё`) as part of this same task, since a mismatch here
  would now be load-bearing (the Layer 1→2 filter silently drops
  unmatched rows) rather than merely cosmetic.

`getLocations`/`getMaterialsSnapshot`/`getProductsSnapshot` (the read
path) are **unchanged** — they already read from `Склад товаров`/`Склад
материалов` (Layer 3), which was never the problem.

## Testing

No new Node-testable logic — `buildGoodsLedgerRow` is unchanged, and the
new `appendGoodsRow` is Apps-Script-only (depends on `SpreadsheetApp`).
Verification is live, by the owner, same pattern as every other live
check in this project:

1. Owner pastes the six updated formulas into `Реестр товаров`,
   confirms existing rows (`Продажа`/`Пополнение`/`Перемещение`) still
   display correctly (spot-check a few, per-column, against what was
   there before).
2. Run a real stocktake through the GitHub Pages tool for one product
   with a nonzero delta.
3. Confirm the new row lands in `Ответы на форму (1)` (not `Реестр
   товаров`) with `Тип записи`="Учет товаров", `Вид действия`=
   "Инвентаризация", the product/quantity/Откуда-or-Куда values matching
   the entered count.
4. Confirm `Реестр товаров` picks it up automatically (no manual action)
   with `Тип`="Инвентаризация" and the same product/quantity/Откуда-Куда.
5. Confirm `Склад товаров`'s per-location stock for that product updates
   correctly (this formula was already extended to recognize
   "Инвентаризация" in an earlier plan — this step confirms that
   extension finally has real data flowing to it, end to end for the
   first time).
6. Confirm `onEditProduction`/`handleProduction` did not fire
   spuriously (check the Apps Script Executions log — no unexpected
   invocation for this event).

## Production hand-off

This fix, once validated in the sandbox, needs to be replicated in the
real production Google Sheet + Apps Script project — the six formula
edits in production's own `Реестр товаров`, and the same
`InventoryService.gs`/`InventoryLogic.js` code changes. Follows the same
established convention as this project's other plans (see
`docs/superpowers/plans/2026-08-31-foundation-security-and-bugfix.md`
and `docs/superpowers/plans/2026-09-01-github-pages-migration.md`'s own
"Production Hand-Off" sections) — written out fully in the implementation
plan's own hand-off section once the sandbox version is validated.

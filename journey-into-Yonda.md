# Journey Into Yonda

*A development history reconstructed from git log, commit diffs, and this
repository's own spec/plan/SDD-ledger documents — not from claude-mem's
observation timeline. See the "A Note on Sources" section at the end for
why.*

## Project Genesis

Yonda Cards is a home-production business in Tashkent — cards, albums, and
interactive photobooks, sold through Instagram, individual orders, and five
consignment points around the city (Teplo Store TAS/SKD, Human House,
UzPost, Ethno Gallery). By the time this repository's first commit landed
on **August 31, 2026 at 17:23**, the business already had a working — if
uncomfortable — Google Sheets-based accounting system: a spreadsheet called
"test Yonda фин учет" wired to a Google Form ("Учет Yonda Cards") and a
handful of Apps Script automations (Telegram notifications, a daily
financial report, automatic material write-off on production).

That first commit, `40c55a6`, is a pure baseline: `clasp clone-script` pulls
the live Apps Script project into git for the first time, alongside the
first spec document,
[`2026-08-31-inventory-and-sales-tools-design.md`](docs/superpowers/specs/2026-08-31-inventory-and-sales-tools-design.md).
That spec is worth dwelling on, because it sets up almost everything that
follows: it documents the existing sheet's architecture (`Реестр
товаров`/`Реестр материалов` as ledgers, `Склад товаров`/`Склад материалов`
as formula-driven stock views), names two real problems (`inventory
counting requires manually computing a correcting delta`, and `sales
write-offs are so inconvenient that stock tracking has effectively been
abandoned — negative stock values already exist in the sheet`), and flags a
bug the owner suspected but hadn't confirmed: `onEditProduction`, the
trigger meant to write off materials when "Производство" is typed into a
row, appeared to be watching the wrong spreadsheet column.

Notably, the spec's own accounting of the codebase warns that "file names
don't match their contents" — a legacy confusion the project deliberately
chose not to clean up. `ProductionHandler.js` turned out to hold the
Telegram/order-notification code, and the file actually named
`Уведомления через ТГ-бот.js` ("Notifications via TG-bot") turned out to
hold the production/material write-off logic. This mismatch is corrected
in naming only inside the plan documents' heads, never in the filesystem —
a conscious decision to avoid unnecessary churn, revisited and reconfirmed
several times across the project's three-day life.

## Architectural Evolution

The project's architecture moved through three distinct phases, each
triggered by a concrete failure rather than by speculative design.

**Phase 1 — Foundation (Aug 31 17:23 → Sep 1 13:55).** Before any feature
work, the first plan
([`2026-08-31-foundation-security-and-bugfix.md`](docs/superpowers/plans/2026-08-31-foundation-security-and-bugfix.md))
does three things: gets `clasp push`/`clasp pull` working from a real git
repo, moves the hardcoded Telegram bot token and chat ID out of source and
into `PropertiesService.getScriptProperties()` (commit `6bdf1e9`), and
fixes the `onEditProduction` column bug the spec had flagged but not yet
confirmed (commit `e732087` — the trigger was checking column C, "Тип
записи", when the "Производство" value actually lands in column F, "Тип").
A same-day follow-up commit (`464e46c`) scrubs a literal copy of the
Telegram token that had leaked into the plan document itself while writing
it up — an early, small instance of a pattern that recurs throughout the
project: security review catching things that slipped past the first pass.

**Phase 2 — The Inventory Web App (Sep 1 14:55 → 20:24).** With the
foundation stable, [Plan
2](docs/superpowers/plans/2026-09-01-inventory-web-app.md) builds an
entirely new tool from scratch: a mobile Google Apps Script Web App
(`doGet`, `HtmlService`) gated by an email allowlist
(`shuhratorifjonov29@gmail.com`, `nurakvlnk@gmail.com`), that lets the
owner or partner walk through a stocktake and have the delta write itself
to the right ledger automatically — including registering brand-new items
that don't exist in the catalog yet. This phase established the project's
lasting split between pure, Node-testable business logic
(`AppScripts/Lib/*.js`, unit tested with `node --test`) and Apps-Script-only
glue that touches `SpreadsheetApp` directly. It also produced the first
genuinely hard bug of the project (see Key Breakthroughs, below) and ended
with a substantial final-review fix wave (`06a49345`) — six distinct
issues closed in one commit, from a broken `npm test` script path to a
missing `Итого` (Total) formula on newly registered products.

**Phase 3 — GitHub Pages Migration (Sep 1 20:53 → Sep 2 01:21).** The
Inventory tool shipped, worked in testing — and then rendered as a
completely blank screen on the owner's own iPhone. The [migration design
spec](docs/superpowers/specs/2026-09-01-github-pages-migration-design.md)
explains the diagnosis bluntly: static HTML rendered fine, but inline
`<script>` execution never ran inside the nested iframe that Apps Script's
`HtmlService` wraps every page in on `script.googleusercontent.com` — a
client-side rendering failure specific to that hosting mechanism, isolated
through "systematic-debugging" in a prior session, reproduced on one real
device, with no deeper root cause found on the device side. Rather than
chase an undocumented sandboxing quirk, the decision was to route around
it entirely: re-host the tool's frontend as a static site on GitHub Pages,
talking to the same Apps Script backend as a JSON API secured by Google
Identity Services sign-in (a client-side ID token, verified server-side
against Google's `tokeninfo` endpoint). This is the single largest
architectural pivot in the project's history, and it produced its own hard
problem — a same-file-scope collision between the new API's `doPost` and
the pre-existing Telegram webhook's `doPost` (see below).

**Phase 4 — The Layer Violation Fix (Sep 2 12:57 → 14:16, and ongoing).**
The newest and still-open thread. A [design
spec](docs/superpowers/specs/2026-09-02-inventory-layered-architecture-fix-design.md)
documents a three-layer architecture the owner had designed for the sheet
— **Layer 1** (`Ответы на форму (1)`, the only sheet anything ever writes
into directly), **Layer 2** (formula-driven ledgers reading Layer 1), and
**Layer 3** (formula-driven stock/PnL views reading Layer 2) — and
identifies that Plan 2's `submitProductsInventory_` had quietly violated
it, writing straight into `Реестр товаров` (Layer 2) instead of going
through Layer 1 like every other event source does. The fix (commit
`3d9dfe0`) rewrites the write path to append a synthetic form-response row
into Layer 1, mirroring a pattern `Переводы.js`'s `handleTransfer` already
used safely for money transfers. As of the last commit this report covers,
that fix is landed and committed, but the corresponding Layer 1→2 formula
branch — six `MAP`/`LAMBDA` edits the *owner* must paste into
`Реестр товаров` by hand — is still pending, and the working tree carries
further **uncommitted** changes at report time: a correction to
`handleProduction`'s stale column-index assumptions (flagged as a
suspected bug in the layer1 spec itself but deliberately deferred there)
and removal of a dead `handleStockNotification` call that would otherwise
crash `onFormSubmit` the moment its guarding typo got fixed. The project's
own architecture-fix work is, in effect, actively self-correcting its own
recently-shipped feature.

## Key Breakthroughs

**The formula-locale trap (commit `d1c2259`, Sep 1 16:04).** Plan 2's Task
3 needed to extend a live spreadsheet formula programmatically via
`Range.setFormula()`. The first attempt used the formula's Russian display
name, `СУММЕСЛИМН` — what a human sees typing into this Russian-locale
sheet — and it silently stored a formula that displayed `#NAME?` /
"Неизвестная функция" until someone re-opened and re-parsed it by hand in
the UI. The fix, discovered by live testing directly against the real
sheet (not guessed), was that `setFormula()` requires the function's
canonical **English** name (`SUMIFS`), while argument separators must
still follow the sheet's own locale (semicolons, not the US comma that
English-name-plus-comma would silently misparse as the range-union
operator). The final code carries an unusually long inline comment
recording this — a rare case in the codebase where a comment exists purely
because the underlying behavior is deeply counter-intuitive and cost real
debugging time to find.

**The `doPost` collision (commits `cf273c3` and `6d14e00`, Sep 2 00:27–00:29).**
Apps Script allows exactly one `doPost` per project — every file's
top-level declarations share one global scope. The GitHub Pages migration
plan needed a new `doPost` for the JSON API, but `Уведомления через
ТГ-бот.js` already declared one for the Telegram webhook. Two `function
doPost` declarations don't throw a build error; the later-evaluated one
silently wins and the other becomes permanently, silently unreachable —
exactly the kind of bug that looks like success until a real webhook call
goes missing in production. This was caught in a plan-review pass before
implementation (the `docs:` commit at 00:27 documents the defect and the
fix design), then implemented as a single project-wide router in
`WebApp.gs` (`6d14e00`) that discriminates the two payload shapes not by
"absence of an `action` field" (which any anonymous POST could satisfy)
but by the presence of `body.update_id` — a field only a real Telegram
`Update` object carries. The Telegram handler itself was renamed to
`handleTelegramWebhook_` and hardened with its own `chat_id` check as
defense in depth, since the router now discriminates by payload shape
rather than caller identity.

**The Layer-1 architecture violation (Sep 2, design spec + `3d9dfe0`).**
Not a runtime crash, but a quieter kind of breakthrough: recognizing, while
investigating something else entirely (a stocktake whose numbers didn't
reconcile — which turned out to be a client-side misunderstanding, not a
real bug), that the actual code had a real, separate architecture
violation sitting underneath the false alarm. The fix's own spec is candid
that the false alarm and the real problem are unrelated, which is itself
notable: the investigation didn't stop once the reported symptom was
explained away.

## Work Patterns

Three days, 39 commits, an unmistakable day/night rhythm:

- **Aug 31, evening (17:23 only)** — a single baseline commit. Setup, not
  development.
- **Sep 1, morning (02:56–03:01)** — two quick security-hygiene commits,
  clearly a short session immediately after the baseline, before the main
  work day.
- **Sep 1, early afternoon (13:42–14:59)** — the bug-fix + spec-writing
  cluster: the `onEditProduction` fix, a hardening pass, plan-doc
  corrections, and Plan 2's full 1,100-line implementation plan committed
  in one go (`22ee7c5`).
- **Sep 1, mid-afternoon to evening (14:59–20:24)** — a genuine feature
  sprint: nine commits in under six hours building the Inventory web app
  top to bottom (test harness → pure logic → formula maintenance script →
  server functions → web app shell → client screen → final review fixes).
  This is the tightest, most feature-dense stretch of the whole project.
- **Sep 1, night (20:53–23:37)** — a pivot from building to *replanning*:
  the blank-iframe bug surfaces, and the entire evening becomes design-spec
  and implementation-plan writing for the GitHub Pages migration, including
  one visible flip-flop — repo visibility decided **public**, revised to
  **private** (`2eb27c0`), then reverted back to **public** again
  (`d9fd176`) with an explicit rationale captured in the commit message
  each time.
- **Sep 2, past midnight (00:27–01:21)** — the migration's implementation
  night: the `doPost` collision found and fixed, the full API auth routing
  built, the entire `WebFrontend/` static site built in one commit
  (`f53670`, 335 lines across 5 new files), then two review passes closing
  findings from a "final branch review."
- **Sep 2, midday (12:57–14:16)** — after a gap (presumably sleep), the
  architecture-fix thread: spec, plan, and the first implementation commit
  for the Layer-1 write path fix, plus the still-uncommitted
  `handleProduction`/`Уведомления` corrections this report catches mid-flight.

The pattern that repeats across all three feature phases: **spec → plan →
implementation → review-and-fix**, never skipping the review step. Several
commits exist purely to close findings from a self-review pass
(`06a49345`, `6739a8e`, `4934eb6`) — the project treats "done" as a state
reached only after an explicit review, not merely after the code runs
once.

## Technical Debt

Debt in this project is unusually well-labeled — nearly every deliberate
shortcut is written down in the same commit or plan that takes it, with an
explicit statement of when it will be paid back:

- **Misleading filenames**, taken on at the very first commit and never
  paid down (a conscious choice, reconfirmed multiple times, that renaming
  would cost more than the confusion it causes going forward).
- **`Реестр материалов` has no Layer 1→2 formula system at all** — flagged
  explicitly in the Sep 2 layer-1 fix spec as "a known, accepted gap for
  now, not silently ignored," while the parallel `Реестр товаров` system
  gets fixed. `submitMaterialsInventory_` still writes directly into Layer
  2, unchanged, on purpose.
- **The `ё`/no-`ё` typo family.** `'Учёт товаров'` (with `ё`) vs. `'Учет
  товаров'` (without) turns out to matter twice in this codebase: once as
  a load-bearing mismatch against a live `FILTER` formula (fixed as part
  of the Layer-1 rewrite), and once inside `Уведомления через ТГ-бот.js`,
  where the similar-looking `ё` line is **explicitly left alone** — fixing
  it would make the branch start matching real data and then crash
  `onFormSubmit`, because the function it calls,
  `handleStockNotification`, was never actually implemented. The Sep 2
  plan's Global Constraints call this out by name as a trap not to
  "helpfully" fix while grepping for the same pattern elsewhere — and the
  still-uncommitted working-tree change at report time appears to be
  exactly the deferred fix for this, now finally being addressed.
- **`handleProduction`'s stale column indices** — flagged in the same
  Sep 2 spec as "found while investigating this fix but unrelated to it,"
  deliberately not fixed there, and (per this session's uncommitted diff)
  now being picked up as its own piece of work.
- **The Layer-1 violation itself** was debt from the moment Plan 2 shipped
  it (`submitProductsInventory_` bypassing Layer 1 was "the workaround
  that let the tool ship without that piece being built") — paid back
  three-plus days later once its downstream consequence surfaced.

## Challenges and Debugging Sagas

The hardest problem in this project's history isn't fully visible in this
repo's own commits — it happened in a prior session referenced by the
GitHub Pages migration spec, diagnosed via "systematic-debugging": a phone
rendering a completely blank screen for a tool that worked everywhere else
tested, isolated down to "scripts inside Apps Script's `HtmlService`
iframe never execute on this device," with the underlying platform
behavior left unexplained and worked around rather than solved. That
unresolved root cause is the entire reason Phase 3 exists.

Inside this repo's own visible history, the two clearest debugging sagas
are the `SUMIFS`/`СУММЕСЛИМН` locale trap and the `doPost` collision,
both covered above — both caught by live testing against the real system
rather than by static review, and both now carry defensive comments
specifically so the next person doesn't rediscover them the hard way.

A third, quieter saga threads through several commits: **not trusting
`clasp push`'s own success report.** The Sep 2 plan's Task 1 states this
outright — "this project's `clasp push` has repeatedly reported success
without the content reaching the server" — and specifies an independent
verification step: fetch the actual deployed source via the raw Apps
Script API (`script.googleapis.com/v1/projects/.../content`) and grep it
for the expected change, rather than trusting stdout. This wasn't a
one-off precaution; it's baked into the implementation plan as a required
step, meaning it was learned once, expensively enough, to become
permanent process.

## Memory and Continuity

This project did not have claude-mem's persistent observation timeline
available to it — see the note at the end of this report. But it clearly
needed *something* to carry context across sessions, and it built its own:
a `.superpowers/sdd/` ledger per plan (gitignored, never committed), a
`progress.md` per plan that records what each dispatched implementer did
and what a subsequent reviewer found, and numbered task-brief/task-report
pairs. The Sep 2 ledger's own pre-flight section is a good example — it
opens by explicitly checking "Plan and spec authored this session (no
compaction gap) — read fresh," cross-references every pair of tasks that
share a data surface, and records a specific instruction to carry forward
into the next dispatch ("Task 1's dispatch must carry this exclusion
explicitly so the implementer doesn't 'helpfully' fix it"). In the absence
of a system like claude-mem, this project effectively hand-rolled the same
function — durable, legible, session-spanning notes — using plain files
and disciplined process instead of tooling.

## A Note on Sources (and Token Economics)

This report was written from `git log`/`git diff` and this repository's
own `docs/superpowers/` spec and plan documents (all read in full during
this session), **not** from claude-mem's observation timeline as this
skill normally requires. Investigating why turned up a real finding worth
recording: the claude-mem worker on this machine had never successfully
started, in this project's history or any other — every daily log since
this project began shows the same failure, `Bun runtime not found`,
because the worker's `bun:sqlite` dependency was never installed. The
database held exactly zero observations for any project before this
session. Bun was installed and the worker was brought up as part of
generating this report, so future sessions on this project will have real
memory — but no Token Economics / Memory ROI section could be produced
here, because there is no historical recall data to measure. That section
is a genuine "not applicable, and here's the concrete reason why," not an
omission.

## Timeline Statistics

- **Date range:** August 31, 2026, 17:23 → September 2, 2026, 14:16
  (Asia/Tashkent) — roughly 45 elapsed hours across 3 calendar days.
- **Total commits:** 39, all by one author.
- **Rough breakdown by stated intent** (from commit-message prefixes):
  `feat:` 14, `docs:` 15, `fix:` 8, `security:` 2, `chore:` 1, `harden:` 1.
  Notably, documentation commits (specs, plans, and plan-doc corrections)
  slightly outnumber feature commits — this project plans and reviews in
  writing at least as much as it writes code.
- **Largest single commits:** `22ee7c5` (Plan 2's implementation plan,
  1,100 lines), `2bd063b` (the Layer-1 fix's implementation plan, 386
  lines), `8d930165` (the GitHub Pages migration plan, 937 lines),
  `f536704` (the entire `WebFrontend/` static site, 335 lines across 5
  files in one commit).
- **Densest work window:** Sep 1, 14:59–20:24 — nine commits building the
  Inventory web app end to end in under six hours.
- **Sessions inferred from time gaps:** roughly five — the Aug 31 baseline;
  an early-morning Sep 1 security pass; a long Sep 1 afternoon/evening
  build-and-migrate-planning session; a Sep 2 past-midnight migration
  implementation session; and a Sep 2 midday architecture-fix session
  (still open, with uncommitted work, as of this report).

## Lessons and Meta-Observations

A few principles recur often enough across this history that a new
contributor should treat them as house rules, not suggestions:

1. **Never edit live spreadsheet formulas programmatically without a
   before/after spot-check against real cells.** This project broke a
   live `ARRAYFORMULA`/spill range this way, more than once, before
   adopting a hard rule (stated explicitly in the Sep 2 plan) that the
   owner pastes formula changes by hand in the Sheets UI going forward —
   Apps Script gets read access and pure-logic changes, never write access
   to formula text.
2. **Verify pushes and deployments independently of the tool's own success
   report.** `clasp push`'s stdout is not sufficient evidence; check the
   actual deployed content.
3. **The three-layer write discipline (Layer 1 only) is load-bearing, not
   a style preference.** Every new write path this project adds gets
   checked against it, and violations get found and fixed even when
   nobody was specifically looking for them.
4. **A plan is not done at "the code runs" — it's done after an explicit
   review pass**, and review findings get their own commits rather than
   being silently folded into the original change.
5. **Flag adjacent bugs; don't casually fix them.** Repeatedly, this
   project's own planning documents name a bug spotted mid-investigation,
   explicitly scope it out, and say why fixing it now would be worse than
   leaving it (most sharply: fixing the `ё` typo elsewhere would crash
   `onFormSubmit` for a function that doesn't exist). Discipline about
   scope shows up as much as discipline about correctness.

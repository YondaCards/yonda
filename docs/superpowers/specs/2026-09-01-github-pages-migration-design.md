# Inventory Tool: GitHub Pages Migration — Design Spec

## Problem

The Инвентаризация (stocktake) tool built in the previous plan renders as a
completely blank screen on the owner's phone (iPhone, Chrome/WebKit) once
the user navigates past the home screen. This was diagnosed extensively in
the prior session (systematic-debugging) and conclusively isolated: static
HTML renders fine, but inline `<script>` execution never happens inside the
nested iframe Apps Script's `HtmlService` wraps every page in
(`script.googleusercontent.com`). The server side is healthy — the
Executions log shows every call succeeding — this is a client-side
rendering failure specific to how Apps Script serves pages, reproduced on
this one device, with no further root cause found on the device side.

A plain static site has no such nested iframe. Moving the tool's frontend
off Apps Script's `HtmlService` hosting and onto GitHub Pages removes the
suspected cause entirely, without needing to find out why the phone blocks
scripts inside that specific sandbox.

## Scope

In scope: re-hosting the existing Инвентаризация tool (all 4 screens: type
select, location picker, counting, confirm) as a static page served from
GitHub Pages, backed by the same Google Sheet through a JSON API exposed by
the existing Apps Script project.

Out of scope: Корзина продаж (sales cart) — remains a separate future plan,
unaffected by this migration. No new features are being added; this is a
hosting and transport change only. The existing Apps Script HTML interface
(`Index.html`, `Inventory.html`, `NoAccess.html`, `WebApp.gs`'s current
`doGet` page-serving branch) is left in place, untouched and still
reachable at its current URL — it simply stops being the primary way the
owner opens the tool.

## Architecture

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  GitHub Pages            │  fetch  │  Apps Script Web App           │
│  (WebFrontend/, this     │ ──────► │  (new deployment, JSON API      │
│  same repo, public)      │ ◄────── │  branch added to doGet/doPost)  │
│                           │  JSON   │                                  │
│  - Google Sign-In button │         │  - verifies ID token w/ Google  │
│  - index.html, inventory │         │  - checks email against         │
│    .html, styles.css,    │         │    ALLOWED_EMAILS               │
│    auth.js, api.js       │         │  - reuses existing               │
└─────────────────────────┘         │    InventoryService.gs logic    │
                                      └──────────────┬───────────────┘
                                                      │
                                                      ▼
                                         Google Sheet (unchanged)
```

The Apps Script project keeps its existing `doGet` (page-serving,
`Session.getActiveUser()`-gated) branch exactly as-is, and gains a second
branch that only activates when the request looks like an API call. Both
branches live in the same `doGet`/`doPost` functions because an Apps Script
project has exactly one `doGet` and one `doPost` — deployments don't carry
separate code, only separate URLs and access settings. Two deployments
point at this one project: the existing one (HTML pages, Google-session
gated) and a new one (JSON API, open access — the API does its own
authorization via the ID token, so Apps Script's own access gate is set to
"Anyone").

## Repo & hosting

Everything stays in this one repo (`Yonda/`). Free GitHub Pages requires a
public repository — but this repo's git history still contains the
Telegram bot token from before Plan 1's fix (removed from the current
files, moved to `PropertiesService`, but still readable in old commits via
`git log -p`). The owner chose not to rotate that token or rewrite history
back when the repo was local-only; going public changes that calculus, so
this was re-raised explicitly. Decision: **the repo stays private**, on a
paid GitHub plan (~$4/month) that supports GitHub Pages on private repos.
This also settles the earlier question about `docs/superpowers/` plans and
specs (Sheet URL, both `ALLOWED_EMAILS` addresses) becoming publicly
readable — with a private repo, they don't.

The new static frontend lives in a new `WebFrontend/` folder at the repo
root (not `/docs` — that's already the plans/specs folder). Publishing uses
a GitHub Actions workflow (`.github/workflows/deploy-pages.yml`, using
`actions/deploy-pages`) that publishes `WebFrontend/` on every push to
`main`. This is a one-time setup; afterward, updating the live site is a
normal `git push`, nothing manual to click in GitHub's UI.

## Auth: Google Sign-In

The static page can no longer rely on `Session.getActiveUser()` — that only
works for pages Apps Script itself serves through `HtmlService`. Instead:

1. The page loads Google's Identity Services library
   (`https://accounts.google.com/gsi/client`) and renders a "Sign in with
   Google" button (via `google.accounts.id.initialize` +
   `renderButton`/One Tap).
2. On sign-in, Google hands the page a signed ID token (a JWT) containing
   the signed-in email, without any server-side OAuth exchange needed —
   this is the client-side-only flow, appropriate for a public static page
   with no backend of its own.
3. Every API call includes this ID token. The Apps Script API verifies it
   server-side by calling Google's `tokeninfo` endpoint
   (`https://oauth2.googleapis.com/tokeninfo?id_token=...` via
   `UrlFetchApp`), which validates the token's signature and expiry and
   returns its claims (`email`, `email_verified`, `aud`). The API checks
   `aud` matches the project's OAuth Client ID, `email_verified` is true,
   and `email` is in `ALLOWED_EMAILS` — the same list `WebApp.gs` already
   uses.

   Google's own docs note the `tokeninfo` endpoint isn't meant for
   high-volume server-side verification (better practice there is
   validating the JWT signature locally against Google's public keys) —
   but for a two-person internal tool making a handful of requests per
   stocktake, the extra network call per request is a non-issue, and it
   avoids needing a JWT/crypto library in Apps Script.

4. Setting up the OAuth Client ID (Google Cloud Console, "Web application"
   type, Authorized JavaScript origin = the GitHub Pages URL) is a one-time
   manual step — done together, walked through step by step, during
   implementation once the GitHub Pages URL is known.

## Apps Script API surface

Both new entry points are added to the existing `doGet`/`doPost` in
`WebApp.gs`, gated on `e.parameter.action` (GET) / a JSON body's `action`
field (POST) being present — when absent, the existing HTML-serving logic
runs unchanged.

**Reads (GET, query string only — see CORS note below):**

- `?action=getLocations&idToken=...`
- `?action=getMaterialsSnapshot&idToken=...`
- `?action=getProductsSnapshot&location=...&idToken=...`

Each maps directly to the existing function of the same name in
`InventoryService.gs` — no logic changes there, just a new caller.

**Writes (POST, body is `text/plain` containing a JSON string — see CORS
note below):**

```json
{
  "action": "submitInventory",
  "idToken": "...",
  "kind": "products",
  "location": "Точка А (ТЦ Мега)",
  "counts": [{"name": "...", "fact": "5"}],
  "newItems": [{"name": "...", "fact": "3"}]
}
```

Maps to the existing `submitInventory(kind, location, counts, newItems)` in
`InventoryService.gs`, unchanged.

**Response shape (both):** `ContentService.createTextOutput(JSON.stringify(...))`
with `setMimeType(ContentService.MimeType.JSON)`. Errors (bad token, email
not allowed, unknown action, or the wrapped function throwing) return
`{"error": "<message>"}` — the frontend checks for this field before
treating a response as success.

## CORS: why GET query strings and POST as `text/plain`

Browsers block a static page on one origin from reading a JSON response
from another origin (Apps Script's `exec` URL) unless that response allows
it. Apps Script doesn't let you set custom response headers, so the
standard, widely-used workaround — the one this design uses — is to only
ever send "simple requests" (the category of cross-origin request browsers
allow without a CORS preflight and that Apps Script's own hosting responds
to permissively): GET requests with plain query-string parameters (no
custom headers), and POST requests whose `Content-Type` is `text/plain`
(not `application/json` — that content type forces a preflight, which Apps
Script can't answer since it has no `OPTIONS` handler). The POST body is
still a JSON string; the API parses it manually with `JSON.parse` inside
`doPost`. This is why the ID token travels as a query parameter on GETs
rather than an `Authorization` header — a custom header would also trigger
a preflight.

This pattern is well-established for using Apps Script as a backend for
external static sites, but it isn't officially documented/guaranteed by
Google, so the implementation plan's first task is a small spike: stand up
a minimal test page and confirm a real GET and a real POST against the
actual (sandbox) Apps Script deployment both succeed end-to-end, before
building the rest of the frontend on top of it. If it doesn't work as
expected, that's found in fifteen minutes, not after the whole migration is
built.

## Testing

Same split as the rest of this project: `InventoryLogic.js`/`Access.js`
already have Node unit tests and don't change. The new frontend's client
logic gets the same "mocked desktop click-through" treatment used to
verify `Inventory.html` earlier — stub `fetch` instead of
`google.script.run`, exercise all 4 screens in a browser. Live verification
against the real deployment and real Google Sheet — including the OAuth
sign-in flow and the CORS spike above — is done by the owner, same as
every other live check in this project, since only they have access to the
Google account and the phone.

## Production hand-off

Same pattern as the previous two plans: this migration is built and
verified in the sandbox first. Once confirmed working, the same OAuth
Client ID setup, `WebApp.gs`/API code, and `WebFrontend/` files get
manually re-applied to the real production Apps Script project and a
production GitHub Pages URL. Deferred to this plan's own hand-off section,
written once the sandbox version is done — following the same convention
`docs/superpowers/plans/2026-08-31-foundation-security-and-bugfix.md`'s
"Production Hand-Off" section already established.

# PACT — PWA Build Plan

> Written for agentic assistants (VS Code Copilot & Claude Code). With `AGENTS.md` committed, you don't
> repeat project context — **paste one task at a time**, review the diff, accept. Each task ends with a
> **Done when** check. (Markdown copy of `RPG-PWA-Build-Plan.html` v5, kept in-repo so the prompts are at hand.)

## Already built
- Rules centralised into `js/engine.js` (single source of truth) — **DONE**
- Three tools refactored to UI-only via the module bridge — **DONE**
- Deployed to GitHub Pages from the repo root (chompy78.github.io/PACT/) — **DONE**
- Regression pack `testing/tests/engine-parity.html` → 5/5 — **DONE**

## Task 0 — Land PHB pages + drawback text (data only) — TODO
See `ENGINE-DATA-UPDATE.md`. Surgical `DATA` edit; `compute()` and `DATA.version` unchanged.
**Done when:** parity still 5/5; tooltips show "(PHB p.N)" and the fuller drawback text.

## Task 1 — PWA shell (offline + installable) — TODO
```
Make the site an installable, offline-capable PWA. Add:
- manifest.json (name, short_name, icons 192 + 512, theme/background colours,
  display: standalone, start_url and scope both "/PACT/").
- service-worker.js with a versioned CACHE_NAME that pre-caches: index.html, js/engine.js,
  every file in tools/, docs/PACT-Players-Guide.html, manifest.json, and the icons.
  Cache-first, network fallback.
- A registration snippet (navigator.serviceWorker.register) in index.html and each tool page.
- 404.html that redirects to index.html (GitHub Pages routing).
- Detect a waiting service worker and offer a non-disruptive "reload to update".
Do not change the engine or the tools' UI. Add icons/ (192, 512, apple-touch 180) as
placeholders if none exist and list what I must replace.
```
**Done when:** the browser's "installable" check passes, the site loads with no network after one visit,
and `engine-parity.html` is still 5/5.

## Task 2 — Supabase client + login — TODO
```
Add authentication with Supabase Auth.
- js/supabase-client.js: a single Supabase client instance (URL + anon key as constants I'll fill in).
- js/auth.js: email/password register + login, forgot-password (Supabase reset email), logout,
  session in localStorage.
- Include auth.js on index.html and each tool page. On load, check the session; if not signed in,
  show a plain-HTML login/register view. After login, read the user's role and route:
  Player -> tools/PACT-Live-Char-Sheet.html, DM -> tools/DM Console.html.
Vanilla JS, plain HTML only. Don't break the existing tools.
```
**Done when:** a new user can register, log in, gets routed by role, and logout returns to the login view.

## Task 3 — Cloud save & offline sync — TODO
```
Add cloud save + sync in js/sync.js.
- Save character data to Supabase (primary) and localStorage (offline fallback).
- Sync on the window "online" event and on app load when signed in + online.
- Conflict resolution: last-write-wins by updated_at; push local only if newer.
- Store ONLY raw character data in characters.stats (CharGen = build JSON; Live Sheet =
  the { LOG, SEQ, rules } event log). Never store derived stats; hydrate from stats and recompute.
- ap (the DM-awarded points column) is ALWAYS server-authoritative: never overwrite it from localStorage.
- On a failed write, keep local and retry on the next online event; never delete local until a
  server write is confirmed.
Also output sql/schema.sql and sql/rls-policies.sql for the data model.
```
**Done when:** edits persist to Supabase, survive going offline, reconcile on reconnect — `ap` never changed by a local push.

## Task 4 — Campaigns & DM AP — TODO
```
Add the campaign + DM system.
- Campaigns: one DM, no player cap; roles are PER-CAMPAIGN and may overlap (the same user can DM one
  campaign and play in another, or even play in their own). Join via a 6-char alphanumeric invite code;
  DM can regenerate the code (invalidating the old one). (See DECISIONS.md D-GH4 — this overrides the
  original "up to 5 players / joining a full campaign errors" wording.)
- The SQL backend already exists (sql/schema.sql, sql/rls-policies.sql, Task 3): joining goes through the
  join_campaign() RPC, code regen through regenerate_invite_code(), and ap is awarded via award_ap()
  (DM-only). Wire js/campaign.js / js/dm.js to those RPCs rather than writing the rows directly.
- Enforce access in Supabase RLS (not just client JS): players read/write only their own character and
  can NEVER write ap; only the campaign's DM can write ap or campaign rows. ap is locked at the COLUMN
  level (a GRANT that omits ap) plus the DM-only award_ap() RPC — not a row policy, since Postgres RLS
  cannot restrict an UPDATE to specific columns.
- Evolve tools/DM Console.html: read the campaign roster from Supabase (player name, character name,
  current AP), expand a character to read-only full stats via the engine, add an "Award AP" input that
  writes ap (DM-only).
Put join/invite logic in js/campaign.js and DM logic in js/dm.js.
```
**Done when:** a DM can award AP; a player cannot change `ap` via the UI, a local sync, or a direct REST call with their token.

## Task 5 — Audit, security & hardening — TODO
```
Audit the finished app. For each item give Pass/Fail/Warning + a fix: PWA (manifest, SW, HTTPS,
icons 192/512/180); Offline (full load no network, local save offline, sync on reconnect); RLS characters
(own-only; cannot write ap even via REST with a valid token); RLS campaigns (own campaign read; DM-only
writes; invite regen DM-only); AP integrity (DM award; player cannot overwrite via dev tools/local sync/API);
GitHub Pages (no server logic, 404.html, SW scope "/PACT/"); Security (anon key safe under RLS?, RLS bypass
via REST, invite-code brute forcing, session token in localStorage/XSS); Performance (Lighthouse mobile >= 90,
flag assets > 100KB); Regression (engine-parity 5/5).
```
**Done when:** every item is Pass (or an accepted Warning) and parity still passes.

## Supporting reference tasks (run when needed)
- **Supabase project setup** — step-by-step: create project, run `schema.sql`, apply `rls-policies.sql`,
  enable email/password auth, set reset redirect to `https://chompy78.github.io/PACT/`, store URL + anon key.
- **Icon & asset list** — exact sizes (192, 512, 180), PNG, where referenced, iOS specifics. List only.
- **Offline UX spec** — a state table (State | indicator | can do | cannot do | automatic).
- **Future features roadmap** — 5 features that fit this architecture with no server/data-model change.

## Other improvements
- Commit the instructions file (`AGENTS.md` + copies) first.
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- Eventually rename `DM Console.html` → `DM-Console.html` (cleaner URLs); update the menu link.

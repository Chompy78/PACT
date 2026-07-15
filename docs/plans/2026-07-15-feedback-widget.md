# Plan: In-app user feedback widget (Supabase-backed)

## Goal
Let any user of the PACT tool suite (CharGen, Live Sheet, DM Console, and the static Player's Guide)
submit free-text feedback from inside the app, saved to a new Supabase table. No in-app admin view in
v1 — feedback is read only via the Supabase dashboard.

## Context
PACT is a static, vanilla-JS (no build step, no framework) tabletop-RPG tool suite hosted on GitHub
Pages. It has **optional sign-in**: the app works fully offline/local-only (localStorage), and signing
in additionally saves characters to a hosted Postgres database (Supabase) protected by Row-Level
Security (RLS) — there is no other backend, and no custom server code is allowed in this repo (GitHub
Pages serves static files only).

Three of the four target pages (`tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`,
`tools/DM-Console.html`) already share one JS engine module (`js/engine.js`) via a `<script
type="module">` bridge that fires an `engine-ready` DOM event once loaded, and two of them additionally
load cloud/auth code that fires `sync-ready` / `campaign-ready`. The fourth target, `docs/PACT-Players-
Guide.html`, is a large (~657 KB) static reference page with **no existing JS module wiring of any
kind** — verified by grep, its only script is a small inline snippet for a "back to top" button.

There's a single shared Supabase client module, `js/supabase-client.js`, exporting a pre-configured
`supabase` client (publishable key, safe to ship client-side — protection comes from RLS, not from
hiding the key). All existing tables use RLS policies plus column-restricted `GRANT`s (Postgres can't
restrict UPDATE to specific columns via policy alone, so grants do that work). A repo rule: never store
derived data, never touch `js/engine.js` rules logic for a UI feature like this.

Every table currently defined only grants row access to the `authenticated` Postgres role. The `anon`
role (a user who hasn't signed in) has only schema-level `usage`, no table grants anywhere in the
current schema — **this feature would be the first case of allowing an unauthenticated database write.**

## Assumptions vs. verified facts
- **Verified (checked in the code/docs):**
  - `js/supabase-client.js` exports a ready-to-use `supabase` client; import path from both `tools/*.html`
    and `docs/*.html` is `../js/supabase-client.js` (both are direct children of the repo root).
  - `js/auth.js` exports `currentUser()` / `currentSession()` / `onAuthChange()` for reading sign-in
    state.
  - `docs/PACT-Players-Guide.html` has zero existing script/module wiring — confirmed by grep, only a
    small inline `<script>` at the very end of the body.
  - The `anon` Postgres role currently has no table-level grants anywhere in `sql/schema.sql` /
    `sql/rls-policies.sql`, only `grant usage on schema public to authenticated, anon;`.
  - Existing convention (e.g. `campaign_invites`): a new table is added directly to `sql/schema.sql` +
    `sql/rls-policies.sql` (the "fresh install" source of truth) **and** mirrored into a standalone,
    idempotent file under `sql/migrations/<date>-<slug>.sql` that patches an already-deployed database.
  - Existing convention for restricting what a client can write: `revoke`/`grant insert (col, col, ...)`
    on specific columns, e.g. `characters`'s insert grant excludes `ap`/`campaign_id` so those can only
    ever be set by a `SECURITY DEFINER` RPC — not by client-side inserts.
  - A shared `js/ui-helpers.js` (plain classic script, not a module) already provides `esc()`/`flash()`/
    `_csCopy()` to the three `tools/*.html` pages, but is **not** loaded by `docs/PACT-Players-Guide.html`.
- **Resolved during cross-review (was an open assumption in the initial draft):**
  - Whether feedback submission should be allowed **without signing in** (anon role) or should require
    an account (authenticated role only) — resolved to "allow anonymous submission." See Decision below.
- **Assumed (not yet confirmed):**
  - The client-side cooldown + length caps + DB-level `page` enum are sufficient v1 mitigation against
    casual/naive abuse of the new anon-write surface; real server-side rate limiting is deferred (see Out
    of scope). If real-world abuse exceeds this, see the fallback noted under Risks.

## Proposed approach
1. **Schema.** Add a `feedback` table to `sql/schema.sql` (and a mirrored file in `sql/migrations/`,
   using this repo's existing idempotent style — `create table if not exists`, `drop policy if exists`
   before `create policy` — so either file is safe to re-run):
   `id uuid pk default gen_random_uuid()`, `user_id uuid references profiles(id) on delete set null`
   (nullable — null for anonymous), `page text not null check (page in ('chargen','livesheet',
   'dmconsole','guide'))` (constrained at the DB level, not just by client convention), `message text
   not null check (char_length(message) between 1 and 2000)`, `contact text check (char_length(contact)
   <= 200)` (optional, free-text — e.g. an email the user chooses to type in, not a structured/required
   field; capped so it can't be used to bloat storage), `created_at timestamptz not null default now()`.
2. **RLS.** Enable RLS on `feedback`. Grant `insert (user_id, page, message, contact)` — not `id`/
   `created_at` — to **both** `authenticated` and `anon` (resolved: anonymous submission is allowed —
   see Decision below). Insert policy: `with check (char_length(message) between
   1 and 2000 and (user_id is null or user_id = auth.uid()))` — a caller can only tag a submission as
   their own `user_id`, never someone else's. **No** select/update/delete grant to either role — the
   Supabase dashboard (service-role access) is the only reader, matching the roadmap item's "no in-app
   admin view in v1."
3. **`js/feedback.js`** — a new, self-contained plain ES module (no dependency on `js/engine.js`'s
   `engine-ready` gate or on `js/ui-helpers.js`, so it works identically on all 4 pages including the
   wiring-less Player's Guide): exports `initFeedbackWidget(pageName)`, which injects a small floating
   button (fixed position, low z-index conflict risk) that opens a minimal inline form (textarea +
   optional contact field, with microcopy noting it's optional and shouldn't contain sensitive info +
   submit), imports `supabase` from `./supabase-client.js` and optionally `currentUser` from `./auth.js`
   to tag `user_id` when signed in. If signed in, the form also shows a "submit anonymously" checkbox
   (unchecked by default) so a signed-in user can still opt out of attribution — without it, a signed-in
   user would have no way to submit unattributed feedback. Submit behavior: disable the button and show
   a loading state for the duration of the request (prevents double-submit from a double click/tap); a
   simple client-side cooldown (a timestamp in `localStorage`, ~60s between submissions) blocks rapid
   repeat submissions before the request even fires — a cheap, in-scope mitigation against casual
   accidental or naive-script spam, not a substitute for real rate limiting. On failure (network error,
   timeout, Supabase unreachable, RLS rejection), show a clear inline error message rather than failing
   silently or retrying automatically; no offline queuing (explicitly out of scope, see below) — if the
   user is offline, the error message says so plainly. Basic keyboard/accessibility floor: the button and
   form are reachable by keyboard, Escape closes the form, and focus moves into the form when it opens.
4. **Wire into all 4 pages.** Add one `<script type="module">` tag near the end of `<body>` in each of
   `tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`, `tools/DM-Console.html`, and
   `docs/PACT-Players-Guide.html`, importing `js/feedback.js` and calling `initFeedbackWidget('chargen'
   | 'livesheet' | 'dmconsole' | 'guide')`. No dependency on each tool's existing `engine-ready`/`sync-
   ready` bootstrap — this runs independently and immediately.
5. Run the Supabase advisor (`get_advisors`) and skim `get_logs` before opening the PR, per this repo's
   standing rule for any RLS/schema change (stated motivation: past incidents where grant/RLS drift was
   masked by internal guards).

## Files involved
- `sql/schema.sql` — new `feedback` table definition.
- `sql/rls-policies.sql` — RLS enable + grants + insert policy for `feedback`.
- `sql/migrations/2026-07-15-feedback-widget.sql` — new, idempotent, mirrors the above for existing
  deployed databases.
- `js/feedback.js` — new shared module; the widget's DOM/logic.
- `tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`, `tools/DM-Console.html`,
  `docs/PACT-Players-Guide.html` — one new `<script type="module">` tag each.
- `CHANGELOG.md` / `DECISIONS.md` — the anon-vs-authenticated call is exactly the kind of non-obvious
  "why" this repo asks to be logged.

## Out of scope
- Any in-app admin/read UI for feedback (v1 is dashboard-only, per the roadmap item).
- Real (server-side) rate limiting, CAPTCHA, or IP-based abuse mitigation — the client-side cooldown in
  the approach above is a cheap deterrent, not a substitute for this.
- Offline queuing of a failed/unreachable submission for later retry (localStorage-backed or otherwise)
  — on failure the widget shows a clear error; the user must retry manually once back online.
- Editing or deleting one's own past feedback after submission.
- A data retention/cleanup policy for the `feedback` table (how long rows are kept, archival) — deferred;
  v1 ships with unbounded retention.
- A full accessibility audit — the approach above covers a basic keyboard/focus/Escape floor, not a
  complete screen-reader/WCAG pass.
- Any change to `js/engine.js` or game-rules logic — this is a pure add-on feature.

## Alternatives considered
- **Require sign-in to submit feedback** (drop anon entirely) — simpler trust model, zero new anon
  surface, but silently excludes every player who never creates an account, which given this app's
  "fully usable offline, sign-in optional" identity could be a large share of actual users. Rejected —
  see Decision below; this remains the documented fallback if anonymous submission proves unworkable.
- **Reuse `js/ui-helpers.js`'s `flash()` for confirmation** — would need `docs/PACT-Players-Guide.html`
  to also load that shared script (a second new wiring dependency for a page that currently has none).
  Rejected in favor of a fully self-contained widget module, to keep the Player's Guide integration to
  exactly one script tag.
- **A dedicated `feedback` Supabase Edge Function instead of a direct table insert** — would let a
  server-side function do real validation/IP-based rate-limiting. To be precise about why this is
  deferred rather than dismissed outright: Edge Functions are Supabase-native infrastructure, not the
  "custom backend code" this repo's hard rule actually prohibits (a separately-hosted server) — so this
  isn't ruled out by that rule the way, say, a Node API server would be. It's deferred for a narrower
  reason: it's a new deployment/operations surface (a function to write, test, and deploy) for a problem
  the client-side cooldown above already addresses cheaply for v1. A direct RLS-protected insert also
  matches every existing feature's data-access pattern in this repo. Worth revisiting if spam volume in
  practice exceeds what the cooldown deters.
- **GitHub Issues instead of a database table** — no new schema/RLS surface at all. Rejected: requires a
  GitHub account (most players won't have one) and issues are public by default, which doesn't fit
  free-text player feedback that may include off-hand complaints or personal framing.

## Decision
Anonymous submission is **allowed** (resolved 2026-07-15, after cross-review — see Review outcome).
Rationale: PACT's core identity is "fully usable offline, sign-in optional," and requiring an account
would silently exclude every player who never signs in from ever giving feedback. The guardrails this
plan already has — insert-only, no read/update/delete grant to any client role, a length cap, a DB-level
`page` enum, and a client-side submission cooldown — are the accepted mitigation for the resulting new
anon-write trust boundary; real server-side rate limiting is explicitly deferred (see Out of scope /
Alternatives). Log this as a `DECISIONS.md` entry during implementation (Context → Options → Decision →
Why → Status), since it's exactly the kind of non-obvious architectural call this repo asks to be logged.

## Risks / open questions
- **Anonymous writes are new to this schema.** Every other table only grants `authenticated`; `feedback`
  is now the first to also grant `anon` (see Decision above). This remains worth re-checking in practice
  after ship: if the accepted mitigations (length cap, cooldown, no read access) turn out insufficient
  against real-world abuse, tightening to sign-in-required is the documented fallback.
- **Abuse/spam volume is only lightly deterred in v1.** The client-side cooldown (~60s, localStorage)
  stops casual double-submits and naive scripts, but a motivated abuser can trivially bypass client-side
  throttling (clear localStorage, script around it). Real rate limiting is explicitly out of scope. The
  `feedback` table could still fill with junk between deploys; there's no in-app admin view to notice
  this in v1, only the Supabase dashboard.
- **Floating-button placement risk**: each of the 3 `tools/*.html` pages already has its own header/
  toolbar/floating-UI elements (verified indirectly via the existing `esc()`/`flash()`/toast-density
  work in recent PRs) — a new fixed-position button could visually collide with something per-tool.
  Needs a real per-tool visual check during implementation, not just a code read (see Verification).

## Verification
- `testing/tests/engine-parity.html` → must still report the current expected pass count (this change
  touches no engine/rules code, so it should be unaffected — run it anyway per this repo's standing
  rule for every change).
- `sql/migrations/2026-07-15-feedback-widget.sql` applied to a test project, **run twice** to confirm it's
  actually idempotent (second run errors on nothing, changes nothing); confirm via the Supabase dashboard
  that: (a) a signed-out (anon) insert succeeds and lands with `user_id = null`; (b) a signed-in insert
  succeeds and lands with the correct `user_id`; (c) a select/update/delete attempt from the client is
  rejected; (d) an insert naming a `user_id` other than the caller's own is rejected; (e) a `message` of
  0 chars and of 2001 chars are both rejected, 1 and 2000 both succeed; (f) a `contact` of 201 chars is
  rejected; (g) a `page` value outside the 4 allowed values is rejected.
- Run `get_advisors` and skim `get_logs` after applying the migration, per this repo's standing rule.
  Additionally confirm the new table's grants didn't alter any **existing** table's grants — this repo's
  own docs note it's "already been bitten twice by grant/RLS drift that internal guards masked," so this
  is a known failure class here, not a hypothetical.
- Manual browser check on each of the 4 pages: the feedback button renders without obscuring any existing
  control at both a desktop and a mobile (narrow/portrait) viewport size; the form is reachable and
  operable via keyboard alone, and Escape closes it; submitting twice in a row (double-click / cooldown)
  produces exactly one row, not two; disabling the network (or blocking the Supabase host) and submitting
  shows a clear inline error, not a silent failure or a hang; a successful submission appears in the
  Supabase table with the correct `page` value.

## Done when
A working feedback button + form exists on all 4 pages, each reachable by keyboard and not obscuring
existing controls at desktop or mobile widths; submissions land in the new `feedback` table with correct
`page`/`user_id` attribution and pass every check listed under Verification; RLS confirmed to block
read/update/delete from the client; the anon-vs-authenticated decision has been made explicitly (not
defaulted silently) and is logged in `DECISIONS.md`.

---

## Reviewer instructions
You are reviewing this plan **cold, with no access to the codebase** — only the text above. You are a
general reasoner, not a code analyzer: judge the plan's **logic, clarity, scope, and risk — not code
correctness you cannot verify.** If the plan relies on knowledge you don't have, that itself is a finding.
Find gaps, unstated risks, and better alternatives — including structural/redesign suggestions, not just
"missing detail" — but do not implement anything. Specifically:
1. Does the proposed approach actually achieve the stated goal?
2. Which of the plan's **assumptions** look shaky, and what happens if one is wrong?
3. Is anything in "Alternatives considered" actually better, or is the plan overcomplicated for the goal?
4. What's missing — an edge case, a risk, a dependency, a **verification step** the plan doesn't mention?
5. Are "Verification" and "Done when" objectively checkable, or do they hide ambiguity?
6. Should this task be split? Is anything in "Out of scope" actually load-bearing?

Write your findings as a plain list (gaps found, suggested improvements, verdict) — don't rewrite the plan
yourself unless asked. **If a section is genuinely solid, say so briefly rather than inventing concerns** —
false findings cost the implementer a wasted cycle.

---

## Review outcome (fill in after the review + implementation — not part of the cold review)
- Reviewer findings: 4 independent cold reviews returned ~19 distinct findings (2 of the 4 reviews were
  near-duplicates of each other in content and structure, so not fully independent signals) → 17 accepted
  and folded into this plan directly, 1 deferred-and-documented (Edge Function as a rate-limiting upgrade
  path, not adopted for v1), 1 elevated to a blocking decision for the user rather than defaulted
  (anon-vs-authenticated submission — all 4 reviews independently flagged this as a product, not
  technical, decision).
- Materially changed the plan? Yes. Added: `contact`/`page` DB-level constraints, explicit idempotent
  migration syntax, a client-side submission cooldown + double-submit guard, defined offline/failure UX
  (previously unspecified), a "submit anonymously" opt-out for signed-in users, a grant-regression
  verification step tied to this repo's own prior grant/RLS incidents, boundary-value and idempotency
  tests, and reworded the Edge Function rejection to be more precise. The core architecture (self-
  contained module, direct RLS-protected insert, dashboard-only read, no engine.js coupling) is
  unchanged — no review argued for restructuring it.
- Without the review, what would have happened: the original draft had no offline/failure-state handling,
  no duplicate-submit guard, an unbounded `contact` field, and treated rate limiting as a distant
  "someday" note rather than a cheap in-scope mitigation — all four reviews independently converged on
  the offline/failure-UX gap in particular, which would otherwise have shipped as silently undefined
  behavior in v1.

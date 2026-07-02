# PACT — Roadmap

> Written for agentic assistants (VS Code Copilot & Claude Code). With `AGENTS.md` committed, you don't
> repeat project context — **paste one task at a time**, review the diff, accept. Each task ends with a
> **Done when** check.
>
> **Rules for this file** (see `AGENTS.md`):
> 1. Holds only **open / planned** work. When a task is DONE, **move it into `CHANGELOG.md`** in the same change.
> 2. **Single writer.** Agents: *output* new items in this format for the human to fold in — don't append directly.
> 3. One task per branch. The open git branch is the "in flight" signal.
>
> **`REV-NN` items** come from the 2026-06-29 code review. Full evidence, code, and acceptance criteria
> live in **`docs/PACT-Code-Review-2026-06-29.md`** — commit that file alongside this roadmap so the
> pointers resolve. Findings are filed by severity: HIGH → Now, MEDIUM → Next, LOW → Later.

Completed work (PWA shell, auth, cloud sync, campaigns, hardening, landing-page redesign, PHB data,
**REV-01** regression gate, **REV-02** SW same-origin cache fix, **REV-03** SW network-first,
**CU-1** agent docs, **CU-2** version sync, **CU-3** repo tidy, **CU-6** DM Console rename, **CU-4** branch
prune) has landed and graduated to `CHANGELOG.md`.

---

# 🔴 NOW — high-severity fixes + cleanup

## Fix crash exporting to Live Sheet when a species/racial trait is selected — TODO
Branch fix/chargen-livesheet-racialtraits-crash. `tools/PACT-CharGen-Webtool.html`'s "⇆ Live Sheet"
button throws for any character with ≥1 species/racial trait (the common case).

```text
Root cause (confirmed by reading the code, not yet fixed):
- buildToLiveLog() (behind the Live Sheet export button) builds its working object via a local
  liveBase() helper (~line 1741) — CharGen's own hand-copied duplicate of the engine's baseBuild()
  shape, not the real js/engine.js one.
- liveBase() initializes saves:[], skills:[], expertise:[], racialSpells:[], and a dozen other
  arrays, but is MISSING racialTraits:[].
- buildToLiveLog's local MUT object (~line 1816) mutator for racial traits is unguarded:
  `racial:(b,p)=>b.racialTraits.push(p.v)`.
- Result: any character with a species/racial trait throws `TypeError: Cannot read properties of
  undefined (reading 'push')` on export. exportToLiveSheet()'s own try/catch (~line 1857-1869) catches
  it and shows a flash error + console.error instead of a raw crash, but nothing gets saved.
- For comparison, js/engine.js's real baseBuild() DOES include racialTraits:[] (~line 378) and uses
  the same unguarded push — safe there only because baseBuild() always sets the field. This is
  copy-paste drift specific to CharGen's local liveBase() duplicate, the same class of drift the
  "Fix AGENTS.md's stale module bridge claim" NOW item above already flags (CharGen hand-copies
  DATA/compute/MUT/baseBuild-shaped things instead of importing them).

1. Add `racialTraits:[]` to liveBase()'s object literal, matching every other array field already
   listed there.
2. Broader sweep (do this, not just the one-line fix): diff liveBase()'s full field list against
   js/engine.js's baseBuild() field list for any OTHER missing array fields, and audit
   buildToLiveLog's local MUT object for any other unguarded `.push()` call that assumes a field
   exists without either a `(b.X=b.X||[]).push(...)` guard or a corresponding liveBase() initializer
   (compare against sibling entries that already guard: toolexpertise/art/subbundle/unlockclass/
   subabil/racialspell). Fix every gap found, not just this one field — this exact bug shape could
   recur elsewhere.
3. Display/integration-only fix — do NOT bump DATA.version, UNLESS the broader sweep in step 2 turns
   up something that actually touches compute() output, in which case bump DATA.version and update
   the REV-01 baseline instead, and say so in the changelog.
4. Verify: build a character in CharGen with at least one species/racial trait, press Live Sheet,
   confirm no console error and the file exports/imports cleanly into the Live Sheet.
5. If a DECISIONS.md entry turns out to be warranted by the broader sweep, use the next free D-GH#
   (verify DECISIONS.md's current highest at pickup time — was D-GH17 as of this writing, so D-GH18).
```
**Done when:** exporting a character with ≥1 species/racial trait from CharGen to Live Sheet no longer
throws; the liveBase()-vs-baseBuild() field diff and MUT unguarded-push audit have been run and any
other gaps found are fixed in the same PR; parity still 5/0.

## PWA stale-version bug: users never get the "new version ready" reload prompt (HIGH) — TODO
Branch fix/pwa-stale-version-cache-bypass. Reported by the user: loading PACT — both as an installed
standalone PWA and in a regular browser tab — consistently serves an old cached version on every page
(index.html and all three tools), and the "A new version of PACT is ready — Reload" banner (already
wired into index.html + all three tools) never appears, even after multiple reloads.

```text
Diagnosis (from reading service-worker.js and all 5 pages' SW registration code on `main`, post the
2026-07-02 preview→main promotion — REV-02/REV-03 and the banner ARE already live, but staleness
persists):

1. Most likely root cause, fix first: service-worker.js's network-first fetch path (NETWORK_FIRST_RE,
   matching *.html and js/engine.js) calls plain `fetch(e.request)` with no cache-control override.
   "Network-first" as an SW *strategy* does not make the underlying fetch() bypass the browser's/CDN's
   ordinary HTTP cache — if response headers permit it, that fetch can still silently return a stale
   cached response. Fix: pass `{cache:'no-store'}` (or reconstruct the request with `cache:'reload'`)
   on that fetch call.
2. Contributing factor: no page calls `registration.update()` proactively — every page relies solely on
   the browser's own default periodic SW update-check timing (can be hours to 24h; can be even less
   frequent for installed/standalone PWAs). Add an explicit `reg.update()` call on page load and on
   `visibilitychange`/`focus`, in all 5 pages' SW registration blocks.
3. Separate inconsistency bug, fix in the same PR: login.html's `updatefound` handler silently calls
   `location.reload()` the instant a new SW is detected — no banner, no user action — unlike the other
   four pages (index.html, CharGen, Live Sheet, DM Console), which show a dismissible banner and only
   reload on click. Align login.html to the same banner pattern.
4. Robust fallback layer (do after 1-3, do not block on it): fetch a small version marker with an
   explicit `cache:'no-store'` fetch on load + periodically/on visibilitychange, compare to the
   currently-loaded version, and surface the same reload banner if they differ — independent of the
   SW's own updatefound event entirely, so it can't silently fail the same way. Reuse the BUILD value
   from the already-filed "Add BUILD export to js/engine.js + wire index.html to read it live" NEXT-
   bucket task once that lands; don't block items 1-3 on it.
5. Verify across both an installed PWA and a plain browser tab (the user reported both): deploy a
   trivial content change, confirm the reload banner appears without needing 24h+ or a manual hard
   refresh, and that clicking Reload actually shows the new content.
6. Display/infrastructure-only — do NOT bump DATA.version; log the fix in CHANGELOG.md.
```
**Done when:** a fresh deploy is detected and the reload banner appears within a normal page
load/revisit (not dependent on the browser's own 24h heuristic) in both installed-PWA and browser-tab
modes, on every page including login.html; login.html's handler matches the other four pages' banner
pattern; parity still 5/0 (no engine change expected).

## Live Sheet unusably cramped on small mobile screens — TODO
Branch fix/mobile-livesheet-density. On small phone widths, the Live Sheet packs too many items into single rows, uses text too small to read comfortably, and has no way to collapse sections — all three "Buy/progress", "Character", and "History & ledger" cards stack into one long, always-fully-expanded column with heavy scrolling.

```text
Context: the Live Sheet has only one mobile breakpoint (@media(max-width:600px), ~line 70) tuning things
like ability-score columns (6→3) and touch targets. Several sections got missed or only partially tuned,
and there is no section-level collapse on mobile at all today:
- .slotgrid (spell slots, line ~191) is hardcoded to `grid-template-columns:repeat(9,1fr)` with NO mobile
  override anywhere — 9 columns (spell levels 1-9) squeeze into one row at any width, including phones.
- .spcols (spell-list columns, line ~196) only narrows 3→2 at 760px (line ~209); nothing narrows it
  further for small phones (e.g. ~375-400px wide).
- .shabrow/.shkpis (printable character-sheet ability/stat rows, lines ~171/177) are hardcoded to 3
  columns with no width-specific tuning at all.
- Buy-list item buttons (.ib, lines ~78/120/139) and category headers (.cath, line ~95) sit at 11.5-13px
  font — workable on a tablet-width phone but tight on smaller screens.
- There is no breakpoint tier below 600px, so there's no separate treatment for genuinely small phones
  (~375-400px, e.g. iPhone SE/mini-class widths) vs. larger phones (~412-428px).
- .layout (~line 300+) holds three top-level cards — "Buy / progress", "Character", "History & ledger" —
  in a CSS grid that collapses to a single column under 1000px (@media(max-width:1000px)); on mobile all
  three are always fully expanded and stacked, forcing long scrolling to move between sections.
- A collapse/expand pattern already EXISTS for buy-list category groups (.bgcat/.cath, ▾/▸ toggle via the
  .clp class, ~lines 135-136) — reuse this same interaction pattern for the new section-level collapse
  rather than inventing a second one.

1. Audit every grid/flex layout and font-size in tools/PACT-Live-Char-Sheet.html's mobile-relevant CSS
   against a real small-phone viewport (~375-390px width): the existing @media(max-width:600px) block
   plus the un-tuned spots above (.slotgrid/.spcols/.shabrow/.shkpis).
2. Fix .slotgrid specifically: it must not force 9 columns at small widths — wrap to fewer columns
   (e.g. 3-5 per row with the grid flowing to multiple rows) or make it horizontally scrollable, whichever
   keeps each slot cell legible.
3. Add a narrower breakpoint tier (e.g. @media(max-width:400px)) for further column/font reduction where
   the 600px tuning still isn't enough, rather than assuming one breakpoint covers all phone sizes.
4. Re-check font sizes on buy-list items and category headers at small widths; bump if needed for legibility.
5. Add collapse/expand to the three top-level cards (Buy/progress, Character, History & ledger) on mobile
   (≤1000px, matching the existing single-column breakpoint): a tap on each card's header (h3) toggles
   that card's body open/closed, mirroring the existing .bgcat/.cath ▾/▸ pattern. Default state (all open
   vs. remembering last state vs. only "Character" open by default) is an implementation call — pick
   whichever needs the least new state-persistence machinery, and say what was chosen in the PR/CHANGELOG.
6. Do not change desktop/tablet layout (existing >1000px behaviour) or engine/rules logic.
   Display-only — do NOT bump DATA.version; just log in CHANGELOG.
7. Related to (but separate from) the "Mobile sticky buttons regression" task already on the roadmap —
   both are mobile-usability gaps in the same file; can be picked up independently or together.
```
**Done when:** on a real small-phone viewport (~375-400px wide), no section of the Live Sheet forces unreadable multi-column cramming; text and tap targets are legible without pinch-zooming; the three top-level sections (Buy/progress, Character, History & ledger) can each be collapsed/expanded independently on mobile; desktop/tablet layout unchanged; parity still 5/0.

---

# 🟡 NEXT — medium-severity fixes + remaining build work

## Cloud/campaign state is invisible to players (CharGen + Live Sheet) — TODO
Branch fix/cloud-campaign-status-visibility. Players can't tell, at a glance, whether they're working
locally or connected to a cloud campaign, or whether an attached campaign's DM rules are actually live.

```text
Confirmed findings (read directly from the code):
1. CharGen has zero cloud/auth integration at all — confirmed via a dev comment in the file itself
   ("Persistence is localStorage only") and zero references to Supabase/auth/sign-in anywhere in
   tools/PACT-CharGen-Webtool.html. Nothing tells the player this passively.
2. CharGen's "🛡 Campaign" button is a naming collision — it's a local, code-paste house-rules feature
   (CG_CAMPAIGN / openCampaign() / applyCampaignCode(), ~line 1709-1739) where a DM types up banned
   boons/drawbacks/arts and shares a text code pasted in manually. It has nothing to do with the real
   cloud campaign system in Live Sheet/DM Console (Supabase campaigns table, campaign_id, DM Console's
   Campaign Rules panel). Same word, two unrelated features.
3. Live Sheet's cloud/sign-in state is only visible inside the "☁ Cloud" dropdown menu — nothing on the
   main character sheet passively shows sign-in state.
4. Even when a character genuinely IS attached to a real cloud campaign, there's no visible confirmation
   that the DM's rules are actually being fetched/enforced right now. The enforcement mechanics already
   exist and work (all landed 2026-07-02 per CHANGELOG): rules configured in DM Console, stored in
   campaigns.rules (D-GH14); Live Sheet fetches them via refreshCloudCampaignRules() and live-filters
   banned weapon masteries/boons (D-GH16); species/origin-class/multi-discipline bans enforced at
   "Save to cloud" via validate() (D-GH14); Feature A's multi-discipline gating reads the same
   window._cloudCampaignRules (D-GH9). All of this state is currently silent/internal — never surfaced
   to the player. No way to tell, at a glance, whether you're actually subject to the DM's rules right
   now, versus the fetch having failed silently, versus not being in a campaign at all.

IMPORTANT — this exact area has been under very active, fast-moving concurrent development (D-GH9,
D-GH14, D-GH16 all landed the same day). Before implementing, re-verify the current state of
campaign-rules fetching/enforcement against CHANGELOG.md and the live code first — confirm which of the
mechanics above are still accurate versus what's changed since this was written. Do not build UI on top
of a possibly-stale assumption about window._cloudCampaignRules's shape or availability.

Scope (minimal clarity/labeling only — NOT new enforcement mechanics):
1. CharGen: add a persistent, always-visible label near the top indicating it's local-only, e.g.
   "🔒 Local only — not connected to any cloud campaign." Clarify or rename the "🛡 Campaign" button (or
   at minimum strengthen its tooltip) so it can't be mistaken for the real cloud campaign system — e.g.
   rename to "🛡 House rules code" or add explicit "(local, not cloud)" wording.
2. Live Sheet: add a persistent badge (not hidden inside the ☁ Cloud dropdown) showing sign-in state,
   and when the loaded character has a campaign_id, the campaign name plus a live confirmation that DM
   rules were actually fetched successfully — e.g. "☁ Campaign: <name> — DM rules active" vs a warning
   state like "⚠ Campaign: <name> — rules unavailable" if the fetch failed or returned nothing.
3. Do not change any enforcement/validation logic (validate(), cloudRuleBarred(), the live-filter
   pickers) — this task only adds visibility into state that already exists internally.
4. Display-only — do NOT bump DATA.version; log the fix in CHANGELOG.md.
```
**Done when:** CharGen shows a persistent local-only indicator and its "Campaign" button can no longer
be mistaken for the cloud campaign system; Live Sheet shows a persistent sign-in + campaign-rules-active
badge outside the ☁ Cloud dropdown; no enforcement/validation behavior changed; parity still 5/0.

## CharGen/Live Sheet: theme selector hidden/clipped + no system dark-mode default — TODO
Branch fix/chargen-livesheet-theme-selector. The theme selector (🎨 Default/Dark/D&D/Royal/Forest dropdown) is inaccessible in real conditions, and neither tool follows the device's dark/light setting on first use.

```text
Context: tools/PACT-CharGen-Webtool.html and tools/PACT-Live-Char-Sheet.html both persist the chosen theme
to the SAME localStorage key ('pactTheme') via an identical setTheme()/restore IIFE pattern (CharGen
~line 2657-2659, Live Sheet ~line 1459-1461) — so they're already meant to stay in sync, just missing two
things. index.html (landing page) already solves both of these correctly for its OWN separate theme system
(different localStorage key 'pact-theme', different theme names parchment/midnight/dragonfire/contrast) —
use its pattern (index.html ~line 49-63) as the reference, don't invent a new one.

Bug 1 — selector hidden on mobile (CharGen):
- .hd-row2 (contains the #themesel dropdown, ~line 391) is set to `display:none` at
  @media(max-width:768px) (~line 305), alongside .hd-row3.
- Unlike .hd-row3's action buttons (Save/Load/Share/Live Sheet/AI Portrait/Campaign/etc.), which get
  re-surfaced in `.mobile-action-bar` (~line 405-415), the theme selector was never added anywhere on
  mobile — it's simply gone. Add it (or an equivalent compact control) to the mobile-visible header/bar.
- Confirm whether Live Sheet has the same mobile hide-without-re-surface gap for its own #themesel
  (Live Sheet's `.top` header, ~line 281-288) and fix identically if so.

Bug 2 — selector can overflow/clip on desktop:
- .hd-row2 (~line 294) has no `flex-wrap` and no overflow handling, unlike .hd-row3 which explicitly has
  `flex-wrap:wrap`. It packs the tool title, version tag, "last edited" timestamp, AND the theme dropdown
  (pushed to the far right via `margin-left:auto`) into one non-wrapping row — on a narrower or zoomed
  desktop window this can overflow and visually clip the theme selector even though it's "present" in the
  DOM. Add flex-wrap (or move the theme selector to a spot that can't be squeezed out) so it's always
  visible/reachable at any desktop width.

Feature — default to system dark/light when there's no saved choice:
- Add the same "saved choice wins, else follow prefers-color-scheme:dark, else default" logic index.html
  already uses (~line 49-63) to BOTH CharGen's and Live Sheet's theme-restore IIFEs. Map system dark mode
  to the tools' existing 'dark' theme option (there's no separate "system" entry needed — just resolve
  the initial value the same way index.html does).
- Apply it early enough to avoid a flash of the wrong theme before JS runs — index.html runs its check
  inline in <head> before first paint; CharGen/Live Sheet currently run their restore IIFE near the bottom
  of the file (CharGen ~line 2659, Live Sheet ~line 1461), after the page has already rendered in the
  default theme. Move the check earlier (inline in <head>, matching index.html) if feasible without
  breaking the tools' existing load order; note in the PR if that's not practical and why.
- "Default to last used" already works today (both tools already read the saved 'pactTheme' value) —
  this task only needs to ADD the system-preference fallback for the case where nothing is saved yet.

Do not touch DM-Console.html (it has no theme system today — out of scope) or engine/rules logic.
Display-only — do NOT bump DATA.version; just log in CHANGELOG.
```
**Done when:** the theme selector is reachable in CharGen on both a real mobile-width screen and a narrow/zoomed desktop window; Live Sheet's selector is confirmed not to have the same mobile-hide gap (or is fixed identically if it does); a first-time visitor (no saved theme) sees CharGen/Live Sheet open in dark mode when their device is in dark mode, and in the previously-saved theme otherwise; parity still 5/0.

## Lock down remaining Supabase function EXECUTE grants (anon) — TODO
Branch fix/lock-down-remaining-function-grants. Revoke the default Postgres EXECUTE-to-PUBLIC grant on the
~12 remaining flagged functions, matching the award_ap/award_xp fix already applied.

```text
Apply as a new migration (sql/migrations/<date>-lock-down-remaining-function-grants.sql) and mirror the
grants into sql/rls-policies.sql. Full plan and safety verification already done in DECISIONS.md D-GH15:
- Trigger-only functions (handle_new_user, add_owner_as_dm, set_updated_at): revoke execute from public,
  no replacement grant needed (Postgres blocks direct calls to `returns trigger` functions anyway).
- Client-facing RPCs already granted to authenticated (join_campaign, join_as_dm, promote_to_dm,
  remove_dm, regenerate_invite_code, regenerate_dm_invite_code): revoke execute from public.
- Internal-only helpers with no explicit grant today (gen_invite_code, is_campaign_dm,
  is_campaign_member, is_campaign_owner, shares_campaign): grant execute to authenticated FIRST, then
  revoke from public, so authenticated behaviour doesn't change.
Apply live via the Supabase MCP (apply_migration), verify has_function_privilege('anon', ..., 'EXECUTE')
= false for all of them, then commit the migration file + rls-policies.sql update.
```
**Done when:** all ~12 functions show `anon_can_execute = false` / `authenticated_can_execute = true` live,
migration file committed, `sql/rls-policies.sql` matches.

## Verify REV-07 invite-code migration live in Supabase — TODO
Branch chore/verify-invite-code-migration-live. Do AFTER PR #82 (REV-07 CSPRNG fix) merges into `preview`
— the migration file doesn't exist on `preview` yet.

```text
1. Apply sql/migrations/2026-07-02-rev07-csprng-invite-codes.sql to the live Supabase project (via the
   Supabase MCP apply_migration, or the SQL editor).
2. Spot-check: trigger gen_invite_code() (e.g. via regenerate_invite_code/regenerate_dm_invite_code on a
   test campaign) and confirm the returned code matches ^[A-Z0-9]{6}$ and is unique against existing
   invite_code/dm_invite_code values.
3. No code change expected — this is an operational verification step, not a fix. If the migration
   reveals a problem, file a follow-up fix rather than patching live.
```
**Done when:** the migration is applied to the live Supabase project; a spot-checked generated code
matches the check regex and is confirmed unique; no code changes (parity unaffected).

## Task 6 — CharGen module bridge migration — TODO
```
Migrate tools/PACT-CharGen-Webtool.html from its embedded DATA + compute() copy to the shared
module bridge, matching Live Sheet and DM Console.
1. Add a <script type="module"> importing { DATA, compute, baseBuild, MUT, activeEvents, economy,
   foldBuild } from '../js/engine.js', copy each onto window, then dispatch new Event('engine-ready').
2. Gate the existing UI <script> on document.addEventListener('engine-ready', ...).
3. Delete the inline const DATA = {...} (line ~428) and function compute(b){...} entirely.
Compat note: CharGen's compute() differs only in the budget line; canonical compute(b,opts) defaults
opts={} → spendable === b.budget, identical behaviour. Extra return fields (playerAp/dmAp/spendable)
are ignored. No UI change.
```
**Done when:** CharGen loads + prices correctly, no embedded DATA/compute remains, parity still 5/0.
*(Then all three tools are on the bridge — architecture uniform. Best done AFTER REV-01 makes the gate real.)*
⚠️ **Interim risk:** the parity gate guards only `js/engine.js`, **not** CharGen's embedded copy — a future
engine change can silently diverge CharGen (they're identical today except the budget line; DATA synced at
v0.332). CharGen's header warns "mirror engine/DATA changes into BOTH files"; until this task lands,
**AUD-1** should assert the two stay in sync.

## Feature: CharGen campaign-rules awareness (sign-in + live enforcement) — TODO
Branch feat/chargen-campaign-rules. **Do AFTER Task 6** — CharGen has zero cloud/auth integration today
(no sign-in, no campaign selection, only a one-way local "Export to Live Sheet" handoff) and still embeds
its own hand-copied rules engine, so wiring campaign rules in now would mean duplicating `validate()`
logic outside `js/engine.js` — exactly what AGENTS.md's hard rule forbids. Task 6 must land first so
CharGen shares the real engine, including its `validate()` export.

```text
Context: DM campaign rules (banned species/masteries/boons/origin classes, multi-discipline toggle) are
enforced today only in Live Sheet, at the "Save to cloud" step (see D-GH14) — because that's the only
tool with cloud/auth wiring. This means a player who builds an entire character in CharGen around a
banned choice only discovers the problem after exporting into Live Sheet and trying to push to the
cloud, forcing a trip back to CharGen. A live-filter follow-up (this same session, docs/PACT_ROADMAP.md
history) closed most of that gap for Live Sheet itself — banned masteries/boons are no longer even
selectable there — but CharGen, where a character's species/origin class are actually chosen, still has
no visibility into any campaign's rules at all.

1. After Task 6, add sign-in (js/auth.js) and campaign selection (js/campaign.js listMyCampaigns/getCampaign)
   to CharGen, matching the bridge pattern already used in Live Sheet.
2. Fetch the selected campaign's rules and call js/engine.js's validate(build, rules) live as the player
   builds — filter banned species/origin classes/masteries/boons out of their respective pickers (mirror
   the Live Sheet live-filter pattern) rather than only warning after the fact.
3. Decide whether "Export to Live Sheet" should carry the selected campaign_id forward automatically (so
   the player doesn't have to reselect the campaign in Live Sheet) — needs a decision on data flow between
   the two tools; document it as a NEW decision code (next free after D-GH14).
4. Do not duplicate validate()'s rule logic — CharGen must call the shared engine export like Live Sheet
   does, not reimplement the checks.
```

**Done when:** a DM's campaign rules are visible to CharGen once a campaign is selected; banned choices
are filtered out of CharGen's pickers during creation (not just rejected later in Live Sheet); no rules
logic is duplicated outside `js/engine.js`; parity still 5/0.

## Externalize CharGen default AP + AP-by-level table — TODO
Branch feat/ap-by-level. BEST DONE AFTER Task 6 — CharGen (the main consumer) still embeds its own
engine copy, so until it's on the shared bridge it won't see js/ap-by-level.js (you'd edit two places).
- Add js/ap-by-level.js exporting AP_BY_LEVEL = {1:50, 2:70, ...} and DEFAULT_LEVEL.
- js/engine.js imports it and surfaces it on DATA (DATA.apByLevel, DATA.defaultAp). Live Sheet + DM
  Console then get it automatically via the bridge; CharGen gets it once Task 6 lands.
- CharGen reads the default budget + level→AP lookup THROUGH the engine bridge — never the file directly.
- AP-per-level is mechanics: bump DATA.version and update the REV-01 baseline in the same PR.
**Done when:** editing a value in js/ap-by-level.js changes the default budget / level options in every tool
that's on the shared engine, with no other code change; engine API stable; parity passes.

## Feature B — Save-file integrity (tamper-evidence) — TODO
Branch `feat/save-integrity`. **Do AFTER Feature A.** Engine first (sign/verify helpers), then the tools.
```
Sign each save; Live Sheet flags edited/corrupted files on load (non-blocking); DM Console badges them;
CharGen exports signed too. Tamper-EVIDENT, not tamper-proof (client-side) — the offline stopgap before
the Supabase enforcement phase. Engine: sign/verify helpers. Tools: Live Sheet save/load flag, DM Console
badge, CharGen sign. Full spec: IMPLEMENT-save-integrity.md (+ ENGINE-INTEGRITY-prompt.md).
```
**Done when:** a signed save verifies clean; a hand-edited save is flagged on load (without blocking) and
badged in DM Console; CharGen exports are signed; parity stays 5/0.
⚠️ Log under a **NEW** decision code (**D-GH10** — the draft's "D-GH4" is taken). Touches CharGen —
coordinate with **Task 6** so the two CharGen edits don't collide.

## AUD-1 — Automated health check (static audit + RLS proof) (HIGH — scope widened) — TODO
The repeatable "is the system still healthy?" check you asked for — a stdlib Python script, no installs,
runs in seconds.
```
testing/scripts/audit.py (Python stdlib only) — file-based checks, run before every commit:
- every service-worker PRE_CACHE URL exists on disk; icons 192/512/180 present; 404.html exists
- manifest has required fields, scope + start_url = /PACT/, and a maskable icon
- SW registration present in every HTML page; no unconditional skipWaiting() in the install handler
- flag any asset > 100 KB
- DATA/compute/MUT drift check, ALL THREE tools (widened while implementing Feature A / PR #85 — see
  DECISIONS.md D-GH9): CharGen, Live Sheet, and DM Console each hand-copy their own DATA/compute/MUT
  from js/engine.js (none of the three are actually bridged for these — see the "Fix AGENTS.md's stale
  module bridge claim" NOW item above). Extend the original CharGen-only check to diff all three tools'
  embedded copies against js/engine.js's exports and fail loudly on any mismatch, not just CharGen's.
  This becomes unnecessary for whichever tool(s) eventually get migrated onto a real bridge.
Optional RLS proof (Python + requests, credentials entered at runtime — never commit them): as a non-DM
player, confirm BOTH writes are REJECTED via the Supabase REST API — (a) writing characters.ap (the DM-only
column lock) and (b) setting campaign_id to a campaign never joined (proves REV-04 is closed).
```
**Done when:** runs clean on a healthy tree and fails loudly on a planted break (a missing PRE_CACHE file,
a player REST write to `ap` that succeeds, or a hand-edited mismatch between any tool's embedded copy and
js/engine.js). Pairs with REV-01/REV-11 — engine-parity joins CI once REV-01 makes the gate assert.

## Feature: Theme-aware random homepage artwork — TODO
Branch feat/theme-random-artwork. Add theme-specific image pools to index.html and randomly select a matching image on page load and theme change.

```text
- Add separate image pools for light and dark themes (e.g. assets/themes/light/* and assets/themes/dark/*).
- Detect the active theme from the existing theme system.
- On page load, randomly select one image from the active theme pool and apply it to the homepage artwork/banner element.
- Re-roll the image when the user switches theme so light mode always uses a light image and dark mode always uses a dark image.
- Keep all logic inside index.html (or a dedicated UI helper JS file if one already exists); no engine changes.
- display-only — do NOT bump DATA.version; just log in CHANGELOG.
- Engine is the single source of truth. All rules live in js/engine.js; do not add rules logic outside the engine.
```

---

## Mobile sticky buttons regression (Save/Load/Share/Live Sheet/AI Portrait/Campaign) — TODO
Branch fix/mobile-sticky-buttons. On mobile, several action buttons (Export/"Save", Import/"Load", Cloud/"Share", Sheet/"Live Sheet" toggle, AI Portrait, Campaign) stay pinned to the viewport while scrolling when they should scroll normally with the page.

```text
Context: D-GH5 (DECISIONS.md) already decided mobile (≤768px) headers use a static "app-shell" layout
(body becomes a flex column with height:100dvh/overflow:hidden; header is a static flex:0 0 auto bar;
.layout is the scrolling region) specifically BECAUSE position:fixed/sticky was unreliable on real mobile
hardware. That app-shell CSS does not appear to currently exist in tools/PACT-Live-Char-Sheet.html — the
header bar `.top` is `position:sticky;top:0` (~line 58) and `#lmobar` (bottom AP/Undo/Redo bar) is
`position:fixed` (~line 97), both unconditional, not scoped out on mobile.

1. Audit tools/PACT-Live-Char-Sheet.html for sticky/fixed rules affecting the button bar(s): `.top`
   (line ~58, contains Undo/Redo/Export/Import/Cloud/Sheet/More→Campaign), `#lmobar` (line ~97),
   `#buysearch` (line ~85), `#apFloat` (line ~278), `.shtop` (line ~164, AI Portrait/Print/Close inside
   the printable sheet overlay).
2. Determine whether D-GH5's app-shell layout was reverted, never fully implemented, or superseded by a
   later change (check CHANGELOG.md / git history for `.top`/`position:sticky` edits after D-GH5 landed).
3. Fix so these buttons are NOT sticky/fixed on mobile — reintroduce D-GH5's static-header app-shell
   pattern (or equivalent) at the ≤768px breakpoint, matching the already-decided approach rather than
   inventing a new one.
4. Also check index.html and tools/DM-Console.html / tools/PACT-CharGen-Webtool.html for the same
   unconditional sticky/fixed buttons on their action bars — fix any found with the same pattern for
   consistency, or note in the PR if they're intentionally sticky and out of scope.
5. Do not change desktop behaviour (D-GH5 keeps position:sticky + window scroll on desktop) or engine/rules
   logic. Display-only — do NOT bump DATA.version; just log in CHANGELOG.
```
**Done when:** on a real mobile viewport (≤768px), Save/Export, Load/Import, Share/Cloud, Live Sheet/Sheet toggle, AI Portrait, and Campaign buttons scroll out of view with the page instead of staying pinned; desktop layout unchanged; parity still 5/0.

---

## Feature: Clone campaign character to standalone — TODO
Branch feat/clone-char-standalone. Let a player copy their campaign-linked character into a new standalone (non-campaign) character they own outright.

```text
In Live Sheet, add a "Clone to standalone" action for characters that belong to a campaign.
The clone copies the raw character build data (stats, event log) into a new character record not tied to any campaign.
ap on the clone is reset to 0 — ap is DM-authoritative and cannot carry over outside the campaign context.
The original campaign character is untouched.
The clone appears in the player's own character list and can be edited freely.
Store only raw character data; derive everything else via compute() / rebuildStateFromEvents() at runtime — do not store derived values.
Display-only — do NOT bump DATA.version; just log in CHANGELOG.
```

**Done when:** a player can clone a campaign character to a standalone record; the clone appears in their character list with ap = 0; the original is unchanged; parity still 5/0.

---

## Feature: DM clone campaign rules to another campaign — TODO
Branch feat/clone-campaign-rules. Let a DM copy the rules configuration from one campaign and apply it as the starting point for another campaign's rules.

```text
In DM Console, add a "Copy rules from…" action on the Campaign Rules panel.
Present the DM with a list of their other campaigns; selecting one copies that campaign's rules JSON into the current campaign's rules fields.
The DM can then adjust before saving — this is a starting-point copy, not a live link.
Write the copied rules to Supabase only on explicit save (DM-only, protected by RLS).
Display-only — do NOT bump DATA.version; just log in CHANGELOG.
```

**Done when:** a DM can copy rules from one of their campaigns into another and save them; the source campaign is unchanged; parity still 5/0.

---

## Feature: Advancement tracks + D&D 2024 level equivalency — TODO
Branch feat/advancement-tracks. Store AP-per-level advancement tracks (slow/average/fast + custom) and a D&D 2024 equivalent level reference table; let DMs select or customise a track per campaign.

```text
Add advancement track data to js/engine.js DATA (or a separate js/advancement.js imported by the engine) as a display-only reference — never read by compute(). Each track (slow/average/fast) defines cumulative AP thresholds per level. Also add a D&D 2024 equivalent level mapping (PACT AP total → approximate D&D 2024 level) as a display reference only.

In DM Console, add a campaign setting for advancement track: the DM can pick slow/average/fast or define a custom track (AP values per level). Store the selection in the campaign record in Supabase (DM-authoritative, RLS-protected).

In Live Sheet (and optionally DM Console), display the character's current D&D 2024 equivalent level as a read-only label derived from total AP spent + the D&D equivalency table.

Display-only — do NOT bump DATA.version; just log in CHANGELOG.

Note: this overlaps with the existing "Externalize CharGen default AP + AP-by-level table" task. Best done after that task lands, or coordinate changes to avoid duplicating the AP table.
```

**Done when:** advancement tracks are stored in engine data; a DM can select or customise a track per campaign; the Live Sheet shows the D&D 2024 equivalent level label; parity still 5/0.

---

## Expand engine-parity test coverage — TODO
Branch test/expand-engine-parity-coverage. `testing/tests/engine-parity.html` currently runs only 5 fixtures (CG-001/002/003, EV-001, LS-001) — budget/empty/over-budget cases only. No coverage of prereq gates, drawback buy-off, racial/mastery pricing, multi-tradition spellcasting paths, or Live Sheet event-log folding beyond the one clean-export case. Before REV-11 (CI) and REV-14 (engine refactor) can trust this gate, it needs to actually prove `compute()` correctness broadly, not just that it doesn't throw.

```text
1. Audit current fixture coverage against js/engine.js's compute() branches — grep for gates/prereqs/discounts
   the 5 existing fixtures never exercise (e.g. drawback buy-off, racial discount stacking, invalid
   prereq purchase, duplicate/cap rejection, HD/AP-by-level edges).
2. Add new fixtures under testing/fixtures/builds/ and testing/fixtures/live-sheets/ (and events/ if needed)
   for the highest-value gaps found in step 1 — prioritize cases most likely to silently break during
   future engine edits (REV-14 split, Task 6 CharGen migration, Feature A multi-tradition work).
3. Add each new fixture's expected values to testing/expected/expected-results.csv via the existing
   "Capture baseline" mode in engine-parity.html, then have a human confirm the captured values against
   the PHB/DATA before committing (same human-review discipline as D-GH13).
4. Wire the new fixtures into testing/tests/engine-parity.html's FIXTURES list.
5. Do NOT change compute() or DATA — this task is test-coverage only. If gaps reveal an actual engine bug,
   file it as a separate roadmap item rather than fixing inline here.
6. If, after auditing, the gate genuinely is legacy/low-value (e.g. duplicated by something else), stop and
   write up that finding instead of padding fixtures for their own sake — note it in DECISIONS.md as a
   NEW decision (next free code: D-GH18 — D-GH14 is taken by the campaign-rules decision; verify
   against DECISIONS.md's current highest number when this task is actually picked up) rather than
   silently doing nothing.
```
**Done when:** engine-parity.html reports more than 5 fixtures covering at least prereq-gate rejection,
drawback buy-off, and one racial/mastery discount case, each with a human-reviewed CSV baseline; parity
still reports all green (N passed / 0 failed).

---

## Add Supabase advisor/log check to the per-change checklist — TODO
Branch docs/audit-checklist-supabase. Add a step to AGENTS.md's per-change checklist.

```text
After any migration/RLS/schema change, run the Supabase advisor (get_advisors) and skim recent logs
(get_logs) before opening the PR. This project has already been bitten twice by grant/RLS drift that
internal guards masked (D-GH15, D-GH12) — the advisor catches that class of issue for free.
```
**Done when:** AGENTS.md's per-change checklist includes this step; no code change.

## Docs-consistency audit: DECISIONS.md / CHANGELOG.md / roadmap cross-check — TODO
Branch docs/consistency-audit. One-time pass checking the three logging docs agree with each other and
with the code.

```text
1. Read DECISIONS.md, CHANGELOG.md, and docs/PACT_ROADMAP.md together.
2. Flag contradictions: a decision marked IN FORCE that no longer matches the code, a roadmap item
   that's actually already done, or a stale D-GH# reservation (already found one live: the "Expand
   engine-parity test coverage" task reserves "D-GH14" but that code is now taken by the campaign-rules
   decision — correct it to the next free code at time of fix).
3. Write findings to docs/sessions/<date>-docs-consistency-audit.md. Do not silently fix code — apply
   only doc corrections (roadmap-graduation moves, D-GH# corrections) directly; anything code-shaped
   becomes its own follow-up roadmap item.
4. Re-running this pass periodically (e.g. after a batch of merges) is a good habit but is a process
   note, not part of this task's completion condition.
```
**Done when:** docs/sessions/<date>-docs-consistency-audit.md exists with the findings; the known D-GH14
reservation collision is corrected in the same pass.

## Add a pre-release manual QA checklist to docs/HOW-TO-WORK.md — TODO
Branch docs/pre-release-qa-checklist. Document the click-through the parity gate can't cover.

```text
1. Add a checklist to docs/HOW-TO-WORK.md: build a character in CharGen → export to Live Sheet → verify
   buy-off works and ledger entries are per-item → push to cloud in a test campaign → confirm DM Console
   sees it and can award AP → check the browser console for errors at each step.
2. Add a one-line pointer to this checklist in AGENTS.md's per-change checklist (alongside the parity
   gate step), scoped to release-shaped PRs (not every doc/small fix).
```
**Done when:** docs/HOW-TO-WORK.md has the checklist and AGENTS.md's per-change checklist links to it.

## Document a rules-correctness review pass in docs/HOW-TO-WORK.md — TODO
Branch docs/rules-review-note. `/code-review`'s default lens is bugs/reuse, not domain (PHB) correctness.

```text
Add a short note + example prompt: for any PR touching js/engine.js's compute()/DATA, run /code-review
with an explicit instruction to check the math against the Player's Guide (caps, gates, prices) rather
than only generic code-quality issues.
```
**Done when:** docs/HOW-TO-WORK.md documents this usage pattern with a copy-pasteable example prompt.

## Add `BUILD` export to js/engine.js + wire index.html to read it live — TODO
Branch fix/engine-build-export. Closes a docs/architecture-drift gap found in a 2026-07-02 audit: AGENTS.md
and docs/VERSION-SYNC.md both document `export const BUILD = "v0.107"` living in js/engine.js with
index.html reading it live so it "never drifts" — neither exists in the code (`git log -S"export const
BUILD"` returns zero hits ever, across all branches; index.html has no BUILD/version-reading code at all).
The three tools' v0.107 labels currently match only by hand-maintained convention. **Worse than a docs gap:**
CHANGELOG.md's 2026-07-01 "CU-2: sync DM Console build version" entry explicitly claims "All three tools
now mirror BUILD in js/engine.js; index.html reads it live" — that claim is false on `preview` as of this
writing (verified live: no BUILD export, no index.html version code). This is the actual prerequisite for
the "AUD-1 follow-up: version/build-sync check" task below, which assumes BUILD already exists.

```text
1. Add `export const BUILD = "v0.107";` to js/engine.js (near the DATA/version constants), matching the
   value already hand-maintained across the three tools.
2. Wire index.html to import BUILD from js/engine.js via the module bridge and render it live somewhere
   sensible (index.html currently has zero version-reading code — this is new UI, not a fix to existing
   UI; pick the least intrusive spot, e.g. footer).
3. Do NOT hand-edit index.html's version display after this lands — it should always reflect BUILD from
   js/engine.js.
4. Leave the three tools' own hand-maintained version labels as-is for now (CharGen line-1 comment/title/
   header, Live Sheet line-1 comment, DM Console TOOL_VERSION) — Task 6 (CharGen module bridge migration)
   is the natural point to also wire those to read BUILD live; note that follow-up but don't do it here.
5. Update docs/VERSION-SYNC.md only if implementation details end up differing from what it already
   describes — otherwise it's accurate once BUILD exists.
6. Correct CHANGELOG.md's 2026-07-01 CU-2 entry (or add a follow-up entry) once this lands so the log
   stops asserting the mechanism existed before it actually did.
7. Display-only / tooling — do NOT bump DATA.version; log the fix in CHANGELOG.md.
```
**Done when:** `js/engine.js` exports `BUILD`; `index.html` displays it live (no hardcoded version
string); `docs/VERSION-SYNC.md` matches reality; the false CU-2 CHANGELOG claim is corrected; parity
still 5/0.

## AUD-1 follow-up: version/build-sync check — TODO
Branch chore/aud1-version-sync-check. Do AFTER AUD-1 (Automated health check) lands.

```text
Extend testing/scripts/audit.py (from AUD-1) with a check that BUILD (js/engine.js) and its mirrors
(CharGen title/header, Live Sheet line-1 comment, DM Console TOOL_VERSION) all match, and that
DATA.version is mirrored between CharGen's embedded copy and js/engine.js (until Task 6 removes the
copy).
```
**Done when:** audit.py fails loudly if any version string diverges from js/engine.js; passes clean on
the current tree.

## REV-11 — Add CI: headless engine-parity gate on every PR — TODO
Branch chore/rev11-ci-engine-parity. Promoted from LATER — no CI exists today, so a regression is only
caught if a human remembers to open engine-parity.html.

```text
1. Add a headless Node runner (dev-tooling only, not a runtime dependency of the shipped app) that
   imports js/engine.js as an ES module, runs the same FIXTURES engine-parity.html uses, and asserts each
   result against testing/expected/expected-results.csv.
2. Wire it as a GitHub Action that runs on every PR touching js/engine.js or testing/**.
3. No npm runtime deps for the app itself — this tooling lives entirely in the CI job/devDependencies,
   consistent with the "vanilla JS, no build step" rule for the shipped app.
```
**Done when:** a PR that breaks a fixture fails CI automatically; a clean PR passes; parity still 5/0
when run locally too.

---

# ⚪ LATER — low-severity fixes + ideas (not scheduled)

**Low-severity review findings:**
- **REV-10** — `.claude/` is tracked despite `.gitignore`. Fix: `git rm --cached -r .claude` (keep on disk), commit.
- **REV-12** — Make "every player-controlled value passes through `esc()`" a hard invariant; add a line to
  `AGENTS.md` Hard rules. Rises in importance once cloud data crosses users.
- **REV-13** — Dead grant maps `grantSk/grantTl/grantIn` in `engine.js` (~:62) are never populated. Wire up
  or remove; don't change pricing without updating the REV-01 baseline in the same PR.
- **REV-14** — (optional, engine-targeted) Extract `DATA` into `engine-data.json`; split `compute()` into
  named sub-pricers. Only safe once REV-01 gives real assertions; dedicated PR, byte-identical output.

**Polish & hardening** (from the Task 5 audit session):
- **Real icons** — replace the placeholder 192/512/180 PNGs with real artwork (needs your art).
- **Pin/bundle supabase-js** — it's `@supabase/supabase-js@2` (major-pinned only); pin the exact version
  (or vendor a local copy) so a CDN minor update can't change offline behaviour.

**Landing-page follow-ups** (deferred from the redesign):
- Extend theming to the guide and tools (index-only today).
- "Continue / recent characters" on the landing page (needs the tools' save format).
- iOS "Add to Home Screen" hint (no `beforeinstallprompt` on iOS Safari).

**Supporting reference tasks** (run when needed):
- Supabase project setup · Icon & asset list (192/512/180) · Offline UX spec · Future-features roadmap.

**Improvements** (recommended action first; the *then* line is a lower-priority upgrade with its caveat):
- **A1 — Engine API contract.** Add a JSDoc block atop `js/engine.js` (signatures + one line per export) so
  agents grasp the API without reading 238 KB. *Then (optional):* a dev-only `engine.d.ts` for IDE
  autocomplete — *caveat:* a new format to maintain; can read as "TypeScript creeping in."
- **A2 — PR template.** Add `.github/pull_request_template.md` with the per-change checklist so every PR
  auto-includes it. *Then (optional):* a fuller `CONTRIBUTING.md` if you onboard more people — *caveat:* it
  isn't auto-inserted, so it's easy to skip.
- **A3 — Client error visibility.** Add a global `onerror`/`unhandledrejection` handler logging to the
  console + a "Report issue" link in the footer. *Then (lower priority):* log errors to a Supabase table
  once sign-in is the default — *caveats:* extra write traffic + a privacy note to document.
- **A4 — DECISIONS.md index.** Add a one-line-per-decision index at the top + the rule "next code =
  highest + 1" (and fix the dup via CU-5). *Then (lower priority):* auto-generate the index — *caveat:*
  depends on AUD-1 existing.
- **A5 — Bulk "back up all characters."** Add a "Back up all" button → one JSON bundle, plus restore, so a
  localStorage user can't lose everything to a browser clear. *Then:* the Supabase migration supersedes it
  — *caveat:* keep the local backup until cloud sign-in is the default.
- **A6 — Tag releases to the build version.** `git tag v0.x` (matching `BUILD`) + a GitHub Release per
  ship, for a labelled rollback point. *Then (lighter alternative):* tags only, no notes — *caveat:* less
  context on what each release shipped.
- **A7 — Lighthouse 85 → 90.** Add a Lighthouse CI GitHub Action to auto-catch perf regressions. *Then
  (lower priority, higher risk):* split/lazy-load the engine (= REV-14) for the real score gain —
  *caveats:* a big engine change; do it only after REV-01 makes the gate real.
- **A8 — AI working defaults.** Add a short "working efficiently" note to `docs/HOW-TO-WORK.md`: Sonnet +
  default effort for spec-driven execution (Opus only for ambiguous/architectural), one task per fresh
  session, read big files once.
- **A9 — Orphaned-export sweep.** One-time audit: grep every named export in `js/engine.js`'s Exports
  line and confirm each is referenced by at least one of the three tools; write findings to
  `docs/sessions/<date>-orphaned-export-sweep.md` (find-and-report only — no deletion inline). File any
  confirmed zero-reference export as its own follow-up roadmap item, same pattern as REV-13's dead grant
  maps.
- **A10 — Pre-release full-audit trigger note.** Document in `docs/HOW-TO-WORK.md` when a full
  multi-agent Workflow audit (rules-logic + security/RLS + usability click-through + docs-consistency
  lenses) is worth running — major releases/big refactors only, not routine PRs — with a sample workflow
  shape for reference.

---

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

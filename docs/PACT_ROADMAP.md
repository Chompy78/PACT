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
prune, PWA stale-version reload-prompt fix, Live Sheet mobile density/collapse) has landed and graduated
to `CHANGELOG.md`.

---

# 🔴 NOW — high-severity fixes + cleanup

## Live Sheet: undo doesn't work properly — TODO
Branch `fix/livesheet-undo-bug`. Reported by the user: in `tools/PACT-Live-Char-Sheet.html`, undoing an action produces incorrect state. Root cause not yet confirmed — needs investigation before a fix.

```text
1. Reproduce: exercise undo() (tools/PACT-Live-Char-Sheet.html:797) across a range of action types
   (normal buys, drawback buy-off, level/HD swaps, and specifically the Martially Bound / Magically
   Bound toggles) and compare pre- and post-undo compute() output for correctness.
2. Known lead to check first: Martially Bound (~line 1099) and Magically Bound (~line 1142-1143) apply
   a permanent "−1 AP, floor 1" discount that their own tooltips say is "reverse only by undo" — verify
   whether undo() actually restores this discount/flag correctly, since undo() (line 797) only pops the
   last LOG entry and re-renders; it does not appear to special-case floored/permanent discounts.
3. Also check the AP-award lock path in undo() ("AP awards lock your history — buys made before an
   award can't be undone") for edge cases (e.g. undoing right up to a lock boundary).
4. Once the actual defect is identified, fix it in the event-log replay / compute() path — do not
   patch around it with tool-local state; undo must stay correct via LOG replay (rebuildStateFromEvents).
5. If the bug turns out to affect compute() output/pricing, bump DATA.version and update the REV-01
   baseline in the same PR. If it's purely a Live Sheet display/state-sync issue, it's display-only —
   do NOT bump DATA.version; just log in CHANGELOG.
```
**Done when:** undo() produces state identical to what compute()/rebuildStateFromEvents() would derive from the LOG with the last entry removed, across normal buys, drawback buy-off, and the Martially/Magically Bound floor-1 discount case; parity still 5/0.

## Full engine module-bridge migration — CharGen, Live Sheet, DM Console — TODO
Branch feat/engine-bridge-all-tools. All three tools hand-copy DATA/compute()/MUT/baseBuild/
activeEvents/economy/foldBuild from js/engine.js instead of importing them — a direct violation of
AGENTS.md's "js/engine.js is the single source of truth... never re-implement rules logic anywhere
else." This supersedes Task 6 (CharGen-only) by extending the same migration to Live Sheet and DM
Console.

```text
1. CharGen (tools/PACT-CharGen-Webtool.html) — this is Task 6's scope, folded in here: add a
   <script type="module"> importing { DATA, compute, baseBuild, MUT, activeEvents, economy,
   foldBuild } from '../js/engine.js', copy each onto window, dispatch new Event('engine-ready');
   gate the existing UI <script> on that event; delete the inline DATA/compute() entirely.
2. Live Sheet (tools/PACT-Live-Char-Sheet.html) — its module script today only imports validate()
   plus sync/auth/campaign helpers (see D-GH9). Extend it to also import DATA, compute, baseBuild,
   MUT, activeEvents, economy, foldBuild from js/engine.js and copy them onto window alongside the
   existing bridge; delete its embedded DATA/compute/MUT/etc. copies.
3. DM Console (tools/DM-Console.html) — its module script today imports nothing from js/engine.js
   (only auth/campaign/dm helpers). Add a new import of DATA, compute, baseBuild, MUT, activeEvents,
   economy, foldBuild, validate from js/engine.js, copy onto window, wire into the existing
   campaign-ready gating; delete its embedded copies.
4. Compat check: CharGen's compute() differs from the canonical one only in the budget line
   (compute(b, opts={}) defaults spendable === b.budget). Before deleting Live Sheet's and DM
   Console's embedded copies, diff them the same way and log any real behavioral differences found.
5. Update AGENTS.md's "Architecture — read before editing" section to remove the "none of the three
   tools import these from js/engine.js today" language and describe the new bridged state.
6. Shrink/remove AUD-1's DATA/compute/MUT drift check (docs/PACT_ROADMAP.md) once all three tools
   are bridged — that audit step becomes unnecessary.
7. Log under a NEW decision code — next free is D-GH25 (D-GH24 was claimed by the theme-selector fix's
   restore-script-position decision) — documenting why all three tools were migrated together rather
   than one at a time.
```

**Done when:** no tool has an embedded copy of DATA/compute/MUT/baseBuild/activeEvents/economy/
foldBuild; CharGen, Live Sheet, and DM Console all import them from js/engine.js via their module
bridges; testing/tests/engine-parity.html still reports 5/0; AGENTS.md's architecture section
reflects the bridged state; Task 6 is closed/graduated by this task landing.

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

## Enable Supabase Auth leaked-password protection — TODO
Manual, dashboard-only — no branch, no code change. Found by the Supabase security advisor during the
2026-07-02 post-merge audit: leaked-password protection (checks new/changed passwords against
HaveIBeenPwned before accepting them) is currently disabled for this project.

```text
There is no MCP tool or SQL migration that reaches Supabase's Auth config — this is a project-settings
toggle, not a database object, so it can't be applied the way the other security fixes from that audit
were. Enable it by hand: Supabase dashboard → Authentication → Sign In / Providers → Password →
"Leaked password protection". Low effort, no downside for legitimate users (it only rejects passwords
already known to be compromised in other breaches).
```
**Done when:** the toggle is enabled in the Supabase dashboard; re-running the security advisor no longer
flags `auth_leaked_password_protection`.

## Lock down remaining Supabase function EXECUTE grants (anon) — TODO
Branch fix/lock-down-remaining-function-grants. Revoke the default Postgres EXECUTE-to-PUBLIC grant on the
~13 remaining flagged functions, matching the award_ap/award_xp fix already applied.

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

Re-verified live 2026-07-02 (post-hoc audit of that day's merged work), independent of the plan above —
confirms the analysis still holds and nothing is currently exploitable, so this stays a hygiene/defense-
in-depth task, not an urgent one:
- Queried `pg_proc.prorettype` directly for handle_new_user/add_owner_as_dm/set_updated_at: all three
  genuinely `returns trigger`. Postgres rejects any direct RPC/SELECT call to a trigger-returning
  function ("trigger functions can only be called as triggers") regardless of its EXECUTE grant, so
  these three are safe today even though the Supabase advisor still flags them.
- Queried the source of every remaining function: the internal-only helpers
  (is_campaign_owner/is_campaign_dm/is_campaign_member/shares_campaign), and the higher-stakes RPCs
  (join_campaign, join_as_dm, promote_to_dm, remove_dm, regenerate_invite_code,
  regenerate_dm_invite_code) all gate on `auth.uid()` equality checks or an explicit
  `if auth.uid() is null then raise exception` — since anon's `auth.uid()` is NULL, `dm_id = NULL` /
  `owner_id = NULL` correctly evaluates to false in Postgres, so every one of these safely rejects an
  anonymous caller today. Full live query results (via Supabase MCP `execute_sql`) available in this
  session's transcript if a future agent wants to re-derive rather than re-run them.
- Only `award_ap` is currently actually locked down (`anon_can_execute=false`); all ~13 others still show
  `anon_can_execute=true` live — confirming this task is still fully open, not partially done.
```
**Done when:** all ~13 functions show `anon_can_execute = false` / `authenticated_can_execute = true` live,
migration file committed, `sql/rls-policies.sql` matches.

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

## A2 — PR template with review-cadence checklist — TODO
Branch docs/pr-template-review-cadence. Promoted from LATER — makes the review habit sticky instead of
relying on memory (ties into this session's audit push).

```text
1. Add .github/pull_request_template.md containing the per-change checklist from AGENTS.md (parity gate,
   CHANGELOG/DECISIONS/sessions updates, version-sync check) so every PR auto-includes it.
2. Add a review-cadence line to the template: run /code-review (low/medium effort) on every PR before
   merge; run /code-review ultra specifically for PRs touching js/engine.js or sql/ (RLS/migrations)
   before merge, given the engine is the single source of truth and RLS is the only security boundary.
3. Optional follow-up (not required for this task): a fuller CONTRIBUTING.md if more people start
   contributing — caveat: a template isn't force-read the way a CI check is, so treat this as a nudge,
   not an enforcement mechanism.
```
**Done when:** .github/pull_request_template.md exists, includes the per-change checklist and the
review-cadence line, and appears automatically when opening a new PR against this repo.

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

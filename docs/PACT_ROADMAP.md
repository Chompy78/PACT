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

## Fix AGENTS.md's stale "module bridge" claim for Live Sheet/DM Console (HIGH) — TODO
AGENTS.md's Architecture section says Live Sheet and DM Console already load `DATA`/`compute`/`MUT`/
`baseBuild`/`activeEvents`/`economy`/`foldBuild` from `js/engine.js` via a module bridge, with only
CharGen (Task 6) still embedding its own copy. This is false: both tools' only `<script type="module">`
block bridges `validate()` plus sync/auth/campaign/dm helpers — `DATA`/`compute`/`MUT` are still hand-
copied top-level declarations in each tool's own HTML, exactly like CharGen (Live Sheet's own header
comment even documents this: "SHARED, DUPLICATED CODE ... copy-pasted into BOTH html files"). Discovered
while implementing Feature A (multi-tradition spellcasting, PR #85) — an engine.js-only MUT edit would
have shipped a feature that passed `engine-parity.html` while doing nothing in the actual tool, because
that gate only ever imports `js/engine.js`, never the tools' embedded copies. Full writeup: DECISIONS.md
D-GH9.
```
Marked HIGH because AGENTS.md is the first thing every agent session reads for architecture ground truth
— a wrong claim here doesn't just mislead a human, it can cause a future agent to silently ship a
no-op change while every automated check stays green. Two ways to close this, pick one:
(a) Correct AGENTS.md's wording to describe what's actually bridged (validate()/sync/auth/campaign/dm)
    vs. what's still hand-copied (DATA/compute/MUT/baseBuild/activeEvents/economy/foldBuild) per tool.
(b) Actually finish the bridge migration for all three tools' DATA/compute/MUT — Task 6 currently only
    scopes CharGen; this would need to become a 3-tool migration (bigger, higher-risk — touches every
    tool's rules-purchasing logic at once).
Recommend (a) first (cheap, immediately closes the misleading-docs risk) with (b) filed as its own
separate, larger migration task if the team decides the duplication itself is worth removing.
```
**Done when:** AGENTS.md's Architecture section accurately describes what's bridged vs. hand-copied in
each of the three tools (CharGen, Live Sheet, DM Console) — no agent reading it going forward would make
the same wrong assumption this session caught.

---

# 🟡 NEXT — medium-severity fixes + remaining build work


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

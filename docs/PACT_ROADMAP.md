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

*(No open NOW items — CU-4 and CU-6 graduated; the CharGen → Live Sheet save bug is closed by this change.)*

---

# 🟡 NEXT — medium-severity fixes + remaining build work


## REV-07 — Invite codes from a CSPRNG (MEDIUM) — TODO
`gen_invite_code` uses `floor(random()*36)` (non-CSPRNG), no throttling.
```
Build the code from gen_random_bytes(n) (pgcrypto already enabled) mapped onto the alphabet; consider 8
chars and/or rate-limiting join_campaign. Keep the check regex (update it if you lengthen).
```
**Done when:** codes still unique + match the check regex, sourced from `gen_random_bytes`.
(Full detail: REV-07.)

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

## Feature A — Live Sheet multi-tradition / multi-discipline spellcasting (+ Magically Bound) — TODO
Branch `feat/multi-tradition-discipline`. **Engine first** (extend `found`, add `dbound`), then the tools.
```
Allow buying >1 tradition and >1 discipline per tradition, each shown by name on its own row.
Per-discipline "Magically Bound" (one-way; reverse only by undo): Binding awards a flat +2 AP with NO
retroactive refund; the −1 spell discount (cantrips/slots/known, floor 1; not Foundation/Rank) applies
from then on. Move "Subclass spell lists" into the Magic category.
5 tasks across 2 files (parity stays 5/0 throughout). Execution order: 1 → verify parity → 4 → 5 → 3 → 2.
  1. js/engine.js (MUT) — extend `found` (add a discipline to an existing tradition) + add a `dbound`
     setter (sets d.bound on {ti,di}). Additive only, ZERO compute() change. VERIFY PARITY after task 1.
  2. Live Sheet — 'Spellcasting' GROUPS closure: iterate all traditions + disciplines, per-discipline
     headers, a Magically Bound toggle, and "Add discipline" / "Open another tradition" buttons.
  3. Live Sheet — priceOf: 3 lines so dbound/mbound flat-price ±2 AP (no full recompute). Also fixes a
     pre-existing Martially Bound refund bug.
  4. Live Sheet — _catOf: move 'Subclass spell lists' to Magic (2 lines).
  5. Live Sheet — ib() tooltip wiring (1 line) + pass a descr to Martially Bound's ib() call.
Full spec: IMPLEMENT-multi-tradition-discipline.md (+ ENGINE-CHANGES-prompt.md for the engine slice);
snippets are from a v0.322 standalone — read the live code and adapt. Read the Live Sheet HTML ONCE and
apply tasks 4,5,3,2 in a single editing pass (it's large).
```
**Done when:** multiple traditions/disciplines buy + display correctly; Magically Bound applies +2/−1 with
no retroactive refund; subclass lists sit under Magic; parity stays 5/0.
⚠️ Kit claims `compute()` / `DATA.version` are untouched — **verify that for a pricing feature**; if pricing
changes, update the REV-01 baseline and follow the version rule. Log under a **NEW** decision code
(**D-GH9** — the draft's "D-GH3" is already taken).

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

## AUD-1 — Automated health check (static audit + RLS proof) — TODO
The repeatable "is the system still healthy?" check you asked for — a stdlib Python script, no installs,
runs in seconds.
```
testing/scripts/audit.py (Python stdlib only) — file-based checks, run before every commit:
- every service-worker PRE_CACHE URL exists on disk; icons 192/512/180 present; 404.html exists
- manifest has required fields, scope + start_url = /PACT/, and a maskable icon
- SW registration present in every HTML page; no unconditional skipWaiting() in the install handler
- flag any asset > 100 KB
- CharGen's embedded DATA/compute still matches js/engine.js (until Task 6 removes the copy)
Optional RLS proof (Python + requests, credentials entered at runtime — never commit them): as a non-DM
player, confirm BOTH writes are REJECTED via the Supabase REST API — (a) writing characters.ap (the DM-only
column lock) and (b) setting campaign_id to a campaign never joined (proves REV-04 is closed).
```
**Done when:** runs clean on a healthy tree and fails loudly on a planted break (a missing PRE_CACHE file,
or a player REST write to `ap` that succeeds). Pairs with REV-01/REV-11 — engine-parity joins CI once
REV-01 makes the gate assert.

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
   NEW decision (next free code: D-GH14) rather than silently doing nothing.
```
**Done when:** engine-parity.html reports more than 5 fixtures covering at least prereq-gate rejection,
drawback buy-off, and one racial/mastery discount case, each with a human-reviewed CSV baseline; parity
still reports all green (N passed / 0 failed).

---

# ⚪ LATER — low-severity fixes + ideas (not scheduled)

**Low-severity review findings:**
- **REV-10** — `.claude/` is tracked despite `.gitignore`. Fix: `git rm --cached -r .claude` (keep on disk), commit.
- **REV-11** — No CI. Add a headless Node runner that imports `js/engine.js`, runs the fixtures, and asserts
  against `expected-results.csv` (pairs with REV-01); wire as a GitHub Action on PRs. No npm *runtime* deps.
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

---

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

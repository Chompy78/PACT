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
**REV-01** regression gate, **REV-02** SW same-origin cache fix, **REV-03** SW network-first) has landed and graduated to `CHANGELOG.md`.
Review findings **REV-08** (docs drift) and **REV-09** (scratch file) will be closed by the
**still-pending CU-1 / CU-3** tasks below — not done yet.

---

# 🔴 NOW — high-severity fixes + cleanup

> **Quick win first:** CU-1 and CU-2 are ready-to-commit files — knock those out immediately. The HIGH
> fixes (REV-01…04) are the priority work in this bucket.

## CU-1 — Single-source agent docs — TODO  *(closes review REV-08)*
Files provided — just commit: overwrite `AGENTS.md`; replace `CLAUDE.md` with the `@AGENTS.md` stub and
`.github/copilot-instructions.md` with the pointer stub; update `docs/HOW-TO-WORK.md` (drop the "three
identical copies" chore).
**Done when:** `git grep -l "Master copy"` is empty; `CLAUDE.md` is the stub.

## CU-2 — Commit VERSION-SYNC.md + confirm build versions match — TODO
Add `docs/VERSION-SYNC.md` (provided). Verify `BUILD` in `js/engine.js` equals the CharGen / Live Sheet /
DM Console labels (all `v0.107` now). `index.html` reads `BUILD` live — don't touch it.
**Done when:** `docs/VERSION-SYNC.md` committed; `BUILD` matches all three tools.

## CU-3 — Tidy root & test files — TODO  *(closes review REV-09)*
Delete `index.old.html` + `.tmp-verify.mjs`; move `campaign-test.html` + `sync-test.html` into `testing/`;
keep `login.html` + `docs/history/`; fix `testing/README.md` (it holds a stray repo description).
**Done when:** root is clean; harnesses open from `testing/`; `engine-parity.html` still 5/0.

## CU-4 — Prune merged branches — TODO  *(after promoting `preview → main`)*
Delete (merged into preview): `data/tools-v0.332`, `engine/data-v0.332`, `feature/dual-source-ap`,
`feature/live-sheet-dual-ap`, `fix/engine-v0.332-data`, `task1/pwa-shell`, `task2/auth`,
`task3/sql-data-model`, `feature/campaign-play`; on origin also `feature/homepage-index`. KEEP `main`,
`preview`, `task2/auth-gate`.
**Done when:** `git branch` shows only `main`, `preview`, `task2/auth-gate` (+ anything active).

## CU-6 — (optional) Rename `DM Console.html` → `DM-Console.html` — TODO
Drop the space; update index menu link, SW precache, and any other references.
**Done when:** nothing references "DM Console.html"; console opens + is precached; parity 5/0.

## CharGen → Live Sheet button does not save character — TODO
Branch fix/chargen-live-sheet-save. Investigate and repair the character export/save path from tools/PACT-CharGen-Webtool.html into the Live Sheet workflow so pressing the Live Sheet button creates a usable character in the local environment.
```text
1. Reproduce the failure from a clean browser profile and confirm whether the button:
   - does nothing,
   - throws a JS error,
   - creates malformed export data,
   - fails to hand off to the Live Sheet,
   - or fails local persistence.
2. Trace the entire flow: CharGen export → transfer payload → Live Sheet import/load → local storage save.
3. Add console-visible error handling instead of silent failure.
4. Verify a newly created character can be exported from CharGen, opened in Live Sheet, and is present after page reload.
5. Add a regression check covering the export/import path.
6. Best done after Task 6 — or update CharGen's embedded copy too.
7. If mechanics or compute() output are untouched, treat as display/integration-only — do NOT bump DATA.version; just log in CHANGELOG.
```

---

# 🟡 NEXT — medium-severity fixes + remaining build work

## REV-05 — Sync: compare parsed instants, not strings (MEDIUM) — TODO
`js/sync.js:125` does `local.updated_at > server.updated_at` — breaks across `Z` vs `+00:00` / differing
precision, causing lost updates.
```
const localNewer = local.dirty && Date.parse(local.updated_at) > Date.parse(server.updated_at);
```
**Done when:** mixed-format timestamps order correctly; add a unit test. (Full detail: REV-05.)

## REV-06 — Offline delete: tombstones so it stays deleted (MEDIUM) — TODO
Offline, `deleteCharacter` removes local but not server, so the row re-pulls on reconnect.
```
Maintain a pact-deletes tombstone list; syncAll/online handler replays delete().eq('id',…) then clears
it; listCharacters filters out tombstoned ids so they don't reappear.
```
**Done when:** delete offline → stays gone in UI; on reconnect server row is removed, never re-pulled.
(Full detail: REV-06.)

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

## CU-7 — CharGen mobile: surface save/load/livesheet action buttons — TODO
```
In tools/PACT-CharGen-Webtool.html, desktop shows character action buttons (Save, Load, Export to
Live Sheet, etc.) near the top of the page. On mobile the sticky header takes over and those buttons
become inaccessible — players cannot save, load, or hand off to the Live Sheet without switching to
desktop mode.

Add a non-sticky action button row for mobile (below the sticky header, above the main content):
1. Grep for the desktop button group (Save, Load, Export/Live Sheet IDs/classes) — do NOT read the
   whole file.
2. Render a <div class="mobile-action-bar"> (or equivalent) immediately after the sticky header
   container, visible only at the mobile breakpoint already used in the file (CSS media query).
3. Do NOT place these buttons inside the sticky header element — they must sit outside it.
4. Avoid duplicate IDs; use classes or data-attributes and re-bind/delegate handlers as needed.
5. Keep the desktop layout pixel-identical. Parity gate must stay 5/0.
```
**Done when:** at a mobile viewport (≤ the file's existing breakpoint), Save, Load, and
Export-to-Live-Sheet buttons (plus any other character-management actions shown on desktop) appear
and work at the top of CharGen without being inside the sticky header; desktop layout is unchanged;
`engine-parity.html` reports 5/0.

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

## Standardise CharGen toolbar spacing — TODO
Branch fix-toolbar-gap. Remove inconsistent spacing between Campaign and Live Sheet in the CharGen toolbar so all toolbar buttons use the same gap and alignment.

```text
Review the CharGen toolbar HTML/CSS.
Identify any custom margin, spacer, flex rule, or grouping that creates extra space between Campaign and Live Sheet.
Refactor so toolbar button spacing is controlled by the shared toolbar layout only.
Do not change button order, labels, sizing, or functionality.
Display-only — do NOT bump DATA.version; just log in CHANGELOG.
```

---

## Feature: Local AI portrait generation — TODO
Branch feat/local-ai-portrait. Add a "Generate Portrait" button to CharGen/Live Sheet that sends a prompt to a local image-generation server (e.g. Automatic1111/ComfyUI) and saves the returned image as a local file download.

```text
Add a "Generate Portrait" button to the character UI (CharGen and/or Live Sheet toolbar).
On click, build a prompt from character data (name, race, class, etc.) and POST it to a configurable local endpoint (default: http://localhost:7860 for Automatic1111).
On success, offer the returned image as a browser file download (PNG).
Store no image data in Supabase or localStorage — download only.
The endpoint URL should be user-configurable (a settings field or prompt dialog), not hardcoded.
Display-only — do NOT bump DATA.version; just log in CHANGELOG.
```

**Done when:** clicking the button sends a request to the local endpoint, the response image downloads to the user's machine, and parity is still 5/0.

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

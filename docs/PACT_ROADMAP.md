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

_(none currently — the last NOW item, the full engine module-bridge migration, graduated to
`CHANGELOG.md` on 2026-07-10.)_

---

# 🟡 NEXT — medium-severity fixes + remaining build work

## Feature: CharGen campaign-rules awareness (sign-in + live enforcement) — TODO
Branch feat/chargen-campaign-rules. **Blocked on one specific import, not the old "Task 6" gate** — CharGen's
DATA/compute() module bridge landed in D-GH26, so that part of the old blocker is cleared. But CharGen's
bridge is "DATA+compute only" (see AGENTS.md Architecture section) — it does **not** yet import `validate()`
from `js/engine.js`, and CharGen has zero cloud/auth integration today (no sign-in, no campaign selection,
only a one-way local "Export to Live Sheet" handoff). Wiring campaign rules in now would still mean
duplicating `validate()` logic outside `js/engine.js` — exactly what AGENTS.md's hard rule forbids — until
CharGen's existing module bridge is extended to also import `validate()` (a small, standalone addition;
does not require the full `feat/engine-bridge-all-tools` NOW item to land first).

```text
Context: DM campaign rules (banned species/masteries/boons/origin classes, multi-discipline toggle) are
enforced today only in Live Sheet, at the "Save to cloud" step (see D-GH14) — because that's the only
tool with cloud/auth wiring. This means a player who builds an entire character in CharGen around a
banned choice only discovers the problem after exporting into Live Sheet and trying to push to the
cloud, forcing a trip back to CharGen. A live-filter follow-up (this same session, docs/PACT_ROADMAP.md
history) closed most of that gap for Live Sheet itself — banned masteries/boons are no longer even
selectable there — but CharGen, where a character's species/origin class are actually chosen, still has
no visibility into any campaign's rules at all.

1. Extend CharGen's existing module bridge to also import `validate` from `js/engine.js`, then add
   sign-in (js/auth.js) and campaign selection (js/campaign.js listMyCampaigns/getCampaign) to CharGen,
   matching the bridge pattern already used in Live Sheet.
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
logic is duplicated outside `js/engine.js`; parity still 20/0.

## Externalize CharGen default AP + AP-by-level table — TODO
Branch feat/ap-by-level. Previously gated on "Task 6" (CharGen's DATA/compute bridge) — that landed in
D-GH26, so CharGen now imports `DATA` live from `js/engine.js` and this task is unblocked and can proceed
independently of the remaining `feat/engine-bridge-all-tools` work.
- Add js/ap-by-level.js exporting AP_BY_LEVEL = {1:50, 2:70, ...} and DEFAULT_LEVEL.
- js/engine.js imports it and surfaces it on DATA (DATA.apByLevel, DATA.defaultAp). All three tools get
  it automatically via their existing DATA bridge.
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
badged in DM Console; CharGen exports are signed; parity stays 20/0.
⚠️ Log under a **NEW** decision code (**D-GH10** — the draft's "D-GH4" is taken).

## AUD-1 — Automated health check (static audit + RLS proof) (HIGH — scope widened) — TODO
The repeatable "is the system still healthy?" check you asked for — a stdlib Python script, no installs,
runs in seconds.
```
testing/scripts/audit.py (Python stdlib only) — file-based checks, run before every commit:
- every service-worker PRE_CACHE URL exists on disk; icons 192/512/180 present; 404.html exists
- manifest has required fields, scope + start_url = /PACT/, and a maskable icon
- SW registration present in every HTML page; no unconditional skipWaiting() in the install handler
- flag any asset > 100 KB
- MUT drift check, CharGen + DM Console only (narrowed after D-GH26's safe-subset bridge, see the "Full
  engine module-bridge migration" NOW item above): `DATA`/`compute`/`baseBuild` are now live imports in
  all three tools and can no longer drift by definition — only CharGen's and DM Console's still-hand-copied
  `MUT` (and, if this audit is extended later, the index-based `activeEvents`/`economy`/`foldBuild`
  closures) remain a real risk. Check those two tools' embedded `MUT` against js/engine.js's export and
  fail loudly on any mismatch. This becomes unnecessary for whichever tool(s) eventually get their `MUT`
  bridged too.
Optional RLS proof (Python + requests, credentials entered at runtime — never commit them): as a non-DM
player, confirm BOTH writes are REJECTED via the Supabase REST API — (a) writing characters.ap (the DM-only
column lock) and (b) setting campaign_id to a campaign never joined (proves REV-04 is closed).
```
**Done when:** runs clean on a healthy tree and fails loudly on a planted break (a missing PRE_CACHE file,
a player REST write to `ap` that succeeds, or a hand-edited mismatch between any tool's embedded copy and
js/engine.js). Pairs with REV-01/REV-11 — engine-parity joins CI once REV-01 makes the gate assert.

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

**Done when:** a player can clone a campaign character to a standalone record; the clone appears in their character list with ap = 0; the original is unchanged; parity still 20/0.

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

**Done when:** a DM can copy rules from one of their campaigns into another and save them; the source campaign is unchanged; parity still 20/0.

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

**Done when:** advancement tracks are stored in engine data; a DM can select or customise a track per campaign; the Live Sheet shows the D&D 2024 equivalent level label; parity still 20/0.

---

## Document a rules-correctness review pass in docs/HOW-TO-WORK.md — TODO
Branch docs/rules-review-note. `/code-review`'s default lens is bugs/reuse, not domain (PHB) correctness.

```text
Add a short note + example prompt: for any PR touching js/engine.js's compute()/DATA, run /code-review
with an explicit instruction to check the math against the Player's Guide (caps, gates, prices) rather
than only generic code-quality issues.
```
**Done when:** docs/HOW-TO-WORK.md documents this usage pattern with a copy-pasteable example prompt.

## AUD-1 follow-up: version/build-sync check — TODO
Branch chore/aud1-version-sync-check. Do AFTER AUD-1 (Automated health check) lands.

```text
Extend testing/scripts/audit.py (from AUD-1) with a check that BUILD (js/engine.js) and its mirrors
(CharGen title/header, Live Sheet line-1 comment, DM Console TOOL_VERSION) all match. DATA.version no
longer needs a separate CharGen-mirror check — CharGen imports DATA live from js/engine.js as of D-GH26,
so there's no embedded copy left to drift.
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
**Done when:** a PR that breaks a fixture fails CI automatically; a clean PR passes; parity still 20/0
when run locally too.

## Fix: feature-search autocomplete renders off-screen once the page is scrolled — TODO
Branch fix/chargen-feature-autocomplete-scroll-position. Found while building the character-gen e2e
harness (testing/scripts/random-manual-e2e.mjs, PR #146 and follow-up). Display-only — do NOT bump
DATA.version; just log in CHANGELOG.

```text
In tools/PACT-CharGen-Webtool.html, the "Chosen features" search autocomplete menu (`.featac`, built by
the `_featAC` input handler) is `position: fixed`, but its `top` is computed by adding the input's
viewport-relative getBoundingClientRect() position PLUS window.scrollY. Since `position: fixed` is
already viewport-relative, this double-counts the scroll offset — the menu's computed `top` ends up
scrollY pixels too far down. Confirmed live via getBoundingClientRect(): with scrollY=347 on a page
~10500px tall, the menu rendered at top=4005px inside a 4000px-tall viewport — genuinely off-screen.

Repro: open CharGen, scroll down at all (the form is long), type into "+ search all" under Chosen
features. The suggestion dropdown appears but renders below the visible viewport — unclickable until you
scroll back to the very top.

Fix is one of:
1. Don't add window.scrollY when positioning a position:fixed element (likely the simplest, correct fix).
2. Or switch the menu to position:absolute if scroll-following was actually wanted.
```
**Done when:** opening the feature-search autocomplete at any scroll position renders the suggestion
list fully within the viewport, verified manually at a few scroll depths and by the e2e harness (which
currently works around this with a forced scroll-to-0 + oversized viewport — that workaround can be
removed once this lands). Parity still 20/0 (unaffected — no engine.js change).

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

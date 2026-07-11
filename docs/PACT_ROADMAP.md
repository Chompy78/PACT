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

## Remove dead DATA keys (benchLevels, armourStandalone) — TODO
Branch chore/remove-dead-data-keys. Delete two provably-unused keys from the `js/engine.js` DATA literal — surfaced by the D-GH48 dead-code audit; both are read nowhere in `js/`, `tools/`, or `index.html`.

```text
- Remove "benchLevels":{...} from the inline DATA literal (~line 22): it's the exact inverse
  ({50:1,...,491:20}) of DATA.levelAP, made fully redundant once the AP ladder was externalized (D-GH48).
- Remove "armourStandalone":{"light":2,"medium":6,"heavy":10,"shield":2} from the same literal: an
  orphaned twin of the live DATA.armourClimb (same shape, never read).
- Confirm zero readers first for each: grep -rnoE 'benchLevels|armourStandalone' js/ tools/ index.html
  → only the definitions themselves. Do NOT remove DATA.levelAP/level1AP (intentional D-GH48 aliases) or
  DATA.armourClimb (has real reads).
- Do NOT re-inline benchLevels; if an AP→level inverse is ever needed, derive it from AP_BY_LEVEL in
  js/ap-by-level.js.
- Display-agnostic values, never read by compute() — do NOT bump DATA.version; log in CHANGELOG only.
```

**Done when:** both keys are gone from `js/engine.js`, the engine imports/parses cleanly, and
`testing/tests/engine-parity.html` is still **20/0**.

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

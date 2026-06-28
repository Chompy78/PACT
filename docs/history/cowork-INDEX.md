<!-- PACT-CURRENT build=v0.106 data=v0.322 -->
# PACT — START HERE (single front door)

> **New session? Read THIS file first, in full, before anything else.** It is the one entry point.
> `PACT-CONTEXT.md` is the deep authority and `RESTART-STATUS-v0.322.md` is the current state —
> both are linked from here and subordinate to it. **Current: build v0.106 · `DATA.version` v0.322.**
> If a number anywhere disagrees with the tools, **the tools win** (`node tests/audit-all.cjs`).

## Bootstrap line — paste this at the top of a new session
```
Read pact-hb/INDEX.md in full FIRST, then follow its read-order. Do not read any
HTML tool whole. If anything you find disagrees with the tools, the tools win
(node tests/audit-all.cjs).
```
A session reads nothing automatically — paste the line above, **or** put a pointer to this file in
your harness's auto-loaded doc (`CLAUDE.md` / `copilot-instructions.md`) so it loads every session.
The `version-consistency` gate (below) keeps this file from going stale silently.

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  ⛔  NEVER PASTE A WHOLE HTML TOOL INTO AN AI SESSION.                          ║
║  One tool file is 280–490 KB ≈ 90k–160k TOKENS, and re-reads the same ~238 KB  ║
║  engine duplicated across all four files.                                      ║
║   • To read RULES/LOGIC → read src/engine/ (data.js, compute.js, …) — small &   ║
║     single-source. NEVER read a whole HTML tool to "read the rules".            ║
║   • To change a NUMBER → edit src/engine/, run `node scripts/build.cjs`, then    ║
║     `node tests/audit-all.cjs`. NEVER hand-edit the engine inside an HTML file.  ║
║   • Open an HTML file ONLY to debug rendered output.                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

## ✍ Output format (ALWAYS)
When presenting recommendations, options, alternatives, or any multi-item list, label them as an
outline — a **CAPITAL LETTER for each group/category** and a **NUMBER for each item within it**
(A1, A2, B1…), so every item has a unique handle the user can refer back to. Apply to all such lists
unless told otherwise. Plain prose, single facts, and short confirmations don't need labels.

**Letters NEVER reset within a session — they keep climbing.** Each new response *continues* the
sequence where the previous one stopped: if the last reply ended at group **C**, the next reply starts
at **D** (not back at A). Run A…Z, then **AA, AB, AC…** like spreadsheet columns. Item numbers DO reset
to 1 inside each new group. This is what makes a handle stable — "**D2**" points to exactly one item in
the whole conversation, so the user can refer back to it turns later without ambiguity. *(The old rule
restarted at A1 every reply, so "A1" collided across turns — fixed; rationale in `DECISIONS.md` D-013.)*

**Render each item as its own Markdown list line** — `- **A1.** …` — **never** a bare indented line.
In most renderers a plain indented line under a heading is just a soft-wrapped continuation of one
paragraph, so the items **collapse together and run on** (hard to read). A `- ` bullet forces each item
onto its own line; the A1/B2 handle still does the addressing — the bullet just guarantees the break.

```
**A. <group / category>**          ← a first response might run A, B, C
- **A1.** <item>
- **A2.** <item>

**B. <group / category>**
- **B1.** <item>
…
**D. <group / category>**          ← the NEXT response CONTINUES at D — not reset to A
- **D1.** <item>
```

## ⚠ The one rule that drives token cost AND correctness
The engine (`DATA`, `compute`, `renderCharSheet`, `buildPortraitPrompts`, `eligibleSpells`) now lives
**once** in `src/engine/*.js` — the single source of truth. The four HTML tools still embed it inline
(so each stays a standalone single file; consoles carry `DATA`+`compute` only), but you **never edit
those copies by hand**. Edit `src/engine/`, run `node scripts/build.cjs` to re-inline into every tool,
then `node tests/audit-all.cjs`. The **build-check** gate (G1) fails if any tool drifts from `src/engine/`.

## Default working mode — token-efficient (engine edits)
- Edit the engine in `src/engine/` ONLY (`data.js`, `compute.js`, `renderCharSheet.js`, …); run
  `node tests/audit-all.cjs` for the logic gates. This is the cheap default — never open or
  regenerate a whole HTML tool just to make an engine change.
- While you work in `src/engine/`, if you haven't rebuilt, the **build-check** gate (G1) reports the
  tools as drifted/UNBUILT — that's expected; it just means the shipped files aren't regenerated yet.
- **Shipping the standalone HTML tools is a DELIBERATE, PROMPTED step.** Do NOT regenerate them
  automatically. When the user wants the shipped/standalone files (or before a release), **ask to
  confirm**, then run `node scripts/build.cjs` to re-inline the engine into every tool, and re-run
  `audit-all` until fully green. The built `.html` files stay fully standalone (engine inlined).

## Read-order for a new session
1. **This file** (`INDEX.md`).
2. `PACT-CONTEXT.md` — deep authority: what PACT is, the tools, invariants.
3. `RESTART-STATUS-v0.322.md` — current build state / what shipped last.
4. `2024-PHB-Species-Reference.md` — species data the engine relies on.
5. Spellcasting work → `spells/dnd-2024-spells.json` + `spells/dnd-2024-spell-grants.json`.
6. Editing the engine → edit `src/engine/`, then `node scripts/build.cjs`. Never open a whole HTML tool to edit the engine.

## Verify the build is healthy
`node tests/audit-all.cjs` runs **all 46 gates** and exits non-zero on any failure. Run it before
trusting any number and before shipping. Tests are **addressable by code** (groups A–G) — see
`tests/TESTS.md`:
- `node tests/audit-all.cjs C3` — one gate · `… B` — a whole group · `… --list` — the catalogue.
- In a session you can just say **"run test C3"** or **"run group B"**.

## Keep the history current — log as you go (3 docs, 3 jobs)
**Before you finish a session, update whichever apply** (newest entries at the TOP) — for any substantive
change, **not just version bumps**:
- **`archive/PACT-CHANGELOG.md`** — *what* changed. One condensed line (engine/tooling/structure/docs);
  format in its **"How to add an entry"** header.
- **`DECISIONS.md`** — *why*. Add/append a record (**Context → Options → Decision → Why → Status**) whenever
  you make or reverse an architectural or process decision.
- **`archive/sessions/<date>-<topic>.md`** — the *discussion*. A short narrative of what the session
  explored and landed on (history; non-authoritative).

On a `DATA.version` bump also refresh `RESTART-STATUS-v0.322.md` + the `PACT-CURRENT` markers (INDEX +
CONTEXT). Gates **G6**/**G3** catch only the *version* case — **the changelog/decisions/narrative updates
are on you, so do them before you finish.**

## Files by role

### Docs (cheap to read — start here)
| File | KB | Purpose |
|---|---:|---|
| `INDEX.md` | — | **This file — the single front door.** |
| `PACT-CONTEXT.md` | 15 | Authoritative hand-off: rules, tools, invariants. |
| `RESTART-STATUS-v0.322.md` | 3 | Current build/version state, recent engine deltas (history → `archive/`). |
| `DECISIONS.md` | — | **Why** it's built this way — decision records (Context→Options→Decision→Why→Status). Check before changing an architectural choice. |
| `2024-PHB-Species-Reference.md` | 8 | Species reference data. |
| `scripts/README.md` | 2 | The engine build/check + headless scripts and the edit→build→verify workflow. |

### Archive — history, NEVER auto-read (see `archive/README.md`)
Out of the live read-path on purpose. Open only when you need the back-story; the tools win regardless.
| File | KB | Purpose |
|---|---:|---|
| `archive/PACT-CHANGELOG.md` | 55 | Full condensed version history. |
| `archive/RESTART-STATUS-history.md` | 15 | Superseded v0.315 / v0.314 restart-status sections. |
| `archive/CONTEXT-history-v0313.md` | 2 | Superseded v0.313 rules-port WIP note. |
| `archive/PACT-ki-sorcery-resource-audit.md` | 11 | One-time ki/sorcery resource-tag audit (tags already applied in the engine). |
| `archive/fuzz/FUZZ-STRESS-PLAN.md` | 3 | Plan for the property-based / metamorphic / differential stress harness. |
| `archive/fuzz/fuzz-stress-harness.cjs` | 19 | The deterministic fuzz/stress harness (manual, long-running; not a gate). |
| `archive/sessions/` | — | Per-session discussion narratives — the "messy middle" behind the decisions (history). |

### Tools — the product (large; open selectively, never whole)
| File | KB | Purpose |
|---|---:|---|
| `PACT-CharGen-Webtool-v0.106.html` | 494 | **Builder** (canonical engine copy). Spend AP budget, themes, export livesheet JSON. |
| `PACT-Live-Char-Sheet-v0.106.html` | 409 | **Player/in-play** sheet: event-sourced log, undo/redo, frozen pricing. |
| `dm-consoles/DM Console - Unified-v0.015.html` | 298 | **The DM console** — Card + Table roster in one file (topbar toggle, default Card view), read-only, imports livesheet JSON. CardGrid + DataTable were merged into this and retired (v0.015 / G2 / D-010). |

### Data
| File | KB | Purpose |
|---|---:|---|
| `spells/dnd-2024-spells.json` | 79 | Spell definitions. |
| `spells/dnd-2024-spell-grants.json` | 26 | Spell-grant mappings. |
| `tests/fixtures/Darion_Vale.json` | 38 | Canonical character fixture for tests. |
| `tests/guide-prices-v0.322.tsv` | 17 | Frozen price snapshot reconciled against the players' guide. |

### Source — the engine, single source of truth (edit HERE)
| File | KB | Purpose |
|---|---:|---|
| `src/engine/data.js` | 187 | The `DATA` constant (ladders, prices, catalogues). |
| `src/engine/compute.js` | 30 | The `compute()` engine (all derived stats, warnings, economy). |
| `src/engine/renderCharSheet.js` | 18 | Character-sheet renderer. |
| `src/engine/buildPortraitPrompts.js` | 2 | Portrait-prompt builder. |
| `src/engine/eligibleSpells.js` | 1 | Spell-eligibility logic. |

### Scripts (engine build & maintenance)
| File | KB | Purpose |
|---|---:|---|
| `scripts/build.cjs` | 1 | **Re-inline `src/engine/` into every standalone HTML tool.** Run after any engine edit. |
| `scripts/build-check.cjs` | 1 | Gate **G1**: verify every tool's engine matches `src/engine/` (no drift). |
| `scripts/extract.cjs` | 1 | One-time: (re)create `src/engine/` from the canonical CharGen tool. |
| `scripts/headless.cjs` | 4 | Run the engine headless to verify numbers without a browser. |
| `scripts/parity.cjs` · `scripts/apply-shared-edit.cjs` | — | **Superseded** by the src/build flow; kept for reference. |

### Tests — 46 coded gates under `tests/` (catalogue: `tests/TESTS.md`)
Run all with `node tests/audit-all.cjs`, or by code/group (`… C3`, `… B`, `… --list`). Groups:
**A** economy/ledger · **B** spellcasting · **C** class features & combat · **D** build/lifecycle ·
**E** data integrity · **F** UI/theme/render · **G** engine parity & meta-gates. Manual tools (not gates):
`guide-reconcile.cjs --strict` (0-drift vs guide) and the archived fuzz harness (`archive/fuzz/`).
**Tests reference files by relative path — do not move files without updating paths and re-running `audit-all`.**

## Keeping this front door honest
The `<!-- PACT-CURRENT … -->` marker on line 1 is checked by `tests/version-consistency.cjs` against
the real `DATA.version` in the tools. If you bump the build, update that marker (and the same marker in
`PACT-CONTEXT.md`) or `audit-all` goes red. That is what stops this file from silently lying to the next session.

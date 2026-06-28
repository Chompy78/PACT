<!-- PACT-CURRENT build=v0.106 data=v0.322 -->
> **Entry point is `INDEX.md` — read that first.** This file is the deep authority it points to.
>
> **⚙ Engine workflow (UPDATED — read before editing):** the engine (`DATA`, `compute`,
> `renderCharSheet`, `buildPortraitPrompts`, `eligibleSpells`) is now **single-sourced in
> `src/engine/*.js`**. Edit there, run `node scripts/build.cjs` to re-inline it into every standalone
> HTML tool, then verify with `node tests/audit-all.cjs` (the **build-check** gate = G1 fails on drift).
> Any section below that says "mirror to all 4/7 files", "apply-shared-edit", or "parity" describes the
> **SUPERSEDED** hand-sync flow — kept for context only; `build.cjs` does this now.

# PACT — Context & Hand-off (AUTHORITATIVE)

> **Build v0.106 · rules `DATA.version` v0.322.** (v0.322 port shipped — see `archive/PACT-CHANGELOG.md` and `RESTART-STATUS-v0.322.md`.) This file is the **single source of truth** for a
> fresh session. Everything in `archive/` is **historical and non-authoritative** — read it only for
> background, never act on it. When a number here and the tools disagree, **the tools win** (verify
> with `node tests/audit-all.cjs`).
>
> *(The superseded v0.313 rules-port WIP note was moved to `archive/CONTEXT-history-v0313.md`.)*

---

## 0. How to start a new session

**Restart message (paste verbatim):**
> *"Read `INDEX.md` in full FIRST, then `PACT-CONTEXT.md`, then the `<!-- AI CONTEXT -->` header inside
> ONE HTML tool (CharGen — never read a whole tool file just to read the rules), then
> `2024-PHB-Species-Reference.md`. `archive/` is history — do not act on it. #1 rule: `compute`,
> `DATA`, `renderCharSheet`, `buildPortraitPrompts`, and `eligibleSpells` are **byte-identical** in
> both tools — now **by construction**: the engine is single-sourced in `src/engine/*.js`. Edit there,
> run `node scripts/build.cjs` to re-inline into every tool, and `build-check` (gate G1) verifies no
> drift. (Do not hand-mirror the old way.) Current: build v0.106, `DATA.version` v0.322."*

**Files, in order:** 1) `INDEX.md` (front door) 2) `PACT-CONTEXT.md` (this) 3) `PACT-CharGen-Webtool-v0.106.html`
4) `PACT-Live-Char-Sheet-v0.106.html` 5) `2024-PHB-Species-Reference.md` 6) *(spellcasting work)*
`dnd-2024-spells.json` + `dnd-2024-spell-grants.json` 7) *(pricing authority)*
`PACT-Players-Guide-v0.322.docx`. Condensed history: `PACT-CHANGELOG.md`. All live in OneDrive
`Documents/Cowork`.

---

## 1. What PACT is
PACT (*Points · Aptitudes · Coin · Time*) — a points-buy advancement system for **2024 (5.5e) D&D** by
**John Chow / DragonReach Forge**. Instead of fixed classes/levels, a character earns **Advancement
Points (AP)** and buys abilities one at a time off escalating ladders. Golden rules: **(1) nothing is
free**; **(2) prices read "before the increase."** Three currencies (AP / Gold / Downtime); at
creation only AP applies. **Feats are removed** (replaced by Arts & Techniques).

## 2. The tools
| File | Role |
|---|---|
| `PACT-CharGen-Webtool-v0.099.html` | **Builder** — spend a DM-set AP budget; themes, budget meter, randomizer, printable sheet; exports `-livesheet.json`. |
| `PACT-Live-Char-Sheet-v0.099.html` | **Player / in-play** — event-sourced LOG of awards + purchases; undo/redo, frozen pricing, buy panel, A4 sheet, DM AP-grant codes, spell-naming picker. |
| `dm-consoles/DM-Console-v1…v5*.html` | **DM roster (read-only)** — 5 designs; import players' `-livesheet.json`; party economy/stats + AP-grant codes. Run the v0.309 engine. |

## 3. ⚠ The #1 maintenance hazard — shared, duplicated code
Five blocks are **copy-pasted byte-identical into both HTML tools** and must stay identical:
`compute(build)` (incl. user-facing warning strings) · the `DATA{…}` blob · `renderCharSheet(b,r,ctx)`
· `buildPortraitPrompts(b)` · `eligibleSpells(b,ti,di)`. **Per-file (NOT shared):** `SHEET_TOOL`,
printable-sheet CSS, and the Live-Sheet spell-picker modal (`openNames`/`saveNames`).

The **2 DM consoles** (CardGrid + DataTable; the other 3 were discarded in the v0.314 WIP) embed an engine bundle re-derived from the Live Sheet (`DATA` + `compute` + fold
+ `dmAnalyze`/`dmMakeGrant`, byte-identical across all 5, minus the spell layer). **Any engine/`DATA`
change must be mirrored into all 4 engine files and the consoles re-spliced**, or they silently run a
stale engine. Tooling that enforces this lives in `scripts/` (see §6).

## 4. Hard constraints (do not break)
1. **Single self-contained `.html`** — inline CSS+JS, no external deps / CDN / network / build step; runs from `file://`.
2. **Prices freeze at purchase** — rules-version changes never retro-change paid costs (grandfathered); the engine only *warns* about drift.
3. **Persistence is localStorage only**; keep the event-LOG / saved-JSON schema backward-compatible.
4. `compute()` is pure and must match the Players-Guide ladders.

## 5. Engine cheat-sheet (rules v0.309)
> Numbers below are the current truth but **verify against the tools** before relying on them:
> `node scripts/headless.cjs` dumps version, counts, ladders, and gate sets.

- **Level = Hit Dice**, gentle ladder (cum 130 @ 20 dice; 6 HP first die, +3 each later).
- **Tiers gate by Hit Dice (floor):** T1→1, T2→2, T3→3, **T4→5, T5→9, T6→13**, T7→17.
- **Master Cost Table (`DATA.MASTER`, v0.309 — unchanged since v0.301)** — sticker by tier × band (Situational · Per-Rest · At-Will · Passive · Premium):

  | Tier | Sit | PR | AW | Pass | Prem |
  |---|--:|--:|--:|--:|--:|
  | T1 | 2 | 3 | 4 | 5 | 12 |
  | T2 | 4 | 5 | 7 | 8 | 14 |
  | T3 | 6 | 8 | 10 | 11 | 16 |
  | T4 | 9 | 11 | 13 | 14 | 18 |
  | T5 | 12 | 14 | 16 | 17 | 20 |
  | T6 | 15 | 17 | 19 | 21 | 24 |
  | T7 | 18 | 20 | 23 | 25 | 28 |

  Per feature the tool **stores both** `origin` and `cross`: `origin = sticker − (tier−1)` (origin-class
  price) and `cross = sticker + tier` (cross-class). **7 intentional composites sit off-table** (4×
  Weapon Mastery, Bard: Beguiling Magic, Barbarian: Primal Champion, Warlock: Pact of the Tome) — never
  auto-reprice these.
- **Abilities:** start 10; +2 even step costs `4 + |mod before|`; creation dump −2 = +4 AP.
- **Speed (v0.095):** `speed = max(base-species, owned racial `spdSet`, `DATA.lineageSpeed[lineage]`) + Σ owned `spd` − drawbacks`. `spdSet`/lineage = idempotent **floor** (set-to); `spd` = additive bonus. Goliath: Long Stride (`spdSet:35`, T1 Passive) = buyable 35-ft floor (0 origin / 6 cross); Wood Elf gets 35 free+auto via `lineageSpeed`.
- **HP/resources:** Vigor +1 HP/die/rank (cap = CON mod); Grit **+4** flat (v0.314); Ki on the gentle curve;
  **Sorcery points = Hit Dice, FREE** with the Sorcerer Discipline (extras 3 AP each).
- **Classes:** origin discount −(Tier−1); cross +Tier; 2nd origin class = 14 AP; subclass unlock `DATA.subUnlock` = 15.
- **Spells (v0.315):** slots **4/6/8/10/12/14/16/18/20**; per spell-economy purchase **origin −1 /
  unlocked 0 / un-unlocked +1** (flat at every tier; Magically Bound −1 more); per-spell `knownUnit` = [1,1,2,2,3,3,4,4,5]; known cap =
  mod+HD, over-cap ×2; **prepared casters** (`DATA.prepared` = Cleric/Druid/Paladin/Ranger) get the list
  free; Warlock pact 3+3N + Mystic Arcanum.
- **Swaps (v0.100, LS-only, name picker):** saved spell/cantrip/arcanum/fighting-style names lock; **2 free swaps per Hit Die** (non-banking, shared pool across all categories; `swapHD`+`swapN` stamped on the `names` event, `avail = 2 − used-this-HD`). **Paid extra swaps — known spells only** — cost the normal learning cost `knownUnit[L-1]` (flat, no +1, no refund), carried on a `{type:'buy',cat:'swap',cost}` event (`economy` charges it; `foldBuild` no-ops the cat; `compute` untouched → **no shared block**). **Cantrips/Arcanum/Fighting Styles: free-swap-only** (no paid path; Arcanum capped at CHA mod, `d.arcanumNames`). **Fighting Styles (v0.100):** 12 `Fighting Style`-cat A&Ts (10 combat + Blessed/Druidic Warrior), free-selected via the Fighting Style feature (slots = owned FS features), excluded from the AP arts panel, named in `b.fightingStyleNames` (folded ×7), swappable. Blessed/Druidic Warrior (`reqFeat`, class-gated) grant 2 Cleric/Druid cantrips (`grantCantrips`, CHA/WIS) → `b.fsCantripNames` (folded ×7), swappable. Languages lock permanently. **Invocations: excluded** from swapping by design (breadth surcharge is a separate pricing task: +1 AP per 2 held, from 0, cap +20). Helpers `_swapCost`/`_swapTally`/`_swapSplit` (pure split, headless-exported)/`_swapAvailFrom`/`_swapDupes` (per-discipline dup guard, both tools); the known-row picker datalist is the combined `dl_…_all` (any eligible level, v0.101); the free-swap pool is shown live in the picker **and** as a persistent eco-line chip, with a red no-confirm warning when a Hit Die is bought while free swaps remain. Gates `tests/name-lock.cjs` + `tests/swap-cost.cjs`. *Done v0.322-F3: cross-level "pay the difference" — free-swap upgrade pays only `unit[newL]−unit[oldL]`, a paid upgrade pays the full new cost (`_swapTally` admits UP rows with an `unit[oldL]` surcharge; gate A5). Future: weapon-mastery/subclass-pick swaps.*
- **Current counts (verify via headless; v0.315):** features **318** (+ hidden back-compat aliases,
  excluded) · arts **43** (incl. 12 Fighting Style) · boons **88** (incl. 12 Epic Boons) · drawbacks
  **69** (incl. Peg Leg). Resource gates: **11** `needsKi`, **10** `needsSorc`.
- **Gating you must preserve:** Eldritch Invocations require a Warlock discipline; invocation
  prereqs/`lvl` gates; `needsKi`/`needsSorc` (⛔ at 0 resource); Tasha/non-core DM toggles.

## 6. Working in a new session
1. `node scripts/headless.cjs` — confirm current ground-truth before editing.
2. Make engine/`DATA`/`eligibleSpells` edits, mirrored to **all 7** engine files. `scripts/apply-shared-edit.cjs '<old>' '<new>'` applies one identical find→replace across all 7 (`--dry` to preview).
3. `node scripts/parity.cjs` — the 5 shared blocks must stay MD5-identical across both tools (and all 5 console bundles identical to each other).
4. `node tests/qa.cjs` (26 targets — incl. F1 guide-reconcile drift gate, which checks **both** `DATA.features` **and** the subclass price layer) + `node tests/gate-targets.cjs` (12) — must stay green; add/adjust targets for new behaviour. On a **guide drop**, run `node tests/guide-reconcile.cjs --regen <guide.txt>` to refresh the committed `tests/guide-prices-v0.309.tsv` snapshot, then F1 enforces engine↔guide parity (`--strict` exits non-zero on any drift). **Deep audits:** `node tests/deep-check.cjs` (14 layers) + `node tests/deep-check2.cjs` (10 layers). ⚠ **Pricing lives in 3 places** — `DATA.features`, `DATA.subclasses[cls][sub].abilities[]`, and `DATA.subAbilMap` — and CharGen reads the latter two; any feature reprice MUST update all three (deep-check L4 + the F1 subclass check guard this).
5. On a **rules** change: bump `DATA.version` + cosmetic labels. On a **significant build**: bump the build counter (filename + first-line header comment) and **update this file + `PACT-CHANGELOG.md` in lockstep**.
6. Never break the single-file/offline constraint (§4).

## 7. Open items (current only)
1. **Bonds — stage 2 (PARKED per John).** Both (a) CharGen mirror + carry-the-source-in-the-saved-JSON and (b) mechanical consequence ladders are parked.
2. **Swap system — cosmetic follow-up only.** *Excluded from swapping by design:* Wild Shape (a bought capability, not a named pick — nothing to swap), Eldritch Invocations, **Weapon Mastery** (per John — masteries are just bought; `X: Weapon Mastery` features stay buyable). *(Subclass-pick swap **removed v0.101** — no longer relevant per John.)* **C4 cosmetic slot-regroup — RESOLVED (v0.314 swap-convert).** A known spell swapped up a level is re-bucketed into `knownNames[newL-1]` on save (`saveNames`), and the sheet groups strictly by that bucket, so it now displays under its new level header. Verified + locked by `tests/slot-regroup.cjs` (the old "displays under original level" note predated swap-convert). *(Done v0.100: paid-swap undo atomicity; **Metamagic** + **Battle Master Maneuvers**; **cross-level swap (C4)** cost. Done **v0.101**: the cross-level picker is now actually reachable — known-row datalist offers any eligible level (`dl_…_all`); **per-discipline duplicate-spell guard** (`_swapDupes`, both tools); swap-cost **honesty** — `_swapTally` split extracted to pure headless-exported **`_swapSplit`**, every swap row recounts live, the box affirms free-vs-paid, and the 🔄 button no longer always says "free".)*
3. **Fighting-style polish.** Style **effects are descriptive** (player-applied; the engine records + displays them but does not auto-compute AC/attack math). *(Done v0.100: the Blessed/Druidic cantrip grant is now **live** — choosing the style reveals its cantrip slots immediately, no save-and-reopen.)*
4. *(low priority)* Design-polish: LS Arts buy-panel, printable-sheet layout, ability-palette WIS/INT closeness — **needs John's direction**.

*(Closed permanently v0.105: the **CON-upgrade undo bug** — never reproduced; verified across 8,000 randomized buy/undo/redo runs; the invariant stays guarded by `tests/undo-sim.cjs` (A2). See `archive/PACT-CHANGELOG.md`.)*

> **Shipped in v0.101 (this session):** swap-cost **honesty** (pure `_swapSplit`, live per-row free/paid preview, honest 🔄 label) · **per-discipline duplicate-spell guard** (`_swapDupes`, LS + CharGen) · **cross-level swap picker** (`dl_…_all`) · restored the **two-level collapsible buy-panel grouping** (`_catOf` + 6 super-cats) **and** the dropped **Cross-class features** buy section (`buyCls`/`setBuyCls`) — both lost vs v0.097 · **CharGen campaign bars now render** (apply rebuilds grids; barred = greyed+disabled, not omitted) · Live-Sheet **campaign chip** "Campaign 🛡 name" (mobile-truncated) · persistent **free-swap pool chip** + **red no-confirm level-up warning**. All edits per-file, **no shared/parity block touched**; parity holds; counts unchanged (arts 43 / boons 76 / drawbacks 68 / features 316). Gates green (the single pre-existing `deep-check2` M3b Fighting-Style `ap>0` mismatch is unrelated and predates this build).
>
> **Shipped in v0.100:** Bonds stage 1 · Centre no-Spellcasting view (LS `ctx.noSpell`) · name-lock + per-Hit-Die swap (**2/HD**, shared pool across spells/cantrips/arcanum/styles) · paid spell swaps · Arcanum swap · **Fighting Styles** (selectable + swappable; + Blessed/Druidic Warrior Cleric/Druid cantrip grant) · **Invocation breadth surcharge**. 18 gates green; arts 43 (12 Fighting Style).
> Convention: keep **Open items** a numbered list; John references suggestions by number.

---
*History: `PACT-CHANGELOG.md` (condensed, one line per build) · `archive/` (verbose work logs — non-authoritative).*

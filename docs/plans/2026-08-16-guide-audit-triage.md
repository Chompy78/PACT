# Guide-audit triage — what's mechanical vs what needs a decision

**Generated 2026-08-16** by `testing/scripts/guide-price-check.mjs` against the v0.333 guide and live
engine **v0.344**. Re-run it any time; this file is a snapshot, the script is the source of truth.

## Read this first

The 2026-08 audit (`pact-guide/plans/guide-audit-report.md`, 171 findings) is **a map of where to
look, not a source of fixes.** Verified failures in it so far:

- Its `Fix:` lines quote `origin` or `cross` where the guide's column needs **sticker** — wrong for
  findings **#36, #41, #42**. Applying them verbatim writes new errors.
- **Three of the five** findings in its Ch9–11 chunk (#3, #14, #17) were already fixed or never real.
- It marked Elf Fey Ancestry / Orc Relentless Endurance / Dragonborn Breath Weapon as needing
  correction *toward* the engine — but the **engine** was the defective side (fixed in v0.344).

Always re-derive the number from the live engine before editing. That is what the checker does.

## A — Mechanical. Engine value known, no judgement needed (11)

Safe to apply as a batch. Guide value → engine value.

| Line | Row | Guide | Engine |
|---|---|---|---|
| 633 | Brutal Strike, improved (L17) | T7 At-Will 23 (17) | **T5 At-Will 16 (12)** |
| 651 | Star Map (Guiding Bolt + free-cast + Guidance) | Bundle 5 | **T3 Situational 6 (4)** |
| 268 | Extra Attack (3 attacks, L11) | T5 Premium 20 (16) | base is **buy-once** — no such purchase |
| 268 | Extra Attack (4 attacks, L20) | T7 Premium 28 (22) | base is **buy-once** — no such purchase |
| 643 | Channel Divinity (3 uses, L6) | T4 Per-Rest 11 (8) | base is **buy-once** — no such purchase |
| 643 | Channel Divinity (4 uses, L18) | T7 Per-Rest 20 (14) | base is **buy-once** — no such purchase |
| 653 | Second Wind (3 uses, L4) | T3 Per-Rest 8 (6) | base is **buy-once** — no such purchase |
| 653 | Second Wind (4 uses, L10) | T5 Per-Rest 14 (10) | base is **buy-once** — no such purchase |
| 653 | Action Surge (2nd use, L17) | T7 Per-Rest 20 (14) | base is **buy-once** — no such purchase |
| 653 | Indomitable (2 uses, L13) | T6 Per-Rest 17 (12) | base is **buy-once** — no such purchase |
| 653 | Indomitable (3 uses, L17) | T7 Per-Rest 20 (14) | base is **buy-once** — no such purchase |

**Caveat on the nine "buy-once" rows:** mechanical only if the decision is *"the guide is wrong,
delete the row."* If the intent was that these purchases **should** exist, the fix is an engine
addition instead — see group B. The audit's own wording offers both ("delete the row, or implement
the ladder in DATA"), so this is a rules call, not a transcription.

## B — Needs an owner decision: delete the guide row, or add the missing engine feature? (18)

The guide advertises these; the engine has no key for them. Each is one question: *should this exist?*

**Features with no engine key**
`Bardic Inspiration` (L268) · `Elemental Fury` (L648) · `Improved Elemental Fury` (L648) ·
`Combat Superiority (Battle Master)` (L656) · `Martial Arts (L1)` (L658) ·
`Disciplined Survivor (Focus)` (L658) · `Aura range → 30 ft (L18)` (L663) ·
`Improved Cunning Strike (L11)` (L673)

**Spell bundles the resolver can't match** — probably naming, not missing data; worth checking before
treating as defects:
`Domain bonus spells` (L643) · `Oath bonus spells` (L663) · `Origin bonus spells` (L678) ·
`Patron bonus spells` (L683) · `Circle of the Land ↳ Arid / Polar / Temperate / Tropical` (L651)

**Spelling / naming**
`Agonising Blast` (L687) — engine key is `Agonizing Blast` (American). Guide uses British 7×.
`Devil's Sight` (L687) — check apostrophe form against the engine key.

## C — Not yet verified at all

- **Chunk 3 (#49–70)** — Ch12–13 and Appendix D spellcasting. The checker does **not** parse these
  tables, so their status is genuinely unknown. A 2026-08-16 session claimed to have applied them;
  the same session's claims about #22–48 proved false, so treat as unverified.
- **#102–171** — Appendices H and I. No task-board entries, and per the audit's own summary the
  single worst-affected section of the guide. Never inventoried.

## D — Known checker limitations (don't mistake these for guide defects)

- `stepped-feature` (22 rows) — repeatable features where one printed cell can't be checked against
  one value. The real ladder is printed alongside; rebuilding those row sets is manual.
- `unparsed-price` (11) — cells like `—`, `varies`, `free — set by race`. Mostly legitimate.
- `ambiguous` (3) — `Fighting Style` / `Channel Divinity` rows where class context didn't resolve.
- Bundle rows named generically (group B) are a **resolver** gap, not necessarily a guide error.

## Suggested order

1. Group A's two true price errors (Brutal Strike, Star Map) — unambiguous.
2. Group A's nine buy-once rows, **once you've answered delete-vs-implement**.
3. Group B, one decision each.
4. Extend the checker to Ch12–13, then settle group C's Chunk 3.
5. Inventory #102–171.

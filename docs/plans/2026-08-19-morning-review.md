# Morning review — 19 August 2026

Written overnight after the `preview` → `main` promotion (PR #423). Ordered by what can affect the real
characters being built this week.

**Shipped and live:** rules `v0.343 → v0.353`, `BUILD v1.423`, all 11 CI checks green. Players now get a
working class-unlock checkbox, a buyable `Elf: Wood Elf speed`, the feature-rename alias map, the ten
restored guide illustrations, the theme switcher, and Appendix J.

**Then you answered "b"**, and the drawback double-count — the one item that could unbalance your table
this week — was fixed too: rules `v0.354`, commit `80297f2`, on `preview`. Item 1 below is now a record
of what was done rather than a decision waiting on you.

**One thing is still deliberately NOT done:** the pre-release manual QA checklist. This session cannot do
manual QA, and both promotions have now gone out without it.

---

## 1. ✅ Drawbacks were worth double — FIXED overnight, model (b), rules `v0.354`

**Commit:** `80297f2` on `preview` · **Decision record:** `D-GH-2026-08-19-drawback-single-count` ·
**Status:** you answered "b" before bed, so this stopped being a decision and became work I could do.

### What was wrong

`foldBuild()` sets `b.budget = economy().earned`, and `earned` includes `drawbackEarned`. `compute()`
then did `playerAp = b.budget`. But `total` **already** netted drawbacks, because their `cost` is
negative. So a drawback both lowered what you spent *and* raised what you could spend.

Measured on the pre-fix engine — a level-1 Fighter awarded 79 AP:

| Drawbacks | Drawback AP | AP available (before) | AP available (now) |
|---|---|---|---|
| 0 | 0 | 79 | 79 |
| 2 | 14 | **107** | **93** |
| 4 | 26 | **131** | **105** |
| 6 | 37 | **153** | **116** |

### What model (b) does

A drawback is **income, not negative spending**. The grant reaches the character through `b.budget`
only; `total` no longer nets it. `79 + 14 granted − 3 spent = 90 remaining` — which is what the guide's
§14 prose already promised and what the ledger now actually shows.

The `Drawbacks (refund) −14` line **still appears** in the ledger with its itemised rows, via a new
`addDisplay()` helper that pushes a display row without touching `total`. Dropping the line would have
broken the invariant that every itemised group has a heading its rows sum to — which `tool-pricing-ci`
asserts, rightly.

The campaign drawback cap still works: excess is now withheld from the *budget*
(`_dWithheld = max(0, drawGain − granted)`) rather than clawed back from the total.

### Two things the fix turned up that were not in last night's writeup

1. **`b.budget` now carries a contract**, documented in the code: it is EARNED AP *including* drawback
   grants — exactly what `foldBuild()` produces. Every real caller folds, so every real caller satisfies
   it. A hand-authored build (a test fixture) that sets `budget` any other way now gets nothing from its
   drawbacks, because under (b) the grant arrives on the budget side and nowhere else.
2. **`economy()` was silently missing legacy drawbacks.** Older CharGen exports delivered drawbacks as a
   coalescing `patch` event whose whole cost is the grant, not as `cat:'drawback'` — fixture `LS-001`
   carries one. Before (b) that shape still worked by accident, because `total` netted the negative cost.
   Under (b) it would have granted **nothing**, quietly costing those characters their drawback AP.
   `_economyFrom` now recognises the legacy shape. Verified: LS-001 budget 81, total 79, remaining 2.

### Verification

All twelve gates green: parity **38/0** (up from 37 — new fixture `EV-019-drawback-counted-once`),
tool-pricing 134/0, chargen-flows 56/56, dm-console-ui 94/94, sw-cache pass, log-fuzz 500/500, four sync
gates 54/0, verify-guide 9/9. Guide §14 reworded to match. `DATA.version` → `v0.354`.

Fixture budgets that moved with the model change (all re-derived from the arithmetic, not fitted):
CG-002 50→51, CG-016 −26→0, CG-017 −12→0, LS-001 78→79, EV-017 4→6.

### Where it is now

Promoted to `main` in a second overnight promotion (see the promotion note at the bottom of this file),
under your "merge all these to main" instruction — the fix is live for your players. The pre-release
manual QA checklist still has not been run by anyone; see "What I would do first thing".
---

## 2. 🟠 The `pact-guide` copy-back — now five sessions behind

The Players Guide master lives in the non-GitHub `pact-guide` project. Everything below exists **only**
in this repo:

- ten embedded WebP illustrations and the four-theme system (restored after `e0c5e9f` deleted them)
- the guide's own theme switcher
- Appendix J
- the "Subclass bonus spells" section split out of "Prepared casters"
- twelve class-unlock price sites (7×N → flat 8)
- the 2nd origin class price (14 → 18) at four sites
- §14's drawback-cap wording
- six corrected Appendix I budget lines

**This is the highest-risk item that is not about this week's characters**, because the documented
transfer direction is master → served copy, and running it now would wipe all of the above.

**Do not use a plain `cp` in either direction.** Run `node testing/scripts/verify-guide.mjs` before and
after; a clean `diff` is explicitly *not* the success condition any more (see the ⛔ box in
`docs/VERSION-SYNC.md`). The file is 1.4 MB, too large to push through the home-server connector, so the
copy has to happen on your machine.

**Also unresolved from the same thread:** you wanted one canonical guide file shared by this repo,
`pact-guide` and `pact-guide-public`. The served copy is now ready for that — verified zero external
references and a defensive theme script — but `pact-guide-public` needs push access attaching before I
can do that side.

---

## 3. 🟠 `refactor/subclass-purchase-unify` — plan drafted, awaiting reviewers

**Cold review document:** `docs/plans/2026-08-18-subclass-purchase-unify-cold-review.md`

Buying the same subclass ability through both CharGen pickers charges twice, silently — 6 AP for a
Cleric buying *Preserve Life* at origin prices. Low exposure at tier 1–2 (only one subclass ability,
*Star Map*, is T1/T2) but it is a real way to lose AP with no warning.

Research changed the shape of the task: **all 192 mirrored abilities agree on price with `subAbilMap` —
zero divergences.** So this is deduplication, not reconciliation. No price has to be decided and no
character's cost should move, which the plan's verification section now asserts specifically.

Three options are put to the reviewers, deliberately not pre-judged, including the smallest one (keep
both representations, share one dedup domain). Ready to send whenever you want.

---

## 4. 🟡 Smaller, and none of them bite this week

| | What | Where |
|---|---|---|
| **Duplicate non-stacking purchases** | Six classes sell "Extra Attack"; the engine charges for all six (102 AP for a Rogue) and only *warns* that they do nothing. All T4 — no tier 1–2 exposure. | not yet on the board |
| **`documents-rules` unstamped** | The marker recording which engine version the guide's prose was reconciled against. Now `v0.353`. | `TASK_BOARD_NEXT` |
| **`ee8dc41`'s commit message is wrong** | It confidently describes a render race in `dm-console-ui-e2e` that cannot occur — the render chain is synchronous. Corrected in a comment at the site; the message itself stands. | — |
| **`z-cold/` housekeeping** | Processed reviews were never moved to `z-cold/processed/`, and `phb-rules-final.jsonl` is unfiled. Both on the `zcold` branch. | — |

---

## What I would do first thing

1. **Sanity-check the drawback fix in the actual tool**, not in the test output — open CharGen, take two
   drawbacks on a level-1 character, and confirm the ledger reads `budget 93 / spent 3 / 90 left` and
   still shows the itemised `Drawbacks (refund)` group. Five minutes, and it is the one thing the twelve
   automated gates cannot tell you: whether the numbers a *player* sees read sensibly.
2. **Run the pre-release manual QA checklist** in `docs/HOW-TO-WORK.md`. Two promotions have now shipped
   without it.
3. Then the copy-back (item 2 — highest risk of silent data loss), then the refactor reviews.

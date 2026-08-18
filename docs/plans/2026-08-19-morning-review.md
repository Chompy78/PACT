# Morning review — 19 August 2026

Written overnight after the `preview` → `main` promotion (PR #423). Ordered by what can affect the real
characters being built this week.

**Shipped and live:** rules `v0.343 → v0.353`, `BUILD v1.423`, all 11 CI checks green. Players now get a
working class-unlock checkbox, a buyable `Elf: Wood Elf speed`, the feature-rename alias map, the ten
restored guide illustrations, the theme switcher, and Appendix J.

**Then you answered "b"**, and the drawback double-count — the one item that could unbalance your table
this week — was fixed too. It took two goes: `v0.354` fixed the arithmetic but broke CharGen (read item 1,
it is the most useful thing in this file), and `v0.355` is the one that is actually right. Item 1 is now a
record of what was done rather than a decision waiting on you.

**One thing is still deliberately NOT done:** the pre-release manual QA checklist. This session cannot do
manual QA, and both promotions have now gone out without it.

---

## 1. ✅ Drawbacks were worth double — FIXED overnight, model (b), rules `v0.355`

**Commits:** `80297f2` (v0.354) then `bc4e186` (v0.355) on `preview` · **Decision record:**
`D-GH-2026-08-19-drawback-single-count` + its Addendum · **Status:** you answered "b" before bed, so this
stopped being a decision and became work I could do.

> **Read the "second go" section below before anything else.** The first fix was correct arithmetic and
> still broke the tool your players use, and the reason nothing caught it is a real gap in this repo's
> test suite that is now closed. It is the most useful thing that happened overnight.

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

### The second go — and why the first one was more dangerous than the bug

v0.354 delivered the grant through `b.budget` and documented that as a **caller contract**: *"`b.budget`
is earned AP including drawback grants — every real caller folds, so every real caller satisfies this."*

That last clause was false. **CharGen does not fold.** `readBuild()` reads the form, where `budget` is
the award field alone. So in the tool your players actually build characters in, v0.354 made drawbacks
worth **zero** — strictly worse than the double-count it replaced, and one merge away from going live.

I found it by driving a real drawback click in a headless CharGen before merging the promotion — the
"sanity-check it in the actual tool" step at the bottom of this file, done by machine. 79 AP award, two
drawbacks worth 6, budget still 79.

**Nothing in twelve gates could see it.** `engine-parity` asserts `total`, the warning count, the exact
warning text, and the *sign* of `remaining` — never the **value** of `budget` or `remaining`. All 38
fixtures pass whether a drawback is worth double, single, or nothing. `EV-019`, which I added
specifically to pin this and described to you as pinning it "end to end", could not.

`v0.355` fixes the shape rather than the symptom: `compute()` derives the grant from `b.drawbacks`
itself, and `b.budget` goes back to meaning **awards only**. No caller is asked about drawbacks, so no
caller can get it wrong. Patching CharGen to sum `DATA.drawbacks` itself was rejected — that is
re-implementing rules logic in a tool, which `AGENTS.md` forbids, and it leaves the trap armed for the
next non-folding caller.

Two gates now cover the income side:

- **`log-fuzz` income invariant** — `compute().budget === economy().earned` on every fuzzed log. It
  failed on its first run and exposed a *second* bug: `rebuildStateFromEvents()` also set
  `budget = economy().earned` and so double-granted every drawback. That is the entry point the parity
  runner uses for event fixtures, and nothing was comparing it against `foldBuild()` on this axis.
- **`chargen-flows-e2e`** — ten checks driving a real click in a real CharGen. 56 → **66**.

Both were verified by re-introducing each bug and watching them fail. With the double-count restored,
`log-fuzz` catches it and **parity still passes 38/0** — that measurement is why both gates exist.

### Two things the first fix turned up that were not in the pre-bed writeup

1. **`b.budget` now carries a contract**, documented in the code: it is EARNED AP *including* drawback
   grants — exactly what `foldBuild()` produces. Every real caller folds, so every real caller satisfies
   it. A hand-authored build (a test fixture) that sets `budget` any other way now gets nothing from its
   drawbacks, because under (b) the grant arrives on the budget side and nowhere else.
2. **`economy()` was silently missing legacy drawbacks.** Older CharGen exports delivered drawbacks as a
   coalescing `patch` event whose whole cost is the grant, not as `cat:'drawback'` — fixture `LS-001`
   carries one. Before (b) that shape still worked by accident, because `total` netted the negative cost.
   Under (b) it would have granted **nothing**, quietly costing those characters their drawback AP.
   `_economyFrom` now recognises the legacy shape. Verified: LS-001 budget 81, total 79, remaining 2.

### One thing found and deliberately NOT fixed

**The campaign drawback cap is DM-view-only.** `drawbackCap` appears in `DM-Console.html` and in neither
player tool — so a player in a campaign you have capped sees the *full* grant in CharGen and the Live
Sheet, while you see the capped figure. Pre-existing since v0.351, unrelated to this fix, but it matters
more now that the grant is real income rather than a cancelling pair. Fixing it means wiring the campaign
rules into both player tools, which is too wide to do unreviewed at 5am. **This is the one drawback-shaped
thing that can still bite you this week, and only if you run a capped campaign.**

### Verification

All gates green at `v0.355`: parity **38/0**, tool-pricing 134/0, chargen-flows **66/66**, dm-console-ui
94/94, sw-cache pass, log-fuzz 500/500 (and 3000/3000 on a second seed), four sync gates 54/0,
verify-guide 9/9. Guide §14 reworded to match — model (b) is unchanged, so the prose still holds.

CharGen verified by hand in a headless browser: 79 award + 6 AP of drawbacks → budget 85, total 0, AP
left 85, ledger row `Drawbacks (refund) −6` with both itemised rows intact.

Fixture budgets that moved: CG-016 −26→0, CG-017 −12→0, LS-001 78→79, EV-017 4→6 (v0.354), and CG-002
50→51→**50** — v0.354 raised it only to satisfy the contract v0.355 removed.

### Where it is now

Promoted to `main` as PR **#424**, under your "merge all these to main" instruction — the fix is live for
your players. The pre-release manual QA checklist still has not been run by anyone; see "What I would do
first thing".
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

1. **Sanity-check the drawback fix in the actual tool** — open CharGen on a level-1 character, tick
   `Frail` (4) and `Asthmatic` (2), and confirm the header reads **85 AP** where it read 79, with the
   itemised `Drawbacks (refund) −6` group still in the ledger. A headless version of exactly this is now
   a permanent gate, so this is a confidence check rather than a discovery one — but it is the only step
   that tells you whether the numbers *read* sensibly to a player, which no assertion can.
2. **Run the pre-release manual QA checklist** in `docs/HOW-TO-WORK.md`. Two promotions have now shipped
   without it.
3. Then the copy-back (item 2 — highest risk of silent data loss), then the refactor reviews.

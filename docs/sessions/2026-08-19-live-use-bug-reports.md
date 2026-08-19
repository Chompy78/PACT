# 2026-08-19 — the night the tools met real characters

A long session in two halves. The first was planned rules work carried over from the previous night. The
second was not planned at all: the owner started building this week's real characters against the live
tools and reported what he saw, one thing at a time. **Every bug in the second half came from use, not
from a gate** — and each one, chased properly, turned out to be a symptom of something larger than the
report described.

Sibling note: `2026-08-19-amble-rules-restamp.md` is a *different* session's record, written concurrently.
See "Two agents, one repo" below.

## Half one — finishing the drawback model

The owner's overnight instruction was to fix what was unambiguous and merge it. That produced `v0.354`
(a drawback is income, not negative spending — model (b)), then `v0.355`, then `v0.356`.

Three versions for one idea is the story. **v0.354 was arithmetically correct and broke CharGen.** It
delivered the drawback grant through `b.budget` and documented that as a contract "every real caller
satisfies". CharGen does not fold — `readBuild()` reads the form — so in the tool characters are actually
made in, drawbacks became worth **zero**: strictly worse than the double-count it replaced. Twelve gates
passed, because all twelve fold.

`v0.355` moved the grant inside `compute()`, deriving it from `b.drawbacks`, so no caller is asked and
none can get it wrong. `v0.356` answered the question that only appeared once the grant was real income:
does a drawback survive `ignore_player_ap`? The owner ruled it does — *"they just get the AP, it's not
considered a grant but a trade for a drawback"* — which also forced `earnedWithDm()` to carve the same
exception, or the frozen ledger and the recompute would have disagreed by exactly the grant.

**The lesson that generalises:** a contract a caller can quietly violate is not a contract, it is a trap.
Deriving the value where the rules live made the bad state unrepresentable.

## Half two — six reports, six deeper problems

Each report and what it actually was:

| Reported | Actually |
|---|---|
| "AP budget decreases by 4 each time I open Moss" | **Data loss.** Two sites still subtracted the drawback total from the award — correct under D-GH41, a *second* subtraction after v0.355. The character's stored log was rewritten downward once per open: 79 → 75 → 71 → 67 → 63, unbounded. Introduced by my own v0.355 and live on `main` for hours. |
| "species pack doesn't tick its items" | Pack ownership was **derived and never exported**, so no UI could render it — in any of the three tools. |
| "DM console shows class but not subclass abilities" | `subAbilities` appeared **nowhere** in the file; two detail renderers had drifted apart, so fixing the reported one would have left the other blind. |
| "chargen says v0.356, popup says 0.339, DM console says v0.176" | One shape twice: labels painted at parse time from hardcoded fallbacks, before `engine-ready`, never repainted. |
| "cannot see how many DM APs there are" | Both tools *had* the display; two states rendered nothing — and both got worse the moment Amble went to 0 player AP, because then the DM figure is the only number that matters. |
| "can't see the version in the guide" | It existed only as a head comment and a tab title. |

### The blind spot that let the worst one through

The AP drain is the one that matters. **Every gate opened a character exactly once.** `chargen-flows`
loads and asserts; `tool-pricing-ci` loads and asserts; parity folds a fixture and prices it. An
idempotence failure is invisible to all of them. The fix was cheap; the gate — load → regenerate →
reconcile, five times — is the part worth keeping.

### Fixes that contained their own bug

Twice, the first version of a fix reintroduced the thing it was preventing, and **the new gate caught it,
not a human**:

- Heritage-pack ticking without *un*-ticking left the previous species' boxes set, which then entered the
  build as cross-race purchases — the exact overcharge the fix existed to avoid. Caught as `[.., 4, 2]`
  against an expected `[.., 2, 0]`.
- The drawback-text comparison reported **ten** mismatches when three were real (entity encoding), while
  simultaneously missing five cells with appended text (`includes()` instead of whole-value equality).

## Data repair

The Amble characters were repaired in the database on the owner's instruction (all six to 0 player AP),
verified against each character's own pre-change backup: event counts identical, order intact, only the
award amount and its label changed. Moss's oldest backup showed award 0, which is what confirmed the drain
rather than assumed it.

## Two agents, one repo

Another session merged **#428** into `preview` mid-work. Rebased onto it rather than merging, re-ran the
gates, pushed clean. Worth noting for anyone reading the history: two agents were writing to this repo
concurrently on 2026-08-19, which is why the decision records interleave.

## Where honesty cost the least

Three times I reported something wrong and corrected it in the same session: "ten drifting descriptions"
(three), "this is my changes, not the runner" (it was the runner), and re-running a red gate into green
twice before diagnosing it properly (it was a real 10s readiness budget, failing one run in five). The
third is the one I'd flag to my future self — **re-running a red gate is not a diagnosis**, and I wrote
that rule into a commit message earlier the same night before breaking it.

## Shipped

`v0.356` / `BUILD v1.427` on `main` across five promotions. `tool-pricing-ci` **134 → 158**;
`verify-guide` **9 → 10**; `engine-parity` 38 → **40**. Every fix has a check confirmed to fail against
the bug before it was fixed.

**Still not done, across all five promotions:** the pre-release manual QA checklist. It needs a human, a
browser and a signed-in account, and steps 4–6 have never been exercised against the real Supabase project.

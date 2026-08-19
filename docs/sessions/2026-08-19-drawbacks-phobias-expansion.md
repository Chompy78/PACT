# 2026-08-19 — 22 proposed drawbacks, and why the AP number means the opposite of what it looks like

Sibling notes: `2026-08-19-amble-rules-restamp.md` (this same session, earlier — the Amble cost review and
rules re-stamp) and `2026-08-19-live-use-bug-reports.md`/`2026-08-19-closing-the-night.md` (concurrent
sibling sessions, interleaved on `preview` the same night — see "Two agents, one repo" in the former).

## The inversion the whole session turns on

The owner brought a 22-row table of proposed drawbacks, priced 16×1 AP and 6×2 AP. The first pass at
reviewing it was wrong in a specific, instructive way: it read the AP number as a **cost** and concluded
the cheap named phobias would undercut the existing `Haunted / Phobia` (3 AP). The owner corrected it in
one line — *"you don't buy these, they give you extra points"*. Drawbacks are **income**
(`economy().drawbackEarned`), so the number is what the player *gains*, and the existing 69-entry scale
already proves it: the harshest drawbacks carry the biggest numbers (`Hexed Luck` 8, `Leaden Reflexes` 6),
not the smallest. Under the correct reading the original conclusion inverts completely — a named phobia
paying *less* than the generic for *more* pain isn't an undercutter, it's a **dead option** nobody would
ever pick over the generic.

That correction reframed the whole review around one test: **compensation ÷ expected pain**, with two
non-symmetric failure modes — over-payment is real AP farming and the only one that threatens balance;
under-payment just makes a dead option, a content problem rather than an exploit. `Light-Blind` (6,
"disadvantage while in bright light") turned out to be the literal template for most of the proposed
list, and anchored a frequency ladder (near-permanent 6 · scene-level 3–4 · occasional 2 · rare 1) used to
price everything else — including gating `Fear of the Dark` on "no light source within 30 feet" rather
than plain darkness, since plain darkness is near-permanent underground at a third of Light-Blind's pay.

The rest of the pricing pass was iterative, one drawback at a time, with the owner overriding specific
calls: `Claustrophobic`/`Agoraphobic` went through three redrafts (a DC-12-per-doorway save, then a
symmetric one-clause pair per the owner's H1 pick); `Snorer`'s ally-facing Perception clause was proposed
for removal (can't be priced per-character) and then explicitly restored by the owner; `Always Hungry`
went from toothless to a Hit-Dice penalty and back to the owner's originally-proposed Perception clause;
`Mana Leak` needed a caster gate the price alone couldn't express. Four proposals were dropped as
dominated or toothless (`Familiar Face`, `Fear of Water`, `Compulsive Collector`, `Sleepwalker`), plus
`Light Sleeper` — which turned out to already be a 2 AP **boon**, not a gap in the drawback list at all.

Final shape: **21 new drawbacks** (69 → 90), **3 reprices** (`Sluggish` 2→1, `Mana-Sick` 3→2,
`Haunted / Phobia` 3→2 — verified against the database first, since reprices cut income: zero live
characters held any of the three), one new `DATA.drawbackReq` gate mechanism, `DATA.version` v0.357.

## `/code-review max` before opening the PR

Run per this repo's own trigger (touches `js/engine.js`). It found the new gate mechanism **wasn't
actually enforced anywhere a player would hit it** — ten findings in total:

- A placeholder `{name:'(none)'}` discipline — exactly what CharGen creates by default when a Discipline
  card is added and left on its default option — defeated the caster-gate predicate entirely, because it
  counted *any* discipline object rather than matching the existing Arts-Foundation predicate's
  `d.name && d.name!=='(none)'` check.
- Only `Mana Leak` was gated. `Ritual-Blind` and `Wild Surge` carry the *identical* printed requirement
  ("Requires a Spellcasting Foundation to take") and were left completely open — 5 AP of free income
  against the 2 AP the mechanism was built to close.
- CharGen's checkbox-disable guard and its random-builder candidate filter both only knew about
  `drawbackMaxStats`, not the new `drawbackReq` — a Fighter could tick Mana Leak freely in the tool
  players actually build characters in, and the randomizer could burn a drawback slot on a pick its own
  legality check would silently reject.
- A comment claiming the ⛔ warning "blocks the cloud save" was false — the real save gate
  (`_cgOverApBudget()`) only ever checks AP-budget overspend, never reads `.warnings` at all.
- `verify-guide.mjs` silently skipped any drawback with no matching guide row (`if (!m) continue`) while
  its PASS message still reported the full `DATA` count — so a drawback added to the engine and forgotten
  in the guide would report as verified. It also had a cap-in-DATA-implies-cap-in-prose check but no
  reverse check, which is exactly what would have caught the two ungated drawbacks above from the guide
  side too.

Eight of ten were fixed in the same PR. Two were **deliberately deferred**, each to its own board task
with an Effort/Risk tag: the false "blocks the cloud save" comment's *underlying* gap — the Live Sheet's
`takeDrawback()` bypasses `legalCheck()` entirely, so *no* drawback gate is enforced there, not just this
new one, the pre-existing stat caps too — is a cross-tool purchase-flow-control change that deserves its
own risk call rather than being folded into a rules PR; and `guide-price-check.mjs` having zero drawback
coverage is exactly the class of gap that produced the six-day Grit ladder divergence
(`D-GH-2026-08-12-grit-steep-ladder`), named rather than silently left.

## Two real merge conflicts, and one that wasn't

`preview` moved twice while this PR's CI was running for the first time — a docs-only commit and then a
`BUILD` version-sync to v1.432. GitHub reported the PR as unmergeable (`405 … merge conflicts`). Doing the
merge locally instead of trusting that verdict showed it was **not actually a conflict** — `git merge
origin/preview` resolved clean with zero conflict markers, because the version-sync commit's changes and
this branch's changes landed on different lines even in the dense single-line HTML tools. Re-ran the full
gate suite on the merged result before pushing rather than trusting the clean auto-merge alone.

The one genuine surprise along the way: diffing the feature branch against the new `preview` tip showed
~300 lines of this PR's own content "disappearing" — the decision record, the CHANGELOG entry, the guide
rows all showing as pure deletions. That was never real: it was the ordinary shape of diffing an unmerged
branch against a `preview` that simply didn't have those additions yet, not preview overwriting anything.
Worth naming as a trap, because the diff *looks* exactly like data loss until you check which direction
you're diffing.

## CI-only failures, and reproducing before re-running

Three checks failed across the two rounds of CI this branch went through, and none were the same shape
twice:

1. **`pricing`** failed on the first run with a harness-level "Live Sheet never became ready" before a
   single assertion ran — the same script had just passed 162/0 locally against the identical commit.
   Re-run once; passed clean.
2. **`sw-cache`** was cancelled twice in a row with zero log output each time, while running concurrently
   with several other jobs this session had just re-triggered. It passed the moment it ran in isolation
   after everything else on the PR had finished — CI-runner resource contention from the concurrent
   re-runs, not a code problem, and confirmed by testing under a genuinely different condition rather than
   repeating the same retry blindly.
3. **`dm-console-ui`** failed on the *second* merge commit (after resolving the `preview` conflict above)
   with 5 specific assertion failures, all clustered on one feature (invite-staleness warnings). Rather
   than assume and re-run, the exact same test suite was run locally first, against that exact commit —
   all 96 checks passed, including the 5 that failed on CI. That confirmed a CI-environment flake before
   spending the one permitted re-run, which then came back clean.

The generalisable habit across all three: a CI failure with no reproducible local counterpart is grounds
to re-run once; a CI failure that reproduces locally is a real bug and gets fixed, not re-run. Checking
which one you have, by actually reproducing, is the step that's easy to skip under time pressure and
easy to get wrong by skipping.

## Shipped

`v0.357` on `preview` — `DATA.drawbacks` 69 → 90, `tool-pricing-ci` 158 → 162, `verify-guide` 10 → 11,
`engine-parity` 40/0 throughout. Guide updated in both the served copy and the `pact-guide` master, each
on its own existing prose — the master had already diverged from the served copy on cap-enforcement
wording *before* this session touched it (see the deferred task above); new rows were applied without
widening or silently overwriting that divergence.

**Still open:** the three deferred items above, all on `docs/TASK_BOARD_NEXT.md` with Effort/Risk tags and
Done-when criteria.

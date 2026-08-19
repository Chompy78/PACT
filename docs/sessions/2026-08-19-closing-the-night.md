# 2026-08-19 — closing the night: three promotions, one moving target

Continuation of the same night as `2026-08-19-live-use-bug-reports.md`, picked up after that session's
close. Four pieces: logging lessons to the cross-project repo, a regression found while copying the
guide's version block back to its master, a live "take these off the market" request that turned into a
three-tool purchase-path audit, and a CI stretch that tested — and mostly confirmed — the diagnostic
discipline this repo has been building up all night.

## Lessons, cross-checked before writing

`/log-lesson-universal-jc` drafted four candidates from the prior session's own commit history. Reading
`chompy78/ai-lessons-learned`'s `INDEX.md` first caught that one of the four — *"re-running a red gate is
not a diagnosis"* — was already there almost verbatim as `H-2043`. Only the other three were written:
the contract-a-caller-can-violate pattern, idempotence gates catching what single-shot gates can't, and
decode-before-comparing for text diffing. Filing found something else worth a GitHub issue on that repo:
`curate.mjs` reads one lesson per **file**, but nine of the twelve pending `inbox/` files bundle 2–4
candidates each — the next curation run silently collapses ~15 candidates into 9 rows. Filed as issue #14
rather than fixed; not this repo's code to touch.

## The guide's version block had broken its own print rule

Copying `#guideVer` back to the `pact-guide` master (this repo's served copy had carried it alone since
earlier tonight — exactly the divergence a future transfer would silently wipe) surfaced a real bug on
the way out, not in the target. The block's CSS had been added by *replacing the body of* `@media
print{...}` rather than appending before it — so printing the guide stopped hiding the nav sidebar, and
the version block itself was scoped to print, unstyled on screen. Neither half was visible from the
change that caused it. Fixed by restoring the print rule byte-identical to its pre-regression text and
moving `.guide-ver` to screen scope; `verify-guide.mjs` gained an 11th check that was shown red against
the unfixed file before being trusted, per the pattern this repo has been insisting on all night.

## "Take these off the market" — a shallow fix would have reproduced its own gap

Rage, Wild Shape, and Bardic Inspiration die needed to stop being purchasable while real defects in each
got fixed. The precedent — v0.314's `BARRED_FEATURES` array, five other features, CharGen-only — looked
like a one-line extension. **A gap audit before touching it found the precedent was already broken**: the
array reached exactly one of CharGen's three purchase paths (the class picker); its Randomize action and
free-typed search box had never checked it, and Live Sheet's three buy lists had never excluded even the
original five since v0.314 shipped. Extending the array with three more strings would have reproduced the
same silent hole for the new features.

Generalized instead into `DATA.features[lab].bar===true`, read independently by all five now-covered call
sites — a flag on data a call site already holds can't be forgotten the way a second array-to-import can.
Full reasoning in `D-GH-2026-08-19-bar-blocked-features`.

## The CI stretch: three genuinely different failure shapes, diagnosed before acting on any of them

Promoting the fix produced the longest CI chase of the night, and each stage demanded a different check
before the next action:

1. **`lighthouse` failed a performance-score assertion** on `index.html` — a file with **zero diff** from
   the immediately-preceding green commit. Confirmed via `git diff --stat` before re-running; came back
   green, consistent with runner-variance noise rather than a regression in an untouched file.

2. **The PR's head moved out from under it.** A sibling session pushed a purely-additive docs commit to
   `preview` mid-flight. Because PR checks are keyed by **ref, not commit SHA**, every rerun issued
   against the now-stale head was racing the new head's *fresh* CI run for the same concurrency-group
   slot — and losing, which surfaced as jobs cancelling in both directions with no code cause at all. The
   fix was mechanical once diagnosed: stop retrying the stale commit, confirm the new commit's own full
   check state, rerun only what that commit still needed.

3. **Four separate Chromium-install hangs**, one on the prior PR and three in a row on this one's `e2e`
   check — each dying within a second of that job's own timeout wall (605s/600s once, then 906s/906s/907s
   three times running before a fourth attempt finally broke through around 800s). The clustering at the
   wall rather than a spread of durations is what makes this a hang-getting-killed, not a slow-but-real
   install — a genuinely slow install would show variable completion times. Traced against the workflow's
   own run history before the third and fourth retries, to confirm every *other* commit that night passed
   the same check cleanly — ruling out a systemic infra outage before treating it as ordinary bad luck
   worth one more attempt. Recorded with the real numbers on the open CI-cache task rather than left as
   an impression.

**The lesson that generalises, and the one already in the lessons repo that this proves out again:** a
cancelled CI job is not a failed one — reading its actual step timings before retrying blindly caught two
different real causes (a moved branch, an install hang) that a bare "rerun until green" would have masked
as identical flake, and confirmed a third (the lighthouse score) as genuine noise rather than a defect.
`H-2043`'s rule — verify locally before the first retry, escalate to real diagnosis once the pattern
repeats — held up across three qualitatively different CI failure shapes in one session, not just the one
it was written from.

## Three promotions, same night

`v1.429` (guide fix), `v1.430` (bar-blocked-features fix + the Chromium-cache task), `v1.432` (the
strengthened CI-stall evidence) — all merged as regular merge commits, all confirmed live via a direct
`curl` against the deployed `js/engine.js`, not assumed from the merge alone. `v1.431` belongs to a
sibling session's PR on `feat/drawbacks-phobias-expansion`, not this one.

One self-caught mistake along the way: a follow-up docs commit was built on a **stale local `preview`**
(fetched but never pulled after the sibling session's push), so the push was correctly rejected as
non-fast-forward rather than silently overwriting anything. Rebased onto the real head, verified no
conflict markers and that both commits' content survived, then pushed clean.

# 2026-08-05 — the species-pack bug turned out to be a pricing-basis bug

Started as `/pick-code-task` on `fix/species-pack-not-charged`. Ended having reversed the recorded
decision behind it, found three more live defects, and built two dev tools. Worth recording because the
diagnosis moved three times and each move was caused by something specific.

## How the diagnosis moved

**v1 — "packs aren't charged".** The plan proposed a canonical fold ordering plus pack events. Sent for
cold review; **five reviewers across four vendor families independently refuted the central mechanism.**
Hoisting identity in the fold cannot inject an event that isn't in the prefix, so the plan converged on
the cheap alternative it claimed to improve on. That was a real error, not a wording problem.

**v2 — "`priceOf()` quotes a whole-build delta".** Better, and it survived a second round (four
reviewers). But the round attacked the mechanism: the item/context split isn't a clean taxonomy, since
Level Up, ability raises and class unlock are *simultaneously* a thing bought and a context change.

**v3 — the owner's reframe, which was better than mine.** I had the pricing mode following the *tool*
(CharGen = draft, Live Sheet = ledger). The owner moved it onto the *character*, via the creation lock —
which closes the hole where reopening a played character in CharGen would launder it.

The sentence that settled it, from the round-2 Copilot/Opus reviewer:

> Legitimate dependence = today's context applied to **this** purchase.
> Contamination = today's context applied to **past** purchases.

## What was actually wrong

`priceOf()` priced every purchase as `compute(after) − compute(before)`. Correct for an ordinary
purchase; wrong when the purchase also changes pricing context, because `compute()` then re-prices what
the player already owns and the diff sweeps that in — and it gets frozen into the log. Three escapes
already existed by hand (`abil`, `mbound`, `dbound`) with a comment naming "the refund bug". Nobody had
generalised them.

Measured, in the real page: Level Up 1→2 with a Vigor/Grit stack charged **14 AP for a 2 AP hit die**.
Unlocking Wizard while owning four Wizard features quoted **−6** — it *paid* the player to unlock a class.

## Things that were assumed and turned out false

- **"Epic boons are a fourth instance."** I asserted this in a plan; two reviewers built findings on it.
  False — `MUT.boon` never sets `epicBoonAbil`, so the candidate build carries no stat bump. Right answer
  by accident.
- **"The log is append-only."** Written into a plan's *verified* section. `replacePatchSlot` filters and
  appends, and `PACT-CharGen-Webtool.html:1901` says so in a comment.
- **"CharGen's LOG starts empty."** It does at parse time, but a boot ends with a 9-event log built by
  `replaceWholeLogFromBuild()`, which bypasses the mutation API — so the creation lock wasn't armed at
  boot and a character saved in that window could never lock. Only found by driving a real browser.
- **My own test reported a false positive** — matching `document.body.innerHTML` for a notice string also
  matches the inline `<script>` source containing it.

## Method notes worth reusing

- **Cold review earned its keep twice.** Both rounds killed a plan that looked finished. Cross-family
  agreement mattered: the one reviewer arguing the opposite case on scope was outvoted 3-1 across vendors.
- **The browser found what Node could not.** Two of the four false assumptions above were only visible by
  loading the actual page. `playwright` can't be installed here (no npm), but Chromium plus the DevTools
  protocol needs nothing — that became `testing/scripts/tool-pricing-ci.mjs`.
- **Query the page, don't screenshot it.** `getComputedStyle` returning `rgb(178,106,0)` is cheaper and
  stricter than looking at a picture, and it's assertable in a gate.
- **A gate that can't fail is decoration.** The new gate was verified by reintroducing the bug and
  checking it went red with exactly the original numbers.

## Outstanding

- `fix/species-pack-not-charged` — the original report, now last of four.
- `fix/ledger-reconciliation-pass` — D6: grandfather now, one correction pass after all four land.
- Campaign-vs-player threshold precedence (D-GH-2026-08-05-pricing-model, open question).
- Three incidental defects found while auditing: `buyManeuver()` skips the affordability gate; epic boons
  are hard-blocked on first purchase in the Live Sheet; `epicBoonAbil` is dropped on a CharGen round-trip.

## Part 4 — what the last branch actually turned out to be

`fix/species-pack-not-charged` closed on the same day, and the shape it took was not the one its own
task entry described. Three things are worth keeping.

**The reported bug was no longer reproducible; the mechanism was.** Driving CharGen in a real browser at
`preview` HEAD, the reported flow — set species, buy pack traits — reconciled perfectly. What still drifted
was the flow nobody had written down: buy four Halfling traits, then *change species*. The traits become
cross-race purchases while the ledger keeps charging own-species prices (13 against a `compute()` of 24),
and changing back quotes the identity patch at **−4**. Same mechanism as Anders' −5, reached a different
way. Had I stopped at "cannot reproduce" the branch would have closed as a no-op.

**Two independent defects wearing one symptom.** Re-pricing the draft ledger fixes the *sum* and leaves the
negative identity line; making `replacePatchSlot` replace in place instead of filter-and-appending fixes the
*line* and leaves the sum. Only reintroducing each half separately showed they were separable — the gate
now asserts both, and each half was verified to fail it alone (reproducing −11 and −4 exactly).

**The fuzzer earned its keep three times over.** Four `repriceDraft` invariants added to `log-fuzz.mjs`
(non-mutating, idempotent, build-preserving, draft-reconciling) failed on the first run and found things
no fixture would have:
- **Non-idempotence.** Re-pricing and the automatic lock are mutually recursive — a new cost moves spend,
  spend moves the lock, the lock decides what may be re-priced. A single pass moved the numbers again on
  a second run: a ledger drifting with no edit behind it. Now runs to a fixed point.
- **Drawbacks are income, not spend.** Re-pricing them changed `b.budget` and therefore `compute()` output.
  Caught by the build-preserving invariant, which existed only because I wrote it as an afterthought.
- **Duplicate purchases.** `_replay` collapses proficiency lists once, at the very end, so mid-walk a
  duplicate inflates `compute()` while the final build has it gone — charging real AP for nothing. Both
  tools guard against emitting duplicates, so no fixture would have covered it.

Two of my own scoping errors also showed up as fuzz failures and were mine, not the code's: `names` events
carry paid-spell-swap AP, and `economy()` reports drawbacks under `earned` rather than `spent`. Worth
noting because both looked like product bugs for a few minutes.

**And one thing deliberately left undone.** Checking whether the Live Sheet had the same hole turned up a
different question instead: a pre-lock Live Sheet character that levels up ends at a ledger of 44 against a
`compute()` of 83, and *neither* D1 nor D2 is being violated — they simply conflict for that case. Filed as
`fix/livesheet-draft-reconcile` with the measured table, because it needs a rules answer rather than code.
The first version of that probe reported `spent=0` throughout, which would have been a spectacular false
finding: the Live Sheet's bridged `economy()` takes an **index**, not an array. Third time this session that
the honest move was to distrust my own first measurement.

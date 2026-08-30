# 2026-08-27 — Hit-Dice gating for class abilities

Kept because three things in this session are only legible as a narrative: an assumption the project had
been carrying for weeks turned out to be false, a design decision was reversed by measurement, and the
change's own cold review found a regression the change had introduced.

## What was actually wrong

The premise arrived as "a major change" — give every class ability an HD requirement alongside its tier.
It wasn't a change at all. The Players Guide already states it ("You can never buy an ability before you
own the Hit Dice… it requires") with Extra Attack at 5 HD as its worked example, `DATA.tierHD` already
held the mapping, and the Live Sheet already enforced it. `js/engine.js` — the single source of truth —
did not. A 1 HD Fighter could buy Extra Attack *and* Extra Attack (3rd) and `compute()` said only
"OVER BUDGET".

So the root cause was never a missing check. It was that the rule had three implementations (engine: none;
Live Sheet: five inline copies that had already drifted over the `lvl` floor; CharGen: none) and the
authoritative one was the one with no opinion. That reframing is what turned the fix from "add a check"
into "export one `requiredHD()` and delete the copies".

## Two things measurement overturned

**The stepped-tier clause.** The plan gated stepped (`rep`) features on an escalating tier, and all four
cold reviewers pushed back on its consequence (17 HD to finish a ladder). The first response was to argue
they had misread the data — only one feature in the dataset is `rep`. A fresh no-context agent judged that
refutation as attacking the messenger, and it was right: the consequence is real, it just comes from
individually authored tiers rather than from the clause. Measuring the clause showed it changed **nothing**
(byte-identical fixture impact), its stated rationale was false for the only entry it touched, its Guide
quote came from the Proficiency Bonus section, and the Guide lists that entry as having "no level gate".
The clause was cut.

**"Pre-launch".** The plan inherited it from D-GH37, and every reviewer flagged it as the highest-blast-
radius assumption. Checked against live Supabase rather than inherited: 25 characters, 8 owners, 4
campaigns, one updated the day before. The first blast-radius query then produced a *second* wrong answer —
it read HD from `cat:'hd'` events, but CharGen writes HD as a replace-in-place `patch` slot, so all 25
characters came back as 1 HD and five looked broken. The owner spotted it ("moss appears to have 3HD
already?"). Re-derived correctly: **one** affected character, unbound, one Hit Die short. That near-miss is
what produced the `HD event vocabulary` task — the log is not a true history for that field.

## The review found a regression the change introduced

`/code-review ultra` caught that ownership was being resolved ~180 lines *below* the ability-score fold, so
a blocked Primal Champion still granted +4 STR/+4 CON for 0 AP. "Blocked" had come to mean *costs nothing*
when it needed to mean *grants nothing*. It also found the frozen-ledger hole: a purchase frozen at 0 while
blocked became free once HD rose, because the Live Sheet priced a level-up as the ladder alone.

Worth recording that the first attempt at that second fix — removing the `hd` context escape so it used
the whole-build delta — was **wrong and the existing tests caught it**. The escape is load-bearing for an
unstamped Vigor/Grit stack, which is precisely what CharGen produces. The right fix charges the ladder plus
the drop in `compute()`'s own "Blocked purchases" line.

## The owner reversed the architecture, not just a value

Round 3 extended the hard block to Arts, Techniques, and Epic Boons — same shape as the class-ability gate,
same "grants nothing" fix applied pre-emptively this time (the epic-boon +2 fold was checked and moved
above the blocking resolution before shipping, not found by a reviewer after the fact).

Then the premise itself changed. The original plan (options A3/B3, chosen at the very start of this
session) had tier *drive* the HD gate, with a per-item `hd`/`lvl` field only ever raising that floor.
Round 4 is the owner looking at the results and ruling it backwards: *"I think the a&t and epic boons
should be properly HD locked like class abilities are. The Tiers are really just for costings."* That
single sentence inverted `requiredHD()` — an item's own level, when stated, now overrides tier in **both**
directions, not just upward. It also exposed a live discrepancy the old design was masking: the Guide
already said epic boons unlock at "the level-19 threshold" while the data still gated them at 17 (tier's
floor) — the tier-driven design had no way to express that a boon's real level sits *above* its tier band
without a special case. Only 40 abilities had a real level on file at that point, so round 4 authored just
those and explicitly deferred the other ~550 rather than invent numbers for them.

## The owner did the research the project didn't have

Round 5 closed that deferral, but not by guessing. The owner supplied a real 2024 PHB text extraction
(`docs/phb-rules-final.jsonl`) and, when an automated regex match against it only resolved 351 of 468
entries cleanly, did the remaining page-by-page adjudication **personally** and handed back a 605-row CSV
with a confidence tag on every value (577 High, 27 Medium) — including catching that four PACT features
were each bundling two separately-leveled 2024 abilities under one name and price, with the reasoning for
each split written out by hand. That CSV, not this session's judgment, is what authored the last 280 `lvl`
overrides. The lesson isn't about the data; it's about sequencing — round 4 correctly stopped at "no
source exists" instead of inventing 550 numbers, which is what left the door open for the owner to supply
the real source instead of this session working around its absence.

## A process rule got broken and caught by a suspicious diff, not by a review

Partway through round 5, the task-board edit (graduating a task, filing two new ones) got bundled into the
same commit as the `js/engine-data.js` data mutation, directly on the PR branch — violating this project's
own single-writer rule for `docs/TASK_BOARD_NEXT.md` (every prior round in this session had put board edits
through their own commit on `preview`, merged back). The catch was a `git diff --stat` that read "1 file
changed, 1 insertion, 1 deletion" right after a mutation that should have touched hundreds of `lvl` fields —
almost misread as "nothing happened" before recognizing it as a diff-stat artifact of the data file being
one giant minified JSON line, not evidence the mutation failed. Fixed by `reset --soft`, re-splitting the
two changes into their proper commits, and re-merging — full recovery, no data lost, but it cost a full
extra round-trip that a moment's checklist-check before committing would have avoided.

## Round 6: the fix for round 3 had two hand-duplicated mirrors of its own

A third `/code-review ultra` on the finished PR found that round 3's arts/boons blocking — correct inside
`compute()` — had left two tool-layer consumers stale: Live Sheet's level-up pricer still only stripped
blocked *features* before diffing (never arts/boons, so a level-up that legalized a blocked Art quoted 10
AP for something that really cost 15), and DM Console's roster only marked blocked *features* with "⛔",
never arts or boons. Both bugs have the same shape: the engine's blocking rule was extended once, correctly,
at its one canonical site, but two other files had each independently hand-written an earlier, narrower
version of "check whether this is blocked" before the extension existed — and extending the canonical
version doesn't retroactively extend code that copied its old shape by hand. Worth naming as its own
pattern: **when a shared rule grows a new case, grep for every place that rule's *shape* was duplicated
before assuming the extension is complete.**

The DM Console fix also had a near-miss caught before shipping rather than after: `s.boons` looked like a
pure display array, but `dmEditBody()`'s "remove a boon" dropdown uses it as an exact-match value source —
decorating it with "⛔ blocked" would have silently broken Remove for every blocked boon. Checked what else
reads a value before changing its shape, not just what renders it.

## Rules of thumb this session earned

- **A hard block must mean "grants nothing", not "costs nothing".** Any future effect reading `b.features`
  must consult `_blockedFeat`; that is why ownership resolution now sits at the top of `compute()`.
- **Verify a live-data claim twice when the first answer is convenient.** The "5 characters break" result
  was wrong in the direction that would have caused needless work, and only a human spot-check caught it.
- **When four reviewers agree on a consequence and you think they misread the mechanism, they may still be
  right about the consequence.** Separate the two before replying.
- **When a shared rule is extended, grep for every hand-written mirror of its old shape before calling the
  extension done.** Round 6's two bugs were both a canonical fix that didn't propagate to a duplicate.
- **A suspicious no-op diff after a real mutation is a prompt to verify with a targeted check, not a
  conclusion that nothing happened.** The round-5 task-board mix-up was caught this way, not assumed away.
- **Before decorating a value for display, check whether the same value is consumed elsewhere as an
  exact-match key.** `s.boons` doubling as a dropdown's `value=` source is the concrete case; the general
  check is cheap and the failure mode (a silently broken control) is not.

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

## Rules of thumb this session earned

- **A hard block must mean "grants nothing", not "costs nothing".** Any future effect reading `b.features`
  must consult `_blockedFeat`; that is why ownership resolution now sits at the top of `compute()`.
- **Verify a live-data claim twice when the first answer is convenient.** The "5 characters break" result
  was wrong in the direction that would have caused needless work, and only a human spot-check caught it.
- **When four reviewers agree on a consequence and you think they misread the mechanism, they may still be
  right about the consequence.** Separate the two before replying.

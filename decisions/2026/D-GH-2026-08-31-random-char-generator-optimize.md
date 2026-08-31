# D-GH-2026-08-31-random-char-generator-optimize — the random generator gets a theme, and a gate that can fail

**Status:** Implemented · branch `claude/random-char-generator-optimize-uoqvmo` · supersedes the
`feat/randomize-tuning` task entry, now graduated off `docs/TASK_BOARD_NEXT.md`.

## Context

The owner's complaint was "it's not great — maybe it needs a theme". The board entry for
`feat/randomize-tuning` had deliberately unset acceptance criteria and an explicit instruction not to
implement against invented ones, so step one was to measure what was actually wrong rather than guess.

A harness driving the generator's search loop against the real `js/engine.js` (50–60 rolls per budget)
found three defects, all reproducible:

| Player AP | ≈ level | HD (avg / max) | boons | arts | skills | overlap between two rolls |
|---|---|---|---|---|---|---|
| 79 | 1 | 3.5 / 6 | 3.4 | 2.0 | 0.9/19 | 0.04 |
| 300 | 10 | 5.6 / 9 | 7.2 | 8.2 | 4.8/19 | 0.11 |
| 600 | 20+ | 5.0 / **9** | 15.2 | 15.6 | 8.9/19 | 0.23 |

1. **Hit Dice capped at 9 at every budget.** `Math.min(20, Math.max(b.hd, 1+rnd(Math.min(9, …))))`
   clamped the random *draw*, not the ceiling, so no budget could roll past HD 9. Because HD gates
   tradition rank, racial-trait tiers and most boons, the surplus had nowhere to go but breadth — 15
   boons and 15 arts on a level-5 body.
2. **Thematic incoherence, worsening with budget.** At 600 AP, 100% of rolls owned light armour +
   shield + simple weapons and ~96% owned heavy armour + all martial weapons, Wizards included. Armour
   and weapons were bought because they were cheap and raised no warning, never because they fit.
3. **Skills starved then flooded.** 0.9 of 19 at level 1 (the eager boon/art/racial block ran before the
   main loop and ate the budget), 8.9 of 19 at 600 AP. No target shape either way.

Two things measured *fine* and were deliberately left alone: legality (the `tryAct` warning gate held on
every roll) and speed (34 ms and ~650 `compute()` calls at the worst budget).

## Options

- **A1 — tune the flat pool.** Fix the clamp, add class guards, cap boons/arts by HD. Cheap, but leaves
  the generator conceptually a shopping list that happens to contain fewer absurdities.
- **A2 — a theme layer over the existing spender.** *(chosen)*
- **A3 — concept-first rewrite with hard budget buckets.** Better spend control by construction, but a
  full rewrite of a function with a decade of accumulated bug-fix comments, each of which would need
  re-verifying. Would have needed a cold plan review first.

## Decision

**A2**, plus the level fix (B1) and a roll panel replacing `confirm()` (C1).

Eight themes, each declaring: favoured abilities, weights over the `cat` values `DATA.boons`/`DATA.arts`
**already carry** (Combat, Defence, Skill & Utility, Social, Magic, Wild & Story, Fighting Style,
Origin, Utility, Epic), a spend shape across four buckets (stats / powers / skills / kit), an
armour/weapon *ceiling*, and shortlists for skills, tools, drawbacks, name style and demeanour.

The spender picks a **bucket** first — weighted by how far that bucket is from its target share — then an
action within it. That is the structural change: what a character ends up owning is now a property of
the theme rather than an accident of how many entries of each kind happened to be in one flat array.

`THEME_SLIP = 0.18` of picks ignore the theme entirely.

## Why

- **The `cat` fields already existed.** The whole thematic axis was sitting unused in `DATA`; no new
  rules authoring was needed, which is most of why A2 cost so much less than A3.
- **The legality machinery was not the problem.** `tryAct()` is untouched in substance — it still gates
  every purchase on budget and no-new-hard-warning. Only *which* purchase gets offered changed. That
  kept the blast radius inside one function's action selection.
- **A rigid theme would only rotate the failure.** Obeying a theme 100% of the time makes every
  "Frontline Bruiser" the same character — the same sameness the change exists to remove, on a different
  axis. Hence the slip, and hence a diversity assertion in the gate rather than a purity one.
- **Level should follow the budget, because in PACT the budget *is* the level.** `DATA.levelAP` maps one
  to the other and the tool already had `apLevel()` for its own budget label. Hit Dice are cheap (4% of
  a level-3 budget, 24% at level 20), so buying the level the budget names leaves the great majority of
  the AP for everything else.

## What the fix exposed

Four further defects, none of which any gate would have caught:

- **Tradition Rank could reach 10.** `DATA.hdGate`/`DATA.rankCum` are 9 long and the UI's Rank control is
  `numOpts(0,9,0)`. Setting `select.value=10` matches no option, so the select goes blank and reads back
  as **Rank 0** through `_domReadBuild()` — stranding every spell slot the roll just bought behind a gate
  now claiming Rank 0. Latent before this change only because HD was clamped to 9, which kept Rank at 1.
- **Spell slots were picked at a random level.** `compute()` requires slots to be non-increasing by
  level; a random level proposes an illegal buy almost every time once Rank climbs, so level-20 casters
  finished with 0–4 slots. Now only pyramid-legal levels are offered, which builds it bottom-up.
- **`DATA.castAbility` is not an "is this a caster" test.** It carries an entry for every class
  (`Fighter:'INT'`, `Barbarian:'STR'`), naming the stat a class *would* cast with. Used as a caster
  test it primed a Fighter's INT to 16–20 while leaving STR at 10.
- **A drawback's refund was never spendable.** The ceiling is captured before any drawback is bought, but
  a drawback *raises* `compute().spendable` — so the character took the hindrance and never got the AP.
  Pre-existing; fixed here because drawbacks are now deliberately thematic and should buy the concept
  something.

## Verification

`testing/scripts/random-quality-ci.mjs` — new, dependency-free CDP (no Playwright, so it runs in a CLI
session), driving the **real tool** rather than a Node re-implementation of its search loop, because a
second copy of that logic is precisely the drift `AGENTS.md` warns about. It asserts statistical
invariants over many real rolls, not one golden output: legality, level tracking, armour/weapon ceilings,
that a theme's favoured categories lead its picks, that two rolls of one theme still differ, that themes
resemble themselves more than each other, that every string a theme names resolves against `DATA`, that
casters finish with usable slots and an uninverted pyramid, and that a Fighter on a caster theme still
primes a Fighter stat. **69 passed / 0 failed.**

> **The board's own risk rating for this task was wrong, and worth recording as a pattern.** It rated
> damage likelihood "low (`random-manual-e2e.mjs` already gates it in a real browser)". That file's
> header states the opposite in its first paragraph: it *deliberately never calls* `randomizeBuild()`,
> because its job is to drive the UI as a human would. `tool-pricing-ci.mjs` calls `randomizeRoll()`
> exactly once, only to assert appearance survives the LOG resync. So nothing gated the generator's
> output at all, and a confident citation of a gate that did not exist is what let the HD-9 cap sit
> there. This is the `AGENTS.md` "verify before writing an absence claim" rule in its inverse form — a
> *presence* claim about test coverage needs checking just as hard.

Also green: `engine-parity-ci` **73/0**, `esc-gap-verify` **9/0**, `log-fuzz` clean (500 iterations).

`tool-pricing-ci` reaches **182/0** but flakes: across five runs on this branch it passed three and
twice died on `CharGen never became ready for the version check` — a 30-second `document.readyState`
poll on roughly the tenth tab that gate opens, which that script's own header already documents as a
contention failure it has hit before. Measured against the unmodified file rather than assumed: the
**baseline failed 3 of 3** runs on the same machine, so the flake is pre-existing and if anything less
frequent here. Not this change's, and not papered over — it stays worth fixing, most likely by having
that gate reuse one tab per tool instead of opening a fresh one per section.

`verify-guide.mjs` fails one check (feature prices) **identically on the unmodified baseline** —
pre-existing guide/engine drift, untouched by this change. The two Playwright gates
(`chargen-flows-e2e`, `random-manual-e2e`) cannot run in a CLI session; their assertions about the 🎲
button's row placement were verified directly in a browser instead and still hold.

No rules changed, so **no `DATA.version` bump and no Players Guide edit** — the generator only consumes
`compute()`, it defines nothing.

# 2026-08-31 — optimising the random character generator

**Branch:** `claude/random-char-generator-optimize-uoqvmo` · **Decision:**
`D-GH-2026-08-31-random-char-generator-optimize` · **Graduated:** `feat/randomize-tuning` off
`docs/TASK_BOARD_NEXT.md`.

## How the session ran

The owner opened with "let's optimise the random character generator, it's not great — maybe it needs a
theme for the random char or something. make a list of options", then approved **A2 (theme layer) + B1
(level from budget) + C1 (roll panel)** and left it to run unattended overnight, with two standing
answers: push the branch but **do not open a PR**, and bind themes *strongly but not absolutely*.

## What measuring first bought

The board entry for this task had deliberately unset acceptance criteria and said in bold not to
implement against invented ones. That was the right call and it paid off — the options list was written
from a harness, not from impressions, and two of the things that *looked* like obvious problems turned
out to be fine:

- **Speed was fine.** 34 ms and ~650 `compute()` calls at the worst budget. Had that been assumed to be
  the problem, the session would have optimised a non-issue and left the real one in place.
- **Legality was solid.** `tryAct`'s warning gate held on every roll, which is why the change could leave
  it alone entirely and confine itself to *which* purchase gets offered.

Conversely, the measured HD-9 cap was invisible to reading the code casually — `Math.min(20, Math.max(…,
1+rnd(Math.min(9, …))))` looks like it has a 20 in it.

## The bug that only appeared because another bug was fixed

Lifting the HD clamp let the tradition Rank ladder run to 10. `DATA.hdGate` and `DATA.rankCum` are nine
entries long and the UI's Rank control is `numOpts(0,9,0)`, so `select.value=10` matched no option, the
select went blank, and `_domReadBuild()` read it back as **Rank 0** — leaving a character holding spell
slots gated behind a Rank it no longer had. It surfaced as eight `no hard warnings` failures in the new
gate and took a monkey-patch of `applyBuild` to pin down: rank went **in as 10 and came out as 0**.

Worth remembering as a shape: a value that is merely *unreachable* rather than *rejected* is safe only
for as long as the thing making it unreachable stays put.

## Review findings that the tests had already passed

`/code-review high` was run on the finished, green diff and found six real defects — all six survived
verification against the code. That is the useful data point: **69 passing assertions did not catch any
of them**, because they were all in territory the assertions did not look at (a caster theme forced onto
a non-caster class, a persisted panel choice outliving its budget, slot levels chosen against a rule the
gate never checked). Each was fixed *and* given an assertion, so the gate grew from 65 to 69 checks and
now fails on all six.

The most instructive was `DATA.castAbility` being used as an "is this a caster" test. It has an entry for
every class — `Fighter:'INT'`, `Barbarian:'STR'` — because it names the stat a class *would* cast with.
Using the engine's own map instead of a local literal was the right instinct (it fixed a real drift risk
in the original code) but the map does not mean what the name suggests.

## A false coverage claim, recorded

The board rated this task's damage likelihood "low (`random-manual-e2e.mjs` already gates it in a real
browser)". That file's header says the opposite in its opening paragraph — it never calls
`randomizeBuild()` by design. Nothing gated the generator's output. `AGENTS.md` already requires
verifying an *absence* claim before writing it down as fact; this is the same rule needing to apply to a
*presence* claim about test coverage, which is easier to assert casually and just as load-bearing.

## Left alone deliberately

- **No `DATA.version` bump, no Players Guide edit** — the generator consumes `compute()` and defines no
  rules. The board entry said the same.
- **`verify-guide.mjs`'s one failing check** (feature prices) reproduces identically on the unmodified
  baseline. Pre-existing guide/engine drift, out of scope, not touched.
- **`tool-pricing-ci`'s readiness flake.** It failed twice in five runs here. Rather than assert
  "pre-existing" from the script's own header comment, the unmodified file was stashed and run three
  times: it failed **3 of 3**. So the flake is real, pre-existing, and slightly *less* frequent with this
  change than without. Worth fixing separately — that gate opens a fresh tab per section and the ~tenth
  one times out — but fixing it inside this branch would have widened the diff for an unrelated reason.
- **C2 (per-section re-rolls)** was scoped out when the options were agreed and stays unbuilt. The panel
  remembers the last theme and level, so re-rolling is two clicks.

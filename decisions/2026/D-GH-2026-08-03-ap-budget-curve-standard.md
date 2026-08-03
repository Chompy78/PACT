# D-GH-2026-08-03-ap-budget-curve-standard — the fixed AP ladder is the Standard BUDGET curve (there is no "pace curve")

Status: Active

Supersedes the terminology — not the mechanism — of the 2026-08-03 addendum to
`D-GH-2026-08-02-creation-lock-switch.md` and of `D-GH-2026-07-14-advancement-tracks.md`.

## Context

`js/ap-by-level.js` held a hand-typed ladder — `{1:50, 2:92, 3:134, 4:155 … 20:491}`, i.e. 50, then
+42, +42, then a flat +21 per level — surfaced on the engine as `DATA.apByLevel` / `DATA.levelAP`,
`DATA.defaultAp` (a fresh CharGen build's starting budget) and `DATA.level1AP` (the creation lock's
fallback threshold).

Two records and one engine comment described those numbers as PACT's **pace curve**, "AP a character
has EARNED by level N", and treated it as a genuine second rules curve sitting alongside the
per-campaign **budget** curve (Standard L1 = 79 / +24, Generous L1 = 83 / +28).

The owner challenged that framing. Checked against `docs/PACT-Players-Guide.html` by targeted grep
(the file is ~1.4 MB and AGENTS.md forbids reading it wholesale), three quotes settle it:

- *"Starting AP budget / track chosen (Level 1 = 79 standard or 83 generous; optional Level 0
  prelude = 55)."*
- *"PACT's default is to award AP by the session, not by the level … around 7 AP per session."*
- *"Twenty pregenerated heroes of one frontier company, the Emberwatch … They run from a 1st-level
  recruit (50 AP) to a 20th-level archmage (491 AP)."*

So the rules contain a **budget** curve (AP a complete level-N build has spent) and an **award pace**
(AP per session, ~7). There is **no AP-earned-per-level schedule at all**. 50 → 491 was the appendix
cast list for the twenty sample Emberwatch characters — a roster, transcribed into a table and then
promoted to a rules curve by later work that reasoned from the table rather than the Guide. That is
why `DATA.level1AP` read 50 when a complete level-1 build costs 79, and why CharGen offered every new
solo character a 50 AP budget.

## Options

- **A1 — docs only.** Correct the "pace curve" label everywhere, leave the ladder at 50 → 491.
  Cheapest, no `DATA.version` bump. Rejected: it leaves the actual numbers wrong. The label was
  never the bug; the table was.
- **A2 — hand-type the Standard budget curve into `ap-by-level.js`.** Correct numbers, minimal
  structural change. Rejected: it creates a second copy of `LEVEL_BUDGET_CURVES.standard`'s two
  numbers. This repo has been bitten by exactly that shape of duplication more than once (D-GH36's
  `MUT` drift, D-GH26's tool-local folds).
- **A3 — derive the ladder from `LEVEL_BUDGET_CURVES.standard`.** Chosen.

## Decision

`js/ap-by-level.js` no longer holds data. It exports `budgetLadder({l1, inc})`, which expands a curve
into a level → cumulative-AP table for levels **0..20**, and applies it:

- `AP_BY_LEVEL = budgetLadder(LEVEL_BUDGET_CURVES.standard)` → `0:55, 1:79, 2:103 … 20:535`
- `AP_BY_LEVEL_GENEROUS = budgetLadder(LEVEL_BUDGET_CURVES.generous)` → `0:55, 1:83 … 20:615`

Consequences on the DATA bridge: `DATA.level1AP` and `DATA.defaultAp` go **50 → 79**. `DATA.version`
**v0.337 → v0.338**.

Level 0 needs no special case — `l1 + inc × (N−1)` at N=0 gives 55 on **both** presets, matching the
Guide's prelude tier exactly. It is additive: `levelForThreshold()` (js/ui-helpers.js) deliberately
scans L=1..20 and never reads key 0, so no level label anywhere changes.

The dependency now runs `advancement.js → ap-by-level.js → engine.js`, one way. That makes
`LEVEL_BUDGET_CURVES.standard` a **mechanics** value — the one exception in a file whose header
previously declared the whole thing display-only. Both file headers now say so, and say which
entries remain display-only (`generous`, `AWARD_PACES`, `STARTING_TIER_RATIOS`).

`creationLockThreshold(campaignRules)` (shipped the day before) is unchanged and still earns its
keep — it honours a campaign that *tuned* its curve. What changed is its fallback: `DATA.level1AP` is
now the Standard budget L1, so the default is correct rather than merely tolerable.

## Why

The lock asks "has this character finished being built?" — a question about **spend** — so every
number feeding it has to come from the budget curve. Deriving rather than copying means the engine's
fixed default and the DM-facing "Standard" preset are the same two numbers by construction; they
cannot drift, and there is no second place to remember to edit.

## Verification

- Parity **24/0**, with `testing/expected/` **untouched** — that is the load-bearing evidence. Four
  fixtures failed first (EV-003, EV-007, EV-009, EV-013 — exactly the four predicted), all with the
  same shape: `total` dropped by 3 or 2 because a racial trait that used to price locked now priced
  at the creation rate, their filler spend of 55–60 no longer clearing 79.
- Those fixtures test the *mechanism* at whatever the default threshold is, so the filler was raised
  above the new default (55 → 85; EV-007's genuine post-import spend 60 → 90) and each fixture's
  matching award raised by the identical delta (60 → 90; EV-007's noLock burst 150 → 180). Holding
  `remaining` constant is deliberate: it means **not one expected value moved**, which distinguishes
  "the threshold moved" from "something got repriced". EV-008 and EV-014 kept passing throughout but
  were raised too — their point is spend *exceeding* the anchor while staying unlocked for other
  reasons, and at 55 vs 79 they would have quietly decayed into duplicates of EV-002.
- Fixture descriptions updated to the real numbers, including EV-012's "replaces the DATA.level1AP
  default (50)".
- Static audit **27/0**; log fuzz **500/500 clean**; browser e2e **3/3**, whose trace shows
  `{"budget":79 …}` — the new default reaching the real CharGen UI, not just the module.
- Tool-side literals chased down: CharGen's budget picker default and its hint string (which still
  advertised "L1 50 · L5 176 … L20 491 (+21/level after L3)"), and two `DATA.level1AP||45` /
  `||50` paranoia fallbacks. DM Console already defaulted to 79/24 and needed no change.

## Caveats and follow-ups

- **The Guide is stamped v0.332; `DATA.version` is now v0.338.** Every number above is sourced from
  that v0.332 text. If the Guide is itself behind the owner's current rules thinking, 79/83/55 are as
  suspect as 50 was — this decision inherits the Guide's currency and nothing more.
- The "pace curve" label still appears in `DECISIONS.md:448`, `D-GH49.md`,
  `D-GH-2026-07-14-advancement-tracks.md`, the 2026-08-03 addendum to
  `D-GH-2026-08-02-creation-lock-switch.md`, and a July session note. Those are historical records;
  correcting them is its own task (on the task board), not a silent rewrite here. Live code was
  fixed in this change: the engine comment above `creationLockThreshold()` and the header of
  `testing/scripts/creation-lock-backfill-dryrun.mjs`.
- Anders Tealeaf's production backfill is still outstanding and still reserved for a human. Its
  arithmetic changes with this: at 17 AP logged spend he remains far below any threshold either way.

# D-GH-2026-10-29-roll-lock-then-spend-steps — turn a rolled remainder into in-play purchases, without a dialog (PR 1 of 2)

**Context.** `feat/roll-lock-then-spend` (owner decision B, 2026-10-04; plan `docs/plans/2026-10-27-roll-lock-then-spend.md`, cold-reviewed by two
outside models). A rolled character on a campaign with a creation limit stops at the limit; pressing Accept locks it and spends the rest as in-play
purchases. The plan split the work in two: this change is the pure, UI-free half, so it can be proved before any button exists.

**What was built** (all in `tools/PACT-CharGen-Webtool.html`; no engine change, no rules-version bump, no SQL):

- `_cgBuildToSteps(cur, target)` — the purchases that turn one folded build into another, or a refusal. Slot work reuses `_cgPostLockSteps` and
  `_cgTraditionSteps`; flat categories (skills, tools, expertise, features, boons ...) are bought one value at a time in prerequisite order. It
  never returns a partial list: it folds its own steps onto a copy of `cur` with the engine's `MUT` and compares the result with `target` over every
  field a roll can touch (`_cgRollDiff`). Any difference, and anything no purchase can express (species, origin class, lineage, drawbacks, innate
  spells, custom proficiencies, bindings, starting gold, Warlock pact slots, a lowering), is a refusal.
- `_cgPlanRemainder(cur, candidates)` — a roll can lower a stat, take a drawback or buy pact slots AFTER the cut, none of which can happen in play,
  so the planner returns the LATEST later build that purchases can reach.
- `_cgPostLockAppend(steps, {unattended:true})` and `_cgSpendSteps(steps)` — the interactive function's own checks with no dialog. Each place that
  would have asked the player now skips that one step and records why: a soft rules warning, a wallet shortfall or trade offer, a boon or drawback
  that needs a description, house rules not loaded, a step that does not fit the AP left. A blocked names gate appends nothing. The survivors land
  as one undo frame and one repaint. `_cgSpendSteps` repeats up to four passes because a step skipped for a missing prerequisite can fit after an
  earlier one lands.
- `window._cgRollTrace` — one inert line in the roller's `tryAct`; when a caller sets it to an array, each accepted step pushes the build after it.

**Decisions.**

- **Unattended is stricter than interactive, on purpose.** The interactive path lets the player click through a soft warning or accept a trade; an
  unattended run cannot accept either for them, so it skips. This is the plan's risk (1): it must be impossible for it to buy something the dialog
  path would have refused, and it may refuse more.
- **Wallet:** the plan's Q4 said a short wallet proceeds only if the player confirms ONE up-front trade offer. That confirmation belongs to the Accept
  button (PR 2); the unattended function itself never trades.
- **Undo (flag for PR 2).** The owner decided 2026-10-04 (3) that undo after Accept steps back one purchase at a time ("maybe — confirm when
  building"). `commitHistory` latches once per handler turn, so a synchronous unattended spend is ONE undo frame. PR 2 should confirm one-frame undo
  with the owner or split the batch across turns.
- **Found, not fixed (existing):** the roller prices `weaponProf.martial === true`, but the form it applies the build through keeps a number (0), so a
  rolled character never gets the martial proficiency the budget counted. The planner treats `true` as 1.

**Pinned by** `testing/scripts/chargen-roll-steps-e2e.mjs`, wired into `chargen-flows.yml`: seeded rolls with the trace on, a random cut, apply and lock
it (names gate off), plan to a later build, spend unattended. Checks: no dialog opens; applied + skipped partition the step list; the LOG grows by
exactly the applied count, all plain `buy` events; with nothing skipped the folded build equals the target on every roll field; a refuse-everything
bug fails (most trials must produce a plan). 60 trials (seed 11): 54 planned, 6 refused, 811 of 812 steps applied (the one skip was a boon that needs
a description).

**Independent review (a fresh agent, before merge).** Two real findings, both fixed and pinned: (1) `_cgSpendSteps` matched pending steps by `cat|label`,
but labels repeat across disciplines ("L1 slot (2)"), so a step that had already landed could be re-applied on the retry pass and, because slot/rank/hit-die
steps are absolute, LOWER something and refund AP. Skipped steps now carry their position, and the unattended path never appends a purchase with a negative
cost (nothing bought can be un-bought). (2) `_cgRollNorm` dropped zeros and sorted numeric lists, so `[2,0,0,...]` equalled `[0,...,2]` and the self-check
could not see a step built for the wrong spell level; numeric lists now compare by position, and an absent `shieldWorn` means "in hand" so an explicit
set-down is a real difference. `extraClasses` joined the compared fields. Cases T1-T3 in the e2e pin all three; the interactive path was checked line by line
and is unchanged when `opts.unattended` is falsy.

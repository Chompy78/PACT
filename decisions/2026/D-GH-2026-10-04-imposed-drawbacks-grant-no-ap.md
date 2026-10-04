# D-GH-2026-10-04-imposed-drawbacks-grant-no-ap — a DM-imposed drawback grants no AP in `compute()`

**Status:** DONE · `DATA.version` **v0.365 → v0.366** (one bump)

## Context

A DM can impose a drawback on a campaign character (`D-GH-2026-08-10-dm-edit-events`). It is recorded at `cost: 0`, so the
player is paid nothing and `economy().drawbackEarned` says 0. But `compute()` derives the drawback grant from the drawback
**names** in `b.drawbacks`, which cannot tell imposed from chosen, so it credited the table value anyway. Found 2026-10-04
while building the DM unlock (`D-GH-2026-10-04-dm-unlock-drawback`); measured on the engine as it then stood:

| Build (79 AP earned, 0 paid) | `compute().remaining` | Frozen ledger | Warnings |
|---|---|---|---|
| one imposed Peg Leg (table 4) | 83 | 79 | none |
| four imposed (4+3+3+4 = 14) | 93 | 79 | "Drawbacks grant 14 AP — the guide caps them at 12", "4 drawbacks chosen" |

Three things read that wrong number: the DM Console's "Granted by drawbacks" row (it reads `compute().drawbackAp`); the
**warnings a player sees**, about drawbacks they never chose and were never paid for; and the **creation ceiling** — the Live
Sheet feeds `creationCeiling` from `compute().drawbackAp`, so a still-building character's ceiling was raised by AP they never
received (confirmed: bonus 14 for four imposed, 0 after the fix). The Live Sheet's "AP left" was right because it reads the
frozen ledger, which is why this stayed invisible.

It matters now because the wounds feature (`feat/permanent-wounds`) is built on DMs imposing several of these.

## Options

- **A. Exempt imposed slots inside `compute()`**, using the marker `_replay()` already stamps (`b._imposedDrawbackIdx`, the
  same `dmEdit` AND `cost >= 0` rule the stat-cap exemption uses). Chosen.
- **B. Have `compute()` read the grant from `economy()`.** Rejected: `compute()` only ever sees the folded build, not the
  log, and the project's rule is that `compute()` derives the grant itself so callers never supply it.
- **C. Subtract the imposed amount in each tool.** Rejected: three places each re-implementing a rules decision, which the
  architecture forbids — and the creation ceiling would still be wrong in the engine.

## Decision

In `compute()`'s drawback loop an imposed slot contributes **0** to `drawGain`. It is still **listed** — at 0 and labelled
`<name> (DM imposed)` — so a DM can see which penalties they have imposed. It no longer counts toward either warning:
"Drawbacks grant N AP" (it granted nothing) or "N drawbacks chosen" (it was not the player's pick; that guideline exists to
stop a build becoming an AP farm, and an imposed drawback pays 0). The penalty itself is untouched — HP, speed, saves and
the rest still apply, and the imposed drawback is still a normal member of `b.drawbacks`.

## Why

- **One definition of "imposed", used for both exemptions.** The stat-cap exemption and this one read the same marker, so
  they can never disagree about whether a drawback was imposed.
- **`compute()` and the ledger now agree** for an imposed drawback recorded at cost 0 — which is every one the DM Console
  emits (asserted: `remaining` equals `economy().available`, 79 for four imposed, 86 for a two-and-two mix), the property the
  frozen-ledger design is meant to guarantee. **Honest limit:** `dm_edit_character_log` does not validate a drawback's cost, so
  a hand-crafted `dmEdit` drawback at a POSITIVE cost is still "imposed" to `compute()` (grant 0) while `economy()` books
  `drawbackEarned -= cost`; the two would differ by that amount. That is a DM-trusted path (a DM can already award or remove AP
  directly), no tool emits it, and it is not covered. Tightening the RPC to refuse a non-zero drawback cost would close it;
  that is a new migration on a trust boundary and was not done here.
- **The creation-ceiling and DM Console fixes are free.** Both consume `compute().drawbackAp`; correcting the source corrects
  them, with no change in either tool. The Live Sheet's own gain figure sums the itemised rows, which are 0 for imposed ones.
- **`DATA.version` bumped once** because `compute()`'s output changes for any build holding an imposed drawback
  (`remaining`, `drawbackAp`, the warning list, the itemised rows). No existing parity fixture recorded those for an imposed
  build, so no existing expected value moved; the two new fixtures pin the warning lists.
- **Blast radius (live Supabase, 2026-10-04 — a dated snapshot, re-measure rather than quote):** 49 characters, 16 holding
  any drawback (39 purchases), **0 DM-imposed**, 0 unlock events. Nothing in production changes until a DM imposes one.

## Verification

- **Differential, against the pre-fix engine:** the new gate fails 17 of its 28 assertions on `origin/preview`'s `engine.js` (the
  11 that pass are the player-taken controls, the unrelated rule, and two cases the old engine happens to get right) and
  passes 28/28 on the fixed one. EV-025 (four imposed)
  and EV-026 (the same four player-taken) were indistinguishable on the old engine — both read 93 with both warnings.
- `imposed-drawback-grants-ci.mjs` 28/28: imposed `remaining` = ledger = 79 and `drawbackAp` 0; no cap or "chosen" warning;
  rows listed at 0; control player-taken = 93, `drawbackAp` 14, both warnings; **mixed** 2 chosen + 2 imposed → grant 7,
  remaining 86; a fifth, imposed drawback does not push "4 chosen" to 5; a 12-AP campaign cap is neither tripped nor consumed
  by imposed drawbacks and still clips the player-taken control to 12; creation-ceiling bonus 0 vs 14.
- `engine-parity-ci.mjs` 79/0 (new EV-025/EV-026), `dm-unlock-drawback-ci.mjs` 30/0, `undo-barrier-ci.mjs` 44/0,
  `version-label-ci.mjs` 10/0 (the three rules-version literals were bumped by hand per `docs/VERSION-SYNC.md`),
  `dm-console-ui-e2e` 109/109, log fuzzer 500/500, `audit.py` 0 failed. `tool-pricing-ci.mjs` passed 189/189 on two of three
  runs; the third stopped at 69/1 — consistent with the already-filed tab-readiness flake (`fix/tool-pricing-tab-flake`),
  which aborts the run partway, but I did not capture that run's message, so it is *consistent with*, not proven to be, that.

## Code review (`/code-review high`)

Seven findings, each checked against the code before acting. **Fixed:**
- The `compute()` API header described an imposed drawback only as exempt from the stat cap; it now states the zero grant,
  the `(DM imposed)` row, the two warning exclusions, and what a hand-built build without the marker gets.
- A code comment quoted 95 / "16 AP" (copied from the old task entry's wound values) while the fixtures say 93 / 14.
- **Test gap:** the marker is positional, and nothing covered the list shifting underneath it. Added: an earlier
  player-taken drawback bought off, the imposed one bought off, both orders, and a legacy `patch` replacing the whole list.
  Shown non-vacuous — with the `patch` reset removed from a scratch copy of the engine, exactly that assertion fails.
- The overstated "always agree" wording above (and the same words in the gate's header).

**Rejected, with evidence:**
- *"CharGen builds from the form, so it never has the marker."* It does not: `readBuild()` is `foldBuild(LOG)`, and every
  `compute()` call in CharGen (the budget pill, `_cgCeilOpts`) takes its build from `readBuild()`. `_domReadBuild()` is a
  separate reader used only when CharGen re-synthesises a log, never for display. A character opened in any tool carries the
  marker.
- *"The `(DM imposed)` suffix puts display text in a data row."* Checked every consumer of the `Drawbacks (refund)` rows
  before changing it: the Live Sheet sums the row VALUES, the tests assert the shape, and nothing matches a row to a purchase
  by name. A third element would force every renderer to change; the suffix needs none. Revisit if a consumer ever needs to
  link a row back to its purchase.

**Accepted, tracked:** the Players Guide is untouched — it has no text on DM-imposed drawbacks, so nothing in it contradicts
the engine, and the wording (no AP, not counted toward the 2–3 guideline or a campaign cap, listed at 0) lands with
`feat/permanent-wounds`, which documents imposed drawbacks for the first time. This is the same deferral already made for
the stat-cap exemption and the unlock.

## Deliberately not changed

- **"Frail and Glass Frame can't be taken together"** still fires for an imposed pair. It is about HP penalties not stacking,
  not about AP, and a DM stacking both should be told. Asserted.
- **The Players Guide.** It has no text on DM-imposed drawbacks at all, so nothing in it contradicts the engine; the wording
  lands with `feat/permanent-wounds`, which documents imposed drawbacks for the first time (the rule that engine and guide
  both land is honoured there, as it was for the stat-cap exemption).
- **A campaign's own drawback cap.** Imposed drawbacks neither trip nor consume it; the cap applies only to what players take.

# 2026-10-13 — DM AP discounts, from a wizard question to a live feature

The owner asked how a wizard who learns a spell in the story (no AP spent) gets it: does the DM just award bonus AP, or
can a DM add a spell or skill without the player paying? The answer at the time was "award AP; nothing else exists". The
session turned that into three board tasks and built the base one, `feat/dm-ap-discount` (PR #649, merged to `preview`).

## What was decided (owner letters, in order)

- **A2 + A3, plus a new ask** — a DM grant for spells/skills, the guide's wizard "scribe a found spell" rule, and a DM
  discount on ANY purchase with the total recorded. Filed as `feat/dm-ap-discount` (built today), `feat/dm-grant-purchase`
  and `feat/wizard-scribe` (both still on `docs/TASK_BOARD_NEXT.md`, both build on today's work).
- **B1** — a discounted purchase still counts its full price toward equivalent level and the creation lock. Two named
  totals: **AP value** (full price) and **AP paid**.
- **C** — the scribe reduction is the DM's call, not a fixed rate.
- **E1** — plan and cold-review first. **F1** — a discount raises the creation ceiling, like a drawback grant.
- **G2** — automatic API review. **I1** — the server's sum does not check that a discounted purchase is still owned (accepted gap).
- **L1, N1** — both database migrations applied today (below). **M2 → overridden** — the owner first asked for a
  `/code-review ultra` before merging, then chose to merge without it. **P1** — a discount changes AP only; gold and
  downtime stay at the full-price rate. **Q1** — rebase before review.

## The design idea that made B1 cheap

The discount is AP the character **earned**, tied to one purchase. `spent` stays at full price (AP value), so the creation
threshold and "≈ Track-Level" were already right. Equivalent level reads *earned*, so it rises as B1 asks. "AP left" is
unchanged in formula and comes out as what was paid. Almost none of the ~65 call sites reading these totals needed to
change. Full record: `decisions/2026/D-GH-2026-10-13-dm-ap-discount.md`.

## The cold review, and what it caught about my own plan

Gemini (`gemini-3.8-flash`) and OpenRouter Nemotron (`nemotron-3-ultra`) both reviewed the plan. Both self-identified
wrongly again ("gemini-2.5-pro", "gpt-4o"). DeepSeek had no stored key and no free OpenRouter model. Both flagged that a
player could forge a discount, and that was true: the database lets an owner write any event into their own log. It became
a required server trigger. Gemini's "a gift could lock creation early" was wrong, because the automatic threshold lock was
retired (R3). But it exposed that my plan's "Verified" section still described the retired lock. Reviews are archived in
`docs/plans/cold-reviews/2026-10-13-*-dm-ap-discount.md`.

## Three things the build changed from the plan

- `refVal` ("the target's name") became `targetCat`. Real purchase events have no common name field.
- A DM-removed boon keeps its discount. Removal refunds nothing, so dropping the discount would charge the player again.
- The anti-forgery check is its own trigger. **The 2026-10-12 award hardening had never been applied**: the live
  `pact_enforce_player_ap_ceiling` was still the 2026-09-03 version. The owner then had it applied too (N1), after its two
  pre-checks passed.

## Database — both migrations applied to production today

`dm_ap_discount` and `server_player_award_after_lock`. Each was applied only after re-reading the live functions it
replaces. Afterwards: new functions not callable by `authenticated`/`anon`, triggers present, existing guards intact,
advisor nothing new, no database errors. Blast radius: 37 characters (10 campaign-bound), 0 existing discount events.

## Collision: four PRs landed on `preview` mid-review

#650–#653 merged while #649 waited. #650 had rewritten the Live Sheet AP line as an explicit sum ("AP left = player + DM +
drawbacks − spent"), which conflicted with my edit to the same line. Resolved by keeping #650's sum and adding a
"+ N DM discount" term, because otherwise the parts no longer add up. A browser test now checks the arithmetic.

## Mistakes of mine, for the record

- `git commit -a` swept the owner's uncommitted `.claude/settings.json` (an `execute_sql` auto-allow) into a pushed
  commit. The auto-mode classifier refused to let me revert that file; the owner reverted it (`0525482`). I now stage by
  name only.

## Still open

- `feat/dm-grant-purchase`, `feat/wizard-scribe` (NEXT board).
- Promotion `preview` → `main`, so DMs actually get the control (an owner release decision; it also carries #650–#653).
- The code went to `preview` without the `/code-review ultra` the owner first asked for.

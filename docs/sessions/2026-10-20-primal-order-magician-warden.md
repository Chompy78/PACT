# 2026-10-20 — Primal Order / Divine Order split, free feat proficiency, and a wide ability audit

Merged to `preview`: #687 (rules v0.380) and #688 (rules v0.381). Decisions: `D-GH-2026-10-20-primal-order-magician-warden`, `D-GH-2026-10-20-feat-free-proficiency`.
Plan: `docs/plans/2026-10-20-primal-order-magician-warden.md` (two cold-review rounds, archived in `docs/plans/cold-reviews/`).

## How it started

The owner asked what the Players Guide says about Druid "Primal Order (Warden)". Almost nothing: one table row, "Buy (skill grant → ladder)", no price. The engine priced it as a plain 5 AP feature that
granted nothing. The 2024 Warden option gives martial weapons and Medium armour, which PACT sells for 15 AP (Simple 1 + all martial 8 + Light 2 + Medium 4), so a player expecting the 2024
text would think it was a 10 AP bargain; the engine gave them nothing at all. The owner's worry: players finding cheap loopholes. What we found: no exploit (the engine granted nothing), but a
**guide that sold the proficiency a second way**, which is its own kind of bug.

## Owner decisions (in the order made)

| | Decision |
|---|---|
| H1 | Warden / Protector have no price of their own; they switch on the proficiency flags and the existing ladders charge once (15 / 21 AP) |
| I2, V1a | Magician and Thaumaturge: 6 AP each (one cantrip + a Wisdom bonus to Arcana/Nature or Arcana/Religion) |
| U1 | The same split for the Cleric's Divine Order |
| Q3, Y1, Z1 | The old Primal Order is retired (`bar:true`, not aliased). The one live owner keeps their 5 AP and martial weapons + Medium armour, **without** Simple or Light, never priced |
| W3, X1 | Feats that hand out a tool or instrument now do, free, and they count toward the number owned **first** (the opposite of the Guide's old "counted last") |
| AD | Musician's three instruments need a picker (built) |
| AC | The `pact-guide` master was edited through the connector |
| AB1 | No new "loophole" rule in the Guide; the DM's existing authority (section on the DM's final say) is relied on |

## What the live data showed (2026-10-20)

- Primal Order: one owner (four rows: main, old copy, DM copy, test copy). No Simple weapons, no armour, Hit Die 3, roughly 80 AP unspent.
- Divine Order, Chef, Musician: no live owners. 40 characters in total.
- The shipped `dmDiscount` event (DM-only, any priced purchase) exists in production and is the supported way to zero the old Primal Order purchase if a DM ever moves that player to Warden;
  nothing in the engine can remove a purchased feature (`dmRemoveBoon` is boons only).

## Things that went wrong, and what caught them

- The first round-2 cold review read the plan **during a `git rebase`** and both reviewers saw the round-1 draft. The two reviews were discarded and re-run once the file was stable. Rule: never start a
  review that reads the repo while a rebase or checkout is in progress.
- A test used the wrong field name for Martially Bound (`mbound` instead of `martiallyBound`) and passed vacuously. A mutation check (remove the `free` guard) exposed it: without the guard a Martially
  Bound Druid pays 16 for Warden, not 15. Both are now pinned.
- A sweep agent reported Cleric Divine Order as absent from the data because the real key is `Cleric: Divine Order (Protector/Thaumaturge)`. Matched by substring it exists with the same shape as Primal Order.
- After the rebase onto a newer `preview`, `gen-drawback-prices-sql.mjs --check` failed: a generated comment line in the still-unapplied house-rules migration stamps the rules version. Regenerated
  (one comment line, prices unchanged).
- The guide master and the served copy differ in unrelated places (Druid "Circle bonus spells" 5–11 vs 5–12; the War Priest archetype 204 vs 205). Left alone; on the board.

## Local sweep recipe

`grep -h "run: node testing/scripts/" .github/workflows/*.yml | sed 's/.*node //' | sort -u` lists the 61 scripts CI runs. In sequence they take about 25 minutes; `chargen-flows-e2e.mjs` alone is
7 minutes (give it a 700 s timeout). `cloud-e2e.mjs` needs a local Supabase stack and cannot run here; `cost-customization-ci.mjs` flaked once under load and passed on rerun.

## Follow-ups (on the board, `docs/TASK_BOARD_NEXT.md`)

`fix/audit-saves-and-skills`, `fix/audit-free-spell-picks`, `fix/audit-text-only-grants`, `chore/decide-spell-invocation-pricing`, `docs/reconcile-pact-guide-primal-order`, `ui/show-granted-proficiencies`.

## How to assess

Open the Live Sheet or CharGen with a Druid: buy Primal Order (Warden) and watch the Weapon and Armour proficiency lines go to 9 and 6 AP; buy Magician and open ✎ Name for the cantrip row; a Bard
with Musician gets three instrument rows. The retired Primal Order no longer appears in any purchase list.

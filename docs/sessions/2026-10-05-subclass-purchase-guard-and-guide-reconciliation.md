# 2026-10-05 → 2026-10-08 — One subclass ability, one purchase; Circle Forms; Martially Bound; four stale guide rows

The story of one long session, written down because the useful part is where the first assumption was wrong. The decisions
have their own records; this is the order things happened in and what each pivot taught.

## The thread, in one paragraph
A question about Wild Shape's cost turned into comparing the level-3 Druid circle abilities. That showed Circle Forms (Circle of the Moon)
could be bought without Wild Shape, and checking whether anyone had done so led to a much more important find: every subclass ability is
sold through two doors (the subclass picker and a mirrored class-feature entry) and one live character had bought the same ability
through both — 8 AP, then 7 AP + 100 gp + 21 days, no warning. That history was repaired (a deletion from a sealed log, rehearsed first),
the cause was fixed in the engine and the Live Sheet, Circle Forms was given its prerequisite, the owner decided Martially Bound should
discount subclass abilities, and the guide was brought into line.

## What shipped
| PR / commit | What | Record |
|---|---|---|
| (live database) | Anders Pipeleaf: duplicate purchase removed from his sealed history, lock re-placed, spend 111 → 104 AP | `D-GH-2026-10-05-anders-double-purchase-repair` |
| #587 | One subclass ability held through both doors is one purchase (the copy bought first counts); v0.369 | `D-GH-2026-10-05-subclass-double-purchase-guard` |
| #588 | Circle Forms requires base Wild Shape, through both doors; v0.370 | `D-GH-2026-10-05-subability-prereq` |
| #589 | The repair write-up | (above) |
| #590 | Guide: Circle Forms row says "Buy (needs Wild Shape)" (master + served copy) | (#588's record) |
| #591 | Martially Bound discounts subclass abilities of the bound class (owner decision 2026-10-07); v0.371 | `D-GH-2026-10-07-martially-bound-subclass-discount` |
| #592 | Guide: four combined rows split into one row per ability; `verify-guide.mjs` red → 11 of 11 | CHANGELOG 2026-10-08 |

## Where the first assumption was wrong (the part worth keeping)
1. **"No one owns Circle Forms."** My first live count was 0. The owner said "Moss owns it". The query had searched for the feature label
   (`Druid: Circle Forms`) but subclass abilities are stored under the subclass key (`Druid|Circle of the Moon|Circle Forms`). A zero needed a
   positive control. It also meant the plan I had just proposed (a prerequisite on the feature copy) would have guarded nothing real characters use:
   the engine's prerequisite gate only ran for `b.features`, and the subclass loop had none.
2. **"Rehearse on the DM copy row."** The two "(DM copy)" rows were not faithful clones (different structure) and one had been edited that day.
   The repo's own Docker harness, loaded with the real row and the live trigger definitions, was the right rehearsal: with the history lock
   on the edit is refused ("protected event 20 changed"); with `trg_pact_locked_history` and the budget trigger disabled for one transaction it is
   accepted and the read-back is identical.
3. **The privileged write was refused.** The auto-mode classifier blocked it as audit tampering. The owner added an ask rule and approved the
   second attempt. Everything about that write was guarded by `id`, `updated_at`, a content fingerprint, the event count and `SEQ`.
4. **"Charge the copy bought first" needs an order `compute()` does not have.** The two arrays lose cross-collection order, so `MUT` stamps the
   first door on `b._abilDoor`. A `/code-review` found the real defects in that: CharGen's live state has no order but its save emits every
   `feature` event before any `subabil` event, so Save + Load silently swapped which copy counted (the unstamped fallback was reversed to match);
   a copy that arrived through a base snapshot was never stamped; a stamp could go stale if its copy was removed in place.
5. **A fuzz hang that was not mine.** After adding fixtures the seeded post-lock parity fuzz hung on a scenario the old fixture set never
   reached, because the fuzz draws its characters from the fixture folder. The clean test was upstream's own harness plus only my new
   fixtures (passes); the branch simply lacked #586. Rebasing removed it.
6. **"One real guide mismatch" was wrong — it was four.** `verify-guide.mjs` listed 21 findings, one a price mismatch. A manual comparison
   showed four rows stale since the 2026-08-27 feature split: the checker matches only the first name of a combined row ("Roving / Tireless"),
   and treats a price range as unparsed. After the fix the verifier is 11 of 11 — its price check fails only on a mismatch, so my claim that
   it "would stay red" was wrong too.
7. **Martially Bound was short of the guide, not the other way round.** §14 already said "every non-spell purchase that class trains you in".
   Found on the way and not changed there: the engine (and CharGen's hint) discounted Fighting Styles although the guide says they are priced flat. Resolved 2026-10-08 in #594: the engine now prices them flat (`noMB` flag, v0.372), the guide was already right.

## Reviews
Three free-tier API reviewers (Gemini, Groq, Nemotron) and `/code-review high`. The repo-access review found every real defect; the API reviewers
mostly agreed, produced one refuted "HIGH" claim (settled by a permanent fixture, EV-032) and one false alarm, and two of three misidentified
themselves. Raw files and triage tables are in `docs/plans/cold-reviews/` (dated 2026-10-05 and 2026-10-07).

## Flakes seen (neither caused by these changes)
- `random-quality-ci`: "a Fighter on a caster theme still primes a Fighter stat" failed once on #591 (unseeded; already a board task, second occurrence).
- `guide-theme` on #592: the `Install Chromium` step timed out on GitHub's package mirrors; the test never ran; a re-run passed.

## Left open (all on the board or with the owner)
- Fighting Style: resolved — the owner chose the engine fix; merged as #594 (v0.372), record `D-GH-2026-10-08-martially-bound-fighting-styles-flat`.
- Promote `preview` → `main`: owner's release call; re-measure live Circle Forms owners first (needs the database).
- The verifier's blind spots, and the Ranger table row that exists only in the served copy.
- Anders's two review copies still carry the duplicate.
- Same-door repeat in `b.subAbilities`; pre-grey prerequisite-blocked tiles; picker price labels ignore Martially Bound.
- Three older cold-review files in `z-cold/processed/` are not archived anywhere in the repo.

Environment gotchas from this session are in the assistant's memory notes (`gh pr edit` workaround, the Supabase ask rule, free-tier API limits,
worktree sandbox rules, the fuzz's fixture coupling).

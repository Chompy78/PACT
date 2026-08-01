# 2026-08-01 — DM Console tile restructure, two CharGen fixes, and the cloud roster gaining full cards + remove + DM notes (PR #281)

## What happened

Started as a scoped DM Console UI request (alphabetize banned lists; restructure the Campaign panel
into tiles), pivoted mid-turn when the user reported a live "serious bug" in a different tool (CharGen),
fixed that plus a related engine-level gap it surfaced, then returned to DM Console where a follow-up
request ("I can't see the cloud characters... no way to remove them... want to add fields") grew into a
three-part feature needing a live database migration. All four pieces landed on one branch
(`claude/dm-console-ui-improvements-gcfwnt`) because the hosting harness's own instructions designated
that single branch for the whole session — not a deviation from `AGENTS.md`'s one-task-per-branch rule
by choice, just the environment's constraint; noted here so a future agent doesn't wonder why one PR
bundles four otherwise-independent changes.

## DM Console panel restructure (first ask)

Alphabetized all seven banned-item grids (species/origin species/origin classes/masteries/boons/
drawbacks/arts — previously in `DATA`'s declaration order) and split the Campaign (cloud) panel into
distinct nested tiles in the order requested: Owner settings → Invite new player → Campaign Rules →
Level budget curve/award pace/starting tier → a new DM Notes tile (cloud-persisted in
`campaigns.rules.dmNotes`, same JSONB column the existing rules already live in — no schema change) →
New campaign/Archived campaigns, with Archive campaign moved to the bottom of that last tile. Verified
with a headless Playwright screenshot of the real page.

## Mid-session pivot: CharGen's half-caster cantrip picker (live bug report)

The user reported, mid-turn: "the add discipline cantrip under the chargen sheet doesn't work — it
doesn't add a line to the ledger or deduct AP's." Reproducing this needed a headless Playwright drive of
the real CharGen UI, which needed the Supabase CDN import (`https://esm.sh/@supabase/supabase-js@...`,
the one external network dependency gating `engine-ready`) stubbed via `page.route()` — the repo's own
`testing/scripts/random-manual-e2e.mjs` already has exactly this stub, reused verbatim rather than
re-derived. Root cause: `js/engine.js`'s LOG replay correctly zeroes `cantrips` for any
`DATA.noCantrip` discipline (Paladin/Ranger — half-casters can't take cantrips) on every fold, and Live
Sheet already hides its Cantrip buy button for these disciplines — but CharGen's `.disc-cant` `<select>`
had no equivalent guard, so it stayed fully clickable and priced with zero feedback when a selection was
silently discarded. Fixed in `tools/PACT-CharGen-Webtool.html`'s render function only (disable + relabel
+ tooltip); no engine change. Logged as `decisions/2026/D-GH-2026-08-01-dm-console-ui-improvements.md`.

## Follow-up: no-Discipline state was also silently swallowed

While in that area, the user asked for a related gap: a Tradition left with every discipline slot at
`(none)` was skipped entirely by `compute()` — no Foundation cost, no warning, nothing. Unlike the
cantrip case, this needed an **engine-level** fix (not CharGen-only) since the state is reachable from
any tool reading stale/imported data, and every tool's Issues tray already reads `compute()`'s
`warnings` live. Added the warning in `js/engine.js`, bumped `DATA.version` v0.336 → v0.337 per
`AGENTS.md`'s "compute() output changed" rule (confirmed none of the 20 parity fixtures exercise the
state, so `testing/expected/` needed no diff), and added a CharGen-only inline marker for the one tool
where the state is actually reachable through normal editing. Logged as
`decisions/2026/D-GH-2026-08-01-dm-console-ui-improvements-2.md`.

## Back to DM Console: cloud roster cards, remove, DM-private notes

The user's next message: "there is a problem that i can't see the cloud characters in the grid or card.
I also have no way to remove them. I also want to be able to add some fields to each such as the
player's name. or per character notes." Investigation found the cloud (campaign) roster rendered through
a completely separate, much thinner path than local `.json` imports — a bare table, because
`js/dm.js`'s `getRoster()` never selected `stats` at all — and that `characters.campaign_id` had a
setter (`join_campaign()`/`bind_character_to_campaign()`) but genuinely no unsetter anywhere in the
schema.

Two real product decisions here, both put to the user directly via `AskUserQuestion` (both calls needed
one retry — the tool reported "did not answer" on the first attempt for reasons that weren't a genuine
decline; per `AGENTS.md`'s own guidance, retried once rather than assuming a default, and got real
answers both times):
- **Remove semantics**: unbind from the campaign (character/data survive) vs. permanently delete. Chose
  unbind — the phrase "remove them" didn't call for destroying another user's data.
- **New fields' visibility**: DM-only/private vs. player-visible. Chose DM-only, mirroring the DM Notes
  tile added earlier this same session at the campaign level.

Shipped: `#campRoster` now renders through the same `cardHTML()`/`buildSections()`/`analyzeAug()`
pipeline local imports use (full stats, skills, spellcasting — not just Player/Character/AP); a new
`dm_unbind_character()` RPC (`SECURITY DEFINER`, mirrors `award_ap()`'s shape — a DM removing a
*player's* row can't go through a plain grant since `characters_update`'s policy is owner-only); and a
new `character_dm_notes` table (not new `characters` columns — that table's blanket `select` grant means
any new column would be visible to the character's own owner the instant their row passes RLS,
regardless of the DM-only decision above) with access via a live join to the character's *current*
`campaign_id`, not a cached one, so notes automatically stop being visible to a DM once a character is
unbound or moves to a different campaign. Caught and fixed a latent bug on the way:
`roster.map(cardHTML)` would have silently fed each local card's array index into `cardHTML`'s new
second parameter (`Array#map` passes `(item, index, array)`) — truthy for every card past index 0.

The migration needed the user's explicit go-ahead (asked directly, again one retry needed) before being
applied to the **live** Supabase project via `mcp__Supabase__apply_migration`, then verified with
`get_advisors` (security + performance) — no new issues beyond the app's existing, already-accepted
`SECURITY DEFINER`-callable-by-`authenticated` pattern shared by every other RPC in this file. Logged as
`decisions/2026/D-GH-2026-08-01-dm-console-cloud-roster.md`.

Note for future reference: `tools/DM-Console.html`'s footer still literally reads "read-only roster
viewer" — already loosely inaccurate before this session (Award AP already wrote to the DB), and more so
now (unbind + DM notes also write). The actual design invariant this label is protecting — DM Console
never edits a character's own build/`stats` data — still holds; none of this session's writes touch
`stats`. The label itself is just stale copy, not a design violation. Filed as a follow-up TODO rather
than fixed here (out of scope, `docs/TASK_BOARD_NEXT.md` design questions around a *different*,
unrelated "DM Console gains a non-read-only capability" feature already exist and shouldn't be conflated
with this).

## Verification

Every change was verified against the **real production code**, not reimplemented test logic:
`testing/scripts/engine-parity-ci.mjs` (20/0, run repeatedly through the session) and
`testing/scripts/random-manual-e2e.mjs` (multiple seeds, green) for the engine changes; headless
Playwright drives of the actual CharGen and DM Console code for the UI/interaction changes — including,
for the cloud roster, stubbing `window._campBridge`'s network methods at the exact interface `js/dm.js`
exports and exercising the real click-delegation code for award/history/notes-save/unbind end to end.

## PR / merge

PR #281 (`claude/dm-console-ui-improvements-gcfwnt` → `preview`) opened once the user said "merge all"
(no PR had existed until then). Waited for all 5 CI checks (log-fuzz, parity, audit, lighthouse, e2e —
tracked via a `Monitor` poll rather than manual re-checking) to go green, then merged (regular merge,
not squash, matching this repo's existing merge-commit convention for feature branches).
`preview` is now 4 commits ahead of `main` (the merge commit + the 3 feature commits) — not promoted in
this session; see this close-out's Part 2 report for the promote-or-hold decision.

## Why this note exists

Three of the five trigger criteria: the plan changed/grew mid-session (a UI-tiles request → a live bug
report pivot → a bigger cloud-roster feature, each unplanned at the start); real decisions a future
agent could reasonably second-guess (unbind-vs-delete, a separate DM-notes table vs. new columns,
engine-level vs. UI-only fix for the two CharGen issues); and effectively more than one independent
piece of work landed together in one sitting (four separable changes, one branch, one PR) — for a
harness-imposed reason worth recording so it doesn't read as a process lapse later.

## Follow-ups

- `preview` → `main` promotion: queued, not done this session (4 commits ahead).
- `tools/DM-Console.html`'s footer text ("read-only roster viewer") is stale copy, not a design
  violation — worth a small follow-up docs/copy task, output in this close-out's report rather than
  filed directly (single-writer rule on the task board).
- Cross-project lesson candidate (drafted, not filed): sandboxed/offline test environments need the same
  CDN-import stub (`page.route()` on the exact external URL) this repo's own `random-manual-e2e.mjs`
  already uses, or any app whose boot is gated behind an external ESM import will never finish loading
  under test — worth generalizing beyond this repo.

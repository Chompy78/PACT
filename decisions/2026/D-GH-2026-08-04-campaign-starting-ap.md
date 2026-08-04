# D-GH-2026-08-04-campaign-starting-ap — both ways into a campaign start a character the same way

Status: Active

## Context

There were two routes into a campaign and they behaved differently:

| route | what it did |
|---|---|
| invite link | `redeem_player_invite` created the character **with** its AP grant, recorded in `ap_awards` |
| shared campaign code | `bind_character_to_campaign` ran `update characters set campaign_id = …` and nothing else |

So a player joining with the code landed on **0 AP**, silently. No error, nothing on screen explaining it,
and the DM saw a roster entry with no budget and no recorded reason. That is exactly what happened to
Cedric Brightblade — mistaken for lost AP when it had never been granted.

## Options

- **F1** — an editable AP field on each roster card. Rejected by the owner: awarding AP from a roster card
  is already possible, so this adds a control for something that works.
- **F2** — a campaign-level starting AP granted automatically on join. **Chosen.**
- **F3** — both.

## Decision

`bind_character_to_campaign` grants the campaign's own `rules.startingTier.ap`.

**Reusing the existing tier figure rather than adding a second setting is the point.** That number already
pre-fills the invite's Starting AP box, so one value now governs both routes in and they cannot drift
apart again — which is precisely how this gap appeared.

**When it grants, precisely.** Only on the path that binds a previously-unbound character. Rebinding to
the same campaign already returns early; a character bound elsewhere already raises; and an `ap_awards`
guard stops an unbind/rebind cycle paying twice. The update is additive (`ap = ap + v_start`), so a
character that already holds AP is topped up rather than clobbered.

**Attribution.** The `ap_awards` row is credited to the campaign's DM, not `auth.uid()` — the caller is the
joining *player*, and recording them as the awarding DM would make the history actively misleading. Same
reasoning as D-GH-2026-08-03-invite-grant-award-row.

**Malformed rules must not block a join.** `rules` is free-form jsonb a DM edits by hand, so the tier value
may be absent, empty, or non-numeric. Anything that isn't a plain non-negative integer grants nothing and
lets the join proceed, rather than erroring — a bad rules blob should not lock players out of a campaign.

## Verification

Executed against the live database with a real player session simulated:

| check | result |
|---|---|
| joining by code grants the tier AP | ap = 45 |
| the grant is recorded in `ap_awards` | 1 row |
| rebinding does not grant twice | still 45 |
| a malformed tier value still lets the join succeed | joined, ap = 0 |
| probe data cleaned up | no stray rows |

Also gated permanently: a new `cloud-e2e` scenario covers the grant, its provenance row, and the
no-double-pay guard.

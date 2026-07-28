# D-GH7 — Campaign play: dual-source AP, co-DMs, and an award ledger

Status: Active

- **Context:** wiring cloud save into the Live Sheet collided with the AP model. The Live Sheet self-awards
  AP via log events (player-writable), but `characters.ap` was meant to be DM-authoritative and
  uncheatable. We also need to know *which* DM gave an award, and a campaign can have more than one DM.
- **Options (AP):** (i) server `ap` is the only budget (breaks solo/honor-system play); (ii) log stays the
  only source (players can self-grant infinite AP by editing their log — defeats the security goal);
  (iii) **both sources coexist, with a per-campaign toggle.**
- **Decision (AP):** (iii). Budget = DM-granted (`characters.ap`) **+** player-entered (log awards), unless
  the campaign's `ignore_player_ap` flag is on, in which case only DM-granted counts. Solo characters (no
  campaign) just use player-entered. Tools show the breakdown and flag any difference.
- **Decision (DMs):** a campaign can have **multiple DMs**. `campaigns.dm_id` stays as the *owner/creator*;
  a new `campaign_dms` table lists everyone who can DM. `is_campaign_dm()` checks membership, so all DM
  powers extend to co-DMs. Two ways to become a co-DM: a **separate DM invite code** (`join_as_dm`) and the
  **owner promoting an existing member** (`promote_to_dm`, owner-only).
- **Decision (attribution):** AP awards are recorded in an `ap_awards` ledger (character, dm_id, amount,
  note, time); `award_ap()` writes a ledger row stamped with the calling DM and updates the running
  `characters.ap` total. So every award is attributed and auditable.
- **Why:** dual-source keeps security available *where the DM wants it* without crippling solo/honor play;
  the ledger gives attribution + history (matching the Live Sheet's event-sourced ethos); a membership
  table is the only way to express co-DMs, and offering both join paths covers self-service and curated add.
- **Status:** IN FORCE. Supersedes D-GH4's "one DM per campaign / single `ap` write". Schema + RLS updated;
  client (DM Console, Live Sheet AP combination) follows.

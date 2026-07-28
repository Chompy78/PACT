# D-GH4 — Data model: per-campaign non-exclusive roles, no player cap, ap locked at the column level

Status: Active

- **Context:** Task 3 needed the Supabase schema + RLS. The plan assumed a global Player/DM role, a 5-player
  cap, and "the characters UPDATE policy must exclude the [points] column from player writes." (The plan
  called the DM-awarded points "xp"; PACT's currency is **AP**, so the column is `ap` — see also the rename.)
- **Options (roles):** (i) global role flag on the profile; (ii) roles derived per-campaign from the
  relationship (DM = `campaigns.dm_id`; player = owning a character in that campaign), allowed to overlap
  even within one campaign.
- **Options (ap):** (i) a row policy / trigger that rejects ap changes; (ii) revoke blanket UPDATE and grant
  UPDATE only on player-writable columns, with a DM-only `award_ap()` SECURITY DEFINER RPC as the sole ap
  write path.
- **Decision:** per-campaign overlapping roles (no stored role column); **no player cap** (overrides the
  plan's "up to 5"); ap protected by a column-level GRANT plus `award_ap()`. Joining and code regeneration go
  through SECURITY DEFINER RPCs (`join_campaign`, `regenerate_invite_code`) so players never need broad read
  access to `campaigns`. Cross-table RLS checks live in SECURITY DEFINER helpers to avoid policy recursion.
- **Why:** the same person can run one table and play at another (or even play in their own game), which a
  global flag can't express. Postgres RLS can't scope an UPDATE to columns, so the column GRANT is the only
  airtight ap guard — a row policy would still let a player set ap in an otherwise-valid update.
- **Status:** IN FORCE. Plan doc (`docs/PWA-BUILD-PLAN.md` Task 4) still says "up to 5 players" and needs
  updating to match.

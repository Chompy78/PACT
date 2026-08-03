# D-GH-2026-08-03-invite-note-dm-only — an invite's DM note is withheld from players at the column level

Status: Active

## Context

`campaign_invites_select` is `is_campaign_dm(campaign_id) or redeemed_by = auth.uid()` — a player can read
their own redeemed invite row. RLS is **row**-level: granting the row grants every column on it. So the
`note` field added by D-GH-2026-08-03-dm-invite-manager was readable by the very player it described. A DM
labelling an invite "replacement after he got himself killed" was writing that to the player.

Flagged at the time rather than silently accepted, and deferred because it touches grants on a live table
and this project has twice been bitten by grant/RLS drift (D-GH15, D-GH12).

## Decision

Withhold `note` from `authenticated` at the **column** level. Every other column stays readable, so the
redeemer clause keeps working for the rest of the row. The DM's own read is unaffected: it goes through
`list_campaign_invites()`, which is `SECURITY DEFINER` and runs as the owner.

Rejected alternatives: moving notes to a separate DM-only table (cleanest conceptually, but a whole table
for one column, and `character_dm_notes` already shows that pattern is only worth it for a richer record);
and leaving it labelled as player-visible (what shipped initially — constrains what a DM can safely write).

## The Postgres subtlety this turned on

**A column-level REVOKE cannot subtract from a table-level GRANT.** Postgres treats table-level `SELECT`
as covering every column, so

```sql
revoke select (note) on public.campaign_invites from authenticated;   -- SILENT NO-OP
```

reports success and changes nothing. The first version of this migration did exactly that;
`information_schema.column_privileges` still listed `note` as selectable afterwards, which is the only
reason it was caught. The table-level grant has to be dropped first and the wanted columns granted
explicitly.

## Consequence for future callers

With a column withheld, `select *` on this table **fails** for `authenticated` with "permission denied for
column note" rather than silently omitting it. Any future client read must name its columns or go through
the RPC. That is deliberate: a loud failure at the first call beats quietly re-leaking the column.

Safe to do now because **nothing in `js/` or `tools/` selects this table at all** — verified before
applying; the only reference anywhere is the `list_campaign_invites()` RPC call. (The comment in
`sql/rls-policies.sql` claiming CharGen's crash-recovery path re-read `starting_budget` from here
described code that no longer exists, and was corrected in this change.)

## Verification

Executed against the live database as the `authenticated` role, with a simulated DM session for the
positive case:

| check | result |
|---|---|
| `authenticated` reads `note` | permission denied |
| `authenticated` `select *` | permission denied (loud, as intended) |
| `authenticated` reads `starting_ap` | still allowed — nothing collaterally revoked |
| DM lists invites via the RPC | 22 invites returned, notes intact |

Supabase security advisor re-run: no new findings. Parity 24/0, audit 28/0.

# D-GH-2026-08-03-invite-single-ap-grant — an invite carries ONE AP grant, paid as DM AP

Status: Active

## Context

A player invite carried two numbers, surfaced in DM Console as "Bonus DM AP" and "Creation budget":

- `starting_ap` → written to `characters.ap` by `redeem_player_invite`. Server-side, DM-authoritative.
- `starting_budget` → returned to the client, which seeded it into the new character's LOG as an
  `award` event. That is **player** AP.

`compute()` resolves `spendable = (ignorePlayerAp ? 0 : playerAp) + dmAp`. So on any campaign with
`ignore_player_ap = true`, the entire Creation budget was granted and then discarded on the same pass.

Found in production, not in review. Invite `d42e29bc…` on the Amble campaign issued 36 + 55; Amble has
`ignore_player_ap = true`; the player could spend **36**, the budget box read **55**, and CharGen
announced *"character created with 55 AP budget"* — a grant the campaign's own setting voids. The two
features were in direct contradiction, and the UI confidently reported the losing one.

## Options

- **A1 — one grant, paid as DM AP.** Chosen.
- **A2 — keep both fields; route the budget into `ap` only when `ignore_player_ap` is set.** Smallest
  diff. Rejected: it leaves two pools whose behaviour silently depends on a checkbox elsewhere in the
  UI, which is the same trap one layer down.
- **A3 — turn `ignore_player_ap` off for Amble, fix only the wording.** Zero code risk. Rejected by
  the owner: the trap re-arms for the next campaign that switches it on.

## Decision

One "Starting AP" field. It is paid into `characters.ap`, so it works identically whether or not the
campaign ignores player AP, and — unlike a LOG `award` event — the player cannot edit or undo their own
grant. CharGen seeds no player-AP award on redemption.

Implementation notes that are load-bearing:

- **Both RPCs keep their exact signatures.** A GitHub Pages deploy and a DB migration are not atomic,
  so for a while the old client still calls `create_player_invite(campaign, ap, budget)`. The function
  folds `starting_ap + starting_budget` server-side, so the old client keeps working and simply
  produces a single-pool invite. In the other direction an old client redeeming a NEW invite gets
  `starting_budget = 0`, seeds no award, and reads the whole grant from `ap`. Both directions degrade
  correctly. An arity-2 overload was rejected — it would make the defaulted 3-arg call ambiguous.
- **`redeem_player_invite` folds too**, so invites created *before* the migration and redeemed *after*
  it still pay their full intended amount instead of losing the budget half.
- **`campaign_invites.starting_budget` is NOT dropped.** Dropping a column is irreversible and buys
  nothing; it stays, is always written 0, and carries a deprecation `comment on column`.
- CharGen keeps a `res.startingBudget > 0` guard on the seed path, so a client running against a
  not-yet-migrated database still seeds the budget half rather than silently losing it.

## Why

The lock, the roster and the AP ledger all treat `characters.ap` as the DM's authoritative lever, and
`ap` is already documented as DM-only and never overwritten by a local push. A DM-issued allowance
belongs in that pool. Two fields for what players experience as one number was the reported source of
confusion even before the `ignore_player_ap` interaction made one of them a no-op.

## Verification

- Migration applied via `apply_migration` (`invite_single_ap_grant`); `sql/schema.sql` updated to match.
  Supabase security advisor re-run: **no new findings** — the two invite RPCs appear in the same
  pre-existing `authenticated_security_definer_function_executable` list as every other RPC in this
  app (intentional; each gates internally on `is_campaign_dm` / `auth.uid()`).
- The `v_ap < 0 or v_extra < 0` check is deliberately made **before** folding: two values summing to a
  non-negative total must each be non-negative, or a negative budget could cancel part of a positive
  grant.
- Parity 24/0, static audit 27/0, browser e2e 3/3.
- No production data rewritten. Existing characters keep whatever `ap` and LOG they already have.

## Follow-up not done here

Amble's already-redeemed character (Sera Valor) still has the pre-change shape: `ap = 36` plus a
55 AP player-AP award event its campaign ignores. Reconciling that one row to `ap = 91` is a
data edit on live data and is left for the owner to trigger deliberately, like the creation-lock
backfill before it.

# D-GH-2026-08-11-character-claim-link-copy-not-transfer — claim link copies a character, doesn't reassign it

Status: **Active**, 2026-08-11.

## Context

`docs/TASK_BOARD_NEXT.md`'s "DM manually adds/imports a character to a campaign, then hands off ownership
via a claim link" task (branch `feat/character-ownership-claim-link`) was drafted assuming the claim link
would reassign `owner_id` on the DM's existing character row — a brand-new `SECURITY DEFINER`
ownership-transfer RPC. That was the reason the task was rated Effort: high · Risk: high and carried a
recommendation to run `/make-code-cold-plan-review` before implementation: `characters_update`'s RLS
policy requires `owner_id = auth.uid()` in both `USING` and `WITH CHECK` (confirmed via `grep -n
"owner_id" sql/rls-policies.sql`), meaning raw ownership reassignment is blocked on purpose today, and
drilling a deliberate hole through that is a genuine trust-boundary change.

During task-board triage on 2026-08-11, the owner questioned whether the flow actually needs to reassign
the *same* row at all, versus just giving the player their own copy of the character.

## Options

- **A1 — keep the transfer design.** Build the ownership-transfer RPC as originally scoped. Preserves a
  single canonical row/id across the handoff (the "same" character before and after), but requires a new
  authorization surface on the one boundary (`owner_id`) this project's RLS deliberately protects.
- **A2 — redesign as a copy.** The claim link creates a brand-new `characters` row owned by the redeeming
  player, seeded from the DM's source character (stats/LOG/kind), auto-bound to the source's campaign.
  The DM's original row is untouched. No RLS/ownership-model change needed at all — a player inserting
  their own row (even one seeded from another user's data server-side) is already exactly what the
  existing insert grant (`id, owner_id, name, kind, stats`, `owner_id = auth.uid()`) allows.

## Decision

**A2 — copy, not transfer.**

## Why

The entire risk rating on this task came from one thing: a new path that can change `owner_id` on an
existing row. A2 eliminates that path completely — the redemption RPC only ever `INSERT`s a row the
redeeming player already has the right to own, it never `UPDATE`s the source row's ownership. That
collapses the task from a genuine security/trust-boundary change to an ordinary feature build, and drops
the recommended `/make-code-cold-plan-review` step as no longer necessary — the risk it existed to catch
is gone by construction, not merely mitigated.

The trade-offs accepted: the copy is a snapshot (later DM edits to the source don't propagate — acceptable,
since once handed off it's the player's character); the DM's original character stays in their account
afterward (accepted as a feature — a reusable template for the next NPC-to-PC promotion) unless a future
session decides a cleanup/archive affordance is worth adding. Both are UX questions, not safety questions,
and are left as open items on the task's own entry rather than settled here.

## Status

Active. Re-scoped `feat/character-ownership-claim-link` task entry in `docs/TASK_BOARD_NEXT.md` to match;
the branch name is unchanged (kept for continuity with existing cross-references in the security-audit
task) even though the mechanism is now a copy, not a transfer.

## Addendum (2026-08-11, same day) — implemented

Built directly against this redesign; the open design questions left on the task-board entry were
resolved as follows (all recorded here rather than re-litigated):

1. **Getting the source character in.** No new capability needed. A DM builds/imports the character in
   CharGen under their own account, then binds it to their own campaign via the existing
   `bindCharacterToCampaign` (works for any owner, including a DM binding an extra character of their
   own) — `characters_update`'s owner-only column grants never gate `campaign_id` directly, only the
   SECURITY DEFINER RPCs do, and this one was already general enough. DM Console's "read-only, never
   edits a character" principle stays intact — it plays no role in this flow at all.
2. **Token storage: plaintext, not hash-only** (revised same day — see Addendum below). `campaign_invites`
   gained a third `type`, `character_claim`, sharing the plaintext `token` column with `player`-type
   rows.
3. **Single-use, no expiry, no revoke UI in v1.** Matches the recommendation; `campaign_invites`'
   existing `campaign_invites_reusable_dm_only_check` needed no change since `create_character_claim`
   always hardcodes `mode = 'single_use'`. `expires_at`/`revoked_at` columns are shared with the other
   invite types and honoured by `redeem_character_claim`'s validity check, but nothing in v1 sets them for
   a claim link — a later task can add DM-facing expiry/revoke UI without any schema change.
4. **DM's original character: left alone, no cleanup offered.** Matches the recommendation. Nothing
   marks it "already claimed" beyond the now-redeemed `campaign_invites` row itself; a DM can generate a
   second claim link from the same source character at any time (no "already claimed" guard was added —
   out of scope for v1, and not obviously wanted: a DM might legitimately want more than one player to
   start from the same NPC template, each getting an independent copy).
5. **AP carries over.** `redeem_character_claim` sets the copy's `characters.ap` to the source's `ap`
   directly (not zero), and records a matching `ap_awards` row ("Carried over from claimed character",
   attributed to the *original* invite's `created_by`) so the provenance trail reads the same as any other
   grant rather than appearing from nowhere.
6. **Auto-bind.** The copy's `campaign_id` is set to the claim invite's `campaign_id` (the source's
   campaign at the time the link was generated) unconditionally on redemption — the whole point of the
   flow. No separate bind step.
7. **Consent: redeeming is confirming**, matching player-invite precedent — CharGen shows a `confirm()`
   dialog before calling `redeemCharacterClaim` (mirrors `tryRedeem()`'s existing invite-acceptance
   prompt), but the server enforces nothing beyond authentication; declining is a pure client-side no-op
   (the token stays valid, same "kept, not burned by Cancel" behaviour player-invite decline already has).

**Implementation notes beyond the open questions:**
- The copy's stats envelope needs its inline `id` field rewritten to the new row's id (`D-GH40`'s unified
  save format stores the character's own id inside `stats`) — done server-side in
  `redeem_character_claim` via `jsonb_build_object('id', v_new_id)`, unconditional, no client-side
  assertion needed (unlike `_cgDeriveCopyId`'s collision guard for the *unrelated* DM-views-a-character-
  in-CharGen copy flow, which derives a deterministic id and therefore has to prove it never equals the
  source — this flow always mints a fresh `gen_random_uuid()`, so there is no collision to guard against).
- CharGen-only in v1: the "Generate claim link" action lives in the ☁ Cloud menu's existing "Bound to
  campaign" panel (shown once a character-bound-to-a-campaign is loaded); redemption reuses the
  `?claim=`→sessionStorage→`tryRedeemClaim()` pattern that mirrors `?invite=`/`tryRedeem()` exactly, in
  its own token/state namespace so an invite and a claim link pending in the same tab never collide.
  DM Console has no UI for this — a DM builds the source character in CharGen, not DM Console.
- **First-pass advisor catch:** `get_advisors` flagged both new RPCs as callable by `anon` after the
  first apply — Postgres grants `EXECUTE` to `PUBLIC` by default on every newly created function, and the
  first pass only added the `grant … to authenticated` half without the paired `revoke … from public`
  every other RPC in `rls-policies.sql` already carries. Fixed in a follow-up migration before this was
  considered done; re-ran the advisor clean afterward. Worth calling out explicitly since this is exactly
  the class of drift `AGENTS.md`'s per-change checklist step 4 (run the advisor before opening the PR)
  exists to catch — it did.

## Addendum (2026-08-11, same day) — token storage flipped to plaintext, per owner

Point 2 above (hash-only, the initial implementation choice) was overridden by the owner the same day:
**"Keep the plaintext, shown-once is fine for now."** Applied as a clean follow-up migration
(`sql/migrations/2026-08-11-character-claim-plaintext-token.sql`) — confirmed zero `character_claim` rows
existed at the time (`select count(*) from campaign_invites where type = 'character_claim'`), so this was
a schema/RPC flip, not a data migration:

- `campaign_invites_token_storage_check` moved `character_claim` from the hash-only group (with `dm`) to
  the plaintext group (with `player`).
- `create_character_claim()` now inserts into `token` directly (no `digest()`/`token_hash`), mirroring
  `create_player_invite()`'s token-generation loop exactly.
- `redeem_character_claim()` now looks up by `token = p_token` directly, no `digest()` step.
- No client-side change needed — the token was always an opaque string to CharGen; only its server-side
  storage/lookup changed.
- Grants unchanged (same function signatures) — re-ran `get_advisors` after, still clean, no new
  `anon`-executable warning introduced by this follow-up.

Net effect: a claim link now behaves exactly like a player invite for storage purposes (plaintext, shown
once, no persistent redisplay), not like a co-DM invite. If a DM loses the link before sharing it, they
generate a new one — no recovery path in v1, same as today for a lost DM-invite token.

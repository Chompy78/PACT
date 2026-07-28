# D-GH-2026-07-13-campaign-join-race-friendly-error — `join_campaign`/`redeem_player_invite` race surfaces friendly error, not raw DB error

Status: Active

- **Context:** filed as a roadmap follow-up from `D-GH-2026-07-13-campaign-membership-helpers`'s own
  `/code-review` pass: `join_campaign` and `redeem_player_invite`'s character-insert had no
  `unique_violation` exception handler, unlike `bind_character_to_campaign` (which got one in
  `D-GH-2026-07-13-campaign-bind-character` to close the same TOCTOU race). All three RPCs share the same
  unlocked "`is_campaign_member()` check, then insert/update" shape, and all three write into the same
  `idx_characters_owner_campaign_unique` partial index — so all three can lose the same race. A race that
  beats either RPC's pre-check hit that index and surfaced a raw Postgres "duplicate key value violates
  unique constraint" error to the client instead of the friendly "You have already joined this campaign"
  message the pre-check itself already raises.
- **Options:** (A) wrap the insert in `begin/exception when unique_violation` inside each function, raising
  the exact message text the function's own pre-check already uses — the pattern already proven in
  `bind_character_to_campaign`. (B) add a single shared helper function both RPCs call instead of
  duplicating the begin/exception block.
- **Decision:** (A) — mirrors the already-shipped, already-reviewed `bind_character_to_campaign` pattern
  exactly, keeping all three RPCs' race-handling shape identical and easy to audit together. (B) would add
  a helper to save a two-line catch clause already duplicated three times (this change brings
  `join_campaign`/`redeem_player_invite` in line with `bind_character_to_campaign`, which already carries
  it) — but the statement each block wraps differs per call site (a plain `insert`, a five-column `insert`,
  an `update`), so a shared helper would need dynamic SQL to stay generic, trading a two-line save for a
  real readability/type-safety cost. Not worth it for a block this small (the opposite mistake
  `D-GH-2026-07-13-campaign-membership-helpers` fixed, where the duplicated logic was a multi-line lookup,
  not a two-line catch clause).
- **Why:** the friendly message already exists in both functions' pre-check — this only closes the race
  window between that check and the write, using the exact same recovery pattern already live and verified
  for `bind_character_to_campaign`. No new behavior on the non-race path, no signature/return-type change.
- **Status:** Shipped. Migration `sql/migrations/2026-07-13-campaign-join-race-friendly-error.sql` applied
  to the live Supabase project (`apply_migration`); confirmed both functions carry the handler via `pg_proc`
  introspection (`prosrc ilike '%unique_violation%'`). Advisor shows no new finding class — `join_campaign`
  and `redeem_player_invite` were already in the "authenticated can execute this SECURITY DEFINER function"
  WARN list before this change, unaffected by it. `get_logs` (postgres service) skimmed post-apply — the
  only ERROR-severity entries are pre-existing "No campaign with that invite code" smoke-test errors from
  earlier sessions, no new/unrelated errors. `testing/scripts/engine-parity-ci.mjs` unaffected (20/0 — no
  `js/engine.js` change).

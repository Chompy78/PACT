# D-GH-2026-07-16-campaign-invite-search-path — schema-qualify, don't widen search_path

Status: Active

- **Context:** `D-GH-2026-07-16-advancement-tracks-e2e` found that `gen_invite_code()` and
  `create_player_invite()` (both pinned to `search_path = public`) call bare `gen_random_bytes(...)`,
  which lives in the `extensions` schema on this project — so campaign creation and player-invite
  creation were broken everywhere in the deployed app (zero campaign rows existed).
- **Options:** (1) widen both functions' `search_path` to `public, extensions`. (2) schema-qualify the
  two call sites (`extensions.gen_random_bytes(...)`), leaving `search_path` at `public`.
- **Decision:** option 2. Changed both call sites to `extensions.gen_random_bytes(...)`; `search_path`
  stays `set search_path = public` on both functions.
- **Why:** these are `SECURITY DEFINER` functions — widening their `search_path` means every future
  unqualified identifier they reference could implicitly resolve against `extensions` too, which is
  exactly the class of ambiguity the separate `pg_temp` search_path hardening task (see the LATER-bucket
  item on `docs/TASK_BOARD.md`) is working to make explicit repo-wide, not looser. A single schema
  qualification at the two actual call sites fixes the bug with zero change to what these functions can
  implicitly resolve.
- **Verification:** applied as migration `2026-07-16-fix-gen-random-bytes-search-path.sql` against the
  live project. A real `INSERT INTO campaigns` (the app's actual code path, not a direct function call)
  succeeded via `gen_invite_code()`'s column default, generating both `invite_code` and `dm_invite_code`;
  the throwaway row was deleted immediately after. `extensions.gen_random_bytes(16)` — the exact
  expression `create_player_invite()` uses — was confirmed to resolve directly. `create_player_invite()`
  itself wasn't re-invoked through its full DM-authenticated path (that requires faking `auth.uid()`
  inside the SQL session, disproportionate for this fix's scope) — its fix is the identical one-line
  schema qualification already proven correct for `gen_invite_code()`.
- **Also found (by `/code-review ultra`, fixed same-PR):** `sql/schema.sql`'s `gen_invite_code()` was
  missing `set search_path = public` even though the live database already had it — untracked drift
  predating this PR (the migration that introduced the CSPRNG version, `2026-07-02-rev07-csprng-invite-
  codes.sql`, also has no `search_path` clause, so the live DB's clause was added by some change never
  reflected back into `schema.sql`). Synced `schema.sql` to match reality.
- **Accepted assumption:** the fix assumes pgcrypto (and `gen_random_bytes`) lands in the `extensions`
  schema, true for Supabase-provisioned projects (this repo's only backend, per `AGENTS.md`) but not
  guaranteed by `create extension if not exists pgcrypto;` alone on an arbitrary Postgres instance — noted
  inline in `sql/schema.sql`, not treated as a gap to fix given the Supabase-only constraint.
- **Status:** Active.

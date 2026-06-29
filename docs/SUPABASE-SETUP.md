# PACT — Supabase project setup

Step-by-step to stand up the backend and validate the Task 3 SQL. Do this once; it unblocks
Tasks 2–5. You only need a free Supabase account.

## 1. Create the project
1. Go to <https://supabase.com> → sign in → **New project**.
2. Name it `pact` (or anything). Pick a region close to your players. Set a strong database
   password and save it somewhere — you won't need it for the app, but you will for `psql`/CLI.
3. Wait for provisioning (~2 min).

## 2. Apply the schema
Run the two SQL files **in order** — schema first, then policies.

**Option A — SQL editor (easiest):**
1. Left sidebar → **SQL Editor** → **New query**.
2. Paste the entire contents of `sql/schema.sql`, click **Run**. Expect "Success, no rows returned".
3. New query → paste `sql/rls-policies.sql`, **Run**. Same success message.

**Option B — CLI:** `supabase db push` after linking, or
`psql "<connection string>" -f sql/schema.sql -f sql/rls-policies.sql`
(connection string is in **Project Settings → Database → Connection string → URI**).

### Verify it applied
In the SQL editor, run:
```sql
select tablename from pg_tables where schemaname = 'public';            -- profiles, campaigns, characters
select proname from pg_proc where proname in
  ('join_campaign','regenerate_invite_code','award_ap','gen_invite_code'); -- all four present
select tablename, rowsecurity from pg_tables where schemaname='public';   -- rowsecurity = true on all three
```

## 3. Enable email/password auth
1. **Authentication → Providers → Email** → make sure it's **enabled**.
2. For local testing you may want to turn **Confirm email** OFF (Authentication → Providers → Email),
   so test signups work without clicking a confirmation link. Turn it back ON before going live.
3. **Authentication → URL Configuration:**
   - **Site URL:** `https://chompy78.github.io/PACT/`
   - **Redirect URLs:** add `https://chompy78.github.io/PACT/` (used by the password-reset email).

## 4. Grab the keys (for Task 2)
**Project Settings → API:**
- **Project URL** — e.g. `https://abcdefgh.supabase.co`
- **anon / public key** — the long JWT.

These go into `js/supabase-client.js` (Task 2) as constants. The anon key is safe to ship in
client code **because RLS is what actually protects the data** — never paste the `service_role`
key into anything client-side.

## 5. Smoke-test the security model (optional but recommended)
Once Task 2 auth exists, confirm the guarantees hold:
- Register two users (A and B). A creates a campaign; B joins with the invite code.
- As B, try to `update` a `characters` row setting `ap` → must be rejected (column not granted).
- As B, try to `update` A's character → blocked by RLS (not owner).
- As the DM, call `award_ap(<B's character>, 10)` → succeeds; B's ap goes up.
- As B, call `award_ap(...)` → rejected ("Only the campaign DM can award AP").

## Notes
- Re-running `rls-policies.sql` is safe (it drops policies first). Re-running `schema.sql` is safe too
  (`create ... if not exists` / `create or replace`).
- Roles are per-campaign and overlapping — there is no global Player/DM flag and no player cap.
  See `DECISIONS.md` D-GH4.

# Session — 2026-07-02 · Post-merge audit of the day's work

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `DECISIONS.md` (D-GH9, D-GH17),
`docs/PACT_ROADMAP.md`.*

## Goal
After a full day of parallel-agent work landed on `preview`/`main` (PRs #71–#91: Feature A multi-tradition
spellcasting, DM campaign rules configure/enforce/live-filter, REV-07 CSPRNG invite codes, the
award_xp/award_ap grant fix, CU-7 mobile action bar, the Live Sheet low-spend nudge, and this session's
own AGENTS.md module-bridge fix), the user asked for an adversarial pass over everything merged that
hour to catch anything the individual PRs' own review missed.

## What we did

### Scoped the audit
Diffed `1808d35` (last commit before the day's work started) against `origin/main`: 19 files, ~1,250
lines, across `js/engine.js`, `js/campaign.js`, all three `sql/migrations/*.sql`, `sql/rls-policies.sql`,
`sql/schema.sql`, and all three tools. Split the review into security/RLS (live Supabase), engine/rules
correctness (Feature A pricing), and docs consistency.

### Security / live Supabase (via the Supabase MCP, not just reading the repo)
- Found the REV-07 CSPRNG migration had been merged into the repo but **never applied to the live
  database** — confirmed by reading `pg_proc.prosrc` for `gen_invite_code()` live; it was still on
  `random()`. Applied it live, verified the deployed function now uses `gen_random_bytes()` and a sample
  generated code matches `^[A-Z0-9]{6}$`.
- Ran the Supabase security advisor: found `gen_invite_code` and `set_updated_at` were the only two
  functions in the schema missing a pinned `search_path` (every other function already has one). Pinned
  both via `ALTER FUNCTION ... SET search_path = public`.
- Verified the still-open "lock down remaining EXECUTE grants" roadmap task's safety analysis actually
  holds live: queried `pg_proc.prorettype` to confirm `handle_new_user`/`add_owner_as_dm`/`set_updated_at`
  genuinely `returns trigger` (Postgres blocks direct RPC calls to these regardless of grant), and read
  every other flagged function's source to confirm each correctly rejects a NULL `auth.uid()` (anon).
  Nothing currently exploitable; expanded that roadmap item in place with the verified evidence so a
  future pickup doesn't have to re-derive it.
- Found "leaked password protection" disabled in Supabase Auth — a dashboard-only toggle with no MCP tool
  to flip it programmatically (checked `list_tables`/`execute_sql`/`apply_migration`/`get_advisors`/
  `get_project`/`deploy_edge_function` — none reach Auth config). Left for the user to enable by hand.

### Engine/rules correctness (Feature A: multi-tradition spellcasting + Magically Bound)
- Verified `compute()` genuinely prices every tradition and every discipline within it (not hard-coded to
  index 0), and that `d.bound`'s AP credit (`mbGain`) and per-level spell discount are both wired
  correctly — the rules math itself was sound.
- Found a real, live UI bug: `ib()`'s cost-label (`costlbl`) and afford-gate (`unaff`) logic special-cased
  `cat==='drawback'` for the "negative cost = AP granted" convention, but Feature A's new `mbound`/`dbound`
  categories use the exact same convention and were never added to either check. Result: the
  Magically/Martially Bound buttons showed a literal "-2" badge next to label text that already said
  "(+2 AP)", and could — for an already over-budget character — be wrongly hard-blocked as unaffordable
  with a nonsensical "needs -2 AP" message. Fixed both checks to match `drawback` exactly.

### DM Console / docs consistency
- Cross-checked the new Campaign Rules panel's data sources (`DATA.pack`, `DATA.masteryFx`, `DATA.boons`,
  `DATA.classes`) against `js/engine.js`'s equivalents — no drift, all match.
- Checked `DECISIONS.md`'s D-GH numbering for duplicates/collisions — none; the previously-known stale
  D-GH14 roadmap reservation had already been corrected to D-GH18 by an earlier session.

## Fixes applied
1. `AGENTS.md`'s stale module-bridge claim (see this session's earlier work; CHANGELOG'd separately).
2. REV-07 CSPRNG invite-code migration applied live + `search_path` pinned on the two functions missing
   it — live Supabase, no repo file change beyond the CHANGELOG entry.
3. Live Sheet's `mbound`/`dbound` cost-badge and afford-gate fix — `tools/PACT-Live-Char-Sheet.html`,
   committed to `claude/remote-control-5v39hy`, merged into `preview` this session.

## Follow-ups filed (not done in this session)
- Enable Supabase Auth's leaked-password-protection toggle (dashboard-only, left for the user).
- "Lock down remaining Supabase function EXECUTE grants" — expanded in place with live verification
  evidence; still open, not urgent (nothing currently exploitable).

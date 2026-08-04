# D-GH-2026-08-04-review-stack-seed — a seeded stack for usability review, and the terms for pointing it at a live project

Status: Active

## Context

`cloud-e2e` proves the signed-in paths *work*. It says nothing about whether they are pleasant, and it
tears the stack down the moment it finishes — so a usability review had no way to reach the cloud half
of the app at all. That half is where every defect this week lived, so reviewing only the signed-out
half would have missed the part most in need of it.

A review needs the opposite of a test fixture: stable accounts that can be signed into repeatedly, a
campaign with history, and deliberate mess — a revoked invite, an archived character, an awkward name
— because an all-happy-path database hides most usability problems by construction.

## Options

- **M1** — local throwaway stack only (`supabase start`). Strongest isolation, but needs Docker.
- **M2** — a separate scratch Supabase project. No Docker, but the free tier caps at two projects per
  org and both were already in use.
- **M3** — seed the live project. No Docker, no cap, realistic — and writes into a database real
  players share.
- **M4** — signed-out review only. Costs nothing and covers nothing that matters here.

## Decision

Build **M1 as the default and M3 as an explicit opt-in**, in one script, sharing one seeding path.

M2 was ruled out by the project cap rather than on merit. M3 was chosen by the owner after being shown
what is actually in the database — four real accounts and a running campaign, one player active that
day. That is the fact the decision turned on, and it is recorded here because the earlier assumption
("there isn't really anything important yet") was reasonable and wrong.

### What live mode gives up rather than merely discourages

- **`sql/schema.sql` is never applied.** Production has the schema; re-applying it would drop and
  recreate policies on a live database.
- **`--reset` does not exist in live mode.** `drop schema public cascade; delete from auth.users` has
  no safe meaning against a shared project, so the flag is refused rather than documented-as-dangerous.
  A destructive path that exists is a destructive path someone eventually runs.

### Three gates, not one flag

`--live`, plus `PACT_REVIEW_LIVE=i-understand` in the environment, plus explicitly-supplied
`SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Nothing is defaulted and nothing is read from the repo, so
the checked-in production constants can never become the target implicitly. A single flag is one typo
away from a different command; a flag plus a spelled-out env var is not something done by accident.

### Cleanup by tag, not by memory

Accounts live on `@review.pact.test`; campaigns are prefixed `[REVIEW]`. `--purge` deletes only the
review accounts, and the schema's own cascades reach everything they own and nothing else:

```
auth.users -> profiles (CASCADE) -> characters.owner_id (CASCADE)
                                 -> campaigns.dm_id     (CASCADE) -> campaign_dms    (CASCADE)
                                                                  -> campaign_invites (CASCADE)
                                    ap_awards.character_id         (CASCADE)
```

Deleting five accounts is therefore both *sufficient* and *exact*. This was verified against the live
FK catalogue, not assumed.

**One cascade is not safe alone.** `characters.campaign_id` is `ON DELETE SET NULL`, so deleting a
review campaign that contained a real player's character would silently **unbind** them rather than
error — a data-loss-shaped outcome with no error message, which is the worst kind. Purge therefore
refuses to run if it finds a non-review character inside a review campaign, and names it. A second
guard refuses any untagged campaign owned by a review account.

### Snapshots

`backup.snapshots` holds whole-database JSON captures. Deliberately in a `backup` schema rather than
`public`: PostgREST exposes only `public`, so the snapshot is unreachable from the app even though it
contains `auth.users` rows including password hashes. Verified `anon` and `authenticated` hold neither
schema `USAGE` nor table `SELECT`.

**Restore is not automated and has not been rehearsed**, and the doc says so. The snapshot means no
data is unrecoverable; it does not mean recovery is quick. Claiming otherwise would be the same class
of error as a test that has only ever been seen green.

## Why the seed data looks like this

Characters are lifted from `testing/fixtures/live-sheets/` rather than hand-authored. A hand-written
LOG would have to get every `cost` right or the Live Sheet ledger reads as nonsense — and a reviewer
would report the resulting garbage as a bug in the app.

The awkward name (`Bob "The Knife" <b>O'Malley</b> & Sons` + 60 characters of overflow) is written
server-side so the client cannot normalise it on the way in. `AGENTS.md` makes escaping a hard
invariant now that cloud data crosses users; a review that only ever sees "Aldric Valor" cannot tell
whether it holds.

## Verification

Each live guard was executed, not merely written: missing `PACT_REVIEW_LIVE`, missing URL/key,
`--reset`, and a non-Supabase URL each refuse with the reason. Every module call in the seed script was
statically checked against the real exports of `campaign.js` / `sync.js` / `dm.js` / `auth.js` — which
caught two wrong DM function names (`listCampaignCharacters`, `setCharacterNote`) before they shipped.

**The seed path itself has not been executed end to end.** `supabase start` cannot run in the cloud
session this was written in: the sandbox caps `RLIMIT_NOFILE` at 20000, Supabase's Postgres container
requests more, and root lacks `CAP_SYS_RESOURCE` to raise it. Recorded here so the first person to run
it budgets a debug round rather than trusting an unproven green.

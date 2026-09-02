# `sql/migrations/` — read this before you copy anything out of here

**A dated migration file is a historical record of one change. It is NOT the current definition of
anything.** Rebuilding a function from the migration that first created it is how you silently revert
every change made since.

This is not a hypothetical. On **2026-09-02** it put two security regressions into production at once.
`2026-09-01-session-seal.sql` needed to add one event type to `dm_edit_character_log()`'s allow-list. It
rebuilt the whole function from `2026-08-10-dm-edit-character-log.sql` and carried a header saying *"every
other line is unchanged from 2026-08-10"* — a statement that was **true**, and was exactly the defect:
2026-08-10 had stopped being the live definition three weeks earlier. Two later changes went with it:

| Lost | Effect |
|---|---|
| `assert_campaign_active()` (2026-08-22) | archived, read-only campaigns became writable by their DM again |
| the boon/award FIFO amount check (2026-08-10) | a boon grant no longer had to be paid for |

Both were live for about eleven hours before a code review caught them.

## Where the current definition actually lives

1. **`sql/rls-policies.sql`** — the maintained baseline. It is the documented fresh-install path
   (`schema.sql` then this), it is declared safe to re-run, and it is what you should copy from or edit.
2. **The database itself** — `select prosrc from pg_proc where proname = '…'`. When it matters, read it
   back rather than trusting any file. That is the only source that cannot be stale by construction.

## What this directory is for

Applying a change, and recording why it was made. Each file should say what it changes and what it
deliberately leaves alone. Several here carry hard-won reasoning in their headers that is worth reading
before touching the same area — `2026-09-02-widen-protected-projection.sql` in particular explains why
`dmRemoveBoon` could be protected positionally while `patch` buys could not, which is the kind of thing
that looks arbitrary until you know.

## Both paths are tested, and they are tested against each other

- `testing/sql/session-seal-test.sql` builds from the **migrations**.
- `testing/sql/rls-baseline-test.sql` builds from **`schema.sql` + `rls-policies.sql`**, and additionally
  loads the migrations on top and asserts both sources define the **same logic**.

`.github/workflows/sql-guards.yml` runs both on any change under `sql/` or `testing/sql/`. So if you
update a migration and forget the baseline — or the reverse, which is what actually happened — CI fails
instead of the difference sitting there for someone to discover in production.

## If you add a migration

1. Apply it.
2. Fold the same change into `sql/rls-policies.sql`.
3. Run both harnesses (`.github/workflows/sql-guards.yml` shows the exact commands; any Postgres 14+ works,
   no Supabase needed).
4. Measure blast radius against live data **before** applying anything that could refuse an existing
   write, and put the number in the header. "0 of 35 characters affected" is worth more than a paragraph
   of reasoning about why it should be safe.

# D-GH-2026-10-10-blank-row-guard — the server refuses blank solo character rows, and a weekly job sweeps any that remain

Status: Written and tested (both SQL harnesses, static audit, engine parity). **Not yet applied to the live database** —
the session's permission check refused `apply_migration` as a production deploy; the owner applies it (see *Applying* below).

## Context

On 2026-10-08 a player (Christen) could not load his character. His account held 11 cloud rows: two real characters, both
named Caspian, and nine "New Character" rows — five of them created within ~6 seconds. A live check on 2026-10-10 found
31 such rows across 5 owners (2026-08-08 → 2026-10-08), one owner holding 16. Every one is pure column defaults: name
'New Character', kind 'livesheet', stats '{}'. No tool's `saveCharacter()` call sends empty stats; the likely source is a
stats-less local placeholder (`noteEdit()` / `setAutosaveEnabled()` in `js/sync.js`) pushed as an INSERT. That client
root cause is tracked separately: `docs/TASK_BOARD_NOW.md` → `fix/blank-character-rows`.

## Options

- **I1 — refuse at the server + one-off cleanup.** Stops new blank rows immediately, before the client fix lands.
- **I2 — a scheduled sweep only.** Most hands-off, but blank rows still appear between sweeps, and a device that still holds
  the placeholder is likely to re-push it after each delete.
- **I3 — both: refusal as the main defence, a weekly sweep as the backstop.** Chosen by the owner, 2026-10-10.

## Decision

1. `trg_pact_refuse_blank_solo_character` (BEFORE INSERT on `characters`) refuses a row with `campaign_id` null whose stats
   carry no `LOG` key, with a `PACT:` message.
2. `pact_purge_blank_characters(p_min_age default 1 day)` deletes solo rows whose stats are exactly `'{}'`, older than the
   minimum age by both `created_at` and `updated_at`, and referenced by no other table. Not callable by anon/authenticated.
3. `pg_cron` runs it Sundays 03:00 UTC (`2026-10-10-blank-row-purge-schedule.sql`, Supabase-only).

## Why

- **Solo only, in both halves.** `join_campaign()` and `redeem_player_invite()` deliberately INSERT a campaign-bound seed row
  with the default `'{}'` and the tool fills it in afterwards. A blanket rule would have broken joining a campaign. Found by
  reading the live function bodies before writing the rule — the obvious version of this guard was wrong.
- **The purge matches exactly `'{}'`,** not "no LOG", so it can never remove a row that holds any data (live: two test rows
  hold only `{"note":"hello"}` and are left alone). The insert guard is broader on purpose: nothing legitimate inserts a solo
  row without a LOG.
- **An empty `LOG` array is allowed** — an untouched draft is a real envelope.
- **Deletes are recoverable:** the existing `trg_characters_snapshot` copies every deleted row to `character_backups`
  (reason `delete`), so the sweep needs no backup step of its own.
- **Refusal ends the re-push loop** that a sweep alone would likely cause: a device still holding a placeholder now gets an
  error it already treats as transient (`reconcile()` retries later), instead of recreating the row.

**Blast radius (live, 2026-10-10, 64 rows):** no legitimate path inserts a solo row without LOG; 31 purge candidates, all
solo, none referenced by `ap_awards`, `gold_awards`, `character_dm_notes`, `campaign_invites`,
`campaign_downtime_declarations` or `ap_award_edits`; 0 campaign-bound active rows with `'{}'`.

**Known limit:** until the client fix lands, a device holding a placeholder may still list it as a device-only entry
(`listMyCharacters()` shows dirty local records the server lacks) and will keep retrying the refused push. Harmless to data;
fixed by `fix/blank-character-rows`.

## Applying (owner)

1. Apply `sql/migrations/2026-10-10-blank-row-guard.sql`, then `2026-10-10-blank-row-purge-schedule.sql`.
2. Run the sweep once: `select public.pact_purge_blank_characters(interval '1 day');` — expected 31 on 2026-10-10.
3. Run the Supabase advisors and check the logs.

-- fix/blank-row-guard (2026-10-10) — run pact_purge_blank_characters() weekly. SUPABASE ONLY.
-- Decision: decisions/2026/D-GH-2026-10-10-blank-row-guard.md. Requires 2026-10-10-blank-row-guard.sql first.
--
-- Kept out of 2026-10-10-blank-row-guard.sql because pg_cron does not exist on the plain Postgres that
-- testing/sql/*.sql run on; deliberately NOT in either harness's \ir list, nor in sql/rls-policies.sql.
--
-- The insert guard is the main defence; this sweep is the backstop for anything that still slips in (e.g. a
-- blank row that is emptied by some other path later). Sundays 03:00 UTC, rows older than 1 day.
-- Inspect:  select * from cron.job where jobname = 'pact-purge-blank-characters';
--           select * from cron.job_run_details order by start_time desc limit 5;
-- Remove:   select cron.unschedule('pact-purge-blank-characters');

create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'pact-purge-blank-characters';
select cron.schedule('pact-purge-blank-characters', '0 3 * * 0',
                     $$select public.pact_purge_blank_characters(interval '1 day')$$);

-- fix/stored-size (2026-10-11) — ONE-OFF DATA CORRECTION: append a "size corrected" event to every character whose stored size
-- is a placeholder. Decision: decisions/2026/D-GH-2026-10-11-stored-size.md · Plan: docs/plans/2026-10-11-stored-size.md (cold-reviewed).
--
-- THE PROBLEM. CharGen hid its size dropdown when size isn't a choice and parked it at "Small"; saving stored that hidden value.
-- compute() ignores a non-choosable stored size, so play was never affected — but anything reading the raw database (another AI
-- session, a report) read "Small" for characters that are Medium. The code fix (js/engine.js sizeOf(); CharGen stores sizeOf().size)
-- stops new ones; this corrects the existing ones.
--
-- WHAT THIS DOES. Appends ONE event per listed character: {type:'buy', cat:'patch', cost:0, payload:{patch:{size:'Medium'}},
-- systemEdit:true}, seq = the stored SEQ (the next free seq), SEQ + 1. It APPENDS rather than rewriting the old size events: those sit
-- inside locked/sealed history for 12 of these characters, which the server freeze (trg_pact_locked_history) refuses to rewrite —
-- and an append after the lock is exactly what that trigger allows (it only refuses the protected prefix shrinking or changing).
-- foldBuild() is last-patch-wins, so the folded build now says Medium; compute() output is unchanged (it never read this value).
--
-- WHAT THIS LEAVES ALONE. The original "Small" events stay in the history (rewriting them is the freeze's job to refuse). Raw readers
-- must take the LAST size event, or better compute(foldBuild(LOG)).size — see AGENTS.md's data rule. Characters whose size is a real
-- choice (Halfling/Gnome pairs, Tieflings) and the 6 with no stored size are not touched. Not registered in the SQL harnesses: it is a
-- data fix keyed on live ids, and a fresh database has none of them.
--
-- GUARDS. Explicit id list (measured 2026-10-11 by running the real engine over all 37 live rows: 23 store "Small" where the engine
-- says Medium, none choosable, 0 errors). Each row is updated only if its LAST stored size is still "Small". One statement; it
-- aborts unless exactly 23 rows change. trg_characters_snapshot backs every row up to character_backups before the update.
--
-- BLAST RADIUS. 23 of 37 characters (12 locked/sealed, 6 campaign-bound incl. 4 Amble player characters, 1 archived): one 0-AP event
-- each, no change to any compute() output (re-verified after applying).

do $$
declare v_n int;
begin
  with target(id) as (values
  ('297e1b2f-17ac-4d31-9392-834ef8ec0864'::uuid),  -- Caspian (old copy)
  ('6ab2a3ca-124c-4892-a4a0-a53128fc8301'::uuid),  -- Bram Cotter Ch8-12
  ('285f6035-0a94-4060-8a6a-16d6edd2a768'::uuid),  -- Caspian lock check (DM copy)
  ('c2c5b10d-8c36-4c06-8d86-301562e548aa'::uuid),  -- Moss Stormspud (COPY)
  ('7556c9d8-9bee-45c8-91ee-3328886c0ad6'::uuid),  -- Bryn Marsh
  ('a8d21e51-b736-68c3-73fc-986475524570'::uuid),  -- Archer (DM copy)
  ('84fac8ff-0f67-423c-9209-9ade981ffd31'::uuid),  -- Sera Valor 2d
  ('d77c9125-87e5-47c0-9e47-c24ac048f329'::uuid),  -- Bram Cotter Ch4 end
  ('bcc28933-9f78-74ab-55fc-569b1bfbc994'::uuid),  -- Skylar (DM copy)
  ('237a8a3c-b82b-4b27-9a73-14188808e214'::uuid),  -- Moss Stormspud
  ('03e52d00-f469-451d-8160-4c37757d9add'::uuid),  -- Archer lock check (DM copy)
  ('535b7ae4-dae2-4cac-8517-23af06c6f1c9'::uuid),  -- Character
  ('b0dd133f-5ae4-4ec3-87f8-5cc886de3433'::uuid),  -- Archer
  ('f3382240-d7d8-4d39-b464-38682358cd0e'::uuid),  -- Skylar lock check (DM copy)
  ('171db88c-04a1-68f8-478b-6d0e0012fab3'::uuid),  -- Moss Stormspud (DM copy)
  ('6e6c8adb-c181-4df3-a3dd-6c956b3c6545'::uuid),  -- Character
  ('ea1e35e3-1881-335f-afcc-0f6025b1a4e1'::uuid),  -- Caspian (DM copy) test
  ('18901258-d445-4528-baac-b4b6a5e7fe71'::uuid),  -- Kaelen Dawnbreaker
  ('05a32d9d-d217-44cc-99a3-5e5c2ac746ff'::uuid),  -- Skylar
  ('b4165554-cb54-4bcf-9baa-882109e0e333'::uuid),  -- Finnian Highmoor
  ('e94017f6-8792-423b-aa4f-c1716d07ed8b'::uuid),  -- Moss Stormspud lock check (DM copy)
  ('3b8e4ed6-0a7d-4173-b315-7d8e6b2f5896'::uuid),  -- Marius Stormholt
  ('e5ea8c2e-040c-4dc8-aeb1-01d5b2aee65e'::uuid)   -- Caspian
  ), upd as (
    update public.characters c
       set stats = jsonb_set(
             jsonb_set(c.stats, '{LOG}', coalesce(c.stats->'LOG', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'type', 'buy', 'cat', 'patch', 'cost', 0,
               'seq', coalesce((c.stats->>'SEQ')::int, jsonb_array_length(coalesce(c.stats->'LOG','[]'::jsonb)) + 1),
               'ts', (extract(epoch from now()) * 1000)::bigint,
               'rules', 'v0.374', 'systemEdit', true,
               'label', 'Size corrected to Medium (the stored value was a placeholder)',
               'payload', jsonb_build_object('patch', jsonb_build_object('size', 'Medium'))))),
             '{SEQ}', to_jsonb(coalesce((c.stats->>'SEQ')::int, jsonb_array_length(coalesce(c.stats->'LOG','[]'::jsonb)) + 1) + 1))
      from target t
     where c.id = t.id
       and (select e->'payload'->'patch'->>'size' from jsonb_array_elements(c.stats->'LOG') with ordinality x(e, ord)
             where e->'payload'->'patch' ? 'size' order by ord desc limit 1) = 'Small'
    returning c.id)
  select count(*) into v_n from upd;
  if v_n <> 23 then
    raise exception 'stored-size correction: expected 23 rows, would update % — aborting, re-measure', v_n;
  end if;
end $$;

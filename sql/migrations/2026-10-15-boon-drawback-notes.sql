-- PACT — a DM approves (and so locks) a player's description of certain boons and drawbacks.
-- feat/boon-drawback-notes (D-GH-2026-10-15-boon-drawback-notes).
--
-- STATUS: APPLIED 2026-10-19 (pre-check: live md5 of dm_edit_character_log = BASE 659177badc40deb2e69bacbbfcdbb4ca; 0 of 40
-- characters had itemNote/dmApproveNote/dmUnlockNote events). Folded into sql/rls-policies.sql the same day.
-- The tools work before it is applied: players write and edit their descriptions (plain LOG events, no server change
-- needed), and DM Console's Approve/Unlock show "the server has not been updated" instead of a database error.
-- Rollback: 2026-10-15-boon-drawback-notes-rollback.sql. Rehearsed on a throwaway Postgres:
-- testing/scripts/creation-lock-guard-test/run-notes.sh (BEFORE: the attacks succeed; AFTER: every case passes; rollback:
-- dm_edit_character_log byte-identical to the definition it replaced, the added objects gone).
--
-- APPLY ATOMICALLY. No BEGIN/COMMIT here: Supabase's apply_migration already runs a migration in one transaction. A manual
-- apply must be single-transaction: `psql -1 -v ON_ERROR_STOP=1 -f <file>` (run-notes.sh applies it that way).
--
-- BASE OF THE REDEFINED FUNCTION. dm_edit_character_log() below is sql/rls-policies.sql's definition on 2026-10-15 — which
-- is 2026-10-13-dm-ap-discount.sql's (APPLIED 2026-10-13, read back from live then and matched line for line) — plus the
-- [NOTES] hunks and nothing else. 2026-10-12-server-player-award-after-lock.sql (APPLIED 2026-10-13, not yet folded into
-- the baseline) does not touch this function. RE-VERIFY against production immediately before applying (README, 2026-09-02):
--   select md5(pg_get_functiondef('public.dm_edit_character_log(uuid,jsonb)'::regprocedure));
-- must equal the same query on a scratch database built from schema.sql + rls-policies.sql (run-notes.sh prints it as BASE).
-- If it differs, rebuild this redefinition from the LIVE text instead of applying this file.
--
-- RECONCILE WITH feat/campaign-house-rules (2026-10-13-campaign-house-rules-server.sql, NOT APPLIED). That migration also
-- redefines dm_edit_character_log() (adds dmHouseRules, pact_next_seq()) and adds the DM-family forgery guard
-- pact_dm_family()/pact_enforce_dm_family(). WHICHEVER OF THE TWO IS APPLIED SECOND MUST BE REBUILT ON THE OTHER:
--   * dm_edit_character_log(): take the then-live text (the first one applied) and add the second one's hunks — this
--     file's two allow-list types + its [NOTES] validation block, or house-rules' dmHouseRules branch + pact_next_seq().
--   * pact_dm_family(): add 'dmApproveNote' and 'dmUnlockNote' to its list of DM-only types. They are already covered by
--     its "truthy dmEdit" rule (the server stamps dmEdit:true on both), so this is belt and braces, but the list is meant
--     to be complete. pact_enforce_item_note_lock() below stays as it is: it also freezes the PLAYER's itemNote events
--     once approved, which the DM-family guard does not cover (an itemNote is not a DM event).
--   * The rollback of whichever is applied second must restore the FIRST one's definitions, not the 2026-10-13 ones.
--
-- WHAT THIS ADDS / CHANGES
--   1. pact_item_note_state(log, cat, name, campaign) (new, internal): the state of one description, read in log order
--      exactly as js/ui-helpers.js pactNoteStates() reads it — a player 'itemNote' {cat, refVal, text} makes it 'pending'
--      (or 'none' when blank), a DM-stamped 'dmApproveNote' made in that campaign makes the note 'approved' only if its text is exactly the current note's, a
--      DM-stamped 'dmUnlockNote' made in that campaign makes an approved note 'pending' again.
--   2. dm_edit_character_log() accepts 'dmApproveNote' {cat, refVal, text} and 'dmUnlockNote' {cat, refVal, note?}. The
--      character must hold a buy of that boon/drawback; an approval needs a note awaiting approval whose current text is
--      exactly the `text` the DM was shown (else "changed since this page loaded"), and records it; an unlock needs an approved note (its optional note is at most 200 characters). Both are rebuilt from
--      a whitelist and stamped with the campaign (campaignId) plus seq/ts/dmEdit/dmId like every other event.
--   3. pact_enforce_item_note_lock() + trg_pact_item_note_lock (new, BEFORE INSERT OR UPDATE on characters):
--      * nobody but a DM of the character's campaign (writing in that campaign) may add, change, remove or reorder a
--        dmApproveNote/dmUnlockNote event — so they arrive only through dm_edit_character_log;
--      * on a campaign character, nobody but its DM may add, change or remove the itemNote events of a description that
--        is approved in that campaign (the lock); a solo character's notes are never locked (confirmed by the owner 2026-10-17 (AW1));
--      * a new itemNote's text must be a string of 1 to 500 characters after trimming (the tools' cap; trimming is
--        pact_js_trim(), the same whitespace set as JavaScript's trim());
--      * a character INSERTED into, or MOVED into, a campaign by anyone but its DM loses the approvals made in that
--        campaign (dropped from the row, so a claimed pregen's descriptions wait for the DM's approval again);
--      Identity is WHO writes (is_campaign_dm), never a flag in the event. Admin sessions (no JWT) are exempt, like
--      pact_enforce_creation_lock(): a hand repair is not refused.
--   pact_ap_ledger_protected() is NOT changed: a note moves no AP, and the trigger above already freezes what must not move.
--
-- WHAT IT DELIBERATELY LEAVES ALONE: the AP ledger and budget checks (a note has no cost and no amount), the locked-history
-- and creation-lock guards, every grant on dm_edit_character_log (`create or replace` keeps them).
--
-- KNOWN GAPS, STATED PLAINLY.
--   * Joining is closed (#673 re-review 4): an INSERT into, or a move into, campaign X by anyone but X's DM drops every
--     approval stamped with X, so approvals forged on a solo character never survive the join. What remains: a player can
--     still hand-craft approvals on a SOLO character (nothing is frozen there, and nothing counts there either — a solo
--     note is never locked), and approvals stamped with campaign Y ride along into X, where they do not count.
--   * CharGen's New Character starts a different character (no notes, by design). Randomise and the Live-Sheet-file load
--     branch carry the note events verbatim (#673 review D), so they no longer drop them.
--   * #673 review A/B/C: an approval counts only for the exact text it approved (a note rewritten in place while solo is
--     pending again); the DM must send the text they were shown; a claimed pregen's approvals are dropped, not refused.
--
-- BLAST RADIUS. NOT MEASURED — this session cannot reach the database. Before applying, run (read-only):
--   select count(*) from characters c, jsonb_array_elements(case when jsonb_typeof(c.stats->'LOG')='array' then c.stats->'LOG' else '[]'::jsonb end) e
--    where e->>'type' in ('itemNote','dmApproveNote','dmUnlockNote');
-- Expected 0 (the event types are new in this PR). With 0, the trigger cannot refuse any existing save: its checks only
-- fire when those events differ between OLD and NEW, or when a new itemNote is written.
--
-- VERIFY AFTER APPLYING.
--   select has_function_privilege('authenticated', 'public.pact_item_note_state(jsonb,text,text,text)', 'execute');   -- false
--   select has_function_privilege('authenticated', 'public.pact_enforce_item_note_lock()', 'execute');              -- false
--   select has_function_privilege('authenticated', 'public.pact_js_trim(text)', 'execute');                         -- false
--   select tgname from pg_trigger where tgname = 'trg_pact_item_note_lock';                                          -- 1 row
--   select p.prosrc like '%assert_campaign_active%' and p.prosrc like '%has no matching award%'
--          and p.prosrc like '%dmUnlockDrawback%' and p.prosrc like '%dmDiscount%' and p.prosrc like '%dmApproveNote%'
--     from pg_proc p where p.proname = 'dm_edit_character_log';                                                        -- true

-- pact_js_trim: String.prototype.trim() exactly — strips the same whitespace set from both ends (ASCII tab/LF/VT/FF/CR/space,
-- NBSP, U+1680, U+2000–U+200A, U+2028/2029, U+202F, U+205F, U+3000, U+FEFF) and nothing else, so "blank" means the same on
-- the server as in js/ui-helpers.js pactCheckNoteText()/pactNoteStates() (#673 re-review 5). btrim() only strips spaces, and
-- [[:space:]] is locale-dependent (it can include U+0085, which JS keeps).
create or replace function public.pact_js_trim(p text)
 returns text
 language sql
 immutable
 set search_path = public, pg_temp
as $function$
  select regexp_replace(p, '^[' || w || ']+|[' || w || ']+$', '', 'g')
    from (select chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) || chr(160) || chr(5760)
                 || chr(8192) || '-' || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279) as w) s;
$function$;

create or replace function public.pact_item_note_state(p_log jsonb, p_cat text, p_name text, p_campaign text,
                                                       out status text, out note text)
 language plpgsql
 immutable
 set search_path = public, pg_temp
as $function$
declare
  e jsonb;
begin
  status := 'none'; note := '';
  for e in
    select ev from jsonb_array_elements(case when jsonb_typeof(p_log) = 'array' then p_log else '[]'::jsonb end)
                   with ordinality as t(ev, ord)
     where ev->>'type' in ('itemNote', 'dmApproveNote', 'dmUnlockNote') and ev->>'cat' = p_cat and ev->>'refVal' = p_name
     order by ord
  loop
    if e->>'type' = 'itemNote' then
      if jsonb_typeof(e->'text') = 'string' then
        note := e->>'text';
        status := case when public.pact_js_trim(note) = '' then 'none' else 'pending' end;
      end if;
    elsif e->'dmEdit' = 'true'::jsonb and p_campaign is not null and e->>'campaignId' = p_campaign then
      -- only an approval OF THIS TEXT counts (#673 review A): a note rewritten in place after approval stays pending
      if e->>'type' = 'dmApproveNote' and status <> 'none' and jsonb_typeof(e->'text') = 'string' and e->>'text' = note then
        status := 'approved';
      elsif e->>'type' = 'dmUnlockNote' and status = 'approved' then
        status := 'pending';
      end if;
    end if;
  end loop;
end;
$function$;

create or replace function public.dm_edit_character_log(p_character uuid, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign   uuid;
  v_stats      jsonb;
  v_log        jsonb;
  v_seq        integer;
  v_new        jsonb := '[]'::jsonb;
  v_ev         jsonb;
  v_type       text;
  v_cat        text;
  v_ts         bigint := (extract(epoch from now()) * 1000)::bigint;
  -- fix/dm-edit-boon-amount-check (D-GH-2026-08-10-dm-edit-boon-amount-check): cross-validate that
  -- every boon grant's buy/award pair actually moves the same amount, so the "net 0 to spendable AP"
  -- promise this function makes is enforced server-side, not just by DM Console's client always
  -- sending the pair together. FIFO-by-VALUE, not by-name: an award event carries only an amount, no
  -- reference to which buy it pays for (unlike buyoff/dmRemoveBoon, which carry refVal).
  v_boon_costs numeric[] := '{}';
  v_award_amts numeric[] := '{}';
  v_award_used boolean[];
  v_matched    boolean;
  v_i          integer;
  v_j          integer;
  -- feat/dm-unlock-drawback (D-GH-2026-10-04-dm-unlock-drawback): scratch for validating 'dmUnlockDrawback'.
  v_name       text;
  v_target     integer;
  v_note       text;
  v_matches    integer;
  -- feat/dm-ap-discount (D-GH-2026-10-13-dm-ap-discount): scratch for validating 'dmDiscount'.
  v_tcat       text;
  v_amount     numeric;
  v_cost       numeric;
  v_prior      numeric;
  -- feat/boon-drawback-notes (D-GH-2026-10-15-boon-drawback-notes): scratch for validating 'dmApproveNote'/'dmUnlockNote'.
  v_nstatus    text;
  v_ntext      text;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) = 0 then
    raise exception 'p_events must be a non-empty JSON array';
  end if;

  select campaign_id, stats into v_campaign, v_stats from characters where id = p_character for update;
  if not found then
    raise exception 'Character not found';
  end if;
  if v_campaign is null then
    raise exception 'Character is not in a campaign';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can edit this character';
  end if;
  perform assert_campaign_active(v_campaign);
  if v_stats is null or not (v_stats ? 'LOG') then
    raise exception 'Character has no log to edit';
  end if;

  v_log := coalesce(v_stats->'LOG', '[]'::jsonb);
  v_seq := coalesce((v_stats->>'SEQ')::integer, jsonb_array_length(v_log) + 1);

  for v_ev in select * from jsonb_array_elements(p_events) loop
    v_type := v_ev->>'type';
    v_cat  := v_ev->>'cat';
    if v_type = 'buy' then
      if v_cat is distinct from 'boon' and v_cat is distinct from 'drawback' then
        raise exception 'dm_edit_character_log: unsupported buy category %', v_cat;
      end if;
      if v_cat = 'boon' then
        v_boon_costs := v_boon_costs || coalesce((v_ev->>'cost')::numeric, 0);
      end if;
    -- [SEAL] 'sessionSeal' added by 2026-09-01-session-seal.sql so a DM can draw the line
    -- through the same audited, dm-stamped path as every other DM-authored event.
    -- [UNLOCK] 'dmUnlockDrawback' added by 2026-10-04-dm-unlock-drawback.sql: a DM releases a drawback they
    -- imposed LOCKED once the story beat has happened. Validated below, per event.
    -- [DISCOUNT] 'dmDiscount' added by 2026-10-13-dm-ap-discount.sql: a DM takes AP off one earlier priced
    -- purchase. Validated below, per event.
    -- [NOTES] 'dmApproveNote' / 'dmUnlockNote' added by 2026-10-15-boon-drawback-notes.sql: a DM approves (locks) or
    -- re-opens a player's description of a boon/drawback. Validated below, per event.
    elsif v_type not in ('award', 'dmRemoveBoon', 'sessionSeal', 'dmUnlockDrawback', 'dmDiscount', 'dmApproveNote', 'dmUnlockNote') then
      raise exception 'dm_edit_character_log: unsupported event type %', v_type;
    end if;
    if v_type = 'award' then
      v_award_amts := v_award_amts || coalesce((v_ev->>'amount')::numeric, 0);
    end if;

    -- [SEAL] A seal is a marker, not a transaction. Stripping amount/cost keeps it out of
    -- pact_ap_ledger_spend's sums and out of the boon/award matching arrays above.
    if v_type = 'sessionSeal' then
      v_ev := v_ev - 'amount' - 'cost';
    end if;

    -- [UNLOCK] An unlock is a marker, not a transaction, and it must name ONE specific purchase. Keyed by the
    -- imposed purchase's server-stamped seq plus its drawback name — never by name alone, because a character
    -- can hold a player-taken and an imposed purchase of the same name and js/engine.js's buy-off match is
    -- by name (FIFO). The target must already be in the STORED log: an imposition and its unlock cannot be
    -- sent in the same call. Validated against the stored log, not the client, so a DM cannot unlock a
    -- player-taken drawback, an unlocked one, one that does not exist, or the same one twice.
    -- Deliberately NOT checked here: whether the target has since been bought off. That is js/engine.js's
    -- by-name FIFO match; re-implementing it in SQL would duplicate a rules decision in a second place. An
    -- unlock of a bought-off purchase is a harmless no-op the engine ignores, and DM Console only ever offers
    -- purchases the engine reports as open.
    if v_type = 'dmUnlockDrawback' then
      v_name := btrim(coalesce(v_ev->>'refVal', ''));
      v_note := btrim(coalesce(v_ev->>'note', ''));
      if v_name = '' then
        raise exception 'dm_edit_character_log: dmUnlockDrawback needs refVal (the drawback name)';
      end if;
      if coalesce(v_ev->>'targetSeq', '') !~ '^[0-9]{1,9}$' then
        raise exception 'dm_edit_character_log: dmUnlockDrawback needs targetSeq (the integer seq of the imposed purchase)';
      end if;
      v_target := (v_ev->>'targetSeq')::integer;
      if v_note = '' or char_length(v_note) > 200 then
        raise exception 'dm_edit_character_log: dmUnlockDrawback needs a story-beat note of 1 to 200 characters';
      end if;
      -- jsonb equality, not ::boolean casts: a hand-edited log can hold any value in these fields, and a
      -- cast error here would abort the DM's call instead of cleanly refusing it.
      select count(*) into v_matches
        from jsonb_array_elements(v_log) as t(e)
       where e->>'type' = 'buy' and e->>'cat' = 'drawback'
         and e#>>'{payload,v}' = v_name
         and e->>'seq' = v_target::text
         and e->'dmEdit' = 'true'::jsonb
         and e->'dmLocked' = 'true'::jsonb;
      if v_matches <> 1 then
        raise exception 'dm_edit_character_log: no single DM-imposed, locked drawback "%" at seq % to unlock (found %)', v_name, v_target, v_matches;
      end if;
      if exists (select 1 from jsonb_array_elements(v_log || v_new) as t(e)
                  where e->>'type' = 'dmUnlockDrawback' and e->>'refVal' = v_name
                    and e->>'targetSeq' = v_target::text) then
        raise exception 'dm_edit_character_log: drawback "%" at seq % is already unlocked', v_name, v_target;
      end if;
      -- Rebuild from a whitelist instead of stripping fields: nothing else the client sent (cost, amount, disc,
      -- payload, ...) may ride along, so the event cannot move AP or masquerade as another type.
      v_ev := jsonb_build_object('type', 'dmUnlockDrawback', 'refVal', v_name, 'targetSeq', v_target,
                                 'note', v_note,
                                 'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM unlocked — ' || v_name), 120));
    end if;

    -- [DISCOUNT] A discount names ONE earlier purchase by its seq plus its category (`targetCat`: the buy's
    -- `cat`, or 'buyoff' / 'names' for those types) — the same identity js/engine.js's activeEvents() resolves.
    -- The target is looked up in the stored log plus this call's earlier events, so a grant and its discount
    -- can be sent together. It must be the only event with that seq, a priced purchase (not a drawback), and
    -- the purchase's net discount after this one must stay between 0 and its frozen cost: a negative amount is
    -- how a DM corrects a mistake, and nothing is ever deleted. Amounts are whole AP and must be JSON numbers.
    -- Not checked: whether the purchase is still owned — js/engine.js decides that (owner decision I1).
    if v_type = 'dmDiscount' then
      v_tcat := btrim(coalesce(v_ev->>'targetCat', ''));
      v_note := btrim(coalesce(v_ev->>'note', ''));
      if coalesce(v_ev->>'targetSeq', '') !~ '^[0-9]{1,9}$' then
        raise exception 'dm_edit_character_log: dmDiscount needs targetSeq (the integer seq of the purchase)';
      end if;
      v_target := (v_ev->>'targetSeq')::integer;
      if v_tcat = '' then
        raise exception 'dm_edit_character_log: dmDiscount needs targetCat (the purchase''s category)';
      end if;
      if jsonb_typeof(v_ev->'amount') is distinct from 'number' then
        raise exception 'dm_edit_character_log: dmDiscount needs a whole, non-zero amount of AP';
      end if;
      v_amount := (v_ev->>'amount')::numeric;
      if v_amount = 0 or v_amount <> trunc(v_amount) then
        raise exception 'dm_edit_character_log: dmDiscount needs a whole, non-zero amount of AP';
      end if;
      if v_note = '' or char_length(v_note) > 200 then
        raise exception 'dm_edit_character_log: dmDiscount needs a note of 1 to 200 characters';
      end if;
      select count(*),
             max(case when e->>'type' = 'buy' then coalesce(e->>'cat', '') else e->>'type' end),
             max(case when jsonb_typeof(e->'cost') = 'number' then (e->>'cost')::numeric else 0 end)
        into v_matches, v_cat, v_cost
        from jsonb_array_elements(v_log || v_new) as t(e)
       where e->>'seq' = v_target::text and coalesce(e->>'type', '') <> 'dmDiscount';
      if v_matches <> 1 or v_cat is distinct from v_tcat or v_cat = 'drawback'
         or not exists (select 1 from jsonb_array_elements(v_log || v_new) as t(e)
                         where e->>'seq' = v_target::text and e->>'type' in ('buy', 'buyoff', 'names'))
         or coalesce(v_cost, 0) <= 0 then
        raise exception 'dm_edit_character_log: no single priced % purchase at seq % to discount (found %)', v_tcat, v_target, v_matches;
      end if;
      select coalesce(sum((e->>'amount')::numeric), 0) into v_prior
        from jsonb_array_elements(v_log || v_new) as t(e)
       where e->>'type' = 'dmDiscount' and e->>'targetSeq' = v_target::text and jsonb_typeof(e->'amount') = 'number';
      if v_prior + v_amount < 0 or v_prior + v_amount > v_cost then
        raise exception 'dm_edit_character_log: a discount of % would take seq % to % AP off a % AP purchase (allowed 0 to %)',
          v_amount, v_target, v_prior + v_amount, v_cost, v_cost;
      end if;
      -- Rebuild from a whitelist, like the unlock: no cost, payload or other field the client sent rides along.
      v_ev := jsonb_build_object('type', 'dmDiscount', 'targetSeq', v_target, 'targetCat', v_tcat,
                                 'amount', v_amount::integer, 'note', v_note,
                                 'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM discount — ' || v_amount::integer || ' AP'), 120));
    end if;

    -- [NOTES] Approve / unlock a player's description of a boon or drawback, keyed by category + name (a character holds
    -- at most one copy of a name; seq is not stable while CharGen rebuilds a draft). The note's state is read from the
    -- stored log (plus this call's earlier events) by pact_item_note_state(), the same reading the tools and
    -- pact_enforce_item_note_lock() use, counting only approvals made in THIS campaign. An approval needs a note awaiting
    -- approval and records the text it approved; an unlock needs an approved note. Both carry the campaign they were
    -- made in. Rebuilt from a whitelist, like the unlock and the discount.
    if v_type in ('dmApproveNote', 'dmUnlockNote') then
      v_tcat := coalesce(v_ev->>'cat', '');
      v_name := btrim(coalesce(v_ev->>'refVal', ''));
      v_note := btrim(coalesce(v_ev->>'note', ''));
      if v_tcat not in ('boon', 'drawback') or v_name = '' then
        raise exception 'dm_edit_character_log: % needs cat (boon or drawback) and refVal (the item''s name)', v_type;
      end if;
      if not exists (select 1 from jsonb_array_elements(v_log || v_new) as t(e)
                      where e->>'type' = 'buy' and e->>'cat' = v_tcat and e#>>'{payload,v}' = v_name) then
        raise exception 'dm_edit_character_log: this character has no % "%"', v_tcat, v_name;
      end if;
      select s.status, s.note into v_nstatus, v_ntext
        from public.pact_item_note_state(v_log || v_new, v_tcat, v_name, v_campaign::text) as s;
      if v_type = 'dmApproveNote' then
        if v_nstatus is distinct from 'pending' then
          raise exception 'dm_edit_character_log: no description of % "%" awaiting approval (it is %)', v_tcat, v_name, coalesce(v_nstatus, 'none');
        end if;
        -- The DM approves the text they were SHOWN (#673 review B): DM Console sends it, and a note the player changed
        -- since the page loaded is refused rather than approved unseen.
        if jsonb_typeof(v_ev->'text') is distinct from 'string' or v_ev->>'text' is distinct from v_ntext then
          raise exception 'dm_edit_character_log: the description of % "%" changed since this page loaded — reload and read it again', v_tcat, v_name;
        end if;
        v_ev := jsonb_build_object('type', 'dmApproveNote', 'cat', v_tcat, 'refVal', v_name, 'text', v_ntext,
                                   'campaignId', v_campaign::text,
                                   'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM approved description — ' || v_name), 120));
      else
        if v_nstatus is distinct from 'approved' then
          raise exception 'dm_edit_character_log: the description of % "%" is not approved (it is %)', v_tcat, v_name, coalesce(v_nstatus, 'none');
        end if;
        if char_length(v_note) > 200 then
          raise exception 'dm_edit_character_log: dmUnlockNote''s note must be 200 characters or fewer';
        end if;
        v_ev := jsonb_build_object('type', 'dmUnlockNote', 'cat', v_tcat, 'refVal', v_name, 'campaignId', v_campaign::text,
                                   'label', left(coalesce(nullif(btrim(v_ev->>'label'), ''), 'DM unlocked description — ' || v_name), 120))
                || case when v_note = '' then '{}'::jsonb else jsonb_build_object('note', v_note) end;
      end if;
    end if;

    v_ev := (v_ev - 'seq' - 'ts' - 'dmEdit' - 'dmId')
      || jsonb_build_object('seq', v_seq, 'ts', v_ts, 'dmEdit', true, 'dmId', auth.uid());
    v_new := v_new || jsonb_build_array(v_ev);
    v_seq := v_seq + 1;
  end loop;

  -- Every boon-grant buy must be matched, FIFO-by-value, to a same-call award of the identical amount —
  -- checked AFTER the loop above (once both arrays are fully collected) but BEFORE the write below, so a
  -- rejected batch never partially applies. A standalone award with no matching boon-buy is left alone
  -- on purpose — award_ap() already lets any campaign DM grant arbitrary AP through its own, unrestricted
  -- path, so a bare award here is a second route to a capability the DM already unconditionally has, not
  -- a new privilege; only a genuinely MISMATCHED pair (a boon-buy this batch never actually paid for) is
  -- the correctness gap this closes.
  v_award_used := array_fill(false, array[coalesce(array_length(v_award_amts, 1), 0)]);
  for v_i in 1 .. coalesce(array_length(v_boon_costs, 1), 0) loop
    v_matched := false;
    for v_j in 1 .. coalesce(array_length(v_award_amts, 1), 0) loop
      if not v_award_used[v_j] and v_award_amts[v_j] = v_boon_costs[v_i] then
        v_award_used[v_j] := true;
        v_matched := true;
        exit;
      end if;
    end loop;
    if not v_matched then
      raise exception 'dm_edit_character_log: boon grant at cost % has no matching award of the identical amount in the same call', v_boon_costs[v_i];
    end if;
  end loop;

  v_log := v_log || v_new;
  v_stats := jsonb_set(jsonb_set(v_stats, '{LOG}', v_log), '{SEQ}', to_jsonb(v_seq));

  update characters set stats = v_stats where id = p_character;
  return v_new;
end;
$$;


-- pact_enforce_item_note_lock: see the header, item 3.
create or replace function public.pact_enforce_item_note_lock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_log jsonb := '[]'::jsonb;
  v_new_log jsonb;
  v_old_fam jsonb;
  v_new_fam jsonb;
  v_dm      boolean := false;
  k         record;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return NEW; end if;   -- admin session
  if TG_OP = 'UPDATE' then
    if NEW.stats is not distinct from OLD.stats and NEW.campaign_id is not distinct from OLD.campaign_id then return NEW; end if;
    v_old_log := case when jsonb_typeof(OLD.stats->'LOG') = 'array' then OLD.stats->'LOG' else '[]'::jsonb end;
  end if;
  v_new_log := case when jsonb_typeof(NEW.stats->'LOG') = 'array' then NEW.stats->'LOG' else '[]'::jsonb end;

  -- A NEW description (one not already stored, compared whole) must be 1 to 500 characters after trimming.
  if exists (select 1 from jsonb_array_elements(v_new_log) as t(e)
              where e->>'type' = 'itemNote'
                and (coalesce(jsonb_typeof(e->'text'), '') <> 'string' or char_length(public.pact_js_trim(e->>'text')) not between 1 and 500)
                and not exists (select 1 from jsonb_array_elements(v_old_log) as o(x) where x = e)) then
    raise exception 'PACT: a boon or drawback description must be 1 to 500 characters'
      using hint = 'Shorten the description and save again.';
  end if;

  -- INSERT into a campaign by anyone but its DM: approvals made in that campaign are DROPPED from the new row, not
  -- refused (#673 review C). The honest case is redeem_character_claim() copying a DM's pregen whose descriptions that
  -- DM approved; refusing broke it. Dropping is the safer of the two fixes: no approval stamped with THIS campaign
  -- survives a player's insert into it (a hand-crafted one is removed the same way), the copy's notes simply wait for the
  -- DM's approval again, and redeem_character_claim() is not redefined. Approvals stamped with another campaign are kept
  -- but never count here; a SOLO insert is not filtered (nothing counts on a solo character), and the move-into-a-campaign
  -- branch below drops them on the way in.
  if TG_OP = 'INSERT' then
    if NEW.campaign_id is not null and not public.is_campaign_dm(NEW.campaign_id)
       and exists (select 1 from jsonb_array_elements(v_new_log) as t(e)
                    where e->>'type' in ('dmApproveNote', 'dmUnlockNote') and e->>'campaignId' = NEW.campaign_id::text) then
      NEW.stats := jsonb_set(NEW.stats, '{LOG}',
        (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(v_new_log) with ordinality as t(e, ord)
          where not (e->>'type' in ('dmApproveNote', 'dmUnlockNote') and e->>'campaignId' = NEW.campaign_id::text)));
    end if;
    return NEW;
  end if;

  -- Moving INTO a campaign (campaign_id changes to X) when the writer is not X's DM — bind_character_to_campaign(), a
  -- campaign move — drops the approvals stamped with X, exactly as an INSERT does (#673 re-review 4). That closes the
  -- "forge approvals on a solo character, then join" path: whatever arrives, no approval made "in X" survives the join, so
  -- every approval that counts in a campaign was written there by its DM through dm_edit_character_log. The comparison
  -- below then treats the dropped events as never having been there; any OTHER change to approvals is still refused.
  if NEW.campaign_id is not null and NEW.campaign_id is distinct from OLD.campaign_id
     and not public.is_campaign_dm(NEW.campaign_id)
     and exists (select 1 from jsonb_array_elements(v_new_log) as t(e)
                  where e->>'type' in ('dmApproveNote', 'dmUnlockNote') and e->>'campaignId' = NEW.campaign_id::text) then
    v_new_log := (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(v_new_log) with ordinality as t(e, ord)
                   where not (e->>'type' in ('dmApproveNote', 'dmUnlockNote') and e->>'campaignId' = NEW.campaign_id::text));
    NEW.stats := jsonb_set(NEW.stats, '{LOG}', v_new_log);
    v_old_log := (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(v_old_log) with ordinality as t(e, ord)
                   where not (e->>'type' in ('dmApproveNote', 'dmUnlockNote') and e->>'campaignId' = NEW.campaign_id::text));
  end if;

  v_dm := OLD.campaign_id is not null and NEW.campaign_id is not distinct from OLD.campaign_id
          and public.is_campaign_dm(OLD.campaign_id);

  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into v_old_fam
    from jsonb_array_elements(v_old_log) with ordinality as t(e, ord) where e->>'type' in ('dmApproveNote', 'dmUnlockNote');
  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into v_new_fam
    from jsonb_array_elements(v_new_log) with ordinality as t(e, ord) where e->>'type' in ('dmApproveNote', 'dmUnlockNote');
  if v_new_fam is distinct from v_old_fam and not v_dm then
    raise exception 'PACT: only the campaign''s DM can approve or unlock a boon or drawback description';
  end if;

  if OLD.campaign_id is null or v_dm then return NEW; end if;

  -- The lock: every description approved in this campaign keeps exactly its stored itemNote events.
  for k in
    select distinct e->>'cat' as c, e->>'refVal' as n
      from jsonb_array_elements(v_old_log) as t(e)
     where e->>'type' = 'dmApproveNote' and e->>'campaignId' = OLD.campaign_id::text
  loop
    if (select s.status from public.pact_item_note_state(v_old_log, k.c, k.n, OLD.campaign_id::text) as s) = 'approved'
       and (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(v_old_log) with ordinality as t(e, ord)
             where e->>'type' = 'itemNote' and e->>'cat' = k.c and e->>'refVal' = k.n)
           is distinct from
           (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) from jsonb_array_elements(v_new_log) with ordinality as t(e, ord)
             where e->>'type' = 'itemNote' and e->>'cat' = k.c and e->>'refVal' = k.n) then
      raise exception 'PACT: your DM approved the description of % — it can''t be changed until they unlock it', k.n
        using hint = 'Ask your DM to unlock it in DM Console, or reload the character if it was approved after you opened it.';
    end if;
  end loop;
  return NEW;
end;
$$;

drop trigger if exists trg_pact_item_note_lock on public.characters;
create trigger trg_pact_item_note_lock
  before insert or update on public.characters
  for each row execute function public.pact_enforce_item_note_lock();

revoke execute on function public.pact_item_note_state(jsonb, text, text, text) from public, anon, authenticated;
revoke execute on function public.pact_js_trim(text)                            from public, anon, authenticated;
revoke execute on function public.pact_enforce_item_note_lock()                 from public, anon, authenticated;

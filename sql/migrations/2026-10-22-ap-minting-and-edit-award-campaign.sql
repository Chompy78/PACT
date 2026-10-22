-- PACT — fix/ap-minting-and-edit-award-campaign (D-GH-2026-10-22-ap-minting-and-edit-award-campaign).
-- NOT applied to the live database by merging this file; the owner applies it after review.
--
-- TWO server holes, both in the AP ledger's campaign scoping.
--
-- HOLE 1 — AP (and gold) carried between campaigns.
--   Any signed-in user can create a campaign (becoming its DM), bind one of their own characters into it with
--   dm_bind_npc(), award it any amount with award_ap(), take it out again with dm_unbind_character() (the NPC trigger
--   clears is_npc only; characters.ap is untouched) and join a VICTIM campaign with bind_character_to_campaign(), which
--   only sets campaign_id and adds that campaign's starting AP. characters.ap survived every move, and
--   pact_enforce_ap_budget_consistency counts NEW.ap as spendable, so the minted AP bought real things.
--   characters.gold has the same shape (award_gold() adds to it; nothing resets it on a move).
--   FIX: a BEFORE UPDATE trigger. When campaign_id changes to a DIFFERENT, NON-NULL campaign, ap is reset to the sum of
--   ap_awards.amount for THAT campaign and THAT character (0 when none), and gold to the sum of gold_awards.gold likewise.
--     * bind_character_to_campaign adds the starting AP AFTER its update, and only when no ap_awards row exists for the
--       character in that campaign. First join: trigger sets 0, function then adds starting AP + writes the award row.
--       Rejoin: trigger restores the award sum (which already includes the starting AP), function skips the grant.
--       Neither double counts.
--     * Unbinding to solo (campaign_id -> null) is deliberately NOT touched: the AP is the player's from that campaign
--       and goes with them; it is reset the moment they enter ANY campaign, which is the only place it can be spent
--       against a DM. (A solo character has no DM and no server-side budget check.)
--     * Admin / SQL-editor sessions (no request.jwt.claims) are left alone, exactly like the other character triggers.
--   Fires as trg_pact_aa_*: Postgres runs BEFORE triggers alphabetically, and this must run before
--   trg_pact_ap_budget_consistency (which reads NEW.ap).
--
-- HOLE 2 — edit_ap_award authorised on the AWARD's campaign but never checked the character was still in it, so a former
--   DM could change the AP of a character that had moved to another campaign (and, with Hole 1 closed, that edit would
--   also corrupt the "ap equals this campaign's award sum" invariant). It now requires characters.campaign_id = the
--   award's campaign_id, and locks the award row and the character row (select ... for update) to close the
--   read-modify-write race. Signature, grants and the legitimate path are unchanged; every other line is the live
--   definition (read from pg_proc on 2026-10-22).
--
-- BLAST RADIUS (live Supabase, read-only, 2026-10-22): 40 characters, 5 campaigns, 111 ap_awards (none with a null
-- campaign), 0 gold_awards.
--   * 10 campaign-bound characters: ap equals the sum of ap_awards for their current campaign on all 10 (and on the
--     total of all their awards), so the reset changes none of them. Rejoin arithmetic is therefore exact.
--   * Nothing on a move would change today. 5 SOLO characters hold ap > 0 (138, 82, 82, 70, 36): for 4 of them it equals
--     awards from a former campaign (they get it back on rejoining THAT campaign), for 1 (ap 70) there is no ap_awards
--     row at all. Those 5 are untouched now; they would start from the new campaign's award sum if they joined a
--     DIFFERENT campaign. Owner call, see the decision record.
--   * gold: 0 characters with gold <> 0, 0 solo, gold_awards empty.
-- Not covered here (noted in the decision record): redeem_character_claim() INSERTs a copy with the source's ap.
--
-- Rollback: 2026-10-22-ap-minting-and-edit-award-campaign-rollback.sql.

create or replace function public.pact_reset_campaign_grants_on_move()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if NEW.campaign_id is null or NEW.campaign_id is not distinct from OLD.campaign_id then
    return NEW;
  end if;
  if coalesce(current_setting('request.jwt.claims', true), '') = '' then return NEW; end if;  -- admin session

  NEW.ap := coalesce((select sum(a.amount) from public.ap_awards a
                       where a.character_id = NEW.id and a.campaign_id = NEW.campaign_id), 0);
  NEW.gold := coalesce((select sum(g.gold) from public.gold_awards g
                         where g.character_id = NEW.id and g.campaign_id = NEW.campaign_id), 0);
  return NEW;
end;
$$;

drop trigger if exists trg_pact_aa_reset_grants_on_campaign_move on public.characters;
create trigger trg_pact_aa_reset_grants_on_campaign_move
  before update on public.characters
  for each row
  when (NEW.campaign_id is not null and NEW.campaign_id is distinct from OLD.campaign_id)
  execute function public.pact_reset_campaign_grants_on_move();

revoke execute on function public.pact_reset_campaign_grants_on_move() from public, anon, authenticated;

comment on function public.pact_reset_campaign_grants_on_move() is
  'On a move into a different non-null campaign, resets characters.ap / gold to that campaign''s ap_awards / gold_awards sums for the character, so granted AP and gold cannot be carried between campaigns. D-GH-2026-10-22-ap-minting-and-edit-award-campaign.';

-- ---------------------------------------------------------------------------
create or replace function public.edit_ap_award(
  p_award_id       uuid,
  p_new_amount     integer,
  p_new_note       text,
  p_new_created_at timestamptz,
  p_edit_note      text
)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_character      uuid;
  v_campaign       uuid;
  v_char_campaign  uuid;
  v_old_amount     integer;
  v_old_note       text;
  v_old_created_at timestamptz;
  v_delta          integer;
  v_ap             integer;
begin
  if p_edit_note is null or btrim(p_edit_note) = '' then
    raise exception 'An edit note is required';
  end if;

  -- for update: two concurrent edits of one award serialise, so each computes its delta from the amount the other left.
  select character_id, campaign_id, amount, note, created_at
    into v_character, v_campaign, v_old_amount, v_old_note, v_old_created_at
    from ap_awards where id = p_award_id for update;

  if v_character is null then
    raise exception 'Award not found';
  end if;
  if v_campaign is null then
    raise exception 'Award has no campaign context';
  end if;
  if not is_campaign_dm(v_campaign) then
    raise exception 'Only a campaign DM can edit an AP award';
  end if;
  perform assert_campaign_active(v_campaign);

  -- The award belongs to a campaign; the AP it paid out only counts while the character is still IN that campaign.
  select campaign_id into v_char_campaign from characters where id = v_character for update;
  if v_char_campaign is distinct from v_campaign then
    raise exception 'This character is no longer in the campaign that made this award';
  end if;

  v_delta := p_new_amount - v_old_amount;

  insert into ap_award_edits
    (award_id, character_id, campaign_id, dm_id, old_amount, old_note, new_amount, new_note,
     old_created_at, new_created_at, edit_note)
    values
    (p_award_id, v_character, v_campaign, auth.uid(), v_old_amount, v_old_note, p_new_amount, p_new_note,
     case when p_new_created_at is not null then v_old_created_at else null end,
     p_new_created_at,
     p_edit_note);

  update ap_awards
    set amount = p_new_amount,
        note = p_new_note,
        created_at = coalesce(p_new_created_at, created_at)
    where id = p_award_id;

  update characters set ap = ap + v_delta
    where id = v_character
    returning ap into v_ap;

  return v_ap;
end;
$$;

-- Grants, restated (create or replace keeps them; this makes the file self-describing and is idempotent).
revoke all on function public.edit_ap_award(uuid, integer, text, timestamptz, text) from public, anon;
grant execute on function public.edit_ap_award(uuid, integer, text, timestamptz, text) to authenticated;

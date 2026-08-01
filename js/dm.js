// PACT — DM-side operations: read the campaign roster and award AP.
//
// Awarding AP goes through the award_ap() RPC, the ONLY write path to
// characters.ap (players have no column grant on it). The RPC itself checks the
// caller is the campaign's DM, so this is safe even if called directly.
//
// Removing a character from a campaign goes through the dm_unbind_character()
// RPC (same reason as award_ap: characters_update's row policy is owner-only,
// so a DM can't clear campaign_id on a player's row via a plain client update).
//
// character_dm_notes is a separate, DM-only table (never the character's own
// owner — see sql/migrations/2026-08-01-dm-remove-character-notes.sql) holding
// a DM-set player-name label and freeform notes per character. It's a plain
// table with its own RLS policy, so reads/writes go through normal
// select/upsert calls — no RPC needed for it.

import { supabase } from './supabase-client.js';

/**
 * Roster for a campaign: every character in it with its player's display name,
 * current AP, DM-only label/notes, and raw stats (LOG/SEQ/rules — the same
 * shape a locally-imported character file has, so callers can run it through
 * the shared engine/dmAnalyze() exactly like an import). The DM can read this
 * via RLS; players cannot read others'.
 * @returns {Promise<Array<{id,name,kind,ap,stats,updated_at,owner_id,player,playerLabel,dmNotes}>>}
 */
export async function getRoster(campaignId) {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, kind, ap, stats, updated_at, owner_id, owner:profiles(display_name), dm_notes:character_dm_notes(player_label, notes)')
    .eq('campaign_id', campaignId)
    .order('name');
  if (error) throw error;
  return data.map(c => {
    // character_dm_notes is 1:1 (character_id is its primary key), but PostgREST's
    // embed can still come back as a one-element array depending on FK detection —
    // normalize either shape rather than assume one.
    const notesRow = Array.isArray(c.dm_notes) ? c.dm_notes[0] : c.dm_notes;
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      ap: c.ap,
      stats: c.stats,
      updated_at: c.updated_at,
      owner_id: c.owner_id,
      player: c.owner?.display_name || '',
      playerLabel: notesRow?.player_label || '',
      dmNotes: notesRow?.notes || '',
    };
  });
}

/**
 * DM-only: remove a character from its campaign (soft "kick" — the character
 * and its data/AP survive untouched, it just stops being any campaign's roster
 * member). Throws if the caller is not a DM of the character's current campaign.
 */
export async function unbindCharacter(characterId) {
  const { error } = await supabase.rpc('dm_unbind_character', { p_character: characterId });
  if (error) throw error;
}

/**
 * DM-only: set the player-name label and/or freeform notes for a character.
 * Upserts the character_dm_notes row; pass only the fields you want to change
 * (omitted fields are written as null, matching a full replace — callers should
 * read the current values first if they want a partial update to read like one).
 */
export async function setCharacterDmNotes(characterId, { playerLabel, notes } = {}) {
  const { error } = await supabase
    .from('character_dm_notes')
    .upsert({ character_id: characterId, player_label: playerLabel ?? null, notes: notes ?? null });
  if (error) throw error;
}

/**
 * DM-only: add (or, with a negative amount, deduct) AP for a character, with an
 * optional note. Returns the new AP total. Throws if the caller is not a DM of
 * the character's campaign. The award is recorded in the ap_awards ledger.
 */
export async function awardAp(characterId, amount, note) {
  const { data, error } = await supabase.rpc('award_ap', {
    p_character: characterId,
    p_amount: amount,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data;
}

/**
 * The AP award history for a character (newest first), each row attributed to
 * the DM who gave it. Readable by the character's owner and any campaign DM.
 * @returns {Promise<Array<{id,amount,note,created_at,dm_id,dm}>>}
 */
export async function getAwardHistory(characterId) {
  const { data, error } = await supabase
    .from('ap_awards')
    .select('id, amount, note, created_at, dm_id, dm:profiles!ap_awards_dm_id_fkey(display_name)')
    .eq('character_id', characterId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(a => ({
    id: a.id, amount: a.amount, note: a.note, created_at: a.created_at,
    dm_id: a.dm_id, dm: a.dm?.display_name || '',
  }));
}

/**
 * Read-only full character data for the DM to inspect: the raw stats blob the
 * engine can hydrate + recompute from. (compute() is not called here — the
 * caller passes stats to the engine.)
 */
export async function getCharacterStats(characterId) {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, kind, stats, ap')
    .eq('id', characterId)
    .single();
  if (error) throw error;
  return data;
}

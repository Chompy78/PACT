// PACT — DM-side operations: read the campaign roster and award AP.
//
// Awarding AP goes through the award_ap() RPC, the ONLY write path to
// characters.ap (players have no column grant on it). The RPC itself checks the
// caller is the campaign's DM, so this is safe even if called directly.

import { supabase } from './supabase-client.js';

/**
 * Roster for a campaign: every character in it with its player's display name
 * and current AP. The DM can read this via RLS; players cannot read others'.
 * @returns {Promise<Array<{id,name,kind,ap,updated_at,owner_id,player}>>}
 */
export async function getRoster(campaignId) {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, kind, ap, updated_at, owner_id, owner:profiles(display_name)')
    .eq('campaign_id', campaignId)
    .order('name');
  if (error) throw error;
  return data.map(c => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    ap: c.ap,
    updated_at: c.updated_at,
    owner_id: c.owner_id,
    player: c.owner?.display_name || '',
  }));
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

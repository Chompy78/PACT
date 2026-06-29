// PACT — DM-side operations: read the campaign roster and award XP.
//
// Awarding XP goes through the award_xp() RPC, the ONLY write path to
// characters.xp (players have no column grant on it). The RPC itself checks the
// caller is the campaign's DM, so this is safe even if called directly.

import { supabase } from './supabase-client.js';

/**
 * Roster for a campaign: every character in it with its player's display name
 * and current XP. The DM can read this via RLS; players cannot read others'.
 * @returns {Promise<Array<{id,name,kind,xp,updated_at,owner_id,player}>>}
 */
export async function getRoster(campaignId) {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, kind, xp, updated_at, owner_id, owner:profiles(display_name)')
    .eq('campaign_id', campaignId)
    .order('name');
  if (error) throw error;
  return data.map(c => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    xp: c.xp,
    updated_at: c.updated_at,
    owner_id: c.owner_id,
    player: c.owner?.display_name || '',
  }));
}

/**
 * DM-only: add (or, with a negative amount, deduct) XP for a character.
 * Returns the new XP total. Throws if the caller is not the campaign's DM.
 */
export async function awardXp(characterId, amount) {
  const { data, error } = await supabase.rpc('award_xp', {
    p_character: characterId,
    p_amount: amount,
  });
  if (error) throw error;
  return data;
}

/**
 * Read-only full character data for the DM to inspect: the raw stats blob the
 * engine can hydrate + recompute from. (compute() is not called here — the
 * caller passes stats to the engine.)
 */
export async function getCharacterStats(characterId) {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, kind, stats, xp')
    .eq('id', characterId)
    .single();
  if (error) throw error;
  return data;
}

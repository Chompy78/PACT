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
    .select('id, name, kind, ap, gold, downtime_days, stats, updated_at, owner_id, owner:profiles(display_name), dm_notes:character_dm_notes(player_label, notes, custom_fields)')
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
      // feat/dm-custom-character-fields (D-GH-2026-08-10): raw values for the campaign's
      // custom field slots (num1/num2/text1/text2), keyed exactly as stored — the DM
      // already has full table access, so no visibility filtering happens here (that
      // filtering only exists for a player-facing read, via get_character_visible_fields()).
      customFields: notesRow?.custom_fields || {},
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
 * feat/dm-custom-character-fields (D-GH-2026-08-10): DM-only, set this character's
 * values for the campaign's custom field slots. `values` is a plain object keyed by
 * slot id (e.g. {num1: '12', text1: 'Owes the guild a favour'}) — pass only the slots
 * you want to change; a full merge with any existing row must be done by the caller
 * first (this upserts `values` as-is into the custom_fields column, replacing it
 * whole, same partial-update caveat as setCharacterDmNotes above). Field-name display
 * and the per-field "visible to players" flag live in the campaign's rules
 * (js/campaign.js's setCampaignRules), not here — this only stores raw values.
 */
export async function setCharacterCustomFields(characterId, values) {
  const { error } = await supabase
    .from('character_dm_notes')
    .upsert({ character_id: characterId, custom_fields: values || {} });
  if (error) throw error;
}

/**
 * feat/custom-fields-player-display (D-GH-2026-08-10-dm-custom-character-fields follow-up): the
 * player-facing read counterpart to setCharacterCustomFields() above, via the
 * get_character_visible_fields() SECURITY DEFINER RPC (sql/rls-policies.sql). Server-filtered, not
 * client-filtered: for the character's own owner it returns only the slots the campaign currently
 * marks visible:true in campaigns.rules.customFields — a hidden field's value never leaves the server
 * for that caller. A campaign DM instead gets every defined value unfiltered (they already have raw
 * table access via character_dm_notes' own RLS, same as setCharacterCustomFields above). Returns {}
 * for a not-campaign-bound character, or a caller who is neither the owner nor a campaign DM.
 * @returns {Promise<Object<string,string>>} e.g. {num1: '12', text1: 'Owes the guild a favour'}
 */
export async function getVisibleCustomFields(characterId) {
  const { data, error } = await supabase.rpc('get_character_visible_fields', { p_character: characterId });
  if (error) throw error;
  return data || {};
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
 * DM-only: grant (or, with negative amounts, deduct) gold and downtime for a character,
 * with an optional note. Returns the updated character row, carrying BOTH new totals.
 * Throws if the caller is not a DM of the character's campaign, or if the character is
 * not in a campaign at all.
 *
 * The gold-and-downtime twin of awardAp() above, and one call for both currencies because
 * they share one wealth_awards ledger row — a table ruling that hands over coin AND a
 * season of training is a single event, not two. Pass 0 for either to grant only the other.
 *
 * This is the whole of the owner's requirement that "in a campaign world, the DM is the one
 * who applies the money": a player has no grant on these columns, so there is no client-side
 * path to them other than this RPC, and it authorizes on is_campaign_dm(). A SOLO character
 * never reaches here — its gold and downtime live as `wealth` events in its own LOG, which
 * is the player-side pool the engine's wealthLedger() reads.
 *
 * @param {string} characterId
 * @param {number} gold          gp to add (negative deducts)
 * @param {number} downtimeDays  downtime in DAYS to add (negative deducts)
 * @param {string} [note]
 */
export async function awardWealth(characterId, gold, downtimeDays, note) {
  const { data, error } = await supabase.rpc('award_wealth', {
    p_character: characterId,
    p_gold: Math.round(Number(gold) || 0),
    p_downtime_days: Math.round(Number(downtimeDays) || 0),
    p_note: note ?? null,
  });
  if (error) throw error;
  // `returns characters` comes back as a single row object, not an array — unlike award_ap's
  // scalar integer. Normalized here so callers never have to know which shape the RPC used.
  return Array.isArray(data) ? data[0] : data;
}

/**
 * The gold/downtime award history for a character (newest first), each row attributed to the
 * DM who gave it. Readable by the character's owner and any campaign DM — the wealth_awards
 * RLS policy is the same one ap_awards uses.
 * @returns {Promise<Array<{id,gold,downtime_days,note,created_at,dm_id,dm}>>}
 */
export async function getWealthHistory(characterId) {
  const { data, error } = await supabase
    .from('wealth_awards')
    .select('id, gold, downtime_days, note, created_at, dm_id, dm:profiles!wealth_awards_dm_id_fkey(display_name)')
    .eq('character_id', characterId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(a => ({
    id: a.id, gold: a.gold, downtime_days: a.downtime_days, note: a.note,
    created_at: a.created_at, dm_id: a.dm_id, dm: a.dm?.display_name || '',
  }));
}

/**
 * feat/dm-edit-events (D-GH-2026-08-10-dm-edit-events): append DM-attributed events to a campaign
 * character's own LOG — grant/remove a boon, impose a drawback. `events` must be a non-empty array;
 * a DM-granted boon needs its matched [buy, award] pair passed together so they land in one atomic
 * write (see the migration's header for why). The server stamps seq/ts/dmEdit/dmId on every event —
 * whatever the caller sets for those fields here is discarded, never trusted. Throws if the caller is
 * not a DM of the character's campaign, or if an event's shape isn't one of the allowlisted
 * boon/drawback types (dm_edit_character_log is deliberately not a general editor).
 * @returns {Promise<object[]>} the events as actually stored (with server-stamped fields)
 */
export async function dmEditCharacterLog(characterId, events) {
  const { data, error } = await supabase.rpc('dm_edit_character_log', {
    p_character: characterId,
    p_events: events,
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
    .select('id, name, kind, stats, ap, gold, downtime_days')
    .eq('id', characterId)
    .single();
  if (error) throw error;
  return data;
}

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
 * @returns {Promise<Array<{id,name,kind,ap,stats,updated_at,owner_id,isNpc,player,playerLabel,dmNotes}>>}
 */
export async function getRoster(campaignId) {
  const { data, error } = await supabase
    .from('characters')
    // owner:basic_mode -- feat/player-basic-mode. Account-level, not per-character, so every row for
    // the same owner carries the same value; the console only needs it to show/toggle the flag
    // wherever a roster already surfaces that player, not to key anything by character.
    // is_npc -- feat/campaign-npcs: the DM's own NPC rows come back in the same roster; DM Console
    // splits them off at load so party-wide actions never see them.
    .select('id, name, kind, ap, gold, stats, updated_at, owner_id, is_npc, owner:profiles(display_name, basic_mode), dm_notes:character_dm_notes(player_label, notes, custom_fields)')
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
      // The gold economy's DM-held pool (Players Guide §16), alongside `ap` and on the same
      // authority. `?? 0` because a row selected before this column existed comes back
      // without it, and the console's arithmetic must not turn undefined into NaN. Downtime
      // carries no per-character column at all — it's a party-wide window, read separately
      // via getDowntimeWindow()/get_downtime_window(), not part of this roster row.
      gold: c.gold ?? 0,
      stats: c.stats,
      updated_at: c.updated_at,
      owner_id: c.owner_id,
      isNpc: !!c.is_npc,
      player: c.owner?.display_name || '',
      basicMode: !!c.owner?.basic_mode,
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
 * DM-only (feat/campaign-npcs): bind one of the caller's OWN unbound, active characters to a campaign
 * they DM, as an NPC. NPCs are exempt from the one-character-per-campaign rule, get no starting AP
 * (award it with awardAp), and are left out of the console's party-wide actions. Remove one with
 * unbindCharacter() — the server clears the NPC flag on unbind. Throws (server-side checks) otherwise.
 */
export async function bindNpc(characterId, campaignId) {
  const { error } = await supabase.rpc('dm_bind_npc', { p_character: characterId, p_campaign: campaignId });
  if (error) throw error;
}

/** Pure: the copy's stats envelope — the source's, deep-copied, with a `name` event appended for the new name, a fresh
 *  id, and SEQ past every existing seq. Nothing else changes. (Exported for the tests.) */
export function npcCopyStats(srcStats, name, id) {
  const stats = JSON.parse(JSON.stringify(srcStats || {}));
  const log = Array.isArray(stats.LOG) ? stats.LOG : [];
  const maxSeq = log.reduce((m, e) => Math.max(m, (e && Number.isInteger(e.seq)) ? e.seq : 0), 0);
  const seq = Math.max(Number.isInteger(stats.SEQ) ? stats.SEQ : 0, maxSeq + 1);
  const ev = { seq, ts: Date.now(), type: 'name', name, label: 'Named: ' + name };
  if (stats.rules != null) ev.rules = stats.rules;
  log.push(ev);
  stats.LOG = log; stats.SEQ = seq + 1; stats.id = id; stats.name = name;
  return stats;
}

/**
 * feat/npc-duplicate-version (owner decision AF3, 2026-10-14): duplicate one of the DM's own NPCs as a new version in the
 * same campaign. The copy is identical apart from its name: the whole stats envelope (every LOG event — build, appearance,
 * awards, seals, DM events) is copied, a `name` event is appended for the new name (the same event a Live Sheet rename
 * writes), and the source's DM-awarded AP and gold are given to the copy through award_ap / award_gold so the server's
 * ledgers record where they came from ("Copied from <name>"). Steps: insert the row (the DM owns it) → dm_bind_npc → award.
 * If the bind fails the copy is left among the DM's own characters, unbound, and the error says so.
 * Returns the new character's id.
 */
export async function duplicateNpc(sourceId, newName, campaignId) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth && auth.user;
  if (!user) throw new Error('Sign in first.');
  const name = String(newName == null ? '' : newName).replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Give the new version a name.');
  if (name.length > 80) throw new Error('That name is too long (80 characters at most).');
  const { data: src, error: selErr } = await supabase.from('characters')
    .select('id, owner_id, name, kind, stats, ap, gold, campaign_id, is_npc').eq('id', sourceId).single();
  if (selErr) throw selErr;
  if (!src || src.owner_id !== user.id || !src.is_npc) throw new Error('Only your own NPCs can be duplicated.');
  if (name.toLowerCase() === String(src.name || '').trim().toLowerCase()) throw new Error('Give the new version a different name.');
  const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : null;
  if (!id) throw new Error('This browser cannot create a character id.');
  const stats = npcCopyStats(src.stats, name, id);
  const { error: insErr } = await supabase.from('characters')
    .insert({ id, owner_id: user.id, name, kind: src.kind || 'livesheet', stats });
  if (insErr) {
    if (insErr.code === '23505') throw new Error('You already have a character named "' + name + '" — pick another name.');
    throw insErr;
  }
  try { await bindNpc(id, campaignId); }
  catch (e) { throw new Error('The copy "' + name + '" was saved to your characters but could not be added to the campaign: ' + (e && e.message || e)); }
  const note = 'Copied from ' + (src.name || 'NPC');
  if (Number(src.ap) || 0) await awardAp(id, Number(src.ap), note);
  if (Number(src.gold) || 0) await awardGold(id, Number(src.gold), note);
  return id;
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
 * feat/player-basic-mode (D-GH-2026-09-05-player-basic-mode, decision A3): restrict `playerId` to
 * one active character, enforced server-side. Callable by any DM sharing a campaign with the player
 * (the RPC itself checks this via shares_campaign() — safe even if called directly). Records the
 * calling DM's id and the current time; see js/auth.js's myProfile() for the player-facing read of
 * that attribution.
 */
export async function setBasicMode(playerId) {
  const { error } = await supabase.rpc('set_basic_mode', { p_player: playerId });
  if (error) throw error;
}

/**
 * The DM-convenience path only — turns basic mode off for `playerId`. Never the only path: the
 * player's own unsetMyBasicMode() (js/auth.js) always works regardless of any DM's standing, which is
 * what actually closes the reversibility gap (see the decision record). This one is for a DM helping
 * a confused player sort out their characters without needing the player to do it themselves.
 */
export async function unsetBasicModeForPlayer(playerId) {
  const { error } = await supabase.rpc('unset_basic_mode', { p_player: playerId });
  if (error) throw error;
}

/**
 * Seal a character's history at this moment (feat/session-seal, D-GH-2026-09-01-session-seal).
 * Everything already in the log becomes immutable; anything may still be appended after it.
 *
 * WHO MAY CALL IT (owner decision I2): a DM of the character's campaign, or — for a character in
 * no campaign at all — its own owner. Decided server-side in seal_character_history(); this is
 * only the transport.
 *
 * The seal is enforced by a BEFORE UPDATE trigger on the characters table, not by the browser, so
 * it holds against every write path including ones this codebase does not have yet. That is the
 * whole point of it: the client-side undo barriers in js/engine.js are advisory, and three cold
 * reviewers independently observed that a stale or offline client's ordinary save could otherwise
 * erase what a seal was meant to freeze.
 *
 * `idem` is optional but STRONGLY recommended for any caller that might retry: pass a key generated
 * once per user action (not per attempt) and a timed-out request replayed twice cannot stack seals.
 *
 * @returns {Promise<object>} the seal event as actually stored, with server-stamped fields.
 */
export async function sealHistory(characterId, note, idem) {
  const { data, error } = await supabase.rpc('seal_character_history', {
    p_character: characterId,
    p_note: note ?? null,
    p_idem: idem ?? null,
  });
  if (error) throw error;
  return data;
}

/**
 * DM-only: award AP and seal the character's history in ONE database transaction.
 *
 * WHY THIS EXISTS RATHER THAN awardAp() FOLLOWED BY sealHistory(). Two separate calls can leave a
 * character AP-awarded but unsealed, or sealed but unawarded, and a DM who retries the half they
 * saw fail duplicates the half that succeeded. Awarding twice is the one outcome here that
 * materially damages a character, so the pair is atomic and idempotent rather than merely ordered.
 *
 * The AP does NOT go into the log. It stays in characters.ap exactly where award_ap() has always
 * put it, because AP already reaches a character by two independent paths that both feed the same
 * spendable total — writing one award to both would double it. The seal is a separate marker
 * carrying no value at all, which is precisely what lets it be one.
 *
 * @param {string} idem key generated once per user action; a retry with the same key is a no-op.
 * @returns {Promise<{ap:number, seal:object, repeated:boolean}>} `repeated` marks a replayed retry.
 */
export async function awardApAndSeal(characterId, amount, note, idem) {
  const { data, error } = await supabase.rpc('award_ap_and_seal', {
    p_character: characterId,
    p_amount: amount,
    p_note: note ?? null,
    p_idem: idem ?? null,
  });
  if (error) throw error;
  return data;
}

/**
 * DM-only: grant (or, with a negative amount, deduct) gold for a character, with an optional
 * note. Returns the updated character row. Throws if the caller is not a DM of the
 * character's campaign, or if the character is not in a campaign at all.
 *
 * The gold twin of awardAp() above. Renamed from awardWealth() the same day it was first
 * built, once downtime turned out not to share gold's shape at all — gold banks per
 * character and accumulates; downtime is a single party-wide window that REPLACES the last
 * one (see declareDowntime() below, which now owns that entirely).
 *
 * This is the whole of the owner's requirement that "in a campaign world, the DM is the one
 * who applies the money": a player has no grant on characters.gold, so there is no
 * client-side path to it other than this RPC, and it authorizes on is_campaign_dm(). A SOLO
 * character never reaches here — its gold lives as `wealth` events in its own LOG, which is
 * the player-side pool the engine's wealthLedger() reads.
 *
 * @param {string} characterId
 * @param {number} gold  gp to add (negative deducts)
 * @param {string} [note]
 */
export async function awardGold(characterId, gold, note) {
  const { data, error } = await supabase.rpc('award_gold', {
    p_character: characterId,
    p_gold: Math.round(Number(gold) || 0),
    p_note: note ?? null,
  });
  if (error) throw error;
  // `returns characters` comes back as a single row object, not an array — unlike award_ap's
  // scalar integer. Normalized here so callers never have to know which shape the RPC used.
  return Array.isArray(data) ? data[0] : data;
}

/**
 * The gold award history for a character (newest first), each row attributed to the DM who
 * gave it. Readable by the character's owner and any campaign DM — the gold_awards RLS
 * policy is the same one ap_awards uses.
 * @returns {Promise<Array<{id,gold,note,created_at,dm_id,dm}>>}
 */
export async function getGoldHistory(characterId) {
  const { data, error } = await supabase
    .from('gold_awards')
    .select('id, gold, note, created_at, dm_id, dm:profiles!gold_awards_dm_id_fkey(display_name)')
    .eq('character_id', characterId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(a => ({
    id: a.id, gold: a.gold, note: a.note,
    created_at: a.created_at, dm_id: a.dm_id, dm: a.dm?.display_name || '',
  }));
}

/**
 * DM-only: declare a downtime window (Players Guide §16). A PARTY-WIDE action by default —
 * pass no characterId and it REPLACES whatever window was declared before, for every
 * character in the campaign at once ("the time should not keep adding up... spend it now or
 * wait till another opportunity" — owner). Pass a characterId to grant that ONE character a
 * bonus on top of whichever base is currently live — a magic item, a personal reward — which
 * is wiped along with the base the moment a new base is declared (a bonus is "extra time in
 * THIS window", not a persistent pool of its own).
 *
 * Deliberately an INSERT-only ledger (declare_downtime() never updates a row): declaring
 * again needs no reset logic of its own, and the full history stays visible for the story
 * record. See getDowntimeWindow() for reading the composed result back.
 *
 * @param {string} campaignId
 * @param {number} days           the window's size, in DAYS (7 = a week, 30 = a month, …)
 * @param {string} [characterId]  omit for the party base; set for a per-character bonus
 * @param {string} [note]
 */
export async function declareDowntime(campaignId, days, characterId, note) {
  const { data, error } = await supabase.rpc('declare_downtime', {
    p_campaign: campaignId,
    p_days: Math.round(Number(days) || 0),
    p_character: characterId ?? null,
    p_note: note ?? null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/**
 * The downtime window in force RIGHT NOW for one character: the party's latest base
 * declaration plus any bonus declared for them since, already composed server-side by
 * get_downtime_window() (one query, so this client never re-derives that composition
 * itself — the same "one source, not two copies" reasoning as everywhere else this app
 * shares logic between the DM Console and the Live Sheet).
 *
 * Pass no characterId to read just the party base (no bonus composed in) — useful for the DM
 * Console's own "what's the current window" display, which isn't about any one character.
 *
 * @param {string} campaignId
 * @param {string} [characterId]
 * @returns {Promise<{days:number, declaredAt:string}|null>} null if no window has ever been declared
 */
export async function getDowntimeWindow(campaignId, characterId) {
  const { data, error } = await supabase.rpc('get_downtime_window', {
    p_campaign: campaignId,
    p_character: characterId ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { days: row.days, declaredAt: row.declared_at };
}

/**
 * The full downtime declaration history for a campaign (newest first) — every party-base and
 * per-character bonus declaration ever made, each attributed to the DM who declared it.
 * declareDowntime() is deliberately insert-only (see its own header), so this is a plain read
 * of campaign_downtime_declarations — no separate audit table needed. Readable by any campaign
 * member (player or DM), same as campaign_downtime_declarations_select's RLS.
 *
 * @param {string} campaignId
 * @returns {Promise<Array<{id,characterId,days,note,createdAt,declaredBy,dm}>>} characterId is
 *   null for a party-base row, set for a per-character bonus row.
 */
export async function getDowntimeHistory(campaignId) {
  const { data, error } = await supabase
    .from('campaign_downtime_declarations')
    .select('id, character_id, days, note, created_at, declared_by, dm:profiles!campaign_downtime_declarations_declared_by_fkey(display_name)')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(d => ({
    id: d.id, characterId: d.character_id, days: d.days, note: d.note,
    createdAt: d.created_at, declaredBy: d.declared_by, dm: d.dm?.display_name || '',
  }));
}

/**
 * feat/dm-edit-events (D-GH-2026-08-10-dm-edit-events): append DM-attributed events to a campaign
 * character's own LOG — grant/remove a boon, impose a drawback, unlock a locked imposed drawback
 * (`dmUnlockDrawback`, feat/dm-unlock-drawback). `events` must be a non-empty array;
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
 * Campaign-wide character house rules (D-GH-2026-10-13-campaign-house-rules, PR4 of feat/campaign-house-rules):
 * the ONE writer of `campaigns.rules.charHouseRules` and of the DM house-rules events, in one transaction.
 * Needs sql/migrations/2026-10-13-campaign-house-rules-server.sql — without it the call fails with "Could not
 * find the function … dm_apply_house_rules_change" (PGRST202), which DM Console turns into a plain message.
 *   charHouseRules  undefined = leave the campaign's rules as they are (only `actions` run); an object = validated
 *                   and stored whole. ({} = all calls on, no custom or repriced items.) Never pass null: PostgREST
 *                   sends a JSON null as SQL NULL, which the server reads as "unchanged".
 *   actions         [{kind:'override'|'pin', character, overrides, label?}
 *                    | {kind:'reprice', character, name, targetSeq, amount, from, to, label?}
 *                    | {kind:'refundBoon'|'removeDrawback', character, name, targetSeq, label?}]  — at most 500, in order;
 *                   the server stamps seq/ts/dmEdit/dmId/campaignId and the refund / grant-back amounts itself.
 *   expectedChr     the campaign's charHouseRules as the caller LOADED them (null = none stored): the server refuses
 *                   the call if another DM changed them since ("another DM changed …"). undefined = no check. An
 *                   override action may likewise carry `expected` (the character's override snapshot it was built from).
 * Called with only a campaign id it changes nothing (DM Console uses that to detect an un-migrated server).
 * @returns {Promise<{charHouseRules:object|null, events:Array<{character:string, event:object}>}>}
 */
export async function dmApplyHouseRulesChange(campaignId, charHouseRules, actions, expectedChr) {
  const args = { p_campaign: campaignId, p_actions: Array.isArray(actions) ? actions : [] };
  if (charHouseRules !== undefined && charHouseRules !== null) args.p_char_house_rules = charHouseRules;
  if (expectedChr !== undefined) args.p_expected = { charHouseRules: expectedChr === undefined ? null : expectedChr };
  const { data, error } = await supabase.rpc('dm_apply_house_rules_change', args);
  if (error) throw error;
  return data;
}

/**
 * The campaign's characters as the house-rules preview needs them (feat/campaign-house-rules-dm-editor): the raw
 * LOG, the DM AP pool, and whether the row is archived (the RPC refuses an archived character, so the preview leaves
 * it out instead of failing the whole change). Read fresh at save time, not from the rendered roster, so the preview
 * prices what the server will check.
 * @returns {Promise<Array<{id, name, ap, stats, archived:boolean, isNpc:boolean}>>}
 */
export async function getHouseRulesRoster(campaignId) {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, ap, stats, archived_at, is_npc')
    .eq('campaign_id', campaignId)
    .order('name');
  if (error) throw error;
  return (data || []).map(c => ({ id: c.id, name: c.name, ap: c.ap, stats: c.stats,
    archived: c.archived_at != null, isNpc: !!c.is_npc }));
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
 * feat/dm-ap-award-editing (2026-09-08): the AP award history for a WHOLE campaign at once
 * (every character, newest first) — the bulk twin of getAwardHistory() above, for DM Console's
 * "edit any award, several characters at once" grid rather than the one-character-at-a-time view.
 * Readable by any DM of the campaign (RLS: ap_awards_select already covers this — a DM sees every
 * row in their own campaign).
 * @returns {Promise<Array<{id,characterId,characterName,amount,note,created_at,dm_id,dm}>>}
 */
export async function getPartyAwardHistory(campaignId) {
  const { data, error } = await supabase
    .from('ap_awards')
    .select('id, character_id, amount, note, created_at, dm_id, dm:profiles!ap_awards_dm_id_fkey(display_name), character:characters!ap_awards_character_id_fkey(name)')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(a => ({
    id: a.id, characterId: a.character_id, characterName: a.character?.name || '',
    amount: a.amount, note: a.note, created_at: a.created_at,
    dm_id: a.dm_id, dm: a.dm?.display_name || '',
  }));
}

/**
 * feat/dm-ap-award-editing (2026-09-08): correct an EXISTING award's amount and/or note, in place
 * — as opposed to awardAp() above, which only ever adds a new, separate award. `editNote` is
 * required (the server rejects a blank one) so every correction states why. Fully audited: the
 * before/after state, who, and when land in ap_award_edits (visible to the character's own owner,
 * not just DMs — see getAwardEditHistory() below). Adjusts the character's running `ap` total by
 * the delta (new − old), not an overwrite, so it composes correctly with any award made since.
 *
 * `newCreatedAt` — feat/dm-ap-award-filters item 4 (2026-09-08, owner decision A): pass `null` (the
 * default) to leave the award's date untouched — the common case, an amount/note-only edit. Pass a
 * Date or an ISO string to REWRITE the award's actual created_at, letting a DM spread out awards
 * that landed at the exact same instant (a real bulk-award artifact — one batch has 24 rows sharing
 * one timestamp to the microsecond) into a meaningful order. This is a deliberate tradeoff, not an
 * oversight: created_at is also ap_award_edits' own audit-ordering key, so once it's rewritable that
 * ordering is no longer fully reliable. Surfaced and accepted explicitly — see
 * decisions/2026/D-GH-2026-09-08-ap-award-editing.md's addendum. The safer alternative (a separate
 * occurred_at display field, created_at left untouched) was offered and not chosen.
 * @returns {Promise<number>} the character's new ap total
 */
export async function editApAward(awardId, newAmount, newNote, newCreatedAt, editNote) {
  const { data, error } = await supabase.rpc('edit_ap_award', {
    p_award_id: awardId,
    p_new_amount: newAmount,
    p_new_note: newNote ?? null,
    p_new_created_at: newCreatedAt ?? null,
    p_edit_note: editNote,
  });
  if (error) throw error;
  return data;
}

/**
 * feat/dm-ap-award-editing (2026-09-08): the edit trail for a single award (newest first) —
 * every correction ever made to it, with the full before/after and who/why. Readable by the
 * character's owner and any campaign DM (same audience as the award itself), per the owner
 * decision that award edits are transparent to the player, not DM-only bookkeeping.
 * @returns {Promise<Array<{id,old_amount,old_note,new_amount,new_note,edit_note,created_at,dm_id,dm}>>}
 */
export async function getAwardEditHistory(awardId) {
  const { data, error } = await supabase
    .from('ap_award_edits')
    .select('id, old_amount, old_note, new_amount, new_note, edit_note, created_at, dm_id, dm:profiles!ap_award_edits_dm_id_fkey(display_name)')
    .eq('award_id', awardId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(e => ({
    id: e.id, old_amount: e.old_amount, old_note: e.old_note,
    new_amount: e.new_amount, new_note: e.new_note, edit_note: e.edit_note,
    created_at: e.created_at, dm_id: e.dm_id, dm: e.dm?.display_name || '',
  }));
}

/**
 * feat/dm-creation-ceiling-controls: set a character's creation-AP ceiling.
 *
 * Goes through the purpose-built `dm_set_creation_ceiling` RPC rather than the general
 * `dm_edit_character_log`, on both cold reviewers' advice — that function's header states it is
 * "deliberately not a general editor", and widening its allowlist would have meant validating a JSON
 * key-set in plpgsql (a permissive check silently accepts `{threshold, auto}`) with no bound on the
 * value. One typed integer argument has neither problem.
 *
 * The stored figure is the DM's number ALONE. The character's drawback grant is added live by the
 * engine's creationCeiling(), never baked in, so a drawback taken mid-build still hands back the room
 * it paid for.
 *
 * @returns {Promise<object>} the appended event, as stored (server-stamped seq/ts/dmEdit/dmId)
 */
export async function setCreationCeiling(characterId, threshold) {
  const { data, error } = await supabase.rpc('dm_set_creation_ceiling', {
    p_character: characterId,
    p_threshold: threshold,
  });
  if (error) throw error;
  return data;
}

/**
 * Reopen creation for a character whose lock should not have stood.
 *
 * Appends `creationUnlocked`, which the engine resolves last-write-wins against `creationLocked` in
 * log order. Future-only: purchases already made keep the prices they were frozen at.
 *
 * @returns {Promise<object>} the appended event, as stored
 */
export async function reopenCreation(characterId, note) {
  const { data, error } = await supabase.rpc('dm_reopen_creation', {
    p_character: characterId,
    p_note: note || null,
  });
  if (error) throw error;
  return data;
}

/**
 * feat/dm-zero-player-ap: zero out a campaign character's self-declared "Player AP" — the
 * award-event total CharGen's own "Budget" field writes into the character's log, a pool
 * entirely separate from this campaign's DM-awarded AP (characters.ap / award_ap()).
 *
 * Appends one compensating, dmEdit-stamped `award` event computed server-side from the
 * character's own log (never trusts a client-supplied figure) — never rewrites history. Once
 * this campaign has ignore_player_ap on, the DB additionally refuses to let that total rise
 * again by anything other than a DM (see pact_enforce_player_ap_ceiling,
 * sql/migrations/2026-09-03-dm-zero-player-ap.sql) — this call is the sanctioned way past that.
 *
 * @returns {Promise<object>} the appended event, as stored (server-stamped seq/ts/dmEdit/dmId)
 * @throws if Player AP is already 0, or the caller is not a DM of the character's campaign
 */
export async function zeroPlayerAp(characterId) {
  const { data, error } = await supabase.rpc('dm_zero_player_ap', {
    p_character: characterId,
  });
  if (error) throw error;
  return data;
}

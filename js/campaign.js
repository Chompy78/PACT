// PACT — campaign membership (create / join / invite codes / co-DMs).
//
// Roles are per-campaign and derived (see DECISIONS.md D-GH4 + D-GH7):
//   owner  = campaigns.dm_id is you (creator; can manage co-DMs, delete)
//   DM     = you are in campaign_dms for it (owner auto-added; co-DMs join/promoted)
//   player = you own a character whose campaign_id is that campaign
// A campaign can have multiple DMs. Joining and management go through SECURITY
// DEFINER RPCs so players never need broad write access to these tables.

import { supabase } from './supabase-client.js';
import { currentUser } from './auth.js';

const CAMPAIGN_COLS = 'id, name, invite_code, dm_invite_code, ignore_player_ap, rules, dm_id';

/**
 * sessionStorage key for a pending Path-A player-invite token (see docs/plans/2026-07-11-
 * campaign-join-invite-flow.md). CharGen stashes the `?invite=` token here so it survives a
 * same-tab round-trip to login.html; login.html reads it after a successful sign-in and
 * redirects back to CharGen with it. Shared here (not hand-duplicated in both files) so the
 * two can't drift out of sync.
 */
export const PENDING_INVITE_KEY = 'pact_pending_invite';

/** Create a campaign you will own/DM. Both invite codes are generated server-side. */
export async function createCampaign(name) {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ name, dm_id: user.id })
    .select(CAMPAIGN_COLS)
    .single();
  if (error) throw error;
  return data;
}

/** Join a campaign as a PLAYER by its invite code. Returns the campaign id. */
export async function joinCampaign(code) {
  const { data, error } = await supabase.rpc('join_campaign', {
    p_code: (code || '').trim().toUpperCase(),
  });
  if (error) throw error;
  return data;
}

/** Join a campaign as a CO-DM by its DM invite code. Returns the campaign id. */
export async function joinAsDm(code) {
  const { data, error } = await supabase.rpc('join_as_dm', {
    p_code: (code || '').trim().toUpperCase(),
  });
  if (error) throw error;
  return data;
}

/** Owner-only: promote a profile (e.g. an existing member) to co-DM. */
export async function promoteToDm(campaignId, profileId) {
  const { error } = await supabase.rpc('promote_to_dm', {
    p_campaign: campaignId, p_profile: profileId,
  });
  if (error) throw error;
}

/** Owner-only: remove a co-DM (the owner cannot be removed). */
export async function removeDm(campaignId, profileId) {
  const { error } = await supabase.rpc('remove_dm', {
    p_campaign: campaignId, p_profile: profileId,
  });
  if (error) throw error;
}

/** DM-only: regenerate the player invite code. Returns the new code. */
export async function regenerateInviteCode(campaignId) {
  const { data, error } = await supabase.rpc('regenerate_invite_code', { p_campaign: campaignId });
  if (error) throw error;
  return data;
}

/** DM-only: regenerate the DM invite code. Returns the new code. */
export async function regenerateDmInviteCode(campaignId) {
  const { data, error } = await supabase.rpc('regenerate_dm_invite_code', { p_campaign: campaignId });
  if (error) throw error;
  return data;
}

/**
 * DM-only: create a single-use player invite token carrying a preset starting DM
 * AP amount and starting build budget. Returns the raw token — the caller builds
 * the canonical CharGen `?invite=<token>` redemption URL from it.
 */
export async function createPlayerInvite(campaignId, startingAp, startingBudget) {
  const { data, error } = await supabase.rpc('create_player_invite', {
    p_campaign_id: campaignId,
    p_starting_ap: startingAp | 0,
    p_starting_budget: startingBudget | 0,
  });
  if (error) throw error;
  return data;
}

/**
 * Redeem a player invite token as the signed-in user. Idempotent: a repeat call
 * by the same user after a successful redemption returns the same result instead
 * of erroring (double-click / interrupted-client recovery).
 * @returns {Promise<{characterId:string, startingAp:number, startingBudget:number}>}
 */
export async function redeemPlayerInvite(token, name) {
  const { data, error } = await supabase.rpc('redeem_player_invite', {
    p_token: (token || '').trim(),
    p_name: name || null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Invite redemption returned no character');
  return { characterId: row.character_id, startingAp: row.starting_ap, startingBudget: row.starting_budget };
}

/** DM-only: set the "ignore player-granted AP" campaign toggle. */
export async function setIgnorePlayerAp(campaignId, value) {
  const { error } = await supabase
    .from('campaigns')
    .update({ ignore_player_ap: !!value })
    .eq('id', campaignId);
  if (error) throw error;
}

/** DM-only: set the campaign rules object (see DECISIONS.md D-GH14 for the schema). */
export async function setCampaignRules(campaignId, rules) {
  const { error } = await supabase
    .from('campaigns')
    .update({ rules: rules || {} })
    .eq('id', campaignId);
  if (error) throw error;
}

/** The DMs of a campaign, with display names. */
export async function getCampaignDms(campaignId) {
  const { data, error } = await supabase
    .from('campaign_dms')
    .select('dm_id, added_by, created_at, dm:profiles!campaign_dms_dm_id_fkey(display_name)')
    .eq('campaign_id', campaignId);
  if (error) throw error;
  return (data || []).map(d => ({
    dm_id: d.dm_id, name: d.dm?.display_name || '', added_by: d.added_by, created_at: d.created_at,
  }));
}

/**
 * Every campaign you can see, tagged with your relationship to it.
 * @returns {Promise<Array<{...campaign, isOwner:boolean, isDm:boolean, isPlayer:boolean}>>}
 */
export async function listMyCampaigns() {
  const user = await currentUser();
  if (!user) return [];
  const [camps, dms, chars] = await Promise.all([
    supabase.from('campaigns').select(CAMPAIGN_COLS).order('name'),
    supabase.from('campaign_dms').select('campaign_id').eq('dm_id', user.id),
    supabase.from('characters').select('campaign_id').eq('owner_id', user.id),
  ]);
  if (camps.error) throw camps.error;
  if (dms.error) throw dms.error;
  if (chars.error) throw chars.error;
  const dmSet = new Set((dms.data || []).map(d => d.campaign_id));
  const playerSet = new Set((chars.data || []).map(c => c.campaign_id).filter(Boolean));
  return (camps.data || []).map(c => ({
    ...c,
    isOwner: c.dm_id === user.id,
    isDm: dmSet.has(c.id),
    isPlayer: playerSet.has(c.id),
  }));
}

/** One campaign by id (null if not visible to you). */
export async function getCampaign(id) {
  const { data, error } = await supabase
    .from('campaigns').select(CAMPAIGN_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

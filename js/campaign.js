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

// dm_invite_code was removed by D-GH-2026-08-09-harden-invitation-system (it was readable by any
// campaign member and redeemable system-wide with no membership check — a confirmed privilege-
// escalation bug). Co-DM invites are now discrete campaign_invites rows (type='dm'), created/redeemed
// via createDmInvite()/redeemDmInvite() below, not a column on this table.
const CAMPAIGN_COLS = 'id, name, invite_code, ignore_player_ap, rules, dm_id, archived_at';

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
  name = (name || '').trim();
  if (!name) throw new Error('Campaign name is required');
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ name, dm_id: user.id })
    .select(CAMPAIGN_COLS)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Owner-only: archive a campaign (soft-delete, reversible via unarchiveCampaign).
 * Hides it from the active list; players and their characters are unaffected.
 * archived_at is writable ONLY through this RPC (see sql/rls-policies.sql's
 * "Column-level campaign-write lockdown") — a direct table update is rejected.
 */
export async function archiveCampaign(campaignId) {
  const { error } = await supabase.rpc('archive_campaign', { p_campaign: campaignId });
  if (error) throw error;
}

/** Owner-only: restore an archived campaign. */
export async function unarchiveCampaign(campaignId) {
  const { error } = await supabase.rpc('unarchive_campaign', { p_campaign: campaignId });
  if (error) throw error;
}

/** Join a campaign as a PLAYER by its invite code. Returns the campaign id. */
export async function joinCampaign(code) {
  const { data, error } = await supabase.rpc('join_campaign', {
    p_code: (code || '').trim().toUpperCase(),
  });
  if (error) throw error;
  return data;
}

/**
 * DM-only: generate a co-DM invite token (D-GH-2026-08-09-harden-invitation-system). Single-use by
 * default; pass mode:'reusable' with a positive maxRedemptions for a multi-use invite. Returns the
 * raw plaintext token — this is the ONLY time it is ever available; it is stored hashed and there is
 * no API to retrieve it again (Security Invariant 1). The caller is responsible for showing/copying it
 * immediately.
 * @returns {Promise<string>} the plaintext token
 */
export async function createDmInvite(campaignId, { mode = 'single_use', maxRedemptions = null, note = null, expiresAt = null } = {}) {
  const { data, error } = await supabase.rpc('create_dm_invite', {
    p_campaign_id: campaignId,
    p_mode: mode,
    p_max_redemptions: maxRedemptions == null ? null : _nonNegInt(maxRedemptions),
    p_note: (note == null ? null : String(note)),
    p_expires_at: expiresAt || null,
  });
  if (error) throw error;
  return data;
}

/**
 * Redeem a co-DM invite token as the signed-in user. Any authenticated account may redeem a valid
 * token (a deliberate choice — see the plan's Security Invariant 12 — not a membership requirement).
 * Idempotent: a repeat call after already being a co-DM (via this token or any other path) returns
 * alreadyMember:true instead of erroring.
 * @returns {Promise<{campaignId:string, alreadyMember:boolean}>}
 */
export async function redeemDmInvite(token) {
  const { data, error } = await supabase.rpc('redeem_dm_invite', {
    p_token: (token || '').trim(),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('DM invite redemption returned no campaign');
  return { campaignId: row.campaign_id, alreadyMember: row.already_member };
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

// regenerateDmInviteCode() was removed alongside dm_invite_code/join_as_dm by
// D-GH-2026-08-09-harden-invitation-system. DM invites are now discrete campaign_invites rows, not a
// single mutable column — "regenerating" one is revoke the old (setInviteRevoked) + createDmInvite(),
// not an in-place mutation.

/** Non-negative integer, or 0 -- doesn't wrap on huge input the way `x | 0` (32-bit
 * bitwise truncation) would; an out-of-range value is instead left for Postgres's
 * own `integer` column to reject with a real error rather than silently corrupting. */
function _nonNegInt(n) {
  n = Math.trunc(Number(n));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * DM-only: create a single-use player invite token carrying ONE preset AP grant,
 * paid into `characters.ap` (DM-authoritative) on redemption. Returns the raw token
 * — the caller builds the canonical CharGen `?invite=<token>` redemption URL from it.
 *
 * The invite used to carry two numbers, the second of which the client seeded into the
 * character's LOG as PLAYER AP — which any campaign with `ignore_player_ap` then discarded
 * outright (see D-GH-2026-08-03-invite-single-ap-grant). `p_starting_budget` is still sent as 0
 * rather than omitted so the intent is explicit at the call site; the column is deprecated and the
 * RPC folds it into the single grant regardless.
 *
 * `note` is a DM-written label shown in the invite list (D-GH-2026-08-03-dm-invite-manager). It is
 * DM-ONLY: `note` is withheld from `authenticated` at the column level, so the redeeming player cannot
 * read it even though campaign_invites_select lets them see the rest of their own row
 * (D-GH-2026-08-03-invite-note-dm-only). Read it back via listCampaignInvites(), never a direct select.
 */
export async function createPlayerInvite(campaignId, startingAp, note) {
  const { data, error } = await supabase.rpc('create_player_invite', {
    p_campaign_id: campaignId,
    p_starting_ap: _nonNegInt(startingAp),
    p_starting_budget: 0,
    p_note: (note == null ? null : String(note)),
  });
  if (error) throw error;
  return data;
}

/**
 * DM-only: every invite ever issued for this campaign (player AND dm type, newest first), with the
 * redeemer's display name and the character the invite produced (player invites only — a dm-type
 * invite never creates a character, so characterId/characterName come back null for those rows).
 * Goes through an RPC rather than a direct select because those joins cross tables the caller's own
 * RLS won't let them read wholesale; the function gates on is_campaign_dm() internally.
 *
 * `token` is the real, re-copyable plaintext for a player-type row (unchanged, historical
 * behavior — see D-GH-2026-08-09-harden-invitation-system for why player tokens stay plaintext).
 * For a dm-type row it is always null: the plaintext was only ever returned once, by
 * createDmInvite(), at creation, and is never stored (Security Invariant 1).
 * @returns {Promise<Array<{id, type, mode, token, note, startingAp, maxRedemptions, redeemedCount,
 *                          expiresAt, createdAt, revokedAt, redeemedAt, redeemedByName, characterId,
 *                          characterName}>>}
 */
export async function listCampaignInvites(campaignId) {
  const { data, error } = await supabase.rpc('list_campaign_invites', { p_campaign: campaignId });
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.id,
    type: r.type,
    mode: r.mode,
    token: r.token,
    note: r.note || '',
    startingAp: r.starting_ap || 0,
    maxRedemptions: r.max_redemptions,
    redeemedCount: r.redeemed_count || 0,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    redeemedAt: r.redeemed_at,
    redeemedByName: r.redeemed_by_name || null,
    characterId: r.character_id || null,
    characterName: r.character_name || null,
  }));
}

/**
 * DM-only: withdraw (or restore) an UNREDEEMED invite. Soft — the row is kept so the record of what
 * was issued survives. A redeemed invite is immutable and the RPC rejects it: the character already
 * exists and its AP was already granted, so "revoked" would describe a state that isn't true.
 */
export async function setInviteRevoked(inviteId, revoked = true) {
  const { data, error } = await supabase.rpc('set_invite_revoked', {
    p_invite: inviteId, p_revoked: !!revoked,
  });
  if (error) throw error;
  return data;   // the new revoked_at, or null when restored
}

/**
 * Redeem a player invite token as the signed-in user. Idempotent: a repeat call
 * by the same user after a successful redemption returns the same result (with
 * isNew:false) instead of erroring (double-click / interrupted-client recovery) —
 * the caller must NOT re-seed the character when isNew is false, or it will
 * silently overwrite any real progress made since the first redemption.
 * @returns {Promise<{characterId:string, startingAp:number, startingBudget:number, campaignId:string, isNew:boolean}>}
 */
export async function redeemPlayerInvite(token, name) {
  const { data, error } = await supabase.rpc('redeem_player_invite', {
    p_token: (token || '').trim(),
    p_name: name || null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Invite redemption returned no character');
  return {
    characterId: row.character_id, startingAp: row.starting_ap, startingBudget: row.starting_budget,
    campaignId: row.campaign_id, isNew: row.is_new,
  };
}

/**
 * Path B: bind an already-built character to a campaign by its shared invite code.
 * Rebind contract: succeeds as a no-op if already bound to this same campaign; throws
 * if bound to a different one. Caller must own the character (enforced server-side).
 * @returns {Promise<string>} the bound campaign's id
 */
export async function bindCharacterToCampaign(characterId, code) {
  const { data, error } = await supabase.rpc('bind_character_to_campaign', {
    p_character_id: characterId,
    p_code: (code || '').trim().toUpperCase(),
  });
  if (error) throw error;
  return data;
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
/**
 * Campaigns you DM or play in. Archived ones are EXCLUDED by default.
 *
 * The filter used to live only in DM Console's own loadCampaigns(), so every other caller —
 * CharGen's campaign picker, the Live Sheet's rules lookup — happily offered archived campaigns as
 * selectable binding/rules targets, silently defeating the archive feature outside one tool. Filtering
 * here makes the safe behaviour the default and the unsafe one explicit: DM Console passes
 * `{ includeArchived: true }` because it needs the archived list to offer "Unarchive".
 */
export async function listMyCampaigns({ includeArchived = false } = {}) {
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
  const rows = includeArchived ? (camps.data || [])
                              : (camps.data || []).filter(c => !c.archived_at);
  return rows.map(c => ({
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

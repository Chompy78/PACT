// PACT — campaign membership (create / join / invite codes).
//
// Roles are per-campaign and derived (see DECISIONS.md D-GH4): you are the DM of
// a campaign whose dm_id is you, and a player in one where you own a character.
// Joining and code regeneration go through SECURITY DEFINER RPCs so players never
// need broad read access to the campaigns table.

import { supabase } from './supabase-client.js';
import { currentUser } from './auth.js';

/** Create a campaign you will DM. The invite code is auto-generated server-side. */
export async function createCampaign(name) {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase
    .from('campaigns')
    .insert({ name, dm_id: user.id })
    .select('id, name, invite_code, dm_id')
    .single();
  if (error) throw error;
  return data;
}

/** Join a campaign by its 6-char invite code. Returns the campaign id. */
export async function joinCampaign(code) {
  const { data, error } = await supabase.rpc('join_campaign', {
    p_code: (code || '').trim().toUpperCase(),
  });
  if (error) throw error;
  return data;
}

/** DM-only: issue a new invite code (the old one stops working). Returns the new code. */
export async function regenerateInviteCode(campaignId) {
  const { data, error } = await supabase.rpc('regenerate_invite_code', {
    p_campaign: campaignId,
  });
  if (error) throw error;
  return data;
}

/** Every campaign you can see, tagged with your role in it ('dm' | 'player'). */
export async function listMyCampaigns() {
  const user = await currentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, invite_code, dm_id')
    .order('name');
  if (error) throw error;
  return data.map(c => ({ ...c, role: c.dm_id === user.id ? 'dm' : 'player' }));
}

/** One campaign by id (null if not visible to you). */
export async function getCampaign(id) {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, invite_code, dm_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// PACT — authentication helpers (email/password) over Supabase Auth.
//
// Pure logic, no UI. The login/register screen (Task 2, step 2) imports these.
// Sessions are persisted by the Supabase client (localStorage, key 'pact-auth').
//
// Roles are PER-CAMPAIGN, not global (see DECISIONS.md D-GH4): there is no
// "this user is a DM" flag to read at login. Routing by role happens later,
// per campaign, in the campaign/DM layer — not here.

import { supabase } from './supabase-client.js';

const REDIRECT_BASE = 'https://chompy78.github.io/PACT/';

// Password-reset emails must land on a page that actually HANDLES Supabase's recovery redirect
// (login.html's recovery branch listens for the PASSWORD_RECOVERY auth event and shows a
// new-password form) — a separate constant from REDIRECT_BASE, which register()'s
// emailRedirectTo below still correctly points at the app homepage. Previously this reused
// REDIRECT_BASE, so a reset link landed on index.html, which has no recovery handling at all —
// see fix/password-reset-flow / D-GH-2026-08-25-password-reset-flow.
const RESET_REDIRECT = REDIRECT_BASE + 'login.html';

/**
 * Register a new user. displayName is stored in auth metadata and copied into
 * public.profiles by the signup trigger (see sql/schema.sql).
 * @returns {Promise<{user, session}>}
 */
export async function register(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName ?? '' },
      emailRedirectTo: REDIRECT_BASE,
    },
  });
  if (error) throw error;
  return data;
}

/** Log in with email + password. @returns {Promise<{user, session}>} */
export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** Send a password-reset email (link returns the user to login.html's recovery form). */
export async function forgotPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: RESET_REDIRECT,
  });
  if (error) throw error;
}

/**
 * Set a new password. Call this after the user arrives back from the reset
 * email (Supabase has put them in a temporary recovery session by then).
 */
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/** Log out and clear the local session. */
export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** The current user, or null if signed out. */
export async function currentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
}

/** The current session, or null. Useful for a quick signed-in check. */
export async function currentSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session ?? null;
}

/**
 * Subscribe to auth changes (login/logout/token refresh/password recovery).
 * @param {(event: string, session: object|null) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, session));
  return () => data.subscription.unsubscribe();
}

/**
 * Subscribe to auth changes when only the session (not the event string) is needed — the common
 * case, and the one every argument-order bug so far has hit (a caller binding `session` to
 * `onAuthChange`'s 1st argument, which is actually `event`). Structurally can't get the order
 * wrong: there's only one argument. Callers that genuinely need the raw event string (e.g. an
 * explicit `SIGNED_OUT` branch) should use `onAuthChange` directly instead.
 * @param {(session: object|null) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onSessionChange(cb) {
  return onAuthChange((_event, session) => cb(session));
}

/** Fetch the signed-in user's profile row (id, display_name, and — feat/player-basic-mode — whether
 *  this account is currently restricted to one active character, and by whom/when if so). The
 *  `setter` embed resolves basic_mode_set_by to that DM's display name so a flagged player can see
 *  who restricted them without a second query — profiles_select's RLS already lets any account read
 *  its own row in full, so no extra grant is needed for this join. */
export async function myProfile() {
  const user = await currentUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, basic_mode, basic_mode_set_at, setter:profiles!basic_mode_set_by(display_name)')
    .eq('id', user.id)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    display_name: data.display_name,
    basicMode: !!data.basic_mode,
    basicModeSetBy: data.setter?.display_name || null,
    basicModeSetAt: data.basic_mode_set_at || null,
  };
}

/** feat/player-basic-mode: the player's own always-available escape hatch — turns basic mode off on
 *  the SIGNED-IN account, regardless of whether the DM who set it still shares a campaign with them
 *  (decision A3: this is what actually closes the reversibility gap, not the DM's own convenience
 *  path — see decisions/2026/D-GH-2026-09-05-player-basic-mode.md and js/dm.js's
 *  unsetBasicModeForPlayer() for that DM-side counterpart). */
export async function unsetMyBasicMode() {
  const { error } = await supabase.rpc('unset_basic_mode');
  if (error) throw error;
}

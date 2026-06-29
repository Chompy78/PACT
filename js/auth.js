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

/** Send a password-reset email (link returns the user to the app). */
export async function forgotPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: REDIRECT_BASE,
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

/** Fetch the signed-in user's profile row (id, display_name). */
export async function myProfile() {
  const user = await currentUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('id', user.id)
    .single();
  if (error) throw error;
  return data;
}

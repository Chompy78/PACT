#!/usr/bin/env node
/**
 * PACT — stand up a LOCAL Supabase stack with realistic, hand-inspectable data, then serve the app
 * against it and stay running.
 *
 * WHY THIS EXISTS. cloud-e2e.mjs proves the signed-in paths work; it says nothing about whether they
 * are pleasant to use, and it tears everything down the moment it finishes. A usability/QoL review
 * needs the opposite: stable accounts a human or an agent can sign into repeatedly, a campaign that
 * already has history, and enough deliberate mess (a redeemed invite, a revoked one, an archived
 * character, an awkward name) that the empty-state-only view of the app isn't the only one on offer.
 *
 * Reuses cloud-e2e's local-stack discovery, production guard, schema bootstrap and on-the-fly
 * supabase-client rewrite. Accounts are FIXED (not timestamped) so they can be typed by hand and so a
 * re-run lands on the same credentials.
 *
 * TWO MODES.
 *
 * LOCAL (default, preferred) — a throwaway `supabase start` stack. Needs Docker + the Supabase CLI.
 * Structurally unable to reach a hosted project: the target must be a loopback address or the script
 * exits.
 *   supabase start
 *   node testing/scripts/seed-review-stack.mjs            # seeds, serves, blocks until Ctrl-C
 *   node testing/scripts/seed-review-stack.mjs --reset    # wipe and re-seed
 *   supabase stop --no-backup
 *
 * LIVE (--live) — a real hosted project, for when Docker isn't available. This writes into a database
 * REAL PLAYERS SHARE, so it is gated on three separate things and gives up the destructive paths
 * entirely; see liveConfig() below for the full contract. Every seeded row is tagged so --purge can
 * remove exactly and only what was seeded.
 *   export SUPABASE_URL=https://<ref>.supabase.co
 *   export SUPABASE_SERVICE_KEY=<service_role key>      # NEVER commit this
 *   export PACT_REVIEW_LIVE=i-understand
 *   node testing/scripts/seed-review-stack.mjs --live
 *   node testing/scripts/seed-review-stack.mjs --live --purge    # when the review is finished
 *
 * Take a snapshot before a live run. `backup.snapshots` (a schema PostgREST does not expose) holds
 * whole-database JSON captures; see docs/review-prompts/usability-qol-review.md.
 *
 * NOT a test. Nothing here asserts; a failure is a hard exit with the reason. This never runs in CI.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 7971;                 // deliberately NOT cloud-e2e's 7970, so both can run at once
const PW = 'pact-review-1234';     // every seeded account shares it — local throwaway stack only

// ---------------------------------------------------------------------------------------------
// PRODUCTION GUARD — first, and unconditional. Same reasoning as cloud-e2e.mjs: this script creates
// users, issues invites and writes characters, so it must be structurally incapable of reaching the
// real project. Asserts on the URL rather than merely defaulting away from it.
// ---------------------------------------------------------------------------------------------
const PROD_REF = 'piuprrrnaotrtxucrtsb';

/** LOCAL mode: the only acceptable target is a loopback address. A positive assertion, not a
 *  blocklist — there is no way to spell 127.0.0.1 that reaches a hosted project. */
function assertLocal(url, why) {
  const u = String(url || '');
  if (u.includes(PROD_REF) || /\.supabase\.co/i.test(u)) {
    console.error(`\n[seed] REFUSING TO RUN: ${why} points at a hosted Supabase project (${u}).`);
    console.error('[seed] This script creates users and writes characters. Local stack only.');
    console.error('[seed] To seed a LIVE project on purpose, use --live (see the header). Aborting.\n');
    process.exit(3);
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(u)) {
    console.error(`\n[seed] REFUSING TO RUN: ${why} is not a loopback address (${u}).\n`);
    process.exit(3);
  }
}

/**
 * LIVE mode. Seeding a project that real people use is a deliberate act, so it is gated on THREE
 * independent things rather than one flag — any of which failing stops the run:
 *
 *   1. --live passed explicitly on the command line.
 *   2. PACT_REVIEW_LIVE=i-understand in the environment. A flag alone is one typo away from a
 *      different command; a flag plus a spelled-out env var is not something you do by accident.
 *   3. SUPABASE_URL and SUPABASE_SERVICE_KEY supplied by the caller. Never defaulted, never read
 *      from the repo — the checked-in constants must not be able to become the target implicitly.
 *
 * What live mode gives up, on purpose:
 *   - it NEVER applies sql/schema.sql (production already has the schema; re-applying it would drop
 *     and recreate policies on a live database)
 *   - --reset is REFUSED outright. `drop schema public cascade` has no safe meaning here, so the
 *     code path does not exist rather than being merely discouraged.
 */
function liveConfig() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  const fail = m => { console.error(`\n[seed] REFUSING TO RUN (--live): ${m}\n`); process.exit(3); };

  if (process.env.PACT_REVIEW_LIVE !== 'i-understand') {
    fail('--live also requires PACT_REVIEW_LIVE=i-understand in the environment.\n' +
         '       This writes review accounts and campaigns into a database real players use.');
  }
  if (!url || !key) fail('--live requires SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.');
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/i.test(url)) {
    fail(`SUPABASE_URL does not look like a Supabase project URL: ${url}`);
  }
  if (process.argv.includes('--reset')) {
    fail('--reset is not available in live mode. It drops the public schema and every auth user.\n' +
         '       Use --purge, which removes only rows tagged as review data.');
  }
  return { api: url.replace(/\/$/, ''), service: key, anon: process.env.SUPABASE_ANON_KEY || '',
           db: null, live: true };
}

const log = m => console.log(`[seed] ${m}`);
function die(msg, detail) {
  console.error(`\n[seed] ${msg}`);
  if (detail) console.error(String(detail).slice(-1500));
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// Local stack discovery / schema bootstrap
// ---------------------------------------------------------------------------------------------
function stackConfig() {
  let raw;
  try {
    raw = execSync('supabase status -o json', { cwd: REPO, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
  } catch (e) {
    die('`supabase status` failed — is the stack running? Try `supabase start`.', e.stderr || e.message);
  }
  const j = JSON.parse(raw);
  const cfg = { api: j.API_URL || j.api_url, anon: j.ANON_KEY || j.anon_key,
                service: j.SERVICE_ROLE_KEY || j.service_role_key, db: j.DB_URL || j.db_url };
  assertLocal(cfg.api, 'the stack API URL');
  assertLocal((cfg.db || '').replace(/^postgresql:\/\/[^@]*@/, 'http://'), 'the stack database URL');
  return cfg;
}

function psql(cfg, statement) {
  try {
    return execSync(`psql "${cfg.db}" -v ON_ERROR_STOP=1 -q -At -f -`, {
      input: statement.endsWith(';') ? statement : statement + ';', encoding: 'utf8', cwd: REPO,
      stdio: ['pipe','pipe','pipe'], env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
    });
  } catch (e) { die('psql failed', e.stderr || e.message); }
}

function applySchema(cfg) {
  for (const f of ['sql/schema.sql', 'sql/rls-policies.sql']) {
    try {
      execSync(`psql "${cfg.db}" -v ON_ERROR_STOP=1 -q -f ${JSON.stringify(path.join(REPO, f))}`,
               { cwd: REPO, stdio: ['ignore','pipe','pipe'],
                 env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
      log(`applied ${f}`);
    } catch (e) { die(`failed applying ${f}`, e.stderr || e.message); }
  }
}

// ---------------------------------------------------------------------------------------------
// Static file server.
//
// In LOCAL mode it rewrites js/supabase-client.js in flight so the app talks to the throwaway stack
// without the repo being modified — the checked-in constants stay pointed at production, as they must.
//
// In LIVE mode it serves the file UNTOUCHED. The checked-in constants already name the live project
// and its publishable key, so rewriting would at best be a no-op and at worst substitute a wrong or
// empty key. Serving the real file also means the review sees exactly the bytes production serves.
// ---------------------------------------------------------------------------------------------
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
               '.json':'application/json', '.css':'text/css', '.png':'image/png',
               '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
function makeServer(cfg) {
  return http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
    fs.readFile(path.join(REPO, rel), (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      let body = data;
      if (rel === 'js/supabase-client.js' && !cfg.live) {
        body = Buffer.from(String(data)
          .replace(/export const SUPABASE_URL = '[^']*';/, `export const SUPABASE_URL = '${cfg.api}';`)
          .replace(/export const SUPABASE_PUBLISHABLE_KEY = '[^']*';/,
                   `export const SUPABASE_PUBLISHABLE_KEY = '${cfg.anon}';`));
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] || 'application/octet-stream',
                           'Cache-Control': 'no-store' });
      res.end(body);
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Admin helpers (service_role — local stack only, already guarded above)
// ---------------------------------------------------------------------------------------------
async function admin(cfg, pathname, init = {}) {
  const r = await fetch(cfg.api + pathname, {
    ...init,
    headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}`,
               'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const txt = await r.text();
  let body; try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${pathname} -> ${r.status} ${txt.slice(0, 300)}`);
  return body;
}
const createUser = (cfg, email, name) =>
  admin(cfg, '/auth/v1/admin/users', { method: 'POST',
    body: JSON.stringify({ email, password: PW, email_confirm: true,
                           user_metadata: { display_name: name } }) });

/** PATCH a table through PostgREST with the service key. Used instead of psql for the handful of
 *  writes the app's own API cannot express, because live mode has no direct database connection —
 *  and because one code path for both modes means the local stack actually exercises what live runs. */
const adminPatch = (cfg, table, query, body) =>
  admin(cfg, `/rest/v1/${table}?${query}`, { method: 'PATCH',
    headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });

/** DELETE likewise. Every caller must pass a filter; a bare table name is refused rather than
 *  becoming "delete everything in this table". */
function adminDelete(cfg, table, query) {
  if (!query || !query.trim()) throw new Error(`adminDelete(${table}) called with no filter — refusing`);
  return admin(cfg, `/rest/v1/${table}?${query}`, { method: 'DELETE',
    headers: { Prefer: 'return=representation' } });
}

/** Sign in through the app's own auth module, not a side channel — same as cloud-e2e. */
async function signIn(page, base, email) {
  await page.goto(`${base}/login.html`, { waitUntil: 'load' });
  const res = await page.evaluate(async ({ email, password }) => {
    const mod = await import('/PACT/js/auth.js');
    try { await mod.login(email, password); const s = await mod.currentSession();
          return { ok: !!s, uid: s && s.user && s.user.id }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, { email, password: PW });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.err || 'no session'}`);
  return res.uid;
}

// ---------------------------------------------------------------------------------------------
// The seeded world
// ---------------------------------------------------------------------------------------------
// EVERY seeded row is tagged, and the tags are the ONLY thing --purge deletes. On the local stack
// that is merely tidy; on a live project it is the entire safety story, so the tags must be
// impossible to collide with real data by accident:
//   accounts  — all on @review.pact.test, a domain nobody can receive mail at
//   campaigns — name starts with REVIEW_PREFIX, so a human scanning DM Console sees what is fake
// Characters are not tagged directly: they are reached through their owner, which is a review
// account, so ownership IS the tag.
const REVIEW_DOMAIN = 'review.pact.test';
const REVIEW_PREFIX = '[REVIEW] ';
const ACCOUNTS = {
  dm:    { email: `dm@${REVIEW_DOMAIN}`,      name: 'DM Morgan' },
  codm:  { email: `codm@${REVIEW_DOMAIN}`,    name: 'Co-DM Riley' },
  p1:    { email: `player1@${REVIEW_DOMAIN}`, name: 'Player Alex' },
  p2:    { email: `player2@${REVIEW_DOMAIN}`, name: 'Player Sam' },
  p3:    { email: `player3@${REVIEW_DOMAIN}`, name: 'Player Jo' },   // invited but never redeemed
};

/** A real CharGen output, lifted from the parity fixture rather than hand-authored — a hand-written
 *  LOG would have to get every `cost` right or the Live Sheet ledger silently reads as nonsense. */
function fixtureCharacter(name) {
  const src = JSON.parse(fs.readFileSync(
    path.join(REPO, 'testing/fixtures/live-sheets/LS-001-clean-generator-export.json'), 'utf8'));
  const LOG = src.LOG.map(e => (e.type === 'name' ? { ...e, name, label: `Name — ${name}` } : e));
  return { schema: 'pact-character/1', rules: src.rules, name, LOG, SEQ: src.SEQ };
}

async function seed(cfg, browser, base) {
  log('creating accounts…');
  const uid = {};
  for (const [k, a] of Object.entries(ACCOUNTS)) {
    const u = await createUser(cfg, a.email, a.name);
    uid[k] = u.id;
  }
  // profiles.display_name is what DM Console renders in rosters and the invite list. The signup
  // trigger may fall back to the email local-part, so set the friendly names explicitly.
  for (const [k, a] of Object.entries(ACCOUNTS)) {
    await adminPatch(cfg, 'profiles', `id=eq.${uid[k]}`, { display_name: a.name });
  }

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await signIn(dmPage, base, ACCOUNTS.dm.email);

  log('creating campaigns, rules and invites…');
  const world = await dmPage.evaluate(async (PRE) => {
    const c = await import('/PACT/js/campaign.js');

    // The main campaign: real rules, so the rule-filtering UI has something to filter.
    const main = await c.createCampaign(PRE + 'The Ashfall Compact');
    await c.setCampaignRules(main.id, {
      bannedSpecies: ['Dragonborn'],
      bannedMasteries: [],
      bannedBoons: [],
      bannedDrawbacks: [],
      bannedArts: [],
      multiDisciplineAllowed: false,
      houseRules: { 'Death saves are made in the open': true, 'One inspiration per session': true },
      levelBudgetCurve: { preset: 'standard', l1: 79, inc: 24 },
      awardPace: { preset: 'average', apPerSession: 7 },
      startingTier: { preset: 'standard', ap: 79 },
      dmNotes: 'Session 4 next Thursday. Remember the Ashfall siege timer.',
    });
    await c.setIgnorePlayerAp(main.id, true);

    // A second campaign with NO rules written at all — the common real-world shape (rules defaults to
    // '{}' and createCampaign never writes a tier). Exercises the join-grant default and every
    // "unconfigured campaign" empty state.
    const bare = await c.createCampaign(PRE + 'Untitled Playtest');

    // An archived one, so the archive/unarchive UI is reachable without archiving a live campaign.
    const old = await c.createCampaign(PRE + 'The Sunken Crypt (finished)');
    await c.archiveCampaign(old.id);

    const fresh = await c.listMyCampaigns({ includeArchived: true });
    const codeOf = id => (fresh.find(x => x.id === id) || {});

    // Invites in every state the list can show: live, long-noted, and (redeemed/revoked below).
    const liveTok    = await c.createPlayerInvite(main.id, 79, 'Alex — new player, joining at session 4');
    const revokedTok = await c.createPlayerInvite(main.id, 79,
      'Jordan — asked for a slot then went quiet, holding this until they confirm one way or the other');
    const staleTok   = await c.createPlayerInvite(main.id, 0, 'No-grant invite (testing 0 AP)');
    const redeemTok  = await c.createPlayerInvite(main.id, 120, 'Sam — veteran tier, joining mid-campaign');

    const invites = await c.listCampaignInvites(main.id);
    const idOf = tok => (invites.find(i => i.token === tok) || {}).id;
    await c.setInviteRevoked(idOf(revokedTok), true);

    // Co-DM invite (D-GH-2026-08-09-harden-invitation-system: dm_invite_code/joinAsDm were removed --
    // co-DM invites are now single-use tokens like player invites, generated here and consumed once,
    // below, by the co-DM's own browser context).
    const dmTok = await c.createDmInvite(main.id, { mode: 'single_use', note: 'Review-stack co-DM seed' });

    return {
      main: { id: main.id, name: main.name, code: codeOf(main.id).invite_code, dmToken: dmTok },
      bare: { id: bare.id, name: bare.name, code: codeOf(bare.id).invite_code },
      old:  { id: old.id,  name: old.name },
      tokens: { live: liveTok, revoked: revokedTok, stale: staleTok, redeem: redeemTok },
    };
  }, REVIEW_PREFIX);

  log('co-DM joining…');
  const coCtx = await browser.newContext();
  const coPage = await coCtx.newPage();
  await signIn(coPage, base, ACCOUNTS.codm.email);
  await coPage.evaluate(async (token) => {
    const c = await import('/PACT/js/campaign.js');
    await c.redeemDmInvite(token);
  }, world.main.dmToken);
  await coCtx.close();

  log('players joining and saving characters…');
  // Player 1 — built locally, then bound by the SHARED CODE (Path B). Gets the join grant.
  const p1Ctx = await browser.newContext();
  const p1Page = await p1Ctx.newPage();
  await signIn(p1Page, base, ACCOUNTS.p1.email);
  await p1Page.evaluate(async ({ env, code }) => {
    const s = await import('/PACT/js/sync.js');
    const c = await import('/PACT/js/campaign.js');
    const id = s.newCharacterId();
    await s.saveCharacter({ id, name: env.name, kind: 'chargen', stats: env });
    await c.bindCharacterToCampaign(id, code);
    // A second, unbound draft, so "My Characters" shows more than one row and both tags are visible.
    const draftId = s.newCharacterId();
    await s.saveCharacter({ id: draftId, name: 'Untitled draft', kind: 'chargen',
                            stats: { schema: 'pact-character/1', rules: env.rules,
                                     name: 'Untitled draft', LOG: [], SEQ: 1 } });
  }, { env: fixtureCharacter('Aldric Valor'), code: world.main.code });
  await p1Ctx.close();

  // Player 2 — REDEEMED an invite (Path A), the other route in. Also gets an archived character.
  const p2Ctx = await browser.newContext();
  const p2Page = await p2Ctx.newPage();
  await signIn(p2Page, base, ACCOUNTS.p2.email);
  await p2Page.evaluate(async ({ token, env }) => {
    const s = await import('/PACT/js/sync.js');
    const c = await import('/PACT/js/campaign.js');
    const res = await c.redeemPlayerInvite(token, env.name);
    if (res.isNew) {
      await s.saveCharacter({ id: res.characterId, name: env.name, kind: 'livesheet',
                             stats: { ...env, id: res.characterId }, campaignId: res.campaignId });
    }
    const goneId = s.newCharacterId();
    await s.saveCharacter({ id: goneId, name: 'Retired: Hex the Unlucky', kind: 'chargen',
                            stats: { schema: 'pact-character/1', rules: env.rules,
                                     name: 'Retired: Hex the Unlucky', LOG: [], SEQ: 1 } });
    await s.archiveCharacter(goneId);
  }, { token: world.tokens.redeem, env: fixtureCharacter('Sera Valor') });
  await p2Ctx.close();

  log('DM awarding AP and adding notes…');
  await dmPage.evaluate(async (campId) => {
    const d = await import('/PACT/js/dm.js');
    const roster = await d.getRoster(campId);
    for (const ch of roster) {
      await d.awardAp(ch.id, 14, 'Session 3 — cleared the Ashfall gate');
    }
    if (roster[0]) {
      await d.setCharacterDmNotes(roster[0].id, {
        playerLabel: 'Alex (Thu group)',
        notes: 'Owes the guild 200gp. Wants a redemption arc — set up the Ashfall broker in session 5.',
      });
    }
  }, world.main.id);

  // A deliberately awkward name, written server-side so it can't be normalised on the way in. Every
  // surface that renders a character name must survive it — this is the esc() invariant in AGENTS.md,
  // and a review that only ever sees "Aldric Valor" can't tell whether it holds. Scoped to the review
  // owner as well as the name, so it can never land on a real player's draft of the same name.
  await adminPatch(cfg, 'characters',
    `owner_id=eq.${uid.p1}&name=eq.${encodeURIComponent('Untitled draft')}`,
    { name: `Bob "The Knife" <b>O'Malley</b> & Sons … ${'x'.repeat(60)}` });

  await dmCtx.close();
  return world;
}

// ---------------------------------------------------------------------------------------------
// Purge — remove seeded data and NOTHING else
// ---------------------------------------------------------------------------------------------
/**
 * Deletes every review account, which the schema's own foreign keys then cascade through:
 *
 *   auth.users -> profiles (CASCADE) -> characters.owner_id  (CASCADE)
 *                                    -> campaigns.dm_id      (CASCADE) -> campaign_dms    (CASCADE)
 *                                                                     -> campaign_invites (CASCADE)
 *                                    -> campaign_dms.dm_id   (CASCADE)
 *                                       ap_awards.character_id          (CASCADE)
 *
 * So deleting the five accounts is sufficient AND exact: nothing owned by anyone else is reachable.
 *
 * ONE cascade is not safe by itself: characters.campaign_id is SET NULL, so deleting a review
 * campaign that somehow contained a REAL player's character would silently unbind that character
 * rather than erroring. That cannot happen if the review only ever used review accounts — but
 * "cannot happen" is what a guard is for, so this refuses to delete anything if it finds a
 * non-review character sitting in a review campaign, and tells you which one.
 */
async function purge(cfg) {
  // Review accounts are identified through the auth admin API, not a table: `profiles` has no email
  // column, and the email domain is the tag.
  const page = await admin(cfg, '/auth/v1/admin/users?per_page=1000');
  const list = (page && page.users) || [];
  const review = list.filter(u => String(u.email || '').endsWith(`@${REVIEW_DOMAIN}`));
  if (!review.length) { log('purge: no review accounts found — nothing to do.'); return; }

  const ids = review.map(u => u.id);
  const inList = `(${ids.join(',')})`;

  // Guard 1: every character in a review-owned campaign must itself be review-owned.
  const camps = await admin(cfg, `/rest/v1/campaigns?select=id,name&dm_id=in.${inList}`);
  if (camps.length) {
    const campIds = `(${camps.map(c => c.id).join(',')})`;
    const inCamp = await admin(cfg,
      `/rest/v1/characters?select=id,name,owner_id&campaign_id=in.${campIds}`);
    const foreign = inCamp.filter(c => !ids.includes(c.owner_id));
    if (foreign.length) {
      console.error('\n[seed] PURGE ABORTED — a review campaign contains characters owned by someone else.');
      console.error('[seed] Deleting it would unbind them (characters.campaign_id is ON DELETE SET NULL).');
      for (const c of foreign) console.error(`[seed]   ${c.name}  (owner ${c.owner_id})`);
      console.error('[seed] Move those characters out of the review campaign, then re-run --purge.\n');
      process.exit(4);
    }
  }

  // Guard 2: never touch a campaign that isn't tagged, even if a review account somehow owns it.
  const untagged = camps.filter(c => !String(c.name || '').startsWith(REVIEW_PREFIX));
  if (untagged.length) {
    console.error('\n[seed] PURGE ABORTED — a review account owns a campaign that is not tagged:');
    for (const c of untagged) console.error(`[seed]   "${c.name}"`);
    console.error('[seed] Rename or reassign it first; purge only removes tagged data.\n');
    process.exit(4);
  }

  log(`purge: deleting ${review.length} review account(s) and everything they own…`);
  for (const u of review) {
    await admin(cfg, `/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
    log(`  removed ${u.email}`);
  }
  log('purge complete — cascades removed their profiles, characters, campaigns, invites and awards.');
}

// ---------------------------------------------------------------------------------------------
function summary(world, cfg, live) {
  const base = `http://localhost:${PORT}/PACT`;
  const rows = Object.entries(ACCOUNTS)
    .map(([k, a]) => `    ${a.email.padEnd(20)} ${PW}   (${a.name}${k === 'p3' ? ', invited only' : ''})`)
    .join('\n');
  return `
${'='.repeat(94)}
  PACT review stack is UP.  Ctrl-C to stop the server.
  Backend: ${live ? 'LIVE PROJECT ' + cfg.api + '  <-- real players share this database'
                  : 'local throwaway stack (then: supabase stop --no-backup)'}
  ${live ? 'When finished:  node testing/scripts/seed-review-stack.mjs --live --purge'
         : ''}
${'='.repeat(94)}

  APP        ${base}/index.html
  CharGen    ${base}/tools/PACT-CharGen-Webtool.html
  Live Sheet ${base}/tools/PACT-Live-Char-Sheet.html
  DM Console ${base}/tools/DM-Console.html
  Characters ${base}/tools/characters.html
  Sign in    ${base}/login.html

  ACCOUNTS (all share one password)
${rows}

  CAMPAIGNS
    "${world.main.name}"      player code ${world.main.code}   (co-DM invite already redeemed by ${ACCOUNTS.codm.email} during seeding — single-use, generate a fresh one from DM Console to add another)
                             rules configured, ignore-player-AP ON, 2 players, 1 co-DM
    "${world.bare.name}"      player code ${world.bare.code}
                             NO rules written — the common real-world shape; join grants the 79 default
    "${world.old.name}"       archived

  INVITE LINKS (CharGen redemption URLs)
    live      ${base}/tools/PACT-CharGen-Webtool.html?invite=${world.tokens.live}
    zero-AP   ${base}/tools/PACT-CharGen-Webtool.html?invite=${world.tokens.stale}
    revoked   ${base}/tools/PACT-CharGen-Webtool.html?invite=${world.tokens.revoked}
    redeemed  ${base}/tools/PACT-CharGen-Webtool.html?invite=${world.tokens.redeem}

  SEEDED MESS (deliberate — an all-happy-path stack hides most usability problems)
    - a character named  Bob "The Knife" <b>O'Malley</b> & Sons …xxxxx…  (escaping + overflow)
    - an archived character, an archived campaign, a revoked invite, a 0-AP invite
    - one character bound by shared code, one by invite redemption
    - an empty "Untitled Playtest" campaign, and a player with an empty draft
${'='.repeat(94)}
`;
}

async function main() {
  const live = process.argv.includes('--live');
  const cfg = live ? liveConfig() : stackConfig();
  log(live ? `LIVE project: ${cfg.api}` : `local stack: ${cfg.api}`);
  if (live) {
    log('live mode — schema will NOT be applied, --reset is unavailable, and every seeded row is');
    log(`tagged (accounts @${REVIEW_DOMAIN}, campaigns "${REVIEW_PREFIX.trim()}") for --purge.`);
  }

  if (process.argv.includes('--purge')) {
    await purge(cfg);
    return;
  }

  if (!live) {
    if (process.argv.includes('--reset')) {
      log('--reset: dropping the public schema and every seeded auth user');
      psql(cfg, 'drop schema if exists public cascade; create schema public;');
      psql(cfg, 'delete from auth.users');
    }
    applySchema(cfg);
  }

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const server = makeServer(cfg);
  await new Promise(r => server.listen(PORT, r));
  const base = `http://localhost:${PORT}/PACT`;

  let world;
  try {
    world = await seed(cfg, browser, base);
  } catch (e) {
    console.error('[seed] seeding failed:', e && e.stack || e);
    if (live) {
      console.error('[seed] LIVE MODE — the run stopped part-way, so some review rows may exist.');
      console.error('[seed] Run with --live --purge to remove whatever was created.');
    }
    await browser.close(); server.close(); process.exit(2);
  }
  await browser.close();

  console.log(summary(world, cfg, live));
  fs.writeFileSync(path.join(REPO, '.review-stack.json'),
                   JSON.stringify({ base, live, api: cfg.api, password: PW,
                                    accounts: ACCOUNTS, world }, null, 2));
  log('wrote .review-stack.json (gitignored) — machine-readable copy of the above');

  process.on('SIGINT', () => { log('shutting down the file server'); server.close(); process.exit(0); });
}

main().catch(e => { console.error('[seed] harness error:', e); process.exit(2); });

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
 * USAGE (needs Docker + the Supabase CLI):
 *   supabase start
 *   node testing/scripts/seed-review-stack.mjs      # seeds, serves, and blocks until Ctrl-C
 *   supabase stop --no-backup                       # when done
 *
 * Add --reset to wipe and re-seed an already-seeded stack.
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
function assertLocal(url, why) {
  const u = String(url || '');
  if (u.includes(PROD_REF) || /\.supabase\.co/i.test(u)) {
    console.error(`\n[seed] REFUSING TO RUN: ${why} points at a hosted Supabase project (${u}).`);
    console.error('[seed] This script creates users and writes characters. Local stack only. Aborting.\n');
    process.exit(3);
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(u)) {
    console.error(`\n[seed] REFUSING TO RUN: ${why} is not a loopback address (${u}).\n`);
    process.exit(3);
  }
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
// Static file server — rewrites js/supabase-client.js in flight so the app talks to the local stack
// without the repo being modified. The checked-in constants stay pointed at production, as they must.
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
      if (rel === 'js/supabase-client.js') {
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
const ACCOUNTS = {
  dm:    { email: 'dm@pact.test',      name: 'DM Morgan' },
  codm:  { email: 'codm@pact.test',    name: 'Co-DM Riley' },
  p1:    { email: 'player1@pact.test', name: 'Player Alex' },
  p2:    { email: 'player2@pact.test', name: 'Player Sam' },
  p3:    { email: 'player3@pact.test', name: 'Player Jo' },   // invited but never redeemed
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
    psql(cfg, `update public.profiles set display_name = ${lit(a.name)} where id = ${lit(uid[k])}`);
  }

  const dmCtx = await browser.newContext();
  const dmPage = await dmCtx.newPage();
  await signIn(dmPage, base, ACCOUNTS.dm.email);

  log('creating campaigns, rules and invites…');
  const world = await dmPage.evaluate(async () => {
    const c = await import('/PACT/js/campaign.js');

    // The main campaign: real rules, so the rule-filtering UI has something to filter.
    const main = await c.createCampaign('The Ashfall Compact');
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
    const bare = await c.createCampaign('Untitled Playtest');

    // An archived one, so the archive/unarchive UI is reachable without archiving a live campaign.
    const old = await c.createCampaign('The Sunken Crypt (finished)');
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

    return {
      main: { id: main.id, name: main.name, code: codeOf(main.id).invite_code,
              dmCode: codeOf(main.id).dm_invite_code },
      bare: { id: bare.id, name: bare.name, code: codeOf(bare.id).invite_code },
      old:  { id: old.id,  name: old.name },
      tokens: { live: liveTok, revoked: revokedTok, stale: staleTok, redeem: redeemTok },
    };
  });

  log('co-DM joining…');
  const coCtx = await browser.newContext();
  const coPage = await coCtx.newPage();
  await signIn(coPage, base, ACCOUNTS.codm.email);
  await coPage.evaluate(async (code) => {
    const c = await import('/PACT/js/campaign.js');
    await c.joinAsDm(code);
  }, world.main.dmCode);
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
  // and a review that only ever sees "Aldric Valor" can't tell whether it holds.
  psql(cfg, `update public.characters
                set name = ${lit(`Bob "The Knife" <b>O'Malley</b> & Sons ${'…'} ${'x'.repeat(60)}`)}
              where name = 'Untitled draft'`);

  await dmCtx.close();
  return world;
}

/** Postgres string literal — the seeded names contain quotes and angle brackets on purpose. */
function lit(s) { return `'${String(s).replace(/'/g, "''")}'`; }

// ---------------------------------------------------------------------------------------------
function summary(world, cfg) {
  const base = `http://localhost:${PORT}/PACT`;
  const rows = Object.entries(ACCOUNTS)
    .map(([k, a]) => `    ${a.email.padEnd(20)} ${PW}   (${a.name}${k === 'p3' ? ', invited only' : ''})`)
    .join('\n');
  return `
${'='.repeat(94)}
  PACT review stack is UP.  Ctrl-C to stop the server (then: supabase stop --no-backup)
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
    "${world.main.name}"      player code ${world.main.code}   DM code ${world.main.dmCode}
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
  const cfg = stackConfig();
  log(`local stack: ${cfg.api}`);

  const already = (psql(cfg, `select count(*)::int from information_schema.tables
                               where table_schema='public' and table_name='characters'`) || '').trim();
  if (already === '1' && !process.argv.includes('--reset')) {
    log('schema already present — re-applying is safe, but pass --reset to wipe seeded rows first.');
  }
  if (process.argv.includes('--reset')) {
    log('--reset: dropping the public schema and every seeded auth user');
    psql(cfg, 'drop schema if exists public cascade; create schema public;');
    psql(cfg, 'delete from auth.users');
  }
  applySchema(cfg);

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
    await browser.close(); server.close(); process.exit(2);
  }
  await browser.close();

  console.log(summary(world, cfg));
  fs.writeFileSync(path.join(REPO, '.review-stack.json'),
                   JSON.stringify({ base, password: PW, accounts: ACCOUNTS, world }, null, 2));
  log('wrote .review-stack.json (gitignored) — machine-readable copy of the above');

  process.on('SIGINT', () => { log('shutting down the file server'); server.close(); process.exit(0); });
}

main().catch(e => { console.error('[seed] harness error:', e); process.exit(2); });

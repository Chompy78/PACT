#!/usr/bin/env node
/**
 * PACT — signed-in cloud path regression tests, against a LOCAL Supabase stack.
 *
 * WHY THIS EXISTS. Parity, audit, log-fuzz, character-gen-e2e and lighthouse all run without a signed-in
 * session, so the entire cloud half of the app — invites, redemption, campaign binding, cloud save/load,
 * AP grants, My Characters — shipped ungated. On 2026-08-03 five defects reached production green through
 * every one of those checks, all of them in this gap.
 *
 * The test database is built from sql/schema.sql + sql/rls-policies.sql, NOT by replaying
 * sql/migrations/. Verified that those two reproduce production exactly (8 tables, every column, 25
 * functions), so this tests the schema that actually ships rather than the historical path to it.
 *
 * USAGE (needs Docker + the Supabase CLI):
 *   supabase start
 *   node testing/scripts/cloud-e2e.mjs
 *   supabase stop
 *
 * CI runs it via .github/workflows/cloud-e2e.yml.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 7970;

// ---------------------------------------------------------------------------------------------
// PRODUCTION GUARD — first, and unconditional.
// ---------------------------------------------------------------------------------------------
// A harness that creates users, issues invites and mutates characters must never be able to reach the
// real project. This asserts on the URL rather than merely defaulting away from it, so a stray env var
// or a copy-pasted key cannot quietly point a destructive test run at live player data.
const PROD_REF = 'piuprrrnaotrtxucrtsb';
function assertLocal(url, why) {
  const u = String(url || '');
  if (u.includes(PROD_REF) || /\.supabase\.co/i.test(u)) {
    console.error(`\n[cloud-e2e] REFUSING TO RUN: ${why} points at a hosted Supabase project (${u}).`);
    console.error('[cloud-e2e] This harness creates users and mutates characters. It runs against a local');
    console.error('[cloud-e2e] `supabase start` stack only. Aborting before touching anything.\n');
    process.exit(3);
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(u)) {
    console.error(`\n[cloud-e2e] REFUSING TO RUN: ${why} is not a loopback address (${u}).\n`);
    process.exit(3);
  }
}

// ---------------------------------------------------------------------------------------------
// Local stack discovery
// ---------------------------------------------------------------------------------------------
function stackConfig() {
  let raw;
  try {
    raw = execSync('supabase status -o json', { cwd: REPO, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
  } catch (e) {
    console.error('[cloud-e2e] `supabase status` failed — is the stack running? Try `supabase start`.');
    console.error(String(e.stderr || e.message).slice(0, 400));
    process.exit(2);
  }
  const j = JSON.parse(raw);
  const cfg = {
    api: j.API_URL || j.api_url,
    anon: j.ANON_KEY || j.anon_key,
    service: j.SERVICE_ROLE_KEY || j.service_role_key,
    db: j.DB_URL || j.db_url,
  };
  assertLocal(cfg.api, 'the stack API URL');
  assertLocal((cfg.db || '').replace(/^postgresql:\/\/[^@]*@/, 'http://'), 'the stack database URL');
  return cfg;
}

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------
let failures = 0, checks = 0;
const log = m => console.log(`[cloud-e2e] ${m}`);
function check(name, ok, detail = '') {
  checks++; if (!ok) failures++;
  console.log(`[cloud-e2e]   ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
function section(t) { console.log(`[cloud-e2e]\n[cloud-e2e] == ${t} ==`); }

// ---------------------------------------------------------------------------------------------
// Static file server. Rewrites js/supabase-client.js on the fly so the app talks to the local stack
// without the repo being modified — the checked-in constants stay pointed at production, as they must.
// ---------------------------------------------------------------------------------------------
const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
               '.json':'application/json', '.css':'text/css', '.png':'image/png', '.webp':'image/webp' };
function makeServer(cfg) {
  return http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/PACT\/?/, '') || 'index.html';
    const file = path.join(REPO, rel);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      let body = data;
      if (rel === 'js/supabase-client.js') {
        body = Buffer.from(String(data)
          .replace(/export const SUPABASE_URL = '[^']*';/,
                   `export const SUPABASE_URL = '${cfg.api}';`)
          .replace(/export const SUPABASE_PUBLISHABLE_KEY = '[^']*';/,
                   `export const SUPABASE_PUBLISHABLE_KEY = '${cfg.anon}';`));
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
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
const createUser = (cfg, email, password) =>
  admin(cfg, '/auth/v1/admin/users', { method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }) });
const sql = (cfg, query) =>
  admin(cfg, '/rest/v1/rpc/_e2e_sql', { method: 'POST', body: JSON.stringify({ q: query }) });

// ---------------------------------------------------------------------------------------------
// Schema bootstrap
// ---------------------------------------------------------------------------------------------
function applySchema(cfg) {
  const dbUrl = cfg.db;
  for (const f of ['sql/schema.sql', 'sql/rls-policies.sql']) {
    try {
      // client_min_messages=warning silences the "policy ... does not exist, skipping" NOTICEs that
      // every `drop policy if exists` emits on a fresh database. Without it they flood stderr and, with
      // ON_ERROR_STOP, the real error is the LAST line — which an early slice of stderr cuts off. That
      // is exactly what made the first CI run unreadable.
      execSync(`psql "${dbUrl}" -v ON_ERROR_STOP=1 -q -f ${JSON.stringify(path.join(REPO, f))}`,
               { cwd: REPO, stdio: ['ignore','pipe','pipe'],
                 env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
      log(`applied ${f}`);
    } catch (e) {
      const err = String(e.stderr || e.message);
      console.error(`[cloud-e2e] failed applying ${f} (last 2000 chars of stderr):\n` + err.slice(-2000));
      process.exit(2);
    }
  }
  // A tiny SECURITY DEFINER helper so the harness can assert on database state directly. Created only
  // on the local stack, never in sql/ — it must not exist in production.
  execSync(`psql "${dbUrl}" -v ON_ERROR_STOP=1 -q -c ${JSON.stringify(`
    create or replace function public._e2e_sql(q text) returns jsonb
    language plpgsql security definer as $fn$
    declare r jsonb; begin
      execute 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (' || q || ') t' into r; return r;
    end $fn$;
    grant execute on function public._e2e_sql(text) to service_role;`)}`,
    { cwd: REPO, stdio: ['ignore','pipe','pipe'] });
  log('created the _e2e_sql assertion helper (local stack only)');
}

// ---------------------------------------------------------------------------------------------
// Page helper: sign in through the app's own auth module, not a side channel.
// ---------------------------------------------------------------------------------------------
async function signIn(page, base, email, password) {
  await page.goto(`${base}/login.html`, { waitUntil: 'load' });
  const res = await page.evaluate(async ({ email, password }) => {
    const mod = await import('/PACT/js/auth.js');
    try { await mod.login(email, password); const s = await mod.currentSession();
          return { ok: !!s, uid: s && s.user && s.user.id }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, { email, password });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.err || 'no session'}`);
  return res.uid;
}

// ---------------------------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------------------------
async function run() {
  const cfg = stackConfig();
  log(`local stack: ${cfg.api}`);
  applySchema(cfg);

  const stamp = Date.now();
  const dmEmail = `dm+${stamp}@pact.test`;
  const plEmail = `player+${stamp}@pact.test`;
  const PW = 'e2e-password-1234';
  const dmUser = await createUser(cfg, dmEmail, PW);
  const plUser = await createUser(cfg, plEmail, PW);
  log(`created DM ${dmUser.id} and player ${plUser.id}`);

  const server = makeServer(cfg);
  await new Promise(r => server.listen(PORT, r));
  const base = `http://localhost:${PORT}/PACT`;
  const browser = await chromium.launch();

  try {
    // ---- 1. DM creates a campaign and an invite carrying AP + a note ----
    section('invite round-trip');
    const dmCtx = await browser.newContext();
    const dmPage = await dmCtx.newPage();
    await signIn(dmPage, base, dmEmail, PW);
    const made = await dmPage.evaluate(async () => {
      const c = await import('/PACT/js/campaign.js');
      const camp = await c.createCampaign('E2E Campaign');
      const token = await c.createPlayerInvite(camp.id, 36, 'Rusty — replacement rogue');
      return { campaignId: camp.id, token };
    });
    check('DM creates a campaign and an invite', !!made.token, `campaign ${made.campaignId}`);

    // ---- 2. Player redeems it; ap must equal the grant, and an ap_awards row must exist ----
    const plCtx = await browser.newContext();
    const plPage = await plCtx.newPage();
    await signIn(plPage, base, plEmail, PW);
    const redeemed = await plPage.evaluate(async (token) => {
      const c = await import('/PACT/js/campaign.js');
      return await c.redeemPlayerInvite(token, 'Cedric Brightblade');
    }, made.token);
    check('redemption returns the full grant as DM AP', redeemed.startingAp === 36,
          `startingAp=${redeemed.startingAp}`);
    check('redemption seeds NO player-AP budget', redeemed.startingBudget === 0,
          `startingBudget=${redeemed.startingBudget}`);

    const row = (await sql(cfg, `select ap, campaign_id is not null as bound from characters
                                 where id = '${redeemed.characterId}'`))[0];
    check('characters.ap equals the grant', row && row.ap === 36, `ap=${row && row.ap}`);
    check('the character is bound to the campaign', row && row.bound === true);

    const awards = await sql(cfg, `select amount, note from ap_awards
                                   where character_id = '${redeemed.characterId}'`);
    check('the grant is recorded in ap_awards', awards.length === 1 && awards[0].amount === 36,
          JSON.stringify(awards));
    check('the award carries the DM note', awards.length === 1 && /Rusty/.test(awards[0].note || ''),
          awards.length ? JSON.stringify(awards[0].note) : 'no row');

    // ---- 3. The DM's note must NOT be readable by the player ----
    section('invite note is DM-only');
    const noteRead = await plPage.evaluate(async () => {
      const { supabase } = await import('/PACT/js/supabase-client.js');
      const r = await supabase.from('campaign_invites').select('note');
      return { err: r.error ? r.error.message : null, data: r.data };
    });
    check('player selecting note is refused', !!noteRead.err,
          noteRead.err ? noteRead.err.slice(0, 80) : `LEAKED: ${JSON.stringify(noteRead.data)}`);

    const dmSees = await dmPage.evaluate(async (cid) => {
      const c = await import('/PACT/js/campaign.js');
      const list = await c.listCampaignInvites(cid);
      return list.map(i => i.note);
    }, made.campaignId);
    check('the DM still sees the note via the RPC', dmSees.some(n => /Rusty/.test(n || '')),
          JSON.stringify(dmSees));

    // ---- 4. ignore_player_ap must not change spendable when the AP is DM-granted ----
    section('ignore_player_ap does not discard a DM grant');
    const spend = await plPage.evaluate(async (charId) => {
      const eng = await import('/PACT/js/engine.js');
      const s = await import('/PACT/js/sync.js');
      const rec = await s.loadCharacter(charId);
      const b = eng.foldBuild((rec.stats && rec.stats.LOG) || []);
      const off = eng.compute(b, { dmAp: rec.ap, ignorePlayerAp: false }).spendable;
      const on  = eng.compute(b, { dmAp: rec.ap, ignorePlayerAp: true  }).spendable;
      return { off, on, playerAp: b.budget || 0 };
    }, redeemed.characterId);
    check('spendable is the grant with ignore_player_ap OFF', spend.off === 36, `=${spend.off}`);
    check('spendable is the grant with ignore_player_ap ON',  spend.on  === 36, `=${spend.on}`);
    check('no player-AP award was seeded', spend.playerAp === 0, `playerAp=${spend.playerAp}`);

    // ---- 5. A revoked invite must not redeem ----
    section('revoked invites are refused');
    const second = await dmPage.evaluate(async (cid) => {
      const c = await import('/PACT/js/campaign.js');
      const token = await c.createPlayerInvite(cid, 10, 'to be withdrawn');
      const list = await c.listCampaignInvites(cid);
      const inv = list.find(i => i.token === token);
      await c.setInviteRevoked(inv.id, true);
      return token;
    }, made.campaignId);
    const refused = await plPage.evaluate(async (token) => {
      const c = await import('/PACT/js/campaign.js');
      try { await c.redeemPlayerInvite(token, 'Should Not Exist'); return { redeemed: true }; }
      catch (e) { return { redeemed: false, err: e.message }; }
    }, second);
    check('a withdrawn invite cannot be redeemed', refused.redeemed === false,
          refused.err ? refused.err.slice(0, 70) : 'IT REDEEMED');
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`[cloud-e2e]\n[cloud-e2e] ${failures ? failures + ' of ' + checks + ' checks FAILED'
                                                   : 'all ' + checks + ' checks passed'}`);
  process.exit(failures ? 1 : 0);
}

run().catch(e => { console.error('[cloud-e2e] harness error:', e); process.exit(2); });

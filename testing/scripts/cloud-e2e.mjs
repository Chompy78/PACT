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
// Assertions read the database directly through psql on STDIN. Two things this avoids: shell quoting
// (an earlier version passed multi-line, dollar-quoted SQL via `-c` and psql read the literal \n escapes
// as backslash commands — "invalid command \n"), and creating a SECURITY DEFINER function that executes
// arbitrary SQL just so a test can look at a table. Nothing is added to the database at all.
function sql(cfg, query) {
  const wrapped = `select coalesce(jsonb_agg(t), '[]'::jsonb) from (${query}) t;`;
  const out = execSync(`psql "${cfg.db}" -At -f -`, {
    input: wrapped, encoding: 'utf8', cwd: REPO, stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
  });
  return JSON.parse(out.trim() || '[]');
}
// Same channel, for a statement that CHANGES something rather than reading it. Kept separate because
// sql() wraps its argument in `select ... from (<query>) t` — a subquery, which Postgres will not let a
// data-modifying statement (or a data-modifying CTE, which is only legal at the top level) appear in.
// Used only to set up server-side state a client RPC deliberately cannot reach, e.g. unbinding a
// character so the rebind path can be tested.
function exec(cfg, statement) {
  execSync(`psql "${cfg.db}" -v ON_ERROR_STOP=1 -q -At -f -`, {
    input: statement.endsWith(';') ? statement : statement + ';', encoding: 'utf8', cwd: REPO,
    stdio: ['pipe','pipe','pipe'],
    env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' },
  });
}

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

    const row = (sql(cfg, `select ap, campaign_id is not null as bound from characters
                                 where id = '${redeemed.characterId}'`))[0];
    check('characters.ap equals the grant', row && row.ap === 36, `ap=${row && row.ap}`);
    check('the character is bound to the campaign', row && row.bound === true);

    const awards = sql(cfg, `select amount, note from ap_awards
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
    // ---- 6. Archiving must actually hide a character from the tools that load characters ----
    // The task that produced this said "no automated gate catches this — pure reliance on someone
    // noticing". listMyCharacters() always returned archived_at; CharGen's and the Live Sheet's own
    // cloud-load menus simply never looked at it, so an archived character stayed fully playable in the
    // two tools where characters are actually used.
    section('archiving hides a character from the load menus');
    const beforeArchive = await plPage.evaluate(async () => {
      const s = await import('/PACT/js/sync.js');
      return (await s.listMyCharacters()).length;
    });
    await plPage.evaluate(async (id) => {
      const s = await import('/PACT/js/sync.js');
      await s.archiveCharacter(id);
    }, redeemed.characterId);

    const arch = (sql(cfg, `select archived_at is not null as archived from characters
                            where id = '${redeemed.characterId}'`))[0];
    check('archiveCharacter sets archived_at', arch && arch.archived === true);

    const menus = await plPage.evaluate(async () => {
      const s = await import('/PACT/js/sync.js');
      const all = await s.listMyCharacters();
      // Exactly the filters the two cloud-load menus apply.
      return {
        total: all.length,
        chargen:   all.filter(c => c.kind === 'chargen'   && !c.archived_at).length,
        livesheet: all.filter(c => c.kind === 'livesheet' && !c.archived_at).length,
        archivedStillListed: all.filter(c => c.archived_at).length,
      };
    });
    check('the row is still returned (tagged), not dropped from the API', menus.archivedStillListed === 1,
          `${menus.archivedStillListed} archived row(s) in listMyCharacters()`);
    check('CharGen\'s load menu excludes it', menus.chargen === 0, `${menus.chargen} selectable`);
    check('the character count is unchanged overall', menus.total === beforeArchive,
          `${beforeArchive} -> ${menus.total}`);

    // ---- 7. Archiving a campaign hides it from the pickers, but not from the DM's unarchive list ----
    section('archiving a campaign hides it from the pickers');
    await dmPage.evaluate(async (cid) => {
      const c = await import('/PACT/js/campaign.js');
      await c.archiveCampaign(cid);
    }, made.campaignId);
    const camps = await dmPage.evaluate(async (cid) => {
      const c = await import('/PACT/js/campaign.js');
      const dflt = await c.listMyCampaigns();
      const incl = await c.listMyCampaigns({ includeArchived: true });
      return { inDefault: dflt.some(x => x.id === cid), inIncluded: incl.some(x => x.id === cid) };
    }, made.campaignId);
    check('an archived campaign is gone from the default list', camps.inDefault === false);
    check('it is still there with includeArchived (so it can be unarchived)', camps.inIncluded === true);

    // ---- 8. A zero-row archive must fail loudly, not report false success ----
    section('archiving a vanished character fails loudly');
    const ghost = await plPage.evaluate(async () => {
      const s = await import('/PACT/js/sync.js');
      try { await s.archiveCharacter('00000000-0000-4000-8000-000000000000'); return { threw: false }; }
      catch (e) { return { threw: true, msg: e.message }; }
    });
    check('archiving a non-existent character throws', ghost.threw === true,
          ghost.threw ? ghost.msg.slice(0, 60) : 'reported success with nothing changed');

    // ---- 9. Joining by the shared campaign code grants the campaign's starting AP ----
    // Previously bind_character_to_campaign only set campaign_id, so a player who joined with the code
    // landed on 0 AP silently — no error, nothing on screen, and a roster entry with no recorded reason.
    section('joining by code grants the campaign starting AP');
    const joinCamp = await dmPage.evaluate(async () => {
      const c = await import('/PACT/js/campaign.js');
      const camp = await c.createCampaign('E2E Join-Code Campaign');
      await c.setCampaignRules(camp.id, { startingTier: { preset: 'custom', ap: 45 } });
      const fresh = await c.listMyCampaigns();
      return { id: camp.id, code: (fresh.find(x => x.id === camp.id) || camp).invite_code };
    });

    // A second player, so the one-character-per-campaign rule doesn't collide with scenario 1.
    const pl2Email = `player2+${stamp}@pact.test`;
    await createUser(cfg, pl2Email, PW);
    const pl2Ctx = await browser.newContext();
    const pl2Page = await pl2Ctx.newPage();
    await signIn(pl2Page, base, pl2Email, PW);

    const joined = await pl2Page.evaluate(async (code) => {
      const s = await import('/PACT/js/sync.js');
      const c = await import('/PACT/js/campaign.js');
      const id = s.newCharacterId();
      await s.saveCharacter({ id, name: 'Joined By Code', kind: 'chargen', stats: { LOG: [], SEQ: 1 } });
      await c.bindCharacterToCampaign(id, code);
      return id;
    }, joinCamp.code);

    const jrow = (sql(cfg, `select ap, campaign_id is not null as bound from characters
                            where id = '${joined}'`))[0];
    check('the joined character receives the tier AP', jrow && jrow.ap === 45, `ap=${jrow && jrow.ap}`);
    check('and is bound to the campaign', jrow && jrow.bound === true);
    const jaw = sql(cfg, `select amount, note from ap_awards where character_id = '${joined}'`);
    check('the join grant has provenance in ap_awards',
          jaw.length === 1 && jaw[0].amount === 45, JSON.stringify(jaw));

    // Rebinding must not pay a second time. Two DISTINCT paths reach that promise and both need
    // covering, because they are guarded by different code:
    //   (a) still bound to this campaign -> the `v_char.campaign_id = v_campaign.id` early return,
    //       which exits before the grant block is even reached;
    //   (b) no longer bound, but previously paid -> the `not exists (select 1 from ap_awards ...)`
    //       guard, the only thing standing between a re-join and a second free budget.
    // Only (a) was covered here, so the ap_awards guard — the one that actually matters — was never
    // executed by this suite at all; deleting it outright would have left every check green.
    await pl2Page.evaluate(async ({ id, code }) => {
      const c = await import('/PACT/js/campaign.js');
      await c.bindCharacterToCampaign(id, code);
    }, { id: joined, code: joinCamp.code });
    const again = (sql(cfg, `select ap from characters where id = '${joined}'`))[0];
    check('rebinding while still bound does not grant twice', again && again.ap === 45,
          `ap=${again && again.ap}`);

    // (b): unbind server-side (no client RPC unbinds — a DM does this out of band), then re-join with
    // the same code. campaign_id is null again, so the early return can't fire and the bind runs the
    // grant block for real; the ap_awards row from the first join is what must stop the second payout.
    exec(cfg, `update characters set campaign_id = null where id = '${joined}'`);
    await pl2Page.evaluate(async ({ id, code }) => {
      const c = await import('/PACT/js/campaign.js');
      await c.bindCharacterToCampaign(id, code);
    }, { id: joined, code: joinCamp.code });
    const rejoined = (sql(cfg, `select ap, campaign_id is not null as bound
                                 from characters where id = '${joined}'`))[0];
    check('re-joining after an unbind rebinds the character', rejoined && rejoined.bound === true);
    check('re-joining after an unbind does not grant again', rejoined && rejoined.ap === 45,
          `ap=${rejoined && rejoined.ap}`);
    const jaw2 = sql(cfg, `select amount from ap_awards where character_id = '${joined}'`);
    check('and adds no second ap_awards row', jaw2.length === 1, JSON.stringify(jaw2));

    // ---- 10. The join grant reads a real-world `rules` blob, not just a well-formed one ----
    // `campaigns.rules` is free-form jsonb a DM edits, and it is `not null default '{}'` while
    // createCampaign() inserts only {name, dm_id} — so "no startingTier at all" is the COMMON case,
    // not an edge one. Both branches below were wrong before this PR: the absent case granted 0
    // (while DM Console displayed 79), and an over-int32 figure passed the digits-only regex and then
    // overflowed the ::integer cast, aborting the whole join transaction.
    section('the join grant survives a real-world rules blob');
    const oddCamps = await dmPage.evaluate(async () => {
      const c = await import('/PACT/js/campaign.js');
      // Left exactly as createCampaign() makes it: rules = '{}', no startingTier key.
      const bare = await c.createCampaign('E2E Bare-Rules Campaign');
      const huge = await c.createCampaign('E2E Overflow-Rules Campaign');
      await c.setCampaignRules(huge.id, { startingTier: { preset: 'custom', ap: '2147483648' } });
      const fresh = await c.listMyCampaigns();
      const code = id => (fresh.find(x => x.id === id) || {}).invite_code;
      return { bare: code(bare.id), huge: code(huge.id) };
    });

    // A fresh player per campaign — one character per campaign, and a joined character can't move.
    const joinAs = async (label, code) => {
      const email = `player-${label}+${stamp}@pact.test`;
      await createUser(cfg, email, PW);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await signIn(page, base, email, PW);
      const res = await page.evaluate(async (c) => {
        const s = await import('/PACT/js/sync.js');
        const cm = await import('/PACT/js/campaign.js');
        const id = s.newCharacterId();
        await s.saveCharacter({ id, name: 'Odd Rules', kind: 'chargen', stats: { LOG: [], SEQ: 1 } });
        try { await cm.bindCharacterToCampaign(id, c); return { id, ok: true }; }
        catch (e) { return { id, ok: false, err: String(e && e.message || e) }; }
      }, code);
      await ctx.close();
      return res;
    };

    const bareJoin = await joinAs('bare', oddCamps.bare);
    check('a campaign with no startingTier still lets a player join', bareJoin.ok, bareJoin.err);
    const bareRow = (sql(cfg, `select ap from characters where id = '${bareJoin.id}'`))[0];
    check('and grants the default 79 the UI advertises', bareRow && bareRow.ap === 79,
          `ap=${bareRow && bareRow.ap}`);

    const hugeJoin = await joinAs('huge', oddCamps.huge);
    check('an out-of-range startingTier does not abort the join', hugeJoin.ok, hugeJoin.err);
    const hugeRow = (sql(cfg, `select ap, campaign_id is not null as bound
                                from characters where id = '${hugeJoin.id}'`))[0];
    check('and the character is bound anyway', hugeRow && hugeRow.bound === true);
    check('and grants nothing rather than overflowing', hugeRow && hugeRow.ap === 0,
          `ap=${hugeRow && hugeRow.ap}`);

  } finally {
    await browser.close();
    server.close();
  }

  console.log(`[cloud-e2e]\n[cloud-e2e] ${failures ? failures + ' of ' + checks + ' checks FAILED'
                                                   : 'all ' + checks + ' checks passed'}`);
  process.exit(failures ? 1 : 0);
}

run().catch(e => { console.error('[cloud-e2e] harness error:', e); process.exit(2); });

// A small stateful stand-in for the house-rules server half (PR3's dm_apply_house_rules_change / dm_edit_character_log),
// shared by dm-campaign-house-rules-e2e.mjs (the campaign editor, PR4) and dm-house-rules-e2e.mjs (the per-character
// overrides, PR5). It stamps events the way the RPC does (seq / ts / dmEdit / dmId / campaignId; refund and grant-back from
// the target) and makes the reprice checks the RPC makes (M3: from = the purchase's current grant, to = its effective value
// after the earlier actions of the same call, amount = to − from), using the engine. The SQL itself is rehearsed by
// creation-lock-guard-test/run-house-rules.sh, and the calls the console really sends are replayed against it by
// run-dm-house-rules-replay.sh (--dump-calls <file> writes them).
export function createHouseRulesHarness({ E, CR, CAMP, RULES0, CHARS0, browser, PORT, extraDmEditTypes }) {
  const clone = o => JSON.parse(JSON.stringify(o));
  const srv = { rules: clone(RULES0), chars: clone(CHARS0), calls: [], missing: false, refuse: null, staleRead: null };
  const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v;
  const sameJson = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const nextSeq = log => log.reduce((m, e) => Math.max(m, Number(e && e.seq) || 0), 0) + 1;
  const browserApLeft = (log, rules, dmAp) => E.compute(E.withHouseRulesCtx(E.foldBuild(log), CR.houseRulesCtxFromRules(rules, CAMP)), { dmAp: dmAp || 0 }).spendable - E.economy(log).spent;
  const serverApLeft = (log, rules, dmAp) => E.serverApLedger(log, { dmAp: dmAp || 0, houseRulesCtx: CR.houseRulesCtxFromRules(rules, CAMP) }).apLeft;
  const dump = { campaign: CAMP, scenarios: [] };
  let scn = null;
  function closeScenario() {
    if (!scn) return;
    scn.expect = srv.chars.map(c => ({ id: c.id, name: c.name, apLeft: browserApLeft(c.LOG, srv.rules, c.ap) }));
    dump.scenarios.push(scn); scn = null;
  }
  // expected: the RPC's p_expected ({charHouseRules: X} or null = no check) — PR #658 review, two DMs at once.
  function rpcApply(campaign, chr, actions, expected) {
    if (srv.missing) { const e = new Error('Could not find the function public.dm_apply_house_rules_change(p_actions, p_campaign, p_char_house_rules) in the schema cache'); e.code = 'PGRST202'; throw e; }
    if (srv.refuse) throw new Error(srv.refuse);
    if (campaign !== CAMP) throw new Error('Only a campaign DM can change its house rules');
    if (expected !== undefined && expected !== null && !sameJson(srv.rules.charHouseRules ?? null, expected.charHouseRules))
      throw new Error('PACT house rules: another DM changed this campaign\'s character house rules since you loaded them — reload and make your change again');
    const rules = clone(srv.rules);
    if (chr !== undefined && chr !== null) rules.charHouseRules = chr;
    const chars = clone(srv.chars), out = [];
    for (const a of actions || []) {
      const c = chars.find(x => x.id === a.character); if (!c) throw new Error('PACT house rules: action — that character is not in this campaign');
      let ev;
      if (a.kind === 'override' || a.kind === 'pin') {
        if (!a.overrides || typeof a.overrides !== 'object' || Array.isArray(a.overrides)) throw new Error('PACT house rules: must be an object');
        if ('expected' in a) {
          const by = E.foldBuild(c.LOG)._dmHouseRulesByCampaign, cur = by && Object.prototype.hasOwnProperty.call(by, CAMP) ? by[CAMP] : null;
          if (!sameJson(cur, a.expected)) throw new Error('PACT house rules: action — another DM changed this character\'s house-rule overrides since you loaded them — reload and make your change again');
        }
        ev = { type: 'dmHouseRules', overrides: a.overrides, label: a.label || 'DM house rules for this character' };
      } else {
        const lk = c.LOG.map(e => e.type).lastIndexOf('creationLocked'), ul = c.LOG.map(e => e.type).lastIndexOf('creationUnlocked');
        if (lk < 0 || ul > lk) throw new Error('PACT house rules: action — the character has not finished creation');
        const ae = E.activeEvents(c.LOG);
        const idx = ae.evs.findIndex(e => e.type === 'buy' && e.seq === a.targetSeq && e.payload && e.payload.v === a.name && e.cat === (a.kind === 'refundBoon' ? 'boon' : 'drawback'));
        if (idx < 0) throw new Error('PACT house rules: action — no purchase "' + a.name + '" at seq ' + a.targetSeq);
        const t = ae.evs[idx], grant = -Number(t.cost) + (ae.drawRepriced.get(idx) || 0);
        if (a.kind === 'refundBoon') { if (t.dmEdit) throw new Error('was granted by a DM'); ev = { type: 'dmRefundBoon', refVal: a.name, targetSeq: a.targetSeq, cost: -Number(t.cost) }; }
        else if (a.kind === 'removeDrawback') ev = { type: 'dmRemoveDrawback', refVal: a.name, targetSeq: a.targetSeq, grantBack: grant };
        else if (a.kind === 'reprice') {
          const eff = E.drawbackValue(E.withHouseRulesCtx(E.foldBuild(c.LOG), CR.houseRulesCtxFromRules(rules, CAMP)), a.name);
          if (a.from !== grant) throw new Error('PACT house rules: from (' + a.from + ') is not the purchase\'s current grant (' + grant + ')');
          if (a.to !== eff) throw new Error('PACT house rules: to (' + a.to + ') is not the effective value (' + eff + ')');
          if (a.amount !== a.to - a.from || a.amount === 0) throw new Error('PACT house rules: amount must be to − from');
          ev = { type: 'dmRepriceDrawback', refVal: a.name, targetSeq: a.targetSeq, amount: a.amount, from: a.from, to: a.to };
        } else throw new Error('PACT house rules: unknown kind ' + a.kind);
        if (a.label) ev.label = a.label;
      }
      Object.assign(ev, { campaignId: CAMP, seq: nextSeq(c.LOG), ts: 3, dmEdit: true, dmId: 'dm' });
      c.LOG.push(ev); out.push({ character: c.id, event: ev });
    }
    if ((actions && actions.length) || (chr !== undefined && chr !== null)) {
      closeScenario();
      scn = { rules0: clone(srv.rules), chars0: clone(srv.chars), chr, actions: clone(actions || []), expected: expected ?? null, dmEdits: [] };
    }
    srv.rules = rules; srv.chars = chars;   // all or nothing
    return { charHouseRules: rules.charHouseRules ?? null, events: out };
  }
  const DM_EDIT_TYPES = ['dmRemoveBoon'].concat(extraDmEditTypes || []);
  function dmEdit(cid, events) {
    const c = srv.chars.find(x => x.id === cid); if (!c) throw new Error('Character not found');
    for (const e of events) { if (DM_EDIT_TYPES.indexOf(e.type) < 0) throw new Error('dm_edit_character_log: unsupported event type ' + e.type);
      c.LOG.push(Object.assign({}, e, { seq: nextSeq(c.LOG), ts: 4, dmEdit: true, dmId: 'dm' })); }
    if (scn) scn.dmEdits.push({ character: cid, events: clone(events) });
    return events;
  }
  const rosterRows = () => srv.chars.map(c => ({ id: c.id, name: c.name, ap: c.ap, stats: { LOG: c.LOG, SEQ: nextSeq(c.LOG) }, archived: !!c.archived, isNpc: false }));
  const applyCalls = () => srv.calls.filter(c => c.op === 'apply' && (c.a.actions.length || (c.a.chr !== undefined && c.a.chr !== null)));
  const reset = () => { closeScenario(); srv.staleRead = null; srv.rules = clone(RULES0); srv.chars = clone(CHARS0); srv.calls.length = 0; srv.missing = false; srv.refuse = null; };
  // A DM Console page wired to this server, with a campaign selected and its rules loaded.
  async function openDm(opts) {
    const o = opts || {};
    const c = await browser.newContext({ viewport: { width: 1200, height: 1000 } }); const p = await c.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.exposeFunction('__srv', (op, a) => {
      try {
        srv.calls.push({ op, a: clone(a || null) });
        if (op === 'roster') return { ok: rosterRows() };
        if (op === 'apply') return { ok: rpcApply(a.campaign, a.chr, a.actions, a.expected) };
        if (op === 'campaign') return { ok: { id: CAMP, name: 'Camp', rules: srv.staleRead || srv.rules, ignore_player_ap: false } };
        if (op === 'dmEdit') return { ok: dmEdit(a.cid, a.events) };
        if (op === 'setRules') { srv.rules = a.rules; return { ok: null }; }
        return { ok: null };
      } catch (e) { return { err: { message: e.message, code: e.code } }; }
    });
    await p.goto(`http://localhost:${PORT}/PACT/tools/DM-Console.html`, { waitUntil: 'load' });
    await p.waitForFunction(() => !!window._campBridge && typeof window._dmRenderCloudRoster === 'function' && !!window._dmCharHouseRulesTest, { timeout: 20000 });
    await p.evaluate(({ camp, rules }) => {
      const B = window._campBridge;
      const call = (op, a) => window.__srv(op, a).then(r => { if (r.err) { const e = new Error(r.err.message); e.code = r.err.code; throw e; } return r.ok; });
      window.__alerts = []; window.__reloads = 0;
      window.alert = m => { window.__alerts.push(String(m)); };
      window.confirm = () => true;
      B.listCampaignInvites = () => Promise.resolve([]);
      B.getHouseRulesRoster = () => call('roster');
      B.getRoster = () => call('roster').then(rs => rs.map(r => Object.assign({ player: 'P', playerLabel: '', dmNotes: '', customFields: {} }, r)));
      B.dmApplyHouseRulesChange = (c, chr, actions, expected) => call('apply', { campaign: c, chr, actions: actions || [], expected: expected === undefined ? null : { charHouseRules: expected } });
      B.getCampaign = () => call('campaign');
      B.dmEditCharacterLog = (cid, events) => call('dmEdit', { cid, events });
      B.setCampaignRules = (c, r) => call('setRules', { rules: r });
      window._dmSetCampaignsTest([{ id: camp, name: 'Camp', rules, isOwner: true, ignore_player_ap: false }]);
      window._dmSetCampIdTest(camp);
      window._dmCampaignApRules = { ignorePlayerAp: false, campaignId: camp, customFields: {}, rules };
      window._dmRulesPanel.load(rules);
    }, { camp: CAMP, rules: srv.rules });
    if (o.openEditor !== false) await p.evaluate(() => { document.getElementById('campCharHouseRulesDetails').open = true; document.getElementById('campRulesDetails').open = true; });
    await p.waitForTimeout(200);
    return { c, p, errs };
  }
  const DUMP = (() => { const i = process.argv.indexOf('--dump-calls'); return i > 0 ? process.argv[i + 1] : null; })();
  async function writeDump(fs) {
    closeScenario();
    if (DUMP) { fs.writeFileSync(DUMP, JSON.stringify(dump)); console.log(`dumped ${dump.scenarios.length} accepted change(s) to ${DUMP}`); }
  }
  return { srv, nextSeq, reset, openDm, applyCalls, browserApLeft, serverApLeft, writeDump, rosterRows };
}

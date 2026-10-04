// Live repair transform for the six Amble histories (docs/plans/2026-10-04-amble-lock-repair.md). READ-ONLY: it reads exported
// rows, builds the repaired log for each, verifies it, prints a before/after report and writes candidate rows to a JSON file.
// It never talks to a database. (buildcopies.mjs made the renamed "lock check (DM copy)" review characters; THIS keeps every
// real event — names, awards, the sync note — and changes only what the plan lists.)
//
//   node repair.mjs <original.json> <snaps.json> <out.json> [Name] [--current <current.json>]
// <original.json> is the export taken BEFORE any repair write (the purchase order is rebuilt from it); --current is a fresh export, used only
// to carry over a sessionSeal a character has gained since (appended verbatim at the end of the repaired log).
//
// What changes (plan §1): the lock events are replaced by ONE creationLocked at the agreed point; ONE creationLockConfig carries
// the DM limit; every purchase's `cost` is re-stamped to its current-rules delta (Q1); gold/downtime are stamped on purchases
// AFTER the lock and removed from those before it (O1); `seq` is renumbered in array order. Nothing else.
import { readFileSync, writeFileSync } from 'node:fs';
import { compute, foldBuild as _foldBuild, economy, creationCeiling, purchaseCost, MUT, DATA } from '../../../js/engine.js';
// foldBuild() ALIASES the event payloads it folds (MUT.patch assigns the payload's objects into the build, and later indexed steps then mutate them
// IN PLACE), so folding a log that holds a spellcasting patch AND later cantrip/slot steps silently rewrites the patch event. Always fold a COPY.
const foldBuild = l => _foldBuild(JSON.parse(JSON.stringify(l)));
const argv = process.argv.slice(2); const ci = argv.indexOf('--current'); const currentP = ci >= 0 ? argv[ci + 1] : null; if (ci >= 0) argv.splice(ci, 2);
const [liveP, snapsP, outP, only] = argv;
const current = currentP ? JSON.parse(readFileSync(currentP, 'utf8')) : null;   // fresh export: used ONLY to carry over a sessionSeal gained since
const live = JSON.parse(readFileSync(liveP, 'utf8'));
const snaps = JSON.parse(readFileSync(snapsP, 'utf8'));
const OPTS = { drawbackCap: 12 };
const RULES = { economy: { band: 'standard' } };            // Amble's economy (campaigns.rules.economy.band)
const LABEL_DATE = '2026-10-04';

// Per character: where the ORDER of the purchases comes from, and the DM limit to (re)stamp (owner decisions, plan §1/§2).
// THE LOCK POINT IS COMPUTED, NOT CHOSEN (owner rule, 2026-10-04): everything up to and including the lock is creation, everything after it
// is in play — so the lock goes right BEFORE the purchase that takes spend past the ceiling (limit + drawbacks) and keeps it there, whatever
// that purchase costs. A crossing that dips back under never stuck; a character that never ends over the ceiling is locked at the end.
// LIMITS (owner decision U2, 2026-10-04): every limit is the AP the character EARNED through chapter 4 (the end of session 4, 2026-08-23 — when the
// creation lock was meant to fire), summed from ap_awards. Moss (79) and Archer (68) already matched; Skylar, Anders, Fenwick and Caspian had been
// stamped 4 AP lower (76/72/74/74) and are raised to 80/76/78/78. Caspian's later 73 is superseded the same way.
const PLAN = {
  'Moss Stormspud':       { mode: 'snap', at: '2026-09-08T12:03', limit: 79 },   // order rebuilt from a backup (CharGen flattened it)
  'Skylar':               { mode: 'snap', at: '2026-09-03T10:42', limit: 80 },
  'Fenwick Copperkettle': { mode: 'snap', at: '2026-09-10T12:58', limit: 78 },
  'Character':            { mode: 'live',                        limit: 68, rename: 'Archer' },   // the character is Archer (his player is Kendall)
  'Caspian':              { mode: 'live',                        limit: 78 },
  'Anders Pipeleaf':      { mode: 'live',                        limit: 76 },
};
const isLockEv = e => e.type === 'creationLocked' || e.type === 'creationUnlocked' || e.type === 'creationLockConfig';
const isPurchase = e => e.type === 'buy' || e.type === 'buyoff';
const clone = o => JSON.parse(JSON.stringify(o));
const pkey = e => e.cat === 'patch' ? 'P:' + Object.keys(e.payload?.patch || {}).sort().join(',') : null;
// events that are neither purchases nor lock bookkeeping (name, award, rulesSnapshot, econSetting …) — kept verbatim
const isMeta = e => !isPurchase(e) && !isLockEv(e);

function reconstruct(c, p) {
  const L = c.stats.LOG.filter(Boolean).map(clone);
  const meta = L.filter(isMeta);
  if (p.mode === 'snap') {
    const cur = L.filter(isPurchase);
    const snap = snaps.find(s => s.cur === c.name && s.t.startsWith(p.at));
    if (!snap) throw new Error(`no backup snapshot for ${c.name} at ${p.at}`);
    const pre = snap.log.filter(Boolean).filter(isPurchase).map(clone);
    const post = [];
    const used = {}; for (const e of pre) if (!pkey(e)) used[e.label] = (used[e.label] || 0) + 1;
    const preP = {}; for (const e of pre) if (pkey(e)) preP[pkey(e)] = JSON.stringify(e.payload);
    for (const e of cur) {
      if (pkey(e)) { if (preP[pkey(e)] !== JSON.stringify(e.payload)) post.push(e); }
      else if (used[e.label] > 0) used[e.label]--;
      else post.push(e);
    }
    return [...pre, ...post, ...meta];             // the full chronological order; name/award/sync notes sat at the end of these logs
  }
  return L.filter(e => !isLockEv(e));              // live order, lock-family events removed
}

// IN-PLAY PRICING IS PER STEP (owner, 2026-10-04). A CharGen slot record can bundle several purchases — Hit Dice 3 -> 5 is two level-ups;
// Archer's "Spellcasting (25 AP)" is eight (foundation, rank, 2 cantrips, 2 known spells, 2 slots). Gold and downtime are charged per
// purchase, so a lump lands in a far higher band (25 AP -> 1,500 gp / 180 d; its pieces total 75 gp / 21 d). Such a record is split into
// the same steps the Live Sheet would have recorded (cat hd / found / rank / cantrip / known / slot), the lock is placed against the STEPS
// (the ceiling can fall inside a bundle), and any bundle that ends up wholly BEFORE the lock is put back exactly as it was.
function explodeBundles(events) {
  const out = []; let bundleId = 0;
  for (const e of events) {
    const patch = e.type === 'buy' && e.cat === 'patch' && e.payload && e.payload.patch;
    const prev = patch ? foldBuild(out) : null;
    let steps = null;
    if (patch && Object.keys(patch).length === 1 && patch.hd != null && patch.hd - (prev.hd || 1) > 1) {
      steps = []; for (let h = (prev.hd || 1) + 1; h <= patch.hd; h++) steps.push({ cat: 'hd', payload: { to: h }, label: 'Level up \u2192 Hit Die ' + h });
    } else if (patch && patch.traditions && Object.keys(patch).every(k => k === 'traditions' || (k === 'dabblerCantrips' && !patch[k])) && !(prev.traditions || []).length
               && patch.traditions.length === 1 && patch.traditions[0].disciplines.length === 1) {
      const t = patch.traditions[0], d = t.disciplines[0];
      if (!d.bound && !(d.pactSlots) && !(d.arcanum || []).some(Boolean)) {
        steps = [{ cat: 'found', payload: { ti: 0, trad: t.name, disc: d.name }, label: `Foundation \u2014 ${t.name} / ${d.name}` }];
        for (let r = 1; r <= t.rank; r++) steps.push({ cat: 'rank', payload: { ti: 0, to: r }, label: `Tradition rank ${r}` });
        for (let c = 1; c <= (d.cantrips || 0); c++) steps.push({ cat: 'cantrip', payload: { ti: 0, di: 0, to: c }, label: `Cantrip ${c}` });
        (d.known || []).forEach((n, i) => { for (let k = 1; k <= n; k++) steps.push({ cat: 'known', payload: { ti: 0, di: 0, L: i + 1, to: k }, label: `Known level-${i + 1} spell ${k}` }); });
        (d.slots || []).forEach((n, i) => { for (let k = 1; k <= n; k++) steps.push({ cat: 'slot', payload: { ti: 0, di: 0, L: i + 1, to: k }, label: `Level-${i + 1} slot ${k}` }); });
      }
    }
    if (!steps) { out.push(e); continue; }
    const id = ++bundleId;
    steps.forEach((st, k) => out.push({ type: 'buy', cat: st.cat, payload: st.payload, label: st.label, cost: 0, level: e.level, rules: e.rules,
      ts: (e.ts || 0) + k, _bundle: id, _orig: e }));
  }
  return out;
}
// Put every bundle that has NO step after the lock back as the original record; merge the before-lock steps of a straddling bundle into one
// patch record (the value they fold to); leave after-lock steps as the per-step events.
function settleBundles(list, lockIdx) {
  const out = []; const ids = [...new Set(list.filter(e => e._bundle).map(e => e._bundle))];
  const info = {}; for (const id of ids) { const idxs = list.map((e, i) => e._bundle === id ? i : -1).filter(i => i >= 0); info[id] = { idxs, after: idxs.filter(i => i >= lockIdx) }; }
  let lockAt = 0;
  for (let i = 0; i < list.length; i++) {
    if (i === lockIdx) lockAt = out.length;
    const e = list[i]; const b = e._bundle ? info[e._bundle] : null;
    if (!b) { out.push(e); continue; }
    const first = b.idxs[0];
    if (!b.after.length) { if (i === first) out.push(clone(e._orig)); continue; }                       // wholly before the lock: original record
    const nBefore = b.idxs.length - b.after.length;
    if (nBefore > 0 && i === first) {                                                                    // straddles the lock: merged pre-lock part
      const base = foldBuild(out); const pre = list.slice(first, first + nBefore); const t = clone(base);
      pre.forEach(st => (MUT[st.cat] || (() => {}))(t, st.payload));
      const op = (e._orig.payload && e._orig.payload.patch) || {};
      const patch = pre[0].cat === 'hd' ? { hd: t.hd } : { traditions: t.traditions, ...(op.dabblerCantrips !== undefined ? { dabblerCantrips: op.dabblerCantrips } : {}) };
      out.push({ ...clone(e._orig), cost: 0, payload: { patch } });
    }
    if (i >= lockIdx) { const { _bundle, _orig, ...rest } = e; out.push(rest); }
  }
  if (lockIdx >= list.length) lockAt = out.length;
  return { events: out.map(({ _bundle, _orig, ...rest }) => rest), lockAt };
}

// The owner's rule. Running total (engine, current rules) after every event; the lock goes right BEFORE the LAST purchase that took
// spend from <= ceiling to > ceiling — provided the character ENDS over the ceiling. Otherwise it goes at the end.
function findLock(events, limit) {
  const total = i => compute(foldBuild(events.slice(0, i + 1)), OPTS).total;
  const fin = compute(foldBuild(events), OPTS), ceil = limit + (fin.drawbackAp || 0);
  if (fin.total <= ceil) return { idx: events.length, label: null, ceil };
  const run = events.map((_, i) => total(i)); let cross = -1;
  for (let i = 0; i < events.length; i++) { const prev = i ? run[i - 1] : 0; if (isPurchase(events[i]) && prev <= ceil && run[i] > ceil) cross = i; }
  return { idx: cross, label: events[cross].label, ceil, at: cross ? run[cross - 1] : 0, to: run[cross] };
}

// M1 (owner, 2026-10-04): drop zero-AP purchase records that PROVABLY change nothing — removing them leaves the folded build and the
// engine total byte-identical. Greedy, earliest first, re-tested after each removal, so of a repeated pair the LATEST (which holds
// the final value) is kept. Never the "Level 1 character" baseline marker, never a drawback, never a record that carries a choice.
function dropRepeats(log) {
  const sig = l => JSON.stringify(norm(foldBuild(l))) + '|' + compute(foldBuild(l), OPTS).total;
  const dropped = []; let changed = true;
  while (changed) {
    changed = false; const base = sig(log);
    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      // ONLY zero-cost slot ('patch') records can be repeats. A per-step purchase (hd / rank / cantrip / known / slot …) is a real, separately
      // priced purchase even when a later step makes it look redundant, so it must never be merged away.
      if (e.type !== 'buy' || e.cat !== 'patch' || (e.cost || 0) !== 0) continue;
      const t = log.filter((_, j) => j !== i);
      if (sig(t) === base) { dropped.push((e.label || e.cat || '').slice(0, 40)); log = t; changed = true; break; }
    }
  }
  return { log, dropped };
}

function build(c, p) {
  const exploded = explodeBundles(reconstruct(c, p));
  const lk = findLock(exploded, p.limit);
  const { events, lockAt } = settleBundles(exploded, lk.idx);
  p.why = lk.label ? `before ${lk.label} (the first purchase past the ceiling of ${lk.ceil} AP: ${lk.at} \u2192 ${lk.to})` : `at the end (spend never went past the ceiling of ${lk.ceil} AP)`;
  const lockTs = (events[lockAt - 1]?.ts || events[0]?.ts || Date.now()) + 1;
  const cfg = { type: 'creationLockConfig', payload: { threshold: p.limit }, dmEdit: true, ts: events[0]?.ts || Date.now(),
    label: `Creation limit set by DM \u2014 ${p.limit} AP (+ drawbacks) \u2014 the AP earned through chapter 4, set by the DM's history repair (${LABEL_DATE})`, rules: DATA.version };
  const lock = { type: 'creationLocked', systemEdit: true, ts: lockTs, rules: DATA.version,
    label: `Creation locked \u2014 placed ${p.why} by the DM's history repair (${LABEL_DATE})` };
  let log = [cfg, ...events.slice(0, lockAt), lock, ...events.slice(lockAt)];
  const rep = dropRepeats(log); log = rep.log;
  // A drawback keeps the grant the LIVE row stamped on it (a backup used to rebuild the order can carry a stale 0): carry it over.
  const liveDraw = {}; for (const e of c.stats.LOG) if (e && isPurchase(e) && e.cat === 'drawback') (liveDraw[e.label] ||= []).push(e.cost);
  for (const e of log) if (isPurchase(e) && e.cat === 'drawback' && liveDraw[e.label]?.length) e.cost = liveDraw[e.label].shift();
  // Q1: current-rules price per purchase (delta of the folded build); drawbacks keep their own grant
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (isPurchase(e) && e.cat !== 'drawback') {
      e.cost = compute(foldBuild(log.slice(0, i + 1)), OPTS).total - compute(foldBuild(log.slice(0, i)), OPTS).total;
    }
  }
  // O1: gold/downtime follow the lock — stamped after it, removed before it
  const li = log.findIndex(e => e.type === 'creationLocked');
  log.forEach((e, i) => {
    if (!isPurchase(e)) return;
    if (i > li && e.cat !== 'drawback') { const q = purchaseCost(e.cost || 0, RULES); if (q) { e.gp = q.gp; e.days = q.days; } }
    else { delete e.gp; delete e.days; }
  });
  if (p.rename) for (const e of log) if (e.type === 'name') { e.name = p.rename; e.label = 'Name \u2014 ' + p.rename; }   // restore the name the reload bug lost
  // a seal gained since the export is carried over verbatim, at the end (it freezes everything before it — it must stay last)
  const cur = current && current.find(x => x.id === c.id);
  if (cur) for (const e of cur.stats.LOG) if (e && e.type === 'sessionSeal' && !log.some(x => x.type === 'sessionSeal' && x.idem && x.idem === e.idem)) log.push(clone(e));
  log = log.map((e, i) => ({ ...e, seq: i + 1 }));
  return { log, li, dropped: rep.dropped };
}

// The invariant that matters: the repair must not change WHAT the character owns. Compare the full folded build before and
// after (keys starting with "_" are derived/ordering state — e.g. per-trait lock flags — and are skipped; arrays of plain values
// compare as sets because purchase order legitimately changes).
const norm = v => Array.isArray(v) ? (v.every(x => x === null || typeof x !== 'object') ? [...v].map(String).sort() : v.map(norm))
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).filter(k => !k.startsWith('_')).sort().map(k => [k, norm(v[k])])) : v;
const diffBuilds = (a, b) => { const A = norm(a), B = norm(b), out = [];
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) out.push(k);
  return out; };
const proj = log => log.filter(e => e.type === 'award').map(e => [e.amount, e.note || '', e.noLock || false, e.disc || false]);
const report = [];
for (const c of live) {
  if (only && c.name !== only) continue;
  const p0 = PLAN[c.name]; if (!p0) continue;
  const p = { ...p0, ...(process.env.LIMITS && JSON.parse(process.env.LIMITS)[c.name] != null ? { limit: JSON.parse(process.env.LIMITS)[c.name] } : {}) };   // LIMITS='{"Name":n}' overrides a limit for what-if runs
  const oldLog = c.stats.LOG.filter(Boolean);
  const { log, li, dropped } = build(c, p);
  const r = compute(foldBuild(log), OPTS), eco = economy(log), ceil = creationCeiling(log, { drawbackAp: r.drawbackAp || 0, spent: eco.spent });
  const atLock = compute(foldBuild(log.slice(0, li)), OPTS).total;
  const post = log.slice(li + 1).filter(isPurchase);
  const oldEco = economy(oldLog), oldR = compute(foldBuild(oldLog), OPTS);
  const oldLi = oldLog.reduce((a, e, i) => e.type === 'creationLocked' ? i : a, -1);
  const checks = {
    'ledger = engine': eco.spent === r.total,
    'exactly one lock, one limit': log.filter(e => e.type === 'creationLocked').length === 1 && log.filter(e => e.type === 'creationLockConfig').length === 1,
    'limit stamped': ceil.base === p.limit,
    'locked': ceil.locked === true,
    'awards unchanged (amount, note, flags)': JSON.stringify(proj(log)) === JSON.stringify(proj(oldLog)),
    'the folded build (what the character owns) is unchanged': diffBuilds(foldBuild(log), foldBuild(oldLog)).filter(k => !(p.rename && k === 'name')).length === 0,   // a planned rename is the one intended difference
    'engine total unchanged vs now (Q1 may move it)': true,
    'seq 1..n in order': log.every((e, i) => e.seq === i + 1),
  };
  const gp = post.reduce((s, e) => s + (e.gp || 0), 0), days = post.reduce((s, e) => s + (e.days || 0), 0);
  const oldPost = oldLi < 0 ? [] : oldLog.slice(oldLi + 1).filter(isPurchase);
  report.push({ name: c.name, id: c.id, ap: c.ap, updated_at: c.updated_at, plan: p, oldLen: oldLog.length, newLen: log.length,
    before: { lockIdx: oldLi, spentEngine: oldR.total, spentLedger: oldEco.spent, inPlay: oldPost.length, gp: oldPost.reduce((s, e) => s + (e.gp || 0), 0), days: oldPost.reduce((s, e) => s + (e.days || 0), 0) },
    after: { lockIdx: li, atLock, spentEngine: r.total, spentLedger: eco.spent, ceiling: ceil.ceiling, limit: ceil.base, inPlay: post.length, inPlayAP: post.reduce((s, e) => s + (e.cost || 0), 0), gp, days },
    changedCosts: log.filter(isPurchase).map((e, i) => e).length && oldLog.filter(isPurchase).map((o, i) => [o.label, o.cost, log.filter(isPurchase)[i] && log.filter(isPurchase)[i].cost]).filter(x => x[1] !== x[2] && false),
    buildDiff: diffBuilds(foldBuild(log), foldBuild(oldLog)).filter(k => !(p.rename && k === 'name')), purchases: [oldLog.filter(isPurchase).length, log.filter(isPurchase).length],
    newName: p.rename || null, dropped, checks, stats: { ...c.stats, ...(p.rename ? { name: p.rename } : {}), LOG: log, SEQ: log.length + 1 } });
}
writeFileSync(outP, JSON.stringify(report));
for (const x of report) {
  const f = Object.entries(x.checks).filter(([, v]) => !v).map(([k]) => k);
  console.log(`\n### ${x.name}   (events ${x.oldLen} → ${x.newLen}; limit ${x.after.limit}, ceiling ${x.after.ceiling})   ${f.length ? '⚠ FAILED: ' + f.join('; ') : 'all checks pass'}`);
  if (x.buildDiff.length) console.log(`  build differs in: ${x.buildDiff.join(', ')}`);
  console.log(`  purchases  : ${x.purchases[0]} → ${x.purchases[1]}${x.dropped.length ? `  (dropped ${x.dropped.length} provable repeat${x.dropped.length > 1 ? 's' : ''}: ${x.dropped.join('; ')})` : ''}`);
  console.log(`  lock now   : index ${x.before.lockIdx}; spent engine ${x.before.spentEngine} / ledger ${x.before.spentLedger}; in play ${x.before.inPlay} (stamped ${x.before.gp} gp / ${x.before.days} d)`);
  console.log(`  lock after : ${x.plan.why} — index ${x.after.lockIdx}, ${x.after.atLock} AP at the lock; spent engine ${x.after.spentEngine} / ledger ${x.after.spentLedger}; in play ${x.after.inPlay} purchases (${x.after.inPlayAP} AP) → ${x.after.gp} gp / ${x.after.days} d`);
}

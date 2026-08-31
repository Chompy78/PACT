/**
 * PACT RPG Rules Engine  (extracted & centralised from the v0.104 web tools)
 * ---------------------------------------------------------------------------
 * Single source of truth for CharGen, the Live Character Sheet, and the
 * regression test pack. Browser-compatible ES module — no Node APIs, no
 * require(), no npm. Import directly via <script type="module">.
 *
 * ── API contract (all named exports; the three tools depend on these shapes) ──────────────────
 * Data:
 *   BUILD  : string   — cosmetic web-tool build number; the tools MIRROR it (see docs/VERSION-SYNC.md).
 *   DATA   : object   — the full rules dataset (ladders, prices, gates, display maps, DATA.apByLevel).
 *                       `DATA.version` is the rules version — bump ONLY on a mechanics/compute() change.
 * Pricing / derivation:
 *   compute(b, opts?) — price a build & derive the sheet. opts:{dmAp?, ignorePlayerAp?}. Returns
 *                       {total, spendable, remaining, budget(=spendable), playerAp, dmAp, drawbackAp, warnings,
 *                        lines, itemize, hp, baseHP, prof, tier, mods, effScore, size, …}. Pure over
 *                       (b, opts). Reads b._lostPurchases (stamped by _replay/foldBuild — see below) to
 *                       itemize a "Lost purchases" ledger line for bought-off drawbacks/DM-removed
 *                       boons (feat/ledger-show-lost-purchases); absent on a hand-built b, same as
 *                       b._raceTraitLocked/b._vigorRankTier. NEVER store its output — derive at runtime.
 *   baseBuild()       — a fresh blank level-1 build object (the fold/replay starting point).
 *   MUT               — { cat: (build, payload) => void }; replay applies MUT[e.cat] per buy event.
 * Event-sourcing (append-only LOG):
 *   activeEvents(events) — {evs, boughtOff, boonRemoved, lost}: live events + a bought-off-drawback map +
 *                          a DM-removed-boon map (feat/dm-edit-events) + the FIFO-matched lost-purchases
 *                          list ({kind,label,cost}[], feat/ledger-show-lost-purchases) compute() itemizes.
 *   creationLockState(events) — {locked, armed, confirmed, threshold, spentTowardThreshold, …} for one
 *                          log. spentTowardThreshold is the LOCK's accounting, never economy().spent.
 *   creationCeiling(events, opts?) — {enforced, base, drawbackBonus, ceiling, spent, remaining, locked}.
 *   wouldExceedCeiling(events, cost, opts?) — may this purchase be made while still in creation?
 *   economy(events)      — {earned, spent, available, drawbackEarned}: AP tally from a LOG (no fold/compute).
 *   earnedWithDm(eco, opts?) — eco.earned composed with DM AP (opts:{dmAp?, ignorePlayerAp?}), mirroring
 *                       compute()'s own spendable formula — feeds Track-Level in both tools
 *                       (feat/ap-model-reconcile). Pure; does not change economy() itself.
 *   foldBuild(events)    — replay a LOG from baseBuild() → a build (b.budget = awards only,
 *                          i.e. economy().earned − drawbackEarned; compute() derives the drawback grant).
 *   rebuildStateFromEvents(base, events, opts?) — replay onto `base` (or an embedded {LOG}) → {ok, version, …}.
 * Campaign rules (VALIDATION only — never read by compute()):
 *   validate(b, rules)   — check a build against a campaign's rules JSON → {ok, violations:[{code,message}]}.
 *   RULE_BAN_FIELDS      — { pickerKind → rules ban-list field }, e.g. arts→bannedArts (shared with the tools).
 * Save-file integrity (tamper-EVIDENT, not secret — D-GH48):
 *   SIG_ALG          : string — the algorithm tag stamped into a signed payload.
 *   signPayload(obj)  — a copy of obj with a tamper-evident `sig` attached.
 *   verifyPayload(obj)— {signed, valid, status}: check a signed payload's integrity.
 *
 * (Historical export note below. This file is ~66 KB / ~930 lines — grep for a symbol when you need one,
 *  but it IS small enough to read in full when the task targets the engine. The rules DATA blob that once
 *  made this file ~238 KB now lives in js/engine-data.js (~189 KB on ~13 lines) — that's the one not to
 *  read wholesale.)
 *
 * The rules data and the compute() costing logic are lifted verbatim from
 * PACT-CharGen-Webtool-v0.104.html; the event-replay logic mirrors the
 * append-only LOG / foldBuild model in PACT-Live-Char-Sheet-v0.104.html.
 */

// AP-by-level ladder lives in its own editable file (feat/ap-by-level); surfaced on DATA below.
import { AP_BY_LEVEL, DEFAULT_LEVEL } from './ap-by-level.js';
// Per-campaign advancement dials (display/config-only; never read by compute()/_replay()).
import { LEVEL_BUDGET_CURVES, AWARD_PACES, STARTING_TIER_RATIOS } from './advancement.js';
// Gold-and-downtime training bands (Players Guide §16); surfaced on DATA below.
import { ECONOMY_BANDS, DEFAULT_BAND, START_GOLD_AP_CAP, TRADE_RATES } from './economy-bands.js';

export const BUILD = "v1.479";

// Rules dataset lives in its own editable file (REV-14a); imported here and
// re-exported unchanged so every tool/importer sees the same DATA surface.
import { DATA } from './engine-data.js';
export { DATA };

/* Renamed-feature migration (v0.350). A saved character is a LOG of events, so a `feature`
 * event holds whatever key existed the day it was recorded. When a key is split or renamed in
 * DATA.features, compute()'s `if(!f)continue;` silently DROPS the purchase — the character
 * loses the feature and the AP it cost, with no warning anywhere. v0.346 split
 * "Druid: Elemental Fury / Improved circle" and v0.345 renamed "Paladin: Aura expansions"; this
 * map is what keeps those characters whole. Applied at both funnels — MUT.feature (so replay
 * normalises the build) and compute()'s lookup (so a build handed in directly still prices).
 * Add an entry here whenever a DATA.features key is renamed or removed; never rename one silently. */
export const FEAT_ALIAS = lab => (DATA.featureAliases && DATA.featureAliases[lab]) || lab;

/**
 * packTraitsFor(species, species2) — the racial traits a character owns FOR FREE by virtue of their
 * heritage pack(s), in DATA.racialList order.
 *
 * A heritage pack is charged as ONE line ("Heritage pack", DATA.pack[species]) and its member traits
 * are then owned implicitly: compute()'s `_ownsR` already treats them as held whether or not they
 * appear in b.racialTraits, which is what makes prerequisite checks work. But that ownership was
 * DERIVED AND NEVER EXPORTED, so no UI could render it — CharGen left the checkboxes unticked while
 * their price label said "in pack", the Live Sheet's character sheet omitted the traits entirely, and
 * its buy panel offered them for sale to a player who already had them.
 *
 * WHY THE TOOLS MUST NOT WRITE THESE INTO b.racialTraits. It looks like the simpler fix and it is a
 * trap. In-pack traits price at 0 only while the pack is yours (`isO && r.pack -> 0`); stored and then
 * followed by a species change they re-price at the CROSS rate. Measured: `Dwarf: Dwarven Resilience`
 * stored on a Dwarf is a 0 AP "Species traits" line, and on an Elf it silently becomes 3 AP. Pack
 * membership is derived from species and must stay derived — the same "never store derived values"
 * rule the persistence model already states.
 *
 * Pure DATA lookup, so callers can use it BEFORE compute() (CharGen needs it inside readBuild()).
 * compute() also returns the same list as `packTraits` for callers that already have a result.
 */
export function packTraitsFor(species, species2) {
  const own = [species, species2].filter(s => s && s !== '(none)');
  if (!own.length) return [];
  return (DATA.racialList || []).filter(lab => {
    const r = DATA.racial[lab];
    return !!(r && r.pack && own.indexOf(r.race) >= 0);
  });
}


/* AP-by-level ladder — externalized to js/ap-by-level.js (feat/ap-by-level) and
 * surfaced on DATA so all three tools read it through the engine bridge. apByLevel/
 * defaultAp are the current names; levelAP/level1AP are back-compat aliases for the
 * same data (compute()'s racial-trait lock reads DATA.level1AP; tool display reads
 * DATA.levelAP). Editing js/ap-by-level.js propagates to every tool with no other change.
 * The ladder is the STANDARD level-BUDGET curve (cumulative AP a complete level-N build
 * has spent): 0:55, 1:79 … 20:535, derived from LEVEL_BUDGET_CURVES.standard so the fixed
 * default and the campaign preset can't drift. It is NOT an AP-earned-per-level schedule —
 * PACT awards AP per session (AWARD_PACES), not per level. */
DATA.apByLevel = AP_BY_LEVEL;
DATA.defaultAp = AP_BY_LEVEL[DEFAULT_LEVEL];
DATA.levelAP   = AP_BY_LEVEL;                 // back-compat alias (tool display / apLevel())
DATA.level1AP  = AP_BY_LEVEL[DEFAULT_LEVEL];  // back-compat alias (compute racial-trait lock)
// Per-campaign advancement dials. AWARD_PACES/STARTING_TIER_RATIOS and the `generous` curve
// are display/config-only, never read by compute() or _replay(). LEVEL_BUDGET_CURVES.standard
// is the exception — it feeds AP_BY_LEVEL above, so editing THAT entry does bump DATA.version.
DATA.levelBudgetCurves  = LEVEL_BUDGET_CURVES;
DATA.awardPaces         = AWARD_PACES;
DATA.startingTierRatios = STARTING_TIER_RATIOS;
/* Gold-and-downtime bands — externalized to js/economy-bands.js and surfaced here so all
 * three tools read them through the same engine bridge as everything else. Display/config
 * only: compute() never reads them, so editing a band is not a DATA.version bump (see that
 * file's header, and AGENTS.md "Versioning"). `off` is one of the three settings, not the
 * absence of a setting — Players Guide §16, "The gold-and-time rule is entirely optional,
 * and it has three settings, not two." */
DATA.economyBands     = ECONOMY_BANDS;
DATA.defaultEconomy   = DEFAULT_BAND;
DATA.startGoldApCap   = START_GOLD_AP_CAP;
DATA.economyTradeRates = TRADE_RATES;

/* ---- shared helpers ------------------------------------------------------ */
const _mod = s => Math.floor((s - 10) / 2);
/* Deep clone. Deliberately a JSON round-trip, NOT structuredClone — measured, not assumed.
 * structuredClone is a host-boundary call whose fixed setup cost dominates for small payloads, and
 * every value this engine clones is small: a weaponProf map (MUT.wprof) and one snapshot field at a
 * time (seedBuild, called once per key). Benchmarked on Node 22 across the real shapes — tiny object,
 * stats block, string, number, small array, nested traditions entry — JSON won every case by
 * 1.9–3.1×, and swapping it in cost ~20% on rebuildStateFromEvents() over the real fixtures.
 * structuredClone only pays off on large/deeply-nested graphs, which this is not. It also THROWS on
 * non-cloneable input (functions/DOM nodes/Symbols) where JSON.stringify silently drops it, so a swap
 * would additionally turn a silent no-op into an exception. Don't "modernize" this without a
 * benchmark that contradicts the above. */
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

/* ==========================================================================
 * compute(build)
 * Prices a build object and returns a stable result:
 *   { total, remaining, budget, warnings, lines, itemize, hp, ac, prof,
 *     tier, mods, effScore, init, speed, castMod, castAb, saveDC, spellAtk,
 *     discInfo, tradInfo, size, status, ... }
 * `total` is the total AP cost (read by the parity runner as totalCost).
 * ========================================================================== */
// What the Nth Grit purchase costs, before the past-CON surcharge.
//
// RULES CORRECTION (owner, 2026-08-05). This ladder is indexed by WHICH PURCHASE it is — your first Grit
// costs 2, your second 4, your third 6 — and does not depend on character level at all. It was previously
// indexed by the character's TIER, so every Grit cost the same and that cost rose as you levelled: three
// Grit cost 6 AP at level 1 but 27 at level 5 and 36 at level 9. The owner confirmed that is wrong, and
// that the Players Guide's "Situational by tier" wording (which the old code implemented faithfully) is
// the thing that needs rewording, not the intent. Grit is now level-independent: three Grit cost 12,
// whenever you buy them.
//
// This is deliberately NOT how Vigor works. Vigor really is tier-locked — "each rank costs the Passive
// band of your current Hit-Dice tier" — so with Vigor, buying early is cheaper and waiting costs more.
// The two are priced differently on purpose; do not "tidy" them into a shared helper.
//
// Past the seven-entry table the steps run 2, 4, 6, 8, 10… (each 2 more than the last), so the 8th costs
// 20, the 9th 24, then 30, 38, 48. The sum of the first m such steps is m*(m+1), which is where that
// closed form comes from. The table needs extending because both tools let a player buy well past 7
// (CharGen's dropdown goes to 12, and the Live Sheet's buy panel has no ceiling at all).
// Character tier from Hit Dice, via DATA.tierHD's gates (T4 needs 5 HD, T5 needs 9, …). compute()
// derives the same figure inline; this exists so _replay() can stamp a purchase with the tier in force
// when it happened, without compute()'s whole build in hand.
function _tierForHD(hd){
  const g = DATA.tierHD || {};
  let t = 1;
  for (let k = 1; k <= 7; k++) if ((Number(hd) || 1) >= (g[k] || 1)) t = k;
  return t;
}

// Hit-Dice requirement for one purchasable item (a DATA.features entry, a DATA.subAbilMap entry —
// anything carrying a `tier`). THE single definition of this rule: compute() gates on it, and all three
// tool with a class-ability picker imports it (CharGen and the Live Sheet) rather than re-deriving
// `b.hd >= DATA.tierHD[tier]` locally. DM Console has no such picker and does not import it. Live Sheet carried FIVE
// such copies across its four pickers and CharGen none, which is exactly how a rule the Players Guide states as absolute
// ("You can never buy an ability before you own the Hit Dice ... it requires") ended up unenforced in the
// one place that is meant to be authoritative. Do not re-inline it; import it.
//
// `hd` and `lvl` on an item are additional FLOORS, never overrides: max() means an item may raise its own
// requirement above its tier's but can never drop below it. `lvl` is the pre-existing Warlock-invocation
// level gate; it is folded in here so callers get one number instead of combining two rules themselves.
export function requiredHD(item){
  if(!item) return 1;
  // TIER SETS PRICE, NOT AVAILABILITY (owner ruling, 2026-08-27). An ability's own `lvl`/`hd` is the
  // authoritative requirement and OVERRIDES its tier — including downward, so an expensive-but-early
  // ability is expressible. Tier is only the fallback for entries that do not yet state a level.
  //
  // That fallback is INTERIM, not the intent. The Guide names a real level for roughly 11 of the 720
  // purchasable abilities; the other ~550 class features and subclass abilities have no stated level in
  // this repo or the Guide, so they still resolve to their tier band's floor. Authoring the rest needs a
  // source, not a guess — see the task board. Anything carrying an explicit value is already exact.
  const explicit = Math.max(Number(item.hd) || 0, Number(item.lvl) || 0);
  if (explicit > 0) return explicit;
  return Number((DATA.tierHD || {})[item.tier || 1]) || 1;
}


// Grit runs on the STEEP ladder — the Nth purchase costs 2N (2/4/6/8/10/12…), the same shape
// py/pricing.py's metamagic_ap() already names "Steep" in the pact-guide project, and the same
// linear-per-purchase escalation every other track in DATA uses (attune 4/6/8/10…, expertise
// 5/6/7/8…, mastery 2/3/4/5…, rankCum 5/6/7/8…). Superseded the earlier hand-written
// [2,4,6,9,12,15,18] table plus its quadratic m*(m+1) tail, which was the only cubic-cumulative
// track in the game — see D-GH-2026-08-12-grit-steep-ladder. Defined for every N, so there is no
// table to run off the end of and no extrapolation branch.
function _gritPrice(n){ return 2 * n; }

export function compute(b, opts){
  b=Object.assign({},b);
  ['saves','skills','expertise','feats','masteries','racialTraits','features','drawbacks','traditions','subAbilities','arts','boons','innate','tools','instruments','customProfs','unlockedClasses','dabblerCantripNames','innateNames','toolExpertise','racialSpells','subSpellBundles'].forEach(k=>{if(!Array.isArray(b[k]))b[k]=[];});
  ['hardy','tough','gold','extraClasses','dabblerCantrips','languages','budget','profBonus','attune','ki','sorcery'].forEach(k=>{b[k]=Number(b[k])||0;});
  b.hd=Math.min(20,Math.max(1,Math.floor(Number(b.hd)||1)));
  if(b.stats&&typeof b.stats==='object'){const s={};for(const k in b.stats)s[k]=Number(b.stats[k])||10;b.stats=s;}else b.stats={};
  const W=[]; const L=[]; let total=0;
  // `force` keeps a 0 AP line visible when it still has itemized detail under it. Without it,
  // a character whose only species traits are free heritage-pack traits got itemized entries
  // filed under a "Species traits" heading that `add` had suppressed — detail with no heading.
  function add(lab,ap,force){ if(ap!==0||force){L.push([lab,ap]);} total+=ap; }
  // DISPLAY-ONLY line: shown in the ledger, excluded from `total`. Added v0.354 for drawbacks, whose
  // grant is income (it reaches the character through b.budget) but which still need to be VISIBLE in
  // the ledger with their itemised rows. Using add() would put the grant back into total and restore
  // the double-count; omitting the line entirely would break the invariant that every itemised group
  // has a heading whose value its rows sum to — which tool-pricing-ci asserts, rightly.
  // Same zero-suppression as add(): a build whose only drawbacks are unknown to the rules scores 0
  // and must render no row at all, not an empty heading. `force` keeps a genuine 0 visible when it
  // still has itemised detail beneath it.
  function addDisplay(lab,ap,force){ if(ap!==0||force){L.push([lab,ap]);} }
  const _ITEMS={}; function addItems(lab,items){ const a=(items||[]).filter(x=>x); if(a.length)_ITEMS[lab]=a; }
  const st=b.stats||{};
  // base AP is paid on the purchased scores only
  // fix/engine-pricing-edge-cases (2026-08-22): DATA.ABIL only defines keys 2-20 — an unclamped score
  // above 20 fell through to `|| 0`, so a score of e.g. 25 cost NOTHING beyond 20's price while still
  // giving a strictly better modifier. Not reachable through any shipped tool's UI (CharGen's stepper is
  // hard-capped 2-20), but compute() is the single source of truth every caller trusts — a hand-edited
  // save, DM Console's edit path, or a reloaded tampered file all bypass the UI cap. Clamped the same way
  // unlockCum's cumulative lookup already is (see its own comment: "a clamp under-charges at worst").
  let abilAP=0;for(const a of ["STR","DEX","CON","INT","WIS","CHA"]){const _sc=Math.min(20,Math.max(2,st[a]||10));abilAP+=(DATA.ABIL[_sc]||0);} add("Ability scores",abilAP);
  for(const a of ["STR","DEX","CON","INT","WIS","CHA"]){const sc=st[a]||10; if(sc<6) W.push(a+" "+sc+" is below the normal floor of 6 — needs DM approval"); if(sc>20) W.push(a+" "+sc+" is above the normal ceiling of 20 — priced as 20");}
  const effScore={}; const mod={};
  const hd=b.hd||1;
  // Ownership must be resolved BEFORE anything reads b.features for a mechanical EFFECT. A blocked
  // purchase is "not counted, not owned" — that has to mean it grants nothing, not merely that it costs
  // nothing. This block used to sit ~180 lines lower, next to the pricing loop that consumes it, which
  // left the Primal Champion +4 STR/+4 CON fold below reading raw b.features: a 1 HD Barbarian got the
  // stats (and the HP/AC/save-DC knock-ons) for 0 AP while the engine reported the feature as not owned.
  // Caught by /code-review ultra on PR #471. Keep this ABOVE the ability-score fold.
  const _ownedFeatSet=new Set((b.features||[]).map(FEAT_ALIAS));
  const _blockedFeat=new Set();
  // Hit-Dice gate (D-GH-2026-08-27-feature-hd-gate). Seeded INTO the same set the prereq fixed point
  // walks, deliberately: a hard block means the purchase is not owned, so anything naming an HD-blocked
  // feature as its prerequisite must block transitively too. Running this as a later pass would leave
  // those dependents reading their prerequisite as owned. Gates on the feature's own tier — NOT on a
  // stepped `rep` escalation: only one entry in the whole dataset is rep (Sorcerer: Metamagic), its price
  // is overridden to a flat 2N two lines below so the escalated tier is dead code for it, and the Guide
  // lists Metamagic explicitly as having "no level gate". Gating it would be a rules CHANGE needing its
  // own Guide edit, not the rules catch-up this is.
  const _hdBlockedFeat=new Set();
  // Arts and Boons carry their own `hd` rather than inheriting a tier gate, and were advisory-only until
  // now: compute() warned and then charged and granted them anyway. Resolved HERE, with the features,
  // because the epic-boon +2 ability fold below reads b.boons directly -- blocking a boon after that point
  // would repeat exactly the Primal Champion regression (blocked meant "costs nothing" instead of
  // "grants nothing"). blockedAP/_BLI are declared here too so the arts loop, which runs well before the
  // feature loop, can feed the same single "Blocked purchases" ledger line.
  let blockedAP=0; const _BLI=[];
  const _blockedArt=new Set(), _blockedBoon=new Set();
  for(const _l of (b.arts||[])){const _a=DATA.arts[_l]; if(_a && hd<requiredHD(_a)) _blockedArt.add(_l);}
  for(const _l of (b.boons||[])){const _bo=((b.houseRules||{}).boons||{})[_l]||DATA.boons[_l];
    if(_bo && hd<(Number(_bo.hd)||1)) _blockedBoon.add(_l);}
  for(const _lab of _ownedFeatSet){const _f=DATA.features[_lab];
    if(_f && hd < requiredHD(_f)){_blockedFeat.add(_lab);_hdBlockedFeat.add(_lab);}}
  {let _changed=true;while(_changed){_changed=false;for(const _lab of _ownedFeatSet){if(_blockedFeat.has(_lab))continue;
    const _f=DATA.features[_lab];if(!_f||!(_f.prereq&&_f.prereq.length))continue;
    const _bad=_f.prereq.some(function(req){return !_ownedFeatSet.has(req)||_blockedFeat.has(req);});
    if(_bad){_blockedFeat.add(_lab);_changed=true;}}}}
  const _flat={STR:0,DEX:0,CON:0,INT:0,WIS:0,CHA:0};if(_ownedFeatSet.has("Barbarian: Primal Champion")&&!_blockedFeat.has("Barbarian: Primal Champion")){_flat.STR+=4;_flat.CON+=4;}const _eb=b.epicBoonAbil||{};for(const _bl of (b.boons||[])){if(_blockedBoon.has(_bl))continue;const _bo=DATA.boons[_bl];if(_bo&&_bo.epic){const _a=_eb[_bl];if(_a&&_flat[_a]!==undefined)_flat[_a]+=2;else W.push(_bl+": choose an ability to raise (+2)");}}for(const a of ["STR","DEX","CON","INT","WIS","CHA"]){effScore[a]=Math.min(30,(st[a]||10)+_flat[a]);mod[a]=_mod(effScore[a]);}
  const row=DATA.HD[hd-1];
  const tier=hd<=1?1:hd<=2?2:hd<=4?3:hd<=8?4:hd<=12?5:hd<=16?6:7;
  add("Hit Dice",row.cum);
  // proficiency bonus (v39 §6): everyone starts at +2; buy up to +6 on the Extreme ladder, each step HD-gated
  const wantPB=Math.min(6,Math.max(2,Math.floor(Number(b.profBonus)||2))); let prof=2; const PG=DATA.profGate;
  for(let pb=3;pb<=wantPB;pb++){ if(hd>=PG[pb]) prof=pb; else { W.push("Proficiency +"+pb+" needs "+PG[pb]+" Hit Dice"); break; } }
  add("Proficiency bonus (+"+prof+")",DATA.profCum[prof]||0);
  // Vigor: +1 HP/HD per rank, cost 4/5/6/7…; cap = CON modifier (v66)
  // Vigor IS tier-locked and stays so — each rank costs the Passive band of your CURRENT Hit-Dice tier,
  // so buying early is genuinely cheaper. Grit is NOT; see _gritPrice() above compute().
  const cm=mod.CON; const vgcap=Math.max(0,cm);   // floor at 0 so a negative CON mod never flags Vigor 0 as over-cap
  // Vigor is priced per RANK at the tier that rank was bought at — see _vigorRankTier below. A stamped
  // build reproduces what the player actually paid; an unstamped one falls back to today's tier, which is
  // the old whole-stack behaviour. Presence, not truthiness, is the signal, exactly as _raceTraitLocked
  // does it: rank tiers are legitimately 1, so a 0-vs-missing test would misread a real entry.
  const hardy=b.hardy||0; const _vt=b._vigorRankTier;
  let hardyAP=0;
  for(let n=1;n<=hardy;n++){
    const _rt=(Array.isArray(_vt)&&_vt[n-1]!=null)?_vt[n-1]:tier;
    hardyAP+=[5,8,11,14,17,21,25][Math.min(7,Math.max(1,_rt))-1];
  }
  add("Vigor",hardyAP);
  if(hardy>vgcap) W.push("Vigor "+hardy+" exceeds cap (max = CON mod = "+vgcap+")");
  // Grit: priced by WHICH purchase it is, plus a flat +1 for each purchase past the CON modifier.
  const tough=b.tough||0; let toughAP=0;for(let n=1;n<=tough;n++)toughAP+=_gritPrice(n)+(n>vgcap?1:0); add("Grit",toughAP);
  const hp=row.baseHP + hd*(cm+hardy) + tough*4;
  // saves by stat
  const saveList=(b.saves||[]); add("Saving throws",DATA.saves[saveList.length]||0);
  // skills by name + expertise by name
  const skillList=(b.skills||[]); const expList=(b.expertise||[]);
  // skills and tools/instruments run on independent ladders — each gets its own first two free.
  // (REV-13: the never-populated grantSk/grantTl/grantIn "free-grant" scaffolds were removed — they only
  //  ever filtered an empty set, i.e. every skill/tool/instrument was paid. Byte-identical output; if a
  //  future feature grants free proficiencies, reintroduce the filter then, with a fixture that exercises it.)
  const paidSkills=skillList.length;
  add("Skills",DATA.skills[paidSkills]||0);
  const paidTools=(b.tools||[]).length+(b.instruments||[]).length+(b.customProfs||[]).length;
  add("Tools & instruments",DATA.tools[paidTools]||0);
  add("Expertise",DATA.expertise[expList.length]||0);
  {const _skSet=new Set(skillList);for(const x of expList) if(!_skSet.has(x)) W.push("Expertise in "+x+" needs the skill bought first");}
  // tool expertise — its own independent track (separate count on the same Expertise ladder)
  const toolExpList=(b.toolExpertise||[]); add("Tool expertise",DATA.expertise[toolExpList.length]||0);
  {const _ownT=new Set([].concat(b.tools||[],b.instruments||[],b.customProfs||[]));for(const x of toolExpList) if(!_ownT.has(x)) W.push("Tool expertise in "+x+" needs that tool/instrument proficiency first");}
  // languages — first free, then an escalating ladder (+1,+2,+3…): 4 langs = 6 AP. (n-1)·n/2
  const langs=b.languages||1; add("Languages",Math.max(0,(langs-1)*langs/2));
  // §6 Attunement slots (Steep 4/6/8/10), no cap, no gate
  // fix/engine-pricing-edge-cases (2026-08-22): uncapped by design (no HD gate), but the table itself
  // still ends (13 entries) — `|| 0` let a purchase past the last index go FREE, and because Live
  // Sheet's buy panel prices this as a whole-build compute() delta (attune isn't in _CTX_PRICERS), the
  // purchase that CROSSES the boundary priced as a REFUND. Reachable purely by clicking Live Sheet's
  // "buy the next one" button repeatedly — no LOG tampering needed. Clamp the index, same pattern as
  // unlockCum's cumulative lookup (its own comment: "a clamp under-charges at worst; `|| 0` paid the
  // player") — every purchase past the table's end costs the same as the last rung, rather than nothing.
  const attune=b.attune||0; add("Attunement slots",DATA.attune[Math.min(attune,DATA.attune.length-1)]||0);
  // Arts & Techniques (flat AP per item like boons; has hd gate + minStats prereqs)
  let artAP=0;const _AI=[];for(const lab of (b.arts||[])){const ar=DATA.arts[lab];if(!ar){W.push(lab+" is no longer in the rules data — no cost/effect applied");continue;}const _ac=(+ar.ap||0);
    if(_blockedArt.has(lab)){W.push('⛔ '+lab+' — blocked: needs '+requiredHD(ar)+' Hit Dice (not counted, not owned)');blockedAP+=_ac;_BLI.push([lab,_ac]);continue;}
    artAP+=_ac;_AI.push([lab,_ac]);
    const _ams=ar.minStatsAny;if(_ams&&_ams.stats){const _anyMet=_ams.stats.some(function(_a){return (st[_a]||10)>=_ams.val;});if(!_anyMet)W.push(lab+': requires '+_ams.stats.join(' or ')+' '+_ams.val+'+');}
    const ms=ar.minStats||{};for(const [_ab,_mn] of Object.entries(ms)){if((st[_ab]||10)<_mn)W.push(lab+': requires '+_ab+' '+_mn+'+');}
    if(ar.prereqNote){
      // Auto-check Spellcasting Foundation
      if(/Foundation/i.test(ar.prereqNote)){
        const _hasFound=(b.traditions||[]).some(function(t){
          return t&&t.disciplines&&t.disciplines.some(function(d){return d&&d.name&&d.name!=='(none)';});
        });
        if(!_hasFound)W.push(lab+': requires a Spellcasting Foundation (buy one in §9 Spellcasting)');
      }else{W.push(lab+': requires '+ar.prereqNote+' (DM check)');}
    }}
  add("Arts & Techniques",artAP);addItems("Arts & Techniques",_AI);
  // weapon proficiency
  const wp=b.weaponProf||{}; let wpAP=0;
  if(wp.simple)wpAP+=DATA.weaponProf.simple;
  if(wp.allMartial){wpAP+=DATA.weaponProf.allMartial; if(!wp.simple)W.push("All-martial proficiency needs Simple first");}
  else if(wp.martial){wpAP+=wp.martial*DATA.weaponProf.oneMartial; if(!wp.simple)W.push("Martial weapon proficiency needs Simple first");}
  if(wp.improvised)wpAP+=3;   // v74: Improvised weapons, flat 3 AP, stand-alone
  add("Weapon proficiency",wpAP);
  // weapon masteries (need proficiency in general)
  const mast=(b.masteries||[]); add("Weapon masteries",DATA.mastery[mast.length]||0);
  if(mast.length>0 && !(wp.simple||wp.martial||wp.allMartial)) W.push("Weapon masteries need any weapon proficiency first (Simple is enough)");
  // armour climb (force prerequisites)
  const arm=b.armour||{}; let armAP=0; const A=DATA.armourClimb;
  const wantHeavy=arm.heavy, wantMed=arm.medium||arm.heavy, wantLight=arm.light||arm.medium||arm.heavy;
  if(wantLight)armAP+=A.light; if(wantMed)armAP+=A.medium; if(wantHeavy)armAP+=A.heavy; if(arm.shield)armAP+=A.shield;
  add("Armour proficiency",armAP);
  // heritage
  add("Heritage pack",DATA.pack[b.species]||0);
  if(b.species2 && b.species2!=="(none)") add("2nd origin species (x2 pack)",2*(DATA.pack[b.species2]||0));
  // Race-defining traits are T1 at creation (origin/cross per Appendix B). Once creation pricing is
  // LOCKED for a given purchase (D-GH31: an explicit creationLocked event, or cumulative spend past
  // DATA.level1AP, whichever came first in the LOG as of that purchase — see _replay), an own-race
  // non-pack trait re-prices at the Master Cost Table cell for your CURRENT Tier × the trait's Band
  // (guide §10: "always hard to grow into your heritage late"). Pack basics & cross-race keep creation
  // price regardless.
  //
  // D-GH34: compute() supports TWO build formats for this decision, by design, not as a temporary shim
  // — an engine change that introduces state derived only from replaying a LOG must either stay
  // compatible with callers that construct builds independently of that replay, or explicitly define
  // the compatibility boundary; this is that boundary:
  //   - Replay-derived builds (folded via this engine's own foldBuild()/_replay()) carry a real
  //     per-trait b._raceTraitLocked[label] entry (true OR false) for every trait they own. That value
  //     is used directly whichever it is — a present-but-false entry means "genuinely not locked, this
  //     purchase happened before any trigger," not "unknown, fall back."
  //   - Legacy/independently-constructed builds (e.g. a tool with its own hand-copied local fold that
  //     never calls this engine's _replay() — Live Sheet and DM Console, as of this writing) have NO
  //     entry for a given trait at all. Presence, not truthiness, is the signal: missing entirely means
  //     fall back to the whole-build b.inPlay flag, which baseBuild() still sets true unconditionally —
  //     restoring this mechanism's pre-D-GH31 behavior for any caller that doesn't (yet) go through real
  //     LOG replay, rather than silently defaulting every such trait to "unlocked."
  // feat/warn-missing-data-refs: several loops below silently `continue` past a saved reference (racial
  // trait/boon/drawback/art/feature/subAbility/subSpellBundle) that no longer exists in DATA — e.g. a
  // trait/feature renamed or retired from the rules. The character keeps the stale label but gets zero
  // cost/effect from it with nothing telling anyone why. Fixed additively: each PRIMARY pricing loop that
  // hits this case now pushes a warning naming the missing reference; existing skip/zero-fallback pricing
  // behavior is unchanged. Several of these categories are ALSO iterated by a SECONDARY loop further down
  // (e.g. racialTraits' cross-species/reqRace checks at line ~348, features' prereq chain at line ~398) —
  // those secondary loops deliberately do NOT also warn, to avoid pushing the same "missing reference"
  // warning two or three times for one stale label; the primary pricing loop is the single canonical
  // checkpoint for "does this reference still exist in DATA."
  let racAP=0;const _SI=[];for(const lab of (b.racialTraits||[])){const r=DATA.racial[lab];if(!r){W.push((lab.split(": ")[1]||lab)+" is no longer in the rules data — no cost/effect applied");continue;}const isO=(r.race===b.species||r.race===b.species2);
    const _hasLockEntry=!!(b._raceTraitLocked&&Object.prototype.hasOwnProperty.call(b._raceTraitLocked,lab));
    const _locked=_hasLockEntry?!!b._raceTraitLocked[lab]:!!b.inPlay;
    // In-pack traits carry their real MASTER[tier][band] origin price (v0.344) so that moving a
    // trait in or out of a heritage pack never silently makes it free — but the pack itself is what
    // grants them, so the origin race pays 0 here rather than paying twice. Cross-race buyers still
    // pay `cross` via the branches below.
    let _rc; if(_locked && isO && !r.pack){const _tt=Math.min(7,Math.max(r.tier||1,tier));const _row=DATA.MASTER[_tt];if(r.band==null){_rc=r.origin;}else{_rc=(_row&&_row[r.band])??r.origin;}} else if(isO){_rc=r.pack?0:r.origin;} else if(r.cross==null){W.push((lab.split(": ")[1]||lab)+" is origin-race only — it can't be taken cross-race.");continue;} else {_rc=r.cross;}
    racAP+=_rc;_SI.push([lab,_rc]);}
  add("Species traits",racAP,_SI.length>0);addItems("Species traits",_SI);
  // §10 cross-species T2+ rule: traits above T1 can only be purchased by the origin species
  for(const lab of (b.racialTraits||[])){const r=DATA.racial[lab];if(!r)continue;const isO=(r.race===b.species||r.race===b.species2);if(!isO&&(r.tier||1)>1)W.push((lab.split(': ')[1]||lab)+': only Tier 1 traits are available cross-species');}{var _rtSet=new Set(b.racialTraits||[]);var _ownsR=function(nm){if(_rtSet.has(nm))return true;var _r=DATA.racial[nm];return !!(_r&&_r.pack&&(_r.race===b.species||_r.race===b.species2));};for(const lab of (b.racialTraits||[])){const r=DATA.racial[lab];if(!r)continue;var _sn=(lab.split(": ")[1]||lab);if(r.reqRace&&!_ownsR(r.reqRace))W.push("⛔ "+_sn+" requires "+((r.reqRace.split(": ")[1])||r.reqRace));if(r.minHD&&hd<r.minHD)W.push("⛔ "+_sn+" needs "+r.minHD+" Hit Dice (level "+r.minHD+")");}}
  // §10 lineage spell-likes: cap-exempt cantrips + half-price 1/long-rest spells (Appendix B prices)
  {const _lin=(DATA.lineageSpells&&DATA.lineageSpells[b.lineage])||[]; let _rs=0;
   for(const nm of (b.racialSpells||[])){const s=_lin.find(x=>x[0]===nm); if(!s){W.push(nm+" is no longer in the rules data — no cost/effect applied");continue;} _rs+=s[1];
     if(s[2]>0 && hd<(DATA.hdGate[s[2]-1]||1)) W.push("Lineage spell "+nm+" (L"+s[2]+") needs "+(DATA.hdGate[s[2]-1])+" Hit Dice");}
   add("Lineage spell-likes",_rs);}
  // class access — unlock cost is 7 × classes already owned (origin + any 2nd origin counted first)
  const has2nd=(b.originClass2 && b.originClass2!=="(none)");
  const ownedBefore=1+(has2nd?1:0);
  const _xc=((b.unlockedClasses||[]).filter(c=>c!==b.originClass&&c!==b.originClass2).length)||(b.extraClasses||0);const _uStart=ownedBefore-1,_uEnd=_uStart+_xc;
  // v0.352: FLAT 8 AP per unlocked class, and the table is read with a CLAMP, not `|| 0`.
  //
  // Both halves fix real defects. The old ladder was 7 x classes-already-owned — [0,7,21,42,70] — which
  // §11 described as mirroring how subclasses are bought, while the guide's actual subclass rule is
  // "a flat 15 AP to open, however many you already have". The engine escalated where the published
  // parallel is deliberately flat. Flat also fits §1's pitch — cross-class is meant to be "just a
  // shopping list, not a multiclass puzzle" — and a price that depends on what you already own is a
  // puzzle. See D-GH-2026-08-18-flat-class-unlock.
  //
  // The `|| 0` it replaces turned "index past the end of the table" into "free": with only five rungs
  // for twelve classes, unlocking a FIFTH class refunded the 70 AP paid for the first four, and with a
  // second origin class the line went negative. A clamp under-charges at worst; `|| 0` paid the player.
  const _cum=i=>DATA.unlockCum[Math.min(Math.max(i,0),DATA.unlockCum.length-1)];
  const unlockAP=_cum(_uEnd)-_cum(_uStart);
  add("Class unlocks",unlockAP);
  // v0.351 (AY2): 14 -> 18. At 14 a second origin paid for itself after SIX features, which put it
  // inside what almost anyone takes, so it read as a default pick rather than a two-class concept.
  // 18 moves the break-even to eight. It is also deliberately above the 14 AP drawback allowance:
  // at 14 the two numbers matched exactly, so two drawbacks funded a whole second origin class for
  // nothing and raised no warning at all. A second origin still carries its own hidden cost — it
  // shifts you up the unlock ladder, so every later unlock costs 7/14/21 more.
  // Price lives in DATA so the tools can LABEL it without hardcoding a second copy. CharGen's own
  // picker hint said "+14 AP" for six days after this rose 14 -> 18 (D-GH-2026-08-18-drawback-cap-
  // and-second-origin), quoting a player one price and charging another.
  if(has2nd) add("2nd origin class",DATA.secondOriginAP);
  // §14 Martially Bound: choose one class; −1 AP (floor 1) on that class's features, stacks with origin. +2 AP gain.
  const mbClass=(b.martiallyBound && b.martiallyBound!=="(none)")?b.martiallyBound:null;
  // Membership-only view of unlockedClasses, built once and shared by the features / subclass-ability /
  // tradition / discipline loops below — each previously re-scanned the array with indexOf per iteration.
  // Used for lookups ONLY: b.unlockedClasses itself is untouched, so any order-dependent read is unaffected.
  const _unlkSet=new Set(b.unlockedClasses||[]);
  // v3 (owner-directed, D-2026-08-19-premium-autogrowth-to-stepped): prerequisite hard block, widened
  // from Warlock-invocation-only to any feature declaring f.prereq. A feature whose prereq isn't owned
  // — or whose prereq is itself blocked (a skipped intermediate step) — is excluded from pricing and
  // ownership entirely below: it costs 0 and is itemized separately under "Blocked purchases" rather
  // than counted as a real purchase. Fixed-point over b.features so a chain of any depth resolves
  // correctly (owning steps 2 and 3 while skipping 1 blocks both, not just the one naming 1 directly).
  // (ownership resolution — _ownedFeatSet / _blockedFeat / _hdBlockedFeat — is computed near the top of
  // compute(), BEFORE any mechanical effect reads b.features. See the block above the ability-score fold.)
  // features — non-stepped: buy once. Stepped (rep): each re-buy is the next tier up.
  let featAP=0; const fcount={}; const _FI=[];
  for(const _lab0 of (b.features||[])){const lab=FEAT_ALIAS(_lab0);const f=DATA.features[lab];if(!f){W.push((lab.split(": ")[1]||lab)+" is no longer in the rules data — no cost/effect applied");continue;}
    fcount[lab]=(fcount[lab]||0)+1; const n=fcount[lab];
    if(!f.rep && n>1){W.push((lab.split(": ")[1]||lab)+": already bought — can only be taken once (not a stepped feature)");continue;}
    let origin,cross,stick;
    if(f.rep){const tier=Math.min(7,f.tier+n-1);stick=DATA.MASTER[tier][f.band];origin=Math.max(1,stick-(tier-1));cross=stick+tier;}
    else {origin=f.origin;cross=f.cross;stick=Math.max(1,f.cross-f.tier);}
    const isO=(f.cls===b.originClass||f.cls===b.originClass2);const isUnlk=!isO&&_unlkSet.has(f.cls);let c=isO?origin:(isUnlk?stick:cross);
    if(mbClass && f.cls===mbClass) c=Math.max(1,c-1);if(lab==="Sorcerer: Metamagic")c=2*n;   // Martially Bound discount (floor 1); Metamagic Steep ladder (option N=2N) v0.314
    if(_blockedFeat.has(lab)){
      // Report every DIRECT cause on the item itself, HD first, so a purchase failing both gates says so
      // instead of hiding one behind the other. A pure-prereq block keeps its exact pre-existing wording
      // — the four prereq regression fixtures assert that string, and it must stay the thing they prove.
      const _missing=(f.prereq||[]).filter(function(req){return !_ownedFeatSet.has(req)||_blockedFeat.has(req);});
      const _reqLab=_missing[0]?(_missing[0].split(": ")[1]||_missing[0]):"an earlier step";
      const _why=[];
      if(_hdBlockedFeat.has(lab)){const _n=requiredHD(f);
        // Name the constraint that actually binds. When a per-item lvl/hd floor exceeds the tier's
        // requirement, "(T5)" would tell the player a T5 ability needs 12 HD — false for every other
        // T5 ability in the game, and it hides the real reason.
        _why.push("needs "+_n+" Hit Dice "+(_n>((DATA.tierHD||{})[f.tier]||1)?"(level gate)":"(T"+f.tier+")"));}
      if(_missing.length||!_why.length) _why.push("requires "+_reqLab+" first");
      W.push("⛔ "+(lab.split(": ")[1]||lab)+" — blocked: "+_why.join(" & ")+" (not counted, not owned)");
      blockedAP+=c;_BLI.push([lab,c]);continue;
    }
    featAP+=c;_FI.push([lab+(f.rep&&n>1?" (step "+n+")":""),c]);}
  add("Class features",featAP);addItems("Class features",_FI);
  // "Blocked purchases" is emitted AFTER the subclass-ability loop below, not here: all 192 subclass
  // abilities are mirrored into DATA.features and are buyable through either collection, so both loops
  // feed one shared blockedAP/_BLI and one ledger line. Gating only this loop would guard one of two
  // identical doors — the precise failure that got the v0.353 §11 access gate removed.
  {var _invN=(b.features||[]).filter(function(l){var f=DATA.features[FEAT_ALIAS(l)];return f&&f.inv&&!_blockedFeat.has(FEAT_ALIAS(l));}).length;var _bs=0;for(var _i=0;_i<_invN;_i++)_bs+=Math.min(20,Math.floor(_i/2));if(_bs>0)add("Invocation breadth surcharge",_bs);}{var _ea=(b.features||[]).filter(function(l){return /: Extra Attack$/.test(l);}).length+((b.features||[]).indexOf("Warlock: Thirsting Blade")>=0?1:0)+(b.subAbilities||[]).filter(function(k){return /\|Extra Attack$/.test(k);}).length;if(_ea>=2)W.push("Extra Attack / Thirsting Blade gained "+_ea+" times — a 2nd attack doesn't stack; the duplicates add no benefit (keep one).");}
  // v0.084: Eldritch Invocations are locked behind the Warlock discipline
  {const _hasWL=(b.traditions||[]).some(function(t){return (t.disciplines||[]).some(function(d){return d&&d.name==="Warlock";});});
   if(!_hasWL)(b.features||[]).forEach(function(lab){var f=DATA.features[lab];if(f&&f.inv)W.push("⛔ "+(lab.split(": ")[1]||lab)+": Eldritch Invocation requires the Warlock discipline (open Arcane › Warlock)");});}
  // v0.203: elevated Warlock-level gates for invocations. NO LONGER PURELY ADVISORY as of
  // D-GH-2026-08-27-feature-hd-gate: requiredHD() folds `lvl` in as a floor, so an invocation above its
  // level gate is now HARD-blocked by the loop above (0 AP, not owned) and this line is the second,
  // explanatory half of the same verdict — it names the Warlock-level cause that the blocked warning
  // reports only as a number. Kept deliberately rather than deduped: dropping it would leave the player
  // told "needs 12 Hit Dice (level gate)" with nothing saying WHICH level gate. See CG-049.
  {(b.features||[]).forEach(function(lab){var f=DATA.features[lab];if(!f||!f.inv)return;
    if(f.lvl&&(b.hd||0)<f.lvl)W.push("⛔ "+(lab.split(": ")[1]||lab)+" requires Warlock level "+f.lvl);});}
  // v0.087: chassis gates — a feature with needsDisc requires that Discipline founded (e.g. Metamagic→Sorcerer)
  {const _ds=new Set();(b.traditions||[]).forEach(function(t){(t.disciplines||[]).forEach(function(d){if(d&&d.name)_ds.add(d.name);});});
   (b.features||[]).forEach(function(lab){var f=DATA.features[lab];if(f&&f.needsDisc&&!_ds.has(f.needsDisc))W.push("⛔ "+(lab.split(": ")[1]||lab)+" requires the "+f.needsDisc+" Discipline (found it in Spellcasting)");});}
  // v0.088: resource gates — ki/sorcery-using abilities require >=1 of the resource
  // fix/engine-pricing-edge-cases (2026-08-22): clamp matches the pricing lookup below — an unclamped
  // index past kiCum's end used to read undefined||0, so a character who owns MANY ki points past the
  // table boundary would incorrectly show "0 ki" here and warn that a Ki-using feature needs ki bought
  // first, despite having plenty.
  {const _kiTot=(DATA.kiCum&&DATA.kiCum[Math.min(b.ki||0,DATA.kiCum.length-1)])||0;
   if(_kiTot<1)(b.features||[]).forEach(function(lab){var f=DATA.features[lab];if(f&&f.needsKi)W.push("⛔ "+(lab.split(": ")[1]||lab)+" requires at least 1 Ki / Focus point (buy Ki points first)");});
   else if(!(b.features||[]).some(function(lab){var f=DATA.features[lab];return f&&f.needsKi;}))W.push("You have "+_kiTot+" Ki / Focus point"+(_kiTot>1?"s":"")+" but no Ki-using ability yet — buy a Ki feature, or refund the points if you won't use them.");}
  {const _hasSorc=(b.traditions||[]).some(function(t){return (t.disciplines||[]).some(function(d){return d&&d.name==="Sorcerer";});});
   const _spTot=(b.sorcery||0);
   if(_spTot<1)(b.features||[]).forEach(function(lab){var f=DATA.features[lab];if(f&&f.needsSorc)W.push("⛔ "+(lab.split(": ")[1]||lab)+" requires at least 1 sorcery point (buy sorcery points first)");});}
  // §5/§11 Ki (Focus) & Sorcery points — gentle ladder, no Hit-Dice gate. fix/engine-pricing-edge-cases
  // (2026-08-22): both tables still END (25/21 entries) despite being uncapped-by-design — an unclamped
  // index past either one fell through `|| 0`, going FREE, and because neither is in Live Sheet's
  // _CTX_PRICERS special-case list, the purchase that crossed the boundary priced as a REFUND (a
  // whole-build compute() delta going negative). Reachable purely by clicking Live Sheet's buy buttons
  // repeatedly, no HD gate on either track to stop long high-level play from reaching it. Clamp the
  // index, same pattern as unlockCum/attune above.
  const ki=b.ki||0; add("Ki / Focus points",(DATA.kiCum&&DATA.kiCum[Math.min(ki,DATA.kiCum.length-1)])||0);  // v0.172: bands-of-4 ladder
  const sorcery=(b.sorcery||0);  // hard block: extra sorcery requires T2
  // v0.172: base pool (= Hit Dice) is FREE with the Sorcerer Discipline — b.sorcery = EXTRA points bought
  add("Sorcery points",(DATA.sorcCum&&DATA.sorcCum[Math.min(sorcery,DATA.sorcCum.length-1)])||0);
  if((b.sorcery||0)>0){var _hsd=(b.traditions||[]).some(function(t){return (t.disciplines||[]).some(function(d){return d&&d.name==="Sorcerer";});});if(!_hsd)W.push("⛔ Sorcery points require the Sorcerer discipline (open Arcane › Sorcerer)");else if(hd<2)W.push("⛔ Sorcery points require 2 Hit Dice (T2)");}
  // §14 Martially Bound — taking it grants 2 AP up front (like a drawback), discount applied in the features loop above
  if(mbClass) add("Martially Bound (gain)",-2);
  // subclass abilities (à la carte) + unlocks: first subclass per class is free, others 15 AP
  const freeSub=b.freeSub||{}; const subUsed={}; let subAP=0;const _UI=[];
  for(const key of (b.subAbilities||[])){const a=DATA.subAbilMap[key];if(!a){W.push((String(key).split("|").pop()||key)+" is no longer in the rules data — no cost/effect applied");continue;}
    const _sLab=(a.cls+" › "+a.sub+": "+a.name);
    // Same Hit-Dice gate as the feature loop, via the same requiredHD(). Blocked means NOT OWNED, so the
    // subUsed[] marking below is skipped too — a blocked ability must not drag its subclass into the
    // paid-unlock accounting for a purchase that did not happen.
    if(hd < requiredHD(a)){
      {const _n=requiredHD(a);
       W.push("⛔ "+a.name+" — blocked: needs "+_n+" Hit Dice "+(_n>((DATA.tierHD||{})[a.tier]||1)?"(level gate)":"(T"+a.tier+")")+" (not counted, not owned)");}
      const _bc=(a.cls===b.originClass||a.cls===b.originClass2)?a.origin:(_unlkSet.has(a.cls)?Math.max(1,a.cross-a.tier):a.cross);
      blockedAP+=_bc;_BLI.push([_sLab,_bc]);continue;
    }
    (subUsed[a.cls]=subUsed[a.cls]||{})[a.sub]=1;
    const isO=(a.cls===b.originClass||a.cls===b.originClass2);const isUS=!isO&&_unlkSet.has(a.cls);const _uc=isO?a.origin:(isUS?Math.max(1,a.cross-a.tier):a.cross);subAP+=_uc;_UI.push([_sLab,_uc]);}
  add("Subclass abilities",subAP);addItems("Subclass abilities",_UI);
  // v0.196: a bought expanded-list bundle also opens its subclass for unlock-accounting
  for(const _bk of (b.subSpellBundles||[])){const _p=String(_bk).split("|");if(_p[0]&&_p[1])(subUsed[_p[0]]=subUsed[_p[0]]||{})[_p[1]]=1;}
  let subUnlockAP=0; let subUnlockN=0;
  for(const cls in subUsed){const used=Object.keys(subUsed[cls]);const free=freeSub[cls]||used[0];
    for(const sub of used){if(sub!==free){subUnlockAP+=DATA.subUnlock;subUnlockN++;}}}
  {const _vc={};for(const _bk of (b.subSpellBundles||[])){const _p=String(_bk).split("|");if(_p.length>=3){const _k=_p[0]+"|"+_p[1];(_vc[_k]=_vc[_k]||{})[_p[2]]=1;}}for(const _k in _vc){const _x=Object.keys(_vc[_k]).length-1;if(_x>0){subUnlockAP+=_x*DATA.subUnlock;subUnlockN+=_x;}}}
  if(subUnlockAP) add("Subclass unlocks ("+subUnlockN+" × 15)",subUnlockAP);
  // NO §11 ACCESS GATE HERE — removed in v0.353, one version after it was added, and deliberately not
  // replaced. v0.347 warned "⛔ <class>: you cannot build from this class" when a subclass ability or
  // spell bundle came from a class that was neither origin nor unlocked. Four reasons it is gone:
  //   1. Its premise was wrong. §11 blesses the cross-class per-feature route in as many words — "the
  //      per-feature surcharge is cheaper for a single dip" — so it warned against a purchase the
  //      published rules endorse.
  //   2. Three of four cold reviewers said do not gate; two independently noted that PACT prices class
  //      boundaries rather than forbidding them.
  //   3. It contradicted §1's pitch, which v0.352's flat unlock was chosen to honour: cross-class is
  //      "just a shopping list, not a multiclass puzzle".
  //   4. It did not work. All 192 subclass abilities are mirrored into DATA.features, so the identical
  //      purchase through the feature picker cost the same and raised no warning at all. Its only
  //      effect was to scold one of two identical paths.
  // If a gate is ever wanted again, close the mirror first (refactor/subclass-purchase-unify) — a rule
  // that guards one of two doors teaches players the wrong thing about the door it does not guard.
  // See D-GH-2026-08-17-subclass-class-access-gate (Superseded) and D-GH-2026-08-18-flat-class-unlock.
  // v0.196: paid subclass "expanded spell list" bundles — opt-in, one buy = whole bundle
  //   (always-prepared bonus spells + free cap-exempt cantrips are granted in eligibleSpells, gated on purchase).
  for(const _bk of (b.subSpellBundles||[])){const _p=String(_bk).split("|");const _sc=(DATA.subclasses[_p[0]]||{})[_p[1]];if(!_sc){W.push((_p[1]||_bk)+" is no longer in the rules data — no cost/effect applied");continue;}const _bn=_sc.spellBundle;if(!_bn)continue;
    // v0.350: bundles now price on the same three tiers as any other subclass ability —
    // origin / unlocked (sticker) / cross-class (sticker + Tier). They used to have only two, so
    // unlocking a class bought a 0 AP reduction on a bundle while saving real AP on that class's
    // abilities. §13's "spell access is free of the class tax" governs the spell ECONOMY — Foundations,
    // Ranks, slots, spells known — where a +Tier surcharge would compound per purchase. It was never
    // meant to exempt one-off spell-GRANTING features: Bard: Magical Secrets, Warlock: Pact of the Tome
    // and Wizard: Signature Spells all carry the full +Tier surcharge, and a bundle is the same shape.
    const _isO=(_p[0]===b.originClass||_p[0]===b.originClass2);
    const _isU=!_isO&&_unlkSet.has(_p[0]);
    add("Spell list — "+_p[1], _isO?_bn.origin:(_isU?(_bn.sticker??_bn.cross):_bn.cross));}
  // spellcasting: per tradition -> per discipline. Casting ability is per discipline (auto by class).
  let mbGain=0; const discInfo=[]; const tradInfo=[]; let primaryMod=0, primaryAb="—", havePrimary=false;
  (b.traditions||[]).forEach((t,ti)=>{
    if(!t||!t.name||t.name==="(none)")return;
    const tag="Trad "+(ti+1)+" "+t.name;
    const discs=(t.disciplines||[]).filter(d=>d&&d.name&&d.name!=="(none)");
    if(discs.length===0){W.push(t.name+": no Discipline chosen — pick one to activate this Tradition (nothing has been purchased for it yet)");return;}
    const hasOrigin=discs.some(d=>d.name===b.originClass||d.name===b.originClass2);
    const hasUnlk=!hasOrigin&&discs.some(d=>_unlkSet.has(d.name));const baseDisc=hasOrigin?1:(hasUnlk?0:-1);
    const foundation=Math.max(1,7-baseDisc); add(tag+" — Foundation",foundation);
    const rank=t.rank||0; const rankCost=rank>0?Math.max(0,(DATA.rankCum[rank-1]||0)-baseDisc*rank):0;
    if(rank>0) add(tag+" — Rank "+rank,rankCost);
    const extraCost=discs.length>1?(DATA.extraDiscCum[Math.min(discs.length-1,3)]||0):0;
    if(extraCost) add(tag+" — extra discipline(s)",extraCost);
    const tsaved=(7-foundation)+(rank>0?((DATA.rankCum[rank-1]||0)-rankCost):0);
    tradInfo.push({index:ti,name:t.name,baseDisc,foundation,rank,rankCost,extraCost,nDisc:discs.length,saved:tsaved});
    discs.forEach(d=>{
      const isO=(d.name===b.originClass||d.name===b.originClass2);
      const _unlk=!isO&&_unlkSet.has(d.name);const dd=(isO?1:(_unlk?0:-1))+(d.bound?1:0);
      const noOrig=d.bound?1:0; let savedOrig=0; const slotCostByLv=[], knownCostByLv=[];
      if(d.bound)mbGain+=2;
      const castAb=DATA.castAbility[d.name]||"INT"; const dmod=mod[castAb]||0;   // auto stat per discipline
      const prepared=DATA.prepared.includes(d.name);
      const bd=[]; let dcost=0;
      const cn=d.cantrips||0;
      if(cn>0){const cc=Math.max(0,(DATA.cantCum[cn]||0)-dd*cn);add(tag+" / "+d.name+" cantrips",cc);bd.push([cn+" cantrip"+(cn>1?"s":""),cc]);dcost+=cc;
        savedOrig+=Math.max(0,(DATA.cantCum[cn]||0)-noOrig*cn)-cc;}
      if(cn>prof+dmod) W.push(d.name+": cantrips "+cn+" over cap (prof + "+castAb+" mod = "+(prof+dmod)+")");if(cn>0&&(DATA.noCantrip||[]).indexOf(d.name)>=0)W.push("⛔ "+d.name+" is a half-caster and cannot learn cantrips — remove them");
      const isWarlock=(d.name==="Warlock");
      // spells known (shared; prepared casters get their list free). Warlock is a known caster, Rank-capped at 5.
      let knownTotal=0; const knownUnits=[];
      for(let Lv=1;Lv<=9;Lv++){
        const nk=(d.known&&d.known[Lv-1])||0;
        const kBase=prepared?0:nk*Math.max(1,DATA.knownUnit[Lv-1]-dd); knownCostByLv[Lv-1]=kBase;
        if(!prepared){const u=Math.max(1,DATA.knownUnit[Lv-1]-dd);for(let q=0;q<nk;q++)knownUnits.push(u);
          if(nk>0)bd.push(["L"+Lv+" known ×"+nk,kBase]);
          savedOrig+=nk*Math.max(1,DATA.knownUnit[Lv-1]-noOrig)-kBase;}
        knownTotal+=nk;
        if(nk>0 && !prepared && (rank<Lv||hd<DATA.hdGate[Lv-1])) W.push(d.name+" L"+Lv+" known: gate not met (need Rank "+Lv+" & "+DATA.hdGate[Lv-1]+" HD)");
        if(nk>0 && isWarlock && Lv>5) W.push("Warlock can't know L"+Lv+" spells (Rank caps at 5 — use Mystic Arcanum for 6th–9th)");
      }
      const knownCap=Math.max(0,dmod+hd);  // v0.172: known casters cap at spellcasting mod + Hit Dice (floored at 0 — a negative dmod+hd is not a negative cap)
      let knownAP=knownUnits.reduce((s,u)=>s+u,0);
      if(!prepared && knownTotal>knownCap){
        // every spell past the cap costs double — surcharge = the cheapest surplus spells (player-favourable)
        knownUnits.sort((a,b)=>a-b); const over=knownTotal-knownCap; let sur=0;for(let i=0;i<over;i++)sur+=knownUnits[i];
        knownAP+=sur; bd.push(["over-cap ×2 surcharge ("+over+" spell"+(over>1?"s":"")+")",sur]);
        W.push(d.name+": "+knownTotal+" spells known over cap ("+knownCap+") — "+over+" surplus charged double");
      }
      if(knownAP) add(tag+" / "+d.name+" spells known",knownAP);
      dcost+=knownAP;
      // spell slots — Warlock pact magic vs standard staircase
      let slotsAP=0,slotTotal=0,pactSlots=0,pactLevel=0,arcAP=0,arcCount=0;
      if(isWarlock){
        pactSlots=Number(d.pactSlots)||0; const pcap=dmod+prof;   // pact slots: all cast at highest level, refresh on short rest
        for(let k=1;k<=pactSlots;k++)slotsAP+=Math.max(1,(3+3*k)-dd);   // Nth pact slot = 3+3N AP
        slotTotal=pactSlots; pactLevel=Math.min(5,rank);
        if(pactSlots>0)bd.push([pactSlots+" pact slot"+(pactSlots>1?"s":"")+" @L"+pactLevel,slotsAP]);
        if(pactSlots>pcap) W.push("Warlock pact slots "+pactSlots+" over cap ("+castAb+" mod + prof = "+pcap+")");
        if(pactSlots>0 && rank<1) W.push("Warlock pact slots need Rank 1+");
        if(rank>5) W.push("Warlock Rank caps at 5 (Mystic Arcanum reaches 6th–9th)");
        if(slotsAP) add(tag+" / Warlock pact slots",slotsAP);
        // Mystic Arcanum (L6–9): one fixed spell each, 1/long rest, HD-gated, up to CHA-mod total
        const arc=d.arcanum||[]; const arcCost=[15,18,21,24];
        for(let i=0;i<4;i++){const L=6+i;const n=Number(arc[i])||0;arcCount+=n;const c=n*arcCost[i];arcAP+=c;
          if(n>0)bd.push(["Arcanum L"+L+" ×"+n,c]);
          if(n>0 && hd<DATA.hdGate[L-1]) W.push("Mystic Arcanum L"+L+" needs "+DATA.hdGate[L-1]+" Hit Dice");}
        if(arcCount>dmod) W.push("Mystic Arcanum count "+arcCount+" over cap ("+castAb+" mod "+dmod+")");
        if(arcAP) add(tag+" / Mystic Arcanum",arcAP);
        dcost+=slotsAP+arcAP;
        if(pactSlots>0 && knownTotal===0) W.push("Warlock: pact slots bought but no spells known");
      } else {
        let prevSlots=99;
        for(let Lv=1;Lv<=9;Lv++){
          const ns=(d.slots&&d.slots[Lv-1])||0;
          const sc=ns*Math.max(1,DATA.slotSticker[Lv-1]-dd); slotsAP+=sc; slotTotal+=ns;
          slotCostByLv[Lv-1]=sc; savedOrig+=ns*Math.max(1,DATA.slotSticker[Lv-1]-noOrig)-sc;
          if(ns>0)bd.push(["L"+Lv+" slots ×"+ns,sc]);
          if(ns>0 && (rank<Lv||hd<DATA.hdGate[Lv-1])) W.push(d.name+" L"+Lv+": gate not met (need Rank "+Lv+" & "+DATA.hdGate[Lv-1]+" HD)");
          if(ns>dmod) W.push(d.name+" L"+Lv+": slots "+ns+" exceed cap ("+castAb+" mod "+dmod+")");
          if(ns>prevSlots) W.push(d.name+" L"+Lv+": slots can't exceed the next-lower level ("+prevSlots+")");
          prevSlots=ns;
        }
        if(slotsAP) add(tag+" / "+d.name+" slots",slotsAP);
        dcost+=slotsAP;
        if(!prepared && slotTotal>0 && knownTotal===0) W.push(d.name+": spell slots bought but no spells known — buy spells to cast them");
      }
      if(d.bound){bd.push(["Magically Bound (gain)",-2]);dcost-=2;}
      discInfo.push({tradIndex:ti,name:d.name,castAb,castMod:dmod,dd,prepared,saveDC:8+prof+dmod,spellAtk:prof+dmod,
        cost:dcost,breakdown:bd,cantripCap:prof+dmod,bound:!!d.bound,isOrigin:isO,savedOrig:savedOrig,slotCostByLv,knownCostByLv,
        isWarlock,pactSlots,pactLevel,pactCap:dmod+prof,arcCount,arcCap:dmod});
      if(!havePrimary||isO){primaryMod=dmod;primaryAb=castAb;havePrimary=true;}
    });
  });
  if(mbGain) add("Magically Bound (gain)",-mbGain);
  // no-Foundation cantrips (#10): Wizard-list cantrips with INT — always available, even alongside a Tradition
  const hasCaster=discInfo.length>0;
  const dabbler=(b.dabblerCantrips||0);
  if(dabbler>0){add("Cantrips (Wizard list, no Foundation)",DATA.cantCum[dabbler]||0);
    if(dabbler>prof+mod.INT) W.push("Cantrips "+dabbler+" over cap (prof + INT mod = "+(prof+mod.INT)+")");}
  // innate single-spells (§12): any one spell as a stand-alone casting, 3× slot cost, 1/long rest, no discount, HD-gated
  let innateAP=0; const innate=b.innate||[];
  for(let L=1;L<=9;L++){const n=Number(innate[L-1])||0; if(n>0){innateAP+=n*(DATA.innate5x[L-1]||0);
    if(hd<DATA.hdGate[L-1]) W.push("Innate L"+L+" spell needs "+DATA.hdGate[L-1]+" Hit Dice");}}
  if(innateAP) add("Innate spells (3×, 1/rest)",innateAP);
  // summary casting stat (#9): caster -> primary discipline; cantrip-only -> INT; else none
  let castMod,castAb,hasDC;
  if(hasCaster){castMod=primaryMod;castAb=primaryAb;hasDC=true;}
  else if(dabbler>0){castMod=mod.INT;castAb="INT";hasDC=true;}
  else {castMod=0;castAb="—";hasDC=false;}
  // boons (§14): flat AP priced like features, gated by Hit Dice. DM house-rules (b.houseRules) may
  // add custom boons/drawbacks or override their AP; those overrides win over the printed values.
  const HR=b.houseRules||{}; const HRb=HR.boons||{}; const HRd=HR.draws||{};
  let boonAP=0;const _BI=[];for(const lab of (b.boons||[])){const bo=HRb[lab]||DATA.boons[lab];if(!bo){W.push(lab+" is no longer in the rules data — no cost/effect applied");continue;}const _bc=(+bo.ap||0);
    if(_blockedBoon.has(lab)){W.push('⛔ '+lab+' — blocked: needs '+(Number(bo.hd)||1)+' Hit Dice (not counted, not owned)');blockedAP+=_bc;_BLI.push([lab,_bc]);continue;}
    boonAP+=_bc;_BI.push([lab,_bc]);
    const _bms=bo.minStats||{};for(const [_ba,_bm] of Object.entries(_bms)){if((st[_ba]||10)<_bm) W.push(lab+': boon requires '+_ba+' '+_bm+'+');}
    const _bbmsa=bo.minStatsAny;if(_bbmsa&&_bbmsa.stats){const _banyMet=_bbmsa.stats.some(function(_bba){return (st[_bba]||10)>=_bbmsa.val;});if(!_banyMet)W.push(lab+': boon requires '+_bbmsa.stats.join(' or ')+' '+_bbmsa.val+'+');} }
  add("Boons",boonAP);addItems("Boons",_BI);
  addDisplay("Blocked purchases",blockedAP,_BLI.length>0);addItems("Blocked purchases",_BLI);
  // Extra Battle Master maneuvers: an escalating rung — base + step*n for the nth extra purchase, so
  // three cost 4+5+6. Priced HERE as of D-GH-2026-08-06-maneuver-afford-gate (which supersedes its own
  // first answer) so that the affordability gate, the ledger and repriceDraft() all agree on one number.
  // Before this, compute() charged nothing for maneuverBuys: the Live Sheet needed a pricing escape for
  // its gate to work at all, the ledger could not explain the spend, and repriceDraft() rewrote the
  // frozen cost to 0 while keeping the maneuvers — handing the AP back on a CharGen round-trip.
  {const _mv=b.maneuverBuys||0;
   if(_mv>0){const _mb=DATA.maneuverBuy||{base:4,step:1},_mbB=+_mb.base||0,_mbS=+_mb.step||0;
     add("Extra maneuvers",_mv*_mbB+_mbS*(_mv*(_mv-1)/2));}}
  // v0.086: DM "Tasha" house-rule — bar abilities sourced from Tasha (flagged tasha:true). Default allowed; warns only when explicitly barred.
  {const _da=(b.houseRules&&b.houseRules.dmAllows)||{};
   if(_da.tasha===false){const _tb=(coll,owned)=>{(owned||[]).forEach(k=>{const it=coll[k];if(it&&it.noncore)W.push("⛔ "+(String(k).split(": ")[1]||k)+": non-core (DM-gated) ability barred by DM house rules");});};
     _tb(DATA.features,b.features);_tb(DATA.boons,b.boons);_tb(DATA.arts,b.arts);}}
  // drawbacks
  // §14: drawbacks grant AP, capped at DATA.drawbackCap (12, the figure the Players Guide states).
  // The cap is ENFORCED when a campaign passes opts.drawbackCap and ADVISORY otherwise — see the
  // add() call below for why the two differ. The default lives in DATA so the engine, both tools
  // and the guide quote one number; it used to be a bare 14 hardcoded here, which disagreed with
  // the guide's 12 while the code enforced neither.
  // Skip unknowns, as all five sibling itemised loops do (:247 :275 :312 :441). Behaviour-identical for
  // the total (an unknown scores v=0) and for warnings (drawbackMaxStats[unknown] is {}), but it stops a
  // drawback retired from the rules rendering a phantom "<name> 0" row, and stops an all-unknown list
  // producing an itemize key with no matching ledger line (add() suppresses a zero line).
  // A drawback whose penalty can only land on a caster is worth nothing to a character who casts no
  // spells: Mana Leak (disadvantage on concentration) is pure free AP for a Fighter, and pricing cannot
  // fix that because one number has to serve both. DATA.drawbackReq gates them instead, keyed by
  // drawback so the next caster-only or class-only entry is DATA, not code. Same ⛔ HARD-violation
  // marker as the stat caps below and as reqRace/minHD.
  // Same predicate the Arts Foundation check above uses (:266) — a placeholder discipline card left on
  // its default '(none)' select is a zero-AP action CharGen's own UI labels "nothing purchased for this
  // slot yet", so it must not count as having a Foundation. An earlier version of this check used
  // `(t.disciplines||[]).length`, which a bare placeholder object satisfies with no name at all.
  const _hasDisc=(b.traditions||[]).some(function(t){return t&&(t.disciplines||[]).some(function(d){return d&&d.name&&d.name!=='(none)';});});
  let drawGain=0;const _DI=[];for(const lab of (b.drawbacks||[])){if(!HRd[lab]&&DATA.drawbacks[lab]===undefined){W.push(lab+" is no longer in the rules data — no cost/effect applied");continue;}const v=(HRd[lab]?(+HRd[lab].ap):DATA.drawbacks[lab])||0;drawGain+=v;_DI.push([lab,-v]);
    // ⛔ = a HARD rules violation, the same marker reqRace/minHD use. Owner's ruling 2026-08-19: a stat
    // cap is enforced in BOTH directions — you may not take a capped drawback above the cap, and you may
    // not raise the score past it while holding one ("your score can never exceed 12"). Without the
    // second half the drawback is a loan: take Frail at CON 10, keep the AP, buy CON to 16.
    // The Live Sheet's buy() already blocks anything not matched by SOFT_WARN, so both directions were
    // already refused there; the marker makes the intent explicit and lets CharGen classify it too.
    const _dmx=DATA.drawbackMaxStats&&DATA.drawbackMaxStats[lab]||{};for(const [_da,_dm] of Object.entries(_dmx)){if((st[_da]||10)>_dm) W.push('⛔ '+lab+': drawback requires '+_da+' '+_dm+' or lower');}
    const _drq=DATA.drawbackReq&&DATA.drawbackReq[lab];if(_drq&&_drq.caster&&!_hasDisc) W.push('⛔ '+lab+': requires at least one spellcasting discipline');
  }
  // Rows are NEGATIVE so they sum to the line total (-drawGain), the same relationship the other five
  // itemised lines have with theirs. `v` is the value actually charged, so a house-ruled drawback
  // (b.houseRules.draws) itemises at its overridden AP, not the printed one.
  // v0.351 (AZ1): the cap is REAL in a campaign and advisory outside one.
  //
  // The comment above this block claimed "§14: drawbacks grant AP, but no more than 14 AP total across
  // a character" and the code did not do it — it only warned. All 69 drawbacks together granted 217 AP,
  // more than a level-11 character's whole feature budget. That is now enforced when a campaign supplies
  // a cap (opts.drawbackCap), because a campaign has a DM whose ruling the number represents. A local,
  // un-bound character keeps the advisory warning and the full grant: there is nobody to adjudicate for
  // them, and silently clamping a solo build would change what people can already make offline.
  const _dCap=(opts&&Number.isFinite(opts.drawbackCap))?Math.max(0,opts.drawbackCap):null;
  const _dGranted=(_dCap!=null)?Math.min(drawGain,_dCap):drawGain;
  // v0.354 — MODEL (b). A drawback GRANTS AP; it is income, not negative spending.
  //
  // It used to be both, and so was worth double: foldBuild() sets b.budget = economy().earned, which
  // already includes drawbackEarned, and this line ALSO subtracted the grant from `total`. A level-1
  // character taking four drawbacks (26 AP) had 131 AP to spend against everyone else's 79.
  //
  // Two corrections were possible and both give the right `remaining`. (a) keep netting it out of the
  // cost and drop it from the budget; (b) leave it in the budget and stop netting it. (b) is what the
  // guide already promises — "Each drawback below grants AP up front" — and what economy() already
  // reports (earned 93 = 79 award + 14 drawback, spent 3). (a) would have made "total spent" go
  // NEGATIVE for any character whose drawbacks outweigh their purchases, which is not a number to put
  // in front of a player. See D-GH-2026-08-19-drawback-single-count.
  //
  // The line is kept at 0 AP so the ledger still SHOWS the drawbacks and their itemised detail; it just
  // no longer moves the total. `force` keeps the heading visible under its own detail (see add()).
  // The grant reaches the character through b.budget, and the cap is applied to the budget below.
  addDisplay("Drawbacks (refund)",-_dGranted,_DI.length>0);addItems("Drawbacks (refund)",_DI);
  if(_dCap!=null&&drawGain>_dCap)
    W.push("Drawbacks grant "+drawGain+" AP but this campaign caps them at "+_dCap+" — "+(drawGain-_dCap)+" AP not granted");
  else if(_dCap==null&&drawGain>DATA.drawbackCap)
    W.push("Drawbacks grant "+drawGain+" AP — the guide caps them at "+DATA.drawbackCap+" AP (check with your DM)");
  if((b.drawbacks||[]).length>3) W.push((b.drawbacks||[]).length+" drawbacks chosen — most DMs cap this at 2–3; more may not be reasonable or approved");
  // Lost purchases (feat/ledger-show-lost-purchases, D-GH-2026-08-10): a bought-off drawback or a
  // DM-removed boon drops OUT of the fold entirely (see _replay's boughtOff/boonRemoved guards) — it's
  // absent from b.drawbacks/b.boons, so neither line above nor the Boons line below can show it. Yet the
  // AP is genuinely, permanently spent: a buyoff's cost always counts toward economy().spent, and a
  // removed boon's original purchase cost is never refunded. _replay() stamps the match (it alone knows
  // WHICH purchase a buyoff/removal actually cancelled — compute() has no log to re-derive that from,
  // only the post-fold build) onto b._lostPurchases; this just itemises it, the same add()/addItems()
  // pattern as every other ledger line. Chosen shape (owner decision, recorded in
  // decisions/2026/D-GH-2026-08-10-ledger-show-lost-purchases.md): a new line that ADDS to total, so a
  // character who bought a drawback for 2 and then bought it off for 6 shows total=6, reconciling with
  // economy().spent for that exact case (no repurchase, no price drift) — the gate this line exists to
  // satisfy. A later repurchase of the same drawback/boon is unaffected: it's a fresh, still-open
  // purchase, priced normally by the lines above; this line only ever reflects purchases that stayed lost.
  let lostAP=0;const _LI=[];
  for(const it of (b._lostPurchases||[])){
    const c=Number(it&&it.cost)||0;
    const lab=(it&&it.kind==='drawback'?'Bought off — ':'Removed by DM — ')+(it&&it.label||'?');
    lostAP+=c; _LI.push([lab,c]);
  }
  add("Lost purchases",lostAP);addItems("Lost purchases",_LI);
  add("Starting gold",b.gold||0);
  // --- AP composition: the two-pool model (see docs/plans/2026-07-12-campaign-ap-model-cold-review.md) ---
  // Spendable AP is composed HERE, once, from two independently-stored pools so every tool shows ONE total:
  //   • Player AP = b.budget  — the character's own `award` events; raw, player-owned. AWARDS ONLY.
  //   • DM AP     = opts.dmAp  — campaign-granted; stored server-side only, NEVER in the character's log.
  //   • Drawback grant = _dGranted — derived HERE from b.drawbacks, never supplied by the caller.
  // opts.ignorePlayerAp (a campaign toggle) drops the player pool from the ceiling but NEVER refunds or
  // rewrites it — purchases already made are grandfathered; only the ceiling changes.
  // ANTI-DOUBLE-COUNT INVARIANT: `spendable` is derived and returned on THIS result object. Callers must
  // DISPLAY it, never write it (or dmAp) back into b.budget / the award log / an export — else a reload
  // double-counts. `budget` in the return is a legacy display alias of `spendable`. `remaining` =
  // spendable − total(spent). (Two pools today; the composition is additive if more are ever added.)
  //
  // WHY THE GRANT IS DERIVED, NOT PASSED IN (v0.355, and this is the whole lesson of D-GH30 again).
  // v0.354 shipped model (b) with the grant riding in on b.budget, documented as a caller contract:
  // "b.budget is EARNED AP *including* drawback grants, exactly what foldBuild() produces". Every
  // folding caller honoured it. CharGen does not fold — readBuild() reads the form, where `budget` is
  // the award field alone — so in the app most characters are actually MADE in, drawbacks silently
  // granted nothing at all. The gates could not see it: they all fold.
  //
  // A contract a caller can quietly violate is not a contract, it is a trap. And the obvious patch —
  // have CharGen sum DATA.drawbacks itself into readBuild().budget — is re-implementing rules logic
  // in a tool, which is the one thing AGENTS.md forbids outright. So the grant is derived here, where
  // the rules live, and b.budget goes back to meaning exactly one thing: AWARDS ONLY, the player's own
  // `award` events, with no drawback AP mixed in. Both callers are then correct with no knowledge of
  // drawbacks: CharGen passes its award field, foldBuild() passes earned − drawbackEarned.
  //
  // THE GRANT SITS OUTSIDE THE ignorePlayerAp BRACKET (v0.356, owner's call — see
  // D-GH-2026-08-19-drawback-grant-vs-ignore-player-ap). A drawback is not player income; it is a TRADE
  // the character made. They accepted a permanent mechanical penalty and the AP is what they got for it.
  //
  // ignorePlayerAp means "your AP comes from me, not from your award history" — it is about awards. A
  // drawback is not an award, so the toggle does not reach it. Under the alternative (grant inside the
  // bracket, which v0.355 shipped) a character in such a campaign stayed permanently Hexed and
  // Leaden-Reflexed and got NOTHING for it, while the panel still listed both drawbacks as active and
  // the ledger still itemised them — nothing on screen said the AP had been deleted.
  //
  // The cap still applies (it caps _dGranted above), so this is not an uncapped side door: a DM who
  // wants to limit drawback AP in such a campaign sets drawbackCap, which is the control built for it.
  //
  // earnedWithDm() — the frozen-ledger AP ceiling the Live Sheet displays — carves the drawback portion
  // out of the same bracket, or the two would report different totals for one character.
  const playerAp=Math.max(0,b.budget||0); const _opts=opts||{}; const dmAp=Number(_opts.dmAp)||0;
  const spendable=(_opts.ignorePlayerAp?0:playerAp)+_dGranted+dmAp; const remaining=spendable-total;
  if(remaining<0) W.unshift("OVER BUDGET by "+(-remaining)+" AP");
  // sheet — apply drawback stat effects (#7) and the Initiative skill (#8)
  const dset={};for(const x of (b.drawbacks||[]))dset[x]=1;
  const dexMod=mod.DEX;
  const init=(b.skills||[]).includes("Initiative")?(mod.WIS+prof+((b.expertise||[]).includes("Initiative")?prof:0)):dexMod;
  // v74: medium/heavy armour give no benefit unless STR >= 10
  const strOK=(st.STR||10)>=10;
  const useHeavy=arm.heavy&&strOK, useMed=arm.medium&&strOK;
  var _wa=b.wornArmour&&DATA.armours&&DATA.armours[b.wornArmour];let ac;if(_wa){if(_wa.cat==="heavy")ac=_wa.base;else if(_wa.cat==="medium")ac=_wa.base+Math.min(dexMod,2);else ac=_wa.base+dexMod;if(!arm[_wa.cat])W.push("⛔ Wearing "+b.wornArmour+" needs "+_wa.cat+" armour proficiency");if(_wa.str&&(st.STR||10)<_wa.str)W.push("⚠ "+b.wornArmour+" needs STR "+_wa.str+" (speed penalty)");}else{ac=useHeavy?18:useMed?13+Math.min(dexMod,2):arm.light?11+dexMod:10+dexMod;}if(arm.shield)ac+=2;if(dset["Thin-Skinned"])ac-=1;
  if((arm.medium||arm.heavy)&&!strOK) W.push("⛔ Medium armour requires Strength 10 (STR is "+(st.STR||10)+")");
  // §14: Frail and Glass Frame are HP-reduction drawbacks that do not stack (and may not be taken together)
  if(dset["Frail"]&&dset["Glass Frame"]) W.push("Frail and Glass Frame can't be taken together — their HP penalties don't stack");
  let hp2=hp; if(dset["Frail"]||dset["Glass Frame"]){const _vg=hd*hardy+tough*4; if(_vg>0){hp2-=_vg; W.push("Frail/Glass Frame: Grit & Vigor cannot offset HP loss at creation; their HP is suppressed");}} if(dset["Frail"])hp2-=hd; else if(dset["Glass Frame"])hp2-=hd; hp2=Math.max(1,hp2);
  let _spB=DATA.speed[b.species]||30,_spF=_spB; (b.racialTraits||[]).forEach(function(rt){var rr=DATA.racial[rt]; if(rr&&rr.spdSet&&rr.spdSet>_spF)_spF=rr.spdSet;}); var _lsp=(DATA.lineageSpeed&&DATA.lineageSpeed[b.lineage]); if(_lsp&&_lsp>_spF)_spF=_lsp; let speed=_spF; (b.racialTraits||[]).forEach(function(rt){var rr=DATA.racial[rt]; if(rr&&rr.spd)speed+=rr.spd;}); if(dset["Slow-Footed"])speed-=5; if(dset["Lame"])speed-=10;
  const saveAdj=dset["Weak-Willed"]?-1:0;
  // ----- Character size (0 AP). Halfling & Gnome packs are Small. A Halfling is ALWAYS Small
  // (even as a second origin). A Gnome paired with a non-small second origin race may CHOOSE
  // Small or Medium; otherwise Small. Everyone else is Medium. -----
  const _races=[b.species,b.species2].filter(s=>s&&s!=='(none)');
  const _isSmall=r=>(r==='Halfling'||r==='Gnome');
  let size='Medium', sizeChoosable=false;
  if(_races.indexOf('Halfling')>=0){
    var _hMed=_races.some(function(r){return r!=='Halfling'&&!_isSmall(r);});
    if(_hMed){sizeChoosable=true;size=(b.size==='Medium')?'Medium':'Small';} else size='Small';
  }
  else if(_races.indexOf('Gnome')>=0){
    const _hasMedium=_races.some(r=>!_isSmall(r));
    if(_hasMedium){sizeChoosable=true; size=(b.size==='Medium')?'Medium':'Small';}
    else size='Small';
  }
  else if(_races.indexOf('Tiefling')>=0){ sizeChoosable=true; size=(b.size==='Small')?'Small':'Medium'; }   // v0.194: Tiefling chooses Small or Medium
  return {total,remaining,budget:spendable,playerAp,dmAp,drawbackAp:_dGranted,spendable,lines:L,itemize:_ITEMS,warnings:W,hp:hp2,baseHP:row.baseHP,prof,tier,mods:mod,effScore,size,sizeChoosable,
    // Traits owned for free via a heritage pack — derived, never stored. See packTraitsFor().
    packTraits:packTraitsFor(b.species,b.species2),
    ac,init,speed,castMod,castAb,hasDC,saveAdj,discInfo,tradInfo,dabbler,
    saveDC:hasDC?(8+prof+castMod):null,spellAtk:hasDC?(prof+castMod):null,hardyCap:vgcap,conMod:cm,goldGp:DATA.goldPurse+(b.gold||0)*50,
    status: remaining<0?("OVER BUDGET by "+(-remaining)+" AP"):remaining===0?"exact — fully spent":(remaining+" AP under budget")};
}

/* ==========================================================================
 * Event sourcing (Live Sheet parity)
 *
 * A character is a base build plus an append-only log of events. Each event
 * is one of:
 *   { type:'award',  amount, note, label, disc }        - grants AP (budget+)
 *   { type:'buy',    cat, payload, cost }               - applies MUT[cat]
 *   { type:'buyoff', refVal, cost }                     - removes a drawback
 *   { type:'names',  ...spell/feat name payload, cost } - folds in names
 *   { type:'name',   name }                             - sets character name
 * ========================================================================== */

// The ten single-instance proficiency lists, which never hold duplicates. Applied at the end of
// _replay() (the historical home of this code) and again per-event by repriceDraft(). Idempotent, and
// deduping early reaches the same final build as deduping once at the end — a later duplicate push
// still appends and is collapsed on the next call.
//
// unlockedClasses added (fix/engine-pricing-edge-cases, 2026-08-22): compute()'s class-unlock pricing
// reads this array's LENGTH as the unlock count (see "Class unlocks" above), with no ownership check —
// a duplicate unlockclass event for an already-unlocked class charged a full extra 8 AP even though the
// GATING logic elsewhere already treats it as one class. arts/boons/subAbilities are NOT included here:
// unlike unlockedClasses, whether a duplicate there should dedupe, refund, or be blocked outright is a
// rules question that hasn't been answered (see the NEXT-board task) — don't extend this list to them
// without that answer first.
const _PROF_LISTS = ['saves','skills','expertise','toolExpertise','tools','instruments','masteries','racialTraits','racialSpells','unlockedClasses'];
function _dedupeProfLists(b) {
  for (const k of _PROF_LISTS) if (Array.isArray(b[k]) && b[k].length > 1) b[k] = [...new Set(b[k])];
}

export function baseBuild() { return {name:'',budget:0,originClass:'Fighter',originClass2:'(none)',species:'Human',species2:'(none)',
 stats:{STR:10,DEX:10,CON:10,INT:10,WIS:10,CHA:10},hd:1,profBonus:2,hardy:0,tough:0,saves:[],skills:[],expertise:[],toolExpertise:[],
 languages:1,languageNames:[],grantNames:{},tools:[],instruments:[],customProfs:[],weaponProf:{},masteries:[],armour:{},
 arts:[],lineage:'',racialSpells:[],
 racialTraits:[],extraClasses:0,unlockedClasses:[],dabblerCantripNames:[],innateNames:[],featNames:{},features:[],traditions:[],subAbilities:[],freeSub:{},subSpellBundles:[],boons:[],innate:[],drawbacks:[],gold:0,
 attune:0,ki:0,sorcery:0,martiallyBound:'(none)',appearance:{},size:'Medium',
 lineage:'',racialSpells:[],
 inPlay:true}; }

/* mutators: apply one purchased payload to the build in place */
export const MUT = {
 create:(b,p)=>{},   // level-1 baseline (Hit Die + starting state); effect already in baseBuild
 patch:(b,p)=>{Object.assign(b,p.patch);},   // imported-from-generator bundle (a whole field set)
 names:(b,p)=>{if(p.eb)b.epicBoonAbil=p.eb;if(p.fs)b.fightingStyleNames=p.fs;if(p.mm)b.metamagicNames=p.mm;if(p.mv)b.maneuverNames=p.mv;if(p.fsc)b.fsCantripNames=p.fsc;if(p.dab)b.dabblerCantripNames=p.dab;if(p.inn)b.innateNames=p.inn;if(p.feat)b.featNames=p.feat;if(p.lang)b.languageNames=p.lang;if(p.grants)b.grantNames=p.grants;(p.tr||[]).forEach(function(t){var d=b.traditions[t.ti]&&b.traditions[t.ti].disciplines[t.di];if(d){d.cantripNames=t.cn;d.knownNames=t.kn;if(t.an)d.arcanumNames=t.an;}});},
 hd:(b,p)=>b.hd=p.to, prof:(b,p)=>b.profBonus=p.to, abil:(b,p)=>b.stats[p.ab]=p.to,
 skill:(b,p)=>b.skills.push(p.v), expertise:(b,p)=>b.expertise.push(p.v), toolexpertise:(b,p)=>(b.toolExpertise=b.toolExpertise||[]).push(p.v), save:(b,p)=>b.saves.push(p.v),
 lineage:(b,p)=>b.lineage=p.v,wornArmour:(b,p)=>b.wornArmour=p.v, racialspell:(b,p)=>(b.racialSpells=b.racialSpells||[]).push(p.v),
 feat:()=>0, feature:(b,p)=>b.features.push(FEAT_ALIAS(p.v)), art:(b,p)=>(b.arts=b.arts||[]).push(p.v), boon:(b,p)=>b.boons.push(p.v), mvbuy:(b,p)=>{b.maneuverBuys=(b.maneuverBuys||0)+1;},
 tool:(b,p)=>b.tools.push(p.v), instrument:(b,p)=>b.instruments.push(p.v), mastery:(b,p)=>b.masteries.push(p.v),
 language:(b,p)=>b.languages=p.to, vigor:(b,p)=>b.hardy=p.to, grit:(b,p)=>b.tough=p.to,
 armour:(b,p)=>b.armour[p.v]=true, wprof:(b,p)=>b.weaponProf=clone(p.wp),
 species:(b,p)=>b.species=p.v, oclass:(b,p)=>b.originClass=p.v,
 racial:(b,p)=>b.racialTraits.push(p.v),   // own-species traits only (cross-race is creation-only, guide §10)
 drawback:(b,p)=>b.drawbacks.push(p.v),
 attune:(b,p)=>b.attune=p.to, ki:(b,p)=>b.ki=p.to, sorcery:(b,p)=>b.sorcery=p.to,
 mbound:(b,p)=>b.martiallyBound=p.v,
 subbundle:(b,p)=>{(b.subSpellBundles=b.subSpellBundles||[]).push(p.v);},
 unlockclass:(b,p)=>{(b.unlockedClasses=b.unlockedClasses||[]).push(p.v);},
 freesub:(b,p)=>{(b.freeSub=b.freeSub||{})[p.cls]=p.sub;},
 subabil:(b,p)=>{(b.subAbilities=b.subAbilities||[]).push(p.v);},
 tasharule:(b,p)=>{(b.houseRules=b.houseRules||{}).dmAllows=Object.assign({},(b.houseRules||{}).dmAllows||{},{tasha:p.v});},
 found:(b,p)=>{const ti=p.ti??0;const newDisc={name:p.disc,bound:false,cantrips:0,slots:[0,0,0,0,0,0,0,0,0],known:[0,0,0,0,0,0,0,0,0],pactSlots:0,arcanum:[0,0,0,0]};if(ti===0&&!b.traditions.length){b.traditions=[{name:p.trad,rank:0,disciplines:[newDisc]}];}else if(!b.traditions[ti]){b.traditions[ti]={name:p.trad,rank:0,disciplines:[newDisc]};}else{(b.traditions[ti].disciplines=b.traditions[ti].disciplines||[]).push(newDisc);}},
 rank:(b,p)=>{const ti=p.ti??0;if(b.traditions[ti])b.traditions[ti].rank=p.to;},
 cantrip:(b,p)=>{const ti=p.ti??0,di=p.di??0;const d=b.traditions[ti]&&b.traditions[ti].disciplines[di];if(d)d.cantrips=p.to;},
 slot:(b,p)=>{const ti=p.ti??0,di=p.di??0;const d=b.traditions[ti]&&b.traditions[ti].disciplines[di];if(d)d.slots[p.L-1]=p.to;},
 known:(b,p)=>{const ti=p.ti??0,di=p.di??0;const d=b.traditions[ti]&&b.traditions[ti].disciplines[di];if(d)d.known[p.L-1]=p.to;},
 dbound:(b,p)=>{const ti=p.ti??0,di=p.di??0;const d=b.traditions[ti]&&b.traditions[ti].disciplines[di];if(d)d.bound=!!p.v;},
};

export function activeEvents(events) {
  const evs = (Array.isArray(events) ? events : []).filter(Boolean);
  // boughtOff: the SET of purchase-event INDICES (position within `evs`) a buyoff has cancelled — not a
  // per-VALUE flag. The old shape (`{[value]: 1}`) made ANY buyoff for a drawback suppress EVERY buy of
  // that value forever, including ones taken AFTER the buyoff, so a bought-off drawback could never be
  // taken again: the retake was silently dropped from the build and its AP never counted. See
  // D-GH-2026-08-06-buyoff-keyed-by-event.
  //
  // Resolved in one forward pass, matching each buyoff to the OLDEST not-yet-cancelled purchase of that
  // value (FIFO) — no new event field, no schema change. `seq` was considered as the match key instead
  // of array position, but the engine has no concept of `seq` at all (it's tool-side bookkeeping;
  // fixtures never carry one) — plain FIFO-by-position needs no identifier and fully covers every case
  // this bug can construct:
  //   - one buy + one buyoff (the overwhelming existing case): matches the sole open entry, reproducing
  //     today's outcome exactly — this is why existing characters' totals are unaffected.
  //   - buy, buyoff, buy again: the buyoff consumes the first entry while the queue is non-empty; the
  //     second buy arrives to a now-empty queue and stays open, uncancelled — the fix.
  //   - two buys then one buyoff: cancels the older of the two, leaving the newer active — a reasonable,
  //     deterministic default for an edge case the task doesn't require a specific answer to.
  // Do not "fix" this into a seq lookup without checking the fixtures first — they'd all lack the field.
  const boughtOff = new Set();
  const _openDraws = {};   // drawback value -> queue of still-open purchase indices, oldest first
  // boonRemoved (feat/dm-edit-events): a DM can remove a player-bought boon with NO refund — the
  // player already spent the AP, and _spendCost() must keep counting it (removal ≠ buyoff, which DOES
  // refund). Resolved with the exact same FIFO-by-value pattern as boughtOff above, on purpose: a boon
  // removal keyed by NAME instead of by matched purchase would reintroduce the identical bug
  // D-GH-2026-08-06-buyoff-keyed-by-event just fixed for drawbacks — a removed-then-rebought boon has
  // to stay bought, not silently vanish from the build again. `dmRemoveBoon` events carry `refVal` (the
  // boon name) exactly like `buyoff` carries it for drawbacks.
  const boonRemoved = new Set();
  const _openBoons = {};   // boon value -> queue of still-open purchase indices, oldest first
  // lost (feat/ledger-show-lost-purchases): a bought-off drawback or DM-removed boon drops OUT of the
  // fold (see _replay's boughtOff/boonRemoved guards), so it never reaches compute() via b.drawbacks/
  // b.boons — yet the AP it cost is still real, permanent spend (a buyoff's cost always counts via
  // _spendCost; a removed boon's original purchase cost was never refunded). Built HERE, in the same
  // FIFO pass that resolves the match, because only this pass knows WHICH purchase a buyoff/removal
  // actually cancelled — compute() sees only the post-fold build and has no log to re-derive it from.
  // Only pushed when the match actually lands (`q && q.length`), same gating as boughtOff/boonRemoved
  // themselves — an unmatched buyoff/removal is a no-op the UI should never emit, and defensively
  // shouldn't manufacture a phantom ledger line either.
  const lost = [];
  // fix/engine-pricing-edge-cases (2026-08-22): a malformed event missing its value/reference field
  // (payload.v or refVal) used to key into the same `undefined` bucket as every OTHER malformed event
  // of that type, letting an unrelated buyoff/removal incorrectly cancel an unrelated drawback/boon
  // purchase. Not reachable through either shipped tool's own emit() calls today (both always populate
  // these fields) — needs an already-malformed LOG (hand-edited, or a future bug elsewhere) — but a
  // silent cross-match on `undefined` is exactly the "missing validation on event payloads" gap this
  // file's own review standard calls out. `v == null` (not `===`) catches both null and undefined.
  evs.forEach((e, i) => {
    if (e.type === 'buy' && e.cat === 'drawback') {
      const v = e.payload && e.payload.v;
      if (v == null) return;
      (_openDraws[v] = _openDraws[v] || []).push(i);
    } else if (e.type === 'buyoff') {
      if (e.refVal == null) return;
      const q = _openDraws[e.refVal];
      if (q && q.length) { boughtOff.add(q.shift()); lost.push({ kind: 'drawback', label: e.refVal, cost: Number(e.cost) || 0 }); }
    } else if (e.type === 'buy' && e.cat === 'boon') {
      const v = e.payload && e.payload.v;
      if (v == null) return;
      (_openBoons[v] = _openBoons[v] || []).push(i);
    } else if (e.type === 'dmRemoveBoon') {
      if (e.refVal == null) return;
      const q = _openBoons[e.refVal];
      if (q && q.length) { const _idx = q.shift(); boonRemoved.add(_idx); const _orig = evs[_idx]; lost.push({ kind: 'boon', label: e.refVal, cost: Number(_orig && _orig.cost) || 0 }); }
    }
  });
  return { evs, boughtOff, boonRemoved, lost };
}

// AP-spend contribution of a single event — 0 for anything that isn't a spend-bearing buy/buyoff/names
// event (drawback buys never count as spend; see economy()'s drawbackEarned handling instead). Shared
// by economy() (final totals) and _replay() (D-GH34: needs the running value at each event, not just
// the final total, so it can't just call economy() once at the end).
function _spendCost(e) {
  if (e.type === 'buy' && e.cat !== 'drawback') return Number(e.cost) || 0;
  if (e.type === 'buyoff') return Number(e.cost) || 0;
  if (e.type === 'names') return Number(e.cost) || 0;
  return 0;
}

// AP tally core, over an ALREADY-resolved activeEvents() snapshot.
//
// Split out of economy() so the fold/rebuild paths can tally without a second activeEvents() pass:
// _replay() has to resolve that snapshot anyway, and both foldBuild() and rebuildStateFromEvents()
// used to call _replay(log) and then economy(log), each independently re-running activeEvents() —
// one redundant filter(Boolean) allocation plus one redundant boughtOff sweep over the whole log.
//
// economy()'s public signature and behaviour are deliberately UNCHANGED (it is bridged into all three
// tools as economy(events) — see AGENTS.md/D-GH37); this is the same function with its first line
// lifted one level out, not a new API.
//
// Reusing a snapshot taken before replay is safe because _replay() never writes to an event or to the
// log array — it only reads event fields and mutates the build `b`. boughtOff depends solely on
// e.type/e.refVal, and this tally solely on e.type/e.amount/e.cat/e.cost/e.payload.v, so a snapshot
// resolved before the replay is identical to one resolved after it.
function _economyFrom(evs, boughtOff) {
  let earned = 0, spent = 0, drawbackEarned = 0;
  evs.forEach((e, i) => {
    if (e.type === 'award') earned += Number(e.amount) || 0;
    else if (e.type === 'buy' && e.cat === 'drawback') {
      if (!boughtOff.has(i)) drawbackEarned += (-(Number(e.cost) || 0));
    }
    // LEGACY SHAPE (v0.354). Both tools now emit cat:'drawback', but older CharGen exports delivered
    // drawbacks as a coalescing PATCH whose whole cost is the grant — LS-001 carries one. Under the old
    // model that worked by accident: the grant reduced `total` directly, so it did not matter which side
    // of the ledger it sat on. Under model (b) the grant reaches the character ONLY through the budget,
    // so a patch-delivered drawback would silently vanish and the character would lose that AP. Matched
    // narrowly: a patch that changes drawbacks and NOTHING else, with a negative cost.
    else if (e.type === 'buy' && e.cat === 'patch' && (Number(e.cost) || 0) < 0
             && e.payload && e.payload.patch && Object.keys(e.payload.patch).length === 1
             && Object.prototype.hasOwnProperty.call(e.payload.patch, 'drawbacks')) {
      if (!boughtOff.has(i)) drawbackEarned += (-(Number(e.cost) || 0));
    }
    else spent += _spendCost(e);
  });
  earned += drawbackEarned;
  // drawbackEarned exposed (D-GH41) so a caller can isolate "raw award total" from "total earned" without
  // re-deriving drawback-bought-off filtering itself — purely additive, existing {earned,spent,available}
  // destructuring is unaffected.
  return { earned, spent, available: earned - spent, drawbackEarned };
}

export function economy(events) {
  const { evs, boughtOff } = activeEvents(events);
  return _economyFrom(evs, boughtOff);
}

// feat/ap-model-reconcile (D-GH-2026-08-10-ap-model-reconcile): a DM-funded character read "Earned Lv 0"
// with "0 earned" even when the DM had granted real AP, because economy().earned can only see the
// character's OWN log — DM AP is stored server-side only (characters.ap), by design (see compute()'s
// two-pool model just above baseBuild()), so economy() structurally cannot know about it.
//
// Deliberately a DISPLAY-TIME composition, not a change to economy() itself (the owner's decision:
// keeps economy() pure/log-only, preserving the anti-double-count invariant) — a small, pure, exported
// function so both tools compute "earned, accounting for DM AP" identically rather than drifting via
// two local copies. Mirrors compute()'s own spendable formula exactly:
// `(ignorePlayerAp ? 0 : playerAp) + dmAp` — same two pools, same ignore-switch semantics, just for the
// EARNED side of the ledger instead of the spendable ceiling.
//
// NOT the same figure as "AP left"/"AP Available" (compute().spendable − economy().spent, G1, #355,
// unaffected by this) — this only feeds Track-Level ("Earned Lv") and "AP to reach Earned Lv N+1" in
// both tools, which use pace-earned, not spend, as their basis.
export function earnedWithDm(eco, opts) {
  const _opts = opts || {};
  const dmAp = Number(_opts.dmAp) || 0;
  const playerEarned = (eco && Number(eco.earned)) || 0;
  // economy().earned = awards + drawbackEarned. ignorePlayerAp drops the AWARDS only: a drawback is a
  // trade the character made, not an award, so it survives the toggle (v0.356 — see the long note on
  // compute()'s AP composition). Without this carve-out the Live Sheet's frozen-ledger ceiling and
  // compute()'s spendable disagree by exactly the grant for every character in such a campaign, which
  // is the D-GH30 display-divergence failure mode all over again.
  const drawbackEarned = (eco && Number(eco.drawbackEarned)) || 0;
  return (_opts.ignorePlayerAp ? drawbackEarned : playerEarned) + dmAp;
}

/* creationLocked timeline — for each event in an already-resolved activeEvents() list, was the
 * creation lock ALREADY set when that event arrived?
 *
 * Extracted out of _replay()'s inner loop (feat/tool-coin-time-costs) rather than copied, because a
 * second consumer now needs the same answer: the gold-and-downtime ledger charges a purchase only if
 * it was made in play, and "in play" is defined as exactly this lock (Players Guide §2, "Gold and
 * downtime only start mattering for things you buy during play"). Duplicating the lock rules into
 * wealthLedger() would put two copies of a one-way ratchet in the engine, which is the drift AGENTS.md
 * exists to prevent — and this one is subtle enough (three interacting config fields, an explicit
 * unlock that suppresses the auto-lock, a spend threshold that is itself a function of frozen costs)
 * that the copies would not have stayed equal for long.
 *
 * A faithful extraction, not a rewrite: the lock state depends ONLY on event fields (type, payload,
 * noLock, and _spendCost's own reads), never on the build being folded, so hoisting it into a pre-pass
 * over the same `evs` array cannot change any value _replay() previously saw. The returned entry is
 * the state ENTERING each event — the same `_wasLocked` semantics compute()'s racial-trait pricing has
 * always used, i.e. a purchase made at the exact moment the threshold trips is still a creation
 * purchase, not the first in-play one.
 *
 * Takes the post-activeEvents() list, so indices line up with _replay()'s own loop and with
 * activeEvents().evs — never the raw log. */
function _lockStates(evs) {
  const out = new Array(evs.length);
  let _locked = false, _spent = 0, _campaignBound = false;
  // creationLockConfig / creationUnlocked bookkeeping (see the block comment above _replay).
  // _cfgAuto: undefined = "not configured" (legacy: campaignBound alone arms the auto-lock, which is
  // what fixtures EV-003/EV-007/EV-009 assert); true = armed even without campaignBound (a solo
  // player opting in); false = explicitly disarmed even WITH campaignBound (a DM switching it off).
  // _cfgThreshold: null/undefined = fall back to DATA.level1AP, preserving the historical anchor.
  // _explicitUnlocked: set by creationUnlocked, cleared by a later creationLocked — see below.
  let _cfgAuto, _cfgThreshold, _explicitUnlocked = false;
  for (let _i = 0; _i < evs.length; _i++) {
    const e = evs[_i];
    out[_i] = _locked;
    if (e.type === 'creationLocked') { _locked = true; _explicitUnlocked = false; }
    else if (e.type === 'creationUnlocked') { _locked = false; _explicitUnlocked = true; }
    else if (e.type === 'creationLockConfig') {
      // Last-write-wins. Only fields actually present are updated, so a config event that sets
      // just a threshold doesn't silently reset `auto` (and vice versa).
      if (e.payload && Object.prototype.hasOwnProperty.call(e.payload, 'auto')) _cfgAuto = e.payload.auto;
      if (e.payload && Object.prototype.hasOwnProperty.call(e.payload, 'threshold')) _cfgThreshold = e.payload.threshold;
      _explicitUnlocked = false;   // re-configuring re-arms: a DM setting a new threshold means "this applies again"
    }
    else if (e.type === 'campaignBound') _campaignBound = true;
    else if (!e.noLock) _spent += _spendCost(e);
    // THE AUTOMATIC THRESHOLD LOCK WAS RETIRED HERE (feat/creation-ceiling, owner decision R3).
    //
    // It used to read:  if (_autoArmed && !_explicitUnlocked && _spent > _thr) _locked = true;
    //
    // That is the bug this change exists to kill. Creation ended by INFERENCE — the first time
    // cumulative spend crossed a threshold, silently, with no user action and no way back. A player
    // experimenting in the builder could permanently lock a character that had never been played, and
    // three live characters did exactly that (Moss Stormspud, Skylar, Caspian — locked at 84, 85 and
    // 87 AP against a 79 default that was never any of their real budgets).
    //
    // Creation now ends only by an explicit `creationLocked` event — a person pressing a button. What
    // replaces the tripwire is a CEILING the player cannot cross by accident (see creationCeiling()):
    // the purchase is refused at the line and the tools offer the two real exits, rather than letting
    // them walk through it and silently changing their pricing on the other side.
    //
    // `_cfgAuto`, `_cfgThreshold` and `_campaignBound` are still tracked above: the threshold is now
    // the CEILING's figure (read via creationLockState/creationCeiling), and `campaignBound` still
    // marks real campaign membership for other callers. Only the automatic *locking* is gone.
  }
  return out;
}

/* =========================================================================
 * GOLD AND DOWNTIME — PACT's second and third currencies (Players Guide §2, §16)
 * -------------------------------------------------------------------------
 * "Talent is bought with three coins: power, gold, and the long patience of
 * practice." Every IN-PLAY purchase reads its gold price and downtime cost off
 * its AP cost, from one universal band (js/economy-bands.js). Creation purchases
 * are exempt and cost AP only.
 *
 * THREE THINGS THIS SECTION DELIBERATELY DOES NOT DO.
 *
 * 1. It does not touch compute(). Gold and downtime are a spending ledger beside
 *    the AP one, not an input to any derived statistic — no HP, AC, AP or warning
 *    depends on them. That is what keeps every function here additive and engine-
 *    parity-neutral, and it is why adding a band is not a DATA.version bump.
 *
 * 2. It does not enforce. Every function here QUOTES a price or TALLIES what was
 *    paid; none refuses a purchase. That is the owner's decision (tracked balance,
 *    soft warning) and it is also what the rules require: §16 gives the DM mentor
 *    discounts, outright waivers, and a coin-for-time trade, and §17 states plainly
 *    that "the DM can waive or reduce any cost at any time, AP, gold, or downtime".
 *    A tool that hard-blocked would be wrong about the rules, not merely strict.
 *
 * 3. It does not re-price history. A purchase's gold and downtime freeze onto its
 *    own event at the moment it is made, exactly as its AP `cost` already does —
 *    see the `gp`/`days` event fields below. §16: "Don't switch mid-game, or a
 *    purchase's price will move under the players' feet."
 *
 * GOLD AND DOWNTIME ARE NOT THE SAME SHAPE OF CURRENCY (owner, feat/tool-coin-time-costs
 * revision — the original two-pool-both-ways design below was corrected the same day it
 * first shipped, before any real campaign used it):
 *
 *   GOLD banks, per character, and is DM-authoritative in a campaign — "in a campaign
 *   world, the DM is the one who applies the money" (owner). Income lives in two places,
 *   precisely as AP does: player-side, as `wealth` events in a solo character's own LOG;
 *   or DM-side, server-only, in characters.gold, written exclusively through the
 *   award_gold() RPC and never by a player. wealthLedger() can only ever see the first,
 *   structurally — same limitation economy() has for DM-awarded AP, resolved the same
 *   way, by composing the two at display time via wealthWithDm(). Do not "fix" this by
 *   teaching wealthLedger() about the server; that would make it impure and double-count
 *   on every caller that already adds the DM pool itself (see earnedWithDm's header for
 *   the same argument made for AP).
 *
 *   DOWNTIME does not bank at all. It is a single window, declared for the WHOLE PARTY at
 *   once, that REPLACES the last declaration rather than adding to it: "the time should
 *   not keep adding up... spend it now or wait till another opportunity" (owner). So it
 *   has no per-character column on `characters` and no `award_*` RPC — see
 *   resolveDowntimeWindow() (below) for how a character's current window is resolved
 *   (campaign vs. solo), and campaign_downtime_declarations / declare_downtime() /
 *   get_downtime_window() in sql/rls-policies.sql for where and how the party-wide
 *   figure actually lives.
 * ========================================================================= */

/** Resolve the economy setting token ('off' | 'standard' | 'fast') for a campaign's
 *  `rules` object — or for a solo player's local settings object, which uses the same
 *  shape so one function serves both and the two cannot drift.
 *
 *  Unknown or absent → DATA.defaultEconomy ('off'). Deliberately fails CLOSED: a typo
 *  in a stored setting shows no prices rather than silently charging a campaign under a
 *  band nobody chose. */
export function economySetting(rules) {
  const t = rules && rules.economy && rules.economy.band;
  return Object.prototype.hasOwnProperty.call(DATA.economyBands, t) ? t : DATA.defaultEconomy;
}

/** The economy band a character carries in its OWN log, or null if it never set one.
 *
 *  A solo player has no campaign to hold the setting, and the character envelope's `rules`
 *  field is the rules-VERSION stamp, not a settings object — so the choice rides the LOG as
 *  an `econSetting` event. That makes it survive export, import, and the CharGen↔Live Sheet
 *  handoff for free, and makes it last-write-wins by replay like every other setting the log
 *  carries. The engine ignores the event everywhere else: it is not a `buy`, so it costs no
 *  AP, folds into no build, and trips no creation lock.
 *
 *  Last one wins — a player may switch bands on their own character; §16's "pick one and
 *  stick to it" is advice to a table, not something a single-player tool should enforce. */
export function logEconomySetting(events) {
  let found = null;
  (Array.isArray(events) ? events : []).forEach(e => {
    if (e && e.type === 'econSetting' && e.payload
        && Object.prototype.hasOwnProperty.call(DATA.economyBands, e.payload.band)) found = e.payload.band;
  });
  return found;
}

/** The band actually in force for a character, resolving the one precedence rule the three
 *  tools must not each invent for themselves:
 *
 *    a campaign that has resolved its rules  →  the CAMPAIGN's band, always
 *    anything else                           →  the character's own logged band, else 'off'
 *
 *  The campaign wins outright, and does so WITHOUT the character's logged setting acting as a
 *  fallback within an active campaign: the whole point of the DM's dial is that a player
 *  cannot opt their character out of the table's economy, and a stale `econSetting` from
 *  before the character joined must not resurface as a private band.
 *
 *  `campaignActive` is deliberately a caller-supplied flag rather than something inferred from
 *  campaignRules being truthy. The tools already distinguish "no campaign" from "campaign whose
 *  rules could not be read right now" (window._rulesStatus), and conflating them here would
 *  silently drop a campaign to its player's own band the moment the network hiccuped — the same
 *  failure mode the DM-AP chip's 'unavailable' state exists to prevent. When rules are
 *  unconfirmed, callers pass false and get the character's own setting, which is the honest
 *  local answer rather than a guess at the table's. */
export function resolveEconomySetting(opts) {
  const o = opts || {};
  if (o.campaignActive) return economySetting(o.campaignRules);
  return logEconomySetting(o.events) || DATA.defaultEconomy;
}

/** The band descriptor for a setting token — {label, rows, blurb}. `rows` is null for
 *  'off'. Accepts a token OR an already-resolved rules object, so callers can pass
 *  whichever they have without each writing its own normalizing branch. */
export function economyBand(settingOrRules) {
  const t = (typeof settingOrRules === 'string') ? settingOrRules : economySetting(settingOrRules);
  return DATA.economyBands[t] || DATA.economyBands[DATA.defaultEconomy];
}

/** Is the gold-and-time economy switched on at all? The one predicate every tool should
 *  gate its price labels and wallet UI on, rather than each comparing tokens to 'off'. */
export function economyOn(settingOrRules) {
  const band = economyBand(settingOrRules);
  return !!(band && band.rows);
}

/**
 * purchaseCost(ap, setting) — the gold and downtime a purchase costing `ap` AP demands.
 * The single pricing function; every tool label and every ledger charge goes through it.
 *
 * Returns null when the economy is off, which callers should read as "show no price at
 * all" — distinct from a zero-cost row, which means "this purchase is genuinely free"
 * and still prints (Tier 1 advances are free ON PURPOSE and the guide wants players to
 * see that: "Low tiers are nearly free, on purpose").
 *
 * Matching walks the rows in order and takes the first whose `maxAp` the cost does not
 * exceed; `maxAp: null` is the open-ended top row. A negative or zero AP cost — a
 * drawback's grant, a refund quote — takes the bottom row, i.e. free: you are not
 * charged coin and calendar for taking on a flaw.
 *
 * @param {number} ap      the purchase's AP cost
 * @param {string|object} settingOrRules  token, campaign rules, or local settings
 * @returns {{gp:number, days:number, time:string, row:object, band:string}|null}
 */
export function purchaseCost(ap, settingOrRules) {
  const t = (typeof settingOrRules === 'string') ? settingOrRules : economySetting(settingOrRules);
  const band = economyBand(t);
  if (!band || !band.rows) return null;
  const n = Math.max(0, Math.ceil(Number(ap) || 0));
  const row = band.rows.find(r => r.maxAp === null || n <= r.maxAp) || band.rows[band.rows.length - 1];
  return { gp: row.gp, days: row.days, time: row.time, row, band: t };
}

/**
 * The gold and downtime actually PAID for one purchase event — the frozen figures if the
 * event carries them, otherwise today's list price for its AP cost.
 *
 * Why frozen fields win: a DM waiver, a mentor discount, or a coin-for-time trade all
 * produce a purchase that did not pay list price, and all three are explicit rules (§16).
 * Stamping the real figures onto the event is the same mechanism the AP `cost` field
 * already uses, so a later band change — or a DM switching Standard to Fast — cannot
 * retroactively rewrite what a character already spent.
 *
 * `gp`/`days` are read independently: a waived gold cost with the downtime still owed is
 * a perfectly ordinary DM ruling, so one may be frozen while the other falls through to
 * list price.
 */
function _paidFor(e, setting) {
  const list = purchaseCost(Number(e.cost) || 0, setting);
  if (!list) return null;
  const hasGp   = e && Object.prototype.hasOwnProperty.call(e, 'gp')   && e.gp   !== null && e.gp   !== undefined;
  const hasDays = e && Object.prototype.hasOwnProperty.call(e, 'days') && e.days !== null && e.days !== undefined;
  return {
    gp:   hasGp   ? (Number(e.gp)   || 0) : list.gp,
    days: hasDays ? (Number(e.days) || 0) : list.days,
    listGp: list.gp, listDays: list.days, time: list.time,
    discounted: (hasGp && (Number(e.gp) || 0) !== list.gp) || (hasDays && (Number(e.days) || 0) !== list.days),
  };
}

/**
 * wealthLedger(events, opts) — the gold-and-downtime ledger over a character's own LOG.
 * The exact counterpart of economy() for the other two currencies, and shaped to match it
 * so the tools' two ledger panels stay symmetrical.
 *
 * ONLY IN-PLAY PURCHASES ARE CHARGED. "Anything you buy when you first build your
 * character costs only AP" (§2) — so each purchase is charged if and only if the creation
 * lock was ALREADY set when it was made, read from the same _lockStates() timeline
 * _replay() folds the build with. This is why the creation exemption cannot drift out of
 * step with the rest of the engine: there is one definition of "in play", not two.
 *
 * Drawbacks are never charged. A drawback GRANTS AP rather than costing it, and coin and
 * calendar buy advancement — you do not pay a trainer to become asthmatic. Buyoffs, which
 * genuinely are in-play purchases with a real AP cost, ARE charged.
 *
 * GOLD AND DOWNTIME ARE NOT SYMMETRICAL (owner, feat/tool-coin-time-costs revision). Gold
 * banks — a `wealth` event's `gp` is player-side income and SUMS across every such event,
 * exactly like a DM's gold grant sums onto `characters.gold`. Downtime does not: "the time
 * should not keep adding up... spend it now or wait till another opportunity". So a `wealth`
 * event's `days` is NOT summed here at all — declaring a downtime window is a separate
 * concept, resolved by resolveDowntimeWindow() (below), which reads the LATEST such value
 * rather than a running total. This is the one place the same event type carries two
 * currencies with two different aggregation rules.
 *
 * @param {object[]} events   the character's LOG
 * @param {object} [opts]     {band} — setting token, campaign rules, or local settings
 * @returns {{on:boolean, band:string, gpSpent:number, daysSpent:number,
 *            gpGranted:number, entries:object[]}}
 */
export function wealthLedger(events, opts) {
  const _opts = opts || {};
  const setting = (typeof _opts.band === 'string') ? _opts.band : economySetting(_opts.band || _opts.rules);
  const { evs, boughtOff, boonRemoved } = activeEvents(events);
  const on = economyOn(setting);
  const out = { on, band: setting, gpSpent: 0, daysSpent: 0, gpGranted: 0, entries: [] };
  if (!on) return out;

  const lockAt = _lockStates(evs);
  evs.forEach((e, i) => {
    // Player-side GOLD income only. Counted whether or not creation has ended: a starting
    // purse or a DM-blessed local adjustment is not a purchase and has no creation exemption
    // to respect. A `wealth` event's `days` (if present) is NOT read here — see the header
    // note above; resolveDowntimeWindow() handles that half of the same event.
    if (e.type === 'wealth') {
      out.gpGranted += Number(e.payload && e.payload.gp) || 0;
      return;
    }
    const isBuy = e.type === 'buy' && e.cat !== 'drawback';
    if (!isBuy && e.type !== 'buyoff') return;
    if (!lockAt[i]) return;                                     // creation purchase — AP only (§2)
    // A bought-off drawback / DM-removed boon drops out of the fold, but its coin and calendar
    // were still really spent — the same reasoning _spendCost() applies to its AP. So these are
    // charged, not skipped; the guards exist only to label the entry as lost.
    const lost = (e.type === 'buy') && ((e.cat === 'boon' && boonRemoved.has(i)) || boughtOff.has(i));
    const paid = _paidFor(e, setting);
    if (!paid) return;
    out.gpSpent   += paid.gp;
    out.daysSpent += paid.days;
    // WHO READS `entries` (asked and answered 2026-08-19, so it isn't mistaken for dead weight later;
    // corrected same day once `ts` below stopped being test-only). wealthWithDm() reads it directly
    // now — `ts` is what lets it filter downtime spend to "since the current window opened" rather
    // than the ledger's all-time `daysSpent` total (see wealthWithDm's own header for why those must
    // differ). testing/scripts/economy-ui-e2e.mjs also reads it: `entries` is how the gate proves the
    // creation exemption (which purchases were charged, by name, not just how much), and `discounted`
    // is how it proves the freeze. Deleting either to tidy the API would delete both a real feature and
    // the test that guards it.
    //
    // `listGp`/`listDays` are still read by nothing but the deferred G2 task's future display — kept
    // for the same reason as before. _paidFor() has
    // to compute the list price regardless — it is both the fallback when an event carries no frozen
    // figures and the comparison that produces `discounted` — so surfacing it is two properties on an
    // object already being built, not extra work. They are the seam a "paid 175 gp (list 350)" display
    // would need, which is exactly what the deferred per-purchase-discount task (G2) would want; see
    // decisions/2026/D-GH-2026-08-19-tool-coin-time-costs.md, "Not done, deliberately". Trimming them
    // would save nothing measurable and cost that seam.
    out.entries.push({
      idx: i, cat: e.cat || e.type, label: e.label || (e.payload && e.payload.v) || e.refVal || '',
      ap: Number(e.cost) || 0, gp: paid.gp, days: paid.days, ts: Number(e.ts) || 0,
      listGp: paid.listGp, listDays: paid.listDays, discounted: paid.discounted, lost,
    });
  });
  return out;
}

/**
 * Would a purchase appended to this log RIGHT NOW be charged gold and downtime — i.e. has the
 * character finished creation?
 *
 * wealthLedger() answers this per past event; a tool's buy panel needs it for the next, not-yet-made
 * one, so it can quote a price the purchase will actually be charged (and stay silent during
 * creation, which costs AP only). Computed by running the same lock timeline over the log plus one
 * probe entry, so the quote a player sees before buying and the charge wealthLedger() applies after
 * are decided by one piece of code rather than two that agree today.
 *
 * The probe is a bare object with no type/cost, so it can neither trip the spend threshold itself nor
 * be mistaken for a real event; its only role is to give _lockStates() one more slot to report into.
 */
export function chargesGoldAndTime(events) {
  const { evs } = activeEvents(events);
  const st = _lockStates(evs.concat([{ type: '_probe', noLock: true }]));
  return !!st[st.length - 1];
}

/**
 * resolveDowntimeWindow(opts) — the downtime window in force for a character right now: how
 * many days are available, and the timestamp purchases must be made ON OR AFTER to count
 * against it. Mirrors resolveEconomySetting()'s precedence exactly, and for the identical
 * reason:
 *
 *   an active campaign with a resolved window  →  the CAMPAIGN's window, always
 *   anything else                              →  the character's own self-declared window, else none
 *
 * The campaign wins outright, without the character's own declaration acting as a fallback
 * within an active campaign — a player must not be able to sit on a bigger window than the
 * one the DM just declared for the whole party by holding onto a stale self-declaration.
 * `campaignActive` is caller-supplied for the same reason it is on resolveEconomySetting: a
 * network hiccup must fall back to the character's own honest local answer, not silently
 * read as "no window".
 *
 * CAMPAIGN: `opts.campaignWindow` is a pre-resolved {days, startTs} the caller fetched from
 * the campaign's downtime declarations — the party base plus this character's own bonus,
 * already summed. This function never talks to the network; composing that figure is the
 * DM Console's/Live Sheet's job (see js/campaign.js), exactly as dmAp/ignorePlayerAp are
 * resolved outside compute() and passed in.
 *
 * SOLO: derived from the character's own LOG — the LATEST `wealth` event that carries a
 * `days` field (present, even if 0 — see the `!= null` check below, which lets a player
 * explicitly close out a window without granting a new one). This is last-one-wins, NOT
 * summed, unlike that same event type's `gp` field (see wealthLedger()'s header for why the
 * two currencies disagree here): declaring a new window replaces the old one.
 *
 * Returns null when no window has ever been declared — nothing to spend against yet, which
 * wealthWithDm() reads as "every downtime purchase so far is an unfunded overdraft", the
 * same honest-zero-balance behaviour an unfunded gold wallet already has.
 */
export function resolveDowntimeWindow(opts) {
  const o = opts || {};
  if (o.campaignActive) return o.campaignWindow || null;
  let found = null;
  (Array.isArray(o.events) ? o.events : []).forEach(e => {
    if (e && e.type === 'wealth' && e.payload && e.payload.days != null) {
      found = { days: Number(e.payload.days) || 0, startTs: Number(e.ts) || 0 };
    }
  });
  return found;
}

/**
 * Compose a wealthLedger() with the DM-held gold pool and the resolved downtime window, for
 * display. The gold-and-downtime twin of earnedWithDm() — a campaign character's real
 * balance is server-side (characters.gold, and the campaign's downtime declarations), which
 * a pure log function structurally cannot see — but gold and downtime compose differently
 * from each other here, matching how differently they behave (owner, feat/tool-coin-time-costs
 * revision):
 *
 *   GOLD banks. `gpLeft` is ALL-TIME cumulative — (the ledger's own gpGranted, i.e. a solo
 *   player's self-declared income, plus any extra `dmGold`) minus ALL gold ever spent. This
 *   is exactly the original, unrevised behaviour; nothing about gold changed.
 *
 *   DOWNTIME does not bank. "The time should not keep adding up... spend it now or wait till
 *   another opportunity" — so `daysLeft` is `opts.window.days` minus ONLY the downtime spent
 *   ON OR AFTER `opts.window.startTs`, read from `ledger.entries` (each purchase's own `ts`),
 *   never from the ledger's all-time `daysSpent` total. That total is still returned, for
 *   history/ledger display — it is simply the wrong figure for "how much of THIS window is
 *   left", which is the only thing `daysLeft` means now.
 *
 * `opts.window` is resolveDowntimeWindow()'s return value. null (no window ever declared)
 * means `daysLeft` is 0 minus all-time downtime spend — every past downtime purchase reads
 * as an immediate, unfunded overdraft, matching how a gold wallet with nothing granted
 * already behaves.
 *
 * `gpLeft`/`daysLeft` may legitimately go NEGATIVE — that is the soft warning the tools
 * render, not an error state. A DM can hand a player an ability and settle the coin (or the
 * calendar) later, and §17 explicitly allows waiving costs after the fact; clamping to zero
 * here would hide exactly the overdraft a player needs to see.
 */
export function wealthWithDm(ledger, opts) {
  const _opts = opts || {};
  const dmGold = Number(_opts.dmGold) || 0;
  const l = ledger || {};
  const gpGranted = (Number(l.gpGranted) || 0) + dmGold;
  const gpSpent = Number(l.gpSpent) || 0;
  const daysSpent = Number(l.daysSpent) || 0;   // all-time total — history/display only, see header

  const win = _opts.window || null;
  const windowDays = win ? (Number(win.days) || 0) : 0;
  const entries = Array.isArray(l.entries) ? l.entries : [];
  const daysSpentInWindow = win
    ? entries.reduce((s, e) => s + (((Number(e.ts) || 0) >= (Number(win.startTs) || 0)) ? (Number(e.days) || 0) : 0), 0)
    : daysSpent;   // no window ever declared: every downtime purchase so far is unfunded

  return {
    gpGranted, gpSpent, gpLeft: gpGranted - gpSpent,
    windowDays, daysSpentInWindow, daysLeft: windowDays - daysSpentInWindow,
    daysSpent,
  };
}

/**
 * tradeCoinTime(cost, mode) — §16, "Trading coin for time". "Pay roughly three times the
 * gold to halve the downtime a purchase demands, or accept triple the downtime to cut its
 * gold cost by half."
 *
 * mode 'goldForTime' spends coin to buy back weeks; 'timeForGold' spends calendar to save
 * coin. Returns a fresh {gp, days} — the caller stamps it onto the purchase event as the
 * frozen `gp`/`days`, which is what makes the trade survive a later band change.
 *
 * Rounds gold UP and downtime DOWN to whole units, so the halving never hands the player a
 * fractional coin and never leaves a stray part-day on the calendar. "The rate is steep on
 * purpose: a convenience, never a shortcut" — and the guide's own framing ("roughly",
 * "the DM sets the exact exchange, and may refuse it outright") is why this returns a
 * suggestion the UI presents rather than a value it imposes.
 */
export function tradeCoinTime(cost, mode) {
  const r = DATA.economyTradeRates[mode];
  if (!r || !cost) return null;
  return {
    gp:   Math.ceil((Number(cost.gp)   || 0) * r.goldMult),
    days: Math.floor((Number(cost.days) || 0) * r.timeMult),
    mode,
  };
}

/**
 * formatDowntime(days) — a day count in the Players Guide's own vocabulary.
 *
 * The bands print "6 weeks", "3 months", "2 years"; a SUMMED balance rarely lands on a
 * band row, so this renders at most the two largest non-zero units (year, month, week,
 * day) — "1 year 4 months" rather than "500 days", which no player would parse at the
 * table. Month = 30 days and year = 365, matching js/economy-bands.js; the arithmetic is
 * a display convenience, not a calendar.
 */
export function formatDowntime(days) {
  const d = Math.round(Number(days) || 0);
  if (!d) return 'None';
  const sign = d < 0 ? '-' : '';
  let rem = Math.abs(d);
  const parts = [];
  // Under two months, skip the month unit entirely and render in weeks. Without this, a 42-day
  // balance printed "1 month 1 week" while the band row it came from says "6 weeks" — the same
  // quantity in two vocabularies, on the same screen. The bands themselves only reach for months
  // at 90 days, so this threshold keeps the summed balance speaking the band's own language.
  const units = rem < 60 ? [['week', 7], ['day', 1]] : [['year', 365], ['month', 30], ['week', 7], ['day', 1]];
  for (const [unit, size] of units) {
    const n = Math.floor(rem / size);
    if (n) { parts.push(n + ' ' + unit + (n === 1 ? '' : 's')); rem -= n * size; }
    if (parts.length === 2) break;
  }
  return sign + parts.join(' ');
}

/** "12 AP · 350 gp · 6 weeks" — the one-line price label every tool shows on a purchasable
 *  item, built here so the three tools cannot format it three different ways. Falls back to
 *  the AP alone when the economy is off, and omits a zero cost rather than printing
 *  "0 gp · None", which reads as missing data rather than as free. */
export function priceLabel(ap, settingOrRules) {
  const n = Number(ap) || 0;
  const bits = [n + ' AP'];
  const c = purchaseCost(n, settingOrRules);
  if (c) {
    if (c.gp) bits.push(c.gp.toLocaleString() + ' gp');
    if (c.days) bits.push(c.time);
    if (!c.gp && !c.days) bits.push('free of coin and time');
  }
  return bits.join(' · ');
}

// Replay an append-only event log onto build `b` in place (shared by foldBuild
// and rebuildStateFromEvents). Returns the activeEvents() snapshot it resolved
// ({evs, boughtOff}) so callers can tally the economy via _economyFrom() without
// making activeEvents() scan the whole log a second time.
//
// creationLocked bookkeeping (D-GH31/D-GH32): a one-way ratchet tracking whether creation
// pricing is still available at each point in the LOG, in LOG order — locked by an
// explicit `creationLocked` event (always, unconditionally — this is the primary intended
// trigger, e.g. a "Finalise character" button), or inferred once cumulative AP spend
// exceeds DATA.level1AP AND the character has a `campaignBound` event somewhere earlier
// in the LOG (D-GH32: a locally-only, never-campaign-bound character never auto-locks via
// the threshold — only an explicit creationLocked event can lock it). If `campaignBound`
// occurs AFTER spend has already crossed the threshold, it fires the automatic lock
// retroactively, right at the point of binding (not applied to purchases before it).
// Mirrors economy()'s spent accounting via the shared _spendCost() helper (drawback buys never
// count as spend); kept here, not in economy(), because economy() only returns final totals and
// this needs the running value at each event. racial-trait purchases are tagged with the locked
// state AS OF JUST BEFORE that purchase (not after), so a purchase whose own cost crosses the
// threshold still prices as the one that crossed it, not as already-locked — matching this
// codebase's existing "prices freeze at time of purchase" rule (see priceOf() in the Live Sheet
// tool). NOTE: `campaignBound` (real cloud-campaign membership, gating this mechanism) is distinct
// from campaign restrictions/rules: real campaign membership today lives only as a `campaign_id`
// column in Supabase, invisible to pure LOG replay, which is exactly why a LOG-level `campaignBound`
// event is needed here at all. (The old local `cat:'campaign'`/`b.campaign` PACTRULES code-paste
// feature was retired in refactor/retire-pactrules-code; any legacy `cat:'campaign'` event now
// replays inert via the missing-mutator no-op below.)
//
// e.noLock: an event (buy/buyoff/names) may opt its own cost OUT of the automatic
// threshold accumulation below — real AP accounting (economy()) is unaffected, this
// ONLY excludes the cost from counting toward crossing DATA.level1AP. For a one-shot
// import/creation burst (e.g. a future CharGen-style export) whose total legitimately
// exceeds the anchor (a higher-level starting character), tagging every event in that
// burst noLock:true keeps it from self-triggering the automatic lock before an
// explicit creationLocked event (or genuine later spending) actually earns it.
//
// PRECEDENCE (D-GH-2026-08-02-creation-lock-switch; documented as a hard rule so it can't drift).
// Two lock mechanisms coexist and behave differently — do not collapse them:
//   * EXPLICIT — `creationLocked` / `creationUnlocked`, resolved in LOG order, last-write-wins.
//     `creationLocked` is a one-way ratchet ONLY in the sense that nothing except a later
//     `creationUnlocked` reopens it; the pair is a two-state toggle, not an irreversible flag.
//   * AUTOMATIC — spend past a threshold. Derived fresh on every replay, so it is inherently
//     reversible: undo the purchase that crossed the threshold and it un-fires. Armed by
//     `creationLockConfig{auto:true}`, or — when no config event exists at all — by `campaignBound`
//     alone (the historical behaviour, asserted by fixtures EV-003/EV-007/EV-009; changing this
//     default would break them, so it is load-bearing, not incidental).
//   * `creationLockConfig{auto,threshold}` — last-write-wins, per-field (a config setting only
//     `threshold` leaves `auto` as it was). `threshold:null`/absent means DATA.level1AP.
//   * A `creationUnlocked` SUPPRESSES the automatic lock as well as clearing the explicit one,
//     until a later `creationLocked` or `creationLockConfig` re-arms. Without this, unlocking a
//     character already over the threshold would be a no-op — it would re-lock on the same pass.
//     This is a deliberate choice, NOT the same thing as raising the threshold: unlock grants
//     open-ended creation room; raising the threshold grants a specific amount.
// Everything above changes only WHEN the lock flips. It never changes the freeze-at-purchase
// guarantee: `_wasLocked` is still captured before the event advances state, so a purchase is
// always priced at the lock state in force at the moment it happened.
//
// Single pass: the lock/spend bookkeeping for event i never depends on anything the build-mutation
// half of the loop does, so both run interleaved per-event rather than as two separate passes over
// `evs` — `_wasLocked` is captured before advancing state for this event, same as before.
//
// `onApplied` (optional) fires once per event that actually reached the build mutators, as the last
// thing in the loop body, with (event, build, wasLocked). It exists for repriceDraft() below and is
// deliberately placed AFTER the MUT call so a caller sees the build with that event applied. Events
// `_replay` short-circuits past (name/names/non-buy/bought-off drawback) never fire it — none of them
// changes what the build COSTS, so a re-pricing caller has nothing to do for them. foldBuild() and
// rebuildStateFromEvents() pass two arguments, so this is inert for every existing caller.
//
// It is a pure observer: the return value is ignored, and `_spent` keeps accumulating the costs the
// log arrived with. That is deliberate and load-bearing for repriceDraft() — the lock position must be
// read from what was actually paid, never from what a caller is in the middle of rewriting, or the two
// chase each other (see repriceDraft's "ALL-OR-NOTHING" note for what that cost the first time).
function _replay(b, log, onApplied) {
  const ae = activeEvents(log);
  const { evs, boughtOff, boonRemoved } = ae;
  // Stamp the lost-purchases list straight from activeEvents()'s own FIFO match (feat/ledger-show-
  // lost-purchases) — same idea as _raceTraitLocked/_vigorRankTier just below: record log-only context
  // on the build so compute(), which only ever sees `b`, can itemize it without re-deriving anything.
  b._lostPurchases = ae.lost;
  const _lockAt = _lockStates(evs);
  for (let _i = 0; _i < evs.length; _i++) {
    const e = evs[_i];
    const _wasLocked = _lockAt[_i];

    if (e.type === 'name') { b.name = e.name; continue; }
    if (e.type === 'names') { MUT.names(b, e); continue; }   // names take the whole event
    if (e.type !== 'buy') continue;                          // award/buyoff/dmRemoveBoon affect economy only
    if (e.cat === 'drawback' && boughtOff.has(_i)) continue;   // bought off: removed (this specific purchase, not the value)
    // DM-removed boon (feat/dm-edit-events): suppressed from the fold only — its cost stays counted in
    // _spendCost() above (already ran for this event, unconditionally) because removal grants no refund.
    // The mirror image of the drawback buyoff line above: THERE the AP comes back, HERE it never does.
    if (e.cat === 'boon' && boonRemoved.has(_i)) continue;
    if (e.cat === 'racial' && e.payload && e.payload.v)
      (b._raceTraitLocked = b._raceTraitLocked || {})[e.payload.v] = _wasLocked;
    // Stamp each NEW Vigor rank with the tier it was bought at, so compute() can price it at what the
    // player actually paid instead of re-pricing the whole stack at today's tier. Same idea as
    // _raceTraitLocked just above — record the purchase context on the purchase — but Vigor is a COUNT
    // rather than a list of named items, so the stamp is an array indexed by rank. Read before the
    // mutator runs, which is the only point where the previous rank total is still visible.
    if (e.cat === 'vigor' && e.payload) {
      const _from = b.hardy || 0, _to = Math.max(0, Math.floor(Number(e.payload.to)) || 0);
      const _tier = _tierForHD(b.hd || 1);
      b._vigorRankTier = (b._vigorRankTier || []).slice(0, _to);
      for (let n = _from + 1; n <= _to; n++) b._vigorRankTier[n-1] = _tier;
    }
    (MUT[e.cat] || (() => {}))(b, e.payload || {});
    if (onApplied) onApplied(e, b, _wasLocked);
  }
  // single-instance proficiency lists never hold duplicates. Factored into _dedupeProfLists() (just
  // above baseBuild()) so repriceDraft() can apply the SAME nine lists mid-walk — see its call site.
  // Set-based dedupe keeps the same first-occurrence-wins ORDER as the previous
  // `filter((v,i) => arr.indexOf(v) === i)` form (Set iteration order is insertion order) but runs in
  // O(n) instead of O(n²) — the old form re-scanned the whole array once per element, which dominated
  // replay cost on long logs (a 2000-event log spent most of _replay() in these nine indexOf sweeps).
  // Equivalent here because these lists hold STRINGS: the one case where the two forms differ is NaN
  // (indexOf can never match it, so the old form dropped every NaN; Set's SameValueZero keeps one),
  // which a proficiency-name list cannot contain.
  _dedupeProfLists(b);
  // half-casters can't hold cantrips
  (b.traditions || []).forEach(t => (t.disciplines || []).forEach(d => {
    if (d && (DATA.noCantrip || []).indexOf(d.name) >= 0) { d.cantrips = 0; d.cantripNames = []; }
  }));
  return ae;
}

// creationLockThreshold(campaignRules): the AP-spent figure past which the automatic creation
// lock fires for a character in this campaign. Callers stamp the result into a character's log
// as a `creationLockConfig{threshold}` event; the engine's replay never reads campaign settings
// directly (that would break pure-log-replay and make old logs re-price under today's settings).
//
// WHICH CURVE — this is the whole point of the function. The lock asks "has this character
// finished being built?", a question about SPEND, so the threshold must come from the level-BUDGET
// curve (cumulative AP a complete level-N build has spent): Standard L1 = 79, Generous L1 = 83.
// It must NOT come from the award pace (AP per SESSION, ~7 — PACT awards by the session, not by
// the level) and must NOT come from the Guide's pregen-roster totals (the twenty Emberwatch sample
// characters, "1st-level recruit (50 AP) to 20th-level archmage (491 AP)" — a cast list, not a
// curve). Those totals used to BE `DATA.apByLevel`, which is why this function was originally
// written to override a wrong default; fix/ap-budget-curve-standard replaced the ladder with the
// Standard budget curve, so `DATA.level1AP` is now 79 and the fallback below is correct by default
// rather than merely tolerable. Conflating the three is a documented trap — see
// D-GH-2026-07-14-advancement-tracks ("Conflating them was a real error in two of the reviews").
//
// This function still earns its keep: it honours a campaign that TUNED its curve (Generous → 83,
// or any custom {l1, inc}), falling back to DATA.level1AP — the Standard L1 — when there is no
// campaign or the campaign never tuned one.
export function creationLockThreshold(campaignRules) {
  const curve = campaignRules && campaignRules.levelBudgetCurve;
  const l1 = curve && Number(curve.l1);
  return (Number.isFinite(l1) && l1 > 0) ? l1 : DATA.level1AP;
}

// foldBuild(events): the Live Sheet's fold — build a character from a blank
// level-1 base by replaying the whole event log; budget = total AP earned.
export function foldBuild(events) {
  const log = (Array.isArray(events) ? events : []).filter(Boolean);
  const b = baseBuild();
  const ae = _replay(b, log);        // reuse _replay's snapshot instead of re-deriving it via economy(log)
  // AWARDS ONLY (v0.355). economy().earned = awards + drawbackEarned, and compute() derives the
  // drawback grant itself from b.drawbacks — so handing it `earned` would grant every drawback twice.
  // Subtract here rather than teaching economy() a second "earned" figure: the frozen ledger's `earned`
  // is what the DM Console and Live Sheet display and must keep meaning "everything this LOG earned".
  const _eco = _economyFrom(ae.evs, ae.boughtOff);
  b.budget = _eco.earned - _eco.drawbackEarned;
  return b;
}

// isCreationDraft(events): has the creation lock fired at any point in this log?
//
// "Draft" is the whole basis on which repriceDraft() decides whether it may touch anything, and it is
// derived state (D5) rather than a stored flag, so it belongs here next to _replay rather than being
// re-derived by each caller from spend and thresholds. Exported so gates can assert the reconciliation
// invariant on exactly the logs it applies to — an earlier version of the fuzzer approximated this as
// "could the lock fire", which excluded every CharGen-shaped log, since _cgEnsureLockArmed() stamps
// creationLockConfig{auto:true} into all of them.
export function isCreationDraft(events) {
  const log = (Array.isArray(events) ? events : []).filter(Boolean);
  // Read the state AFTER the last real event, via the same inert probe chargesGoldAndTime() uses.
  //
  // This used to walk _replay()'s per-event callback and ask whether any event was ENTERED already
  // locked — which cannot see a lock that is the FINAL event, because no later event exists to enter.
  // That was survivable while the automatic tripwire existed, since spend usually crossed the line
  // partway through a log. It is NOT survivable now: with the tripwire retired (feat/creation-ceiling),
  // the only way to lock is pressing "Finish creating", and that event is almost always the last one.
  // A player would finish creation, save, reload — and be a draft again, with repriceDraft() free to
  // rewrite the very prices the lock exists to freeze. Caught by CI's tool-pricing gate.
  const { evs } = activeEvents(log);
  const st = _lockStates(evs.concat([{ type: '_probe', noLock: true }]));
  return !st[st.length - 1];
}

// creationLockState(events): the creation-lock picture for one character's log, in one call —
// `{locked, armed, confirmed, threshold, spentTowardThreshold, remainingToThreshold}`.
//
// WHY THIS IS AN ENGINE EXPORT and not a third hand-written copy. CharGen and Live Sheet each carry
// their own `_creationLockState()` that scans the log for `creationLockConfig` and resolves
// armed/threshold with the same last-write-wins-per-field rule `_lockStates()` uses. Those two are
// already duplicates of each other; DM Console needing the same answer would have made three. This
// project's recurring failure is exactly that shape — a canonical rule extended once while
// hand-written mirrors of its older form quietly keep the old behaviour (see the round-6 note in
// `docs/sessions/2026-08-27-feature-hd-gate.md`, where a correct engine fix left two tool-layer copies
// stale). One export, and the two existing copies can be collapsed onto it as a follow-up.
//
// `locked` is authoritative: it comes from the same `_lockStates()` timeline compute()'s racial-trait
// pricing reads, so it can never disagree with the pricing actually applied. `threshold` is the figure
// in force (an explicit `creationLockConfig{threshold}`, else `DATA.level1AP`), and `confirmed` says
// which of those two it is — a caller can then distinguish "measured against this character's own
// number" from "measured against the engine default", which is precisely the distinction that made two
// live characters lock against 79 when their campaign's figure was 83.
//
// Pure and additive: reads only the log, changes no compute() output, so it needs no `DATA.version`
// bump.
//
// ⚠ `spentTowardThreshold` IS NOT `economy().spent`, AND MUST NOT BE DISPLAYED AS "AP spent".
// It is the lock's own accounting: the figure `_lockStates()` compares against the threshold, which
// deliberately EXCLUDES every event tagged `noLock` — and CharGen tags its entire creation burst that
// way (D-GH34, so an imported higher-budget character can't self-trip the lock partway through a
// synthetic ordering). The practical effect is stark: measured on the live character Anders Pipeleaf,
// this reads **0** while `economy().spent` reads **67**. Both are correct for their own question.
// Named the long way precisely so the two can't be confused at a call site — a number that means one
// thing being rendered as if it meant another is the exact failure this codebase keeps paying for.
export function creationLockState(events) {
  const log = (Array.isArray(events) ? events : []).filter(Boolean);
  const { evs } = activeEvents(log);
  let armed, thr = null, spent = 0;
  for (const e of evs) {
    if (e.type === 'creationLockConfig' && e.payload) {
      if (Object.prototype.hasOwnProperty.call(e.payload, 'auto')) armed = e.payload.auto;
      if (Object.prototype.hasOwnProperty.call(e.payload, 'threshold')) thr = e.payload.threshold;
    } else if (!e.noLock) spent += _spendCost(e);
  }
  const threshold = (thr == null) ? DATA.level1AP : thr;
  // `locked` is the state AFTER the last real event, obtained the way chargesGoldAndTime() already
  // does it: run the timeline over the log plus one inert probe, and read the probe's slot.
  //
  // NOT `!isCreationDraft(log)`, which was wrong here and was caught only by driving the real console:
  // _lockStates() reports the state ENTERING each event, so a log whose FINAL event is `creationLocked`
  // has no later slot carrying the lock, and isCreationDraft() reports it as still a draft. The live
  // characters that exposed nothing are the ones that happen to have purchases after their lock.
  const _st = _lockStates(evs.concat([{ type: '_probe', noLock: true }]));
  return {
    locked: !!_st[_st.length - 1],
    armed: armed === undefined ? null : !!armed,   // null = not configured (legacy campaignBound path)
    confirmed: thr != null,                        // false = falling back to the engine default
    threshold,
    spentTowardThreshold: spent,
    remainingToThreshold: threshold - spent,
  };
}

// creationCeiling(events, opts) — the AP ceiling a character may not spend past while still being
// built, and where they currently stand against it.
//
// Returns {enforced, base, drawbackBonus, ceiling, spent, remaining, locked}.
//
// THE RULE (owner, R3): ceiling = the DM's assigned creation figure + the character's drawback grant.
// The DM's figure is a ONE-OFF SNAPSHOT stamped into the log as `creationLockConfig{threshold}`; it is
// deliberately NOT recomputed from current DM AP, because a later chapter award must not silently raise
// a creation budget. (That exact mistake was made against live data while designing this — a reward of
// +5 AP inflated three characters' apparent ceilings — which is the argument for freezing it.)
//
// The DRAWBACK HALF IS LIVE, not snapshotted, and that asymmetry is deliberate: a drawback is a trade
// the character makes during creation, so taking one mid-build must hand back the room it paid for
// (owner decision G2 — otherwise a player who took Soul Debt could not spend what it granted them).
// `opts.drawbackAp` is compute()'s own post-cap grant, passed in rather than re-derived here so the
// campaign's drawback cap is applied in exactly one place.
//
// `enforced` is false when the log carries NO explicit threshold. That is fail-open by design: every
// character that predates this feature has no ceiling, and a character with no DM to set one (local,
// solo, offline) must keep working exactly as before. Callers MUST check it — enforcing the
// `DATA.level1AP` fallback as if it were a real ceiling would strand every existing character at a
// number nobody chose, which is the very failure being fixed.
//
// `spent` is the REAL spend (economy().spent), not creationLockState()'s threshold accounting — a
// ceiling is about what the character has actually bought, so it must count the creation burst that
// the lock's own bookkeeping deliberately ignores. Pass it in if you already have it.
export function creationCeiling(events, opts) {
  const o = opts || {};
  const st = creationLockState(events);
  const drawbackBonus = Math.max(0, Number(o.drawbackAp) || 0);
  const base = st.threshold;
  const ceiling = base + drawbackBonus;
  const spent = Number.isFinite(Number(o.spent)) ? Number(o.spent) : economy(events).spent;
  return {
    enforced: st.confirmed,   // no explicit threshold stamped -> no ceiling, see above
    base, drawbackBonus, ceiling, spent,
    remaining: ceiling - spent,
    locked: st.locked,
  };
}

// wouldExceedCeiling(events, cost, opts) — the one predicate both player tools gate a purchase on, so
// "may I buy this?" is answered in the engine rather than re-implemented per tool.
//
// False for a LOCKED character (creation is over; the ceiling no longer applies and normal AP
// affordability takes over), false when nothing is enforced, and false for a refund/grant (cost <= 0 —
// a drawback must never be refused by the ceiling it raises).
export function wouldExceedCeiling(events, cost, opts) {
  const c = Number(cost) || 0;
  if (c <= 0) return false;
  const st = creationCeiling(events, opts);
  if (!st.enforced || st.locked) return false;
  return (st.spent + c) > st.ceiling;
}

// repriceDraft(events): re-derive the frozen `cost` of every purchase in a DRAFT character's log, so
// its ledger telescopes back to compute().total.
//
// WHY THIS EXISTS (D-GH-2026-08-05-pricing-model, D2). Before the lock a character is a draft: there is
// only one pricing context, so "what was paid" and "what it costs to build today" must agree. After the
// lock, prices freeze per purchase and the two are MEANT to diverge. Nothing enforced the draft half —
// a purchase's cost was frozen at the moment it was made, and a LATER change to pricing context left it
// stale. Measured in a real browser: buy four Halfling traits (ledger 13, compute 13), then switch
// species to Dwarf — the traits become cross-race and compute jumps to 24 while the ledger stays 13;
// switch back and the identity patch quotes -4, taking the ledger to 2 against compute's 13. That
// negative quote is the same mechanism that left Anders Tealeaf's log summing to 15 against a
// compute() of 33.
//
// ALL-OR-NOTHING, AND THAT IS THE POINT. Either the log is a draft, in which case every purchase in it
// re-prices, or the lock has fired somewhere, in which case NOTHING is touched and the function returns
// its input. There is deliberately no per-event "this one was pre-lock, that one wasn't" mode.
//
// The first version had one, and it was wrong in two ways that a code review caught (see D7):
//   * The auto-lock's position is a function of cumulative spend — i.e. of the very costs this function
//     rewrites. Re-pricing moved the lock point, which changed which events were re-pricable, which
//     moved it again: the numbers kept shifting on repeated calls over the same log. A fixed-point loop
//     hid that rather than fixing it, and needed O(events after the lock) passes to settle.
//   * Worse, it broke the guarantee it claimed to keep. Edit a locked character's species and the new
//     quote lands at the old event's index, which sits BEFORE the lock — so the pass treated it as
//     draft state and re-priced downstream purchases that were bought while locked. Reproduced: a trait
//     frozen at 6 AP silently became 2.
// Deciding once, for the whole log, removes both: the lock position is read from what was actually
// paid, never from what this pass is about to write, so a second call cannot move anything. Where a
// re-price pushes a draft past its own threshold the new costs stand as that draft's final
// reconciliation, and the next call sees a locked log and leaves it alone — a fixed point after one
// pass, by construction rather than by iteration.
//
// HOW. One pass with a running build, pricing each purchase as its own sequential delta on everything
// before it. That is the basis CharGen's import burst (_buildEventBurst) already uses, so the two agree
// by construction. Riding on _replay() rather than walking the log here is load-bearing: racial-trait
// pricing depends on the per-trait `_raceTraitLocked` map that _replay stamps, and the lock bookkeeping
// is subtle enough (see the PRECEDENCE block above) that a second copy would drift — which is exactly
// how D-GH36 got its `found`/`dbound` bug.
//
// WHAT IT WILL NOT TOUCH: anything at all once the lock has fired; drawbacks, whose recorded cost is
// income rather than spend (economy() reports it under `earned`, and foldBuild feeds that into
// b.budget, so rewriting it would change how much AP the character HAS — caught by the fuzzer);
// and buy-off, award and name events, which _replay never routes here in the first place.
//
// Non-mutating: the returned log is a fresh array of fresh event objects. Callers assign the result.
//
// A log containing a buy-off will NOT telescope exactly, and that is correct rather than a gap: buying
// a drawback off costs 3x its refund (a table price for undoing something), so the AP is genuinely
// spent on nothing compute() can see. Gates asserting ledger==compute must scope to buy-off-free logs.
export function repriceDraft(events) {
  const log = (Array.isArray(events) ? events : []).filter(Boolean).map(e => clone(e));
  const b = baseBuild();
  let prev = 0, anyLocked = false;
  const priced = [];
  _replay(b, log, (e, build, wasLocked) => {
    if (wasLocked) anyLocked = true;
    // Dedupe BEFORE pricing. _replay only collapses the proficiency lists once, at the very end, so
    // mid-walk a duplicate purchase is still sitting in the array and inflates compute() — while the
    // final build has it collapsed away. Pricing off that gap charges real AP for a purchase the
    // character never receives (the fuzzer's minimal repro: buy the CON save twice, ledger 13 against
    // a compute() of 5). Both tools guard against emitting duplicates, so this is a degenerate shape
    // rather than a routine one, but _replay repairs it silently and the pricer has to agree.
    _dedupeProfLists(build);
    const now = compute(build).total;
    if (e.type === 'buy' && e.cat !== 'drawback') priced.push([e, now - prev]);
    prev = now;
  });
  // Costs are collected first and written only here, so a lock firing late in the log still protects
  // the events before it — the decision is made on the whole log, never event by event.
  if (anyLocked) return log;
  for (const [e, cost] of priced) e.cost = cost;
  return log;
}

// Seed a working build from baseBuild() defaults, overlaying any provided
// snapshot, then guaranteeing the structural fields the mutators write to.
function seedBuild(baseSnapshot) {
  const b = baseBuild();
  if (baseSnapshot && typeof baseSnapshot === 'object' && !Array.isArray(baseSnapshot)) {
    for (const k in baseSnapshot) {
      const v = baseSnapshot[k];
      if (v !== undefined) b[k] = clone(v);
    }
  }
  const arrays = ['saves','skills','expertise','toolExpertise','tools','instruments',
    'masteries','racialTraits','racialSpells','features','arts','boons','drawbacks',
    'traditions','subAbilities','subSpellBundles','unlockedClasses','innate','customProfs'];
  arrays.forEach(k => { if (!Array.isArray(b[k])) b[k] = []; });
  if (!b.stats || typeof b.stats !== 'object' || Array.isArray(b.stats))
    b.stats = { STR:10, DEX:10, CON:10, INT:10, WIS:10, CHA:10 };
  ['armour','weaponProf','freeSub','houseRules','grantNames'].forEach(k => {
    if (!b[k] || typeof b[k] !== 'object' || Array.isArray(b[k])) b[k] = {};
  });
  return b;
}

/**
 * rebuildStateFromEvents(baseSnapshot, events)
 * Replays an append-only event log on top of a base snapshot and returns the
 * rebuilt state: the folded build, the priced result from compute(), and the
 * AP economy. Mirrors the Live Sheet's foldBuild()+economy()+compute() flow.
 */
export function rebuildStateFromEvents(baseSnapshot, events, opts) {
  // Resolve the working event log + base build from the shapes the runner and
  // fixtures actually use:
  //   • base + incremental events:  ({...build}, [ ...events ])
  //   • full Live Sheet export:     ({rules,name,LOG,SEQ}, [])  - LOG replayed from scratch
  //   • plain snapshot, no log:     ({...build}, [])            - just priced as-is
  // A real Live Sheet export keeps its whole history under LOG and has no base
  // snapshot, so when one is handed in (the parity runner passes the entire file
  // as baseSnapshot with events=[]) we replay that embedded log from a blank build.
  let log = (Array.isArray(events) ? events : []).filter(Boolean);
  let base = baseSnapshot;
  if (log.length === 0 && baseSnapshot && typeof baseSnapshot === 'object' && !Array.isArray(baseSnapshot)) {
    const embedded = baseSnapshot.LOG ?? baseSnapshot.events ?? baseSnapshot.event_log;
    if (Array.isArray(embedded)) {
      log = embedded.filter(Boolean);   // the export's LOG IS its history...
      base = null;                       // ...so fold it from a blank level-1 build
    }
  }
  const b = seedBuild(base);
  const ae = _replay(b, log);        // reuse _replay's snapshot instead of re-deriving it via economy(log)
  const eco = _economyFrom(ae.evs, ae.boughtOff);
  // budget = whatever the base build started with, plus all AP AWARDED through the log — awards only,
  // the same meaning foldBuild() gives it (v0.355). economy().earned also carries drawback grants, and
  // compute() derives those itself from b.drawbacks, so passing `earned` straight through would grant
  // every drawback twice — which is exactly what the log fuzzer's dualEntry check caught the moment the
  // income invariant was added: this entry point and foldBuild() disagreed on any log with a drawback.
  // A base snapshot's own `budget` is awards-only under the same rule (a CharGen export's award field,
  // or a previous fold), and any drawbacks it carries are granted by compute() off b.drawbacks.
  const baseBudget = Number(base && base.budget) || 0;
  b.budget = baseBudget + eco.earned - eco.drawbackEarned;

  const result = compute(b, opts);
  return {
    ok: result.remaining >= 0,
    version: DATA.version,
    build: b,
    result,
    economy: eco,
    budget: b.budget,
    total: result.total,
    remaining: result.remaining,
    warnings: result.warnings,
    eventsApplied: log.length
  };
}

/**
 * validate(b, rules) — check a build against a DM's campaign rules (D-GH14).
 * `rules` is the campaign's `rules` JSON column (DM-authoritative, read-only
 * to players): { bannedSpecies, bannedOriginSpecies, bannedMasteries,
 * bannedBoons, bannedDrawbacks, bannedArts, bannedOriginClasses,
 * bannedOriginClasses2, multiDisciplineAllowed, houseRules }.
 * Pure and side-effect-free; does not touch compute() or pricing. Returns
 * { ok, violations: [{code, message}] } — never throws on a malformed/empty
 * rules object (every field defaults to "no restriction").
 */
export function validate(b, rules) {
  const r = rules || {};
  const violations = [];
  const has = (arr, v) => Array.isArray(arr) && v && arr.includes(v);

  for (const sp of [b.species, b.species2]) {
    if (sp && sp !== '(none)' && has(r.bannedSpecies, sp)) {
      violations.push({ code: 'bannedSpecies', message: 'Species "' + sp + '" is banned in this campaign.' });
    }
  }
  if (b.species2 && b.species2 !== '(none)' && has(r.bannedOriginSpecies, b.species2)) {
    violations.push({ code: 'bannedOriginSpecies', message: '"' + b.species2 + '" cannot be taken as a 2nd origin species in this campaign.' });
  }
  for (const cls of [b.originClass, b.originClass2]) {
    if (cls && cls !== '(none)' && has(r.bannedOriginClasses, cls)) {
      violations.push({ code: 'bannedOriginClasses', message: 'Origin class "' + cls + '" is banned in this campaign.' });
    }
  }
  // Asymmetric ban, mirroring bannedOriginSpecies above: a class may be allowed as a PRIMARY origin
  // (originClass) but banned as a stacked 2nd origin (originClass2) only. bannedOriginClasses (just
  // above) already bans a class in BOTH slots — this is a separate, narrower list, not a replacement.
  if (b.originClass2 && b.originClass2 !== '(none)' && has(r.bannedOriginClasses2, b.originClass2)) {
    violations.push({ code: 'bannedOriginClasses2', message: 'Class "' + b.originClass2 + '" cannot be taken as a 2nd origin class in this campaign.' });
  }
  for (const m of (b.masteries || [])) {
    if (has(r.bannedMasteries, m)) {
      violations.push({ code: 'bannedMasteries', message: 'Weapon mastery "' + m + '" is banned in this campaign.' });
    }
  }
  for (const bo of (b.boons || [])) {
    if (has(r.bannedBoons, bo)) {
      violations.push({ code: 'bannedBoons', message: 'Boon "' + bo + '" is banned in this campaign.' });
    }
  }
  for (const dw of (b.drawbacks || [])) {
    if (has(r.bannedDrawbacks, dw)) {
      violations.push({ code: 'bannedDrawbacks', message: 'Drawback "' + dw + '" is banned in this campaign.' });
    }
  }
  for (const ar of (b.arts || [])) {
    if (has(r.bannedArts, ar)) {
      violations.push({ code: 'bannedArts', message: 'Art "' + ar + '" is banned in this campaign.' });
    }
  }
  if (r.multiDisciplineAllowed === false) {
    const nDisc = (b.traditions || []).reduce((s, t) => s + ((t.disciplines || []).length), 0);
    if (nDisc > 1) {
      violations.push({ code: 'multiDisciplineAllowed', message: 'Multi-discipline spellcasting is not allowed in this campaign.' });
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Maps a live-filter "kind" (species / originSpecies / originClasses / masteries / boons — the
 * categories a tool UI can filter a picker by) to the matching field name on a campaign's `rules`
 * object, i.e. validate()'s own schema above. Exported so tool UIs derive this mapping from one
 * source instead of each hardcoding its own copy (display-only; never read by compute()).
 */
export const RULE_BAN_FIELDS = {
  species: 'bannedSpecies',
  originSpecies: 'bannedOriginSpecies',
  originClasses: 'bannedOriginClasses',
  originClasses2: 'bannedOriginClasses2',
  masteries: 'bannedMasteries',
  boons: 'bannedBoons',
  drawbacks: 'bannedDrawbacks',   // canonical kind
  draws: 'bannedDrawbacks',       // alias: the tools' live-filter vocabulary abbreviates "drawbacks" to
                                  // "draws" (e.g. HOUSE.disabled.draws). Accepting both lets
                                  // cloudRuleBarred() use ONE kind token per call site — instead of
                                  // 'draws' silently failing open here.
  arts: 'bannedArts',
};

/* =========================================================================
 * Save-file integrity — tamper-EVIDENT signing (D-GH48, Feature B)
 * -------------------------------------------------------------------------
 * signPayload()/verifyPayload() stamp an exported/saved character file with a
 * SHA-256 digest over its own contents so a hand-edited or corrupted file is
 * DETECTED on load. This is the offline stopgap before the Supabase
 * server-side enforcement phase — being client-side, it is tamper-EVIDENT,
 * NOT tamper-proof: a determined editor who recomputes the digest can defeat
 * it (stopping that needs a secret the browser can't hold). The goal here is
 * to catch accidental edits, truncation/corruption, and casual tampering.
 *
 * Pure, synchronous, dependency-free, and works in file:// contexts too (no
 * SubtleCrypto / secure-context requirement). Additive to the public API —
 * compute() and rebuildStateFromEvents() are untouched, so engine parity is
 * unaffected. The `sig` field verifyPayload() checks is metadata the rest of
 * the engine never reads, so an unsigned or signed file both price identically.
 * ========================================================================= */

export const SIG_ALG = 'PACT-SHA256-v1';

// Deterministic, key-order-independent JSON serialization. Arrays keep their
// order (a character's LOG order is meaningful); object keys are sorted so a
// save re-serialized with a different key order still verifies. undefined and
// function values are dropped, matching JSON.stringify's own behaviour.
function _canonicalJSON(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  // Array elements that JSON.stringify serializes as `null` — undefined, holes, functions, symbols —
  // must canonicalize to `null` too, or a save (written with JSON.stringify) verifies as `tampered`
  // against its own signature after the undefined→null round-trip. Index-based iteration (not .map,
  // which skips holes) so a sparse array element is caught. Object properties with those values are
  // dropped below, matching JSON.stringify's object behaviour.
  if (Array.isArray(v)) {
    const parts = [];
    for (let i = 0; i < v.length; i++) {
      const s = _canonicalJSON(v[i]);
      parts.push(s === undefined ? 'null' : s);
    }
    return '[' + parts.join(',') + ']';
  }
  const keys = Object.keys(v).sort();
  const parts = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], val = v[k];
    if (val === undefined || typeof val === 'function') continue;
    parts.push(JSON.stringify(k) + ':' + _canonicalJSON(val));
  }
  return '{' + parts.join(',') + '}';
}

// Synchronous SHA-256 over a JS string (UTF-8 encoded) → lowercase hex.
// Self-contained standard implementation; validated against the NIST vectors
// for "", "abc", the pangram, and the 448-bit message.
function _sha256hex(msg) {
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const enc = unescape(encodeURIComponent(msg));
  const bytes = [];
  for (let i = 0; i < enc.length; i++) bytes.push(enc.charCodeAt(i) & 0xff);
  const l = bytes.length;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitHi = Math.floor(l / 0x20000000);   // high 32 bits of the 64-bit bit-length (l*8 >> 32)
  const bitLo = (l * 8) >>> 0;
  bytes.push((bitHi>>>24)&0xff,(bitHi>>>16)&0xff,(bitHi>>>8)&0xff,bitHi&0xff);
  bytes.push((bitLo>>>24)&0xff,(bitLo>>>16)&0xff,(bitLo>>>8)&0xff,bitLo&0xff);
  const w = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++)
      w[i] = (bytes[off+i*4]<<24)|(bytes[off+i*4+1]<<16)|(bytes[off+i*4+2]<<8)|(bytes[off+i*4+3]);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15]>>>3);
      const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2]>>>10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
    H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
  }
  let hex = '';
  for (let i = 0; i < 8; i++) hex += ('00000000' + (H[i]>>>0).toString(16)).slice(-8);
  return hex;
}

/**
 * signPayload(obj) — return a NEW object identical to `obj` but carrying a
 * `sig` field { alg, hash } whose hash is the SHA-256 of the canonical form of
 * everything EXCEPT `sig`. Never mutates the input; re-signing is deterministic.
 * Any existing `sig` is replaced (so re-saving an already-signed file re-signs it).
 */
export function signPayload(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(k => { if (k !== 'sig') out[k] = obj[k]; });
  const hash = _sha256hex(_canonicalJSON(out));
  out.sig = { alg: SIG_ALG, hash };
  return out;
}

/**
 * verifyPayload(obj) — check a payload's `sig`. Never throws. Returns one of:
 *   { signed:false, valid:false, status:'unsigned'    } — no signature present
 *   { signed:true,  valid:false, status:'unknown-alg' } — signed by an alg we don't know
 *   { signed:true,  valid:true,  status:'ok'          } — digest matches, untampered
 *   { signed:true,  valid:false, status:'tampered'    } — digest mismatch (edited/corrupted)
 * Callers flag on 'tampered' (and may on 'unknown-alg'); 'unsigned' is silent —
 * an older or hand-built file is not the same as a tampered one, and flagging is
 * non-blocking either way.
 */
export function verifyPayload(obj) {
  if (!obj || typeof obj !== 'object' || !obj.sig || typeof obj.sig !== 'object')
    return { signed: false, valid: false, status: 'unsigned' };
  if (obj.sig.alg !== SIG_ALG)
    return { signed: true, valid: false, status: 'unknown-alg' };
  const payload = {};
  Object.keys(obj).forEach(k => { if (k !== 'sig') payload[k] = obj[k]; });
  const ok = _sha256hex(_canonicalJSON(payload)) === obj.sig.hash;
  return { signed: true, valid: ok, status: ok ? 'ok' : 'tampered' };
}

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
 *                       {total, spendable, remaining, budget(=spendable), playerAp, dmAp, warnings,
 *                        lines, itemize, hp, baseHP, prof, tier, mods, effScore, size, …}. Pure over
 *                       (b, opts). NEVER store its output — derive at runtime.
 *   baseBuild()       — a fresh blank level-1 build object (the fold/replay starting point).
 *   MUT               — { cat: (build, payload) => void }; replay applies MUT[e.cat] per buy event.
 * Event-sourcing (append-only LOG):
 *   activeEvents(events) — {evs, boughtOff}: live events + a bought-off-drawback map.
 *   economy(events)      — {earned, spent, available, drawbackEarned}: AP tally from a LOG (no fold/compute).
 *   foldBuild(events)    — replay a LOG from baseBuild() → a build (b.budget = economy().earned).
 *   rebuildStateFromEvents(base, events, opts?) — replay onto `base` (or an embedded {LOG}) → {ok, version, …}.
 * Campaign rules (VALIDATION only — never read by compute()):
 *   validate(b, rules)   — check a build against a campaign's rules JSON → {ok, violations:[{code,message}]}.
 *   RULE_BAN_FIELDS      — { pickerKind → rules ban-list field }, e.g. arts→bannedArts (shared with the tools).
 * Save-file integrity (tamper-EVIDENT, not secret — D-GH48):
 *   SIG_ALG          : string — the algorithm tag stamped into a signed payload.
 *   signPayload(obj)  — a copy of obj with a tamper-evident `sig` attached.
 *   verifyPayload(obj)— {signed, valid, status}: check a signed payload's integrity.
 *
 * (Historical export note below; do not read the ~238 KB body wholesale — grep for the symbol you need.)
 *
 * The rules data and the compute() costing logic are lifted verbatim from
 * PACT-CharGen-Webtool-v0.104.html; the event-replay logic mirrors the
 * append-only LOG / foldBuild model in PACT-Live-Char-Sheet-v0.104.html.
 */

// AP-by-level ladder lives in its own editable file (feat/ap-by-level); surfaced on DATA below.
import { AP_BY_LEVEL, DEFAULT_LEVEL } from './ap-by-level.js';
// Per-campaign advancement dials (display/config-only; never read by compute()/_replay()).
import { LEVEL_BUDGET_CURVES, AWARD_PACES, STARTING_TIER_RATIOS } from './advancement.js';

export const BUILD = "v0.202";

// Rules dataset lives in its own editable file (REV-14a); imported here and
// re-exported unchanged so every tool/importer sees the same DATA surface.
import { DATA } from './engine-data.js';
export { DATA };

/* AP-by-level ladder — externalized to js/ap-by-level.js (feat/ap-by-level) and
 * surfaced on DATA so all three tools read it through the engine bridge. apByLevel/
 * defaultAp are the current names; levelAP/level1AP are back-compat aliases for the
 * same data (compute()'s racial-trait lock reads DATA.level1AP; tool display reads
 * DATA.levelAP). Editing js/ap-by-level.js propagates to every tool with no other change. */
DATA.apByLevel = AP_BY_LEVEL;
DATA.defaultAp = AP_BY_LEVEL[DEFAULT_LEVEL];
DATA.levelAP   = AP_BY_LEVEL;                 // back-compat alias (tool display / apLevel())
DATA.level1AP  = AP_BY_LEVEL[DEFAULT_LEVEL];  // back-compat alias (compute racial-trait lock)
// Per-campaign advancement dials — display/config-only reference tables, never
// read by compute() or _replay(); editing js/advancement.js does not bump DATA.version.
DATA.levelBudgetCurves  = LEVEL_BUDGET_CURVES;
DATA.awardPaces         = AWARD_PACES;
DATA.startingTierRatios = STARTING_TIER_RATIOS;

/* ---- shared helpers ------------------------------------------------------ */
const _mod = s => Math.floor((s - 10) / 2);
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

/* ==========================================================================
 * compute(build)
 * Prices a build object and returns a stable result:
 *   { total, remaining, budget, warnings, lines, itemize, hp, ac, prof,
 *     tier, mods, effScore, init, speed, castMod, castAb, saveDC, spellAtk,
 *     discInfo, tradInfo, size, status, ... }
 * `total` is the total AP cost (read by the parity runner as totalCost).
 * ========================================================================== */
export function compute(b, opts){
  b=Object.assign({},b);
  ['saves','skills','expertise','feats','masteries','racialTraits','features','drawbacks','traditions','subAbilities','arts','boons','innate','tools','instruments','customProfs','unlockedClasses','dabblerCantripNames','innateNames','toolExpertise','racialSpells','subSpellBundles'].forEach(k=>{if(!Array.isArray(b[k]))b[k]=[];});
  ['hardy','tough','gold','extraClasses','dabblerCantrips','languages','budget','profBonus','attune','ki','sorcery'].forEach(k=>{b[k]=Number(b[k])||0;});
  b.hd=Math.min(20,Math.max(1,Math.floor(Number(b.hd)||1)));
  if(b.stats&&typeof b.stats==='object'){const s={};for(const k in b.stats)s[k]=Number(b.stats[k])||10;b.stats=s;}else b.stats={};
  const W=[]; const L=[]; let total=0;
  function add(lab,ap){ if(ap!==0){L.push([lab,ap]);} total+=ap; } const _ITEMS={}; function addItems(lab,items){ const a=(items||[]).filter(x=>x); if(a.length)_ITEMS[lab]=a; }
  const st=b.stats||{};
  // base AP is paid on the purchased scores only
  let abilAP=0;for(const a of ["STR","DEX","CON","INT","WIS","CHA"]){abilAP+=(DATA.ABIL[st[a]||10]||0);} add("Ability scores",abilAP);
  for(const a of ["STR","DEX","CON","INT","WIS","CHA"]){const sc=st[a]||10; if(sc<6) W.push(a+" "+sc+" is below the normal floor of 6 — needs DM approval");}
  const effScore={}; const mod={};
  const _flat={STR:0,DEX:0,CON:0,INT:0,WIS:0,CHA:0};if((b.features||[]).includes("Barbarian: Primal Champion")){_flat.STR+=4;_flat.CON+=4;}const _eb=b.epicBoonAbil||{};for(const _bl of (b.boons||[])){const _bo=DATA.boons[_bl];if(_bo&&_bo.epic){const _a=_eb[_bl];if(_a&&_flat[_a]!==undefined)_flat[_a]+=2;else W.push(_bl+": choose an ability to raise (+2)");}}for(const a of ["STR","DEX","CON","INT","WIS","CHA"]){effScore[a]=Math.min(30,(st[a]||10)+_flat[a]);mod[a]=_mod(effScore[a]);}
  const hd=b.hd||1; const row=DATA.HD[hd-1];
  const tier=hd<=1?1:hd<=2?2:hd<=4?3:hd<=8?4:hd<=12?5:hd<=16?6:7;
  add("Hit Dice",row.cum);
  // proficiency bonus (v39 §6): everyone starts at +2; buy up to +6 on the Extreme ladder, each step HD-gated
  const wantPB=Math.min(6,Math.max(2,Math.floor(Number(b.profBonus)||2))); let prof=2; const PG=DATA.profGate;
  for(let pb=3;pb<=wantPB;pb++){ if(hd>=PG[pb]) prof=pb; else { W.push("Proficiency +"+pb+" needs "+PG[pb]+" Hit Dice"); break; } }
  add("Proficiency bonus (+"+prof+")",DATA.profCum[prof]||0);
  // Vigor: +1 HP/HD per rank, cost 4/5/6/7…; cap = CON modifier (v66)
  const cm=mod.CON; const vgcap=Math.max(0,cm);   // floor at 0 so a negative CON mod never flags Vigor 0 as over-cap
  const hardy=b.hardy||0; let hardyAP=hardy*[5,8,11,14,17,21,25][tier-1]; add("Vigor",hardyAP);
  if(hardy>vgcap) W.push("Vigor "+hardy+" exceeds cap (max = CON mod = "+vgcap+")");
  // Grit: flat 2 up to CON mod, then +1 each beyond (v66)
  const tough=b.tough||0; let toughAP=0;for(let n=1;n<=tough;n++)toughAP+=[2,4,6,9,12,15,18][tier-1]+Math.max(0,n-vgcap); add("Grit",toughAP);
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
  for(const x of expList) if(!skillList.includes(x)) W.push("Expertise in "+x+" needs the skill bought first");
  // tool expertise — its own independent track (separate count on the same Expertise ladder)
  const toolExpList=(b.toolExpertise||[]); add("Tool expertise",DATA.expertise[toolExpList.length]||0);
  {const _ownT=new Set([].concat(b.tools||[],b.instruments||[],b.customProfs||[]));for(const x of toolExpList) if(!_ownT.has(x)) W.push("Tool expertise in "+x+" needs that tool/instrument proficiency first");}
  // languages — first free, then an escalating ladder (+1,+2,+3…): 4 langs = 6 AP. (n-1)·n/2
  const langs=b.languages||1; add("Languages",Math.max(0,(langs-1)*langs/2));
  // §6 Attunement slots (Steep 4/6/8/10), no cap, no gate
  const attune=b.attune||0; add("Attunement slots",DATA.attune[attune]||0);
  // Arts & Techniques (flat AP per item like boons; has hd gate + minStats prereqs)
  let artAP=0;const _AI=[];for(const lab of (b.arts||[])){const ar=DATA.arts[lab];if(!ar)continue;const _ac=(+ar.ap||0);artAP+=_ac;_AI.push([lab,_ac]);
    if(hd<(+ar.hd||1)) W.push(lab+': needs '+(+ar.hd||1)+'+ Hit Dice');
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
  let racAP=0;const _SI=[];for(const lab of (b.racialTraits||[])){const r=DATA.racial[lab];if(!r)continue;const isO=(r.race===b.species||r.race===b.species2);
    const _hasLockEntry=!!(b._raceTraitLocked&&Object.prototype.hasOwnProperty.call(b._raceTraitLocked,lab));
    const _locked=_hasLockEntry?!!b._raceTraitLocked[lab]:!!b.inPlay;
    let _rc; if(_locked && isO && !r.pack){const _tt=Math.min(7,Math.max(r.tier||1,tier));const _row=DATA.MASTER[_tt];if(r.band==null){_rc=r.origin;}else{_rc=(_row&&_row[r.band])??r.origin;}} else if(isO){_rc=r.origin;} else if(r.cross==null){W.push((lab.split(": ")[1]||lab)+" is origin-race only — it can't be taken cross-race.");continue;} else {_rc=r.cross;}
    racAP+=_rc;_SI.push([lab,_rc]);}
  add("Species traits",racAP);addItems("Species traits",_SI);
  // §10 cross-species T2+ rule: traits above T1 can only be purchased by the origin species
  for(const lab of (b.racialTraits||[])){const r=DATA.racial[lab];if(!r)continue;const isO=(r.race===b.species||r.race===b.species2);if(!isO&&(r.tier||1)>1)W.push((lab.split(': ')[1]||lab)+': only Tier 1 traits are available cross-species');}{var _ownsR=function(nm){if((b.racialTraits||[]).indexOf(nm)>=0)return true;var _r=DATA.racial[nm];return !!(_r&&_r.pack&&(_r.race===b.species||_r.race===b.species2));};for(const lab of (b.racialTraits||[])){const r=DATA.racial[lab];if(!r)continue;var _sn=(lab.split(": ")[1]||lab);if(r.reqRace&&!_ownsR(r.reqRace))W.push("⛔ "+_sn+" requires "+((r.reqRace.split(": ")[1])||r.reqRace));if(r.minHD&&hd<r.minHD)W.push("⛔ "+_sn+" needs "+r.minHD+" Hit Dice (level "+r.minHD+")");}}
  // §10 lineage spell-likes: cap-exempt cantrips + half-price 1/long-rest spells (Appendix B prices)
  {const _lin=(DATA.lineageSpells&&DATA.lineageSpells[b.lineage])||[]; let _rs=0;
   for(const nm of (b.racialSpells||[])){const s=_lin.find(x=>x[0]===nm); if(!s)continue; _rs+=s[1];
     if(s[2]>0 && hd<(DATA.hdGate[s[2]-1]||1)) W.push("Lineage spell "+nm+" (L"+s[2]+") needs "+(DATA.hdGate[s[2]-1])+" Hit Dice");}
   add("Lineage spell-likes",_rs);}
  // class access — unlock cost is 7 × classes already owned (origin + any 2nd origin counted first)
  const has2nd=(b.originClass2 && b.originClass2!=="(none)");
  const ownedBefore=1+(has2nd?1:0);
  const _xc=((b.unlockedClasses||[]).filter(c=>c!==b.originClass&&c!==b.originClass2).length)||(b.extraClasses||0);const _uStart=ownedBefore-1,_uEnd=_uStart+_xc;
        const unlockAP=(DATA.unlockCum[_uEnd]||0)-DATA.unlockCum[_uStart];  // §: uses unlockCum table for explicitness
  add("Class unlocks",unlockAP);
  if(has2nd) add("2nd origin class",14);
  // §14 Martially Bound: choose one class; −1 AP (floor 1) on that class's features, stacks with origin. +2 AP gain.
  const mbClass=(b.martiallyBound && b.martiallyBound!=="(none)")?b.martiallyBound:null;
  // features — non-stepped: buy once. Stepped (rep): each re-buy is the next tier up.
  let featAP=0; const fcount={}; const _FI=[];
  for(const lab of (b.features||[])){const f=DATA.features[lab];if(!f)continue;
    fcount[lab]=(fcount[lab]||0)+1; const n=fcount[lab];
    if(!f.rep && n>1){W.push((lab.split(": ")[1]||lab)+": already bought — can only be taken once (not a stepped feature)");continue;}
    let origin,cross,stick;
    if(f.rep){const tier=Math.min(7,f.tier+n-1);stick=DATA.MASTER[tier][f.band];origin=Math.max(1,stick-(tier-1));cross=stick+tier;}
    else {origin=f.origin;cross=f.cross;stick=Math.max(1,f.cross-f.tier);}
    const isO=(f.cls===b.originClass||f.cls===b.originClass2);const isUnlk=!isO&&(b.unlockedClasses||[]).indexOf(f.cls)>=0;let c=isO?origin:(isUnlk?stick:cross);
    if(mbClass && f.cls===mbClass) c=Math.max(1,c-1);if(lab==="Sorcerer: Metamagic")c=2*n;   // Martially Bound discount (floor 1); Metamagic Steep ladder (option N=2N) v0.314
    featAP+=c;_FI.push([lab+(f.rep&&n>1?" (step "+n+")":""),c]);}
  add("Class features",featAP);addItems("Class features",_FI);{var _invN=(b.features||[]).filter(function(l){var f=DATA.features[l];return f&&f.inv;}).length;var _bs=0;for(var _i=0;_i<_invN;_i++)_bs+=Math.min(20,Math.floor(_i/2));if(_bs>0)add("Invocation breadth surcharge",_bs);}{var _ea=(b.features||[]).filter(function(l){return /: Extra Attack$/.test(l);}).length+((b.features||[]).indexOf("Warlock: Thirsting Blade")>=0?1:0)+(b.subAbilities||[]).filter(function(k){return /\|Extra Attack$/.test(k);}).length;if(_ea>=2)W.push("Extra Attack / Thirsting Blade gained "+_ea+" times — a 2nd attack doesn't stack; the duplicates add no benefit (keep one).");}
  // v0.084: Eldritch Invocations are locked behind the Warlock discipline
  {const _hasWL=(b.traditions||[]).some(function(t){return (t.disciplines||[]).some(function(d){return d&&d.name==="Warlock";});});
   if(!_hasWL)(b.features||[]).forEach(function(lab){var f=DATA.features[lab];if(f&&f.inv)W.push("⛔ "+(lab.split(": ")[1]||lab)+": Eldritch Invocation requires the Warlock discipline (open Arcane › Warlock)");});}
  // v0.203: invocation prerequisites (pact boons / chained invocations) + elevated level gates — hard-enforced
  {const _own=new Set(b.features||[]);(b.features||[]).forEach(function(lab){var f=DATA.features[lab];if(!f||!f.inv)return;
    (f.prereq||[]).forEach(function(req){if(!_own.has(req))W.push("⛔ "+(lab.split(": ")[1]||lab)+" requires "+(req.split(": ")[1]||req));});
    if(f.lvl&&(b.hd||0)<f.lvl)W.push("⛔ "+(lab.split(": ")[1]||lab)+" requires Warlock level "+f.lvl);});}
  // v0.087: chassis gates — a feature with needsDisc requires that Discipline founded (e.g. Metamagic→Sorcerer)
  {const _ds=new Set();(b.traditions||[]).forEach(function(t){(t.disciplines||[]).forEach(function(d){if(d&&d.name)_ds.add(d.name);});});
   (b.features||[]).forEach(function(lab){var f=DATA.features[lab];if(f&&f.needsDisc&&!_ds.has(f.needsDisc))W.push("⛔ "+(lab.split(": ")[1]||lab)+" requires the "+f.needsDisc+" Discipline (found it in Spellcasting)");});}
  // v0.088: resource gates — ki/sorcery-using abilities require >=1 of the resource
  {const _kiTot=(DATA.kiCum&&DATA.kiCum[b.ki||0])||0;
   if(_kiTot<1)(b.features||[]).forEach(function(lab){var f=DATA.features[lab];if(f&&f.needsKi)W.push("⛔ "+(lab.split(": ")[1]||lab)+" requires at least 1 Ki / Focus point (buy Ki points first)");});
   else if(!(b.features||[]).some(function(lab){var f=DATA.features[lab];return f&&f.needsKi;}))W.push("You have "+_kiTot+" Ki / Focus point"+(_kiTot>1?"s":"")+" but no Ki-using ability yet — buy a Ki feature, or refund the points if you won't use them.");}
  {const _hasSorc=(b.traditions||[]).some(function(t){return (t.disciplines||[]).some(function(d){return d&&d.name==="Sorcerer";});});
   const _spTot=(b.sorcery||0);
   if(_spTot<1)(b.features||[]).forEach(function(lab){var f=DATA.features[lab];if(f&&f.needsSorc)W.push("⛔ "+(lab.split(": ")[1]||lab)+" requires at least 1 sorcery point (buy sorcery points first)");});}
  // §5/§11 Ki (Focus) & Sorcery points — gentle ladder, no Hit-Dice gate
  const ki=b.ki||0; add("Ki / Focus points",(DATA.kiCum&&DATA.kiCum[ki])||0);  // v0.172: bands-of-4 ladder
  const sorcery=(b.sorcery||0);  // hard block: extra sorcery requires T2
  // v0.172: base pool (= Hit Dice) is FREE with the Sorcerer Discipline — b.sorcery = EXTRA points bought
  add("Sorcery points",(DATA.sorcCum&&DATA.sorcCum[sorcery])||0);
  if((b.sorcery||0)>0){var _hsd=(b.traditions||[]).some(function(t){return (t.disciplines||[]).some(function(d){return d&&d.name==="Sorcerer";});});if(!_hsd)W.push("⛔ Sorcery points require the Sorcerer discipline (open Arcane › Sorcerer)");else if(hd<2)W.push("⛔ Sorcery points require 2 Hit Dice (T2)");}
  // §14 Martially Bound — taking it grants 2 AP up front (like a drawback), discount applied in the features loop above
  if(mbClass) add("Martially Bound (gain)",-2);
  // subclass abilities (à la carte) + unlocks: first subclass per class is free, others 15 AP
  const freeSub=b.freeSub||{}; const subUsed={}; let subAP=0;const _UI=[];
  for(const key of (b.subAbilities||[])){const a=DATA.subAbilMap[key];if(!a)continue;
    (subUsed[a.cls]=subUsed[a.cls]||{})[a.sub]=1;
    const isO=(a.cls===b.originClass||a.cls===b.originClass2);const isUS=!isO&&(b.unlockedClasses||[]).indexOf(a.cls)>=0;const _uc=isO?a.origin:(isUS?Math.max(1,a.cross-a.tier):a.cross);subAP+=_uc;_UI.push([(a.cls+" › "+a.sub+": "+a.name),_uc]);}
  add("Subclass abilities",subAP);addItems("Subclass abilities",_UI);
  // v0.196: a bought expanded-list bundle also opens its subclass for unlock-accounting
  for(const _bk of (b.subSpellBundles||[])){const _p=String(_bk).split("|");if(_p[0]&&_p[1])(subUsed[_p[0]]=subUsed[_p[0]]||{})[_p[1]]=1;}
  let subUnlockAP=0; let subUnlockN=0;
  for(const cls in subUsed){const used=Object.keys(subUsed[cls]);const free=freeSub[cls]||used[0];
    for(const sub of used){if(sub!==free){subUnlockAP+=DATA.subUnlock;subUnlockN++;}}}
  {const _vc={};for(const _bk of (b.subSpellBundles||[])){const _p=String(_bk).split("|");if(_p.length>=3){const _k=_p[0]+"|"+_p[1];(_vc[_k]=_vc[_k]||{})[_p[2]]=1;}}for(const _k in _vc){const _x=Object.keys(_vc[_k]).length-1;if(_x>0){subUnlockAP+=_x*DATA.subUnlock;subUnlockN+=_x;}}}
  if(subUnlockAP) add("Subclass unlocks ("+subUnlockN+" × 15)",subUnlockAP);
  // v0.196: paid subclass "expanded spell list" bundles — opt-in, one buy = whole bundle
  //   (always-prepared bonus spells + free cap-exempt cantrips are granted in eligibleSpells, gated on purchase).
  for(const _bk of (b.subSpellBundles||[])){const _p=String(_bk).split("|");const _sc=(DATA.subclasses[_p[0]]||{})[_p[1]];const _bn=_sc&&_sc.spellBundle;if(!_bn)continue;
    const _isO=(_p[0]===b.originClass||_p[0]===b.originClass2);
    add("Spell list — "+_p[1], _isO?_bn.origin:_bn.cross);}
  // spellcasting: per tradition -> per discipline. Casting ability is per discipline (auto by class).
  let mbGain=0; const discInfo=[]; const tradInfo=[]; let primaryMod=0, primaryAb="—", havePrimary=false;
  (b.traditions||[]).forEach((t,ti)=>{
    if(!t||!t.name||t.name==="(none)")return;
    const tag="Trad "+(ti+1)+" "+t.name;
    const discs=(t.disciplines||[]).filter(d=>d&&d.name&&d.name!=="(none)");
    if(discs.length===0)return;
    const hasOrigin=discs.some(d=>d.name===b.originClass||d.name===b.originClass2);
    const hasUnlk=!hasOrigin&&discs.some(d=>(b.unlockedClasses||[]).indexOf(d.name)>=0);const baseDisc=hasOrigin?1:(hasUnlk?0:-1);
    const foundation=Math.max(1,7-baseDisc); add(tag+" — Foundation",foundation);
    const rank=t.rank||0; const rankCost=rank>0?Math.max(0,(DATA.rankCum[rank-1]||0)-baseDisc*rank):0;
    if(rank>0) add(tag+" — Rank "+rank,rankCost);
    const extraCost=discs.length>1?(DATA.extraDiscCum[Math.min(discs.length-1,3)]||0):0;
    if(extraCost) add(tag+" — extra discipline(s)",extraCost);
    const tsaved=(7-foundation)+(rank>0?((DATA.rankCum[rank-1]||0)-rankCost):0);
    tradInfo.push({index:ti,name:t.name,baseDisc,foundation,rank,rankCost,extraCost,nDisc:discs.length,saved:tsaved});
    discs.forEach(d=>{
      const isO=(d.name===b.originClass||d.name===b.originClass2);
      const _unlk=!isO&&(b.unlockedClasses||[]).indexOf(d.name)>=0;const dd=(isO?1:(_unlk?0:-1))+(d.bound?1:0);
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
  let boonAP=0;const _BI=[];for(const lab of (b.boons||[])){const bo=HRb[lab]||DATA.boons[lab];if(!bo)continue;const _bc=(+bo.ap||0);boonAP+=_bc;_BI.push([lab,_bc]);
    if(hd<(+bo.hd||1)) W.push(lab+": boon needs "+(+bo.hd||1)+"+ Hit Dice");
    const _bms=bo.minStats||{};for(const [_ba,_bm] of Object.entries(_bms)){if((st[_ba]||10)<_bm) W.push(lab+': boon requires '+_ba+' '+_bm+'+');}
    const _bbmsa=bo.minStatsAny;if(_bbmsa&&_bbmsa.stats){const _banyMet=_bbmsa.stats.some(function(_bba){return (st[_bba]||10)>=_bbmsa.val;});if(!_banyMet)W.push(lab+': boon requires '+_bbmsa.stats.join(' or ')+' '+_bbmsa.val+'+');} }
  add("Boons",boonAP);addItems("Boons",_BI);
  // v0.086: DM "Tasha" house-rule — bar abilities sourced from Tasha (flagged tasha:true). Default allowed; warns only when explicitly barred.
  {const _da=(b.houseRules&&b.houseRules.dmAllows)||{};
   if(_da.tasha===false){const _tb=(coll,owned)=>{(owned||[]).forEach(k=>{const it=coll[k];if(it&&it.noncore)W.push("⛔ "+(String(k).split(": ")[1]||k)+": non-core (DM-gated) ability barred by DM house rules");});};
     _tb(DATA.features,b.features);_tb(DATA.boons,b.boons);_tb(DATA.arts,b.arts);}}
  // drawbacks
  // §14: drawbacks grant AP, but no more than 14 AP total across a character
  let drawGain=0;for(const lab of (b.drawbacks||[])){const v=(HRd[lab]?(+HRd[lab].ap):DATA.drawbacks[lab])||0;drawGain+=v;
    const _dmx=DATA.drawbackMaxStats&&DATA.drawbackMaxStats[lab]||{};for(const [_da,_dm] of Object.entries(_dmx)){if((st[_da]||10)>_dm) W.push(lab+': drawback requires '+_da+' '+_dm+' or lower');} }
  add("Drawbacks (refund)",-drawGain);
  if(drawGain>14) W.push("Drawbacks grant "+drawGain+" AP — note most tables cap at 14 AP (check with your DM)");
  if((b.drawbacks||[]).length>3) W.push((b.drawbacks||[]).length+" drawbacks chosen — most DMs cap this at 2–3; more may not be reasonable or approved");
  add("Starting gold",b.gold||0);
  // --- AP composition: the two-pool model (see docs/plans/2026-07-12-campaign-ap-model-cold-review.md) ---
  // Spendable AP is composed HERE, once, from two independently-stored pools so every tool shows ONE total:
  //   • Player AP = b.budget  — folded from the character's own `award` events; raw, player-owned.
  //   • DM AP     = opts.dmAp  — campaign-granted; stored server-side only, NEVER in the character's log.
  // opts.ignorePlayerAp (a campaign toggle) drops the player pool from the ceiling but NEVER refunds or
  // rewrites it — purchases already made are grandfathered; only the ceiling changes.
  // ANTI-DOUBLE-COUNT INVARIANT: `spendable` is derived and returned on THIS result object. Callers must
  // DISPLAY it, never write it (or dmAp) back into b.budget / the award log / an export — else a reload
  // double-counts. `budget` in the return is a legacy display alias of `spendable`. `remaining` =
  // spendable − total(spent). (Two pools today; the composition is additive if more are ever added.)
  const playerAp=b.budget||0; const _opts=opts||{}; const dmAp=Number(_opts.dmAp)||0;
  const spendable=(_opts.ignorePlayerAp?0:playerAp)+dmAp; const remaining=spendable-total;
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
  return {total,remaining,budget:spendable,playerAp,dmAp,spendable,lines:L,itemize:_ITEMS,warnings:W,hp:hp2,baseHP:row.baseHP,prof,tier,mods:mod,effScore,size,sizeChoosable,
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
 feat:()=>0, feature:(b,p)=>b.features.push(p.v), art:(b,p)=>(b.arts=b.arts||[]).push(p.v), boon:(b,p)=>b.boons.push(p.v), mvbuy:(b,p)=>{b.maneuverBuys=(b.maneuverBuys||0)+1;},
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
  const boughtOff = {};
  evs.forEach(e => { if (e.type === 'buyoff') boughtOff[e.refVal] = 1; });
  return { evs, boughtOff };
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

export function economy(events) {
  const { evs, boughtOff } = activeEvents(events);
  let earned = 0, spent = 0, drawbackEarned = 0;
  for (const e of evs) {
    if (e.type === 'award') earned += Number(e.amount) || 0;
    else if (e.type === 'buy' && e.cat === 'drawback') {
      if (!boughtOff[e.payload && e.payload.v]) drawbackEarned += (-(Number(e.cost) || 0));
    }
    else spent += _spendCost(e);
  }
  earned += drawbackEarned;
  // drawbackEarned exposed (D-GH41) so a caller can isolate "raw award total" from "total earned" without
  // re-deriving drawback-bought-off filtering itself — purely additive, existing {earned,spent,available}
  // destructuring is unaffected.
  return { earned, spent, available: earned - spent, drawbackEarned };
}

// Replay an append-only event log onto build `b` in place (shared by foldBuild
// and rebuildStateFromEvents). Returns the boughtOff map.
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
// Single pass: the lock/spend bookkeeping for event i never depends on anything the build-mutation
// half of the loop does, so both run interleaved per-event rather than as two separate passes over
// `evs` — `_wasLocked` is captured before advancing state for this event, same as before.
function _replay(b, log) {
  const { evs, boughtOff } = activeEvents(log);
  let _locked = false, _spent = 0, _campaignBound = false;
  for (let _i = 0; _i < evs.length; _i++) {
    const e = evs[_i];
    const _wasLocked = _locked;
    if (e.type === 'creationLocked') _locked = true;
    else if (e.type === 'campaignBound') _campaignBound = true;
    else if (!e.noLock) _spent += _spendCost(e);
    if (_campaignBound && _spent > DATA.level1AP) _locked = true;

    if (e.type === 'name') { b.name = e.name; continue; }
    if (e.type === 'names') { MUT.names(b, e); continue; }   // names take the whole event
    if (e.type !== 'buy') continue;                          // award/buyoff affect economy only
    if (e.cat === 'drawback' && boughtOff[e.payload && e.payload.v]) continue; // bought off: removed
    if (e.cat === 'racial' && e.payload && e.payload.v)
      (b._raceTraitLocked = b._raceTraitLocked || {})[e.payload.v] = _wasLocked;
    (MUT[e.cat] || (() => {}))(b, e.payload || {});
  }
  // single-instance proficiency lists never hold duplicates
  ['saves','skills','expertise','toolExpertise','tools','instruments','masteries','racialTraits','racialSpells']
    .forEach(k => { if (Array.isArray(b[k])) b[k] = b[k].filter((v, i) => b[k].indexOf(v) === i); });
  // half-casters can't hold cantrips
  (b.traditions || []).forEach(t => (t.disciplines || []).forEach(d => {
    if (d && (DATA.noCantrip || []).indexOf(d.name) >= 0) { d.cantrips = 0; d.cantripNames = []; }
  }));
  return boughtOff;
}

// foldBuild(events): the Live Sheet's fold — build a character from a blank
// level-1 base by replaying the whole event log; budget = total AP earned.
export function foldBuild(events) {
  const log = (Array.isArray(events) ? events : []).filter(Boolean);
  const b = baseBuild();
  _replay(b, log);
  b.budget = economy(log).earned;
  return b;
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
  _replay(b, log);
  const eco = economy(log);
  // budget = whatever the base build started with, plus all AP earned through the
  // log. For a full export (base=null) this is exactly economy().earned, matching
  // the Live Sheet, where budget = total AP awarded over the character's life.
  const baseBudget = Number(base && base.budget) || 0;
  b.budget = baseBudget + eco.earned;

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
 * multiDisciplineAllowed, houseRules }.
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

# Cold review: one subclass ability must be one purchase (two purchase doors)

Date: 2026-10-05. Reviewer has NO access to the repository. Everything you need is in this document.

## Goal
A tabletop-RPG character builder sells every subclass ability through TWO "doors". Make an ability that is held through both doors count as ONE purchase: charge it once, tell the player, and refuse the second purchase in both UI tools. Do this without changing price rules or breaking saved characters.

## Context
- The app is static vanilla JavaScript (no framework, no build step). One module, `engine.js`, is the single source of truth for rules. Three UI tools import it. A character is an append-only event LOG (a list of purchase events); the build is derived by replaying the log (`foldBuild`), and `compute(build)` returns total AP (the point currency), warnings and an itemised ledger. Derived values are never stored.
- Door A: `build.subAbilities` is a list of keys like `"Rogue|Soulknife|Psionic Power / Psychic Blades"` priced from `DATA.subAbilMap[key]`.
- Door B: `build.features` is a list of labels like `"Rogue: Psionic Power / Psychic Blades"` priced from `DATA.features[label]`. All 192 subclass abilities are mirrored into `DATA.features` under the label `"<Class>: <Ability name>"` (verified: every subAbilMap entry maps to an existing mirrored feature).
- `compute()` has two separate loops, one per collection, each deduplicating only within its own collection. The two pickers each test "already owned?" against their own collection only. So the same ability bought through both doors is charged twice with no warning. This happened once on a real campaign character (8 AP through door A, then 7 AP plus gold and downtime through door B). The 7-vs-8 gap exists because door B's loop applies a "Martially Bound" discount (-1 AP, floor 1) and door A's loop does not. That discount mismatch is explicitly OUT OF SCOPE.
- Owner decision "P3" (already made, not up for debate): when both copies exist, charge the copy bought FIRST; the later copy is a duplicate.
- A purchase-legality function, `purchaseLegality(cur, cat, payload)`, builds a candidate build (cur + the new purchase), runs `compute()` on both, and treats any NEW warning that starts with the stop-sign character as a HARD refusal (unless it matches a soft-warning allowlist). Both tools call it at buy time.

## Verified vs assumed
Verified (ran the code): the original bug reproduces (42 AP with both doors vs 34 AP with one); all existing regression gates still pass with the change (88 engine-parity fixtures, a 61,431-case legality sweep, 6,161 price-of cases, 20 other node gates, 5 browser gates); 6 new fixtures pass; with the guard disabled 8 of 20 new checks fail; all 192 abilities are refused as duplicates in both orders.
Assumed (not proven): that nothing else reads the order of purchases across the two collections; that stamping order on the build object is safe across undo / time-travel scrub / the draft-character flow in the creation tool; that treating the later copy as "not counted" but still "owned" is correct for effects keyed on the feature label; that no saved character has a legitimate reason to hold the same ability through both doors.

## Proposed approach
1. Add `abilityIdent(key)` (both key shapes -> the mirrored feature label) and `ownsAbility(build, key)` (owned through either door).
2. Stamp purchase order: the two event handlers (`MUT.feature`, `MUT.subabil`) record the FIRST door used for a mirrored ability on `build._abilDoor[ident]` ('f' or 's'). An underscore key = derived ordering state, never saved or compared. A build handed to `compute()` without it falls back to door A.
3. In `compute()`, before the feature loop, detect abilities present in both collections and mark the later copy as a duplicate. In the later copy's loop: push ONE warning that starts with the stop-sign character ("duplicate: already owned as ..., bought first (this copy is not counted)"), do not price it, list it once under "Blocked purchases" (display-only line), and `continue`. If the counted copy is itself blocked by a Hit-Dice requirement, do not list the duplicate a second time.
4. Ownership sets (`_ownedFeatSet`, `_blockedFeat`) are deliberately NOT changed: the logical ability is still owned through the counted copy, so effects keyed on the feature label still apply exactly once.
5. Refusal at buy time needs no tool-side rule: `purchaseLegality()` already refuses any new stop-sign warning.
6. Live Sheet UI: the class-feature lists and the subclass list use `ownsAbility()` so an ability owned through either door renders as owned. The creation tool's feature menu is built once at start-up and cannot be marked per character; it relies on the engine warning.
7. Bump the rules version once (the computed output changes for a build holding a duplicate). Add fixtures, a pure-node gate, a browser gate.

## Files involved
`engine.js` (helpers, `MUT`, `compute()` detection + two branches); `engine-data.js` (version string only); the Live Sheet HTML (3 feature lists + 1 subclass list + module import); two tool title labels (version literal); fixtures CG-053..056 (direct builds) and EV-030..031 (event replays, both orders); `expected-results.csv`, `expected-warnings.json`; a new node gate and a new browser gate; two CI workflow files.

## Out of scope
The Martially Bound discount mismatch; collapsing the two doors into one (a separate high-risk refactor: about 100 references across tools, only 3 of 52 fixtures buy a subclass ability); repairing any existing saved character (done separately).

## Alternatives considered
- Charge a fixed door (always A) instead of "first bought": rejected by the owner (P3).
- Derive purchase order inside `compute()` by scanning the log: `compute()` receives a build, not the log, so it cannot; changing its signature is a wide API change.
- Mark the duplicate "not owned" (add to `_blockedFeat`): rejected because it would remove an effect the character legitimately holds through the counted copy.
- Enforce only in the pickers: rejected, because a hand-edited or old log would still double-charge silently.

## Risks
Stamped order could go stale or be missing in some flow; the fallback to door A could charge the wrong copy there. Effects or prerequisites keyed on the feature label while the counted copy is door A. A stored "frozen ledger" (sum of recorded event costs) intentionally does not change, so for an already-duplicated saved log the ledger and `compute()` will disagree until repaired. Warnings are matched by text content in `purchaseLegality`, so identical duplicate texts for two different purchases could collide.

## Verification
Run the engine-parity, legality, price-of and new gates (all must report 0 failed); run the browser gates; mutation check: disable the guard and confirm the new gate fails.

## Done when
A build holding one ability through both doors prices it once, warns once, lists the later copy once under "Blocked purchases" (both orders, and when Hit-Dice-blocked); both tools refuse the second purchase; all gates pass.

## Reviewer instructions
- First line of your reply: your model name and any settings.
- Judge logic, clarity, scope and risk. You cannot run the code; do not claim a test would fail unless you can show why from the text.
- Attack the DESIGN and the DIFF in Appendix A. Look hardest for: a path where the stamped order is wrong or missing; a case where two different purchases produce the same warning text; effects/prerequisites/stepped features/aliases (`FEAT_ALIAS`) interacting badly; undo / replay / time-travel; anything that makes a legitimate purchase refuse; anything the new tests cannot catch.
- Answer these questions, each with a verdict and one paragraph: (1) does this achieve the goal? (2) are any assumptions shaky? (3) is there a simpler or safer alternative to the stamped `_abilDoor`? (4) is leaving ownership sets unchanged correct? (5) is routing the refusal through `purchaseLegality` sound? (6) what is missing or wrong in the diff (cite lines)? (7) are the Verification steps objectively checkable? (8) should this be split?
- Rank every finding HIGH / MEDIUM / LOW and say how sure you are (certain / likely / guess).
- Output a markdown file body named `subclass-double-purchase-guard-review-<model>.md`.

## Review outcome
Four reviews, 2026-10-05. Raw files in `docs/plans/cold-reviews/` (dated 2026-10-05, slug `subclass-double-purchase-guard`). Appendix A below is the diff AS SENT to the reviewers, before these fixes. Three API reviewers got the brief without repo access; the fourth was this repo's own `/code-review high` (repo access). Two of the three API reviewers named the wrong model in their own self-ID line (Groq's `gpt-oss-120b` said "gpt-4-0125-preview"; Gemini's `gemini-3.1-flash-lite` said "gpt-4o"); the files are filed under the model actually requested.

| # | Source | Finding | Verdict | Action |
|---|---|---|---|---|
| 1 | code-review | CharGen's live state has no purchase order (read off two page lists) so `compute()` counted the subclass copy, but CharGen SAVES every `feature` event before any `subabil` event, so after Save + Load the FEATURE copy counted | **Accept (real)** | Unstamped fallback is now the feature copy, matching the save order; test pins "live unstamped build == the log CharGen saves" |
| 2 | code-review | A copy that arrived through a base snapshot / legacy `patch` bundle is unstamped, so a later buy through the other door wrongly became "first" | **Accept (real)** | `_noteDoor` credits an older unstamped copy in the other door as first; tests both directions |
| 3 | code-review, Nemotron #2, Groq B | Stamp can go stale when the first copy is removed in place | **Accept (partly)** | `_noteDoor` drops a stamp whose door no longer holds the ability. A stale stamp after undo/scrub is NOT possible: the Live Sheet calls `foldBuild()` on every render and undo pops from the LOG (Groq's "high risk" B is a false alarm) |
| 4 | code-review | A repeated key warned and listed once per copy | **Accept** | One duplicate warning and one Blocked-purchases line per key; test. (A same-door repeated subclass key still charges twice -- pre-existing, out of scope, filed as a follow-up) |
| 5 | code-review | Duplicate's displayed price/HD check could differ between doors | **Reject as a bug, pinned** | The blocked line is display-only. New test asserts all 192 mirrors have identical `requiredHD`, tier, origin and cross price, and none is an invocation |
| 6 | code-review | `_mirrorIdents` cache never invalidated | **Accept** | Cache keyed on the `DATA.subAbilMap` object and its size; test adds then removes an entry |
| 7 | code-review | Identity string and price expression re-derived inline in several places | **Accept** | `_subIdent()` and `_subPriceOf()` helpers; one place each |
| 8 | code-review | `_ownedFeatSet`/prereq gate sees `b.features` only while `ownsAbility()` sees both doors | **Latent, pinned** | No data row has the shape (a feature whose prerequisite is a mirrored subclass ability); new test fails the day one is added |
| 9 | code-review | O(subAbilities x features) scan per `compute()` | **Accept** | Detection reuses `_ownedFeatSet` |
| 10 | code-review | Other `b.features.includes()` checks in the Live Sheet (Eldritch Invocations) ignore the subclass door | **No overlap, pinned** | Invocations are not mirrored subclass abilities; the same test asserts none of the 192 is an invocation |
| 11 | Nemotron #6 (HIGH) | The subclass loop forgets Hit-Dice blocking of the counted feature copy | **Refuted** | `_blockedFeat` already holds Hit-Dice-blocked features. New fixture EV-032 (feature first, Hit-Dice-blocked) lists the ability once |
| 12 | Nemotron #3 | Persist order in the log instead of stamping the build | **Reject** | The log IS the order; the stamp is re-derived by replay on every render, never stored |
| 13 | Gemini | Legacy characters with a deliberate double purchase would be recomputed | **Noted** | Measured 2026-10-05: one live case, repaired separately; frozen ledgers (`economy()`) are unaffected |

---
## Appendix A: the engine diff (unified, 8 lines of context)
```diff
diff --git a/js/engine.js b/js/engine.js
index 29b72a1..d33ed90 100644
--- a/js/engine.js
+++ b/js/engine.js
@@ -88,16 +88,43 @@ export { DATA };
  * DATA.features, compute()'s `if(!f)continue;` silently DROPS the purchase — the character
  * loses the feature and the AP it cost, with no warning anywhere. v0.346 split
  * "Druid: Elemental Fury / Improved circle" and v0.345 renamed "Paladin: Aura expansions"; this
  * map is what keeps those characters whole. Applied at both funnels — MUT.feature (so replay
  * normalises the build) and compute()'s lookup (so a build handed in directly still prices).
  * Add an entry here whenever a DATA.features key is renamed or removed; never rename one silently. */
 export const FEAT_ALIAS = lab => (DATA.featureAliases && DATA.featureAliases[lab]) || lab;
 
+/* One ability, two purchase doors (feat/subclass-double-purchase-guard, owner decision P3, 2026-10-05).
+ * All 192 subclass abilities are sold twice: as `DATA.subAbilMap["Class|Sub|Name"]` (b.subAbilities) and as a
+ * mirrored `DATA.features["Class: Name"]` (b.features). The two loops in compute() used to dedupe only within
+ * their own collection, so one ability bought through both was charged twice with no warning (a live campaign character,
+ * 8 AP + 7 AP, found 2026-10-05). abilityIdent() is the ONE shared identity — the mirrored feature label.
+ * It is deliberately a function of the two keys' own shapes, not a second table that has to be kept in sync. */
+let _mirrorIdents = null;
+const _isMirrored = id => {
+  if (!_mirrorIdents) _mirrorIdents = new Set(Object.values(DATA.subAbilMap || {}).map(a => a.cls + ': ' + a.name));
+  return _mirrorIdents.has(id);
+};
+/** "Class|Sub|Name" (a subAbilMap key) or "Class: Name" (a feature label) -> the shared "Class: Name" identity. */
+export function abilityIdent(key) {
+  if (typeof key !== 'string') return key;
+  if (key.indexOf('|') >= 0) { const a = (DATA.subAbilMap || {})[key]; return a ? a.cls + ': ' + a.name : key; }
+  return FEAT_ALIAS(key);
+}
+/** Does the build hold this ability through EITHER door? Accepts either key shape. */
+export function ownsAbility(b, key) {
+  const id = abilityIdent(key);
+  return (b.features || []).some(l => FEAT_ALIAS(l) === id) || (b.subAbilities || []).some(k => abilityIdent(k) === id);
+}
+/* Purchase order across the two collections. b.features and b.subAbilities are separate arrays, so which door an
+ * ability was bought through FIRST is lost by the time compute() sees the build. MUT notes it (first door wins) on
+ * `b._abilDoor` — an underscore key, like `_raceTraitLocked`: derived ordering state, never saved, never compared. */
+const _noteDoor = (b, id, door) => { if (!_isMirrored(id)) return; const d = b._abilDoor || (b._abilDoor = {}); if (!d[id]) d[id] = door; };
+
 /**
  * packTraitsFor(species, species2) — the racial traits a character owns FOR FREE by virtue of their
  * heritage pack(s), in DATA.racialList order.
  *
  * A heritage pack is charged as ONE line ("Heritage pack", DATA.pack[species]) and its member traits
  * are then owned implicitly: compute()'s `_ownsR` already treats them as held whether or not they
  * appear in b.racialTraits, which is what makes prerequisite checks work. But that ownership was
  * DERIVED AND NEVER EXPORTED, so no UI could render it — CharGen left the checkboxes unticked while
@@ -482,26 +509,45 @@ export function compute(b, opts){
   // v3 (owner-directed, D-2026-08-19-premium-autogrowth-to-stepped): prerequisite hard block, widened
   // from Warlock-invocation-only to any feature declaring f.prereq. A feature whose prereq isn't owned
   // — or whose prereq is itself blocked (a skipped intermediate step) — is excluded from pricing and
   // ownership entirely below: it costs 0 and is itemized separately under "Blocked purchases" rather
   // than counted as a real purchase. Fixed-point over b.features so a chain of any depth resolves
   // correctly (owning steps 2 and 3 while skipping 1 blocks both, not just the one naming 1 directly).
   // (ownership resolution — _ownedFeatSet / _blockedFeat / _hdBlockedFeat — is computed near the top of
   // compute(), BEFORE any mechanical effect reads b.features. See the block above the ability-score fold.)
+  // One ability, two doors (feat/subclass-double-purchase-guard, owner decision P3 2026-10-05): an ability held through BOTH
+  // b.features ("Class: Name") and b.subAbilities ("Class|Sub|Name") is one purchase, not two. The copy bought FIRST is the one
+  // counted; the later copy costs nothing, grants nothing, raises one "⛔ … duplicate" warning (which purchaseLegality() reads as a
+  // hard refusal, so both tools turn the second purchase away) and is listed once under "Blocked purchases". Order comes from
+  // b._abilDoor (stamped by MUT); a build handed in without it falls back to the subclass copy, the door that also feeds
+  // subclass-unlock accounting and the class-access check the feature door skips.
+  const _dupFeat=new Set(), _dupSub=new Set(), _dupSubKey={};
+  {const _byId={};for(const _k of (b.subAbilities||[])){const _a=DATA.subAbilMap[_k];if(_a&&!_byId[_a.cls+": "+_a.name])_byId[_a.cls+": "+_a.name]=_k;}
+   for(const _id in _byId){if(!(b.features||[]).some(function(l){return FEAT_ALIAS(l)===_id;}))continue;
+     _dupSubKey[_id]=_byId[_id];
+     if(((b._abilDoor||{})[_id]||'s')==='f')_dupSub.add(_byId[_id]);else _dupFeat.add(_id);}}
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
+    if(_dupFeat.has(lab)){
+      // The later copy of an ability whose subclass copy was bought first. If the counted (subclass) copy is itself Hit-Dice-blocked
+      // its own line already stands for this ability, so the duplicate is not listed a second time (or its price counted twice).
+      const _ka=DATA.subAbilMap[_dupSubKey[lab]];
+      W.push("⛔ "+(lab.split(": ")[1]||lab)+" — duplicate: already owned as a "+_ka.sub+" subclass ability, bought first (this copy is not counted)");
+      if(!(hd<requiredHD(_ka))){blockedAP+=c;_BLI.push([lab,c]);}
+      continue;
+    }
     if(_blockedFeat.has(lab)){
       // Report every DIRECT cause on the item itself, HD first, so a purchase failing both gates says so
       // instead of hiding one behind the other. A pure-prereq block keeps its exact pre-existing wording
       // — the four prereq regression fixtures assert that string, and it must stay the thing they prove.
       const _missing=(f.prereq||[]).filter(function(req){return !_ownedFeatSet.has(req)||_blockedFeat.has(req);});
       const _reqLab=_missing[0]?(_missing[0].split(": ")[1]||_missing[0]):"an earlier step";
       const _why=[];
       if(_hdBlockedFeat.has(lab)){const _n=requiredHD(f);
@@ -558,16 +604,26 @@ export function compute(b, opts){
   add("Sorcery points",(DATA.sorcCum&&DATA.sorcCum[Math.min(sorcery,DATA.sorcCum.length-1)])||0);
   if((b.sorcery||0)>0){var _hsd=(b.traditions||[]).some(function(t){return (t.disciplines||[]).some(function(d){return d&&d.name==="Sorcerer";});});if(!_hsd)W.push("⛔ Sorcery points require the Sorcerer discipline (open Arcane › Sorcerer)");else if(hd<2)W.push("⛔ Sorcery points require 2 Hit Dice (T2)");}
   // §14 Martially Bound — taking it grants 2 AP up front (like a drawback), discount applied in the features loop above
   if(mbClass) add("Martially Bound (gain)",-2);
   // subclass abilities (à la carte) + unlocks: first subclass per class is free, others 15 AP
   const freeSub=b.freeSub||{}; const subUsed={}; let subAP=0;const _UI=[];
   for(const key of (b.subAbilities||[])){const a=DATA.subAbilMap[key];if(!a){W.push((String(key).split("|").pop()||key)+" is no longer in the rules data — no cost/effect applied");continue;}
     const _sLab=(a.cls+" › "+a.sub+": "+a.name);
+    if(_dupSub.has(key)){
+      // The later copy of an ability whose FEATURE copy was bought first (see the detection block above the feature loop). Not counted,
+      // and — like a blocked purchase — it must not open its subclass for the paid-unlock accounting below. Listed once, and not at
+      // all when the counted feature copy is itself blocked (its own line already stands for the ability).
+      W.push("⛔ "+a.name+" — duplicate: already owned as a "+a.cls+" class feature, bought first (this copy is not counted)");
+      if(!_blockedFeat.has(a.cls+": "+a.name)){
+        const _dc=(a.cls===b.originClass||a.cls===b.originClass2)?a.origin:(_unlkSet.has(a.cls)?Math.max(1,a.cross-a.tier):a.cross);
+        blockedAP+=_dc;_BLI.push([_sLab,_dc]);}
+      continue;
+    }
     // Same Hit-Dice gate as the feature loop, via the same requiredHD(). Blocked means NOT OWNED, so the
     // subUsed[] marking below is skipped too — a blocked ability must not drag its subclass into the
     // paid-unlock accounting for a purchase that did not happen.
     if(hd < requiredHD(a)){
       {const _n=requiredHD(a);
        W.push("⛔ "+a.name+" — blocked: needs "+_n+" Hit Dice "+(_n>((DATA.tierHD||{})[a.tier]||1)?"(level gate)":"(T"+a.tier+")")+" (not counted, not owned)");}
       const _bc=(a.cls===b.originClass||a.cls===b.originClass2)?a.origin:(_unlkSet.has(a.cls)?Math.max(1,a.cross-a.tier):a.cross);
       blockedAP+=_bc;_BLI.push([_sLab,_bc]);continue;
@@ -984,29 +1040,29 @@ export function baseBuild() { return {name:'',budget:0,originClass:'Fighter',ori
 /* mutators: apply one purchased payload to the build in place */
 export const MUT = {
  create:(b,p)=>{},   // level-1 baseline (Hit Die + starting state); effect already in baseBuild
  patch:(b,p)=>{Object.assign(b,p.patch);},   // imported-from-generator bundle (a whole field set)
  names:(b,p)=>{if(p.eb)b.epicBoonAbil=p.eb;if(p.fs)b.fightingStyleNames=p.fs;if(p.mm)b.metamagicNames=p.mm;if(p.mv)b.maneuverNames=p.mv;if(p.fsc)b.fsCantripNames=p.fsc;if(p.dab)b.dabblerCantripNames=p.dab;if(p.inn)b.innateNames=p.inn;if(p.feat)b.featNames=p.feat;if(p.lang)b.languageNames=p.lang;if(p.grants)b.grantNames=p.grants;(p.tr||[]).forEach(function(t){var d=b.traditions[t.ti]&&b.traditions[t.ti].disciplines[t.di];if(d){d.cantripNames=t.cn;d.knownNames=t.kn;if(t.an)d.arcanumNames=t.an;}});},
  hd:(b,p)=>b.hd=p.to, prof:(b,p)=>b.profBonus=p.to, abil:(b,p)=>b.stats[p.ab]=p.to,
  skill:(b,p)=>b.skills.push(p.v), expertise:(b,p)=>b.expertise.push(p.v), toolexpertise:(b,p)=>(b.toolExpertise=b.toolExpertise||[]).push(p.v), save:(b,p)=>b.saves.push(p.v),
  lineage:(b,p)=>b.lineage=p.v,wornArmour:(b,p)=>b.wornArmour=p.v, racialspell:(b,p)=>(b.racialSpells=b.racialSpells||[]).push(p.v),
- feat:()=>0, feature:(b,p)=>b.features.push(FEAT_ALIAS(p.v)), art:(b,p)=>(b.arts=b.arts||[]).push(p.v), boon:(b,p)=>b.boons.push(p.v), mvbuy:(b,p)=>{b.maneuverBuys=(b.maneuverBuys||0)+1;},
+ feat:()=>0, feature:(b,p)=>{const l=FEAT_ALIAS(p.v);b.features.push(l);_noteDoor(b,l,'f');}, art:(b,p)=>(b.arts=b.arts||[]).push(p.v), boon:(b,p)=>b.boons.push(p.v), mvbuy:(b,p)=>{b.maneuverBuys=(b.maneuverBuys||0)+1;},
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
- subabil:(b,p)=>{(b.subAbilities=b.subAbilities||[]).push(p.v);},
+ subabil:(b,p)=>{(b.subAbilities=b.subAbilities||[]).push(p.v);_noteDoor(b,abilityIdent(p.v),'s');},
  tasharule:(b,p)=>{(b.houseRules=b.houseRules||{}).dmAllows=Object.assign({},(b.houseRules||{}).dmAllows||{},{tasha:p.v});},
  found:(b,p)=>{const ti=p.ti??0;const newDisc={name:p.disc,bound:false,cantrips:0,slots:[0,0,0,0,0,0,0,0,0],known:[0,0,0,0,0,0,0,0,0],pactSlots:0,arcanum:[0,0,0,0]};if(ti===0&&!b.traditions.length){b.traditions=[{name:p.trad,rank:0,disciplines:[newDisc]}];}else if(!b.traditions[ti]){b.traditions[ti]={name:p.trad,rank:0,disciplines:[newDisc]};}else{(b.traditions[ti].disciplines=b.traditions[ti].disciplines||[]).push(newDisc);}},
  rank:(b,p)=>{const ti=p.ti??0;if(b.traditions[ti])b.traditions[ti].rank=p.to;},
  cantrip:(b,p)=>{const ti=p.ti??0,di=p.di??0;const d=b.traditions[ti]&&b.traditions[ti].disciplines[di];if(d)d.cantrips=p.to;},
  slot:(b,p)=>{const ti=p.ti??0,di=p.di??0;const d=b.traditions[ti]&&b.traditions[ti].disciplines[di];if(d)d.slots[p.L-1]=p.to;},
  known:(b,p)=>{const ti=p.ti??0,di=p.di??0;const d=b.traditions[ti]&&b.traditions[ti].disciplines[di];if(d)d.known[p.L-1]=p.to;},
  dbound:(b,p)=>{const ti=p.ti??0,di=p.di??0;const d=b.traditions[ti]&&b.traditions[ti].disciplines[di];if(d)d.bound=!!p.v;},
 };
```

## Appendix B: `purchaseLegality` (unchanged, for reference)
```js
export function purchaseLegality(cur, cat, payload) {
  const cand = clone(cur); (MUT[cat] || (() => {}))(cand, payload);
  const seen = {}; compute(cur).warnings.forEach(w => { seen[w] = (seen[w] || 0) + 1; });
  const warnings = compute(cand).warnings.filter(w => { if (/OVER BUDGET/.test(w)) return false; if (seen[w] > 0) { seen[w]--; return false; } return true; });
  const followup = warnings.filter(w => EXPECTED_FOLLOWUP.test(w));
  const rest = warnings.filter(w => !EXPECTED_FOLLOWUP.test(w));
  const hard = rest.filter(w => !SOFT_WARN.test(w));
  const soft = rest.filter(w => SOFT_WARN.test(w));
  const dup = !!(DUP_FIELD[cat] && payload && payload.v != null && (cur[DUP_FIELD[cat]] || []).indexOf(payload.v) >= 0);
  return { warnings, followup, rest, hard, soft, dup };
}
```

## Appendix C: the pure-node gate (new)
```js
// feat/subclass-double-purchase-guard (owner decision P3, 2026-10-05) — gate for "one subclass ability is one purchase".
//
// All 192 subclass abilities are sold through TWO doors: b.subAbilities ("Class|Sub|Name") and a mirrored b.features ("Class: Name").
// Before this guard the two loops in compute() deduped only within their own collection, so an ability bought through both was
// charged twice with no warning (a live campaign character, 8 AP + 7 AP). The engine-parity fixtures CG-053..056 / EV-030..031 pin compute()'s
// output; this script pins the other half — what the TOOLS rely on:
//   * purchaseLegality() REFUSES the second purchase through either door (a "⛔ … duplicate" warning is a hard block),
//   * the refusal follows purchase order (P3: the copy bought FIRST is the one counted), not a fixed preference for one door,
//   * abilityIdent()/ownsAbility() give the pickers one shared identity for both key shapes,
//   * a clean first purchase, and a different ability through the other door, are NOT refused (the guard must not over-fire),
//   * every one of the 192 mirrored abilities round-trips (same identity from both key shapes), so no ability is left unguarded.
// Pure Node, no browser. Run: node testing/scripts/subclass-double-purchase-ci.mjs
import { DATA, compute, baseBuild, foldBuild, MUT, purchaseLegality, abilityIdent, ownsAbility, FEAT_ALIAS } from '../../js/engine.js';

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const clone = o => JSON.parse(JSON.stringify(o));

const S = 'Rogue|Soulknife|Psionic Power / Psychic Blades';
const F = 'Rogue: Psionic Power / Psychic Blades';
const OTHER_S = 'Rogue|Soulknife|Soul Blades';          // a DIFFERENT Soulknife ability: must stay buyable
const OTHER_F = 'Rogue: Soul Blades';

// A Rogue build assembled the way the tools do: replay events through MUT (so the purchase order is stamped on the build).
const rogue = () => { const b = baseBuild(); b.originClass = 'Rogue'; b.hd = 8; b.budget = 300; b.freeSub = { Rogue: 'Soulknife' }; return b; };
const buy = (b, cat, v) => { const c = clone(b); MUT[cat](c, { v }); return c; };

console.log('== identity helpers');
ok(abilityIdent(S) === F, 'abilityIdent(subAbilMap key) is the mirrored feature label', abilityIdent(S));
ok(abilityIdent(F) === F, 'abilityIdent(feature label) is itself');
ok(abilityIdent('Rogue|NoSuchSub|Nothing') === 'Rogue|NoSuchSub|Nothing', 'an unknown subAbilMap key is returned unchanged (never throws)');
{ const bad = []; for (const [k, a] of Object.entries(DATA.subAbilMap)) { const id = a.cls + ': ' + a.name; if (abilityIdent(k) !== id || !DATA.features[id]) bad.push(k); }
  ok(bad.length === 0, 'all ' + Object.keys(DATA.subAbilMap).length + ' subclass abilities map to an existing mirrored feature', bad.slice(0, 3).join(' | ')); }
{ const b = buy(rogue(), 'subabil', S);
  ok(ownsAbility(b, S) && ownsAbility(b, F), 'owned via the subclass door -> ownsAbility true for BOTH key shapes');
  ok(!ownsAbility(b, OTHER_F) && !ownsAbility(b, OTHER_S), 'a different ability is not reported as owned'); }
{ const b = buy(rogue(), 'feature', F);
  ok(ownsAbility(b, S) && ownsAbility(b, F), 'owned via the feature door -> ownsAbility true for BOTH key shapes'); }
ok(!ownsAbility(rogue(), S) && !ownsAbility(rogue(), F), 'nothing owned -> false');

console.log('== purchaseLegality refuses the second door (P3: the copy bought first wins)');
{ const cur = buy(rogue(), 'subabil', S);                       // subclass door first
  const L = purchaseLegality(cur, 'feature', { v: F });          // ...then the feature door
  ok(L.hard.some(w => /duplicate/.test(w)), 'subclass first, then feature: REFUSED as a duplicate', JSON.stringify(L.hard));
  ok(L.hard.length === 1, 'exactly one hard reason (no double reporting)', JSON.stringify(L.hard)); }
{ const cur = buy(rogue(), 'feature', F);                       // feature door first
  const L = purchaseLegality(cur, 'subabil', { v: S });          // ...then the subclass door
  ok(L.hard.some(w => /duplicate/.test(w)), 'feature first, then subclass: REFUSED as a duplicate', JSON.stringify(L.hard));
  ok(L.hard.length === 1, 'exactly one hard reason (no double reporting)', JSON.stringify(L.hard)); }

console.log('== the guard must not over-fire');
{ const L = purchaseLegality(rogue(), 'subabil', { v: S });
  ok(L.hard.length === 0, 'a first purchase through the subclass door is allowed', JSON.stringify(L.hard)); }
{ const L = purchaseLegality(rogue(), 'feature', { v: F });
  ok(L.hard.length === 0, 'a first purchase through the feature door is allowed', JSON.stringify(L.hard)); }
{ const cur = buy(rogue(), 'subabil', S);
  const L = purchaseLegality(cur, 'feature', { v: OTHER_F });
  ok(!L.hard.some(w => /duplicate/.test(w)), 'a DIFFERENT ability through the other door is not a duplicate', JSON.stringify(L.hard));
  const L2 = purchaseLegality(buy(rogue(), 'feature', F), 'subabil', { v: OTHER_S });
  ok(!L2.hard.some(w => /duplicate/.test(w)), 'a DIFFERENT ability through the subclass door is not a duplicate', JSON.stringify(L2.hard)); }

console.log('== price: counted once, and the same as a single-door purchase');
{ const single = compute(buy(rogue(), 'subabil', S)).total;
  const both1 = compute(buy(buy(rogue(), 'subabil', S), 'feature', F)).total;
  const both2 = compute(buy(buy(rogue(), 'feature', F), 'subabil', S)).total;
  ok(both1 === single, 'subclass then feature costs the same as subclass alone', both1 + ' vs ' + single);
  ok(both2 === compute(buy(rogue(), 'feature', F)).total, 'feature then subclass costs the same as feature alone', both2 + ' vs ' + compute(buy(rogue(), 'feature', F)).total); }

console.log('== every mirrored ability is guarded (both orders, all of them)');
{ const miss = []; let n = 0;
  for (const [k, a] of Object.entries(DATA.subAbilMap)) {
    const id = a.cls + ': ' + a.name; const base = baseBuild(); base.originClass = a.cls; base.hd = 20; base.budget = 9999; base.freeSub = { [a.cls]: a.sub };
    const x = purchaseLegality(buy(base, 'subabil', k), 'feature', { v: id });
    const y = purchaseLegality(buy(base, 'feature', id), 'subabil', { v: k });
    n++;
    if (!x.hard.some(w => /duplicate/.test(w)) || !y.hard.some(w => /duplicate/.test(w))) miss.push(k);
  }
  ok(miss.length === 0, 'all ' + n + ' abilities refused as a duplicate in BOTH orders', miss.slice(0, 5).join(' | ')); }

console.log('== a build handed in without purchase order falls back to the subclass copy');
{ const b = rogue(); b.features = [F]; b.subAbilities = [S];   // no b._abilDoor — e.g. a hand-assembled build
  const r = compute(b);
  ok(r.warnings.some(w => /duplicate: already owned as a Soulknife subclass ability/.test(w)), 'the FEATURE copy is the duplicate by default', JSON.stringify(r.warnings)); }

console.log('\n' + (fail ? '✗ ' + fail + ' FAILED / ' + pass + ' passed' : '✓ ' + pass + ' passed / 0 failed'));
process.exit(fail ? 1 : 0);
```

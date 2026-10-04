// Reference copy — the Live Sheet's ORIGINAL priceOf()/_CTX_PRICERS, verbatim as of refactor/engine-priceof
// (2026-10-04), before it moved into js/engine.js. testing/scripts/engine-priceof-ci.mjs runs this and the engine's
// priceOf() over the same builds and requires identical answers. It is a frozen oracle: do NOT "fix" it to match a
// future engine change — if the engine's pricing is changed on purpose, update the expectation in the test instead.
// Free variables it expects (supplied by the test): DATA, MUT, compute, clone, requiredHD, FEAT_ALIAS, foldBuild.
const _CTX_PRICERS={
  // Ability raise: the ABIL ladder delta from the CURRENT score to the target. A build diff here would
  // also re-price already-owned Grit, whose surcharge rides vgcap = CON mod (js/engine.js:119,123).
  abil:function(cur,p){const from=(cur.stats&&cur.stats[p.ab])||10;
    return (DATA.ABIL[Math.min(20,(+p.to))]||0)-(DATA.ABIL[Math.min(20,from)]||0);},
  // Level up: the Hit Dice cumulative step, PLUS anything that step makes legal.
  //
  // The ladder step alone is right for everything the character already owns — that independence is the
  // whole reason this escape exists, and it is load-bearing: a whole-build delta re-prices an UNSTAMPED
  // Vigor/Grit stack (one with no _vigorRankTier stamps, which is exactly what CharGen produces, since it
  // writes `hardy` as a patch slot rather than a cat:'vigor' event). Measured: removing the escape turned
  // a 2 AP level-up into 8 for such a character.
  //
  // But the ladder step alone was ALSO swallowing a real charge once the Hit-Dice gate landed
  // (D-GH-2026-08-27-feature-hd-gate). A purchase held while HD-blocked is frozen at cost 0; levelling
  // past its requirement makes it legal and owned, and charging only the ladder paid nothing for it —
  // 32 AP of unearned spending power in the frozen ledger, with no warning. js/engine.js's repriceDraft()
  // never had this bug, because it prices every event as the compute() delta.
  //
  // So: ladder step + the drop in "Blocked purchases". compute() already itemises each blocked purchase
  // at the exact cost it WOULD have, so the fall in that line across the level-up is precisely what the
  // step legalises — no more (already-owned things stay out of it) and no less.
  hd:function(cur,p){const to=Math.min(20,Math.max(1,Math.floor(+p.to)||1)),from=cur.hd||1;
    const step=(((DATA.HD[to-1]||{}).cum)||0)-(((DATA.HD[from-1]||{}).cum)||0);
    // Charging the fall in the "Blocked purchases" line alone was NOT enough: legalising a purchase also
    // moves OTHER priced lines. A blocked subclass ability is skipped by the engine's subUsed[] marking,
    // so unblocking it can add a 15 AP "Subclass unlocks" line; an unblocked invocation re-enters the
    // breadth surcharge. Measured: real delta 32, blocked-line quote 17.
    //
    // So take the difference of two deltas: the real one, and the same one on a build with every
    // currently-HD-blocked purchase stripped out. Whatever re-prices for reasons OTHER than unblocking
    // — notably an unstamped Vigor/Grit stack, which is why this escape exists at all — appears in both
    // and cancels. What survives is exactly the cost of what this level-up makes legal.
    const alias=(typeof FEAT_ALIAS==='function')?FEAT_ALIAS:function(x){return x;};
    const strip=function(b){const c=clone(b);const h=b.hd||1;
      c.features=(c.features||[]).filter(function(l){const f=DATA.features[alias(l)];return !(f&&h<requiredHD(f));});
      c.subAbilities=(c.subAbilities||[]).filter(function(k){const a=DATA.subAbilMap[k];return !(a&&h<requiredHD(a));});
      // Arts & Boons are hard-blocked the same way as features/subAbilities (D-GH-2026-08-27-feature-hd-gate
      // addendum) but were missing here: an HD-blocked Art or Boon passed through unstripped, so it appeared
      // in BOTH deltaFull and deltaStripped below and canceled out -- the level-up that legalised it quoted
      // only the ladder step and the purchase activated for free. Caught by /code-review ultra on PR #471.
      c.arts=(c.arts||[]).filter(function(l){const a=DATA.arts[l];return !(a&&h<requiredHD(a));});
      c.boons=(c.boons||[]).filter(function(l){const bo=((b.houseRules||{}).boons||{})[l]||DATA.boons[l];return !(bo&&h<(Number(bo.hd)||1));});
      return c;};
    const bump=function(b){const c=clone(b);(MUT.hd||function(){})(c,{to:to});return c;};
    const curS=strip(cur);
    const deltaFull=compute(bump(cur)).total-compute(cur).total;
    const deltaStripped=compute(bump(curS)).total-compute(curS).total;
    return step+(deltaFull-deltaStripped);},
  // Class unlock: the "Class unlocks" ladder component alone, evaluated before vs after. Mirrors the
  // engine's own cumulative window (js/engine.js:214-217) rather than re-deriving a rung, so a class
  // that is already an origin class costs 0 here exactly as it does there — which matters because the
  // buy list filters only originClass, so originClass2 is offered and the engine ignores it.
  unlockclass:function(cur,p){
    const rung=function(b){
      const has2=(b.originClass2&&b.originClass2!=="(none)");
      const start=(1+(has2?1:0))-1;
      const xc=((b.unlockedClasses||[]).filter(function(c){return c!==b.originClass&&c!==b.originClass2;}).length)||(b.extraClasses||0);
      return (DATA.unlockCum[start+xc]||0)-(DATA.unlockCum[start]||0);};
    const after=clone(cur);(MUT.unlockclass||function(){})(after,p);
    return rung(after)-rung(cur);},
  // The two bonds: a flat +2 AP gain, one-way. A build diff would additionally hand back a retroactive
  // discount on already-owned features/spells — the original refund bug these two were escaped for.
  mbound:function(){return -2;},
  dbound:function(){return -2;},
  // Drawback: DATA.drawbacks[name], negated (a drawback GRANTS AP, so it is priced as a negative cost) —
  // flat table price, same shape as mbound/dbound above. Needed for fix/livesheet-drawback-legalcheck:
  // the default whole-build-delta path below would be WRONG here regardless of context — drawbacks are
  // modeled as income since v0.354 and never move compute().total at all (js/engine.js's "MODEL (b)"
  // comment), so priceOf('drawback',...) would silently return 0 without this entry.
  drawback:function(cur,p){return -((DATA.drawbacks[p.v]||0));}
};
// price a prospective change: its own listed price for a context change, else a delta against the
// CURRENT committed build (correct for an ordinary purchase, which changes nothing else's price)
function priceOf(cat,payload,_cur){
  const cur=_cur||foldBuild(null);   // optional pre-folded build: callers already holding foldBuild(null) (e.g. buy()) pass it to avoid a redundant re-fold; omitted → fresh fold (identical result — the fold is deterministic on the current LOG)
  const _ctx=_CTX_PRICERS[cat];
  if(_ctx)return _ctx(cur,payload||{});
  const before=compute(cur).total;
  const cand=clone(cur); (MUT[cat]||(()=>{}))(cand,payload);
  return compute(cand).total - before;
}

// Reference copy — the Live Sheet's ORIGINAL purchase-legality rules (legalCheck, SOFT_WARN, EXPECTED_FOLLOWUP, DUP_FIELD and the
// hard/soft/follow-up split that buy() applied), verbatim as of refactor/engine-purchase-legality (2026-10-04), before they moved
// into js/engine.js as purchaseLegality(). testing/scripts/engine-legality-ci.mjs runs this and the engine's version over the same
// builds and purchases and requires identical answers. It is a frozen oracle: do NOT "fix" it to match a future engine change — if
// the rules are changed on purpose, update the expectation in the test instead.
// Free variables it expects (supplied by the test): MUT, compute, clone.
function legalCheck(cat,payload,_cur){
  const cur=_cur; const cand=clone(cur); (MUT[cat]||(()=>{}))(cand,payload);
  const seen={}; compute(cur).warnings.forEach(w=>{seen[w]=(seen[w]||0)+1;});
  return compute(cand).warnings.filter(w=>{ if(/OVER BUDGET/.test(w))return false; if(seen[w]>0){seen[w]--;return false;} return true; }); // OVER BUDGET is a soft planning advisory only — the live economy (apAvailable(), frozen prices) already gates affordability in buy(); never hard-block a purchase you can actually pay for. Otherwise: new warnings introduced — by content, not count (so Vigor 1→2→3 each flag)
}

const SOFT_WARN=/surplus charged double|most tables cap at|most DMs cap|needs DM approval|to benefit|add no benefit|no Ki-using ability|caps them at|injure the same place/i;
const EXPECTED_FOLLOWUP=/choose an ability to raise/i;
const DUP_FIELD={save:'saves',skill:'skills',expertise:'expertise',toolexpertise:'toolExpertise',tool:'tools',instrument:'instruments',mastery:'masteries',racial:'racialTraits',racialspell:'racialSpells'};

// buy() applied this split to legalCheck()'s answer, and its duplicate guard before it (verbatim logic, parameterised on the build).
function classify(cur,cat,payload){
  const warns=legalCheck(cat,payload,cur);
  const followup=warns.filter(function(w){return  EXPECTED_FOLLOWUP.test(w);});
  const rest    =warns.filter(function(w){return !EXPECTED_FOLLOWUP.test(w);});
  const hard=rest.filter(function(w){return !SOFT_WARN.test(w);});
  const soft=rest.filter(function(w){return  SOFT_WARN.test(w);});
  const dup=!!(DUP_FIELD[cat] && payload && payload.v!=null && (cur[DUP_FIELD[cat]]||[]).indexOf(payload.v)>=0);
  return {warnings:warns,followup:followup,rest:rest,hard:hard,soft:soft,dup:dup};
}

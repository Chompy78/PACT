// Reference copy — the Live Sheet's ORIGINAL wallet logic (_lsWallet, the decision part of _lsOfferTrade, _lsWalletShort), as of refactor/engine-wallet-check (2026-10-05),
// before it moved into js/engine.js as walletState()/walletCheck(). testing/scripts/engine-wallet-ci.mjs runs this and the engine over the same inputs and requires
// identical answers. A frozen oracle: do NOT "fix" it to match a future engine change — if the rules change on purpose, update the expectation in the test instead.
// The only edit from the original: the window.* globals the tool read (_rulesStatus, _dmWindow, _dmGold) and eventsUpTo() are passed in as `o` / `events`, and the
// confirm()/flash() prompt text is dropped — this is the DATA each prompt was built from. Free variable it expects: E (the engine's economy functions).
function _lsWallet(events, o){
  var led=E.wealthLedger(events,{band:o.rules});
  var a=o.campaignActive;
  var win=E.resolveDowntimeWindow({events:events,campaignActive:a,campaignWindow:o.campaignWindow||null});
  return Object.assign({led:led}, E.wealthWithDm(led,{dmGold:a?(o.dmGold||0):0, window:win}), {on:led.on,band:led.band});
}
// _lsOfferTrade's decision: null (no trade), else the traded {gp,days,time} that would be offered.
function _lsOfferTrade(events, o, q){
  if(!q||(!q.gp&&!q.days)) return null;
  var w=_lsWallet(events,o); if(!w) return null;
  var shortGold=q.gp>w.gpLeft, shortTime=q.days>w.daysLeft;
  if(shortGold===shortTime) return null;
  var mode=shortGold?'timeForGold':'goldForTime';
  var t=E.tradeCoinTime(q,mode);
  if(!t) return null;
  if(t.gp>w.gpLeft || t.days>w.daysLeft) return null;
  return { gp:t.gp, days:t.days, time:q.time, mode:mode };
}
// _lsWalletShort: the soft-warning TEXT built from the same comparison.
function _lsWalletShort(events, o, q){
  var w=_lsWallet(events,o); if(!w||!q) return '';
  var bits=[];
  if(q.gp   > w.gpLeft)   bits.push('short '+(q.gp-w.gpLeft).toLocaleString()+' gp');
  if(q.days > w.daysLeft) bits.push('short '+E.formatDowntime(q.days-w.daysLeft));
  return bits.join(' · ');
}

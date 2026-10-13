// PACT — pure readers of a campaign's rules blob (campaigns.rules), shared by all three tools.
//
// WHY A SEPARATE FILE (feat/campaign-house-rules-tools, D-GH-2026-10-13-campaign-house-rules). These helpers are
// part of js/campaign.js's API (campaign.js re-exports them), but campaign.js imports the Supabase client and
// auth, so it loads in each tool's CLOUD module — the one that may fail or arrive late. The house-rules context
// is needed by every fold, from the very first render and fully offline (a local file that carries a
// rulesSnapshot), so the tools import these from here, in their ENGINE bridge, which has no network
// dependency. Nothing here touches the network, the DOM or `window`.

/**
 * houseRulesCtxFromRules(rules, campaignId) — the engine's houseRulesCtx for a character IN a campaign:
 *   { campaignId, rules: rules.charHouseRules | null, bans: { boons: rules.bannedBoons, draws: rules.bannedDrawbacks } }
 *
 * Returns null when there is no rules object at all (no campaign, or nothing known about it) — the caller is
 * then solo, and the character's own CharGen house rules apply. A campaign whose rules carry no charHouseRules
 * still gets a context (rules: null): owner decision U1 — while in a campaign the character's own patch is
 * ignored, whatever the campaign does or does not set.
 *
 * Campaign "disabled" is the campaign's existing ban lists (plan F2); the engine reads them from ctx.bans.
 * Pure, like drawbackCapFromRules().
 */
export function houseRulesCtxFromRules(rules, campaignId) {
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return null;
  const hr = rules.charHouseRules;
  const list = a => Array.isArray(a) ? a.filter(x => typeof x === 'string') : [];
  return {
    campaignId: (typeof campaignId === 'string' && campaignId) ? campaignId : null,
    rules: (hr && typeof hr === 'object' && !Array.isArray(hr)) ? hr : null,
    bans: { boons: list(rules.bannedBoons), draws: list(rules.bannedDrawbacks) },
  };
}

/**
 * latestRulesSnapshot(LOG) — the campaign rules this character last carried offline: the newest `rulesSnapshot`
 * event in its LOG (the Live Sheet writes one from the live rules; `campRules: null` is a logged LEAVE).
 * Returns { rules, campaignId } (campaignId is null on a snapshot written before it was stamped), or null when
 * the LOG has no snapshot or its newest one is a leave. Inert to the engine, like the event itself.
 *
 * Was a local function in the Live Sheet and the DM Console (_latestLogSnapshotRules); one reader now, so CharGen
 * can read the same snapshot without a third copy.
 */
export function latestRulesSnapshot(LOG) {
  if (!Array.isArray(LOG)) return null;
  for (let i = LOG.length - 1; i >= 0; i--) {
    const e = LOG[i];
    if (e && e.type === 'rulesSnapshot') {
      if (!e.campRules || typeof e.campRules !== 'object') return null;
      return { rules: e.campRules, campaignId: (typeof e.campaignId === 'string' && e.campaignId) ? e.campaignId : null };
    }
  }
  return null;
}

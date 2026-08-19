/**
 * PACT — the gold-and-downtime training bands  (feat/tool-coin-time-costs)
 * ---------------------------------------------------------------------------
 * The third and second of PACT's "three currencies" (Players Guide §2): every
 * IN-PLAY purchase reads its gold price and its downtime cost straight off its
 * AP cost, from one universal band. Character-generation purchases are exempt —
 * they cost AP only ("Character generation is free of gold and time… Gold and
 * downtime only start mattering for things you buy during play", §2).
 *
 * `js/engine.js` imports these and surfaces them on DATA (`DATA.economyBands`),
 * exactly as `ap-by-level.js` / `advancement.js` are surfaced. All three tools
 * read the bands THROUGH the engine's DATA bridge — never this file directly —
 * so editing a band's numbers here changes every tool with no other code change.
 *
 * THREE SETTINGS, NOT TWO (§16 "Which band fits your campaign — or none at all",
 * and §17's pre-session checklist "☐ Gold-and-Time economy: Off, Standard, or
 * Fast?"). `off` is a first-class setting, not the absence of one: the guide is
 * explicit that "the whole system is optional… nothing else in PACT depends on
 * it". It is deliberately NOT represented here as a band with zeroed rows — an
 * `off` campaign shows no prices at all, which is a different UI state from a
 * campaign whose prices happen to be zero. See economyBand() in engine.js.
 *
 * DOWNTIME IS STORED IN DAYS, DISPLAYED IN THE GUIDE'S OWN WORDS. Each row
 * carries both: `days` is the canonical integer the ledger does arithmetic on,
 * `time` is the exact phrase the Players Guide prints for that row. Storing only
 * the phrase would make the balance un-summable; storing only the days would
 * make the tools print "90 days" where the book says "3 months", and the book is
 * what a player has open at the table. Month = 30 days, year = 365 — the guide
 * never mixes a "3 months" row with a "90 days" row, so no round-trip ambiguity
 * arises from the two coexisting.
 *
 * NOT read by compute(). These tables price a purchase in gold and calendar; they
 * never touch AP, HP, AC or anything else compute() derives, so adding or editing
 * a band is not a `DATA.version` bump (see AGENTS.md, "Versioning"). The one thing
 * that WOULD bump it is changing an AP price such that a purchase crosses a band
 * threshold — but that is the AP change bumping it, not the band.
 *
 * ROWS ARE ORDERED, LOWEST BAND FIRST, and `maxAp: null` marks the open-ended top
 * row ("51+ AP"). Matching walks the rows in order and takes the first whose
 * `maxAp` the cost does not exceed; see purchaseCost() in engine.js.
 */

/* Standard band — Players Guide §16, "Every in-play purchase reads its gold and
 * downtime straight off its AP cost, using this single band."
 * Front-loaded to be gentle: "Tier 1 advances (1–2 AP) cost no gold and no
 * downtime at all… the brakes of gold and, above all, time only really bite from
 * the mid-tiers onward." */
export const BAND_STANDARD = [
  { maxAp:    2, gp:     0, days:   0, time: 'None',     ap: '1–2 AP (most Tier 1)' },
  { maxAp:    5, gp:    25, days:   7, time: '1 week',   ap: '3–5 AP (rest of Tier 1–2)' },
  { maxAp:   10, gp:   100, days:  21, time: '3 weeks',  ap: '6–10 AP' },
  { maxAp:   15, gp:   350, days:  42, time: '6 weeks',  ap: '11–15 AP' },
  { maxAp:   20, gp:   750, days:  90, time: '3 months', ap: '16–20 AP' },
  { maxAp:   30, gp:  1500, days: 180, time: '6 months', ap: '21–30 AP' },
  { maxAp:   40, gp:  3000, days: 270, time: '9 months', ap: '31–40 AP' },
  { maxAp:   50, gp:  5500, days: 365, time: '1 year',   ap: '41–50 AP' },
  { maxAp: null, gp: 10000, days: 730, time: '2 years',  ap: '51+ AP' },
];

/* Fast track — Players Guide §16, "Fast track, for campaigns that level quickly".
 * "More of the early purchases are free. The first downtime cost is measured in
 * days rather than a week. The gold figures are roughly halved, and the longest
 * waits shrink from years to a few months. The rule is otherwise identical… Only
 * the thresholds move."
 *
 * Note the thresholds genuinely differ from Standard's — this is not Standard
 * with scaled numbers. Standard's first row tops out at 2 AP, Fast's at 5, and
 * Fast has eight rows to Standard's nine. Do not try to derive one from the other. */
export const BAND_FAST = [
  { maxAp:    5, gp:    0, days:  0, time: 'None',     ap: '1–5 AP (all of Tier 1, cheapest Tier 2)' },
  { maxAp:   10, gp:   50, days:  1, time: '1 day',    ap: '6–10 AP' },
  { maxAp:   15, gp:  150, days:  3, time: '3 days',   ap: '11–15 AP' },
  { maxAp:   20, gp:  400, days:  7, time: '1 week',   ap: '16–20 AP' },
  { maxAp:   30, gp:  800, days: 14, time: '2 weeks',  ap: '21–30 AP' },
  { maxAp:   40, gp: 1500, days: 30, time: '1 month',  ap: '31–40 AP' },
  { maxAp:   50, gp: 3000, days: 42, time: '6 weeks',  ap: '41–50 AP' },
  { maxAp: null, gp: 5000, days: 90, time: '3 months', ap: '51+ AP' },
];

/**
 * The three settings a campaign (or a solo player) can pick, keyed by the token
 * stored in `campaigns.rules.economy.band` / the local setting. `off` carries no
 * rows on purpose — see the header note on why it is not a zeroed band.
 *
 * `blurb` is the one-line description the settings UI shows next to each choice,
 * condensed from §16's "Pick by the campaign's rhythm" list.
 */
export const ECONOMY_BANDS = {
  off: {
    label: 'Off',
    rows: null,
    blurb: 'AP alone governs advancement — no gold or downtime is tracked or shown.',
  },
  standard: {
    label: 'Standard',
    rows: BAND_STANDARD,
    blurb: 'Sandbox, exploration, and slow-burn home games, where weeks and months pass freely.',
  },
  fast: {
    label: 'Fast',
    rows: BAND_FAST,
    blurb: 'War, horror, survival, or any campaign on a ticking clock, where downtime is scarce.',
  },
};

/** The setting used when a campaign (or character) has never chosen one.
 *  `off` on purpose: the economy is opt-IN. Switching it on is a deliberate DM
 *  decision from §17's pre-session checklist, and defaulting a live campaign into
 *  a currency it never agreed to track would retroactively bankrupt every
 *  character in it. */
export const DEFAULT_BAND = 'off';

/* Starting wealth (§16). The purse itself is DATA.goldPurse (25 gp) and the
 * 1 AP = 50 gp conversion is already wired through compute().goldGp — both
 * predate this file and are deliberately left where they are. Only the guide's
 * SUGGESTED cap lives here, because nothing enforced it before. */
export const START_GOLD_AP_CAP = 8;   // "Suggested cap: 8 AP (400 gp) at creation"

/* Trading coin for time (§16, "Trading coin for time"). "Pay roughly three times
 * the gold to halve the downtime a purchase demands, or accept triple the
 * downtime to cut its gold cost by half."
 *
 * The guide is emphatic that this is DM-adjudicated and situational — "The DM sets
 * the exact exchange, and may refuse it outright when no plausible mentor,
 * library, or workshop is at hand." So these are the DEFAULT rates the tool
 * offers, never a rate it enforces. */
export const TRADE_RATES = {
  goldForTime: { goldMult: 3, timeMult: 0.5 },   // 3× gold, half the downtime
  timeForGold: { goldMult: 0.5, timeMult: 3 },   // triple the downtime, half the gold
};

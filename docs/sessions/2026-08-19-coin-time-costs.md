# 2026-08-19 — building the gold-and-downtime economy into the tools

Branch: `claude/tool-coin-time-costs-lb4j3h`
Decision record: `decisions/2026/D-GH-2026-08-19-tool-coin-time-costs.md`

## The starting point, and the surprise in it

The ask was to "build in the coin and time costs into the tools", configurable by the DM in a campaign
or by the player outside one, switchable off, with every feature showing a time and money cost.

Before asking anything, the guide was checked. **It already specified the entire system** — §2 "The
Three Currencies", §16 "Gold, Downtime, and Starting Wealth" with both band tables printed in full,
and §17's pre-session checklist already carrying *"☐ Gold-and-Time economy: Off, Standard, or Fast?"*.
Even the details the ask did not mention were there: the creation exemption, the coin-for-time trade
at 3×, mentor discounts, concurrent-training overlap, and the starting-wealth cap.

So this was **implementation against an existing specification, not rules design** — which changed the
shape of the work substantially, and meant no guide edit was needed and `pact-guide` was never
touched. Worth naming because it is the exact inverse of the drift `AGENTS.md`'s "a mechanics change
isn't finished until the engine AND the guide land it" rule exists to prevent: there the engine runs
ahead of the guide; here the guide had been complete and authoritative for months while the engine
carried nothing but `DATA.goldPurse`.

## What was actually asked, and answered

Four decisions were put to the owner before any code:

| Question | Answer |
|---|---|
| How hard should the tools enforce? | Tracked balance, **soft warning** |
| How configurable? | **Three presets only** (Off/Standard/Fast) |
| Where does "in play" begin? | **Reuse the existing creation lock** |
| How much in this branch? | **All four slices**, including the guide's optional extras |

## The three choices that shaped everything

**Soft, not hard.** §16 gives the DM mentor discounts and waivers; §17 says outright that the DM *"can
waive or reduce any cost at any time, AP, gold, or downtime"*. A tool that blocked a purchase would
not be strict, it would be **wrong about the rules**. Same reasoning killed a `>= 0` check constraint
on the new columns: an overdraft is a real table state, so it renders amber, never red.

**The creation lock, not a new concept.** The engine already knew where creation ends — a one-way
ratchet with three interacting config fields, an explicit unlock, and a spend threshold. Rather than
copy that into the ledger, `_replay()`'s bookkeeping was **extracted** into `_lockStates()`. This was
the one genuinely risky edit of the session (`_replay` is the highest-risk function in the repo), so
it was made first, alone, and proven neutral against `engine-parity` and `log-fuzz` before anything
was built on it.

**Freeze the price onto the event.** `gp`/`days` stamp onto each purchase exactly as `cost` already
stamps its AP. This stops a DM switching Standard→Fast from silently re-pricing every purchase ever
made — the specific hazard §16 warns about — and, unexpectedly, collapsed three separate features
(DM waivers, mentor discounts, the coin-for-time trade) into **one mechanism**: "a purchase that did
not pay list price".

## Two things the tooling caught that review would not have

1. **A real PWA bug.** `audit.py --rls` failed the moment `economy-bands.js` was added: `engine.js` is
   cached network-first, so a new import of a cache-first file could break the import at link time for
   returning users. Fixed by adding it to `NETWORK_FIRST_RE` and bumping `CACHE_NAME` to `pact-v9`.
   Nothing in the feature's own testing would have found this.

2. **A substring collision in a scripted edit.** Applying `    window._dmAp = ...` before
   `        window._dmAp = ...` matched *inside* the longer line and duplicated a statement. Caught by
   re-grepping after the edit. The lesson is ordinary but worth writing down: when scripting
   replacements where one anchor is a substring of another, apply the **longest first**, or anchor on
   something that cannot nest.

## Where each tool landed, and why they differ

The three tools deliberately do **not** show the same thing, because they are not in the same
situation:

- **Live Sheet** — where money is real. Full wallet, per-tile prices including "free of coin and time"
  on Tier 1 (the guide's own point that low tiers are free *on purpose*), shortfall warnings, the
  trade offer, and the ledger's frozen figures.
- **CharGen** — a creation form, where nothing is charged. Prices say **"in play"**. That wording is
  load-bearing: a bare "350 gp" there would be a lie about what the player is being charged. Free
  rows stay unlabelled, since on a form charging nothing, "free" on every cheap row is noise.
- **DM Console** — the dial and the grant form. The grant form is hidden entirely when the campaign
  plays with the economy off, because its presence would imply the economy was running.

## Testing

New gate `testing/scripts/economy-ui-e2e.mjs`, 120 checks. Both band tables are asserted at every row
**boundary** rather than mid-row, because an off-by-one in the `maxAp` comparison is the likeliest way
the table breaks and a mid-row sample would never see it.

The gate was **verified to go red** rather than assumed to: removing the creation guard fails 13
checks, zeroing one band row fails 16. Three of the early failures were the test's own wrong
expectations, not product bugs — including one that surfaced genuinely awkward UI copy ("None downtime
left"), which was then fixed in the tool.

## Deliberately not done

- **No `DATA.version` bump** — `compute()` is untouched; the bands are display/config data.
- **No `BUILD` bump** — that belongs to the `preview` → `main` promotion PR.
- **No guide edit** — the guide already specifies all of this.
- **Concurrent-training overlap** (§16's "charge only the longer of two downtimes") and a **DM-side
  per-purchase discount UI** are not built. Both are explicitly DM-adjudicated, and the freeze
  mechanism already supports them at the data layer, so they are follow-up UI work, not missing rules.
- **The migration is written but not applied** to the live Supabase project — applying it is a
  shared-state action for the owner to authorize, and `get_advisors` should run immediately after per
  `AGENTS.md` step 4.

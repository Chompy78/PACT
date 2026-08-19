# D-GH-2026-08-19-tool-coin-time-costs — the gold-and-downtime economy reaches the tools

Status: Active

- **Context:** PACT is named for its three currencies, and the Players Guide has documented all three
  in full for some time — §2 "The Three Currencies", §16 "Gold, Downtime, and Starting Wealth", and
  §17's pre-session checklist item *"☐ Gold-and-Time economy: Off, Standard, or Fast?"*. Two of the
  three had **no implementation whatsoever**: no band tables, no per-purchase derivation, no balance,
  no DM grant path, no setting. Only the *starting wealth* half existed (`DATA.goldPurse = 25` and
  `compute().goldGp`), which predates this work and is untouched by it.

  This is therefore the **inverse** of the failure `AGENTS.md`'s "A mechanics change isn't finished
  until the engine AND the guide land it" rule was written for. There, the engine shipped ahead of the
  guide. Here the guide had been complete and authoritative for months while the engine carried
  nothing — so this task needed no guide edit at all, and `pact-guide` was not touched. The guide was
  read as the specification, not written to.

- **Options:**
  1. *Display-only.* Show each feature's gold and downtime, track nothing. Cheapest, no DB work — but
     a player cannot see what they can afford, which is most of the point of a brake.
  2. *Tracked balance with a soft warning.* Keep a real wallet, warn on an overdraft, never block.
  3. *Hard gate.* Refuse a purchase the wallet cannot cover.

  And, orthogonally, on configurability: three presets only; presets plus editable numbers; or presets
  plus a global multiplier. And on where "in play" begins: reuse the existing creation lock; split by
  tool (CharGen free, Live Sheet charges); or add an explicit "begin play" event.

- **Decision:** **(2) tracked balance with a soft warning, three presets only, reusing the existing
  creation lock.** All three chosen by the owner from a presented option set.

  Concretely:
  * `js/economy-bands.js` holds both band tables verbatim from §16, plus the three settings and the
    trade rates. Surfaced on `DATA` exactly as `ap-by-level.js`/`advancement.js` are.
  * `js/engine.js` gains `economySetting`/`economyBand`/`economyOn`, `purchaseCost`, `priceLabel`,
    `wealthLedger`, `wealthWithDm`, `tradeCoinTime`, `formatDowntime`, `logEconomySetting`,
    `resolveEconomySetting`, and `chargesGoldAndTime`. `compute()` is untouched.
  * `characters.gold` / `characters.downtime_days` + a `wealth_awards` ledger + `award_wealth()`,
    mirroring `characters.ap` / `ap_awards` / `award_ap()` column-for-column.
  * All three tools show a price on every priced row; Live Sheet gains a wallet line, a purchase-time
    warning, and the coin-for-time trade; DM Console gains the campaign dial and a grant form.

- **Why:**

  **Soft, not hard, because a hard gate would misstate the rules.** §16 hands the DM mentor discounts
  and outright waivers; §17 says plainly *"the DM can waive or reduce any cost at any time, AP, gold,
  or downtime"*. A tool that refused the purchase would not be strict, it would be **wrong** — and
  every legitimate DM ruling would become a support request. For the same reason nothing here clamps a
  negative balance to zero: an overdraft is a real table state (the DM handed something over and will
  settle the coin later), so it renders as a caution, never an error, and `award_wealth()` carries no
  `>= 0` check constraint.

  **Three presets, because §16 says to pick one and hold to it.** *"Choose one at the start and hold
  to it for the whole campaign. Don't switch mid-game, or a purchase's price will move under the
  players' feet."* Editable thresholds would invite exactly the drift that warns against, and would
  need a custom-band storage shape and a repricing story for existing characters. `off` is a
  first-class setting, not the absence of one — the guide is explicit that it has *"three settings,
  not two"* — so it is modelled as a band with `rows: null`, never as a band of zeroes: a campaign
  playing Off shows **no prices at all**, which is a different UI state from one whose prices are zero.

  **The creation lock, because the alternative was two definitions of "in play".** §2: *"Character
  generation is free of gold and time… Gold and downtime only start mattering for things you buy
  during play."* The engine already had that boundary — a one-way ratchet with three interacting
  config fields, an explicit unlock that suppresses the auto-lock, and a spend threshold that is
  itself a function of frozen costs. Splitting by tool would have been simpler and **wrong** for
  anyone who finishes a character in the Live Sheet; a new "begin play" event would have added a
  second way for a character to be in the wrong state.

  This is why `_replay()`'s lock bookkeeping was **extracted** into `_lockStates()` rather than
  copied. Two consumers now need the same answer, and a second copy of that ratchet would not have
  stayed equal for long. The extraction is faithful — the lock depends only on event fields, never on
  the build being folded, so hoisting it to a pre-pass cannot change any value `_replay()` previously
  saw, which `engine-parity` (40/0) and `log-fuzz` (500/500, 103 draft-reconciliation logs) confirm.
  `chargesGoldAndTime()` answers the same question for the *next, not-yet-made* purchase over the same
  timeline, so a quote a player sees and the charge the ledger later applies cannot disagree.

  **Costs freeze onto their own event.** A purchase stamps the `gp`/`days` actually paid, exactly as
  `cost` already freezes its AP. Without this, a DM switching Standard→Fast would silently re-price
  every purchase every character had ever made — the specific thing §16 warns against. It also makes
  waivers, mentor discounts and the coin-for-time trade **one mechanism instead of three**: all are
  simply "a purchase that did not pay list price". `gp` and `days` are read independently, because a
  waived fee with the calendar still owed is an ordinary ruling.

  **The DM owns the money in a campaign**, per the owner's requirement: *"When a player uses gold or
  applies time, in a campaign world, the DM is the one who applies the money."* That is exactly the
  trust boundary `characters.ap` already sits on, so it is mirrored rather than reinvented — players
  have no column grant at all, so Postgres rejects a write before RLS is consulted, and
  `award_wealth()` is a `SECURITY DEFINER` RPC guarded on `is_campaign_dm()`. Only **grants** are
  stored; what a character has **spent** stays derived from its LOG, per the standing "never store
  derived values" rule. A solo character has no DM, so its grants live as `wealth` events in its own
  LOG — that asymmetry is the requirement, not a gap.

  **The band setting needed no migration.** `campaigns.rules` is already the DM-authoritative settings
  blob (D-GH14), so the campaign choice lands at `rules.economy.band` — the same call
  `D-GH-2026-08-10-dm-custom-character-fields` made for its field definitions. The **solo** setting
  rides the character's own LOG as an `econSetting` event, because the envelope's `rules` field is the
  rules-*version* stamp, not a settings object; as a LOG event it survives export, import and the
  CharGen↔Live Sheet handoff for free, and needs no storage anywhere.

  **Precedence is one rule, in the engine.** An active campaign's band always wins, with the
  character's own logged band explicitly *not* acting as a fallback within one — a player must not be
  able to opt their character out of the table's economy, and a stale `econSetting` from before they
  joined must not resurface as a private band. `campaignActive` is caller-supplied rather than inferred
  from the rules object being truthy, so a network hiccup drops to the character's own honest local
  answer instead of silently downgrading the table's economy — the same distinction the DM-AP chip's
  `'unavailable'` state exists to preserve.

  **CharGen says "in play", and that wording is load-bearing.** Creation is free, so a bare "350 gp" on
  a creation form would be a straightforward lie about what the player is being charged. CharGen's
  labels are forward-looking planning information and say so. For the same reason a free Tier 1 row is
  left unlabelled there while the Live Sheet does label it "free of coin and time" — on a form where
  nothing is charged, that phrase on every cheap row is noise; on a sheet where money is real, it is
  the guide's own point that *"low tiers are nearly free, on purpose"*.

  **The trade is offered only when it would help and would close.** §16's coin-for-time exchange is
  prompted only when the player is short of one currency while holding enough of the other — *"handy
  when a build is rich in one and starved of the other"* — and never when the traded price would still
  not close, which would just add a click before the same shortfall warning. The prompt states the DM
  may refuse it outright, because the guide does.

- **Not done, deliberately:** no `DATA.version` bump — `compute()` output is unchanged (engine-parity
  0 failed proves it), and the bands are never read by it. No `BUILD` bump — that belongs to the
  `preview` → `main` promotion PR, not a feature branch (`D-GH-2026-08-02-build-version-pr-linked`).
  No guide edit — the guide already specifies all of this. Concurrent-training overlap (§16's "charge
  only the longer of two downtimes") and a DM-side per-purchase discount UI are **not** built; both
  are explicitly DM-adjudicated, and the freeze mechanism already supports them at the data layer, so
  they are follow-up UI work rather than missing rules.

- **Verification:** new gate `testing/scripts/economy-ui-e2e.mjs` — 120 checks across both band tables
  (asserted at every row **boundary**, against the guide's printed figures), the creation exemption,
  the freeze, drawback exclusion, the precedence rule, the trade, and the real DOM of all three tools
  in a browser. Confirmed to go **red**: 13 checks fail with the creation guard removed, 16 with one
  band row zeroed. Full suite green — engine-parity 40/0, log-fuzz 500/500, audit.py --rls 29/0,
  chargen-flows 66/66, dm-console-ui 96/96.

- **Applied to the live project** (`PACT`, `piuprrrnaotrtxucrtsb`) on 2026-08-19, as migration
  `dm_gold_downtime_economy`. The `revoke update … grant update (…)` pair was checked against the live
  grants FIRST rather than run blind — the two matched exactly (UPDATE `archived_at, autosave_enabled,
  kind, name, stats`; INSERT `autosave_enabled, id, kind, name, owner_id, stats`), so no grant drift
  existed to be silently dropped by the re-grant. This is the check D-GH15/D-GH12 exist to make routine.

  Verified after: both columns `integer NOT NULL default 0`; `gold`/`downtime_days` absent from every
  `authenticated`/`anon` INSERT and UPDATE grant (players structurally cannot write them);
  `award_wealth` `SECURITY DEFINER` with `search_path=public, pg_temp`; `wealth_awards_select` present
  with RLS on; and all 24 existing characters sitting at 0/0, untouched.

  Advisors run immediately after, per AGENTS.md step 4. **No new issue classes.** `wealth_awards`
  inherits exactly the lint set `ap_awards` already carries — unindexed FKs on `dm_id`/`campaign_id`,
  one `auth_rls_initplan` on its select policy, and "unused index" on a table with no rows yet — and
  `award_wealth` joins the existing `authenticated_security_definer_function_executable` list beside
  `award_ap` and every other RPC here, which is this project's intended pattern, not a regression.
  The only pre-existing items (`character_backups` RLS-without-policy, leaked-password protection off)
  are unrelated and unchanged.

  The repo's own audit caught a real PWA bug on the way: `js/engine.js` is cached network-first, but
  its new `economy-bands.js` import would have been cache-first, so a stale copy could break the
  import at link time. Added to `NETWORK_FIRST_RE`; `CACHE_NAME` bumped to `pact-v9`.

## Addendum (same day) — the DM-as-bookkeeper model was wrong; downtime is not gold

- **What was raised.** After the above shipped and was applied, the owner asked to walk through how
  it actually plays at the table: a player wants to buy something, sees the cost, tells the DM they
  have the money and time, and the DM agrees or doesn't. Working through that concretely surfaced
  that this build had modelled gold and downtime as **twins** — both DM-granted, per-character,
  accumulating columns (`characters.gold` / `characters.downtime_days`, one `wealth_awards` ledger,
  one `award_wealth()` RPC) — and that this was **wrong for downtime specifically**, in a way that
  would have made the feature a genuine chore rather than the light-touch brake §16 describes:
  switching the economy on would have marked every existing character permanently overdrawn (nobody
  had a balance yet), and the DM would have had to hand-type a downtime figure into every character
  card, every session, forever.

- **The correction, from the owner directly:**
  1. Gold is fine as built — per-character, DM-granted (in a campaign) or self-declared (solo),
     accumulating. §16 and the owner's own framing both treat gold as a bank.
  2. Downtime is **not** a bank. It is a single window the DM declares for the **whole party at
     once** — "the time should not keep adding up... spend it now or wait till another opportunity."
     A new declaration **replaces** the old one; it does not add to it.
  3. The natural moment to declare it is the same moment the DM already awards AP (end of session),
     which is why gold/AP share one form ("same area as AP awards") while downtime gets its own,
     separate, party-wide control — because bundling a party-wide value into a per-character form
     would mean re-typing the same number once per player, with no guard against drift.
  4. A DM may additionally grant one character **bonus time** — extra days on top of whatever base
     window is live — on the SAME per-character form gold uses ("extend to include time (and bonus
     time)"). A bonus resets along with the base the moment a new one is declared (owner: **S1**),
     because it is "extra time in *this* window", not a second persistent pool.

- **Why this was corrected same-day rather than shipped and revisited.** The original migration had
  been live for hours with every character still at gold=0/downtime_days=0 and no campaign using the
  economy — the cheapest possible moment to fix a wrong data model is before any real data exists
  against it. Waiting would have meant either migrating real balances later or living with the wrong
  shape indefinitely.

- **What changed, concretely:**
  - `characters.downtime_days` **dropped** — a character's downtime is now fully computed, never
    stored. `characters.gold` is untouched.
  - `wealth_awards` → **`gold_awards`** (renamed, downtime column dropped) — gold-only, since
    downtime no longer shares its shape at all. `award_wealth()` → **`award_gold(character, gold,
    note)`**.
  - New table **`campaign_downtime_declarations`** (`campaign_id`, nullable `character_id`, `days`,
    `note`, `declared_by`, `created_at`) — ledger-style like `ap_awards`/`gold_awards`, but read as
    "the LATEST row", never summed. `character_id is null` = the party base; a specific character =
    a bonus for them alone, layered on the currently-live base. New RPCs **`declare_downtime(campaign,
    days, character?, note?)`** (insert-only — a fresh row IS the reset, no update path exists) and
    **`get_downtime_window(campaign, character?)`** (one query composing base + that character's
    bonus since the base landed; not `SECURITY DEFINER` — it only needs what the caller's own RLS
    already grants).
  - `js/engine.js`: `wealthLedger()`'s `wealth`-event handling now sums `gp` (gold banks) but treats
    `days` as **last-one-wins, not summed** (declaring replaces) — the one place a single event type
    carries two currencies with two different aggregation rules, which is the point, not an
    inconsistency. New `resolveDowntimeWindow(opts)` mirrors `resolveEconomySetting()`'s exact
    precedence (active campaign's window always wins; otherwise the character's own latest
    self-declared window from its LOG; else `null`). `wealthWithDm()` rewritten: `gpLeft` stays
    all-time cumulative (gold, unchanged); `daysLeft` is now `window.days` minus only the downtime
    spent **on or after** `window.startTs`, read from `wealthLedger()`'s own `entries[]` (which
    gained a `ts` field for exactly this) — never the all-time `daysSpent` total, which remains
    reported separately for history display. `window: null` (nothing ever declared) reads as "every
    downtime purchase so far is an unfunded overdraft" — the same honest-zero-balance behaviour an
    unfunded gold wallet already had.
  - Live Sheet: gained the missing solo self-service control (**🎒 Record gold & downtime**, in the
    More menu) — the write path §16 needs for an uncampaigned player, which the original build never
    built despite reading a (permanently-empty) `wealth` event type. Gold prompts add (negative
    deducts); downtime prompts **replace**, and a blank answer explicitly means "no change" (an
    explicit `0` still closes the window out). Campaign-bound characters resolve their window via the
    new `get_downtime_window()` RPC, fetched at the same points `_lsResolveDmAp`/cloud-load already
    resolve `ap`/`ignorePlayerAp`.
  - DM Console: the old standalone "Grant gold & downtime" block is gone. Each roster card's existing
    Award AP form gained optional gold and bonus-time fields (hidden when the campaign plays with the
    economy off); a new, single **party-wide downtime control** sits above the roster, not on any
    card. `loadRoster()` now also resolves the party's base window plus every roster character's own
    composed window (N parallel `get_downtime_window()` calls — deliberately N+1 round trips rather
    than a bulk fetch + client-side base/bonus composition, so that arithmetic lives in exactly one
    place, the SQL function, not two).
  - **A real, unrelated bug found and fixed on the way:** `window._dmCampaignApRules` — the cache the
    DM Console's award form and rules panel both read — never carried the campaign's `economy` band
    at all, at any of its three assignment sites. Every read of the (always-missing) `.economy.band`
    silently fell through to `'off'`, which meant the original "Grant gold & downtime" block could
    **never have shown**, in any campaign, regardless of what band the DM had chosen. Fixed by having
    all three sites carry the whole `rules` object and every read site call `economySetting(rules)`
    instead of re-deriving the fallback locally.

- **Migration path.** A follow-up migration (`2026-08-19-downtime-window-revision.sql`), not an edit
  to the already-applied one — `sql/migrations/` is an append-only historical log; the original file
  is left as a true record of what actually happened, in order. Safe as a straight `ALTER`/`DROP`, not
  a data migration: verified before writing it that every character was still at 0/0 and no campaign
  had switched the economy on, so there was no real balance anywhere to preserve or reconcile.

- **Verification:** gate extended to **151 checks** (from 120) — new coverage for gold-vs-downtime
  composition, `resolveDowntimeWindow()`'s full precedence, a window being replaced end-to-end (not
  summed) using genuine distinct event timestamps (not the coincidental `ts=0` earlier scenarios in
  the file share), the DM Console's award-form fields appearing/disappearing correctly, and the
  party-wide control. Verified to go **red** on the two regressions that matter most: making
  `resolveDowntimeWindow()` sum instead of last-one-wins failed 6 checks; making an undeclared
  window's overdraft silently read as zero failed 1. Full suite still green — engine-parity 40/0,
  log-fuzz 500/500, audit.py --rls 29/0, chargen-flows 66/66, dm-console-ui 96/96.

- **Not yet applied to the live project** as of this addendum — the follow-up migration exists on
  disk only; it needs the same explicit go-ahead + `get_advisors` check the original migration got.

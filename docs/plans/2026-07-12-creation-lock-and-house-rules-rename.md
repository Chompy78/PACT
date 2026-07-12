# Plan: Creation-lock trigger (DM-adjustable, offline-safe) + house-rules/campaign name separation

> **Status: design capture (pre-implementation).** Part of the campaign-model program (siblings:
> `2026-07-12-campaign-ap-model.md`, `2026-07-11-campaign-join-invite-flow.md`). Engine-model work sitting
> next to the known D-GH30 / `feat/ap-model-reconcile` tension → intended for cold plan review before code.
> Proceeds on **D2 / E1 / F1** (D flipped from award-based to spend-based — see L1; award-based would lock a
> player before they could spend their allocation at creation prices). **Scope (G) is still open** pending a
> Player's-Guide check — the engine today reprices ONLY own-species racial traits (not 2nd species / 2nd
> class, contrary to initial belief).

## Goal
Make "creation lock" (the switch from cheap character-creation pricing to full in-play pricing) actually
work, driven by two triggers matched to who's in charge — a **player finalising a solo character**, and a
**DM-set, per-player AP target** for campaign characters — in a way that is **correct offline** and cannot
be confused with PACT's older local "house-rules code" feature (which is renamed here to end the naming
collision).

## Context — what exists today (verified in code)
- **`creationLocked`** — a real LOG event; a one-way switch that locks creation pricing from then on. The
  intended "finalise" trigger. **Emitted by nothing today (dormant).**
- **`campaignBound`** — a real LOG event that arms an **automatic threshold lock**: once bound *and*
  cumulative spend passes a threshold, creation auto-locks; the lock is stamped **per purchase** (bought
  before the threshold → stays cheap; after → full price). Threshold is **hardcoded** to `DATA.level1AP`.
  **Also dormant.**
- **`inPlay`** — a local build *field* (not an event); it is only the **fallback** for race-trait pricing
  when replay hasn't stamped a per-trait lock (`_locked = _hasLockEntry ? _raceTraitLocked[trait] :
  b.inPlay`). So the LOG-stamped value is authoritative; `inPlay` only matters when there's no campaign lock.
- **What "locked" changes mechanically:** today, **race-defining trait pricing only** (creation cost → full
  Master-table cost). It does NOT freeze AP or block edits. *(Open question: should other creation
  discounts also lock? — see Open questions.)*
- **The gen→live handoff emits no event** — it's a verbatim LOG copy; being in the Live Sheet does not lock
  creation. So the lock must be driven by the two triggers below, not by which tool you're in.
- **Two unrelated things are both called "campaign":** the **local house-rules code** (`b.campaign` /
  `cat:'campaign'` / `applyCampaignCode()` — an offline, paste-a-code build-restriction preset, the *older*
  mechanism) vs. **real cloud membership** (`campaignBound` / `campaign_id`). They don't interact
  functionally (restrictions vs. membership+lock); the lock keys only off the real one. The collision is a
  naming footgun, not an engine bug.

## Decisions

**L1 — Two triggers, one lock (D1/E1/F1).**
- **Local / solo character:** the player flips a switch — an explicit **"Finalise / Go live"** action emits
  a one-way `creationLocked` event into its own log. (A local character has *no numeric target* — it's a
  switch, not a dial; this is why there's no "two threshold numbers" collision.)
- **Campaign character:** a **DM-set AP target** (per player) auto-locks when reached, via `campaignBound` +
  the carried target.
- **D2 (basis) — SPEND-based, not award-based.** The lock fires on cumulative AP **spent** crossing the
  target, NOT on AP awarded. This is the engine's native behaviour and it is load-bearing: awards are
  `noLock` (never count toward the lock), so a player can hold a large *unspent* awarded pile and stay
  unlocked, then **spend their whole allocation at creation prices** — each purchase is stamped at the price
  valid at that moment, cheap while cumulative spend is under the target, expensive only beyond it. (An
  award-based trigger, the rejected D1, would lock a topped-up player *before* they could spend, forcing
  their whole build at locked prices — a real bug caught in review.) The target therefore acts as a
  **creation-priced spend cap**; spending past it is in-play advancement at full price.
- **F1 (scope):** locked = the existing **pricing switch**, stamped per purchase; no budget-freeze/edit-block
  this round. **NOTE — the exact set of repriced items is the open G question:** the engine today reprices
  ONLY own-species non-pack racial traits; whether the rules intend 2nd origin species / 2nd origin class (or
  more) to also flip must be confirmed against the Player's Guide before this plan is review-ready (see Open
  questions). **E1 (reversible):** the DM can adjust (below).

**L2 — The DM-adjustable target is one DB number.**
A new DM-authoritative, per-character value `characters.creation_ap_target` (integer, nullable; default =
`DATA.level1AP` when unset), written **only** through a DM-only SECURITY DEFINER RPC (same pattern that
guards `characters.ap` via `award_ap()`; optionally an audit-ledger row). The DM sets/adjusts it from the
DM Console roster. **That single edit is the entire "DM updates the lock" action** — the DM never writes
the player's log.

**L3 — Offline-safe: the target + lock state live in the LOG, not just the DB.**
The engine only ever reads the lock/target from the **LOG** (so online and offline are identical). The DB
value is the source of truth; the **player's own client materializes it into the log** (as a
`creationTarget`/`campaignBound` event) when it next syncs online. Offline files carry their own
last-synced target and lock deterministically. **Last-wins:** replay uses the most recent `creationTarget`
event. *(A never-synced or newer-than-last-sync DM change simply isn't seen until the player reconnects —
the accepted "offline = last-known rules" trade.)*

**L4 — Precedence invariant (document as a hard rule so it can't drift).**
> Trait lock = the log-stamped value if the character is campaign-bound; otherwise the local `inPlay`
> fallback. The two are never summed or compared — campaign-bound means the log is authoritative and
> `inPlay` is ignored. Threshold = the latest `creationTarget` event (last-wins).

**L5 — Adjust asymmetry.** Raising the target only *grants creation room* (and naturally **unlocks** on the
next recompute if spend is now below it) — freely reversible. **Lowering** below current spend
retroactively reprices purchases past the new target (creation→full) and can push a character over budget —
a deliberate, **warn-worthy** DM action. (This keeps us clear of D-GH30: we only ever reprice on an
explicit DM lower, never silently.)

**L6 — Self-lock-then-join edge (define, don't leave to chance).** A character that self-finalised (one-way
`creationLocked`) *before* joining a campaign stays locked; the DM's raise-the-target unlock can't reopen an
explicit lock. This mainly affects **Path B** (binding an already-built character). Intended behaviour:
binding does not silently reopen creation; if the DM wants to grant creation room to such a character, that's
an explicit, separate action (out of scope for v1 — flag in the invite plan's Path B).

## Prerequisite deliverable — house-rules / campaign name separation
Do this **first** (its own branch/PR) so the lock code isn't wading through the ambiguous naming:
- Rename the local house-rules feature so "campaign" means *only* real cloud membership:
  `b.campaign` → `b.houseRules`; `cat:'campaign'` → `cat:'houseRules'`; `applyCampaignCode()` →
  `applyHouseRulesCode()`; UI "campaign code" → "house rules code" (the Live Sheet button is *already*
  labelled "🛡 House rules code" — internals just need to catch up).
- **`cat:'campaign'` is a LOG event category**, so this is an event-format change — cheap **now** because
  the app is pre-launch (no real character logs to migrate); it only gets more expensive once real data
  exists.
- **Future follow-up (not this task):** assess whether the local house-rules code is now partly redundant
  with cloud campaign rules (`campaigns.rules` + engine `validate()`) and could eventually be retired
  rather than kept.

## Files involved
- `js/engine.js` — replace hardcoded `DATA.level1AP` in the auto-lock with the carried `creationTarget`
  (last-wins); document the L4 invariant. House-rules rename touches `cat:'campaign'` handling.
- `sql/` — new migration: `characters.creation_ap_target` column + DM-only `set_creation_target()` RPC +
  RLS/grants (mirror into `schema.sql`).
- `js/campaign.js` / `js/dm.js` — wrapper for the new RPC; expose target in roster reads.
- `tools/DM-Console.html` — per-player "creation target" control (number + quick Lock/Unlock shortcuts) in
  the roster.
- `tools/PACT-CharGen-Webtool.html` / `tools/PACT-Live-Char-Sheet.html` — "Finalise / Go live" action
  (emit `creationLocked`); client-side materialization of DB target → LOG event on load/sync; house-rules
  rename in both.

## Out of scope
- Budget-freeze / edit-block semantics for "locked" (F2) — pricing switch only this round.
- Retiring the local house-rules code (assessment only, above).
- Un-finalising an explicitly-locked character / campaign transfer / unbind.
- The AP-display and invite work (sibling plans).

## Open questions
- **G — Does the lock reprice only race-defining traits, or 2nd origin species / 2nd origin class (or more)
  too?** Engine investigation is DEFINITIVE that today **only** own-species non-pack racial traits reprice on
  lock; `species2` (flat 2× pack), `originClass2` (flat 14 AP), lineage, and every other cost are NOT
  lock-gated. The user expected more, so this is a **rules-intent question** for the Player's Guide:
  - **G1** — engine is right, race-traits-only → lock feature stays small (make the existing single reprice
    DM-adjustable/offline-safe; likely no new-item `DATA.version` bump).
  - **G2** — engine is incomplete, more should reprice → a real engine-rules expansion (new repricing per
    item, Player's-Guide alignment, `DATA.version` bump, new fixtures per category). Much larger/riskier.
  Settle via a targeted Player's-Guide grep before this plan is review-ready.
- **D/E/F: confirmed D2 / E1 / F1** (D2 = spend-based, corrected from D1).

## Risks
- **D-GH30 adjacency:** the lock stamps pricing per purchase in replay order; keep the "spent/remaining"
  ledger logic untouched and only reprice on an explicit DM lower (L5).
- **Event-format change** (`cat:'campaign'`→`cat:'houseRules'`, new `creationTarget` event): safe now
  (pre-launch), risky later — do the rename early.
- **Materialization seam:** DB target → player-log event happens on the player's online sync; define this
  reconciliation precisely (when, dedup, last-wins) so it can't loop or duplicate events.

## Verification
- `testing/tests/engine-parity.html` → still **20/0** (existing fixtures have no `campaignBound`/target, so
  they're unaffected); **add new fixtures** covering: below-target (unlocked/cheap), crossed-target
  (locked/full, per-purchase stamping), explicit `creationLocked`, and raise-target-unlocks.
- **Offline lock test:** a file whose log carries `campaignBound` + target reprices correctly with no DB.
- **DM-adjust round-trip:** DM changes `creation_ap_target` → player client materializes it → lock/unlock
  matches; raising unlocks, lowering-below-spend reprices (and warns).
- **Precedence test:** a campaign-bound character below target shows unlocked even if its local `inPlay` is
  true (log wins).
- **Rename sweep:** no remaining `cat:'campaign'` / `applyCampaignCode` / `b.campaign`; house-rules code
  still applies restrictions; real campaign membership unaffected.
- Supabase advisor + logs after the migration/RPC (per repo process).

## Done when
- Solo characters can Finalise (emit `creationLocked`); campaign characters auto-lock at a DM-set,
  per-player, offline-carried target; the DM adjusts it by editing one number; raise unlocks, lower reprices.
- The lock is correct offline (driven entirely from the log); the L4 precedence invariant is documented.
- "campaign" means only cloud membership in code; the local feature is "house rules"; parity 20/0 (+ new
  lock fixtures pass); advisor clean.

## Sequencing (this plan within the program)
1. **House-rules rename** (this plan's prerequisite) — independent, mechanical, do first while pre-launch.
2. **AP model** (`2026-07-12-campaign-ap-model.md`) — makes CharGen DM-AP-aware; prerequisite for invite Path A.
3. **Creation-lock trigger** (this plan) — builds on the campaign/AP plumbing.
4. **Invite/join UI** (`2026-07-11-campaign-join-invite-flow.md`) — depends on 2 (and links to 3 for the
   invite-sets-initial-target idea, and to L6 for Path B).

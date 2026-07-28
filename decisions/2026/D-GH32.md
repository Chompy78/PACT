# D-GH32 — Automatic `creationLocked` requires a `campaignBound` event; the explicit trigger doesn't

Status: Active

- **Context:** Phase 2 of the CharGen/Live-Sheet unification effort (`docs/plans/2026-07-08-chargen-
  livesheet-unification-phase2.md`) settled a fuller design for `creationLocked` than D-GH31 shipped:
  four trigger paths (explicit "Finalise character" button, automatic threshold, retroactive-on-binding,
  and first locking DM AP award), and specifically that the *automatic* threshold trigger should only
  ever fire for a character that has joined a real cloud campaign — a purely local, never-bound character
  should stay creation-priced indefinitely regardless of how much it spends; only an explicit action can
  lock it. D-GH31 shipped the automatic trigger unconditionally (any character crossing `DATA.level1AP`
  auto-locked, local or not) — correct for that phase's narrower scope, but not the final intended rule.
- **A naming risk surfaced during implementation and is recorded here to prevent future confusion:**
  `js/engine.js` already has an unrelated `MUT.campaign` mutator (`cat:'campaign'`), set by Live Sheet's
  `applyCampaignCode()` — this is a **local, offline, code-paste house-rules feature** (a DM types up
  banned boons/drawbacks/arts and shares a text code), already flagged elsewhere in this project's roadmap
  as a confusing naming collision with the *real* cloud campaign system. The new `campaignBound` event
  introduced here is unrelated to `b.campaign`/`cat:'campaign'` — it represents real cloud-campaign
  membership. Verified directly: today, real campaign membership lives only as a `campaign_id` column on
  a character's row in Supabase (`js/campaign.js`'s `listMyCampaigns`/`getCampaign`), invisible to pure
  LOG replay — which is exactly why a LOG-level `campaignBound` event is necessary at all: `_replay()` has
  no database access and needs some in-LOG signal to know whether a character has ever been bound.
- **Decision:** in `_replay()` (`js/engine.js`), the automatic (threshold-based) `creationLocked` inference
  now requires a `campaignBound` event to have occurred earlier in the LOG; the explicit `creationLocked`
  event remains unconditional (fires regardless of campaign binding — it's the primary intended trigger).
  If `campaignBound` arrives *after* spend has already crossed the threshold, the automatic lock fires
  retroactively at the exact point of binding (not applied to purchases before it). `campaignBound`
  carries a campaign ID payload but `_replay()` doesn't otherwise interpret it — it's purely a boolean
  gate for this mechanism today. `DATA.version` v0.333→v0.334 (a real behavior change, not display-only).
- **Why:** without this gate, a player who never joins a campaign — building and playing a character
  entirely locally, exactly like CharGen's existing standalone use case — would have their racial-trait
  pricing silently jump to the expensive tier-based rate the moment cumulative spend crossed the anchor,
  with no DM, no campaign, and no explicit action from the player. That's surprising and punitive for the
  offline/local use case this project explicitly supports (`AGENTS.md`: "Local-only still works"). Gating
  on campaign membership means the automatic trigger only ever applies where a DM is actually present to
  set expectations; a solo/local player can only lock in via their own explicit action.
- **Status:** DONE. Engine-only (`_replay()` in `js/engine.js`); no tool emits `campaignBound` yet — that
  wiring is Phase 2 step 6. Existing D-GH31 fixtures `EV-003`/`EV-007` updated to include a `campaignBound`
  event (preserving their original per-purchase-tagging/`noLock` test intent under the new gate); two new
  fixtures added: `EV-008` (a local character's spend crossing the anchor does NOT auto-lock) and `EV-009`
  (a late `campaignBound` event retroactively locks going forward, not retroactively repricing purchases
  before it). `testing/tests/engine-parity.html` → 13/0.

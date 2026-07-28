# D-GH36 — DM Console's `MUT` bridged to js/engine.js; the matching foldBuild/economy bridge is paused (conflicts with D-GH34)

Status: Active

- **Context:** `feat/engine-bridge-all-tools` (the NOW roadmap item) called for Live Sheet and DM Console to
  stop hand-copying `foldBuild`/`activeEvents`/`economy`/`MUT` and import the engine's real versions
  instead, matching CharGen's D-GH33 bridge. A cold-reviewed plan
  (`docs/plans/2026-07-09-engine-bridge-live-dm-console.md`) covered both the fold/economy bridge and DM
  Console's separately-known `MUT` divergence (`found` has no else-branch for a second/later founded
  tradition — silently drops it; `dbound` is entirely absent — DM Console can't process that event type at
  all). Before implementing, tracing the engine's `foldBuild()`/`_replay()` surfaced that the fold/economy
  half of this plan directly conflicts with **D-GH34** (already merged): D-GH34 explicitly considered and
  *rejected* bridging Live Sheet/DM Console's fold logic as its fix, specifically because doing so — without
  historical `creationLocked`/`campaignBound` events already present in existing characters' LOGs — would
  silently flip every racial trait from today's expensive/locked pricing to cheap/creation pricing (the
  inverse of the regression D-GH34 itself fixed). Neither of the plan's two independent cold reviews caught
  this (no code access); it surfaced only once the engine's `_replay()` was actually read.
- **Decision:** split the plan's two independent halves. (1) **`MUT` bridge: done now.** DM Console imports
  `MUT` from `js/engine.js` (matching Live Sheet, which already did this); its local copy — and the two
  confirmed bugs — are gone. `MUT` has no relationship to `_raceTraitLocked`/replay-driven pricing, so this
  half is genuinely behavior-preserving except for the two intentional bug fixes. (2) **`foldBuild`/
  `activeEvents`/`economy` bridge: paused.** Left as the still-open, not-yet-designed part of
  `feat/engine-bridge-all-tools` — needs a lock-state migration strategy for existing LOGs before it can
  proceed safely; see the plan doc's Addendum for the open design question.
- **Why:** the two halves are independent — `MUT`'s bugs are real, verified, and low-risk to fix immediately;
  the fold/economy bridge is not (it silently touches live AP totals and directly contradicts a very recent,
  deliberate decision). Splitting them lets the safe half land now instead of blocking on the harder
  problem, and keeps `feat/engine-bridge-all-tools` honestly scoped to what's actually unresolved rather than
  re-closing a question D-GH34 already settled.
- **Status:** DONE (MUT bridge only). Verified: `tools/DM-Console.html`'s only two `MUT` call sites
  (`MUT.names(b,e)` and `MUT[e.cat](b,e.payload)`, both inside its local `foldBuild`) are compatible with the
  engine's `MUT` shape. `testing/tests/engine-parity.html` → 20/0 (headless-browser run, not just Node).
  DM Console's own browser-level smoke test was inconclusive in this sandbox — its module graph depends on
  `js/auth.js` → `js/supabase-client.js` → an external `esm.sh` CDN import that this sandbox's proxy could
  not complete (confirmed identical failure on the pre-change code via `git stash`, so not a regression from
  this change). `feat/engine-bridge-all-tools`'s fold/economy half remains open in
  `docs/PACT_ROADMAP.md`/AGENTS.md, now with the D-GH34 conflict documented so it isn't re-attempted naively.

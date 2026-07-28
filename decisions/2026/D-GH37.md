# D-GH37 — Live Sheet + DM Console's foldBuild/activeEvents/economy bridged to js/engine.js (D-GH36's pause lifted — pre-launch, no legacy characters)

Status: Active

- **Context:** D-GH36 paused this exact bridge because it conflicts with D-GH34: without historical
  `creationLocked`/`campaignBound` events already present in an existing character's LOG, the engine's real
  replay would silently re-price every racial trait for that character (flip from today's
  expensive/locked fallback to cheap/creation pricing). The task owner confirmed this app is **still
  pre-launch — no real characters exist anywhere to protect**, which removes the entire premise of that
  risk: there is no existing data whose pricing could silently change. Separately, tracing the trigger
  events themselves found that **no tool — including CharGen, which already uses the engine's real
  replay — currently emits `creationLocked` or `campaignBound` anywhere** (grepped all three tools and
  `js/engine.js`; zero emission sites). So today, CharGen characters are *never* actually locked (the
  trigger never fires) and always price racial traits at the cheap rate, while Live Sheet/DM Console
  (pre-bridge) always priced them at the expensive rate via the `b.inPlay` fallback — an existing,
  unintended cross-tool inconsistency for identical characters, not something this change introduces.
- **Decision:** lift D-GH36's pause. `tools/PACT-Live-Char-Sheet.html` and `tools/DM-Console.html` now
  import `foldBuild`/`activeEvents`/`economy` from `js/engine.js` (aliased) and their local
  `uptoIdx`-based versions become thin adapters: a new local `eventsUpTo(uptoIdx)` slices the tool's own
  `LOG` (preserving the existing time-travel call signature), then hands the array to the imported
  engine functions. No call site elsewhere in either tool changed. Verified via a call-site audit: every
  argument passed to these three functions across both tools is either `null` or a numeric, UI-bound
  `viewAt`/slider value (Live Sheet) — DM Console's `viewAt` turned out to be unused dead code (it only
  ever calls with `null`). `testing/tests/engine-parity.html` → 20/0, confirmed in a real headless-browser
  run (not just Node).
- **Why:** with no legacy data at risk, this is now a straightforward deduplication that also fixes the
  cross-tool pricing inconsistency above — all three tools now agree (all price racial traits at the
  cheap/creation rate, matching CharGen's actual current behavior, since nothing locks anyone yet in any
  tool). `activeEvents`/`economy`/`foldBuild` no longer have separate hand-copied implementations anywhere
  in the codebase.
- **Status:** DONE. `DATA.version` unchanged (no `compute()` table/pricing-formula change — the pricing
  *behavior* shift described above is a side effect of removing duplicated, drifted replay code, not a
  rules edit). A genuine end-to-end browser exercise of Live Sheet/DM Console themselves (beyond
  `engine-parity.html`, which doesn't load either tool) was not completed in this session's sandbox — both
  tools' module graphs depend on an external CDN import (`js/auth.js` → `js/supabase-client.js` →
  `esm.sh`) that this sandbox's outbound proxy could not complete for a `type="module"` script tag despite
  reaching the same host fine via `curl`. Static verification (call-site audit, return-shape matching,
  syntax check of both files' classic-script bodies) was completed instead. **Follow-up for whoever next
  touches either tool with real browser access:** load both tools fresh, confirm `engine-ready` fires and
  a build's stats/AP total render correctly, especially for a character with racial traits.
- **Follow-up, separate and not part of this change:** the `creationLocked`/`campaignBound` trigger
  mechanism (D-GH31/32) is fully built in the engine but wired to nothing in any tool's UI — there is no
  "finalize character" action anywhere. If the "hard to grow into your heritage late" rule is meant to
  actually bite eventually, wiring that trigger is real, separate feature work (needs its own UI decision
  in all three tools), not a refactor — flagged here so it isn't lost, not undertaken as part of this task.

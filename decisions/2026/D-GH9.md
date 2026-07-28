# D-GH9 — Feature A found Live Sheet does NOT bridge DATA/compute/MUT from js/engine.js — edited both copies

Status: Active

- **Context:** The roadmap task (and `AGENTS.md`'s Architecture section) describe Live Sheet and DM Console
  as already on a "module bridge" that imports `DATA`, `compute`, `baseBuild`, `MUT`, `activeEvents`,
  `economy`, and `foldBuild` from `js/engine.js` onto `window`, with only CharGen still embedding its own
  copy (Task 6). While implementing Feature A's `found`/`dbound` MUT extension, direct inspection showed
  this is false for the mutation/pricing layer: Live Sheet's only `<script type="module">` block imports
  `validate` (from `js/engine.js`) plus sync/auth/campaign helpers — `DATA`, `compute`, `MUT`,
  `activeEvents`, `economy`, and `foldBuild` are separate, hand-written top-level declarations in the same
  file, and the file's own header comment (line 27) explicitly documents this as intentional: *"SHARED,
  DUPLICATED CODE ... copy-pasted into BOTH html files and must stay byte-for-byte in sync."* DM Console
  has the identical pattern (its own local `compute()`/`MUT`, only auth/campaign/dm helpers bridged). So
  editing `js/engine.js`'s `MUT` alone would have been a no-op for the actual running tool — the "Engine
  first, then the tools" task ordering only holds if you also patch the tool's own copy.
- **Options:** (i) trust `AGENTS.md`'s claim and edit only `js/engine.js` (would silently produce
  non-functional "Add discipline"/"Open another tradition" buttons — engine tests would stay green while
  the live tool didn't work); (ii) **edit both `js/engine.js`'s `MUT` and Live Sheet's local `MUT`
  identically**, keeping the two byte-for-byte in sync per the file's own stated invariant; (iii) use this
  task to actually migrate Live Sheet onto a real bridge for `DATA`/`compute`/`MUT` (out of scope — that's
  a separate, larger migration essentially identical to Task 6, not something to fold into a pricing
  feature).
- **Decision:** (ii). `found` (extended to add a discipline to an already-open tradition, not just found a
  new one) and the new `dbound` setter were added to both copies in lockstep. `compute()` itself needed no
  change in either file — both copies already priced `d.bound` and iterated all traditions/disciplines
  correctly before this change (dead code, unreachable via any UI path until `found`/`dbound` could
  produce that state), which is why the original task's "Engine first... ZERO compute() change" framing
  was directionally right even though its premise about the bridge was wrong.
- **Why:** `AGENTS.md` is supposed to be the single, trustworthy source of architecture truth for any agent
  picking up a task cold — "Engine first, then the tools" only makes sense read literally if the tools
  actually consume the engine. Silently going along with the stale claim would have shipped a feature that
  passes `engine-parity.html` (which only ever imports `js/engine.js`) while doing nothing in the browser.
- **Status:** IN FORCE. `AGENTS.md`'s Architecture bullet ("Three UI-only tools... load the engine via a
  module bridge") is now known to be accurate only for `validate()` plus sync/auth/campaign/dm helpers —
  `DATA`/`compute`/`MUT`/`baseBuild`/`activeEvents`/`economy`/`foldBuild` are still copy-pasted into Live
  Sheet and DM Console exactly as CharGen's are. Correcting `AGENTS.md`'s wording, and/or actually
  finishing the bridge migration for all three tools (Task 6 currently only scopes CharGen), is filed as a
  new roadmap item rather than done here — out of scope for a spellcasting pricing feature.

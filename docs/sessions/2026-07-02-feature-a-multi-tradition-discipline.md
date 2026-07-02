# Session — 2026-07-02 · Feature A: multi-tradition/discipline spellcasting + Magically Bound

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `DECISIONS.md` (D-GH9).*

## Goal
Implement the roadmap's "Feature A" item: let Live Sheet players buy more than one tradition and more
than one discipline per tradition, and add a per-discipline "Magically Bound" toggle (+2 AP flat,
−1 spell discount from then on, one-way).

## What we did

### Discovery: `AGENTS.md`'s bridge claim doesn't hold for Live Sheet/DM Console
The roadmap task said "Engine first (extend `found`, add `dbound`)" and `AGENTS.md`'s Architecture
section says Live Sheet and DM Console already load `DATA`/`compute`/`MUT`/etc. from `js/engine.js` via a
module bridge (only CharGen is called out as still embedding its own copy, per Task 6). Direct inspection
of `tools/PACT-Live-Char-Sheet.html` showed this is false for the pricing/mutation layer: its only
`<script type="module">` block imports `validate` (from `js/engine.js`) plus sync/auth/campaign helpers.
`DATA`, `compute`, `MUT`, `activeEvents`, `economy`, `foldBuild` are separate hand-written declarations in
the same file — the file's own header comment even documents this as intentional ("SHARED, DUPLICATED
CODE ... copy-pasted into BOTH html files"). DM Console has the identical pattern. See D-GH9 for full
detail and the follow-up this implies for `AGENTS.md`/Task 6.

Practical effect: every MUT edit had to be made twice — once in `js/engine.js`, once in Live Sheet's own
copy — or the new UI buttons would have been no-ops despite `engine-parity.html` staying green (that gate
only imports `js/engine.js`).

### What was already there
Both `compute()` copies (engine.js and Live Sheet's) already fully priced multi-tradition/multi-discipline
builds and `d.bound` (Foundation/Rank per tradition, extra-discipline surcharge, per-discipline −1
discount floor 1, +2 AP flat gain) — this must have been built in anticipation of this feature. Only the
mutation layer (`found` could only create a brand-new tradition, never add a discipline to an existing
one; no `dbound` setter existed) and the UI (single-tradition/single-discipline only) were missing.

### The five/six tasks (done in one pass per the roadmap's own suggestion)
- **`found`/`dbound`** — extended in both `js/engine.js` and Live Sheet's local `MUT`. `found` now pushes
  a new discipline onto `b.traditions[ti].disciplines` when that tradition already exists, instead of only
  handling ti===0-bootstrap and brand-new-index cases. `dbound` sets `d.bound` at `{ti,di}`. Additive only
  — verified zero `compute()` diff via `engine-parity.html` (5/0 before and after).
- **`_catOf`** — moved `'Subclass spell lists'` from the `Class & subclass` bucket to `Magic`.
- **`ib()`** — tooltip (`title=`) now includes the `descr` argument, not just the warn/reason text; added a
  `descr` to Martially Bound's `ib()` call explaining the −1 discount / no-retroactive-refund behaviour.
- **`priceOf`** — `mbound`/`dbound` now return a flat `-2` instead of a full `compute()` diff. The diff
  approach was a real pre-existing bug: buying Martially/Magically Bound recomputes the *entire* build at
  the new discounted rate, so any already-owned same-class feature (or, going forward, same-discipline
  spell) silently got cheaper too — refunding more than the intended flat +2 AP. Flat-pricing avoids this;
  the ongoing −1 discount still applies correctly to purchases made *after* binding, since those go through
  their own category's normal diff pricing.
- **Spellcasting `GROUPS` closure** — rewritten to iterate every tradition and every discipline (was
  hard-coded to `b.traditions[0]`/`disciplines[0]`), with a per-discipline header, a Magically Bound
  button/owned-state, and "Add discipline: X" / "Open another tradition" buttons.
- **Campaign gating** — the add-discipline/open-tradition buttons are hidden when
  `window._cloudCampaignRules.multiDisciplineAllowed === false` (mirrors the existing `cloudRuleBarred`
  live-filter pattern from the campaign-rules follow-up; no new fetch). Closes the multi-discipline gap
  D-GH16 explicitly flagged as "not yet buildable, pending Feature A."

### Verification
- `engine-parity.html`: 5 passed / 0 failed, both immediately after the engine.js MUT change and after
  the full Live Sheet pass. No `compute()`/`DATA.version` change was needed — confirmed by an unchanged
  parity baseline.
- Manual browser pass (served the worktree via a local Python static server + the connected Chrome
  extension, since `.claude/launch.json` lives in the shared repo folder, not the worktree): founded
  Arcane/Wizard, added Sorcerer as a second discipline in the same tradition (correct extra-discipline
  surcharge, both disciplines display and price independently), bought Magically Bound on Wizard (ledger
  shows a flat `+2`, only future Wizard purchases show the discount, Sorcerer stays full price — no
  retroactive refund), and confirmed `multiDisciplineAllowed:false` hides the add/open buttons and shows
  an explanatory hint.

## Follow-ups filed (not done in this session)
- Correct `AGENTS.md`'s Architecture section (or actually finish the bridge migration for Live Sheet/DM
  Console, not just CharGen's Task 6) — see D-GH9's Status note. Output as a new roadmap item below for
  the human to fold in.

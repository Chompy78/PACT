# D-GH-2026-08-10-chargen-dm-view — a DM opens a campaign character in CharGen via a safe copy

Status: **Active**, 2026-08-10.

## Context

DM Console's roster card offered only "👁 View" (read-only, opens the Live Sheet's `?viewChar=<id>`
route). CharGen had no route at all — no `?viewChar=` handler, and the Live Sheet's "Open in CharGen"
button is hidden in its own read-only mode specifically because CharGen had no read-only concept and
would happily edit and persist another player's character. Owner, 2026-08-05: *"it's only for looking at
this stage… first step is just the view as this is most useful during start of a campaign."*

## Options

- **A — A locked, read-only view (mirroring the Live Sheet's own `VIEW_ONLY`).** Twelve mutation entry
  points (`emit`/`replacePatchSlot`/`retractFlatEvent`/`replaceWholeLogFromBuild`/
  `_cgSyncSingletonEvent`/`undo`/`redo`/`resetBuild`/local autosave/three `saveCharacter` call sites)
  would each need gating, correctly, forever — safe only by vigilance.
- **B — A fresh, freely-editable COPY under the DM's own account.** No entry-point guards at all:
  CharGen works exactly as it already does. Safe by construction — a copy with its own id structurally
  cannot touch the original no matter what CharGen does to it. Also answers a real DM question ("what if
  I gave them this boon?") a locked view cannot. (Chosen, per the owner's explicit preference,
  2026-08-05: *"Have a duplicate of the character automatically created in the background that the DM
  can look at and view as if it was their own character... there's no risk of damaging the actual
  original."*)

Two further calls the task doc left open, both decided in this session (see the conversation this
session's Q&A round, not re-litigated here): the copy is **cloud-saved** (syncs to the DM's own
character list, not local-only), and repeat views **overwrite the DM's existing copy of that source**
rather than piling up duplicates.

## Decision

**Option B.** DM Console's roster card gained a second, distinctly-labelled button — "📋 Copy to
CharGen" — beside the existing "👁 View" (Live Sheet, read-only). Clicking it opens
`PACT-CharGen-Webtool.html?viewChar=<id>` in a new tab; CharGen's own `?viewChar=` handler
(`_cgConsumeViewChar()`) then:

1. Confirms sign-in, then fetches the source via `peekCharacter()` — never `loadCharacter()`, which
   caches into localStorage with no ownership check (the exact mechanism of
   `D-GH-2026-08-02-listmycharacters-local-cache-leak`).
2. Derives a copy id via `_cgDeriveCopyId(sourceId, dmUserId)` — SHA-256 of a fixed prefix plus both
   ids, formatted as a UUID. Deterministic per **(source, viewing DM)** pair: the same DM re-opening the
   same source always lands on the same copy (overwrite-per-source, cross-device correct with no extra
   query or schema field), while two different DMs copying the same player's character get two
   independent copies. **Asserted structurally impossible to equal the source id** — the function
   refuses and alerts rather than proceeding if it ever does.
3. Applies the fetched `LOG`/`stats` into a brand-new character under that copy id, named
   `"<original name> (DM copy)"`, explicitly **not campaign-bound** (`_cgResetCloudApState()`), then
   saves it immediately via `S.saveCharacter()` — so it appears in the DM's own cloud character list
   right away, not only after the debounced autosave fires.
4. Tells the DM plainly, via a `flash()` (not a silent load): this is a snapshot as of right now, edits
   here never touch the original, and re-opening it later replaces this same copy.

The synchronous boot sequence (`_cgHadShared`) treats a pending `?viewChar=` the same as an incoming
handoff — it skips restoring this device's own local autosave/blank-character steps for that one load,
so an unrelated in-progress build doesn't flash on screen before the copy replaces it.

**Option A (the locked read-only view) was not built.** Per the owner's framing it is the retained
fallback for a DM who genuinely needs to see a character exactly as it stands rather than a
point-in-time copy — filed as a future task only if that need is actually reported, not built
speculatively alongside B.

## Why

The copy approach eliminates the entire class of bug Option A would have required permanent vigilance
against (a future edit path forgetting to check `CG_VIEW_ONLY`), at the cost of the copy being a
snapshot rather than always-live — a tradeoff the owner explicitly preferred and one the UI states
plainly rather than hides. The id-derivation scheme was chosen over a bare `genCharId()` (a fresh random
id every call) specifically to satisfy the "overwrite per source" decision without adding a database
query or a schema field: the id itself IS the lookup.

## Verification

Display/data-flow only — no `DATA.version` change (no rules move), no `js/engine.js` change. Gated in
`testing/scripts/tool-pricing-ci.mjs`:
- The collision hazard directly: `_cgDeriveCopyId` is deterministic per (source, dm) pair, distinct
  across different sources, distinct across different DMs viewing the same source, and — the one thing
  this task's own doc calls "the single thing most likely to be got wrong, and it destroys player data
  when it is" — asserted to never equal the source id, even adversarially (`dm id == char id`).
- DM Console: both buttons render with distinct labels and the correct `data-cid`; the real delegated
  click handler (not a synthetic one) opens `PACT-CharGen-Webtool.html?viewChar=<id>` for the clicked
  row's own id.

Not coverable without a live signed-in session in this environment, same limitation already documented
for other cloud-dependent CharGen paths: the full fetch→copy→save round trip through `peekCharacter()`/
`saveCharacter()` against a real campaign character. `cloud-e2e`/manual verification is the intended
coverage for that half. `testing/scripts/engine-parity-ci.mjs` and the rest of `tool-pricing-ci.mjs` are
unaffected and still report 0 failed.

## Related

- `feat/dm-edit-events` — blocked on this landing; can now proceed.
- `D-GH-2026-08-02-listmycharacters-local-cache-leak` — the `peekCharacter()`-not-`loadCharacter()`
  precedent this reuses.

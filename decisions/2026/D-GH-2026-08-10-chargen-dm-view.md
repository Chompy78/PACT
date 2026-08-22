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

## Addendum (2026-08-10, same day) — persistent header banner, not just the one-time flash

Raised in retrospective review: the only signal that a loaded character is a DM copy was the `flash()`
at open time (easy to miss/dismiss, scrolls away) and the `"(DM copy)"` suffix on the character's own
name in the header — easy to not notice if the DM isn't reading closely. Added a persistent, pinned
banner row (`#cgDmCopyBanner`) to the sticky header. First pass reused the existing `.warnbanner.warn`
(orange/advisory) palette; owner feedback (same day) preferred a colour outside the existing red/orange
issue-severity language entirely, since this isn't a build-quality signal at all — reassigning orange to
a third, unrelated meaning would have made the red/orange pair mean less everywhere else they're used.
Switched to **purple** (`#5a3d99`, white text) — matching the family of the existing `#cgInviteBanner`
just above it in the same header stack (`#3b3060`), a shade apart so the two remain visually
distinguishable if both were ever showing at once, though that's not expected in practice. Driven off
the same `" (DM copy)"` name-suffix check on every `render()`, so it reappears correctly on a later
reload of the same copy too (the suffix is stored in both the DB row's name and the envelope's own
embedded name — see step 3 above), not just at the moment the copy is first opened. No schema change, no
new stored marker — reuses the existing naming convention as the signal. Gated in `tool-pricing-ci.mjs`
(3 checks: shows for a `(DM copy)`-suffixed name at the purple background and NOT the `.warn` class,
hidden for an ordinary name, clears when the suffix is removed); `engine-parity-ci.mjs` unaffected
(display-only, no `DATA.version` change).

## Addendum (2026-08-22) — the copy's own budget math ignored the DM AP it displayed

Owner report: opening a character in CharGen via "📋 Copy to CharGen" didn't show its DM-granted AP and
read as falsely over budget. Root cause: `_cgResetCloudApState()` correctly leaves `_dmApStatus` at
`'none'` so the copy can never re-bind to the live campaign — but `_cgDmOpts()` gated `dmAp` on that
same flag, so the copy's `compute()` budget saw **0** DM AP even though `_cgConsumeViewChar()` had
already captured the source's real total in `window._cgCopySourceAp` for display. The display line
(`_apSourceHTML()`) correctly said "does not count here"; the budget math just did what it said, which
is the actual bug — a DM sandboxing a real, DM-funded character had no way to see it as not-over-budget
short of mental arithmetic.

Considered three depths (put to the owner as lettered options): **A** — do nothing, point DMs at the
already-correct "👁 View" (Live Sheet, genuinely live and read-only) instead; **B** — feed the frozen
`window._cgCopySourceAp` snapshot into `_cgDmOpts()`'s `dmAp`, so the copy's budget is correct as of
the moment it was opened, without re-binding to the campaign; **C** — the owner's own proposal, a
live-reading second/shadow campaign construct so a copy's DM AP tracks the source campaign over time.
**Chose B** — it directly fixes the reported symptom (wrong number, wrong over-budget reading) using a
value the code already captures, with no new schema, no live coupling, and no risk to the "copy can
never write back to the source" invariant this decision exists to protect. C was rejected as
disproportionate: it would mean modeling a second kind of campaign membership for what is fundamentally
a stale-snapshot display gap, and "👁 View" already exists for anyone who needs a live-accurate read
(A's role) — the two buttons are complementary (live/read-only vs. frozen/editable), not competing
fixes for the same need.

`_cgDmOpts()` now returns `{dmAp:window._cgCopySourceAp, ...}` (combined with player AP, same as the
live "active" branch) whenever `_dmApStatus` is `'none'` but a copy snapshot is present, instead of
`{dmAp:0}`. `_apSourceHTML()`'s copy-branch label/tooltip updated to state the AP now counts, that it's
a frozen snapshot (won't update if the DM awards more later), and to point at "👁 View" for an
always-live total. Deliberately does **not** also snapshot the source campaign's `ignore_player_ap`
rule or drawback cap — always combines player+DM AP, which is the common case; a DM who needs the exact
live rule should use "👁 View". Display/budget-math only, no `js/engine.js`/`DATA.version` change;
`engine-parity-ci.mjs` unaffected (52/0). Full record: `docs/sessions/2026-08-22-amble-archer-rename-and-ap-split.md`.

**Follow-up (same day) — `/code-review` caught a real regression this addendum introduced.** Two
independent review passes flagged that `window._cgCopySourceAp` is set exactly once
(`_cgConsumeViewChar()`) and cleared in only two places (`_cgResetCloudApState()`, and every load path
that calls it) — but `_cgResolveDmApStatus()`, the function the cloud-load path uses INSTEAD of
`_cgResetCloudApState()` (per its own comment: "the cloud-load handler... sets its own values right
after"), never touched it. Before this addendum that was harmless — the field was display-only. Once
`_cgDmOpts()` started reading it for real budget math, the same staleness became a correctness bug: a
DM who opened a "Copy to CharGen" sandbox, then loaded a second, unrelated, non-campaign character in
the same tab, would have that second character's budget silently inflated by the first copy's frozen
AP. Both reviews also confirmed a live regression this introduced in `tool-pricing-ci.mjs` — two
pre-existing assertions still pinned the old (0 AP, "not campaign-bound") behavior and were failing
against this branch's own diff.

Fixed: `_cgResolveDmApStatus()` now clears `_cgCopySourceAp`/`_cgCopySourceName` at its top, so any
subsequent character load (cloud load, campaign join) starts clean. Updated the two stale
`tool-pricing-ci.mjs` assertions to match the new, correct behavior, and added a third that pins the
staleness fix itself (open a copy, then simulate loading an unrelated character, assert the frozen AP
does not survive). Also fixed a now-inaccurate comment on `randomizeBuild()` that still claimed
`_cgDmOpts()` is a no-op for any non-active-campaign build (no longer true for an open DM-copy sandbox).
`tool-pricing-ci.mjs`: 163 passed / 0 failed (one unrelated pre-existing timing flake — "CharGen never
became ready for the heritage-pack check" — reproduced intermittently on this exact same code both
before and after this follow-up, confirmed unrelated by re-running). `engine-parity-ci.mjs` unaffected
(52/0).

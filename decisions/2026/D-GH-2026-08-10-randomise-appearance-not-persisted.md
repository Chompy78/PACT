# D-GH-2026-08-10-randomise-appearance-not-persisted — 🎲 Randomise all / 🪶 Auto-write never actually saved anything

Status: **Active**, 2026-08-10.

## Context

Found live: the reporting user set a description on Kaelen Dawnbreaker via CharGen's Setup-tab
"🎲 Randomise all" appearance control, switched to the Live Sheet and back, and it was gone. They
recognized the symptom from `fix/sheet-tab-appearance-not-persisted` (PR-era fix that routed the Sheet
tab's manually-typed appearance fields through the LOG instead of a tool-local scratchpad) and reported
"the bug is back."

Investigation initially chased the wrong lead — the DM-AP handoff fix shipped earlier the same day
(`D-GH-2026-08-10-dm-ap-lost-on-handoff`) touches the exact same Live Sheet ⇆ CharGen switch path, so it
was the natural first suspect. A direct database check of Kaelen's real record showed something more
alarming than a missing field: her whole log had been replaced with a freshly-seeded, mostly-blank
character (near-identical timestamps, `"Starting creation budget (0 AP)"`, a bare default build) — not a
partial data loss. That finding didn't hold up under a synthetic round-trip reproduction: a real
`writeHandoff`/`?handoff=` Live Sheet → CharGen transfer, run directly against the actual app code,
carried appearance data through correctly. The blank-character log was very likely a separate, coincidental
autosave overwrite from the concurrent AP-editing work in this session (an open tab racing a raw SQL edit),
not evidence of a code bug in the handoff itself — recorded here for completeness, not chased further, since
the ACTUAL bug (below) was confirmed independently and explains the reported symptom directly.

## Root cause

CharGen's Setup-tab appearance panel has its own randomiser, entirely separate from the Sheet tab's manual
typing (which the prior fix already covers):

- **`_rollField(field)`** — rolls one field (`gender`, `age`, `hair`, …), called either directly (the
  per-field 🎲 button, `randField()`) or in a loop by `randomiseAppearance()` (the "🎲 Randomise all"
  button).
- **`genDescription()`** — composes the "overall" paragraph from the other fields' current values, wired
  both to `randomiseAppearance()` and independently to its own "🪶 Auto-write" button.

Both set the DOM field's `.value` directly:
```js
const set=(id,v)=>{const e=$(id);if(e)e.value=v;};   // _rollField, before the fix
const e=$('ap_overall');if(e)e.value=pcs.join(' ');   // genDescription, before the fix
```
Neither dispatches an `'input'`/`'change'` event, and neither calls `_shCommitAppearanceField()` — the
function the Sheet tab's *manual* typing path uses (via its `'input'`/`'change'` listeners →
`onSheetField()` → `_shCommitAppearanceField()`) to actually write into the LOG. Setting `.value`
programmatically fires no such event on its own. The result: the randomised text renders correctly on
screen — genuinely convincing, since `readBuild()`/DOM inspection right after clicking looks completely
normal — but nothing reaches `compute()`'s or `foldBuild()`'s input at all. The first render, reload,
save, or tool switch that re-derives the sheet from the LOG shows nothing there, because there was never
anything there to show.

This is not a regression of `fix/sheet-tab-appearance-not-persisted` — it's a second, adjacent code path
(`apField()`'s Setup-tab inputs, distinct ids, no `data-mf` attribute at all) that was never brought under
the same fix when it shipped. Confirmed directly, not assumed: a CDP-driven end-to-end check showed the
DOM field populated with a full randomised paragraph immediately after `randomiseAppearance()`, while
`LOG.filter(...appearance patch...).length === 0`.

## Decision

Route both through the same commit function the manual-typing fix already established:
```js
const set=(id,v)=>{const e=$(id);if(e)e.value=v;_shCommitAppearanceField(id.slice(3),v);};   // _rollField
...
const composed=pcs.join(' ');
const e=$('ap_overall');if(e)e.value=composed;
_shCommitAppearanceField('overall',composed);   // genDescription
```
`id` is always `'ap_<field>'` in `_rollField`'s call sites, matching `_shCommitAppearanceField`'s own key
naming exactly — no new mapping needed. `_shCommitAppearanceField` already coalesces repeated calls into
ONE patch event (merging into the existing slot rather than appending a new one each time — the same
behaviour PR #364 established for manual field-by-field typing), so a `randomiseAppearance()` loop calling
it ~20 times in a row still produces a single LOG event, not twenty.

## Why here, not a broader rewrite

`_shCommitAppearanceField` already exists and is exactly the right primitive — this is a two-line change
using established infrastructure, not new design. No alternative considered: the only other shape (having
`_rollField`/`genDescription` build a full appearance object and commit it once at the end of
`randomiseAppearance()`, rather than per-field) would change the coalescing behaviour for no benefit, since
`_shCommitAppearanceField` already coalesces on the LOG side.

## Addendum (2026-08-10, pre-merge review) — the fix was correct but wasteful inside randomizeRoll()

`/code-review` (medium effort) on the PR found two real issues in how the fix interacts with
`randomizeRoll()` (the full "🎲 Random" character button), both confirmed by reading the code directly
before acting:

1. **Wasted work, not a correctness bug.** `randomizeRoll()` calls `randomiseAppearance()` while
   `_histSuspended` is true, then unconditionally rebuilds the *entire* LOG from the DOM a few lines
   later (`replaceWholeLogFromBuild(_domReadBuild())` — pre-existing code, there specifically because
   `genName()`'s DOM-only name write needs the same resync). With this fix's new per-field commits, that
   meant up to ~20 extra `_shCommitAppearanceField()` calls — each a full `fold+compute` pass over the
   in-progress build — for state the resync three lines later discards regardless. Confirmed directly:
   an instrumented count showed **28 calls** during one `randomizeRoll()` run before the fix below, all
   pure waste (the final appearance data was already correct either way, since the resync reads the same
   DOM values `_rollField` sets).
2. **A stale comment.** The resync's own comment said appearance was "straight to the DOM… no events",
   which this fix made false — left uncorrected, a future maintainer could reasonably conclude the resync
   is now redundant for appearance and remove it, silently reintroducing the original bug.

**Fix:** both `_rollField`'s `set` helper and `genDescription()`'s final commit now skip
`_shCommitAppearanceField()` while `_histSuspended` — the signal that a bulk resync governs and per-field
LOG writes would be immediately overwritten anyway (the same convention already used elsewhere for
suspended-history bulk flows). The standalone "🎲 Randomise all"/"🪶 Auto-write" buttons are **not**
inside a suspended block when clicked directly, so this guard doesn't affect their behavior at all — only
`randomizeRoll()`'s internal call is skipped. Comment at the resync call site rewritten to state the
current, accurate reason.

## Verification

`testing/scripts/tool-pricing-ci.mjs`: 3 checks — `randomiseAppearance()` writes to the LOG (not just the
DOM), coalesced into one patch event; `genDescription()`'s standalone "🪶 Auto-write" path also commits;
`randomizeRoll()` performs **zero** `_shCommitAppearanceField()` calls (spied directly) while still
producing correct final appearance data. **All three confirmed to fail without their respective fix**
(hand-verified by reverting just the fix and re-running before committing each time — the first two showed
DOM populated/LOG empty; the third showed 28 wasted calls instead of 0) and pass with it. 129/0 overall
(was 126/0). `engine-parity-ci.mjs` unaffected, 30/0 — display/commit-path only, no `DATA.version` change.

**Not independently re-verified against a live browser session** — same caveat as the DM-AP fix; the
reporting user can confirm by re-running the same randomise-then-switch-tools sequence that surfaced it.

## Related

- `fix/sheet-tab-appearance-not-persisted` — the original fix this is the missed second half of (manual
  typing was covered; the randomiser was not).
- `D-GH-2026-08-10-dm-ap-lost-on-handoff` — the initially-suspected cause, ruled out by direct
  reproduction; recorded in Context above for anyone re-investigating this class of report later.

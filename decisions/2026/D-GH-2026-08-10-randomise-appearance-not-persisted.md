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

## Verification

`testing/scripts/tool-pricing-ci.mjs`: 2 new checks — `randomiseAppearance()` writes to the LOG (not just
the DOM), coalesced into one patch event; `genDescription()`'s standalone "🪶 Auto-write" path also
commits. **Both confirmed to fail without the fix** (hand-verified by reverting just the fix and
re-running before committing — DOM showed the text, LOG match count was 0/the composed text never reached
`foldBuild()`'s output) and pass with it. 128/0 overall (was 126/0). `engine-parity-ci.mjs` unaffected,
30/0 — display/commit-path only, no `DATA.version` change.

**Not independently re-verified against a live browser session** — same caveat as the DM-AP fix; the
reporting user can confirm by re-running the same randomise-then-switch-tools sequence that surfaced it.

## Related

- `fix/sheet-tab-appearance-not-persisted` — the original fix this is the missed second half of (manual
  typing was covered; the randomiser was not).
- `D-GH-2026-08-10-dm-ap-lost-on-handoff` — the initially-suspected cause, ruled out by direct
  reproduction; recorded in Context above for anyone re-investigating this class of report later.

# D-GH-2026-08-04-archived-campaign-peek — read-only peek at an archived campaign: guard, don't hide

Status: Active

## Context

From the 2026-08-04 usability review (MEDIUM), recorded there as NOT DONE because it was a feature rather
than a defect fix. An archived campaign in DM Console offered its name and an **Unarchive** button and
nothing else, so a DM wanting to check an old campaign's roster, rules or notes had to put it back in
their active list first — mutating state purely to look at it, then remembering to archive it again.

The obvious implementation is a second, read-only view. The obvious *shortcut* is to hide the write
controls. Both are wrong for different reasons, which is what this record is about.

## Options

- **A1 — a separate read-only renderer.** A second code path that draws roster/rules/notes without any
  controls. Clean-looking, but it is a parallel implementation of the panel: every future change to the
  campaign panel has to be made twice, and the day one is forgotten the archived view silently shows
  stale or wrong information.
- **A2 — reuse `selectCampaign()`'s render path, then lock the result down.** One renderer, one set of
  markup, a flag that decides whether the controls are live.
- **A3 — A2, but hide the write controls instead of disabling and guarding them.** Cheapest diff.

**Chosen: A2, with the lock enforced in two independent places.**

## Decision

`selectCampaign(id)` now falls through to `archivedCampaigns` when the id isn't in `currentCampaigns`,
sets a module-level `peekCamp`, and renders exactly as it always did. The read-only state is then
enforced twice, on purpose:

1. **`_peekBlocks()` gates every write handler.** `setCampaignRules` (×2 — Save rules and Save notes),
   `createPlayerInvite`, `setInviteRevoked`, `setIgnorePlayerAp`, `archiveCampaign`, and the three
   roster-card writes (`awardAp`, `setCharacterDmNotes`, `unbindCharacter`). Eight call sites.
2. **`_applyPeekLock()` disables the controls** across `campOwnerTile`, `campInviteTile`, `campRulesTile`,
   `campAdvancementTile`, `dmNotesTile`, `#campRoster` and `#ruleSaveBtn`.

## Why

**Why guard AND disable, rather than either alone.** Disabling is the *visible* half and it is the half
that can be defeated — the roster replaces its own `innerHTML` on every refresh (tab focus, the Refresh
button, an award landing), so cards routinely come back enabled between renders. That is not a
hypothetical: the re-lock in `_paintRoster()` exists precisely because the paint and the lock would
otherwise drift apart. The handler guard is the half that *cannot* be defeated by a re-render, a stale
queued handler, or a devtools poke, and it is why the task said "guard the write paths, do not merely
hide them". Hiding (A3) would have left every one of those handlers live behind a `display:none`.

**Why not disable the disclosure controls.** The task's own step 2 said "every input, button and
disclosure control disabled", but disabling the `<details>` toggles would make the rules and invites
unreadable — which is the entire point of the feature. Disclosures stay usable; they are navigation, not
a write path. Deliberate deviation, recorded here rather than silently.

**Why some controls stay live.** `+ Create campaign` and the `Unarchive` buttons belong to the DM, not to
the campaign being peeked — locking the way back out would be a trap. The ⓘ buttons only `alert()` their
own `title` and are the read-only explanation of what is being looked at. Everything else, including the
Copy buttons, is locked: an archived campaign's invite codes are dead links, so copying one is a trap
worth closing too.

**Why exiting restores rather than blanket-enables.** Several of these controls carry their own disabled
state that predates the peek — `ignorePlayerAp` is disabled by its lock, buttons disable themselves
mid-request. `_applyPeekLock(false)` restores each control's recorded prior state, so leaving a peek
cannot hand back a control the rest of the UI thinks is locked.

**A banner, not just grey controls.** Greyed controls with no explanation read as "broken", not as
"deliberately locked". The banner is the explanation; the disabled attributes are the enforcement.

## Verification

`testing/scripts/dm-console-ui-e2e.mjs` grew 21 checks (44 → 73), driven through the real
`renderArchivedCampaigns()`/`selectCampaign()`/`_paintRoster()`/`renderInvites()` via a
`window._dmArchivedPeek` seam in the same shape as the existing `window._dmRulesPanel`.

**Ten mutants, all killed** — each guard removed individually, plus the disable sweep, the archived
lookup, and the roster re-lock. The forced-click checks deliberately re-enable the buttons first, so they
test the guard rather than the disabled attribute.

**The trap this nearly fell into.** Three checks initially passed whether their guard existed or not.
Playwright **auto-dismisses** dialogs, so every `confirm()`-gated handler — Archive, Remove-from-campaign,
Ignore-player-AP — took its cancel branch and never reached the RPC. Verified directly: with confirm
auto-dismissed, deleting the Archive and Ignore-AP guards left the suite green. Fixed by stubbing
`window.confirm` to `true` for the forced-click section. Two others were vacuous for a duller reason —
the offline page renders no roster cards and no invites, so there was nothing to click; both now seed
real rows through the seam first. This is the same failure mode that produced pass 1's only CRITICAL
(`docs/reviews/2026-08-04-usability-qol.md`) and it will recur — **a Playwright check on a
confirm-gated path is presumed vacuous until shown red.**

UI-only. No `DATA.version` bump (display-only, `compute()` untouched); no `BUILD` bump (feature PR, not a
promotion). `engine-parity` 24/0, `audit` 29/0, `log-fuzz` 500/500, `chargen-flows` 27/27 all unaffected.

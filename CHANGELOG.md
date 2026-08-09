# PACT — Changelog

> One line per change, **newest first**. `DATA.version` is noted only when it changed.
> This is the scannable, going-forward log; the full pre-GitHub history is in
> `docs/history/CHANGELOG-full.md`. *Why* lives in `DECISIONS.md`; the messy middle in `docs/sessions/`.

> **Format note (2026-07-28):** entries older than 2026-07-17 were rotated out to `docs/CHANGELOG-archive-2026-06-29-to-2026-07-16.md` — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`.

- **2026-08-09 · docs(tasks): remove stale `feat/creation-vs-awarded-ap` entry from `TASK_BOARD_NOW.md`** —
  picked up via `/run-code-task-jc` and found already fully shipped: the level+track selectors, the
  creation/awarded AP split, and `#budget` as a plain number input all landed 2026-08-05 (see this file's
  2026-08-05 entry and `decisions/2026/D-GH-2026-08-05-creation-vs-awarded-ap.md`); the one open question
  the board task still listed — removing `_buildEventBurst`'s blanket `noLock` tagging — was answered
  differently and closed 2026-08-06 (`D-GH-2026-08-06-creation-lock-survives-reload.md`: the owner kept
  the tagging and had CharGen append an explicit `creationLocked` event instead). No code change; the
  board entry was a stale duplicate of already-completed, already-documented work.

- **2026-08-09 · fix(chargen): drop the mobile last-row collapse toggle — leave it flat and scrolling** —
  Second follow-up to the mobile header rework: `.mobile-action-bar`'s "▴ Less"/"▾ More" collapse toggle
  (added the same day) removed. The row already scrolls horizontally to reach anything off-screen, so
  collapsing it behind a tap added a step without saving anything a scroll didn't already handle. Reverted
  to a flat single-row strip — same 7 buttons (Sheet/Live Sheet/AI Portrait/Share/Name spells/Random/Info),
  `overflow-x:auto` directly on the row, no wrapper `<div>` or toggle button. `setMobActionsCollapsed()`/
  `toggleMobileActions()` and the `pactCgMobActionsCollapsed` localStorage key removed along with it.
  `testing/scripts/chargen-flows-e2e.mjs`'s collapse-specific checks replaced with simpler ones asserting
  the toggle/wrapper are gone and the row scrolls (49 → 46 checks — fewer, but covering the actual
  current shape instead of a removed feature).

- **2026-08-09 · fix(chargen): move the mobile 🎨 Theme selector to the right side of the first row** —
  Follow-up to the mobile header rework above: 🎨 Theme moved from between Redo and 📁 Local to the last
  slot in `.hd-mobnav`, after "Jump to section", with `margin-left:auto` so it hugs the row's right edge
  on any width — mirrors the desktop header's own `.hd-theme{margin-left:auto}` pattern for the same
  control. `testing/scripts/chargen-flows-e2e.mjs`: 48 → 49 checks (added an explicit
  `.hd-mobnav.lastElementChild === themeselMobile` assertion so the position, not just the row
  membership, is covered).

- **2026-08-09 · fix(chargen): mobile header rework — Local/Cloud on the first row, collapsible last row, fixed info modal** —
  CharGen's mobile header (`.hd-mobnav`/`.mobile-action-bar`) reorganized: 📁 Local/☁ Cloud moved from
  the last row into the first row alongside Undo/Redo/Theme (their popup menus still work — both are a
  single reparented element keyed off `btn.parentElement`, not the button's row); 🎲 Random moved the
  other way, off the first row and onto the last (Sheet/Live Sheet/AI Portrait/Share/Name spells/Info).
  The last row is now collapsible — a "▴ Less"/"▾ More" toggle hides the seven action buttons down to
  just itself, reclaiming vertical space for the builder below; the choice persists per-device via
  localStorage, defaulting to expanded (unchanged behavior) until first collapsed. Fixed a real flex-shrink
  bug found while screenshotting the new layout: the buttons inside the (still horizontally-scrollable)
  action strip were shrinking and wrapping their own labels onto 2-3 lines instead of scrolling —
  `flex-shrink:0` on the strip's children was the missing piece. Also fixed the info modal (`#infoBox`):
  it had no `max-height`/`overflow`, so its content — routinely taller than a phone viewport — just ran
  off both edges of the screen with no way to scroll and no way to reach the close button. Capped the box
  at `85vh` with internal scroll, and made the close button live in a sticky `.infotop` bar (mirroring
  `.shtop`, the same pattern `#sheetview`/`#explainview`/`#portraitview` already use for this exact
  problem) so it stays reachable at any scroll position. `testing/scripts/chargen-flows-e2e.mjs`: 27 → 48
  checks (new coverage for the row swap, menu reparenting after the move, collapse/expand/persist, and
  the info modal's scroll-cap + sticky-close-button behavior at a deliberately short 390×600 viewport).

- **2026-08-09 · feat(dm-console): warnings banner for stale invites + lock the Campaign Rules panel** —
  Two DM Console additions. (1) A "⚠ Worth a look" banner above the campaign panel, computed from the
  same `_invites` fetch the invite-list panels already use: flags an outstanding (unredeemed, unrevoked)
  player or co-DM invite issued 14+ days ago, and a player invite granting 0 AP (almost always a
  forgotten "Starting tier"). Reuses `_dmInviteSettled()` for the co-DM half so "is this one done" can't
  drift from the invite-list filter. (2) The Campaign Rules + Advancement panels (bans, house rules,
  budget curve, award pace, starting tier, "copy rules from…") now land **locked by default** on every
  campaign switch, mirroring the existing `ignore_player_ap` lock (`_setIgnoreLocked`) — a new
  Locked/Unlocked button beside "Save rules" gates all the inputs in both tiles plus the Save button
  itself; a successful save always re-locks. Composes for free with the existing archived-campaign peek
  lock (`_applyPeekLock`'s remember/restore already respects whatever `disabled` state this lock leaves
  behind). `testing/scripts/dm-console-ui-e2e.mjs` extended: the pre-existing "Save rules button is
  enabled on a live campaign" check was updated for the new default-locked behavior, plus new coverage
  for lock/unlock/re-lock and for the warnings banner (stale/fresh/settled/0-AP/exhausted-reusable
  cases) — 79 → 88 checks, all passing.

- **2026-08-09 · fix(security): harden the invitation system — close a live privilege-escalation bug** —
  `D-GH-2026-08-09-harden-invitation-system`. `campaigns.dm_invite_code` was readable by any campaign
  member and redeemable by any authenticated account system-wide, with no membership check and no rate
  limiting — a confirmed live bug (production data showed it was never actually exploited). Dropped
  `dm_invite_code`/`join_as_dm()`/`regenerate_dm_invite_code()` outright and unified co-DM invites onto
  the existing hardened player-invite model (`campaign_invites`, extended with `type`/`mode`/
  `redeemed_count`/`max_redemptions`; new `create_dm_invite()`/`redeem_dm_invite()`, hash-only token
  storage, single-use by default with reusable as an explicit DM opt-in). Player-invite tokens
  deliberately stay plaintext (unlike DM invites) since DM Console's invite list re-displays them — see
  the decision record for why. Went through a 6-reviewer cross-vendor cold review before implementation.
  New "Invite a co-DM" panel and "Join as co-DM" redemption row in DM Console replace the old static
  code display — also closes the previously-separate "Wire up joinAsDm()" task. `testing/scripts/
  audit.py`'s live RLS proof extended with 3 new adversarial checks. `DATA.version` unchanged (no rules
  logic touched); `engine-parity` 29/0, `dm-console-ui-e2e` 79/79, `audit.py --rls` 0 failed.
- **2026-08-08 · chore(agents): delete the 8 custom commands in `.claude/commands/` now superseded by identically-named skills** —
  `add-code-task`, `cleanup-code-branches`, `close-code-session`, `log-code-lesson`,
  `make-code-cold-plan-review`, `pick-code-task`, `run-code-task`, `sweep-code-tasks` all now exist as
  skills; the old command files were stale duplicates. Removed the files (and the now-empty
  `.claude/commands/` dir); no other project files changed.
- **2026-08-08 · docs(ui): CharGen — rewrite the Info panel, it described a flow removed months ago** —
  `D-GH-2026-08-08-chargen-header-followup-2` addendum. The "Sending to the Live Sheet" section still
  described the pre-D-GH40 export/converter flow — "click ⇆ Live Sheet, downloads a `-livesheet.json`
  file, Open the Live Sheet and use ⬆ Import" — a mechanism that no longer exists; the actual current
  button (⇆ Open in Live Sheet) does a one-click same-origin handoff with no file at all. "Saving your
  build" only mentioned the standalone Save/Load buttons this session's own header changes had already
  moved into the 📁 Local menu, and never mentioned ☁ Cloud at all — sign-in, autosave, cloud save/load,
  or campaign join. "Other outputs" listed one button (Sheet) out of four, a gap traced to a 2026-08-03
  HTML-truncation bug fix (D-GH-2026-08-03-sw-cache-e2e) that deliberately didn't guess at the original
  lost sentence — but never came back to document the other three buttons (AI Portrait, Share, Name
  spells) with new, accurate text either. Rewrote all three sections to match the current header exactly:
  Local vs. Cloud menus (with the New Character / Autosave / My Characters / campaign-join wording),
  Share + the real Open-in-Live-Sheet handoff, and the full Other-outputs list. Verified with DOM-text
  assertions (no screenshots): the stale `-livesheet.json`/Import wording is gone, and every current
  header feature (Local, Cloud, New Character, Autosave, My Characters, campaign, Open in Live Sheet, AI
  Portrait, Name spells, Sheet, Share) is now mentioned. `engine-parity` 29/0, `audit.py` 0 failed —
  docs-only, no `compute()`/rules involvement, no `DATA.version` change.

- **2026-08-08 · feat(ui): CharGen — mobile Local menu, version numbers visible in the Info panel** —
  `D-GH-2026-08-08-chargen-header-followup-2`. (1) Mobile had a Cloud dropdown (previous fix) but no
  equivalent for local actions — New Character lived alone in `.hd-mobnav`, Save/Load alone in
  `.mobile-action-bar`, none of them consolidated the way desktop's 📁 Local menu is. Added
  `#cgLocalBtnM` to `.mobile-action-bar`, reusing the same reparent-the-one-menu-element technique (and
  its "reparenting always shows the menu at its new location" fix) already proven for the mobile ☁ Cloud
  button, rather than duplicating `#cgLocalMenu`'s markup — removed the now-redundant standalone New/
  Save/Load buttons. (2) The header's "Web Tool · vX" / "PACT rules · vX" labels are `display:none`
  below 1150px, and `.hd-row2` itself is `display:none` below 768px — mobile had no way to see either
  version number at all. Added a line to the Info panel that copies the two header spans' live text
  (not hand-duplicated strings — one source of truth, no third place for `audit.py`'s version-mirror
  check to need updating). Verified with DOM-state assertions (rects/classList/textContent, no
  screenshots this round per instruction): mobile Local menu opens with real content, New Character from
  it mints a different id, a mobile→desktop resize round-trip re-opens correctly, and the Info panel's
  version line reads correctly on both mobile and desktop. `engine-parity` 29/0, `audit.py` 0 failed. No
  `compute()`/rules involvement, no `DATA.version` change.

- **2026-08-08 · fix(ui): CharGen — header no longer wraps on common laptop widths, mobile gets cloud
  access, New Character also offered from the ☁ Cloud menu** — `D-GH-2026-08-08-chargen-header-followup`,
  the owner's review of the local/cloud split found three real gaps, confirmed with real-browser
  screenshots at each width (not assumed): (1) `.hd-row2` overflowed and wrapped the theme selector onto
  its own line at ~1024-1150px, a very common laptop/half-screen width — fixed by hiding the two
  least-critical text labels ("Web Tool · vX" / "PACT rules · vX", both readable elsewhere) below 1150px,
  verified holding a single line down to 900px. (2) Mobile had **zero** cloud access — `.hd-row2`
  (where the cloud menu lives) is `display:none` below 768px, so a hidden ancestor hid the menu
  regardless of any new trigger button. Fixed by reparenting the ONE `#cgCloudMenu` element into
  whichever button's wrapper (desktop `#cgCloudBtn` or new mobile `#cgCloudBtnM`) triggered it, rather
  than duplicating the whole rich menu (auth state / campaign join / character list — real ID-collision
  risk across two DOM copies); also fixed `.mobile-action-bar`'s `overflow-x:auto` implicitly clipping
  the dropdown vertically too (the CSS overflow spec ties both axes together once either leaves
  `visible`) with an explicit `overflow-y:visible`. A same-session resize-without-closing edge case
  (open on mobile, resize to desktop, click the desktop trigger) was caught by an actual round-trip
  headless test and fixed: reparenting now always shows the menu at its new location instead of
  toggling it closed. (3) "🆕 New Character" is now offered from the ☁ Cloud menu too (previously only
  in 📁 Local) — it flushes a pending *cloud* autosave before detaching, so it's as much a cloud action
  as a local one. Verified: `engine-parity` 29/0, `audit.py` 0 failed, headless-Chromium checks at
  1024px/900px/1151px (no wrap) and a mobile→desktop→mobile menu round-trip. No `compute()`/rules
  involvement, no `DATA.version` change.

- **2026-08-08 · feat(ui): CharGen — split header into 📁 Local / ☁ Cloud menus, relabel Reset as 🆕 New
  Character, fix a debounce-redirect data-loss edge case** — `D-GH-2026-08-08-chargen-local-cloud-split-
  new-character`, a follow-up to the header declutter below after the owner reviewed the result: cloud
  actions still sat behind an unlabeled "⋯" while local Save/Load were loose buttons in the row below.
  New "📁 Local" dropdown (New Character/Save/Load) sits beside a re-labeled "☁ Cloud" dropdown on the
  same header row. Also traced "the reset doesn't really work as intended" to its root cause: Reset
  already silently minted a fresh character id on every use (never overwrites the character you had
  open, just detaches from it with zero indication) — relabeled to "🆕 New Character" with honest confirm
  text instead of building new in-place-wipe behavior. Fixed a real bug found while tracing this: a
  still-pending cloud autosave for the outgoing character could get silently redirected to the new blank
  character's id if its 3s debounce timer hadn't fired yet — now flushed first, the same mechanism
  `switchToLiveSheet()` already uses before navigating. Verified: `engine-parity` 29/0, `audit.py` 0
  failed, headless-Chromium smoke pass (menu open/close, New Character mints a different id, Save/Load
  still work, mobile nav shows "New" not "Reset"). No `compute()`/rules involvement, no `DATA.version`
  change.

- **2026-08-08 · feat(ui): header declutter across all three tools — remove redundant status text,
  move Autosave into the cloud menu, move "Last edited" into the info panel** —
  `D-GH-2026-08-08-header-declutter`, the closing follow-up to
  `docs/plans/2026-08-08-header-simplification-universal-autosave.md` (Part A/B are both shipped;
  this is the header-space cleanup that plan's own goal called for). (1) CharGen's `cgCloudStatus` /
  Live Sheet's `cloudStatusBadge` badges no longer show "Local only" / "Signed in — no campaign
  selected" — both states duplicated other header elements already visible (the sign-in link/campaign
  `<select>`, and the sync chip's own "🔒 Signed out" / "☁ Signed in" text); the badge now shows ONLY
  what nothing else says — a bound campaign's name/rules-fetch state. (2) The Autosave toggle moved
  from a persistent header chip into the ☁/⋯ cloud menu as a settings item — it's set-once-and-forget,
  not a live status, so it no longer competes with the sync chip and campaign controls for header
  space; same element ids (`cgAutosaveChk`/`lsAutosaveChk`) so the existing gate/toggle-handler code
  needed no changes. (3) The `.lastedited` span (the tool file's own last-modified date) moved out of
  the header into each tool's Info panel (CharGen/Live Sheet) or footnote (DM Console, which has no
  info modal) — freeing header space on every screen size, not just the mobile-only hide it had before.
  DM Console's copy had never actually been live (no `document.lastModified` script existed for it,
  unlike the other two tools) — fixed in passing rather than relocating stale hardcoded text. Verified
  with a real headless-Chromium smoke pass (populated timestamps, hidden redundant badges, cloud menus
  still open/render correctly) in addition to `engine-parity` 29/0 and `audit.py` 0 failed — no
  `compute()`/rules involvement, no `DATA.version` change.

- **2026-08-08 · fix(sync): two real bugs in `setAutosaveEnabled()`, caught by `/code-review ultra`
  before merge** — the B3 branch's own PR-template checklist calls for an ultra review on any change
  touching `sql/`; it found what regular verification hadn't. (1) `characters.updated_at` is bumped by
  an unconditional `BEFORE UPDATE` trigger even for an update that only touches `autosave_enabled` —
  without re-pinning `base_updated_at`/`_pageBase` to the trigger's new value, the same page's very next
  real save was refused as a false "changed on another device" conflict, caused by nothing but flipping
  the toggle. (2) Toggling autosave on a character with no local cache yet (a brand-new, never-saved
  build) silently no-opped — the user's explicit choice was discarded, not merely delayed, and the
  toggle UI would visibly snap back to checked. Both fixed; the failure-path rollback also needed a
  follow-up fix so a failed write on a never-cached character removes the placeholder record instead of
  leaving a phantom unconfirmed value. Both verified with a differential repro (fails on the pre-fix
  commit, passes on the fix) promoted into a permanent gate,
  `testing/scripts/sync-autosave-toggle-ci.mjs` (4/0, plus `sync-state-machine` 21/0, `sync-concurrency`
  12/0, `engine-parity` 29/0 all still clean). Two more findings from the same review — in
  **pre-existing** push-overlap machinery, one already shipped in CharGen before this branch, freshly
  (and faithfully) replicated into Live Sheet's new B3 scaffolding — were logged to
  `docs/TASK_BOARD_NEXT.md` rather than fixed here: they're bounded (local data isn't lost, only cloud
  sync can lag) and deserve their own scoped fix, not scope creep onto this branch. See
  `docs/plans/2026-08-08-shared-sync-chip-part-b.md`'s B3 implementation note. No `DATA.version` change.

- **2026-08-08 · feat(sync): universal cloud autosave with a per-character owner-reversible toggle**
  — Part B3 of `docs/plans/2026-08-08-shared-sync-chip-part-b.md`, implementing the C2 design decision
  (see `decisions/2026/D-GH-2026-08-08-universal-autosave-toggle.md`): every signed-in character now
  autosaves to the cloud by default, campaign-bound or not, governed by one `characters.autosave_enabled`
  boolean (default `true`) any owner can flip at any time via a new checkbox next to the sync chip in
  both editor tools. No RPC — a plain column grant under the existing owner-only `characters_update`/
  `characters_insert` row policies, mirroring `archived_at`'s precedent (unlike `award_ap()`, the writer
  here is always the row's own owner, so `award_ap`'s SECURITY DEFINER pattern doesn't apply). CharGen's
  autosave gate (`_cgCloudAutosave`/`_cgFlushCloudSaveNow`/pagehide) had its old campaign-bound-only
  check replaced outright, including a stale header comment that would otherwise have contradicted the
  code beneath it. Live Sheet gets cloud autosave for the first time — previously ☁ Save to cloud was
  its only cloud write path — mirroring CharGen's debounce/overlap-guard/keepalive-on-exit pattern
  exactly, plus an awaited flush before `switchToCharGen()`'s cross-tool navigation (same bug class as
  D-GH-2026-08-08-chargen-cloud-autosave-flush). Two real bugs caught before commit: (1) the same
  `_session`-is-private-to-a-different-closure mistake B2 already made once, this time in the toggle's
  enable/disable logic — fixed with a `window._lsSignedIn` boolean mirror, matching CharGen's existing
  `window._cloudSignedIn`; (2) `setAutosaveEnabled()` would have thrown a misleading "may have been
  deleted" error the first time anyone toggled autosave on a character never yet cloud-saved (zero rows
  matched because the row didn't exist yet, not because anything was wrong) — fixed with an existence
  check, plus carrying the toggle value through `pushCharacter()`'s first INSERT so a pre-save choice
  isn't silently discarded back to the default. Deliberately NOT done: the write-volume budget (no live
  traffic data available to measure against in this environment); DM Console's roster does not yet
  surface a character's toggle state (open follow-up, not required for B3's own done-when bar).
  **Migration applied to the live database on explicit owner confirmation** (same day) — verified
  post-apply: column exists as `boolean not null default true`; all 16 pre-existing characters read
  `true` (none silently flipped `false`); `authenticated` holds INSERT/SELECT/UPDATE on the column;
  `get_advisors(security)` showed no new finding attributable to this change.
  `testing/tests/engine-parity.html` 29/0, `tool-pricing` 67/0, `sync-state-machine` 21/0,
  `sync-concurrency` 12/0 — confirmed, not assumed unaffected. No live-browser visual verification was
  possible in this environment. No `DATA.version` change.
- **2026-08-08 · feat(sync): a shared cloud-sync status chip in all three tools, wired to the real
  state machine** — Part B2 of `docs/plans/2026-08-08-shared-sync-chip-part-b.md`, built on B1's
  `getSyncState`/`noteEdit`/`checkFreshness` (same day, earlier). New `chipPresentation()` in
  `js/sync.js` is the one place all three tools' icon/label/tone/aria-label for the six sync states come
  from, so the wording can't drift between copies. **Deviates from the plan's original "replace, don't
  add" framing**: reading the actual code found `cgCloudStatus`/`cloudStatusBadge` are dual-purpose
  (sign-in state AND campaign-rules-binding status), so replacing them would have been a real
  information loss — the new chip (`#cgSyncChip`, `#lsSyncChip`, class `synchip`) is additive instead,
  the lowest-risk default since the owner didn't weigh in when asked mid-implementation. `noteEdit()` is
  now actually wired into both editor tools' edit paths (CharGen's `_cgAutosave()`, Live Sheet's
  `save()`) and `checkFreshness()` fires on `visibilitychange`/`focus` in both, self-throttled. The
  `conflict` state reuses the existing `onBehind` confirm-and-reload primitive in both tools rather than
  a new "force sync" control (the prior plan review found that label actively misleading against the
  existing stale-save guard) — its wording now also points at the already-shipped ⬇ Export as a
  keep-a-copy-first step before the destructive reload. CharGen's `☁ Cloud` button is visually
  de-emphasized (shrunk to `⋯`) with the chip as the primary status element; **Live Sheet's stays
  undemoted** — it has no autosave until B3, so demoting its only cloud-save path now would have been a
  real regression, a correction a prior review round caught in v1 of this plan. DM Console gets the
  shared icon/aria-label vocabulary applied to its existing `#campWho` (kept as one text element, not
  given a separate chip — it usefully shows the signed-in email, which the editor-tool chip doesn't);
  its three write paths' own feedback (`award-status`, `dm-notes-status`) were checked, not assumed —
  `dm-notes-save` already has full Saving/Saved/Error text, `awardAp`'s success is shown via the
  immediate roster re-render (an explicit flash would just be overwritten by it), `unbindCharacter`'s
  card disappearing is its own confirmation — no changes needed there. Chip surfaces use `textContent`
  only, never a dynamic name (the mapping function's contract is fixed-enum-in, nothing dynamic to
  escape). Folds in and removes the now-superseded `docs/TASK_BOARD_NEXT.md` entry "Consistent, obvious
  sign-in indicator across the three tools." One real bug caught before commit: Live Sheet's freshness-
  check wiring initially referenced `_session`, private to a different script closure — would have
  silently no-op'd forever inside a swallowing `try/catch`; fixed by relying on `checkFreshness()`'s own
  internal signed-in guard instead. `testing/tests/engine-parity.html` 29/0, `tool-pricing` 67/0,
  `sync-state-machine` 21/0, `sync-concurrency` 12/0 — all confirmed, not assumed unaffected. No live-
  browser visual verification was possible in this environment; see the plan doc's B2 implementation
  note for what a manual pass should still check. No `DATA.version` change. Same branch-pinning
  deviation as Part A/B1 (implemented directly on this session's designated branch).

- **2026-08-08 · feat(sync): a real sync-state machine in js/sync.js — getSyncState/noteEdit/
  checkFreshness** — Part B1 of `docs/plans/2026-08-08-shared-sync-chip-part-b.md` (the shared cloud-sync
  status chip work), split out as pure sync-layer plumbing with no UI change yet. Adds six exported states
  (`signedOut > saving > conflict > behind > dirty > idle`, highest precedence first) via
  `getSyncState(id)`. Closes the 3-second debounce blind window a cold-review round confirmed: local
  autosave never touched `dirty` until a push actually fired, so a naive status read would report "all
  synced" for several seconds after a real edit. Fixed with two monotonic counters instead of a boolean —
  `editSeq` (bumped synchronously by the new `noteEdit()`, meant to be called at edit time, not
  debounce-fire time) and `savedSeq` (stamped with whatever `editSeq` a push captured *at push-start*,
  advanced only via `Math.max`) — `hasUnsavedEdits = dirty || editSeq > savedSeq` is race-safe against an
  edit landing while an earlier push for the same character is still in flight. **Found and fixed a real
  bug while writing the differential test for exactly this race**: `applyServerMeta()`'s final `lsSet(rec)`
  wrote back the *whole* in-memory record captured at push-start, silently overwriting a concurrently
  higher `editSeq`/`savedSeq` some other push or `noteEdit()` had already advanced in localStorage — the
  same failure class the counters exist to prevent, reintroduced one layer down. Fixed by merging against
  the currently-persisted values via `Math.max`, not just against the in-memory record's own copies. Also
  adds read-only `checkFreshness(id)` (deliberately separate from `reconcile()`, which mutates) for a
  persisted `behind` flag with real clear conditions — including the one a single reviewer caught and the
  other four missed: `reconcile()`'s own silent adopt-at-boot branches (both of them) now clear `behind`
  too, via a new shared `markInSyncWithServer()` helper, so a stale "cloud moved on" warning can't outlive
  a background auto-resolve. A failed freshness check never touches the persisted `behind` value — only a
  page-lifetime `lastCheckFailed` marker, decorating whichever of the 6 states is showing rather than
  growing a 7th. New standalone gate `testing/scripts/sync-state-machine-ci.mjs` (21 passed / 0 failed,
  differential on the editSeq/savedSeq race) — not yet wired into CI, same as `sync-concurrency-ci.mjs`.
  **Also fixed `sync-concurrency-ci.mjs` itself**, found broken by this session's own Part A change
  (`withKeepalive` added to `js/sync.js`'s import line 2026-08-08 earlier today, never re-run against this
  script since it isn't CI-wired) — now 12/0. `noteEdit()` isn't wired into any tool yet (that's Part
  B2/B3); this branch is sync-layer only. `testing/tests/engine-parity.html` 29/0, `tool-pricing` 67/0,
  both unaffected by design. No `DATA.version` change. Implemented directly on this session's designated
  branch rather than a fresh `feat/sync-state-machine` branch, per the harness's branch-pinning rule for
  this session (see the same deviation noted for Part A).

- **2026-08-08 · fix(chargen): a debounced cloud-autosave push no longer gets silently abandoned by
  navigation** — `_cgCloudAutosave()` only ever *scheduled* a push 3s after the last edit; nothing flushed
  a pending timer on navigation. CharGen's own "Open in Live Sheet" button (`switchToLiveSheet()`) walked
  straight into this: it called `_cgAutosave()` (re-arming a fresh 3000ms cloud-push timer) and then
  navigated away in the same breath, guaranteeing that queued push never fired — the last few seconds of
  edits before every tool switch silently never reached the cloud. `switchToLiveSheet()` now **awaits** a
  bounded flush (`_cgFlushCloudSaveNow`, 2.5s timeout) before navigating, so the in-app switch is a real
  guarantee, not a best-effort. Plain tab/browser close gets a best-effort `pagehide` flush using
  `fetch(...,{keepalive:true})` (new `withKeepalive()` in `js/supabase-client.js`, re-exported from
  `js/sync.js`) — `sendBeacon` was considered and rejected because it can't carry the Authorization/apikey
  headers an authenticated Supabase write needs. Page-lifecycle delivery is inherently best-effort on every
  browser/OS regardless of transport, so this is documented as such rather than claimed as a guarantee; the
  durable fallback for that case remains the local autosave (already written) plus the record's `dirty`
  flag retrying on this browser's next boot/reconnect. `_cgCloudPush()` now tracks its in-flight promise so
  a flush can await an already-running push instead of firing a duplicate or resolving early.
  Found and scoped while cold-reviewing a larger header-simplification/universal-autosave plan (4 models,
  2 vendor families — see `docs/plans/2026-08-08-header-simplification-universal-autosave.md`); this fix
  is split out as its own small, low-risk change (Part A) rather than folded into that larger, still-open
  design. `testing/tests/engine-parity.html` 29/0, `tool-pricing` 67/0, both unaffected by design (no
  rules-engine involvement). No `DATA.version` change.

- **2026-08-06 · fix(chargen): undo no longer un-locks a locked character, or reorders its purchases** —
  a regression from the same day's creation-lock work, found by asking whether the ordering problem was
  *"just randomize"*. It wasn't. `restoreFrame()` (undo/redo) restored the frame's LOG and then called
  `applyBuild(foldBuild(LOG))`, which **rebuilds the LOG from the DOM** by design under D5. The DOM has no
  control representing a `creationLocked` event, so the rebuild silently dropped it — **one undo unlocked
  a locked character** — and re-emitted the purchases in canonical rather than click order. Measured on
  six raises bought as CHA, WIS, INT, CON, DEX, STR: an undo→redo round-trip moved the creation boundary
  from **4 purchases to 6**, so two that had been priced post-lock became creation-priced. `restoreFrame()`
  now reinstates the frame's LOG verbatim after letting `applyBuild()` repaint, **superseding D5's
  DOM-rebuild default for undo/redo only** — the same call `_cgApplyEnvelope()` already makes, because
  applyBuild's DOM re-derivation diverges on anything the DOM cannot represent. Confirmed red against the
  reverted line. Display/state only; `DATA.version` unmoved.
- **2026-08-06 · fix(sync): a cloud save is refused if another device wrote first, instead of silently
  overwriting it** — `pushCharacter()` used a bare `.update(...).eq('id', …)` with **no concurrency guard
  at all**, and the entire event log lives in the `stats` blob — so the later writer replaced the earlier
  writer's whole history. Two devices on one character destroyed each other with no warning. Now guarded
  on `characters.updated_at`, which a BEFORE UPDATE trigger already maintains server-side, so nothing
  needs writing client-side. The fiddly part is that the client didn't *keep* the server's value:
  `saveCharacter()` stamps `updated_at` with the local clock on every edit, so a guard against it would
  never match and every save would look like a conflict. Added `base_updated_at`, holding the last value
  the server confirmed, carried across local edits and never re-stamped. **Two holes found in my own fix
  while auditing:** `reconcile()` adopts a server row with `lsSet({...server})` in two places, neither of
  which set `base_updated_at` — so the *first* save after a fresh load ran unguarded, which is exactly the
  two-device case. Both now stamp it. Zero rows updated no longer means one thing: an existence check
  tells "row not there yet, insert" apart from "someone wrote first, conflict", since inserting in the
  second case would collide on the primary key. A conflict returns `{synced:false, conflict:true}`, keeps
  the local edit and leaves the record dirty; the Live Sheet offers a reload, and CharGen's silent
  keystroke autosave breaks its silence **once** for this one outcome, because unlike an offline blip it
  will never resolve by retrying. A record with no known base value still saves exactly as it does today.
  **Not covered by any automated gate — the dependency-free suite cannot reach a signed-in Supabase
  session, so this needs the two-tab check in the PR before it merges.** No schema change; `DATA.version`
  unmoved.
- **2026-08-07 · chore(release): `BUILD` → `v1.378` (PR #378)** — promotion of `preview` → `main`, three
  commits under one theme: a character can no longer be lost quietly. Ships the `character_backups`
  trigger, the off-site Export backup button and its staleness warning, the offline ownership check, and
  the stale-cloud-save guard together with its recovery path and a new gate that reaches it. Major
  carried forward at `1` — per `docs/VERSION-SYNC.md` that is a named human decision, never inferred from
  the size of a promotion. Merged with a **regular merge commit, not a squash**: squashing a promotion
  severs the shared history between `preview` and `main`, so the next promotion's 3-way merge falls back
  to a stale ancestor (this happened for real between #293 and #294). `DATA.version` stays **v0.341** —
  nothing here changes `compute()` output. Mirrors synced in `js/engine.js` (source of truth), CharGen
  (line-1 comment, `<title>`, header `.sub`), Live Sheet (line-1 comment) and DM Console
  (`TOOL_VERSION`); `index.html` reads `BUILD` live and was not touched. All 10 CI checks green —
  `pricing` failed once with `fetch failed` on a **docs-only commit**, which is what identified it as an
  environment flake rather than a defect, and it passed on re-run. Tagging `main` as `v1.378` is still
  outstanding: tag/release pushes get a hard 403 from a cloud session.
- **2026-08-07 · fix(sync): ☁ Cloud → Load can finally recover a copy that is behind (DD1)** — completes
  the conflict story. `reconcile()` no longer swallows a refused push as "retry later": a refused push can
  *never* succeed, because the server has moved and this copy's base never will, so it now reports
  `{behind:true}`. `loadCharacter(id, {onBehind})` asks the caller before doing anything destructive, and
  only on an explicit yes discards the local copy and takes the server's. Both tools' single explicit-Load
  path (`loadCloudChar()`) supplies that prompt, naming the character and warning that unsaved local work
  is lost. **Omitting the callback leaves behaviour unchanged**, so background callers — `syncAll()`,
  campaign-rules refresh — can never silently discard work. This makes the conflict alert added earlier
  today truthful: it tells the user to use Cloud → Load, and Cloud → Load now works. Gate back to green at
  **12 passed / 0 failed**, with two new checks: a plain re-load keeps the local copy, and the caller is
  asked before anything is discarded. Both tools boot headless with 0 console errors; `engine-parity`
  29/0, `tool-pricing` 67/0. No `DATA.version` change.
- **2026-08-07 · test(sync): make the concurrency harness use real timestamps — and it immediately caught
  a second, unfixed defect** — the harness stubbed server times as `'T1'`/`'T2'`. `Date.parse` turns those
  into `NaN`, so `isNewerInstant()` always returned false, `reconcile()` always took its adopt branch, and
  the "recovers after re-loading" check passed for entirely the wrong reason. With real ISO instants it
  fails, correctly: **after a refused save, ☁ Cloud → Load cannot recover.** The local record is dirty and
  newer, so `reconcile()` takes its *push* branch, the guard refuses that push, `catch { /* retry later */ }`
  swallows it, and `loadCharacter()` returns the stale **local** record — so Load hands back your own copy,
  never the cloud's. The page can neither save nor recover, and the conflict dialog added earlier today
  points the user at exactly that control. This is the root cause of the original report that two browser
  profiles kept showing different states. **The gate is deliberately left red** (9 passed / 1 failed): a
  green gate here would be a lie, and the non-zero exit correctly blocks the branch until the recovery path
  is fixed. Not wired into CI, so nothing else breaks. No `DATA.version` change.
- **2026-08-07 · fix(sync): the stale-save guard now travels with the copy the page is holding** — the
  guard shipped on this branch could be defeated, and was, in production: a character went **43 AP spent
  → 47 → back to 43** across two separate Edge profiles with the guard active throughout. `initSync()`
  runs `syncAll()` on every page load and reconnect; `reconcile()`'s adopt branch refreshed
  `base_updated_at` **in localStorage**, while the still-open tool page held an older in-memory build it
  had no way to update. The next save then presented a *fresh base with stale content*, the guard
  matched, and the newer version was silently overwritten — worse than no guard, because it looked like
  one. (The branch's own earlier fix, stamping `base_updated_at` at those adopt sites, is what opened
  this.) The base is now pinned per **page** in memory — written only by `loadCharacter()` and by this
  page's own successful push, never by a background `reconcile()` — so storage can refresh freely without
  arming a stale page. New gate `testing/scripts/sync-concurrency-ci.mjs` (**10 passed / 0 failed**)
  replays the exact production sequence; it is *differential*, failing unless the bug still reproduces
  against a reverted copy, so it cannot pass vacuously. This closes the "no automated gate can reach
  this" gap the branch shipped with. No `DATA.version` change.
- **2026-08-07 · fix(chargen): a save conflict no longer reports itself as "Save failed"** — found by the
  manual two-tab check that `feat/sync-stale-save` requires. Of the three save paths, only two handled
  `res.conflict`: the Live Sheet's manual save and CharGen's autosave. CharGen's **manual** ☁ Save to
  cloud fell through to `throw res.error` and reported the conflict via the generic
  `alert('Save failed: …')` — untrue, and the most damaging thing that path could say. The save to the
  device succeeded; only the cloud push was refused, and the record stays dirty so nothing is lost. A
  player told "Save failed" reasonably concludes their work is gone and redoes it, or never learns
  another device is ahead. Deliberately **not** a copy of the Live Sheet's `confirm()` + `location.reload()`:
  CharGen boots from its local autosave (`_cgRestoreAutosave`), so a reload restores this device's build,
  not the other device's — offering one would be a lie in this tool. It points at ☁ Cloud → Load, which
  actually fetches from the cloud, and restores the button itself since the shared reset sits after the
  try/catch. Verified against the extracted function: conflict alerts correctly and re-enables the button,
  a genuine error still reports "Save failed", the success path is unchanged; CharGen boots with 0 console
  errors. No `DATA.version` change.
- **2026-08-07 · docs(sql): `sql/full-backup.sql` — the whole-database backup runbook** — completes the
  backup story with the one mechanism that sees everything, run from the Supabase dashboard rather than
  the app. Two forms: a per-character query that downloads as CSV with each `envelope` cell a loadable
  `pact-character/1` document, and a single-JSON bundle for archival. Documents who can run it and why
  nobody else can — `characters_select` caps any client at `owner_id = auth.uid() or
  is_campaign_dm(campaign_id)`, so even an account DMing every campaign reaches 6 of 15 — and records
  that an in-app admin backup was requested, considered and rejected rather than left unexplained (see
  the decision record's Addendum 2: a client-side allowlist can't do it, doing it properly means
  inventing the admin role this project deliberately lacks, and it would grant no new capability, only
  a weaker route to one `service_role` already has). Deliberately excludes `character_backups` and
  points at that migration's existing restore recipes instead of duplicating them. Both queries were
  executed against production before committing: Query A returns 15 rows, all restorable, all with
  owner emails; Query B a well-formed 101,676-char bundle. A `docs/HOW-TO-WORK.md` table now sets the
  three mechanisms side by side so they don't get mistaken for each other. No `DATA.version` change.
- **2026-08-07 · fix(sync): apply the ownership check on the offline character list too** —
  `listMyCharacters()`'s online branch filters `.eq('owner_id', …)` because `characters_select` also
  grants a DM read access to every character in campaigns they run; the offline branch made no such
  check, so "My Characters" meant something different depending on connectivity. It could not simply
  reuse the online branch's `dirty` test — offline, `dirty:false` is the normal resting state of the
  user's *own* synced characters, so that would have emptied the list of everything except unpushed
  work. Instead `reconcile()` now caches `owner_id` and the offline branch drops records positively
  known to belong to someone else, keeping unmarked ones (local-only, or cached before this change;
  they self-heal on the next reconcile). Previously latent — every path that could cache a foreign
  character is separately guarded — but it was the missing last line under a feature that now writes
  characters to a downloadable file. Verified headless against the real `sync.js`: a foreign record is
  dropped while own-synced, own-unpushed, local-only and legacy-unmarked records all survive.
  No `DATA.version` change.
- **2026-08-07 · feat(characters): warn when the backup is stale; scheduled-backup Routine deleted** —
  the weekly agent-run Routine was abandoned for good (it cannot carry its own connectors, and the
  bundle would have to pass through a model context it already exceeds), so the export is a manual
  act. Since the original failure was *nobody remembered*, My Characters now records the last
  successful export and shows a red warning bar — and turns the export button red — when it is 7+ days
  old or has never happened; fresh state is a quiet grey line so "you're covered" never competes for
  attention with "you're not". Tracked per browser, not per account, on purpose: the file sits on one
  device's disk, so an account-wide flag would let a desktop export silence a phone holding no copy.
  A localStorage read failure counts as "never exported" — every tie breaks toward the warning. An
  export where every character turns out to be unsaved now refuses to produce an empty file or reset
  the clock. Verified headless across never/20d/7d-boundary/2d/today plus a real export resetting
  stale→fresh. No `DATA.version` change.
- **2026-08-07 · feat(characters): "Export backup" on My Characters — the off-site half of the backup
  story** — the `character_backups` trigger (same date) is a safety net that lives in the *same
  database as the thing it protects* and is readable only from the Supabase dashboard. This is the
  copy the user holds, outside the app. Downloads every character the account can see as one JSON
  file; each `characters[].stats` is a plain `pact-character/1` envelope, so a single lost character
  is restored by a normal Load in CharGen or the Live Sheet with no conversion. Uses `peekCharacter()`
  rather than `loadCharacter()` — peek is explicitly read-only, so taking a backup can never mutate
  what it's backing up. **Archived characters are always included regardless of the "Show archived"
  checkbox** (that box filters a view; a backup silently thinned by a UI toggle is the exact gap this
  closes), and characters with no `stats.LOG` are reported by name rather than dropped. Verified
  headless against a stubbed data layer: archived row present in the bundle while hidden from the
  list, skipped rows named, envelope schema intact, campaign name resolved, and a character named
  `Fenwick <script>` produced 0 injected script elements. Note this is now the *primary* mechanism —
  a scheduled agent-run backup can't scale, since the bundle would have to pass through a model
  context (140 KB already exceeds it). No `DATA.version` change.
- **2026-08-07 · feat(sql): automatic pre-change snapshots for cloud characters (`character_backups`)** —
  a real player character was lost to `js/sync.js` `deleteCharacter()`, which is a literal hard
  `delete` (the 2026-07-25 `archived_at` soft-delete is a *separate*, reversible action, offered
  before it). Nothing captured the row on the way out, and an overwritten `stats` was equally
  unrecoverable, so a lost cloud character had no recovery path for anyone — including the project
  owner. New `character_backups` table plus a `BEFORE UPDATE OR DELETE` trigger on `characters`
  storing the pre-change row; retention keeps the newest 50 `update` snapshots per character and
  **never** prunes `delete` snapshots. No foreign keys (both `profiles`→`characters` and
  `characters`→`ap_awards` cascade, which would kill the backups with the row they exist to outlive);
  `SECURITY DEFINER` trigger (it fires as the player, who is granted nothing on the table);
  `clock_timestamp()` not `now()` for `captured_at` (transaction time ties, and the prune would then
  order by a random uuid). RLS on with zero policies and no client grant — the Supabase dashboard is
  the only reader, same posture as `feedback`; no new admin role. Verified in production with a probe
  character since removed: pre-change capture, no-op updates skipped, restore under the original id
  with the campaign binding intact, 60 updates pruned to exactly 50, advisor clean. **Not
  retroactive** — it cannot recover anything deleted before today. Off-site copy to Google Drive
  still to come. See `decisions/2026/D-GH-2026-08-07-character-backups.md`. No `DATA.version` change.
- **2026-08-06 · docs(agents): name the failure the A/B/A1/A2 convention keeps hitting, instead of
  restating the rule** — the owner asked why the lettered-options format keeps getting lost. It isn't
  lost: `AGENTS.md` is auto-imported every session and the rule was already there. The failure is
  narrower — the format gets applied to things *shaped like a question* and dropped from things *shaped
  like a status report*, and a closing "where we are / what's outstanding" summary routinely carries two
  or three real decisions as a bare numbered list. The section now says explicitly that status summaries,
  wrap-ups, "still on you" lists and `/close-code-session` action lists are all covered, and that
  **letters run for the whole session** rather than resetting per message — both failures observed on
  2026-08-06, the second when the letters restarted at A with A–H already spent. Written as a named
  trap with the date rather than a louder restatement, on the same reasoning as `H-039` in
  `ai-lessons-learned`: a preference that keeps slipping needs its trigger made unmissable, not repeated.
- **2026-08-06 · docs: gate counts replaced with wording that cannot go stale** — `AGENTS.md` (×4),
  `docs/HOW-TO-WORK.md` (×3) and `testing/README.md` all told agents to expect **26 passed**, and
  HOW-TO-WORK put tool-pricing at **16**. Measured today: **29** and **67**. A stale pass count is worse
  than none — it either masks a real failure or sends someone hunting a regression that isn't there.
  Rather than typing in a seventh copy of a number that moves every time a fixture is added, all of them
  now say **"expect 0 failed"** and point at `testing/expected/expected-results.csv` as the live baseline.
  The same treatment applied to the forward-looking `Done when:` lines on the task boards — including
  five `27/0` I wrote myself earlier today, which had already gone stale within hours, which is the
  argument for the change in miniature. **Deliberately left alone:** `CHANGELOG`, the changelog archive
  and `DECISIONS.md` records. *"parity 27/0"* in a decision record is accurate history of what was true
  when it shipped, not an instruction to anyone.
- **2026-08-06 · fix(chargen): the creation lock is recorded, so it survives a reload** — owner report:
  *"the higher character generation lock doesn't seem to fire."* It never could. **Both** of the engine's
  lock paths were dead in CharGen: the automatic one (`_spent > threshold`) is suppressed because
  `_buildEventBurst` tags every event `noLock:true`, and the explicit `creationLocked` event — which
  `js/engine.js:671` calls *"the primary intended trigger"* — **had never been emitted by any tool**;
  CharGen's only mention of it was inside a comment. And since `_locked` is derived state rebuilt on
  every `_replay()`, there was nothing to survive a page load even had it fired. `_cgRepriceDraft()` now
  appends `creationLocked` once `economy(LOG).spent` passes the threshold, mirroring `_replay()`'s own
  resolution (`js/engine.js:749-756`): armed-only (D-GH32 preserved), strictly-over, once, and never
  while an explicit unlock is in force. Chosen (owner, H2) over the task board's step 4 of *removing* the
  blanket `noLock` — that would have reopened **D-GH34**, since the burst's order is synthetic and the
  lock would land at an arbitrary point inside it. Measured on an imported over-budget character (140 AP
  against a 79 threshold): the lock is the **last** event, **12** buys precede it and **0** follow, every
  burst buy still carries `noLock`, and every racial trait is still stamped pre-lock. Gate +5 assertions;
  the firing, persistence and burst-ordering ones confirmed red against a reverted fire, and the
  unlock guard against its own revert (which produced `[creationLocked, creationUnlocked,
  creationLocked]` — a DM's unlock undone on the next keystroke). **Not delivered:** per-portion pricing
  inside an import (first 79 at creation prices, the rest post-lock) — the burst emits in canonical, not
  purchase, order, so there is no honest place to draw that line; `feat/creation-vs-awarded-ap` stays
  open for it. Engine untouched, so `DATA.version` is unmoved. Recorded in
  `decisions/2026/D-GH-2026-08-06-creation-lock-survives-reload.md`.
- **2026-08-06 · fix(login): sign-in now lands back on index.html instead of a redundant "signed in"
  panel** — `login.html` used to show its own post-auth screen ("Signed in as X.", "Open PACT tools",
  "Live Character Sheet", "Log out") after a successful sign-in, or when a signed-in visitor loaded the
  page directly. That panel duplicated `index.html`'s header, which already renders "Signed in as X ·
  Log out" via `js/auth.js` (`currentSession`/`myProfile`/`logout`). Replaced it with a redirect to
  `index.html`, checked in the same three places the old panel was shown: after login, after register
  (when email confirmation is off and a session exists immediately), and on page load for an already
  signed-in visitor — each still defers to `resumePendingInvite()` first, so the campaign-invite
  round-trip (CharGen → login.html → CharGen) is unaffected. Removed the now-dead `#signedView` markup/CSS
  and the `logout`/`myProfile` imports that only it used. Display only; `BUILD`/`DATA.version` unmoved.
- **2026-08-06 · fix(index): "Continue where you left off" moved into the For players section** — the
  resume-cards module (`#continueSection`) previously rendered as its own top-level section above the
  Player's Guide hero; it now nests at the bottom of the existing "For players" `tools-group`, below the
  three tool cards. Layout/markup-only move — the recent-characters module still finds its elements by id
  and its icon lookup still matches on tool-card `href`, both unaffected by DOM position. Display only;
  `BUILD`/`DATA.version` unmoved.
- **2026-08-06 · fix(livesheet): a refresh keeps the campaign binding, and a lookup no longer mints a
  character id** — owner report: *"when the page is refreshed, it loses the connection to campaign and I
  need to reload the character."* **The task board's diagnosis was wrong and is worth correcting:** it
  blamed `save()` for not passing `campaignId`, but `save()` has carried it since PR #312. The defect is
  on the **load** side — `load()` calls `_lsResetCloudApState()` (which nulls `_lsCampaignId`) and then
  restores `LOG`, `SEQ`, `rules` and `__charId` but never `d.campaignId`. The envelope had it all along;
  the restore threw it away. Now restored — and it is the tab's own autosave, so adopting its binding
  grants nothing the server's RLS wouldn't. Second half: the async fallback meant to recover the binding
  called `S.loadCharacter(currentCharId())`, and **`currentCharId()` mints a fresh random id when none is
  set** — so it queried a character that had never existed, got nothing, and set `_lsCampaignId = null`,
  wiping the binding again. Added `peekCharId()`, a read-only companion answering *"have we an id yet"*
  without minting, and the round-trip now bails when there is none. Gate +2 assertions covering the whole
  local save → wipe → load cycle, both confirmed red against reverts (binding → `null`; peek → mints an
  id). **Not addressed:** the Live Sheet → CharGen half, which the board flags as an unconfirmed
  boot-order hypothesis and which needs a signed-in browser to verify — the task stays open for it.
  Display/state only; `DATA.version` unmoved.
- **2026-08-06 · fix(engine): a bought-off drawback can be taken again** (`DATA.version` **v0.340 →
  v0.341**) — `activeEvents()` keyed its `boughtOff` map by drawback **value**, so any buyoff suppressed
  *every* buy of that value forever, including ones taken **after** the buyoff. Measured (the task's own
  repro): buy "Asthmatic", buy it off, take it again → build has no Asthmatic, `drawbackEarned:0`. The
  retake was accepted by the UI and silently ignored by the engine, with no warning. Worse, the Live
  Sheet's buy panel read the same value-keyed map to decide whether to *offer* a drawback at all, so a
  bought-off drawback rendered as a permanently disabled *"Bought off (3× cost paid)"* tile whose
  `onclick` only flashes a message — the retake wasn't just dropped if attempted, the UI made attempting
  it structurally unreachable. `boughtOff` now resolves per-**purchase**, not per-value: one forward pass
  matches each buyoff to the oldest not-yet-cancelled purchase of that value (FIFO by array position) —
  no `seq` field, no schema change, which is a deliberate departure from the task board's own suggested
  fix (the engine has no concept of `seq`; see `decisions/2026/D-GH-2026-08-06-buyoff-keyed-by-event.md`
  for why plain ordering covers every case without it). Existing single-buy/single-buyoff characters are
  unaffected — verified directly. The buy panel's blocking "Bought off" branch is removed outright: once
  cancellation is per-purchase, a drawback not currently held is simply available to take again. New
  fixture `EV-017`, mutation-tested by reverting the engine change and confirming it fails (`EV-015`/
  `EV-016` unaffected by the same revert). **This session's environment had no browser available**, so
  the two new Live Sheet UI gate assertions were pushed unexecuted, flagged as such in the decision
  record — and CI's first real run caught a genuine bug **in the test**, not the fix:
  `buyoffDrawback()`'s own affordability gate silently refused every buy-off because the test never
  funded an `award` event, so the fix itself was never actually exercised. Fixed and re-verified green
  against the real CI browser — exactly the failure mode the "not executed locally" flag exists to catch.
  Graduates the task off `docs/TASK_BOARD_NOW.md`.
- **2026-08-06 · feat(engine): `compute()` prices extra maneuvers — and the pricing escape is deleted**
  (`DATA.version` **v0.339 → v0.340**) — `repriceDraft()` re-derives every frozen cost as a `compute()`
  delta, and `compute()` never read `maneuverBuys`, so three maneuvers bought for 4+5+6 were rewritten to
  **0/0/0 while the maneuvers were kept** — 15 AP silently handed back on a CharGen round-trip, and since
  every pre-lock character is a draft, that reached all of them. `compute()` now charges the rung already
  in `DATA.maneuverBuy` (`base + step×n`, so three cost 15) on a new **`Extra maneuvers`** ledger line.
  The pleasing part: `priceOf()`'s ordinary whole-build diff now returns the right rung on its own
  (deltas verified 4, 5, 6, 7), so the Live Sheet's `_UNCHARGED_PRICERS` was **deleted, not updated** —
  the fourth escape `D-GH-2026-08-05-pricing-model` **D1** warned against is gone rather than relocated,
  which is what D1 meant by *"retired into that rule"*. One number now serves the affordability gate, the
  ledger and reprice, which previously disagreed by construction. New fixture `EV-016` — no fixture
  carried `maneuverBuys` at all, so the category had **zero coverage** while the suite read green, the
  same blind spot that had hidden Grit and Vigor. Parity 27/0 → **28/0**. Supersedes the pricing half of
  `D-GH-2026-08-06-maneuver-afford-gate`; recorded in
  `decisions/2026/D-GH-2026-08-06-reprice-preserves-uncharged-costs.md`.
- **2026-08-06 · fix(chargen): house-rule names and descriptions can no longer inject markup** — a DM's
  custom boon/drawback name and description are user-typed, and `houseRules` rides inside the saved
  `pact-character/1` envelope and the cloud `stats` column — so they render in **another user's** browser.
  That makes it stored XSS, not a display bug, and AGENTS.md's `esc()` rule a hard invariant (REV-12).
  Wider than filed: the reported site was `buildDrawGrid`, but the same raw interpolation was in
  `buildBoonGrid`, in **both** grids' `fx` descriptions, and in `buildDmList`'s visible name — six sites,
  all now through the shared `esc()` from `js/ui-helpers.js`. The DM-list handlers needed **two** layers:
  `JSON.stringify()` escapes quotes at the JS level, then `esc()` escapes for the attribute — `esc()`
  alone stops the injection but leaves `onclick="fn("a"b")"`, a syntax error that silently breaks the
  disable/remove buttons for any name containing a quote. Also renamed a `const esc = …` local that
  **shadowed the global `esc()` helper** in `buildArtGrid`'s scope, which is exactly what makes a later
  `esc()` call throw. Gate +2 assertions; both confirmed red against a real revert (un-escaped name
  materialises an `<img>`; single-layer handler neither parses nor fires). Note the element-count check
  is what carries the first assertion — `onerror` timing is unreliable headless, so asserting only on
  "did script run" would have passed while markup was injecting. Display-only; `DATA.version` unmoved.
- **2026-08-06 · fix(chargen): an epic boon's ability choice survives a whole-log rewrite** — silent data
  loss on a supported path: `epicBoonAbil` is set only by the Live Sheet's ✎ Names dialog and has no
  CharGen control, so `_domReadBuild()` never carried it and `replaceWholeLogFromBuild()` emitted a
  `names` event without it. A Live Sheet character with epic boons, opened in CharGen and re-saved, came
  back with its choices gone and a permanent *"&lt;boon&gt;: choose an ability to raise (+2)"* it could not
  clear. `replaceWholeLogFromBuild()` now recovers the value from the log it is about to replace and
  hands it to the burst on the build; the `names` event carries `eb`, and its emission guard fires on
  that alone (a character can have an ability choice and no named spells). **Two wrong fixes preceded the
  right one, both caught by driving the real tool rather than reasoning:** `_buildEventBurst()` declares
  its own `let LOG=[]`, so reading `LOG` there hits that binding's temporal dead zone — and the read sat
  in a `try/catch`, so it failed silently and recovered nothing; the top-level `LOG` is also a `let`, so
  `window.LOG` is undefined too. The capture has to happen in the caller. Gate +1 assertion, confirmed
  red against the reverted carry (returns `[null, 1]`). Display/entitlement field only — `DATA.version`
  unmoved, engine untouched.
- **2026-08-06 · chore(release): `BUILD` → `v1.367` (PR #367)** — small follow-up promotion of `preview` →
  `main`, immediately after `v1.365`: the Live Sheet rules-version fix plus its board entry. Major carried
  forward at `1`. `BUILD` mirrored from `js/engine.js` into CharGen's line-1 comment, `<title>` and header
  `.sub`, the Live Sheet's line-1 comment, and DM Console's `TOOL_VERSION`; `index.html` untouched (reads
  `BUILD` live). `DATA.version` stays at **v0.339** — nothing in this promotion changes `compute()` output.
- **2026-08-06 · fix(livesheet): the footer reads `DATA.version` live instead of a hardcoded literal** —
  found by checking the claim *"all tools show v0.339 now"* after the v1.365 promotion rather than
  asserting it. They didn't: the Live Sheet's footer read **`PACT v0.309`** while the rules were v0.339 —
  30 versions behind, and the only place that tool states a rules version at all (it has no *"PACT rules"*
  chip like CharGen). It was missed because `docs/VERSION-SYNC.md`'s mirror list doesn't name it. The
  footer now carries `#lsRulesVer` and `_lsBoot()` paints it from the `RULES` value it *already* read from
  `DATA.version` — the same live read DM Console uses — so it cannot drift again; the literal in the HTML
  is only the no-engine fallback. This also makes CharGen's header comment true for the first time: it
  claims the Live Sheet reads `DATA.version` live, which until now it did not. The two agent-facing
  `AI SESSION CONTEXT` headers were resynced with it (CharGen v0.337, Live Sheet v0.309 → v0.339).
  **Deliberately untouched:** the *Players Guide* provenance strings (*"verbatim from the v0.309 Players
  Guide"*, *"PACT-Players-Guide-v0.303.docx"*) — those record which edition the quoted text came from, so
  bumping them would assert a re-check that hasn't happened; and the `// v0.314:`-style annotations that
  mark when a feature landed. Gate +1 assertion comparing the footer to `DATA.version` itself rather than
  a fixed string, so it never needs updating at a rules bump; confirmed red against the reverted wiring
  (returns `v0.309`). Display-only — `DATA.version` and `BUILD` both unmoved.
- **2026-08-06 · chore(release): `BUILD` → `v1.365` (PR #365), and CharGen's stale rules labels resynced**
  — promotion of `preview` → `main`, 49 non-merge commits since `v1.358`. Major carried forward at `1`;
  per `docs/VERSION-SYNC.md` that is a named human decision, never inferred from the size of a promotion.
  `BUILD` mirrored from `js/engine.js` into CharGen's line-1 comment, `<title>` and header `.sub`, the
  Live Sheet's line-1 comment, and DM Console's `TOOL_VERSION`; `index.html` untouched (it reads `BUILD`
  live). `DATA.version` stays at **v0.339** — it moved once this window, for the Grit and Vigor pricing
  corrections, and nothing since changed `compute()` output. **Also resynced two user-visible *rules*
  labels that had drifted**, which the version-sync one-liner tells you not to touch during a promotion:
  CharGen's `<title>` read *Rules v0.338* and its `#cgPactver` chip read *PACT rules · v0.337* while
  `DATA.version` was v0.339 — CharGen hardcodes both, unlike the Live Sheet and DM Console which read
  `DATA.version` live, and the file's own comment says to resync them on a rules bump. The bump that
  should have done it was in this same window. Fixing a stale mirror to the already-current value is not
  a rules-version change, and shipping *"PACT rules · v0.337"* to `main` would have been a wrong fact in
  front of users; the same comment's own stale examples (`v0.337`, `v0.202`) were corrected with it.
- **2026-08-06 · feat(engine): the `Drawbacks (refund)` ledger line itemises what was taken** — owner-
  confirmed: a character with three drawbacks showed one lump sum and no way to see which three, while
  *Arts & Techniques*, *Species traits*, *Class features*, *Subclass abilities* and *Boons* all expanded
  into named rows. The drawbacks loop now collects pairs and calls `addItems("Drawbacks (refund)", …)`
  with the key matching the ledger line's label exactly — both tools already walk `itemize` generically,
  so there is no renderer change. Rows are **negative**, so they sum to the line total (`-drawGain`), the
  same relationship the other five itemised lines have with theirs; the value itemised is the one
  actually charged, so a house-ruled drawback shows its overridden AP, not the printed one. Unknown
  drawbacks are skipped, as all five sibling itemised loops already do — a drawback retired from the rules
  scores 0, and without the guard it rendered a phantom `<name> 0` row and could leave an `itemize` key
  with no matching ledger line (`add()` suppresses a zero total). `compute()` totals do not move and
  `testing/expected/` captures only totals and warnings (checked, not assumed), so **`DATA.version` is
  unmoved**. Note the rows are visible in **CharGen and DM Console** only — the Live Sheet's AP ledger
  maps `r.lines` and does not read `itemize` at all. Gate +11 assertions across the three fixes; every one
  that guards a specific behaviour was confirmed red against a deliberately reverted guard before being
  trusted, and step 6's check that *Boons* rows still render is in there too. **Not in this change:** the
  2026-08-05 scope extension — showing what was *lost* (a bought-off
  drawback, its buy-off cost, and a DM-removed boon) appears in no ledger line at all, and needs an owner
  decision on whether historical spend belongs in `compute()`'s ledger (`feat/ap-model-reconcile`) plus a
  line shape for a DM-edit feature that isn't built yet. The task stays on `docs/TASK_BOARD_NEXT.md`.
- **2026-08-06 · fix(livesheet): buying an extra maneuver goes through the affordability gate** —
  `buyManeuver()` called `emit()` directly, making it the one purchase path in the tool that skipped
  `buy()`'s frozen-economy check. Measured on a Fighter with *Combat Superiority* and **0 AP available**:
  four clicks charged 4, 5, 6 and 7 AP and took the character to **−22**, with no refusal and no warning.
  Now routed through `buy()`. Pricing needed an escape first — `maneuverBuys` is read only by the ✎ Names
  dialog's slot count and by no ledger line, so `compute()`'s build diff prices the purchase at 0 and the
  gate would have been a no-op; `mvbuy` therefore joins `_CTX_PRICERS` quoting its own rung
  (`4 + maneuverBuys`), the same escape `hd`, `abil` and `unlockclass` already use. The dialog now
  redraws only when the purchase lands, so a refusal leaves it open showing the flash. Verified: at 0 AP
  all four clicks are refused with *"Not enough AP: needs 4, have 0"*; at 15 AP the ladder still charges
  4, 5, 6 and then refuses the 7 with *"needs 7, have 0"*. Review then found the escape was in the wrong
  table: `_CTX_PRICERS` means *"the diff over-charges because this purchase changes the pricing context"*,
  and adding a fourth entry contradicts `D-GH-2026-08-05-pricing-model` **D1** outright. `mvbuy` now lives
  in its own `_UNCHARGED_PRICERS` — *"the diff is 0 because `compute()` charges nothing"* — which keeps D1's
  planned retirement of `_CTX_PRICERS` safe to carry out; folding an uncharged purchase in would have made
  maneuvers free again the day it happened. The rung itself moved into **`DATA.maneuverBuy`**
  (`{base:4, step:1}`), following D1's own finding that *"the escapes exist where the data was missing"* —
  it had never been in `DATA` at all. `DATA.version` deliberately unmoved (value unchanged, `compute()`
  never reads the key, parity 27/0); reasoning recorded in
  `decisions/2026/D-GH-2026-08-06-maneuver-afford-gate.md`.
- **2026-08-06 · fix(livesheet): epic boons can be bought again — an expected follow-up is no longer a
  hard block** — owner-confirmed: all 12 `epic:true` boons were unbuyable in the Live Sheet. `MUT.boon`
  pushes the label but cannot set `epicBoonAbil`, so `compute()` on the candidate build always raised
  *"&lt;boon&gt;: choose an ability to raise (+2)"*; that string matched neither `SOFT_WARN` nor anything
  else, so `buy()` classified it as a rules violation and refused with *⛔ Purchase blocked*. The warning
  is guidance, not a violation — the ability is chosen afterwards in the ✎ Names dialog. Added a third
  class, `EXPECTED_FOLLOWUP`, rather than widening `SOFT_WARN`: soft warnings mean "allowed but flagged,
  confirm through", and asking a player to confirm a warning that isn't one is the wrong prompt. `buy()`
  now flashes a pointer to the dialog instead. Measured on a HD-17 character with 804 AP: 12 of 12 epic
  boons blocked before, 12 of 12 bought after, with the guidance still raised on the build and
  *"Crossbow Expert: requires DEX 14+"* still hard-blocked. Two follow-on defects found in review and
  fixed here: the event was still storing the **unfiltered** `warns`, and the history ledger paints any
  row carrying one red — so an epic boon would have looked like a rules breach forever, including after
  the ability was chosen, and `warns` travels inside the saved envelope; `buy()` now stores `rest`. And
  `ib()` built its own classification with no knowledge of `EXPECTED_FOLLOWUP`, so every epic-boon tile
  stayed amber `.warn` while clicking it bought cleanly — the panel and `buy()` disagreeing about the
  same string. The tile keeps the guidance text and drops the styling. No engine change, so
  `DATA.version` unmoved.
- **2026-08-05 · fix(livesheet): a racial trait is gated by its tier, as CharGen already gated it** — owner
  report: *"Draconic flight requires T4, which works in CharGen but not the Live Sheet."* A trait's tier
  gates it by Hit Dice via `DATA.tierHD` (T4 needs 5 HD), and CharGen enforced that on its trait
  checkboxes. The Live Sheet used `DATA.tierHD` for class features, Eldritch Invocations and cross-class
  features but **not** for racial traits — `racialWhy()` checked only `minHD` and `reqRace`, and
  *Dragonborn: Draconic flight* is T4 with no `minHD` field at all, so nothing stopped it being bought at
  level 1. `racialWhy()` now checks the tier gate first; `minHD` stays as a stricter override for traits
  naming an explicit level (the breath-dice steps, Goliath's Large Form). Gate +2 assertions, the second
  driving the real buy panel for a Dragonborn so it proves the gate is wired rather than that the numbers
  exist in `DATA`. No `compute()` change, so `DATA.version` unmoved.
- **2026-08-05 · feat(engine): Vigor is priced per rank at the tier it was bought at** — closes the
  pre-lock reconciliation question (D8). `compute()` had no way to know *when* a Vigor rank was bought, so
  it re-priced the whole stack at today's tier: buy Vigor 2 at level 1 for 10 AP, level to 5, and the sheet
  said it cost 28 — charging 18 AP for Vigor already owned, purely for levelling. Vigor now carries
  `b._vigorRankTier`, stamping each rank with the tier in force when bought — the same mechanism
  `_raceTraitLocked` has always used for species traits. `_replay` fills it just before the mutator runs
  (the only point where the previous rank total is still visible); `compute()` prices each rank from its
  own stamp and falls back to today's tier for an unstamped build, so nothing changes for callers that
  don't replay a LOG. Two ranks bought at tier 1 stay at 10 after levelling, while a third bought after the
  level-up costs the tier-4 rate of 14 — both halves in one build. **This closes the tool divergence**:
  levelling 1→5 with Vigor 2 / Grit 3 now quotes 12 in *both* tools, where CharGen quoted 51. One
  divergence remains, `unlockclass` (CharGen −6 vs Live Sheet 7), tracked as `fix/chargen-context-pricing`.
  Like Grit, Vigor was **entirely ungated** — every fixture had `hardy: 0` and no event fixture bought it.
  New fixture EV-015 pins both halves; parity 26/0 → 27/0, verified by reverting the stamp (EV-015 fails,
  the other 26 pass). `DATA.version` unchanged: no price table moved, and an unstamped build computes
  exactly as before.
- **2026-08-05 · feat(chargen): pick a building level and budget track instead of an AP number** —
  the AP budget was a **751-option `<select>`** (`numOpts(0,750)`), which the owner called clunky, and the
  creation lock always measured against a flat `DATA.level1AP` of 79 no matter what the character's budget
  was. Two selectors — **building level (0–20)** and **budget track (lean / standard / generous)** — now
  derive all three numbers the tools need: **total AP** from the curve, **creation AP** (the track's
  level-1 figure, which is what the lock measures), and the remainder, which behaves as **awarded AP** at
  post-creation prices. A level-5 Standard character starts with 175 AP: the first 79 spends under creation
  pricing with the usual warnings, the other 96 as awards — which is the right shape, since a character
  beginning at level 5 has in rules terms already advanced (owner's design). Level 0 is handled by the same
  formula rather than a special case: its 55 AP total is below the level-1 figure, so creation AP clamps to
  the total and the whole prelude budget is creation spending. The threshold is written as an **appended**
  `creationLockConfig` event (D4 — never replaced or moved), so it persists in the save file with no schema
  change. `#budget` remains as a plain number input, derived from the two selectors but still directly
  editable for a table running a figure no curve produces. Two bugs found and fixed while building it: a
  render-time helper repainted the selectors from the budget and fought the user's own edit (the level
  snapped back before the new total landed); and "derive the level from the budget" has no unique answer at
  all — Lean level 6 and Standard level 5 both total 175 AP — so the selectors are now inputs only, with a
  hint line reporting the real figures. `relabel()` also gained an `options` guard, since it assumed a
  `<select>`. Gate: `tool-pricing-ci.mjs` 34 → 42, covering all three tracks, level 0 and level 20, the
  event-not-DOM threshold, and that the control is no longer a dropdown. Parity 26/0, log-fuzz 500/500,
  `DATA.version` unchanged — no `compute()` output moves.
- **2026-08-05 · fix(engine): Grit is priced by which purchase it is, not by your character tier** —
  **rules correction (owner), `DATA.version` v0.338 → v0.339.** `js/engine.js` indexed the Grit ladder
  (2/4/6/9/12/15/18) by the character's **tier**, so every Grit purchase cost the same and that cost rose
  as you levelled: three Grit cost 6 AP at level 1, **27 at level 5, 36 at level 9**. It is now indexed by
  **purchase number** and is level-independent — three Grit cost 12, whenever you buy them. Past the
  seven-entry table the steps run 2/4/6/8/10 (8th = 20, 9th = 24, then 30, 38, 48); both tools let a player
  buy well past 7, so the table had to extend. The past-CON-mod surcharge is now a **flat +1 per purchase**
  rather than the escalating `max(0, n − CONmod)` the code applied. Vigor is deliberately untouched: it
  really is tier-locked ("each rank costs the Passive band of your current Hit-Dice tier"), so with Vigor
  buying early is genuinely cheaper — the two are priced differently on purpose.
  **The Players Guide needs rewording to match** — it says "Situational by tier" in three places
  (`docs/PACT-Players-Guide.html` lines 671 and 675 ×2), which is what the old code implemented faithfully.
  Also corrected two plainly wrong CharGen labels found alongside: the control read "Grit (+5 HP)" and the
  HP formula "Toughness×5" where the engine and guide both say **+4**.
  **Test coverage: this was previously ungated entirely** — all 23 fixtures had `tough: 0`, so no parity
  test touched Grit pricing and none could have caught either the tier indexing or a regression. Added
  CG-010/CG-011: the same Grit-10 build at HD 1 and HD 9, whose Grit lines must both read 147, spanning the
  table and the extrapolation. Parity **24/0 → 26/0**; verified by reverting the fix (both new fixtures
  fail, the other 24 pass). tool-pricing 32/0, log-fuzz 500/500.
- **2026-08-05 · fix(chargen): a draft character's AP ledger now reconciles to `compute()`** — closes
  `fix/species-pack-not-charged`, the last of the four pricing branches. Before the creation lock fires a
  character is a draft with one pricing context, so what was paid must equal what the build costs today —
  but a purchase's cost was frozen when it was made and a *later* change to context left it stale.
  Measured in a real browser: buy four Halfling traits (ledger 13, `compute()` 13), switch species to
  Dwarf and the traits become cross-race purchases the ledger still records at own-species prices
  (13 vs 24); switch back and the identity patch quotes **−4**, taking the ledger to 2 against 13. That
  negative line is the same mechanism behind Anders Tealeaf's log summing to 15 against a `compute()` of
  33. Fixed in two independent halves: new `repriceDraft(log)` export in `js/engine.js` re-derives every
  pre-lock purchase's cost as its own sequential delta (riding `_replay`, which gained one optional
  callback, so racial `_raceTraitLocked` stamping and the lock bookkeeping stay single-source), called
  from CharGen's mutation paths **and from `_cgApplyEnvelope`** — the load path (file, `?handoff=`,
  autosave restore) that a pre-existing under-recorded ledger actually arrives by; and `replacePatchSlot()` now replaces in place instead of
  filter-and-appending, which had been moving a slot's event to the end of the log on every edit so the
  identity line priced traits that came *before* it. Post-lock purchases keep their frozen price
  (D5), and drawbacks are untouched — their recorded cost is income, not spend. The pass runs to a fixed
  point because re-pricing and the threshold lock are mutually recursive — the decision is made once for
  the whole log (`isCreationDraft()`, also exported), never per event, so it settles in one pass and a
  locked character's frozen prices are never re-derived. `DATA.version` unchanged:
  `compute()` output does not move, only what the ledger records. Gate: `tool-pricing-ci.mjs` 20→27,
  verified by reintroducing each half (reproduces −11 and −4 exactly); `log-fuzz.mjs` gained four
  `repriceDraft` invariants (non-mutating, idempotent, build-preserving, draft-reconciling) — those
  caught the non-idempotence, the drawback-income bug, and a duplicate-purchase mispricing that also
  hardened `_replay`'s proficiency dedupe. Code review then caught four more, all fixed here: the
  per-event lock decision needed O(events) passes to settle and could re-price a purchase frozen at 6 AP
  down to 2 (a D5 violation); the load path never re-priced at all; and the fuzz invariant's scope
  excluded every CharGen-shaped log, since `_cgEnsureLockArmed()` stamps `{auto:true}` into all of them.
  Gate 20→32; fuzz 500/500 clean across five fixed seeds and at 80 events/log; parity 24/0.
- **2026-08-05 · docs(decisions): reverse H2 — the species-pack fix is a `priceOf()` quoting-basis bug, not
  a ledger-accounting one** — two rounds of external cold review (5 reviewers, then 4) refuted the planned
  approach, and two code audits moved the diagnosis to `priceOf()`
  (`tools/PACT-Live-Char-Sheet.html:503-511`), which quotes a purchase as a **whole-build delta** and freezes
  that number into the log — so any purchase that changes pricing context bills the player for re-pricing
  everything they already own. Already escaped by hand three times (`abil`, `mbound`, `dbound`, the last two
  with an inline comment naming "the refund bug") and still live for **Level Up** (charges the hit-die step
  plus a full re-price of the existing Vigor/Grit stacks) and **class unlock** (quotes the unlock cost minus a
  retroactive discount on already-owned features of that class; can go negative). New model recorded as
  **D-GH-2026-08-05-pricing-model**: prices freeze at purchase, `compute().total` and the ledger sum are
  *meant* to diverge, and the **creation lock** — not which tool is open — decides whether a purchase is
  quoted by draft re-pricing or at listed price. Lock trigger = first spend past a threshold, stored as a
  `creationLockConfig` event (persists offline and online with no schema change), default `DATA.level1AP` = 79.
  Engine side is already built and fixture-covered; nothing in any tool emits the events, so `_locked` is
  `false` for every character today. `DATA.version` unchanged — no rules or `compute()` change, docs only.

- **2026-08-04 · chore(release): bump BUILD to v1.358 (PR #358)** — promotion of `preview` → `main`
  carrying the archived-campaign peek and the DM-AP roster fix. `DATA.version` unchanged at **v0.338**:
  `compute()` was not touched, only its caller was passing nothing. Two decisions recorded on the task
  board in the same change — **G1**, DM Console's "AP left" uses the frozen ledger (matching the Live
  Sheet's `buy()` gate) and the AP Ledger keeps the repriced total, with Fenwick Copperkettle as the
  worked example on the new `feat/ap-model-reconcile` entry; and **H2**, the species-pack fix takes the
  invariant route (recorded cost equals `compute()`'s delta by construction) rather than the narrower
  event-ordering fix.

- **2026-08-04 · fix(dm-console): roster priced every AP figure against player AP only, ignoring DM AP** —
  reported from the live Amble campaign, where characters showed "OVER BUDGET by 27 / 36 AP". DM AP is
  stored only on `characters.ap` and never in the character's log, but `dmAnalyze()` called `compute(b)`
  with **no** opts and reported `economy()`'s totals — and `economy()` can only see the log. So the card's
  "AP left", the table's "AP Avail", the ⚠ OVER BUDGET warning (`js/engine.js:423`) and the AP Ledger's
  `total / budget` line were all player-log-only. Amble runs `ignore_player_ap` with the whole budget
  granted as DM AP, so the entire budget was invisible and every character read as deeply overspent —
  contradicting what those same players saw on their own Live Sheets. `{dmAp, ignorePlayerAp}` now flows
  `dmAnalyze` → `analyzeAug` → `cloudAnalyze`, and `available` is `spendable − economy().spent` — the Live
  Sheet's own `_apRemaining()`, i.e. the frozen ledger, not `compute()`'s repriced total (D-GH30). Anders
  −15 → **12**, Cedric −36 → **0**, both bogus warnings gone. Toggling ignore-player-AP now re-fetches the
  roster it just re-budgeted. `dm-console-ui` 73 → **79** checks; 4 mutants killed. Display-only; no
  `DATA.version` bump. See `decisions/2026/D-GH-2026-08-04-dm-console-dm-ap-budget.md`.

- **2026-08-04 · feat(dm-console): read-only view of an archived campaign** — an archived campaign offered
  its name and an **Unarchive** button and nothing else, so checking an old campaign's roster, rules or
  notes meant putting it back in the active list first — mutating state purely to look at it. Its name is
  now a clickable control that opens the ordinary campaign panel, locked. Reuses `selectCampaign()`'s
  render path (no second renderer to drift), and enforces the read-only state **twice**: `_peekBlocks()`
  gates all eight write call sites — `setCampaignRules` ×2, `createPlayerInvite`, `setInviteRevoked`,
  `setIgnorePlayerAp`, `archiveCampaign`, `awardAp`, `setCharacterDmNotes`, `unbindCharacter` — and
  `_applyPeekLock()` disables the controls. Guarded, not hidden: the roster replaces its own `innerHTML`
  on every refresh, so cards come back enabled and the handler guard is the half that can't be defeated.
  A banner says why, `+ Create`/`Unarchive`/ⓘ stay live so the way out is never locked, and exiting
  restores each control's prior disabled state rather than blanket-enabling. `dm-console-ui` 44 → **73**
  checks; all 10 mutants killed. Display-only; no `DATA.version` bump.
  See `decisions/2026/D-GH-2026-08-04-archived-campaign-peek.md`.

- **2026-08-04 · fix(dm-console): three help strings still said the shared code grants no AP** — the
  Players-code tooltip claimed a code-join "gets a new character bound to this campaign, with no preset
  AP/budget", the invite note called it "a blank character with no preset AP", and the Starting-tier
  tooltip said its "only effect is to pre-fill" the invite box. All three predate #329/#331: a code-join
  now grants `rules.startingTier.ap` (79 when unset), and it binds the character the player is
  **currently building** rather than creating a blank one — the second thing all three got wrong.
  Reported by the owner, who read the tooltip and could not tell what their campaign actually grants.
  Display-only; no `DATA.version` bump.

- **2026-08-04 · fix(chargen/feedback): mobile clipping and the floating Feedback button** — two HIGHs
  from the usability review, both with deeper causes than reported. The clipped class grid was **three**
  stacked layout defects, not one: an **inline** `grid-template-columns` no media query could override;
  the UA stylesheet's `fieldset{min-width:min-content}`, which stops a fieldset shrinking below its
  content (section 7 sat at 596px inside a 362px form); and flex/grid children defaulting to
  `min-width:auto`, so `1fr` and `.grow{flex:1}` floored tracks at content width. With
  `body{overflow-x:hidden}` there was no scrollbar, so half the classes were simply invisible. Widening
  the check found **section 9 clipped too** — the innate-spell table sizing its own parent, so its
  `max-width:100%` resolved against a box it was itself inflating. The Feedback pill now measures the
  host tool's fixed bottom bars at runtime and clears them (Live Sheet's `#lmobar` carries Undo/Redo
  mid-play), rests semi-transparent, collapses to an icon under 520px, and can be dismissed for the
  session. `chargen-flows` grows to **21 checks**, all four new mobile ones verified RED against the
  reverted fixes.

- **2026-08-04 · fix(live-sheet/chargen): orphaned duplicate on tool handoff, and a one-way-door invite
  decline** — three findings from the usability review, triaged against the code rather than taken at
  face value. **(1)** Every CharGen cloud save passes `campaignId`; the Live Sheet's never did. That
  argument is the input to `saveCharacter`'s anti-fork guard: without it, an id that has drifted off the
  UUID format makes the sync layer **mint a new id and insert a fresh row** instead of adopting the
  campaign's existing one — stranding a campaign-less duplicate frozen at its pre-handoff state while the
  real bound row stops updating. `js/sync.js`'s own comment already described this exact failure. **(2)**
  Declining the invite prompt cleared the token and hid the banner, so a player who clicked Cancel lost
  the invite with no explanation and no way back; the token is kept now and the banner offers "Accept
  invite" / "Discard invite". **(3)** The "invite never shows as redeemed" report is **not a data bug** —
  `redeem_player_invite` stamps `redeemed_at`, `list_campaign_invites` returns it, the row renders
  "Redeemed", and 13 of 22 live invites carry it; verified end to end. The real problem was the roster and
  invite list going stale independently, so either panel's Refresh now reloads both. New
  `chargen-flows` gate (11 checks) covers handoff identity and decline recovery — verified RED against
  the reverted decline behaviour (5 of 11 failed). See
  `decisions/2026/D-GH-2026-08-04-handoff-identity-and-invite-decline.md`.

- **2026-08-04 · fix(sql): grant `service_role` its table privileges in `rls-policies.sql`** — production
  had **none**, and nothing noticed because the app never uses that role (it is the browser client
  throughout, on the anon key under RLS). It surfaced when `seed-review-stack.mjs` became the first
  thing to authenticate as `service_role` and every call returned "permission denied". Supabase's
  project defaults normally supply these, which is exactly why depending on them was wrong: this file's
  stated job is that a fresh project works. No widening — `service_role` already bypasses RLS by design
  and its key never reaches a browser.

- **2026-08-04 · fix(chargen): section-nav chips were mislabelled from 7 onward, one was dead, and Arts
  AP was shown on the wrong section** — found by the usability review. `SECTIONS` had **11** entries
  against the form's **10**: a standalone `Arts` entry survived after Arts & Techniques were merged into
  `Arts & Boons`. Because chips bind positionally (`SECTIONS[i]` → `#sec(i+1)`), every chip from 7 on
  carried the previous section's name — "Arts" jumped to *Class Access*, "Spellcasting" to *Arts* — and
  the 11th pointed at a `#sec11` that never existed. The quieter half: `updateSections()` breaks on the
  first matching entry, so **all Arts & Techniques spend was rendered as section 7's AP subtotal**, on
  *Class Access & Features*. Phantom entry removed; `buildSecNav()` now drops any chip whose target
  doesn't resolve and warns, so a future drift loses a chip instead of shipping a dead button; and
  `audit.py` gains a check (29 total) asserting `SECTIONS` and `buildForm()`'s `grp()` calls stay the
  same length — verified RED against the reintroduced bug.

- **2026-08-04 · test(dm-console): first automated UI coverage for the console** — `cloud-e2e` drives
  `js/campaign.js`/`js/dm.js` directly and never opens DM Console, so the rules panel could break on any
  change with every gate still green. `testing/scripts/dm-console-ui-e2e.mjs` (27 checks) covers the
  starting-tier model, its override semantics, and all three `startingTier` shapes `loadRulesIntoPanel`
  must survive. Needs no Supabase stack — supabase-js is vendored, so the module bridge loads offline and
  fires `campaign-ready` — which keeps it cheap enough to run on every PR. Verified RED before being
  committed (perturbing `TIER_BANDS.heroic` failed 2 checks), and it immediately caught a real one:
  legacy `legendary` (1.6 × 79 = 126) does not land on level 3 (127), so a mapped legacy value now keeps
  its saved number and shows as an override instead of displaying a level its figure doesn't match.

- **2026-08-04 · feat(dm-console): starting tier is now a level + a band, and an unconfigured campaign
  grants nothing** (SQL migration `2026-08-04-join-grant-absent-means-zero.sql`) — the old single ratio
  (Prelude 0.7× / Standard 1.0× / Veteran 1.3× / Legendary 1.6×) conflated "what level is this
  character" with "how well-resourced are they", and off a Standard L1 of 79 the presets were
  *literally* levels: 55 = L0, 79 = L1, 103 = L2. Now two dropdowns — **level 0–20**, priced off the
  campaign's own budget curve, and a band (**Gritty 0.85× / Standard 1.0× / Heroic 1.15×**) — with each
  level option showing its live AP. Old `{preset, ap}` maps across exactly. The Players-code row now
  states the grant where the code is copied ("grants **N AP**, once per character") with a link to
  change it. And the `absent → 79` default from earlier the same day is **reversed**: that 79 was a
  hardcoded input placeholder inside a collapsed panel, not a DM's choice, so an unconfigured campaign
  now grants 0 and says so on screen. Amble and any campaign with a saved figure are unaffected. Also
  fixes three help strings that still claimed the shared code granted no AP and created a blank
  character — it binds the character the player is *currently building*. See
  `decisions/2026/D-GH-2026-08-04-starting-tier-level-band.md`.

- **2026-08-04 · test(review): seeded review stack + usability/QoL review prompt** — `cloud-e2e` proves
  the signed-in paths work but tears the stack down immediately, so a usability review had no way to
  reach the cloud half of the app at all. `testing/scripts/seed-review-stack.mjs` seeds five accounts,
  three campaigns (configured / no-rules / archived), invites in four states, two players joining by the
  two different routes, awarded AP and DM notes — then serves the app and **stays up**. Deliberately
  includes mess an all-happy-path stack hides: an archived character, a revoked invite, an empty
  campaign, and a name carrying quotes, HTML tags and 60 chars of overflow to test `esc()` on every
  surface that renders it. Default mode is a throwaway local stack; `--live` targets a hosted project
  for when Docker isn't available, gated on three independent things, with `--reset` refused outright
  and `--purge` removing only tagged rows. `docs/review-prompts/usability-qol-review.md` is the
  paste-ready prompt. See `decisions/2026/D-GH-2026-08-04-review-stack-seed.md`.

- **2026-08-04 · fix(campaign): five review findings on the join grant** (SQL migration
  `2026-08-04-join-grant-bounds-and-default.sql`) — a campaign with **no** `rules.startingTier` granted 0
  while DM Console displayed 79; since `rules` defaults to `'{}'` and `createCampaign` never writes a tier,
  that was **3 of 4 live campaigns**, not an edge case. Absent now means 79. `'^[0-9]+$'` also accepted
  `'2147483648'`, whose `::integer` cast overflowed and **aborted the join** — now bounded to 7 digits, with
  anything malformed granting 0. DM Console's `parseInt(x,10) || 79` rewrote a DM's deliberate 0. And two
  paths read DM AP via `peekCharacter()`, which prefers the **local** copy — so a player whose DM had just
  paid them still saw 0 spendable AP, every purchase OVER BUDGET, and Randomize refusing; both now use a new
  `refreshServerAp()`. `cloud-e2e` gains three scenarios and goes 24 → 32 checks — including an
  unbind→rebind case, because the old "does not grant twice" check hit an early return and never reached the
  double-pay guard at all. See `decisions/2026/D-GH-2026-08-04-join-grant-followups.md`.

- **2026-08-04 · feat(campaign): joining by the shared code now grants the campaign's starting AP**
  (SQL migration `2026-08-04-campaign-starting-ap-on-join.sql`) — an invite created a character with its
  grant; joining by code only set `campaign_id`, so those players landed on **0 AP** with nothing saying
  so. `bind_character_to_campaign` now grants `rules.startingTier.ap`, the same figure that already
  pre-fills the invite, so one number governs both routes. Only on a genuine first bind, guarded against
  an unbind/rebind double-pay, additive, credited to the DM not the joining player, and a malformed rules
  blob grants nothing rather than blocking the join. Verified live (45 granted, provenance row written,
  rebind no-ops, malformed value joins cleanly at 0) and gated by a new `cloud-e2e` scenario.

- **2026-08-04 · fix(chargen): Randomize refuses instead of building an unaffordable character** — it used
  `spendable || DATA.level1AP || 79`, treating a legitimate **0** as "missing", so a character with no AP
  got a ~79 AP build it couldn't afford and was flagged OVER BUDGET the moment it finished. It now says
  "This character has no AP yet — ask your DM to grant some" and stops. Last instance of the falsy-zero
  bug class that caused the 79 AP conjured onto Cedric Brightblade.

- **2026-08-04 · chore(dm-console): remove six orphaned CSS rules** — `.grantCharList` / `.grantCharRow`
  and friends styled the per-character tick list deleted when grant codes stopped pretending to be
  per-character. Nothing carries those class names any more.

- **2026-08-04 · feat(dm-console): collapsible invite/advancement cards; the AP-ignore toggle is
  locked** — "Invite new player" and "Level budget curve · award pace · starting tier" are now
  `<details>`, collapsed by default, matching the pattern Campaign Rules already used; the campaign
  panel was a long unbroken scroll otherwise. **"Ignore player-entered AP" now sits behind a lock:** the
  checkbox is disabled until you click 🔒 Locked, changing it asks for confirmation spelling out the
  effect on every character in the campaign, and it re-locks immediately afterwards so an unlocked state
  is never left lying around. Selecting a campaign always lands locked. That setting decides whether
  every character's own log AP counts toward what they can spend — a stray click silently re-budgets the
  whole table, which is exactly how the original invite-AP confusion started.

- **2026-08-04 · fix(archive): archived characters and campaigns are actually hidden** — the archive
  feature (shipped 2026-07-25) was silently defeated outside the "My Characters" page: CharGen's and the
  Live Sheet's own cloud-load menus filtered on `kind` only and never looked at `archived_at`, so an
  archived character stayed fully loadable and playable in the two tools where characters are actually
  used. Both menus now exclude them. `listMyCampaigns()` gained the archived filter **by default** — it
  previously existed only as a local filter inside DM Console, so CharGen's campaign picker offered
  archived campaigns as selectable binding targets; DM Console now opts in with `{includeArchived:true}`
  because it needs them to offer Unarchive. `archiveCharacter()`/`unarchiveCharacter()` now check the
  updated row count: a Supabase UPDATE matching zero rows returns `error:null`, so a stale tab reported
  "Archived" success while nothing changed. DM Console's unarchive button escapes the campaign id, per
  the codebase's hard `esc()` rule. **Now gated:** four new `cloud-e2e` scenarios cover exactly this —
  the task noted "no automated gate catches this", and there is one now. Graduated off the 🔴 NOW board.
  Note the task's step 1 was already stale: `listCharacters()` had been consolidated into
  `listMyCharacters()` (which does select `archived_at`), so the duplication it described no longer
  existed — the live defect was the tools ignoring the field, not the query omitting it.

- **2026-08-03 · test(sw): a returning-visitor gate, and CharGen's dead service-worker registration** —
  new `testing/scripts/sw-cache-e2e.mjs` + CI workflow installs the real service worker, deploys a module
  change, and reloads *without* a hard refresh — the one state no other gate covers, and the only state in
  which the 2026-08-03 outage existed. Verified red on that exact bug (`events=["engine-ready"]` only,
  `does not provide an export named '__swProbe'`, exit 1) and green once fixed. Building it uncovered that
  **line 3905 of CharGen was the truncated fragment `<li><sp`**, unterminated since PR #210, which
  swallowed the `<script>` registering the service worker — so CharGen registered none of its own, masked
  only because `index.html` registers one for the whole `/PACT/` scope. A deep link straight to CharGen got
  no service worker, no offline support and no caching. Structure closed (the lost sentence is
  unrecoverable and is marked, not invented).

- **2026-08-03 · feat(vendor): the Supabase client is served from our own origin, not a CDN** — every
  cloud feature used to depend on `esm.sh` being reachable at page load, and an ES module import failure
  aborts the whole script, so an outage or an ad-blocker took the cloud half of every tool down. Now
  `js/vendor/supabase-js-2.110.2.js`, precached by the service worker. Uses the **official UMD build**
  (1 file, 206KB, zero imports) rather than esm.sh's ESM form, which resolves transitively to 6 files and
  268KB including injected node polyfills; adapted with a two-line export footer and no transform, since
  the UMD's top-level `var` is module-scoped inside an ES module. The version in the filename is
  load-bearing — an update is a new URL, so the SW can never serve it stale, which is what lets it stay
  cache-first. `audit.py`'s import-freshness check gained vendor awareness (it previously only matched
  same-directory imports and would have ignored `./vendor/…` entirely): it now fails on an unversioned
  vendor filename, a missing file, or one absent from `PRE_CACHE` — both new failure modes demonstrated
  red first. Verified with every third-party host blocked: all three tools fire their cloud event, which
  previously never fired at all.

- **2026-08-03 · fix(security): an invite's DM note is no longer readable by the player it describes**
  (SQL migration `2026-08-03-invite-note-dm-only.sql`) — `campaign_invites_select` lets a redeemer read
  their own row, and RLS being row-level meant that included the DM's `note`. Now withheld at the column
  level; the DM reads it through the SECURITY DEFINER `list_campaign_invites()`. Worth knowing: a
  column-level REVOKE cannot subtract from a table-level GRANT — the first attempt reported success and
  changed nothing — so the blanket grant is dropped and the columns granted explicitly. `select *` on
  this table now fails loudly for `authenticated` rather than silently omitting the column; nothing in
  `js/`/`tools/` selects it directly, so nothing breaks. Verified live as the `authenticated` role
  (note denied, `select *` denied, other columns fine) and as a simulated DM session (22 invites, notes
  intact). Advisor: no new findings.

- **2026-08-03 · fix(dm-console): the AP grant code stops pretending to be per-character; local tools
  grouped below the cloud campaign** — the grant card asked you to tick each character and set an amount
  each, implying every code was bound to a character. `dmMakeGrant()` encodes an **amount and a note and
  nothing else**, so every generated code worked for whoever pasted it — the UI described a binding the
  format never had. Reduced to one amount, one note, one code, with the sharing model stated plainly.
  The two non-cloud cards (Import roster · AP grant code) now sit inside one **Local files & grant
  codes** master card placed *below* Campaign (cloud), and dim with an explanation once the loaded
  campaign actually has characters — pointing at the roster's own Award AP instead. Dimmed, not
  disabled: importing a local file for reference while running a cloud campaign is still legitimate, so
  this is guidance rather than a lock, and hover/focus restores full opacity.

- **2026-08-03 · fix(chargen,livesheet): loading a campaign character no longer conjures 79 player AP;
  the tool-switch keeps its campaign** — three separate faults, all downstream of moving the invite grant
  into the DM pool. (1) `applyBuild` used `b.budget || DATA.level1AP`, treating a legitimate **0** as
  "missing". Harmless while every campaign character carried a LOG award; a data bug the moment their
  budget legitimately folded to 0 — each load wrote 79 into the field and `_cgSyncAward()` emitted
  `award 79`, manufacturing player AP from nothing. Inert on a campaign with `ignore_player_ap`, silently
  inflating the budget on any campaign without it. The budget `<select>` also started at 12 and so could
  not represent 0 at all: it blanked, and the empty-field fallback minted 79 regardless. Fixed at all
  three points — nullish default, a numeric parse that accepts 0, a 0 option in the select, and no
  zero-award minted for a character that has none. (2) The Live Sheet's handoff-receive never adopted the
  campaign binding, so a CharGen → Live Sheet → CharGen round-trip reported `campaignId: null` and the
  character appeared detached with 0 DM AP — the database row was never touched. It now adopts the
  binding and resolves the authoritative `ap` from the server. (3) The version banner was a one-shot side
  effect that never cleared, so a banner raised by an earlier stale load sat over a current-version
  character and contradicted the version line beside it; it is now recomputed from `loadedRules` on every
  render, like the line it disagreed with.

- **2026-08-03 · feat(dm-console): invites are listed, labelled and withdrawable** (SQL migrations
  `2026-08-03-invite-notes-and-revoke.sql`, `-invite-manager-grant-lockdown.sql`) — a generated invite
  link previously existed only wherever the DM pasted it, so unredeemed ones accumulated invisibly
  (Amble had nine) with no way to tell which was meant for whom or what AP it carried. Now: an optional
  **Note** when generating (which also becomes the note on the AP award the character receives), and an
  **Invites issued** list showing each invite's note, AP, issue date and state — Open / Redeemed (with
  redeemer and character) / Withdrawn — with copy and **Withdraw** on outstanding ones and Restore on
  withdrawn ones. Withdrawal is soft (`revoked_at`), so the record of what was issued survives; a revoked
  invite is refused at redemption, checked before the claiming UPDATE so it can't be consumed by a race.
  Redeemed invites are immutable. Two problems the Supabase advisor caught and this fixes: `create or
  replace` with a new signature had left the **old 3-argument `create_player_invite` alive alongside the
  new one** (dropped — PostgREST resolves a 3-key call against the defaulted 4-argument version), and all
  three new/changed functions had inherited Postgres's default `EXECUTE to PUBLIC`, making them
  `anon`-callable; now revoked to `authenticated` only, matching the existing convention. **Caveat:**
  `campaign_invites_select` lets a redeemer read their own row, so a player can read the note on the
  invite they redeemed — treat notes as labels, not private commentary.

- **2026-08-03 · fix(sw): a network-first module must not import a cache-first one** (`CACHE_NAME`
  `pact-v7` → `pact-v8`) — `js/sync.js` is network-first and began importing `isCloudCharId` from
  `js/character-store.js`, which was cache-first. Returning users therefore ran today's `sync.js` against
  a cached `character-store.js` with no such export, and a named ES import the target doesn't export is a
  **link-time** failure: the whole module graph refused to instantiate. The cloud bridge died on every
  normal load while the engine bridge (importing only pre-existing names) linked fine — producing a
  rendered-but-cloud-less app: empty "My Characters" for an account with 8 characters, invites never
  redeemed so the previous character stayed on screen, "Sign in for campaign rules" while signed in, and
  the Live Sheet's cloud-unreachable banner. A hard refresh bypasses the service worker, which is exactly
  why everything "worked after a hard refresh". `character-store.js` is now network-first and the cache
  name is bumped so already-broken browsers self-heal on next load. **New guard:**
  `testing/scripts/audit.py` check `service-worker import freshness` fails if any network-first module
  imports a cache-first one — verified to go red on this exact bug and green once fixed.

- **2026-08-03 · fix(chargen,characters): feedback button no longer covers the AP ledger; My Characters
  gets a Back control** — the fixed feedback button sat on the last rows of CharGen's ledger, so
  `#sumdetails` now reserves its footprint rather than moving an affordance all three tools share. My
  Characters only offered "All tools", so arriving from a tool left no way back to it; a Back button now
  appears when there's same-origin history to return to, and stays hidden when there isn't.

- **2026-08-03 · fix(invites,chargen,livesheet): an invite grant is a recorded award; a saved file keeps
  its campaign binding** (SQL migration `2026-08-03-invite-grant-award-row.sql`) — redemption now writes
  an `ap_awards` row for the grant, attributed to the DM who created the invite rather than the redeeming
  player. Without it `ap_awards` was empty campaign-wide, which also meant Live Sheet's
  clone-to-standalone — which converts DM AP into itemized log entries by reading that table — silently
  dropped a character's entire starting grant. Five existing characters backfilled. Separately, the local
  file, tool-handoff and share-link loads all zeroed DM AP; correct when it was a bonus on top of a LOG
  award, total budget loss once the grant became the whole budget (an exported campaign character opened
  at `budget 0 · remaining -14`, every purchase flagged over). Envelopes and handoff batons now carry the
  campaign **binding** only — never the AP number, which the engine's ANTI-DOUBLE-COUNT INVARIANT forbids
  in an export — and the reader resolves the authoritative `ap` from the server when signed in, or reports
  DM AP as *unavailable* when not. The binding is covered by the D-GH48 signature, so editing it reads as
  tampered. `#b=` share links deliberately unchanged: they carry the folded build, not the log, and are
  the one path where a stale AP number would spread to other people. See
  `decisions/2026/D-GH-2026-08-03-invite-grant-award-row.md`.

- **2026-08-03 · fix(sync): the UUID id migration must not fork a campaign-bound character** — the
  migration shipped in v1.309 minted a fresh UUID unconditionally, which INSERTS a new row. A
  campaign-bound character whose id had drifted onto the legacy format was therefore saved as a
  brand-new, campaign-less duplicate while its real bound row kept only the seed log. Hit on the first
  real character through the path: one build landed as two orphan rows (`campaign_id` null, `ap` 0)
  while the Amble-bound row still showed 2 events, so opening it looked like the work had vanished.
  `saveCharacter()` now takes an optional `campaignId` and, when migrating, adopts the server's
  existing row for that campaign instead of minting — the DB already enforces one character per player
  per campaign, so the row is unambiguous. CharGen passes it on all three cloud-save paths.

- **2026-08-03 · fix(characters): device-only rows can be archived, deleted, and seen** — archiving sent
  a legacy pre-UUID id to Postgres and threw `invalid input syntax for type uuid`; since Delete was
  only offered once archived, those orphan rows could not be removed at all. Archive/unarchive/delete
  now handle local-only ids entirely in localStorage (and skip the tombstone, which could never be
  cleared for an id `replayDelete()` can't send). Device-only rows get a direct "Delete from this
  device" instead of the cloud-only Archive step, with a confirm that says which copy is going. The
  page also no longer hides everything behind a "reconnect" card when offline — `listMyCharacters()`
  always had an offline branch, so withholding it hid exactly the at-risk device-only copies; campaign
  names now degrade to "Unknown campaign" rather than failing the whole list.

- **2026-08-03 · fix(sync): character ids are UUIDs — locally-born characters can finally reach the
  cloud** — `genCharId()` minted `'c'+base36` (e.g. `cmscl7ilrr5muh`) while `characters.id` is a
  Postgres `uuid`, so saving a locally-created character failed with `invalid input syntax for type
  uuid` — and since `saveCharacter()` writes localStorage before pushing, every attempt left an
  orphaned local copy, showing the same character twice in My Characters. Only cloud-born characters
  (invite redemption) had ever synced. Ids are now `crypto.randomUUID()` (with a `getRandomValues`
  v4 fallback for non-secure contexts); new `isCloudCharId()`; `saveCharacter()` migrates a legacy id
  on first push and returns it, and all four save call sites adopt it — the join-campaign path
  reassigns its local `id` too, since `bindCharacterToCampaign` runs straight afterwards. See
  `decisions/2026/D-GH-2026-08-03-uuid-character-ids.md`.

- **2026-08-03 · feat(characters): My Characters shows ☁ Cloud vs 📥 Device only** — both kinds rendered
  identically, so a character that had never reached the server looked as safe as one that had.
  `listMyCharacters()` now tags each row `cloud`/`pendingSync`; offline it reports what the device last
  knew (`!dirty`). This is also what lets an owner tell an orphaned local duplicate from the real row.

- **2026-08-03 · fix(invites): ONE AP grant per invite, paid as DM AP** (SQL migration
  `2026-08-03-invite-single-ap-grant.sql`) — an invite carried two numbers and the second, "Creation
  budget", was seeded into the character's LOG as **player** AP. `compute()` resolves
  `spendable = (ignorePlayerAp ? 0 : playerAp) + dmAp`, so on a campaign with "ignore player AP" set,
  the whole grant was awarded and discarded on the same pass. Live example: Amble issued 36 + 55, the
  player could spend 36, and CharGen announced "created with 55 AP budget". Now one "Starting AP" field
  paid into `characters.ap` — correct whichever way the toggle is set, and unlike a LOG award the
  player can't edit their own grant. Both RPCs keep their signatures and fold
  `starting_ap + starting_budget` server-side, so a Pages deploy and a DB migration need not be atomic
  and pre-migration invites still pay out in full; `starting_budget` is deprecated and always written 0
  but deliberately **not** dropped. Advisor re-run after the migration: no new findings. See
  `decisions/2026/D-GH-2026-08-03-invite-single-ap-grant.md`.

- **2026-08-03 · feat(chargen): cloud autosave for campaign-bound characters** — CharGen only ever wrote
  to the cloud on an explicit action, so a player who redeemed an invite and started building stayed
  invisible in their DM's roster until they happened to press Save. Now debounced (3 s after edits stop)
  for characters bound to a campaign — the one case where somebody else is waiting on the data. Solo
  local builds keep manual saving and today's traffic profile. Pushes never overlap (`pushCharacter()`
  is a bare update-then-insert with no dirty check, so a slow request overtaken by a fast one could land
  the older build last), and failures stay silent because the local autosave already holds the work.

- **2026-08-03 · fix(chargen,dm-console): campaign status line after a join; a named character keeps its
  name in the DM roster** — CharGen's header kept reading "Signed in — no campaign selected" for a
  demonstrably bound character: the `<select>` was built at sign-in *before* the join so
  `selEl.value = camp.id` no-opped, and `renderStatus()` was never called from outside its closure. New
  `_cgAdoptCampaign()` fixes both. In DM Console, a character the player had named and saved rendered as
  "Unnamed character" — `hasData` rightly requires a `buy` event, but the placeholder card never
  consulted the `name` column that `getRoster()` already selects.

- **2026-08-03 · fix(dm-console): Starting tier AP follows the budget curve's L1** — the tier is a ratio
  of L1, but only recomputed when the *tier* dropdown changed, so switching Standard→Generous left the
  invite prefill on the old number (Amble: tier 79 against a curve L1 of 83). Now recomputes when L1 or
  the curve preset moves, and never overwrites a DM's own 'custom' figure.

- **2026-08-03 · fix(dm-console): explain the advancement dials and the two invite AP fields** — added
  an ⓘ to each of “Level budget curve”, “Award pace (AP per session)” and “Starting tier (new-PC
  budget)” spelling out what each dial actually drives (and, for the budget curve, that it now also
  sets the creation-lock threshold — its note previously claimed “display only”). Rewrote the invite
  form's two tooltips: both grants are spendable, and the real difference is ownership — **Creation
  budget** becomes the first entry in the player's own AP ledger (“Starting creation budget (79 AP)”,
  theirs to undo/redo against), while **Bonus DM AP** lives on the character record server-side,
  DM-only, invisible in that ledger. The old Bonus DM AP tooltip said it “does NOT get spent building
  the character”, which was wrong: `compute()` sets `spendable = playerAp + dmAp`. UI text only.

- **2026-08-03 · fix(rules): the AP-by-level ladder is the Standard BUDGET curve — 50 → 79 at L1**
  (`DATA.version` **v0.337 → v0.338**) — `js/ap-by-level.js`'s `{1:50, 2:92 … 20:491}` was never a
  rules curve. Per the Players Guide it was the appendix roster of twenty pregenerated Emberwatch
  sample characters (“a 1st-level recruit (50 AP) to a 20th-level archmage (491 AP)”), transcribed
  into a table and subsequently mislabelled a “pace curve”. PACT has a **budget** curve (what a
  complete level-N build has spent: Standard L1 79/+24, Generous 83/+28) and an **award pace** (AP per
  *session*, ~7) — and no AP-earned-per-level schedule at all. The ladder is now derived from
  `LEVEL_BUDGET_CURVES.standard` by a new `budgetLadder({l1,inc})` covering levels **0–20** (level 0 =
  55 on both presets, the Guide's prelude tier, straight out of the same formula). `DATA.level1AP` and
  `DATA.defaultAp` become **79**, so a new solo character is offered a real level-1 budget and the
  creation lock's fallback threshold is right by default. Also updated CharGen's budget picker default
  and its stale hint (“L1 50 · L5 176 … L20 491”). Parity **24/0** with `testing/expected/` untouched
  — the four threshold fixtures had their filler spend and their matching award raised by the same
  delta, so `remaining` and every expected value held still; audit 27/0, fuzz 500/500, browser e2e
  3/3. See `decisions/2026/D-GH-2026-08-03-ap-budget-curve-standard.md`.

- **2026-08-03 · fix(engine): creation-lock threshold reads the campaign's BUDGET curve, not the pace
  curve** — *(“pace curve” here is the mislabel corrected by the entry above; the mechanism it
  describes is unaffected)* — the auto-lock compared AP spent against `DATA.level1AP` (50). That's the *pace* curve —
  AP **earned** by level. The lock asks "is this character finished being built?", a question about
  **spend**, which is the separate *budget* curve (what a complete level-N build costs: Standard
  L1=79, Generous L1=83, per-campaign). `D-GH-2026-07-14-advancement-tracks` had already flagged this
  exact conflation as a follow-up. New pure export `creationLockThreshold(campaignRules)` resolves
  `rules.levelBudgetCurve.l1`, falling back to `DATA.level1AP` for solo/untuned characters; CharGen's
  invite redemption stamps it into the character's log at seed time. For Amble (Generous) the
  threshold becomes **83**: a player can spend their whole 70 AP grant and stay in creation, locking
  only once in-play spending passes what a complete level-1 build costs. Verified the Players Guide's
  Level 0 (55 AP) also sits on the budget curve and already falls out of the existing formula — no
  table row is missing. No `DATA.version` bump (the threshold is a log event, so `compute()` output
  is unchanged for every pre-existing input). Parity 24/0. See the 2026-08-03 addendum in
  `decisions/2026/D-GH-2026-08-02-creation-lock-switch.md`.
- **2026-08-02 · feat(engine): creation-lock switch — the engine half (events, precedence, backward
  compatibility)** — PACT's rules price own-species racial traits cheap during creation and expensive
  if claimed later, but nothing could ever mark a character "finished," so the expensive branch was
  unreachable. Both states the app has actually shipped were wrong: pre-D-GH37 every trait priced
  *expensive* (local folds never produced the per-trait lock stamp, so `compute()` fell through to
  `baseBuild()`'s unconditionally-true `inPlay`); post-D-GH37 every trait prices *cheap* (real replay
  stamps `false`, no trigger exists). Measured at tier 3: 4 AP unlocked vs 10 locked. Adds
  `creationLockConfig{auto,threshold}` (last-write-wins per field) and `creationUnlocked`
  (last-write-wins with `creationLocked`, future-only, and suppressing the auto-lock so unlocking an
  over-threshold character isn't a same-pass no-op); documents the precedence rule above `_replay()`.
  Fully backward compatible — the plan's specified "defaults off" would have broken three existing
  fixtures that assert `campaignBound` alone arms the lock, so `auto` falls back to campaign
  membership when unconfigured. Parity 20/0 → **24/0** (4 new fixtures; all repo references to the
  old count updated). Engine only — no UI, and **no production data written**. See
  `decisions/2026/D-GH-2026-08-02-creation-lock-switch.md` and
  `docs/plans/2026-08-02-creation-lock-switch.md`.
- **2026-08-02 · fix(dm-console): clarify the two AP fields on a player invite** — the invite form's two
  number inputs were bare placeholders ("Starting DM AP" / "Starting budget") with no explanation, and
  they fund two genuinely different pools — which read as one confusing number in the resulting
  character's ledger. Now proper labels with ⓘ tooltips: **Bonus DM AP** ("extra AP always available on
  top of what the character earns — the same pool as clicking Award AP later; does NOT get spent
  building the character") and **Creation budget** ("how much AP the player has to spend BUILDING their
  character — the same starting budget every character gets, just customizable"). Also renamed the
  card's "DM AP (server total)" row to "Bonus DM AP" to match, and the invite-seeded ledger entry from
  the generic "Award — budget (N AP)" to "Starting creation budget (N AP)". Display-only; no change to
  which pool anything actually goes into. (`_cgSyncAward()`'s live-reconcile label deliberately left
  alone — its equality guard compares the whole event, so renaming it would churn every existing
  character's LOG on next load for a pure wording change.)
- **2026-08-02 · fix(dm-console): "View" button is always visible, next to Skills/Tools** — the "👁 View
  in Live Sheet" button (shipped earlier today) lived inside "DM tools (private)," a collapsible
  section that's closed by default on a fully-built character's card (same as every other section) —
  so it looked like the button was missing entirely on real characters, only showing on unbuilt
  placeholder cards (which have no collapsible sections at all). Moved it out to the always-visible
  top action row next to "🎯 Skills"/"🛠 Tools" on every cloud character (built or not), shortened the
  label to "👁 View". Award AP/History/Remove/notes stay inside the collapsible section — this is the
  one DM action reached for often enough to not want an extra click for.
- **2026-08-02 · fix(dm-console): dark-mode contrast on the Skills/Tools overlay popups** — the
  per-character "🎯 Skills"/"🛠 Tools" popup (and its own trigger buttons) had a hardcoded white
  background and navy/gray text, so in dark mode it showed as a light card floating on the dark page.
  Added a new `--info`/`--info-bg` theme variable pair (matching the existing `--good`/`--good-bg`
  pattern — there wasn't one for this "blue" highlight before) and switched `.ov-card`, `.ov-x`,
  `.ov-h`, `.ov-sub`, `.sktab` (proficient/expertise row highlighting, borders), and `.skbtn` to the
  theme variables already used elsewhere in this file. Light/dnd/royal/forest are visually unchanged
  (verified pixel-identical computed styles before/after); only dark mode's colors actually change.
- **2026-08-02 · fix(security): background auto-sync no longer caches every character a DM can see** —
  `js/sync.js`'s `syncAll()` (runs automatically on every signed-in page load) queried `characters`
  with no owner filter, relying entirely on RLS — for a DM that meant every player's character in
  every campaign they run got cached locally as routine background behavior. Previously harmless only
  because `listMyCharacters()`'s `dirty` check happened to exclude these downstream, not because the
  fetch itself was scoped correctly. Added `.eq('owner_id', user.id)`, same pattern as
  `listMyCharacters()`. See `decisions/2026/D-GH-2026-08-02-syncall-owner-scope.md`.
- **2026-08-02 · feat(dm-console): read-only "View in Live Sheet" for a player's character** — DM
  Console's cloud roster cards get a "👁 View in Live Sheet ↗" button opening the character's full
  sheet in a new tab, genuinely read-only. Doesn't reuse the existing `?cloudChar=` deep link (that
  makes the character the tab's active/editable one and immediately calls `save()`, risking cross-tab
  corruption of the shared local-autosave slot, and a new trigger for the `listMyCharacters()`
  local-cache leak if "☁ Save to cloud" were clicked). Instead: a new `?viewChar=` link fetches via
  `peekCharacter()` (never touches `localStorage`) and a `VIEW_ONLY` flag gates `emit()`/`save()`/
  `undo()`/`redo()` — the choke points every mutation already routes through — plus hides the controls
  that would otherwise look interactive. See
  `decisions/2026/D-GH-2026-08-02-dm-readonly-livesheet-view.md` (also flags a separate, pre-existing
  `syncAll()` finding worth a defense-in-depth follow-up).
- **2026-08-02 · fix(chargen): clearer message when a redundant invite finds an existing campaign
  membership** — a DM sent a player two invites to the same campaign; the second showed "Could not
  join campaign: You have already joined this campaign," reading as a failure though nothing actually
  went wrong (verified: the player has exactly one character, no data lost). Invites are anonymous
  single-use tokens with no player identity at generation time, so this can't be caught before
  redemption — `tryRedeem()`'s catch block now recognizes this specific case and shows "You're already
  in this campaign — this invite wasn't needed" instead. See
  `decisions/2026/D-GH-2026-08-02-invite-already-joined-message.md`.
- **2026-08-02 · fix(security): "My Characters" local-storage merge no longer resurrects other
  accounts' characters after the server-side leak fix** — a DM still saw 4 other accounts' characters
  on `tools/characters.html` after `listCharacters()`'s owner-filter fix shipped. Root cause was
  client-side: `listMyCharacters()`'s local-storage merge (meant to surface not-yet-synced drafts)
  trusted *any* character cached in `localStorage` by id as "mine," with no ownership check —
  `loadCharacter()`/`reconcile()` caches any character it can fetch (by design, for DM/campaign-role
  reads) with no owner check either, so a character viewed once while the server-side bug was live
  stuck in the local cache forever, on that device, even after the server fix. Now requires
  `dirty === true` (set only by this device's own unsynced `saveCharacter()` calls, cleared on
  successful push) for a local-only entry to count as "mine." Verified via a headless-Playwright unit
  test against the real `js/sync.js`. See
  `decisions/2026/D-GH-2026-08-02-listmycharacters-local-cache-leak.md`.
- **2026-08-02 · chore(release): `BUILD` format corrected to `v<major>.<PR#>` (v1.293)** — follow-up
  to the entry below: after PR #293 merged with `BUILD = "v293"`, clarified the intended format
  includes a manual major/epoch number ahead of the PR number (`v1.293`, not a bare PR number). The
  major is a plain manual value, starting at `1`, carried forward unchanged at every future promotion
  unless a human explicitly bumps it for a relaunch/milestone — never inferred from a promotion's
  contents. Corrected `js/engine.js` and all three tools' mirrors to `v1.293`; updated
  `docs/VERSION-SYNC.md`'s promotion procedure and `AGENTS.md` to match. See the addendum in
  `decisions/2026/D-GH-2026-08-02-build-version-pr-linked.md`.
- **2026-08-02 · docs(versioning): `BUILD` is now the promotion PR number, not a manual counter** —
  `js/engine.js`'s `BUILD` used to be an independently-incremented `v0.10x` string, bumped on an ad hoc
  schedule. It's now `v<N>` where `N` is the GitHub PR number that promotes `preview` → `main` (e.g.
  `v268` for PR #268), set once as part of that promotion PR and never inside a regular feature PR.
  Removes a manual "what's the next number" step (the same shared-mutable-counter hazard already
  documented for the old `D-GH<N>` decision numbering) and makes every build directly traceable to
  the exact PR diff it shipped — `github.com/Chompy78/PACT/pull/<N>` *is* the build. `DATA.version`
  (the separate rules-version axis) is unaffected. Updated `docs/VERSION-SYNC.md` (full promotion
  procedure) and `AGENTS.md`. See `decisions/2026/D-GH-2026-08-02-build-version-pr-linked.md`.
- **2026-08-02 · fix(security): CharGen's/Live Sheet's cloud "Load saved character" menu no longer
  leaks other players' characters to a DM** — live report: "why can I see 4 characters, I should only
  have 1." `js/sync.js`'s `listCharacters()` (used by both tools' ☁ Cloud menu) had no `owner_id`
  filter and relied entirely on RLS, whose `characters_select` policy deliberately also grants a DM
  read access to every character in campaigns they run (needed for DM Console's roster). Confirmed
  live against the production DB: the 4 rows belonged to 4 different Google accounts — other players
  who'd redeemed invites into a campaign the reporting user DMs, not characters they'd created. Deleted
  `listCharacters()` entirely (verified zero other callers) and pointed both cloud-menu call sites at
  the already-existing, explicitly owner-scoped `listMyCharacters()` (already used by `characters.html`).
  See `decisions/2026/D-GH-2026-08-01-dm-console-listcharacters-leak.md`.
- **2026-08-02 · fix(dm-console): cloud roster's "has this character been built yet" check no
  longer false-positives on CharGen's auto-synced default name** — the empty-invite placeholder fix
  earlier today treated a `buy`/`buyoff`/`names`/`name` event as evidence a player had actually
  built something, but CharGen's invite-redemption seed (`_cgApplyEnvelope`, tools/PACT-CharGen-
  Webtool.html ~line 2854) unconditionally re-syncs a `type:'name'` event from the boot-time
  `#cname` field as "back-compat" — even when that field still holds the server-assigned default
  "New Character" the player never touched. Every freshly-redeemed invite therefore already carried
  a `name` event alongside its seed `award`, so it still rendered the full baseBuild()-defaults card
  instead of the placeholder — confirmed live (a real campaign character showing "New Character",
  HP 6, AC 10, Purchases 0). `hasData` now checks for a real `buy` event only, matching the same
  definition the "Purchases" count elsewhere in this file already uses — `name`/`names`/`buyoff`
  events alone no longer count.
- **2026-08-02 · feat(dm-console): AP grant code is now per-character, both bottom panels are
  collapsible** — two live-testing follow-ups. (1) "AP grant code" (`#grantPanel`) generated one code
  for the whole party at one shared amount; it's now a `<details>` (collapsed by default, like the
  import panel) listing every character currently loaded (local imports + cloud roster, including
  not-yet-built placeholders) with a tick-box and its own amount field, so a DM can grant different AP
  to different players in one pass — "Generate code(s)" produces one code per ticked character, each
  shown with its own Copy button. (2) The "Campaign (cloud)" panel (`#campPanel`) is now also a
  `<details>` (open by default, since it hosts sign-in/campaign-select) — the collapse mechanics
  (chevron, marker suppression) were generalized from `#importPanel`-only CSS to a shared
  `details.panel` selector so all three bottom panels collapse identically.
- **2026-08-02 · fix(dm-console): cloud roster card no longer shows a fake "fully built" character for
  an unopened invite** — a freshly-redeemed player invite's LOG holds only the seed `award` event (no
  `buy`/`names`/`name`), but `cloudAnalyze()`'s `hasData` check only verified the LOG was an array, so
  it ran `dmAnalyze()` anyway and rendered a full card off `baseBuild()`'s bare engine defaults (Human
  Fighter, HP 6, AC 10, Speed 30′…) as if the player had actually chosen them — the exact "card just
  says 'New Character', no real details" reported from live testing. `hasData` now requires at least
  one real build event in the LOG; without one it falls back to the existing "No character data yet"
  placeholder, which already existed for this case but was never reached.
- **2026-08-02 · fix(dm-console): Table/Card view toggle now covers the cloud roster, dark-mode
  contrast on card headings/stat-strip/section-rows, collapsible local-import card** — four bugs from
  live testing. (1) Clicking "Table view" visibly did nothing for a DM with only cloud (campaign)
  characters loaded — the toggle only ever drove `#grid`/`#tableRoot` from the local `roster` array;
  `#campRoster` (cloud cards) was a separate container it never touched. Table view now merges local +
  cloud data (`_combinedRoster()`/`_rows()`/`_idOf()`), and `#campRoster` itself switches between its
  own rich cards and stepping aside for the shared table. Cloud roster is also now cleared on sign-out
  and campaign deselection, so stale data can't leak into a later Table view. (2) The 6 stat-strip boxes
  (HP/AC/Speed/Pass Perc/Prof/Save DC) had a hardcoded near-white background (`#fafcff`) instead of a
  theme variable, so in dark mode they stayed white while their (theme-aware) text went light-on-light.
  (3) Several card-view text colors (`.cname`, `.secrow`, `.kvrow .vv`, `.summary b`,
  `#campSection .cstitle`) used `--navy` directly, which dark mode redefines to a near-black shade for
  its OWN use as a *background* (header gradient, buttons) — unreadable as foreground text on the
  also-dark card background it actually sits on. Added a new `--heading` variable (indirects through
  `--navy` so dnd/royal/forest need no change; dark mode gets an explicit light override) and swapped
  those five selectors to it; also fixed `.secrow:hover`'s hardcoded near-white hover background the
  same way. (4) The redundant "Drop your players' exported .json files here" banner (`#empty`, shown
  above the Campaign Roster whenever no local file was imported — which is always, for a DM working
  purely from the cloud) is removed; the dropzone and "Import roster" panel are merged into one
  collapsible `<details>` card (collapsed by default), decluttering the page for the common case.
  Verified via headless Playwright against the real DM Console code (toggle with cloud-only data,
  dark-mode screenshot before/after, light-theme regression screenshot, collapsed/expanded import card,
  file import still working nested inside `<details>`); `engine-parity-ci.mjs` 20/0 and
  `random-manual-e2e.mjs` green (no `js/engine.js` change).

- **2026-08-01 · docs(agents): fix two more stale `AGENTS.md` bullets referencing removed
  `buildToLiveLog()`/`_lsImportFold`** — verified in `tools/PACT-CharGen-Webtool.html` (code comment at
  the old call site: "D-GH40: buildToLiveLog()/exportToLiveSheet() removed") that CharGen's last local
  `MUT` closures were deleted along with the whole dedicated-export path, not just superseded. Corrected
  the High-risk-files bullet, the Architecture MUT-bridging paragraph (CharGen's `MUT` is now fully
  bridged like the other two tools, no local exceptions), and the old "CharGen → Live Sheet export
  (D-GH3)" bullet to describe the current mechanism (shared save envelope + `switchToLiveSheet()`
  handoff, D-GH38). Docs-only.

- **2026-08-01 · docs(agents): fix stale `AGENTS.md` Persistence bullet describing `characters.stats`** —
  same pre-D-GH40 claim as the `sql/schema.sql` fix above ("CharGen = a flat build JSON; Live Sheet =
  an event log"), corrected to describe the one shared `{schema:'pact-character/1', ...}` envelope both
  tools have used since 2026-07-10. Docs-only.

- **2026-08-01 · docs(schema): fix stale `sql/schema.sql` comments describing `characters.stats`** —
  the header design notes and the `stats`/`kind` column comments still described the pre-D-GH40 state
  (CharGen = flat build JSON, Live Sheet = event log). Since D-GH40 (2026-07-10) both tools share one
  canonical envelope, `{schema:'pact-character/1', rules, name, LOG, SEQ, id}`; `kind` now only marks
  which tool owns/opens a character, not a different data shape. Docs-only, no schema/DDL change.

- **2026-08-01 · feat(dm-console): cloud campaign roster now renders as full character cards, plus
  "remove from campaign" and DM-private per-character notes** — three linked gaps found live-testing:
  (1) cloud (campaign) characters showed in a bare Player/Character/DM-AP table, not the rich card
  view local `.json` imports get. `#campRoster` now renders through the exact same `cardHTML()` /
  `buildSections()` / `analyzeAug()` pipeline as the import grid (full stats, skills, spellcasting,
  etc.), sharing the `[data-sk]`/`[data-tools]`/`[data-known]` overlay handlers via a small
  `findRosterEntry()` lookup that checks both rosters. (2) there was no way to remove a character from
  a campaign at all — `characters.campaign_id` had no "unset" path (only `join_campaign()` /
  `bind_character_to_campaign()` ever set it). Added `dm_unbind_character()` (SECURITY DEFINER RPC,
  mirrors `award_ap()`'s shape) — a soft "kick": the character and its data/AP survive, it just leaves
  the campaign's roster; exposed as a "Remove from campaign" button with a confirm dialog, deliberately
  *not* the local grid's quick corner "×" (that one's trivially reversible; unbinding isn't). (3) added
  DM-only player-name label + freeform notes per character, editable inline on each cloud card and
  saved via `setCharacterDmNotes()`. Stored in a new `character_dm_notes` table (not new `characters`
  columns — a blanket `select` grant on `characters` means any new column there would be visible to the
  character's own owner the moment their row passes RLS; a separate table with its own DM-only policy
  avoids that). DB migration applied to the live project + verified via `get_advisors` (no new issues).
  See `decisions/2026/D-GH-2026-08-01-dm-console-cloud-roster.md`.

- **2026-08-01 · feat(engine, chargen): warn when a Tradition has no Discipline chosen (`DATA.version`
  v0.336 → v0.337)** — a Tradition ("Arcane"/"Divine"/"Primal") with every discipline slot left at
  "(none)" was priced as a complete no-op: `compute()` skipped it entirely (no Foundation cost, no line
  items) with zero indication anything was incomplete. `js/engine.js` now pushes a
  `"<Tradition>: no Discipline chosen — pick one to activate this Tradition…"` warning for this state,
  which surfaces automatically as a real ⚠ issue (not an advisory ⓘ) in every tool's warnings/Issues tray
  since they all read `compute()`'s `warnings` live. CharGen additionally shows an inline red "⚠ No
  discipline chosen" marker directly on the empty discipline row (`tools/PACT-CharGen-Webtool.html`'s
  per-discipline render block), since that's the one tool where this state is actually reachable
  (Live Sheet's discipline buy buttons always target a named discipline). Bumped `DATA.version` because
  this changes `compute()`'s possible `warnings` output; the 20 parity fixtures don't exercise this state
  so `testing/expected/` needed no changes — confirmed 20/0 before and after. Mirrored the new version
  string into CharGen's hardcoded cosmetic labels (header comment, `<title>`, `#cgPactver`) and
  `docs/AI_review_prompt.md`.

- **2026-08-01 · fix(chargen): half-caster discipline cantrip picker silently discarded selections** —
  reported live: picking a cantrip count for a Paladin/Ranger discipline in CharGen showed a priced,
  fully-clickable dropdown but added no ledger line and deducted no AP. Root cause: `js/engine.js`'s LOG
  replay correctly zeroes `cantrips` for any discipline in `DATA.noCantrip` (half-casters can't take
  cantrips) on every fold, but `tools/PACT-CharGen-Webtool.html`'s `.disc-cant` `<select>` had no matching
  UI guard — Live Sheet already avoids this by simply not rendering the Cantrip buy button for these
  disciplines. Fixed by disabling the select and resetting its displayed value to 0 whenever the current
  discipline is in `DATA.noCantrip` (covers both picking a half-caster discipline directly and switching
  an existing discipline into one), with a tooltip explaining why. No `js/engine.js`/`compute()` change —
  reproduced and verified via a headless Playwright drive of the real CharGen UI (stubbed Supabase CDN
  import); `testing/tests/engine-parity.html` still 20/0.

- **2026-08-01 · feat(dm-console): restructure the Campaign (cloud) panel into per-purpose tiles, add DM
  notes, alphabetize banned lists** — the panel had grown into one long undifferentiated block. Split it
  into visually distinct nested tiles in order: Owner settings (ignore player-entered AP) → Invite new
  player (player/DM codes + invite generator) → Campaign Rules (banned lists, multi-discipline toggle,
  house rules) → Level budget curve / award pace / starting tier → a new DM notes tile (free-text,
  campaign-scoped, stored in the same `campaigns.rules` JSONB column as `rules.dmNotes`, own "Save notes"
  button) → New campaign / archived campaigns, with "Archive campaign" moved to the bottom of that tile.
  All seven banned-item grids (`ruleBannedSpecies`/`…OriginSpecies`/`…OriginClasses`/`…Masteries`/
  `…Boons`/`…Drawbacks`/`…Arts`) now render alphabetically instead of DATA's declaration order. No IDs
  renamed, no `js/engine.js` change; verified with a headless screenshot of the real page.

- **2026-07-29 · docs: correct every stale file-size figure in the read-budget guidance** — `AGENTS.md`'s
  "Don't read large files wholesale" section had a wrong number in each entry, and the same wrong number
  was reaching external reviewers. Measured: `js/engine.js` is **~66 KB / 924 lines**, not ~237 KB — that
  figure predated REV-14a splitting the `DATA` blob into `js/engine-data.js` (**~189 KB on ~13 lines**),
  which is the genuinely expensive file in `js/` and wasn't in the list at all. Also
  `docs/PACT-Players-Guide.html` **~1.4 MB** (listed as ~657 KB) and `tools/*.html` **~127–376 KB**
  (listed as "320–520 KB each"). Fixed in all three *live* locations — `AGENTS.md`, `js/engine.js`'s
  header comment, and `docs/AI_review_prompt.md`, the template used to commission external engine
  reviews, which described the file as "~237 KB (mostly a large DATA blob)" and so primed reviewers to
  misjudge it (the review behind the perf work below came from that template). The list now carries its
  measurement date and says to re-measure rather than trust it. Historical mentions in
  `decisions/2026/D-009.md`, the PWA-migration record, `docs/sessions/*` and the changelog archive were
  deliberately left alone — those figures were correct when written. See addendum in
  `decisions/2026/D-GH-2026-07-29-file-review-4plpe3.md`.

- **2026-07-29 · perf(engine): make LOG replay linear, drop a redundant `activeEvents()` pass** —
  acted on an external perf review of `js/engine.js` after verifying and benchmarking each claim.
  (1) `_replay()`'s nine single-instance proficiency lists were deduped with
  `filter((v,i) => arr.indexOf(v) === i)` — a full rescan per element; now `[...new Set(arr)]`, same
  first-occurrence order, O(n) instead of O(n²): **`foldBuild()` on a 2000-event log went 6.48 ms →
  0.44 ms (~14.6×)** and is now linear rather than quadratic in log length. (2) `foldBuild()` and
  `rebuildStateFromEvents()` each ran `activeEvents()` twice (once via `_replay()`, once via
  `economy()`); `_replay()` now returns its snapshot and a private `_economyFrom()` tallies from it —
  worth ~23% of a fold at 500 events, with **no change to public `economy(events)`**, which stays
  single-argument for the three tools that bridge it. (3) `b.unlockedClasses` (four loops),
  `b.racialTraits` and `skillList` membership tests now use a Set built once instead of a per-iteration
  `indexOf` scan. Two of the review's suggestions were **measured and rejected**: `structuredClone`
  (its top-ranked item) is 1.9–3.1× *slower* than the JSON round-trip for every shape this engine
  clones and cost ~20% on `rebuildStateFromEvents()`, and caching `DATA.*` in locals was unmeasurable
  (V8 inline caches) — `clone()` now carries an inline note recording the benchmark so it isn't
  "modernized" again. Async Web Crypto signing was rejected as breaking `_sha256hex`'s documented
  synchronous/`file://` constraint. No behaviour change: parity **20/0**, `log-fuzz` 3000 iterations
  clean, plus a differential test against the pre-change engine over the fixtures and 4000 random LOGs
  (**20,021 checks, 0 mismatches**). `DATA.version` and `BUILD` deliberately unchanged — no mechanics
  or user-visible change. See
  `decisions/2026/D-GH-2026-07-29-file-review-4plpe3.md`.

- **2026-07-29 · docs: fix `/make-code-cold-plan-review` Step 7 triage gap + sync `docs/SKILLS.md`** —
  `/code-review` on PR #276 found two issues in the previous same-day change: (1) Step 7 had no defined
  action for a `blocking`-severity finding that reviewers agreed on and that hit none of the four explicit
  stop-and-ask triggers, and separately left it ambiguous whether "reviewers disagreeing" was an
  unconditional stop-trigger or only when the new disinterested-agent pass failed to resolve it. Fixed by
  making `blocking` findings always return to the user for the final call (even once the agent pass
  confirms them), and making unresolved disagreement an unconditional stop while a resolved
  minor/moderate disagreement may be applied directly. (2) `docs/SKILLS.md`'s "cold-review loop" section and
  skill-reference bullet, the human-readable authority on this skill, hadn't been updated alongside the
  prior change — now describes the cross-vendor guidance, adversarial/severity-confidence framing,
  disinterested-agent second opinion, and structured outcome table. See addendum in
  `decisions/2026/D-GH-2026-07-29-custom-skills-commands.md`.

- **2026-07-29 · docs: strengthen `/make-code-cold-plan-review` with cross-vendor, adversarial, and
  consensus-matrix guidance** — based on research into cross-model code/plan review practice (see
  `decisions/2026/D-GH-2026-07-29-custom-skills-commands.md`): (1) Step 4 now explicitly tells the user to
  prefer a reviewer from a different vendor family than the plan's author, since same-family review repeats
  its own blind spots; (2) the generated "Reviewer instructions" section now asks the reviewer to actively
  try to refute the plan (not just "check it over") and to tag each finding with a severity
  (blocking/moderate/minor) and confidence (high/low); (3) the "Review outcome" stub is now a structured
  table (finding, severity, confidence, raised-by, cross-family agreement, disposition) instead of a
  free-text summary; (4) Step 7's triage now sends any `blocking`-severity or reviewer-disputed finding to a
  fresh, context-free `Agent` call for a disinterested second opinion before the plan's own author decides,
  to avoid the same session grading its own homework. Added `Agent` to the command's `allowed-tools`.

- **2026-07-28 · docs: migrate DECISIONS.md/CHANGELOG.md/docs/TASK_BOARD.md to the split-file pattern** —
  `DECISIONS.md` (371,703 bytes, 112 full records + 1 orphaned index-only entry) is now a thin index over
  `decisions/2026/D-*.md` (41,077 bytes live). `docs/TASK_BOARD.md` (35,953 bytes) split into
  `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by its existing bands. `CHANGELOG.md` (271,870 bytes, 281
  entries) rotated everything older than 2026-07-17 into `docs/CHANGELOG-archive-2026-06-29-to-2026-07-16.md`
  (238 entries, ~233KB), keeping 43 entries live (~40KB) — extending this project's own pre-existing
  `docs/history/CHANGELOG-full.md` rotation precedent (D-002/D-003) rather than inventing a new pattern for
  changelog entries specifically. Also fixed `docs/dev-status.html`'s live client-side fetch/parse of the
  task board (it fetched a single `TASK_BOARD.md` at runtime; now fetches and merges all three band files)
  and updated every other file with a hardcoded `docs/TASK_BOARD.md` reference (`AGENTS.md`,
  `.github/copilot-instructions.md`, `.github/pull_request_template.md`, `docs/SKILLS.md`,
  `docs/HOW-TO-WORK.md`, `docs/roadmap.html`) — `.claude/commands/*.md` needed no changes, already
  hardened for either file shape by `D-GH-2026-07-28-command-format-agnostic`. Every-session-relevant read
  path (AGENTS.md + DECISIONS.md + TASK_BOARD_NOW.md + live CHANGELOG.md) dropped from ~705KB to ~109KB
  (~85%). See `DECISIONS.md` D-GH-2026-07-28-decisions-changelog-task-board-split for the full rationale.
- **2026-07-28 · docs: add 'technical access != scope' rule** — Added a "Technical Access ≠ Scope" section
  to `AGENTS.md`, after direct testing on Home AI Server confirmed a session with broad, non-enforced
  access would cross into a different project's files if asked. See `DECISIONS.md`
  D-GH-2026-07-28-technical-access-not-scope.
- **2026-07-28 · docs(commands): make task-board/decisions commands format-agnostic** — hardened all 7
  `.claude/commands/*.md` files that read or write `docs/TASK_BOARD.md`/`DECISIONS.md` to check for the
  split-file shape (`TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md`, a thin `DECISIONS.md` index over
  `decisions/<year>/D-*.md`) before assuming today's single-file layout. No content migration — this
  project's own `DECISIONS.md`/`CHANGELOG.md` are still the current single-file shape, tracked as their
  own future task. See D-GH-2026-07-28-command-format-agnostic.
- **2026-07-26 · fix(dm-console): sticky header down to one row, theme dropdown readable** — the sticky
  `header.topbar` stacked title/summary/last-edited/actions as separate block elements (~4-5 rows); moved
  the summary/last-edited line into a new non-sticky `.subbar` right below it, and made the header itself
  a single flex row (home link, title, actions) — sticky scroll now only ever pins that one ~53px row.
  Separately, `#dmThemeSel`'s native `<option>` popup inherited the closed box's white text with no
  explicit background, rendering white-on-the-browser's-default-white in every theme; added
  `#dmThemeSel option{color:#1F3864;background:#fff}` so the list is readable regardless of the header's
  current `--navy`/`--blue` (which only paint the closed box, never the native popup).

- **2026-07-25 · docs(add-code-task): drop the pre-commit approval gate** — `/add-code-task` now shows the
  drafted task block and proceeds straight to committing it to `docs/TASK_BOARD.md` in the same turn,
  instead of waiting for an explicit "yes"/"looks good" first (D-GH-2026-07-25-add-task-drop-approval-gate).
- **2026-07-25 · feat(characters): "My Characters" page — archive/delete, campaign grouping, open-in-tool
  deep links** — new `tools/characters.html`: every cloud-saved character (CharGen + Live Sheet) in one
  signed-in, online-only view, grouped by campaign name (via `listMyCampaigns()`) with a "No campaign"
  bucket, and a "Show archived" toggle (archived rows hidden by default). Each row: Open in CharGen/Live
  Sheet (disabled with an "empty" tag for `hasData:false` rows), Archive/Unarchive (reversible), and —
  only once archived — Delete permanently (uses the existing, previously UI-less `deleteCharacter()`).
  `js/sync.js` gained `listMyCharacters()` (owner-scoped, unlike `listCharacters()` which also returns a
  DM's-eye view via `is_campaign_dm`), `archiveCharacter()`/`unarchiveCharacter()`. DB: `characters` gained
  `archived_at timestamptz` + `grant update (archived_at) on characters to authenticated` — no RPC needed,
  unlike `campaigns.archived_at`, because `characters_update`'s RLS is already owner-only (see
  D-GH-2026-07-25-character-archive). CharGen and Live Sheet both gained a `?cloudChar=<id>` boot-time deep
  link (each tool's existing cloud-load logic extracted into a shared `loadCloudChar(id,label)`, called by
  both the menu click and the new boot handler) so the new page's "Open in ..." buttons can hand off to a
  specific saved character. Discoverability: a "📋 My Characters" link in each tool's ☁ Cloud menu, plus a
  card on `index.html`.
- **2026-07-25 · fix(sync, live-sheet, chargen): "No character data found" on cloud-load** — reported as
  every entry in Live Sheet's "Load saved character" list failing with this error. Root-caused against
  the **live database** (not just code): all 4 affected rows had `stats` = `{}` or `{"note":"hello"}` —
  pre-launch test/stub data with no `LOG` array, not corrupted real saves. Deleted the 4 stub rows
  (`piuprrrnaotrtxucrtsb`, table `characters`). Separately hardened both tools against this class of row
  recurring (e.g. a redeemed player invite a player never opened): `js/sync.js`'s `listCharacters()` now
  selects `stats->LOG` and returns a `hasData` flag per character; both CharGen's and Live Sheet's
  cloud-load menus render a `hasData:false` row as an inert, greyed "empty" entry (shown, not hidden — a
  player should still be able to see it exists) instead of a clickable button that resolves to the
  generic error after the user already committed to loading it. Verified end-to-end in a real browser
  (both tools) with a mocked signed-in session carrying one real and one stub character: the stub renders
  as a non-interactive `<div>` with no click handler attached, the real one still loads correctly.
  Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): "Award" button silently clipped off-screen on narrow viewports** —
  reported as "no button to push AP to players." Reproduced: the Campaign Roster's Award AP cell needs
  ~250px for its amount/note/button row, but `#campRoster table{width:100%}` forces the table to fit
  its container regardless, and `#campRoster{overflow:hidden}` (there for the rounded corners) silently
  clips whatever doesn't fit instead of wrapping or scrolling — confirmed via a real headless-browser
  render at 320-414px widths that the Award button's bounding box extended well past the visible
  container, while the amount input (visible) stayed in view, matching exactly what was reported. Fixed
  by wrapping the table in its own `.roster-scroll` (`overflow-x:auto`, table `min-width:560px`) so
  narrow viewports scroll horizontally to reach Award/History instead of losing them — verified the
  scroll region activates, the button becomes reachable and clickable after scrolling, and desktop
  widths are unaffected (button was already fully visible there). Display-only; no `DATA.version` bump.

- **2026-07-25 · fix: favicon on every remaining HTML page** — follow-up to the index/DM-Console
  favicon fix. Swept every `.html` file in the repo (`find . -iname "*.html"`, excluding
  `docs/history/` archives) and added the same `assets/icons/PACT_favicon.png` `<link rel="icon">` to
  the 9 that still had none: `login.html`, `404.html`, `docs/PACT-Players-Guide.html`,
  `docs/dev-status.html`, `docs/roadmap.html`, `testing/campaign-test.html`, `testing/sync-test.html`,
  `testing/tests/engine-parity.html`, `testing/tests/sync-timestamp.html` — relative path depth adjusted
  per file's location. `docs/PACT-Players-Guide.html` edited via a targeted `Edit` (not a full read) per
  its own "never read wholesale" note — confirmed the exact existing `<link>` text via a 1-line `Read`
  first. Verified every page+icon pair resolves 200 via both direct HTTP requests and a real browser
  (favicon request observed firing from each page's actual served location) — `404.html`'s favicon
  request couldn't be observed in the local test harness because the page's existing
  `window.location.replace()` redirect fires immediately (expected; it correctly returns to `/PACT/` on
  the real site), but the `<link>` tag itself and direct icon fetch both confirmed present/200.
  Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(index, dm-console): consistent browser-tab favicon across the whole app** —
  `index.html` had its own one-off inline SVG "P" emblem (a different icon than every other page); DM
  Console had **no** `<link rel="icon">` at all (a deliberate omission from an earlier favicon pass —
  D-GH-2026-07-19-pwa-manifest-icon-coverage — now reversed at explicit request). Both now use the same
  `assets/icons/PACT_favicon.png` CharGen/Live Sheet already use (relative path, matching those two
  tools' existing convention). Verified via real HTTP requests (not just file existence) that the
  favicon resolves with a 200 from both pages' actual served locations. `login.html` still has no
  favicon — out of scope of this ask, left alone. Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): Campaign panel on its own row; Import Roster dims when a cloud
  campaign is active** — `#campPanel` had no explicit flex-basis (`flex:1 1 300px`), so at wide enough
  viewports it could sit alongside Import Roster/AP Grant Code instead of getting its own row, despite
  being the longest of the three panels. Changed to `flex:1 1 100%` (matching the `#drop` drop-zone's
  existing "always its own full row" pattern) — Campaign now always renders below the other two,
  full-width. Separately: Import Roster (local `.json` drag-drop) and a loaded cloud campaign's live
  roster are two independent, coexisting features — confirmed neither UI state hides the other
  (`selectCampaign()` never touches `#grid`/`#empty`). Reported as confusing which one "is" the
  campaign; added a `dimmed` class (opacity .55, full opacity on hover) toggled on `#importPanel`
  whenever a campaign is selected, plus a small clarifying note — dims rather than disables, since
  local-file review alongside an active campaign remains a legitimate use. Verified in a real browser
  (both themes, wide viewport) with a full mocked Supabase session exercising the actual
  `selectCampaign()`/`updateAuth()` code paths. Display-only; no `DATA.version` bump.

- **2026-07-25 · feat(dm-console): boon/drawback tooltips in Campaign Rules banned-lists** — the
  "Banned boons"/"Banned drawbacks" checkbox grids showed only names, no description of what each
  actually does. Added an optional 3rd element to `RULE_GRIDS` entries (a per-name tooltip-text
  function) and a conditional `title=` attribute in `renderRuleGrids()`'s shared render template —
  reads `DATA.boons[name].fx` / `DATA.drawbackFx[name]` directly (the same data every other tool
  already reads for these descriptions; confirmed via research that CharGen/Live Sheet already
  normalize both maps to a common `.fx` shape and CharGen's racial-trait checkboxes already use the
  identical `title=`-from-DATA pattern), so there's exactly one source of truth and no new text to
  keep in sync. Also investigated adding a symmetric "banned as 2nd origin classes" list to mirror
  "2nd origin species" — found it would be a no-op: `validate()` already bans a class in both
  `originClass`/`originClass2` slots via the single existing `bannedOriginClasses` list; species has
  a *second*, asymmetric list only because it also supports an "okay as primary, not as bonus 2nd"
  case that classes never had modeled. Logging the asymmetric-class-ban feature as a separate task
  rather than building it here (a real engine design decision, not this task's scope). Verified
  end-to-end in a real browser with a full mocked Supabase session (not just CSS, this time — the
  actual `campaign-ready`-gated render path executed): 88/88 boons and 69/69 drawbacks carry correct
  tooltip text; the five unaffected grids (species, 2nd origin species, origin classes, masteries,
  arts) confirmed to have no `title=` regression. Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): campaign-panel polish — layout order, code tooltips, oversized fields**
  — Three follow-ups from live feedback on the campaign create/archive feature. (1) "New campaign" and
  "Archived campaigns" moved from the top of the Campaign panel (shown before any selected-campaign detail,
  confusing on every load) to the bottom, in that order — selected-campaign details now show first. (2)
  Added a small ⓘ button next to the Players/DMs invite codes (hover *or* click, matching existing
  `title`-attribute hint patterns like `.warnicon`/`.tamper` elsewhere in this file) explaining what each
  reusable code does — while wiring this up, confirmed `joinAsDm()` (the co-DM redemption RPC) has no
  consuming UI in *any* tool, same class of dead-code gap `createCampaign()` had before this session; not
  fixed here, flagged to the user as a possible follow-up task. (3) `body` never set an explicit
  `font-size`, so every `.field` input and non-`.sm` `.btn` (which both use `font:inherit`) fell back to
  the browser default (~16px) against the rest of the UI's deliberate 11–14px scale — reported as
  "Starting DM AP"/"Starting Budget AP" (invite-form placeholders) looking oversized, but affected every
  `.field`/plain `.btn` in the tool. Fixed at the root with one `body{font-size:14px}` rather than
  patching each selector. All three verified in a real browser — including, for the first time this
  session, with the `campaign-ready`-gated JS (create/archive/info-button click handlers) actually
  exercised via a stubbed `supabase-client.js` import (this sandbox has no network path to esm.sh, so
  earlier same-session screenshots only verified CSS/layout, not click wiring — noted for the record).
  Display-only; no `DATA.version` bump.

- **2026-07-25 · feat(dm-console): add theme selector (Default/Dark/D&D·Parchment/Royal/Forest)** — DM
  Console had zero UI to change theme (only ever picked up dark mode from OS `prefers-color-scheme`,
  no way to override it, and none of Live Sheet/CharGen's other 3 themes existed there at all). Added a
  `<select id="dmThemeSel">` in the top bar (matching Live Sheet/CharGen's existing `#themesel` pattern),
  a `dmSetTheme()` persisting to `localStorage['pact-dm-theme']`, and three new `[data-theme]` variable
  blocks (`dnd`/`royal`/`forest`) mapped onto DM Console's own token set (`--navy`/`--navy2`/`--blue`/
  `--blue-lt`/`--light`/`--paper`/`--card`/`--ink`/`--muted`/`--line`/status-color pairs) — colors chosen
  to match the other two tools' equivalent themes where a direct token existed, derived consistently
  from the existing `default`/`dark` blocks' pattern where DM Console has extra tokens the others don't.
  Verified all 5 themes in a real browser (init script, live switch, and page-reload persistence) —
  campaign panels/buttons from the two contrast fixes above render correctly in every theme, confirming
  those fixes were token-based rather than color-literal. Display-only CSS; no `DATA.version` bump.

- **2026-07-25 · feat(dm-console): create + archive/unarchive campaigns** — DM Console had no way to
  create or remove a campaign. Wired up the existing (previously dead-code) `createCampaign()` behind a
  new "+ New campaign" row, and added reversible archive (not hard delete — see D-GH-2026-07-25-
  campaign-archive for why) via new `archive_campaign()`/`unarchive_campaign()` RPCs, an "Archive
  campaign" button (owner-only, confirm-gated), and an "Archived campaigns" panel with per-row Unarchive.
  New `campaigns.archived_at` column, genuinely owner-only via a column-level UPDATE grant lockdown
  (mirrors `characters.ap`'s existing pattern) — closes a gap where the previous blanket grant would have
  let any co-DM write it directly. Applied live via Supabase MCP (`get_advisors` clean beyond the
  standard boilerplate every RPC here already has), persisted as
  `sql/migrations/2026-07-25-campaign-archive.sql` + `sql/schema.sql`/`sql/rls-policies.sql`. Also fixed
  `.btn.ghost` (Copy/Unarchive buttons), found unreadable in light theme while verifying the new UI —
  same root cause as the panel/dark-theme fixes below. Display-only CSS; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): dark-theme contrast — buttons, chips, table headers, and field
  values were unreadable** — follow-up to the panel/label fix below. Root cause: `[data-theme="dark"]`'s
  `--light` custom property was `#475569` (a medium slate), nearly the same luminance as `--navy`
  (`#0f1729`) and `--blue` (`#1a3a5c`) in dark mode — so every component pairing `--light`+`--navy`
  (`.btn`, `.chip`, `.card .csub .tier`, `#tableRoot table.awards th`/`.badge`, `#campRoster th`) and the
  header's own `.summary` subtitle text collapsed to ~1.5:1 contrast (WCAG AA needs 4.5:1). Fixed by
  changing dark theme's `--light` to an actually pale value (`#c9d6ec`) — one token, fixes every affected
  component at once (verified: Sign in/Generate code/Copy/Save rules buttons, roster table headers,
  tier/award badges). Separately, `.field`/`#campSel` had a hardcoded near-white background (both themes)
  but `color:var(--ink)` (theme-varying — light gray in dark mode), so typed/selected values were
  near-invisible; changed to `color:var(--navy)`, matching the already-correct convention its sibling
  `.field.ro` uses for the same fixed-light-background pattern. `#tableRoot`'s own locally-scoped
  variables (always light, by design, unaffected by `[data-theme]`) were left untouched. Display-only,
  no `DATA.version` bump; verified visually in both themes via headless screenshot.

- **2026-07-25 · fix(dm-console): panel/label text illegible against its own card background** —
  `#importPanel`/`#grantPanel`/`#campPanel`'s `.ptitle`, `label.lbl`, `.grantnote`, and ~15 similar
  Campaign-Rules labels/notes used `var(--light)` (a pale near-white blue) as text color, styled for the
  navy hero header they were copy-pasted from — but these panels actually sit in `<main>` on the light
  `--paper` background, making the text nearly invisible (reported: "AP grant code" / "Amount" / "Note
  (optional)" / the whole-party grant note unreadable). Fixed by giving `.panel` a proper card treatment
  (`--card` background, `--line` border, `--shadow`, matching `.card` elsewhere) and switching all
  panel-scoped label/note text to `--muted` (checkbox labels to `--ink`), the same variables already used
  for equivalent labels elsewhere in this tool (`.xtra .xlabel`, `.cglabel`). `.hrchip` house-rule chips
  got a real chip background (`--paper`/`--line`) for the same reason. Display-only CSS/JS-template
  change — no `DATA.version` bump. Verified visually in both light and dark theme via a headless
  screenshot. Left the header's own (correctly-placed) `--light` text and the pale-bg/navy-text chip
  components (`.chip`, table headers, badges) untouched — a separate, unreported low-contrast issue
  affecting those chips/buttons and `.field` input values specifically in dark theme was noticed but not
  fixed here (out of scope of the report); worth a follow-up task if it bothers users in practice.

- **2026-07-21 · docs(sessions): corrected the 2026-07-20/2026-07-21 date-labeling mistake** — fixed
  everywhere across `family-hub`, `wildlife-explorer`, and PACT's own two session notes about them:
  decision IDs, `CHANGELOG.md` entry dates, and session-note filenames. Left every reference to the
  *other*, genuinely-pre-existing `2026-07-20` dates untouched in both target repos (family-hub's
  original Copilot planning session, wildlife-explorer's Milestone-5 planning log) — those are real,
  not mislabeled. Also left the two decision IDs a separate, concurrent status-review session added to
  wildlife-explorer (`D-2026-07-20-web-session-branch-override`, `D-2026-07-20-branch-model-confirmed`)
  untouched — no basis to assume those are wrong too. Done as new commits in each repo, not history
  rewrites, since `family-hub`'s and `wildlife-explorer`'s originals were already pushed.

- **2026-07-21 · docs(sessions): light-ported the memory-layer scaffold to a fifth repo,
  PACT_Players**: a Quartz-based campaign-content site, not a software project — full scaffold skipped
  (no `AGENTS.md`, no Effort/Risk task board), only `CHANGELOG.md`/`DECISIONS.md`/`sessions/` (repo-root,
  not `docs/sessions/` — that's Quartz's own vendored docs) plus 4 of 8 skills. Mid-port, discovered a
  concurrent session had already authored a real `TASKS.md`; adopted it rather than overwriting with a
  placeholder. Also caught (not yet fully corrected) a session-wide date-labeling mistake — this and the
  prior two ports were mislabeled `2026-07-20` when the actual date was `2026-07-21`. See
  `docs/sessions/2026-07-21-port-agents-scaffold-to-pact-players.md`.

- **2026-07-21 · docs(sessions): ported the AGENTS.md/skills scaffold to a fourth repo,
  wildlife-explorer**: additive, not build-fresh — unlike family-hub (ported moments earlier the same
  session), this repo already had a real governance file (`AI.md`) and a genuinely working
  `npm run check` test/build/encoding-audit gate, so `AGENTS.md` was scoped as a thin process-layer
  supplement rather than a competing entry point; `AI.md` was left completely untouched. Confirms a
  "three independent axes" shape space (governance layer / product docs / real verification gate, each
  present or absent independently) rather than a simple blank-vs-mature spectrum. Nothing in PACT itself
  changed beyond this session note; see
  `docs/sessions/2026-07-21-port-agents-scaffold-to-wildlife-explorer.md` for the full detail
  (target-repo decisions logged in wildlife-explorer's own `DECISIONS.md`).

- **2026-07-21 · docs(sessions): ported the AGENTS.md/skills scaffold to a third repo, family-hub**:
  same manual copy-and-adapt pattern as the `petdetective`/`homelife` ports, done directly against the
  local clone at `C:/Users/user/dev/family-hub`. A genuinely third target-repo shape — not blank-slate,
  not mature-with-conflicting-conventions, but rich product-planning docs with zero AI-workflow
  governance layer. Nothing in PACT itself changed beyond this session note; see
  `docs/sessions/2026-07-21-port-agents-scaffold-to-family-hub.md` for the full detail (target-repo
  decisions logged in family-hub's own `DECISIONS.md`, not duplicated here).

- **2026-07-20 · feat(tooling): close-code-session stages/commits/pushes once you approve the letter**:
  removed the `git add`/`git commit`/`git push` tool restriction at the user's explicit request — Part 3
  now surfaces "stage, commit, and push" as one of its lettered follow-ups and runs it once approved,
  instead of only ever printing the command for manual hand-off. The shared-checkout mitigation (never
  `git add -A`/`.`, always name exact files, re-check `git status` right before staging) is unchanged and
  still applies regardless of who runs the add. Merging, rebasing, resetting, and deleting are still always
  disallowed. See `D-GH-2026-07-20-close-code-session-run-commit`.

- **2026-07-20 · chore(repo): swept 126 stale remote branches + 6 local worktree remnants**: local
  cleanup removed 1 merged local branch/worktree (`feat/clone-char-standalone`, its lock stale — the
  claimed PID wasn't running) and 5 orphaned `.git/worktrees/` admin dirs left over from past
  `ExitWorktree` runs that never fully cleaned up (these were also the cause of the "Permission
  denied" noise on every `git fetch` this session and prior sessions — resolved). Remote cleanup
  classified all 129 `origin/*` branches against their PR history (`main`/`preview` never touched):
  114 merged via PR, 2 closed without merging, 2 with no PR but fully absorbed into `preview`, and 8
  with no PR and genuine unique commits — all verified superseded/already-shipped duplicates from
  concurrent sessions except one (`claude/remote-control-149hqs`, held back pending its stored-XSS
  fix); confirmed that fix already shipped via an identical parallel-session commit already on `main`
  (`8660d42`, same message/timestamp as the held branch's `b3f7df3`), then deleted it too. Full
  methodology and the Windows/Git-Bash CRLF pitfall hit along the way: see
  `docs/sessions/2026-07-20-remote-branch-worktree-cleanup.md`.

- **2026-07-20 · docs(tooling): close-code-session's session-note step writes without pausing**:
  Part 1 item 3 (`docs/sessions/<date>-<topic>.md`) now says explicitly that once the write
  criteria are evaluated, the file is written (or skipped) immediately in the same turn — no
  presenting the evaluation as a question and waiting for a reply first. Closes the gap flagged
  in the `TASK_BOARD.md` entry this graduates; the user had been missing session-note writes
  because a prior run paused for confirmation that the skill never actually required.

- **2026-07-19 · docs(terminology): replaced "roadmap" with "task board" everywhere it referred to
  `docs/TASK_BOARD.md`**: `AGENTS.md`, `docs/SKILLS.md`, `docs/HOW-TO-WORK.md`, and all 6
  `.claude/commands/*.md` skill files (9 files, ~38 occurrences) — including `/add-code-task`'s own
  future-commit template (`docs(roadmap): ...` → `docs(task-board): ...`), so new task-board-addition
  commits use the new scope going forward. `CHANGELOG.md`/`DECISIONS.md`/`docs/sessions/*.md` left
  untouched, same as the earlier `-code-` command rename — dated historical record, not rewritten.
  "Roadmap" was never a stale filename reference (the file has always been `docs/TASK_BOARD.md`), just
  informal vocabulary for the same thing; the two terms coexisting caused real confusion, so picked one.
  Docs/skill-file text only — no code or rules touched, parity unaffected (still 20/0).

- **2026-07-19 · chore(release): bump BUILD to v0.203**: mirrored across all three tools per
  `docs/VERSION-SYNC.md` (CharGen's line-1 comment, `<title>`, header `.sub` label, and its
  JS-side title-template string; Live Sheet's line-1 comment; DM Console's `TOOL_VERSION`).
  Cosmetic build-number bump only — `DATA.version` unchanged, parity still 20/0. The earlier
  cloud-session restriction that blocked a plain `git tag`+`git push` and a `gh api .../releases`
  POST (see `docs/sessions/2026-07-19-github-release-tag-cloud-session-restriction.md`) was
  specific to that cloud-session proxy — a local session tagged `v0.203` and pushed it on
  2026-07-19 without issue, and GitHub auto-generated the matching Release from the tag push.
  Both now exist: https://github.com/Chompy78/PACT/releases/tag/v0.203.

- **2026-07-19 · fix(feedback) — fixed CSS specificity collision hiding the anon checkbox
  incorrectly**: `js/feedback.js`'s `.pact-fb-anon{display:flex}` rule had the same
  specificity/origin as the browser's built-in `[hidden]{display:none}` rule and won by source order,
  so `anonWrap.hidden = true` (the signed-out default) never actually hid the "submit anonymously"
  checkbox row. Scoped the selector to `.pact-fb-anon:not([hidden])` so the browser's own `[hidden]`
  rule applies again. Verified in a real browser (Playwright/Chromium, isolated harness with a stubbed
  Supabase client): signed-out now computes `display:none` (no checkbox/empty box); signed-in still
  computes `display:flex` with a working, checkable checkbox. Display-only, no `DATA.version`/engine
  impact; parity still 20/0.

- **2026-07-19 · fix(feedback) — inlined the "submit anonymously" checkbox with its contact note**:
  `js/feedback.js`'s checkbox (shown only to signed-in users) previously rendered as its own row below
  the "Optional — only if you'd like a reply..." note; both now share one flex row
  (`.pact-fb-note-row`), checkbox first. Verified in a real browser (Playwright/Chromium, isolated
  harness with a stubbed Supabase client) at both a normal width and the 420px mobile breakpoint, in
  both the signed-out (checkbox absent) and signed-in (checkbox inline) states. Display-only, no
  `DATA.version`/engine impact; parity still 20/0. While verifying, found a separate pre-existing bug
  (the signed-out checkbox isn't actually hidden due to a CSS specificity collision) — filed as its own
  roadmap task rather than folded into this fix, since it predates this change and isn't scoped to it.
- **2026-07-19 · chore(release) — graduated A6 (tag releases to build version)**: confirmed done —
  `v0.107` was tagged with a GitHub Release on 2026-07-17; no further action needed, so the task-board
  entry (which had flagged itself for human confirmation) is removed.

- **2026-07-19 · fix(pwa) — closed the last two PWA-completeness gaps: manifest + apple-touch-icon on
  every HTML entry point**: `login.html` and `docs/PACT-Players-Guide.html` gained `<link rel="manifest">`
  (previously only `index.html` and the three tools declared it); all five non-`index.html` entry points
  (`login.html`, the Player's Guide, and all three tools) gained `<link rel="apple-touch-icon"
  href="/PACT/icons/apple-touch-icon.png">`, matching the tag `index.html` got in the previous PWA fix —
  DM Console included, since the browser-tab-favicon exclusion it got in an earlier change was never
  reasoned to extend to the home-screen icon. Every new link uses the absolute `/PACT/...` path, matching
  `manifest.json`'s own convention (the existing tool favicon links use a relative path — a pre-existing
  inconsistency, left as-is). HTML well-formedness verified (all 5 files parse cleanly); no `js/engine.js`
  change, parity 20/0.

- **2026-07-19 · fix(pwa) — bumped service-worker cache + widened network-first coverage + wired the
  missing apple-touch-icon**: `CACHE_NAME` `pact-v6`→`pact-v7`, forcing already-installed/returning users
  to pick up `js/character-store.js` (cache-first; holds this session's Continue-feature `recordAutosave`,
  which was otherwise stuck stale for them indefinitely). Also widened `NETWORK_FIRST_RE` to cover
  `js/ui-helpers.js` (holds `esc()`, the shared XSS-escaping helper all three tools call), `js/ap-by-level.js`,
  and `js/advancement.js` — same "costs nothing, only speeds up fix propagation" reasoning as
  D-GH-2026-07-16-sw-network-first-security-modules, applied to three files that were added since and never
  covered; added all three to `PRE_CACHE` too, matching every other network-first file. Separately, added a
  `<link rel="apple-touch-icon">` to `index.html` — the correctly-sized asset (`/icons/apple-touch-icon.png`)
  already existed and was in `manifest.json`, but no page actually referenced it via the explicit tag iOS
  Safari's "Add to Home Screen" relies on most reliably. Engine untouched, parity 20/0.

- **2026-07-19 · chore(commands) — renamed all 8 Claude Code custom commands to carry `-code-`**: `add-task`→
  `add-code-task`, `cleanup-branches`→`cleanup-code-branches`, `close-session`→`close-code-session`,
  `log-ai-lessons`→`log-code-lesson`, `pick-task`→`pick-code-task`, `plan-for-review`→
  `make-code-cold-plan-review`, `run-task`→`run-code-task`, `sweep-tasks`→`sweep-code-tasks` — distinguishes
  them at a glance from the author's separate `-chat-` Claude.ai Skills. Updated every cross-reference in
  `.claude/commands/*.md`, `AGENTS.md`, `docs/SKILLS.md` (which also gained an old→new mapping table),
  `docs/HOW-TO-WORK.md`, `docs/TASK_BOARD.md`, and `.gitignore`. `CHANGELOG.md`/`DECISIONS.md`/
  `docs/sessions/` deliberately left using the old names — dated historical record, not rewritten.

- **2026-07-18 · feat(tools) — CharGen and Live Sheet now show the anvil/hammer PACT favicon**: moved
  `assets/PACT_favicon.png` → `assets/icons/PACT_favicon.png` and added `<link rel="icon"
  type="image/png" href="../assets/icons/PACT_favicon.png">` to the two non-DM tools' `<head>` (right after
  the manifest link). DM Console deliberately left unchanged. Verified in a real browser: both tabs load the
  favicon (200) and DM Console has no icon link. Asset/display-only — no `DATA.version` or `BUILD` change.
- **2026-07-18 · feat(landing) — "Continue where you left off" recent-characters section**: `index.html`
  now shows resume cards for your last 3 distinct characters plus a collapsible timeline of the last 10
  autosaves, each resuming into the right tool via the existing `?handoff=` baton. Backed by a new shared
  versioned-autosave store in `js/character-store.js` (`recordAutosave`/`readRecent`, key `pactRecentV1`):
  both tools now additively feed it from their autosave (never touching their own restore slot, fully
  guarded). Capture uses time **and** difference — identical snapshots are skipped, rapid same-character
  edits coalesce, and a new snapshot is cut only on a ≥2-min gap, a tool switch, or a ≥5-event jump — so a
  keystroke burst can't fill it with duplicates. Character names render via `textContent` (XSS-safe). BUILD
  v0.201→v0.202; engine untouched (parity 20/0). See `DECISIONS.md` D-GH-2026-07-18-continue-recent-chars.
- **2026-07-18 · fix(chargen) — made CharGen's rules-version display read live from `DATA.version`**: 
  CharGen's header shows "PACT rules · vX" in both a `.hd-pactver` span and the `<title>` tag, but both 
  were hardcoded to v0.336 instead of reading `window.DATA.version` at `engine-ready` like Live Sheet 
  and DM Console already do. Added `id="cgPactver"` to the span and an event listener that updates both 
  the span text and the page title with the live version. Display-only — no rules/`compute()` change, 
  `DATA.version` unchanged. Mirrors the now-documented follow-up to the prior v0.332→v0.336 display-drift fix.

- **2026-07-18 · docs(agents) — refreshed stale version parentheticals in AGENTS.md**: The Versioning 
  section's "currently" notes for BUILD and DATA.version had drifted since PR #251: listed v0.107 
  and v0.332. Updated both to match the live values at merge time (real: v0.202 per js/engine.js — 
  bumped again since this PR was first opened, caught during its pre-merge rebase — and v0.336 per 
  js/engine-data.js). Docs-only — no code or rules change.
- **2026-07-18 · feat(theming) — extended localStorage-based theme switching to guide and DM Console**: 
  PACT-Players-Guide.html now supports the same 4-theme system as index.html (parchment/midnight/dragonfire/contrast) 
  with localStorage persistence. DM Console gained dark-mode support with system preference fallback, maintaining 
  its modern design language. CharGen and Live Sheet already had theme switching. Theming pattern now consistent 
  across all public-facing UIs.

- **2026-07-17 · fix(chargen) — synced CharGen's hardcoded rules-version display to the real
  `DATA.version`**: CharGen showed "Rules v0.332" (title + `.hd-pactver` header label + two doc comments)
  while the engine's canonical `DATA.version` had advanced to **v0.336** — a pre-existing display drift.
  Updated all four spots to v0.336. CharGen is the only tool that hardcodes this (Live Sheet and DM Console
  already read `DATA.version` live at `engine-ready`, so they can't drift); the misleading comment claiming
  the label "tracks DATA.version" was corrected to say it's hardcoded, and a follow-up to make CharGen
  live-read it too was noted. Display-only — no rules/`compute()` change, `DATA.version` untouched.

- **2026-07-17 · refactor(engine) — REV-14a: extracted the `DATA` rules dataset out of `js/engine.js`
  into its own `js/engine-data.js` module**: `engine.js` shrinks from ~189 KB (dominated by one 189 KB
  `DATA` literal line) to ~65 KB and now imports + re-exports `DATA` unchanged, so every tool/importer
  sees the identical surface — matching the existing `ap-by-level.js`/`advancement.js` externalization
  pattern. Byte-identical output verified: the moved literal is character-identical **and** deep-equal to
  the original, `engine-parity` (incl. warnings) reports **20/0**, and all 14 named exports are unchanged.
  `service-worker.js` updated (cache `pact-v5`→`pact-v6`, `engine-data.js` precached + network-first) so
  the rules dataset keeps `engine.js`'s immediate-fix-propagation semantics instead of going stale on a
  cache-first copy (see `DECISIONS.md`). No rules change — `DATA.version` unchanged (still v0.336); `BUILD`
  bumped **v0.200 → v0.201** (non-trivial structural build) and mirrored across the three tools per
  `docs/VERSION-SYNC.md`. Real-browser boot check (Chromium, all three tools): `engine-ready` fires, the
  bridges' `DATA` mutation succeeds (confirming `.js` is not frozen), and `compute()` runs clean. Follow-up
  **REV-14b** (split `compute()` into named sub-pricers) stays open; a cold-reviewed plan for the whole of
  REV-14 lives at `docs/plans/2026-07-17-engine-breakup-rev14.md`.

- **2026-07-17 · docs(roadmap) — scored `docs/TASK_BOARD.md`'s remaining untagged items with
  Effort/Risk tags**: REV-14, real icons, both landing-page follow-ups, A1/A3/A7's remaining scope, and
  the `MUT.patch` rename/restriction idea now carry the three-factor Risk breakdown, so they're visible
  to `/sweep-tasks` (most land at `Risk: high` — architectural/engine-touching or new live-data-table
  work — with real icons the one `Risk: low` exception, blocked only on art). The vague "Supporting
  reference tasks" bullets were deliberately left untagged — not scoped enough to rate. Also flagged
  (not fixed): A6's release-tagging work already shipped (v0.107) but was never marked done here.

- **2026-07-17 · fix(tooling) — `run-task.md`'s worktree-base check replaced with exact-equality, not
  ancestry**: the documented `git merge-base --is-ancestor origin/preview HEAD` check (and an
  undocumented "sharper" ancestry variant used ad hoc this session) both give a false positive right
  after a `preview`→`main` promotion — a worktree wrongly based on `origin/main` still passes, since
  `origin/preview` is reachable from `main`'s tip via the promotion merge. Replaced with
  `[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/preview)" ]`, which can't be fooled the same way.
  See `DECISIONS.md` D-GH-2026-07-17-worktree-base-check-exact-equality.

- **2026-07-17 · docs(tooling) — synced `docs/SKILLS.md` with the sweep-tasks/add-task changes it had
  missed**: the Ambiguity-High cross-tool-migration rule, `/sweep-tasks`' cap-backfill and stricter
  `$ARGUMENTS` parsing, and a corrected `/code-review ultra` description (it can silently fall back to
  a local max-effort pass, not always a billed cloud review).

- **2026-07-17 · refactor(auth) — shared `onSessionChange(session)` helper for `js/auth.js`,
  migrated 4 of 5 call sites**: adds `onSessionChange`, a one-argument wrapper around
  `onAuthChange(event, session)` that structurally rules out the argument-order bug — CharGen's 3
  call sites and DM Console's 1 (both previously bitten by it) now use it. Live Sheet's single call
  site (also previously bitten) keeps the raw, order-dependent `onAuthChange` since it genuinely
  needs the event string for its `SIGNED_OUT` branch — that site is **not** structurally protected by
  this change, only documented against (see `DECISIONS.md`). Display/UI-only, no `js/engine.js`/
  `DATA` involvement, parity still 20/0.

- **2026-07-17 · fix(tooling) — 15 findings from a `/code-review ultra` pass on `/sweep-tasks`/
  `/add-task` fixed**: worktree-leak on park paths, TaskList entries left stuck `in_progress`, no
  cap-backfill on drop/park, undefined bumped-to-high review tier, undefined PR-number capture,
  unvalidated `$ARGUMENTS` batch-size parsing, unguarded direct pushes to `preview`, a diff-size-check/
  add-task-example contradiction, a missing cross-tool-migration Ambiguity callout, plus stale-doc
  fixes in `docs/TASK_BOARD.md` and `AGENTS.md` — see `DECISIONS.md`
  D-GH-2026-07-17-sweep-tasks-review-fixes for the full list.

## How to add an entry
Add at the TOP. Format:
`- **<date> · <type> — <headline>** (<proof: tests pass, files touched>). <what changed, condensed>.`
`<type>` ∈ `feature · rule · fix · data · UI · tooling · docs`. Note `DATA.version` only if it changed.

---

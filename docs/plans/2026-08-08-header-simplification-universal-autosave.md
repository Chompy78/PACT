# Plan: Simplify header save/load UX + universal cloud autosave across PACT's three tools

## Status (2026-08-08)
Cold-reviewed by 4 models (see Review outcome below). The review surfaced enough design work in the
sync-state model and the universal-autosave consent question that this is now **split in two**:
- **Part A (this branch, `claude/header-save-state-clarity-bt6sjy`):** just the confirmed flush-on-navigate
  defect — small, low-risk, no further review needed. Implemented directly, not through a second cold
  review.
- **Part B (not started):** the shared status chip, the sync-state machine, universal autosave, and the
  eligibility/consent decision. Needs its own v2 plan and likely its own cold-review round — see
  "Deferred to Part B" at the bottom. Do not treat Part A's merge as this plan being done.

## Goal
PACT's three standalone web tools (Live Sheet, CharGen, DM Console) each show cloud sign-in/save state
differently, and none of them tell a user "your edits haven't reached the cloud yet" or "the cloud copy
moved past what you're looking at." This plan replaces the three inconsistent status badges with one
shared status-chip design (signed-out / signed-in / saving / unsaved changes / newer-on-cloud / both) and
makes cloud autosave universal (today it only exists for campaign-bound characters in one of the two
editor tools), so the manual "☁ Save to cloud" button stops being the thing a user has to remember to
click. It also fixes one concrete defect found while scoping this plan: a debounced cloud push can be
silently lost on navigation, including the tool's own cross-tool switch action.

## Context
PACT is a static, vanilla-JS (no framework/bundler/npm) tabletop-RPG tool suite hosted on GitHub Pages,
with Supabase as the only backend (reached client-side, protected by row-level security). Each of the
three tools (`tools/PACT-Live-Char-Sheet.html`, `tools/PACT-CharGen-Webtool.html`,
`tools/DM-Console.html`) is an intentionally standalone HTML file — there is no shared UI framework or
component system between them; only a few things are shared modules (`js/engine.js` for game rules,
`js/sync.js` for cloud save/load, `js/character-store.js` for the save-file envelope format,
`js/auth.js`/`js/campaign.js`). A hard project rule: "Every player-controlled value that reaches
innerHTML/an attribute must pass through esc()... cloud data now crosses users, so an unescaped field is
a stored-XSS path, not just a display bug" — relevant here because the new chip may render a character or
campaign name.

The owner (this project's maintainer) made these decisions in conversation before this plan was drafted:
1. Scope is all three tools' headers, not just the two editor tools — this also absorbs an existing
   queued-but-not-started task ("give the three tools a consistent signed-in indicator") rather than doing
   it twice.
2. Cloud autosave should become universal: extend the existing campaign-bound-only background autosave to
   (a) the Live Sheet tool, which has no cloud autosave at all today, and (b) non-campaign-bound cloud
   characters in both editor tools. The manual "Save to cloud" button stops being the normal path and
   becomes a manual "force sync now" fallback.
3. Replace the three different signed-in/out badges with ONE shared status-chip design/vocabulary used
   identically in all three tools, expressing: signed-out, signed-in (nothing pending), saving, unsaved
   local changes ("dirty" — edited but not yet pushed), newer-version-on-cloud ("behind" — another device
   or the DM wrote to this character since it was loaded), and the combined dirty+behind case (this is the
   same conflict state an existing guard already refuses to overwrite at save time — see below).
4. The goal is simplification, not addition — the chip is meant to *replace* existing separate elements
   (the plain signed-in badge, and today's only-at-save-time conflict alert), not be a fourth thing to look
   at alongside them.

Before drafting this plan, the owner reported "I don't think the CharGen autosave works" — made an edit to
a cloud character, waited a full minute, opened it in a different browser, and the edit wasn't there. This
was investigated by reading the actual code path (not assumed): the existing campaign-bound autosave
gate/debounce/push wiring traces correctly for the steady-state case, and the owner separately confirmed
autosave is in fact working for their character once the campaign-bound scoping was understood. A real,
independent defect was found and confirmed while investigating (see Verified below); it was never
conclusively linked to the original report, and is fixed on its own merits.

## Assumptions vs. verified facts

**Verified (read directly in the code):**
- `js/sync.js`'s `saveCharacter()` stamps every local write with `dirty: true`; `applyServerMeta()` (run
  after a successful push) clears it to `false`. This flag lives only in the local cached record
  (read/written via internal `lsGet`/`lsSet` helpers) and is **never exposed** through `window._syncBridge`
  (which only exposes `saveCharacter, loadCharacter, refreshServerAp, listMyCharacters, newCharacterId,
  initSync`) or read by any UI code today.
- **CharGen's local autosave never touches `js/sync.js`'s `dirty` flag at all.** `_cgAutosave()` writes
  straight to its own `CG_AUTOSAVE_KEY` via `localStorage.setItem()`. The `js/sync.js` cache's `dirty`
  flag is only set inside `saveCharacter()`, which only runs after the 3s cloud-push debounce fires (or on
  manual save) — so for up to 3 seconds after every edit, that flag reads `false` even though real unsaved
  edits exist. Any future sync-state API built on that flag alone will misreport "nothing pending" during
  that window. (Confirmed by direct code read; independently flagged by one cold reviewer as `blocking`.)
- `reconcile(id)` returns `{behind: true}` **transiently**, as a one-time signal to its caller, when a
  locally-dirty record's push is refused because the server moved (a conflict) — it is never persisted
  anywhere today. It runs once at boot (`initSync()`) and once on the browser's `online` event — there is
  no periodic/live polling while a tab sits open.
- CharGen's existing cloud autosave (`_cgCloudAutosave()`/`_cgCloudPush()`) is gated on
  `window._cgCampaignBound && window._cloudSignedIn`, scoped deliberately to campaign-bound characters
  only. Traced the full chain end to end: `emit()` → `render()` → `_cgRenderInner()` → `_cgAutosave()` →
  `_cgCloudAutosave()`; the campaign-bound flag is set correctly at boot via
  `_cgAdoptEnvelopeBinding()` → `_cgResolveDmApStatus()`, and identically on an explicit cloud Load via
  `loadCloudChar()`. The owner confirmed this steady-state path is in fact working.
- **Confirmed defect (Part A's target):** the autosave push is only *scheduled* —
  `_cgCloudAutosave()` calls `setTimeout(_cgCloudPush, 3000)` — and nothing flushes a pending timer on
  navigation. Grepped both editor tools for `beforeunload`/`pagehide`: neither wires either event to
  anything cloud-related. CharGen's own in-app tool switch, `switchToLiveSheet()`, calls `_cgAutosave()`
  (which re-arms a fresh 3000ms cloud-push timer) and then navigates away (`location.href = ...`) in the
  same function — guaranteeing that queued push never fires. A plain tab/browser close within 3 seconds of
  the last edit has the identical failure mode.
- **DM Console is not read-only** (this plan's original assumption was wrong): `js/dm.js` exports
  `awardAp()`, `setCharacterDmNotes()`, and `unbindCharacter()` — all real writes DM Console performs
  against campaign/character data, wired to buttons in its UI. These are separate from the
  LOG/`stats`-blob build-sync model this plan builds a chip for (DM Console doesn't edit a character's
  *build*), but "no dirty/behind logic needed for DM Console at all" is too broad a conclusion — its own
  write paths need their own save-feedback story. Deferred to Part B.
- The Live Sheet has **no cloud autosave at all** — its `save()` only writes to `localStorage`; cloud
  writes happen solely via the explicit `☁ Cloud → Save to cloud` menu action.
- Each tool renders sign-in state with its own function and vocabulary: Live Sheet's
  `renderCloudStatusBadge()`, CharGen's `renderStatus()`, DM Console's `updateAuth()` — three different
  text/icon sets.
- Two recent, already-shipped features this plan must not duplicate: a stale-cloud-save guard (refuses an
  overwrite if another device wrote first, via a server-confirmed `base_updated_at` concurrency check) and
  an off-site Export backup button with its own staleness warning + a DB-side backup trigger.
- Repo-wide hard rules: vanilla JS only, no frameworks; after any change a fixture-based regression test
  (`testing/tests/engine-parity.html`) must report 0 failed; a separate rules-dataset version number is
  bumped only when the pricing engine's output changes.

**Assumed (flagged during cold review, unresolved — see Part B):**
- Whether "signed in" implies consent for every future edit to autosave to the cloud, and what happens to
  a character a user previously kept local-only the moment they sign in. Cold-review verdict: this is a
  real data-handling decision, not cosmetic, and — since this app already has real user data (not the
  pre-launch, no-real-characters state assumed elsewhere in this project's history) — needs an explicit
  answer before Part B ships, not just a note.
- The exact "behind" refresh trigger for an open, idle tab (polling vs. visibilitychange/focus vs.
  realtime) — cold-review consensus recommends visibilitychange/focus as the MVP, explicitly deferring
  idle-interval polling and realtime.
- Whether non-campaign-bound autosave should reuse the same 3000ms debounce at higher write volume.

## Proposed approach — Part A only (this branch)
1. Add a flush of any pending `_cgCloudSaveTimer` on `pagehide`, using `fetch(..., {keepalive: true})`
   for the actual network call rather than a bare `fetch` — a bare async request is not guaranteed to
   complete once the page starts tearing down, and `sendBeacon` cannot carry the Authorization/apikey
   headers Supabase's REST calls need. `keepalive` fetch can carry those headers and is the mechanism that
   actually survives page dismissal, subject to its body-size cap (comfortably large enough for a
   character-sheet payload).
2. Make `switchToLiveSheet()` **await** the pending cloud push (flushing it immediately rather than merely
   re-arming a new 3000ms timer) before navigating, instead of the current fire-and-forget call.
3. State the resulting guarantee precisely, in the code comment and in Done-when below, as two tiers:
   **guaranteed** for the in-app cross-tool switch (awaited before navigation), **best-effort** for
   uncontrolled exit (tab/browser close, OS-level discard) — backstopped by the existing mechanism where a
   still-`dirty` local record retries on this same browser's next boot/reconnect. Do not claim uncontrolled
   exit is now guaranteed; it isn't, on any browser.
4. Bound the awaited flush in step 2 with a short timeout so an offline/paused-backend user isn't stranded
   on a dead "Open in Live Sheet" button — on timeout, navigate anyway and rely on the same dirty-record
   retry backstop.

## Files involved
- `tools/PACT-CharGen-Webtool.html` — add the `pagehide` keepalive flush; fix `switchToLiveSheet()` to
  await/flush with a bounded timeout instead of re-arming and abandoning the timer.

## Out of scope (Part A)
- Everything in "Deferred to Part B" below: the shared chip, `getSyncState()`/sync-state machine,
  universal (non-campaign-bound) autosave, the conflict-resolution UX, DM Console chip treatment, the
  behind-detection trigger, the task-board sign-in-indicator fold-in.
- Any change to the rules engine or its pricing output.
- Extending the same flush fix to the Live Sheet, since the Live Sheet has no cloud autosave to flush yet
  (that's Part B).

## Alternatives considered
- **`navigator.sendBeacon`** for the flush — rejected: cannot set the Authorization/apikey headers the
  Supabase REST call needs, so it can't carry an authenticated write.
- **No debounce, push on every keystroke** — rejected (unchanged from the original plan): this is exactly
  what the existing autosave comment already rejected for the campaign-bound case ("a network write behind
  every keystroke").

## Risks / open questions (Part A)
- `pagehide` firing order/timing varies slightly across browsers (especially bfcache-eligible navigations)
  — the keepalive fetch should be started as early as possible in the handler.
- The bounded timeout in step 4 is a judgment call on duration; pick something short enough not to stall
  the user (low single-digit seconds) and note the choice in the commit.

## Verification (Part A)
- `testing/tests/engine-parity.html` → 0 failed (expected unaffected — no rules-engine involvement).
- Manual check: edit a campaign-bound character, immediately click "Open in Live Sheet" within the old
  3-second window, confirm the edit reached the cloud row (check from a second browser/profile).
- Manual check: edit a campaign-bound character, close the tab immediately, reopen later, confirm the
  edit is present locally at minimum (best-effort cloud delivery is not guaranteed and the check should
  not assume it is).
- No rules-dataset version bump; changelog entry added.

## Done when (Part A)
`switchToLiveSheet()` no longer silently abandons a pending cloud push — it flushes (with a bounded
timeout) before navigating. The `pagehide` handler attempts a best-effort keepalive flush for uncontrolled
exit, documented as best-effort rather than guaranteed. `testing/tests/engine-parity.html` still reports 0
failed. Changelog updated.

---

## Deferred to Part B (not started — needs its own plan + likely its own cold review)
Everything below survives from the original single-plan draft as scoping material for Part B; none of it
is implemented by Part A.

- **Explicit sync-state machine.** Replace the loosely-described `getSyncState(id)` idea with a real
  design: named states (signed-out, signed-in-idle, saving, dirty, behind, dirty+behind, error/offline),
  explicit transitions and precedence (e.g. saving supersedes dirty; what happens on push failure, auth
  expiry, offline), and — critically — **explicit set AND clear conditions for both `dirty` and `behind`**
  (the original plan only specified `dirty`'s clear condition; cold review confirmed `behind` had none,
  which would leave a stale conflict warning on screen after the conflict is actually resolved). Also
  address in-flight/request-ordering: a snapshot/version per outbound push, single-flight per character, so
  an old response can't clear `dirty` after a newer edit superseded it.
- **Behind-detection trigger.** Adopt visibilitychange/focus-triggered reconcile as the MVP (cold-review
  consensus); explicitly scope out idle-interval polling and realtime for this iteration.
- **Conflict-resolution UX for the dirty+behind state.** Design what the user can actually do when both
  are true — the existing stale-save guard will refuse a naive "Force sync now" in exactly this state, so
  that control needs either a distinct label ("Retry sync" is not "overwrite the server") or a real
  resolve flow (discard-local-and-reload vs. something else), not silence.
- **Universal-autosave eligibility rule — needs the owner's explicit decision, not an assumption.** Does
  signing in imply consent for every future edit to autosave? What happens to a character a user
  previously kept local-only when they sign in? Any first-time notice? This is a real data-handling
  decision given the app now has real user data.
- **DM Console's actual role in the chip.** It has real write paths (`awardAp`, `setCharacterDmNotes`,
  `unbindCharacter`) separate from the build-sync model — decide what save-feedback, if any, those need,
  rather than giving it pure signed-in/out visuals with zero dirty/behind logic.
- **The shared chip itself** (markup/CSS duplicated three ways per this project's standalone-file
  architecture, but the state→label/icon/aria mapping should live as one shared pure function to reduce
  drift risk), demoting "Save to cloud" to a fallback reachable from the chip, and folding the
  already-queued "consistent sign-in indicator" task-board entry into this work.
- **Verification for Part B** must cover offline/failed-push, expired-auth, character-switch-mid-save,
  same-browser multi-tab editing, and the idle-tab behind-refresh case — not just the happy path.

---

## Review outcome
- **Reviewers:** Claude Opus 4.8 (Anthropic, via MS Copilot), GPT-5 default (OpenAI — file was named
  "deepseek" but the review's own self-identification line says GPT-5; flagged as a labeling
  inconsistency, treated as OpenAI-family for weighting), GPT-5.6 Luna (OpenAI), GPT-5 via M365 Copilot
  (OpenAI). **Effectively 2 vendor families, not 4** — 3 of the 4 files are OpenAI-lineage models, so their
  agreement with each other counts as one family's view, not independent triple-confirmation. All 4
  converged on the same core gaps regardless, which is why they're weighted heavily below.

| Finding | Severity | Confidence | Raised by | Cross-family agreement | Disposition |
|---|---|---|---|---|---|
| `pagehide` flush of async write not guaranteed; needs `keepalive` fetch, split guarantee | blocking | high | all 4 | yes (Anthropic + OpenAI) | accept — implemented in Part A |
| CharGen local autosave never sets `js/sync.js`'s `dirty` flag (3s+ blind window) | blocking | high | 1 (GPT-5/"deepseek"-labeled) | n/a — confirmed by direct code read, not by reviewer count | accept → doc-noted here; state-machine fix deferred to Part B |
| dirty+behind conflict state has no resolution UX; "Force sync now" mislabeled | blocking (per reviewers) / not blocking (per disinterested check) | high | all 4 | yes | defer → Part B (scoped addendum, not a Part-A blocker) |
| "behind" refresh trigger undecided yet Done-when/Verification depend on it | blocking (per reviewers) / blocks-this-doc-not-the-design (per check) | high | all 4 | yes | defer → Part B (adopt visibilitychange/focus MVP) |
| persisted `behind` flag has no clear-condition | blocking | high | 3 of 4 | yes (Anthropic + OpenAI) | defer → Part B, doc-noted as a required design element |
| universal autosave has no consent/eligibility rule | blocking (conditional per disinterested check — real user data tips it blocking) | high | 3 of 4 | mostly one family | defer → Part B, needs owner decision before implementation |
| DM Console assumed read-only, not verified | moderate | medium | 3 of 4 | yes (Anthropic + OpenAI) | accept — confirmed false by direct code read, corrected here |
| shared chip duplicated 3x with no shared state-mapping | moderate/minor | high | all 4 | yes | accept → Part B design note |
| verification matrix too narrow (offline/failure/conflict/multi-tab/idle) | moderate | high | all 4 | yes | accept → Part B verification section |
| `esc()` coverage not extended to tooltip/aria-label/error text | moderate | high | 2 of 4 | yes (Anthropic + OpenAI) | accept → Part B, hard project rule either way |
| multi-tab-same-browser races | moderate | high | 2 of 4 | no (one family only) | accept → Part B risk note, lower confidence |
| task should be split into staged branches | moderate | high | 3 of 4 | yes (Anthropic + OpenAI) | **accept — this document itself is the result** |

- **Materially changed the plan?** Yes — split into Part A (implement now) and Part B (re-plan later); Part
  A's own guarantee wording changed from "no longer silently drops on navigation" to an explicit
  guaranteed/best-effort split; DM Console's role corrected from "no logic needed" to "needs its own,
  different, scoped treatment."
- **Without the review:** the plan would have shipped a `pagehide` flush using a bare (non-keepalive)
  fetch that looks correct in manual testing but doesn't survive real page teardown — silently failing to
  fix the exact bug it was written for — and would have generalized autosave without ever deciding whether
  signing in means consent to it.

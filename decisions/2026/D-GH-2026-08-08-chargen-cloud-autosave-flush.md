# D-GH-2026-08-08-chargen-cloud-autosave-flush

**Context.** CharGen's campaign-bound cloud autosave (2026-08-03) only ever *schedules* a push —
`_cgCloudAutosave()` calls `setTimeout(_cgCloudPush, 3000)` — and nothing flushed a pending timer on
navigation. CharGen's own "Open in Live Sheet" button, `switchToLiveSheet()`, called `_cgAutosave()`
(re-arming a fresh 3000ms cloud-push timer) and then navigated away in the same function, guaranteeing
that queued push never fired. A plain tab/browser close within 3 seconds of the last edit had the
identical failure mode. Found and scoped while cold-reviewing a larger header-simplification/
universal-autosave plan (`docs/plans/2026-08-08-header-simplification-universal-autosave.md`) — 4 models
reviewed that plan (2 vendor families: Anthropic and OpenAI-lineage; one review file was mislabeled
"deepseek" but self-identified internally as GPT-5), and this defect, plus the fix's own reliability
limits, was independently confirmed as `blocking` by all of them and by a disinterested follow-up check.

**Options considered:**
- **A — `navigator.sendBeacon` for the page-exit flush.** Rejected: `sendBeacon` cannot set custom
  headers, and an authenticated Supabase write needs `Authorization`/`apikey` headers. It literally cannot
  carry the request this needs.
- **B — Plain `fetch()` from a `pagehide` handler, claimed as a fix.** Rejected as insufficient: an
  ordinary (non-keepalive) fetch is not guaranteed to complete once the page starts tearing down — it can
  be aborted mid-flight. Shipping this would look correct in manual testing (dev tools rarely kill the
  page fast enough to expose the race) while still losing the write in the real failure mode.
- **C — `fetch(url, {keepalive: true})` for the page-exit flush; a real `await` for the in-app
  navigation case.** Chosen. `keepalive` is the fetch option designed to let a request outlive page
  dismissal, and — unlike `sendBeacon` — it can carry auth headers (subject to a small body-size cap the
  character-sheet payload is comfortably under).
- **D — Remove the debounce, push on every edit.** Rejected, unchanged from the original 2026-08-03
  reasoning: "a network write behind every keystroke."

**Decision:** C, split into two tiers with two different guarantees, not one:
1. **In-app navigation (`switchToLiveSheet()`):** the page controls when it navigates, so it can genuinely
   wait. `switchToLiveSheet()` is now `async` and calls `_cgFlushCloudSaveNow(2500)`, which clears the
   debounce timer and awaits the actual push (or an already-in-flight one — `_cgCloudPush()` now tracks
   its promise so a flush never fires a duplicate push or resolves before the real request finishes),
   bounded by a 2.5s timeout so an offline/paused-backend user is never stranded on the button.
2. **Uncontrolled exit (tab/browser close, OS discard):** best-effort only, via a `pagehide` listener that
   flushes any pending/in-flight push using `withKeepalive()` (new export in `js/supabase-client.js`, wired
   through Supabase's client-level `global.fetch` option, re-exported from `js/sync.js` since that's what
   the tools' module bridges import from). This is explicitly documented as best-effort, not a guarantee —
   the durable fallback for this case is unchanged: the local autosave (already written) plus the record's
   `dirty` flag retrying on this browser's next boot/reconnect.

**Why.** The cold review's own disinterested-agent pass confirmed the core physics: browsers abort
in-flight non-keepalive requests once page teardown starts, which is the documented reason `sendBeacon`/
`keepalive` fetch exist as distinct API surfaces. Claiming "no longer silently drops a pending cloud push
on any navigation" without this distinction would have been dishonest about what's actually guaranteed —
the review specifically flagged that risk. Splitting the guarantee into "real" (in-app, awaited) vs.
"best-effort" (page-exit, keepalive) is cheap to state precisely and avoids over-promising a delivery
guarantee no browser actually provides for uncontrolled exit.

**`withKeepalive()`'s scope:** it's a single shared mutable flag (`_keepaliveNext`) toggled around exactly
one call via `try/finally`, not a per-request parameter — postgrest-js (the vendored Supabase client)
doesn't expose per-call fetch options, only a client-level `global.fetch` override. This is safe here
specifically because `withKeepalive` `await`s the *entire* wrapped call (not just its synchronous prefix)
before clearing the flag, so it stays set through the actual `fetch()` invocation buried several `await`s
deep inside `saveCharacter()` → `pushCharacter()`. A second, unrelated request racing during that same
narrow window would also pick up `keepalive: true` — harmless (keepalive only changes unload survival, not
request semantics) — but this should stay scoped to page-exit flushes, not become the default for every
request.

**Status:** DONE (Part A of the larger header-simplification/universal-autosave plan). Part B — the shared
status chip, the sync-state machine, universal (non-campaign-bound) autosave, and the still-open
eligibility/consent question — is deliberately deferred; see the plan document's "Deferred to Part B"
section and its Review outcome table for the full cold-review triage.

## Addendum (2026-08-10, `/sweep-code-tasks` — `fix/autosave-flush-latest-push`)

Found by `/code-review ultra` on the B3 (universal autosave) branch: this record's own `_cgCloudPush()`
"tracks its promise so a flush never... resolves before the real request finishes" claim (Decision 1,
above) was incomplete. When a push was already **busy**, `_cgCloudPush()`'s busy branch returned the
*stale, already-in-flight* promise instead of the promise for the retry `_cgCloudSaveAgain` queues up —
the retry that actually carries whatever edit arrived mid-flight. `_cgFlushCloudSaveNow()`'s
`Promise.race` resolved on that stale push, the in-app navigation proceeded, and the real retry fired
later from a `.finally()` callback with **no keepalive at all** — exactly the failure mode Decision C
above was written to close, just for the retry case specifically rather than the first push. Freshly
replicated, unfixed, into Live Sheet's new B3 autosave scaffolding built on top of this pattern.

**Fix:** both `_cgCloudPush()`/`_lsCloudPush()` gained a read-only `_cgCloudPushSettled()`/
`_lsCloudPushSettled()` waiter that recursively tracks however many retries the queue actually needs
(without itself ever triggering one — that would spuriously re-save unchanged state on every check).
`_cgFlushCloudSaveNow()`/`_lsFlushCloudSaveNow()` and the `pagehide` handler's `withKeepalive()` call now
await that instead of `_cgCloudPush()`'s own return value.

**A real trade-off this reopens, not fully closed here:** this record's own "`withKeepalive()`'s scope"
paragraph above already flagged that a second, unrelated request racing during `withKeepalive`'s "narrow
window" would also pick up `keepalive:true`, judged harmless *because the window was narrow* (one push's
`fetch()`). The fix above widens that window to however long the retry chain takes — no longer
necessarily narrow. `get_advisors`/manual testing found no live incident from this, but it's a real,
reviewer-confirmed widening of the exposure this record originally accepted only in its narrow form, not
something this addendum resolves — see `feat/keepalive-scope-narrowing` on `docs/TASK_BOARD_NEXT.md` for
the follow-up decision (narrow the window back down vs. accept it, formalized either way).

New differential test: `testing/scripts/autosave-flush-latest-push-ci.mjs` (extracts the real functions
from both tools, confirms a hand-reverted pre-fix copy reproduces the bug before trusting the live code
doesn't). `engine-parity-ci.mjs`/`tool-pricing-ci.mjs` unaffected.

## Addendum (2026-08-11, `feat/keepalive-scope-narrowing` — the widened window, resolved: A2, narrowed)

The trade-off the previous addendum reopened is resolved as **A2 — narrow the window back down**, not
formalized as an accepted trade-off. Reasoning: the narrow fix was low effort, mirrored an already-drafted
shape, and had existing CI coverage to lean on — there was no real cost to restoring the original "wrap
exactly one call" contract instead of writing an exception to it.

**Fix:** `withKeepalive()` is no longer called from the `pagehide` handler at all. Both tools gained a
`_cgPageHiding`/`_lsPageHiding` flag (set `true` by `pagehide`, reset `false` once the push queue fully
drains) and a small `_cgKeepaliveWrap(fn)`/`_lsKeepaliveWrap(fn)` helper that `_cgCloudPushOnce()`/
`_lsCloudPushOnce()` calls around just its own `saveCharacter()` call. Each push **attempt** — the initial
push and any chained retry — independently decides for itself whether to open a `withKeepalive()` span,
rather than one outer span held open for however long the whole settle-wait takes. This closes the same
gap the previous addendum's fix closed (a retry chained after `pagehide` still gets keepalive) through a
different mechanism: instead of widening the outer wrap to still be open when the retry fires, each
attempt opens its own span exactly when it actually dispatches, so a concurrent unrelated fetch (e.g.
Supabase's `autoRefreshToken`) landing in the gap *between* attempts no longer inherits `keepalive:true`.

`testing/scripts/autosave-flush-latest-push-ci.mjs`'s pagehide scenario was restructured to prove this
directly (extended to a two-retry chain so span *count* is a meaningful signal — a single wide wrap and
two narrow per-attempt wraps were otherwise indistinguishable in the original one-retry scenario): asserts
`keepaliveSpans.length === 2` (both retries independently covered) and every span has `endCall-startCall
=== 0` (each stayed narrow — no other call happened while it was open). 10/10 (was 8/8).

## Addendum (2026-08-11, `fix/manual-save-queue-bypass`)

Found alongside the keepalive finding, same `/code-review ultra` pass: CharGen's `onSaveClick()`/
`onJoinCampaignClick()` and Live Sheet's manual "☁ Save to cloud" button all called `S.saveCharacter(...)`
directly, bypassing `_cgCloudSaveBusy`/`_cgCloudPush()` (or the `_ls*` twins) entirely — so a manual save
could fire a second, uncoordinated write while an autosave push for the same character was already in
flight, with no ordering guarantee over which one landed last.

**Fix:** a new shared `_cgQueuedSaveCharacter(args)`/`_lsQueuedSaveCharacter(args)` helper — waits for any
push already in flight to settle (`_cgCloudPushSettled()`), then claims the same busy/again coordination
the autosave queue itself uses for the duration of its own `saveCharacter()` call. Deliberately does NOT
delegate to `_cgCloudPushOnce()`: that function swallows errors/conflicts silently (correct for a
background autosave), while manual saves are user-initiated and must surface their own success/failure UI
— so the caller (`onSaveClick()`, `onJoinCampaignClick()`, Live Sheet's button handler) keeps its own
result handling, just routed through the shared coordination instead of a raw call. Live Sheet's
clone-to-standalone save and CharGen's two new-character-id save paths (Randomize seed, DM-view copy) are
out of scope — they mint a brand-new character id per save and can never race the autosave queue's push
for the *currently open* character.

New scenario in the same differential test file: an autosave push in flight, then a manual save — the
reverted leg (literal pre-fix `_cgQueuedSaveCharacter` body: a raw, uncoordinated `saveCharacter()` call)
proves the race reproduces first; the live leg proves the manual save's own network call waits until the
autosave push has settled. 14/14 (was 10/10 after the keepalive-narrowing addition above).

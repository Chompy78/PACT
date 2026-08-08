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

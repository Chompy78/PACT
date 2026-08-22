# D-GH-2026-08-22-dm-console-stale-campaign-switch-race — a stale campaign-switch response could clobber the newly-selected campaign's data

## Context
While promoting `preview` → `main` (PR #446, a pure `BUILD` version-sync commit with zero logic
changes), CI's `dm-console-ui-e2e.mjs` failed on 5 tests — all in the invite-staleness "warnings
banner" section — twice, identically, on the same commit. Re-running the exact same commit locally
passed 96/96 both times. Per this repo's babysit convention, a failure that reproduces identically
twice is real, not a flake to re-run past — but the code involved (`_campWarnings()`/
`renderCampWarnings()`) is purely synchronous (no network, no timers) and untouched by anything in
the promotion or the PR it carries (#444), so it could not have been *caused* by either.

## Investigation
`renderCampWarnings()` reads only the module-level `_invites` array and `Date.now()` — deterministic
given its inputs. The actual mutator of `_invites` is `loadInvites()`, which the auto-refresh
listeners (`document.addEventListener('visibilitychange', refreshCampaignPanels)` /
`window.addEventListener('focus', ...)`) fire **fire-and-forget**, with no cancellation and no check
that the campaign it was fetching for is still the one selected by the time the fetch resolves.
`loadInvites()` unconditionally does `_invites = <fetch result, or [] on error>` then
`renderCampWarnings()` **on both its success and error path** (by design, per its own existing
comment — "an error clears _invites, which correctly clears any warnings...").

If a Playwright-driven browser fires a stray `focus`/`visibilitychange` event at any point earlier in
this large test suite (headless automation frameworks are known to synthesize these around tab/window
management in ways a real user session mostly doesn't), a `loadInvites()` call goes out for whatever
campaign was selected at that moment. If that call is still in flight when the "warnings banner" test
section later seeds fresh data via the test seam and asserts on it within ~40ms, and the stray call
*then* resolves (typically rejecting with a real 400/401 — there is no live Supabase backend in CI) —
its unconditional `_invites = []; renderCampWarnings();` wipes the just-seeded banner right out from
under the assertion. This matches every observed detail: exactly the tests checking seeded *content*
fail (the ones checking *empty/cleared* state naturally still pass either way); the console logs show
exactly 400/401 noise; and it explains a CI-only, seemingly-nondeterministic-but-actually-timing-
dependent reproduction without being truly random (Playwright's focus-event behavior differs between
a real display server and a CI runner's headless/virtual-display setup — plausible, though the exact
trigger inside the suite was not pinned down; the mechanism was proven by direct reproduction, below).

Verified live by directly reproducing the shape of the race (not by finding the exact stray-focus
trigger inside the test suite): seeded two campaigns, selected the first (starting a deliberately
delayed fetch), switched to the second before it resolved (a fast, correct fetch completes and
renders), then let the first's stale response resolve *after*. Confirmed the leak reproduces
without the fix and is contained with it, for both `_invites` (via `loadInvites()`) and the party
downtime globals (via `_refreshDowntimeWindows()`).

`_refreshDowntimeWindows(campId, characterIds)` — called from `loadRoster()` — has the identical
shape and the identical bug: it writes `window._dmPartyWindow`/`window._dmDowntimeWindows`, shared
caches `dmToolsBody()`/the party downtime control read synchronously at render time, with no guard
against a stale campaign's response landing after a faster, newer campaign's load already populated
them correctly. `loadRoster()` itself has the same unconditional-write shape across its own two
`await` points (`B.getRoster`, then `_refreshDowntimeWindows`).

## Decision
Added a single shared guard, `_isCurrentCamp(id)` (returns `id === currentCampId`), and applied it
after every await boundary in all three functions before any DOM or `window`-global write:
- `loadInvites()` — pins `forCampId = currentCampId` at entry; re-checks after the fetch resolves
  (both success and error paths) before touching `_invites`/the DOM.
- `loadRoster(campId)` — re-checks after `B.getRoster()` (both paths) and again after
  `_refreshDowntimeWindows()`, before `_renderPartyDowntime()`/`_paintRoster()`.
- `_refreshDowntimeWindows(campId, characterIds)` — re-checks at entry (defensive; its only caller
  already checks, but a second caller could be added later without knowing to), after the party-window
  fetch, and per-character inside the `Promise.all` map.

**A real bug caught mid-fix, by `/code-review`:** the first draft of the `_refreshDowntimeWindows` fix
wrote `window._dmPartyWindow = await B.getDowntimeWindow(...)` directly — the assignment happens as
part of evaluating the awaited expression, so it occurred *before* the staleness re-check that followed
it on the next line ever ran. The guard was syntactically present and still let the exact leak through.
Fixed by resolving into a local (`var partyWindow = await ...`) and only conditionally committing it to
the global after the re-check. Verified directly: the live reproduction above initially still showed
the stale `999`-day window landing after the fix; after the correction, the current campaign's `7`-day
window survived the late stale resolve unchanged. A guard whose write happens inside the same
expression it's meant to gate is worth naming as its own category of near-miss — it looks correct on
read-through.

**Not fixed, scoped out:** the three guard sites were briefly hand-duplicated
(`if(x !== currentCampId) return;`) with two different local variable names (`campId` vs `forCampId`)
before being factored into the one `_isCurrentCamp()` helper — a second `/code-review` pass flagged the
duplication as a drift risk. Factored immediately since it was a one-file, mechanical change with no
behavior implications.

## Why
This is exactly the shape of bug that stays invisible in a manually-tested app for a long time — a
real DM would need to switch campaigns while a request from the previous one was still in flight and
happened to resolve after the new one loaded, a genuinely rare timing window in ordinary use — and
would only show up as a subtly wrong number (an old campaign's downtime window, or an old campaign's
invite warning) that's easy to dismiss as "must have just needed a refresh." It surfaced here only
because Playwright's automated focus-event behavior in CI made the race far more likely to actually
land than a human clicking through the UI ever would. Worth fixing on the strength of that alone,
separately from the CI-failure investigation that found it: an event-sourced-adjacent app already
built around "the frozen ledger is the source of truth" (per `AGENTS.md`'s own framing) should not
also have unguarded fire-and-forget writes to shared render-time caches.

Not bundled into the promotion PR (#446) despite being found while investigating its CI failure — per
`docs/VERSION-SYNC.md`, a promotion PR carries only the version-sync commit; this landed as its own
PR into `preview` first, and the promotion was re-attempted against `preview` afterward.

## Status
Implemented on `fix/dm-console-stale-response-race`, off `preview` at the `v1.446` version-sync
commit. Verified: `dm-console-ui-e2e.mjs` 96/96, `economy-ui-e2e.mjs` 155/155, `engine-parity-ci.mjs`
52/52, `chargen-flows-e2e.mjs` 66/66, plus two direct live reproductions of the race (invites/warnings
banner, party downtime window) confirmed to leak without the fix and stay contained with it.

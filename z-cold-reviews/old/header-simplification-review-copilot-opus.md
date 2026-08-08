# Cold review — "Simplify header save/load UX + universal cloud autosave"

**Reviewer model/settings:** Microsoft Copilot (Claude Opus 4.8), default settings.
**Access:** Plan text only — no codebase. I cannot verify code correctness; findings are about logic, scope, clarity, and risk. Where a claim depends on code I can't see, that dependency is itself noted as a finding.
**Posture:** Adversarial by request — I assumed the goal is unmet until argued otherwise.

---

## Executive read
The plan is unusually honest — the Verified/Assumed split, the "never conclusively linked" caveat on the original bug, and the tight Out-of-scope are all better than most plans I see. That candour is doing real work and I've tried not to punish it by inventing concerns. But there are a handful of genuine gaps, two of which I'd call blocking, mostly clustered around **states the plan names but never designs an action for** (the combined dirty+behind case), **a fix that may not actually flush on the event it targets** (`pagehide` + async network write), and **an open question that a "Done when" criterion silently depends on**.

---

## Findings

### 1. The combined "dirty + behind" state is named as important but given no resolution UX — `blocking`, confidence `high`
The plan elevates dirty+behind to a first-class chip state and correctly notes it's "the same conflict state an existing guard already refuses to overwrite at save time." But then step 6 makes the chip's primary action "Force sync now" — and in exactly this state, force-sync hits the stale-save guard and is *refused*. So the user lands in: chip says "both", the one offered action fails, and the plan defines no next step (reload-and-lose-local? overwrite-server? merge?). The state you most need an affordance for is the only one with none. **Suggestion:** design the conflict-resolution branch explicitly (at minimum a "discard local & reload server" vs "overwrite server" choice, with the destructive one guarded), and add it to "Done when." Surfacing a conflict you can't act on is arguably worse than today's save-time-only alert, which at least appears at the moment of a concrete action.

### 2. `pagehide` flush of an async cloud write is not guaranteed to complete — the fix may not fix the bug — `blocking`, confidence `moderate`
Step 1 is the linchpin ("fix before generalizing"), but a debounced Supabase push is an async `fetch`. Firing it from a `pagehide`/tab-discard handler does **not** reliably complete a normal async request — the document can be torn down first. Reliable delivery on unload generally needs `navigator.sendBeacon` or `fetch(..., {keepalive: true})`, and Supabase's client (auth headers, JSON body, RLS) may not drop cleanly into either. The plan describes the flush as if it were synchronous. **Suggestion:** specify the actual delivery mechanism and prove it in the manual test (edit → hard-close within the window → confirm the row updated), not just the in-app `switchToLiveSheet()` path where you *can* await. If beacon/keepalive can't carry an authenticated write, the honest fallback is "rely on next-boot reconcile of the dirty record" — which reframes finding 3.

### 3. "Silently lost" overstates same-browser behaviour and undercuts the "must fix first" framing — `moderate`, confidence `high` (given the plan's own Verified facts)
Per the plan's own Verified section, local writes are stamped `dirty:true` and `reconcile()` pushes dirty records at boot / on `online`. On the **same browser**, a pending push interrupted by navigation isn't destroyed — the dirty record persists in local cache and should push on the next reconcile. So the true failure is narrower than "silently lost": it's *cross-device immediacy* (another browser/device won't see the edit until this browser reconciles) and *stranding* (the dirty record may sit unpushed until that character is reopened, if reconcile only touches the loaded id). That's still a real defect, but calling it silent permanent loss inflates its severity and its "must be first" ordering. **Suggestion:** restate the defect precisely (immediacy/stranding, not loss), and confirm whether `reconcile()` at boot sweeps *all* dirty cached records or only the loaded id — the whole safety-net argument rests on that, and it's not in the Verified list.

### 4. An undecided open question is load-bearing for a "Done when" criterion — `blocking`, confidence `high` (internal inconsistency)
Step 3 and Open Questions leave the "behind" refresh trigger (poll vs. `visibilitychange`/focus vs. realtime) **explicitly undecided**, yet "Done when" requires all three tools to *render the behind state* and Verification requires two-tab behind testing. You cannot be "done" on, or test, a mechanism you haven't chosen. **Suggestion:** make the minimal decision now rather than deferring — and note the cheap-vs-deep split maps cleanly here: reconcile-on-`visibilitychange`/focus is the low-cost, durable-enough answer (no idle load, catches the realistic "I switched tabs and came back" case); a fixed polling interval is the shallow-but-costly one that also aggravates the free-tier auto-pause risk you already list; realtime is correctly deferred. My recommendation: adopt reconcile-on-focus/visibility as the baseline, drop interval polling entirely, and leave realtime as the named future.

### 5. The original bug report is never root-caused, yet the pattern gets generalised anyway — `moderate`, confidence `moderate`
The plan is admirably honest that the 3-second flush defect was "never conclusively linked" to the owner's report. But note the report's own facts refute that link: the owner *waited a full minute* (debounce is 3000ms, so it would have fired) and opened a *different browser* (fresh boot → reconcile should pull the server row). If the edit still wasn't there, the edit plausibly never reached the server — which contradicts "autosave is in fact working." Something in that chain (adopt-server-over-dirty in reconcile, session/RLS on the second browser, campaign-bound scoping masking it) is unexplained, and step 4 copies this pattern into a *second* tool and removes the campaign-bound gate. **Suggestion:** before generalising, do one clean end-to-end trace of "edit → confirmed server row" for a *non*-campaign-bound character specifically, since that's the newly-enabled path with the least prior road-testing. You don't need to explain the old report, but you shouldn't scale a path whose one field report is still unaccounted for.

### 6. Chip must `esc()` the character/campaign name — present in Context, absent from approach and Verification — `moderate`, confidence `high`
The Context calls out the hard rule that any player-controlled value reaching innerHTML is a stored-XSS path, and flags that the chip "may render a character or campaign name." Yet step 5 (build the chip) and the entire Verification section never restate it. This is exactly the kind of rule that gets dropped when the same markup is hand-duplicated into three files. **Suggestion:** add "all names rendered in the chip pass through `esc()`" to step 5 and add an explicit line to Verification/Done-when. Cheap to add, genuinely a security regression if missed in one of three copies.

### 7. Persisted `behind` flag needs an invalidation rule or the chip will lie — `moderate`, confidence `high`
Step 2 persists `behind` onto the cached record "so the getter can see it without re-running reconcile." But `behind` is point-in-time truth. Once a subsequent push succeeds or the server row is adopted, a stale persisted `behind:true` makes the chip report a conflict that no longer exists. The plan specifies where `behind` is *set* but not where it's *cleared*. **Suggestion:** define the clear conditions (successful push, server adoption, successful reconcile) alongside the set condition — same rigour the plan already applied to `dirty` set/clear.

### 8. `getSyncState(id)` conflates session-level and character-level state — `moderate`, confidence `moderate`
Four of the six chip states are per-character (`dirty`, `behind`, `saving`, and lastSyncedAt), but `signedIn` and the "signed-in, nothing loaded / brand-new unsaved character" states are per-session and have no meaningful `id`. An API keyed on `id` is awkward for precisely the states DM Console (and a fresh CharGen) will spend most of their time in. **Suggestion:** split into a session read (`signedIn`) and a per-character read, or make `id` optional with defined behaviour when absent — otherwise each of the three tools invents its own "no id yet" handling and the "identical vocabulary" goal quietly erodes.

### 9. DM Console's read-only status is assumed, not verified — and it's load-bearing — `moderate`, confidence `low`
The plan admits it "did not re-verify beyond reading DM Console's header markup." If DM Console can write *anything* that reaches the cloud (an AP nudge, a note, a roster tweak), giving it chip visuals with no dirty/behind logic means it can silently drop a write while showing an all-clear chip — the exact failure class this plan exists to kill. **Suggestion:** promote this from "taken as given" to a one-line verification step ("confirm DM Console issues zero cloud writes") before shipping the chip-only treatment. It's a small check guarding a disproportionate embarrassment.

### 10. Demoting "Save to cloud" — no test that the fallback works when autosave is broken — `moderate`, confidence `high`
Risks correctly says the force-sync fallback "must stay reachable even when the chip's own automatic path is what's broken." But Verification never tests that scenario. As written, you could ship a fallback that only works when it isn't needed. **Suggestion:** add a Verification step: with autosave disabled/failing, confirm force-sync from the chip still pushes. Also confirm the fallback is reachable in the `saving`-stuck and `both` states, not just the happy path.

### 11. This is too much for one "simplification" change — should be split — `moderate`, confidence `moderate`
The plan bundles: a real bugfix (step 1), a new sync-state API (step 2), an undecided behind-detection mechanism (step 3), a behaviour-model change to autosave defaults (step 4), a three-way duplicated UI component (step 5), a control demotion (step 6), a task-board edit (step 7), and two log entries (step 8). Step 1 is independently shippable, independently testable, and is the thing you've labelled "must be first" — that's a signal it wants to be its own merged PR, not a step inside a large one. **Suggestion:** land the flush/navigate fix (and finding 2/3's real mechanism) as a standalone change with its own verification, then build the chip + universal autosave on top. Smaller diffs also match the project's own stated preference for focused changes, which the plan cites approvingly elsewhere.

### 12. "One shared chip = same code duplicated three times, synced by convention" — real, correctly flagged, worth a mitigation — `minor`, confidence `high`
The plan names this maintenance risk squarely (good). Given there's no shared UI layer but there *are* shared modules (`js/sync.js` et al.), consider whether the chip's *state→text/icon mapping* (the part most likely to drift) can live as a pure function in a shared JS module even though the markup can't — reducing "kept in sync by convention" to just the DOM shell. Not blocking; just a way to shrink the risk you've honestly owned.

### 13. `switchToLiveSheet()` awaiting a network write before navigating can hang offline — `minor`, confidence `moderate`
Step 1 says make the switch "await/flush" before `location.href`. If offline (or Supabase paused), an unbounded await strands the user on a dead button. **Suggestion:** bound it — attempt-with-timeout, then navigate regardless and let the persisted `dirty` record + next-boot reconcile be the safety net (which is the same net finding 3 depends on). Never let the sync fix make navigation feel broken.

---

## Sections I judged genuinely solid (not inventing concerns)
- **Verified vs. Assumed split** — this is the strongest part of the plan; it makes exactly the right claims falsifiable and flags what wasn't checked.
- **Out of scope** — well-drawn and defensible; realtime/AP-model/Load-list deferrals are correct, and you resisted the temptation to fold in the AP work.
- **Alternatives considered** — the rejection of "push on every keystroke" (citing the existing comment) and "two separate indicators" (citing the owner's explicit call) are sound and correctly attributed rather than re-litigated.
- **The instinct to fix the flush defect before copying the pattern** — right ordering, even though I've argued (findings 2/3) the defect's mechanism and severity need restating.

---

## Bottom line
Not a rubber stamp, but not a rewrite either. Two blockers I'd resolve before implementation: **(1)** define the dirty+behind resolution UX, and **(4)** decide the behind-detection trigger a "Done when" criterion depends on. One near-blocker: **(2)** prove the `pagehide` flush actually delivers an authenticated async write, or reframe the fix around next-boot reconcile. Everything else is tightening. If you split step 1 out per finding 11 and pin down findings 6, 7, and 10 in the Verification section, the rest of the plan is in good shape to build.

*File: `header-simplification-review-copilot-opus.md`*

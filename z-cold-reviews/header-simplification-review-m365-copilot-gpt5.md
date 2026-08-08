M365 Copilot — GPT-5 reasoning model (default reasoning)

# Cold review: PACT header save/load UX and universal cloud autosave

## Overall assessment

The plan identifies a real UX inconsistency and a credible data-loss defect, but it does **not yet establish a sufficiently precise sync model to implement safely**. Its largest weakness is that it treats “dirty”, “behind”, “saving”, local cache state, and the editor’s current in-memory state as though they are one state machine. The text provided does not prove that they are. Generalising autosave and adding background reconciliation before defining those semantics could create silent overwrites, misleading status chips, or UI/cache divergence.

The flush-on-navigation defect should be fixed promptly, but universal autosave, stale detection, and the shared chip should not all be implemented as one undifferentiated change.

## Findings

1. **Severity: blocking · Confidence: high — `pagehide` does not by itself make an asynchronous cloud flush reliable.**  
   The plan says to flush on `pagehide`, but does not define a browser-lifecycle-safe transport or what “flush” means. Starting or awaiting a normal Supabase request during `pagehide` can still be terminated when the page is frozen or discarded, especially on mobile. The explicit cross-tool switch can await a completed push, but tab close, browser close, process kill, crash, and mobile eviction cannot be guaranteed by an ordinary async handler.  
   **Suggested improvement:** separate the guarantees. For deliberate in-app navigation, cancel the timer, await the current/latest push, handle failure visibly, and navigate only after a defined outcome. For uncontrolled page exit, treat local persistence as the durable guarantee and cloud delivery as best effort; investigate whether the actual Supabase request can safely use `fetch(..., {keepalive: true})` within browser limits. Do not claim that tab close “no longer drops” a cloud push unless the chosen transport is tested and can support the required authentication, headers, and payload. Document unavoidable lifecycle limits.

2. **Severity: blocking · Confidence: high — the plan lacks a single, explicit sync state machine and source of truth.**  
   `getSyncState(id)` is proposed from the cached record, while edits apparently also exist in each tool’s in-memory model and timers/in-flight requests exist outside that record. A cache flag cannot alone distinguish at least: edited but not locally persisted, locally persisted but not scheduled, scheduled, request in flight, failed, offline, conflicted, superseded by a later edit, or successfully synced. The six chip states therefore cannot be derived reliably from the described fields.  
   **Suggested improvement:** define the state machine before implementation, including events, transitions, persistence boundaries, and ownership. Specify which layer is authoritative for `dirty`, `behind`, `saving`, `error`, `offline`, `lastSyncedAt`, and the server revision. Make the chip consume that model rather than infer state independently in each HTML file.

3. **Severity: blocking · Confidence: high — “behind” is defined too narrowly and may be destructive when reconciliation is used as detection.**  
   The verified behaviour says `reconcile(id)` reports `behind` only when a **locally dirty** record conflicts; otherwise it may silently push or adopt a server row. That is not equivalent to “the cloud copy moved past what you are looking at”. A clean cached record can become stale while the editor remains open, and adopting the server row into cache does not necessarily update the editor’s in-memory document. Conversely, using reconcile merely to check freshness may perform writes or replace cached content.  
   **Suggested improvement:** add a read-only freshness check that compares the open document’s known server revision (`base_updated_at` or an immutable version) with current server metadata without pushing or adopting. Define `behind` relative to the document currently displayed, not merely the local cached record. Keep detection, reconciliation, and conflict resolution as separate operations.

4. **Severity: blocking · Confidence: high — combined dirty+behind has no safe resolution path.**  
   The chip can display the conflict, and the existing guard can refuse overwrite, but the plan does not say what the user can do next. “Force sync now” is particularly dangerous wording in this state: users may read it as “overwrite the cloud”, while the existing stale guard correctly refuses that action. A status indicator without recovery leaves the character permanently stuck or encourages destructive workarounds.  
   **Suggested improvement:** define the conflict interaction before shipping the state. At minimum provide explicit actions such as export local copy, reload cloud copy, inspect differences where feasible, and retry after resolving. Never map “force sync” to bypassing the concurrency guard. Rename the fallback to something unambiguous such as “Retry sync” when it cannot force an overwrite.

5. **Severity: blocking · Confidence: high — request ordering and edits made during an in-flight save are unspecified.**  
   Debouncing prevents excessive starts but does not ensure that only one push is active, that responses are applied in order, or that an earlier response does not clear `dirty` after a newer edit. Navigation flush can also race an already-running request or start a duplicate push. This becomes more likely when autosave expands to all signed-in characters.  
   **Suggested improvement:** require per-character serialisation or a single-flight queue, snapshot/version each outbound save, coalesce later edits, and clear dirty only if the acknowledged snapshot still matches the latest local revision. Define how timer cancellation, retry, explicit sync, focus refresh, and navigation flush interact with an in-flight operation.

6. **Severity: blocking · Confidence: high — universal autosave eligibility and first-cloud-write semantics are ambiguous.**  
   “Any signed-in character” and “non-campaign-bound cloud characters” are not necessarily the same set. The plan does not establish whether a local-only character with an ID becomes a cloud record merely because the user signs in, whether imported/exported copies autosave, whether a newly created unsaved character has a stable cloud identity, or whether a character owned by another user/campaign is writable under RLS. This is also the sharpest part of the acknowledged behaviour-model change.  
   **Suggested improvement:** define an explicit eligibility predicate. A safer default is autosave only after a character has an established cloud binding/ownership record, while offering a one-time “Save this character to cloud” enrolment for genuinely local-only characters. If automatic enrolment is desired, specify identity creation, consent/notice, RLS failure handling, duplicates, and sign-out behaviour.

7. **Severity: moderate · Confidence: high — the status vocabulary omits failure and offline states.**  
   The six requested states include “saving” but no “save failed”, “offline”, “authentication expired”, “permission denied”, or “retry scheduled”. A failed request could therefore leave the chip saying “saving”, “unsaved changes”, or even “signed in” without telling the user that automatic protection has stopped. This undermines the stated trust goal.  
   **Suggested improvement:** add an error/offline dimension or state, with accessible detail and a retry action. Decide whether dirty+error and behind+error need combined presentation. Define timeouts so “saving” cannot persist indefinitely.

8. **Severity: moderate · Confidence: high — polling/reconcile-on-focus is presented as tuning, but it is load-bearing and should not be left undecided.**  
   The goal explicitly promises that the chip can say the cloud copy moved ahead. Without a refresh trigger, that promise is false during an open session. Yet calling the current side-effecting `reconcile()` periodically may increase writes or mutate cache, not merely detect freshness.  
   **Suggested improvement:** make a read-only focus/visibility freshness check the minimum implementation. Add bounded polling only after measuring expected active tabs, request volume, free-tier limits, and rate behaviour. Randomise/jitter any interval and stop it for hidden/offline/signed-out tabs. Realtime can remain out of scope, but current detection semantics cannot.

9. **Severity: moderate · Confidence: high — multi-tab behaviour on the same browser is missing.**  
   Two tabs editing the same character share local storage but have separate in-memory models, timers, and requests. Server concurrency checks may catch some races, but cached `dirty`/`behind` flags and chip state can still be overwritten or displayed incorrectly. A `storage` event or `BroadcastChannel` is not discussed.  
   **Suggested improvement:** add same-browser, same-character multi-tab scenarios to the design and verification matrix. Either coordinate ownership/saves across tabs, notify other tabs of revisions, or explicitly warn/prevent concurrent editing.

10. **Severity: moderate · Confidence: high — duplicating the state logic three times conflicts with the “one shared” requirement and increases drift risk.**  
    Standalone HTML files do not preclude a shared JS module or shared stylesheet; the plan itself says shared modules are permitted. Duplicating markup/CSS/state logic “by convention” makes identical vocabulary and behaviour hard to guarantee. It also appears unnecessary for logic even if tool-specific DOM mounting remains local.  
    **Suggested improvement:** put the canonical state-to-label/icon/ARIA/action mapping in a small shared module, and consider a shared CSS asset if standalone deployment permits it. Each tool can supply a namespaced mount element and callbacks. If strict single-file portability forbids shared CSS/JS beyond existing modules, state that constraint explicitly and add a parity test or generated snippet rather than relying on convention.

11. **Severity: moderate · Confidence: high — DM Console’s role is insufficiently verified for a three-tool behavioural contract.**  
    The plan admits it did not verify that DM Console is read-only beyond its header. If it can change AP, campaign assignments, metadata, or character rows, showing only signed-in/out could misrepresent saves and conflicts. If it writes characters, it may itself be the actor that makes editor tabs “behind”.  
    **Suggested improvement:** inspect and document every DM Console write path before fixing its chip states. Define whether its own writes need saving/error feedback and how they trigger version changes seen by editors. If it is truly read-only, record that as verified rather than assumed.

12. **Severity: moderate · Confidence: high — `lastSyncedAt` and persisted `behind` can become misleading across sessions and identities.**  
    Persisting `behind` onto a cached record risks displaying a stale warning after sign-out/sign-in, ownership changes, successful reload, conflict resolution, or switching users on the same browser. A local timestamp is also not proof that the displayed revision is current, and client clocks may be wrong.  
    **Suggested improvement:** define clearing rules and bind sync metadata to user ID, character ID, and server revision. Prefer server-confirmed revision/time for acknowledgement. Test sign-out, account switch, revoked session, deleted cloud row, and character rebind flows.

13. **Severity: moderate · Confidence: high — the manual fallback is not independent of the failing automatic path.**  
    Moving the action into the chip is visually simpler, but if both call the same broken scheduler/state path, it is not a meaningful fallback. Making the chip clickable also risks hiding the action and conflating status with control.  
    **Suggested improvement:** keep a discoverable menu/action labelled by outcome, invoke an immediate serialised save attempt rather than rearming the debounce, expose errors, and preserve export as an independent recovery route. Verify keyboard, touch, and screen-reader operation.

14. **Severity: moderate · Confidence: high — security requirements are acknowledged but not converted into acceptance tests.**  
    The plan mentions `esc()` for character/campaign names but does not identify every rendering surface: chip text, title/tooltip, ARIA label, menu, toast, and attributes. It also does not address unsafe construction if status details include server error text.  
    **Suggested improvement:** add malicious-name fixtures containing HTML, quotes, ampersands, and attribute-breaking payloads, and verify all three tools. Prefer `textContent` and DOM APIs over `innerHTML` where practical; escape according to the destination context rather than assuming one helper safely covers text and attributes.

15. **Severity: moderate · Confidence: high — verification is too happy-path and does not objectively test the core sync guarantees.**  
    “Manual two-browser-tab verification” is underspecified. It omits network failures, offline edits, expired auth, RLS denial, deleted rows, save races, rapid repeated edits, multi-tab same-browser edits, sign-out mid-save, focus refresh, and conflict recovery. “Confirm the edit reached the cloud row” also needs a defined observation point and timeout.  
    **Suggested improvement:** write a state-transition test matrix with preconditions, actions, expected chip state, expected local record revision, expected server revision, and recovery. Use throttled/offline DevTools and controlled delayed responses where possible. Add unit-level tests for the sync state reducer/getter even if authenticated end-to-end tests remain manual.

16. **Severity: moderate · Confidence: high — the Done criteria overclaim close-tab reliability and under-specify identical UI.**  
    “A deliberate navigation away … no longer silently drops a pending cloud push” combines awaitable in-app navigation with unawaitable browser termination. “Same chip markup/vocabulary” does not specify labels, colours, icons, priority when dimensions overlap, accessible names, or error behaviour.  
    **Suggested improvement:** split acceptance criteria into guaranteed in-app navigation, best-effort page exit, and guaranteed local recovery on next launch. Provide a canonical state/output matrix and objective visual/accessibility checks.

17. **Severity: moderate · Confidence: high — this should be split into staged changes.**  
    The current task combines a confirmed data-loss fix, a sync-state API redesign, new stale detection, autosave expansion, three header rewrites, control redesign, task-board maintenance, and documentation. A defect in any layer will be difficult to isolate, and universal autosave increases blast radius immediately.  
    **Suggested improvement:** stage it as: (1) navigation/local-durability fix plus tests; (2) authoritative sync state model and read-only freshness detection; (3) one editor’s chip and recovery UX behind a rollout switch; (4) Live Sheet and non-campaign expansion after write-volume/error observation; (5) DM Console visual parity and task-board cleanup. Logs can be updated with each stage.

18. **Severity: minor · Confidence: high — terminology is internally inconsistent.**  
    The text refers to “three tools”, “both editor tools”, Live Sheet separately, and campaign/non-campaign cloud characters in ways that make eligibility difficult to follow. “Signed-in” is also treated as a save state even though authentication state and document sync state are separate dimensions.  
    **Suggested improvement:** define a short glossary: tool roles, local-only character, cloud-bound character, campaign-bound character, dirty, behind, conflict, saving, synced, and eligible for autosave. Model authentication separately, even if the chip composes both dimensions.

19. **Severity: minor · Confidence: high — the plan does not quantify or instrument the write-volume risk it raises.**  
    The quota concern is acknowledged but left without a decision gate. Without telemetry or even a rough estimate, there is no basis for deciding whether 3 seconds is acceptable after removing the gate.  
    **Suggested improvement:** estimate writes per active editing session and expected concurrent users, check Supabase project limits before rollout, and add lightweight client-side diagnostics or server-side query monitoring. Tune the debounce based on observed edit bursts; consider a maximum-delay cap so continuous editing eventually syncs.

20. **Severity: minor · Confidence: high — some sections are solid and should be retained.**  
    The plan clearly separates verified facts from assumptions, avoids blaming the newly found defect for an unproven original symptom, preserves the concurrency guard, records the behaviour-model change, excludes pricing-engine/version changes, and requires the existing regression fixture to remain green. These are strong scoping and reasoning choices.  
    **Suggested improvement:** retain those sections, but make the unresolved sync semantics and browser-lifecycle limitations explicit gates rather than implementation-time details.

## Bottom line

Do not implement the plan exactly as written. Fix the confirmed navigation defect first, but redefine its guarantee honestly. Before universal autosave or polling, specify an authoritative per-character sync state machine, a read-only freshness check, ordered save processing, autosave eligibility, failure states, and conflict recovery. Once those are settled, the common chip becomes a presentation layer over reliable semantics rather than a polished indicator of uncertain state.

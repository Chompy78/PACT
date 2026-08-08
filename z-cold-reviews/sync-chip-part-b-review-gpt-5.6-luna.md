GPT-5.6 Luna (default reasoning mode; no extended-thinking setting exposed)

# Cold review: Shared cloud-sync status chip + universal autosave (Part B)

Source reviewed: `Pasted markdown(6).md` (the supplied Part B plan). This is a cold review of the plan text only; I did not inspect the codebase.

## Overall assessment

The plan is substantially stronger than a typical UI-only sync plan. The B1/B2/B3 split is sensible, the decision to make freshness checking read-only is particularly good, and the conflict UX correctly avoids pretending that a stale-save refusal is a usable "force sync" action. The DM Console scope is also appropriately narrower than the editor tools. The plan therefore closes most of the five stated historical blockers conceptually.

I would **not implement B3 yet**, however. There are two issues I consider blocking: the proposed definition of autosave eligibility is not durable enough to support the stated behaviour, and the sync-state contract is still underspecified at the boundary between local edit state, sync.js state, and the UI. There are also several moderate verification and lifecycle gaps that should be fixed before implementation.

## Findings

1. **blocking, high — Autosave eligibility is not reliably derivable from the local cache**

   B3 says that a character becomes eligible after a confirmed cloud save, but then defines eligibility as whether the character already has a confirmed cloud row, "derivable from the existing local cache". Those are not necessarily equivalent over the lifetime of an application. A local cache can be missing, be cleared, be stale, be recreated on another browser/device, or fail to contain the expected metadata even though the server row still exists. Conversely, a stale local record could make a character appear eligible when the current server/account relationship no longer supports that assumption.

   This matters because B3 makes eligibility the gate for an ongoing write behaviour, not merely a UI convenience. The plan needs an explicit authoritative source and lifecycle for eligibility.

   **Suggested improvement:** define precisely whether eligibility is authoritative server-side (for example, existence of the user's character row) or intentionally device-local consent. If it is server-side, state how B3 obtains that fact on boot/character load and what happens on a new device. If consent is intentionally device-local, introduce and document a durable consent marker and define its clearing/transfer semantics. Do not describe "confirmed cloud row" and "local cache" as interchangeable unless the existing architecture guarantees that invariant.

2. **blocking, high — The `pendingEdit` contract is not sufficiently specified to make the state machine authoritative**

   B1 correctly identifies the 3-second blind window, but the proposed fix says "each tool sets a local `pendingEdit` flag" while `getSyncState(id)` lives in `js/sync.js`. The plan does not specify where that flag lives, whether it is keyed by character ID, how it survives character switches, how concurrent save operations interact with it, or exactly which event clears it.

   The clearing rule is especially important: "cleared only once `js/sync.js` confirms `dirty:false` with no push scheduled/in-flight" leaves several races implicit. An edit can occur while a save is in flight; a character can be switched while a debounce is pending; a failed push can leave dirty state; and an old save completion must not clear the pending state belonging to a newer edit.

   **Suggested improvement:** define the state transition contract explicitly, ideally with a per-character revision/generation (or equivalent monotonic edit token). State which component owns `pendingEdit`, how it is associated with an ID, and what exact save completion is allowed to clear it. Include edit-during-save and character-switch-during-save as B1 state-machine tests, not only as a B3 matrix item.

3. **moderate, high — The six-state vocabulary and the internal state vocabulary are not cleanly aligned**

   The standing scope says the shared vocabulary is `signed-out, signed-in-idle, saving, dirty, behind, dirty+behind`, while `getSyncState()` returns `{signedOut, idle, dirty, saving, behind, conflict}`. This is understandable because `conflict` represents `dirty+behind`, but the plan should make that translation explicit rather than having two vocabularies that appear to describe the same state.

   **Suggested improvement:** document a single canonical internal enum and a single presentation vocabulary, with an explicit mapping such as `conflict -> dirty+behind`. Also specify what happens when a state is impossible or unknown.

4. **moderate, high — `behind` is defined, but the "what the user is behind from" model needs a clearer invariant**

   `checkFreshness()` compares server `updated_at` with locally known `base_updated_at`, but the plan does not state the invariant that `base_updated_at` represents. For example, is it always the server version from which the current local build was loaded, or can it be updated by unrelated metadata? The correctness of `behind` depends on this being stable.

   **Suggested improvement:** explicitly define `base_updated_at`: when it is established, when it advances, and which operations are allowed to change it. Add tests for clean-local/server-newer, dirty-local/server-newer, server-unchanged, successful push, and conflict-resolution reload.

5. **moderate, high — A freshness check can identify staleness but cannot provide a complete "honest" status without defining unknown/error states**

   The proposed state set contains no state for "freshness check failed", "offline", "session expired", or "sync status unknown". Yet B3's verification explicitly includes offline/failed-push and expired-auth cases. If a freshness request fails, the plan does not say whether the chip remains `idle`, becomes `dirty`, displays an error, or silently retains an old `behind` value.

   This is potentially misleading for a status indicator whose stated purpose is to be "honest".

   **Suggested improvement:** either add an explicit `unknown/error` state to the canonical state model, or explicitly define failure semantics (for example, preserve the last known state plus a separate transient error indicator). The latter may be preferable if the six-state UI vocabulary is deliberately frozen, but the behaviour must be specified and tested.

6. **moderate, high — The 30-second freshness cadence is a reasonable starting point, but the plan lacks an acceptance criterion**

   The plan says 30 seconds is an open question and calls for reviewer input, but implementation still needs an objective rule. "At most once per 30s" is a throttling mechanism, not a product requirement.

   **Suggested improvement:** define the intended behaviour first (for example, check on focus/visibility return, subject to a minimum interval), then make 30 seconds the initial implementation constant. Measure request volume in realistic use and record the result before merging B3. If 30 seconds remains, promote it from an unresolved question to an explicit decision.

7. **moderate, high — B3's write-volume gate is not actually a gate yet**

   "Re-measure write volume before merging" is good risk awareness, but no threshold, measurement window, expected user population, or decision rule is specified. Consequently an implementer can complete B3 while technically satisfying the text regardless of whether Supabase usage becomes problematic.

   **Suggested improvement:** define a concrete measurement protocol and acceptance threshold before B3 implementation. For example: representative character-edit sessions × expected active users × autosave frequency, compared with the applicable Supabase quota/headroom. If the numbers are unknown, make the result an explicit owner decision rather than an informal re-measurement.

8. **moderate, high — The conflict-resolution path needs a post-reload state contract**

   Reusing `loadCloudChar()` is a strong choice, but the plan only specifies that the user confirms a reload. It does not explicitly state the expected state transitions afterwards: `behind` must clear, local `pendingEdit` must clear, `base_updated_at` must advance to the loaded server version, and the UI must leave `dirty+behind`.

   **Suggested improvement:** make these postconditions part of B2's acceptance test. Also test canceling the conflict prompt: the state should remain `dirty+behind` and no local data should be silently discarded.

9. **moderate, high — Character switching while a save is pending needs to be a first-class B1 invariant, not only a B3 edge case**

   The plan explicitly mentions "character-switch-while-a-save-is-pending" in B3 verification, which is good, but this race exists in the state machine introduced in B1 and affects every subsequent branch.

   **Suggested improvement:** move the scenario into B1 verification and require that completion/failure of character A's save cannot clear, overwrite, or relabel character B's pending state. This should be keyed by character ID and, ideally, a save/edit generation.

10. **moderate, medium — The plan does not specify what happens when a character has a cloud row but the current device has no usable local cache**

    This is the practical consequence of finding #1. A user may sign in on a second device and open a cloud character. The plan needs to distinguish "this character is eligible for autosave" from "this device currently has the character loaded and has a baseline from which to autosave".

    **Suggested improvement:** define boot/load sequencing: authenticate → discover/load cloud character metadata → establish local baseline → mark eligibility → enable autosave. Do not enable autosave merely because an ID is known.

11. **moderate, medium — DM Console's "shared chip" requirement is semantically inconsistent with the stated universal vocabulary**

    The plan explicitly and reasonably narrows DM Console to signed-in/out only, but the goal and standing scope repeatedly describe one shared six-state chip "across all three tools". A future implementer could read this as requiring the same state machine in DM Console, which the plan then says is inappropriate.

    **Suggested improvement:** change the requirement language so that "shared" clearly means shared visual/authentication treatment and shared mapping primitives, while the editor tools use the six-state sync chip and DM Console uses the two-state auth chip plus action-local feedback.

12. **moderate, medium — `esc()` coverage is called out, but the verification does not establish that all dynamic chip attributes are covered**

    The plan correctly recognises the trust boundary and explicitly names label, tooltip/title, and aria-label. The verification says to use a malicious-name fixture, which is good. However, the acceptance criterion should identify the actual dynamic surfaces to prevent a future implementation from escaping visible text while forgetting an attribute.

    **Suggested improvement:** make the fixture assert that the malicious value is rendered literally/safely in every dynamic text and attribute surface, and that no executable markup/event attribute is introduced.

13. **minor, high — B1 says "without a live session where possible", but the boundary requiring integration tests is unclear**

    Pure state-machine tests are appropriate, but `checkFreshness()` necessarily crosses the data boundary. A completely mocked test can prove the algorithm while missing auth/RLS/query-shape problems.

    **Suggested improvement:** retain pure unit-style tests but add one minimal integration/manual test proving that the real freshness query can read only the intended metadata and cannot mutate the character.

14. **minor, medium — The plan should explicitly state whether a successful manual "Save to cloud" immediately opts the character into autosave even if B3 has not yet completed**

    B3 says the manual save is the consent moment, but the implementation boundary is B3. This is probably obvious, but the plan should state that B1/B2 do not accidentally alter existing manual-save semantics and that eligibility is only acted upon once B3 ships.

    **Suggested improvement:** add a versioned behaviour statement to B3: before B3, manual save remains manual; after B3, a confirmed manual save opts that character into autosave.

15. **minor, medium — The verification matrix should include repeated edits during debounce**

    The stated problem is a debounce blind window, so testing a single edit is not enough. Multiple edits before the debounce fires are where a poorly specified `pendingEdit` lifecycle can fail.

    **Suggested improvement:** add rapid repeated edits, edit → save starts → edit again, failed save → edit again, and offline → online → edit sequences.

## Assessment of the five claimed blocking findings

### 1. State machine
**Mostly closed, but not fully.** The explicit precedence and `pendingEdit` concept are a meaningful improvement. The remaining blocking issue is the lifecycle/ownership contract for `pendingEdit`; without it, the state machine is specified at the label level but not sufficiently at the transition level.

### 2. Behind clear-conditions
**Conceptually closed.** The plan gives explicit clear conditions and correctly avoids conflating freshness detection with reconciliation. It should add postconditions for reload and define the `base_updated_at` invariant.

### 3. Refresh trigger
**Closed as a deliberate product decision, with one caveat.** Focus/visibility plus throttling is a coherent trigger and the explicit deferral of polling/realtime is defensible. The remaining gap is defining failure/unknown semantics and setting an acceptance criterion for the 30-second value.

### 4. Conflict-resolution UX
**Strongly closed.** Reusing the existing `onBehind`/confirm-and-reload primitive and explicitly rejecting "Force sync now" directly addresses the stale-save-guard problem. Add cancel/post-reload state assertions, but this is no longer a blocking design gap.

### 5. DM Console scope
**Closed.** The plan correctly recognises that DM Console is not a character-build editor and does not pretend that `dirty`/`behind` apply there. Verifying the existing action-local status elements before adding new UI is also the right approach.

## What is solid

- The three-branch split is appropriate and independently testable.
- Keeping freshness checking read-only rather than reusing `reconcile()` is a particularly good architectural decision.
- The explicit `saving > conflict > behind > dirty > idle` precedence removes an otherwise common source of contradictory status.
- Reusing the existing conflict-resolution primitive avoids inventing a second stale-data mechanism.
- Keeping realtime, idle polling, multi-tab coordination, rules-engine changes, and stale-save-guard changes out of scope keeps the work bounded.
- Calling out `esc()` as a trust-boundary requirement is important and correctly treated as more than cosmetic.
- The plan does not silently assume owner approval for the B3 consent decision.

## Recommendation

**Approve B1/B2 with the moderate findings addressed during implementation; hold B3 until the eligibility/consent model and write-volume acceptance criteria are made authoritative.**

The most important change is to replace the current informal equivalence:

> "confirmed cloud row" ≈ "derivable from existing local cache"

with an explicit, durable eligibility contract. The second most important change is to turn `pendingEdit` from a concept into a specified per-character state transition with race-safe clearing.

With those changes, the plan would be in good shape for implementation. The historical five blockers are not simply being restated: four are substantially resolved, while the state-machine blocker still needs one level more precision and B3 introduces a new load-bearing eligibility ambiguity.

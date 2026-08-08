```
gpt-5 (default)
```

**Reviewer:** GPT-5 (default, no external tools)
**Plan:** Simplify header save/load UX + universal cloud autosave across PACT's three tools

---

### Overall assessment

This is a thoughtful, internally consistent plan with a strong grounding in actual code inspection (the “Verified” section is unusually good). The architecture (three standalone HTML files, shared modules) is acknowledged, and the tradeoffs are surfaced honestly. That said, the plan has several gaps — some structural, some behavioral — that need resolution before implementation. The biggest risks are around **undefined state semantics** (what exactly does “dirty” mean?), **missing failure handling** (what happens when autosave fails?), and **unclear verification** (how do we know the chip states are accurate?).

---

### Findings

#### 1. The definition of "dirty" is ambiguous and may lead to false positives/negatives

**Severity:** `blocking`
**Confidence:** `high`

The plan says `dirty` is set by `saveCharacter()` and cleared by `applyServerMeta()`. But `saveCharacter()` is called on every local write — which includes `localStorage` saves triggered by the user's own edits. That's correct. But does `saveCharacter()` get called for *every* edit in both tools? In CharGen, the edit path goes through `emit()` → `render()` → `_cgAutosave()` → `_cgCloudAutosave()`, which calls `setTimeout(_cgCloudPush, 3000)`. But `_cgCloudPush()` calls `saveCharacter()` only if it actually performs a cloud push. If the user is offline, or if the push fails, `saveCharacter()` is never called — so `dirty` remains `false`, and the chip will incorrectly show "signed-in (nothing pending)" even though local edits exist. This is not a theoretical edge case; it's the normal offline/backoff path.

**Suggested fix:** Define `dirty` as "there are unsaved local edits that have *not yet been successfully pushed to the cloud*", and set it unconditionally on every local edit, clearing it only after a successful push. The current code (`_cgCloudAutosave` sets a timer, and the timer's callback calls `saveCharacter`) means `dirty` is only set *after* the debounce, not before — so the chip will show "signed-in" for up to 3 seconds after every edit, which violates the goal ("your edits haven't reached the cloud yet").

---

#### 2. "Behind" detection is underspecified and may be unreliable

**Severity:** `blocking`
**Confidence:** `high`

The plan proposes to persist `behind` from `reconcile()` onto the cached record and then refresh it "on a bounded interval and/or on visibilitychange/window focus". But `reconcile()` today is called only at boot and on `online` events. Extending that to a periodic poll introduces a new risk: if the poll fails (network error, auth expiry, Supabase outage), `behind` remains stale. The plan does not specify what happens in that failure case — does the chip show "behind" incorrectly, or does it show "signed-in" and risk a conflict later? Both are bad.

More importantly, `reconcile()` today is a *push-then-pull* operation: it tries to push the local dirty record, and if that fails with a conflict, it sets `behind`. But if the local record is *not* dirty, `reconcile()` does nothing — it does not fetch the server version to check if a newer version exists. That means a second device could edit a character while this tab is open, and this tab's `behind` state would never be set unless the local user makes an edit and tries to push. The plan's proposed refresh mechanism (polling) would need to call a *new* function that fetches the server row and compares `updated_at` even when there are no local changes. That function does not exist today, and the plan does not describe it.

**Suggested fix:** Be explicit about the new `reconcile()` variant or a separate `checkBehind()` function that fetches the server row and compares timestamps, with a clear failure-handling policy (e.g., "if fetch fails, keep the previous `behind` state and retry on next interval").

---

#### 3. The "flush on navigation" fix is incomplete: it only covers explicit navigation, not tab closure or background kill

**Severity:** `moderate`
**Confidence:** `high`

The plan adds `pagehide` flush, which is good. But `pagehide` is not guaranteed to fire on mobile when the browser kills a background tab, or on desktop when the OS terminates the process. The plan says "preferred over beforeunload for reliability on mobile/tab discard", but `pagehide` is still not reliable in all cases. The only truly reliable way to ensure a pending push is not lost is to push on every edit (no debounce), which the plan explicitly rejects. So the fix is *partial* — it will catch deliberate navigation and normal tab closure in most desktop browsers, but not all cases. That's acceptable if framed as "defense in depth", but the plan presents it as a complete fix.

**Suggested fix:** Acknowledge that the flush-on-navigation fix is a best-effort improvement, not a guarantee, and document the remaining edge case (OS-level tab kill) as a known limitation. If that's unacceptable, revisit the "no debounce" alternative.

---

#### 4. The user-facing behavior change (universal autosave) is not communicated to the user

**Severity:** `moderate`
**Confidence:** `high`

Today, a signed-in user who never clicks "Save to cloud" remains local-only. After this change, that is no longer true — every edit will be pushed to the cloud. The plan mentions this as a risk but does not propose any user-facing notice (e.g., a one-time tooltip, a changelog entry, a banner). This matters because a user might have intentionally kept a character local (e.g., a draft they didn't want to share with the campaign). The plan's "done when" does not include any communication step.

**Suggested fix:** Add a verification step that confirms the user has been informed — either via a visible note in the UI (e.g., "Autosave to cloud is now enabled for all signed-in characters") or via the project's changelog/decisions log, with a clear explanation of the behavioral change.

---

#### 5. The "force sync now" fallback control is not clearly designed

**Severity:** `moderate`
**Confidence:** `medium`

The plan says: "Turn '☁ Save to cloud' into a 'Force sync now' action reachable from the chip (e.g. the chip itself is clickable, or opens a small menu)". This is vague. If the chip itself is clickable, what happens? Does it trigger a sync? Does it open a dropdown? If the autosave path is broken (e.g., because the user is offline or auth is expired), the fallback must still work. But if the chip is the only control, and the chip's own state is derived from the same sync layer that might be broken, there's a circular dependency: the user needs to trigger the fallback, but the control's state may be misleading.

**Suggested fix:** Define a separate, always-visible "Force sync" button (small, secondary) that is *not* the chip itself, so the user can always force a sync regardless of the chip's state. The chip then becomes a *status indicator* that is clickable for more details, not the primary action.

---

#### 6. The plan assumes DM Console is read-only, but this is not verified beyond reading the header markup

**Severity:** `moderate`
**Confidence:** `medium`

The plan says "DM Console needs no autosave/dirty/behind logic at all, since it's understood elsewhere in this project as a read-only roster viewer that never edits a character's own data — this plan takes that as given but did not re-verify it beyond reading DM Console's header markup this session." This is a weak foundation. If DM Console has any editing capability (e.g., DM-only notes, initiative tracking, or character status updates), then it *does* need dirty/behind logic. The plan's own "Alternatives considered" section does not mention DM Console at all.

**Suggested fix:** Re-verify DM Console's actual behavior by reading its edit/save code paths (not just the header), or explicitly note in the plan that DM Console is excluded from the autosave/dirty/behind logic and document that decision.

---

#### 7. The shared chip design is duplicated across three files, but the plan does not specify how to keep them in sync

**Severity:** `moderate`
**Confidence:** `medium`

The plan acknowledges this risk: "a real maintenance risk the reviewer should weigh explicitly, not wave through." It then does not resolve it. Given that the three tools are standalone HTML files, duplication is inevitable, but the plan could mitigate the risk by:

- Defining a single CSS block and markup template in a shared file (e.g., `js/ui-chip.js`) that each tool imports, even if it's just a string template.
- Or, at minimum, creating a shared reference document that lists the exact HTML and CSS for the chip, so changes are coordinated.

**Suggested fix:** Add a step in the plan to create a shared chip component (even a simple one) in `js/` that exports a function to render the chip, so the three tools call the same code. This avoids the "convention-only" sync problem.

---

#### 8. The verification plan does not include a test for the "behind" state refresh while the tab is idle

**Severity:** `moderate`
**Confidence:** `medium`

The manual two-browser-tab verification will test the initial "behind" state after a sync, but it will not test the refresh mechanism (polling/focus) while the tab sits open. The plan does not specify how to verify that the chip updates when a second device edits a character *while this tab is open and not being edited*. This is the core new behavior for "behind" detection. Without a clear verification step, this feature is likely to be merged untested.

**Suggested fix:** Add a verification step: open a character in Tab A (editor), leave it idle. Open the same character in Tab B, make an edit, wait for the autosave. Then, without refreshing Tab A, verify that Tab A's chip eventually shows "behind" (or "dirty+behind" if Tab A has unsaved edits). Also verify that the refresh mechanism (polling/focus) does not cause excessive API calls.

---

#### 9. The "saving" state is mentioned but not defined

**Severity:** `minor`
**Confidence:** `medium`

The chip states include "saving", but the plan does not specify when this state is shown (e.g., during the 3-second debounce? During the actual network request? After the request starts but before it completes?). If "saving" is shown during the debounce, the chip will say "saving" for 3 seconds even though no network request has been sent — which is misleading. If it's shown only during the network request, the user may not see it if the request is fast.

**Suggested fix:** Define "saving" as "a network request is in flight" (i.e., after the debounce timer fires and the `fetch` is pending). Show a spinner or animated state to indicate progress, and disable editing feedback if needed.

---

#### 10. The "Done when" condition about the chip being "the same chip markup/vocabulary" is ambiguous

**Severity:** `minor`
**Confidence:** `medium`

The plan says "the same chip markup/vocabulary used identically in all three tools" — but does that mean the *exact same HTML string* (including IDs, classes, and structure), or does it mean the *same visual appearance and state vocabulary* but with tool-specific IDs? If the IDs are different, the chip is not "the same" in a code-sync sense, and the maintenance risk increases. If the IDs are the same, there's a risk of collision if two tools are loaded in the same page (they are not, but it's a potential future concern).

**Suggested fix:** Be explicit: the chip will use the same CSS classes and structure, but IDs will be namespaced per tool (e.g., `#ls-cloud-chip`, `#cg-cloud-chip`). The markup and state logic will be functionally identical, but not literally the same HTML string, to avoid ID collisions.

---

### Summary of recommended changes

- **Blocking:** Resolve the "dirty" state definition and ensure it reflects unsaved edits even before the debounce. Define and implement a proper "behind" refresh mechanism, including a fetch that works when there are no local changes.
- **Blocking:** Clarify what happens when autosave fails (network error, auth expiry, conflict) — does the chip show an error state? Does it retry?
- **Moderate:** Add user-facing notice about the behavioral change.
- **Moderate:** Redesign the "force sync" control so it's independent of the chip itself.
- **Moderate:** Re-verify DM Console's read-only status, or explicitly exclude it from the dirty/behind logic.
- **Moderate:** Create a shared chip component in `js/` to avoid duplication drift.
- **Moderate:** Add a verification step for the idle-tab "behind" refresh.
- **Minor:** Define the "saving" state precisely.
- **Minor:** Clarify what "same chip markup" means in practice.

---

### Verification of "Verification" and "Done when"

- Most verification steps are objective (visual check, regression test, manual two-browser-tab). The "behind while tab idle" step is missing (see finding 8).
- The "Done when" condition about the chip being "the same" is ambiguous (see finding 10).
- The regression test (0 failed) is not enough — it only covers rules engine, not sync or UI.

---

### Should this task be split?

Yes — at minimum, split into:

1. **Infrastructure:** Fix the flush-on-navigation bug, add the sync state API, and implement the behind-refresh mechanism.
2. **UI:** Build the shared chip component and replace the three existing indicators.
3. **Behavioral:** Enable universal autosave and demote the manual save button.

This allows the backend sync changes to be verified independently of the UI changes, and reduces the risk of a large, interwoven PR.

---

### Final verdict

The plan is well-researched and addresses the stated goal, but it has several unresolved gaps that make it incomplete. With the suggested fixes, it would be solid. Without them, it risks shipping a feature that shows incorrect state and loses edits in edge cases.

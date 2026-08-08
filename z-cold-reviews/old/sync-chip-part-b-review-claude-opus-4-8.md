# Cold review — "Shared cloud-sync status chip + universal autosave (Part B)"

**Reviewer:** Claude Opus 4.8 (via Microsoft Copilot; extended-reasoning mode)
**Vendor family:** Anthropic — *same family as one prior reviewer; adds no cross-family diversity, weight accordingly.*
**Basis:** Plan text only, no codebase access. Findings judge logic/clarity/scope/risk, not code correctness.

---

## Verdict in one line
Structurally sound and noticeably more honest than a re-defer, but it **oversells its own uniformity and honesty**, has **two real inter-branch ordering/coupling gaps**, and its headline "resolved blocking finding" — the conflict UX — is the **weakest** of the five it claims to close (it trades "no next step" for "only a lossy next step, unlabelled as lossy").

---

## Findings

### F1 — `pendingEdit` breaks `js/sync.js` purity with no defined interface
- **Severity:** moderate · **Confidence:** high
- **Gap:** B1 puts `pendingEdit` as a *tool-local* flag (set in CharGen `_cgAutosave()` / Live Sheet `save()`) but then says `getSyncState()` — which lives in the "pure, tool-agnostic" `js/sync.js` — "treats `pendingEdit` as equivalent to `dirty`." How does a pure module read a flag owned by the tool? The plan never says. This is the exact coupling the "Alternatives considered" section rejects on principle (keeping `sync.js` pure). You can't have both.
- **Fix:** specify the seam explicitly — e.g. `getSyncState(id, { pendingEdit })` passed in by the caller, or a `sync.setPendingEdit(id, bool)` setter that `sync.js` owns. Pick one and name it in B1, or the purity claim is false in practice.

### F2 — `behind` silently changes from a transient return value into persisted state, with no storage location named
- **Severity:** moderate · **Confidence:** high
- **Gap:** Your own "Verified facts" say `reconcile()` returns `{behind:true}` *transiently, never persisted*. B1 now needs `behind` to be a **queryable, persisted** state that `getSyncState()` reads and that has explicit "clear conditions." That is a genuinely *new* piece of stored state, but the plan frames it as reuse and never says where it lives (the local cache record next to `dirty`? a separate map?). Its **set** conditions are also under-specified — step 4 lists three *clear* conditions but only `checkFreshness()`/`reconcile()` as setters.
- **Fix:** state that B1 introduces a persisted `behind` field in the local cache record, define both set and clear transitions symmetrically, and stop describing it as reuse of `reconcile()`'s transient value.

### F3 — `checkFreshness()` depends on a stored `base_updated_at` that is *assumed*, not in your verified-facts list
- **Severity:** moderate · **Confidence:** high
- **Gap:** `checkFreshness()` "compares to the locally known `base_updated_at`." Your verified section confirms `applyServerMeta()` clears `dirty` after a push — but it does **not** confirm that a server `updated_at` is persisted locally as a comparison baseline. If no such baseline is stored today, `checkFreshness()` as designed is unimplementable, and the whole `behind` mechanism collapses.
- **Fix:** move `base_updated_at` from implicit assumption to a verified fact (or add "persist server `updated_at` on push/adopt" as an explicit B1 sub-task).

### F4 — "Independently mergeable" is false for B2 → Live Sheet without B3
- **Severity:** moderate · **Confidence:** high
- **Gap:** B2 step 4 demotes "Save to cloud" to a chip fallback action. But per your verified facts, **Live Sheet has no cloud autosave until B3**. So merging B2 *without* B3 makes Live Sheet's *only* cloud-save path harder to find while still not automatic — a net UX regression in the B2-only window. This directly contradicts the "each independently mergeable" claim in Proposed approach.
- **Fix:** either (a) gate the *demotion* of manual save in Live Sheet on B3 landing, or (b) explicitly document that B2 must not ship to Live Sheet ahead of B3. CharGen is fine (it already autosaves); Live Sheet is the exception.

### F5 — Conflict resolution is discard-only and lossy, and not labelled as such — the weakest of the five "resolved" findings
- **Severity:** moderate (borderline blocking) · **Confidence:** high
- **Gap:** Reusing `onBehind` → confirm-and-reload is clean *mechanically*, but for a genuine `dirty+behind` conflict, "Reload the cloud version" **discards the user's local unsaved build work**. The plan removes "Force sync now" entirely, so a user in conflict has **no path to keep their local edits** — the only resolution destroys them. The original blocking finding was "Force sync hits the stale-save guard with no next step." The proposed fix swaps that for "one next step, which is always lossy, and the label doesn't say so." That restates the gap more than it closes it.
- **Fix:** at minimum, label the loss explicitly ("Reload cloud version — your unsaved local changes will be discarded") and consciously decide + document that there is deliberately no keep-mine/merge path. If keep-mine is genuinely out of scope, say *why* discarding local build work is acceptable here — don't leave it implicit.

### F6 — "One shared indicator across all three tools" is really "two full chips + one partial chip + bespoke per-action text"
- **Severity:** moderate · **Confidence:** high
- **Gap:** The goal sells uniformity ("three tools one shared honest indicator"). B2 then, reasonably, gives DM Console a *narrower* signed-in/out-only chip **plus a separate per-action status paradigm** for `awardAp`/`setCharacterDmNotes`/`unbindCharacter`. That's a defensible design — but it means DM Console runs two status paradigms and diverges from the other two tools. The plan's framing undersells this divergence.
- **Fix:** reword the goal/scope to "one shared *vocabulary and mapping function*; DM Console uses a deliberately reduced subset plus point-of-action feedback." Honesty about the non-uniformity is cheap and avoids a reviewer (or future you) reading it as a contradiction.

### F7 — The chip cannot be "honest" about `behind` in the very case it exists for (concurrent editing), given multi-tab coordination is out of scope
- **Severity:** moderate · **Confidence:** medium
- **Gap:** `behind`/`conflict` only matter under concurrent editing. Yet `checkFreshness()` fires only on focus/visibility (≥30s apart) and idle/realtime polling is deferred. So during an active single-tab session, `behind` is essentially never updated until push time. Worse: **cross-tool same-character editing is native to PACT** (shared `character-store.js`; CharGen edits a char while Live Sheet has it open). That's not exotic — it's the app's whole point — yet "same-browser multi-tab coordination (BroadcastChannel)" is dismissed in Out of scope as "lowest-confidence, single-vendor-family." I'd raise its load-bearing-ness: the chip's `behind`/`conflict` states are most-needed exactly where the plan defers detection. The stated goal word "honest" then overclaims — the chip is honest about *local* state and only *best-effort, focus-gated* about *remote* state.
- **Fix:** soften the goal wording from "honest" to "honest about local state, best-effort about remote," and reconsider whether a lightweight `BroadcastChannel` same-browser signal belongs *in* B1 rather than deferred — it's cheap and directly serves the cross-tool case. (Answers instruction #6: yes, an Out-of-scope item is more load-bearing than credited.)

### F8 — B3 consent: one manual save ≠ informed consent to *perpetual* autosave, and there is no opt-out
- **Severity:** moderate · **Confidence:** high
- **Gap:** The chosen default is better than retroactive-on-sign-in, agreed. But "clicked Save to cloud once" is being treated as consent to **continuous background autosave forever**, with **no described disable path**. A user may click "Save to cloud" meaning "snapshot this now," not "enrol this character in perpetual sync." And once eligible, there's no way back to local-only (you explicitly rule out backfill, but also never provide a forward opt-out). That's a real data-handling decision, which is precisely the class of thing the prior review said not to assume.
- **Fix:** either (a) add a per-character autosave toggle so eligibility is revocable, or (b) explicitly state in the B3 decision record that the first manual save is a one-way, irrevocable enrolment and justify why that's acceptable. Also handle the cross-device edge: a character *loaded from cloud* on a new device has a cloud row but was never manually saved *on that device* — confirm it counts as eligible (it should) and that the eligibility signal survives a cloud load, not just a cloud save.

### F9 — No automated test for the state machine, despite the project's own fixture-test culture
- **Severity:** moderate · **Confidence:** high
- **Gap:** `getSyncState()` is a pure function with a defined precedence order — the *ideal* unit-test target — and the repo already has a fixture harness (`engine-parity.html`). Yet B1 verification only says "exercise … against known cache states … where possible" and a manual two-tab check. "Where possible" is an escape hatch, not a test. This is a missing verification step (instruction #4) *and* an objectively-checkable gap (instruction #5).
- **Fix:** add a small fixture/table-driven test asserting each precedence rule (`saving > conflict > behind > dirty > idle`, plus `signedOut` overriding all) and the `pendingEdit ≡ dirty` merge. Cheap, and it locks the one part most prone to silent regression.

### F10 — "Re-measure write volume" has no threshold, so B3's key risk gate isn't objectively checkable
- **Severity:** moderate · **Confidence:** high
- **Gap:** B3 verification says "re-measure, not assume" the Supabase free-tier write volume — but names no budget, no pass/fail number, no measurement method. That fails instruction #5: it reads as diligence but can't actually gate a merge.
- **Fix:** state the concrete budget (writes/character/session, or debounce floor) and the measurement method, so "re-measured OK" is a checkable claim rather than a vibe.

### F11 — "Done when" is satisfiable without ever delivering the autosave half of the Goal
- **Severity:** minor · **Confidence:** high
- **Gap:** "Done when … the B3 consent default is either owner-approved and implemented, **or explicitly still pending**." The OR lets the plan be "done" with B3 unbuilt — meaning the Goal's second clause ("make cloud autosave the default beyond campaign-bound") can remain unmet while the plan reports done. Honest about the gating, but the Done-when does not entail the Goal.
- **Fix:** split Done-when into "Done (B1+B2)" vs "Goal fully met (requires B3)" so the two aren't conflated.

### F12 — State-vocabulary naming drift (`idle`/`conflict` vs `signed-in-idle`/`dirty+behind`)
- **Severity:** minor · **Confidence:** high
- **Gap:** The standing scope's six-state vocabulary (`signed-out, signed-in-idle, saving, dirty, behind, dirty+behind`) doesn't match the code enum (`signedOut, idle, dirty, saving, behind, conflict`). Also, the precedence list omits `signedOut` entirely (presumably it overrides all). Minor, but two names for the same state invites a phantom seventh state and confused mapping code in B2.
- **Fix:** reconcile the two vocabularies in one table, and add `signedOut` to the precedence statement.

### F13 — `saving` outranking `conflict` produces a correct-but-flickery display; worth a one-line acknowledgement
- **Severity:** minor · **Confidence:** medium
- **Gap:** With `saving > conflict`, an in-flight push that is about to be refused shows `saving` then snaps to `conflict`. Self-healing and probably fine, but undocumented. A stale-false `behind` cleared by a *successful* push (clear condition #1) is likewise fine but relies on the reader trusting the precedence. One sentence saying "transient saving→conflict flip is expected and acceptable" would close it.

---

## What's genuinely solid (stated so you don't re-litigate it)
- **Reusing existing primitives** (`onBehind`, `withKeepalive`, `loadCloudChar`'s confirm-reload) instead of inventing new ones — correct instinct, keeps blast radius small.
- **`esc()` coverage across label + tooltip/title + aria-label**, not just visible text — this is the right read of the trust boundary and is spelled out well.
- **The B1/B2/B3 split** and **gating B3 on owner approval** — good sequencing discipline (subject to F4's ordering caveat).
- **Keeping `checkFreshness()` read-only and separate from `reconcile()`'s push-or-adopt** — clean separation; the rejection of "reuse `reconcile()` for freshness" in Alternatives is correct.
- **Explicitly stating no `DATA.version` bump per branch** rather than assuming it — exactly the kind of assumption-surfacing the plan should do more of (see F3).

---

## Instruction #7 — did the plan close each of the five prior blocking findings?

| Prior blocking finding | Closed? | Notes |
|---|---|---|
| **State machine** | **Partially** | Enum + precedence defined, but `pendingEdit` coupling (F1) and persisted-`behind` storage (F2) are under-specified. Close after F1/F2. |
| **`behind` clear-conditions** | **Mostly** | Clear conditions explicit and good; set-conditions/storage weaker (F2), and the focus-gated staleness window means `behind` is best-effort not honest (F7). |
| **Refresh trigger** | **Closed as "decided", weak on adequacy** | It *is* now decided (focus/visibility + 30s), not vague — meets the "not-vague" bar. But 30s is an admitted guess and barely fires in single-tab use (F7). Decided ✅, adequate ❓. |
| **Conflict-resolution UX** | **Restated more than closed** | Mechanically clean, but discard-only + unlabelled loss + no keep-mine (F5). This is the weakest of the five. |
| **DM Console scope** | **Closed** | Narrower treatment is well-reasoned; residual is the dual-paradigm framing (F6) and the "check if `award-status` already exists" dependency, which you already flagged. |

**Bottom line:** four of five are closed or nearly so; the **conflict-resolution UX (F5)** is the one I'd not sign off as "resolved" yet, and the **state-machine internals (F1–F3)** need three specific mechanical decisions before implementation, not more prose.

---

## Highest-value changes before implementing
1. **F3** — verify `base_updated_at` is actually stored, or `checkFreshness()` (and all of `behind`) can't exist. *Do this first; it's foundational.*
2. **F1 / F2** — name the `pendingEdit` seam and the `behind` storage location; both currently rely on hand-waving across a module boundary you elsewhere promise to keep pure.
3. **F5** — decide and *label* the lossy conflict resolution; don't ship a discard-only path that doesn't say it discards.
4. **F4** — don't let B2 demote Live Sheet's manual save ahead of B3.
5. **F8** — make the autosave enrolment revocable, or explicitly justify it as one-way in the decision record.

*File would be named:* `sync-chip-part-b-review-claude-opus-4-8.md`

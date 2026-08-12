# Review: Reconcile guide↔engine rules-version drift

**Model:** Kimi Chat (Moonshot AI)  
**Date:** 2026-08-12  
**Plan reviewed:** `claude/merge-pact-guide-version-132ppm` — Reconcile guide↔engine rules-version drift (the `documents-rules:` pointer)

---

## 1. Does this plan actually achieve the stated goal?

**Yes.** The plan comprehensively addresses all stated objectives:

- **Machine-generated pointer:** Reuses the existing `SYNCED_FROM.txt` vendoring pipeline (already proven for pricing sync) to stamp a `documents-rules:` comment, eliminating hand-typed version copies.
- **Separation of concerns:** Explicitly preserves the independent `content-version:` doc revision marker and documents the semantic distinction between the two markers.
- **Eliminates BUILD mirroring:** Correctly identifies that `BUILD` (cosmetic web-tool build number) has no place in the guide and drops it entirely.
- **Defined update path:** Documents a manual-but-explicit procedure in `docs/VERSION-SYNC.md` rather than leaving it as an ad-hoc "when someone remembers" step.
- **Branch choice documented:** Explicitly selects `main` (live player-facing code) over `preview` and plans to write this down in both projects.
- **Filename cleanup:** Drops the embedded version from the guide filename, removing a guaranteed-stale hardcoded reference.

The logic holds together end-to-end. The plan correctly treats this as a *pointer* problem (what rules version was this prose checked against?) rather than a *sync* problem (how do we auto-merge two documents?), which matches the actual failure mode described in Context.

---

## 2. Are any of the "Assumed" items shaky enough that they should have been verified before proposing an approach built on them?

**Moderate concern on Assumption #1; Assumption #2 is well-grounded.**

The plan lists two assumptions:

1. *"That pact-guide's guide-authoring workflow can add a small generation step... without disrupting its existing hand-editing flow."*
   - **Risk level:** Medium. While the plan notes that pact-guide already has Node tooling (`py/tools/*.mjs`) and a pattern for version-stamped generated files, "can add" and "without disrupting" are optimistic. Hand-editing HTML is a fragile workflow; injecting a generated comment into a hand-maintained file creates a collision surface.
   - **Mitigation:** The plan's proposed patch/handoff approach (drafting precise before/after text for the other session) is the right risk mitigation, but it doesn't eliminate the underlying workflow friction. The plan should perhaps explicitly state that if the generation step proves disruptive, the fallback is to make `documents-rules:` a fully machine-generated *sidecar* file (e.g., `PACT-Players-Guide.rules-pointer.txt`) rather than an inline comment. This would decouple the generation from the hand-edited HTML structure entirely.

2. *"That copying the finished guide HTML from pact-guide into this repo's `docs/PACT-Players-Guide.html` remains a manual, session-driven step..."*
   - **Risk level:** Low. This is strongly supported by the evidence in Context (commit `3bd8e70` being a manual copy with a stale marker). No automation evidence was found. This assumption is safe.

**Recommendation:** Before executing, the pact-guide-side session should verify that injecting into the HTML is trivial. If not, the sidecar fallback should be considered.

---

## 3. Is there a better alternative to the proposed approach that this plan didn't consider?

**Two alternatives worth noting, though neither clearly superior given the constraints:**

### Alternative A: Sidecar pointer file (not inline comment)
Instead of injecting `<!-- documents-rules: ... -->` into the HTML, generate a separate `PACT-Players-Guide.rules-pointer` (or `.json`) file in pact-guide, co-located with the guide. Pros: zero risk of disrupting hand-edited HTML; trivial to generate; trivial to verify. Cons: requires the consumer (PACT repo, or players) to know to look for it; doesn't travel with the HTML when copied. Given that the copy is manual anyway, a sidecar could be copied alongside, but this adds file-count complexity.

### Alternative B: CI drift-detector (not syncer)
Rather than (or in addition to) generating a pointer, add a lightweight GitHub Action in the PACT repo that fails a check if `docs/PACT-Players-Guide.html`'s embedded `documents-rules:` (once it exists) disagrees with the current `main` branch's `DATA.version`. This doesn't *replace* the plan's manual update path, but adds an objective gate that prevents stale copies from being committed unnoticed. The plan's Verification section mentions re-running `engine-parity.html`, but a dedicated drift check would be more targeted.

**Verdict:** The plan's chosen approach is reasonable, but Alternative B (drift-detector) is low-cost, high-value insurance that aligns with the plan's own emphasis on verification. It could be added to the "Risks" or "Verification" section as a follow-up enhancement without expanding this plan's scope.

---

## 4. What's missing?

Several gaps that could cause friction during execution:

### a) Transition / cutover procedure
The plan doesn't specify how to handle the period when `docs/PACT-Players-Guide.html` in the PACT repo still carries the old `v0.332` marker while waiting for the pact-guide-side patch. Should the PACT repo's file be updated immediately with a hand-typed `documents-rules:` as a temporary measure, or should it wait for the full pact-guide patch? A sequencing note ("PACT repo waits for pact-guide patch before touching its served copy") would prevent conflicting edits.

### b) Parser contract for `documents-rules:`
The plan gives an example (`<!-- documents-rules: v0.342 @ main@9575e75 (synced 2026-08-11) -->`) but doesn't define a strict format or specify whether any existing tooling will parse this. If `engine-parity.html` or future automation needs to read this comment, a regex/grammar should be specified now. The example mixes `DATA.version`, branch, commit hash, and date in one string — this is human-readable but not machine-friendly.

### c) Filename change blast radius
Step 4 drops `-v0.333` from the pact-guide filename. The plan mentions updating "pact-guide-internal reference[s]" but doesn't enumerate them. Are there bookmarks, hardcoded paths in `catalog.py`, shell aliases, or documentation links that reference the old name? A quick inventory (or at least a reminder to do one) should be included in the pact-guide patch.

### d) Ownership of verification
The Verification section says "re-run `testing/tests/engine-parity.html`" and "manually confirm..." but doesn't say *who* does this. Given the cross-project split, is the PACT-side session responsible for verifying the pact-guide patch landed correctly? The plan should explicitly state that verification is joint: pact-guide session confirms generation works; PACT session confirms copy landed correctly.

### e) `DECISIONS.md` entry template
The plan says to record the decision in `DECISIONS.md` but doesn't draft the entry. Since this is a docs-only change in this repo, drafting the exact text would reduce friction and ensure consistency with existing decision records.

### f) No mention of `BUILD` removal from existing prose
While the plan correctly states the guide should "stop mirroring `BUILD`," it doesn't explicitly check whether the guide's body text ever mentions `BUILD` (e.g., "last updated for web tool v1.417"). If such references exist, they should be hunted down and removed as part of this work.

---

## 5. Is the Verification section objectively checkable by someone who isn't the plan's author?

**Partially — with access caveats.**

The verification steps are:

1. *"Re-run `testing/tests/engine-parity.html` and confirm 0 failed."*  
   ✅ **Objective and checkable.** Pass/fail, no ambiguity.

2. *"Manually confirm `docs/PACT-Players-Guide.html`'s `content-version` and `documents-rules` comments both parse and agree with what pact-guide's canonical file actually contains, character-for-character."*  
   ⚠️ **Objective in principle, but requires access to both repos.** A third-party reviewer with access to both repos can do this. A reviewer with only the PACT repo cannot verify the "agrees with pact-guide's canonical file" clause — they can only verify that the comments exist and are syntactically reasonable. The plan should split this into two checks: (a) verify comments exist and are well-formed in PACT repo (anyone can do), and (b) verify they match pact-guide's canonical file (requires cross-project access).

3. *"Confirm the branch decision (`main`) is written down in both this repo and pact-guide."*  
   ⚠️ **Requires access to both repos.** Same caveat as above.

**Recommendation:** Restructure Verification into "PACT-repo verifiable" and "Cross-project verifiable" tiers so that a single-repo reviewer knows which checks they can objectively perform.

---

## 6. Should this split into multiple smaller plans?

**Yes, though the current single-plan approach is acceptable with tighter handoff discipline.**

The plan naturally cleaves into two independent workstreams:

- **Plan A (PACT repo):** Document the branch choice, define the two-marker convention, write the manual update procedure in `docs/VERSION-SYNC.md`, record the decision in `DECISIONS.md`. This is pure documentation, zero risk, can ship immediately.
- **Plan B (pact-guide repo):** Rename file, add generation step for `documents-rules:`, update internal references. This requires touching a foreign project's tooling and workflow.

**Why splitting is better:**
- **Reduced coordination risk:** Plan A can ship now, providing immediate value (documented procedure, decision record) even if Plan B is delayed or encounters the "disrupts hand-editing" problem.
- **Clearer ownership:** Each project's session owns its plan end-to-end. The cross-session handoff becomes a dependency link ("Plan B blocks final verification of Plan A") rather than a single plan with mixed ownership.
- **Easier rollback:** If the pact-guide patch fails, Plan A doesn't need to be reverted.

**Why the current approach is acceptable:** The plan already explicitly tags steps as "this repo" vs "pact-guide (patch)" and uses the established precedent of cross-session handoffs. If the owner is comfortable with this pattern, keeping it as one plan is fine — but the "Done when" criteria should be gated accordingly (e.g., "PACT-repo criteria are Done when Plan A ships; full cross-project Done when Plan B is confirmed landed").

---

## Summary Judgment

| Criterion | Rating | Notes |
|-----------|--------|-------|
| **Logic** | Strong | Correctly identifies the problem as pointer/sync separation, not content merge. Reuses proven infrastructure. |
| **Clarity** | Strong | Excellent "Verified vs. Assumed" section. Clear scope boundaries. Well-structured. |
| **Scope** | Appropriate | Correctly excludes pricing pipeline, auto-triggers, and content changes. |
| **Risk awareness** | Good | Acknowledges cross-project coordination risk and display-only damage scale. Could be sharper on transition sequencing and parser contracts. |
| **Actionability** | Good | Steps are concrete, but missing filename blast-radius check, transition procedure, and parser spec. |

**Overall recommendation:** **Approve with minor amendments.** The plan is sound and should proceed. Before execution, add: (1) a transition sequencing note, (2) a strict format/regex for `documents-rules:`, (3) a sidecar-file fallback option if HTML injection proves disruptive, and (4) consider splitting into two formally separate plans for cleaner ownership.

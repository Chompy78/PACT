M365 Copilot — GPT-5 reasoning model

# Review: Reconcile guide↔engine rules-version drift (`documents-rules:` pointer)

**Review date:** 2026-08-12  
**Overall verdict:** **Approve with required revisions.** The design direction is sound and directly addresses the conceptual drift, but the plan currently combines a shippable PACT-repo documentation change with an externally owned pact-guide implementation that has not yet been designed precisely enough to be objectively verified. The most important correction is to define the pointer’s semantics and generation/check workflow more rigorously, then split delivery into two coordinated plans or phases.

## Executive assessment

The plan correctly separates three concepts that were previously at risk of being conflated:

1. `BUILD` — a cosmetic web-application build identifier, which the guide should not mirror.
2. `DATA.version` — the engine rules-content version against which guide mechanics are checked.
3. `content-version` — the guide document’s independent prose revision.

It also makes the right architectural choice by reusing the already-vendored engine snapshot rather than introducing another cross-repository reader or sync pipeline. Selecting `main` as the player-facing reference branch is coherent with the stated deployment model.

However, a generated `documents-rules:` comment does not by itself prove that the guide prose was actually reviewed against those rules. If the marker is refreshed automatically whenever the vendored engine snapshot changes, it could falsely assert compatibility before a human has reconciled the guide. The plan must therefore distinguish **generating a candidate pointer from vendored facts** from **advancing the guide’s declared compatibility after review**. This is the chief logical gap.

---

## 1. Does the plan achieve the stated goal?

**Mostly yes, provided one semantic gap is fixed.**

The proposed approach achieves the structural parts of the goal:

- It establishes one dedicated rules pointer.
- It leaves the independent document revision intact.
- It stops using `BUILD` as a guide-facing rules label.
- It removes the volatile revision number from the canonical filename.
- It provides a defined path for moving the canonical guide into PACT’s served copy.
- It records the `main` branch choice and cross-project responsibilities.
- It avoids duplicating the existing pricing vendoring mechanism.

### Required correction: define what `documents-rules` asserts

The example marker says:

```html
<!-- documents-rules: v0.342 @ main@9575e75 (synced 2026-08-11) -->
```

The prose describes it as both:

- a pointer sourced from the latest vendored snapshot; and
- a declaration that “this prose was checked against this exact rules version.”

Those are not automatically the same thing. A vendor refresh can establish what rules were copied, but it cannot establish that the guide was reviewed and reconciled against them. If the guide marker is regenerated during every vendor refresh, the marker could advance from `v0.342` to `v0.343` even when the prose has not been checked.

The plan should explicitly adopt one of these behaviours:

- **Recommended:** the generator reads the vendored metadata and updates the marker only as an explicit guide-reconciliation action after review. The script should not be an unconditional side effect of price vendoring.
- Alternatively, use distinct fields such as `available-rules` and `documents-rules`; however, that adds complexity and conflicts with the stated goal of one guide pointer.

With the recommended behaviour, “machine-generated” means the version, branch, commit and date are mechanically derived and validated, while the decision to advance the compatibility claim remains deliberate.

### Clarify “single pointer” scope

The Done-when wording says the guide declares a “single `documents-rules:` pointer”. Specify whether this means:

- exactly one occurrence in the canonical guide HTML;
- exactly one occurrence in each copy, with the two files matching; or
- one canonical occurrence in pact-guide that is copied unchanged into PACT.

The intended interpretation appears to be the third, but the acceptance criteria should say so.

---

## 2. Are the assumed items too shaky?

### Assumption about adding a generation step

**Yes — this should be verified before prescribing the implementation shape, although it does not undermine the architecture.**

The plan knows that pact-guide has Node tooling and vendored metadata, but it does not establish:

- which command constitutes the guide build or release workflow;
- whether the canonical HTML is hand-edited directly or produced from another source;
- where an idempotent marker-stamping step should be attached;
- whether existing tooling already parses `SYNCED_FROM.txt`;
- the exact, stable format of `SYNCED_FROM.txt`;
- whether the relevant script has tests or a `--check` mode.

These facts matter because editing a generated HTML output may be overwritten, while editing a hand-maintained canonical file may be appropriate. The pact-guide session should verify the workflow before choosing between extending an existing script, adding a sibling script, or modifying an existing build command.

This should be reframed from “a small script is enough” to an implementation constraint:

> Use the existing vendored snapshot as the sole source of engine identity. Integrate marker generation at the canonical HTML production or release boundary identified by the pact-guide repository’s actual workflow.

### Assumption that cross-repo copying is manual

**Moderately shaky, but safe as an interim choice.**

The plan says no automation was found, which is enough to document a manual procedure now. Still, before declaring the manual procedure the long-term update path, the PACT repo should be checked for any existing import, release, deployment or documentation-sync commands that ought to own this copy. If none exists, the manual path is reasonable.

The plan should not claim there is “no realistic fully-automatic push”; automation may be possible from the owner’s local environment even without a pact-guide remote. The stronger and more defensible statement is that automation is **not justified within this task’s scope or risk budget**.

### Assumption that `SYNCED_FROM.txt` is sufficient

**This needs a targeted verification.** The plan says it contains every needed fact, but the proposed marker includes a shortened commit and a date whose semantics are not fully fixed. Confirm:

- whether the stored commit is the source branch HEAD at copy time or the last commit touching only the four vendored files;
- which of those commits should appear in `documents-rules`;
- whether the date is a copy timestamp, reconciliation date or source commit date;
- whether the timestamp includes a timezone;
- whether parsing a human-readable text file is treated as a stable interface.

A commit that last touched the vendored files provides stronger provenance for the rules snapshot than an unrelated branch HEAD, but the plan must choose and document one.

---

## 3. Is there a better alternative not considered?

There is no clearly better replacement for the overall architecture. Reusing vendored provenance plus an explicit cross-repo copy is the lowest-complexity fit for the stated constraints. There are, however, two improvements worth incorporating.

### Add a check mode rather than relying only on mutation

The plan discusses generating the marker but not validating it in automation or local verification. The pact-guide tool should ideally support both:

```text
stamp/update mode: derive and write the marker
check mode: fail if the existing marker differs from the expected vendored provenance
```

This preserves a controlled manual reconciliation step while making staleness objectively detectable. It also makes the operation idempotent and suitable for future CI without building the deferred automatic trigger now.

### Add a PACT-side import/check helper if the repository already has an appropriate scripts area

A very small helper could copy a user-supplied canonical guide file and verify the two markers before replacement. This would not require PACT to know the private repository’s path and would not automate cross-repo access. For example, conceptually:

```text
import-guide <path-to-canonical-html>
```

It could verify exactly one `content-version` marker, exactly one `documents-rules` marker, a versionless canonical filename, and byte-for-byte marker preservation. This is more reliable than prose-only instructions.

That said, this helper should be treated as an optional follow-up unless PACT already has a natural tooling location. The documented manual procedure is sufficient for the current task if its checks are explicit.

---

## 4. What is missing?

### A. A precise marker grammar

Define a stable format rather than only an example. At minimum specify:

- exact comment prefix;
- accepted rules-version pattern;
- branch field;
- full or abbreviated commit length;
- date format and meaning;
- whether spacing is significant;
- whether there must be exactly one occurrence;
- placement relative to `content-version`, `<doctype>` and `<html>`.

A simpler machine-oriented form may be easier to parse reliably, for example:

```html
<!-- documents-rules: version=v0.342; branch=main; commit=9575e75; reconciled=2026-08-11 -->
```

The precise syntax is less important than fixing it once and testing it.

### B. Reconciliation semantics and failure behaviour

State that a vendor refresh must not silently advance the compatibility claim. Also define what happens when:

- vendored metadata is missing or malformed;
- the HTML contains zero or multiple pointers;
- the existing marker has been hand-edited;
- the vendored branch is not `main`;
- `DATA.version` cannot be parsed;
- the source commit is unavailable;
- the guide is copied while the marker is known to be stale.

The safe default is to fail without modifying the guide.

### C. Ownership and command-level workflow

The manual procedure needs named responsibilities and executable steps. For example:

1. Refresh or verify the vendored engine snapshot using the existing pact-guide command.
2. Reconcile guide prose against that snapshot.
3. Run the pointer-stamping command.
4. Run its check mode.
5. Increment `content-version` only under the guide project’s existing document-revision policy.
6. Copy the canonical HTML to PACT’s `docs/PACT-Players-Guide.html`.
7. Compare both marker lines character-for-character.
8. Run PACT verification and commit both projects independently.

The exact commands must be filled in by the project-owning session after inspecting each repository.

### D. Rename impact checks

“Update any internal reference” is too vague. The pact-guide patch should search for and account for:

- scripts and package commands;
- Markdown links;
- task boards and current-work files;
- tests and fixtures;
- ignore files;
- release/copy instructions;
- hard-coded output paths;
- archived files, with an explicit policy on whether archives are intentionally left unchanged.

The patch should use a true rename where possible so history remains intelligible.

### E. Initial migration state

The plan should specify how the first pointer is established. In particular:

- Which vendored snapshot is authoritative at migration time?
- Must the guide be manually reviewed against it before stamping?
- Does the initial rename increment `content-version` under pact-guide policy?
- Is PACT’s currently served `v0.332` marker corrected only when the canonical copy lands, or should an interim correction be made?

The current plan correctly avoids guessing the live `DATA.version`, but acceptance should require reading it fresh from the chosen vendored snapshot during implementation.

### F. Decision-record content

Specify that both decision records should capture:

- why `main` is authoritative;
- why `BUILD` is excluded;
- the distinct meanings of both markers;
- the source of generated provenance;
- why cross-repo transfer remains manual;
- the rule that stamping follows reconciliation rather than merely vendoring.

### G. Task-board closure and handoff evidence

The plan originates from `TASK_BOARD_NEXT.md`, but it does not say when or how that task is updated. Completion should require links or commit identifiers for both repositories, or an explicit blocked/partial state until the external patch lands.

---

## 5. Is Verification objectively checkable?

**Partly, but not yet fully.** The engine-parity check is objective if the command and expected result are known. The marker comparison is also objective in principle. Several improvements are needed.

### Make commands and expected outputs explicit

Instead of “re-run `testing/tests/engine-parity.html`”, identify the actual supported invocation. An HTML file is not itself necessarily a command. State whether it is opened manually in a browser, run through a test harness, or executed by a repository script. Record the expected summary exactly, including whether console errors matter.

### Add deterministic textual checks

Acceptance should include checks equivalent to:

- canonical pact-guide HTML contains exactly one `content-version:` marker;
- canonical pact-guide HTML contains exactly one `documents-rules:` marker;
- PACT served HTML contains exactly one of each;
- both marker lines match between canonical and served files exactly;
- `documents-rules` matches parsed vendored metadata;
- no guide-facing reference to `BUILD` remains;
- no active pact-guide reference to `PACT-Players-Guide-v0.333.html` remains;
- the canonical versionless filename exists and the old active filename does not;
- repeated execution of the stamping tool produces no further diff.

### Verify the source, not only equality between copies

Two files can match and still both be wrong. Verification must triangulate among:

1. vendored provenance metadata;
2. pact-guide’s canonical marker;
3. PACT’s served-copy marker.

All three should agree.

### Separate pre-merge and post-handoff verification

The current plan mixes verification available in this repository with verification that can occur only after the pact-guide patch lands. Label each check with its project and owner so a reviewer can tell whether the task is complete or merely prepared.

---

## 6. Should this be split into smaller plans?

**Yes. Split it into two implementation plans under one parent decision, with a final integration checkpoint.**

The present document is a good architectural plan, but it crosses repository boundaries, ownership, branches and verification environments. Treating it as one directly executable plan makes it too easy to mark the PACT portion complete while the actual generated pointer does not yet exist.

### Plan A — pact-guide canonical implementation

Owner: the session with direct access to `/data/projects/creative/PACT-guide`.

Scope:

- inspect and document the actual guide-authoring/build workflow;
- define the marker grammar and semantics;
- source provenance only from the existing vendored snapshot;
- implement stamp and preferably check modes;
- ensure stamping occurs only after reconciliation;
- rename the canonical HTML to `PACT-Players-Guide.html`;
- update active internal references;
- record the decision and changelog entry;
- produce the canonical HTML ready for transfer.

### Plan B — PACT documentation and receiving workflow

Owner: this PACT-repo session.

Scope:

- add the cross-project section to `docs/VERSION-SYNC.md`;
- record the architectural decision in `DECISIONS.md`;
- define `main` as the authoritative player-facing rules branch;
- document the two marker meanings;
- document the manual import and verification procedure;
- optionally add a local import/check helper if consistent with repository conventions;
- run the repository’s documented docs-only verification.

### Integration checkpoint

Do not close the parent task until:

- Plan A has landed in pact-guide;
- its canonical versionless HTML has been copied into PACT;
- all three provenance sources agree;
- the old filename has no active references;
- both decision logs contain the change;
- the PACT served copy has been committed and verified.

This split is not merely administrative. Plan A needs repository-specific discovery before its patch can be responsibly specified, whereas Plan B is already well enough defined to proceed.

---

## Recommended changes before implementation

1. Define `documents-rules` as a **reviewed compatibility assertion**, not merely the latest vendored version.
2. Specify a stable, testable marker grammar and exact provenance fields.
3. Confirm which commit from `SYNCED_FROM.txt` the marker records and what the date means.
4. Require idempotent stamp behaviour and, preferably, a non-mutating check mode.
5. Split execution into pact-guide and PACT plans with a shared integration gate.
6. Replace general verification prose with project-specific commands and deterministic acceptance checks.
7. Require the pact-guide-owning session to inspect the real authoring workflow before drafting the final patch.
8. Keep the parent task open until the canonical HTML is copied into PACT and independently checked against vendored metadata.

## Final judgement

The plan is logically strong at the architecture level and shows good restraint: it reuses existing provenance, avoids unnecessary automation, separates document revision from rules compatibility, and acknowledges cross-project ownership. Its main weakness is that it treats “generated from the latest vendored snapshot” as equivalent to “the prose was checked against that snapshot.” Correct that semantic mismatch, make verification deterministic, and split implementation by repository. With those revisions, the plan should meet its goal cleanly and durably.

# Plan: Reconcile guide↔engine rules-version drift (the `documents-rules:` pointer)

Date: 2026-08-12 · Revised after cold review (4 reviewers: Copilot/Opus-4.8, Kimi Chat, M365 Copilot/GPT-5
reasoning, Claude 3.5 Sonnet — full reviews in `z-cold/` on the `zcold` branch of this repo)
Branch (PACT repo): `claude/merge-pact-guide-version-132ppm`
Source task: PACT repo's `docs/TASK_BOARD_NEXT.md`, entry "Reconcile guide↔engine rules-version drift"
(board-suggested branch name `docs/guide-engine-version-pointer`, not used — this session's branch is
pinned by its harness).

## Goal

Stop the Players Guide's rules-version labeling from silently drifting out of sync with the engine that
actually prices characters. Replace hand-typed version copies with one machine-generated, collision-proof
pointer that means "this prose was reconciled against this exact rules version" — not merely "this is
whatever version happened to be vendored last" — and give this repo's served guide copy a defined,
verifiable update path.

## Context

Two **separate git projects**, same owner:
- **PACT** (this repo, GitHub `chompy78/pact`). `js/engine.js` exports `BUILD` (cosmetic build number);
  `js/engine-data.js`'s `DATA.version` is the rules-content version, bumped only on mechanics changes.
  Serves a static guide copy at `docs/PACT-Players-Guide.html` (~1.4 MB), read by players.
- **pact-guide** (local-only, `/data/projects/creative/PACT-guide` on the home server — not on GitHub).
  Where the guide's prose is authored; canonical file currently `PACT-Players-Guide-v0.333.html`.

Both files already carry `<!-- content-version: vX.XXX --><title>...vX.XXX</title>` — in pact-guide this
is a correctly-working, hand-maintained, independent doc revision (moves on prose edits, not rules
changes; **no change needed here**). In this repo it's currently just stale and already internally
inconsistent: it reads `v0.332`, but commit `3bd8e70` ("Grit cost table matches the Steep ladder
(v0.343)") updated the content without updating the marker — i.e. marker and content already disagree
*inside this repo*, before even comparing against pact-guide.

## Verified vs. Assumed

**Verified this session:**
- This repo's `preview`: `BUILD = "v1.417"`; read `DATA.version` fresh at implementation time, don't
  trust a number written into this doc.
- `docs/PACT-Players-Guide.html` marker/title both say `v0.332`; last touched by `3bd8e70` (references
  `v0.343` in its message, doesn't update the marker).
- pact-guide's `PACT-Players-Guide-v0.333.html` carries `content-version: v0.333`, already independent.
- pact-guide already shipped (2026-08-11, `D-2026-08-11-engine-js-auto-sync-pipeline`) a vendoring
  pipeline for a *different* consumer (`catalog.py` pricing), directly reusable here:
  - `py/vendor/engine/` — point-in-time copy of `engine.js` + 3 imports, from `Chompy78/PACT`'s `main`
    branch (deliberately not `preview`).
  - `py/vendor/engine/SYNCED_FROM.txt`, regenerated per refresh, stamps: source repo, branch (`main`),
    **the source-repo HEAD commit at copy time**, and separately **"Last commit that touched these 4
    files"** (a different, usually-earlier commit), a copy timestamp, `Live DATA.version`, `Live BUILD`.
    Both commit fields exist; this plan picks one explicitly (see Marker spec) rather than leaving it
    ambiguous, per review feedback.
  - That pipeline's own trigger is manual by deliberate choice — pact-guide's `TASK_BOARD.md` already
    tracks "Add an automatic trigger for the engine.js price sync" as its own open, low-risk task. **Not
    duplicated here.**
- `py/PACT-staleness.py` (the landmine the original task text warned about) is already retired/archived
  (2026-08-12, `D-2026-08-12-retire-pact-staleness-gate`) — confirmed non-functional since before that
  project's 2026-07-17 standardization. Nothing here should touch it.
- The 2026-08-11 auto-sync pipeline (the other landmine) is built, shipped, and scoped to pricing only —
  no live overlapping effort to collide with, only infrastructure to build on top of.

**Assumed, flagged by review, now addressed rather than left implicit:**
- *Whether pact-guide's authoring workflow can absorb a stamping step without disrupting hand-editing* —
  downgraded from "the plan assumes yes" to an explicit **precondition** (see Phase 2, step 0).
- *Whether the vendored snapshot is fresh as of the guide edit* — this was the plan's most significant
  logic gap (caught independently by two reviewers): reusing `SYNCED_FROM.txt` values is safe only if
  stamping happens *as* a reconciliation action, not as an automatic side effect of a pricing-only vendor
  refresh that could be arbitrarily old or new relative to the prose. Resolved in the Marker spec below.
- *Cross-repo copy stays manual* — low risk, no evidence of existing automation in either project;
  kept as a documented manual step per the task's own "defined update path" (not "automated") wording.

## Marker spec (shared by both phases — pin this once, don't leave it to the implementer)

- **Format**, structured key=value, deliberately shaped nothing like `content-version` so the two can
  never be confused by a glance at raw text:
  `<!-- documents-rules: version=v0.342; branch=main; commit=877596b; reconciled=2026-08-11 -->`
  - `version` / `branch` / `commit` sourced from `py/vendor/engine/SYNCED_FROM.txt`'s **"Last commit that
    touched these 4 files"** field (not the source-repo HEAD field) — that commit is what actually
    determines the vendored `DATA.version`'s content, so it's the more defensible provenance pointer.
  - `reconciled` = the date a human (or an AI session acting for the owner) actually checked the guide
    prose against that vendored snapshot — **not** the vendor-copy timestamp. This is the field that
    encodes "reviewed," not just "available."
  - Exactly one occurrence per file. Placed adjacent to the existing `content-version` comment.
- **Semantics, stated explicitly:** `documents-rules` asserts *"this prose was reconciled against this
  rules version,"* not *"this is the newest version we happened to have vendored."* Therefore: **stamping
  is a deliberate action taken when the guide author finishes reconciling, never an automatic side effect
  of refreshing `py/vendor/engine/` for the pricing sync.** A vendor refresh alone must not advance this
  marker.
- **Stamp tool needs two modes:** `stamp` (writes the marker from the current vendored snapshot — run
  only as part of a reconciliation pass) and `check` (non-mutating; fails loudly if the existing marker's
  `version`/`branch`/`commit` no longer match the current vendored snapshot, surfacing staleness without
  silently advancing the compatibility claim). `check` is the guardrail three reviewers asked for.
- **`BUILD` is never mirrored anywhere in the guide** — neither marker, nor body prose. Grep the guide
  body for stray `BUILD`/web-tool-version mentions (e.g. "as of web tool v1.4xx") as part of Phase 2 and
  remove any found — a gap only one reviewer caught, cheap to close.

## Phase 1 — this repo, ships now, no external dependency

**Owner:** this session. **Scope:**
1. Confirm `main` as the mirrored branch (already the de facto choice via pact-guide's existing vendoring
   pipeline — write it down rather than re-derive it).
2. Add a new `##` section to `docs/VERSION-SYNC.md`: the marker spec above, the branch decision, the
   explicit "`content-version` = last prose edit; `documents-rules` = last rules reconciliation, stamped
   deliberately, never on a bare vendor refresh" distinction, and the manual copy procedure below.
3. **Manual copy procedure, with named responsibility:** whenever pact-guide's canonical file changes,
   **the session that made that change** copies the finished HTML into this repo's
   `docs/PACT-Players-Guide.html` and commits in the same session, then verifies (a) both markers parse,
   (b) `documents-rules`'s `version`/`branch`/`commit` match `py/vendor/engine/SYNCED_FROM.txt`'s current
   values (three-way triangulation: vendored snapshot ↔ pact-guide canonical ↔ this repo's served copy —
   not just the last two), and (c) no stray `BUILD` references remain in guide body prose.
4. Record in `DECISIONS.md`: (a) `main` chosen as the mirrored branch and why (matches the existing
   pricing-vendor precedent, is what's actually live for players); (b) the two-marker split and that
   `documents-rules` is a reconciliation assertion, not a vendor-refresh artifact; (c) `BUILD` is
   permanently out of scope for guide display; (d) the filename convention change pact-guide will make
   (see Phase 2) and why this repo's own served copy stays versionless as it already is.
5. **Interim-state note, stated in the new `VERSION-SYNC.md` section itself:** landing Phase 1 alone does
   **not** fix the currently-visible `v0.332` staleness in `docs/PACT-Players-Guide.html` — that only
   heals once Phase 2 ships and the next manual copy lands. Say this so nobody reads Phase 1 as having
   resolved the visible problem.

**Phase 1 Done when:** `docs/VERSION-SYNC.md` and `DECISIONS.md` both carry the above; the copy procedure
names its owner explicitly; `testing/tests/engine-parity.html` still reports **0 failed** (docs-only
change, should be unaffected — same expectation as every change in this repo).

## Phase 2 — pact-guide patch, owned by that project's own session

**Precondition (per review — feasibility must be confirmed, not merely assumed):** before implementing,
the pact-guide-side session inspects its own actual guide-authoring/build workflow and confirms where a
stamping step fits without disrupting hand-editing. If injecting an HTML comment proves disruptive, the
documented fallback is a sidecar file (e.g. `PACT-Players-Guide.rules-pointer.txt`) copied alongside the
HTML instead of embedded in it — noted here so the patch isn't blocked rediscovering this option.

**Scope (drafted here as a patch for handoff, not applied directly — pact-guide is outside this session's
GitHub scope):**
1. Rename `PACT-Players-Guide-v0.333.html` → `PACT-Players-Guide.html` (matches this repo's own
   versionless convention). **Rename blast-radius checklist** (per review — "update internal references"
   was too vague): scripts/`py/tools/*` and any `package.json`-equivalent commands, Markdown links,
   `TASK_BOARD.md`/`CURRENT-WORK.md` mentions, tests/fixtures, any hardcoded path in active tooling.
   Files already moved to `archive/` (e.g. the retired `PACT-staleness.py`) are explicitly left
   unchanged — historical, not live references.
2. Build the `stamp`/`check` tool per the Marker spec above, reading `py/vendor/engine/SYNCED_FROM.txt`'s
   "last commit that touched these 4 files" field. Wire `stamp` into whatever step in pact-guide's actual
   workflow represents "I just finished reconciling the guide against the current vendored rules" —
   determined by that session's own inspection, not prescribed here.
3. Remove any stray `BUILD`/web-tool-version mentions from guide body prose.
4. Record in pact-guide's own `DECISIONS.md`/`CHANGELOG.md`: the same four facts as this repo's Phase 1
   step 4, from that project's side.

**Phase 2 Done when:** the canonical file is versionless with a `stamp`/`check`-capable tool in place;
the current marker was written by `stamp` after an actual reconciliation pass (not hand-typed to match);
rename blast-radius items are cleared; that project's own decision/changelog records carry the change.

## Integration checkpoint (closes the parent task-board item — neither phase alone does)

- Phase 2's canonical HTML has been copied into this repo's `docs/PACT-Players-Guide.html` per the Phase 1
  procedure.
- All three provenance sources agree, checked character-for-character: `py/vendor/engine/SYNCED_FROM.txt`
  (pact-guide) ↔ pact-guide's canonical `documents-rules` marker ↔ this repo's served-copy marker.
- This repo's `DECISIONS.md` gets a follow-up line noting the copy landed and was verified.
- The task-board entry graduates to `CHANGELOG.md` only at this point, not at Phase 1 alone.

## Out of scope

Building/modifying the pricing auto-sync pipeline itself (reused as a data source only); choosing or
building an automatic *trigger* for either sync (pact-guide already tracks its own, separately); any
rules/pricing content change to the guide; repairing `py/PACT-staleness.py` (already retired); a CI/GitHub
Action drift-detector (a `check` mode covers the same need without adding new repo infrastructure).

## Alternatives considered

- **Fully automate the cross-repo copy.** Rejected: pact-guide has no GitHub remote or CI; bigger,
  riskier infrastructure than the task's own "defined update path" (not "automated") asks for.
- **Live client-side read of `engine-data.js` from the guide page.** Rejected: this repo is static-only
  with no backend/build step (hard rule), and a live cross-origin dependency at page-load is the same
  fragility pact-guide's own pricing-sync plan already rejected for the same reasons.
- **A brand-new vendoring script for this task.** Rejected: `SYNCED_FROM.txt` already captures every fact
  needed at guide-relevant freshness; a second independent reader of `engine-data.js` is exactly the
  "two overlapping sync mechanisms" failure mode the original task text warned against.
- **Auto-advance the marker on every vendor refresh** (the plan's original, less-precise design).
  Rejected after review: conflates "vendored" with "reconciled," and could silently assert the guide was
  checked against a rules version nobody actually reviewed it against.

## Risks

- **Cross-project coordination:** Phase 2 is executed by a different session this one can't verify
  directly. Mitigated by the precondition check, the explicit rename checklist, and the Integration
  checkpoint gating final closure on a verified copy rather than trusting a "done" report.
- **Display-only, low blast radius** either way (matches the task's own Risk: medium rating — ambiguity,
  not damage scale, is the real driver).
- **`docs/VERSION-SYNC.md`'s scope grows** to cover a cross-project convention alongside its existing
  same-repo build/rules content — kept under a clearly separate `##` heading to avoid conflation.

## Verification — tiered by who can actually run each check

**Checkable in this repo alone, by anyone:**
- `testing/tests/engine-parity.html` reports **0 failed** after Phase 1 lands.
- `docs/VERSION-SYNC.md` and `DECISIONS.md` contain the marker spec, branch decision, and interim-state
  note verbatim.
- Once Phase 2's copy lands: `docs/PACT-Players-Guide.html` contains exactly one `content-version` and
  exactly one `documents-rules` comment, both matching the pinned grammar (a syntax check, not a
  cross-repo agreement check).

**Checkable only with access to both repos (label results accordingly — don't sign off as "verified" on
a check that structurally can't run from one side):**
- `documents-rules`'s `version`/`branch`/`commit` match `py/vendor/engine/SYNCED_FROM.txt`'s current
  values character-for-character (three-way triangulation, not just a two-file diff).
- The `main`-branch decision is written down in both projects' own docs.

## Done when

Restated for reviewer self-containment, now phase-scoped: the guide declares a single, structurally
collision-proof `documents-rules` pointer that is *stamped as a reconciliation action* (via a tool with a
non-mutating `check` mode), never hand-typed and never auto-advanced by a bare vendor refresh; the
existing `content-version` doc revision is untouched; `BUILD` is mirrored nowhere in the guide (marker or
prose); the guide's filename carries no version; this repo's served copy has a named, verifiable update
procedure; the `main` branch decision and the two-marker semantics are recorded in both projects'
decision logs; and the Integration checkpoint's three-way provenance agreement has actually been checked,
not assumed.

---

## Reviewer instructions

This document has already been through one round of cold review (4 reviewers, findings folded in above).
If reviewing again: self-identify model/settings first. Judge whether the fold-in actually resolved the
prior findings (see the Marker spec section for the reconciliation-vs-vendor-refresh fix, and the
Phase 1/Phase 2/Integration-checkpoint split for the ownership/verifiability fix) rather than re-raising
the same points. Flag anything the fold-in missed or got wrong.

## Review outcome

**Round 1 (2026-08-12):** 4 reviewers (Copilot/Opus-4.8, Kimi Chat, M365 Copilot/GPT-5 reasoning,
Claude 3.5 Sonnet), all "approve with revisions." Convergent findings (split into phases; tier
verification by access; define a collision-proof marker grammar; add a check mode; note the interim
stale-state; enumerate rename blast radius; specify `DECISIONS.md` content; name responsibility) folded
in above. Most substantive single finding (M365, echoed by Copilot): a marker auto-advanced on every
vendor refresh would assert "reconciled" when it only means "vendored" — fixed by making `stamp` a
deliberate reconciliation action with a separate non-mutating `check` mode. No reviewer disagreements to
reconcile. Not yet re-reviewed after this revision.

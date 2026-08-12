*Reviewer model/settings: Microsoft Copilot (Claude Opus 4.8 backend), default settings, no repo access — judging from plan text only.*

# Review — Plan: Reconcile guide↔engine rules-version drift (`documents-rules:` pointer)

**Reviewed:** 2026-08-12
**Plan branch:** `claude/merge-pact-guide-version-132ppm`
**Scope of this review:** logic, clarity, scope, risk, and self-containment of the plan as written. Not factual correctness against either repo (no access).

---

## Verdict up front

**A — Overall assessment**

- **A1 — Sound in direction, over-coupled in packaging.** The design (one machine-generated rules pointer, kept distinct from an independent doc-revision marker, versionless filename, documented manual copy path) is the right shape and the reasoning is honest — especially the Verified/Assumed split and the landmine-resolution notes, which are better than most plans bother with. **Recommended to proceed, but split it (see F) and close three gaps (D) first.**
- The single biggest substantive weakness is not called out in the plan: **`content-version` and `documents-rules` share the same `v0.3xx` value space**, which structurally invites the exact conflation the plan is trying to end — and the already-observed in-repo drift is itself an instance of that confusion.

---

## 1. Does the plan actually achieve the stated goal?

**Largely yes, with one honest downgrade of the goal that should be stated out loud.**

The goal has three parts; the plan hits all three:

| Goal element | Addressed by | Verdict |
|---|---|---|
| Replace hand-typed version copies with one machine-generated pointer | Step 2 (generated from vendored `SYNCED_FROM.txt` data) | ✅ at the *source* (pact-guide) |
| Give the served copy a defined update path | Step 5 (documented manual copy-and-verify in `VERSION-SYNC.md`) | ✅ defined, deliberately manual |
| Stop the labelling drifting out of sync with the engine | Steps 2–5 combined | ⚠️ *reduces* drift surface; does not *eliminate* drift |

The caveat that should be explicit: **the pointer is machine-generated only inside pact-guide.** This repo still receives it by a manual copy (step 5). So the plan converts a "hand-typed marker" failure mode into a "forgot to re-copy the file" failure mode — smaller, but the same *class* of silent, human-gated drift. That's a legitimate and honest trade (the task asks for "a defined update path," not an automated one), but the plan frames the outcome as "stop drifting" when what it actually delivers is "shrink the drift surface and document the residual manual step." Say that plainly so a reviewer isn't over-promised.

Second, worth noting: **the plan's own steps do not fix the currently-observed in-repo disagreement** (marker `v0.332` vs content updated to rules `v0.343`). That only heals as a *side effect* of the next manual copy from pact-guide. The plan should state that the existing drift persists until the pact-guide side ships **and** a fresh copy lands — otherwise a reader may assume landing this plan's this-repo steps resolves the visible v0.332 problem. It doesn't.

## 2. Are any "Assumed" items shaky enough to have verified first?

Two things — one filed correctly, one **mis-filed as settled**.

- **Assumption A2.1 (pact-guide can add the generation step without disrupting hand-editing).** Load-bearing for the whole "machine-generated" claim, but it lives in a repo this session can't reach, and it's being handed off as a patch to that project's own session. Leaving it *assumed* is acceptable **only if the handoff makes feasibility a precondition** ("confirm this generation step fits your authoring flow before implementing"), not just "here's a diff." As written, step 6 says "draft as a patch and hand it over" — it should add: *don't mark Done-when until that session confirms feasibility, not merely receipt.* Minor wording gap, real consequence.
- **Assumption A2.2 (the cross-repo copy stays manual).** Low stakes — if automation *does* exist, that only helps. Fine to leave assumed.

- **The genuinely shaky link is filed under "Verified," not "Assumed":** the claim that `SYNCED_FROM.txt` "captures every fact a `documents-rules` pointer needs." That file is refreshed on the **pricing tool's** vendor cadence, and it stamps `DATA.version` *as of that pricing refresh*. But `documents-rules` is supposed to mean "the prose was checked against this rules version" — a **guide-authoring** event on a *different* cadence. Reusing the pricing snapshot silently assumes the vendored snapshot is current *as of the guide edit*. That temporal coupling is asserted, not examined, and it's the most likely place for a subtly-wrong-but-plausible pointer to be generated. This should be moved into "Assumed" (or resolved) and given an explicit guardrail: the generation step should read/compare the vendor snapshot's copy-timestamp against the guide-edit time, or re-vendor at guide-build, so it never stamps a stale rules version onto freshly-checked prose.

## 3. Is there a better alternative the plan didn't consider?

The three rejected alternatives (full automation, client-side live read, brand-new vendoring script) are all rejected for sound, well-stated reasons. But one **complementary** approach is missing and is arguably the highest-value omission:

- **Add a cheap guardrail/lint in *this* repo that fails loudly when the manual copy is skipped or the marker is malformed.** The plan documents the manual procedure but adds **no detection** for the failure mode it's most exposed to (someone edits/copies and the marker doesn't come along — exactly what commit `3bd8e70` did). A tiny check — reuse the existing `engine-parity.html`/test harness, or a ~20-line parser — that asserts (a) both markers exist, (b) both are well-formed, and (c) their formats can't be confused, converts silent drift into a red build. This isn't the rejected "full automation of the copy"; it's a smoke detector on the manual step. It directly retires the residual risk from Q1 and costs almost nothing. Its absence is the plan's clearest missed lever.
- **Disambiguate the two markers by *format*, not just by name.** Because both are `v0.3xx`, a human eyeballing the HTML can't tell which is which by value. Give `documents-rules` a shape that can never collide — e.g. always the full `v0.3xx @ <branch>@<commit>` triplet (the plan's own example already does this; make it a hard rule and forbid the bare form), and keep `content-version` as the bare `v0.3xx`. Cheap, and it structurally kills the conflation class the whole plan exists to prevent.

## 4. What's missing?

- **No detection for the residual manual-copy failure** (see Q3) — the single most important gap.
- **Marker format-collision risk** (`content-version` and `documents-rules` both `v0.3xx`) — unaddressed in a plan whose entire premise is "don't conflate these two."
- **Sequencing/interim-state gap.** Step 5 documents (in this repo) a `documents-rules` marker that this repo's served copy **won't carry** until the pact-guide side ships and the copy lands. So this repo's docs will describe a marker the file doesn't yet contain — a temporary doc↔reality mismatch. Call out the interim state explicitly ("docs land first; marker arrives with the next copy").
- **Handoff acceptance criteria.** Step 6 says draft a patch and "ask the owner to confirm it landed." No definition of *what confirmation looks like*, no rollback/fallback if the other session declines or implements it differently, no owner named for that half. For a cross-project handoff this is the weakest operational seam.
- **No statement of process-verification.** The Done-when says "generated rather than hand-typed," but nothing in the plan lets a reviewer confirm the marker was *generated* rather than re-typed by hand that happened to match. Verification checks values, not provenance (see Q5).
- **Player-usefulness is unaddressed (probably fine, but say so).** `documents-rules` is an HTML *comment* — invisible to players. That's correct for machine-checking, but the plan never states that answering a player's "is my guide current?" is explicitly *not* a goal here. One line closes it.

## 5. Is the Verification section objectively checkable by a non-author?

**Partly — and it inherits the plan's own cross-project blind spot.**

- ✅ **"Re-run `engine-parity.html`, confirm 0 failed"** — fully objective, checkable by anyone with this repo.
- ✅ **"Branch decision written down in both projects"** — checkable, *if* the checker has both repos.
- ⚠️ **"Confirm `content-version` and `documents-rules` agree character-for-character with pact-guide's canonical file"** — checkable *in principle*, but requires access to pact-guide's canonical file, which a reviewer scoped to *this* repo (the plan's own stated reviewer situation) does not have. So this check is objective only for someone with both-repo visibility, not for the arbitrary this-repo reviewer the plan otherwise assumes.
- ❌ **No check that the pointer was actually *generated*** (the Done-when's core property) rather than hand-matched. Verification tests the *value*, not the *mechanism*.
- ❌ **No check for the format-collision property** from Q3/Q4.

Net: the docs-only, this-repo checks are cleanly checkable; the cross-project checks are checkable only under both-repo access and should be **labelled as such** so nobody signs off "verified" on a check they structurally couldn't run.

## 6. Should this split into multiple smaller plans?

**Yes — strongly, and the plan has already done 90% of the partitioning work for you.**

The plan cleanly separates into two sets with different owners, risk profiles, and verification paths:

- **P1 — this-repo, docs-only (steps 1, 3, 5 + this repo's `DECISIONS.md`).** Low risk, fully within this session's control, independently landable and independently verifiable (`engine-parity.html` + local doc inspection). No hard dependency on the other repo *if* the interim-state note from Q4 is added.
- **P2 — pact-guide-side patch (steps 2, 4, 6).** Different repo, different session/owner, unverifiable from here, gated on the A2.1 feasibility confirmation. Genuinely a separate unit of work with its own Done-when.

Why splitting is the right call:

- The current **single "Done when" blocks the safe, easy this-repo doc change on a *different project's* session acting** (it requires recording in pact-guide's decision log). That's artificial coupling — the low-risk half can't close until cross-team coordination completes.
- P1 and P2 have **different verifiability** (Q5): folding them together means the combined task can never be cleanly "verified" by a this-repo reviewer.
- **Counter-point to respect:** the two halves must stay coherent (same marker name, same format, same branch decision). So don't split them into two *disconnected* plans — split into **P1 + P2 that both reference a single shared one-page "marker spec"** (name, format rule, source-of-values, branch = `main`). That preserves design coherence while decoupling delivery.

Recommended structure: **P0 (shared marker spec, ~1 page) → P1 (this repo, land now) → P2 (pact-guide patch, owned by that session, land when feasibility-confirmed).**

---

## Smaller notes

- **Clarity:** thorough to the point of density — the Verified/Assumed discipline and landmine-resolution notes are genuinely good practice and should be kept. A short "TL;DR / decisions" box at the top would help a reviewer who has to hold the two-repo topology in their head.
- **Scope:** well-bounded; the Out-of-scope and "don't duplicate pact-guide's trigger task" notes are exactly right and pre-empt the obvious scope creep. The one under-specified spot is the `documents-rules` **format**, which should be pinned down (Q3/Q4) rather than left to the implementer.
- **Risk section:** honest and proportionate, correctly rates this display-only/low-blast-radius. Its one omission is the "silent manual-copy skip" risk, which the guardrail in Q3 would retire.

## Recommendations, ranked

- **R1 (do first):** Add a this-repo lint/guardrail that fails when either marker is missing/malformed or when their formats could be confused (Q3). Highest value, lowest cost, retires the main residual risk.
- **R2:** Pin the `documents-rules` format so it can never collide with `content-version` (always the full `v0.3xx @ branch@commit` triplet) (Q3/Q4).
- **R3:** Split into P0 (marker spec) + P1 (this repo, now) + P2 (pact-guide patch) with separate Done-whens (Q6).
- **R4:** Move the "`SYNCED_FROM.txt` has every fact" claim from Verified → Assumed and add the timestamp-freshness guard so a stale pricing-vendor snapshot can't stamp the wrong rules version onto fresh prose (Q2).
- **R5:** Add the interim-state note and make handoff feasibility (not receipt) a Done-when precondition (Q1/Q4).

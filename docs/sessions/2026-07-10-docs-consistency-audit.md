# 2026-07-10 — Docs-consistency audit: DECISIONS.md / CHANGELOG.md / roadmap cross-check

One-time pass (roadmap task `docs/consistency-audit`) checking `DECISIONS.md`, `CHANGELOG.md`, and
`docs/PACT_ROADMAP.md` agree with each other and with the code. Run as part of a small batched
`/run-task` alongside `fix/mobile-sticky-buttons` and `docs/audit-checklist-supabase` (the latter itself
turned out to be a finding of this same class — see below).

## Findings, and what was done about each

### 1. Stale duplicate roadmap item — "Add Supabase advisor/log check to the per-change checklist"
Already done: `AGENTS.md`'s per-change checklist step 4 already has this exact text, added in commit
`e770e26` and graduated to `CHANGELOG.md` on 2026-07-09. The roadmap entry was never pruned. **Fixed**
(as part of the sibling batch task, same branch): removed the stale roadmap entry, logged a one-line
`CHANGELOG.md` note pointing at the original commit. No code change needed — there was nothing left to do.

### 2. Real, previously-undetected D-GH# collision — a *triple* `D-GH30`
`DECISIONS.md` had **three** separate decisions all headed `## D-GH30`:
- "Live Sheet's 'AP left' reads the frozen ledger" — commit `3fbf18cd`, 2026-07-08 11:25 UTC (earliest).
- "Cloud/campaign status badge reads existing sync-ready state" — commit `8ac417e9`, 2026-07-08 23:22 UTC.
- "D-GH numbering: verify against the live remote…" — commit `4fce4cc4`, 2026-07-08 23:31 UTC (only ~8
  minutes after the second one).

This is a fourth collision instance beyond the three (D-GH19/20, D-GH25/27, D-GH26/28) `AGENTS.md`
already tracked — and it's genuinely ironic: the third colliding entry is the decision that *established*
the "check the live remote before claiming a number" policy, and it still collided, inside the exact
window its own Why paragraph already predicted the live check "narrows... but can't fully close." Two
sessions must have claimed `D-GH30` within the same ~8-minute window, each having checked a not-yet-fully-
synced view of `origin/preview`.

**Fixed** per `AGENTS.md`'s own documented fallback (keep the earliest-merged entry's number, renumber the
rest, add an addendum note under each renumbered entry):
- `D-GH30` stays with "AP left" (earliest-merged).
- "Cloud/campaign status badge" → **`D-GH42`** (next free at time of fix).
- "D-GH numbering…" → **`D-GH43`**.

Addendum notes added to both renumbered `DECISIONS.md` entries. Cross-references updated: `AGENTS.md`'s
numbering pointer and collision count (now four: D-GH19/20, D-GH25/27, D-GH26/28, D-GH30/42/43), both
affected `CHANGELOG.md` entries, and a short addendum on `docs/sessions/2026-07-08-dgh-numbering-collision-fix.md`
(narrative left intact — historical record of what was believed true at the time — with the correction
appended rather than rewritten in place, matching the `DECISIONS.md` addendum convention). References that
correctly point at the *surviving* `D-GH30` (the "AP left" decision — several in `DECISIONS.md` itself,
`AGENTS.md`, `CHANGELOG.md`, `docs/plans/2026-07-08-creation-pricing-trigger-phase1.md`,
`docs/sessions/2026-07-08-livesheet-ap-display-fix.md`) were left untouched — verified individually, not
assumed.

### 3. `AGENTS.md`'s "Active Priorities" no longer matched the roadmap
"Current focus" still named the full engine module-bridge migration (`feat/engine-bridge-all-tools`) as
the active 🔴 NOW item — but that item graduated to `CHANGELOG.md` on 2026-07-10 and NOW is now empty.
"High-risk files" still described the three tools' `DATA`/`compute()`/`MUT` as "hand-copied... parity risk
until the bridge lands" — but D-GH26/D-GH36/D-GH37 already bridged all of those in all three tools except
CharGen's still-local `MUT` inside its import-fold path. **Fixed**: both bullets rewritten to match the
current roadmap/architecture state (the file's own header comment explicitly asks for this: "refresh when
focus shifts, prune when stale — stale is worse than empty").

### 4. Stale engine-parity pass count (`9/0` / `5/0` vs. the live `20/0`)
`testing/expected/expected-results.csv` currently has 20 data rows (verified directly: `wc -l` minus
header), matching `testing/README.md`'s already-correct count. But `AGENTS.md` still said **9/0** in three
places (Verification expectations, Testing table, per-change checklist step 3), and `docs/PACT_ROADMAP.md`
still said **5/0** in eight separate "Done when" clauses across open tasks. **Fixed**: both files updated
to `20/0` (`testing/README.md` needed no change — already correct per an earlier fix logged 2026-07-10).

### 4b. Same stale count also in `docs/HOW-TO-WORK.md` (found during this task's own parity verification, outside the audit's declared 3-doc scope)
`docs/HOW-TO-WORK.md` had the same stale **"9 passed / 0 failed"** wording in two spots (the "Verifying
the engine without a browser" intro and "The loop per task" step 4). **Fixed** — both now say 20. Left
un-fixed, as a deeper and out-of-scope-for-this-pass gap: the same section's fixture list (only enumerates
CG-001–CG-006/LS-001/EV-001–EV-002 — 9 fixtures) and `expected-results.csv` column list (missing
`new_engine_events_applied`) are also stale against the current 20-fixture/12-column reality, but fixing
those properly needs enumerating all 20 fixtures correctly, not a mechanical count swap — worth a small
follow-up if someone's already in that file.

### 5. Possibly-overstated CI coverage claim — not fixed, flagged for a human call
`CHANGELOG.md`'s 2026-07-10 entry "headless Playwright e2e for character gen + advancement (**REV-11**)"
tags itself as REV-11, but the roadmap's still-open REV-11 task (`chore/rev11-ci-engine-parity`) asks
specifically for a **headless Node runner that asserts against `testing/expected/expected-results.csv`**
wired as a CI gate — a fixture-parity check, not UI-level fuzzing. Confirmed no such runner or workflow
exists (`.github/workflows/` has only `character-gen-e2e.yml`; no script references
`expected-results.csv`). The Playwright e2e harness is valuable, real coverage, but it doesn't appear to
satisfy REV-11's own "Done when" (a PR that breaks a *fixture* fails CI). Left `docs/PACT_ROADMAP.md`'s
REV-11 entry as-is (still open, correctly) and did **not** edit the CHANGELOG title — whether that
`(REV-11)` tag was intentional (broader interpretation) or a mislabel is a judgment call for whoever wrote
it, not a doc-correction this pass should make unilaterally.

### 6. Spot-checked, confirmed still genuinely open (no false "already done")
`AUD-1` (no `testing/scripts/audit.py` exists yet), `feat/save-integrity`, `feat/ap-by-level`,
`feat/clone-char-standalone`, `feat/clone-campaign-rules`, `feat/advancement-tracks`,
`docs/pre-release-qa-checklist`, `docs/rules-review-note`, the CharGen autocomplete-scroll fix, and the
Live Sheet level-cap-tile fix — spot-checked against `CHANGELOG.md`/`DECISIONS.md` keyword search, no
matching "already done" evidence found for any of them.

## What was *not* done (scope boundary)
Per the task's own instruction, only doc corrections (roadmap-graduation moves, D-GH# corrections) were
applied directly. Finding 5 is the one item that's code/interpretation-shaped rather than a mechanical doc
fix — left as a note here rather than turned into its own roadmap item, since it's a one-line judgment call
for a human, not follow-up work.

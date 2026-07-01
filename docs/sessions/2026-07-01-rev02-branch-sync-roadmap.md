# Session — 2026-07-01 · REV-02 implementation, main/preview sync, roadmap additions

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `DECISIONS.md`.*

## Goal
Pick up the next NOW task (REV-02), then address a branch divergence issue that surfaced during the session.

---

## REV-02 — SW same-origin guard (implemented this session)

Identified as the next NOW task. The `service-worker.js` fetch handler had a comment claiming
same-origin filtering but no actual check — Supabase API calls, esm.sh CDN, and all cross-origin GETs
were being intercepted and cached. Fixed by adding a two-line origin guard immediately after the GET
check:

```js
const url = new URL(e.request.url);
if (url.origin !== self.location.origin) return;
```

PR merged to `main` (see next section for why that was a problem). CHANGELOG updated; no DECISIONS.md
entry (straightforward bug fix, not an architectural choice — REV-03's network-first strategy is the
decision, logged under D-GH11).

---

## Branch divergence — root cause, fix, and prevention

### What happened

Several PRs had merged directly into `main` instead of going through `preview` first:

- CU-5 (DECISIONS.md duplicate D-GH7 fix)
- CU-7 (CharGen mobile action buttons roadmap entry)
- docs/ap-by-level roadmap entry
- REV-02 (this session)

`main` was 8 commits ahead of `preview`; `preview` had 2 merge-housekeeping commits `main` didn't.

Root cause: GitHub's default base branch was `main`, so any PR opened via the UI (or when `gh` wasn't
available in the shell PATH) targeted `main` automatically.

### Fix

Merged `origin/main` → `preview` locally. One conflict in `docs/PACT_ROADMAP.md`: `preview` still
listed REV-01 and REV-02 as TODO; `main` had them graduated. Resolved by taking `main`'s graduated
state and updating the completed-work preamble to mention both. Pushed to `origin/preview`.

After merge: `preview` is a superset of `main` (3 housekeeping merge commits ahead, no content
difference in the other direction).

### Prevention

Changed the GitHub repo default branch from `main` to `preview` (Settings → General → Default branch).
All new PRs now target `preview` by default; promoting to `main` is an explicit step when ready to go
live.

**Intended flow going forward:**
- Feature/fix branches → PR into `preview`
- When ready to ship → PR from `preview` → `main`

---

## REV-01 — Regression gate made real (implemented this session)

The `testing/tests/engine-parity.html` runner was hollow: it hard-coded `pass: true` regardless of
output and `expected-results.csv` had all blank value columns. A failing engine still reported 5/0.

### Approach chosen
Two-mode runner (see D-GH13):
- **Capture baseline** button — runs all 5 fixtures, prints CSV rows for human review before committing.
- **Run tests (assert)** button — fetches `expected-results.csv`, compares actuals, fails on mismatch.

CG-003 additionally asserts `remaining < 0` and that the first warning starts with `"OVER BUDGET"`.
LS-001/EV-001 assert `.ok`, `.total`, and `.eventsApplied`.

### Baseline captured and confirmed (engine v0.332)
| ID | total AP | warnings | ok | eventsApplied |
|---|---|---|---|---|
| CG-001 | 2 | 0 | true | — |
| CG-002 | 50 | 0 | true | — |
| CG-003 | 67 | 1 | false | — |
| LS-001 | 78 | 1 | true | 28 |
| EV-001 | 68 | 0 | true | 7 |

LS-001's single warning is "Ki points but no Ki feature" (non-blocking; character is valid).

CHANGELOG entry and roadmap graduation are on the `fix/rev-01-regression-gate` PR (not yet merged to
`preview` at time of writing). DECISIONS D-GH13 records the architecture choice.

---

## Roadmap additions

Three new tasks added to `docs/PACT_ROADMAP.md` (roadmap-only PRs, no code change):

- **🟡 NEXT — Externalize CharGen default AP + AP-by-level table** (`feat/ap-by-level`). Add
  `js/ap-by-level.js` exporting `AP_BY_LEVEL` and `DEFAULT_LEVEL`; engine surfaces them on `DATA`;
  tools on the shared bridge consume them automatically. Best done after Task 6 (CharGen bridge
  migration). AP-per-level is mechanics so bumps `DATA.version` and requires updating the REV-01
  baseline in the same PR.

- **🟡 NEXT — Feature: Theme-aware random homepage artwork** (`feat/theme-random-artwork`). Adds
  theme-specific image pools to `index.html`; randomly selects a matching image on load and re-rolls
  on theme change. Display-only; no DATA.version bump.

- **🔴 NOW — CharGen → Live Sheet button does not save character** (`fix/chargen-live-sheet-save`).
  Investigate and repair the export/save path from CharGen into the Live Sheet workflow. Covers
  reproduction, full flow trace, error-handling improvements, and a regression check.

---

## CU-1/CU-2/CU-3 graduation + a second roadmap merge conflict

`docs/PACT_ROADMAP.md` picked up another stash/upstream-style conflict marker (`<<<<<<< Updated
upstream` / `=======` / `>>>>>>> Stashed changes`) straddling the CU-2 and CU-3 entries — a leftover
from local stash handling, not a branch merge. Resolved by removing all three CU tasks (CU-1, CU-2,
CU-3 were all already done) from the NOW bucket and updating the completed-work preamble to list them.
Committed directly to `preview` (docs-only, no branch per convention).

CU-2 itself (`tools/DM Console.html` `TOOL_VERSION` v0.015 → v0.107) was still sitting on an unmerged
branch, `fix/cu-2-dm-console-version` — PR #56 opened and merged into `preview`. The merge required a
second local conflict resolution in `PACT_ROADMAP.md` (branch still had the old NOW-bucket text;
`preview`'s graduated version won). `gh pr merge --merge` transiently reported "not on any branch" /
left a stale `.git/rebase-merge` directory after the local rebase-and-push actually completed
successfully in the background — turned out to be inert leftover state, not a real interruption;
confirmed via `git reflog` and cleaned up with `rm -rf .git/rebase-merge`. The PR merge on GitHub itself
went through cleanly once retried.

One side effect: the PR merge added its own copy of the CU-2 CHANGELOG line, duplicating the one
already on `preview` — deduped in a follow-up commit.

**End of session state:** `preview` NOW bucket contains only CU-4 (branch pruning, blocked on
`preview → main` promotion), CU-6 (optional DM Console rename), and the CharGen → Live Sheet save fix.
No open PRs.

# D-GH-2026-07-15-parity-warning-text-assertions — exact warning-text assertions via a JSON sidecar, not a new CSV column

Status: Active

- **Context:** `testing/expected/expected-results.csv` asserted only `new_engine_warnings` as a
  **count** per fixture, not which warnings actually fired — so a warning changing wording, firing for
  the wrong reason, or silently disappearing while another appeared wouldn't fail the gate. This was
  the documented precondition REV-14 (splitting `compute()`'s ~371-line, 54-`W.push`-site body into
  named sub-pricers) was waiting on.
- **Options:** (a) add a new `expected-results.csv` column holding each fixture's warning text (joined
  by some in-cell delimiter); (b) a new JSON sidecar file (`expected-warnings.json`) mapping test ID to
  its exact warning-text array, loaded alongside the CSV by both harnesses.
- **Decision:** (b). While enumerating the actual warning text every fixture produces (to build the
  expected data), discovered LS-001's Ki-focus warning — `"You have 2 Ki / Focus points but no
  Ki-using ability yet — buy a Ki feature, or refund the points if you won't use them."` — contains a
  literal comma. Both harnesses' CSV loader uses an unquoted `line.split(',')` (the existing `notes`
  column already works around this by using semicolons instead of commas, precisely because the parser
  has no quoting support) — embedding warning text with a real comma into a column that isn't the last
  one would silently misalign every subsequent column. A JSON sidecar sidesteps the problem entirely
  with no parser rewrite.
- **Why:** Extending the naive CSV parser to support quoted fields (real CSV semantics) would fix (a)
  too, but that's a larger, riskier change to test infrastructure that's worked by convention for a
  while — not worth it for one new assertion when a sidecar file does the job with zero parser risk.
  Removed the CG-003/CG-007 hardcoded first-warning-text checks in both harnesses since the general
  exact-array assertion now subsumes them; kept their independent `remaining`-sign assertions (not
  about warning content). Verified the new assertion actually catches a mismatch (not just a no-op) by
  temporarily corrupting one expected entry and confirming a FAIL, then restoring it. Enumerating every
  fixture's actual warnings also surfaced that only 5 of the engine's 54 `W.push` sites (plus the
  separate over-budget `W.unshift`) are ever exercised by the current 20 fixtures — a real coverage
  gap, but per the roadmap task's own instruction not to feel obligated to close it in this same
  test-only change; left as a roadmap follow-up instead.
- **Status:** in force.

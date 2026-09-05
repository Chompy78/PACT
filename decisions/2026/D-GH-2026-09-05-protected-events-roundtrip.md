# D-GH-2026-09-05-protected-events-roundtrip — a gate kept for a bug that does not exist

Status: Active

- **Context:** `/code-review ultra` on PR #503 predicted a live failure: `dmRemoveBoon` is protected
  *positionally* by `pact_ap_ledger_protected()`, CharGen's `replaceWholeLogFromBuild()` re-synthesises
  the entire event log from the DOM, and CharGen cannot emit `dmRemoveBoon` at all (`grep -c` → 0).
  Predicted symptom: open a sealed character in CharGen, save, and `trg_pact_locked_history` raises
  `PACT: locked character history cannot shrink` in front of a player.

  Filed as `fix/chargen-regenerates-protected-events` and left unreproduced for two days. A close read of
  the code (#517) said the symptom should not occur; that reading was recorded as **explicitly
  unverified**, and this record is what settles it.

- **Options:**

  Once reproduction showed no failure:
  1. *Close the finding as "no bug" and delete the task.* Rejected — it would discard the one thing the
     review got right.
  2. *Make `replaceWholeLogFromBuild()` preserve protected events by construction.* Deferred, not
     rejected — it is the correct end state, but it sits on every load, reset and randomize, and there
     is no failing case to prove a change against.
  3. **Keep a regression gate that pins the invariant.** Chosen.

- **Decision:** Close the predicted bug as **not reproduced**, and keep
  `testing/scripts/protected-events-roundtrip-ci.mjs` plus its workflow as a standing gate.

- **Why:**

  **What reproduction actually showed** (headless Chromium, three consecutive runs, 8/8 each):

  | Probe | Result |
  |---|---|
  | Load a character carrying `sessionSeal` + `dmRemoveBoon` through the real load path | both survive; protected projection **5 → 5** |
  | Call `replaceWholeLogFromBuild()` directly | both destroyed; projection **5 → 2** |
  | `_cgBlockedBySeal()` on that character | refuses, with *"🔒 Part of this character's history is locked."* |

  So the predicted failure does not occur, and the hazard it pointed at is **real and now demonstrated
  rather than argued**. `_cgApplyEnvelope` rebuilds and then reinstates the saved log verbatim; the
  destructive entry points are refused with a readable message; ordinary edits never reach the rebuild.

  **Why keep a gate for a bug that does not exist.** Because the invariant holds by *caller discipline*,
  not by construction. Four call sites each either restore afterwards or refuse first; a fifth that
  forgets both reintroduces the failure, and its symptom is a raw database error shown to a player.
  Discipline that only lives in reviewers' heads is exactly what this repo has been bitten by — see
  `D-GH-2026-09-05-protected-projection-search-path`, where a rule applied project-wide was silently
  dropped from one function and nothing noticed for two days. A gate converts the convention into
  something CI enforces.

  **Why assertion 2 is deliberately a "this still breaks" check.** It asserts that
  `replaceWholeLogFromBuild()` *does* drop protected events — pinning a known-fragile mechanism so a
  future reader cannot mistake the arrangement for safe-by-design. If someone later makes the rebuild
  preserve them by construction, that assertion **should** start failing; its own message says to delete
  it and note the change. A tripwire, not a demand that the fragility persist.

  **Why the gate is its own workflow.** `sql-guards` proves the trigger behaves but never loads a tool.
  `chargen-flows` and `cloud-e2e` drive the tools but assert nothing about the protected projection.
  Neither would notice a client silently dropping a sealed event. The projection is mirrored
  client-side from the SQL, so no Supabase and no credentials are needed.

  **A correction worth recording, because it nearly became a fourth false claim.** The first run of this
  script reported all three load assertions failing — apparently confirming the bug. The fault was the
  probe: it read `window.LOG`, and `LOG` is declared with `let`, so it is not a property of `window`.
  The tell was `_cgSealedFloor()` returning **6** in the same output that claimed zero events — an
  impossible pair. Had that run been reported as-is it would have "confirmed" a bug that does not exist,
  in a session that had already produced three claims made from a single signal. The gate now carries a
  comment naming the trap for anyone extending it.

- **Status:** Active. `fix/chargen-regenerates-protected-events` graduated — its "Done when" required
  step 1's result recorded with evidence either way, and a test that fails if a protected event is lost
  across a round trip. Both are met.

  **Deliberately not done:** making the rebuild safe by construction. It remains the right end state and
  is now cheap to attempt safely, because this gate would catch a regression introduced while doing it —
  but there is no failing case to prove such a change against, and the function is on every load, reset
  and randomize. Left for whoever has a reason to touch that path.

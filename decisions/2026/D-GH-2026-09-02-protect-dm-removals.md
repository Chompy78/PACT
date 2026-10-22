# D-GH-2026-09-02-protect-dm-removals — a DM-removed boon cannot be un-removed from a locked history (`dmRemoveBoon` joins the protected projection)

Status: Active

> **Provenance.** Written 2026-10-22 from commit `f2418a9` (shipped in PR #503): its message and its diff (`sql/migrations/2026-09-02-widen-protected-projection.sql`, `testing/sql/session-seal-test.sql`). It was not written by the commit's author on the day, so it records only what those sources state. The missing record was flagged on the board as `docs/decisions-for-2026-09-02-sql-commits`.

- **Context:** a `dmRemoveBoon` event sat outside **both** `pact_ap_ledger_protected()`'s projection and `pact_ap_ledger_spend()`'s sums, so deleting one moved neither trigger's view of the log: the projection never mentioned it, and its cost is 0 so no sum changed. A player could delete one from a locked prefix, `js/engine.js` `activeEvents()` would stop suppressing the boon, and the DM's decision was silently reversed inside a history the seal calls permanent.

- **Options:**
  1. *Protect it positionally, like the other flat events (add it to the projection).* **Chosen.**
  2. *Give it the harder derived-value treatment that priced patch events need.* Rejected: that treatment exists because something legitimately **rewrites or relocates** patch events (`replacePatchSlot()`). Nothing does that to this event.

- **Decision:** `dmRemoveBoon` is added to the protected projection (`sql/migrations/2026-09-02-widen-protected-projection.sql`, carried into the baseline `sql/rls-policies.sql`).

- **Why positional protection is correct here — checked, not assumed:**
  - The event is created in exactly one place (`tools/DM-Console.html`, around line 2652), and only through `dm_edit_character_log()`, whose write is `v_log := v_log || v_new`, append-only.
  - Every other reference only reads it: `js/engine.js` `activeEvents()` and the Live Sheet's history renderer. CharGen never mentions it.
  - Nothing rewrites one in place or moves one.
  - A whole-log rebuild (`buildToEventLog` → `_buildEventBurst`) would drop one, since it re-synthesises from the DOM, but every path that does so is already refused on a locked character by `_cgBlockedBySeal()`, so it is not a legitimate write this change breaks.
  - **The general lesson, recorded in the migration header:** "just add it to the projection" is right or wrong depending on whether anything legitimately rewrites that event type. It has to be checked per type, never inferred from the shape.

- **Blast radius:** zero, twice over. Measured immediately before applying: 0 `dmRemoveBoon` events across all 35 live characters, and 0 seals, so no character had a protected prefix at all.

- **Verification (from the commit):** in a rolled-back transaction against the live trigger, deleting the event was refused, re-pointing its `refVal` at a different boon was refused, and a new purchase after the seal was still allowed. The SQL harness gained cases (43 assertions / 0 failures, up from 40) on a Postgres 16. The repo migration body hashed identically to the live `pg_proc` definition.

- **Later follow-up:** the predicted failure that this gate could break a legitimate CharGen round trip was reproduced and did not occur; the gate stayed anyway. See `D-GH-2026-09-05-protected-events-roundtrip`.

- **Related:** `D-GH-2026-09-02-baseline-is-the-authority`.

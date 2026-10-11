Nemotron 3 Super (API)

# Review of Plan — stored character size stops lying (`fix/stored-size`)

**Goal achievement:** Yes, the plan ensures that after the fix any raw read of the character's size field will return Medium for non‑choosable characters, because new saves store the correct size and the one‑off migration appends a correcting event that updates the stored value to Medium. All tools already use `compute().size`, so their behavior is unchanged.

**Shaky assumptions**
- The assumption that any reader that inspects the raw database will use the *most recent* size event. If a reader instead scans all events and picks the first, or aggregates in some other way, the stored "Small" events could still cause a false Small reading.
- The grep‑based assumption that no code path reads the stored size when size is not choosable. While plausible, it relies on the current code base; future tooling or plugins could introduce such a path.
- The assumption that appending a zero‑AP patch event has no effect on AP/budget calculations. This depends on the existing exclusion logic; if that logic changes, the correction could unintentionally affect resources.

**Better alternatives / missing considerations**
- Make the stored size field *optional* and treat its absence as a signal to fall back to `compute().size`. A migration could set size to `null` (or delete the field) for non‑choosable characters, guaranteeing that any reader that respects the absence rule gets the correct size without relying on event order.
- Add a runtime validation step in the save path that overwrites any incorrectly stored size with the computed value before writing, providing a defense‑in‑depth guarantee even if some future code mistakenly reads the stored field.
- Document the expectation that consumers of the event log should use the latest size event, and provide a helper function (e.g., `getLatestSize(log)`) to discourage incorrect aggregations.

**Verification**
The proposed verification—re‑running the engine scan over the live logs and confirming zero mismatches between `compute().size` and the stored size field—is directly observable and repeatable. It does not depend on hidden state, making it objectively checkable.

**Conclusion**
The plan satisfactorily meets the stated goal under the current assumptions. To harden the solution against the noted shaky assumptions, consider adding the optional‑size fallback or a pre‑save validation step, and explicitly document the expected event‑log consumption pattern for raw readers.
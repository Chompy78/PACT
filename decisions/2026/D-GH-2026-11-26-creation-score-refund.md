# D-GH-2026-11-26-creation-score-refund — scores can be changed freely until creation is locked (rules v0.389)

**Context.** v0.388 (D-GH-2026-10-29-no-purchase-refunds) kept the AP for the highest score ever held, including during creation. Owner (2026-11-26): "That's wrong and it doesn't make sense." Amble's Caspian and Skylar had both lowered a score before their creation lock and would have been charged for it. The 2026-10-04 decision note says only that dumping below 10 stays and nothing is removed or lowered after the lock; the before-lock restriction appears in the task text written from it.

**Options.**
- Free until creation is locked.
- Free until the character's first session seal.
- Keep v0.388.

**Decision (owner).** Free until creation is locked. `_replay` remembers `statsHigh` only for locked state (seeded with the score held at the lock); an unlock clears it. A dump below 10 is unchanged.

**Not changed.** Event-sourced frozen ledgers; the server guard; `compute()`'s price formula.

**Status.** Accepted. Supersedes the before-lock part of D-GH-2026-10-29-no-purchase-refunds.

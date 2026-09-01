# Review — `feat/session-seal`

## Model and relevant settings

**Model:** GPT-5.6 Luna.  
**Relevant settings:** I do not have access to the repository, database, browser tooling, or the implementation beyond the supplied plan, so this review assesses the plan's logic, clarity, scope, and risk only. I am treating the stated “verified” items as claims made by the plan, not as independently verified facts.

## 1. Does this plan actually achieve the stated goal?

**Mostly yes at the design level, but not yet completely enough to call the plan airtight.**

The core design is sound:

- A zero-AP, DM-authored seal event avoids changing the existing AP accounting path and therefore avoids the identified double-counting problem.
- Putting the seal in the shared event LOG gives both player tools a common source of truth.
- Extending `undoFloor(events)` means the existing Live Sheet undo protection can inherit the new rule.
- Explicitly addressing CharGen checkbox deletion and whole-build replacement is essential. The plan correctly identifies that protecting only Undo would not satisfy “cannot be un-selected”.
- Keeping the character editable forward after the seal is the right semantic model: the seal freezes history before the boundary rather than making the whole character read-only.

However, there is a significant gap: **the plan has not fully specified the invariant that must hold when a sealed character is modified or synchronised after the seal.** Risk 4 acknowledges this, but the proposed implementation does not yet say how the system prevents a stale client from deleting or replacing sealed history.

The most important acceptance invariant should be stated explicitly:

> No authorised or unauthorised client operation may result in an event LOG whose prefix before the latest seal is different from the sealed prefix, or whose length is below the seal's floor.

Without defining that invariant across **every write path**, “the seal works” is too dependent on the current UI behaving correctly.

So: **the architecture is appropriate, but the plan needs one more layer of write-path/synchronisation specification before implementation.**

## 2. Which assumptions look shakiest, and what would you do about them?

### A. Offline/late-arrival behaviour — by far the shakiest

This is correctly identified as the sharpest open question.

The problematic sequence is:

1. Player has character state A locally.
2. DM seals the character at state B.
3. Player's stale client still has A or performs an undo/delete based on A.
4. That client later syncs.
5. The system must decide whether the stale write is rejected, merged, or somehow transformed.

This cannot safely be left as a UI question. **The database/server must enforce the seal invariant**, otherwise a stale client can potentially bypass the browser protections.

I would make the intended rule explicit:

> Once a seal exists, server-side writes must reject any operation that would remove, replace, or mutate events at or before the seal boundary.

For a whole-build replacement, the server should not accept a stale replacement merely because the client was previously authorised. The client must refresh/rebase, or the operation must fail with a clear conflict.

I would also add an explicit test for this race.

### B. “DM-only”

This is plausible, but it is an assumption rather than a requirement demonstrated by the supplied material.

**Action:** confirm with the owner before implementation. If confirmed, enforce it at the database boundary, not just in the DM Console.

### C. “Seals are stackable”

Also reasonable, but it should be made precise.

The plan says the newest seal sets the floor. That raises an important semantic question: **what exactly does a seal record?**

If `undoFloor(events)` simply treats every seal as a barrier, this is fine if the barrier is derived from the event's position. But the plan should explicitly define whether:

- every seal is retained permanently;
- the latest seal is the effective boundary;
- an earlier seal remains meaningful for audit/history;
- malformed or duplicated seal events are handled deterministically.

I would retain all seals for audit purposes while defining the effective floor as the latest valid seal.

### D. Existing characters are not retroactively sealed

This is a sensible default and should probably be made a hard migration requirement.

The migration must add capability only; it must **not create seal events or alter existing LOGs**.

### E. Sealed purchases should be visibly explained

I agree with this assumption. More importantly, the explanation should be **derived from the actual seal state**, rather than being a UI-only convention. Otherwise the UI can drift from the engine.

## 3. Is there a better alternative?

### The chosen approach is better than A1 and A2

**A1 — make the AP award itself the seal:** I agree with rejecting it. The plan identifies the central accounting problem correctly: AP currently has two independent inputs, and moving the award into the LOG risks changing the authoritative accounting model.

**A2 — seal Undo only:** definitely insufficient. It explicitly fails the user's requirement because CharGen can delete a purchase without invoking Undo.

**A3 — make CharGen read-only:** also correctly rejected. It violates the important requirement that players can continue building after the session boundary.

### One alternative worth considering: a first-class “sealed-through event ID/index” rather than a marker event

If the underlying data model permits it, a separate server-side seal record could arguably be cleaner than adding a special event to the character LOG. For example, a character/session seal could record the exact event identity or immutable sequence number being sealed.

That would make the semantic distinction extremely clear:

- LOG = character history
- seal metadata = immutable boundary over that history

It could also make concurrency and synchronisation easier to reason about.

**But I would not automatically replace the proposed marker-event design with this.** The supplied plan already has a proven DM-authored event mechanism, the shared engine already understands event barriers, and adding another persistence mechanism creates its own consistency and migration problems. Given the project's existing architecture, the dedicated marker event is probably the better incremental change.

The bigger improvement is not changing the architecture; it is **making server-side enforcement and concurrency semantics explicit.**

## 4. What is missing?

### A. Server-side enforcement of the seal invariant

This is the biggest omission.

The plan focuses heavily on CharGen controls, which is necessary, but browser controls cannot be the ultimate security boundary.

The plan should identify every operation capable of changing the LOG and specify whether it:

- is allowed after a seal;
- must preserve the sealed prefix;
- must be rejected;
- must be rebased;
- or must be performed through a privileged server function.

The existing DM append-events function is promising, but the plan does not establish from the supplied text whether **all** character LOG writes pass through equivalent server-side protection.

That is not something I can verify from this document.

### B. Explicit concurrency model

Add a section covering:

- DM seals while player is editing.
- Player saves immediately before/after the seal.
- Two browser tabs edit the same character.
- Player is offline when the seal is created.
- Player reconnects with stale local state.
- DM seals twice in quick succession.
- A request is retried after a timeout.

For each case, define the expected outcome.

### C. Whole-build replacement semantics

The plan correctly identifies New Character, file load, and Randomise as dangerous.

But it should say exactly what happens when replacement is attempted on a sealed character.

My recommendation:

> A replacement operation is permitted only if the resulting LOG preserves the complete sealed prefix unchanged. If the operation cannot guarantee that, reject it and require the client to reload/rebase.

Do not rely on “the UI will disable things” for this.

### D. Definition of “purchase made before that moment”

This needs a precise event-level definition.

For example:

- Is the seal boundary the event immediately preceding the seal event?
- Are all purchase events before the seal immutable?
- What about a purchase that is subsequently cancelled by a later event?
- Are non-purchase events also protected?
- Does the seal protect the entire LOG prefix, or only purchases?

The stated goal says “everything bought before that line”, while the implementation proposal talks about an event-history floor. Those concepts should be explicitly reconciled.

### E. Undo semantics around non-purchase events

The plan says the barrier protects a leading event prefix. It would be useful to specify whether the seal freezes **all history** before the boundary, even though the user-facing requirement is framed around purchases.

That matters because a history floor is broader than a purchase lock.

### F. Error and recovery behaviour

Specify what the player sees when an operation is rejected:

- stale character;
- sealed history;
- sync conflict;
- attempted deletion of a sealed purchase.

The UI should distinguish “this is locked by the DM” from a generic save failure.

### G. Auditability

The plan says the marker is DM-stamped, which is good. I would also define what is retained for audit:

- who sealed it;
- when;
- campaign/character;
- position of the boundary;
- whether AP was awarded in the same action.

This is especially important because the feature deliberately creates an irreversible historical boundary.

### H. Transactionality of “award AP + seal”

The plan says these happen in the same DM action. It should explicitly require that the database operation be atomic.

You do not want:

- AP successfully awarded but seal failed; or
- seal successfully written but AP award failed.

If they are presented as one action, the persistence semantics should make them one transaction or provide an equally strong failure guarantee.

### I. Idempotency/retry behaviour

DM actions can be retried after a network timeout. The plan should specify what happens if the same “award + seal” request is submitted twice.

This is particularly important because the AP award already affects a numeric column. A retry must not award AP twice.

### J. Migration rollback/forward-compatibility

The migration risk is mentioned, but there should be a simple operational statement about deployment order:

1. database accepts the new event;
2. application understands it;
3. clients are deployed;
4. old clients encounter the new marker safely.

The supplied text does not establish whether old clients ignore unknown events, reject them, or could accidentally mishandle them. That is worth checking before rollout.

## 5. Is the verification section objectively checkable?

**Partly. The current tests are concrete, but the acceptance criteria are incomplete.**

Good, objectively checkable items include:

- Existing gates remain at 0 failures.
- A seal event grants zero AP.
- A sealed checkbox cannot be unticked.
- Undo refuses to cross the barrier.
- New purchases remain functional.
- Database advisor passes.

Those can be automated.

The weak point is that the verification suite does not yet cover the most consequential unresolved behaviour: **concurrency and stale clients**.

I would add deterministic tests for at least:

| Scenario | Expected result |
|---|---|
| Undo before seal | Allowed |
| Undo crossing seal | Rejected |
| Checkbox deletion before seal | Allowed |
| Checkbox deletion of sealed purchase | Rejected |
| New purchase after seal | Allowed |
| Whole-build replacement preserving sealed prefix | Allowed, if supported |
| Whole-build replacement that removes sealed prefix | Rejected |
| Stale client saves after DM seal | Rejected/rebased according to defined policy |
| DM seal while player is offline | Seal survives; stale client cannot overwrite it |
| Duplicate award+seal request | AP awarded once |
| Seal-only request | AP unchanged |
| Two successive seals | Latest boundary becomes effective |
| Existing character before migration | Unchanged and unsealed |

The final “done when” statement should also be turned into machine-testable acceptance criteria wherever possible.

## 6. Should this be split into more than one plan?

**I would not split it by component. I would split the implementation into two logical stages if the team wants to reduce risk.**

### Stage 1 — persistence and invariant

Implement and test:

- seal event;
- server/database allow-list;
- atomic DM award + seal;
- engine barrier;
- concurrency/stale-client rules;
- migration;
- automated tests.

This establishes the actual security and data invariant.

### Stage 2 — CharGen UX

Implement:

- checkbox disabling;
- explanations/tooltips;
- whole-build replacement behaviour;
- stale-state error/reload UX;
- browser-driven acceptance tests.

This separation is useful because Stage 1 proves that the data cannot be corrupted, while Stage 2 proves the UI makes the rule usable.

I would **not** make A2 (“Undo only”) a staging release. The plan correctly notes that it fails the actual requirement, and releasing it risks users assuming the feature is complete.

## Overall verdict

**Approve the direction, but request changes before implementation.**

The dedicated zero-AP seal event is a strong fit for the existing architecture and is materially better than coupling the seal to AP accounting. The plan also does a good job identifying the non-obvious CharGen deletion and whole-build replacement paths.

The principal weakness is that the plan currently treats the browser/UI as a larger part of the enforcement mechanism than it should be. The critical invariant needs to be enforced and tested at the persistence/server boundary, particularly for **offline clients, stale writes, retries, and concurrent edits**.

### Changes I would require before implementation

1. Define the exact event-level meaning of the seal boundary.
2. Define server-side enforcement for every LOG mutation path.
3. Define the stale/offline/concurrent-write policy.
4. Make “award AP + seal” atomic and idempotent.
5. Specify whole-build replacement behaviour after a seal.
6. Add automated tests for the above race/conflict cases.
7. Confirm the DM-only and stackable-seal assumptions with the owner.
8. Clarify what exactly is frozen: the whole historical prefix or only purchase events.

With those additions, the plan would be substantially stronger and the acceptance criteria would be much closer to objectively demonstrating that the feature cannot silently lose sealed history.

## Source basis

This review is based solely on the supplied cold-review plan. The plan itself states that repository access is unavailable to the reviewer and asks that unverifiable implementation claims not be guessed at. fileciteturn0file0L138-L153

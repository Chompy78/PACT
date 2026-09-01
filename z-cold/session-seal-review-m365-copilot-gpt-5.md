# Cold Review: `feat/session-seal`

**Model:** M365 Copilot, based on the GPT-5 reasoning model  
**Relevant settings:** Cold review of the supplied document only; no repository, database, browser runtime, or test environment access. Australian English. Claims described as verified in the plan are treated as premises, not independently verified facts.

## Executive verdict

**Recommendation: revise before implementation.**

The core architecture is sound: a dedicated, zero-value, DM-authored seal event is cleaner and safer than repurposing the existing AP award. It preserves the current AP accounting model, gives the shared engine an explicit barrier, and allows characters to keep progressing after each seal.

However, the plan does **not yet guarantee the stated end-to-end goal**. It covers local user actions after a client has received the seal, but it does not define the authoritative behaviour when a stale or offline client later saves a shorter or divergent LOG. That is not an edge case. It is a missing concurrency and data-integrity rule at the persistence boundary. If ordinary character saves can replace the server LOG without enforcing the current server-side floor, then UI controls and client-side undo checks are advisory rather than a security or integrity boundary.

A second significant gap is the definition of exactly what a seal freezes. “Everything bought before that line” sounds purchase-specific, while `undoFloor(events)` freezes the leading history structurally. Those are compatible only if all relevant mutations are append-only and every editing path preserves the prefix. CharGen’s existing mid-LOG splice and whole-build reconstruction show that this invariant is not currently universal.

## 1. Does the plan achieve the stated goal?

### Short answer

**Mostly for an up-to-date online client, but not yet for all persistence and synchronisation cases.**

### What the plan gets right

1. A separate seal event avoids coupling history permanence to AP value.
2. Extending the existing privilege-checked DM append function is preferable to inventing a second authorisation path.
3. Adding the marker to the shared engine rule should make Live Sheet undo recognise it without duplicating logic.
4. The CharGen work correctly identifies that Undo alone is insufficient. The removal path, reconstruction paths, and visible controls all need treatment.
5. Stackable markers naturally fit a leading-prefix floor, assuming later seals supersede earlier floors without changing their meaning.
6. Keeping new purchases editable after the latest seal matches the stated requirement better than making the entire character read-only.

### Where achievement remains incomplete

#### 1.1 The server-side save contract is unspecified

The plan says how a DM appends a seal, but not how a player subsequently saves a character. The decisive questions are:

- Does a player save replace the full LOG, append events, or submit a revision?
- Can a stale client overwrite a LOG that now contains a DM seal?
- Does the database reject a proposed LOG whose immutable prefix differs from the current authoritative prefix?
- Is there optimistic concurrency control, such as a revision number, updated timestamp, or compare-and-swap condition?

Without one of those protections, a player need not deliberately bypass the UI. An ordinary stale save could erase the marker and the purchases it was meant to freeze.

#### 1.2 “Frozen purchases” and “immutable prefix” need an explicit equivalence rule

The feature is described in purchase language, but implemented as a structural LOG floor. The plan should state the invariant explicitly:

> Once a valid seal is part of the authoritative LOG, no non-DM operation may remove, reorder, replace, or semantically neutralise any event at or before that seal.

This is stronger and clearer than protecting only checkbox purchases. It also exposes whether later compensating events, such as boon removal, are permitted after a seal. A purchase may remain in the LOG but be effectively reversed by an appended removal event. That might be intended, especially for a DM action, but it needs a stated rule.

#### 1.3 The award-and-seal operation is not described as atomic

The plan calls the seal a separate marker written “in the same DM action”, but does not say whether the AP column update, audit ledger insert, and seal append occur in one database transaction.

If they are separate calls, partial outcomes are possible:

- AP awarded but history not sealed;
- history sealed but AP award failed;
- audit row written for only one part;
- the DM retries and duplicates one side.

This does not invalidate the dedicated marker design, but the user-visible combined action should have a defined transaction and retry policy.

#### 1.4 Control disabling is useful UX, not the principal integrity mechanism

Greying and explaining sealed controls is correct. Re-ticking sealed controls after another routine force-unchecks them is more fragile. The durable rule should be that the underlying mutation is rejected before the LOG changes. Rendering should then derive disabled state from that same immutable-prefix information.

If the implementation depends on “re-tick and disable” after invalidation code runs, the plan risks UI races and transient corruption. Prefer preventing the invalidation routine from targeting sealed events in the first place, or having it produce a proposed LOG that is validated centrally before commit.

### Verdict for question 1

The proposed design is directionally correct and likely achieves the visible behaviour in normal online use. It cannot be said to achieve the full goal until persistence-level stale-write protection, atomicity, and the exact immutability invariant are specified.

## 2. Shakiest assumptions and recommended treatment

### 2.1 Existing characters are not retroactively sealed

This is plausible and safest for migration, but it is a product decision, not merely an implementation default. Existing histories may contain previous DM-stamped barriers that already affect `undoFloor(events)`, so “not retroactively sealed” does not necessarily mean “fully editable until first explicit seal”.

**Action:** obtain an owner decision and document migration semantics precisely. State whether existing barrier types continue to lock history exactly as they do after Step 1, and whether the new marker adds another barrier rather than replacing old meanings.

### 2.2 Seal is DM-only

This follows the campaign framing but leaves solo and offline characters outside the feature. That may be entirely acceptable because they are explicitly out of scope. The shaky part is not the conclusion; it is whether “DM-only” means only the DM may create seals, only cloud characters may be sealed, and whether a character removed from a campaign retains existing seals.

**Action:** record a product decision covering authorship, campaign removal, campaign transfer, ownership transfer, and deleted campaigns. Existing valid seals should probably remain meaningful historical facts even if campaign membership later changes.

### 2.3 Seals are stackable

This is strongly implied by “each session” and is the correct default. Still, stacking introduces identity and audit questions. A marker should probably carry a server-generated event ID and timestamp, and possibly a session or award-ledger reference, even if a human-readable session label is optional.

**Action:** make stacking explicit and define the canonical “latest seal”: latest valid seal in authoritative event order, not latest client timestamp supplied by a browser.

### 2.4 A disabled control plus tooltip is sufficient explanation

A tooltip alone is weak for keyboard users, touch devices, and accessibility. Native disabled controls often do not emit hover or focus events, so their tooltip may be unavailable.

**Action:** use visible or focusable explanatory text, an adjacent lock indicator, or an `aria-describedby` relationship. Test keyboard and touch behaviour. This is not a reason to broaden the feature, but it makes the proposed explanation reliable.

### 2.5 The DM append function makes the marker “tamper-evident for free”

This is only partly supported by the stated facts. Re-stamping proves that events appended through that function receive server-controlled authorship. It does not prove that another save path cannot later delete, reorder, or replace those events.

**Action:** replace “tamper-evident for free” with a narrower claim unless all LOG write paths enforce preservation of DM-authored barriers. Audit every database function, row-level policy, and direct update path that can modify the LOG.

### 2.6 Whole-build replacement should preserve sealed history

The required behaviour is underspecified. Possible interpretations include:

- block New Character, load, and Randomise whenever the open character has a seal;
- allow the operation only as creation of a new character identity;
- merge regenerated post-seal events onto the immutable prefix;
- permit replacement only after an explicit “discard unsaved character and open another” navigation action.

Blindly preserving the prefix while rebuilding later events may create an invalid or incoherent build.

**Action:** define each operation separately. “New Character” and loading a different file are identity/navigation operations, not necessarily edits to the current cloud character. Randomise is an edit and should apply only to the mutable suffix or be unavailable when that cannot be done coherently.

## 3. Is there a better alternative?

### Recommended architecture

Keep the **dedicated zero-AP seal event**, but strengthen it with a **server-enforced immutable-prefix save contract** and, for the combined award action, a **single transactional database operation**.

This is better than any of the three rejected alternatives because it cleanly separates:

- AP accounting;
- audit history;
- session sealing;
- client presentation;
- persistence integrity.

A robust form would be:

1. The DM calls one server operation for “award AP and optionally seal”, or a seal-only operation.
2. The server checks campaign authority.
3. In one transaction, it updates the numeric AP field, writes the ledger row, and appends one seal marker when requested.
4. Every character LOG save includes an expected revision or equivalent concurrency token.
5. The server rejects stale revisions and rejects any write that changes the authoritative immutable prefix.
6. The client reloads and presents a conflict rather than overwriting.

### Assessment of rejected alternatives

#### A1: AP award itself is the seal

The rejection is sound under the stated data model. It would blur AP source accounting or require a migration of the authoritative AP mechanism. It is not better for this step.

There is one variant worth noting: an award ledger entry could carry a reference to a separate seal event, or the atomic server function could produce both. That preserves separation without making the award event itself the barrier.

#### A2: Seal Undo only

The rejection is correct. It fails the explicit un-selection requirement and should not be shipped as a completed feature. It could be an internal implementation checkpoint only if it never reaches users as the claimed session-seal feature.

#### A3: Make CharGen read-only once sealed

The rejection is correct because it prevents forward progression. It could be a temporary fail-safe if the fine-grained mutable-suffix implementation proves unsafe, but it is inferior as the product design.

### Potentially better data model, but likely excessive here

A server-side `sealed_through_event_id` or immutable prefix hash on the character row could make validation efficient and explicit. However, storing a derived seal boundary beside an event-sourced LOG introduces synchronisation obligations and may violate the project’s preference to derive state from the LOG. It is not clearly better unless LOG validation cost or concurrency handling makes it necessary.

A safer minimal extension is to derive the floor from the authoritative LOG on the server during save validation. With only 25 current characters, correctness is more important than premature optimisation.

## 4. What is missing?

### 4.1 Required design for offline and late-arrival clients

This is the main blocker.

#### Required invariant

The server’s current LOG is authoritative. A client that loaded revision `R` must not overwrite revision `R+1`, especially when `R+1` contains a DM seal.

#### Recommended conflict policy

1. Give each character a monotonically increasing revision, or use another reliable compare-and-swap token.
2. Every save submits the revision the client loaded.
3. If the server revision differs, reject the save without modifying data.
4. Return or prompt a reload of the current character.
5. Preserve the stale client’s unsaved mutable work locally so it can be reviewed or reapplied after the seal.
6. Never automatically merge removal or reconstruction operations across a newly arrived seal.

#### Example conflict

1. Player loads events 1 to 20 at revision 7.
2. DM appends seal event 21, producing revision 8.
3. Player locally removes event 15 and attempts to save a LOG based on revision 7.
4. Server rejects the write as stale.
5. Client reloads revision 8. Event 15 is now in the immutable prefix and cannot be removed.
6. Any unrelated post-seal work should be offered for explicit reapplication, not silently merged.

#### Alternative if revisioning is unavailable

At minimum, the save operation must compare the proposed LOG against the current server LOG and require exact preservation of the current immutable prefix. This catches destructive writes but may still allow lost updates in the mutable suffix. Revisioning is the clearer and more general solution.

#### Offline scope distinction

The plan excludes local/offline characters with no DM. That is different from a cloud character temporarily edited offline. The latter is squarely part of risk 4 and must be handled.

### 4.2 Atomicity and idempotency

Define whether combined award-and-lock is one transaction. Define what happens on retry after timeout. The operation should use an idempotency key or otherwise prevent duplicate award ledger entries, duplicate AP increments, and unintended duplicate seals.

Duplicate zero-value seals might not change calculations, but they can damage audit clarity. Duplicate AP increments would be materially harmful.

### 4.3 Event schema

The new marker needs a precise schema and validation rules. At minimum, specify:

- canonical event type name;
- schema/version field if the LOG uses one;
- server-authored actor and timestamp;
- stable event ID;
- optional link to award ledger entry or campaign session;
- explicit absence of AP value, or enforced zero value;
- behaviour when unknown future clients encounter it.

“Zero AP” is safer if the event type cannot carry an AP amount at all, rather than merely carrying `0` by convention.

### 4.4 Compatibility with older clients

An older CharGen or Live Sheet may not recognise the new event. Depending on current parsing behaviour, it could ignore, discard, or fail on the marker. A stale deployed page or cached static asset could then save a LOG without it.

Specify:

- minimum compatible client behaviour for unknown events;
- cache/version strategy for static files;
- whether the server blocks writes from clients below a schema version;
- whether unknown events must always be preserved byte-for-byte or structurally.

### 4.5 All LOG mutation paths

The plan names CharGen paths but should require an explicit inventory of every LOG writer, including:

- normal cloud save;
- autosave, if present;
- import and export round trips;
- file load into an existing cloud character;
- randomisation;
- new-character flow;
- Live Sheet mutations other than Undo;
- DM boon grant and boon removal;
- database functions and administrative tools;
- any migration or repair scripts.

The rule belongs at a common mutation boundary wherever possible. A list of known UI paths is not a durable substitute.

### 4.6 Semantics of later removals and corrections

The database already permits DM boon removal. The plan must say whether a DM may append a removal after a seal. If yes, this does not “unseal” history; it records a later authorised change. If no, the allow-list or validation must distinguish sealed targets.

Likewise, decide how genuine mistakes are corrected when unsealing is out of scope. An append-only corrective event may be needed even if destructive rewriting remains forbidden.

### 4.7 Exact seal boundary and event ordering

Define whether the seal freezes:

- all events before the marker;
- the marker itself;
- events in the same submitted batch before or after it;
- the AP award ledger action associated with it.

A simple rule is that the immutable floor is the index immediately after the latest valid seal marker, making the marker itself immutable. Tests should pin this down.

### 4.8 Failure and feedback behaviour

The UI needs defined responses for:

- award succeeds but seal cannot be created, if operations are not atomic;
- stale save rejection;
- lack of network connectivity;
- permissions changed between opening and submitting the form;
- seal-only action on an already sealed, unchanged LOG;
- server returns an unknown or malformed event.

### 4.9 Rollout and rollback

For live data, “additive migration” is necessary but not sufficient. Include:

- pre-deployment backup or verified recovery point;
- deployment order for database and static clients;
- compatibility during mixed-version rollout;
- smoke test against a non-production campaign or test character;
- monitoring for rejected writes and function errors;
- rollback behaviour after seal events already exist.

If the database accepts the event before clients understand it, preservation by older clients matters. If clients ship first, the database must fail safely until the migration lands.

### 4.10 Audit and observability

The plan should say how a DM or support operator can confirm that a seal exists and who created it. A visible session-history entry, audit ledger link, or diagnostic view would materially reduce the “silent failure” risk.

### 4.11 Changelog and decision-log content

The “Done when” clause requires both, but not what decisions must be recorded. At minimum record:

- why seal is separate from AP;
- server authority and stale-write policy;
- stackability;
- non-retroactive migration;
- unsealing out of scope;
- behaviour of whole-build replacement paths;
- compatibility expectations for older clients.

## 5. Is verification objectively checkable?

### Overall assessment

**Partly.** The named gates and expected failure counts are objective, but several requirements are too broad or omit the setup and expected state needed for reproducibility.

### Objectively checkable items already present

- Each named script exits successfully and reports 0 failed.
- The barrier pure-function test recognises the marker.
- A test can assert that seal events contribute zero AP.
- A browser test can assert that specified controls are disabled.
- A browser test can attempt Undo and compare the LOG before and after.
- A database advisor can be run and its findings recorded.

### Judgement-dependent or incomplete items

- “Affected CharGen checkboxes” does not identify which controls or fixtures.
- “Cannot be un-ticked” must test both DOM interaction and underlying LOG immutability, not only visual state.
- “New purchases after it behave normally” needs explicit operations and expected LOGs.
- “Award AP with the lock option set” does not check transaction failure, retry, or partial success.
- “Database advisor run” is not a pass criterion. Which severity levels are allowed? What baseline differences are acceptable?
- There is no test for stale clients, concurrent saves, old clients, duplicate submissions, malformed markers, unauthorised users, or preservation through import/export.
- There is no explicit test that existing 25 characters remain unchanged by migration.

### Recommended acceptance matrix

1. **Migration safety**
   - Snapshot representative character rows before migration.
   - Run migration.
   - Assert LOGs, AP columns, ownership, and campaign relationships are unchanged.
   - Assert no seal event was added retroactively.

2. **Authorisation**
   - Campaign DM can append a seal to a campaign character.
   - Character owner who is not DM cannot append one through any exposed route.
   - DM of another campaign cannot append one.
   - Anonymous user cannot append one.
   - Server overwrites or rejects client-supplied authorship and timestamps as designed.

3. **AP accounting**
   - Seal-only changes spendable AP by exactly 0.
   - Award without seal changes AP exactly once.
   - Award with seal changes AP exactly once and appends exactly one seal.
   - Retry of the same request does not increment AP twice.

4. **Atomicity**
   - Inject failure into each stage of combined award-and-seal.
   - Assert either all intended database changes commit or none do.

5. **Barrier semantics**
   - No seal: existing behaviour remains unchanged.
   - One seal: floor is immediately after the marker.
   - Multiple seals: latest valid marker determines the floor.
   - Events after the latest seal remain undoable or retractable under existing rules.
   - Malformed or player-authored lookalike markers do not gain DM authority.

6. **CharGen mutation paths**
   - Sealed boon purchase cannot be unchecked.
   - Sealed drawback purchase cannot be unchecked, if applicable to the purchase model.
   - Attempted removal leaves the LOG byte-for-byte or structurally unchanged.
   - Mutable post-seal purchase can be checked and unchecked normally.
   - Undo stops at the floor.
   - Randomise cannot modify the sealed prefix.
   - New Character does not overwrite the current sealed cloud character.
   - Loading a file cannot replace the sealed prefix of the current cloud character.
   - Existing validity recalculation does not force-remove a sealed purchase.

7. **Live Sheet**
   - Undo stops at the new seal.
   - Other mutation paths preserve the immutable prefix.
   - New post-seal events remain usable and undoable as intended.

8. **Concurrency and offline return**
   - Load revision R on player client.
   - Append seal on server, producing R+1.
   - Attempt save from R that removes a pre-seal event.
   - Assert server rejects it and authoritative LOG remains unchanged.
   - Assert client surfaces a clear conflict and offers reload.
   - Assert unrelated local work is not silently lost or silently merged.

9. **Compatibility**
   - Export and re-import preserve the seal event.
   - Unknown-event handling preserves markers.
   - A deliberately old client cannot erase a seal on save.

10. **Accessibility and explanation**
    - Locked state has a programmatically associated explanation.
    - Explanation is available with keyboard and touch interaction, not hover only.

11. **Database advisory pass criterion**
    - Record the exact advisor output before and after.
    - Require no new high or critical security findings.
    - Review all new warnings and document any accepted exception.

With named fixtures, exact initial LOGs, expected final LOGs, exit codes, and database assertions, the verification becomes objectively repeatable.

## 6. Should this be split into more than one plan?

### Recommendation

**Yes, split delivery into two implementation plans or two mergeable phases, while keeping one end-to-end feature acceptance gate.**

This should not be split into independently shippable partial products where only the UI lock lands. It should be split by risk and dependency:

### Phase 1: Authoritative seal and persistence integrity

Scope:

- event schema;
- SQL allow-list migration;
- server transaction for award-plus-seal and seal-only;
- immutable-prefix validation on every LOG write path;
- revision or concurrency control;
- idempotency;
- engine recognition;
- pure-function and database tests;
- mixed-version rollout rules.

This phase establishes that a seal cannot be lost even if a client is stale or defective. It may be deployable behind a disabled UI or feature flag, but should not expose a user workflow until Phase 2 is ready.

### Phase 2: Product workflow and client enforcement

Scope:

- DM Console lock option and standalone action;
- CharGen mutation guards;
- CharGen control states and explanations;
- behaviour for New Character, load, and Randomise;
- Live Sheet regression coverage;
- conflict UX for stale clients;
- browser-driven end-to-end tests;
- changelog and decision log.

### Why this split is better

- It isolates the highest-risk live database and concurrency work.
- It gives the client work a stable server contract.
- It prevents UI behaviour from being mistaken for integrity enforcement.
- It permits focused review and rollback.
- It still preserves a single “Done when” definition: the feature is not complete until both phases pass the end-to-end acceptance suite.

## Specific changes recommended to the plan text

1. Replace “tamper-evident for free” with a claim limited to server-authored append operations, unless all later LOG writes are proven to preserve sealed prefixes.
2. Add a formal immutable-prefix invariant.
3. Add a persistence and concurrency section defining stale-save rejection.
4. State that cloud characters temporarily offline are in scope, even though purely local characters are not.
5. Make the combined award-and-seal action transactional and idempotent.
6. Define each whole-build replacement path separately rather than treating them as one class.
7. Define whether later DM-authored removal or correction events may supersede sealed purchases without deleting history.
8. Define the seal event schema and ordering semantics.
9. Add old-client and unknown-event compatibility requirements.
10. Convert verification into explicit fixtures, operations, and expected database and LOG states.
11. Define objective pass criteria for the database advisor.
12. Split implementation into authoritative backend integrity and client workflow phases, but do not ship the feature as complete after only one phase.

## Final assessment

The chosen dedicated-marker approach is the best of the options presented and should be retained. The plan demonstrates good understanding of the current double-counting hazard and the inadequacy of Undo-only protection.

The blocking defect is that the design currently treats the client’s local floor as though it were sufficient to preserve server history. It is not. The feature becomes reliable only when the authoritative save path rejects stale or prefix-destroying writes, and when award-plus-seal has defined atomic and idempotent behaviour.

**Outcome: approve the architecture in principle; request plan revision before implementation.**

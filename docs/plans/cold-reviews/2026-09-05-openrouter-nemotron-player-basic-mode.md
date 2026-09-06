Reviewer: OpenRouter API, model `nvidia/nemotron-3-super-120b-a12b:free` (free tier). Note: this model
skipped the "Reviewer instructions" section's first instruction (self-identify as the first line) entirely
— it went straight to answering the five questions with no self-ID line at all. Different failure mode
than the Gemini/Groq rounds in this same folder (wrong identity vs. no identity), but the same underlying
lesson: verify the reviewer actually followed the embedded instructions, don't assume it did because most
of the rest of the output looks competent.

**Verification note, per this project's cold-review process — this round held up well.** Unlike the Groq
round, this reviewer correctly recognized the plan's *current*, already-revised state (the broadened
trigger + lock, the resolved authority decision) rather than critiquing an earlier version of the plan
that no longer exists. Its one genuinely new point — accepted below — is real and wasn't raised by any of
the three prior reviewers.

**Accepted:** a previously-unraised edge case — what happens to the `basic_mode` flag and its
`basic_mode_set_by`/`basic_mode_set_at` metadata if a flagged player's account is ever deleted, depending
on foreign-key `ON DELETE` behavior (`CASCADE` silently drops it, `RESTRICT` could block the deletion
entirely). Doesn't affect the core goal (a deleted account has no characters left to restrict), but is a
real operational question worth deciding before implementation rather than discovering via a failed
deletion in production. Folded into the plan as a Risks note.

**Not new, but correctly identified (matches existing lower-priority notes):** the "exactly ONE insert
path" claim being stronger than its cited evidence (DM Console wasn't checked) — this reviewer explicitly
noticed the plan's own Review-outcome section already flags this, rather than re-presenting it as an
undiscovered gap the way Groq did with the partial-unique-index point.

---

```markdown
player-basic-mode-review-Nemotron-3-Super.md
=============================================

## 1. Does this plan actually achieve its stated goal?
Yes, the plan achieves its goal of restricting a player to exactly one active (non-archived) character in a manner that cannot be bypassed by direct database access. The enforcement mechanism uses a `BEFORE INSERT OR UPDATE OF archived_at` trigger on the character table that, when the player's `basic_mode` flag is enabled, verifies the count of active characters (`archived_at IS NULL`) for the owner. To eliminate race conditions, it acquires an explicit lock (via `pg_advisory_xact_lock` keyed on `owner_id` or `SELECT ... FOR UPDATE`) before counting. This design covers both character creation (INSERT) and un-archiving (UPDATE setting `archived_at` to NULL), closing the archive/create/un-archive bypass. The lock ensures serializable execution for concurrent operations on the same owner, preventing the count-then-act race. As enforced at the database layer, it cannot be circumvented by direct SQL calls.

## 2. Are any of its "Verified" claims suspicious — internally inconsistent, or asserted with more confidence than the plan's own evidence supports?
Yes, the claim that "There is exactly ONE code path in the whole app where a genuinely new character row gets inserted" is overconfident and lacks sufficient evidence. The plan states this was verified by examining the two player-facing tools, but the lower-priority notes explicitly acknowledge that the DM Console was not checked. Since the assertion presents this as a verified fact without full verification, it introduces risk: if the DM Console contains an alternative insert path (e.g., for awarding campaign characters), the enforcement could be bypassed there. This claim should be softened (e.g., "verified in the two primary player-facing tools") or re-verified to include all potential insert paths before implementation.

## 3. Is there a better alternative to the proposed approach that the plan didn't consider?
No, the plan thoroughly evaluated alternatives. It rejected a naive partial unique index referencing `player_accounts.basic_mode` (due to PostgreSQL's requirement for partial index predicates to depend only on immutable expressions of the indexed table) and instead proposed two sound implementations: (a) a lock-guarded broadened trigger (selected as the initial approach) and (b) denormalization of `basic_mode` onto the character table to enable a genuine partial unique index. It also considered enhancing error handling with a SQLSTATE error code (`ERRCODE`) alongside message-substring matching, noting it as valuable to adopt in the "Alternatives considered" section. All significant alternatives were addressed; none were overlooked.

## 4. What's missing — an edge case, a failure mode, a piece of the "Done when" list that isn't actually objectively checkable?
The plan's verification and done-when criteria are largely objective and robust. However, one edge case not explicitly covered is the consequences of deleting a player account while they have an active `basic_mode` flag. While the "Out of scope" section correctly states that retroactive enforcement is not intended (so existing over-limit players are not auto-corrected), the plan does not specify what happens to the flag or its metadata (`basic_mode_set_by`, `basic_mode_set_at`) upon account deletion. Depending on foreign key settings (e.g., `ON DELETE CASCADE` vs. `RESTRICT`), this could either silently remove the flag data or block account deletion entirely. Though this does not directly violate the core goal (a deleted player has no active characters to restrict), it may cause operational issues (e.g., failed deletion workflows) and should be documented or tested. That said, all core functionality remains objectively verifiable via the specified done-when and verification steps.

## 5. Should this be split into more than one plan (e.g., is the "who can set this flag" question big enough that it should be resolved as its own decision before any code plan is written at all)?
No, the plan does not require splitting. The authority/model question (who may set and unset the flag) was already resolved in a separate decision record (`decisions/2026/D-GH-2026-09-05-player-basic-mode.md`), and this plan has been explicitly revised to incorporate that outcome (as noted in the "Update 2026-09-05 — decision recorded" and "plan body revised" sections). The current text reflects the settled authority model, making a separate plan unnecessary. The remaining open questions (configurable limit via numeric value, handling of local-only characters) are properly flagged as deferred implementation details in the "Still open" section, not blocking concerns requiring independent planning.
```

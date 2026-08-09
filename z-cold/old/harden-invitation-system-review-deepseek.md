Review: harden-invitation-system-plan

Reviewer: Claude 3.5 Sonnet (Anthropic)
Date: 2026-08-09
Context: Cold review of plan document only; no repository, database, or file contents beyond what is quoted.

---

1. Self-identification

This is Claude 3.5 Sonnet, operating with standard safety and reasoning settings. No external tools or repository access were used; this review is based solely on the provided plan text.

---

2. Does this plan actually achieve the stated goal if executed as written?

Yes, with caveats. The plan is logically coherent and addresses each layer of the reported vulnerability:

· It stops the read leak via column‑grant narrowing (proven pattern).
· It replaces the low‑entropy, reusable dm_invite_code with a high‑entropy, scoped, revocable token table, closing the guess/brute‑force path.
· It extends the existing hardened campaign_invites table rather than building a parallel system, inheriting its atomic‑claim, DM‑only creation, and soft‑deletion properties.
· It explicitly sequences UI wiring after model changes, preventing accidental use of the old primitive.

The plan also correctly identifies that the migration and rate‑limiting decisions are genuine open questions that must be resolved before ship. Provided those are resolved in line with the security properties, the technical approach will achieve the goal.

However, the plan relies on several assumptions that, if they turn out false, could undermine the fix. I flag these in the findings below.

---

3. Are any "Verified" facts actually assumptions, and any "Assumed" items that should have been verified earlier?

Verified‑vs‑assumption check

Claimed Verified Assessment
The campaigns row‑select policy is … — stated as read from live source. This is a claim; I cannot verify it from the plan. However, the plan is internally consistent and the language suggests the author actually inspected the files. I treat this as verified in the author's context but note that the exact policy text is not quoted, so a reviewer cannot independently judge its correctness. This is not a fatal flaw for a plan review.
The exact narrowing precedent exists on a sibling table — with a comment explaining why. Similarly, this is plausible and the plan reuses the pattern. The absence of a quoted example makes it hard to judge whether the pattern is truly applicable to campaigns (e.g., if campaigns has foreign‑key dependencies that the narrowed grant would break). This is a moderate risk but not a plan flaw.
join_as_dm does not check caller is a member — verified by inspection. Straightforward to verify; likely accurate.
No rate‑limiting or abuse‑tracking exists — verified by inspection. This is a negative fact; the plan’s honesty about it is credible.

Assumptions that should have been verified before writing the plan

· Hosting‑platform rate limiting (Assumption #1) — this is a critical dependency for requirement 11. The plan correctly notes it must be confirmed, but I would argue this should be verified before committing to the design, because if platform throttling does not cover RPCs, the plan will require a new table and function logic that significantly expands scope. This is a blocking‑level open item for the implementation phase.
· Existing UI for player invite generation (Assumption #4) — the plan says “once confirmed” but does not specify who confirms it or by when. This could delay the UI wiring step if the existing pattern is unsuitable. Recommend making this a pre‑implementation check, not an assumption.
· Current row counts (Assumption #3) — less critical, but affects migration performance and the decision on whether to regenerate all DM codes in a single transaction or batch. The plan should include a simple script to count rows before writing the migration.

---

4. Is there a better alternative that this plan didn’t consider?

The plan’s considered alternatives are reasonable. One additional approach not mentioned:

· Deprecate the dm_invite_code column immediately and force all existing DMs to generate a new single‑use token via the UI — i.e., a “cut‑over” rather than a migration. This avoids the ambiguous migration choice (step 5) entirely, because old codes are simply ignored (the column remains but is never read). This would be a clearer behavior change (existing DMs get an empty invite list and must create one) but it might break workflows. The plan’s deliberate migration choice is more conservative, which I agree with.

Another nuance: the plan does not consider server‑side validation of the type field to prevent a DM‑type token from being redeemed via the player‑type function. It mentions “a client‑supplied campaign identifier cannot override the campaign a token is bound to” but does not explicitly state that the redemption function must reject a token if the requested action does not match its type. I recommend adding that as a verification case.

---

5. What’s missing — a step, a risk, a file, a verification case?

Missing steps

· Explicit revocation/deprecation of the old join_as_dm function. The plan says “retire dm_invite_code” but does not list a step to REVOKE EXECUTE on that function or to drop/ignore the column. If the function remains executable, even if the column is hidden, an attacker who guesses the old code might still use it. The column should be set to NULL for all rows and the function should be dropped or patched to always return an error. This is a critical missing implementation detail.
· Decision on token storage (hash vs. plaintext). The plan mentions “stored as a hash where practical” but does not commit. For a 128‑bit random token, hashing is practical and strongly recommended to protect against database compromise. This should be a concrete design choice in the plan, not an open question.
· Atomic handling of reusable invite counts. The plan adds count/limit fields for reusable redemption but does not specify how to atomically decrement the remaining uses in a concurrent environment. The existing single‑use pattern uses UPDATE ... WHERE redeemed_by IS NULL — for reusable, you need UPDATE ... SET uses_remaining = uses_remaining - 1 WHERE uses_remaining > 0 with a RETURNING check, which is race‑safe in PostgreSQL. The plan should explicitly mention this pattern to avoid a new concurrency bug.
· A step to remove dm_invite_code from the narrowed column‑grant. The plan says narrow the SELECT grant to exclude both invite‑code columns. It later says to leave the player invite_code as‑is. That’s inconsistent — the plan should clarify whether the narrowed grant excludes only dm_invite_code or both. If it excludes both, the player code would become unreadable for legitimate players (breaking join flow). This is a serious ambiguity.

Missing risks

· Migration rollback complexity. If the migration adds new columns and populates them from the old dm_invite_code, and then something goes wrong, rolling back will require a separate down‑migration. The plan does not mention a rollback strategy.
· UI confusion during migration. If existing DMs see both the old “regenerate DM invite code” button and the new “generate DM invite token” button, they may use the wrong one. The plan should schedule removal of the old UI elements in the same deployment, not later.
· Performance impact of token‑table joins. If all invite checks now go through campaign_invites instead of a simple column equality, ensure there is an index on (campaign_id, type, token_hash, redeemed_by IS NULL, expires_at > NOW()). The plan does not mention indexing.

Missing verification cases

· Test that the old join_as_dm function is completely unreachable (if deprecated).
· Test that a revoked token cannot be used even if it is not expired.
· Test that a token intended for a specific campaign cannot be used to join a different campaign (the plan mentions this but does not list it as a verification case).
· Test that a DM invite token cannot be redeemed by the campaign owner (they are already a DM) — what is the expected behavior? Should it error gracefully? The plan should specify.
· Test that regenerating a new reusable token invalidates the old one (if that is intended).

---

6. Is the “Verification” section objectively checkable?

Mostly yes, but a few items are subjective.

· “Run the RLS‑audit script” — the script itself is not described, so we don’t know if it checks column‑level grants. The plan says “extend with new coverage” — that is good, but the extension itself is not defined. A reviewer would need to see the new assertions to judge completeness.
· “Manually re‑derive by reading the final policy” — this is objective: someone can read the \d+ output or the policy file and confirm. Good.
· “Confirm rules‑engine regression suite unaffected” — they say “run once” — that is objective.

However, the plan does not specify how to prove that the rate‑limiting step (if implemented as a new table) actually works under load — e.g., a concurrent test that fires 100 redemption requests and expects exactly the configured number to succeed. This should be part of the end‑to‑end script extension.

Overall, the verification section is reasonably concrete but could benefit from a checklist of specific adversarial SQL queries (e.g., SELECT dm_invite_code FROM campaigns WHERE ... run as a non‑DM user) that must return zero rows.

---

7. Should this plan split into more than one plan?

Yes, for two areas:

1. The migration decision (step 5) — reusable vs. single‑use. This is a user‑facing behavior change that affects how existing campaigns operate. It deserves a separate design document or at least a dedicated review with the product owner, not a binary choice left to the engineer. I recommend splitting step 5 into a pre‑implementation decision task that produces a clear spec (e.g., “all existing DM codes become reusable tokens with infinite uses, to preserve current behavior”) and then proceed with the technical migration.
2. Rate limiting (step 7). If the platform does not provide throttling, this is a new subsystem (attempts table, cleanup job, etc.) that could double the effort. I recommend a separate spike to confirm platform capability first, then either fold rate‑limiting into the main plan or spin it off as a distinct task. The main plan should be conditioned on that confirmation.

The rest of the plan (column narrowing, token table extension, redemption functions, UI wiring) can stay as one cohesive implementation plan.

---

8. Findings summary

Finding Severity Confidence Agree/Disagree
Missing explicit deprecation of the old join_as_dm function and column. Without this, the old code path may still work, leaving the vulnerability open. blocking high N/A
Ambiguity on which columns are excluded from the narrowed SELECT grant. The plan says “both invite‑code columns” but then says leave the player code as‑is. Contradiction must be resolved. blocking high N/A
No specification for atomic decrement of reusable invite use counts — could reintroduce concurrent‑redemption bugs on reusable tokens. moderate medium N/A
Rate‑limiting dependency on platform is unverified before plan approval. Should be a pre‑condition, not an assumption. moderate high N/A
Migration decision (step 5) is left open‑ended — could cause user regression if wrong. Should be resolved with product input before coding. moderate high N/A
Token storage (hash vs. plaintext) is not committed. Should be explicitly decided in the plan. moderate medium N/A
Verification checklist lacks specific adversarial SQL queries — e.g., “as non‑DM, select dm_invite_code from campaigns” — to make the check fully objective. minor low N/A
No rollback strategy or index plan for the migration. minor medium N/A
The plan’s “verified” claims are not reproducible from the document — but that’s acceptable for a cold review; however, quoting the actual policy text would strengthen the plan. minor low N/A

---

9. Overall recommendation

Conditionally approve the plan, with the following mandatory pre‑conditions:

· Resolve the migration choice (step 5) with product owners and record the decision before any code is written.
· Verify the hosting platform’s rate‑limiting coverage for RPC calls; if absent, design the attempt‑tracking table as part of the plan (or spin off a separate task).
· Add explicit steps to deprecate/remove the old join_as_dm function and the dm_invite_code column (or set it to NULL and ignore).
· Clarify the column‑grant narrowing: exactly which columns are excluded, and ensure the player invite_code remains readable for legitimate players.

Once these are addressed, the plan is robust, well‑reasoned, and appropriately risk‑aware. The author has clearly learned from past RLS incidents and the approach of “extend, don’t parallel” is sound.

---

Review complete.
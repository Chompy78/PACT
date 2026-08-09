# Cold Review: Harden the campaign invitation system (PACT)

**Reviewer:** Grok 4.5 (xAI)  
**Date:** 2026-08-08  
**Document reviewed:** hardening plan.md (task-board item `fix/harden-invitation-system`)

---

## 1. Does this plan actually achieve the stated goal if executed as written?

**Yes, with important caveats.**

The stated goal is to close a confirmed, currently-live privilege-escalation bug (any authenticated user who obtains/guesses a 6-character `dm_invite_code` can become a co-DM) and replace the two ad-hoc invite mechanisms with one hardened, unified model that satisfies a fixed list of security properties, without changing user-visible behavior for people using invites correctly today.

If the steps are executed faithfully:

- Column-grant narrowing stops the read leak of `dm_invite_code` (and preferably `invite_code`).
- Moving DM invites onto the extended `campaign_invites` table (128-bit tokens, atomic claim-on-redeem, type/mode/expiry/revocation) eliminates the low-entropy, system-wide, unscoped redemption path.
- Scoping the redemption function to a specific token row + enforcing expiry/revocation closes the escalation vector.
- Modeling the new functions on the existing (already-hardened) player-invite functions reduces the chance of re-introducing known classes of bugs.
- The verification suite (existing RLS audit + e2e + new adversarial cases + DB advisory tool) provides a realistic chance of catching regressions.

**Caveats that could still leave residual risk or break the “no user-visible behavior change” promise:**

- The migration decision in step 5 is left open. Choosing the wrong default (force every existing campaign onto single-use only, or preserve reusable forever) either changes visible behavior or leaves a weaker security posture than the rest of the plan implies.
- Rate limiting (step 7) is still unresolved. If the platform does not already throttle the relevant RPCs, and the new attempt-tracking table is incomplete or absent, the high-entropy tokens are still theoretically brute-forceable (albeit far harder than 6-character codes).
- The plan never explicitly states the full “fixed list of security properties” that the unified model must satisfy. The reader is left to infer them from the steps. This makes it harder to verify completeness.

Overall: the plan is directionally correct and, if the open design calls are resolved carefully and the verification is actually performed, it should achieve the goal. It is not yet a fully closed plan.

**Severity of residual gap:** moderate  
**Confidence:** high

---

## 2. Are any of the “Verified” facts actually assumptions in disguise, or any “Assumed” items things that should have been verified before this plan was written?

**Most Verified items are solid; a few border on assumption. Several Assumed items should have been closed first.**

### Verified section
- The description of the `campaigns` SELECT policy and the absence of a narrowed column GRANT is presented as read from live source files. Acceptable as verified within the document’s own framing.
- The existence of a proven column-list GRANT pattern on a sibling table is also presented as observed. Good.
- The `join_as_dm` function’s lack of membership check, its broad EXECUTE grant, and the resulting system-wide attack surface are clearly stated as observed. High confidence these are real.
- The `campaign_invites` table’s positive properties (CSPRNG token, atomic UPDATE…RETURNING, soft revoke, correct RLS scoping) are presented as inspected. Credible.
- `expires_at` being a no-op is explicitly noted. Good.
- Absence of rate-limiting tables/policies is stated as “none found by inspection.” Acceptable.
- Prior planning document scope and the existence of the two audit scripts are treated as known. Fine.
- Prior RLS/grant regressions caught by the advisory tool are historical fact within the project’s own narrative.

**Borderline items that are closer to strong inference than pure observation:**
- “No rate limiting anywhere in the schema or policy files (none found by inspection)” – absence of evidence is not evidence of absence if the search was incomplete. Still reasonable to treat as verified for planning purposes.
- The claim that the code space is “roughly 2.1 billion combinations (36^6)” is arithmetic, not a database fact, but correct.

### Assumed / not verified section
Several of these should have been closed (or at least bounded) before writing an implementation plan of this size:

| Item | Why it should have been verified | Severity if left open |
|------|----------------------------------|-----------------------|
| Platform-level rate limiting on RPC calls | Directly determines whether step 7 requires new application machinery or can lean on existing infra. Leaving it open risks scope expansion mid-implementation. | moderate |
| Whether any `dm_invite_code` has already been misused | Affects urgency and whether a forced rotation / notification is required. Static analysis cannot answer it, but log inspection (if logs exist) could. | moderate |
| Current row counts of the two tables | Directly affects migration cost/risk and whether a “regenerate every DM code” statement is trivial or expensive. Easy to query. | minor–moderate |
| Existence and shape of any existing DM-facing “generate player invite” UI | Needed to decide whether the new “generate DM invite” affordance can mirror an existing pattern. UI discovery is cheap. | moderate |
| Contents of the longer code-review document referenced elsewhere | Explicitly acknowledged as potentially containing adjacent findings. Leaving it unread risks missing related issues. | moderate |

**Finding:** The plan correctly separates Verified from Assumed, but several Assumed items are cheap to close and material to scope/risk. Treating them as open questions is honest; treating them as acceptable to leave open until implementation is riskier than necessary.

**Severity:** moderate  
**Confidence:** high

---

## 3. Is there a better alternative to the proposed approach that this plan didn’t consider?

**Yes – two alternatives worth explicit consideration.**

### Alternative A (preferred for speed-to-mitigation)
**Immediate, narrow hot-fix first, then the full unification.**

1. Immediately narrow the `campaigns` SELECT grant to exclude `dm_invite_code` (and optionally `invite_code`).
2. Immediately change `join_as_dm` so it requires the caller to already be a member of the campaign (or at least a player in it) **and** add a simple rate-limit / attempt-counter if none exists at the platform level.
3. Rotate every existing `dm_invite_code` (or mark them all revoked and force generation of new ones).
4. Only after the live privilege-escalation path is closed, proceed with the larger unification onto the token table.

This does not fully satisfy the long-term “unified hardened model” goal, but it dramatically reduces the currently-live risk in hours/days rather than the longer timeline implied by a full redesign + migration + UI work. The plan currently treats the full redesign as atomic. A phased approach is safer for a confirmed live escalation bug.

### Alternative B
**Keep the shared reusable code for player invites, but force single-use (or short-lived reusable with explicit expiry + rotation) for DM invites only.**

The plan already notes that the player `invite_code` is lower urgency. Making the DM path strictly single-use / short-lived while leaving the player path as-is (for now) reduces the migration decision surface and the behavior-change risk for ordinary players. The unified table can still be used; the `mode` column simply defaults differently by type.

The plan rejected “column-grant narrowing alone” and “just rotate more often,” which is correct. It did not seriously explore a phased mitigation or a differential policy for DM vs player invites. Both are reasonable and lower-risk paths given that a live escalation bug exists today.

**Severity of omission:** moderate  
**Confidence:** medium–high

---

## 4. What’s missing — a step, a risk, a file, a verification case?

### Missing or under-specified steps
- Explicit decision record for the migration choice (step 5) **before** writing the migration SQL. The plan flags it as a design call but does not require it to be resolved and logged prior to implementation.
- Concrete definition of the “fixed list of security properties” the unified model must satisfy. Without it, “done when” is harder to evaluate objectively.
- Handling of already-issued (and possibly already-read) `dm_invite_code` values: notification to DMs? Forced rotation? Logging of historical redemptions?
- Client-side error handling and messaging for the new redemption paths (generic errors that do not leak “expired vs revoked vs never existed” are required by verification, but the plan does not discuss the UX copy or the client RPC wrappers).
- Explicit plan for what happens to the old `regenerate_dm_invite_code` / `regenerate_invite_code` functions and the columns after migration (drop? keep as deprecated? convert into thin wrappers?).

### Missing risks
- **Token storage:** the plan says “stored as a hash where practical.” For single-use tokens that are redeemed by presenting the cleartext value, hashing is good; for any reusable mode the cleartext (or a reversible form) must still be recoverable or the UI cannot show the code again. This tension is not discussed.
- **Concurrency beyond redemption:** concurrent generation of many invites, concurrent revoke + redeem, etc.
- **Backward compatibility of the client RPC surface:** existing mobile/web clients that still call the old `joinAsDm` with a 6-character code will break unless a compatibility shim is provided for a transition period.
- **Audit / forensics:** once the old codes are gone, can an investigator still answer “who became a co-DM and via which invite?” The new model should preserve an audit trail; the plan does not explicitly require one.

### Missing files / artifacts
- The decision-log entry template or the actual decision record for steps 5 and 7.
- Any temporary compatibility / deprecation migration that keeps the old RPCs working for a short window.
- Explicit test fixtures or seed data for the new adversarial cases (the verification section lists the cases but not how they will be seeded).

### Missing verification cases
- A non-member, non-player authenticated user cannot redeem a DM invite even if they somehow obtain the token (the plan’s system-wide attack surface is acknowledged; the test should cover it).
- After column-grant narrowing, an ordinary player’s `SELECT * FROM campaigns` (or equivalent client query) returns no invite-code columns and does not error in a way that leaks their existence.
- Migration idempotency / re-run safety.
- Behavior when `expires_at` is in the past vs NULL vs far future.

**Severity of most important omissions (phased mitigation, migration decision gate, audit trail, compatibility):** moderate  
**Confidence:** high

---

## 5. Is the “Verification” section objectively checkable by someone who did the work, or is it vague enough that “I did it” could be claimed without real evidence?

**Mostly checkable, with a few soft spots.**

Strong, objective items:
- Existing RLS-audit script and cloud/auth e2e script must pass.
- Hosted database advisory/lint tool must be clean.
- Specific adversarial assertions listed (non-DM cannot read secret, cross-type redemption rejected, concurrent single-use redeem yields exactly one success, expired/revoked produces generic error, client-supplied campaign id cannot override token binding).
- Manual re-derivation of final policies/grants by reading the live state (not the diff).
- Rules-engine regression suite unaffected.

Softer / less objective items:
- “Both need new cases added specifically asserting…” – the list is good, but there is no requirement that the new cases be committed, named, or visible in CI. An implementer could claim they were added and run privately.
- “Manually re-derive… that no authenticated non-DM role can select a DM invite secret” – excellent intent, but without a required artifact (e.g., a checked-in query result or a test that fails if the column is selectable) it remains a judgment call.
- “Confirm the existing rules-engine regression suite is unaffected” – easy to claim without evidence if the suite is large.

**Recommendation:** require that the new adversarial tests be added to the existing scripts, committed, and that the CI (or the documented run) shows them passing. Also require a short “live policy dump” or a test that selects the forbidden columns and asserts they are absent from the result set.

**Severity of current vagueness:** minor–moderate  
**Confidence:** high

---

## 6. Should this plan split into more than one plan?

**Yes.**

The live privilege-escalation bug is confirmed and currently exploitable by any authenticated user who can obtain or guess a 6-character code. Closing that path is urgent.

The larger work (unified token model, migration design, rate-limiting infrastructure, UI affordances, full verification expansion) is high-effort and contains genuine design decisions (especially step 5).

**Recommended split:**

1. **Hot-fix / containment plan** (NOW, high urgency)  
   - Narrow column grants.  
   - Tighten `join_as_dm` authorization (require existing membership or equivalent).  
   - Add or confirm rate limiting.  
   - Rotate or revoke existing `dm_invite_code` values.  
   - Minimal verification that the escalation path is closed.

2. **Unification & hardening plan** (follow-on)  
   - Extend `campaign_invites`, migrate, new functions, UI, full adversarial suite, decision log entries, etc.

The migration-decision risk in step 5 is large enough that it deserves its own short design note (or at least a forced decision-log entry) before the unification work begins, but it does not need a completely separate multi-week plan of its own.

**Severity of not splitting:** moderate (delays closure of a live escalation)  
**Confidence:** high

---

## Summary of Findings

| # | Finding | Severity | Confidence |
|---|---------|----------|------------|
| 1 | Plan achieves the goal if executed carefully, but open migration and rate-limit decisions leave residual risk and possible behavior change. | moderate | high |
| 2 | Several “Assumed” items (platform rate limits, existing UI patterns, row counts, prior code-review doc, possible past misuse) should have been closed or bounded before planning. | moderate | high |
| 3 | Phased hot-fix + later unification, and differential treatment of DM vs player invites, were not considered. | moderate | medium–high |
| 4 | Missing: pre-implementation migration decision gate, explicit security-properties list, audit-trail requirement, client compatibility plan, token-hashing vs re-display tension, several verification artifacts. | moderate | high |
| 5 | Verification is mostly objective but lacks required committed tests / live-policy artifacts that would make “I did it” claims hard to fake. | minor–moderate | high |
| 6 | Plan should be split: immediate containment of the live escalation, then the larger unification work. | moderate | high |

---

## Overall Disposition

The plan is thorough, honest about what was verified versus assumed, correctly identifies the core defect class, and reuses proven in-repo patterns. It is a strong foundation.  

It is not yet ready for direct implementation without:

1. Closing or explicitly deciding the open design calls (migration semantics, rate limiting).  
2. Preferentially shipping a narrow containment fix first.  
3. Tightening the verification artifacts so success is objectively demonstrable.  

Once those are addressed, the approach is sound.

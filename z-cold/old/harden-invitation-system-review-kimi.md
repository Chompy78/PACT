Reviewer: Kimi k1.5 (Moonshot AI)

Review Date: 2026-08-09

Document Reviewed: `fix/harden-invitation-system` cold-review plan  

---

1. Executive Summary

This is a well-structured, security-conscious plan written by someone with strong Postgres RLS literacy. The threat model is correctly identified, the atomic-claim pattern is appropriately reused, and the "audit first, fix second" discipline is sound. However, the plan as written does not fully achieve its stated goal because it scopes the player-facing shared invite mechanism as "out of scope" despite the goal explicitly calling for a single unified model to replace both ad-hoc mechanisms. More critically, the document references a "fixed list of security properties" that is omitted from the text, making complete validation impossible. Finally, for a currently-live privilege-escalation bug, the absence of any immediate containment step is a significant gap.

Overall Disposition: Needs revision before implementation. Resolve the missing requirements list, reconcile the player-invite scope contradiction, and add an emergency mitigation step.

---

2. Question-by-Question Assessment

Q1: Does this plan actually achieve the stated goal if executed as written?
Partially — but with a major scope contradiction that prevents full achievement.

The goal states: "replace the app's two different ad-hoc invite-code mechanisms with one hardened, unified model." The plan correctly unifies the DM-invite path into the extended `campaign_invites` table. However, it explicitly scopes retiring the player-facing shared `invite_code` column as out of scope (Proposed Approach step 5 and Out of Scope section) and recommends leaving it in place. If executed exactly as written, the app would still have two coexisting invite mechanisms for players: the old shared reusable code and the new single-use token table. That is not a "unified model."

The plan does appear capable of closing the specific live DM privilege-escalation bug, but the unification goal is not met.

Q2: Are any of the "Verified" facts actually assumptions in disguise, or any "Assumed" items things that should have been verified before this plan was written?
The Verified section is largely credible. Two Assumed items should have been verified.

The Verified facts read as genuine file-inspection claims. The negative claim "No rate-limiting ... exists anywhere" is inherently hard to prove absolutely, but "none found by inspection" is an honest epistemic framing.

Two Assumed items, however, are prerequisites for safe implementation and should be resolved before this plan is approved rather than during implementation:

- Assumed #3 (UI pattern for player invite generation): Needed to design the DM Console affordance in step 6. Building UI without knowing the existing pattern risks inconsistency.
- Assumed #2 (row counts): Needed to size and schedule the migration in step 5. A table with 10 rows and one with 100,000 rows require different migration strategies.

Q3: Is there a better alternative to the proposed approach that this plan didn't consider?
Yes — three alternatives deserve explicit mention:

1. Immediate emergency hotfix: Because this is a live bug, the plan should include a stopgap (e.g., temporarily revoke `EXECUTE` on `join_as_dm` from the public role, or add an immediate `is_campaign_member` guard to the existing function) before the multi-step hardening begins. "Audit first, fix second" is good hygiene for latent bugs; for active privilege escalation, it leaves the window open.
2. Hashing tokens with no server-side storage of plaintext: Step 4 mentions "stored as a hash where practical" but treats it as optional. For a high-risk security fix, storing only hashed tokens (like passwords) should be the default, with explicit justification if plaintext storage is required. This alternative would limit the blast radius of a future database read leak.
3. Magic-link / URL-based delivery: The plan jumps from 6-character typeable codes to 128-bit hex strings without addressing UX. An alternative is URL-based redemption (`/join?token=...`) where the token never needs to be manually typed, sidestepping the usability regression of 32-character hex codes.

Q4: What's missing — a step, a risk, a file, a verification case?
Several significant omissions:

- The "fixed list of security properties" referenced in the Goal is entirely missing from the document. Without these requirements, reviewers cannot confirm the plan satisfies them.
- No immediate mitigation step for the live vulnerability (see Q3).
- No rollback plan for the migration in step 5.
- No notification/audit trail when a co-DM is added. Given the severity of the bug, campaign owners should be notified when elevation occurs.
- Token delivery UX is not addressed. How does a DM share a 128-bit hex token? Copy-paste? A URL? This affects both security and usability.
- Expiry duration and policy are unspecified.
- Collision handling for token generation is not discussed.
- No verification case explicitly asserting that the old `dm_invite_code` column itself (not just its selectability) is removed or nulled after migration.

Q5: Is the "Verification" section objectively checkable by someone who did the work, or is it vague enough that "I did it" could be claimed without real evidence?
Mostly checkable, but with gaps.

The adversarial test cases (concurrent redemption, generic error messages, campaign-ID override) are objectively checkable. The RLS-audit script and lint tool are deterministic.

However:
- "Manually re-derive ... that no authenticated non-DM role can select a DM invite secret" is manual and relies on human diligence. It should be supplemented with an automated assertion in the RLS-audit script.
- The verification section does not include a specific test for the old `dm_invite_code` column being non-selectable or removed, which was the original bug vector.

Q6: Should this plan split into more than one plan?
Yes — at minimum, the migration decision (step 5) and rate-limiting design (step 7) should be resolved in separate short RFCs before implementation proceeds.

The core security model change (steps 1–4, 6, 8) is coherent and can stay together. However:

- Step 5 (migration decision) is flagged as a "genuine, unresolved design call" that could cause a user-facing regression. This is significant enough to require its own decision record or RFC, approved by stakeholders, before engineers implement the migration SQL.
- Step 7 (rate limiting) is explicitly open-ended and may require new infrastructure. It should be a separate spike or design doc so that it doesn't block the security fix if platform-level rate limiting is already sufficient.

---

3. Findings

#	Finding	Severity	Confidence	
1	Missing security requirements list: The goal references "a fixed list of security properties (below)" that is not included in the document. The plan cannot be fully validated against unstated requirements.	blocking	high	
2	Scope contradicts goal on player invite unification: The goal mandates replacing both ad-hoc mechanisms with one unified model, but the plan explicitly leaves the player-facing shared `invite_code` in place and scopes its retirement as out-of-scope.	blocking	high	
3	No immediate emergency mitigation: For a currently-live privilege-escalation bug, the plan contains no stopgap (e.g., temporary function restriction or hotfix) to close the window during the audit and implementation period.	blocking	high	
4	Token delivery/usability not addressed: The plan proposes 128-bit hex tokens without explaining how DMs share them or how players enter them, representing an unacknowledged UX regression from 6-character codes.	moderate	high	
5	Rate-limiting requirements undefined: Step 7 is appropriately flagged as open, but without requirements (per-account? per-IP? per-campaign? thresholds?), it cannot be designed or verified.	moderate	high	
6	Hashing strategy is optional rather than default: Step 4 says "stored as a hash where practical," treating hashing as a nice-to-have. For high-risk tokens, the plan should default to hashing with explicit justification for any plaintext retention.	moderate	medium	
7	Missing audit/notification on elevation: There is no mention of logging DM promotions or notifying the campaign owner, which limits incident detection and response.	moderate	medium	
8	No rollback or transition grace period: The migration step lacks a rollback strategy or backwards-compatible redemption path during transition. If the migration fails or old codes are still in flight, there is no recovery path.	moderate	medium	
9	Two assumed items should be verified pre-approval: The UI pattern for existing player invites (Assumed #3) and live table row counts (Assumed #2) are needed to design steps 5 and 6 and should be resolved before the plan is approved.	moderate	medium	
10	Verification lacks automated check for old column cleanup: The manual re-derivation step is valuable but should be paired with an automated RLS-audit assertion that the old `dm_invite_code` column is non-selectable.	minor	medium	
11	Expiry policy unspecified: Step 4 says expiry will be enforced but never states the duration, configurability, or purge behavior for expired tokens.	minor	medium	
12	Token collision handling not mentioned: While 128-bit tokens have low collision probability, the generation logic should either guarantee uniqueness or explicitly document collision handling.	minor	low	

---

4. Detailed Analysis

Finding 1: Missing Security Requirements List (Blocking)
The very first sentence of the Goal references "a fixed list of security properties (below)." No such list appears anywhere in the document. This is not a cosmetic issue — it prevents the reviewer from confirming that the proposed unified model actually satisfies all required properties. For example, is "per-invite attribution" a requirement? Is "DM cannot read plaintext token after generation" a requirement? Is "invites must be revocable by any co-DM or only the owner?" Without the list, these questions cannot be answered.

Recommendation: Add the actual numbered security requirements to the document, or reference the exact file path where they live, before implementation begins.

Finding 2: Player Invite Scope Contradiction (Blocking)
The Goal and Proposed Approach are in tension. The Goal says unify both mechanisms. Step 5 says "The player-facing shared `invite_code` column is treated the same way for symmetry" but then immediately recommends leaving it as-is unless the audit finds a reason not to. The Out of Scope section doubles down on this.

If the project genuinely decides that retiring the player shared code is too large a behavior change, the goal should be edited to state that the unification applies to the DM invite mechanism only, with player unification as a follow-up. As written, the plan sets up a verification failure: a reviewer checking against the goal will correctly conclude the goal is not met.

Finding 3: No Emergency Mitigation (Blocking)
The document opens by calling this a "confirmed, currently-live privilege-escalation bug." The proposed approach begins with "Audit first, fix second." In normal secure-development lifecycle terms, this is correct. But for a live bug, there should be a parallel track: an immediate, minimal hotfix that raises the cost of exploitation while the full fix is built.

Examples of acceptable stopgaps:
- Temporarily add a membership check to the existing `join_as_dm` function so it only works for existing campaign members (closing the "any authenticated account" surface).
- Regenerate all `dm_invite_code` values immediately and notify DMs to re-share.
- Revoke `EXECUTE` on `join_as_dm` from the default role and grant it only to a new, empty role until the fix ships.

The plan should at least address why no stopgap is needed or why one is infeasible.

Finding 4: Token Delivery UX (Moderate)
Moving from 6-character alphanumeric codes to 128-bit hex strings (32 characters) is a major UX change. The plan does not address how a DM shares this token or how a player redeems it. If the redemption UI is a text box where players type codes, 32-character hex is error-prone. If it's a URL (`/join?token=...`), that's a different security model (tokens in browser history, referrer logs, etc.). This needs a design decision.

Finding 5: Rate Limiting Requirements (Moderate)
Step 7 correctly identifies rate limiting as an open question but provides no requirements. Is the concern brute-forcing the 2.1B code space? Or is it abuse of the redemption function? The answer determines whether you need per-IP, per-account, or per-campaign throttling, and what the thresholds should be. The plan should either include draft requirements or explicitly defer them to a separate spike — but not leave them entirely undefined.

Finding 6: Hashing Ambiguity (Moderate)
"Stored as a hash where practical" is too weak for a high-risk security fix. The security properties of hashed vs. plaintext storage are very different:
- Hashed: Database breach does not leak active tokens. DM cannot see token after generation (must copy at creation). Requires constant-time comparison.
- Plaintext: Database breach = immediate total compromise of all active invites. DM can re-read token anytime.

The plan should pick one and justify it. If hashing is impractical for some reason (e.g., need to support case-insensitive redemption), that tradeoff should be documented.

Finding 7: Missing Audit/Notification (Moderate)
When `join_as_dm` succeeds, the campaign owner currently has no signal that someone new has gained elevated access. Given that this bug may have already been exploited (Assumed #2 asks whether codes have been misused), adding an audit log and/or notification is a natural defense-in-depth measure. At minimum, an `campaign_audit_log` table entry or an email to the owner would help with incident response.

Finding 8: No Rollback Plan (Moderate)
The migration in step 5 involves creating new tokens and (presumably) removing the old column. If something goes wrong post-deployment, how does the team roll back? Is the old column kept temporarily and backfilled? Is there a feature flag? The plan should specify whether the migration is reversible.

---

5. Disposition

Criterion	Assessment	
Logic & reasoning	Strong. The atomic-claim pattern reuse, the column-grant narrowing, and the "necessary but not sufficient" analysis in step 3 are all sound.	
Scope	Too narrow in one critical place (player invites) and too broad in another (rate-limiting infrastructure, which is genuinely open-ended).	
Risk analysis	Honest about the migration decision and rate-limiting uncertainty. Understates the live-exploitation window by omitting emergency mitigation.	
Clarity	High. The document is well-structured and clearly written.	
Achievability	The core DM-invite hardening is achievable. The unification goal is not achieved as written.	

Recommendation: Revise and resubmit. Before implementation:

1. Add the missing security requirements list referenced in the goal.
2. Reconcile the goal and scope: Either commit to migrating the player shared code into the unified model, or edit the goal to state that unification applies to DM invites only.
3. Add an emergency mitigation step or explicit justification for why none is required for this live bug.
4. Resolve Assumed items #2 and #3 (row counts and existing UI pattern) and include the findings.
5. Produce a separate short RFC for step 5 (migration strategy) and step 7 (rate limiting) so they do not block the core security fix.

Once revised, this plan provides a solid foundation for a high-confidence security fix.
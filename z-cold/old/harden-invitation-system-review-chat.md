GPT-5.6 Luna — no special settings relevant to this review.

Cold-review verdict

The plan is directionally strong and identifies the real vulnerability correctly, but I would not approve it for implementation as written. The core security diagnosis is sound, and the decision to replace the reusable DM code rather than merely hide it is the right architectural direction. However, there are several places where the proposed unified model is underspecified enough that implementation could accidentally preserve an escalation path or introduce ambiguous authorisation semantics.

I would mark it “request changes before implementation”, primarily because the security invariants need to be made explicit before anyone writes the migration/functions.

1. The biggest issue: the plan does not define the exact authorisation invariant for DM redemption

The plan correctly says the current join_as_dm is globally callable, but the replacement still leaves an important question unanswered:

> Who is allowed to redeem a DM invite?



There are at least three materially different possible policies:

1. Any authenticated user can redeem a valid DM invitation.


2. Only an existing campaign member can redeem it.


3. Only a player in the target campaign can redeem it.



The current vulnerability is partly caused by #1, but the plan does not explicitly say whether #1 remains acceptable once the token is sufficiently strong.

This matters because the opening goal says:

> “lets an ordinary campaign member become a co-DM without authorization”



while the verified facts establish that any authenticated account can currently exploit a known/guessed code.

If the intended product behaviour is “a DM can invite an entirely new person to become a co-DM”, then requiring existing membership would break a legitimate workflow. If that is not intended, the new function should enforce membership.

Required change: explicitly define the redemption authorisation invariant, e.g.:

> A DM invite token authorises exactly one authenticated account to become a co-DM of the token's bound campaign, subject to token validity and whatever campaign-membership prerequisite the product intends. The caller-supplied campaign ID is never authoritative.



Without this, the most important security decision remains implicit.


---

2. “Unified model” is underspecified around type + mode

The proposed fields:

type

mode

count/limit fields


are sensible, but the plan doesn't define their allowed combinations.

For example:

Type	Mode	Meaning

player	single-use	one player
player	reusable	multiple players
dm	single-use	one co-DM
dm	reusable	multiple co-DMs


But should all four combinations be supported?

More importantly, what happens if someone creates:

type = dm
mode = reusable
max_redemptions = NULL

or:

type = player
mode = single_use
max_redemptions = 50

The database should enforce these invariants rather than trusting the RPC implementation.

Required change: define a constrained data model, preferably with database-level checks/enums, including:

permitted invite types;

permitted modes;

whether max_redemptions is mandatory for reusable invites;

whether it must equal 1 for single-use invites;

whether redeemed_count is authoritative;

whether a reusable invite can be revoked;

whether a revoked invite can ever be un-revoked;

what happens when the redemption limit is reached.



---

3. Reusable DM invites need much more careful concurrency semantics

The plan is very good on single-use concurrency:

> UPDATE ... WHERE redeemed_by IS NULL ... RETURNING



But that pattern does not automatically translate to reusable invites.

For a reusable invite, two simultaneous redemptions could both observe:

redeemed_count < max_redemptions

and both succeed when only one slot remains.

The plan says:

> “count/limit fields for reusable redemption”



but does not specify the atomic operation.

This is particularly important because the task is explicitly security-critical.

Required change: specify that reusable redemption must perform the validity check and redemption-count increment atomically in one database operation/transaction, with the relevant row locked or updated conditionally.

Conceptually:

UPDATE campaign_invites
SET redeemed_count = redeemed_count + 1
WHERE id = ...
  AND revoked_at IS NULL
  AND expires_at > now()
  AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
RETURNING ...

Then membership/co-DM creation needs to be transactionally coupled to that claim.


---

4. The plan needs to specify idempotency when the recipient is already a co-DM/player

This is an important missing behavioural rule.

Suppose a reusable DM invitation is redeemed by someone who is already a co-DM.

Does that:

succeed but consume a redemption?

succeed without consuming one?

fail?

return a generic “invalid invite”?

return “already a member”?


The same question applies to a player invite.

This matters because redeemed_count represents actual consumption. If an already-authorised member can repeatedly redeem a reusable token and consume capacity, that's potentially an abuse vector.

Required change: define membership/idempotency semantics before implementation.

I would make this an explicit invariant:

> A redemption either creates the authorised membership transition and consumes one redemption, or makes no state change.



That keeps the accounting meaningful.


---

5. Token hashing is mentioned but not actually designed

The plan says:

> “128-bit random tokens, stored as a hash where practical”



That wording is too tentative for security-critical work.

If tokens are bearer credentials, the database ideally shouldn't contain the plaintext bearer secret after creation. The client needs the plaintext exactly once so it can share it, while the database stores a cryptographic digest.

The plan needs to establish:

token generation;

token encoding;

hash algorithm;

whether a salt/pepper is used;

whether lookup is by hash;

whether plaintext is ever persisted;

whether the token appears in logs/errors;

whether token values are displayed again after creation.


Also, 128 bits is adequate for an unguessable bearer token, but the plan should distinguish this from the old 6-character code. The security improvement isn't merely “longer”; it is high-entropy, server-bound, expiry/revocation controlled, and non-readable by ordinary members.


---

6. The migration strategy is too unresolved to safely implement

This is the most significant product-level gap.

The plan correctly recognises that migration is a genuine decision, but the reviewer shouldn't leave implementation with this unresolved.

There are actually two separate migrations:

1. dm_invite_code


2. invite_code



The plan says the DM code should be replaced, while the player code should probably remain.

For the DM side, I would strongly favour:

> Do not migrate the old 6-character secret as a bearer credential. Generate a new high-entropy token.



If the old code is already potentially compromised, preserving it inside a new token record doesn't fix the exposure.

If backwards compatibility requires existing DMs to continue using their old shared code, then there should be an explicit transitional mechanism with a short, documented sunset period—not simply transplanting the old secret into the new model.

At minimum, the plan needs to state:

whether old dm_invite_code values are immediately invalidated;

whether new DM tokens are generated automatically;

whether existing DMs must copy a new invitation;

whether old links/codes continue working temporarily;

how long the compatibility period lasts;

when the old column/function is removed.



---

7. The plan conflates “hide the secret” with “no non-DM can obtain it”

The verification criterion says:

> “no authenticated non-DM role can select a DM invite secret from any table”



That's good, but it should go further.

A security review should establish no alternate disclosure path, including:

direct SELECT;

RPC returning the token;

campaign-management RPC;

error messages;

logs;

views;

functions with overly broad return types;

client-side campaign objects;

old regenerate_dm_invite_code;

old join_as_dm.


The phrase “in any form” appears in the adversarial test, but the implementation plan should explicitly require removal/locking down of the old functions, not merely the old column.

For example, if regenerate_dm_invite_code remains callable by a non-DM due to an overlooked grant, the new model can still be undermined.


---

8. The old join_as_dm must be explicitly retired or made impossible to exploit

This deserves its own requirement.

The plan says:

> “Replace the DM invite-code primitive itself”



but doesn't explicitly say:

revoke EXECUTE on old join_as_dm;

remove/replace the function;

remove its underlying ability to inspect campaigns.dm_invite_code;

ensure there isn't another RPC still invoking it.


This is exactly the sort of security regression that could happen during a migration: the new path is secure but the old RPC remains callable.

Required change: add an explicit invariant:

> After migration, no executable database function exposed to the browser can grant co-DM status from dm_invite_code, and the old join_as_dm path is either removed or rendered permanently unusable.



Same applies to regenerate_dm_invite_code.


---

9. Rate limiting needs a more precise threat model

The plan is right to call this out, but “rate limiting” isn't quite enough.

Once the secret becomes a 128-bit random token, brute-forcing the token becomes effectively infeasible. The primary value of rate limiting is therefore less about making the token cryptographically unguessable and more about:

abuse;

denial-of-service;

database load;

enumeration/error probing;

protection against future weaker credentials;

operational controls.


The plan should therefore distinguish:

Credential security → high entropy + hashing + expiry + revocation.

Abuse protection → rate limiting.

If platform-level controls are sufficient, great. But they need to be verified specifically for the database RPC endpoint, as the plan already recognises.


---

10. Generic errors are good, but the plan should specify the boundary

The requirement:

> “generic error that does not distinguish ‘expired’ from ‘revoked’ from ‘never existed’”



is excellent.

However, the function shouldn't necessarily hide every possible distinction.

For example, there is a legitimate distinction between:

malformed input;

unauthenticated caller;

invalid/expired/revoked token;

valid token but insufficient campaign membership;

successful redemption.


The plan should define which information is intentionally suppressed.

Otherwise developers may implement either:

overly informative errors that leak token validity, or

an unhelpful catch-all that makes legitimate client handling difficult.



---

11. The audit-first step is good, but needs a defined deliverable

“Systematically re-check every existing database function, row-policy, and column-grant” is exactly the right instinct.

But as written it could become an open-ended security review.

I'd require a concrete output:

> Produce an inventory of every function/table/policy/grant in scope, with each privileged operation mapped to its caller authorisation, data visibility, and mutation capability. Record findings before implementation.



That makes the audit reproducible and prevents the implementation from proceeding based on an informal read-through.


---

12. The verification suite is strong but missing a critical negative test

You have:

> “a client-supplied campaign identifier cannot override the campaign a token is actually bound to server-side.”



Excellent.

Add the inverse attack:

> A valid token for Campaign A cannot be used to create membership/co-DM status in Campaign B, even when the caller supplies Campaign B's identifier.



And also:

> A token whose type is player cannot be coerced into DM membership by manipulating client-supplied parameters.



The second one is particularly important because the unified table introduces type as a new security boundary.


---

What I would change before implementation

I would add a short section immediately after Proposed approach called something like Security invariants.

Something along these lines:

Security invariants

The implementation must preserve these invariants at the database level; client-side checks are never considered authorisation:

1. Invite secrets are bearer credentials. Plaintext invite tokens are never readable through ordinary table queries by campaign members or other non-DM users. Stored invite credentials are cryptographically hashed where practical.

2. Token identity is server-authoritative. A redemption is determined solely from the presented token and the server-side invite row. A caller-supplied campaign ID, invite type, mode, redemption limit, or other metadata cannot alter what the token authorises.

3. Invite scope is immutable. Every invite is permanently bound to exactly one campaign and one invite type ("player" or "dm"). A player invite can never be used to obtain DM privileges, and a DM invite can never be redeemed through the player-invite path.

4. Privilege is granted only by a SECURITY DEFINER function. No browser-accessible role can directly insert or update campaign membership or co-DM state.

5. Single-use redemption is atomic. A single-use invite can produce at most one successful redemption, including under concurrent requests.

6. Reusable redemption is atomic. A reusable invite cannot exceed its configured redemption limit, including under concurrent requests. The redemption count and resulting membership change are transactionally consistent.

7. Validity is enforced server-side. Revocation and expiry are checked during redemption, not merely when an invite is displayed or listed.

8. Invalid bearer credentials are indistinguishable. Redemption of a nonexistent, expired, revoked, exhausted, or otherwise invalid token returns the same externally observable invalid-invite result and does not reveal which condition applied.

9. Old DM-code redemption is impossible. After migration, no browser-callable function can grant co-DM status from "dm_invite_code", and the old "join_as_dm" / "regenerate_dm_invite_code" paths are revoked or removed.

10. Membership semantics are explicit. The redemption behaviour when the caller is already a player, already a co-DM, or already the campaign owner is defined before implementation, including whether a redemption is consumed.

11. Migration never preserves a potentially compromised DM secret. Existing six-character DM codes are not copied into the new bearer-token credential store. Migration either generates fresh credentials or uses an explicitly time-limited compatibility mechanism approved in the decision log.

12. Authorisation semantics are explicit. The implementation records whether a DM invite may be redeemed by any authenticated account or requires existing campaign membership. This is a product/security decision and must not be inferred by the implementation.That would substantially strengthen the plan.

One architectural point I would reconsider

I would not necessarily make DM invites reusable by default merely to preserve the old behaviour.

The old six-character code being reusable forever is an implementation characteristic, not necessarily a product requirement.

A stronger model would be:

single-use DM invites by default;

optional reusable DM invitations only if there is a demonstrated workflow requiring them;

explicit maximum redemption count for reusable invites;

expiry and revocation for both.


If the product genuinely needs “send this same DM invitation to several people”, reusable invites can absolutely be supported. But they should be treated as a separate capability with deliberate limits rather than as the default migration target.


---

Overall assessment

Area	Assessment

Identifies root vulnerability	Strong
Recognition that column hiding alone is insufficient	Excellent
Reuse of existing hardened invite infrastructure	Strong
RLS/grant awareness	Strong
Migration awareness	Strong, but unresolved
Concurrency thinking	Strong for single-use; incomplete for reusable
Token security specification	Incomplete
Authorisation semantics	Incomplete / critical
Legacy-function retirement	Needs explicit requirement
Verification strategy	Very strong, with a few missing adversarial cases
Scope control	Good
Implementation readiness	Not yet


Bottom line

The plan has the right architecture and correctly identifies that the vulnerability cannot be fixed merely by hiding dm_invite_code. The strongest part is the decision to move the privilege-bearing credential onto the existing, already-hardened invite infrastructure.

Before implementation, however, I would require the plan to lock down four things:

1. exact DM-redemption authorisation semantics;


2. atomic semantics for reusable invites;


3. complete retirement of the legacy DM-code/RPC path;


4. explicit token/data-model invariants and migration behaviour.



Once those are resolved, I would consider the plan substantially stronger and suitable for handing to Claude Code for implementation.
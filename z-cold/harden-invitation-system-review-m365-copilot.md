M365 Copilot (GPT-5 family)

# Review: Harden Invitation System Plan

## Executive Summary

The plan is generally strong, internally consistent, and addresses the primary security issue identified in the document: a privilege-escalation path that allows unauthorised acquisition of co-DM privileges. The proposal correctly recognises that hiding the existing `dm_invite_code` is necessary but insufficient, and that the vulnerable security boundary is the redemption mechanism, not merely code visibility.

The plan would likely achieve its stated goal if implemented as written. However, there are several areas where the plan either leaves significant design choices unresolved or lacks verification steps that would provide stronger assurance that the vulnerability class has been fully eliminated.

## 1. Does this plan actually achieve the stated goal if executed as written?

### Answer

**Mostly yes.**

The plan addresses all three major contributors described in the Verified section:

1. Sensitive invite information is currently visible to ordinary members.
2. DM redemption is authorised solely by possession of a low-entropy reusable code.
3. DM invites lack expiry, auditing, revocation granularity, and abuse controls.

The proposed approach:

- Removes exposure of DM invite secrets through ordinary reads.
- Replaces permanent reusable low-entropy DM invite codes with high-entropy tokens.
- Moves DM and player invitation flows onto a common, hardened model.
- Adds revocation and expiry enforcement.
- Introduces verification and regression coverage.

If all proposed steps are executed correctly, the described escalation path should be eliminated.

### Finding 1

**The plan's success depends on an unresolved migration decision that directly affects security and compatibility.**

**Severity:** Moderate  
**Confidence:** High

## 2. Are any of the Verified facts actually assumptions in disguise?

Most Verified items appear appropriately categorised.

### Finding 2

**Infrastructure-level rate limiting should ideally be verified before committing to solution architecture.**

**Severity:** Moderate  
**Confidence:** High

### Finding 3

**Existing DM invite usage patterns should ideally be investigated before choosing migration behaviour.**

**Severity:** Minor  
**Confidence:** Medium

## 3. Is there a better alternative?

### Finding 4

**A hashed-token-only storage model should be explicitly evaluated.**

**Severity:** Minor  
**Confidence:** Medium

## 4. What's missing?

### Finding 5

**No explicit rollback strategy is documented.**

**Severity:** Moderate  
**Confidence:** High

### Finding 6

**No verification explicitly covers stale clients.**

**Severity:** Minor  
**Confidence:** Medium

### Finding 7

**No verification explicitly tests privilege removal after invite revocation.**

**Severity:** Minor  
**Confidence:** Medium

### Finding 8

**No explicit auditability requirement is stated after migration.**

**Severity:** Minor  
**Confidence:** Medium

## 5. Is the Verification section objectively checkable?

### Finding 9

**Manual policy review should be backed by automated assertions.**

**Severity:** Minor  
**Confidence:** High

## 6. Should this plan split into more than one plan?

### Finding 10

**The migration strategy deserves its own design decision record before implementation proceeds.**

**Severity:** Moderate  
**Confidence:** High

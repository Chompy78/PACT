# PACT engine.js — Comprehensive Review Request (Repository-Aware Version)

I'd like a comprehensive review of the `js/engine.js` file from my PACT tabletop RPG toolkit.

This is the single-source-of-truth rules engine that three browser tools (CharGen, Live Sheet, DM Console) import as an ES module.

---

## About PACT (context you need)

PACT (Points · Aptitudes · Coin · Time) is a points-buy advancement system layered on D&D 2024.

Characters earn Advancement Points (AP) and buy abilities one at a time from escalating price ladders.

Two golden rules:

1. Nothing is free.
2. Prices are read **before the increase** (the Nth purchase reads its cost before N is incremented).

The engine is a browser-native ES module:

- No Node APIs
- No bundler
- No build step
- Tools open directly via `file://`

Exports include:

- `DATA`
- `compute()`
- `MUT`
- `baseBuild()`
- `foldBuild()`
- `economy()`
- Replay helpers
- Validation helpers
- Tamper-evident save-file helpers

Current version:

```js
DATA.version = "v0.336"
```

File size:

```text
~237 KB
```

(mostly a large DATA blob)

---

# Ground Rules For This Review

These rules exist because previous reviews incorrectly reported intentional behavior as defects.

Failure to follow these rules is considered a review error.

## 1. Check Existing Rationale Before Calling Anything A Bug

This codebase contains many deliberate, non-obvious design decisions documented in:

- DECISIONS.md
- AGENTS.md
- CHANGELOG.md
- Inline code comments

Many comments reference decision IDs:

```text
D-GH1
D-GH14
D-GH31
D-GH34
...
```

Before creating a finding:

### If you encounter:

- a D-GH reference
- a guide citation
- an explicit rationale comment

You MUST:

1. Locate the supporting documentation.
2. Read it.
3. Verify whether the behavior is intentional.

If a documented rationale exists, either:

### Accept It

and drop the finding

OR

### Challenge It

but explicitly explain:

```text
I found the rationale.

I disagree because...
```

Do not present:

```text
intentional behavior
```

as

```text
a bug
```

without explaining why the documented decision itself is flawed.

Every finding must state one of:

```text
Checked DECISIONS.md — no existing rationale found.
```

or

```text
Reviewed D-GHxx — finding conflicts with documented intent because...
```

---

## 2. Cite Exact Code Quotes

Do not paraphrase.

Every finding must include:

- file
- line number
- direct code quote

Example:

```js
const spendable = ...
```

Then re-read that quote before finalizing the finding.

If you cannot quote it directly:

Do not write the finding.

---

## 3. Confidence Caps Severity

Severity and confidence are separate.

Every finding must be assigned exactly one confidence level:

### CONFIRMED

You traced the actual code path and verified it.

### PLAUSIBLE

You observed a pattern but did not fully verify it.

### REQUIRES DECISION REVIEW

Behavior exists but may be intentional.

### RETRACTED

Finding was incorrect.

---

### Maximum Allowed Severity

| Confidence | Highest Severity |
|------------|-----------------|
| CONFIRMED | 🔴 Critical |
| PLAUSIBLE | 🟡 Major |
| REQUIRES DECISION REVIEW | 🟢 Minor |
| RETRACTED | None |

A finding cannot be:

```text
🔴 Critical
```

while also saying:

```text
appears to
likely
requires verification
may be
```

---

## 4. Deduplicate Findings

Merge findings by root cause.

Do not count:

```text
same mechanism
```

multiple times under different headings.

Example:

```text
Ledger-vs-compute mismatch
```

and

```text
Race-trait repricing caused by ledger-vs-compute mismatch
```

should generally be one finding.

---

## 5. Adversarial Self-Check

Before finalizing any:

- 🔴 Critical
- 🟡 Major

actively try to prove it wrong.

Ask:

- Is this intentional?
- Is it already documented?
- Is it already tracked?
- Is it handled elsewhere?
- Did I inspect the full code path?
- Did I verify the real source rather than a snippet?

State the result.

---

# How To Provide Feedback On This Review

If a finding is challenged later:

Do not automatically defend it.

Re-evaluate it.

---

## Step 1 — Re-check Source Material

Before responding:

Read again:

- exact code lines
- DECISIONS.md
- AGENTS.md
- CHANGELOG.md
- relevant fixtures/tests

Do not rely on memory.

---

## Step 2 — Reclassify The Finding

Every challenged finding must be reclassified as:

### CONFIRMED

Still correct after verification.

### REFRAMED

The behavior exists but is intentional and documented.

Explain:

- why it was originally flagged
- what rationale was found
- whether any legitimate design concern remains

### RETRACTED

The finding was incorrect.

Examples:

- misread code
- extraction artifact
- already handled elsewhere
- missed context
- incorrect assumption

Use the exact phrase:

```text
RETRACTED — reviewer error.
```

when appropriate.

---

## Step 3 — Separate Bugs From Design Disagreements

If DECISIONS.md documents the behavior:

Do not automatically call it a bug.

Use:

```text
Design concern
```

or

```text
Decision challenge
```

instead.

Example:

```text
D-GH31 intentionally permits X.

This review disagrees because Y.
```

That is different from:

```text
X is broken.
```

---

## Step 4 — Re-score Severity

Severity is assigned after verification.

Not before.

No unverified finding may be:

```text
Priority 1
```

or

```text
Critical
```

---

## Step 5 — Adversarial Verification Pass

For every Critical or Major finding:

Try to refute it.

Specifically check:

- incorrect assumptions
- missing context
- design intent
- existing fixes
- test coverage
- consumer responsibilities

Document the verification attempt.

---

## Step 6 — Report Review Quality Metrics

At the end include:

```text
Review Quality Summary

Total findings: X

CONFIRMED: X
PLAUSIBLE: X
REQUIRES DECISION REVIEW: X
RETRACTED DURING REVIEW: X

Checked against DECISIONS.md: X
Checked against AGENTS.md: X
Checked against CHANGELOG.md: X

Overall confidence:
High / Medium / Low
```

The objective is:

```text
maximize correctness
```

not

```text
maximize findings
```

Three correct findings are better than twenty speculative ones.

---

# What I Want Reviewed

## 1. Correctness

- Does `compute()` correctly implement the PACT ladders?
  - Gentle
  - Steady
  - Steep
  - Extreme
  - Premium

- Are origin discounts and cross-class surcharges consistently applied?

- Do tier gates (T1–T7) fire at the correct HD thresholds?

- Does the "prices freeze at purchase" invariant hold?

- If it does NOT hold:
  - is that intentional?
  - is it documented?
  - or is it a bug?

- Are racial trait pricing edge cases implemented correctly against documented intent?

---

## 2. Replay Logic

Review:

```js
_replay()
```

Specifically:

- `_locked`
- `_spent`
- `_campaignBound`

Evaluate:

- drawback economics
- buyoff handling
- creation locking
- noLock behavior

---

## 3. Engine / Consumer Coherence

- DATA export completeness
- consumer workarounds
- hand-mirrored structures
- RULE_BAN_FIELDS alignment

---

## 4. Performance

Evaluate:

- repeated compute calls
- foldBuild frequency
- memoisation opportunities
- DATA blob structure

---

## 5. Safety / Robustness

Review:

```js
SIG_ALG
signPayload
verifyPayload
validate()
```

Question:

```text
Does it do what it claims?
```

not

```text
Is it theoretically perfect crypto?
```

---

## 6. Maintainability

Evaluate:

- MUT consistency
- architecture risks
- likely bug introduction areas

---

## 7. Suggested Improvements

Provide:

- single highest-leverage refactor
- deprecated/vestigial code
- inferred test coverage gaps

---

# What I Will Provide

These files are NOT optional context.

Failure to read them before producing findings is considered a review error.

Required:

- DECISIONS.md
- AGENTS.md
- CHANGELOG.md
- js/engine.js

Optional:

- ap-by-level.js
- campaign.js
- consumer HTML files
- parity tests
- expected fixture outputs
- Player Guide
- design docs

---

# Preferred Review Output Format

## Executive Summary

3–5 paragraph overview.

---

## Findings

Grouped by:

### 🔴 Critical

### 🟡 Major

### 🟢 Minor

### 🔵 Nitpick

Each finding must include:

- Confidence
- File
- Line number
- Code quote
- Explanation
- Why it matters
- Documentation reviewed
- Adversarial verification result
- Suggested fix

---

## Priority Fix List

CONFIRMED findings only.

---

## Needs Verification List

PLAUSIBLE findings only.

---

## Review Quality Summary

Required.

---

# Before You Start

Tell me:

1. Which upload format works best.
2. Whether you want companion files immediately.
3. Any additional repository context that would materially improve review quality.

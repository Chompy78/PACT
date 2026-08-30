> Triaged in session: docs/sessions/2026-08-30-creation-ceiling-and-cold-review-backlog.md, 2026-08-30
> Reviewer: Claude Sonnet 5 (claude-sonnet-5), reasoning effort medium — run as an in-session cold subagent
> Plan reviewed: docs/plans/2026-08-30-creation-ceiling.md
> Method: single-file read of the plan only; no repo exploration, no code verification (enforced by prompt).

# Cold review — creation ceiling (Claude Sonnet 5)

## Summary of severities

| # | Finding | Severity | Confidence |
|---|---|---|---|
| 1 | Done-when #1 vs Step 2/8 scope ambiguity | minor | medium |
| 2 | Frozen ceiling creates silent AP-starvation state; mitigation is passive-only | major | high |
| 2b | Freezing at set-time maximizes trap exposure for the population the feature targets | major | medium |
| 3 | Hybrid "live-until-manually-frozen" alternative not considered | moderate | medium |
| 4 | No active notification mechanism; LOG-edit-vs-frozen-`spent` interaction unchecked | moderate–major | medium |
| 5 | (a) recommended, conditioned on verifying "only Amble is real" | — | high/medium |
| 6 | Dedicated single-purpose RPC alternative not considered vs. widening | moderate | medium |
| 7 | "Honest limits" underclaims the usability-stall risk specifically | major | medium |
| 8 | Verification mostly objective; two soft/manual items | minor | high |
| 9 | Step 0 should be its own fix branch, not bundled | minor | medium |

## 1. Does this plan achieve its stated goal?

Mostly yes, on its own terms. Steps 1–4 directly implement the narrow goal. One gap: **Done when #1**
("No code path writes `creationLocked` except an explicit user action") is stronger than Step 2 describes.
Step 8's bulk stamping of six characters is itself a non-interactive write of ceiling state — arguably
fine, but the plan should have drawn that line explicitly. *(minor, medium)*

## 2. Shakiest assumptions

**The frozen snapshot is a usability trap dressed as a feature.** Walk the play scenario: a DM mid-session
awards 5 AP. The player is still nominally "in creation" because nothing forces the button at any
particular time. That AP is now unspendable until the player performs an unprompted administrative action
whose trigger condition ("you are now stuck") is exactly the failure mode the plan set out to eliminate for
the old mechanism. **The plan converted an invisible auto-lock into an invisible auto-stall**: previously
"you didn't know you got locked", now "you don't know you're capped and your new AP is inert".

The plan conflates two problems — (a) "when did creation pricing end", legitimately ambiguous and
non-derivable; and (b) "why can't I spend the AP the DM just gave me", a raw blocking question, not a
pricing nuance. Problem (b) has no mitigation beyond Step 5's passive display. A passive label is not an
active nudge; there is no notification and no DM-side visibility at the moment of the stall (Step 7's check
is DM-Console-only). Risks names this ("A frozen ceiling surprises a DM…") and does nothing about it.
*(major, high)*

Second: freezing at exactly the moment it is set **maximizes** the odds of hitting that trap for exactly
the population the feature is meant to help — players still receiving DM AP during creation. The plan
treats this as settled by owner fiat rather than argued through. *(major, medium)*

## 3. Better alternative?

The plan frames this as binary (frozen vs fully live) when a middle path exists and isn't discussed: **a
ceiling that stays live until someone deliberately freezes it.** Invert who initiates. This still gives an
explicit, auditable trigger — satisfying the plan's core insight, no accidental crossing — without ever
producing a state where already-awarded AP sits inert. Worth at least a rejection paragraph.
*(moderate, medium)*

## 4. What is missing?

- **No proactive notification** for the "unspendable AP" state.
- **LOG-editing-in-place vs the frozen ceiling is unchecked.** The plan rejects the live-ceiling design
  *because* "the LOG is edited in place for earlier choices". If a player retroactively edits an earlier
  purchase after the snapshot, does `spent` move relative to a frozen `base`? This is the exact bug class
  the plan spent two paragraphs establishing as dangerous, and it isn't re-checked against the new
  mechanism.
- No mention of what Step 4's confirm dialog does on cancel.
- **No concurrent/multi-session write handling** — Step 7 covers DM-vs-player precedence but not a DM
  setting the ceiling from two devices, or `threshold` and `auto` being touched near-simultaneously.
- **Campaign movement flagged but explicitly left unresolved** — shipping without resolving a risk three
  separate reviewers already raised on the predecessor.
- **No rollback plan.**

## 5. Decision point — recommendation: (a)

**Case for (a):** keeping auto-lock as a "legacy path" doesn't remove the bug, it makes it opt-in-by-default
for existing data while both code paths coexist — the codebase must then reason about two lock-arming
mechanisms indefinitely, doubling the surface for exactly the `_lockStates()` edge cases the plan documents
a history of. A legacy path for a mechanism the plan calls a trap is not a neutral hedge.

**Case for (b):** only real if there is untested exposure the plan hasn't verified — and the plan's own
split marks "only Amble is real" as *assumed*, not verified.

**Recommendation: (a)**, conditioned on verifying that assumption with a live DB check rather than owner
say-so, since it is the sole thing standing between "bounded 3-fixture cost" and "unknown blast radius".

## 6. RPC allowlist

Widening by exactly one field with an explicit exclusion list and a mandated advisor re-run is better
practice than most ad hoc RPC changes. But **a dedicated `dm_set_creation_ceiling()` RPC** is a real
alternative the plan neither picks nor rejects. Every field folded into a shared allowlist is a permanent
tax on auditing that function forever; a separate RPC pays a one-time cost and never needs revisiting.
*(moderate, medium)*

## 7. "Honest limits" — underclaims by omission

It does not overclaim; it is unusually candid, and downgrading "DM-authoritative" to "DM-set,
client-honoured" is a genuine strength. But on the question posed it **underclaims**: it frames "never
finishing" purely as a *pricing* non-issue, without confronting that this is the same scenario where newly
awarded AP goes invisible with no forcing function to notice. The section defends the pricing side of the
question and never answers the usability side. *(major, medium)*

Direct answer: **yes, worth building — but only if Step 5's passive display becomes an active
acknowledgment at the moment of DM award.** As specified, it risks being a ceiling players fall into and
don't climb out of, reproducing the psychological shape of the bug this plan exists to fix — moved from
"accidentally locked" to "accidentally stalled".

## 8. Verification

One of the plan's stronger sections. "Expected delta is confined to Moss's and Skylar's gold/downtime on
five purchases; anything else is a regression" is a genuinely falsifiable acceptance criterion. Two softer
items: migration rejection isn't specified as to *how* it's verified, and the manual UI step depends on
human judgment of copy adequacy. *(minor, high)*

## 9. Split?

**Yes, partially.** Step 0 is a standalone bugfix with zero dependency on the ceiling — it could ship
today and would reduce the ceiling PR's size and risk. Per the project's own one-task-per-branch
discipline, it "looks like a `fix/` branch masquerading as a prerequisite". Steps 1–8 hang together and
shouldn't be split further. *(minor, medium)*

## Closing

The plan is well-structured, unusually well-evidenced (live replay table, explicit verified-vs-assumed
split, named risks citing prior bugs), and honest about its limits — but its central, owner-mandated design
choice has a usability failure mode that the plan names and does not mitigate beyond a passive display
line, and that gap is exactly what Q2 and Q7 were pointed at.

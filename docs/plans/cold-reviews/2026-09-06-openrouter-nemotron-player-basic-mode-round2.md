Reviewer: OpenRouter API, model `nvidia/nemotron-3-super-120b-a12b:free` (free tier), requested via the
properly-invoked `cold-review-api-universal-jc` skill (fell back to this model automatically after the
first-choice `z-ai/glm-5.2:free` hit a 429 — the skill's model-list fallback working exactly as
designed). Self-identification failure mode #4 for this session: an explicit placeholder line ("We are a
language model (version unknown) running via a direct API call") rather than a wrong name or silent
omission — still a failure to follow the reviewer instructions' first line, just a different shape of
failure.

**Verification note, per this project's cold-review process.** Checked every claim against the plan's
current text.

**Rejected, not new (already flagged in the plan's own Review-outcome section, and the review itself
says so):** the "exactly ONE insert path" over-claim (point 2) — this reviewer explicitly notes the
plan's own text already flags this, same as its first-round counterpart did.

**Rejected, not new:** "no alternative considered" (point 3) — the plan's "Alternatives considered"
section already covers every option this reviewer names (RLS-only enforcement, client-side-only, numeric
limit, partial unique index, SECURITY DEFINER wrapper, ERRCODE-based exception).

**Rejected, not new:** "split into two plans" (point 5) — same answer as round 5 from the same model,
same reasoning (the authority question already has its own decision record).

**Accepted, genuinely new:** point 4 — the "Done when" list had no objective test for a *direct database*
bypass attempt (as opposed to going through either tool's UI), even though "cannot be bypassed by calling
the database directly" is the core claim the whole feature rests on. Folded into "Done when" as an
explicit raw-SQL bypass-attempt check.

---

```markdown
player-basic-mode-review-generic.md
We are a language model (version unknown) running via a direct API call.

1. Does this plan actually achieve its stated goal?
   Yes. The revised enforcement mechanism (broadened trigger covering INSERT and UPDATE of archived_at
   with explicit locking) prevents both the archive/create/un-archive bypass and race conditions. The
   trigger checks the flag via the player-accounts table and blocks writes that would exceed one active
   character when the flag is set. It enforces independently of application logic (belt-and-suspenders)
   and cannot be bypassed by direct database calls since it fires at the database level.

2. Are any of its "Verified" claims suspicious — internally inconsistent, or asserted with more
   confidence than the plan's own evidence supports?
   Yes. The claim "There is exactly ONE code path in the whole app where a genuinely new character row
   gets inserted into the cloud database" is overly strong. The plan states this was verified by checking
   "the two player-facing tools" but does not mention verifying the DM Console or other potential
   insertion paths. Given the plan's own later note in the Review-outcome section that this claim "is
   stronger than its own cited evidence," this assertion exceeds the evidence provided.

3. Is there a better alternative to the proposed approach that the plan didn't consider?
   No. The plan thoroughly considered alternatives including RLS policy enforcement, client-side-only
   checks, numeric limits, cross-table partial unique indexes (rejected due to Postgres predicate
   constraints), SECURITY DEFINER wrappers, and error-code-based exceptions. The two enforcement options
   (a) lock-guarded broadened trigger and (b) denormalized flag with partial unique index were both
   evaluated, with (a) selected as the initial implementation. No superior alternative is omitted from
   consideration.

4. What's missing — an edge case, a failure mode, a piece of the "Done when" list that isn't actually
   objectively checkable?
   The "Done when" list lacks an explicit verification step for direct database bypass testing. While the
   goal requires enforcement "so it cannot be bypassed by calling the database directly," the
   verification section only covers application-layer checks (friendly messages in tools, concurrent
   creation attempts, mid-session flag flips). There is no objective test listed for connecting directly
   to the database and attempting to insert/update a second active character for a flagged player to
   confirm blocking occurs. This is critical for validating the core "cannot be bypassed" requirement.

5. Should this be split into more than one plan (e.g., is the "who can set this flag" question big
   enough that it should be resolved as its own decision before any code plan is written at all)?
   No. The plan correctly separated the authority/reversibility question into a prior decision record
   (decisions/2026/D-GH-2026-09-05-player-basic-mode.md), which resolved who may set/unset the flag and
   recorded setter metadata. The current plan focuses purely on implementation against that resolved
   authority model, making further splitting unnecessary. The remaining open questions (configurable
   limit, local-only characters) are documented as future extensions or out-of-scope considerations, not
   blockers requiring separate planning.
```

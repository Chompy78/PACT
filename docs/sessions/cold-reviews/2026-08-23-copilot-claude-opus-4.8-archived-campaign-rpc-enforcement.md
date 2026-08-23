> Triaged in session: https://claude.ai/code/session_01JukBACD4cFriAwSNcmWvQQ, 2026-08-23
> Reviewer: Microsoft Copilot (Claude Opus 4.8 base)
> Plan reviewed: docs/plans/2026-08-22-archived-campaign-rpc-enforcement-cold-review.md

# Cold plan review — Archived-campaign write-lockdown (server-side enforcement)

**Reviewer:** Microsoft Copilot (Claude Opus 4.8 base), default settings
**Mode:** Document-only review. No repository access. The "Verified vs. Assumed" split is taken at
face value; critique is aimed at the *reasoning, scope, clarity and risk framing*, not at re-checking
the SQL against a tree I cannot see.

**One-line verdict:** Structurally sound, unusually honest about its own epistemics, and correctly
scoped — but it ships a **fail-open guard** where a fail-closed one costs the same, **duplicates the very
predicate it argues for centralising**, and **under-specifies the execute-grants on its two new
functions**, which is precisely the class of drift the plan itself names as its top historical risk. Fix
those three before merge; everything else is polish.

---

## Answers to the six required questions

### 1. Does this plan achieve its stated goal?

**Conditionally yes — and the plan is honest about the condition.**

The stated goal is that *every* DM-write path mutating campaign settings or a bound character's state
rejects the write server-side when archived. The plan delivers a mechanism (one guard + five RPC call
sites + one tightened RLS policy) that would lock the **six enumerated paths**. If the inventory is
complete, the goal is met.

But "every write path" is only ever as good as the enumeration, and the enumeration rests on a
**grep, not an exhaustive manual read** — which the plan correctly flags in its "Assumed" section. So the
plan achieves *"lock these six"* with high confidence and *"lock everything"* with grep-bounded
confidence. That's the right way to frame it, but it means the **goal is not self-certifying**: the
re-grep-before-writing step (mentioned once, in passing) is load-bearing and should be promoted from a
parenthetical into an explicit pre-merge gate, because if it's skipped the plan can be fully "done" per
its own checklist while silently missing a seventh path.

One structural gap in the goal-coverage argument (see Q4): the plan enumerates **RPC** mutation paths and
**one** direct-column RLS path, but never explicitly rules out a *direct table-write RLS path* into the
character/ledger/awards tables. Its implicit assumption is "all character-state mutation flows through the
five SECURITY DEFINER RPCs." That assumption is doing real work and isn't listed among the flagged
assumptions.

### 2. Are any "Verified" facts actually shaky, or better described as assumptions?

Three points.

- **"Two of those five names don't exist as RPCs at all" is verification-by-absence, resting on the same
  grep the plan elsewhere labels *assumed*.** Presence of a function is directly observable; *absence* is
  only as strong as the search that failed to find it (an oddly-named, schema-qualified, or
  dynamically-created function can be missed). This conclusion is filed under **Verified**, but its
  epistemic basis is identical to the enumeration the plan files under **Assumed**. That's an internal
  inconsistency: the grep can't be "assumed-incomplete" for finding functions and simultaneously
  "verified-complete" for proving two don't exist. Downgrade this to "verified-present that
  `ignore_player_ap`/`rules` are columns; *believed-absent* that any setter RPC wraps them, pending the
  same re-grep."

- **Internal count error that undercuts an inventory-precision plan.** The text says the task board
  "named **four** write paths as the presumed complete set" and then lists **five** names
  (`award_ap`, `dm_edit_character_log`, `set_ignore_player_ap`, `declare_downtime`, `set_campaign_rules`),
  before saying "two of those **five**." Four vs. five is a trivial typo anywhere else — but in a plan
  whose entire credibility pitch is "I counted more carefully than the task board did," a miscount in the
  counting narrative is worth fixing.

- The remaining Verified items (`archived_at` exists; `archive/unarchive` are the only writers and are
  owner-gated; `award_wealth` already dropped/replaced; the six-path inventory) read as genuinely
  observed and I have no reason to doubt them from the text. No other reclassification needed.

### 3. Is there a better alternative to the proposed approach?

The overall shape — **one reusable guard + one RLS-policy tightening** — is the right idiom, and the two
rejected alternatives (a `before` trigger; modifying `is_campaign_dm()` itself) are rejected for the
*correct* reasons. I would not overturn the approach. But two concrete refinements are strictly better
than what's written:

- **A1 (recommended): invert the guard to fail-closed.** As written, `assert_campaign_active` does
  `if exists (campaign archived) then raise`. Feed it a **wrong or non-existent** UUID (e.g. a character
  id where a campaign id was intended) and `exists()` is false → **no raise → the write is allowed.**
  That's fail-*open* on the security boundary. Rewrite as *require an active row*:
  `if not exists (select 1 from campaigns where id = p_campaign and archived_at is null) then raise …`.
  Now a missing/wrong id → raise → deny. Same cost, opposite (safe) failure mode. Given the plan already
  worries that each RPC must pass the right `v_campaign`/`p_campaign`, the fail-closed form is the one that
  turns a variable-mixup coding slip into a hard error instead of a silent bypass.

- **A2 (recommended): factor the archived predicate into ONE boolean, then build both helpers on it.** The
  plan's headline argument for centralisation is "don't scatter six copies of the check" — yet it then
  ships **two** functions (`assert_campaign_active` and `is_campaign_dm_and_active`) that each independently
  embed the `archived_at is null` SQL. That's the same duplication, at N=2. Cleaner:
  `is_campaign_active(uuid) returns boolean` as the single source of truth; `assert_campaign_active` calls
  it and raises; `is_campaign_dm_and_active` returns `is_campaign_dm(id) and is_campaign_active(id)`. One
  place defines "what archived means," consistent with the plan's own stated value.

- **A3 (minor): give the raise a stable custom SQLSTATE/errcode** rather than relying on the English
  message string, so any client that *does* surface the bypass error can branch on archive-rejection
  programmatically instead of substring-matching prose.

None of these change the architecture; they harden the exact design chosen.

### 4. What's missing — a write path, a risk, or a hollow verification step?

- **Possible seventh path (the biggest omission): direct table-write RLS on character/awards/ledger
  tables.** The plan assumes every character-state mutation is funnelled through the five DEFINER RPCs and
  that the only *direct* RLS write surface is `campaigns_update`. If any DM-facing `insert`/`update` policy
  or column grant exists on `characters`, an AP/gold-awards table, or a downtime ledger, it bypasses all
  five RPC guards untouched. This should be an explicit checklist line ("confirm no direct DM
  `insert`/`update` grant+policy on character/awards/ledger tables"), not an unstated assumption.

- **Unnamed risk: archive-vs-write TOCTOU.** The plan sells "archived = read-only" as a *real invariant*,
  but there's a small race: DM-A commits `archive_campaign` while DM-B's `award_ap` is mid-flight; B's
  `assert` read saw `archived_at IS NULL`, passes, and the write lands after archive committed. Severity is
  low (both parties are DMs; window is microseconds) — but a plan that claims *invariant* rather than
  *near-always* should name it, if only to dismiss it. If you want it truly closed, a `SELECT … FOR SHARE`
  on the campaign row inside the guard serialises against the archive write; probably overkill, but state
  the decision.

- **Grant/revoke on the two NEW functions is under-specified — and this is the plan's own #1 historical
  failure mode.** The Risks section cites two prior grant/RLS-drift incidents, yet the migration spec only
  says grants are "restated where the file's own convention already does that for *touched* objects." The
  two *new* helpers are new objects. `is_campaign_dm_and_active` is referenced in an RLS **policy
  predicate**, evaluated in the querying role's context, so that role needs `EXECUTE` on it; default
  `EXECUTE` to `PUBLIC` may or may not match this repo's revoke-then-grant convention. Leaving this implicit
  is exactly how the cited incidents happen. Make the migration **explicitly** `grant execute` (and
  `revoke from public` if that's the house style) on both new functions.

- **`search_path` inconsistency between the two new SECURITY DEFINER functions.**
  `assert_campaign_active` pins `search_path = public, pg_temp`; `is_campaign_dm_and_active` pins only
  `public`. On a security boundary, both DEFINER functions should pin the same hardened `search_path`
  (include `pg_temp`). Small, but it's the kind of inconsistency a security lint or a careful reviewer
  will (rightly) stop on.

- **A verification hole (see Q5): the plan's own "authority-before-archive" design decision is asserted but
  never tested.** Step 2 in Proposed-Approach deliberately orders the archive check *after* the
  `is_campaign_dm` check so a non-DM never learns archive state — good design, but no test confirms a
  non-DM against an archived campaign gets the *authority* error and not the *archived* error. Add that
  negative-control case.

- **A second verification hole: the "DM can still READ an archived campaign" invariant** — the entire
  reason `is_campaign_dm()` is left untouched — is never directly asserted. Add an explicit "signed-in DM
  can still `select` the archived campaign after the migration" check; it's the exact regression the design
  is structured to avoid.

### 5. Is the Verification section objectively checkable by a non-author?

**Largely yes, with two caveats.**

- **Checkable:** apply-migration → `get_advisors` → direct `supabase.rpc(...)` per path → `unarchive` →
  re-run. Concrete, reproducible, and (crucially) the "direct signed-in call, bypassing the client guards"
  design means it tests the *actual* boundary, not the UI convention. This is the strongest part of the
  plan.

- **Caveat 1 — fixtures aren't turnkey.** The steps presume a campaign with a bound character, a DM role on
  it, and the campaign in an archived state. None of that setup is scripted in the plan, so a non-author
  must construct the fixture from tribal knowledge before any step runs. "Objectively checkable *in
  principle*" — yes; "runnable as written by a stranger" — not quite.

- **Caveat 2 — one step is a deliberate null.** Step 4 (`engine-parity.html`) validates *nothing about this
  fix* by the plan's own admission (no JS touched); a 0-failed result only confirms "no JS regressed." The
  plan is honest about this, but a reader skimming "Done when" could over-credit it. Keep it, label it
  clearly as a null control, don't count it toward "verified."

### 6. Should this plan split — or is the scope boundary right?

**Keep it as one plan. The boundary is drawn correctly — with one conditional.**

- Splitting the six enumerated paths further would be artificial: they share one guard function and one
  migration, and shipping the RLS-policy tightening separately from the five RPCs would deploy a
  *half-invariant* (some archived writes blocked, others not) — the worst interim state on a security
  boundary. Ship the six together.

- The two deferrals are correctly *separate* future plans, each with a concrete mechanical reason, not a
  hand-wave: `character_dm_notes` genuinely needs a `for all` → split-policy refactor first (locking writes
  without splitting would also block DM *reads* of an archived campaign's notes — a real regression), and
  the invitation subsystem was hardened days earlier, so re-touching those same functions now is textbook
  scope creep on the identical boundary.

- **The one conditional:** if the Q4 "seventh path" (a direct DM-write RLS policy/grant on
  character/awards/ledger tables) turns out to exist, it belongs in **this** plan, not a deferred one — it's
  the same invariant, same mechanism, and deferring it would again ship a half-invariant. So the scope line
  is right *given* the re-grep comes back clean; make that dependency explicit.

---

## Prioritised, actionable findings

**Must-fix before merge**
- **F1.** Invert `assert_campaign_active` to **fail-closed** (`if not exists (… archived_at is null) then
  raise`). *(Q3-A1)*
- **F2.** **Explicitly grant/revoke EXECUTE** on both new functions in the migration — this is the plan's
  named #1 historical drift class and is currently only implicit. *(Q4)*
- **F3.** **Re-run the enumeration grep immediately before writing the migration** and **explicitly confirm
  no direct DM-write RLS/grant** on character/awards/ledger tables. Promote from parenthetical to a gating
  step; the "goal met" claim depends on it. *(Q1, Q4)*

**Should-fix**
- **F4.** Collapse the duplicated archived predicate into one `is_campaign_active(uuid)` boolean; build both
  helpers on it (matches the plan's own centralisation argument). *(Q3-A2)*
- **F5.** Pin the **same hardened `search_path` (incl. `pg_temp`)** on both new DEFINER functions. *(Q4)*
- **F6.** Add two verification cases: (a) non-DM vs. archived campaign returns the *authority* error, not
  the *archived* error; (b) a DM can still `select` the archived campaign post-migration. *(Q4, Q5)*

**Nice-to-have / clarity**
- **F7.** Give the raise a stable custom SQLSTATE so clients can branch on it. *(Q3-A3)*
- **F8.** Name (even to dismiss) the archive-vs-write TOCTOU race, since the plan claims a hard
  *invariant*. *(Q4)*
- **F9.** Fix the "four vs. five" miscount in the inventory narrative; reclassify "two setters don't exist"
  from Verified to grep-bounded. *(Q2)*
- **F10.** Label Step 4 (engine-parity) explicitly as a null control in "Done when" so it isn't
  over-credited. *(Q5)*

---

## What the plan gets right (worth preserving)

- **Right boundary chosen for the RLS change:** tightening only `campaigns_update` rather than
  `is_campaign_dm()` — correctly protecting the "archived = still browsable, just frozen" property. This is
  the single best decision in the plan.
- **Authority-check-first ordering** to avoid leaking archive state to non-DMs — good instinct (just
  untested; see F6).
- **Direct-RPC verification that bypasses the client guards** — tests the real boundary, not the UX
  convention, which is the entire point of the exercise.
- **Explicit Verified/Assumed split and self-flagged grep-completeness limit** — the plan argues honestly
  against its own confidence, which is exactly what a cold review wants to see.

**Net:** approve-with-changes. Land F1–F3 and the plan delivers a genuine invariant rather than a
better-documented convention.

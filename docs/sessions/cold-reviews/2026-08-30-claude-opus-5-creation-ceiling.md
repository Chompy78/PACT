> Triaged in session: docs/sessions/2026-08-30-creation-ceiling-and-cold-review-backlog.md, 2026-08-30
> Reviewer: Claude Opus 5 (claude-opus-5), default settings — run as an in-session cold subagent
> Plan reviewed: docs/plans/2026-08-30-creation-ceiling.md
> Method: single-file read of the plan only; no repo exploration, no code verification (enforced by prompt).

# Cold review — creation ceiling (Claude Opus 5)

Credit first: the arithmetic in the live-character table is internally consistent, the "expected delta is
confined to X; anything else is a regression" verification line is unusually good practice, and the
"Honest limits" section does something most plans refuse to do. The findings below are against a document
above the median.

## Blocking items

1. **Undefined ceiling for every character without a ceiling event** (4a) — the current state of the whole
   database.
2. **The frozen-ceiling trap on mid-creation awards** (2a), whose only offered remedy is an irreversible
   action that is wrong in that case.
3. **The stated rationale for freezing contradicts the plan's own Honest limits** (2b).
4. **No undo for Finish** (4b), while step 8 performs exactly that undo by hand.

## 1. Does it achieve the stated goal?

**Partly. It achieves the narrow goal and abandons the broader one it opens with.** *(major, high)*

Context states the actual requirement: *"the app must know when creation ended."* After this plan, **the
app does not know when creation ended.** It knows only whether a human pressed a button. Honest limits
concedes this without circling back to note that the line-24 requirement now goes unmet. The old design
answered the question wrongly in an edge case; the new design declines to answer it at all, by default,
forever. That may be the right trade — but it belongs in the Goal, not left for the reader to reconcile.

**Step 7's invariant check is largely dead on arrival.** *(major, high)* It flags "spend exceeds the
DM-set ceiling with no finish marker" — but if step 3's guard works, **spend can never exceed the
ceiling**. It can only fire on pre-existing data or a client bypass. It cannot catch what will actually
happen constantly: a character sitting at its ceiling, still unlocked, still being played at creation
prices. That is the state the DM needs surfaced.

## 2. Shakiest assumptions

**2a — the frozen snapshot is coherent in the intended case and a trap in a case the app cannot
distinguish.** *(blocking, high)* `dmAp` awards carry **no marker distinguishing "creation funding" from
"chapter reward"** — both are `award` events, and the plan never raises this. So an ordinary mid-creation
top-up (a late joiner, a correction) leaves the player with AP they cannot spend, and the only remedy the
UI offers — "pointing at the finish action" — is an irreversible action that is **wrong** here; what was
needed was for the DM to re-snapshot. Risks names this with no mitigation attached. *A risk with no
mitigation in the design that names it is an unresolved design question wearing a risk label.*
Minimum fix: step 3's refusal must offer **both** exits, and step 6 must specify a DM "re-snapshot to
current funding" action, not just "set".

**2b — the justification for freezing is self-defeating.** *(blocking, high)* The plan says *"were the
ceiling live, it could never be crossed and the lock would be unreachable"* — but under the final design
the lock is reachable **only** by the button (Done-when #1). Frozen or live changes nothing about
reachability. What the freeze actually buys is friction: a player pinned at the ceiling is nagged toward
Finish. That is legitimate, but it is coercion-by-annoyance and per 2a sometimes points at the wrong
action. Defend the freeze on those honest terms, or drop it.

**2c — "none is stranded on day one" measures the wrong thing.** *(major, high)* Read the plan's own
table: Skylar headroom **0**, Moss **3**, Fenwick **7**. Skylar cannot make a single purchase after this
ships without pressing Finish. Follow her through step 8: her marker is cleared, leaving her unlocked with
zero headroom whose only forward action is Finish — which re-locks her. **Step 8 for Skylar is a round trip
to the same state**, netting only the gold/downtime reversal on two AP.

**2d — the Moss example doesn't support its argument.** *(minor, high)* Moss's own figure **is 79**
(75 + 4), identical to the generic default. Skylar is the case that genuinely proves the per-character
point. The plan under-uses its strongest example and over-claims on its weakest.

**2e — "only Amble's six characters are real"** is a single owner assertion; the plan never states how many
characters exist in total or how many are not campaign-bound. *(major, medium)*

**2f — step 0's "purely additive" claim** is asserted rather than argued for the three label changes.
*(minor, medium)*

## 3. Better alternative — make the ceiling a fork, not a wall

Instead of refusing outright, crossing the ceiling opens a three-way choice: **(1)** finish now and buy at
in-play prices; **(2)** keep building at creation prices, recording a `ceilingExceeded` marker; **(3)**
cancel. This retains the core insight in full — no transition without an explicit click — while
eliminating the strand-and-trap failure mode, and it gives step 7's invariant check something real and
common to detect ("knowingly building past the DM's budget"), which is exactly the auditability Honest
limits says is the goal. Materially different from the rejected warn-only, which kept an invisible
automatic tripwire behind the warning. **This is the option I'd build.**

Secondary: **drop the freeze** (per 2b its stated reason doesn't hold). You lose the nag, which the plan
concedes is unenforceable anyway.

## 4. What is missing?

- **4a (blocking, high) — the default ceiling for a character with no ceiling event.** This is *every
  character in the database right now*, and the plan never defines it: refuse everything, allow everything,
  fall back to 79, or compute live? The single most load-bearing unspecified case in the document.
- **4b (major, high) — no way to undo an accidental Finish.** The plan's own verified facts say no tool
  emits `creationUnlocked`, and it doesn't add one — while moving the irreversible event from "fired by
  accident" to "fired by a click the UI actively pushes you toward". Out-of-scope covers a DM-applied lock
  a player can't clear, but says nothing about a **DM-cleared** lock. Sharper: the plan claims *"nothing
  needs to be reversible"* and then step 8 is an act of reversal.
- **4c (major, high) — step 6 must precede step 3**, and the plan doesn't say so: step 3 enforces a ceiling
  whose only authoring mechanism arrives in step 6.
- **4d (major, high) — campaign movement carried in unresolved.** Three reviewers across two revisions is a
  signal, not a footnote.
- **4e (moderate, high) — no rollback story.** Every `creationLocked` emitted is permanent data; reverting
  code doesn't revert data.
- **4f (moderate, high) — step 5's scope is unbounded.** "Wherever AP appears" across three tools is a
  direction, not a specifiable step.
- **4g (moderate, medium) — the confirm dialog's affordance is unspecified** for an unclearable action
  reached from an error message.
- **4h** — `opts` in `creationCeiling(events, opts)` undefined; no bound on the ceiling value; no PR
  sequencing for a nine-step change; the Players Guide appears in Files but in no numbered step.

## 5. Decision point — (a), and the plan overstates it as "the largest risk"

**(b) either doesn't fix anything or is (a) in a costume.** Legacy default-on → the bug stays live for
exactly the characters that have it. Legacy default-off → dead code plus permanent maintenance. Per-campaign
opt-in → two lock models coexisting in the file the project treats as its sole source of truth.

Note too: under (b) the three fixtures keep passing, which means **the test suite would be pinning a
deprecated model in place**, actively resisting the change the product wants. Worse than a broken test.

**Where the plan misjudges risk:** fixture churn is a chore. The largest risks here are **4a** (undefined
ceiling for unmigrated characters) and **4b/2a** (an unclearable Finish the UI pushes users toward when
it's the wrong answer).

## 6. RPC allowlist — no, not as described

1. **The field restriction is asserted, not specified.** A "contains `threshold`" check silently passes
   `{threshold, auto}`. Specify **key-set equality with rejection of unknown keys**.
2. **No bound on the value.** A DM could set 0, instantly stranding a player with no purchase possible and
   no un-finish path (4b). A server-side type + range check is mandatory and unmentioned.
3. **It genuinely erodes the boundary** — once the answer to "can we add one more type?" is yes, it's
   precedent. That's how allowlists become general editors.

**Recommended: a purpose-built `dm_set_creation_ceiling(character_id, threshold int)`.** Then
`dm_edit_character_log` is untouched and its "not a general editor" property holds literally.

**Secondary, worth pricing: don't put it in the LOG at all.** The ceiling is DM-authored metadata *about* a
character, not an event *in* its history. A DM-owned column/table with its own RLS needs no allowlist
change, gives natural revision semantics, and **replaces step 7's hand-written precedence rule with a
schema-level one** — step 7 exists purely because two authors write one value into a last-write-wins log.

## 7. Honest limits — underclaims three ways, mildly overclaims once

- **Underclaim 1:** frames the problem as cheating when it is **forgetting**. An optional confirmation
  step's modal outcome is "not pressed". The system default flips from "eventually locked, sometimes
  wrongly" to "never locked, silently, for everyone".
- **Underclaim 2:** never says Finish has no in-app undo.
- **Underclaim 3:** no acknowledgement of what's lost — the old auto-flip produced a *correct answer by
  default* for well-behaved builds. The honest framing: trading "occasionally wrong, automatically" for
  "usually absent, by design".
- **Overclaim:** *"nothing needs to be reversible"*, disproved by step 8.

**Is a ceiling a player can never finish out of worth building? Yes — but not for the plan's stated
reason.** Its value is: (1) the accidental permanent lock becomes **impossible**; (2) the DM gets a
per-character number to see and audit, which is what a tabletop DM actually wants, since DMs enforce
socially; (3) the boundary is **legible at the moment the player hits it**.

**Sharp implication: (1) is delivered by step 2 alone.** Deleting the auto-lock fixes the reported bug
outright. Steps 1/3/4/5/6/7 all serve (2) and (3) — a feature, not the bug fix. Price them separately.

## 8. Verification — better than most, four items that aren't checkable

Strongest line in the document: the named expected diff with a failure condition.

- **Done-when #4 ("a campaign-bound player cannot override it") is literally unsatisfiable** given no
  server-side enforcement and player-owned rows. Must read "cannot override it through the app's UI".
  *(major)*
- **The fixture list omits the flagship scenario** — "award received while at ceiling". Also missing: a
  character with **no ceiling event** (4a), a ceiling **lowered below current spend**, and un-finish.
  *(major)*
- "Step 0 regression … in all three labels" — which three, in which files? *(moderate)*
- Done-when #3's "plain language" is subjective. *(minor)*

## 9. Split — yes, into three

- **PR A — Step 0.** Additive, no version bump, repairs a live contradiction. Should not be held hostage.
- **PR B — the bug fix.** Step 2 + step 8 + the three fixtures + `DATA.version` + the Guide. Closes the
  reported bug and frees the two affected characters.
- **PR C — the feature.** Steps 1/3/4/5/6/7. Every unresolved question in this review lives here.

The argument is exposure, not tidiness: if C stalls on the campaign-movement question, A and B still ship.
**Honest counter:** B without C leaves a window where *no* character ever locks. But per Honest limits the
plan **accepts that same state permanently** for any player who never presses Finish — so B-then-C makes
temporary and visible a condition the full design already makes permanent and invisible.

Fix the four blocking items, adopt (a), use a purpose-built RPC, and take the three-way split — and this
becomes a plan I'd sign off on.

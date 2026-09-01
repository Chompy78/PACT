# Plan — Creation lock: a per-character AP ceiling with an explicit finish

Date: 2026-08-30 · Branch: `feat/creation-ceiling`
Supersedes the *mechanism* in `docs/plans/2026-08-02-creation-lock-switch.md`.

## Goal

Replace the automatic spend tripwire with a **per-character creation-AP ceiling** that purchases cannot
exceed, and an explicit **"Finish creating"** action that is the only way past it.

**Post-review decision (R3, owner, 2026-08-30):** the ceiling stays a **wall** — a purchase past it is
refused — and **only the DM can raise it**, from the same per-card panel. The reviewers' "fork" (letting the
player choose to keep building past the ceiling) was rejected on the owner's reasoning that it is wrong in
the common case: if the ceiling really was the character's whole creation budget, "keep building" lets a
player self-serve past it at creation prices, and the app still cannot tell that player apart from one who
legitimately needs more. The person who knows is the DM, so the DM decides. See *Owner decision after
review* below for what this resolves.

Owner decisions folded in: the ceiling is **each character's DM-granted AP plus their drawback grant**,
captured as a **one-off snapshot** — not a live figure that tracks later awards (P3); drawback AP **raises**
the ceiling rather than being stranded behind it (G2); the DM sets and sees it **per character in DM
Console** (H1); the display fix for the drawback pool ships as **step 0** of this plan (I2).

## Context (the reviewer has no repo access — everything needed is here)

PACT is a static vanilla-JS tabletop-RPG tool suite (no framework, no build step, GitHub Pages + Supabase).
Characters are event-sourced: an append-only `LOG` of purchase events, replayed to derive the character.
`js/engine.js` is the sole source of truth for rules; three UI-only tools consume it — **CharGen** (the
builder), **Live Sheet** (the in-play sheet), **DM Console** (the DM's roster).

Characters are built by spending **AP**. PACT prices a character's own-species traits cheaply *during
creation* and expensively *afterwards*, so the app must know when creation ended. Today it **infers** this:
replay accumulates spend, and the first time it exceeds a threshold (default 79) the character is
permanently marked "creation locked". That mark also decides when purchases begin costing gold and downtime.

**The problem.** A player experimenting in the builder — adding a spell to see its price, trying a higher
Hit Dice, backing it out — can tick past the threshold and permanently lock a character that has never been
played. Two live characters (Moss Stormspud, Skylar) are in this state.

Making the mark reversible was considered and rejected: the LOG is **edited in place** for earlier choices
(changing a stat rewrites the original event's cost rather than appending a refund), so recomputing
liveness from current spend lets a *later* edit retroactively move where creation ended — reopening two
already-fixed bugs (`D-GH34`; `D-GH-2026-08-06-creation-lock-survives-reload`, where one undo silently
un-locked a locked character).

**The insight.** Making the threshold a *ceiling you cannot cross* rather than a *line you cross unnoticed*
dissolves that problem class: you can never land on the wrong side by accident, so nothing needs to be
reversible.

**Why the ceiling is a snapshot, and why that matters.** It is captured once from the character's funding at
the time it is set, then frozen. A later DM award therefore does **not** raise it — so a player who is at
their ceiling must press "Finish creating" before they can spend new chapter AP. That is the intended flow:
the button is how a character stops being built and starts being advanced.

*(Corrected after review.* This plan previously justified the freeze as "were the ceiling live, the lock
would be unreachable". That argument is wrong — under this design the lock is reachable *only* by the
button, frozen or not. The honest justification is different and simpler: **the ceiling is a deliberate DM
setting, not a moving target.** A DM sets it once at onboarding and would rarely revisit it; a ceiling that
silently rose with every chapter award would stop being a budget at all. Its frozen-ness is the point, and
the DM's raise control is the release valve.*)

## Assumptions vs. verified facts

**Verified — read in the current code / live database this session:**

- `_lockStates()` in `js/engine.js` recomputes lock state on every replay; it sets locked when
  `_spent > _thr` and has **no path back**. Only CharGen auto-emits the marker (`_cgEnsureLockFired()`);
  Live Sheet and DM Console never do, so the trap is builder-only today.
- `creationLockConfig{auto,threshold}` and `creationUnlocked` already exist in the engine (last-write-wins
  per field). **No tool emits `creationUnlocked`** — there is no UI to clear a lock.
- `compute()` composes spendable AP from **three** pools — `(playerAp × ignore-toggle) + drawbackGrant +
  dmAp` — but exposes only `playerAp` and `dmAp`. **The drawback grant is never returned**, so no tool can
  label it. Three live labels consequently contradict their own totals (step 0).
- `economy()`'s `spent` excludes drawback purchases; drawbacks are income, not spending.
- Live Sheet already refuses unaffordable purchases with a flash message — a blocking pattern exists.
- DM writes into a player's LOG go through the `dm_edit_character_log` RPC, whose **server-enforced
  allowlist** accepts only boon/drawback `buy`, `award`, and `dmRemoveBoon`; its header states it is
  "deliberately not a general editor". A DM-set ceiling therefore needs a **SQL migration**.
- DM Console renders per-card "DM tools (private)" via `dmToolsBody()`, already hosting per-character DM
  write actions — the right home for the ceiling control.
- `DATA.drawbackCap` = 12; a campaign may override/enable it, enforced in-campaign and advisory outside.
- Measured by replaying the six live Amble characters' real LOGs through `compute()`. Ceiling under this
  plan (DM AP + drawback grant) vs. AP actually spent:

  | Character | DM AP | Drawbacks | Ceiling | Spent | Headroom |
  |---|--:|--:|--:|--:|--:|
  | Anders Pipeleaf | 72 | 12 | 84 | 67 | 17 |
  | Archer | 70 | 0 | 70 | 32 | 38 |
  | Caspian | 74 | 9 | 83 | 61 | 22 |
  | Fenwick Copperkettle | 74 | 4 | 78 | 71 | 7 |
  | Moss Stormspud | 75 | 4 | 79 | 76 | 3 |
  | Skylar | 76 | 4 | 80 | 80 | 0 |

  Every character is at or under their own ceiling — but **"under" is not the same as "has room"**: Skylar
  has **zero** headroom and could not make a single purchase without pressing Finish; Moss has 3, Fenwick 7
  (corrected after cold review — the original claim "none is stranded on day one" measured the wrong
  thing). Moss and Skylar carry `creationLocked` markers that fired against the generic 79 default. Note
  Moss's own ceiling *is* 79, so his marker is not evidence for per-character ceilings; **Skylar** (ceiling
  80, locked at 79) is the case that actually proves that point.
- **Clearing those two markers reprices nothing**: neither character owns a racial trait, the only thing
  lock state affects in pricing. The sole effect is on five small post-lock purchases (Moss 7 AP, Skylar
  2 AP) which revert from in-play to creation purchases, so their gold/downtime charges drop.

**Assumed — the reviewer should probe:**

- That a frozen ceiling is the right model, given a DM who awards AP mid-creation must now expect the
  player to press finish before spending it.
- That drawback AP raising the ceiling is balanced, bounded by the 12 AP cap.
- That widening the RPC allowlist by one non-purchase event type does not meaningfully erode the
  "not a general editor" boundary.
- The other three campaigns are throwaway test data (owner), so only Amble's six characters are real.

## Proposed approach

**Step 0 — name the third pool (prerequisite; fixes a live bug).** Expose the drawback grant from
`compute()`'s return (purely additive — no pricing change, no `DATA.version` bump) and correct the three
labels so every breakdown sums to its headline: `0 player + 4 drawbacks + 76 DM = 80`. Groundwork the
ceiling display needs, and independently repairs a contradiction five live players can see now.

**Step 1 — `js/engine.js`: `creationCeiling(events, opts)`** returning
`{base, drawbackBonus, ceiling, spent, remaining}`, where `base` is the stored snapshot and
`drawbackBonus` is the grant after the cap. One function, so all three tools quote one number.

**Step 2 — `js/engine.js`: retire the automatic `_spent > _thr` lock in `_lockStates()`.** The lock becomes
explicit-only. **Decision point below.**

**Step 3 — both player tools: enforce the ceiling** at the existing purchase guard, refusing a buy that
would push spend past it while unlocked. The refusal must name the ceiling, its composition, and **both**
exits — "if you've finished building, press Finish creating; if you need more build budget, ask your DM" —
never the finish action alone, which is the wrong answer for a player who was topped up mid-build.

**Step 3a — a character with no ceiling event has NO ceiling** (blocking item 1). Enforcement applies only
where a ceiling has actually been set. This is deliberately fail-open: it cannot strand anyone, it leaves
every local/solo character behaving exactly as it does today (they have no DM to set one, and the existing
"can't afford it" guard already bounds them), and it means shipping this does not require migrating the
whole database first.

**Step 4 — both player tools: "Finish creating"**, emitting `creationLocked` behind a confirm that states
what changes (own-species traits get pricier; purchases start costing gold and downtime). Cannot be
deferred past step 3 — it is the only escape from a ceiling.

**Step 5 — display (hard requirement).** Show the ceiling *and its composition* wherever AP appears, plus
an explicit state for "you have awarded AP you cannot spend until you finish creating."

**Step 6 — DM Console: show, set and raise the per-character ceiling in `dmToolsBody()`**, defaulting to
that character's DM AP + drawback grant. Includes a **"reopen creation"** control clearing an unwanted lock
via `creationUnlocked` — the missing undo for an accidental Finish (blocking item 3), which costs almost
nothing once this panel exists and which step 8 already performs by hand.

Via a **purpose-built RPC**, `dm_set_creation_ceiling(character_id, threshold int)` — *not* by widening
`dm_edit_character_log`'s allowlist (both reviewers, independently). That function's header states it is
"deliberately not a general editor", and a one-integer RPC keeps that property literally true rather than
by promise: nothing to get wrong in JSON key-set validation, and a server-side range check on the single
value. Run the Supabase advisor and skim logs after the migration.

**Step 6a — warn the DM at award time when an award would strand AP.** When granting AP to a character
that is still unlocked, if the award exceeds their remaining headroom, say so with the exact figure —
*"Skylar has 0 AP of headroom; 18 of this 18 AP award will not be spendable until she finishes creating,
or you raise her ceiling."* This is the mitigation for the reviewers' central finding: it catches the
strand **at the moment the DM would cause it**, rather than leaving the player to discover it later.
Computed exactly from ceiling − spent; no tuned threshold.

**Step 7 — authority.** Tag threshold events with their source (`dm` / `player`). While campaign-bound, a
player-authored threshold **never** overrides a DM-authored one regardless of timestamp; outside a campaign
the player sets their own. Add a DM Console invariant check flagging any character whose spend exceeds the
DM-set ceiling with no finish marker, or whose effective ceiling differs from the DM's last-set value.

**Step 8 — clear the two wrongly-fired markers** on Moss and Skylar via `creationUnlocked`, and stamp all
six Amble characters with their correct ceiling.

**Decision point.** Fixtures EV-003/EV-007/EV-009 assert that campaign membership alone arms the automatic
lock at the default threshold. Retiring auto-lock breaks all three. Either **(a)** update them and accept a
mechanics change — `DATA.version` bump plus a `testing/expected/` refresh — or **(b)** keep auto-lock as a
legacy path, carrying two models. This plan proposes **(a)**; it is the largest risk here.

## Honest limits of this design

It is **not enforcement**. The app is static and players own their character rows, so no client-side rule
binds a determined owner — that is a property of the architecture, not this feature. Two consequences worth
stating rather than burying:

- The finish marker is a **new non-derivable bit**. Its absence is indistinguishable from a character who
  simply has not finished, so a player who never presses it keeps creation pricing indefinitely and no
  recompute can call that wrong. The old auto-flip was a pure function of spend and threshold.
- The gain is therefore **auditability, not enforcement** — which is what step 7's invariant check exists
  to convert into something a DM can actually see. The claim is "DM-set, client-honoured", never
  "DM-authoritative".

Step 7's source-tagging is *not* an anti-cheat measure: undefined precedence between a DM-written and a
player-written ceiling produces wrong state for honest users (DM raises it while the player is offline;
last-write-wins silently picks one) and, in an append-only log, bakes it into history.

## Files involved

`js/engine.js` · `tools/PACT-CharGen-Webtool.html` · `tools/PACT-Live-Char-Sheet.html` ·
`tools/DM-Console.html` · `sql/migrations/` and `sql/rls-policies.sql` · `testing/fixtures/`,
`testing/expected/expected-results.csv` · `CHANGELOG.md`, `DECISIONS.md`,
`docs/PACT-Players-Guide.html` (a mechanics change is half-done until the guide lands it).

## Out of scope

A DM-applied lock a player cannot clear · splitting creation-vs-awarded pricing *within* one import burst ·
`feat/ap-model-reconcile` · drawback pricing itself · server-side enforcement of any of this.

## Alternatives considered

- **Symmetric/live lock** — rejected: in-place LOG edits let a later edit move where creation ended.
- **A live ceiling tracking current DM AP** — rejected by owner: it can never be crossed, so the lock is
  unreachable and the finish button becomes the only mechanism.
- **Ceiling from the campaign's budget curve (79/83)** — superseded: the owner's ceiling is the character's
  own funding, which is per-character rather than per-campaign.
- **Ceiling excluding drawback AP** — rejected: a player who took Soul Debt could not spend what it paid.
- **Move the trigger to Live Sheet / cooldown / warn-only** — rejected; all keep an invisible tripwire.

## Risks

- **Fixture breakage** (EV-003/007/009) and the `DATA.version` bump — the central risk.
- **A frozen ceiling surprises a DM** who awards AP expecting it to be immediately spendable.
- **Strandable character** if a ceiling is set too low; the finish control is the escape, hence the 3/4
  ordering constraint.
- **Widening the RPC allowlist** erodes a deliberately narrow boundary — mitigated by accepting only a
  `threshold` field and re-running the advisor.
- **Campaign movement**: a character moving between campaigns, or leaving one, may carry a stale ceiling
  and binding marker. Flagged by three independent reviewers of the predecessor plan; still unresolved.

## Verification

- `node testing/scripts/engine-parity-ci.mjs` → **0 failed**, with `testing/expected/` updated in the same
  change. `node testing/scripts/tool-pricing-ci.mjs` → **0 failed**.
- New fixtures: ceiling with no drawbacks; with drawbacks under the cap; over the cap; purchase refused
  exactly at the ceiling; purchase allowed after `creationLocked`; a player-authored threshold not
  overriding a DM-authored one while campaign-bound.
- Step 0 regression: for a character with drawbacks, the printed breakdown sums exactly to the headline in
  all three labels.
- Migration: advisor clean; a non-DM caller and a disallowed event type both rejected.
- Re-run all six Amble characters through `compute()` before and after; diff full output. Expected delta is
  confined to Moss's and Skylar's gold/downtime on five purchases; anything else is a regression.
- Manual, both player tools: build to the ceiling, confirm the refusal names it and its composition; press
  finish; confirm spending opens and the state text changes.

## Done when

1. No code path writes `creationLocked` except an explicit user action.
2. A purchase exceeding the ceiling is refused in **both** CharGen and Live Sheet.
3. The ceiling and its composition are visible in both player tools, every AP breakdown sums to its own
   headline, and unspendable awarded AP is explained in plain language.
4. A DM can see and set each character's ceiling in DM Console, and a campaign-bound player cannot
   override it **through the app's UI** (the app is static and players own their rows, so the unqualified
   claim was literally unsatisfiable — corrected after cold review).
5. Both CI gates 0 failed; `testing/expected/` and `DATA.version` updated together; advisor clean.
6. Moss and Skylar are unlocked; all six Amble characters carry their correct ceiling.
7. Engine and Players Guide both reflect the new rule.

## Reviewer instructions

State your model and settings on the first line of your response.

Judge logic, clarity, scope and risk — not correctness you cannot verify from this text alone. Then answer:

1. Does this achieve the stated goal?
2. Which assumptions are shakiest? Pay particular attention to the frozen-snapshot ceiling: is "the DM
   awards AP, and the player must press finish before spending it" a coherent flow or a usability trap?
3. Is there a better alternative, given the rejected options?
4. What is missing?
5. **On the decision point: (a) retire auto-lock and bump the rules version, or (b) keep a legacy
   auto-lock path? Argue the trade explicitly.**
6. Is widening the `dm_edit_character_log` allowlist the right way to give a DM the ceiling, or is there a
   safer route that keeps that boundary intact?
7. Does "Honest limits of this design" overclaim or underclaim? Specifically: is a ceiling that a player
   can simply never finish out of worth building at all?
8. Is the Verification section objectively checkable as written?

Output your review as a file named `creation-ceiling-review-<model>.md`.

## Review outcome

Reviewed 2026-08-30 by two independent cold subagents — **Claude Sonnet 5** and **Claude Opus 5** — each
given the plan text alone, no repo access, no conversation history. Full reviews:
`docs/sessions/cold-reviews/2026-08-30-claude-sonnet-5-creation-ceiling.md` and
`…-claude-opus-5-creation-ceiling.md`.

**Status: NOT ready to implement.** Four blocking items, three of which are defects in this document
rather than in the design. Both reviewers converged independently on four points, which is the strongest
signal in the set.

### Converged across both reviewers — accepted

| Finding | Action |
|---|---|
| **Split step 0 out** — additive, no version bump, repairs a live contradiction; shouldn't be held hostage | **DONE** — shipped as PR #475 (`fix/ap-breakdown-drawback-pool`), parity 73/0 |
| **Decision point: take (a)**, retire auto-lock and bump the rules version | **Accepted.** Opus's argument is decisive: under (b) the three fixtures keep passing, so *the test suite would pin a deprecated model in place* |
| **Use a purpose-built RPC**, not a widened `dm_edit_character_log` allowlist | **Accepted** — step 6 to be rewritten as `dm_set_creation_ceiling(character_id, threshold int)` |
| **The frozen ceiling is a usability trap** on mid-creation awards | **Owner decision required** — see below |

### Blocking — must be resolved before implementation

1. **The default ceiling for a character with no ceiling event is undefined** (Opus 4a). This is the state
   of *every character in the database right now* — verified: none of the six Amble characters carries a
   `creationLockConfig{threshold}`. Refuse everything, allow everything, fall back to 79, or compute live?
   The single most load-bearing unspecified case in the plan.
2. **Mid-creation awards strand the player, and the only exit offered is wrong** (Opus 2a, Sonnet 2).
   `dmAp` awards carry no marker distinguishing creation funding from a chapter reward — both are `award`
   events. A DM topping a character up mid-creation leaves AP the player cannot spend, and step 3 points
   them at Finish, which is irreversible and not what they needed. Sonnet: the plan "converted an invisible
   auto-lock into an invisible auto-stall."
3. **No undo for Finish** (Opus 4b), while step 8 performs exactly that undo by hand — and §Honest limits
   claims "nothing needs to be reversible", which step 8 disproves.
4. **The stated rationale for freezing does not survive the plan's own Honest limits** (Opus 2b). The plan
   claims a live ceiling would make the lock unreachable — but under this design the lock is reachable
   *only* by the button either way. The freeze buys friction, not reachability. Defend it on those terms
   or drop it.

### Claims in this plan the reviewers proved wrong — corrected in place

- **"Every character is at or under their own ceiling, so none is stranded on day one"** measured the wrong
  thing (Opus 2c). Skylar's headroom is **0** — she cannot make a single purchase without pressing Finish;
  Moss has 3, Fenwick 7. Corrected above.
- **Step 8 for Skylar is a round trip**: clearing her marker leaves her unlocked with zero headroom whose
  only forward action is Finish, which re-locks her. Net effect is the gold/downtime reversal on 2 AP.
- **The Moss example doesn't support its argument** (Opus 2d). Moss's own ceiling *is* 79 — identical to the
  generic default he locked against. Skylar (ceiling 80) is the case that actually proves the
  per-character point.
- **Step 7's invariant check was dead on arrival** (Opus): if step 3's guard works, spend can never exceed
  the ceiling, so it could only fire on pre-existing data. The state a DM actually needs surfaced is "at
  the ceiling, still unlocked, still on creation prices."
- **Done-when #4 was literally unsatisfiable** — "a campaign-bound player cannot override it", with no
  server-side enforcement and player-owned rows. Must read "cannot override it through the app's UI."
- **"Only Amble is real" was assumed; it is now verified** — a live query shows Amble is the *only*
  campaign with any characters at all; the other three have zero. This closes the precondition Sonnet
  attached to its (a) recommendation, and the blast radius is smaller than the plan claimed.

### Owner decision after review (R3, 2026-08-30) — and what it resolves

The owner rejected the fork and chose **a wall plus a DM-only raise control**, with a DM-side warning at
award time. The reasoning, which the reviewers could not have had: *the DM normally sets the creation
budget once and would almost never change it; on the rare occasion they do, they understand why.*

The decisive objection to the fork came from the owner, not from either reviewer: **if the ceiling really
was the character's whole creation budget, "keep building" is wrong too.** It lets a player spend past
their real budget at creation prices, and the player facing that dialog is no better placed than the app to
know which case they are in. The fork moves the guess from the app to the player; it does not remove it.
R3 moves the decision to the only party who actually knows — the DM.

Status of the four blocking items under R3:

| # | Item | Status |
|---|---|---|
| 1 | Undefined ceiling for a character with no ceiling event | **Resolved** — step 3a: no ceiling event means no ceiling. Fail-open, cannot strand anyone, no database migration needed before shipping |
| 2 | Mid-creation awards strand the player, only exit is wrong | **Resolved** — step 6a warns the DM at the moment they would cause it, with the exact stranded figure; step 3's refusal now names both exits; step 6 lets the DM raise the ceiling |
| 3 | No undo for Finish | **Resolved** — step 6's "reopen creation" control, which the DM panel makes nearly free |
| 4 | Freeze rationale self-defeating | **Resolved** — rationale replaced. The freeze is not about lock reachability; the ceiling is a deliberate DM setting, and one that silently rose with every award would not be a budget |

Still open, unchanged by R3: **campaign movement** (a character moving between or leaving campaigns may
carry a stale ceiling — flagged by three reviewers across two revisions), the **rollback story**, and
**step 5's unbounded scope**.

### The alternative both reviewers pointed at — considered and rejected

Opus proposes **a fork, not a wall**: crossing the ceiling opens a three-way choice — finish now and buy at
in-play prices / keep building at creation prices (recording a `ceilingExceeded` marker) / cancel. It keeps
the core insight (no transition without an explicit click), removes the strand-and-trap failure mode, and
gives the DM audit check something real and common to detect. Sonnet independently proposes a related
inversion (**a live ceiling until someone deliberately freezes it**).

Both are materially different from the rejected "warn-only", which kept an invisible automatic tripwire
behind the warning. Neither was considered in this plan. **Choosing between fork-not-wall, drop-the-freeze,
and the plan as written is an owner call**, because it changes what the feature is — not something a
reviewer or an implementer should settle.

**Rejected 2026-08-30 in favour of R3** — see *Owner decision after review* above for why: option 2 of the
fork ("keep building") is wrong precisely when the ceiling was correct, which is the common case.

### Deferred, with reasons

- **Campaign movement** (Opus 4d, Sonnet 4) — flagged by three reviewers across two plan revisions and
  still unresolved. Either scope it out with the consequence stated plainly, or resolve it; carrying it
  further is a decision to accept a known-wrong outcome.
- **Rollback story** (Opus 4e) — every `creationLocked` emitted is permanent data; reverting code does not
  revert it.
- **Step 5's unbounded scope** ("wherever AP appears" across three tools) — enumerate the surfaces or it
  cannot be signed off.

---

## Close-out (2026-09-01) — what shipped, and the three carried questions answered

The plan is **implemented**. This section records what the open items became, so a future reader is not
left holding the same questions the plan was carrying.

### The four blocking items

| # | Item | Outcome |
|---|---|---|
| 1 | Undefined ceiling for a character with no ceiling event | **Fail-open.** No stamped ceiling means no ceiling. Nothing enforced for legacy or solo characters, and nothing had to be migrated before shipping. |
| 2 | Mid-creation awards strand the player | **R3.** The refusal names *both* exits, and a DM can raise the ceiling from DM Console. |
| 3 | No undo for Finish | **Built.** "Reopen creation" in DM Console, via `dm_reopen_creation()`. |
| 4 | Freeze rationale self-defeating | **Rationale replaced.** The freeze is not about lock reachability; a ceiling that silently rose with every award would not be a budget. |

### The three questions the plan carried as unresolved

**Campaign movement — RESOLVED.** Owner, 2026-09-01: *"when a character leaves or joins a campaign, the
locks go."* Both the lock and the ceiling are cleared, by a trigger on `characters.campaign_id`
(`2026-09-01-campaign-move-clears-creation.sql`) rather than by patching the join/leave RPCs — one rule
on the column cannot be bypassed by a future caller. A character with no campaign has no DM, so nothing
is enforced for it, which is the same fail-open rule as item 1.

**Step 5's scope — BOUNDED.** "Wherever AP appears" was never specifiable. The actual surfaces, all
shipped:

| Surface | Shows |
|---|---|
| CharGen AP chip (3 label variants) | the three pools, summing to the headline |
| CharGen "Finish creating" | shown only while genuinely in creation; ceiling + spend in its tooltip |
| CharGen purchase refusal | ceiling, its composition, and both exits |
| Live Sheet AP chip | same three pools |
| Live Sheet "Finish creating" | same rule and tooltip |
| Live Sheet purchase refusal | same message |
| DM Console card → Creation row | locked / still building, and whether the limit is the engine default |
| DM Console DM tools → Creation limit | state in words, set/raise input, Reopen creation |

Anything beyond these is a new request, not an unfinished step.

**Rollback story — STATED, and it is not symmetrical.** Reverting the code does **not** revert the data,
because every `creationLocked` / `creationLockConfig` / `creationUnlocked` is a permanent log event.

- *Code* rolls back by reverting the commits and restoring `DATA.version` — but note the five re-baselined
  fixtures (EV-003/007/009/012/013) would need reverting with it, or parity fails.
- *Data* does not roll back by reverting code. Events already written stay written. They are harmless to
  an older engine — the retired automatic lock ignored `threshold`, and an unknown event type replays
  inert — so an older build reads such a character as it always did. **That asymmetry is the design
  working, not a gap:** the log is the record, and a rollback that silently rewrote history would be the
  worse outcome.
- The genuine one-way door is `DATA.version` v0.363 → v0.364 and the fixture re-baseline, which is what
  a rules-version bump is *for*.

### What is deliberately still open

- **A DM-applied lock a player cannot clear.** Out of scope from the start; `dm_reopen_creation()` gives a
  DM the clear, but nothing distinguishes a DM-issued lock from a player-issued one.
- **The two-writer precedence rule** (source-tagging DM vs player thresholds) from the judge's verdict.
  Not built: with the DM-only RPC being the sole write path in practice, there is no second writer today.
  It becomes real if a player-facing ceiling control is ever added.

### One item closed by being wrong

While reviewing PR #481 this session I noted `THEME_SLIP = 0.18` as "a tuned constant with no test
pinning it". **That was wrong**, and worth recording so nobody acts on it. `testing/scripts/
random-quality-ci.mjs` already guards the *property* rather than the number, which is the better test:
line 249 asserts two rolls of one theme still differ (mean overlap < 0.70), catching a slip set too low
and making themes rigid; line 241 asserts the favoured categories lead the picks, catching a slip set
too high and making themes meaningless. Pinning `0.18` exactly would have been more brittle and tested
less.

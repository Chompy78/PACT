# Cold review — Enforce Hit-Dice requirements on class abilities

**Reviewer model:** Microsoft Copilot, based on Claude Opus 4.8 · reasoning effort: high · web/tools: none used (judged from the inline text only, as instructed)
**Plan reviewed:** `D-GH-2026-08-27-feature-hd-gate` · Branch `feat/feature-hd-gate` · Review date 2026-08-27
**Access:** none to the repository. This is a judgement of logic, clarity, scope and risk from the plan text alone.

---

## Verdict at a glance

**Accept with changes.** The plan is unusually well-scoped and self-aware — it names the two purchase doors, the fixed-point interaction, and the fixture blast radius up front, which is exactly the stuff that normally sinks a gate like this. The core engineering call (fold the HD check *into* the `_blockedFeat` fixed point rather than run it as a later pass) is correct and is the load-bearing insight of the whole plan.

Three things stand between it and a clean merge, in priority order:

1. **R1 is under-protected in Verification.** The intent to keep the four prereq fixtures failing for the *prereq* reason is stated, but nothing in the Verification section *proves* it. That is the single most important fix and it is cheap.
2. **The "pre-launch, no real PCs" assumption is the highest-blast-radius item and is explicitly unconfirmed.** Re-confirm before merge; it is the difference between "engine catches up to Guide" and "breaking change to live builds".
3. **R3 (17 HD to finish a ladder) is a game-design decision, not an engine decision.** It needs a rules-owner sign-off because, if rejected, it reopens the *rule* — not just the fixtures.

Everything else is polish.

---

## The six questions

### 1. Does this approach achieve the stated goal?

**Yes, logically.** The goal is "the engine blocks a class ability bought before its Tier's HD requirement." The plan achieves it and, more importantly, achieves it on **both** paths — the 359-entry feature loop and the 192-entry subclass loop — where a naive fix would only close the first door. Point 5's observation that all 192 subclass abilities are *mirrored into* `DATA.features` is what makes the second door mandatory rather than optional, and the plan treats it that way. That is the correct reading.

Two things make the "yes" solid rather than hopeful:

- **Folding into the fixed point (step 2)** is the right structural decision. A separate later pass would silently mis-handle any feature whose prerequisite is itself HD-blocked, because that prerequisite would still read as "owned." The plan calls this out explicitly; good.
- **Gating stepped features on effective step tier (step 4)** is internally consistent with the pricing rule (`min(7, baseTier + n - 1)`). Gating on base tier would let a 5-HD character buy an entire ladder in one sitting, which contradicts the Guide. Correct.

One small clarity gap, not a logic gap: the "Done when" says blocked items are "not owned." Confirm that the *mirrored* subclass ability, if it blocks via **both** paths, is itemised **once** under "Blocked purchases," not twice, and that neither path counts it as owned. The parity check asserts equal AP and equal warnings between paths, but not de-duplication when both fire on the same underlying ability. See Q4.

### 2. Are any Assumptions shaky, and which hurts most if wrong?

All four are load-bearing, but they differ enormously in blast radius.

| Assumption | If wrong | Blast radius |
|---|---|---|
| **Pre-launch, no real PCs** | A stricter rule retroactively invalidates existing, legally-created characters | **Highest** — turns a "catch-up" into a breaking change; also promotes R4 (undo/non-monotonic HD) from hypothetical to real |
| Guide table = `DATA.tierHD` (T1–T3 unverified) | Low-tier gates fire at wrong HD | Low — T1–T3 gate at 1/2/3 HD; practical effect tiny, but it is a *factual data* hole that is trivially checkable |
| Guide needs no rules edit | Scope grows to include a Guide change (project rule: mechanics land in both) | Moderate — schedule, not correctness |
| Cross-class blocks identically to origin-class | Over-blocks legitimate cross-class buys | Moderate |

**The pre-launch assumption hurts most if wrong**, and it is the one the plan itself flags as *not re-confirmed* ("a prior project decision record states this; I did not independently re-confirm it"). Everything downstream — the acceptability of a hard block, the harmlessness of re-baselining, the "we can ignore R4 for now" posture — rests on it. It is also the cheapest to verify (grep for persisted builds / ask the project owner). **Re-confirm it before merge, not after.**

Secondary flag: the **T1–T3** gap is worth closing on principle. It is a factual claim about the rules the engine will now *enforce*, and "I didn't see it stated" is a weak basis for shipping an absolute rule. Five minutes with the Guide removes it.

### 3. Is there a better alternative than the one chosen?

On the three axes the plan poses, the choices are right, and the rejections are well-argued:

- **Hard block over soft warning** — correct. The Guide states the rule as absolute, and the "advisory drifts the moment a tool stops rendering it" argument is exactly what already happened (CharGen never wired the class-ability gate that Live Sheet has). Soft would reproduce the original defect.
- **Derived gate over authored data** — strongly correct. Hand-authoring 551 values that merely restate `tier` is a pure drift surface with no information gain. The optional per-item `hd` override is the right escape hatch for genuine exceptions. This is the best decision in the plan.
- **Effective step tier over base tier** — correct, for the reason given.

**Where I'd add an option the plan doesn't consider:** a **version-gated / flagged rollout** of the *block behaviour* itself, decoupled from the code landing. Given the blast radius in Q2 and the unresolved R4, shipping the enforcement behind `DATA.version` such that it can be toggled (or such that pre-version builds are grandfathered) de-risks the "pre-launch assumption is wrong" scenario without re-architecting anything. It is strictly safer than a hard cutover and costs little, since `DATA.version` is already being bumped. I'd rate this a genuine improvement on the rollout mechanics, not the rule.

Beyond that, the chosen path is the right one.

### 4. What's missing — a case, consequence, stakeholder or failure mode?

- **De-duplication of the mirrored ability (case).** As above: when a subclass ability blocks via both the subclass loop and the mirrored feature entry, is it reported once or twice, and is it counted as owned zero times? The parity check tests *equality* between paths, not *combination* when both fire. Add a check.
- **Persisted / saved builds (consequence + failure mode).** These are vanilla-JS web tools — do any of them save builds to `localStorage`, files, or shared links? Even pre-launch, developer and playtest saves exist. A stricter `compute()` will re-price them on next load and may strand purchases. The plan addresses fixtures but not *saved user state*. If there is any persistence, a migration note (or the flagged rollout above) is needed.
- **DM Console as a consumer, not just a picker (stakeholder).** The plan correctly says DM Console has no picker, so it needs no *authoring* change. But does DM Console *run `compute()`* on imported builds to display them? If so, it will now surface "Blocked purchases" on builds the DM cannot edit there. That may be the *correct* behaviour, but it is an un-noted UX consequence for a real user (the DM at the table).
- **CharGen affordance follow-through (failure mode).** The `<select>` can't disable an option, so the annotation "T4 · needs 5 HD" is the affordance — fine. But what happens on the *transition* when a user selects a blocked option? Confirm the item is added, immediately shown under "Blocked purchases," and the annotation makes the zero-AP/blocked outcome legible. An annotation that only appears in the dropdown but not on the selected chip would confuse.
- **Accessibility (stakeholder).** The signal is an emoji (`⛔`). Confirm screen readers get the textual "blocked: needs 5 Hit Dice" (they will, since it's in the string) and that colour/emoji isn't the sole carrier. Minor, but the plan touches UI.
- **R4 is listed but not decided (failure mode).** Live Sheet undo can lower HD and strand a legally-bought ability. The plan flags it and leaves it open. That's honest, but "unclear whether this needs handling" should become a decision *before* merge, because it is the one path where the "HD only increases, so recompute is always safe" reasoning breaks — and it's the same path that becomes live if the pre-launch assumption is wrong.

### 5. Is Verification objectively checkable?

**Mostly yes, with two soft items and one gap.**

Objective and machine-checkable:
- `engine-parity-ci.mjs` → 0 failed and `tool-pricing-ci.mjs` → 0 failed.
- 1-HD Fighter + Extra Attack ⇒ specific `⛔ … needs 5 Hit Dice` string, 0 AP, appears under "Blocked purchases."
- Same build at 5 HD ⇒ no HD warning.
- Transitive block case.
- Feature-path vs subclass-path AP and warning equality.

Rests on judgement:
- **"Manual: open CharGen … confirm high-Tier abilities show their HD requirement"** — explicitly manual; not encoded. Acceptable for a UI affordance, but call it out as non-CI.
- **"re-baselined with each changed total explained"** — the explanation is human prose. "0 failed" only proves the new expected files are *self-consistent with the new engine*, not that the new baseline is *correct*. A green CI after re-baselining is necessary but not sufficient; the correctness lives in the (judgement-based) explanations. This is the classic re-baseline trap and ties directly to R1.

**The gap:** nothing in Verification asserts that the four prereq fixtures still block **for the prereq reason**. That protection currently lives only in the author's intent ("raise `hd` enough to clear the HD gate while still failing the prereq gate"). It should be an explicit, keyed assertion — see R1 below. Until it is, R1 is a *stated* risk with no *test* behind it.

### 6. Should this be split into multiple plans?

**Partially.** The instinct to separate "engine enforcement" from "fixture re-baselining" is understandable but wrong here: the 13 re-baselined totals are **atomically coupled** to the engine change. Merge the engine without them and CI goes red; merge them without the engine and they describe behaviour that doesn't exist. They must ship together.

What *is* cleanly separable:

- **CharGen UI annotation (step 6)** — pure UI, no effect on `compute()` output or expected files, lower risk, easy to revert. Good split candidate; can trail the engine PR.
- **The three "Out of scope" items** — already correctly excluded (boons/arts hard-block, the 14 vs 10/17 price discrepancy, Ki/attunement gates). Keep them out.

So the recommended shape is: **PR1 = engine gate + new regression fixtures + re-baselined expected (indivisible); PR2 = CharGen annotation.** Not the engine/fixture split originally floated.

---

## R1 — does re-baselining 13 fixtures silently weaken the tests they were written to perform?

**Yes, this is a real and specific risk, and the plan's current mitigation is intent, not enforcement.**

The failure mode is precise: `CG-022`, `CG-027`, `CG-030`, `CG-031` exist to prove the *prerequisite* block. Raising their `hd` to clear the HD gate is necessary (otherwise they now block on HD and the prereq path is never exercised). But once `hd` is raised, a green CI no longer distinguishes "blocked because prereq" from "blocked because something else" — the test passes as long as *a* block occurs. That is the definition of a test that passes for the wrong reason.

The plan's wording — "raised enough to clear the HD gate while still failing the prereq gate" — is the right *goal*, but the Verification section never checks it. Two ways to convert intent into proof, better one first:

- **Preferred: split each of the four into two fixtures.** A low-HD variant that asserts the **HD** block reason, and a high-HD variant that asserts the **prereq** block reason. This preserves each original test's intent exactly, makes both gates independently regression-covered, and removes the judgement call about "minimum hd that still tests the same thing." Slightly more fixtures, much stronger signal.
- **Minimum: add a reason assertion.** Since warnings are keyed strings, assert that each of the four fixtures' blocked-reason names the **prerequisite**, not Hit Dice. This is a one-line-per-fixture check and directly closes the Q5 gap.

R2 (which reason wins when both fire) is the same problem wearing a different hat, and the proposed order (prereq first, HD second) is defensible — but it too is "untested assumption." Whatever order is chosen, encode it as an assertion on a purpose-built double-block fixture. The plan already proposes an "HD+prereq double-block" regression fixture (step 7); make **that** fixture assert the *reason ordering*, and R1 and R2 are both retired objectively.

**Net:** R1 is the correct thing to worry about, and it is not yet neutralised. It becomes neutralised the moment the prereq fixtures assert their reason rather than merely their block. Do not merge the re-baseline without it.

---

## R3 — is a 17-HD requirement to complete a stepped ladder acceptable game design?

**This is not an engineering question and should not be answered inside this plan.** It is a rules-owner decision, and it carries a scope risk the plan under-weights.

The logic is sound: if step *n* is priced at tier `min(7, baseTier+n-1)`, and the gate derives from tier, then finishing a Tier-4 ladder (Rage, Wild Shape, Sneak Attack, Martial Arts) genuinely requires 17 HD — near the top of the 1–20 scale. The plan is *correct* that this follows from the Guide's wording. The open question is whether the Guide's author intended the *combination* of "each step gates on its own tier" **and** "these specific ladders climb to T7," because those two rules multiply into "you cannot complete a core martial identity until level 17."

Why this matters more than the plan frames it: R1 is contained inside the test suite. **R3 can reopen the rule.** If the rules owner says "no, a 5-HD martial should be able to climb faster than that," then step 4's "gate on effective step tier" is *itself* what changes — a new curve, a cap, or a per-ladder override — which is an engine and Guide change, not a fixture tweak. That is a scope-expanding outcome hiding behind a risk bullet.

**Recommendation:** get explicit written sign-off from the rules owner on the 17-HD ladder consequence **before** the fixtures are re-baselined, because five fixtures (`CG-021/024/028/029` and one more per R5) are being raised to `hd 17` specifically to encode it. Re-baselining to 17 *bakes the design decision into the test suite*; if the decision later flips, all of that work re-churns. Confirm the design first, then baseline.

---

## Recommendations (for you to pick from)

**A — Pre-merge blockers (do these before PR1 lands)**

- **A1.** Re-confirm the "pre-launch, no real PCs" assumption independently; if any persisted/saved builds exist, add a grandfather/migration note or gate the block behind `DATA.version` (see B1).
- **A2.** Convert R1 from intent to enforcement: split the four prereq fixtures into HD-block and prereq-block variants (preferred), or add per-fixture reason assertions (minimum). Make the double-block fixture assert the R2 reason ordering.
- **A3.** Get rules-owner sign-off on R3 (17-HD ladder) *before* baselining the five `hd→17` fixtures.
- **A4.** Close the T1–T3 data hole by confirming `DATA.tierHD` against the Guide for all seven tiers, not four.

**B — Strongly recommended**

- **B1.** Ship the *block behaviour* behind `DATA.version` / a flag so a wrong pre-launch assumption is recoverable without a revert. Recommended — it's near-free given the version bump already planned and it's the cleanest hedge against A1 and R4.
- **B2.** Add the missing de-duplication check for mirrored subclass abilities that block via both paths.
- **B3.** Decide R4 (undo lowering HD) explicitly — even if the decision is "documented known limitation, no handling" — rather than leaving it open.

**C — Structure**

- **C1.** Split CharGen UI annotation into its own PR trailing the engine PR. *Recommended.*
- **C2.** Keep engine + fixtures + expected as one indivisible PR (do **not** split these).

**Recommendation:** the plan is sound enough to proceed on this branch; treat **A1–A4** as merge-blocking, adopt **B1** to de-risk, and ship in the **C1/C2** shape. The two things most likely to bite are the ones you already flagged — R1 (fix with A2) and R3 (fix with A3) — so your instinct on where to look is right; they just need enforcement and sign-off rather than a note.

---

## Smaller notes

- **Clarity:** the plan is genuinely readable cold — "Verified facts" vs "Assumptions" separation is excellent practice and made this review possible. Keep that split.
- **Scope hygiene:** the three out-of-scope items are correctly severed, and the 14-vs-10/17 price discrepancy is right to be a separate task-board item, not smuggled in here.
- **Wording nit:** "Done when" says "not owned" and "0 AP" for blocked items — good — but add "reported exactly once even when reachable via both purchase paths" so B2 is captured in the definition of done, not just the test list.
- The `_hdNeededFor` `max(tierHD, item.hd, item.lvl)` shape is a tidy way to preserve the Warlock-invocation `lvl` gate; confirm one fixture actually exercises the `lvl` term so it doesn't silently rot.

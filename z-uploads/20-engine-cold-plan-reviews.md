# Engine cold-plan reviews (6 tasks touching js/engine.js)

Pre-implementation plans for the six engine tasks. Each is written as a cold-plan
review: the trap, the design call, the sequencing, and the gate. **I cannot run
these — they need `js/engine.js` + the parity gate — so each ends with the exact
verification you must do locally.** No code here is committed.

Ordering note (dependency-aware): **Task 6 (engine-review-cleanup item 1) and the
CharGen embedded-copy sync recur across several of these.** Where a task says "best
done after Task 6", honour it.

---

## 1. `chore/engine-review-cleanup` — 4 low-risk hardening items (worst-of = high)

Bundled per AGENTS.md's "quick" allowance, but the bundle is rated **high** because
item 4 is a real design call and item 1 also touches CharGen's hand-copied
import-fold path. Each item still gets its own commit + CHANGELOG line.

| # | Item | Design call | Output-neutral? |
|---|---|---|---|
| 1 | Drawback buyoff matches by **label**, not stable ID | Give each `buy` (drawback) event a stable `id`; `buyoff` carries `refEventId`; keep label-match as legacy fallback | Should be, **but** must update CharGen's embedded import-fold copy too |
| 2 | `verifyPayload()` claims "never throws" but `_canonicalJSON()` has no cycle guard | Wrap top-level call in try/catch, return `{signed:true, valid:false, status:'error'}` | Yes (additive) |
| 3 | `baseBuild()` declares `lineage:'', racialSpells:[]` twice | Delete the duplicate | Yes (harmless dedupe) |
| 4 | `noLock:true` in `_replay()` scoped only by a comment | **Structural constraint** (only honour `noLock` for events before any real spend/finalize) OR at minimum rename to `importBurst` | **Possibly not** — if it changes when a build is creation-locked, output moves |

**The one that decides the task's rating — item 4.** Prefer the structural
constraint over rename-only: a comment is not a guard, and any `buy`/`buyoff`/`names`
event can currently set `noLock` and permanently dodge the creation-lock trigger.
The rename is the fallback if the structural fix proves to interact with
`repriceDraft()`/creation-lock timing in a way you don't want to touch in a cleanup
PR.

**⚠ Interaction with `fix/buyoff-keyed-by-event` (NOW).** Item 1 changes how
drawback buy/buyoff events reference each other — the *same* mechanism that NOW task
is fixing (buyoff keyed by name suppressing later re-buys). **Confirm the two don't
collide**; ideally sequence item 1 after the NOW fix, or fold the stable-id idea
into it.

**Verify locally:** run `engine-parity.html` after **each** commit. If item 4
changes any fixture's creation-lock state → **bump `DATA.version`** and update
`testing/expected/` in the same PR; items 1–3 expected output-neutral. Log
`D-GH-<date>-engine-review-cleanup` if item 1 or 4 changes real behaviour.

**Done when:** buyoffs resolve by stable event reference (legacy label fallback),
`verifyPayload()` cannot throw on any input, `baseBuild()`'s duplicate removed,
`noLock` structurally constrained or renamed, and `engine-parity.html` still 20/0.

---

## 2. `feat/warn-missing-data-refs` — warn on stale rules-table references (sweep-eligible)

`compute()` silently no-ops when a character references a racial trait/boon/drawback
removed or renamed from DATA — confirmed sites: racial traits (~L182, L189,
`if(!r)continue`), boons (~L372, `if(!bo)continue`), drawbacks (~L383, `||0`). The
character keeps the stale label but gets zero cost/effect on recompute, with no
warning. **Additive: warning text only, no pricing change.**

**Design call (low-stakes):** centralise behind one `_lookupOrWarn(table, key, W)`
helper, OR add one `W.push` line at each site. **Default to per-site** (minimal,
additive, lowest risk) unless the step-1 audit finds centralising is clearly
cleaner. **Do NOT** use this task to also refactor compute()'s structure — that's
REV-14b.

**Steps:**
1. **Audit** every DATA lookup in `compute()`/`rebuildStateFromEvents()` that
   silently skips or zero-prices an unrecognised ref. Confirmed: racialTraits,
   boons, drawbacks. Also grep masteries, features, class/subclass refs,
   spells/traditions, feats for the same `if(!X)continue` / `||0` pattern.
2. At each site keep the existing skip/zero-fallback **unchanged** and push a
   warning naming the specific missing ref, e.g.
   `⚠ '<label>' is no longer in the rules data — no cost/effect applied.` Reuse each
   site's existing `W.push` conventions (⛔/⚠ prefixes, label-splitting).
3. Decide centralise-vs-per-site (default per-site).
4. **Add at least one fixture** in `testing/fixtures/` + `testing/expected/` with a
   build referencing a deliberately-absent trait/boon/drawback, so the new warning
   path gets permanent coverage — closing exactly the `W.push` fixture gap REV-01's
   follow-up already flags.
5. Additive/display-only for numeric output → **do NOT bump `DATA.version`**; log in
   CHANGELOG.

**Verify locally:** `engine-parity.html` still 20/0 for all pre-existing fixtures
(no numeric change), plus the new fixture passes with the expected warning text.

---

## 3. `feat/banned-2nd-origin-class` — mirror the species asymmetric-ban (sweep-eligible, but engine)

`validate()` bans an origin class in **both** slots via one `bannedOriginClasses`
list — there's no equivalent to species' `bannedOriginSpecies` (banned *only* as a
bonus 2nd origin, still allowed as primary). A genuine engine gap, with an exact
precedent to mirror.

**Steps (mirror the species pattern exactly):**
1. `js/engine.js`: add a rule-schema field (e.g. `bannedOriginClasses2`) alongside
   `bannedOriginSpecies` in `RULE_BAN_FIELDS` (~L733–745).
2. `validate()`: add a branch checking `b.originClass2` against the new list,
   mirroring the `bannedOriginSpecies` check at ~L689–691 (banned only in slot 2).
3. `tools/DM-Console.html`: add a "Banned as 2nd origin classes" rule grid mirroring
   `ruleBannedOriginSpecies`, options from `DATA.classes`.
4. **CharGen embedded copy:** check whether CharGen's local engine copy needs the
   new field/`validate()` branch too (AGENTS.md Task 6 note) — best done after Task
   6, or update in the same PR.

**Version call:** the new list only fires when a DM explicitly sets it, which no
existing fixture does → expected output-neutral → **do NOT bump `DATA.version`**;
log in CHANGELOG. **If** any fixture's violations output changes, bump and update
`testing/expected/` in the same PR.

**Verify locally:** a DM can ban a class as 2nd-origin-only (allowed primary, banned
bonus), `validate()` enforces it, `engine-parity.html` still 20/0.

---

## 4. `fix/chargen-context-pricing` — the LAST tool-disagreement (medium)

D1 (a context-changing purchase is quoted from its own rules table, never by
whole-build diff) was implemented for the Live Sheet's `priceOf()` only. CharGen's
`replacePatchSlot()` still does `compute(after).total − compute(before).total`.
Re-measured 2026-08-05: eight of nine pricing categories now agree; the survivor is
unlock-class-owning-features:

| case | Live Sheet | CharGen |
|---|---|---|
| unlock Wizard owning 4 Wizard features | 7 | **−6** |
| unlock Wizard owning none (control) | 7 | 7 |

CharGen *pays the player 6 AP* because the whole-build delta sweeps in the
retroactive discount the owned features get once the class is unlocked.

**The mismatch to design around (this is the reviewable part):** the Live Sheet's
`_CTX_PRICERS` table is keyed by event **CATEGORY** (abil, hd, unlockclass…), but
`replacePatchSlot` writes a whole **SLOT** (IDENTITY carries originClass,
originClass2, species, species2, size, lineage at once). Decide: **price a slot
field-by-field against its own table**, OR **split the context-bearing fields out of
the slot**. Recommendation: **field-by-field against `_CTX_PRICERS`** — it reuses
the already-solved rule and keeps the two tools from disagreeing about what a
context change costs, without restructuring the slot model.

**The fix shape** matches the two that already landed: stamp each feature with
whether its class was unlocked when it was bought (as `_raceTraitLocked` does for
species traits and `_vigorRankTier` now does for Vigor), so an already-owned feature
keeps the cross-class price it was actually bought at.

**Guardrails:**
- Do **NOT** reintroduce filter-and-append — replace-in-place keeps the identity
  line in its ledger position and keeps a locked character's event indices stable.
- The **draft path stays unchanged** — `repriceDraft()` still owns pre-lock pricing;
  this quote only reaches a ledger once the lock has fired. Assert both halves.

**Verify locally:** gate in `testing/scripts/tool-pricing-ci.mjs` alongside the
existing "re-pricing stops dead once the lock has fired" block — assert a locked
species change is quoted at the listed pack price independent of owned traits.
Reproduced locked bug to target: Dwarf + four Halfling traits switching to Halfling
is quoted **−4** where the listed Halfling pack price is **7**. If `compute()`
output changes → bump `DATA.version` + refresh `testing/expected/`; if only
CharGen's recorded costs change, it does not move. `engine-parity.html` still 24/0.

---

## 5. `REV-14b` — split compute() into named sub-pricers (high, cold-review recommended)

Second half of REV-14 (14a — DATA extraction — shipped PR #251). Decompose
compute()'s ~370-line body (~L76–446) into named `_price*` helpers. **Behaviour-
preserving: output must be byte-identical.** Full plan already drafted at
`docs/plans/2026-07-17-engine-breakup-rev14.md` — reconcile this against it, don't
supersede it.

**The one design decision that prevents silent drift:** extract each section into a
helper taking **ONE SHARED MUTABLE CONTEXT** (`{total, L, W, mod, effScore, add,
…}`) and mutating it exactly as the inline code did — **NOT** return-and-merge.
Return-and-merge forces hidden inter-section dependencies to be made explicit and is
exactly where drift creeps in. Preserve `L` (ledger) and `W` (warnings) push order
**exactly**.

**Sequence:**
1. **Pre-flight, no code change:** produce a data-flow map of which locals each
   commented section reads vs writes (`total, L, W, mod, effScore`, the `add()`
   closure, any first-occurrence/suppression state). Confirm the exact line span of
   the `_raceTraitLocked` creation-lock logic so extraction-by-comment-boundary
   can't split it.
2. Extract **one section per commit**; run `engine-parity` after each so any
   regression is bisectable. compute() ends as setup + a fixed ordered sequence of
   `_price*` calls + return assembly, same signature/return shape.
3. **Verify byte-identical:** hash the full compute() return (totals + ledger `L` +
   warnings `W`) for every fixture before vs after; list any `W.push` branch no
   fixture reaches.

**Version:** behaviour-preserving → **do NOT bump `DATA.version`** (output must be
identical); log in CHANGELOG.

**Verify locally:** compute() is a dispatcher over named `_price*` helpers
(shared-context design), unchanged signature/return; full-payload output identical
across all fixtures; `engine-parity` still 20/0. **Run `/make-code-cold-plan-review`
before implementing** — it's a stateful-algorithm decomposition with a real
byte-identical guarantee.

---

## 6. `feat/character-log-merge` — merge concurrent edits instead of refusing (high, cold-review)

The deep fix behind `fix/optimistic-character-save` (NOW, which only *refuses* a
stale write). **Do the NOW task first** — its refusal stays as the fallback whenever
a merge can't be resolved.

> ⚠ **Blocker status caveat.** `fix/optimistic-character-save` is cited as a `(NOW)`
> task, but `TASK_BOARD_NOW.md` is **empty** and this fix isn't in any completed-work
> list. Confirm via `CHANGELOG.md`/git before relying on it as a prerequisite —
> if it hasn't landed, the refusal fallback this merge depends on doesn't exist yet.
> See `BLOCKER-REGISTER.md`. This is the *right* end state for the data model: a PACT
character is an append-only event log, so two people usually append *different*
events, and the "conflict" is an artefact of storing the log in one JSONB blob
written whole.

**What makes it non-trivial (the four real design problems):**
1. **Client-side merge** — the server stores one blob, so both logs must be fetched,
   merged and pushed, with the NOW task's guard still protecting the push.
2. **Event order matters for pricing** — the engine replays in log order;
   `_replay`'s creation-lock and per-purchase stamps depend on it. Two logs
   interleaved by timestamp could price differently than either alone. **Check
   against `repriceDraft()` and `_vigorRankTier` before trusting a merge.**
3. **Singleton events** (name, award, patch slots) **replace**, not append — a naive
   union produces two name events or doubles an award. These need per-type merge
   rules.
4. **Genuinely conflicting edits** (both sides change species) need a human answer —
   fall back to the NOW task's refusal, naming the conflicting field. Never guess
   between two human intentions.

**Sequence:**
1. **Do not start until `fix/optimistic-character-save` has landed.**
2. **Classify every event type** as append-mergeable or singleton-replace BEFORE
   writing merge code — the list is in `js/engine.js`'s event documentation plus
   CharGen's `PATCH_SLOTS`.
3. **Prove the ordering question with the fuzzer**, not by reasoning: merge two
   randomly generated logs, then assert the merged log still satisfies the
   invariants `log-fuzz.mjs` already checks (idempotent reprice, no NaN, ledger
   reconciles for a draft).
4. Anything unmergeable falls back to refusal + reload with the conflicting field
   named.
5. `engine-parity` must stay at its current count — this is a sync-layer change and
   must **not** move `compute()`.

**Verify locally:** two independent edits to the same character both survive a save;
singleton events merge correctly rather than duplicating; the fuzzer confirms merged
logs satisfy the same invariants as authored ones; anything unmergeable still falls
back to a clear refusal. **Run `/make-code-cold-plan-review`** — per-event-type merge
rules + the ordering/pricing interaction are a genuine design problem, untestable
without a live signed-in session.

# Plan — CharGen records post-lock spellcasting changes as in-play purchases (phase 2b)

> **Status: DRAFT for cold review (2026-10-04).** Task `fix/chargen-post-lock-purchases`, phase 2b. Parent plan: `docs/plans/2026-10-04-chargen-post-lock-purchases.md` §9–11.
> Written to be read with **no access to the repository**.

## Goal

After a character's creation is finished ("locked"), the character-creation tool (CharGen) must stop rewriting the spellcasting/identity/misc parts of the character **in place**
(a refund route and no in-play price) and instead record any increase as the same appended, in-play-priced purchases the play tool (Live Sheet) records — and refuse everything the
Live Sheet cannot do. This finishes the work for every patch slot, so the server can then freeze them all (see the server-freeze plan).

## Context (all inline)

**The app.** PACT is a static vanilla-JS tabletop-RPG toolkit (no frameworks, no build). One JS module, `engine.js`, is the single source of truth for rules: it exports the
rules data `DATA`, `compute(build)` (derives totals and warnings), `foldBuild(LOG)` (replays an event log into a build), `MUT` (a table of mutation functions, one per purchase
category), `priceOf(build, cat, payload)` (the AP price of one purchase) and `purchaseLegality(build, cat, payload)` (the "may this be bought" rule: duplicate guard, hard
blocks, soft warnings). Three tools use it: CharGen (build a character), Live Sheet (play a character; every purchase is `buy(cat, payload)` → one appended event), DM Console.

**Event log.** A character is a list of events. A purchase event: `{type:'buy', cat, payload, cost, label, level, warns, [gp, days]}`. Before the lock, CharGen records a whole
"slot" (e.g. all spellcasting) as ONE `buy` with `cat:'patch'` and `payload.patch = {traditions:[…]}` that it rewrites in place as the player edits — fine for a draft. After the lock
that is wrong: it rewrites creation history and re-prices the whole slot. The rule decided by the owner: after the lock **nothing bought can be removed or lowered; increases are
appended as in-play purchases; AP-granting purchases (drawbacks) are not available to players; free-text or creation-only things are refused.**

**What is already built (released).** For slots `hdProf`, `stats`, `languages`, `vigor`, `ki`, `sorcery`, `attunement`, `armour` (+ what you wear), `weaponProf`, `freeSub`:
CharGen diffs the edited slot against the current folded build, turns each increase into the Live Sheet's own events (e.g. `hd{to}`, `abil{ab,to}`, `language{to}`, `armour{v}`,
`wprof{wp}`), prices each with `priceOf`, checks each with `purchaseLegality`, stamps `gp`/`days` when the campaign economy charges, checks the whole edit is affordable before appending
anything, appends all of it as one undo step, and **refuses** any decrease (with a plain message and the control put back). `customProfs` (free text, no Live Sheet equivalent) is refused.
A head-to-head browser test makes the same purchases in both tools and requires identical events, total and spent. The function that does the diffing is `_cgPostLockSteps(slot, patch, cur)`;
the shared append/price/legality step is `_cgPostLockAppend(steps)`; a set `_CG_POSTLOCK_SLOTS` says which slots take this path after the lock.

## The remaining slots

| Slot (patch keys) | What CharGen has today after the lock | Proposed |
|---|---|---|
| `traditions` (`traditions`) | rewrites the whole nested spell array in place | **diff → appended spellcasting events** (below) |
| `innate` (`innate`) | rewrites in place | **refuse** — the Live Sheet has no purchase for it (verified: no `MUT` category) |
| `misc` (`martiallyBound`, `dabblerCantrips`) | rewrites in place | **refuse** both: `martiallyBound` is an AP-GRANTING purchase (`mbound` = −2 AP), `dabblerCantrips` has no Live Sheet purchase |
| `identity` (`originClass`, `originClass2`, `species`, `species2`, `size`, `lineage`) | rewrites in place | **refuse** — creation-only (the server already freezes species once sealed) |
| `economy` (`gold`), `houseRules` | DM-controlled | unchanged |
| `appearance`, `names` | in place, no AP | unchanged |

## Spellcasting: shape and mapping

`traditions` is an array of **traditions** `{name, rank, disciplines:[{name, bound, known:[9], slots:[9], arcanum:[4], cantrips, pactSlots}]}`. In the engine the purchases are indexed
mutations on `traditions[ti].disciplines[di]` (`ti`, `di` default 0):
- `found {ti, trad, disc}` — open a discipline: if there is no tradition at `ti`, create it `{name: trad, rank:0, disciplines:[new]}`; else add a discipline to it. (Live Sheet labels: "Open <trad> / <disc>", "Add discipline: <disc>".)
- `rank {ti, to}` — set the tradition's rank (one step per click; label "<Tradition> Rank N").
- `cantrip {ti, di, to}` — set the discipline's cantrip count ("Cantrip (N)").
- `slot {ti, di, L, to}` — set level-L slot count, `slots[L-1]` ("L<L> slot (N)"). `known {ti, di, L, to}` — `known[L-1]`, not offered for "prepared" disciplines ("L<L> known (N)").
- `dbound {ti, di, v:true}` — "Magically Bound": −2 AP (an AP *grant*), plus a spell discount from then on.
There is **no** purchase for `arcanum`, `pactSlots` (warlock) in the engine's `MUT`; those come from other categories.

### The diff (pure function, no side effects)
Input: `cur = foldBuild(LOG).traditions`, `next = patch.traditions` (what the form now says). Output: ordered steps or a refusal.
1. **Prefix check.** For every index `i < cur.length`, `next[i]` must exist with the same `name` (no removal, rename or reordering) and each existing discipline likewise → else refuse.
2. **New tradition/discipline** (index beyond `cur`) → one `found {ti, trad, disc}` per new discipline, in order, *before* anything that depends on it.
3. **Rank** increases → `rank {ti,to}` stepwise (`to` = each intermediate value), *before* slots/known/cantrips (their legality is gated by rank).
4. **Per discipline:** `cantrips` increase → `cantrip` per +1; each `slots[L-1]` increase → `slot` per +1; each `known[L-1]` increase → `known` per +1 (skipped for prepared disciplines).
5. **`bound` false→true → refuse** (AP-granting; same principle as new drawbacks). true→false → refuse.
6. **Any decrease** (rank, cantrips, slots, known, or a missing discipline/tradition) → refuse. **Any change to `arcanum` or `pactSlots`** → refuse (no purchase exists).
7. Steps are then priced one by one against the build **as it would be after the previous step**, legality-checked, affordability-checked for the whole list, and appended exactly as for the other slots.

## Verified vs assumed

**Verified:** `MUT` definitions for the six spellcasting categories and their payloads (quoted above); the Live Sheet's buy buttons and labels for them; no `MUT` category for innate spells,
dabbler cantrips, arcanum or pact slots; `mbound`/`dbound` are −2 AP flat; the phase-1/2a machinery and its tests exist and pass (148 browser checks).
**Assumed (challenge these):** (a) the order *found → rank → cantrip/slot/known* always satisfies each step's prerequisites (rank gates slot levels; the Live Sheet UI enforces this by
what it shows, `purchaseLegality`/`compute` warnings enforce it in code); (b) `priceOf` for these categories is the default whole-build `compute()` delta and is correct for an indexed
change; (c) the form can only *append* a tradition/discipline (it cannot reorder) — to be checked in the form code; (d) refusing `arcanum`/`pactSlots` changes does not block a legitimate
warlock flow (warlock pact slots/arcanum may be derived from hit dice or features rather than purchased).

## Files involved

`tools/PACT-CharGen-Webtool.html` (`_cgPostLockSteps`, `_CG_POSTLOCK_SLOTS`, the traditions/identity/misc slot patch builders); `testing/scripts/chargen-flows-e2e.mjs` (browser tests);
`CHANGELOG.md`; the parent plan. No engine change (the engine already has all the pieces), no `DATA.version` change.

## Out of scope

Server-side freeze (separate plan); the wallet warning (separate plan); changing the rules for what a spellcaster can buy; any Live Sheet change; warlock arcanum/pact slots purchases.

## Alternatives considered

- **A. Make CharGen read-only for spellcasting after the lock** (players use the Live Sheet) — far less code and no diff algorithm, but the creation tool cannot then spend a rolled character's
  remainder on spells after the lock. The owner chose to build it. *The reviewer may argue for this as the safer split.*
- **B. Re-use the whole-slot rewrite but append it as one `patch` event with the delta cost** — would keep the nested-array diff out of CharGen, but reintroduces a coalescing patch after the lock that
  the server freeze cannot classify, and diverges from the Live Sheet's event vocabulary (head-to-head parity lost). Rejected.
- **C. Allow `dbound` and `mbound` after the lock** (they are legal in the Live Sheet) — rejected by the owner (AP-granting).

## Risks

1. **Diff correctness on nested arrays** (highest). A wrong mapping silently buys the wrong thing or prices wrongly. Mitigation: pure diff function with exhaustive unit-style tests (every field, every direction)
   plus a randomised head-to-head against the Live Sheet over many scripted sequences, requiring identical events and an identical folded build.
2. **Ordering/prerequisites** (assumption a): a step rejected by the legality rule in the middle of a multi-step edit. Mitigation: validate the whole list before appending; a refusal appends nothing.
3. **Index drift**: `ti`/`di` must refer to the same tradition/discipline in the folded build as in the form. Mitigation: the prefix check (step 1) plus a test with two traditions and two disciplines.
4. **Blocking a legitimate edit** by refusing `arcanum`/`pactSlots`. Mitigation: a warlock test case; if the form changes them as a side effect of other edits, the diff must treat "derived" differences as no-ops (to be established by the test).
5. **Large file**: the tool file is ~600 KB; changes must be local and the existing 148 browser checks must still pass.

## Verification (objectively checkable)

Browser tests (headless Chromium, the project's existing harness): (1) head-to-head — scripted sequence "open Divine/Cleric; rank 1→2; 2 cantrips; slots L1 ×2, L2 ×1; known L1 ×2; add a second discipline" done in CharGen after the lock vs the same
`buy()` calls in the Live Sheet → identical events (cat, payload, cost, label, level, gp, days), identical total and spent, economy on and off; (2) a refusal per rule — lower rank, remove a discipline, lower a slot, `bound` true,
change `arcanum`, rename a tradition — each appends nothing, leaves spent unchanged, and puts the control back; (3) pre-lock path unchanged (single patch event rewritten in place); (4) unsupported slots `innate`, `misc`,
`identity` refused after the lock with a plain message; (5) a randomised property test (≥200 random increase-only edits) compares the folded builds from both tools; (6) full existing suite passes.

## Done when

All six verification groups pass in CI; `fix/chargen-post-lock-purchases` can be removed from the task board (phases 1, 2a, 2b done); the server-freeze Stage 2 keys are unblocked.

---

## Reviewer instructions (part of this document)

1. **First line of your reply: state which model you are and any settings.**
2. Judge **logic, clarity, scope and risk**; you cannot run code — do not claim a test passes or fails.
3. Answer: (a) Does this achieve the goal? (b) Which assumptions are shakiest? (c) Is there a better alternative (including Alternative A)? (d) What is missing — wrong step orders, edge cases in the nested-array diff, flows that would be blocked
   by mistake? (e) Is the verification objectively checkable? (f) Should it split (e.g. traditions vs the three refusals)?
4. Output a Markdown file: `chargen-2b-review-<model>.md`.

## Review outcome

**Reviewed 2026-10-04 by two API reviewers** (`gemini-3.6-flash`, `openai/gpt-oss-120b` — both self-identified wrongly; logged by real model id). Archived in `docs/sessions/cold-reviews/2026-10-04-*-chargen-2b.md`.

**Accepted:**
- **Split, and stage it (both reviewers; Gemini strongly).** **2b-1 (low risk, ships first):** after the lock, CharGen **refuses** edits to `innate`, `misc` (`martiallyBound`, `dabblerCantrips`), `identity` **and `traditions`**
  (i.e. Alternative A for spellcasting first), with a plain message pointing at the Live Sheet. That closes the in-place-rewrite refund route for every remaining slot immediately and unblocks removing the server freeze's
  temporary exemptions. **2b-2 (higher risk, only if it proves safe):** replace the `traditions` refusal with the real diff described above. If 2b-2 is not safe it simply does not ship, and spellcasting stays Live-Sheet-only after the lock.
- Index handling made explicit: `found` carries the index in the *edited* list (stable because the prefix check forces existing entries to match by position and name); a test with two new traditions in one edit and an insertion in the middle (refused).
- `bound` is refused only as a *transition* (an existing `bound:true` from creation is untouched); removing it is also refused — un-granting a −2 AP grant is a refund, so Groq's "allow removal" is rejected.
- Test additions: a Warlock case (derived `arcanum`/`pactSlots` must not cause a false refusal — **to verify first how those values are produced before 2b-2 is built**), simultaneous rank + slot increases, a multi-discipline edit, an attempt to reorder.
- Refusal messages name the reason for each case.

**Rejected / noted:** *"multi-slot transaction in one click"* — CharGen routes one control change through one slot at a time (to be confirmed by the test). *"`priceOf` may not be additive for indexed changes"* — each step is priced as the real
whole-build delta, correct by construction. *"Alternative D, dispatch `buy()` from the buttons"* — not applicable: the post-lock CharGen UI has no per-purchase buttons for spells, only the form.

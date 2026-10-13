> Triaged in session: (no session link available in this environment), 2026-10-13 — folded into docs/plans/2026-10-13-dm-ap-discount.md (Review outcome).

# Cold Review — `feat/dm-ap-discount` Plan

**Reviewer:** `gpt-4o` (OpenAI API, temperature 0, no tools)

---

## 1. Does the plan achieve the stated goal?

**Yes.** The plan directly implements every bullet in the Goal:
- DM can discount any priced purchase (amount or %, capped at full price, with a note) via a new `dmDiscount` event.
- The discount is bound to its target purchase (by `seq`) and disappears when that purchase is cancelled/bought off.
- Total discounted AP is accumulated per character and per campaign and surfaced in the DM Console.
- 100% discount = free grant (follow-up); partial discount = wizard scribe (follow-up).

The mechanics (raise `earned`, keep `spent` as AP value, derive AP paid = `spent − discounted`) satisfy Owner Decision B1 and leave the creation lock and equivalent-level formulas untouched.

---

## 2. Shaky assumptions

| Assumption | Assessment |
|------------|------------|
| *No existing log contains `dmDiscount`* | Safe for a brand-new event type, but the migration should still `SELECT 1 FROM log WHERE type = 'dmDiscount' LIMIT 1` as a guard. |
| *Percentages converted to whole AP at save time* | **Underspecified** — no rounding rule (floor / round / ceil) is given. A 33% discount on 10 AP could become 3, 3, or 4 AP. Must be decided and documented before implementation. |
| *Existing readers “mostly correct without change”* | Plausible given B1, but 65 call sites is a large surface. The promised “decision record mapping every reader to AP value or AP paid” is the right artefact; it should be treated as a **required deliverable**, not a nice-to-have. |
| *`pact_ap_ledger_spend` is a function/view that can be “taught”* | The plan calls it a “SQL sum” and later says “teach … to count `dmDiscount` as income”. The exact object type (function? view? trigger-maintained column?) matters for the migration. Needs clarification. |
| *“Protected (frozen) event types”* | Referenced but not defined. Presumably a list of event types the ledger trigger treats as immutable; needs explicit enumeration in the migration. |

---

## 3. Better alternatives?

The three alternatives considered (edit cost in place, keep using `award`, lower `spent`) are correctly rejected for the reasons given. The chosen “discount as DM-bound income” design is the only one that:
- respects append-only logs,
- honours B1 (AP value = full price for lock/level),
- ties the discount to its purchase,
- provides a running total.

No superior alternative is apparent from the text alone.

---

## 4. What’s missing / under-specified

1. **Percentage rounding rule** (see above).
2. **`refVal` semantics** — the event schema includes `refVal`; the plan doesn’t say what it holds (frozen cost of target? something else?).
3. **Migration atomicity** — `dm_edit_character_log` must be updated *and* the new event type allowed in a single transaction; rollback file must revert both.
4. **Player-save path validation** — Risk 3 hinges on the player write path rejecting `dmDiscount`. The plan should name the player-save function/trigger and confirm it whitelists event types (or that a new check will be added).
5. **UI for “AP or %”** — toggle? two fields? auto-detect? Validation? Accessibility?
6. **Campaign discount total location** — “visible to the DM” is vague; specify exact screen/component.
7. **`foldBuild()` budget interaction** — one sentence; a short note on why this doesn’t double-count would help reviewers.
8. **“Database advisor”** — what tool? What does it check? If it’s a custom script, cite its path.
9. **Rollback migration detail** — mentioned but not described.
10. **Decision record** — promote from “involved file” to explicit Done-when criterion.

---

## 5. Is the Verification section objectively checkable?

**Mostly yes**, assuming the reviewer has repo access:
- Engine parity test (new fixtures, unchanged `expected-results.csv`) — ✅ checkable.
- End-to-end DM Console → Live Sheet browser test — ✅ checkable.
- Read-only replay of 35+ live characters — ✅ checkable *if* the replay script and DB snapshots exist.
- Database advisor — ❓ checkable only if the tool is in the repo and its output format is stable.

A cold reviewer cannot *run* these, but the criteria are concrete and binary.

---

## 6. Should this be split?

The work is **cohesive** (DB → engine → three UIs → tests) and all pieces are interdependent. Splitting would create merge conflicts and partial-deploy risk. Keep as one plan, but **extract the “decision record” into a separate tracked document** so it can be reviewed independently of code.

---

## 7. Opinion on Risks 2 & 3

### Risk 2 — SQL ledger ignores cancellations
**Real and subtle.**  
If a purchase is bought off, the engine drops its `dmDiscount` (earned ↓), but the SQL ledger still counts the discount as income. The server therefore **over-states** the character’s earnings and may **accept a save the engine says is over budget**.  
*Mitigation*: either (a) make the ledger target-aware (join to `activeEvents` logic in SQL), or (b) demote the ledger check to a warning and let the engine be the authority. Option (a) is cleaner but couples SQL to engine logic. **Decision required before merge.**

### Risk 3 — Player client forging `dmDiscount`
**Valid.** The “locked-award trigger” only watches `award` totals. If the player save path allows arbitrary event types, a malicious (or buggy) client could append `dmDiscount`.  
*Fix*: ensure the player save function/trigger has an **allow-list** of event types and `dmDiscount` is *not* on it. The plan should name that function (`player_save_character_log`?) and add the check to the migration.

---

## 8. Flag on Risk 1 (decided)

**No objection.**  
Treating discounts like drawback refunds for the creation ceiling (`threshold + drawbackBonus + discount − spent`) means a 100% discounted purchase during creation:
- raises `spent` (AP value) → may trip the creation lock (intended),
- raises `discount` → raises ceiling by same amount → player’s *own* budget unchanged.

This is exactly what B1 + F1 ask for. The logic holds.

---

## 9. Summary verdict

| Criterion | Pass? | Notes |
|-----------|-------|-------|
| Goal achieved | ✅ | |
| Assumptions solid | ⚠️ | Rounding, `refVal`, ledger object type, player-save allow-list need closure |
| Alternatives weighed | ✅ | |
| Scope complete | ⚠️ | Missing items in §4 must be added before implementation |
| Verification checkable | ✅ | (given repo access) |
| Single plan appropriate | ✅ | Extract decision record as side artefact |

**Recommendation:** **Approve with conditions** — close the gaps in §4, resolve Risk 2 (ledger vs. engine), and harden Risk 3 (player-save allow-list) in the migration. Once those are in the plan text, it’s ready to build.
# Implementation spec — `feat/campaign-ap-budget-enforce`

**Task:** Block cloud save for campaign-bound characters over AP budget.
**Design status:** Fully settled in the task entry — this spec is the build brief;
the implementer should not need to re-derive anything.
**Effort:** high · **Risk:** medium (client-side only, no data loss, no
security/trust boundary; a git revert fully undoes it).

---

## Goal

Add a per-campaign `rules.enforceApBudget` toggle (default **on**) that blocks a
campaign-bound character's **cloud** save (manual "Save to cloud" **and**
autosave) once `compute()`'s `remaining < 0`. **Local file "Save to file" is
never affected.** DM Console gets a lock-guarded toggle matching the existing
"ignore player-entered AP" UI **exactly**.

---

## Design (settled — do not re-litigate)

### 1. Setting location & default
- Key: **`rules.enforceApBudget`** (boolean) inside the campaign's **existing
  `rules` jsonb blob** — **NOT** a new `campaigns` column. No migration, no RLS
  change.
- Default **`true`** when absent/unset — the **opposite** default from
  `ignore_player_ap`.
- Read/write via the existing `setCampaignRules()` read-modify-write-the-whole-blob
  path (`js/campaign.js`), same as `houseRules` / `levelBudgetCurve` already do.

### 2. Enforcement is CLIENT-SIDE ONLY — deliberately
Matches `validate()`'s existing banned-item enforcement (also client-side-only
today). True DB-level enforcement would mean reimplementing `compute()`'s AP
pricing maths in SQL, which violates the hard rule that **`js/engine.js` is the
only place rules logic lives**. **Do not build a Postgres-side check.**

### 3. Exact blocking condition
Block only the **cloud** save path (Cloud menu's "Save to cloud" + cloud
autosave) — **never** the Local "Save to file" action (a personal backup, not
DM-visible). Block **when all three hold**:
- the character's `campaign_id` is set, **AND**
- that campaign's `rules.enforceApBudget` is **true-or-absent**, **AND**
- `compute()`'s `remaining < 0`.

`compute()` itself needs **no change** — `remaining < 0` already means "over
budget". All new logic lives at the **save call sites** plus the **DM Console
settings UI**.

### 4. Two blocked-save behaviours
- **Manual "Save to cloud" while blocked:** show a clear message explaining why
  ("over budget by N AP; DM has budget enforcement on").
- **Autosave while blocked:** **skip the push silently after one warning** —
  mirror the existing `_cgConflictWarned` one-notice-per-session pattern — rather
  than erroring on every debounce cycle.

### 5. Both tools
Apply to **CharGen** (`onSaveClick()` / `_cgCloudPushOnce()`) **and Live Sheet's**
equivalent cloud-save handlers. **Not DM Console** — it has no save path of its
own (read-only roster/awards).

### 6. Grandfathering
Turning the setting **on must never** retroactively touch, hide, or revert an
already-over-budget character — it only blocks that character's **next** save
attempt.

### 7. DM Console UI — copy the existing pattern verbatim
Copy the **"ignore player-entered AP"** lock pattern exactly
(`tools/DM-Console.html`): a **disabled checkbox** + a **separate lock/unlock
toggle button** + a **`confirm()` dialog** on change + **auto-relock after every
attempt**, success or failure. Place the new toggle **alongside** it.

---

## Test plan (differential regression)

Add to `testing/scripts/` matching the existing `sync-*-ci.mjs` pattern. Prove
each case, and prove the test fails against the pre-fix code before trusting it:

| # | Setup | Expected |
|---|---|---|
| 1 | campaign-bound, **over** budget, `enforceApBudget` **on/absent** | cloud save (manual **and** autosave) **refused** |
| 2 | campaign-bound, over budget, `enforceApBudget` **explicitly false** | cloud save **succeeds** |
| 3 | campaign-bound, **under** budget, setting on | cloud save **succeeds** (never blocked) |
| 4 | **non-campaign** character, over budget | cloud save **succeeds** (never blocked) |
| 5 | any of the above | **local "Save to file" always succeeds** |
| 6 | already-over-budget character, setting flipped **on** | character is **not** altered/hidden/reverted; only its **next** save is gated |
| 7 | blocked autosave debounce loop | **one** warning, then silent skips — not an error per cycle |

`compute()` is unchanged, so `testing/tests/engine-parity.html` must still report
**0 failed** and `DATA.version` must **not** move.

---

## Done when
- A campaign-bound, over-budget character's cloud save (manual and autosave) is
  **refused** when `rules.enforceApBudget` is true-or-absent, **succeeds** when
  explicitly `false`, and local file Save is **never** affected either way —
  verified by the new differential test.
- DM Console's new toggle uses the **same lock/confirm pattern** as "ignore
  player-entered AP".
- `testing/tests/engine-parity.html` still **0 failed** (compute() unchanged).

## Notes for the implementer
- No `DATA.version` bump, no migration, no RLS/advisor step — this is a
  save-call-site + settings-UI change only. Log it in CHANGELOG.
- Because enforcement is client-side, it is an **honesty aid for the player and a
  convenience gate for the DM**, not a security control. If server-side
  enforcement is ever wanted, it belongs with the
  `security/privilege-and-character-integrity` audit, not here.

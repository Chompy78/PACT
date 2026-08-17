# D-GH-<date>-dm-edit-events

**Status:** Design decided (owner rulings, 2026-08-05). Records the settled model
for `feat/dm-edit-events`. **This record is the "open questions answered in a
decision record" half of that task's *Done when* — the code half remains open and
is blocked on `feat/chargen-dm-view` and `fix/buyoff-keyed-by-event`.**

> ⚠ **Blocker status caveat (verify before sequencing).** `fix/buyoff-keyed-by-event`
> is referenced here as a `(NOW)` task, but the provided `TASK_BOARD_NOW.md` is
> **empty** — it lists no open tasks, and this fix is not in any board's
> completed-work list either. So its status can't be confirmed from the three
> board files alone. Before treating it as a hard blocker, check `CHANGELOG.md`/git
> branches: if it's **done**, this task's boon-removal half is unblocked now; if
> it's **missing**, it needs writing into NOW first. See `BLOCKER-REGISTER.md`.

**Scope:** DM edits are **add boons/remove boons** and **impose drawbacks** on a
campaign-bound roster character — *not* a general editor.

---

## The one-line rule everything else falls out of

> **A DM edit moves the character's power level without touching their wallet.**

A player is never richer or poorer for a DM edit. Implement it as a single
invariant — **a `dmEdit` event contributes 0 to the player's spendable AP** — and
every specific case below is that invariant applied to a different sign.

| DM action | normally | to stay AP-neutral |
|---|---|---|
| adds a boon | costs AP | grant matching **bonus AP** — net 0 |
| adds a drawback | *grants* AP | **suppress** the AP grant (record at cost 0) — net 0 |
| removes a player's boon | — | **no refund**; power drops, wallet unchanged |

---

## Settled rulings

### 1. Neutrality is ONE invariant, not two rules
`economy().available` **before == after** for any DM edit. Assert it directly.
Boons and drawbacks are not special cases — they are opposite signs of the same
rule.

### 2. Drawbacks are **ADD-only** for the DM
> "The DM should not remove drawbacks — instead they should just award the APs to
> let the player do it themselves."

- The DM **imposes** a drawback by recording the buy event at **cost 0**.
  Verified this needs **no engine change**: the power-level hit comes from the
  drawback being in the build (priced by `compute()` against the rules table),
  the AP handout from the event cost — the two are already independent.
  - drawback worth 2, player takes it normally → spendable 81 (+2), power −2.
  - drawback worth 2, **DM imposes (cost 0)** → spendable **79 (unchanged)**,
    power −2.
- To let a player *out* of a DM drawback, the DM **awards AP** (existing
  mechanism) and the player uses the **ordinary buy-off path**. The DM never
  reaches in and deletes.

#### Two INDEPENDENT removal settings live on the drawback **event**
> "One state is locked or unlocked for removal. The second is the actual removal
> cost which is either flat or expensive."

- **Locked / unlocked** — can this drawback be removed at all?
- **Removal cost, when unlocked** — **flat** (table value, e.g. 2) or
  **expensive** (3× table value, e.g. 6). **Flat is the default.**
- Even when unlocked, the player always spends AP to remove it — there is no free
  removal.

**Why flat is the default** (it differs from today's 3×, so record the reason):
the 3× penalty exists to deter treating a drawback as a cheap AP loan then buying
out. A DM-imposed drawback was never a loan, so under a flat 3× the arithmetic
*inverts* — the punished player ends worse off than the one who gamed the system:

| drawback worth 2 | got | pays to remove | net |
|---|---|---|---|
| chose it, then bought out | +2 | −6 | **−4** |
| DM imposed it, removed at 3× | 0 | −6 | **−6** |

Flat removes that: you lost 2 AP of power, you spend 2 to get it back, one-for-one.
Expensive stays available for a DM who wants the drawback to bite.

`buyoffDrawback(v)` (Live Sheet ~:603) currently reads only `DATA.drawbacks` and
hardcodes `refund*3`, so it must consult the **LOG** for both flags. A locked
drawback refuses **with a stated reason**, never a hidden button.

### 3. Removing a boon — the DM **can**, and the player **loses the AP**
> "The DM can remove the player-bought boon and the player effectively loses the
> AP." No refund, whether the DM granted it or the player paid.

Consistent with neutrality: the player already spent the AP; not refunding means
spendable is unchanged while power drops by the boon's value.

**The obvious implementation is wrong.** Removal must **NOT** delete the original
buy event — deleting *refunds* the AP:

| 25 AP boon | spent | available | power |
|---|---|---|---|
| player bought it | 25 | 75 | 25 |
| if the buy event were **deleted** | 0 | **100** | 0 |

Removal must **suppress the boon in the fold while leaving its cost in `spent`**.
Shape it like `buyoff` (`activeEvents()` collects it, `_replay()` skips it) **but
with a different economy rule**: skip it in `_replay`, and leave `_spendCost()`
alone so the AP stays spent. This is genuinely different from drawback buyoff
(which removes both the effect *and* the AP) — do not reuse that branch verbatim.
There is **no boon-removal path in the engine today** (`MUT.boon` only pushes),
so this is the **one part of the task that touches `js/engine.js`**.

### 4. The event is **never deleted**; the boon can be bought again
> "It should not delete the event, it should always show they did buy it, but then
> they lost it. They can buy it back again."

The log reads as history — bought, lost, bought again — each purchase paid for
separately. Removal suppresses **one specific purchase**; it does not blacklist
the boon.

> ⚠ **Blocked on `fix/buyoff-keyed-by-event` (NOW).** Today `boughtOff` is keyed
> by the drawback's **name**, so it suppresses *every* purchase of that value,
> including later ones (measured: buy → buy off → re-take → the retake is silently
> dropped and earns no AP). A boon removal keyed by name would inherit the
> identical bug against the explicit "buy it back again" requirement. That fix
> **must land first.**

### 5. The player cannot undo a DM edit
Copy the existing precedent, don't invent one: an **award event acts as an undo
barrier** in the Live Sheet (~:611, "AP awards lock your history"). A DM-marked
event behaves the same. **CharGen needs its own guard** — its undo restores
whole-LOG snapshots rather than popping the last event, so the two tools do not
share a mechanism here.

### 6. Both tools' ledgers render a DM-marked event **distinctly**
The whole point is that the player can see what their DM changed. Also fold the
**buy-off ledger gap** into `feat/ledger-show-lost-purchases`, not here: a
drawback bought for 2 and bought off for 6 currently produces **no** AP-ledger
line for the 6 AP, so the categorised breakdown and `spent` disagree by the whole
buy-off. Solve it once, there.

### 7. Concurrency — recommendation **B**, decoupled
Handled by its **own** tasks (`fix/optimistic-character-save` NOW,
`feat/character-log-merge` LATER), so this task must only **not fight** them.
Of the four routes, the recommendation is **B — optimistic check on
`updated_at`**: the column already exists and is already selected
(`js/sync.js:172`); read it on open, send it with the write, reject if it moved,
tell the DM to reload.
- **A (last-write-wins)** silently destroys the first save — not acceptable for a
  DM writing to a character its owner may have open.
- **C (merge the two logs)** is the *real* end-state for this data model, but it
  is the separate `feat/character-log-merge` task; **B does not block C later.**
- **D (lock while a DM has it open)** needs presence tracking and fails badly
  offline.

### 8. RLS
A DM writing to a character they do not own is a **policy change**. After it, run
the Supabase advisor (`get_advisors`) and skim `get_logs` before opening the PR —
this project has been bitten twice by grant/RLS drift (D-GH15, D-GH12).

---

## Marker shape (recommended)
A **field on the event** (e.g. `dmEdit: {by, at}`) rather than a new event type,
so every existing replay path keeps working untouched. Validate it against
`economy()` / `_replay()` / `_spendCost()` before committing.

## Sequencing (for the code half — out of scope for this record)
1. `fix/buyoff-keyed-by-event` (NOW) — must land first.
2. `feat/chargen-dm-view` (NEXT) — the read-only/copy view; this task is blocked on it.
3. Then `feat/dm-edit-events` implementation.

## Done when (this record's slice)
The rulings above are recorded so the next agent implements against a fixed
design rather than re-deriving it. The task's overall *Done when* (working
add/remove in both tools, DM-marked rendering, passing RLS advisor) remains open.

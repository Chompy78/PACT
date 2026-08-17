# Sync & tool implementation approaches (4 tasks)

Implementation approaches for the four tool/sync tasks. Coding + tests need the
actual tool files, so each ends with the exact local verification. Not committed.

---

## 1. `feat/chargen-dm-view` — DM views a campaign character in CharGen

Today there is **no route at all**: DM Console's roster card offers only "View in
Live Sheet"; CharGen has **no `viewChar` handler** (zero matches). The Live Sheet's
"Open in CharGen" button is deliberately hidden in read-only mode because CharGen
has no read-only concept and would happily edit and persist another player's
character.

### Recommended approach — hand the DM a COPY, not a locked view (owner, 2026-08-05)
> "Have a duplicate of the character automatically created in the background that
> the DM can look at… no risk of damaging the actual original."

**Build the COPY approach first.** It's better on every axis:
- **Safe by construction, not by vigilance** — the read-only route needs *twelve*
  mutation entry points gated correctly and stays correct only while every future
  edit path remembers the flag. A copy with its own id can't touch the original no
  matter what CharGen does.
- **Much less code** — no `CG_VIEW_ONLY`, no guards, no hide-list.
- **More useful** — "what if I gave them this boon?" is a real campaign-start
  question a locked view can't answer.
- **Sidesteps the re-pricing trap** — a scratch copy showing today's reconciled
  ledger is unremarkable, whereas the same numbers labelled "the player's character"
  read as a bug.

**THE ONE SEVERE HAZARD — the copy MUST get a fresh `genCharId()`.** The handoff
envelope carries the original's id and CharGen adopts whatever id it's handed
(`currentCharId()`, `_cgApplyEnvelope`). A copy that keeps the original id is not a
copy — it's the DM's browser autosaving and cloud-saving over the player's
character. **Assert the new id differs from the source id in the gate** — this is the
single thing most likely to be got wrong and it destroys player data when it is.

**Housekeeping to decide before building:**
- **Where does the copy live** — DM's local storage only, or their cloud list?
  Recommendation: **local-only** for a scratch copy (vanishes on another device,
  which is fine for "look at it at campaign start"); cloud means it shows among their
  own characters and needs clear labelling.
- **Naming:** unmistakable, e.g. *"Anders Tealeaf (DM copy)"*.
- **Must NOT be campaign-bound** — a save could otherwise write into the campaign's
  roster.
- **Do copies accumulate?** Recommendation: overwrite-per-source, so checking six
  characters doesn't leave six copies.
- **It's a snapshot** — stale if the player edits after. State that in the UI.

### Fallback — read-only route (build only if the copy approach is rejected)
Copy the Live Sheet's shape: its `VIEW_ONLY` flag no-ops emit/save/undo/redo —
*that* is the safety; hiding buttons is cosmetic. **CharGen's guard surface is larger
than the Live Sheet's** — all of these mutate the LOG or persist it and all need
gating at the function head:
`emit()` · `replacePatchSlot()` · `retractFlatEvent()` · `replaceWholeLogFromBuild()`
· `_cgSyncSingletonEvent()` · `undo()` · `redo()` · `resetBuild()` · the local
autosave · and the **three** `S.saveCharacter(...)` call sites (~:770, ~:800, ~:1011).

**Two traps specific to CharGen (matter for the fallback; mooted by the copy):**
- **Boot regenerates the log from the DOM** (`applyBuild → replaceWholeLogFromBuild`)
  and re-prices a draft via `repriceDraft()` — so a DM would see a *reconciled*
  ledger, not the frozen one the player sees. Decide whether to label, suppress, or
  show both.
- **Use `peekCharacter()`, not `loadCharacter()`** — `loadCharacter()` caches into
  localStorage with no ownership check (the exact
  `D-GH-2026-08-02-listmycharacters-local-cache-leak` mechanism). Confirm
  `peekCharacter()` (`js/sync.js:172`) can't serve a stale local copy.

**Verify locally:** for the copy — a DM opens a roster character in CharGen from DM
Console, the copy has a **fresh id asserted ≠ source id**, is not campaign-bound, is
labelled a DM copy, and is fetched without caching into the DM's local storage. The
cloud half needs a manual signed-in check — say so in the PR. `engine-parity` still
0 failed; no `DATA.version` change.

---

## 2. `feat/dm-edit-events` (code half) — DM edits recorded as DM-marked log events

**Design is fully settled** — see the decision record already drafted in the "can
do" zip (`02-dm-edit-events-decision.md`). This is the code approach only.

**Blocked on two things landing first:**
1. `feat/chargen-dm-view` (above) — build the view first.
2. `fix/buyoff-keyed-by-event` (NOW) — a boon removal keyed by name would inherit
   the buyoff-keyed-by-name re-buy bug against the explicit "buy it back again"
   requirement. **⚠ But `TASK_BOARD_NOW.md` is empty — this fix's status is
   unverifiable from the boards; confirm via `CHANGELOG.md`/git (see
   `BLOCKER-REGISTER.md`).**

**The single invariant to implement:** a `dmEdit` event contributes **0** to
spendable AP. Assert `economy().available` before == after for any DM edit.

**Marker shape (recommended):** a **field on the event** (e.g. `dmEdit:{by,at}`)
rather than a new event type, so every existing replay path keeps working untouched.
Validate against `economy()`/`_replay()`/`_spendCost()` before committing.

**The only part touching `js/engine.js` — boon removal.** It needs an event that
**skips the boon in `_replay()` while leaving its cost in `_spendCost()`** (so the AP
stays spent, power drops, wallet unchanged). Shape it like `buyoff` but with a
different economy rule — do NOT reuse the drawback branch verbatim (that removes both
effect *and* AP). There is no boon-removal path today (`MUT.boon` only pushes).
**Verify against a fixture that `spent` and `available` are UNCHANGED and only power
moves** — the naive "delete the buy event" gets it backwards (measured: deleting a
25 AP boon refunds it to 100 available).

**Drawbacks are ADD-only, at cost 0** — needs **no engine change**: power hit comes
from the drawback being in the build, AP handout from event cost, and the two are
already independent. Two flags on the drawback event (locked/unlocked;
flat/expensive), so `buyoffDrawback()` (Live Sheet ~:603) must consult the LOG, not
just `DATA.drawbacks`. A locked drawback refuses **with a reason**, never a hidden
button.

**Undo barrier:** copy the award-event pattern (Live Sheet ~:611). **CharGen needs
its own guard** — its undo restores whole-LOG snapshots, not LIFO pops.

**Both tools' ledgers render a DM-marked event distinctly.** Fold the buy-off
ledger-line gap into `feat/ledger-show-lost-purchases`, not here.

**RLS:** a DM writing to a character they don't own is a policy change — run
`get_advisors` and skim `get_logs` before the PR (D-GH15/D-GH12 drift history).

**Verify locally:** DM can add/remove boons and impose drawbacks on a roster
character; each change recorded as a DM edit and rendered as such in both tools; the
neutrality invariant asserted; RLS advisor clean; `engine-parity` unchanged.

---

## 3. `fix/autosave-flush-latest-push` — flush doesn't wait for the freshest edit

`_cgFlushCloudSaveNow()` (CharGen) and its twin `_lsFlushCloudSaveNow()` (Live Sheet)
don't wait for the freshest pending edit when a push is already in flight, and
neither the flush nor its retry use `withKeepalive` — so a deliberate tool-switch
navigation (`switchToLiveSheet()`/`switchToCharGen()`) can outrun the save it was
added to guarantee. **Two independent copies of the same pattern — fixing one does
not fix the other.**

**Root cause (reproduce first):** user edits while an earlier debounced push is in
flight, then immediately switches tools. `_cgFlushCloudSaveNow()` calls
`_cgCloudPush()`, which in the busy branch just sets `*SaveAgain=true` and returns the
**OLD in-flight promise** — not one representing the newer edit. The `Promise.race`
resolves on that stale push, the switch navigates away, and the retry carrying the
actual latest edit fires later from the old push's `.finally()` — **without
keepalive**.

**Fix direction:** `_cgCloudPush()`/`_lsCloudPush()` must return a promise that
resolves only once the **LATEST queued push** (not just "a" push) has completed, so
the flush's `Promise.race` waits on the right thing. The `.finally()`-triggered retry
should go through `withKeepalive` too, since it can fire after navigation starts.

**Verify locally:** write a differential regression test in `testing/scripts/`
matching `sync-concurrency-ci.mjs`'s pattern that reproduces
overlapping-push-then-navigate and **fails on the pre-fix code**; confirm the flush
waits for the LATEST edit's push with keepalive on any post-navigation retry; apply
to **both** tools; `engine-parity.html` still 0 failed. (Local autosave never loses
the edit — only the cloud copy can lag until reconnect — so this is
availability/correctness of the cloud copy, not data loss.)

---

## 4. `fix/reconcile-push-inflight-tracking` — reconcile() bypasses `_pushInFlight`

`js/sync.js`: `reconcile()`'s `localNewer` branch calls `pushCharacter(local, …)`
directly **without** `_pushInFlight.add()/delete()` — unlike `saveCharacter()`, the
only other `pushCharacter()` caller, which tracks it. While that push runs (at boot
or during `syncAll()`/reconnect), `getSyncState(id)` for the same id can't see it and
falls through to dirty/conflict/idle on stale flags instead of the documented
**SAVING** precedence — so a status chip refreshed in that window shows a
wrong/flickering state until `applyServerMeta()` catches up. **Display-only, one
obviously-right fix.**

**Fix:** wrap `reconcile()`'s `pushCharacter()` call exactly as `saveCharacter()`
does — `_pushInFlight.add(id)` before the call, `delete(id)` in a `finally`.

**Verify locally:** add a test that starts a `reconcile()`-triggered push and checks
`getSyncState()` mid-flight reports **SAVING**, not a stale dirty/conflict/idle read;
`testing/scripts/sync-state-machine-ci.mjs` still 0 failed.

---

## Suggested order across these four
1. `fix/reconcile-push-inflight-tracking` — lowest risk, display-only, no deps.
2. `fix/autosave-flush-latest-push` — contained, both tools, has its own gate.
3. `feat/chargen-dm-view` (copy approach) — unblocks #4.
4. `feat/dm-edit-events` — after #3 **and** `fix/buyoff-keyed-by-event` (NOW).

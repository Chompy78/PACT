# D-GH-2026-08-10-dm-edit-events — a DM adds/removes boons and drawbacks, recorded as a DM edit

Status: **Active**, 2026-08-10.

## Context

The owner (2026-08-05) wanted to eventually edit a campaign character — particularly adding/removing
boons and drawbacks — but explicitly *"as an edit to the save file log that states it is a DM edit,"*
not a silent overwrite. Blocked on `feat/chargen-dm-view` landing first (it did, 2026-08-10). Almost all
of the product-level design was settled by the owner across several 2026-08-05 exchanges (recorded on the
task board and summarized under Decision below); this record captures the *implementation* decisions that
board entry left open, made in this session.

## Decision — product shape (owner, 2026-08-05, implemented as specified)

- **Neutrality invariant:** a DM edit never changes the player's spendable AP — `economy().available`
  before == after, for every DM edit. A granted boon costs AP normally AND grants matching bonus AP (net
  0); an imposed drawback costs the player 0 AP instead of the normal drawback refund (net 0, no engine
  change needed — see below).
- **Undo barrier:** the player cannot undo past a DM edit, mirroring the Live Sheet's existing AP-award
  barrier exactly.
- **Drawbacks are ADD-only.** The DM never removes a player-taken or DM-imposed drawback directly —
  instead they award AP (the existing `award_ap()` path, no new mechanism) and the player buys it off
  themselves. A DM-imposed drawback carries two independent flags: locked/unlocked (can it be bought off
  at all) and flat/expensive removal cost (the table value once, or the existing 3×) — flat is the
  default, since the 3× deterrent exists to punish gaming a "cheap AP loan," which doesn't apply to a
  drawback the player never chose.
- **Boons can be added AND removed, with no refund on removal.** The player keeps the AP they spent (or
  the DM granted); their power level just drops. The purchase event is never deleted — it stays visible
  in history, and the boon can be bought again later (requires the FIFO-by-purchase matching this
  decision reuses from `D-GH-2026-08-06-buyoff-keyed-by-event`, not name/value matching, which would
  reintroduce that exact bug for boons).

## Decision — implementation (this session)

**1. Engine (`js/engine.js`) — the ONE part of this feature that touches it, as the task doc predicted.**
`activeEvents()` gained a second FIFO-by-value resolution map, `boonRemoved`, built with the identical
pattern `boughtOff` already uses for drawback buyoffs — a `dmRemoveBoon` event (carrying `refVal`, the
boon name) cancels the oldest still-open purchase of that value. `_replay()` skips a removed boon's
`MUT.boon` call (so it drops out of the build) but does **not** touch `_spendCost()` for it — its cost
was already counted at buy time and stays counted, since removal is not a refund. No change to
`economy()`/`_economyFrom()` was needed for either boon removal or DM-imposed drawbacks: a drawback
buy's cost field already IS the amount it grants (`drawbackEarned += -cost`), so recording it at `cost:0`
achieves neutrality with the existing formula; a `dmRemoveBoon` event isn't `award`/`buy`(non-drawback)/
`buyoff`/`names`, so `_spendCost()` already returns 0 for it with no new logic. **`DATA.version` is NOT
bumped** — no existing fixture contains a `dmRemoveBoon` event (the type didn't exist before), so
`boonRemoved` is always empty for every pre-existing log and `compute()`'s output is unchanged for all of
them (verified: all 30 fixtures still pass with their existing expected values). New fixture `EV-018`
pins the mechanism (buy → remove → re-buy: build holds it once, `spent`/`earned` count both real
purchases, the removal contributes to neither).

**2. New RPC — `dm_edit_character_log(character, events)`, SECURITY DEFINER.** `characters_update`'s row
policy is owner-only in both `USING` and `WITH CHECK`; a DM had no write path onto a player's `stats`
column at all, unlike `ap` (`award_ap()`) or `campaign_id` (`dm_unbind_character()`). This is the same
bypass pattern, extended to `stats`. Design choices:
- **A JSON array, not one event per call** — a DM-granted boon needs its matched `[buy, award]` pair to
  land in the *same* atomic write, or there is a real, if brief, moment where the character has spent
  more with nothing earned to offset it.
- **The server stamps `seq`/`ts`/`dmEdit`/`dmId`, discarding whatever the client sent for them.** This is
  what makes `dmEdit:true` a trustworthy marker for a *different account's* edit — the calling DM cannot
  forge who made it, when, or where in the log it lands. (A character's own owner already has direct
  column-level `UPDATE` on their own `stats` and could self-forge the same marker on their own character
  regardless of this function — a pre-existing, unrelated capability, same class as hand-editing a local
  JSON export.)
- **A server-side type/cat allowlist** (`buy`/cat `boon` or `drawback`, `award`, `dmRemoveBoon` — nothing
  else) enforces "not a general editor" independently of the client, since a DM is otherwise fully
  trusted with AP amounts via `award_ap()` already and this is about keeping the new write path narrowly
  scoped, not a trust boundary on top of that.
- **Compatibility with the AP-integrity triggers** (`D-GH-2026-08-10-campaign-ap-log-integrity`, already
  live) verified by reading `pact_ap_ledger_spend` directly before writing this: a boon grant's buy+award
  pair moves both `spent` and `earned` by the identical amount (net 0, never trips the over-budget
  check); a DM-imposed drawback (`cost:0`) moves neither; `dmRemoveBoon` isn't summed by that trigger at
  all, matching `js/engine.js`'s own treatment of it exactly.

**3. Client wiring.** `js/dm.js` gained `dmEditCharacterLog()`, bridged into DM Console's `_campBridge`.
DM Console's roster card DM-tools section gained three controls (grant a boon, remove a boon — only shown
when the character currently holds one, impose a drawback with locked/removal-cost flags), all gated
behind the same archived-campaign-peek write-block every other DM-tools action already uses. A successful
edit triggers a full roster reload (`window._dmReloadRoster`, a new cross-closure bridge mirroring
`window._dmRenderCloudRoster`'s existing pattern) rather than a local field patch — a DM edit changes the
folded *build* (which boons/drawbacks exist), not one number the way Award AP does, so the card, the
remove-boon dropdown, and the AP strip all need a real re-analysis to stay consistent together.

**4. Ledger rendering — both tools, to the extent each tool has a per-event history to mark.** The Live
Sheet's History & ledger renders every `dmEdit`-flagged row with a left border + a "🛡 DM" badge; a
locked DM-imposed drawback shows a lock instead of a buy-off button (refused with a stated reason, not
hidden); `buyoffDrawback()` now consults the matched purchase's own `dmLocked`/`dmRemovalCost` flags
(reading the LOG via a new `_openDrawbackEvent()` helper) rather than always charging the unconditional
3× — an ordinary player-taken drawback is unaffected (regression-guarded). **CharGen does not render a
per-event DM marker** — verified it has no per-event history view at all (its `renderLedger()` shows
`compute()`-derived *categorized* lines with itemized names, not raw LOG events), and building one, or
threading a DM flag through `compute()`'s `itemize` output, would be a *second* engine touch point beyond
the one the task doc explicitly scoped ("the ONE part of stage 2 that touches `js/engine.js`"). Recorded
as an accepted scope boundary, not a gap — a DM edit is fundamentally an in-play concept and the Live
Sheet is where a played character's history lives.

## Verification

`testing/scripts/engine-parity-ci.mjs`: 30/0 (new fixture EV-018 pins the boon-removal mechanism; every
pre-existing fixture's expected values are unchanged, confirming no `DATA.version` bump was needed).
`testing/scripts/tool-pricing-ci.mjs`: 113/0, covering — `buyoffDrawback()`'s three rate paths (flat,
expensive, locked-refusal) plus the unconditional-3× regression guard for an ordinary drawback; ledger
rendering of DM-marked buy/award/dmRemoveBoon rows and the locked-drawback display; both tools' undo
barriers refusing on a trailing `dmEdit` event while still undoing an ordinary purchase normally; all
three DM Console controls rendering and calling `dm_edit_character_log` with the exact expected event
shape (mocked bridge); the archived-campaign-peek write-block covering all three new buttons the same as
the existing Award AP/notes/unbind actions. Migration applied to the live Supabase project; `get_advisors`
confirms `dm_edit_character_log` carries the same expected WARN class every other authenticated-only
SECURITY DEFINER RPC in this schema already has (21 total), not a new finding; grants verified directly
via `information_schema.routine_privileges` (`authenticated` + owner only); a live call against a
nonexistent character id confirmed the guard chain executes cleanly through to the expected "Character
not found" rejection. **Not verified in this session:** a full live end-to-end (real DM account, real
player character, real concurrent access) — this needs two distinct authenticated sessions, which this
environment cannot simulate; the RPC's `for update` row lock plus the existing `updated_at` trigger
should compose correctly with the player-side optimistic-save check
(`D-GH-2026-08-07-optimistic-character-save`) by construction (any DM-edit write bumps `updated_at`,
which the player's own next save already checks), but this composition was reasoned through, not
observed live.

## Related

- `feat/chargen-dm-view` (`D-GH-2026-08-10-chargen-dm-view`) — the blocker this was waiting on.
- `D-GH-2026-08-06-buyoff-keyed-by-event` — the FIFO-by-purchase pattern `boonRemoved` mirrors.
- `D-GH-2026-08-10-campaign-ap-log-integrity` — the AP-integrity triggers this RPC's writes were verified
  compatible with.
- `feat/ledger-show-lost-purchases` — still owes the Live Sheet's *AP Ledger* panel (not History &
  ledger, already done here) showing a bought-off drawback's buy-off cost and a removed boon's lost
  value; explicitly deferred there rather than solved twice, per that task's own note.

## Addendum (2026-08-10, pre-merge review) — a removed boon's History row never went dead

Found by `/code-review ultra` on the promotion PR: the Live Sheet's History & ledger table only ever
checked `boughtOff` (drawbacks) when deciding whether a `buy` row should render as cancelled (`.dead`).
A removed boon's original purchase row kept normal, fully-priced, apparently-still-active styling — the
only visible sign anything happened was a separate `dmRemoveBoon` row further down with no visual link
back to the purchase it cancelled. Fixed by reading `activeEvents(idx).boonRemoved` alongside `boughtOff`
in the same `dead` check, mirroring the exact FIFO-by-purchase semantics already in place for drawbacks
(a retake after the removal correctly stays live — same guarantee `D-GH-2026-08-06-buyoff-keyed-by-event`
established for drawbacks). No engine change — `boonRemoved` already existed on `activeEvents()`'s
return; only the tool-side row-styling check was missing it. `tool-pricing-ci.mjs` gained 1 check
(125/0 total); `engine-parity-ci.mjs` unaffected (display-only, no `_replay()`/`compute()` change).

**Deliberately NOT fixed in this pass, flagged instead:** the same review also raised that
`dm_edit_character_log()` never cross-validates a DM-granted boon's paired `buy` cost against its `award`
amount — the "always net 0" neutrality invariant is enforced by DM Console's client code always sending
the pair together, not by the RPC itself. The migration's own header comment (see the SQL file) already
names this explicitly as an accepted trade-off, on the reasoning that `award_ap()` already lets a DM grant
arbitrary AP through a separate, existing path — so this isn't a NEW privilege, just a second route to one
that already exists. Left as-is rather than expanding this PR's scope with a new migration; logged as a
follow-up task (see `CHANGELOG.md`'s entry for this addendum) for whoever picks it up to weigh whether
server-side cross-validation is worth adding anyway, independent of whether it's technically a new hole.

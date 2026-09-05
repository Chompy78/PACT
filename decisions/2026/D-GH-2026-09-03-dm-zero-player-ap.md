# D-GH-2026-09-03-dm-zero-player-ap — Player AP gets a DM reset, and a database-level ceiling once ignored

Status: Active. Shipped 2026-09-03. No `DATA.version` change — the engine is untouched; this adds a
purpose-built RPC and one new trigger, mirroring `dm_set_creation_ceiling`'s own shape.

## Context

A DM asked "how did Archer gain 127 Player AP in the Amble campaign?" while investigating why a copy
of a player's character showed different spellcasting slots than the player's live sheet. The 127 had
nothing to do with the campaign's own AP awards — Archer's DM-granted total (`characters.ap` /
`ap_awards`) was 70, matching five recorded grants exactly. The 127 was **Player AP**: CharGen's own
freely player-editable "Budget" field, stored as `award`-type events summed by `economy()` — a pool
`compute()` treats as structurally separate from DM-granted AP (see `js/engine.js`'s two-pool model,
just above `baseBuild()`).

A live audit of all six Amble-bound characters found the pattern was not isolated to Archer: Anders
Pipeleaf carried 79, Caspian 27. Amble already had **`ignore_player_ap = true`** set — the DM had
already told the engine "my awards are the only source" — yet the raw figure was still sitting in three
characters' logs, and DM Console's "Copy to CharGen" sandbox (`feat/chargen-dm-view`) does not re-fetch
that campaign setting by documented design, so a DM inspecting a copy saw the uncapped number in full.

Two separate gaps, once named:
1. **No way to correct an existing inflated figure.** Nothing let a DM zero it without rewriting the
   character's log by hand.
2. **No enforcement that it could not grow again.** `ignore_player_ap` was read-side only —
   `pact_enforce_ap_budget_consistency` (2026-08-10) already excludes it from the *spendable* ceiling
   check, but nothing stopped the underlying award total itself from rising, in the database, by any
   write that touched `stats`.

## Options

- **A1 — display-only fix.** Patch "Copy to CharGen" to also fetch and honour `ignore_player_ap`, so
  every read path agrees. Cheap, but leaves the actual number free to keep growing in the database; the
  next code path that forgets to apply the flag (exactly what already happened once) silently counts it
  again.
- **A2 — hard database ceiling.** *(chosen)* A new trigger that refuses to let a character's own
  (non-DM) award-event sum increase once its campaign has `ignore_player_ap` on, plus a purpose-built
  RPC so a DM can zero an already-inflated figure. Closes the gap at its root — the number itself cannot
  grow — at the cost of one more trigger in a layer that already carries two related invariants, so it
  needed checking for interaction, not just addition.

**A2** was chosen: the request was explicitly "a way for it to not increase," and a read-side-only fix
would keep leaving that promise resting on every future caller remembering to apply it correctly, which
is the exact class of drift this project keeps paying for elsewhere (hand-written mirrors, forgotten
flags).

## Decision

**`dm_zero_player_ap(p_character uuid)`** — a purpose-built RPC, not a `dm_edit_character_log`
allowlist widening, for the same reasoning `dm_set_creation_ceiling` already gave (2026-09-01): that
function is "deliberately not a general editor," and a value computed entirely server-side needs no
JSON validation and has no bound to get wrong. It sums every existing `award`-type event in the
character's own log (never trusting a client-supplied figure) and appends ONE compensating event
carrying the exact negative of that sum, stamped `dmEdit:true` — append-only, like every other DM-log
RPC in this project, so `pact_enforce_locked_history` needs no special-casing.

**`pact_enforce_player_ap_ceiling`** — a new `before update on characters` trigger, deliberately
separate from `pact_enforce_ap_budget_consistency`. That trigger already reads `ignore_player_ap`, but
only to decide what counts toward the *spend* ceiling; it says nothing about the award figure itself.
This one compares the sum of **non-dmEdit** `award` events between `OLD` and `NEW`: if a campaign has
`ignore_player_ap` on and that sum would rise, the update is rejected outright. `dmEdit:true` events
(this RPC's own corrections, and a DM-granted boon's matched buy/award pair from
`dm_edit_character_log`) are excluded from both sides of the comparison — a DM's own actions were never
what needed guarding against.

**Exposed in DM Console's "DM tools" panel**, next to the Creation-limit controls it is styled after: a
"Zero Player AP" button, shown only when the figure is non-zero, with a confirm dialog and the same
disable/status/reload pattern as `dm-ceiling-btn`/`dm-reopen-btn`.

## Why

**Because the two pools (DM-awarded vs. player-declared) are supposed to be independent, and the DM's
control over the campaign's pool should not have a smaller guarantee than the DM's control over their
own awards.** `characters.ap` already can't be raised by anyone but a DM, by column-level grant. Player
AP had no equivalent floor once a DM had explicitly opted out of it.

**Because the fix belongs in the database, not in one more UI code path.** Every prior fix in this class
(archived-campaign write lockdown, boon-amount matching, locked-history protection) that tried to hold
an invariant only in the calling code has, at some point in this project's history, had exactly one
caller forgotten. A trigger cannot be forgotten by a new call site the way a client-side check can.

**Because the compensating-event shape matches the engine's own model of `award` as summed, not
last-write-wins.** CharGen's client-side "singleton" behaviour (filter-out-and-append) is a UI
convention, not an engine guarantee — `economy()` sums every `award` event present. Zeroing therefore
has to append a value that cancels the sum, not overwrite CharGen's one field, and it has to be computed
from the log at write time so it is correct regardless of how many `award` events actually exist.

**Known, accepted limit — not a new one.** `dmEdit:true` is a trust label, not a forgery-proof
credential: a character's owner already has direct column-level `UPDATE` on their own `stats`
(`characters_update`'s row policy) and could in principle stamp a fake `dmEdit:true` on their own row
via a raw API call. This is the identical, already-documented limitation `dm_edit_character_log`
carries on the same marker — "the same class as hand-editing a local JSON export" — and this trigger
does not attempt to close it. What it closes is the ordinary path: CharGen's Budget field, and any tool
that reads and writes the log the normal way.

## Verified against live data

Confirmed all three affected characters' `ap_awards` sums matched `characters.ap` exactly (70/72/74 for
Archer/Anders/Caspian respectively — the DM-awarded pool was never wrong), isolating the discrepancy to
Player AP alone before writing any fix. After applying the migration: ran `dm_zero_player_ap` against
all three live characters (impersonating the Amble DM via `request.jwt.claim.sub`, exercising the exact
RPC a DM's browser would call), confirmed all three now sum to 0. Then proved the new ceiling actually
holds: a direct `UPDATE` appending a plain (non-dmEdit) `+5` award event to Archer was **rejected** by
`pact_enforce_player_ap_ceiling` with the intended error, in the same session, against the live
database — not merely reasoned about. `get_advisors` afterward showed no new finding class; the two new
functions carry the identical generic "SECURITY DEFINER exposed to authenticated" info-level warning
every other DM RPC in this project already carries, and both are already revoked from `public`/`anon`
per the lesson recorded in `D-GH-2026-09-01-campaign-move-clears-creation`.

## Status

IN FORCE. `sql/migrations/2026-09-03-dm-zero-player-ap.sql` applied to the live project. Archer, Anders
Pipeleaf and Caspian all confirmed at Player AP 0. `js/engine.js` untouched — no parity re-run required.

## Related

- `sql/migrations/2026-08-10-campaign-ap-log-integrity.sql` — `pact_enforce_ap_budget_consistency`,
  the sibling trigger this one deliberately does not duplicate (spend ceiling vs. the award figure
  itself).
- `sql/migrations/2026-09-01-dm-creation-ceiling.sql` — the purpose-built-RPC pattern this follows.
- `feat/chargen-dm-view` (D-GH-2026-08-10-chargen-dm-view) — the "Copy to CharGen" sandbox whose
  documented non-live `ignorePlayerAp` is what first surfaced the gap this closes. **Patched same day**
  (follow-up, still this decision): `_cgConsumeViewChar()` now freezes the source campaign's
  `ignore_player_ap` at copy-open time, the same way it already freezes DM AP, and `_cgDmOpts()` reads
  that instead of a hardcoded `false`. Display-only — the database-level ceiling above already meant
  the stored figure could never really have grown, only been shown wrong. `drawbackCap` had the
  identical shape of gap in the same function (a capped campaign's copy showed the FULL, uncapped
  drawback grant) — closed in the same follow-up, same fetch: `rules` is frozen alongside
  `ignore_player_ap` (one call, no second network round-trip, since `drawbackCapFromRules()` is a pure
  function of the rules blob), and `_cgDrawbackCap()` now takes an optional rules override instead of
  always reading the copy's unset `window._cloudCampaign`.

# D-GH-2026-08-03-invite-grant-award-row — an invite's grant is a recorded award; a file carries the campaign binding, never the AP

Status: Active

## Context

Two gaps found while checking what happens when a player exports a cloud character to a local save.

**1. The invite grant had no provenance.** `award_ap()` writes an `ap_awards` row (amount, note, DM, when)
before incrementing `characters.ap`. `redeem_player_invite` did not — it set `ap` directly. Once
D-GH-2026-08-03-invite-single-ap-grant made that grant the character's *entire* starting AP, the one
number defining a new character had no record anywhere. Observed: `ap_awards` held **0 rows**
campaign-wide while every character in the campaign carried AP.

That is worse than an audit gap, because `ap_awards` is an *input to an existing feature*. Live Sheet's
clone-to-standalone (D-GH-2026-07-11) converts a campaign character's DM AP into itemized `award` log
entries by reading `getAwardHistory()`. With the table empty, cloning silently produced a standalone
character that had lost its whole starting grant.

**2. Leaving the cloud zeroed the budget.** Three paths called `_cgResetCloudApState()` on load — local
file, tool handoff, `#b=` share link — each with a comment explaining that a local copy has no campaign
binding. Those comments were *correct* when DM AP was a bonus on top of a LOG award. Once the grant
became the whole budget, the same line deleted everything. Verified against the engine: a DM-AP-only
character opened from a file reports `budget 0 · spendable 0 · total 14 · remaining -14` — over budget,
with every purchase flagged. The tool handoff was the worst case: same browser, same session, one click.

## Options considered for (2)

- **A — put a `dmAp` snapshot in the envelope.** Rejected. `js/engine.js`'s ANTI-DOUBLE-COUNT INVARIANT
  says callers must "DISPLAY it, never write it (or `dmAp`) back into `b.budget` / the award log / an
  export — else a reload double-counts." The cloud row keeps its `ap`, so a file carrying the number too
  double-counts the moment it syncs back. It is also the lump-sum shape D-GH-2026-07-11 explicitly
  rejected for losing per-award attribution.
- **B — materialize the awards into the exported LOG**, as clone-to-standalone does. Rejected for the
  same reason. Cloning is safe *because it severs the campaign* — `campaign_id` → NULL and `ap` → 0, so
  the awards move pools rather than duplicating. An export severs nothing.
- **C — carry the campaign BINDING, never the number.** Chosen.

## Decision

**(1)** `redeem_player_invite` inserts an `ap_awards` row for the grant, attributed to
`campaign_invites.created_by` — the DM who issued the invite — **not** `auth.uid()`, which at that moment
is the redeeming *player*; recording the player as the awarding DM would make the history actively
misleading. Skipped when the grant is 0. The idempotent-replay branch deliberately writes no second row.
The five existing characters were backfilled with a note recording the 2026-08-03 reconciliation.

**(2)** `buildCharacterEnvelope()` and `writeHandoff()` gained an optional `campaignId` — the binding
only, omitted entirely for local-only characters. New `_cgAdoptEnvelopeBinding()` replaces the blind
reset on the file-load and handoff paths: signed in, it reads the authoritative `ap` via
`peekCharacter()` (a pure read that never reconciles or pushes — the function D-GH-2026-07-11 added for
exactly this reason) and resolves to `'active'`; otherwise it resolves to `'unavailable'`, a state the
AP-source badge already explains as *"NOT the same as having no DM AP."*

`#b=` share links are deliberately **left alone**. They encode the folded *build*, not the LOG — no
history, no ledger — and are unsigned and length-bound. A shared build showing player AP and no DM grant
is honest for a link that has left the campaign context, and it is the one path where a stale AP number
would propagate to other people.

## Why

The project had already decided how AP leaves the DM pool (D-GH-2026-07-11: itemized awards, on a path
that severs the campaign). The bug was never a missing mechanism — it was that the mechanism's data
source was empty, and that the non-severing paths were discarding the binding they needed to resolve.
Fixing the source makes the existing feature correct without touching it; carrying the binding makes the
other paths correct without introducing a second, competing store of a number the engine explicitly
forbids duplicating.

## Verification

Migration `invite_grant_award_row` applied; `sql/schema.sql` synced; advisor re-run — no new findings.
Envelope checked directly: a bound character's envelope carries `campaignId` and **no** `ap`/`dmAp`
field; a local-only character's omits it entirely; the binding is covered by the D-GH48 signature, so a
hand-edited `campaignId` verifies as `tampered`. Parity 24/0, audit 27/0, browser e2e 3/3.

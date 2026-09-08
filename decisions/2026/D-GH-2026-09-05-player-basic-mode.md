# D-GH-2026-09-05-player-basic-mode — who may set/unset a player's one-character restriction, and what happens when the authorizing relationship ends

Status: Active

## Context

`docs/TASK_BOARD_NEXT.md`'s "Account-level 'basic mode'" task proposes letting someone restrict a
confused player to one active character, after a real support case: a player had two cloud characters
both named "Archer" (one correctly built, one whose build points a DM had zeroed), and the wrong one was
bound to his campaign. Fixed by hand this once; the task is to make it a real feature instead of a
repeat manual DB intervention.

A cold-plan-review draft for that task (`docs/plans/2026-09-05-player-basic-mode.md`) defaulted to
"any DM who currently shares a campaign with the player may set the flag" without examining what happens
when that sharing relationship later ends — the player leaves the campaign, or the DM removes them. Two
independent Claude Code sub-agent reviewers (cold review, plan text only, no repo access) each flagged
this as a serious gap without seeing each other's review: if unflag authority is re-checked against
*current* campaign membership, a player flagged by a DM they've since parted ways with can end up with
**no one left able to unflag them** — recreating exactly the kind of stuck state ("needs manual DB
intervention") this feature exists to eliminate, just moved from "duplicate characters" to "unremovable
restriction."

Also relevant, confirmed this session: the schema has no admin/superuser role anywhere — the only
existing elevated authority in this app is "is this user the DM of this specific campaign," which is
scoped per-campaign, not global. Any authority model for basic mode has to be built from that primitive
or explicitly decide not to use it.

One more fact worth naming plainly (from the same cold review): **the motivating incident was a
data-quality/confusion problem, not a trust-and-abuse problem.** The player wasn't gaming the system —
he genuinely couldn't tell which of his own characters to use. That should weigh in favor of a model
that treats basic mode as a *help*, not a *punishment* — which argues for giving the player themselves
an escape hatch, not just DMs.

## Options

- **A1 — any DM sharing a campaign may set AND unset; unset re-checks current membership.** The
  plan's original default. **Rejected.** This is exactly the broken option described above: current-
  membership re-checking on unset can leave a flagged player permanently stuck once the qualifying
  relationship ends, with literally no path back — worse than the problem being solved.
- **A2 — record the setting DM's identity permanently; only that DM (regardless of current membership)
  may unset.** Closes the "any DM" scope-creep concern, but doesn't close the reversibility gap — if
  that specific DM's account goes inactive, deletes itself, or simply never returns, the player is
  stuck the same way as A1, just with one specific person as the single point of failure instead of a
  membership check.
- **A3 — any DM sharing a campaign may set; the FLAGGED PLAYER may always unset their own flag; any DM
  sharing a campaign may also unset (convenience, not required for correctness).** Chosen.
- **A4 — no DM authority at all; stays a manual database operation until/unless the app grows a real
  admin role.** Zero new attack surface, but doesn't build the feature the task asks for — this is
  "keep doing what we did for Archer by hand," which is the exact repeat-manual-intervention outcome
  the task exists to remove. Rejected as the permanent answer, though it remains the honest fallback if
  A3 is later found to be wrong (see Verification below).
- **A5 — a global admin role, independent of campaign membership.** Rejected: this app has never needed
  one, adding it purely to backstop one feature is a disproportionately large trust-model change for a
  data-quality feature, and it doesn't actually solve reversibility any better than A3 — it just moves
  the "who has standing" question to a role that doesn't exist yet and would need its own decision
  record anyway.

## Decision

**A3.** A DM sharing a campaign with the player may turn basic mode ON. Once on, **the player can
always see it and turn it off themselves** — no DM's continued involvement is required for the player to
undo the restriction on their own account. Any DM currently sharing a campaign with the player may also
turn it off (a convenience for the support case that motivated this — a DM helping a confused player
sort out their characters shouldn't need to ask the player to do it themselves), but that convenience
path is never the *only* path, which is what actually closes the reversibility gap: the player is never
one lapsed relationship away from being permanently stuck, because their own account is always
sufficient standing to unset their own restriction.

This also directly matches the "help, not punishment" framing above — a restriction the affected person
can always lift themselves reads as guidance, not as a account-level penalty imposed on them with no
recourse.

**Record who set it and when**, visible to the player (addresses the other cold-review finding: no DM
gets silent, unaccountable authority over another user's account — the player can always see who
restricted them and why, even though they don't need that DM's cooperation to undo it).

**Explicitly out of scope for this decision** (left to the implementation plan): the exact column
shape, whether setting requires a reason/note, and whether there's a cooldown or confirmation before a
DM can re-flag a player who just unflagged themselves (a griefing vector A3 opens that A1/A2 didn't,
since A3's DM-set path stays available even after a player self-unflags — worth the implementation
plan naming a mitigation, such as the player being notified again rather than silently re-restricted).

## Why

The reversibility gap was the decisive factor: any option that can leave a real player's account
permanently stuck is worse than the manual-intervention problem it replaces, and both A1 and A2 have
that failure mode under ordinary, non-adversarial circumstances (people leave campaigns; that's normal
app usage, not an edge case). A3 is the only option where the player's own standing — which by
definition cannot lapse the way a third party's campaign membership can — is sufficient on its own to
guarantee a way out.

Giving DMs a *set* path but making the player's own *unset* path unconditional also matches the actual
shape of the motivating problem: a DM is well-positioned to *notice* a confused player (they see the
roster, the duplicate names, the campaign mismatch) but has no lasting standing to *hold* that
restriction over the player indefinitely once noticed — the player is the one person who can never lose
standing over their own account.

## Verification

- Deferred to the implementation plan's own verification section (this record settles the authority
  question; it doesn't implement it) — but any implementation must demonstrate: a player can unset their
  own flag with no dependency on any DM's current campaign membership; a DM who no longer shares a
  campaign with the player cannot set OR unset it (their standing genuinely ends, unlike the player's);
  the flag's setter identity and timestamp are visible to the affected player.
- If A3 turns out to be exploited as a griefing vector (repeated set/unset cycling) once real usage is
  observed, the fallback is A4 for the specific pair involved (revert to manual DB handling for that
  case) rather than redesigning the whole authority model reactively — noted here so a future session
  doesn't have to re-derive that this was anticipated.

## Follow-up not done here

The implementation plan (`docs/plans/2026-09-05-player-basic-mode.md`) still needs revising against this
decision, and separately against the other cold-review finding (the proposed enforcement mechanism itself
has a bypass via un-archiving, and a race condition — both reviewers independently suggested a partial
unique index instead of a counting trigger, which closes both). Both fixes are recorded in that plan's
own Review outcome section; this decision record only settles the authority question that plan's
Proposed approach had left as an unresolved default.

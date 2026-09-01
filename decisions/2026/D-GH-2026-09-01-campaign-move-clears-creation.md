# D-GH-2026-09-01-campaign-move-clears-creation — a creation ceiling belongs to one table, and does not travel

Status: Active. Shipped 2026-09-01 (PR #487, promoted in v1.488). No `DATA.version` change — the engine
is untouched; this is the database refusing to let one table's ruling follow a character to another.

## Context

`feat/creation-ceiling` gave every campaign character a creation-AP ceiling set by its DM, and a
finished-creation lock. It shipped with one question deliberately unanswered: **what happens to either
when a character changes campaigns?**

That question was not an oversight — it was raised by **three independent cold reviewers** across two
revisions of `docs/plans/2026-08-30-creation-ceiling.md`, and the plan carried it as an explicit
"still unresolved" risk rather than guessing. Opus's review put it plainly: *"Three reviewers flagging
the same thing across two plan revisions is a signal, not a footnote."*

## Options

- **A1 — carry both across.** The character keeps the ceiling and lock it had. Simplest, and wrong: a
  number one DM chose would silently govern a character at a table that never chose it, and a character
  would arrive at a new campaign already past creation, priced as in-play, with nothing on screen
  explaining why.
- **A2 — carry the ceiling, clear the lock.** The new DM inherits a starting figure they can adjust.
  Less disruptive, but still lets one table's number govern another's, just more quietly.
- **A3 — clear both.** *(chosen — owner, 2026-09-01: "when a character leaves or joins a campaign, the
  locks go".)*

## Decision

**A3.** On any change to `characters.campaign_id` — join, leave, or transfer — append
`creationLockConfig{threshold:null}` and `creationUnlocked`.

A character with no campaign then has **no ceiling at all**, which is not a special case: it is the same
fail-open rule `creationCeiling()` already applies to every local, solo and legacy character. Nothing is
enforced for a character with no DM to adjudicate for it.

**Implemented as a trigger on the column, not as changes to the join/leave RPCs.** Characters reach and
leave a campaign by several paths — `bind_character_to_campaign()`, `dm_unbind_character()`,
`redeem_player_invite()`, `redeem_character_claim()`, and any direct owner update RLS permits. Patching
each means finding them all today *and remembering them forever*; a path added later without this in
mind would silently keep the old behaviour. That is exactly the hand-written-mirror drift this project
keeps paying for — see the round-6 note in `docs/sessions/2026-08-27-feature-hd-gate.md`, where a
correct engine fix left two tool-layer copies stale. One rule on the column cannot be bypassed by adding
a new caller.

## Why

**Because a ceiling is a ruling, not a property of the character.** It encodes what one DM granted one
character to build with, at one table. It has no meaning anywhere else, and carrying it would give it
authority nobody conferred.

**Because it needed no engine change, and that was verified rather than assumed.** `js/engine.js`
already reads a `creationLockConfig` whose `threshold` is null as "no ceiling set", and already resolves
`creationUnlocked` against `creationLocked` last-write-wins. Both were checked against the engine before
the migration was written. A rule that can be expressed in events the engine already understands is
strictly better than one that needs new engine vocabulary.

**Append-only, so the history stays readable.** Nothing is rewritten or removed; both events carry
`systemEdit:true` and a label naming the move ("joined a campaign" / "left the campaign" / "moved to a
different campaign"). A DM asking "why has this character no limit?" can see exactly when and why.

## The advisor caught something the design did not

After the migration applied, the Supabase advisor reported
`anon_security_definer_function_executable`: the trigger function was callable by the **anon** role via
`/rest/v1/rpc/pact_campaign_move_clears_creation`. Postgres grants `EXECUTE` on a new function to
`PUBLIC` by default and PostgREST exposes it.

This was a **new finding class for this project** — every other `SECURITY DEFINER` function here is a
deliberate RPC, and none was anon-callable. Calling it directly would have failed for want of `OLD`/
`NEW` trigger context, but "it would error" is not a security argument for leaving a `SECURITY DEFINER`
function exposed. Revoked from `public`/`anon`/`authenticated`, then verified: both false (matching
`snapshot_character`, the other properly-restricted trigger function here) and the trigger still fires,
since triggers execute as the table owner.

Worth recording as the concrete case for the per-change rule that the advisor runs after every
migration: the finding was invisible in the SQL under review and appeared only in the advisor's output.

## Status

IN FORCE. Verified against the live database in transactions rolled back afterwards: Fenwick (unlocked,
ceiling 74) leaving cleared the ceiling; Skylar (locked, ceiling 76) leaving cleared both; and all six
Amble characters were confirmed unchanged afterwards. Parity 73/0.

## Related

- `docs/plans/2026-08-30-creation-ceiling.md` — the plan this closes the last carried question of; see
  its Close-out section.
- `sql/migrations/2026-09-01-dm-creation-ceiling.sql` — the DM's own set/reopen controls, which this
  complements: a DM decides the ceiling at their table, and a move clears it on the way out.

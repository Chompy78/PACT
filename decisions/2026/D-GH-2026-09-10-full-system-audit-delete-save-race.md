# D-GH-2026-09-10-full-system-audit-delete-save-race — a save must never resurrect a character this device just deleted

**Status:** Adopted, implemented on `claude/fervent-clarke-6yv9o9` (a full-system audit session, not a
single-task branch — see `docs/sessions/2026-09-10-full-system-audit.md` for the whole session).

## Context

Requested: a full audit of PACT for errors, logical errors, and UI issues. The existing automated suite
(1,000+ assertions — engine parity, escaping, pricing, sync concurrency, undo barriers, e2e flows) was
run in full first and passed clean, so the audit's value-add was manual/adversarial review beyond what
that suite already locks down. A background review of `js/sync.js`, `js/campaign.js`, `js/dm.js`,
`js/auth.js`, `js/character-store.js` found one genuine, previously-untracked bug.

**The bug.** `deleteCharacter()` (`js/sync.js`) removes the local cache record and tombstones the id
synchronously, then attempts the server `DELETE`. If a `saveCharacter()` push for the SAME character was
already in flight (the normal case for a debounced autosave racing a user-initiated delete), and that
delete's `DELETE` reaches the server before the save's `UPDATE` runs its zero-rows check, the `UPDATE`
legitimately matches zero rows for a reason `pushCharacter()`'s zero-rows branch had no way to see: it
could not tell "this row never existed" apart from "this row existed and was just deleted." Both prior
branches (the guarded conflict-check, and the plain insert for an unguarded record) read a zero-rows
update the same way — "safe to insert" — so either path silently re-created the row the user had just
deleted, and `applyServerMeta()` would then re-populate the local cache too. No existing gate covered
this: `sync-concurrency-ci.mjs`'s own header scopes itself to save-vs-save races (the 2026-08-07
43→47→43 incident), never delete-vs-save.

## Options

- **A1 — Check this device's own tombstone list at the zero-rows decision point.** `deleteCharacter()`
  already records tombstones precisely to stop "a later pull" resurrecting a deleted row (see the
  file's own header comment); this extends that same invariant to a push racing the delete itself.
- **A2 — Have `deleteCharacter()` wait on `_pushInFlight` for the same id before proceeding.** Would
  serialize the two operations client-side rather than making the push self-aware.
- **A3 — Distinguish "never existed" from "recently deleted" via a server-side signal** (e.g. a
  soft-delete marker checked by the exists-query). Bigger: a schema change for a client-only race.

## Decision

**A1.** Added `js/sync.js`'s `DeletedError` and a check — `if (lsDeletes().includes(rec.id)) throw new
DeletedError(rec.id);` — right after the zero-rows detection in `pushCharacter()`, before either the
guarded conflict-check or the plain insert. Both `saveCharacter()`'s and `reconcile()`'s calls into
`pushCharacter()` funnel through this one function, so one check point covers both call sites.
`saveCharacter()`'s catch gained a `deleted: true` branch (parallel to its existing `sealed`/`conflict`
handling) so a caller CAN special-case it later; no tool UI was changed to react to it specifically —
the local record is already gone by the time this fires (`deleteCharacter()`'s `lsRemove()` already ran),
so there is nothing left to keep "dirty," and a rare post-delete "save failed" toast is acceptable
fallout against the alternative of silent data resurrection.

## Why

**A1 over A2.** A2 would work but adds real complexity (async coordination between two independently-
callable exported functions) for a check A1 gets for one `if` statement, reusing state
(`lsDeletes()`) the module already maintains for exactly this class of problem.

**A1 over A3.** The ambiguity ("zero rows" meaning either "never existed" or "just deleted") is entirely
a *client-side* timing question — the server has no ambiguity at all, it simply doesn't have the row.
Solving a client race with a schema change would be solving the wrong layer.

**Known residual scope, stated rather than solved.** A1's tombstone check only holds while the
tombstone is still pending. Once `replayDelete()` confirms and clears it, an extremely stale save that
arrives afterward (long outliving the delete's own round trip) would not be caught by this check and
could still re-insert the row. This is a much narrower window than the one actually found — the
tombstone is written synchronously, before the delete's own network request is even sent, so it
persists through the entire ordinary race window — and closing it fully would require either a
permanent (never-cleared) record of every deleted id, which conflicts with this app's existing
local-storage growth discipline (see `character_backups`' retention design,
`D-GH-2026-08-07-character-backups`), or a server-side tombstone. Left as a known limitation rather than
over-built for a race that would additionally require a save to be lost for longer than a delete's own
confirmation round-trip.

## Verified

`testing/scripts/sync-concurrency-ci.mjs` gained a differential regression test (`deleteRaceScenario()`):
a reverted copy of `js/sync.js` (the tombstone check stripped via regex) is proven to reproduce the
resurrection, and the live copy is proven to refuse the save and leave the character deleted. All
pre-existing scenarios in that file, and the full CI suite (engine parity, escaping, pricing, undo
barriers, state machine, autosave races, e2e flows, theming, service worker, randomiser quality — see
the session note) stayed green throughout.

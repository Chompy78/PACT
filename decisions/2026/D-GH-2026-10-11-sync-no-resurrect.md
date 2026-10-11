# D-GH-2026-10-11-sync-no-resurrect — a character the server no longer has is not re-uploaded unless it holds unsaved work

Status: Active. `js/sync.js` `reconcile()` only; tests in `testing/scripts/sync-state-machine-ci.mjs` section (g).

## Context

The server logs showed one browser, on every page load, PATCHing each character and then trying to INSERT about 20 more, each refused
as "a solo character must be saved with its event log" (the blank-row guard of 2026-10-10), plus one refused for a duplicate name.
That device held 67 local records; 39 had no server row: 33 `noteEdit()` placeholders (`{id, editSeq}`, no stats), 4 copies of rows
adopted while they held `{}`, 2 holding `{"note":"hello"}`, and an old, deleted 35-event copy of Bram Cotter Ch8-12 that would have been
re-inserted had its name not clashed with the current Bram. None had unsaved work.

Cause: `reconcile()`'s "server has no copy" branch pushed every local record, treating a missing row as "never uploaded". It cannot tell
that from "deleted elsewhere" by the row alone, but the local record can: a record the server once confirmed is not dirty.

## Options (owner chose D2)

- **D1** — never push a record without a LOG. Stops the refusals; a deleted character with content still comes back.
- **D2** — D1, plus: a record with no unsaved edits whose row is gone was deleted elsewhere, so drop the local copy. Unsaved work still uploads.
- **D3** — clear the one device's records by hand. Recurs on any device holding old copies.

## Decision

When the server has no row: (1) no `stats.LOG` → never push; drop the record unless this page is working on that id; (2) not dirty and
`editSeq <= savedSeq` → deleted elsewhere, drop the local copy; (3) otherwise (real unsaved work) → push, as before.

## Why

Both signals already exist: `dirty`/`editSeq > savedSeq` is how the sync chip decides "unsaved". A record is only ever made not-dirty
from a server confirmation, so "not dirty and no row" means deleted elsewhere. Nothing is lost by dropping it: the server's
`character_backups` keeps every deleted row, and the owner's other characters come back from the server on the next sync. An explicit
user save of a character deleted elsewhere still re-creates it (pushCharacter() unchanged) — that is the user choosing to keep it.

# D-GH-2026-07-25-cloud-load-empty-characters — "No character data found" was stub data, not a code bug — hardened both tools against the row shape anyway

Status: Active

- **Context:** reported as every entry in Live Sheet's "Load saved character" list failing with "No
  character data found." Queried the live `characters` table directly (`piuprrrnaotrtxucrtsb`, not just
  read the code) rather than guess: all 4 `kind='livesheet'` rows had `stats` = `{}` or
  `{"note":"hello"}` — no `LOG` array at all. These aren't corrupted real saves; they're pre-launch
  test/stub data (the literal `"note":"hello"` placeholder text and empty `{}` stats aren't anything the
  real Save-to-cloud path — `buildCharacterEnvelope()` — has ever produced). Both tools' load-click
  handlers already correctly require `Array.isArray(rec.stats.LOG)` before proceeding (this is deliberate
  validation, not a missing check) — they were refusing to load garbage exactly as designed. The gap was
  UX: a user gets this error only *after* clicking to load, with no way to tell in advance which list
  entries are hollow.
- **Options:** for the stale data — (i) leave the 4 rows, document the cause; (ii) delete them (this app
  is pre-launch, confirmed 0 rows across `characters` after deletion, matching D-GH37's prior finding of
  no real user data to protect). For the UX gap — (a) do nothing, since it's not technically a bug; (b)
  filter hollow rows out of the load list entirely; (c) show them, visibly disabled, with an explanation.
- **Decision:** (ii) delete the stale rows. (c) show-disabled, not hidden or ignored.
- **Why:** (ii) over (i) — there is no future value in keeping known-hollow rows around now that their
  cause is understood and logged here; leaving them just re-triggers the same confusion for the next
  person who opens the menu. (c) over (b)/(a): a player should be able to see that a character slot
  exists (e.g. a redeemed player-invite character they haven't opened in Live Sheet/CharGen yet) rather
  than have it silently vanish from their list, but clicking it must not resolve to a generic,
  after-the-fact error — showing it inert with a specific explanation ("never saved... nothing to load
  yet") satisfies both. Implemented by adding a `hasData` flag to `js/sync.js`'s shared `listCharacters()`
  (selects `stats->LOG` via a PostgREST JSON-path alias rather than the full `stats` blob, to avoid
  doubling the payload of every character in the list just to check one key's presence) — both tools
  already independently required a `.hasData`-equivalent (`Array.isArray(rec.stats.LOG)`) at load time
  with identical semantics, so one shared flag serves both without new duplication.
- **Status:** DONE. Verified end-to-end in a real browser (both tools) with a mocked session carrying one
  real and one stub character: the stub renders as a non-interactive `<div>` with no click handler
  attached (clicking it produces no dialog, confirmed); the real character's button still triggers the
  normal load confirmation and completes with zero console errors. The 4 live stub rows are deleted;
  `characters` table confirmed at 0 rows immediately after.

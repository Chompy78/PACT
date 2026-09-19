# D-GH-2026-09-18-campaign-mixup-guardrails — soft guardrails against the "wrong character" support ticket

## Context
A DM reported a player (Christen, character "Caspian") who saw wildly wrong AP numbers and asked to have
their sheet "reset". Live investigation (real Supabase data + the actual `js/engine.js` replayed against
the character's own LOG, not hand-arithmetic) found no engine bug: the player had **two** characters
named "Caspian" — the real one, bound to the DM's campaign, healthy at 82/99 AP spent/spendable; and an
old unbound draft from before they joined the campaign, sitting in the browser's single shared
`pactLiveSheet` local-autosave slot. `PACT-Live-Char-Sheet.html`'s `load()` silently resumes whatever was
last active in that slot with no campaign check at all, so opening the app (rather than going through
"My Characters" first) can silently reopen the wrong one. The DM confirmed this is a recurring pattern,
not a one-off.

## Options
- **A. Do nothing / instruct-only.** Tell players to always use My Characters. Zero engineering cost,
  relies on every player remembering every time — the same reliance that caused this ticket.
- **B. Soft, in-app guardrails (chosen).** Three small, additive, display/warn-only changes in
  `tools/PACT-Live-Char-Sheet.html`: (1) a one-time flash when a confirmed-standalone character loads
  for a signed-in player who belongs to a real campaign; (2) a display-only "— <campaign>" suffix next
  to the character name in the sheet header whenever the loaded character is campaign-bound; (3) a
  client-side block on the Rename action when the new name collides with another of the player's own
  characters.
- **C. Hard DB-level enforcement** (a `UNIQUE(owner_id, name)` constraint, and/or forcing every load
  through a campaign-aware picker with no silent local resume). Rejected for now — see Why.

## Decision
B. Implemented as three independent, additive pieces, all display/warn-only:
1. `_lsWarnIfUnbound()` — fires once per session, only when `listMyCampaigns()` shows the signed-in
   player actually has a campaign (`isPlayer || isDm`), so a genuinely solo/offline player never sees it.
   Hooked into both the silent-resume boot path (`refreshCloudCampaignRules()`) and the explicit
   `loadCloudChar()` path.
2. `window._lsCampaignName` (mirrors the existing module-local `_campaignName` across the classic-script/
   module-script boundary) — consumed by `render()`'s `.shname` line. Never written into `b.name`, the
   LOG, or persisted anywhere — purely rendered, so it can never drift into `compute()`/`foldBuild()` or
   get exported/saved as part of the character.
3. `_lsRenameGuard(newName, currentId)` — checks the signed-in player's own `listMyCharacters()` result
   for a case-insensitive name collision (excluding archived characters and the literal default
   `'New Character'`) before the Rename button's `emit({type:'name',...})` fires. Blocks with an
   explanatory `alert()`; any failure (offline, not signed in) fails OPEN (allows the rename) rather than
   blocking on a check that couldn't run.

## Why
- **Why soft, not a DB constraint (rejects C):** a hard `UNIQUE(owner_id, name)` would break immediately
  against live production data — Christen's own two "Caspian" rows already violate it, and it is
  completely normal for the DEFAULT name of every fresh draft to collide (`'New Character'` is what
  CharGen and Live Sheet both seed a brand-new character with; a player routinely has more than one
  in-progress draft before naming any of them). Enforcing uniqueness at the DB layer would need a
  migration/cleanup pass for existing rows and a design for the default-name case first — worth
  revisiting only if the soft version proves insufficient in practice.
- **Why the Rename button only, not live-as-you-type:** CharGen's name field re-syncs a LOG singleton
  event on every keystroke (`_cgSyncName()`, by design, so typing feels instant) — running an async
  cross-character duplicate check on every keystroke would be both annoying (interrupting mid-type) and
  wasteful (a network round-trip per character typed). Live Sheet's Rename is a single deliberate
  `prompt()` action, the natural point to check once. CharGen is not covered by this decision; if the
  same problem recurs from CharGen-originated drafts, a blur-triggered (not keystroke-triggered) version
  of the same guard is the natural follow-up.
- **Why display-only for the campaign suffix, never persisted:** matches this codebase's standing rule
  (`AGENTS.md`, Persistence section) — store only raw character data; derive everything else at runtime.
  A suffix baked into the stored `name` would itself become a second source of truth to keep in sync
  (and would show up in exports, PDFs, DM rosters, etc. as literal text, not a display affordance).
- **Why scoped to Live Sheet only, not also DM Console / My Characters:** the diagnosed failure mode is
  specifically "opens Live Sheet directly and silently resumes the wrong local character." My Characters
  already groups by campaign (a "No campaign" vs named-campaign heading), so the same information is
  already visible there structurally; DM Console's roster is already filtered to one campaign at a time,
  so every row would carry an identical, redundant suffix. Live Sheet's in-sheet header is the one place
  a player looks without necessarily having passed through either of those.

## Status
Implemented, on branch `claude/fervent-franklin-klb6g3` (this session's designated cloud-session branch —
not a `type/short-slug` branch, per this session's harness-assigned workflow). Not yet run against
`testing/tests/engine-parity.html` by a human, though none of these changes touch `compute()`/`foldBuild()`/
`economy()` or any `DATA` table, so no parity or `DATA.version` impact is expected. CharGen's equivalent
duplicate-name guard is an open follow-up (see Why above), not part of this change.

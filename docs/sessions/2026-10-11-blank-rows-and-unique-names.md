# 2026-10-08 → 2026-10-11 — a player who couldn't load his character: blank rows, duplicate names, release v1.599

Decisions: `decisions/2026/D-GH-2026-10-10-blank-row-guard.md`, `decisions/2026/D-GH-2026-10-11-unique-character-names.md`.
PRs: #595 (blank-row guard), #596 (unique names), #599 (promotion, `v1.583` → `v1.599`).

## How it started
Christen (Amble) could not load his character. His account held **11** cloud rows: two real characters, both named
**Caspian**, and nine "New Character" rows, five of them created within ~6 seconds on 2026-10-08 11:47 UTC.

- **The two Caspians were separate rows with different ids**, not one character opened in two tools: a CharGen row in Amble
  (40 events, 100 DM AP, still being advanced) and a solo Live Sheet row whose 28 events all share one millisecond (4 Aug) —
  the signature of an import, not a hand-built history. The cause of that split was **not found**: the old id-dropping export
  converter was gone by 10 July and the campaign id-migration fork fix (#310) was on `main` by 3 August, the day before.
- **The blank rows were pure column defaults** (name 'New Character', kind 'livesheet', stats `{}`): 30–31 across 5 owners,
  2026-08-08 → 2026-10-08, one owner holding 16. No tool's `saveCharacter()` sends empty stats, so the likely source is a
  stats-less local placeholder (`noteEdit()` / `setAutosaveEnabled()` in `js/sync.js`) pushed as an INSERT. Not yet pinned —
  that is `fix/blank-character-rows` on the NOW board.
- **The duplicate-name guard existed but couldn't have helped**: `_lsRenameGuard` (#545, 18 Sep) runs only on Live Sheet's
  Rename button, never on save/import/handoff, and CharGen had none.

## What was decided (owner choices)
- **C3:** keep CharGen able to advance characters after the lock — the confusion came from the split rows, not from which tool.
- **I3:** the server refuses blank rows *and* a weekly job sweeps any that remain.
- **G2:** the database refuses two active characters with the same name.
- **K2:** remove the `/data/projects/creative/PACT` → `pact` symlink (it made H: show two folders). Nothing referenced it except
  old notes and one never-trusted Claude Code project entry.

## Where the first version of the guard was wrong
The obvious rule — "refuse any character row with no event log" — would have **broken joining a campaign**: `join_campaign()`
and `redeem_player_invite()` deliberately insert a campaign-bound seed row with stats `{}` that the tool fills in afterwards.
Found by reading the live function bodies before writing the rule. Both the guard and the purge are therefore **solo-only**.
The same reading found that both invite RPCs caught *every* `unique_violation` as "already in this campaign", which would have
mislabelled a name clash once the unique index existed — fixed in #596 by checking the constraint name.

## Data changes made on the live database (owner-approved, all reversible)
- 2026-10-11: blank-row guard + purge applied; the one-off sweep removed **31** rows (64 → 33), each copied to
  `character_backups` (reason `delete`) by the existing snapshot trigger.
- Christen: three early "New Character" drafts **archived**; the stale solo copy **renamed** "Caspian (old copy)" by appending a
  real `name` event (seq 29, `SEQ` 30 — renaming only the column would have been undone by the next save, since the tools take
  the name from the log), then **archived**. His active list is now one character: Caspian (Amble).
- 2026-10-11: unique-names migration applied after re-counting 0 violating groups.
- Sam (Skylar, Amble) was checked on request: one character, locked and sealed, untouched since the 4 Oct repair; nothing changed.

## Collisions and process notes
- **Supabase permission rules didn't match.** `.claude/settings.json` names `mcp__Supabase__*`, but these sessions use the
  claude.ai connector (`mcp__claude_ai_Supabase__*`). `apply_migration` was refused as "Production Deploy" until the owner added
  the `mcp__claude_ai_` rule; a "go" in chat does not get past that check. Adding the rule also moved `execute_sql` into `deny`
  for a while — fixed by the owner.
- **`preview` moved twice during the promotion** (other sessions merged #597 and #598). The first `BUILD` bump push was rejected
  and redone on the new tip; CI was confirmed green on the exact commit that shipped (`41cacb8`, 27/27).
- **The main checkout was switched by another session** mid-way (to `docs/server-freeze-stage1-applied`, later
  `feat/server-freeze-stage2`); this session's work was done in separate worktrees throughout.
- **A wrong number corrected:** an early reply said "13 existing duplicates" without having counted; a real count found 2 pairs
  (Christen's Caspians, and one account's two "Character" rows — a default name, now exempt).
- An unexplained discrepancy: the very first count query returned 6 rows for Christen, the full listing seconds later 11.

## Still open
- `fix/blank-character-rows` (NOW): the client-side cause. Until it lands, a device holding a placeholder retries a refused push
  and may list it as a device-only entry.
- The other `mcp__Supabase__*` permission rules in `.claude/settings.json` still don't match this connector.
- Whether to tag `v1.599` (owner decision, `docs/VERSION-SYNC.md` step 6).

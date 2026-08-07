# 2026-08-07 — character backups, and a production data cleanup

Started from a real incident: a player character (Fenwick Copperkettle, `rhysmyself@gmail.com`) was lost.
The report was "I accidentally removed them from the campaign", but `dm_unbind_character` only nulls
`campaign_id` — that should have been a one-field restore. The row was gone entirely, because
`js/sync.js deleteCharacter()` is a literal hard delete and nothing captured the row on the way out.

Two thirds of this session is in the code (PR #377). The last third is **production data changes that
exist nowhere else in the repo** — hence this note.

## What shipped (PR #377, branch `feat/character-backups`)

1. **`character_backups`** — a `BEFORE UPDATE OR DELETE` trigger snapshotting every characters row
   pre-change. 50 `update` snapshots kept per character; `delete` snapshots never pruned. Server-side
   only (RLS on, zero policies). Full rationale, including three load-bearing details chosen against
   specific failures: `decisions/2026/D-GH-2026-08-07-character-backups.md`.
2. **"Export backup"** on My Characters — the off-site half, a copy the user holds outside the app.
3. **A staleness warning** — the export is manual, and the original failure was that nobody remembered.
   Warns at 7+ days or never, per browser.
4. **An ownership check on `listMyCharacters()`'s offline branch** — the online branch filtered
   `.eq('owner_id', …)`; offline made no check at all.
5. **`sql/full-backup.sql`** — the whole-database runbook, run from the Supabase dashboard.

Gates at merge: `engine-parity` **29/0**, `tool-pricing` **67/0**, security review clean.

## Decisions taken (options as presented, for the record)

- **S1 — the scheduled backup Routine was deleted, not disabled.** It could not inherit the connectors
  it needed and would have fired weekly doing nothing; a disabled job in the list eventually reads as
  "backups are handled". The staleness warning replaces it. (Addendum 1 of the decision record.)
- **V1 — no in-app admin backup.** An account DMing every campaign still reaches only 6 of 15
  characters, because RLS decides. Doing it properly means inventing the admin role this project
  deliberately lacks, and it would grant no new capability — only a weaker route to one `service_role`
  already has. (Addendum 2. It also names what should reopen the question.)
- **W1 / X2 / Y2** — the data operations below.

## Production data changes made this session

**These are not in any diff. This section is the only record.** Every one was snapshotted first by the
trigger shipped earlier the same day, so all are reversible via the recipes in
`sql/migrations/2026-08-07-character-backups.sql`.

| # | Change | Detail |
|---|---|---|
| 1 | Deleted 2 test characters (W1) | `check-Anders Tealeaf`, `check-Fenwick Copperkettle`. Snapshotted `reason='delete'`, kept forever. |
| 2 | Bound Fenwick to Amble + 36 DM AP | The rebuilt character was a **new row** (created 05:33 today, new id) — not a restore. Mirrors what an invite redemption would have paid (`rules.startingTier.ap` = 36), with a matching `ap_awards` row so `ap` reconciles. |
| 3 | Removed `award` events from Amble's 5 characters (X2) | Verified against the engine: `spent` **identical** for all, zero new warnings, and `remaining` **unchanged** (0→0, 1→1, 2→2, −13→−13) because `ignore_player_ap` already dropped `playerAp` from the ceiling. The events were dead ledger lines. |
| 4 | Copied Moss Stormspud to `jrc.chow@gmail.com` | `Moss Stormspud (COPY)`, bound to Amble so the AP view reproduces faithfully. Envelope `id`/`name` rewritten to match the new row — left as the original's, a tool Load would resolve to Moss himself. |

### The accepted risk in #3, written down so it isn't rediscovered

Those five characters now have **no player-side budget**. Today that is invisible, because Amble runs
`ignore_player_ap: true` and `compute()` (`engine.js:485`) already excluded `playerAp` from the ceiling.
**If anyone leaves Amble, or `ignore_player_ap` is switched off, they will have a fully-spent build and
zero player AP.** This was surfaced before the change and accepted deliberately.

### Open, not fixed

**Moss Stormspud is over budget by 13 AP** — 37 DM AP, 50 net spend. Confirmed **pre-existing** by
replaying his pre-edit snapshot through the engine, so it was not caused by anything here. Left alone
per Y2; his player resolves it at the table. The copy in change #4 preserves the exact state.

## A correction worth remembering

Mid-session I reported `economy().available` as if it were the character's remaining AP. It is not —
`economy()` is derived from the LOG alone and **never sees DM AP**; only `compute()` combines the two
(`spendable = (ignorePlayerAp ? 0 : playerAp) + dmAp`). Shown alone it made a healthy party look
uniformly tens of AP in the red. The human spotted it immediately and correctly diagnosed the gap as
drawback refunds. **If a future session quotes an AP figure, quote `compute().remaining`, not
`economy().available`.** This is the same `compute()`-vs-`economy()` divergence `AGENTS.md` already
flags as high-risk, and it is what `feat/ap-model-reconcile` on the NEXT board exists to resolve.

## Not done

- **PR #374** was not merged. Its own body says *"do not merge until the two-tab check has been run"* —
  a concurrent-save test needing two signed-in browser tabs, which no agent session can perform.
- **Tagging the promotion commit** cannot be done from a cloud session (hard 403 — see
  `docs/sessions/2026-07-19-github-release-tag-cloud-session-restriction.md`).
- `delete@test.com`'s 3 characters and three empty `New Character` rows are still present (W2, not
  taken — one is a real player account whose duplicates may be deliberate).

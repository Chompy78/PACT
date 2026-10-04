# Creation-lock forensics (Amble, 2026-10)

Read-only analysis scripts from the 2026-10-01 → 10-04 investigation into lost creation locks. They run
the real `js/engine.js` in Node over character data exported **read-only** from Supabase. **No player data
is committed here** — export fresh JSON into a scratch directory each time (queries are in
`docs/sessions/2026-10-04-creation-lock-restart.md`).

| Script | Input | What it does |
|---|---|---|
| `gap.mjs <live.json>` | live `characters` rows (`[{name,kind,ap,stats}]`) | stored ledger vs engine total, limit, DM AP |
| `walk.mjs <live.json> [name]` | live rows | walks a Live Sheet log event by event, marks the limit crossing |
| `recheck.mjs <snaps.json>` | `character_backups` versions (`[{cur,src,t,log}]`) | CharGen lock points from backups, priced by current rules (Q1) |
| `nodraw.mjs <live.json> <snaps.json>` | both | apples-to-apples table (drawbacks excluded — display only) |
| `buildcopies.mjs <live.json> <snaps.json> <out.json>` | both | builds the "lock check (DM copy)" logs with the lock at the agreed point |
| `verifycopies.mjs <copies.json>` | copies read back from the DB | re-verifies spend, limit, lock position |

The per-character limits and crossing points hard-coded in `buildcopies.mjs` / `walk.mjs` are the DM-agreed
values in `docs/plans/2026-10-01-amble-creation-lock-review.md`.

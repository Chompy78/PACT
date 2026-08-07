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

## The second half: PR #374, and four defects the manual gate had passed

The backup work was only half the day. The other half was the stale-cloud-save branch, which had been
sitting open with a self-imposed gate: *"do not merge until the two-tab check has been run."* Running
that check produced **four defects in two attempts**, and how they were found matters more than what
they were.

1. **CharGen reported a conflict as "Save failed."** Of three save paths only two handled
   `res.conflict`; CharGen's manual save fell through to the generic catch. The message was untrue —
   the save to the device had succeeded — and it is the message most likely to make a player redo work
   they never lost.
2. **The guard could be defeated, and was, in production.** `initSync()` runs `syncAll()` on every page
   load and reconnect; `reconcile()`'s adopt branch refreshed `base_updated_at` **in localStorage**,
   while the content being saved came from the page's **in-memory build**. A background sync therefore
   handed a stale page a *fresh* base. Observed: **43 AP spent → 47 → back to 43** across two Edge
   profiles, guard active throughout. Note the shape — an earlier round of the *same* fix had added
   `base_updated_at` to those adopt sites, closing a visible bug and opening an invisible one.
   **A guard that looks like it works is worse than no guard, because it gets trusted.**
3. **My own harness gave a false pass.** Its stubbed server used `'T1'`/`'T2'` as timestamps.
   `Date.parse` turns those into `NaN`, so `isNewerInstant()` always returned false, `reconcile()`
   always adopted, and the recovery check went green for entirely the wrong reason. Real ISO instants
   exposed defect 4 immediately.
4. **A refused save had no way out.** The local record is dirty and newer, so `reconcile()` pushed,
   the guard refused, `catch { /* retry later */ }` swallowed it, and `loadCharacter()` returned the
   same stale copy. **"☁ Cloud → Load" handed the user their own copy forever** — the exact control the
   conflict message told them to use. "Retry later" was the wrong frame: a refused push can *never*
   succeed, because the server has moved and this copy's base never will.

Fixed by pinning the base to the copy the page holds (`_pageBase`, written only by `loadCharacter()`
and this page's own successful push) and by `loadCharacter(id, {onBehind})`, which asks before
discarding anything. Full reasoning: `decisions/2026/D-GH-2026-08-07-optimistic-character-save.md`.

### The premise that caused all of it

Both the task and the PR asserted **"no automated gate can reach this"**, because the dependency-free
suite cannot sign in to Supabase. That was false, and it is what cost a live character. Supabase is not
what needed testing — the *order of local reads and writes around a conditional update* is.
`testing/scripts/sync-concurrency-ci.mjs` stubs the server, gives each simulated profile its own
`localStorage`, and replays the production sequence against the real `js/sync.js` in Node built-ins
only. It catches defects 2 and 4.

**Treat "this can't be tested automatically" as a claim to verify, not a fact to accept.** It was
written into a task, carried into a PR, and used to justify a manual ritual that then missed four
things — including one that destroyed data while the guard was live.

## Shipped: v1.378

`preview` → `main` via PR #378, merged with a regular merge commit (never squash — that severs the
shared history and breaks the *next* promotion's 3-way merge). `BUILD` → `v1.378`, major `1` carried
forward; `DATA.version` stays `v0.341` because no mechanics changed. All 10 CI checks green;
`engine-parity` 29/0, `tool-pricing` 67/0, `sync-concurrency` 12/0.

One CI flake worth recording: `pricing` failed with `fetch failed` on a **docs-only commit**, which is
what proved it environmental rather than a defect. It passed on re-run. If it recurs, that job's
browser/loopback setup is the suspect, not the diff.

## Found at the end: drawbacks are counted twice

Checking `Moss Stormspud (COPY)` after the award cleanup showed "4 player AP ignored". With every
`award` event gone, that 4 was **purely drawback-derived** — which made a real bug visible.
`foldBuild()` folds `drawbackEarned` into `b.budget`, but `total` already nets drawbacks, so a drawback
both cuts the cost and raises the ceiling. Amble is unaffected (`ignore_player_ap` drops `playerAp` and
lands accidentally on the correct model); **every character outside such a campaign gets double value.**

Filed rather than fixed — it changes `compute()` output, so it needs `testing/expected/` and a
`DATA.version` bump, which is not something to bolt on the day a promotion shipped. On the NEXT board as
`fix/drawback-ap-double-count`, tagged Risk: high so `/sweep-code-tasks` cannot pick it up.

The display fix is the interesting half: **drawback AP is a discount on cost, not a pool to spend from.**
Show it on the cost line and reserve "Player AP" for actual awards; `economy()` already returns
`drawbackEarned` separately (D-GH41), so no new engine export is needed.

## Not done

- **Tagging `main` as `v1.378`** — the one step a cloud session cannot do (hard 403; see
  `docs/sessions/2026-07-19-github-release-tag-cloud-session-restriction.md`). Run locally:
  `git tag v1.378 4cdaab5 && git push origin v1.378`.
- **`Marius Stormholt` is at 43 spent**, not the 47 that a stale tab overwrote during testing. The 47
  state is preserved in its 13:00:50 snapshot and is one query away if wanted.
- **The prescribed two-tab test was wrong** and is now corrected in the PR body: two tabs in one browser
  profile *share localStorage*, which is not the case the guard is about. Two profiles or two devices.
- `delete@test.com`'s 3 characters and three empty `New Character` rows are still present (W2, not
  taken — one is a real player account whose duplicates may be deliberate).

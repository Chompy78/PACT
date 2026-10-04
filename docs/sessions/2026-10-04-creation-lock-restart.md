# RESTART — Amble creation locks (handoff written 2026-10-04)

> **Read this first in the new session.** It is the complete state of the creation-lock work carried over
> from session https://claude.ai/code/session_01Fo8ZLDkMnBkS6uUn9M1Zmq (2026-10-01 → 2026-10-04). The
> owner's choices below are **decided** — do not re-ask them. Everything is on `preview` as of this file.

## The problem in one paragraph
The DM asked whether every "Amble" character had its creation lock. Four did not. Two client bugs were
deleting locks: (1) **CharGen reload** rebuilt the LOG from the form after restoring the autosave — fixed
in PR #553, live since v1.554; (2) **a stale local copy pushed over a newer cloud save** (Skylar 2 Oct 9:00,
Archer 3 Oct 9:55 AWST, *after* the reload fix) — **still open**. The server accepts both because nothing
protects the creation-lock events. Separately, several lock points were never in the right place.

## Live state at handoff (re-check before acting — figures in this file are a snapshot)
- Supabase project `piuprrrnaotrtxucrtsb` (PACT). Amble campaign `a6687e29-7c12-46b2-a9a3-711586a9ca12`.
  DM/owner + sole co-DM: **jrc.chow@gmail.com**, user id `3016205d-d33a-44e8-af1a-6574e2e1a359`.
- All six Amble characters carry an **interim** `creationLocked` (end-of-log, AP unchanged), re-applied to
  Skylar and Archer on 2026-10-04. **They can still be lost** to the stale-copy bug until the server guard
  ships — re-check at the start of every session:
  ```sql
  select c.name, to_char(c.updated_at at time zone 'Australia/Perth','DD Mon HH24:MI') saved_awst,
    coalesce((select v->>'type' from jsonb_array_elements(c.stats->'LOG') with ordinality e(v,o)
      where v->>'type' in ('creationLocked','creationUnlocked') order by o desc limit 1),'none') lock_state
  from characters c where c.campaign_id='a6687e29-7c12-46b2-a9a3-711586a9ca12' order by 1;
  ```
  Re-lock any that read `none`/`creationUnlocked` with an end-of-log append (the SQL used is in this
  session's history; shape: append `{seq,ts,type:'creationLocked',rules,systemEdit:true,label}` and bump `SEQ`).
- "Character" in Amble is **Archer** (name lost to the reload bug). Anders and Moss currently carry the
  *old* automatic lock, which sits too early.

### Figures (engine, current rules, 2026-10-04)
| Character | DM AP | Drawback AP | Total | DM limit | Limit + drawbacks | Spent | Agreed lock point |
|---|---|---|---|---|---|---|---|
| Anders Pipeleaf | 98 | 12 | 110 | 72 | 84 | 111 (ledger 110) | after Psychic Blades T3, 17 Sep (84→91) |
| Caspian | 95 | 9 | 104 | 74 | 83 | 81 | none — still under the limit |
| Fenwick Copperkettle | 101 | 4 | 105 | 74 | 78 | 97 | after Prestidigitation, 10 Sep (78→82) |
| Moss Stormspud | 100 | 4 | 104 | 79 | 83 | 101 | after Druid: Wild Shape, 8 Sep (75→88) |
| Skylar | 96 | 4 | 100 | 76 | 80 | 98 | after the ability raise, 3 Sep (80→84) |
| "Character" (Archer) | 84 | 0 | 84 | 68 | 68 | 79 | at the end of the log |

Full per-character detail: `docs/plans/2026-10-01-amble-creation-lock-review.md` (revised 2026-10-04).

## Lock-check DM copies (created 2026-10-04, owner jrc.chow, no campaign)
Named `<name> lock check (DM copy)` — Anders, Caspian, Fenwick, Moss, Skylar, Archer. Each has the lock at
the agreed point, prices re-worked under current rules, a DM limit config, and one award = DM AP. Built by
`testing/scripts/creation-lock-forensics/buildcopies.mjs`; verified by `verifycopies.mjs` (ledger = engine
on all six). **The owner is checking these in the tools** — wait for their verdict before the repair.

## Owner decisions (all made — do not re-ask)
| Code | Decision |
|---|---|
| A2 / I2 | Fix CharGen properly (rebuilds must not destroy history), not per-path patches. Boot part done (#553). |
| D1 | Server guard: creation-lock events append-only; only the DM reopens creation or sets the limit. |
| F2 → **L1** | A campaign move **never** clears the finished-creation lock (F2 had a leave/join-elsewhere/return loophole). The ceiling figure is still cleared on a move. |
| G2 | Backdate locks per character after DM sign-off. Rule: **the purchase that crosses the limit counts as creation; the lock goes straight after it**; where spend dipped back under, the crossing that stuck. |
| Moss | Limit = 79 + drawbacks. |
| Archer | Lock at the end of the log. |
| **Q1** | Lock points are judged on **current-rules prices** (engine `compute(foldBuild(LOG)).total`), not the stored ledger, which held stale prices (Skylar's Proficiency +3 at 4 vs 18; Moss's Wild Shape at 0). |
| R | **No mechanics change.** Drawback AP stays in the limit; the "drawbacks excluded" table was display only. |
| P1 | Re-lock and prioritise the server guard over Part 1b. |
| S1 | Keep **every** backup of campaign characters (no 50-snapshot pruning). |

Facts confirmed in code during the session: the lock only changes AP price for **own-species traits**
(`js/engine.js` ~420); **Vigor** is priced by the Hit-Dice tier at purchase (5/8/11/14/17/21/25), **Grit**
by purchase number (+1 past CON mod) — neither by the lock; after the lock **every** purchase also costs
**gold and downtime** in Amble (economy "standard", `chargesGoldAndTime()`). Anders' Psychic Blades T3 was
charged 100 gp / 21 days although under G2 it is a creation purchase.

## Work order (continue from here)
1. **Start of session:** run the lock check above; re-lock if needed. Ask the owner for their verdict on
   the six DM copies.
2. **Decision T (open) — how to test the server guard.** Recommended **T1: a Supabase test branch**
   (small hourly cost, needs owner approval when created). T2 (rolled-back transaction on live) not
   recommended. T3 (first bring the CI test database up to date) is a real gap but a separate, large job:
   `sql/schema.sql` + `sql/rls-policies.sql` are **missing ≥5 functions added since 2026-09-01**
   (`dm_reopen_creation`, `dm_set_creation_ceiling`, `pact_campaign_move_clears_creation`,
   `pact_enforce_player_ap_ceiling`, …), so `cloud-e2e` cannot test this guard today.
3. **Server guard + L1 + S1** — draft at `sql/migrations/2026-10-04-creation-lock-guard.sql`, **not
   applied anywhere**. Test per T (player cannot remove/alter a lock event; cannot append
   `creationUnlocked` or a threshold; can append `creationLocked`; DM reopen works; solo character
   unaffected; campaign move keeps the lock; >50 backups kept for a campaign character; a refused save
   surfaces js/sync.js's "locked character history" recovery path). Then apply (needs owner approval —
   `apply_migration` is in the "ask" list), run the Supabase advisors + logs (AGENTS.md step 4), and
   record it in CHANGELOG/DECISIONS. Also mirror into `sql/schema.sql`/`rls-policies.sql` per convention.
4. **Stale-copy bug** — find why CharGen pushed a local copy older than the cloud row (the #374
   stale-save guard did not catch Skylar 2 Oct / Archer 3 Oct). Evidence: `character_backups` show the
   lost-lock saves reused the lock's `seq` (pre-lock base + name/award resync). The server guard stops the
   damage; this stops the cause.
5. **Part 3 (G2 repair)** — after the guard is live and the owner signs off the copies: rewrite each live
   log as creation → lock → in-play (as the DM copies do), show before/after AP **and gold/downtime**, get
   sign-off, write in one transaction guarded on `updated_at`. Decide Anders' 110 (paid) vs 111 (current
   rules) — recommended keep 110. Restore Archer's name. Restore DM limits on Fenwick (74), Skylar (76),
   Archer (68), Moss (79).
6. **Part 1b** — remaining whole-log rebuild paths in CharGen (random roll, `#b=` share links, legacy /
   untagged imports) → merge instead of rewrite (`replaceWholeLogFromBuild()`), plus refuse re-rolling a
   finished character.
7. **Follow-ups:** `_cgSyncAward()` relocates a burst-shaped award once on load; CharGen edits patch slots
   in place after the lock; server guard does not yet stop moving a post-lock purchase before the lock
   (review H3); `random-manual-e2e.mjs` does not use the shared browser launcher; scan other campaigns for
   the same lock-loss pattern; four free-API cold reviews (needs `GEMINI_API_KEY`, `OPENROUTER_API_KEY`,
   `GROQ_API_KEY`, `DEEPSEEK_API_KEY` as environment secrets).

## Key files
- Plan: `docs/plans/2026-10-01-creation-lock-integrity.md` (round-1 cold review triaged in "Review outcome").
- Review sheet: `docs/plans/2026-10-01-amble-creation-lock-review.md`.
- Decision: `decisions/2026/D-GH-2026-10-01-creation-lock-integrity.md`.
- Session note: `docs/sessions/2026-10-01-amble-creation-locks.md`.
- Draft migration: `sql/migrations/2026-10-04-creation-lock-guard.sql`.
- Scripts: `testing/scripts/creation-lock-forensics/` (README lists inputs).
- Regression test for the reload fix: `testing/scripts/chargen-flows-e2e.mjs` ("a finished character stays
  finished across CharGen reloads").

## Export queries (read-only; save output to the scratch directory, never the repo)
```sql
-- live rows (input for gap/walk/nodraw/buildcopies)
select json_agg(json_build_object('id',c.id,'name',c.name,'kind',c.kind,'ap',c.ap,'updated_at',c.updated_at,'stats',c.stats))
from characters c where c.campaign_id='a6687e29-7c12-46b2-a9a3-711586a9ca12';
-- backups (input for recheck/nodraw/buildcopies; rows: {cid,cur,src,name,kind,t,log})
with ids as (select id, name cur from characters where campaign_id='a6687e29-7c12-46b2-a9a3-711586a9ca12')
select json_agg(r order by r.cid, r.t) from (
  select i.id cid, i.cur, 'backup' src, b.name, b.kind, b.captured_at t, b.stats->'LOG' log
    from character_backups b join ids i on i.id=b.character_id where b.reason='update'
  union all select i.id, i.cur, 'live', c.name, c.kind, c.updated_at, c.stats->'LOG' from characters c join ids i on i.id=c.id) r;
```
Large results spill to a file; parse with Python by slicing from `[{"json_agg"` to the last `</untrusted-data`.

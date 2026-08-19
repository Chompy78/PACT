# D-GH-2026-08-19-amble-character-rebuild-costs — a stale `stats.rules` stamp may be corrected in place

**Status:** DONE · no code change · no `DATA.version` bump (nothing in the app changed)

## Context

Owner asked whether Amble's six characters would cost differently if rebuilt at `v0.356`. Four carried
stale rules stamps (`v0.342` ×3, `v0.341` ×1); two were already current.

Replaying every character's `LOG` through three engine builds — `foldBuild(LOG)` → `compute(b, {dmAp,
ignorePlayerAp:true})`, with the historical engines checked out at `fec9579^` (`v0.341`) and `5c94a1f^`
(`v0.342`) — produced a result that reads alarming and isn't:

| Character | Saved at | Cost then | Cost now | Δ | Drawback refund | AP left then → now |
|---|---|---|---|---|---|---|
| Anders Pipeleaf | v0.342 | 51 | 63 | +12 | −12 | 0 → 0 |
| Caspian | v0.342 | 52 | 61 | +9 | −9 | 1 → 1 |
| Fenwick Copperkettle | v0.342 | 34 | 38 | +4 | −4 | 19 → 19 |
| Skylar | v0.341 | 37 | 40 | +3 | −3 | 18 → 18 |

Every delta is **exactly that character's drawback refund**, and `spendable` rose by the same amount.
This is `v0.354`/`v0.356` moving the drawback grant off the **cost** side (a negative line inside
`total`, via `add()`) and onto the **budget** side (`addDisplay()` keeps the line visible but out of
`total`; the grant now raises `spendable`) — see `D-GH-2026-08-19-drawback-grant-vs-ignore-player-ap`.
Ledger lines are byte-identical across the versions. Nobody was repriced.

`v0.341` and `v0.342` are indistinguishable for all six builds.

**Moss Stormspud is the one genuinely repriced build** — `2nd origin class` 14 → 18 and `Species traits`
0 → 4, **+8 real**. He is the only multiclass character (Ranger + Druid), which is why he alone moved. He
had already been re-saved under `v0.356`, so it was already banked — it is why his AP left reads 1, not 9.

## Decision

**A stale `stats.rules` stamp may be corrected in place with SQL — it does not require a tool re-save.**
Applied here as a single `jsonb_set(stats,'{rules}','"v0.356"')`, scoped to the campaign and to rows whose
stamp was not already current.

This holds **only** under the conditions checked first, each of which is a real gate and not a formality:

1. **The stamp is display-only.** It drives Live Sheet's "Loaded under X rules; now running Y" banner
   (`tools/PACT-Live-Char-Sheet.html:1086`) and nothing else. `compute()` never reads it.
2. **The cloud rows carry no `sig`.** D-GH48 signing is for envelopes that *leave* the tool; these are
   unsigned, and unsigned envelopes load fine. A signed row would have had its signature invalidated by
   any direct field edit — that check is the difference between a safe edit and a corrupted character.
3. **The rewrite was proven to be a no-op in substance** — no cost change, no AP-left change, no new
   warnings — *before* the stamp was cleared. Clearing a drift banner over a **real** drift would be
   hiding a live bug, not fixing a label.

## Why not just let it self-heal

Each stamp re-stamps itself on its owner's next save, so doing nothing was the cheaper option and was
recommended. Owner chose to normalise instead, to stop the DM Console showing three different rules
versions across one campaign roster. Both are defensible; the point of this record is that the *mechanism*
is now established and gated, not that normalising is the house default.

## The verification pattern (reuse this)

The `characters` table has a `BEFORE UPDATE` snapshot trigger (`snapshot_character()`) that writes the
prior row into `public.character_backups`, 50 deep per character. That gives a free before/after oracle —
diff each updated row against **its own** snapshot rather than against a copy you took by hand:

```sql
md5((c.stats - 'rules')::text) = md5((b.old_stats - 'rules')::text)  -- everything except the stamp
md5((c.stats->'LOG')::text)    = md5((b.old_stats->'LOG')::text)     -- the LOG specifically
```

Both returned true for all four rows. Rollback is the same table. The three `BEFORE UPDATE` guards
(`pact_enforce_ap_budget_consistency`, `pact_enforce_locked_history`, plus the snapshot) accepted the
write, which is corroboration rather than proof — they are scoped to AP/budget and locked history.

Accepted side-effect: `trg_characters_updated_at` bumped `updated_at`. A genuine re-save does the same,
and any client that notices pulls an identical `LOG`.

## The trap this record mainly exists to name

**A bigger `total` on an old character is not evidence of a repricing.** Across any version spanning
`v0.354`, `compute().total` changed meaning — the drawback grant left it. Comparing `total` alone across
that boundary makes four untouched characters look 3–12 AP more expensive. **Compare `remaining`, or the
ledger lines, never `total` in isolation.**

A related upside worth recording: under `v0.356`, `compute().total` now equals the frozen ledger spend
(`economy().spent`) for all six characters. Under `v0.342` the two diverged for every character holding a
drawback — the D-GH30 display-divergence class. That is closed for this campaign.

## Operational note

Investigating this needed engines older than the container's clone held: the default checkout was shallow
and only reached `v0.343`. `git fetch --unshallow` was required before `v0.341`/`v0.342` were reachable at
all. Worth knowing for the next version-archaeology task — the versions are not missing, just not fetched.

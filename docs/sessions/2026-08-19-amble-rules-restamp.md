# 2026-08-19 — Amble: do the characters cost more under v0.356?

Owner question: look at all six characters in the **Amble** campaign and work out whether rebuilding
them at today's rules (`v0.356`) would give them a **different cost**. Answer up front: the headline
cost number moves for four of them, but **not one of them was actually repriced** — and the one
character a rebuild genuinely would have repriced had already absorbed it.

## Method

Each character's `stats.LOG` was replayed through three engine builds and priced with the campaign's
real settings (`campaigns.ignore_player_ap = true`, `dmAp` from `characters.ap`):

```
foldBuild(LOG)  ->  compute(b, { dmAp, ignorePlayerAp: true })
```

Historical engines came from detached worktrees at the last commit carrying each rules version —
`fec9579^` for `v0.341` and `5c94a1f^` for `v0.342` — against the working tree for `v0.356`. (The
container's clone is shallow by default and only reached back to `v0.343`; `git fetch --unshallow`
was needed before the older versions were reachable at all.)

## What was found

**`v0.341` and `v0.342` are indistinguishable for these six builds** — byte-identical `compute()`
output across the board. Skylar being one version further behind than the others made no difference.

**The four stale characters' `total` rose by exactly their drawback refund**, and their `spendable`
rose by exactly the same amount:

| Character | Saved at | Cost then | Cost now | Δ | Drawback refund | AP left then → now |
|---|---|---|---|---|---|---|
| Anders Pipeleaf | v0.342 | 51 | 63 | +12 | −12 | 0 → 0 |
| Caspian | v0.342 | 52 | 61 | +9 | −9 | 1 → 1 |
| Fenwick Copperkettle | v0.342 | 34 | 38 | +4 | −4 | 19 → 19 |
| Skylar | v0.341 | 37 | 40 | +3 | −3 | 18 → 18 |

This is the `v0.354`/`v0.356` drawback accounting change, not a price change: the drawback grant moved
off the **cost** side (where it had been a negative line inside `total`, via `add()`) and onto the
**budget** side (`addDisplay()` keeps the line visible but out of `total`; the grant now raises
`spendable` instead). Their ledger lines are byte-identical between versions. Net position unchanged
for all four — same AP left, no new warnings.

> **The trap worth remembering.** A bigger `total` on an old character is *not* evidence of a
> repricing. Compare `remaining` (or the ledger lines), never `total` alone, across a version that
> spans `v0.354`. Four characters here look like they got 3–12 AP more expensive and none of them did.

**Moss Stormspud is the only genuinely repriced build** — `2nd origin class` 14 → 18 and
`Species traits` 0 → 4, so **+8 real** on top of his +4 drawback shift. He is the only multiclass
character in the campaign (Ranger + Druid), which is why he alone was touched. He had already been
re-saved under `v0.356` earlier the same day, so the cost is already banked — it is why his AP left
reads 1 rather than 9. Nothing was pending for him.

Fenwick picked up a cosmetic zero-value `Species traits` line (0 AP, no cost effect).

**A good side-effect:** under `v0.356`, `compute().total` now equals the frozen ledger spend
(`economy().spent`) for all six characters. Under `v0.342` the two diverged for every character
holding a drawback — the D-GH30 class of display divergence. That is now closed for this campaign.

## What was changed

Owner elected to normalise the stamps rather than leave them to self-heal on each player's next save.
`stats.rules` was set to `v0.356` for the four stale rows (Anders/Caspian/Fenwick from `v0.342`,
Skylar from `v0.341`) with a single `jsonb_set`, scoped to the Amble campaign and to rows whose stamp
was not already current. **No LOG, and no other field, was touched — and no code changed; the repo has
no diff from this session.**

The stamp is informational: it drives Live Sheet's "Loaded under X rules; now running Y" banner
(`tools/PACT-Live-Char-Sheet.html:1086`). Since the four were verified to have no cost or AP-left
change, that banner was a false positive for them. Checked first that the cloud rows carry **no `sig`**
(D-GH48 signing applies to files that leave the tool; these are unsigned, and unsigned envelopes load
fine), so a direct field edit had no signature to invalidate.

## Verification and rollback

Each updated row was diffed against **its own pre-update snapshot** in `character_backups`:
`md5((stats - 'rules')::text)` matched, and `md5((stats->'LOG')::text)` matched, for all four — so
only the stamp moved. Envelope keys and LOG lengths unchanged. All three `BEFORE UPDATE` guard
triggers (`pact_enforce_ap_budget_consistency`, `pact_enforce_locked_history`, plus the snapshot)
accepted the write.

Rollback is automatic and available: `snapshot_character()` wrote the prior rows into
`public.character_backups` with `reason = 'update'` (captured `2026-08-19 09:01:18Z`), retained 50 deep
per character.

One side-effect accepted deliberately: `trg_characters_updated_at` bumped `updated_at` on the four
rows. A genuine re-save would do the same, and any client that notices will pull an identical LOG.

## Final standings (v0.356)

| Character | Cost | Spendable | AP left |
|---|---|---|---|
| Anders Pipeleaf | 63 | 63 | **0** |
| Caspian | 61 | 62 | 1 |
| Fenwick Copperkettle | 38 | 57 | 19 |
| Kaelen Dawnbreaker | 2 | 53 | 51 |
| Moss Stormspud | 57 | 58 | 1 |
| Skylar | 40 | 58 | 18 |

No warnings on any character. Worth flagging for the table: **Anders is at exactly 0 AP left** — no
headroom for any further purchase without a new award.

## Logging decisions for this session

`CHANGELOG.md` was deliberately **not** touched, at the owner's explicit call: nothing in the app
changed — no engine, tool or rules diff, and `DATA.version` is untouched — so the changelog stays a
history of what shipped rather than of operational data corrections. This note is the whole record.

Test gate run at close on the docs-only commit: `testing/scripts/engine-parity-ci.mjs` → **0 failed**.

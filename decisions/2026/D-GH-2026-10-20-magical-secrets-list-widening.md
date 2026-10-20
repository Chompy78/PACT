# D-GH-2026-10-20-magical-secrets-list-widening — Bard Magical Secrets is back, as a list-widening only

Status: Active. Rules `DATA.version` v0.383 -> v0.384. Engine data, engine (`widenedLists`), both tools' spell pools, the served Players Guide and the `pact-guide` master in this change.

## Context

Magical Secrets (Bard, 13 origin / 22 cross, HD 10) was barred in v0.382 (`D-GH-2026-10-20-bar-unreviewed-grants`) because the engine gave it six free off-list spell picks of any level (worth 6-30 AP) that the Guide says belong to the spell economy. The 2024 rule is narrower: when a Bard gains new prepared spells, they may be chosen from the Bard, Cleric, Druid and Wizard lists. It gives no extra spells and no slots.

## Options and owner pick

The owner chose BO1 (board task `chore/review-barred-abilities`, item 5): unbar it as a list-widening only, price unchanged. Not taken: keep it barred, or keep the free picks capped (R6). Eldritch Knight and Arcane Trickster stay barred for good (BH): those subclasses reach Wizard spells by buying the Wizard discipline.

## Decision

1. Data: the feature loses `bar:true` and returns to `featureList` (its old position). Its `choiceGrants` entry becomes `widen: "Bard"` (no `bar`): `ownedChoiceGrants()` skips any entry with `widen`, so the free-pick block and `grantedSpells()` rows stay off.
2. Engine: new export `widenedLists(b, cls)` returns the extra class lists for a discipline: the feature owned, `hd >= charLevel` (10), the discipline named in `widen`, never the discipline's own list. Display-side only; `compute()` does not call it and no price moves.
3. Tools: each tool's own `eligibleSpells(b, ti, di)` adds leveled spells on a widened list to the pool, flagged `widened`. A cantrip is never widened. Names are still free text ("pick from the list or type any name"), so nothing that was legal becomes illegal.
4. Guide (both copies): the row reads `17 (13)` / "Buy (HD 10+; widens your Bard spell list, no extra spells)" (the printed sticker was right: the guide's sticker column is the engine's sticker figure, not the cross-class price; the board note "reconcile the printed 17 to 22" was wrong). The "Barred while under review" paragraph now says nine abilities and explains the widening.
5. Tests: `barred-grants-ci` (47) pins the price, the gate and a mutation control; `magical-secrets-widening-e2e` (18) drives both tools' pools; `livesheet-pack-spells-e2e` moves to Eldritch Knight as its choice-grant fixture.

## Why

A widening is the one part of Magical Secrets that is both in the 2024 text and not already sold elsewhere. Reading it in the pool code rather than adding a priced benefit keeps the price at 13 / 22 and avoids repricing anyone. No live character owns it (checked 2026-10-20: none of the barred features were owned), so nothing needed grandfathering.

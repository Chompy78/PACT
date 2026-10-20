# D-GH-2026-10-20-bar-unreviewed-grants — ten abilities barred "for the time being" until each is reviewed

Status: Active (temporary). Rules `DATA.version` v0.381 → v0.382. Engine data, engine, both tools (art menus), the served Players Guide and the `pact-guide` master in this change.

## Context

A read-only grants audit (2026-10-20) found abilities that PACT sells as features but that either grant nothing the engine applies (Iron Mind, Disciplined Survivor, Otherworldly Glamour, Bonus Skills, Body and Mind) or grant free spells the Guide says are barred (Eldritch Knight, Arcane Trickster, Magical Secrets), or whose text claims more than the engine does (Telepathic, Tavern Brawler). Live Supabase (project piuprrrnaotrtxucrtsb, 2026-10-20, `stats::text ilike` on all 12 names): no character owns any of the features or free picks; one player (3 rows) mentions Tavern Brawler.

## Options and owner pick

The owner asked (in words) to keep Boon of Fortitude and Boon of Skill and to bar the others "for the time being", with a task to review each one and a separate task for escalating epic-boon prices. Alternatives not taken: fix each grant now (needs a rules decision per ability), or bar only Iron Mind and Disciplined Survivor.

## Decision

1. Six class features and two arts get `bar:true`; the five that appeared in `DATA.featureList` are removed from it. `bar` gates NEW purchases only (menus, search, roller); pricing and replay are untouched, so an owner keeps their ledger. Arts gain the same flag: hidden in the CharGen and Live Sheet art menus unless the character already owns it, skipped by the CharGen roller.
2. `choiceGrants[k].bar:true` on Eldritch Knight, Arcane Trickster and Magical Secrets; `ownedChoiceGrants()` skips them, so the six free off-list picks disappear from both ✎ Name dialogs and from `grantedSpells()`. The subclass and its own spell bundle are untouched.
3. Boon of Fortitude and Boon of Skill are not barred (owner). Their missing effects (+40 HP, every skill) stay on the board (BK / BI). BI's Boon of Skill half is overtaken by this choice.
4. Guide: ten rows read Barred and one paragraph ("Barred while under review") names them; Tavern Brawler leaves the "allowed" sentence. A Guide paragraph that exists only in the served copy (it names Magical Secrets as a priced feature) was left alone so the two copies do not diverge further.
5. `gen-drawback-prices-sql.mjs --check` ignores the rules-version token in the generated comment: the migration carrying the block is applied (history) and every later version bump would otherwise fail the check without any drawback price moving.

## Why

Barring is reversible (delete a flag) and cannot reprice anyone; it stops new players buying features that charge for nothing while the owner reviews each ability. The Guide already said Iron Mind and the Eldritch Knight / Arcane Trickster spell picks were barred, so those two changes make the engine match it.

## Open

A task on the board reviews each of the ten one by one; a second task makes each epic boon cost more than the one before. The `pact-guide` project's own CHANGELOG / TASK_BOARD / generated files still need the reconciliation task already on the board.

## Update 2026-10-20

Magical Secrets was unbarred in v0.384 as a list-widening only (owner decision BO1): see `D-GH-2026-10-20-magical-secrets-list-widening`. The other nine stay barred.

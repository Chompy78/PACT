# Campaign NPCs, the Amble NPCs, lineage spell gates, release v1.612 — 2026-10-11

**Owner's decisions this session:** B3 → D2 (build a real NPC flag first, don't bind NPCs as ordinary characters), C1 (Bram at 82 DM AP
total), E2 (spell out the lineage spell gate), F3 (lineage 2nd-level spell price question left for later). Merge on green and promote.

## NPCs: the cheap path was a dead end
The owner first chose to bind the Amble NPCs (Bram, Wren; two versions per arc) as ordinary characters (B3). Checking before writing found
that the one-character-per-owner-per-campaign unique index — also the race guard for player joins — made that work for exactly ONE NPC, and
that binding auto-grants the campaign's starting AP (Amble: 36). The owner switched to D2: build `characters.is_npc` first.

## Cold review changed the design
Plan `docs/plans/2026-10-11-campaign-npcs.md`, reviewed by two free API models. Gemini (flash-lite, self-identified wrongly as GPT-4o) found
the one real flaw: excluding NPCs from the basic-mode count lets any basic-mode user create their own campaign and bind unlimited characters
as NPCs (verified: `campaigns_insert` only checks `dm_id = caller`). NPCs now still count. nemotron found nothing new. Files:
`docs/plans/cold-reviews/2026-10-11-*-campaign-npcs.md`; scorecard rows added to ai-templates' `data/cold-review-track-record.md`
(uncommitted there).

## Shipped (#606), applied live before merge
Migration applied to production first (additive, default false; live site serves `main`), then verified: the 8 live function bodies hash
identical to the repo's migration path; security advisor +1 (`dm_bind_npc`, intended). `cloud-e2e` failed once on a GitHub rate limit
downloading the Supabase CLI (no tests ran) and passed on re-run. `preview` moved twice under the PR; both rebases were mechanical.

## Live data changes (database only, no code) — all as the DM's own account via the real RPCs
Run through `execute_sql` with `request.jwt.claims` set to the DM, so `auth.uid()` is the DM and every ledger row is attributed to them.
| NPC in Amble | DM AP | How |
|---|---|---|
| Bram Cotter Ch8-12 | 130 | bound; 82 then +48 |
| Bram Cotter Ch4 end | 82 | copy of Ch8-12 (new id in row and envelope, renamed name event, the source's bind-time `creationLockConfig` note dropped) |
| Wren Ch4 end | 82 | bound; one award |
| Wren Ch8-12 | 130 | copy of Wren Ch4 end |
The six Amble player characters were not touched. The copies are exact copies of the source builds — the owner trims Ch4 Bram / grows Ch8-12 Wren in CharGen.

## "Why does the Tiefling ability say L3?" became a rules fix (#610, v0.373)
The third element of each `DATA.lineageSpells` entry was both a spell level and (via `hdGate`) the Hit Dice gate. 2nd-level spells were
stored as "3rd" to reach 5 HD — hence "L3" — and the six 1st-level lineage spells had no gate though the PHB grants them at level 3. CharGen
did not gate lineage spells at all; the Live Sheet did, with its own copy of the rule. Entries now state their Hit Dice; one engine pair
(`lineageSpellHD`/`lineageSpellLabel`) feeds every tool; CharGen greys like a tiered racial trait. "T3" was rejected as the label because
T3 means 3 HD elsewhere and Darkness needs 5. Guide updated in both copies (the `pact-guide` master already had someone's uncommitted edits
from earlier the same day; this session's 12 cells + one sentence sit on top, uncommitted there). Live: 0 of 7 lineage-spell owners affected.
Left open (F3, on the board): the five 2nd-level lineage spells cost 12, the guide's rule says 2nd-level costs 9.

## Release
Promotion PR #612 → build `v1.612` (sync commit `8b3fd59` pushed straight to `preview` per `docs/VERSION-SYNC.md`). Merged once every check
passed, as a regular merge commit (`1bae766`, two parents — never squash for a promotion), and tagged `v1.612`. `main` serves BUILD `v1.612`,
rules `v0.373`.

## Not this session's, noted
`esc-gap-verify` fails "CharGen never became ready" on unchanged `preview` too.

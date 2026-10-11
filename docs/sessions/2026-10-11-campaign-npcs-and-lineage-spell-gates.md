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

## After the first close: NPC versions finalised (live data only)
- The owner finalised the Ch4 builds, then had the old **Ch8-12** rows deleted and replaced by copies of the finalised Ch4 builds under
  the Ch8-12 name, at **130 DM AP** each (Ch4 versions stay at 82). Deletes are recoverable: `trg_characters_snapshot` put both deleted
  rows in `character_backups`; their award ledger rows were cascade-deleted. The owner then renamed Wren to "Wren Ashdown …".
- **Bram descriptions** were written straight into both Bram rows from the owner's list (the appearance event replaced in place, as
  CharGen does; `appearance` is exempt from the freeze), with a re-written overall paragraph. **Wren descriptions:** the owner's first
  edits were never in the cloud (checked event-by-event and against the row backups — not a code fault found); they arrived with a
  later save at 10:32, and only Wren's overall paragraph was then re-written (K1).

## "Another session reads Bram as Small" → the stored-size fix (#615, owner choice I3)
Root cause differed from the first guess (a display bug): every screen shows `compute().size`, which ignores a stored size that isn't a
choice — but CharGen parked its hidden size dropdown at "Small" and saved it, so **23 of 37** characters stored Small while being
Medium, and raw readers were misled. I3 was chosen as "plus a DM-authorised server function for sealed rows"; reading the freeze
trigger showed it only guards the history before the lock, so an **appended** correction passes it — no server function was built.
`sizeOf()` in the engine (484 combinations identical to the old engine), CharGen stores its answer, and a one-off SQL appended a 0-AP
correction to the 23 (applied live; every character's play outputs identical before/after; mismatches 23 → 0). Both API cold reviewers
flagged first-vs-last raw readers → AGENTS.md's data rule now says how to read a character from the raw database. Reviews:
`docs/plans/cold-reviews/2026-10-11-*-stored-size.md`.

## Release v1.616
Promotion PR #616 (rules `v0.374` from #609, #615, #613); sync commit `eb9403c`. Merged as a regular merge commit (`494d290`, two
parents) and tagged `v1.616` once every check passed. Two false stops on the way, both safe (nothing merged): the watcher started in
the gap before the new checks registered ("no checks reported"), and `cloud-e2e` hit the same GitHub rate limit downloading the
Supabase CLI as on #606 (no tests ran; passed on re-run).

## Not this session's, noted
`esc-gap-verify` fails "CharGen never became ready" on unchanged `preview` too.

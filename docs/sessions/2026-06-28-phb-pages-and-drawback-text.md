# Session — 2026-06-28 · PHB pages + drawback text (v0.106)

*History / non-authoritative. Authoritative state: `RESTART-STATUS-v0.322.md`, `DECISIONS.md` D-014.*

## Goal
Close the one open thread: fill the PHB page numbers (weapon masteries + Arts & Techniques) and
the 69 drawback descriptions, from John's two source files:
- `phb-rules-final-claude.jsonl` — 1,576 PHB rule entries, each with a `page`. Masteries and A&T are
  in here (A&T are filed as `category:"Feat"`, 75 of them; masteries as `Equipment` "(mastery)" rows).
- `PACT-Players-Guide-v0.324.html` — the drawback table (`<tr><td>name</td><td>desc</td><td>+cost</td></tr>`).

## What we found (tools beat the stale note)
- **`drawbackFx` was already fully populated** — 69 string descriptions, not the empty map the
  restart-status implied. The initial probe wrongly reported it empty because it checked `.desc`/`.page`
  on values that are plain strings. Corrected by re-probing as strings.
- **`masteryFx`** already held the 8 effect texts with `page:null` — only the page was missing.
- `_aTip(name,src)` (LiveSheet, per-file) renders `o.fx + (o.page ? " (PHB p.N)" : "")`, fed by
  `DATA.arts` / `DATA.maneuvers` / `DATA.metamagicOptions`; drawbacks render their string directly.
  So art pages go on `DATA.arts[*].page`; masteries on `DATA.masteryFx[*].page`.

## What we did
- **Masteries:** all 8 → `page:214` (the JSONL `Equipment` "(mastery)" rows are all p214).
- **A&T:** matched 41/43 `DATA.arts` to JSONL `Feat` rows by normalized name; set `page`. Blessed Warrior
  + Druidic Warrior have no JSONL row → left page-less (no fabrication).
- **Drawbacks:** reconciled engine vs guide — 53 identical, 10 synced to the guide's fuller wording,
  6 split `Affliction —` rows left as-is (guide stores them as one combined row). The 10 diffs only add
  DEX/WIS cap clauses that `drawbackMaxStats` already enforces → display-only, so `DATA.version` stays v0.322.
- Edits were surgical: verified `JSON.stringify(DATA[sub])` appears verbatim in the minified `data.js`,
  then replaced old→new for `masteryFx`/`arts`/`drawbackFx` only. `build.cjs` re-inlined into all 3 tools.
- **Build bumped v0.105→v0.106** (filenames, HTML headers, INDEX/CONTEXT markers, RESTART-STATUS) per CONTEXT §6.

## Result
46/46 gates green (G1 build-check + G3 version-consistency verify the bump). DATA.version v0.322.

## Left open
The 6 `Affliction —` descriptions have no "capped at 10" clause in their text (the cap is still enforced
mechanically). Asked John whether to append it for parity with the 10 synced rows.

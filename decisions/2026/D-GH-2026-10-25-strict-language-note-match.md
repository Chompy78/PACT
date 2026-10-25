# D-GH-2026-10-25-strict-language-note-match — a plain language name is listed when the campaign's list entry carries a "(note)"

**Context.** Found live 2026-10-22: Skylar, a player in campaign Amble, could not spend or save because her language was the plain
"Haldeni". Amble's language list is strict (`rules.languages = {list, strict:true}`) and its entries carry notes inside the name
("Haldeni (default)", "Aelvish (Elven dialect) (Elven rule)", "Thieves' Cant (Albric)"). `campaignLanguages(rules).isListed()` in
`js/engine.js` was an exact, case-insensitive match, so the plain name a player types counted as off the list. Seven characters were
rewritten by hand to "Haldeni (default)" the same day; the cause remained for every new player.

**Options.**

- **Q1 — what counts as the plain name?**
  - A. Strip every bracket group anywhere in an entry. B. Strip only TRAILING bracket groups ("Aelvish (Elven dialect) (Elven rule)" -> "Aelvish").
  - **Decision: B.** A bracket in the middle of an entry is part of the name, and stripping it could list a word the DM never offered. An
    entry that is only a note adds no key (otherwise the blank name would be the only free name anyway).

- **Q2 — what does a player see and what is stored?** (the task's open question)
  - A. CharGen offers the full list entry and stores it. B. Accept the plain name as typed and store what was typed.
  - **Decision: B, PROVISIONAL — the task recommended it, the owner has not yet confirmed.** Nothing is rewritten, so no character's data
    moves; the suggestions (`list`) still show the full entries. The cost of being wrong is small and reversible (a later change can
    normalise names on save).

- **Q3 — is this a rules change (`DATA.version` bump, Players Guide)?** The task said yes.
  - **Decision: no.** `isListed()` is read by the three tools only; `compute()` never calls it, prices the language COUNT, and never
    reads a name (the comment above `STANDARD_LANGUAGES` says so). AGENTS.md reserves `DATA.version` for changes to ladders, prices, gates
    or `compute()` output. The Players Guide does not mention the campaign language list at all (searched 2026-10-25). So no bump and no
    guide edit; `engine-parity` is untouched (136 passed / 0 failed). If the owner wants it treated as a rules change anyway, it is a
    one-line bump.

**Not matched on purpose.** A partial note ("Aelvish (Elven dialect)") is not the plain name and is not an entry, so it stays off the
list. "Common" stays off Amble's list (only "Common Sign Language" is there). A name already locked into a character is still never
refused (unchanged). The plain "Thieves' Cant" now matches all four dialect entries; that is the intended reading of a plain name.

**Status.** Accepted, with Q2 awaiting the owner's confirmation. Pinned by `testing/scripts/campaign-language-note-ci.mjs` (63 cases against
a frozen copy of Amble's real list; 12 of them fail on the old engine).

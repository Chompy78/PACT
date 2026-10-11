# D-GH-2026-10-12-campaign-language-list — a campaign can set its own language list

Status: Active. Engine helper + all three tools in this change. No `DATA.version` bump: `compute()` prices the language
*count* and never reads a name. No database change: the setting lives in the existing DM-only `campaigns.rules` JSON.

## Context

Owner request: languages should be customisable per campaign — e.g. one campaign drops "Common" and uses Haldeni, Orcish
(Kaldrunic), Elven (Aelvish), Albric, Aurelani. Before this, a character bought a number of languages and named them in free
text, with a fixed suggestion list (`LANGS_2024`, the 2024 PHB list) copied separately into CharGen and the Live Sheet.

## Options (owner chose A1, then asked for A3 as a DM switch)

- **A1** — the campaign list replaces the suggestions, players can still type their own, off-list names are marked.
- **A2** — suggestions only, no marking.
- **A3** — off-list languages block saving. Risk: a language can't be unlearned, so a character with "Common" already locked in
  would never be able to save again.

## Decision

1. `rules.languages = {list: [...], strict: bool}`. An empty or missing list means the standard list.
2. `js/engine.js` exports `STANDARD_LANGUAGES` (the one copy; both tools' `LANGS_2024` removed) and `campaignLanguages(rules)`,
   which cleans the DM's names (trims, de-duplicates case-insensitively, strips `< > " &` because they render in players'
   browsers) and answers `isListed(name)` case-insensitively.
3. Live Sheet (`resolveRules()`, so the offline LOG snapshot carries it) and CharGen (`cloudRules()` or the copy sandbox's rules)
   suggest the campaign list, show it above the language rows, and mark an off-list name "Not on this campaign's language list".
4. **Strict (A3, DM Console checkbox "Only allow languages on this list")** refuses only a *newly entered* off-list name, at the
   names dialog's save. A name already locked into the log (Live Sheet: the read-only row) or unchanged from the saved one
   (CharGen) passes and is only marked. That keeps A3's intent without stranding existing characters.
5. DM Console rules panel: a "🗣 Languages" block (textarea, one per line; "Fill with standard list"; the strict checkbox),
   saved by the shared Save rules button and behind the same lock.

## Why

- Checking at the names dialog rather than in `validate()` (which gates cloud save) is what makes the exception for
  already-locked names possible: `validate()` sees only the folded build, not which names predate the list.
- This is a client-side guard, like the campaign bans. A player editing a file by hand can still name anything; the DM sees the
  names on the sheet.

## Status / follow-ups

- Gate: `testing/scripts/campaign-language-list-e2e.mjs` (22 checks), wired into `economy-ui.yml`.
- Not done: the DM Console roster doesn't mark off-list names (its proficiency overview shows language counts only).

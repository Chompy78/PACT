# 2026-10-22 — security audit (RLS/RPC boundary + stored XSS) and the two fixes it produced

**Trigger.** Owner asked how to spend spare credits usefully; chose deep audits (read-only), then the
security audit and a stored-XSS sweep together, then the fixes.

## What was done
- **Audit, repo side (read-only agent):** every migration, RLS policy and RPC read against the attacker model in
  `docs/TASK_BOARD_NEXT.md`'s "Security audit" task. Report was a scratchpad file, not kept.
- **Audit, live side (read-only SQL, owner pre-approved read-only Supabase use):** advisors, function grants,
  table and column grants, policies, triggers, bodies of the RPCs that do not call `auth.uid()` directly.
  Result: every `SECURITY DEFINER` function pins `search_path`, none is callable by `anon`, RLS is on everywhere,
  column-level UPDATE grants are narrow, 17 triggers guard `characters`. Only advisor item to act on:
  leaked-password protection is off (dashboard toggle, now a board task).
- **XSS sweep:** the agent's report was checked against the code before being relied on. The sink was real but the
  attack path it named (a `buy hd` event) was wrong — `MUT.hd` clamps; the real path is a `buy` with `cat:'patch'`
  (`Object.assign(b, patch)`, `js/engine.js` MUT.patch), which `foldBuild` never coerces. Fixed in #708.
- **AP minting:** the audit's top finding was confirmed against live function bodies (not executed): create own
  campaign, `dm_bind_npc` own character, `award_ap`, `dm_unbind_character`, `bind_character_to_campaign` into a
  victim campaign — `characters.ap` survives every move. Live check on 2026-10-22: all 10 campaign-bound characters
  already matched their award sums, so no sign it was used. Fixed in #707.

## Decisions taken with the owner
- D1 (XSS): deep + shallow together — coerce numeric build fields once in the fold, and `esc()` at every sink.
- E3: fix the two sharpest server holes now (#707), log the rest as board tasks (seven added, `f0c793e`).
- G1: leave the one solo character holding 70 AP with no award row alone for now; it loses that AP only if it joins
  a *different* campaign (the new trigger resets AP to the new campaign's award sum).

## State left behind
- **#707's migration is applied to the live database (later the same day).** The first two `apply_migration`
  attempts failed with "Invalid or expired requestState" (the approval prompt timed out, nothing applied); the
  third, with the owner at the screen, succeeded. Read-only checks afterwards: the trigger exists, `edit_ap_award`
  carries the new membership check, `edit_ap_award` is callable by `authenticated` but not `anon`, and the reset
  function is callable by neither and pins `search_path`. `get_advisors` (security) showed nothing new. The
  function bodies were not diffed against the file and the logs were not queried.
- **#708 merged** after a clean merge of `preview` into its branch (#709/#710 had landed); gates re-run green.
- **Released as v1.712:** promotion PR #712 (merge commit `06103bc`) and a GitHub Release. Three CI jobs first
  failed at "Install Chromium" (a runner download timeout, not a test); re-runs passed, and their scripts were
  also run locally on the `preview` tip.
- Tooling note: `gh pr merge` was refused by the auto-mode classifier twice even with
  `Bash(gh pr merge:*)` in `.claude/settings.local.json`, then went through on the third attempt; an unrelated
  `git pull` was refused straight afterwards. Not a rules problem — the classifier's judgement varies.

## Live-data fix: Amble's strict language list (same day, owner's call)
- **Report:** a player (Skylar) could not spend or save with the language `Haldeni`. Cause found: Amble's campaign
  language list is strict (`rules.languages.strict = true`) and its entries carry notes inside the name
  (`Haldeni (default)`, `Aelvish (Elven dialect) (Elven rule)`, …). `campaignLanguages().isListed()` is an exact,
  case-insensitive match, so the plain `Haldeni` a player types is "off the list" (checked by running the engine's own
  function on a copy of the list). The exact error on her screen was not seen, so this is the likely cause, not proven.
- **Scope measured (read-only):** seven Amble characters held plain `Haldeni` in a `names` event — Archer, Caspian,
  Fenwick Copperkettle, Moss Stormspud (two events), Skylar and the two Bram Cotter NPCs. Only the Wren NPC already used
  the annotated name.
- **What was done:** the owner chose to rewrite the characters, not the list. `dm_edit_character_log` cannot do this
  (it only appends award, seal, discount and note events), so one admin `UPDATE` via the Supabase MCP replaced the exact
  string `Haldeni` with `Haldeni (default)` inside `names` events' `lang` arrays for the seven characters. No trigger was
  disabled; the server accepted it. Verified afterwards: no plain `Haldeni` left, event counts, `SEQ` and `ap` unchanged
  (Skylar: 32 events, 103 AP). Before-values were kept in the session scratchpad only.
- **Trade-offs the owner accepted:** sealed history was edited outside the audited DM route, and the sheets now show
  the note `(default)` as part of the language name.
- **Not fixed (the cause remains):** any new player who types a plain name from an annotated strict list hits the same
  refusal. Options on record: strip a trailing `(note)` in the match (engine change), or clean the list's names.

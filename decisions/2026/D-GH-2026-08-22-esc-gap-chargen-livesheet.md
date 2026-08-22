# D-GH-2026-08-22-esc-gap-chargen-livesheet — closing five stored-XSS/attribute-injection gaps in CharGen and Live Sheet

## Context
A full playability/usability/logic audit of the three tools (2026-08-22, run as four parallel agent
reviews — one per tool plus the engine — each cross-checking claims against the actual shipped code)
found five places in CharGen and Live Sheet where a player-controlled value reaches `innerHTML` or an
HTML attribute without passing through `esc()`/`_csEsc()`, violating this repo's own hard invariant
(`AGENTS.md`: *"every player-controlled value that reaches innerHTML/an attribute must pass through
esc()... cloud data now crosses users, so an unescaped field is a stored-XSS path, not just a display
bug"*). Filed as a NOW task the same day
(`fix/esc-gap-chargen-livesheet` on `docs/TASK_BOARD_NOW.md`) and picked up immediately since three of
the five sites are reachable through completely ordinary UI use — no file tampering, no crafted
request — and are cross-user reachable via cloud sync, share links, and DM Console's roster/
`?viewChar=` view of another player's character.

The five sites, and why each is exploitable:
1. `tools/PACT-CharGen-Webtool.html:5139` (`renderCharSheet()`) — `b.languageNames` joined into
   `innerHTML` unescaped, while every sibling field in the same function (cantrips, spells, fighting
   styles, tool/instrument names) is escaped via `_csEsc()`. Reachable directly through the shipped
   "Name spells & languages" dialog — the ordinary, documented way to set this field.
2. Same function, `:5142`/`:5162` — mastery and drawback labels also unescaped. Not reachable through
   the checkbox-constrained UI in normal use, but neither `MUT.mastery`/`MUT.drawback` in
   `js/engine.js` nor `foldBuild()` validate the value against the known vocabulary before storing it,
   so a hand-edited save file, a manipulated share-link payload, or a compromised cloud record can carry
   an arbitrary string here.
3. `tools/PACT-Live-Char-Sheet.html:1298-1300` (`validate()`) — "Feature/Boon/Drawback no longer in
   rules: "+`e.payload.v` interpolated raw, then rendered into `#tray.innerHTML`. Reachable via the
   unrestricted JSON import path (`importJSON()` has no schema/whitelist check on `payload.v` — only a
   non-blocking tamper-evidence signature warning that loads the file either way), cloud sync, and DM
   Console's `?viewChar=` read-only view of another player's character.
4. `tools/PACT-Live-Char-Sheet.html:1471` — the drawback buy-off button's `onclick` handler only
   escaped the single quote used as the JS-string delimiter; the surrounding double-quoted HTML
   attribute was never escaped, so the same `payload.v` value could also break out of the attribute
   itself (e.g. `x" onmouseover="…`) — a second, independent injection vector on the same field as #3.
5. `tools/PACT-Live-Char-Sheet.html:1414-1415` — saves/skills/tools+instruments list renders joined
   into `innerHTML` without `esc()`. Same reachability as #3.

`renderCharSheet()` is duplicated byte-for-byte between the two tools (documented in both files' own
header comments), so #1 and #2 each had a live twin in `tools/PACT-Live-Char-Sheet.html:1973/1976` —
plus one more of the same shape found while fixing it: the drawbacks render at `:1996`, the exact
mirror of #2's CharGen drawbacks bug, which the original audit finding didn't separately enumerate but
is unambiguously the same defect. Fixed alongside the rest for consistency rather than left as a
known-identical gap.

## Decision
Closed all eight sites (five audited + the CharGen↔Live Sheet `renderCharSheet()` duplication +
the one same-shape drawbacks mirror found while fixing) with two patterns, matching what the rest of
each file already does correctly:
- **Sites #1, #2, #5 and their duplicates** — wrap the array in `.map(esc)`/`.map(_csEsc)` before
  `.join()`, the same pattern every other field in these functions already uses. No behavior change
  for any value that was already safe; a value containing HTML-special characters now renders as
  literal text instead of markup.
- **Site #3** — `esc(e.payload.v)` at each of the three interpolation points inside `validate()`.
  Deliberately scoped to just the interpolation, not a blanket `esc()` over the whole `issues` array —
  several other entries in that array intentionally embed real HTML (e.g. a "Confirm or change" link),
  and escaping those would break them.
- **Site #4** — rather than trying to correctly double-escape a value that has to survive both a JS
  string literal and an HTML attribute in the same breath, moved the value out of the inline handler
  entirely: `data-v="`+`esc(v)`+`"` plus `onclick="buyoffDrawback(this.dataset.v)"`. `esc()` already
  escapes both `"` and `'`, so it's safe in the attribute context, and `dataset.v` hands
  `buyoffDrawback()` the browser-decoded original string with no double-escaping question to get
  wrong.

**Verification.** Wrote a throwaway CDP-driven script
(`testing/scripts/esc-gap-verify.mjs`, same zero-dependency harness as `tool-pricing-ci.mjs`) that
loads each tool for real, drives `renderCharSheet()`/`validate()`/the buy-off button's markup directly
with the exact payloads from the audit (`<img src=x onerror=…>` for the escaping sites, a bare `"` for
the attribute-injection site), and asserts both that no script executes and that the raw tag/broken-out
attribute never reaches the DOM. All 9 assertions pass against the fixed code. Also ran the two
existing headless gates to confirm no regression outside this change's scope: `engine-parity-ci.mjs`
52/0 (untouched — this is a render-layer fix, `compute()` never changed) and `tool-pricing-ci.mjs`
163/0 (drives real UI across all three tools, including the character-sheet render paths touched here).

## Why
This is the class of bug `AGENTS.md`'s escaping invariant exists specifically to prevent, and the
audit's reachability analysis is the part worth recording: three of these five sites needed no
tampering at all, just the tool's own intended UI (naming a language, importing a JSON save,
buying off a drawback) — this was not a theoretical "what if someone crafts a file" finding. Because
`renderCharSheet()` is genuinely duplicated source (not shared via import), a fix to one copy without
checking the other silently leaves an identical live vulnerability behind — worth naming explicitly
since nothing enforces the two copies staying in sync short of a human noticing on the next edit.

## Status
Implemented directly on `claude/tools-review-issues-y00cx8` (this session's designated branch — the
project's normal `/run-code-task` convention of a fresh `fix/esc-gap-chargen-livesheet` worktree/branch
was not used, since this session operates under a stricter "never push to a different branch without
explicit permission" constraint than the project's default workflow). `engine-parity-ci.mjs`: 52/0.
`tool-pricing-ci.mjs`: 163/0. `esc-gap-verify.mjs` (new, one-off but kept in `testing/scripts/` for
reproducibility): 9/0.

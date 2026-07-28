# D-GH-2026-07-25-dm-console-themes — DM Console gains a theme selector + 3 new themes, token-mapped rather than copy-pasted

Status: Active

- **Context:** while investigating a light-theme readability bug in DM Console earlier this session, found
  it has no theme UI at all — `data-theme="dark"` only ever came from OS `prefers-color-scheme`, with no
  way to override it and none of Live Sheet/CharGen's other 3 themes (D&D/Parchment, Royal, Forest)
  present. Both other tools have a real `<select id="themesel">` dropdown wired to `setTheme()`/
  `localStorage['pactTheme']`.
- **Options:** (i) copy the other tools' theme CSS blocks verbatim into DM Console; (ii) design new
  `[data-theme="dnd"/"royal"/"forest"]` blocks using DM Console's own variable names
  (`--navy`/`--navy2`/`--blue`/`--blue-lt`/`--light`/`--paper`/`--card`/`--ink`/`--muted`/`--line`/status
  pairs), matching the other tools' color choices where a directly-equivalent token exists and deriving
  the rest from the same pattern DM Console's own existing `default`/`dark` blocks already establish.
- **Decision:** (ii). Reused exact hex values from the other tools' themes for every token with a clear
  1:1 role match (`--navy`↔navy, `--blue`↔blue, `--ink`↔ink, `--muted`↔grey, `--line`↔line, `--paper`↔bg,
  `--card`↔card, `--good`/`--bad`↔good/bad, `--light`↔lt where a pale accent tone was needed); derived new
  values only for tokens DM Console has that the other tools don't (`--navy2`, `--blue-lt`, `--good-bg`/
  `--zero`/`--zero-bg`/`--bad-bg`/`--warn`/`--warn-bg`, `--shadow`), each built the same way the existing
  `default`→`dark` pair already derives them (e.g. `--navy2` = a darker shade of that theme's `--navy`,
  status `-bg` pairs = a pale tint of the status color in that theme's hue family).
- **Why:** (i) was rejected outright — DM Console's CSS uses an entirely different variable set than Live
  Sheet/CharGen's (confirmed by diffing both files' `:root` blocks earlier this session while fixing the
  panel-contrast bugs), so a verbatim copy wouldn't even apply to DM Console's selectors. Reusing the
  other tools' hex values (rather than inventing fresh colors) keeps the same 5-theme *palette family*
  recognizable across all three tools for a DM who uses more than one, without requiring an actual shared
  CSS/variable bridge between three intentionally-standalone tools (per `AGENTS.md`'s "Vanilla JS
  only... tools stay standalone single files" hard rule). Verified all 5 themes in a real browser,
  including that the earlier `.panel`/`.btn.ghost`/dark-contrast fixes (D-GH-2026-07-25's other two
  entries) hold up correctly across every new theme — confirming those fixes were genuinely token-based,
  not color-literal patches that happened to work only for `dark`.
- **Status:** DONE. `#dmThemeSel` in the top bar; `dmSetTheme()`/init script mirror the other tools'
  `pact-dm-theme`/`pactTheme` localStorage pattern (same not-distinguished-from-never-chosen "Default"
  quirk both other tools already have, kept for consistency rather than fixed unilaterally here).

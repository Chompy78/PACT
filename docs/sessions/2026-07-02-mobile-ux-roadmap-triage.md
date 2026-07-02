# Session — 2026-07-02 · Mobile UX roadmap triage (sticky buttons, Live Sheet density, theme selector)

*History / non-authoritative. Authoritative state: `CHANGELOG.md`, `docs/PACT_ROADMAP.md`.*

## Goal
The user reported a batch of mobile usability complaints against the live app (screenshots/descriptions,
not code) and wanted them turned into roadmap items — this session did the investigation to ground each
complaint in actual code before filing, then filed them via the `add-roadmap-task` skill (direct commits
to `preview`, no branch/PR, per that skill's design).

## What we did

### 1. Mobile sticky buttons regression
User reported Save/Load/Share/Live Sheet/AI Portrait/Campaign buttons staying pinned on scroll on mobile
when they shouldn't be. Traced to `tools/PACT-Live-Char-Sheet.html`'s `.top` header (`position:sticky`,
~line 58) and `#lmobar` bottom bar (`position:fixed`, ~line 97), both unconditional — not scoped out on
mobile. Notably, this contradicts `DECISIONS.md` D-GH5, which already decided mobile headers should use a
static "app-shell" layout specifically because sticky/fixed was unreliable on real phones; that app-shell
CSS (`height:100dvh`, breakpoints at 768/920/380px) doesn't appear to exist in the file today — flagged in
the task as needing investigation into whether it was reverted or never fully implemented.
Filed as **"Mobile sticky buttons regression"**, initially proposed 🔴 NOW, **downgraded to 🟡 NEXT** by
the user (cosmetic/annoyance, not broken or risky). Branch: `fix/mobile-sticky-buttons`.

### 2. Live Sheet unusably cramped on small mobile screens
User reported the Live Sheet being too small/cramped on mobile, guessing "too many items in a row
somewhere." Confirmed: `.slotgrid` (spell slots, ~line 191) hardcodes 9 columns with zero mobile
adjustment; `.spcols` only narrows 3→2 at 760px with nothing further for small phones; `.shabrow`/
`.shkpis` are hardcoded to 3 columns with no width tuning; only one mobile breakpoint (600px) exists in
the whole file. User then asked for collapsible sections (Buy/progress, Character, History & ledger all
stack into one long always-expanded column on mobile) and **raised the item from 🟡 NEXT to 🔴 NOW**. The
task points at reusing the existing `.bgcat`/`.cath` ▾/▸ collapse pattern already used for buy-list
category groups, rather than inventing a new interaction. Branch: `fix/mobile-livesheet-density`.

### 3. CharGen/Live Sheet theme selector hidden/clipped + no system dark-mode default
User couldn't find CharGen's theme selector and wanted it to default to the device's dark/light setting
(or last-used). Investigation found two separate real bugs, not one: (a) on mobile (≤768px), `.hd-row2`
(which holds `#themesel`) is hidden entirely and — unlike the other header buttons — never re-surfaced in
`.mobile-action-bar`; (b) on desktop, `.hd-row2` has no `flex-wrap`, so a narrow/zoomed window can overflow
and clip the selector even though it's technically present. Also found `index.html` already implements
exactly the "saved choice wins, else follow `prefers-color-scheme`" pattern the user wants, but CharGen and
Live Sheet's separate (shared) theme system (`localStorage['pactTheme']`) has no system-preference
fallback — task asks for the same pattern to be applied to both tools, since they already share theme
storage. Initially proposed 🔴 NOW, **downgraded to 🟡 NEXT** by the user. Branch:
`fix/chargen-livesheet-theme-selector`.

### Parallel sessions
Other Claude Code sessions were filing roadmap items on `preview` at the same time (PWA stale-version
reload bug, Live Sheet racial-trait export crash, cloud/campaign state visibility, BUILD export wiring).
Each of this session's pushes hit a non-fast-forward rejection at least once; resolved each time with
`git fetch origin preview && git rebase origin/preview` before re-pushing — no conflicts, all auto-merged
cleanly since everyone was appending to different points in the file.

## Notes
- No `DECISIONS.md` entry — these are roadmap-item filings (open work), not architectural decisions; each
  task's own `text` block already carries the "why" for whoever picks it up.
- No code was touched this session (roadmap-doc edits only), so the engine-parity gate was not run —
  correctly, since it doesn't apply to a docs-only change.
- All three tasks are filed against the *same file* (`tools/PACT-Live-Char-Sheet.html` for #1/#2,
  `tools/PACT-CharGen-Webtool.html` + Live Sheet for #3) — worth picking up together or in sequence to
  avoid three separate agents editing overlapping CSS/header regions in parallel.

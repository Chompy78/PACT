# D-GH-2026-07-16-dev-status-page — a live-fetch glance dashboard, distinct from the baked-in roadmap.html

Status: Active

- **Context:** the reconciliation asked for a quick-glance human-status page (current tasks + recent
  decisions + recent changes). `docs/roadmap.html` already renders the fuller Board/Timeline/Dashboard
  views, but from a **baked-in** `const ITEMS` snapshot that must be hand-regenerated when it drifts.
- **Options:** (1) skip it — `roadmap.html` is close enough. (2) A second baked-in snapshot page (same
  regeneration burden). (3) A lightweight page that **fetches** the source docs at load and light-parses
  them.
- **Decision:** option 3 — `docs/dev-status.html`: fetches `TASK_BOARD.md` (same dir), `../CHANGELOG.md`,
  `../DECISIONS.md`; parses band headers + `##` task titles, the top-N `- **…**` changelog bullets, and the
  top-N `- **D-…**` index bullets; renders a stat strip + three cards. Reuses `roadmap.html`'s exact
  CSS-variable palette (light + dark). Distinct from `roadmap.html`, not a replacement — it links to it.
- **Why:** a glance page's entire value is being *current*; a baked-in snapshot defeats that and adds a
  regeneration chore. Line-parsing three well-structured docs needs no Markdown library (keeps the
  vanilla-JS/no-build rule). The only cost is that `file://` opens can't fetch — handled with a clear
  fallback message pointing at the served site. Divergence from `roadmap.html`'s baked-in approach is
  deliberate and documented here so a future agent doesn't "fix" the inconsistency by mistake.
- **Consequence:** all fetched text is rendered via `textContent` (never `innerHTML`), satisfying the
  repo's hard escaping invariant even though the sources are trusted repo docs. If the docs' heading
  conventions change (band emoji, `— TODO` suffix, index-bullet shape), the parser's regexes need updating.
- **Access:** gated to signed-in users. `index.html`'s existing auth module unhides a "Dev Status" card
  only when `currentSession()` returns a session; the page itself imports `../js/auth.js`, runs its
  bootstrap only for a signed-in user, and **fails closed** to a "sign in" prompt otherwise (including when
  the Supabase client can't load, e.g. offline). This is deliberately a **visibility/UX gate, not a
  security control** — `TASK_BOARD.md`/`CHANGELOG.md`/`DECISIONS.md` are public on GitHub Pages, so the raw
  data is readable by anyone with the URL regardless. There is no per-account "player vs DM" role in this
  app (DM-ness is per-campaign), so "any signed-in user" is the honest scope, covering both.
- **Verification:** headless Playwright render against a local static server — stat counts matched the
  source (Now 0 / Next 1 / Later 3), 7 decisions + 7 changelog entries populated, signed-out state shows
  the gate with the dashboard hidden, and a direct bootstrap call confirmed the parsers still render
  correctly after the fence-reorder/early-break cleanup.
- **See also:** D-GH-2026-07-16-agents-workflow-reconcile; `docs/roadmap.html` (the fuller, baked-in view).
- **Status:** Active.

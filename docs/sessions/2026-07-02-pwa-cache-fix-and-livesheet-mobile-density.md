# 2026-07-02 — PWA stale-version fix + Live Sheet mobile density

Picked the two top NOW-tier roadmap items in priority order, per user request: PWA stale-version bug
first (priority), Live Sheet mobile density as an extra since both were tractable in the same session.

## PWA stale-version bug
Straightforward per the roadmap's own diagnosis — three fixes:
1. `service-worker.js`'s network-first fetch now passes `{cache:'no-store'}` so it can't silently return
   a browser-HTTP-cached stale response.
2. All 5 pages (`index.html`, `login.html`, three tools) now call `reg.update()` on `visibilitychange`
   (→visible) and `focus`, instead of relying solely on the browser's own periodic SW update check.
3. `login.html`'s `updatefound` handler force-reloaded silently — aligned it to the same dismissible
   banner pattern the other four pages already use.
The roadmap's item 4 ("robust fallback layer" — an independent version-marker poll) was intentionally
skipped; it depends on the not-yet-landed `BUILD` export task and the roadmap task itself said not to
block items 1-3 on it.

## Live Sheet mobile density
Did the explicitly-scoped fixes (`.slotgrid` no longer forces 9 columns, new `@media(max-width:400px)`
tier, tap-to-collapse on the three top-level cards reusing the `.bgcat`/`.cath` pattern), but the more
significant finding came from actually testing rather than trusting the CSS by eye.

**The existing `@media(max-width:600px)` mobile-tuning block was mostly not working.** Verified with a
headless Chromium session (Playwright, pre-installed in this environment) at a 375px viewport:
`getComputedStyle('.abrow').gridTemplateColumns` returned 6 equal columns, not the intended 3, despite
the mobile CSS looking correct on read-through. Root cause: that `@media` block sits near the top of the
`<style>` section, *before* several unconditional base rules for the same selectors (`.abrow`, `.kpis`,
`.ib`, `.cath`) defined later in the file. CSS resolves equal-specificity ties by source order — the
later rule always wins when both match, regardless of which one is "meant" to be the override. So the
later desktop rule was silently beating the earlier mobile one at every width, including mobile.

This wasn't something the roadmap task's diagnosis anticipated (it assumed the `.abrow`/`.kpis` 3-column
mobile behavior was already working, correctly, and only called out the untouched selectors). But it's
almost certainly the dominant cause of the reported cramping — a 6-column ability-score row not shrinking
on a 375px screen is a bigger visual problem than the spell-slot grid, which needs a spellcasting
character to even render.

Fixed with `!important` on just the shadowed declarations (not a blanket reorder of the stylesheet) —
this file already uses the identical technique for the identical problem in its `@media print` overrides
for `.spcols`/`.slotgrid`, so it's a consistent, low-risk fix rather than a new pattern. Logged as
DECISIONS.md D-GH19, including why a full stylesheet reorder was considered and rejected as
out-of-scope/higher-risk for this task.

All fixes verified live: headless-browser computed-style checks at 375px (small phone), and a desktop
check at 1280px confirming no regression to the existing 3-column/6-column desktop layout.

## Follow-up worth flagging
The same cascade-order pattern (mobile `@media` block declared before the base rules it's meant to
override) likely affects other properties in that same 600px/1000px block that weren't in this task's
scope to check exhaustively (e.g. `.bg h4` font-size, `.top h1` font-size vs. the later
`@media(max-width:880px)` block). Worth a dedicated audit pass if more "this mobile fix isn't visibly
doing anything" reports come in for this file.

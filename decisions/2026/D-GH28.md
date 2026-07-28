# D-GH28 — Homepage theme artwork is hand-authored SVG, not photos/illustrations

Status: Active

- **Context:** the roadmap task asked for theme-specific image pools for a new homepage banner, randomly
  selected per active theme and re-rolled on switch. No image-generation tool was available in this
  session, and fetching real photos/illustrations from the web carries unclear licensing (and the project
  has a hard rule against generating/guessing URLs not related to programming help).
- **Options considered:** (A) fetch freely-licensed stock art from the web; (B) leave the feature as
  scaffolding only (pool/selection/re-roll logic wired, no real images) for a human to fill in later; (C)
  hand-author small original SVG banners, palette-matched to each theme's existing CSS custom properties.
- **Decision:** (C). Four SVGs added: `assets/themes/light/{parchment-scroll,heraldic-crest}.svg`,
  `assets/themes/dark/{starfield,dragon-ember}.svg`.
- **Why:** avoids any licensing risk entirely, needs no build step or external fetch (fits the "vanilla JS,
  static files only" hard rule), stays lightweight (a few KB of vector paths vs. photo-sized rasters), and
  reuses the same hex values as each theme's `--bg`/`--accent`/etc. so the artwork reads as intentional
  rather than a generic placeholder. (B) was rejected because a fully-wired feature with empty pools isn't
  actually demoable or "done"; (A) was rejected on licensing grounds.
- **Status:** DONE. Revisit if a human wants to swap in real illustrated art later — the pool arrays in
  `index.html`'s theme-switcher script are the only place that needs updating (`artPools.light`/`.dark`).
- **Addendum (2026-07-05):** originally logged as `D-GH26`, picked before a rebase surfaced that number
  as explicitly reserved for the engine module-bridge migration task (`docs/PACT_ROADMAP.md`, "don't
  reuse D-GH26 for anything else in the meantime"). Renumbered to `D-GH28` before this branch's PR
  landed — same class of collision as the `D-GH19`/`D-GH20`/`D-GH25` incidents, caught this time before
  merge rather than after.
- **Update (2026-07-05):** the SVG placeholders in the dark pool (`starfield.svg`, `dragon-ember.svg`)
  were superseded by real artwork (`assets/themes/dark/book-{closed,open}{,-banner}.webp`, supplied by
  the project owner) and deleted. The light pool still uses the original SVGs — no equivalent real art
  provided yet for that bucket. `source-assets/images/` was added alongside this for the full-resolution
  originals behind the new webp files (see `source-assets/README.md`).
- **Update (2026-07-05, superseding the above):** the project owner supplied dedicated banner art for
  all four named themes (2 images each), not just the dark ones. The light/dark-bucket model this
  decision originally established is retired — `artPools` is now keyed directly by theme name
  (`parchment`/`midnight`/`dragonfire`/`contrast`), each theme showing only art actually made for it.
  `assets/themes/light/` is deleted outright (superseded by `assets/themes/parchment/` and
  `assets/themes/contrast/`). `assets/themes/dark/` is also deleted, but its 2 interim book-art webp files
  were kept at the project owner's request rather than discarded — restored from git history into
  `assets/themes/midnight/`, where they now sit alongside midnight's 2 dedicated images (4 total in that
  pool). No SVG placeholders remain anywhere in the pools — every theme now has real supplied art. The
  Player's Guide cover (`pact-cover.jpg`) was also swapped to a smaller `assets/pact-cover.webp` in the
  same change, unrelated to the theme pools but supplied in the same asset batch.
- **Note:** `artPools` is a hand-written JS object in `index.html` — adding a file to a theme's directory
  does nothing on its own. There's no server-side directory listing or build step on a static GitHub
  Pages site, so every image path must be added to the relevant `artPools.<theme>` array explicitly.

# Source assets

Full-resolution, pre-optimization originals for images (and, in future, other media) used
elsewhere in the app. **Nothing in here is served or read by the app or tools** — it exists
purely for provenance, so a served asset can be re-cropped or re-exported later without
regenerating it from scratch.

**AI agents:** never read, glob, or summarize this directory wholesale (see `AGENTS.md`'s
"Don't read large files wholesale" section) — these are large binaries, not something you need
to reason about. If a task needs a specific file, it'll be named explicitly.

## What goes where
- `source-assets/images/` — full-res source images (PNG/JPEG/etc.) behind the optimized
  `.webp`/`.svg` files actually referenced from `assets/themes/*/` or elsewhere in the app.
  (Future media types — audio, fonts, design files — would get their own sibling subfolder here,
  same pattern.)

## Adding a new asset (manual step — no build pipeline; PACT has no npm/bundler)
1. Drop the full-resolution original in `source-assets/images/` (or a new subfolder if it's a
   different media type).
2. Export/optimize a web-ready version — `.webp` for photos, `.svg` for vector art — sized for
   where it's actually used (a homepage banner needs far less resolution than a print-quality
   original).
3. Commit the optimized file into the real served location, e.g. `assets/themes/light/` or
   `assets/themes/dark/` for homepage artwork.
4. Reference the served (optimized) file's path from the relevant HTML/JS. Never point app code
   at `source-assets/`.

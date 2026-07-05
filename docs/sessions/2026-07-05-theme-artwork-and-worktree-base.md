# 2026-07-05 — BUILD export, leaked-password retirement, and the theme-artwork saga

Three roadmap-adjacent pieces of work landed in one session; this note exists because the
theme-artwork task went through several genuine pivots, and a decision-number collision was
caught mid-session that a future agent might otherwise wonder about.

## 1. `BUILD` export fix (PR #111)

Straightforward: `docs/VERSION-SYNC.md` and a prior `CHANGELOG.md` entry both claimed
`js/engine.js` exported `BUILD` and that `index.html` read it live — neither existed. Added the
export and the read. No surprises here; included for completeness since it's the same session.

## 2. Leaked-password-protection roadmap item retired (PR #113, D-GH25)

The project owner tried to enable Supabase's leaked-password-protection Auth setting and found
it's gated behind a paid plan tier. Rather than leave the roadmap item open indefinitely, it was
removed with a `DECISIONS.md` entry recording the cost/benefit call — the security advisor will
keep flagging the gap on every future check, so it stays visible even though it isn't fixed.

## 3. Theme-aware homepage artwork (PRs #114, #120) — the actual pivot history

**Iteration 1 (PR #114):** the roadmap task asked for light/dark image pools with no assets
supplied. No image-generation tool was available in-session, and fetching third-party art risked
unclear licensing, so 4 original SVGs were hand-authored (palette-matched to the theme CSS
variables) as a light/dark-bucketed placeholder (`assets/themes/{light,dark}/*.svg`). Logged as
`D-GH26`.

**Iteration 2 (PR #114, same branch, before merge):** the project owner supplied real dark-theme
artwork (4 grimoire/spellbook `.webp` images). Swapped into the dark pool, deleted the 2
superseded dark SVGs, added `source-assets/` as a general (not image-specific) home for
full-resolution originals — kept out of every agent's read path via an `AGENTS.md` "don't read
wholesale" entry plus its own README.

**The D-GH26 collision:** mid-session, a rebase onto `preview` pulled in another concurrent
session's fix for an unrelated `D-GH25` collision, which revealed that `D-GH26` — the number
already used for this session's "SVG vs. real art" decision — was explicitly reserved in
`docs/PACT_ROADMAP.md` for the (separate, not-yet-done) engine module-bridge migration task, with
an explicit "don't reuse D-GH26 for anything else in the meantime" note. Caught via
`grep -rn "D-GH26"` before pushing, renumbered to `D-GH28`, with an addendum in `DECISIONS.md`
documenting the renumbering — same class of incident as the prior `D-GH19`/`D-GH20`/`D-GH25`
collisions, this time caught pre-merge instead of post-merge.

**Iteration 3 (PR #120):** the project owner supplied dedicated banner art for *all four* named
themes (parchment, midnight, dragonfire, contrast — 2 images each), not just dark ones. This
changed the right design: a light/dark bucket model means a Dragonfire-styled image could show up
under Contrast just because both are "dark"/"light," which looks worse than no variety at all.
Retired the bucket model entirely — `artPools` in `index.html` is now keyed directly by theme
name, each theme only ever showing art made for it. Also swapped the Player's Guide cover
(`pact-cover.jpg` → `assets/pact-cover.webp`, supplied in the same asset batch) since it was the
only other raster image on `index.html`.

**Iteration 4 (PR #120, follow-up commit):** the project owner asked to keep the two original
dark-theme book banners rather than discard them when the bucket model was retired. They were
recoverable via `git show <pre-deletion-commit>^:<path>` even though already deleted from the
working tree — restored into `assets/themes/midnight/` and added to `artPools.midnight` (now 4
images in that one pool). This is also where the "no auto-discovery" point came up explicitly:
`artPools` is a hand-written JS array, and a static GitHub Pages site with no build step can't
list a directory's contents at runtime — every asset path has to be named in the array.

## Recurring gotcha: `EnterWorktree` basing on a stale branch

At least twice this session, `EnterWorktree(name: "...")` produced a worktree whose `HEAD` was
**not** an ancestor of `origin/preview` — it had silently based on a stale `origin/main` snapshot
instead, despite `git remote show origin` correctly reporting `preview` as the actual default
branch. Caught each time via `git merge-base --is-ancestor HEAD origin/preview` before editing
anything; fixed with `git stash -u` (if edits were already made) → `git reset --hard
origin/preview` → `git stash pop`. Also caused a `git push --force-with-lease` to be needed once,
since the local rebase rewrote a commit's parent/hash relative to what was already pushed. No data
was lost in any instance, but it cost several extra round-trips. Worth checking base immediately
after every `EnterWorktree` call going forward rather than assuming it's correct.

## Net result

Roadmap: 2 items graduated (BUILD export was already-shipped-implied, not a roadmap item;
leaked-password-protection and theme-random-artwork both graduated into `CHANGELOG.md`).
`DECISIONS.md`: D-GH25, D-GH28 (with two "Update" amendments), plus the renumbering trail.
`testing/tests/engine-parity.html` baseline unaffected throughout (no `js/engine.js` rules
changes) — the `BUILD` export is the only engine-file touch, and it's additive/non-rules.

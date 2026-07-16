# 2026-07-15 — two roadmap tasks in one sitting (tools Home-nav + DM Console roster tuned-curve)

## What happened

One session picked and shipped two NEXT-section roadmap items back-to-back via `/pick-task` → `/run-task`,
each on its own branch/PR into `preview`:

1. **`feat/tools-home-nav-cleanup`** (PR #222) — add a consistent "← Home" link (→ `../index.html`) to all
   three tools' headers, audit/reduce toolbar clutter, and add `aria-label`s to icon-only buttons.
2. **`fix/dm-console-roster-tuned-curve`** (PR #223) — make DM Console's roster level read the DM-tunable
   `levelBudgetCurve` instead of the fixed `DATA.levelAP` ladder, consistent with Live Sheet.

Both are display-only (no `DATA.version`/`compute()` change); engine-parity stayed **20/0** on each.

## Why this is worth a note

### 1. A "pure UI markup" change broke e2e — caught only by CI, not parity (PR #222)
PR #222 looked maximally safe: a `<a class="homelink">← Home</a>` added to each header, some CSS, and
`aria-label`s. Engine-parity (20/0) and a headless logic check both passed. **But the `e2e` CI job went
red, 0/5 iterations.** Root cause: Live Sheet's `#apFloat` "AP left" badge is `position:fixed; top:10px;
right:14px; z-index:1500` and always on. Inserting the Home link as the first child of the `.top`
`flex-wrap:wrap` header row shifted the buttons rightward just enough that **"Open in CharGen" now lands
under `#apFloat`, which intercepts the click** — Playwright times out clicking it. The `#apFloat` overlap
was a *latent* hazard (an informational badge that eats pointer events over a wrapping button bar); the
Home link merely moved a real button into its shadow at the test viewport. This is exactly the class of
regression that a `compute()`-only parity gate and unit logic checks cannot see — it took the browser
e2e. **Lesson:** treat any header/toolbar reflow as behaviour-affecting even when it's "just markup," and
watch the e2e job, not only parity, before calling a UI PR green.

### 2. The DM Console roster fix carried two real design decisions (PR #223)
Documented fully in `DECISIONS.md` (`D-GH-2026-07-15-dm-console-roster-tuned-curve`); summary:
- **Local mirror, not a shared engine helper.** The roadmap's separate `chore/unify-level-lookup-helper`
  task owns the cross-tool extraction; doing it here would collide and exceed single-file scope. So DM
  Console got its own `_latestLogSnapshotRules()`/`_levelCurve()`/`trackLevel()` trio mirroring Live
  Sheet's offline path (curve resolved from each character's own LOG `rulesSnapshot` — DM Console has no
  live cloud rules for an imported file, so the snapshot is authoritative).
- **Full Live-Sheet parity over "only when configured."** Chose to fall back to the Standard preset
  (`{l1:79,inc:24}`) when a character is untuned, *not* keep the old fixed ladder — because the "only when
  a curve is configured" reading would still leave DM Console disagreeing with Live Sheet for *untuned*
  characters (the two are numerically very different: ladder L1=50 vs curve L1=79). Consequence: an
  unbound character's displayed roster level can shift versus the old ladder, by design.
- **Left a stale roadmap reference untouched:** the still-open `chore/unify-level-lookup-helper` entry
  cites `DM-Console.html:552 (apLevel(), fixed ladder)`, now `trackLevel()` on the tuned curve — flagged
  in the PR and DECISIONS instead of editing it, per the roadmap single-writer rule.

### 3. `EnterWorktree` silently based BOTH worktrees on `main`, not `preview`
Both `/run-task` runs this session hit the recurring trap: `EnterWorktree` created the worktree off `main`
(329 commits ahead of `preview` on the second run), not the intended `preview` base. The first run's
`git merge-base --is-ancestor origin/preview HEAD` check **passed anyway** — because `preview` *is* an
ancestor of `main`, so ancestry can't detect a main-based worktree; the bad base only surfaced when
`git rebase origin/preview` tried to replay 200+ main-only commits. On the second run I replaced the
check with **exact equality** (`HEAD == origin/preview`), which caught it immediately, before any edit —
reset hard to `origin/preview` and carried on. This is the durable fix and is queued for
`ai-lessons-learned`.

## State at session end
- PR #223 — `mergeable_state: clean`, e2e green, reviewed clean. Ready to merge.
- PR #222 — `mergeable_state: unstable`, **e2e red (real regression, see §1)**. Needs a fix before merge.
- `preview` and `main` in sync (0 commits apart).

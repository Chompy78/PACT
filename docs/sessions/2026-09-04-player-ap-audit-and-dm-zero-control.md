# 2026-09-04 — Archer's 127 Player AP: the two-pool model, a DM zero control, and two bugs a review pass caught

Started as one question — "how did Archer gain 127 player AP in the Amble campaign?" — and grew into a
live-data audit, a new DB-level control, two UI display fixes, and a full PR + promotion cycle. Recorded
here because the shape of the mistakes (a fix that silently touches the wrong pool, a fix that swaps a
condition instead of extending it) is worth remembering past this one session.

## 1. The 127 AP wasn't what it looked like

Live Supabase queries against `piuprrrnaotrtxucrtsb` found Archer's DM-awarded AP (`ap_awards` /
`characters.ap`) summed correctly to 70 across five grants — the DM's own bookkeeping was never wrong.
The 127 was a completely separate number: **Player AP**, CharGen's self-editable "Budget" field, stored
as `award`-type LOG events and summed by `economy()` — a pool `compute()` treats as structurally distinct
from DM-granted AP (see `js/engine.js`'s two-pool model). Widening the audit to all six Amble characters
found the pattern wasn't universal (three of six had a non-zero figure: 127/79/27), which mattered for
scoping the fix correctly rather than assuming every character needed the same treatment.

A second thread in the same conversation — "why does his DM copy show different spell slots than his
live sheet" — turned out to be unrelated to AP at all: the player had **three separate "Archer" saves**
under one account, and the DM had copied the stale campaign-bound one rather than the most-recently-saved
file (identified by `updated_at`, then confirmed by reading the actual LOG for the `slots:[2,0,...]`
patch). A reminder that "which file is the real one" is a live-data question, not an assumption to make
from a filename.

## 2. Why `ignore_player_ap` didn't already cover this

Amble already had `ignore_player_ap = true` — the DM's explicit intent that only their own awards count.
That flag was real and already enforced at the DB level for the *spend* ceiling
(`pact_enforce_ap_budget_consistency`, 2026-08-10) — but nothing stopped the underlying Player-AP number
itself from growing, and DM Console's "Copy to CharGen" sandbox (a deliberately disconnected DM-side
view) didn't even apply the flag on **read**, by documented prior design. So a DM inspecting a copy saw
the raw, uncapped figure with no indication anything was wrong.

## 3. The fix, and the two bugs a review pass actually caught

Built (`D-GH-2026-09-03-dm-zero-player-ap`, full record has the complete why):
- `dm_zero_player_ap` RPC — purpose-built, same shape as the existing `dm_set_creation_ceiling`, not a
  `dm_edit_character_log` allowlist widening. Appends one compensating `award` event computed from the
  log itself.
- `pact_enforce_player_ap_ceiling` trigger — once a campaign ignores player AP, the database refuses any
  further rise in a character's own (non-DM) award total. A real guarantee, not a display filter.
- A "Zero Player AP" button in DM Console, and two fixes to "Copy to CharGen" so it stops hardcoding
  `ignorePlayerAp:false` / `drawbackCap:undefined`.

Ran `/code-review ultra` on the branch **before** opening the PR, since it touched `sql/` — the
project's own PR template requires it there. Two of its three findings were real:

1. **`dm_zero_player_ap` summed every `award` event, `dmEdit:true` included.** Zeroing a character who
   also had a DM-granted boon (a matched buy/award pair from `dm_edit_character_log`, the award side
   `dmEdit:true`) would have cancelled that legitimate grant too, silently charging the character for a
   boon that was supposed to be free. Fixed to exclude `dmEdit:true`, matching exactly what the new
   trigger already protected — the button's own tooltip had already promised "Never touches DM-granted
   AP" before the SQL actually kept that promise.
2. **The Copy-to-CharGen fixes were gated on `_cgCopySourceAp>0`**, conflating "is this a copy" with
   "does it have non-zero DM AP" — a fresh character with 0 DM AP fell through and lost both fixes,
   which was the exact bug being closed, just reachable a different way. Fixed with a real
   `_cgCopySourceIsCopy` flag.

The third finding (reuse `findRosterEntry()` in the new button's handler) was checked against the file
and correctly **not** applied — every sibling handler in that same delegated-click function already uses
the same inline `cloudRoster.filter()`; the suggested change would have made this handler the
inconsistent one, not fixed an inconsistency. Worth recording as a case where a review finding needs
verifying against the actual codebase, not applying on reviewer authority alone.

## 4. CI caught a fourth bug the review pass missed

Opening PR #508 ran `tool-pricing-ci.mjs`, which failed 2 of 189 checks. The `_cgCopySourceIsCopy` fix
above had **replaced** the `_cgCopySourceAp>0` condition instead of adding to it — breaking two
pre-existing tests that simulate a copy by setting `window._cgCopySourceAp` directly, predating the new
flag. The general lesson: when closing a gap in a condition, OR the new signal in rather than swapping
it for the old one, unless you're certain nothing else depends on the old signal alone — and the way to
be certain is to run the actual test suite, not just re-read the diff. Fixed by OR-ing
(`_cgCopySourceIsCopy || _cgCopySourceAp>0`) and verified locally with the real CDP-driven harness
(`node testing/scripts/tool-pricing-ci.mjs` → 189/0) before pushing again.

## 5. Merge conflict, and the promotion

PR #508 showed `mergeable_state: "dirty"` on open — PR #507 (an unrelated proficiency-bonus re-price)
had landed on `preview` after this branch was cut. `git merge origin/preview` resolved with no real
conflict (git's `ort` auto-merge; the only overlapping lines were version-string bumps), verified with
`engine-parity-ci.mjs` and a syntax check before pushing. All 15 CI checks green, PR merged (squash, per
this repo's established convention for feature PRs).

Then promoted `preview` → `main` per `docs/VERSION-SYNC.md`'s documented procedure: opened the promotion
PR first (#511) to obtain its number, pushed one follow-up commit onto `preview` (the PR's own head)
setting `BUILD` to `v1.511` and syncing the three tool labels, verified with `version-label-ci.mjs`
(10/10) and `engine-parity-ci.mjs` (73/0), then merged with a **regular merge commit** — never squash,
per that doc's explicit warning that squashing a promotion severs shared history and poisons the next
promotion's 3-way merge. Tagging `main` was explicitly left undone: this session cannot push tags (a
documented cloud/web-session platform restriction), and whether this promotion is "meaningful enough" to
tag is the owner's call, not a mechanical step.

## Net result

Three live Amble characters (Archer, Anders Pipeleaf, Caspian) had their Player AP zeroed via the new
RPC and confirmed at 0. A new DB-level trigger makes the "DM has switched off player AP" setting an
actual guarantee instead of a display convention. `preview` is promoted into `main` at `v1.511`.
`js/engine.js` untouched throughout — no `DATA.version` change. Full technical record:
`decisions/2026/D-GH-2026-09-03-dm-zero-player-ap.md` (two addenda covering the review-pass and
CI-pass fixes).

## Lesson candidate

Two related lessons surfaced this session that generalize past PACT:
1. When a fix removes a value from being counted in one code path (e.g. excluding a "trusted" tag from
   a sum), verify against every OTHER thing that sum feeds — a compensating write that's correct for the
   pool it targets can still silently corrupt an adjacent pool that shares the same underlying event
   type.
2. When narrowing or replacing a boolean condition to close a gap, prefer OR-ing the new check onto the
   old one over swapping it outright, and confirm with the actual test suite (not a diff re-read) that
   nothing else relied on the old condition alone.

Not filed to `ai-lessons-learned` this session — the invoking skill's shared lesson-logging step
(`/log-lesson-universal-jc`) wasn't available in this environment; noted here for whoever next has
access to file it properly.

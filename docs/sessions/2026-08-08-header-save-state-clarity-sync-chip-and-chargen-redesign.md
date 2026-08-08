# 2026-08-08 — Header/save-state clarity: sync chip, universal autosave, CharGen header redesign

One long session on branch `claude/header-save-state-clarity-bt6sjy`, shipped as eight separate PRs
(#379–#388, each promoted `preview → main` on landing). Starts from a cold-reviewed plan
(`docs/plans/2026-08-08-header-simplification-universal-autosave.md`) and ends with a fully-specified,
not-yet-built task on the board. Told here in the order it actually happened, because several steps only
make sense as reactions to what the previous one revealed.

## The arc

**Part A — a small, real bug found while scoping something bigger.** The original plan (shared sync
chip + universal autosave) got cold-reviewed by 4 models before any code was written. The review
surfaced enough open design questions (a consent/eligibility model for autosave, an undecided
"behind"-detection trigger) that the plan was split: Part A shipped alone — a debounced cloud-autosave
push that `switchToLiveSheet()` was silently abandoning by navigating away before the 3s timer fired.
Fixed with an awaited, bounded flush plus a best-effort `pagehide` handler using `fetch(...,
{keepalive:true})` (`sendBeacon` was considered and rejected — it can't carry Supabase's auth headers).

**Part B — the sync-state machine, shared chip, and universal autosave (B1–B3).** A real six-state
machine (`SIGNED_OUT`/`SAVING`/`CONFLICT`/`BEHIND`/`DIRTY`/`IDLE`) landed in `js/sync.js`, driving one
shared `chipPresentation()` function so the three tools' status chips can't drift in wording. Then
universal cloud autosave: originally scoped as campaign-bound-only with a one-way consent-timestamp
model for everyone else, the owner rejected that split mid-implementation-planning ("can we just have a
toggle for everyone, even campaign bound ones?") and it became one universal, freely-reversible
`characters.autosave_enabled` toggle (C2 in `D-GH-2026-08-08-universal-autosave-toggle`) — accepting that
a player can now silently make a DM's roster go stale by switching it off, on purpose, as a known
tradeoff rather than an oversight. `/code-review ultra` (required by the PR template since it touched
`sql/`) caught two real bugs before merge: the toggle's own write bumped `characters.updated_at` via an
unconditional trigger, invalidating the optimistic-concurrency guard and causing a false "changed on
another device" conflict on the very next real save; and toggling a never-cloud-saved character silently
discarded the choice because the optimistic local write was skipped when there was nothing cached yet.
Both fixed and covered by a differential regression test (`sync-autosave-toggle-ci.mjs`) that fails on
the pre-fix commit and passes on the fix — this project's standing pattern for proving a fix isn't
vacuous. The migration was applied to the live Supabase database mid-session, verified post-apply
against all 16 existing characters.

**Header declutter, round 1.** B2's chip was deliberately *additive* — it left the older
campaign-status badges in place rather than replacing them, reasoning they carried unique
campaign-binding info the chip didn't. That left CharGen and Live Sheet's headers with 5–6
always-visible cloud-related elements, several saying the same thing in different words (a badge
reading "Signed in — no campaign selected" duplicating both the campaign `<select>`'s own state and the
sync chip's "☁ Signed in" text). Given three depth options (minimal dedup / moderate consolidation /
full popover redesign), the owner picked moderate: the status badges were cut down to show *only* what
nothing else already said, and the Autosave toggle moved from a persistent header chip into the existing
cloud menu. Also moved the header's file-build "Last edited" timestamp into each tool's Info panel — and
in the process, corrected a `DECISIONS.md` record that had drifted from what actually shipped (said an
RPC where a plain column grant was built, and was still marked "not started" despite being live).

**CharGen-specific: the Local/Cloud split, and a Reset bug that wasn't where it looked.** The owner
reviewed the *result* of round 1 and found it "isn't great" — cloud actions sat behind a lone unlabeled
"⋯" while local Save/Load stayed as loose buttons in a different row. Also flagged: no New Character
button, and "reset doesn't really work as intended anymore." Reading the actual code (not assuming)
found that `resetBuild()` already silently minted a brand-new character ID on every call — it never
overwrote the character you had open, it just detached from it with zero indication, which is what
actually read as broken. Given the choice (merge Reset and New Character into one honest action, vs.
keep them separate and rebuild true in-place-wipe semantics with a new overwrite risk), the owner picked
the merge — lower risk, and the underlying behavior already worked. Renamed the button, added the honest
confirm text, and fixed a real edge case surfaced while tracing it: a still-pending cloud autosave for
the character being left behind could get silently redirected to the new blank character's ID if its
debounce timer hadn't fired yet — fixed by flushing first, reusing the same mechanism Part A built.

**Header follow-up, round 2 — verified with real screenshots, not assumed.** The owner reviewed again
and found the new header wrapped the theme selector onto its own line at common laptop widths
(~1024–1150px), that mobile had *zero* cloud access at all (a pre-existing gap, newly conspicuous once
desktop's cloud access got a clean label), and that the Cloud menu had no New Character option even
though New Character's own fix already made it cloud-aware. All three fixed, and this is where the
"don't take more screenshots without asking" instruction landed — from here on, verification switched to
DOM-state assertions (element rects, `classList`, `textContent` via headless Chromium) instead.

**Mobile parity, and a bug the round-trip test caught before it shipped.** Desktop had Local+Cloud
menus; mobile had picked up Cloud but not Local. Extending the same "reparent the one menu element into
whichever button's wrapper triggered it" technique to Local (rather than duplicating markup — real
ID-collision risk with two live copies of the same form fields) worked, but a naive version had a real
bug: resizing from mobile to desktop without closing the menu first, then clicking the desktop trigger,
toggled the menu *closed* instead of moving and showing it — because it was already `.open` from the
mobile click. Caught by an actual mobile→desktop→mobile round-trip test, not assumed safe. Also added
the app/rules version numbers to the Info panel, since both were `display:none` on mobile with no other
way to see them.

**The Info panel itself was stale.** Last finding of the day: the Info panel's own guide text still
described the pre-D-GH40 "Export to Live Sheet" flow — download a `-livesheet.json` file, open the Live
Sheet, use Import — a mechanism removed months ago. It also never mentioned Cloud, Local, autosave, or
New Character at all, and its "Other outputs" list had quietly stayed at one item out of four ever since
a 2026-08-03 truncation-bug fix deliberately declined to guess at lost content. Rewrote all three
sections to match the current header, adding new accurate documentation for the three previously-missing
buttons rather than trying to reconstruct what PR #210 actually lost.

**Closing move: planned, not built.** With CI still running on the last promotion, the owner asked to
plan the next piece — blocking a campaign-bound character's cloud save when it's over AP budget, a DM
Console setting, default on, behind the same lock pattern as the existing "ignore player-entered AP"
toggle. An `Explore` agent grounded the design in real code (the lock UI's exact mechanism, `compute()`'s
`remaining < 0` being purely advisory today with no blocking anywhere, `validate()` being deliberately
orthogonal to budget math, and where the campaign's `rules` object is already cached at save time). Two
real decisions got made — the setting lives in the existing `rules` jsonb key rather than a new
`campaigns` column (no migration needed, same effective protection), and enforcement is client-side only,
matching the existing (also client-side-only) banned-item rules rather than trying to reimplement pricing
math in SQL. Filed as a fully-specified task on `docs/TASK_BOARD_NEXT.md` rather than built this session.

## Bugs worth remembering (the generalizable shape, not just the fix)

- **A relocated DOM-populating `<script>` must run after its target markup, not just "later in the same
  general area."** Happened twice today, once in CharGen and once in Live Sheet: moving a
  `document.getElementById('X').textContent = ...` IIFE into a script tag that runs *before* `#X`'s own
  markup has been parsed silently gets `null` back. Caught by comparing byte offsets of the markup vs.
  the script call before it ever reached a real page load — a cheap, mechanical check worth doing on
  purpose whenever a script block moves.
- **`overflow-x: auto` silently couples to `overflow-y`.** Per the CSS overflow spec, setting one axis to
  a non-`visible` value while leaving the other `visible` promotes the second to `auto` too — so a
  horizontal-scroll container can clip an absolutely-positioned dropdown vertically with no visual hint
  why. Fix is an explicit `overflow-y: visible` once you know to look for it.
- **A "reparent one shared element" pattern needs to handle re-triggering from a different origin
  correctly, not just toggle.** `classList.toggle('open')` is right when the same button is clicked
  twice; wrong when a *different* trigger just moved the element to a new location — that click should
  always show it there. Only surfaced by an actual round-trip test (mobile → resize → desktop → click),
  not by testing each breakpoint in isolation.
- **A CI check failing twice with two different generic infra-flavored errors (a "fetch failed," then a
  "page never became ready") is a different signal than one specific assertion mismatch with real
  numbers** — worth a bounded retry (this session capped it at two) backed by an independent local run of
  the same suite on the same code, rather than either blind-retrying forever or treating the first flake
  as a real regression.
- **A written decision record can drift from what actually shipped even within the same day.** The
  universal-autosave-toggle record said "RPC," described a status of "not started," and was two
  implementation details behind reality by the time it was re-read a few hours later. Worth periodically
  re-checking a record against the real `sql/` files it describes, not just trusting it was accurate when
  first written.

## Process notes
- Every promotion this session followed the same shape: open the `preview → main` PR first (to get its
  number), bump `BUILD` to `v1.<that number>` in a *fresh clone* of `preview` (not the session's local
  `preview` branch, which is a stale ref from a historical squash-merge divergence — see
  `docs/VERSION-SYNC.md`), push directly to `preview`, wait for CI, merge with a real merge commit (never
  squash, for the same historical reason). Tagging each resulting `main` commit is hard-blocked from this
  cloud session and was left as an explicit follow-up each time.
- `/code-review ultra`, cold-plan-review, an `Explore` agent, and real headless-Chromium verification
  (screenshots early on, DOM-state assertions later per explicit instruction) each caught something real
  this session — none were performed pro forma.

## Open items
- Two pre-existing push-overlap findings from the B3 ultra-review remain on `docs/TASK_BOARD_NEXT.md`,
  untouched this session (bounded impact, deliberately deferred, not forgotten).
- The new campaign AP-budget-enforcement task is fully specified on `docs/TASK_BOARD_NEXT.md`, not yet
  built.
- The `pricing` CI check's readiness-timeout flakiness (two different generic failures in one promotion)
  might be worth its own look — not filed as a task this session, only flagged in conversation.
- Tagging `v1.380` through `v1.388` on `main` still needs a local terminal or the GitHub web UI for each.

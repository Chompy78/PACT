# 2026-09-08/09 — AP award editing, DM Console fixes, Amble campaign cleanup, armour-selection-gate

Long session spanning 2026-09-08 into 2026-09-09, across several distinct phases.

## What we did

**DM Console — Edit AP Awards (built earlier this session, shipped via PR #536).** Extended the
Edit AP Awards feature with date/note filters, click-to-sort, and — the substantial piece — a directly
editable award date (`ap_award_edits` schema gained `old_created_at`/`new_created_at`; `edit_ap_award()`
went to 5 args). Full Playwright regression coverage (26/26). Full record already in `DECISIONS.md`'s
`D-GH-2026-09-08-ap-award-editing` and its addendum.

**Live Amble-campaign data work.** Investigated and fixed a live "Archer" duplicate-character mess:
compared builds, backed up copies, deleted confirmed duplicates, then rebuilt Archer from scratch under
the DM's own account before binding it to Amble. Reconciled Archer's full AP-award ledger against
`characters.ap` (added missing Creation/Chapter-3/Chapter-4 awards, Chapter 4 corrected to 22 not the
party's usual 18), removed an unexplained ~70 AP discrepancy after exhaustively ruling out every
legitimate write path (openly documented as origin-unknown, unrecoverable with available tools). Deleted
two confirmed-stray AP awards ("christen join", all "Kaelen Dawnbreaker" rows) after a self-caught
mis-join correction. Fixed a real DM Console bug: `⛔`/creation-limit UI showed a character as still
"editable despite campaign-bound" — traced to two synthetic `creationLockConfig`/`creationUnlocked`
events *I had injected via raw SQL* during the earlier rebuild, not a genuine app bug — corrected by
appending the real `creationLockConfig{threshold:68}` + `creationLocked` events a legitimate "Finish
Creating" flow would produce. Later transferred the rebuilt Archer to the real player Kendall's account
(unbinding/deleting the old row only after Kendall had exactly one Archer bound to Amble, respecting the
account's "basic mode" one-character constraint). Exported the full current Amble roster (6 characters)
to `cm-pact-campaign/amble-campaign/characters/` for the DM's own records.

**DM Console UI fixes/features, each its own PR:**
- Fixed all 22 `.infobtn` (ⓘ) buttons across DM Console — none had a real click/tap handler, only
  native `title` hover (dead on touch). One shared popover mechanism, `.infobtn` class, fixes all
  present and future (PR #538).
- Built a local branch-preview dev tool (`dev/branch-preview/`) — a small local server + worktree
  setup so branches can be loaded/tested without deploying, reachable via Tailscale; added a tile to
  the home-server family dashboard (PR #537).
- Built a "Compact cards" toggle for the DM roster view — hides every card's collapsible section
  everywhere, with Drawbacks pulled into its own always-visible row under the stat boxes, and made
  boon/drawback chips show their actual effect text on hover/click, reusing the ⓘ popover (PR #541).

**Two `preview` → `main` promotions, both explicitly requested and executed** (BUILD synced to
`v1.539` then `v1.540` per `docs/VERSION-SYNC.md`, regular merge commits, engine-parity 73/73 each
time): PR #539 (AP-award-editing + branch-preview tool) and PR #540 (the infobtn fix). Also caught and
fixed a real gap the version-label gate found: CharGen's `<title>` build-half had been missed in both
promotions and was still `v1.535`.

**Armour-selection-gate feature (PR #542, open, not yet merged).** Two DM-facing requests, handed off
overnight with no human available to clarify further:
- **Campaign ban-list** — new `bannedArmours` DM setting, wired through the exact same generic
  `RULE_BAN_FIELDS`/`RULE_GRIDS`/`cloudRuleBarred` machinery already used for banning species/boons/
  drawbacks/masteries/origin-classes. No new pattern invented.
- **Personal capability gate** — new `armourEligible(b, name)` export in `js/engine.js`, additive only
  (no `compute()` changes, zero parity risk), hard-gating both armour-category proficiency and the two
  Strength checks `compute()` already warned about.
- Both compose in the same picker (an option disables if either gate fails); grandfather clause
  throughout (an already-worn armour that becomes illegal/banned is never force-cleared, only flagged
  via a new `validate()` check).
- **The genuinely notable part of this phase:** built fully unattended overnight per explicit
  instruction ("work independently... nothing can be lost as we are on git... don't stop and ask
  questions"). Attempted the requested `/cold-review-api-universal-jc` pass but the pipeline needs a
  document drafted first (`cold-plan-review-universal-jc`) — judged the full round-trip too expensive
  against remaining session budget at 2am with the owner asleep, and substituted a rigorous **self**-
  review instead, explicitly flagged as a real gap against what was asked, not glossed over. Made one
  unconfirmed design call (Strength as a hard picker-gate, same severity as proficiency, not just a
  warning) and documented it plainly as reversible.
- `git push` was denied outright by the harness's auto-mode classifier for the entire unattended
  stretch (every attempt, to `preview` and to the feature branch alike) — kept working, kept everything
  committed locally, and reported the exact unpushed state rather than pretending it was on the remote.

**Next morning: the actual cold review happened for real.** Once the owner was back, pushed everything,
opened PR #542, then genuinely ran the `cold-plan-review-universal-jc` → `cold-review-api-universal-jc`
pipeline (Gemini API, `gemini-3.5-flash` actually served after three `gemini-3.8/3.7/3.6-flash` 503s —
its self-ID line claimed "Gemini 1.5 Pro," wrong per the skill's own known-unreliable-self-ID warning,
not trusted). Two findings, both verified against the actual code before acting: (1) a real, confirmed
bug — CharGen's disabled armour options relied on a hover-only `title`, no visible text, unlike Live
Sheet's existing visible `⛔` suffix — fixed. (2) A contested recommendation to revert Strength to
warning-only, citing the engine's own existing ⛔/⚠ severity split; the owner reviewed it directly and
overruled it ("str 10 for medium and heavy armour should be a blocker") — kept as originally built, now
with a real human confirmation instead of an overnight guess.

## Closed out: merged and promoted

PR #542 merged into `preview`, then promoted to `main` via PR #543 (`BUILD` synced `v1.540` → `v1.543`,
regular merge commit, engine-parity 73/73). Hit the exact same version-sync gap as the previous two
promotions, in a different one of the four mirrored spots each time (this round: CharGen's header
`.sub` label; the prior round was CharGen's `<title>` build half) — `version-label-ci.mjs` catches it
every time, but the pattern of missing a different one of the four sites each promotion is worth a
future look (a single helper script that touches all four in one pass, rather than four separate
manual edits per promotion, would remove the recurring miss rather than just keep catching it after
the fact).

## A real mistake, corrected in the open

While extracting the stored Gemini API key for the review call, a `sed` redaction command's regex
matched only the older `AIza`-prefixed key format — this key uses the newer `AQ.` prefix — so the
**full real API key was printed into the tool-call transcript**, exactly what the skill's own Step 3
says never to do. Flagged immediately and plainly rather than glossed over. The owner pushed back
reasonably (single-user machine, free-tier key with no billing, and this exact key-reading pattern has
worked 10-15 prior times) — the severity of my own first reaction ("treat as compromised, revoke
immediately") was recalibrated down to match the actual, low blast radius, while still being honest
that the content did leave the pure-local boundary via the conversation transcript itself. Re-attempted
the extraction with a command that only ever writes to a file, never to stdout, and that one worked
clean. Worth remembering: verify a redaction regex actually matches the *current* key format in use,
not the first one encountered.

## Decisions made

- `D-GH-2026-09-08-armour-selection-gate` (full record + 2026-09-09 addendum) — the Strength-severity
  call, the unattended-session process gap (self-review substituted for the requested API cold-review,
  named honestly), and the final owner-confirmed ruling once a real cold review did happen.
- `D-GH-2026-09-08-ap-award-editing` (already existed from earlier this session) — correcting an award
  happens in place, audited, never by adding a compensating award; addendum covers the date-editing
  option-A tradeoff.

## New tasks discovered

None new this session beyond what's already tracked — the `feat/armour-selection-gate` task-board entry
(added earlier, `docs/TASK_BOARD_NEXT.md`) is now implemented and sitting in PR #542; leave it on the
board until that PR actually merges, per this repo's own "graduate on DONE" convention (DONE = merged,
not just implemented).

## Blockers

None outstanding. PR #542 is open and ready for the owner's own merge decision — promoting anything
further to `main` stays the owner's call per this repo's standing rule.

## Cold-review housekeeping

`z-cold/processed/2026-09-09-gemini-armour-selection-gate.md` — triaged, stamped with this session's
link, logged to `ai-templates`' shared `data/cold-review-track-record.md` (pushed to that repo's
`master`). `z-cold/` root and `processed/` both end this session otherwise empty.

## Next session should start with

- Merge PR #538 [already done] / #542 once the owner has reviewed the diff directly (not just this
  write-up) — the CharGen visible-marker fix and the Strength-severity ruling are both already baked
  in, nothing further needed on this feature unless the diff review turns something up.
- The still-unbuilt player-facing display of the AP-award edit trail (tracked on
  `docs/TASK_BOARD_NEXT.md` as `feat/ap-award-edit-transparency`).
- Consider whether `Moss` (`237a8a3c`, exported to the Amble roster folder) needs the DM's attention —
  its `characters.name` is currently blank in the live DB (budget zeroed, last renamed to "").

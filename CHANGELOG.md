# PACT — Changelog

> One line per change, **newest first**. `DATA.version` is noted only when it changed.
> This is the scannable, going-forward log; the full pre-GitHub history is in
> `docs/history/CHANGELOG-full.md`. *Why* lives in `DECISIONS.md`; the messy middle in `docs/sessions/`.

- **2026-09-05 · chore: repo branch cleanup — 91 → 3 branches, one accidental `main` deletion and full
  recovery** — a merged-PR-based sweep (git ancestry checks don't work here; this repo squash-merges)
  correctly identified 85 stale branches, but the delete list wasn't filtered against the repo's own
  protected branch names first: two historical PRs had `head.ref: "main"`, so `main` — the live GitHub
  Pages source — was deleted along with the real stale ones. Recovered immediately: the commit was still
  live on GitHub, restored `main` to its exact prior SHA, verified byte-exact via two independent tools.
  `preview` carried the identical exposure and was never actually at risk — GitHub refuses to delete a
  repo's configured default branch, unconditionally, and `preview` holds that status. Branch protection
  on `main` ("Restrict deletions"/"Restrict force pushes") is recommended and still outstanding — no
  GitHub tool available here exposes that setting; it's an owner action. Two further orphaned branches
  (`claude/amble-character-dms-awards-igww1s`, `claude/tools-review-issues-y00cx8`) were individually
  content-checked and confirmed to carry no unique unmerged work, pending deletion. Full record:
  `D-GH-2026-09-05-branch-cleanup-incident`.
- **2026-09-05 · feat: a real-browser headless roller for other projects** —
  `testing/scripts/roll-headless.mjs`, so `cm-pact-campaign` (and similar) can get 🎲 roller output by
  driving the actual tool in headless Chromium instead of regex-extracting `randomizeRoll()`'s source into
  a bare vm — the same extraction technique that caused fault #3 of the Hit-Dice fix below (lifting the
  function out of its file puts `apLevel` out of scope). Self-contained, zero npm dependencies, same CDP
  technique the CI gates already use; CLI takes `--theme`/`--budget` (comma-listable)/`--count`/`--class`/
  `--out`/`--list-themes` and returns the tool's real `readBuild()` + `compute()` output. Full record:
  `D-GH-2026-09-05-roller-headless-access`.
- **2026-09-05 · fix: the 🎲 roller's Hit Dice ceiling was a label, not a rule** — every rolled character
  got exactly 1 Hit Die at any AP budget (real player sheets at 75-98 AP carry 1-5), because the level cap
  treated `ap-by-level.js`'s documented *expectation* as a hard rule `compute()` never actually enforces.
  Re-defined as an affordability ceiling (18% of budget, floored at the level) drawn uniformly rather than
  pinned to its floor, added Grit to the kit spend pool (it offered Vigor but never Grit), and replaced a
  silent level-9 fallback with a loud throw. `random-quality-ci.mjs` gained two regression gates (HD
  variance at a budget; Grit reachability) that would have caught both original bugs and now guard against
  their return — **74/0**. No `DATA.version` bump, no engine change. Full record:
  `D-GH-2026-09-05-roller-build-shapes`.
- **2026-09-05 · release: promote `preview` → `main` as build `v1.520` (PR #520)** — carries six commits:
  the protected-event reproduction and its new gate, two documentation corrections, and three session
  records. Regular merge commit, never squash, per `docs/VERSION-SYNC.md` step 5; **verified after the
  fact that `main`'s head really has two parents**, and that `main` and `preview` share an identical tree
  hash (`e062f841…`) rather than merely "no commits ahead". `BUILD` bumped in `js/engine.js` and mirrored
  to the four tool labels, `index.html` untouched (it reads `BUILD` live), `DATA.version` untouched at
  `v0.365`. All **16 CI checks green**. **No tag**, per
  `D-GH-2026-08-20-tag-only-meaningful-promotions`: test infrastructure and documentation only, no shipped
  behaviour change. **A procedural note worth carrying:** step 3 says to push the `BUILD` commit onto the
  promotion PR's own branch, which for a `preview`→`main` promotion means pushing to `preview` — and a
  cloud session can push only its own working branch. It went as PR #521 into `preview` first instead;
  same result, one extra hop. `docs/VERSION-SYNC.md` now says so rather than leaving the next cloud
  session to rediscover it.
- **2026-09-05 · release: promote `preview` → `main` as build `v1.513` (PR #513)** — carries the Guide
  half of the proficiency-bonus re-price (#510, `docs(guide)`) plus a security-hardening SQL fix and its
  production-verification note (#512, #515) that landed on `preview` from a concurrent session while this
  promotion PR was open. Regular merge commit, never squash, per `docs/VERSION-SYNC.md` step 5 — confirmed
  the merge commit carries two parents (old `main` tip + `preview`'s tip at merge time). `BUILD` bumped
  v1.511 → v1.513 in `js/engine.js` and mirrored to the four tool labels; `index.html` untouched (reads
  `BUILD` live); `DATA.version` untouched (confirmed by diff — the only changed line in `js/engine.js` is
  the `BUILD` constant). All 16 CI checks green, re-verified after the head moved twice more mid-review
  from concurrent pushes. **No tag** — left for a local/terminal session or the GitHub web UI (cloud
  sessions cannot push tags); whether this docs+security promotion warrants one is the owner's call per
  `D-GH-2026-08-20-tag-only-meaningful-promotions`. This promotion itself overlapped with a *second*,
  independent promotion (PR #511, a different concurrent session) landing minutes earlier — see
  `docs/sessions/2026-09-05-proficiency-bonus-pricing-and-concurrent-promotions.md` for the full
  sequence.
- **2026-09-05 · test: reproduce the predicted protected-event failure — it does not occur, and the gate
  stays anyway** — `/code-review ultra` predicted that opening a sealed character in CharGen and saving
  would drop `sessionSeal`/`dmRemoveBoon` and be refused with `PACT: locked character history cannot
  shrink`. **Reproduced in headless Chromium, three consecutive runs: it does not happen.** The load path
  (`_cgApplyEnvelope`) rebuilds and then reinstates the saved log **verbatim** — protected projection
  **5 → 5** — and `_cgBlockedBySeal()` refuses the destructive entry points with a readable message.
  **The hazard behind it is real and now demonstrated rather than argued:** calling
  `replaceWholeLogFromBuild()` directly drops both events, **5 → 2**. Safety is caller discipline across
  four call sites, not construction. New gate `testing/scripts/protected-events-roundtrip-ci.mjs`
  (**8 assertions**) + `.github/workflows/protected-events-roundtrip.yml` pins the invariant, mirroring
  `pact_ap_ledger_protected()`'s projection client-side so it needs no Supabase and no credentials. One
  assertion deliberately checks that the rebuild **still** breaks — a tripwire on a known-fragile
  mechanism, which should be deleted if the rebuild is ever made safe by construction; its own message
  says so. `fix/chargen-regenerates-protected-events` graduated. **A near-miss recorded in the decision:**
  the first run reported the bug as confirmed, and the fault was the probe reading `window.LOG` when `LOG`
  is a `let` and never attaches to `window` — `_cgSealedFloor()` returning 6 beside "zero events" is what
  exposed it. No app code changed. `DATA.version` and `BUILD` untouched. See
  `D-GH-2026-09-05-protected-events-roundtrip`.
- **2026-09-05 · docs: correct an over-broad claim about protected events, and rewrite the task built on
  it** — `/code-review ultra` flagged that `dmRemoveBoon` is protected *positionally* on the stated
  grounds that "Nothing rewrites or relocates one", and that CharGen regenerates its whole log from the
  DOM and cannot emit that type. The predicted symptom — open a sealed character in CharGen, save, get
  `PACT: locked character history cannot shrink` — **does not appear to occur**, for two reasons the
  review missed: every cloud load runs through `_cgApplyEnvelope`, which rebuilds and then reinstates the
  saved log **verbatim**, and `_cgBlockedBySeal()` already refuses the genuinely destructive entry points
  with a player-readable message. Ordinary edits never reach the rebuild path at all. **What survives is
  smaller and real:** `replaceWholeLogFromBuild()` does destroy those events, and safety depends on all
  four call sites individually restoring afterwards or refusing first — caller discipline, not
  construction, the same shape as `D-GH-2026-09-05-protected-projection-search-path`. The migration
  header now states the narrower truth (**comments only — zero non-comment diff lines, so replaying the
  file is byte-identical**), and the task is rewritten to lead with reproduction, to name "no bug" as a
  valid outcome, and to make a round-trip regression test the deliverable rather than a speculative code
  change. **Explicitly not reproduced** — this is a reading of the code, said so in all three places.
  No code, no SQL, no rules. `DATA.version` and `BUILD` untouched.
- **2026-09-05 · fix(sql): `pact_ap_ledger_protected` gets its pinned `search_path` back — and the
  property is now asserted, not just agreement** — three consecutive definitions of this function
  declared `set search_path = public, pg_temp`; `2026-09-02-widen-protected-projection.sql` dropped the
  clause while retyping the signature to widen the projection, and `cb323ca` copied that weaker form
  into `sql/rls-policies.sql`, the fresh-install path. Restored in both, via a new dated migration —
  body, projection and grants untouched. **Severity, stated plainly rather than inflated:** this
  function is **not** `security definer` (it runs as its caller) and is reached from
  `pact_enforce_locked_history()`, which is and does pin — so there was **no known live escalation
  path**. Fixed because the safety was a property of today's call graph rather than of the function,
  because `2026-07-16-harden-search-path-pg-temp.sql` made pinning unconditional, and because a
  permanently-ignored advisor warning is how the dangerous one gets missed. The **more durable half**
  is the new check: #505's hardened drift guard asserts the baseline and the migrations say the *same*
  thing, and is satisfied when both are wrong in the same way — which is exactly how this shipped.
  `rls-baseline-test.sql` now asserts the property itself across all **seven** functions, with a count
  guard so a rename fails rather than silently shrinking coverage. Proven on a real PostgreSQL 16:
  recreating the original bug (**both** sides unpinned, and therefore agreeing) now fails
  `UNPINNED: pact_ap_ledger_protected`, where the old guard passed. 32 → **34 assertions**;
  `session-seal-test.sql` still 43/43, and the migration path confirmed to end pinned via `pg_proc`.
  **Applied to production** the same day, with the live body hash captured before and after to prove
  only the `SET` clause moved (`9971cf21…` unchanged), and grants re-verified still revoked for
  `anon` and `authenticated`. The Supabase advisor no longer reports `function_search_path_mutable`
  at all. Live `pg_proc` before the fix confirmed the diagnosis and the severity call: this was the
  **only** unpinned function of the seven checked, and the only one that is not `security definer`.
  `DATA.version` and `BUILD` untouched. See `D-GH-2026-09-05-protected-projection-search-path`.
- **2026-09-05 · docs(guide): sync Proficiency Bonus prose/table to `DATA.version` v0.365** — follow-up to
  the 2026-09-03 engine re-price below. Updated both copies to `18/20/24/28` per step (cumulative `90`):
  this repo's served `docs/PACT-Players-Guide.html`, and the `pact-guide` master (patched directly via
  the home-server connector, not a full-file regenerate). Reworded the "raising it is the dearest climb
  in the game... each costing 3 AP more than the last" prose, since the new deltas (18/20/24/28) aren't a
  clean arithmetic step — now describes the price as matching a Premium-tier class feature's cost at the
  same Hit-Dice tier, per `D-GH-2026-09-03-proficiency-bonus-pricing`'s actual pricing rationale. Verified
  with `node testing/scripts/guide-price-check.mjs` and `node testing/scripts/verify-guide.mjs` — both
  clean against this specific change; `verify-guide.mjs`'s one `feature prices` FAIL (an unrelated
  pre-existing `Empowered Strikes / Self-Restoration` price-mismatch plus several ambiguous/unparsed
  class-feature rows) was confirmed present before this edit too (`git stash` diff), so it is
  pre-existing drift, not a regression, and out of scope here. **Not done:** the Guide's
  `documents-rules:` reconciliation stamp — machine-generated by `pact-guide`'s own
  `stamp_guide_rules.mjs`, which this session could not run (file read/write access to `pact-guide` via
  the home-server connector, but no script-execution capability there). `DATA.version` unchanged by this
  commit (docs-only).
- **2026-09-03 · feat(dm): a DM can zero a character's self-declared Player AP, and once a campaign
  ignores it, it can no longer creep back up** — live-data audit for the Amble campaign found three
  characters (Archer, Anders Pipeleaf, Caspian) carrying a non-zero "Player AP" (CharGen's own
  self-editable "Budget" field, an `award`-type LOG total structurally separate from DM-awarded
  `characters.ap`) — 127/79/27 AP respectively — despite Amble already having `ignore_player_ap` on.
  Root cause: that campaign flag only ever gated what compute()/the UI *read*, never what could be
  *written* — "Copy to CharGen" (feat/chargen-dm-view) is a documented, deliberate exception that never
  re-fetches it, so a DM inspecting a copy saw the raw, uncapped figure. Fixed at both ends: a new
  `dm_zero_player_ap` RPC (purpose-built, same reasoning as `dm_set_creation_ceiling` — not a
  `dm_edit_character_log` allowlist widening) appends a dmEdit-stamped compensating award computed from
  the log itself, exposed in DM Console's "DM tools" panel as a one-click **Zero Player AP** button; and
  a new trigger, `pact_enforce_player_ap_ceiling`, makes the DB itself refuse any further rise in a
  character's own (non-dmEdit) award total once its campaign has `ignore_player_ap` on — so the number
  cannot grow back regardless of which tool or path writes it. All three live characters zeroed via the
  new RPC. See `D-GH-2026-09-03-dm-zero-player-ap`.
- **2026-09-03 · fix(chargen): "Copy to CharGen" now shows the same Player AP figure as every live
  view** — same-day follow-up to the entry above. The sandbox's `_cgDmOpts()` hardcoded
  `ignorePlayerAp:false`, so a DM's copy of a character in a campaign that ignores player-entered AP
  still counted it in full, disagreeing with Live Sheet/DM Console/a live CharGen session. Fixed by
  freezing the source campaign's `ignore_player_ap` at copy-open time, the same way DM AP is already
  frozen. Display-only — the new DB trigger already meant the stored figure could never really have
  grown, only been shown wrong.
- **2026-09-03 · fix(chargen): "Copy to CharGen" now shows the same drawback-AP cap as every live
  view** — same-day follow-up, identical shape to the entry above. `_cgDmOpts()` hardcoded
  `drawbackCap:undefined` for the copy sandbox, so a copy of a character in a campaign that caps
  drawback AP showed the FULL, uncapped grant instead of the capped figure DM Console/Live Sheet/a live
  CharGen session all show. Fixed by freezing the source campaign's `rules` in the same fetch that
  already freezes `ignore_player_ap` (no second network call — `drawbackCapFromRules()` is a pure
  function of that blob), and giving `_cgDrawbackCap()` an optional rules-override parameter.
- **2026-09-03 · fix: two real bugs found by `/code-review ultra` on the three entries above, before
  opening the PR** — (1) `dm_zero_player_ap` summed ALL award events including `dmEdit:true` ones, so
  zeroing a character with a DM-granted boon would silently cancel that legitimate grant too, leaving
  its paired cost stranded; fixed to exclude `dmEdit:true`, matching what the ceiling trigger already
  protects and what the DM Console button's own tooltip already promised. (2) The Copy-to-CharGen fixes
  were gated on `_cgCopySourceAp>0` rather than "is this actually a copy", so a character with 0 DM AP
  (an ordinary case, not an edge case) lost both fixes — and the AP-source label had the identical
  conflation, telling the DM a bound character "isn't bound to a cloud campaign at all". Both fixed with
  a genuine `_cgCopySourceIsCopy` flag. See the Addendum on `D-GH-2026-09-03-dm-zero-player-ap`.
- **2026-09-03 · fix(chargen): the `_cgCopySourceIsCopy` fix replaced a condition instead of adding to
  it, breaking two existing tests** — caught by CI on PR #508 (`tool-pricing-ci.mjs`, 187/2 failed).
  Two pre-existing tests simulate a "Copy to CharGen" copy by setting `window._cgCopySourceAp` directly,
  without the newer flag. Fixed by OR-ing the two conditions (`_cgCopySourceIsCopy ||
  _cgCopySourceAp>0`) instead of swapping one for the other — both signals stay valid for what each
  actually covers. Verified locally with the real CDP test harness: 189 passed / 0 failed.
- **2026-09-03 · feat(engine): re-price the proficiency bonus ladder (`DATA.version` v0.364 → v0.365)**
  — `DATA.profCum` (+2→+6) was `4/7/10/13` per step (cumulative 34), priced as if it were a narrow
  purchase; `prof` actually feeds every proficient skill (doubled again under Expertise), every
  proficient save, spell save DC/attack, cantrip/pact-slot/arcane caps, and every weapon attack a
  character is proficient with. Measured against `js/ap-by-level.js`'s budget curve, the old steps cost
  4%–18% of the AP a character earns in the tier window each unlocks in — cheaper than a single
  Premium-band class feature at the same tier despite touching far more of the sheet. Re-priced to
  `18/38/62/90`, matching `DATA.MASTER`'s Premium-band (raw) price at each of the four HD-gated tiers —
  an anchored number, not an invented curve. HD-gates (`DATA.profGate`) unchanged. No fixture pins
  `profBonus` above the free default of 2, so `testing/tests/engine-parity.html` is unaffected by
  construction (73 passed / 0 failed, before and after) — flagged as a coverage gap for a follow-up
  fixture, not treated as proof of safety. **The Players Guide is not updated in this change** — the
  served copy (`docs/PACT-Players-Guide.html`) and the `pact-guide` master still show the old numbers and
  the "dearest climb" framing; queued as a follow-up task per the owner's request rather than landed
  alongside the engine change, so per `AGENTS.md` this is not yet fully done. See
  `D-GH-2026-09-03-proficiency-bonus-pricing`.
- **2026-09-03 · fix(testing): the anti-drift guard could not see the drift it was built for**
  — `/code-review ultra` on PR #503 returned 13 findings; this lands the test/doc half of them.
  `testing/sql/rls-baseline-test.sql` hashed only `prosrc`, so the `search_path` regression that shipped
  in the SAME promotion (`pact_ap_ledger_protected` lost `set search_path = public, pg_temp` when the
  migration was folded into the baseline) was **invisible to it** — proven by injecting the divergence
  deliberately and watching it print PASS. The hash now covers `proconfig`, `prosecdef` and
  `provolatile` too. Two further holes in the same file: the comparison is an inner join with no count
  assertion, so a typo'd or renamed function silently shrank coverage while still reporting SAME-logic
  (now asserted both sides, 5 and 5); and `pg_temp.rejects()` caught `when others`, so a missing column
  or a syntax error counted as a passing rejection — rename `characters.stats` and all four probes went
  green having never fired the trigger (now requires the `PACT: ` prefix). 30 → **32 assertions**, each
  new one proven to bite by a deliberate break. `testing/scripts/version-label-ci.mjs`: the
  `check(BUILD, BUILD)` tautology became a real well-formedness assertion, and the `index.html` guard
  now derives its pattern from any major instead of hardcoding `v1` (a hand-pasted `v2.512` used to sail
  past the one check on the one file that must never be hand-edited). `testing/scripts/dm-console-ui-e2e.mjs`:
  the suite-wide stub waits on `window._campBridge` instead of a 2500 ms guess — a slow boot made it
  throw and abort the suite before assertion 1 — and the sleep moved after the stub install.
  `docs/VERSION-SYNC.md` said a rules bump "needs **no** rules-label edit in any tool"; three literals
  say otherwise and CI now asserts them, so the next bump would have gone red against the documented
  procedure — corrected, with the three sites named. Verified against a real PostgreSQL 16:
  `rls-baseline-test.sql` 32/32, `session-seal-test.sql` 43/43, `dm-console-ui-e2e` 96/96,
  `version-label-ci` 10/10. **No production SQL and no app code touched** — the `search_path` fix itself
  is handed to the session that owns those commits. `DATA.version` and `BUILD` untouched. See
  `D-GH-2026-09-03-code-review-503-followups`.
- **2026-09-03 · release: promote `preview` → `main` as build `v1.504` (PR #504)** — carries the two
  header-truth commits below. Regular merge commit, never squash, per `docs/VERSION-SYNC.md` step 5;
  verified after the fact that `main`'s head really has two parents. `BUILD` bumped in `js/engine.js` and
  mirrored to the four tool labels, `index.html` untouched (it reads `BUILD` live), `DATA.version`
  untouched — confirmed by diffing `js/engine.js` and seeing the `BUILD` constant as its only changed
  line. All 14 CI checks green. **No tag**, per `D-GH-2026-08-20-tag-only-meaningful-promotions`: this
  promotion carries comment and documentation corrections only. Verified live by fetching
  `js/engine.js` off GitHub Pages (`v1.504`) and spot-checking the shipped header prose, rather than
  stopping at "merged".

- **2026-09-03 · fix(tools): stop the header comment tripping the engine-symbol drift guard** — the
  de-rot commit below asserted that neither tool declares a local `compute()` and demonstrated it by
  quoting the grep, writing the literal `function compute(` into both files. `testing/scripts/audit.py`'s
  drift guard matches that pattern against **raw file text, comments included**, so the sentence claiming
  the guard finds nothing was itself the thing it found: CI went red at 27 passed / 2 failed. Reworded to
  make the same point without spelling out a declaration, and the comment now warns the next editor that
  the guard reads comments too. Deliberately did **not** loosen the guard to ignore comments — a
  commented-out engine symbol is a paste waiting to happen, and weakening a drift check that protects the
  single source of truth to accommodate prose is the wrong trade. audit 29/0 (was 27/2).

- **2026-09-02 · fix(tools): drop the false `file://` claim from CharGen and Live Sheet** — both headers
  listed *"Must run by opening the file directly (file://)"* under **HARD CONSTRAINTS (do not break)**.
  It had been untrue since D-GH26: the rules engine is an ES module and browsers refuse module loads from
  a `file://` origin, so opening either tool off disk leaves `window.DATA` undefined and the tool
  non-functional (measured in headless Chromium — all three tools, engine not loaded, `DATA.version`
  `null`). Replaced with what is actually true, stating why in place so it is not restored.
  `docs/HOW-TO-WORK.md` already said `file://` would not work and gained the failure *symptom* so it is
  recognisable without re-measuring. Restoring `file://` is filed as a LATER consideration
  (`feat/file-protocol-support`), gated behind relaxing the no-build-step rule. Also de-rotted the Live
  Sheet's `DATA.version (currently "v0.339")` header comment, stale by 25 releases, into a pointer to the
  live value. No behaviour change; `DATA.version` untouched. See
  `D-GH-2026-09-02-file-protocol-support-or-drop-the-claim` — including two corrections: the task that led
  here was itself wrong, and only two of the three tools carried the claim.

- **2026-09-02 · fix(tools): de-rot the whole "READ FIRST" header block, not just the one false line** —
  a `/code-review ultra` pass over the change above found that the same comment block still told a fresh
  agent to read two files that do not exist (`PACT-CONTEXT.md`, `PACT-Players-Guide-v0.303.docx`), stamped
  itself `v0.339` against a live v0.364, claimed `compute()` and `DATA` were "copy-pasted into BOTH html
  files" with a RULE to keep mirroring them — which today means re-implementing the rules engine inside a
  tool, the one thing `AGENTS.md` forbids — described the tools as having "NO external deps" when both
  import 6-7 modules from `js/`, and described the deleted D-GH40 `-livesheet.json` export as the
  CharGen→Live Sheet handoff. All corrected against the files. **One was player-facing:** the Live Sheet's
  in-app Tool Guide told players to click `⇆ Live Sheet` "to download a `-livesheet.json` file" — that
  button is `⇆ Open in Live Sheet`, downloads nothing, and hands the character over in-browser, so players
  were sent hunting for a file that was never produced; rewritten to describe the two routes that exist.
  The four items in that block which genuinely ARE still duplicated (`renderCharSheet`,
  `buildPortraitPrompts`, `hydrateSheet`/`csSave`) were kept. Also corrected the same `file://` claim in
  `docs/AI_review_prompt.md` — the brief for a cold reviewer who cannot check it — along with its pinned
  `DATA.version = "v0.337"`, and repointed `version-label-ci.mjs`'s dead `TASK_BOARD_NEXT.md` reference.
  Comments and docs only; no behaviour change. See the Addendum to
  `D-GH-2026-09-02-file-protocol-support-or-drop-the-claim`.

- **2026-09-02 · docs: record that the 2026-08-25 warnings-race fix was incomplete** — added an
  Addendum to `D-GH-2026-08-25-dm-console-warnings-race-flake` (plus a ⚠ pointer on its `DECISIONS.md`
  index entry) so that record no longer reads as "solved". Names the precise analytical gap: it examined
  the two `P.select('live-1')` calls above the warnings block and cleared them as *victims* — correctly,
  their own assertions read only synchronous state — but never considered them as *sources*, and those
  are the selects whose in-flight fetches poison the later block. A race has two ends; only one was
  audited. Also records the measurement (3 issued / 2 unsettled pre-fix, 0 / 0 after) and one
  consequence: a `[]`-returning warnings-banner failure is now a known defect class with two instances
  and must not be closed by a re-run again. Notes explicitly that no *product* change is implied —
  `loadInvites()`'s same-campaign late response is correct behaviour in production and only bites a test
  that seeds synthetic state.
- **2026-09-02 · fix(testing): close the dm-console-ui warnings race properly (2nd attempt)** — the
  invite-warnings block failed **5 of 96** on PR #499's promotion, every assertion returning `[]`, and
  went green on a re-run — the second time this exact failure has been papered over. `selectCampaign()`
  fire-and-forgets `loadInvites()`, which calls `renderCampWarnings()` on **both** its success and error
  path, so a late response sets `_invites = []` and wipes the banner a later block just seeded.
  `loadInvites()`'s stale-response guard does not help: it pins `forCampId` and bails only when the
  campaign **changed**, and every select in the suite picks the same `live-1`.
  `D-GH-2026-08-25-dm-console-warnings-race-flake` diagnosed this correctly but stubbed
  `listCampaignInvites` only for the warnings block's own duration — which cannot cancel the fetches the
  two selects **above** it had already issued, and those are the actual clobberers. The stub now goes in
  once, right after page-ready, before any block runs. **Measured rather than reasoned:** instrumenting
  the pre-fix suite with a slow-failing stub showed **3 real calls issued, 2 still unsettled** when the
  warnings block ran; after the fix it is **0 and 0**. CI is where it bites because the real call there
  makes a genuine round-trip that 401/400s slowly — locally it fails instantly and lands harmlessly,
  which is why the failing commit passed 3/3 on a dev machine.
- **2026-09-02 · docs: a cloud session cannot delete ANY remote ref, not just tags** —
  `docs/sessions/2026-07-19-github-release-tag-cloud-session-restriction.md` was written about tags and
  releases and closed by listing "deleting a remote branch" as an **open question**. It has since been
  answered four separate times — 2026-07-11, 2026-07-14, 2026-08-09 and again on 2026-09-02 (PR #496's
  branch) — each independently finding remote-branch deletion blocked, but the answer stayed scattered
  across session notes while the canonical note still said "unknown". Corrected there, with all four
  citations. The note's own quoted mechanism already predicted it: the proxy "restricts git push
  operations to the current working branch", and a branch you don't have checked out is no more that
  than a tag ref is. Recorded one non-obvious detail: a branch delete can surface as a **transport**
  error (`send-pack: unexpected disconnect`) rather than a clean `403`, which reads like a network blip
  and invites a pointless retry — `git ls-remote --heads origin <branch>` distinguishes them.
  `AGENTS.md` gains a one-line pointer under Shell environment notes, since an agent planning branch
  cleanup reads that and not a July session note. Genuinely still untested, and left marked so: repo
  settings and webhooks.
- **2026-09-01 · fix(testing): repair economy-ui-e2e fixtures stranded by the creation-ceiling change** —
  the gate failed **35 of 155** checks on untouched `preview` and now passes **155/155**. Cause: PR #480
  (`5a752b7`, *"creation ends by choice, not by accident"*) retired the automatic threshold tripwire that
  used to end creation, but these fixtures still built characters with `creationLockConfig{threshold:N}`
  and spent past it, expecting the lock to trip. It no longer does, so every character stayed
  mid-creation, nothing was ever billable, and each of the 35 assertions about charging measured an
  economy that never charges. Fixed at all 8 fixture sites by ending creation the way the app now does —
  an explicit `creationLocked` event placed exactly where the old threshold tripped, so the same
  purchases are creation and the same ones are in play. The now-meaningless `threshold` values were
  dropped too: a threshold is a *ceiling* since #480, and figures like 1 or 20 would have left every
  fixture absurdly over it (omitted, it falls back to the realistic 79 default, which none exceed).
  Also added an **abort-visibility guard**: a crash partway now prints an explicit
  `[economy] ABORTED — N checks ran` line instead of dying silently between the last PASS and the
  summary. **Correction to the entry below:** that script was reported as "exits 0 even when it
  crashes". It does not — it exits 1, correctly. The 0 came from measuring it as
  `node … | tail -25`, where the pipeline reports `tail`'s status, not node's.
- **2026-09-01 · feat(engine,dm-console): DMs can re-price any row of their campaign's economy band** —
  the gold-and-downtime economy shipped with three settings and nothing to turn between them. A DM may
  now customise any band row, independently for gold and for downtime, by a **multiplier** (×2, ×0.5) or
  a **flat override**; the two are a radio per row per currency, so they cannot both be set. `js/engine.js`
  gains `effectiveBandRows()`/`bandRowKey()` and `purchaseCost()` matches against effective rows, so every
  existing call site picks it up unchanged. Stored at `campaigns.rules.economy.rowCosts[band][rowKey]` —
  **no SQL migration** (`rules` is free-form JSON; the key is omitted when nothing is customised) and **no
  `DATA.version` bump** (no default band moved, `compute()` untouched, and §17 already grants the DM this
  licence in the guide's own words, so no guide edit either). Already-made purchases keep the price they
  paid — frozen `gp`/`days` still win — and a customised row's downtime **phrase** is regenerated from its
  new day count, so a re-priced row can't print "6 weeks" beside a 21-day cost. New gate:
  `testing/scripts/cost-customization-ci.mjs` (82 checks) + `.github/workflows/cost-customization.yml`.
  Found while testing, **pre-existing**: `economy-ui-e2e.mjs` failed 35 of 155 checks on untouched
  `preview` — its fixtures still relied on the auto creation lock that PR #480 retired. Repaired in the
  follow-up entry above.
- **2026-09-01 · fix(chargen): a finished character can no longer be re-rolled, and a stale "latent"
  claim corrected** — found reviewing PR #492. That PR makes `creationLocked` an undo barrier (correctly
  — it made true a promise my own "Finish creating" dialog was already making and breaking). But
  `undoFloor()` returns the index of the *last* barrier + 1, and the roll's carried lock must be
  re-appended AFTER the burst or every burst event replays as post-lock and re-prices own-species traits
  expensive (D-GH34). On a locked character the barrier therefore lands last, `undoFloor === LOG.length`,
  and the pre-roll frame can no longer be restored — breaking CharGen's own "randomize is ONE undoable
  step". Measured: a lock mid-log leaves a 2-event undoable tail; the same lock at the end leaves 0.
  Fixed by **refusing the roll** rather than reordering, which is also the conceptually right answer: a
  roll builds a character from scratch, and one whose creation has been deliberately ended is being
  advanced, not built. There is now a real control for the case where you mean it — a DM's "Reopen
  creation". Also corrects `undoFloor()`'s note that `creationUnlocked` handling is "latent (nothing
  emits it yet)": `dm_reopen_creation()` and the campaign-move trigger both emit it, and two live
  characters already carry one.
- **2026-09-02 · fix(tools): version labels now have a gate — and the task that prompted it was wrong**
  — the board carried a task claiming CharGen displayed a rules version 25 releases stale (`v0.339`
  against a live `v0.364`). **It was wrong, and I wrote it** — from a grep, without loading the tool. All
  three tools read `DATA.version` live at `engine-ready` and display **v0.364** correctly over http, which
  is how the app is served; `fix/chargen-rules-label-live` fixed the last hardcoded copy on 2026-08-10.
  Verified by loading each tool in headless Chromium and reading what is on screen. What IS real: the
  hardcoded **fallback** literals behind those live writes were stale, and nothing has ever checked them —
  they have rotted twice before (the Live Sheet's footer sat 30 versions behind until 2026-08-06;
  CharGen's Info popup showed `v0.339` beside a header reading `v0.356`, reported from real use
  2026-08-19), and both times the live path was fixed and the literal left. New
  `testing/scripts/version-label-ci.mjs` (10 assertions, pure Node, no browser) asserts every user-visible
  rules label equals `DATA.version` and every build mirror equals `BUILD`, enumerating the targets rather
  than grepping so the dozens of legitimately-pinned historical comments ("v0.314 fix") are not touched;
  it also asserts `index.html` hardcodes nothing, since `docs/VERSION-SYNC.md` says it reads `BUILD` live.
  Proven to fail on both a drifted value **and** a renamed anchor, so it cannot quietly stop checking.
  Now a job in `engine-parity.yml`. The three stale literals are corrected to `v0.364` — safe to do only
  because the gate now keeps them honest. **Separately, and bigger:** measuring this turned up that
  `file://` no longer works in ANY tool — ES modules are blocked there, so the `engine-ready` bridge never
  runs and `window.DATA` never exists, yet all three still list *"Must run by opening the file directly"*
  under HARD CONSTRAINTS. Filed as a NOW task; it needs an owner decision, not a patch.
- **2026-09-02 · fix(sql): the maintained baseline had fallen three migrations behind — and now cannot again**
  — `sql/rls-policies.sql` calls itself the fresh-install path and says "safe to re-run". Neither claim held.
  A database built from `schema.sql` + `rls-policies.sql` had **no seal functions at all**, so the shipped
  tools' `supabase.rpc('seal_character_history')` would have failed on every press; and **re-running it
  against production** would have reverted `pact_enforce_locked_history` to the award-only 2026-08-10
  version and re-GRANTed the EXECUTE that `2026-09-01-revoke-trigger-function-execute.sql` removed —
  silently undoing a security fix, while that migration's header claimed the grant state was "reproducible
  from `sql/` alone". The baseline now carries the live `dm_edit_character_log`, the widened projection, the
  amended locked-history trigger, **both seal RPCs** (previously absent entirely), and grants matching live.
  **Verified by diff, not by eye:** a database built from the baseline alone is now logic-identical to
  production for all **seven** functions (normalised body hashes compared both ways). Two new guards make it
  stay that way — `testing/sql/rls-baseline-test.sql` (30 assertions) builds the fresh-install path, loads
  the migrations over the top and asserts **both sources define the same logic**, and
  `.github/workflows/sql-guards.yml` finally runs it *and* `session-seal-test.sql` (43 assertions) in CI —
  the latter had **never** run there despite covering the entire security boundary. The drift guard was
  proven to fail by deliberately reverting one line and confirming a non-zero exit. `sql/migrations/README.md`
  records the rule the whole day turned on: a dated migration is a historical record, never the current
  definition.
- **2026-09-02 · fix(seal): a DM-removed boon can no longer be un-removed from a locked history**
  — `dmRemoveBoon` sat outside **both** `pact_ap_ledger_protected()`'s projection and
  `pact_ap_ledger_spend()`'s sums, so deleting one moved neither trigger's view of the log: the projection
  never mentioned it, and its cost is 0 so no sum changed. A player could delete it from a locked prefix,
  `activeEvents()` would stop suppressing the boon, and the DM's decision was silently reversed inside a
  history the seal calls permanent. Added to the projection — and **positional protection is the right tool
  here, unlike for patch buys**: checked rather than assumed, `dmRemoveBoon` is created in exactly one place
  (DM Console, through `dm_edit_character_log`'s append-only write) and every other reference merely reads
  it, so nothing rewrites or relocates one. That is precisely the property `replacePatchSlot()` breaks for
  patch events, which is why species and ability scores needed comparing by derived value instead. The
  general lesson, now recorded in the migration: *"add it to the projection" is right or wrong depending on
  whether anything legitimately rewrites that event type, and it has to be checked per type.* Blast radius
  zero twice over — measured before applying, 0 `dmRemoveBoon` events exist across all 35 live characters
  and 0 seals exist. Verified: delete refused, `refVal` swap refused, a post-seal purchase still allowed;
  SQL harness **43/0** against a real Postgres 16 (up from 40), and the repo migration hashes identically to
  the live `pg_proc` body.
- **2026-09-02 · feat(seal): a locked character's species is frozen and its ability scores only go up**
  — owner ruling (`D-GH-2026-09-02-seal-freezes-species-and-ratchets-stats`), closing the largest gap the
  second review found: species, origin class and ability scores live in `cat:'patch'` events, which are
  deliberately outside the seal's positional protection because `replacePatchSlot()` legitimately rewrites
  them in place — so a locked character could change Human to Dwarf, or move a locked STR 14 to DEX 14. The
  equal-cost swap was the nastier one: the AP total is unchanged, so the budget trigger could not see it
  either. Now compared by **derived value** (immune to how the event moved) and keyed on the **payload key,
  not `_slot`** — measured first: 164 of 218 live patch events carry no `_slot` at all, so a slot-based rule
  would have missed almost every character. **Second origin species is frozen too**, and that is not
  belt-and-braces: the engine prices a trait as own-species when `r.race === b.species || r.race ===
  b.species2`, so freezing one without the other leaves the rule bypassable. Asymmetric by design — ADDING a
  second origin species after a lock stays allowed (it is a new purchase), changing or removing one that was
  already locked in is refused. **Ability scores ratchet**: raising with new AP is fine, lowering or moving
  points is not. Fails open where no species is recorded — two live characters have none. CharGen's
  `_cgSealPatchRefusal()` mirrors the rule against `foldBuild(LOG)` so the player gets a sentence, not a raw
  database error. The third clause of the ruling (own-species traits only, unless a second origin species)
  needed **no code** — `js/engine.js` already enforces it; freezing species is what makes it stick after a
  lock. Nine behaviours verified against the live trigger in rolled-back transactions, and the repo migration
  now hashes **identically** to the live `pg_proc` body — checked, not assumed, because a file drifting from
  the live definition is what caused this same day's production regression.
- **2026-09-02 · fix: the remaining 20 session-seal review findings, across engine, sync, all three tools and CI**
  — second `/code-review ultra` pass on the merged seal, five independent angles. The worst were silent
  rather than loud. **CharGen mispriced every purchase in a sealed class**: `_cgLockSealedControls()`
  disabled sealed `.classunlock` boxes and `_domReadBuild()` drops disabled ones, so the class vanished
  from the priced base and each later buy in it was stamped with the **cross-class surcharge**, frozen
  into the LOG. Now distinguished by a `dataset.sealLocked` flag, which also fixes the else-branch
  clearing `disabled` on controls it never disabled after an in-app character switch. **`repriceDraft()`
  ignored `sessionSeal`** — a character sealed while still in creation kept having its frozen `cost`
  rewritten, and `cost` is in the server's protected projection, so every save would have been refused
  for ever with no client path back. **`redo()` had no barrier guard** and `cgFinishCreating()` bypasses
  `commitHistory()`, so buy/buy/undo/Finish/redo deleted the `creationLocked` event outright. **`reconcile()`
  bypassed `_sealBlocked`**, re-issuing an impossible write on every load and reconnect and making the
  documented Cloud → Load remedy a no-op; routed through the existing `onBehind` channel so owner
  decision L1 (keep the client's work, ask first) still holds. **The `name` guard blocked renames the
  server allows** — the projection covers `'names'` (spell/language), not `'name'` — and sat above the
  no-op check, so opening a locked character flashed twice. `retractFlatEvent()`'s tri-state return is
  now honoured by all three reconcile callers (they re-tick the box instead of diverging) and its refusal
  is coalesced to one notice per pass. Autosave now surfaces a refusal at all, the one-shot notice is
  per-character rather than per-page and is never burned from `pagehide` where `alert()` is suppressed,
  DM Console's zero-amount guard no longer rejects "and lock history" on its own, and its seal button
  reuses one idempotency key so a retry cannot stack a second seal. **Wording corrected throughout**: the
  same rejection fires for the pre-existing AP-award boundary, so nothing claims "your DM sealed this".
  Server-side, `pact_ap_ledger_protected()` now projects the **whole event** rather than six enumerated
  fields — the `'v'` key only covered `{v:…}` payloads, leaving `abil`/`hd`/`wprof`/`names` substitutable
  and a seal's own `idem` strippable (which defeats the double-award guard); blast radius measured at 0 of
  35 characters before applying. `undo-barrier-ci.mjs` was wired into **no workflow at all** and now runs
  in `engine-parity.yml`; two vacuous assertions in `sync-concurrency-ci.mjs` are replaced with real
  lifecycle coverage via a test seam; the snapshot section that tested a local re-implementation now says
  so. `_undoBarrierMsg()` moved to `js/ui-helpers.js` — it had been duplicated into both tools at the
  moment the rule it explains was centralised. Gates: parity 73/0, undo-barrier 44/0, sync-concurrency
  26/0, sync-state-machine 24/0, autosave-flush 14/0, log-fuzz 2000/2000, esc-gap 9/0; tool-pricing's one
  remaining failure is the known harness flake, **verified pre-existing by stashing every change and
  reproducing it identically on a clean tree**.
- **2026-09-02 · fix(sql): the session-seal migration silently deleted two live guards — restored**
  — `/code-review ultra` on the merged seal work found that `2026-09-01-session-seal.sql` rebuilt
  `dm_edit_character_log()` from the **stale** `2026-08-10-dm-edit-character-log.sql` rather than editing
  the live definition, and that this reached **production**. Its header said "every other line is unchanged
  from 2026-08-10" — true, and precisely the defect: that file had not been the live definition for three
  weeks. Gone with it: `assert_campaign_active()` (so an **archived, read-only campaign was writable by its
  DM again** — reverting D-GH-2026-08-22) and the whole boon/award FIFO amount-matching block (so **a boon
  grant no longer had to be paid for** — reverting D-GH-2026-08-10-dm-edit-boon-amount-check, itself a
  `/code-review ultra` find on PR #403). Both confirmed absent against the live database before the fix and
  present after, `sessionSeal` support retained. Also fixed `award_ap_and_seal()`'s idempotency race — its
  authorisation SELECT took no row lock, so two concurrent calls sharing one `p_idem` could both pass the
  replay probe and both award AP, the one outcome its own header calls materially damaging; rebuilt from
  the **live body read back from `pg_proc`**, not from the migration file. The rollback file, which told an
  operator to re-apply that same stale file (leaving the database *weaker* than before the seal shipped),
  is corrected. Client half: the Live Sheet's manual cloud-save threw `res.error` **before** its new
  `res.sealed` branch, so on the first rejection — the only one carrying `error` — the branch was dead and
  the player saw raw plpgsql text; all five review angles found this independently. Advisor clean, live data
  unchanged (35 characters / 461 log events / 0 seals), parity 73/0, undo-barrier 44/0, sync-concurrency 24/0.
  **The lesson, since this is the second time in two days:** a dated migration file is a historical record,
  not the current definition. Rebuild a function from `sql/rls-policies.sql` or from `pg_proc`, never from
  the migration that first created it.
- **2026-09-01 · fix: 14 code-review findings on the session seal, incl. one that killed undo outright**
  — `/code-review ultra` (required by the PR template for anything touching `js/engine.js` or `sql/`)
  found that step 1's `isUndoBarrier()` treated `noLock` awards as barriers. CharGen's budget is a
  singleton `award` **relocated to the log tail** on every edit, so touching the Budget field put a
  barrier at the end, `undoFloor()` returned `LOG.length`, and undo died permanently — in both tools.
  CharGen's own comment says a budget award must not lock undo; that was true only until step 1 added
  the guard. The server had always exempted `noLock`. Also fixed: a budget edit bricking cloud save on
  a sealed character; `retractFlatEvent()`'s refusal being ignored by three reconcile callers (LOG/DOM
  divergence); `_cgLockSealedControls()` matching a descendant's marker through nested skill/expertise
  labels and force-enabling controls it never disabled, plus sweeping every control on every keystroke;
  the Live Sheet refusing another character's import and refusing Reset — its only start-fresh path —
  while naming a control it doesn't have (Reset now detaches to a fresh id); `isSealRejection()`'s
  OR-chain making its hint/details fallback dead code; `_sealBlocked` never cleared by the in-app remedy;
  both manual-save paths reporting a seal rejection as "will sync when online";
  `award_ap_and_seal()` returning data before authorising; the protected projection guarding a sealed
  purchase's price but not its **identity**; `creationLocked` ignoring `creationUnlocked`; and an
  overclaiming comment on the sync guard. SQL fixes applied to production as `session_seal_review_fixes`.
  The EXECUTE revoke now has a migration file so `sql/` reproduces the live grant state.
- **2026-09-01 · fix(testing): tool-pricing gate was flaky — one case was a wrong answer, not a timeout**
  — the drawback-cap check reads `window._campaignBridge` (set by the async cloud bridge) but its
  readiness probe waited only for a classic-script symbol, so it ran early and read `undefined`,
  reporting a wrong result rather than failing to start — exactly what a readiness poll exists to
  prevent. Probe corrected; poll ceiling 30s → 60s after five spurious failures in one session. Three
  consecutive clean runs at 189/0. A flaky gate trains the reader to re-run and shrug, which is how a
  real failure gets waved through.
- **2026-09-01 · feat(tools): session seal Phase 2 — the seal reaches the UI** — CharGen's
  `retractFlatEvent()` now refuses to splice a purchase out of the sealed prefix and the checkbox
  re-ticks itself; that path, not `undo()`, is what the owner's "anything already bought can't be
  unselected" was really about. Sealed controls are disabled with a **visible** `🔒 sealed` marker
  rather than a title tooltip, because a disabled input fires no hover or focus event so a tooltip on
  one is unreachable by keyboard and touch. The Live Sheet's Import and Reset refuse on a sealed
  character (both keep the id, so the server would reject them anyway — better refused where the reason
  can be given). The DM Console gains an "and lock history" tick on the award form, routed through the
  atomic idempotent `award_ap_and_seal()`, plus a standalone "🔒 Lock history" button. Verified in a
  real browser: `tool-pricing-ci.mjs` **189/0** including five new seal assertions. Still open: CharGen's
  🎲 Randomise / file-load rebuild paths can drop a seal locally (fails safe — the server rejects — but
  shows a raw error), and the offline conflict UX. See `D-GH-2026-09-01-session-seal`.
- **2026-09-01 · feat(sql,engine): session seal — AMENDS the existing history lock (Phase 1)** — a DM,
  or the owner of a character in no campaign, can draw an explicit line under a character's history;
  everything before it is frozen, anything may still be appended after it. **Corrects a false premise
  this work was built on:** the plan and its three cold reviews all assumed no server-side history
  protection existed. It has since 2026-08-10 — `pact_enforce_locked_history()` already freezes
  everything up to the last non-discretionary award for campaign-bound characters. Found by listing
  the live triggers on `characters` in a pre-flight check, immediately before applying. A second,
  parallel trigger was therefore withdrawn: it would have been the hand-written-mirror drift
  `AGENTS.md` warns about, and it compared raw JSONB where the original deliberately compares a
  projection — it would have started rejecting legitimate saves. Phase 1 now makes three surgical
  changes instead: `sessionSeal` joins the protected projection so a seal cannot be removed; the
  boundary becomes the later of award and seal; and the seal half covers solo characters, which the
  award half skips. Adds `seal_character_history()`, atomic idempotent `award_ap_and_seal()` (the DM
  Console's Award AP writes no LOG event, so today it locks nothing), `sealedFloor()` beside
  `undoFloor()` in `js/engine.js`, and a 32-assertion SQL harness whose first section is regression
  tests proving the 2026-08-10 behaviour is unchanged. Zero of the 35 live characters carry a seal, so
  the change is inert until one is placed. No UI yet — Phase 2. Migration tested locally, **not applied
  to production**. See `D-GH-2026-09-01-session-seal`.
- **2026-09-01 · docs(agents): the live character count was stale — 35, not 25** — `AGENTS.md` carried
  "25 characters, 8 owners, 4 campaigns" measured 2026-08-27. A live check while preparing the
  session-seal migration found **35 characters, 8 owners, 4 campaigns, 6 campaign-bound, 49 AP awards,
  461 log events** — ten new characters in five days. Corrected here and in the session-seal plan,
  decision record, migration and SQL harness, all of which had quoted the stale figure. `AGENTS.md`
  now says explicitly that its number is a dated snapshot to re-measure, not a current fact — which is
  what its own "measure the blast radius against the live table" rule already implied.
- **2026-09-01 · fix(engine,tools): one undo-barrier rule, shared by both player tools** — the rule
  "this part of the history can no longer be taken back" had been hand-written three times, once per
  tool, and two copies were wrong for the *same* character (D-GH40 gave both tools one save envelope).
  CharGen's `undo()` checked only `dmEdit` while its own comment claimed to mirror the Live Sheet's
  award barrier, so a plain `award` event — a redeemed grant code, or the DM awards a clone migrates in
  — blocked undo in one tool and not the other; and **neither** tool treated `creationLocked` as a
  barrier, so the "Finish creating" dialog's promise that *"only your DM can reopen creation"* was false
  in both (one Undo click reopened it). Adds `isUndoBarrier()`/`undoFloor()` to `js/engine.js`, bridged
  into both tools. Exported as a **floor** rather than a per-event predicate because CharGen's undo
  restores whole earlier snapshots, so a frame captured before a barrier arrived would otherwise jump
  straight past it — that tool now compares the target frame's floor against the live log's. New gate
  `testing/scripts/undo-barrier-ci.mjs` (0 failed / 19). No mechanics change, so `DATA.version` is
  unchanged. Step 1 of 2 toward a DM-triggered per-session seal — see
  `D-GH-2026-09-01-undo-barrier-shared` for what it deliberately does *not* yet close.
- **2026-09-01 · feat(sql): moving a character between campaigns clears its creation lock and ceiling** —
  resolves the campaign-movement question three independent cold reviewers raised against the
  creation-ceiling plan and which it carried as unresolved. Owner decision: *"when a character leaves or
  joins a campaign, the locks go"* — both the finished-creation lock and the DM's ceiling figure. A
  ceiling is one DM's ruling about one character at one table; carrying it elsewhere would let a number
  nobody there chose silently govern that character, and a character with no campaign has no DM to
  adjudicate for it, so nothing is enforced (the same fail-open rule every local character already
  follows). Implemented as a trigger on `characters.campaign_id` changing rather than by patching
  `bind_character_to_campaign` / `dm_unbind_character` / `redeem_player_invite` /
  `redeem_character_claim` individually — one rule on the column cannot be bypassed by a future caller
  added without it in mind. Append-only, and needs **no engine change**: `js/engine.js` already reads a
  `threshold` of null as "no ceiling set".
- **2026-09-01 · fix(chargen): a random roll destroyed the DM's creation limit and un-finished creation**
  — 🎲 Random re-derives the whole LOG from the DOM (`applyBuild` then the appearance resync), and the
  DOM has no control representing a creation ceiling or a finished-creation lock, so both were silently
  dropped. Measured on the live tool: a character with a DM-set ceiling of 78 and creation finished came
  back with **no ceiling at all** (reverted to the 79 default, unenforced) and as a **draft again** — the
  DM's limit gone and the player quietly back on creation pricing. `randomizeRoll()` now captures those
  events before the rebuild and re-appends them after, skipping any that survived so a re-roll cannot
  stack duplicates. Carried in the roll rather than in `replaceWholeLogFromBuild()` deliberately: that
  function is also on the path that LOADS a different character, where preserving creation state would
  let one character inherit another's ceiling and lock — verified both directions.
- **2026-08-31 · feat(chargen): themed random character generator** — the 🎲 Random roll produced
  incoherent characters, and three defects were measured rather than guessed (harness now committed as
  `testing/scripts/random-quality-ci.mjs`): Hit Dice were capped at **9 for every budget** because
  `1+rnd(Math.min(9,…))` clamped the random DRAW rather than the ceiling, so a 535 AP (level-20) budget
  rolled an HD-5 character and dumped the surplus into 15 boons + 15 arts; at 600 AP **100%** of rolls
  owned light armour + shield + simple weapons and ~96% heavy armour + all martial weapons *regardless of
  class*; and skills were starved at level 1 (0.9 of 19) yet flooded at 600 AP (8.9 of 19). Adds a
  **theme layer** — eight playable concepts (Frontline Bruiser, Skirmisher, Battle-Caster, The Face,
  Scholar, Wilderness Scout, Trickster, Zealot), each declaring a spend shape, category weights over the
  `cat` fields `DATA.boons`/`DATA.arts` already carry, ability priorities, an armour/weapon ceiling and
  shortlists for skills, tools, drawbacks, name style and demeanour. ~18% of picks stay deliberately
  off-theme so two rolls of one theme still differ. Level now tracks `apLevel(budget)`. The old
  `confirm()` is replaced by a roll panel (theme picker + target level, remembered between rolls) whose
  preview strip spells out what the selected theme will do — abilities raised first, favoured boon/art
  categories, armour/weapon ceiling, favoured skills, spend split — every value read back off the theme
  object the generator itself uses, so it cannot drift from the roll.
  Legality machinery is untouched — `tryAct()` still gates every buy on budget + no-new-hard-warning.
  Fixes found on the way: tradition Rank could reach 10 against a UI select that only offers 0–9, which
  made the select read back as Rank **0** and stranded every spell slot behind a gate; spell slots were
  picked at a random level despite compute()'s non-increasing-by-level rule, so most were rejected and
  level-20 casters finished with 0–4 slots; `DATA.castAbility` was used as an "is this a caster" test
  when it carries an entry for every class, priming a Fighter's INT over its STR; and a drawback's AP
  refund was never spendable because the ceiling was captured before it. Display/UX only — no rules
  change, no `DATA.version` bump. New `testing/scripts/random-quality-ci.mjs` (+ `random-quality.yml`)
  gates what the roll produces — nothing did before. Graduates `feat/randomize-tuning` off
  `docs/TASK_BOARD_NEXT.md`.
  Full record: `decisions/2026/D-GH-2026-08-31-random-char-generator-optimize.md`.
- **2026-09-01 · feat(dm-console): a DM can set a character's creation limit and reopen creation** —
  completes the creation-ceiling work: until now the ceiling could only be stamped by hand in SQL. Each
  roster card's DM tools gains a **Creation limit** block showing the character's state (no limit set /
  still building against N AP / creation finished), an input to set or raise the figure, and a **Reopen
  creation** button on a locked character. Two purpose-built RPCs — `dm_set_creation_ceiling()` and
  `dm_reopen_creation()` — rather than widening `dm_edit_character_log`'s allowlist, on both cold
  reviewers' independent advice: that function's header calls it "deliberately not a general editor", and
  a JSON key-set check in plpgsql silently accepts `{threshold, auto}` with no bound on the value. One
  typed integer argument has neither problem. Both are append-only, DM-gated by `is_campaign_dm()`, and
  range-checked 1–2000 server-side. The stored figure is the DM's number alone — the drawback grant is
  added live by the engine, so a drawback taken mid-build still returns the room it paid for.
- **2026-08-31 · feat(engine,tools): creation ends by choice, not by accident — ceiling + "Finish
  creating", automatic spend tripwire retired · `DATA.version` v0.363 → v0.364** — creation used to end
  by *inference*: the first time cumulative spend crossed a threshold, silently, with no user action and
  no way back. Three live characters locked that way (Moss 84, Skylar 85, Caspian 87 AP) against a 79
  default that was none of their real budgets. The tripwire is now **deleted** — in `_lockStates()` and
  in CharGen's own `_cgEnsureLockFired()` mirror, which is where all three were actually locked. In its
  place: `creationCeiling()` / `wouldExceedCeiling()`, a limit of **the DM's assigned figure + the
  character's drawback grant** that a purchase is refused at, in both player tools, naming *both* exits
  (finish creating, or ask your DM to raise it) — never the finish action alone, which is wrong for a
  player topped up mid-build. Creation now ends only via an explicit **Finish creating** control.
  Fail-open by design: a character with no stamped ceiling has none, so nothing changes for legacy or
  solo characters. Five fixtures (EV-003/007/009/012/013) re-baselined — a racial trait that used to
  re-price on auto-lock now stays at creation rate; verified this repriges **no** live character.
- **2026-08-30 · feat(dm-console): show each character's creation-lock state on their card** — a DM had
  no way to see whether a character was still being built or had passed its creation limit, per
  character, anywhere. The card's PACT-build panel now carries a **Creation** row: "locked (past N AP)"
  or "still building — limit N AP", saying explicitly when N is the engine default rather than a figure
  set for that character. Read-only; SETTING a ceiling is the unbuilt half of
  `docs/plans/2026-08-30-creation-ceiling.md`. New pure engine export `creationLockState(events)` supplies
  it — CharGen and Live Sheet already carry a hand-written copy of this scan each, and a third would have
  been the drift shape this project keeps paying for. Additive: no `compute()` change, no `DATA.version`
  bump, parity 73/0.
- **2026-08-30 · fix(tools): AP breakdowns omitted the drawback pool and contradicted their own
  headline** — `compute()` composes spendable AP from THREE pools (player × ignore-toggle + drawback grant
  + DM) but returned only two of them, so no tool could label the third. Live on a real character:
  headline "80 AP", breakdown "0 player + 76 DM" — a 4 AP contradiction, visible to five of the six Amble
  players. `compute()` now returns `drawbackAp`; CharGen's three AP labels print the drawback share via one
  shared `_apDrawPart()` helper (three call sites, one definition, so they cannot drift apart again), and
  DM Console splits its mislabelled "AP earned (own log)" row — which silently attributed drawback AP to
  the player — into an awards row and a "Granted by drawbacks" row, showing the capped figure and the raw
  one when a campaign cap bites. Purely additive to the engine's return: no pricing change, parity 73/0,
  no `DATA.version` bump.
- **2026-08-27 · feat(dm-console): HD stat box on the roster card, plus per-card hide/show** — the
  default Card view's stat strip (`cardHTML()`) gets an **HD** box (the character's actual hit-dice
  level, `s.hd`, distinct from the AP-earned `Level` already shown in the header) appended after the
  campaign's two custom-field boxes. Every roster card (Card view, Customisable view, and their
  no-data placeholders, local files and cloud/campaign characters alike) also gets a 🙈 **Hide**
  button next to Skills/Tools/View; hidden ids persist in a new `pact_dm_v3_hidden_cards`
  localStorage set (same per-device-preference pattern as the existing `hiddenCols`/`XLayout` keys —
  display-only, never touches campaign data or `characters.stats`). A "🙈 N hidden — Show all" strip
  with per-name chips appears above the grid whenever any of that roster's cards are hidden, scoped so
  "Show all" only clears ids present in that roster (local files vs. one campaign's cloud roster) —
  a card hidden while viewing a different campaign stays hidden. `engine-parity-ci.mjs` (65/0,
  `engine.js` untouched) and `tool-pricing-ci.mjs` (176/0 on a clean re-run; one run hit an unrelated
  "Live Sheet never became ready" harness timing flake, reproduced absent on the pre-change tree too).
- **2026-08-30 · docs(sessions): file four `feature-hd-gate` cold reviews that had never left `z-cold/`,
  and clear the folder** — sorting `z-cold/`'s ten files by content hash showed five were byte-identical
  duplicates of reviews already in `docs/plans/cold-reviews/`, one a superseded plan snapshot, and four
  genuinely unfiled with no copy anywhere in the repo. The four are now in `docs/sessions/cold-reviews/`
  as `2026-08-27-<reviewer>-feature-hd-gate.md`, each stamped with the session log they were triaged in
  and referenced back from `docs/sessions/2026-08-27-feature-hd-gate.md`. Root cause — the close-session
  relocation checks `z-cold/processed/` only, copied instead of moving, and cannot fire at all in this
  repo where `z-cold/` is gitignored and lives on the `zcold` branch. See
  `D-GH-2026-08-30-archive-hd-gate-cold-reviews`.
- **2026-08-30 · fix(sql): `campaign_invites` was missing the table-level `revoke` its own comment
  claimed existed — DM invite notes leaked on a fresh stack, though not in production** — caught by
  `cloud-e2e`'s "invite note is DM-only" check failing deterministically on an unrelated PR (#472); the
  comment above `sql/rls-policies.sql`'s `campaign_invites` grant said a table-level grant is dropped
  before the column-scoped `grant select (...)`, but no `revoke` was ever actually present there or in
  `sql/migrations/2026-08-09-harden-invitation-system.sql`. Verified directly against production this was
  **not a live vulnerability** — `note`/`token_hash` carry no `SELECT` for `authenticated` there, because
  the role that built production's schema inherited a narrower `pg_default_acl` than whatever role
  `cloud-e2e`'s throwaway local Supabase stack uses; production's safety was incidental, not guaranteed by
  the SQL. Added the explicit `revoke select on public.campaign_invites from authenticated, anon;` to
  `sql/rls-policies.sql` plus a no-op-on-production migration, so the restriction holds regardless of
  ambient default privileges. Migration not applied to production from this session (unnecessary — it's a
  no-op there); goes through the normal deploy process. Graduates the NEXT-board task a concurrent session
  independently filed for the same gap (removed from `docs/TASK_BOARD_NEXT.md` in this change). See
  `D-GH-2026-08-30-invite-note-grant-drift`.
- **2026-08-27 · fix(tools): Arts/Boons hard-gate had two tool-layer gaps — Live Sheet under-charged a
  level-up that legalized a blocked Art/Boon, DM Console didn't mark them blocked;
  `tools/PACT-Live-Char-Sheet.html`, `tools/DM-Console.html`** — third `/code-review ultra` on PR #471.
  Live Sheet's `_CTX_PRICERS.hd` `strip()` helper only stripped blocked `features`/`subAbilities` before
  diffing, never `arts`/`boons`; reproduced a 5 AP silent under-charge (real delta 15, quoted 10) on a
  build leveling past a blocked Art's threshold, then extended `strip()` to cover all four purchase types.
  DM Console's roster/detail views marked blocked features but not blocked Arts/Boons; fixed by adding
  `artsDisplay`/`boonsDisplay` fields for the two pure-display call sites while keeping `s.boons` raw,
  since it also feeds `dmEditBody()`'s remove-a-boon dropdown as an exact-match value. Both fixes verified
  by reverting and confirming their new `testing/scripts/tool-pricing-ci.mjs` checks fail with the exact
  wrong numbers before restoring. No `DATA.version` bump — tool-layer only. engine-parity 73/73,
  tool-pricing 182/182. See `DECISIONS.md` D-GH-2026-08-27-feature-hd-gate (Addendum, round 6).

- **2026-08-27 · feat(engine): authored true 2024 levels for the remaining ~550 class features/subclass
  abilities; split 4 mis-bundled features; `js/engine-data.js` · `DATA.version` bump** — closes the
  task the previous entry deferred. Source: the owner's own page-by-page adjudication of a real 2024 PHB
  extraction (`docs/phb-rules-final.jsonl`), 577 rows High confidence and 27 Medium, not this session's
  guesswork. Applied 280 `lvl` overrides — 278 tighten a gate above its tier-band floor, 2 loosen one below
  it (only possible because `requiredHD()` now overrides tier in both directions). Split
  `Fighter: Tactical Mind/Shift/Master`, `Monk: Empowered Strikes/Self-Restoration`,
  `Monk: Perfect Focus/Body and Mind`, `Ranger: Roving/Tireless` into 8 separately-leveled, separately-
  priced features — each re-tiered by its own level using the engine's existing tier-shift pricing formula,
  the same one `rep` features already use — since each was bundling 2024 abilities the PHB gates and prices
  at different levels under one name. Zero live characters held any bundled key, so no migration was
  needed. Live data checked first: of 8 characters holding a class/subclass ability, only the one already
  known-blocked since round 1 is affected — no new character, no Amble character. 8 fixtures re-baselined
  (raised `hd` to the new minimum and re-derived through `compute()`); `CG-050` is the one exception — it
  exists to prove a *blocked* purchase grants nothing, so its `hd` stayed put and only its expected warning
  text moved. engine-parity 73/73, tool-pricing 180/180. Guide sync and the JSONL's own bundling are filed
  as separate follow-ups, not rushed into this round. See `DECISIONS.md`
  D-GH-2026-08-27-feature-hd-gate (Addendum, round 5).

- **2026-08-27 · feat(engine): tier demoted to pricing-only — an ability's own level is now the
  Hit-Dice authority; `js/engine.js`, `js/engine-data.js` · `DATA.version` v0.361 → v0.362** — owner
  ruling: "the Tiers are really just for costings." `requiredHD()` now treats an item's own `hd`/`lvl` as
  authoritative, overriding tier in **both** directions; `DATA.tierHD` is the fallback only for an item
  that states no level of its own. Authored true levels for the 40 abilities a source actually states: 26
  general-feat Arts (3→4 HD, 2024 general feats are level 4+), 12 Epic Boons (17→19 HD, level 19+ — the
  Guide's prose already said "the level-19 threshold", the data hadn't caught up), and 2 class features
  whose own name stated a level their gate missed (`Paladin: Aura range → 30 ft (L18)`,
  `Rogue: Improved Cunning Strike (L11)`, the latter a genuine *tightening* below its tier default).
  **The remaining ~550 class features and subclass abilities were deliberately left on the tier fallback**
  — no source in this repo or the Guide states their true level, and authoring them without one would mean
  inventing numbers. That data-authoring pass is now its own task-board item. Live data checked before any
  value moved: none of the 11 characters holding an affected Art/Boon/feature is above the new
  requirement. 4 fixtures updated; one hand-computed total (`EV-018`) was caught wrong and corrected by
  re-deriving through the real replay pipeline instead of composed arithmetic. engine-parity 73/73,
  tool-pricing 180/180. See `DECISIONS.md` D-GH-2026-08-27-feature-hd-gate (Addendum, round 4).

- **2026-08-27 · feat(engine): the Hit-Dice gate extended to Arts & Techniques and Boons;
  `js/engine.js` · `DATA.version` v0.360 → v0.361** — the original gate scoped to class abilities, leaving
  feats (Arts) and Boons **advisory**: the engine warned "needs N+ Hit Dice" and then charged and granted
  them anyway, so a 1 HD character could hold and use a 3 HD Art. Both now behave exactly as class
  abilities do — 0 AP, not owned, grants nothing, itemised under "Blocked purchases". The trap that made
  this non-trivial: the epic-boon **+2 ability fold reads `b.boons` ~400 lines above the boon pricing
  loop**, so gating at the loop alone would have handed a 1 HD character a free +2 — the same shape as
  round 1's Primal Champion regression. Arts and Boons are therefore resolved into blocked sets at the top
  of `compute()`, beside the feature sets and before that fold, with `blockedAP`/`_BLI` hoisted so all four
  datasets feed one ledger line. `CG-051` covers a blocked Art; `CG-052` covers the epic-boon trap (STR
  stays 10 at 1 HD, becomes 12 at 17). `EV-018` needed 17 HD and a larger award so the DM-removal mechanic
  it exists to prove still runs. **3 HD stays correct for the general-feat pool** — tiers are level bands
  gated at the floor (T3 = levels 3–4), the same rule that puts a level-19 Epic boon at 17 HD. Live data
  checked before shipping: 11 of 25 characters hold Arts or Boons and **none** is above their Hit Dice, so
  this enforces against zero existing characters. engine-parity 73/73, tool-pricing 180/180. See
  `DECISIONS.md` D-GH-2026-08-27-feature-hd-gate (Addendum, round 3).

- **2026-08-27 · fix: a blocked purchase grants nothing, and a level-up pays for what it legalises;
  `js/engine.js`, both player tools** — three defects found by `/code-review ultra` on PR #471, two of them
  introduced by the Hit-Dice gate in the same PR. (1) **Ownership was resolved after the ability-score
  fold**, which reads raw `b.features` for `Barbarian: Primal Champion`'s +4 STR/+4 CON — so a 1 HD
  Barbarian got the stats and their HP/AC/save-DC knock-ons for **0 AP** while the engine reported the
  feature "not counted, not owned" (that build cost 19 AP before the gate). Ownership now resolves at the
  top of `compute()`, before anything reads `b.features` for an effect. (2) **A purchase frozen at cost 0
  while HD-blocked became free once Hit Dice rose:** the Live Sheet priced a level-up as the Hit-Dice
  ladder alone, so nothing charged for the purchases the level-up legalised — `compute().total` 128 against
  `economy().spent` 96, no warning. `repriceDraft()` never had this bug (it prices every event as the
  `compute()` delta), so the level-up now charges the ladder **plus the drop in compute()'s own "Blocked
  purchases" line**. Removing the context escape outright was tried and reverted — it re-prices an
  unstamped Vigor/Grit stack, which is exactly what CharGen produces. (3) **All four Live Sheet pickers
  tested ownership before the HD check**, rendering a held-but-blocked feature as "Already purchased"; they
  now show it as held-but-inert with the remedy, and CharGen's subclass picker gained a live met/unmet HD
  annotation. New `tool-pricing-ci` coverage for the CharGen-import → level-up path. engine-parity 71/71,
  tool-pricing 179/179. Graduates the three task-board items these close. See `DECISIONS.md`
  D-GH-2026-08-27-feature-hd-gate (Addendum).

- **2026-08-27 · feat(engine): enforce the Hit-Dice requirement on class abilities, via one shared
  `requiredHD()`; `js/engine.js`, both player tools · `DATA.version` v0.359 → v0.360** — the Players Guide
  states this as absolute ("You can never buy an ability before you own the Hit Dice ... it requires") and
  `DATA.tierHD` has always carried the mapping, but the engine never checked it: a 1 HD Fighter could buy
  Extra Attack **and** Extra Attack (3rd) and `compute()` said only "OVER BUDGET". The rule existed in three
  places with three answers — engine none, Live Sheet five inline copies that had already drifted from each
  other over the `lvl` floor, CharGen none. Now `js/engine.js` exports `requiredHD()` as the
  single definition; `compute()` hard-blocks on it (0 AP, not owned, itemised under "Blocked purchases")
  across **both** the feature and subclass-ability paths, seeded into the existing `_blockedFeat` fixed
  point so an HD-blocked prerequisite blocks its dependents transitively; Live Sheet's five copies are
  deleted in favour of the export and CharGen annotates each class-feature option with its requirement
  (its subclass-ability picker is a follow-up). No stepped-tier
  escalation — measured as changing nothing (one `rep` entry exists, and its price is overridden), and the
  Guide lists that entry as having "no level gate". 15 fixtures re-baselined by raising HD and re-deriving,
  never by regenerating expected output; the four prereq regression fixtures keep their original warning
  strings byte-for-byte. 5 new fixtures (CG-045–049). engine-parity 70/70, tool-pricing 176/176. Live data
  checked rather than assumed: 25 characters/8 owners/4 campaigns exist (the app is **not** pre-launch), and
  exactly one non-campaign character is affected. See `DECISIONS.md` D-GH-2026-08-27-feature-hd-gate.
- **2026-08-30 · docs(tasks): graduate the frozen-ledger NOW task — already fixed on PR #471, board
  entry was stale** — `docs/TASK_BOARD_NOW.md` still listed "A purchase frozen at 0 while HD-blocked
  becomes free once Hit Dice rise" as open on a dedicated `fix/blocked-purchase-freezes-at-zero` branch,
  but the actual fix landed directly on PR #471 itself (`54d46f6`, extended for Arts/Boons in
  `ea1279d`): Live Sheet's `_CTX_PRICERS.hd` now charges the ladder step plus the real `compute()` delta
  of everything the level-up newly legalises, not the ladder step alone. Checked the task's own "Done
  when" against current code before graduating rather than trusting the commit message: `tool-pricing-
  ci.mjs`'s "the frozen ledger and compute() must agree across level-ups" section directly asserts
  `compute().total`/frozen-ledger agreement across a level-up that legalises a blocked purchase, covering
  the exact seam (frozen ledger + level-up pricer) the task named — found while filing an unrelated
  follow-up task and cross-checking the live board rather than the stale snapshot in a loaded system
  prompt. No migration concern: the whole HD-gate feature (gate + correct pricing) ships in one PR, so
  no live character could hold a pre-fix frozen 0-cost blocked purchase.

- **2026-08-25 · test(dm-console): stub `listCampaignInvites` to remove a real CI-only race in the
  warnings-banner check; `testing/scripts/dm-console-ui-e2e.mjs`** — `dm-console-ui` failed once in CI on
  the PR #469 promotion; local repro + one CI re-run both passed, so it was first called a flake and
  merged. Re-investigated while writing the session close-out after noticing `CHANGELOG.md` already
  recorded a directly analogous 2026-08-22 incident (PR #447) in the *same test file* that was NOT a
  flake. Traced the real cause this time: `selectCampaign()` fire-and-forgets `loadInvites()`, which
  calls the real, unstubbed `listCampaignInvites()` against live Supabase and unconditionally calls
  `renderCampWarnings()` on both its success and error path — a slow real network round-trip landing
  after the test's own synthetic `seedInvites()` calls silently clobbers the assertion's data. Fixed by
  stubbing the call for that one check block instead of guessing a longer timeout. 96/96 on 3 consecutive
  runs. Test-only — no `tools/`/`js/`/`sql/` change, so `main` carried no live defect from this. See
  `DECISIONS.md` D-GH-2026-08-25-dm-console-warnings-race-flake.

- **2026-08-25 · fix(auth): password reset was broken end-to-end — wrong redirect target plus no page
  to handle it; `js/auth.js`, `login.html`** — `forgotPassword()` redirected to the app homepage, which
  has no recovery handling, so the recovery session Supabase establishes was silently discarded; even a
  correct redirect would have landed nowhere, since `updatePassword()` existed but nothing called it.
  Added a `RESET_REDIRECT` constant pointing at `login.html` (separate from `REDIRECT_BASE`, which
  `signUp()` still correctly uses) and a new recovery view there: a synchronous pre-import script detects
  `type=recovery`/`error=` in the URL fragment before the Supabase client's own async hash-clearing can
  race it (mechanics verified against the vendored client source, not assumed), a "verifying…" state
  waits for the real `PASSWORD_RECOVERY` event, and an expired/invalid-token state offers a resend. The
  existing signed-in bounce-to-index check now runs only when neither branch applies — it would otherwise
  fire on a genuine recovery visit too, since the recovery redirect itself establishes a session.
  **Needs a manual Supabase dashboard step** (add `https://chompy78.github.io/PACT/login.html` to Auth →
  URL Configuration → Redirect URLs) that this session's tools cannot perform — flagged, not silently
  assumed done. `engine-parity-ci.mjs` 65/0, `tool-pricing-ci.mjs` 176/0 (both null controls; no `js/`
  rules code touched). See `DECISIONS.md` D-GH-2026-08-25-password-reset-flow.

- **2026-08-24 · fix(db): archived campaigns are now write-locked server-side, not just in the DM
  Console UI; `sql/migrations/2026-08-22-archived-campaign-write-lockdown.sql`** — `award_ap`,
  `award_gold`, `declare_downtime`, `dm_edit_character_log`, `dm_unbind_character` now reject a write
  against an archived campaign (new `assert_campaign_active()` check, right after each function's
  existing DM-authority check), and the `campaigns_update`/`characters_delete` RLS policies gained the
  same check via a new `is_campaign_dm_and_active()` predicate. `characters_delete`'s missing archive
  check — any campaign DM could otherwise hard-delete a bound character with no check at all — was found
  during this work's own broader write-surface audit, not in the original task-board finding. Cold-reviewed
  by 5 independent reviewers before implementation (production RLS/RPC change). Verified with a full
  fixture-based role/state matrix directly against production (no local Supabase stack available in this
  environment): all seven paths confirmed to reject while archived and restore after
  `unarchive_campaign()`; negative-authority-ordering, positive-still-readable, and cross-campaign-
  isolation controls all held. `engine-parity-ci.mjs` 65/0 (null control — no `js/` file touched).
  Supabase advisor: no new finding class. See `DECISIONS.md`
  D-GH-2026-08-22-archived-campaign-rpc-enforcement.

- **2026-08-24 · fix(tools): the new missing-DATA-reference warnings now classify as advisory, not a hard
  issue; +6 fixtures** — `/code-review ultra` post-merge audit of `feat/warn-missing-data-refs` found
  CharGen's `isAdvisory()` and Live Sheet's `_lsIsAdvisory()` were never updated for the new "is no longer
  in the rules data" notice, so it rendered as an urgent ⚠ issue with a dead "jump to control" click
  target and inflated the top-level issue count — contradicting the message's own "no cost/effect
  applied" wording. Fixed both classifiers. Also added fixtures CG-039–CG-044, closing a coverage gap
  where only 2 of the 8 new warning sites (boons, racialSpells) had regression tests. Two more findings
  from the same review (latent label-derivation edge cases in subAbilities/subSpellBundles, a `SOFT_WARN`
  gap) verified not currently reachable with live DATA or through any UI path — deferred, recorded in
  full in the decision record rather than fixed reflexively. `D-GH-2026-08-24-missing-data-ref-warning-classification`.

- **2026-08-24 · feat(engine): warn when `compute()` encounters a rules-table reference no longer in
  DATA** — 8 sites (racial traits, boons, drawbacks, arts, features, subAbilities, subSpellBundles,
  racialSpells/lineage) silently zero-priced a saved reference retired from the rules with no warning.
  Additive only — existing skip/zero-fallback pricing unchanged at every site, confirmed by 0 output
  drift across all 57 pre-existing fixtures. `subSpellBundles` needed real care: its lookup is
  overloaded (a falsy bundle means either "class/subclass genuinely missing" or "this subclass
  legitimately sells no bundle" — only the former warns). The 8th site (`racialSpells`) and a stored-XSS
  regression in both CharGen's and Live Sheet's warning renderers (the new warnings are the first case
  where the label itself is attacker-controlled free text, not a curated `DATA` key) were both caught by
  `/code-review ultra` after the initial 7-site change — fixed with `esc(w)` at both render sites,
  matching DM Console's existing correct pattern. New fixtures CG-037, CG-038; 2 new XSS regression
  checks in `tool-pricing-ci.mjs`. `D-GH-2026-08-24-warn-missing-data-refs`.
- **2026-08-24 · docs: graduated 3 merged PRs' task-board entries that were left un-graduated at merge
  time** — `ci/engine-data-path-filters` (#458), `ci/cache-chromium` (#459), and
  `test/guide-drawback-price-check` (#460) each shipped without their `CHANGELOG.md`/task-board-graduation
  step, a violation of `AGENTS.md`'s own per-change checklist step 5/7 caught while writing this session's
  sweep-log entry. Backfilled below with entries stamped at their actual merge dates; task-board sections
  removed. No code changed in this commit.

- **2026-08-24 · ci(engine-data): add `js/engine-data.js` to 6 workflows' path filters** — `engine-parity.yml`,
  `tool-pricing.yml`, `static-audit.yml`, `chargen-flows.yml`, `dm-console-ui.yml`, `character-gen-e2e.yml`
  already watched `js/engine.js` but not its `DATA` split-out (REV-14a), so a PR touching only
  `engine-data.js` silently skipped all six — observed for real on PR #441 (only 2 of 9 workflows ran).
  `cloud-e2e.yml` deliberately left unchanged (never watched `js/engine.js` by design). PR #458.

- **2026-08-24 · ci: cache Chromium in the 7 browser-driven CI jobs + a step-level install timeout** —
  `character-gen-e2e`, `chargen-flows`, `cloud-e2e`, `dm-console-ui`, `guide-theme`, `sw-cache-e2e`,
  `tool-pricing` ran `npx playwright install --with-deps chromium` uncached; observed 4 real install
  stalls across PRs #429/#430 the same night, each misreading as a test failure once the job's own
  timeout killed it mid-install. Added `actions/cache` keyed on runner OS + Playwright lockfile hash, plus
  a 5-minute step-level timeout on the install step itself so a stall now fails naming the install step
  instead of silently skipping every test. PR #459.

- **2026-08-24 · test(guide): drawback AP-gained prices now verified against `DATA.drawbacks`** —
  `guide-price-check.mjs` had zero drawback-price coverage, the same class of gap that produced the
  six-day Grit ladder divergence (`D-GH-2026-08-12-grit-steep-ladder`). Extended `verify-guide.mjs`'s
  existing drawback-text check to also compare the guide's "AP gained" column against `DATA.drawbacks`;
  confirmed live by deliberately mispricing one drawback on a scratch copy and watching the check catch
  it by name. All 84 AP values (90 drawbacks minus 6 sharing the Affliction row) match. PR #460.

- **2026-08-24 · fix(livesheet): drawback purchases now go through `legalCheck()`; fix(chargen): a
  rejected random drawback no longer leaks a draw attempt** — `takeDrawback()` bypassed all rules
  enforcement in the Live Sheet (a Fighter could tick Mana Leak, a broken stat cap went unenforced).
  Routed through `buy()`, which required a new `_CTX_PRICERS.drawback` entry — the default whole-build-
  delta pricer returns 0 for drawbacks, which are modeled as income since v0.354, not negative spend.
  CharGen's random builder's `_draws` counter is now only spent when `tryAct(actDraw)` actually succeeds.
  3 new browser-driven checks in `tool-pricing-ci.mjs` (both gates, plus a regression guard) — 171/0,
  confirmed to fail red against the pre-fix code before confirming green against the fix.
  `D-GH-2026-08-24-livesheet-drawback-legalcheck`.

- **2026-08-24 · docs: purged the "pace curve" mislabel from 5 historical records** — annotated (never
  rewrote) `DECISIONS.md`, `D-GH49.md`, `D-GH-2026-07-14-advancement-tracks.md`,
  `D-GH-2026-08-02-creation-lock-switch.md`, and the 2026-07-14 session log with dated correction notes
  pointing at `D-GH-2026-08-03-ap-budget-curve-standard`, per its own follow-up list. Original wording
  preserved verbatim in every record. `docs/PACT-Players-Guide.html` deliberately untouched (out of this
  task's scope). engine-parity 57/0, unaffected.

- **2026-08-22 · feat(dm-console): "Current co-DMs" list with a Remove action** — the console let a DM
  withdraw an *unredeemed* co-DM invite, but once someone actually redeemed one and joined the campaign,
  there was no way to see who currently had DM access or undo a mistaken/compromised grant. Wires the
  already-existing, already-owner-gated `getCampaignDms()`/`removeDm()` (`js/campaign.js`) — a
  `SECURITY DEFINER` RPC that independently re-checks ownership server-side — into a new owner-only
  panel tile, same gating pattern as "Archive campaign". Remove asks for confirmation naming the co-DM
  and the consequence. **`/code-review` catch:** `getCampaignDms()` returns every `campaign_dms` row,
  and the `add_owner_as_dm` trigger auto-inserts the owner into that same table on campaign creation —
  without a filter, the owner showed up in their own "co-DMs" list with a Remove button that would hit
  `remove_dm()`'s own "the owner cannot be removed" guard and dead-end in a raw error, directly
  contradicting the tile's own copy. `loadCoDms()` now filters by `dm_id` before rendering. 5 new
  `tool-pricing-ci.mjs` checks (rendering/escaping on synthetic data, the confirm+RPC-call wiring,
  decline-leaves-it-alone, the owner-filter) — 168/0. `D-GH-2026-08-22-dm-console-codm-revoke-ui`.

> **Format note (2026-07-28):** entries older than 2026-07-17 were rotated out to `docs/CHANGELOG-archive-2026-06-29-to-2026-07-16.md` — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`.

- **2026-08-22 · fix(engine): four pricing edge cases from the 2026-08-22 audit — `DATA.version` v0.358 →
  v0.359** — Attunement/Ki/Sorcery points went FREE (or refunded AP) once bought past their price
  tables' last entry (13/25/21 rungs respectively, none Hit-Dice-gated) — live-reachable purely by
  clicking Live Sheet's existing buy buttons repeatedly, no LOG tampering needed, since none of the
  three are in Live Sheet's `_CTX_PRICERS` list so their marginal cost is a whole-build `compute()`
  delta that goes negative at the boundary. Ability scores above 20 similarly fell through `|| 0`,
  pricing a purchased STR 25 identically to STR 10 while giving a strictly better modifier — not
  reachable through any shipped tool's UI, but `compute()` is the single source of truth every caller
  (a hand-edited save, DM Console's edit path) trusts. A duplicate `unlockclass` LOG event
  double-charged 8 AP for a class already unlocked, since `unlockedClasses` wasn't among the nine
  proficiency lists `_dedupeProfLists()` already covers — extended to a tenth; `arts`/`boons`/
  `subAbilities` deliberately left alone pending an owner decision on whether duplicates there should
  even be legal (not filed as a task — see the decision record). `activeEvents()`'s buyoff/dmRemoveBoon
  FIFO matching also gained a null-guard so two malformed events (missing `payload.v`/`refVal`) can no
  longer cross-match on the same `undefined` key — defensive only, no output change for any valid LOG.
  All four clamp to their table/ladder's existing pattern (`unlockCum`'s own comment: "a clamp
  under-charges at worst; `|| 0` paid the player"). 5 new parity fixtures (CG-033–036, EV-020);
  `engine-parity-ci.mjs` 57/0, `tool-pricing-ci.mjs` 163/0, `log-fuzz.mjs` 500/500 iterations clean.
  Not a Players Guide change — the intended rules (uncapped-by-design ladders, a 20-cap on scores, one
  unlock per class) don't change, only the engine's enforcement of them. **`/code-review ultra` catch:**
  CharGen's per-ability "N AP" display label (`annotate()`) read the same table with the same unclamped
  lookup for a cosmetic purpose — fixed to match `compute()`'s clamp so an out-of-range imported score
  can't show a stale "0 AP" label next to the (correctly-priced) real total. Full record:
  `D-GH-2026-08-22-engine-pricing-edge-cases`.
- **2026-08-22 · fix(tools): 10 mechanical playability/usability fixes from the 2026-08-22 audit** —
  batched low-risk sweep across all three tools, each independently confirmed and covered by
  `engine-parity-ci.mjs` (52/0) and `tool-pricing-ci.mjs` (163/0, two fixtures updated to build a real
  over/under-budget LOG instead of stubbing `compute()`, since the budget-gate fix below changes exactly
  what `_lsOverApBudget()` reads). **Live Sheet:** the cloud-save budget gate (`_lsOverApBudget()` and
  the manual "Save to cloud" handler) now reads the frozen ledger via `apAvailable(null)` instead of
  re-pricing against today's `DATA` — a post-freeze price-table change could otherwise trip the gate for
  a character who was never over budget, or silently bypass it in the other direction; `importJSON()`
  now confirms before replacing the current character, matching `resetAll()`'s existing pattern; Current
  HP/Temp HP/Hit Dice left now show a "this device only" hint, since they're still plain-localStorage
  scratch that doesn't survive a device switch (shallow fix — the deeper LOG-backed migration is a
  separate owner decision, not filed as a task pending that call). **DM Console:** an AP/gold-only award
  now triggers a full roster reload instead of a stale local patch, so the card's headline "AP left"/
  Level numbers are never stale; declaring a party-wide downtime window now confirms first (it silently
  wiped unspent time campaign-wide with one click); removed the dead `viewAt` time-travel variable (no
  scrub UI ever consumed it); the local-roster remove button's touch target grew from 28×28 to 40×40 to
  match the file's other controls. **CharGen:** the AP ledger's itemization rows now use `_csEsc()`
  instead of a partial `&lt;`-only replace; the AP budget field clamps to `Math.max(0, …)`, closing a
  path where a stray leading minus (easy on a mobile numeric keypad) minted a genuine negative award
  event; the character-name field gained a 60-char `maxlength`. **`/code-review` catch on this same PR:**
  CharGen's `_cgOverApBudget()` had the identical re-pricing bug the Live Sheet fix above closes —
  fixed the same way (frozen ledger via `economy(LOG).spent` against `compute().spendable`), plus the
  budget field's own displayed value now corrects itself after the negative-clamp fix above (it used to
  keep showing e.g. "-79" indefinitely while the real recorded award silently became 0). Two more
  `tool-pricing-ci.mjs` fixtures updated to match, and both needed an explicit DM-AP-context reset
  (`window._dmApStatus`/`_dmAp`/`_ignorePlayerAp`/`_cgCopySourceAp`) the original compute()-stubbed
  tests never needed, since a real LOG-based test is now exposed to whatever DM-context globals an
  earlier check in the same page session left set. Full record:
  `D-GH-2026-08-22-audit-batch-mechanical-fixes`.
- **2026-08-22 · fix(security): closed five stored-XSS/attribute-injection gaps in CharGen and Live
  Sheet** — a full tool audit found `renderCharSheet()`'s language/mastery/drawback fields,
  `validate()`'s rules-drift warning text, and the drawback buy-off button's `onclick` all rendered a
  player-controlled value into `innerHTML`/an HTML attribute without `esc()`/`_csEsc()`, three reachable
  through ordinary UI use (naming a language, importing a JSON save, buying off a drawback) and
  cross-user via cloud sync, share links, and DM Console's roster/`?viewChar=` view. Fixed all sites
  (plus the byte-identical `renderCharSheet()` duplicate in Live Sheet and one same-shape mirror found
  while fixing) by escaping consistently with every sibling field, and closed the buy-off button's
  attribute-injection vector by moving its value into an escaped `data-v` attribute instead of an
  inline string. Verified against the actual fixed code with the audit's exact payloads (new
  `testing/scripts/esc-gap-verify.mjs`, 9/0), plus `engine-parity-ci.mjs` 52/0 and `tool-pricing-ci.mjs`
  163/0 confirming no regression. `D-GH-2026-08-22-esc-gap-chargen-livesheet`.
- **2026-08-22 · fix(dm-console): a stale campaign-switch response could clobber the newly-selected
  campaign's invites/warnings and party-downtime data** — found while investigating a CI failure on
  the `preview`→`main` promotion PR: `dm-console-ui-e2e.mjs`'s invite-warnings-banner tests failed
  twice in CI (reproducing identically) while passing 96/96 locally on the same commit — traced to a
  genuine race, not a flake. `loadInvites()`/`loadRoster()`/`_refreshDowntimeWindows()` are triggered
  fire-and-forget by the focus/visibilitychange auto-refresh listeners, with no guard against their
  result landing after the DM has switched (or deselected) campaigns; a slow response for the OLD
  campaign would overwrite `_invites`, the roster, `window._dmPartyWindow` and
  `window._dmDowntimeWindows` with stale data after the NEW campaign already rendered correctly.
  Fixed with a shared `_isCurrentCamp(id)` guard re-checked after every await before any DOM/global
  write. Caught mid-fix by `/code-review`: the first draft's guard in `_refreshDowntimeWindows` came
  too late — the party-window assignment happened *inside* the awaited expression, before the check
  ever ran — corrected to resolve into a local first, then conditionally commit to the global.
  Verified against both races directly (a stale response deliberately made to land after a campaign
  switch, confirmed to leak without the fix and stay contained with it) — `dm-console-ui-e2e.mjs`
  96/96, `economy-ui-e2e.mjs` 155/155, `engine-parity-ci.mjs` 52/52, `chargen-flows-e2e.mjs` 66/66.
  `D-GH-2026-08-22-dm-console-stale-campaign-switch-race`.
- **2026-08-22 · fix(chargen): DM-copy AP snapshot could bleed into an unrelated character's budget
  (`/code-review` catch)** — two independent review passes on the AP-snapshot fix below found it left
  `window._cgCopySourceAp` (now budget-relevant) uncleared by `_cgResolveDmApStatus()`, the function
  every OTHER character load funnels through — so a DM who opened a "Copy to CharGen" sandbox, then
  loaded a second unrelated non-campaign character in the same tab, would see that second character's
  budget silently inflated by the first copy's frozen AP. Also caught: two `tool-pricing-ci.mjs`
  assertions left pinned to the old (0 AP) behavior, now failing against this branch's own diff. Fixed
  all three, plus a now-inaccurate `randomizeBuild()` comment; added a regression test for the
  staleness fix itself. `tool-pricing-ci.mjs`: 163/0 (1 unrelated pre-existing timing flake, confirmed
  by re-running against the exact same code). See the decision's "Follow-up" note.
- **2026-08-22 · fix(chargen): "Copy to CharGen" DM sandbox showed 0 DM AP and falsely read as over
  budget** — the disconnected copy `_cgConsumeViewChar()` makes (`D-GH-2026-08-10-chargen-dm-view`)
  already captured the source character's real DM AP for display (`window._cgCopySourceAp`), but the
  copy's own budget math (`_cgDmOpts()`) still fed `compute()` a hardcoded 0, since it gates on
  `_dmApStatus==='active'` (deliberately false for a disconnected copy). Now feeds the frozen snapshot
  into the budget when present, so the copy's OVER BUDGET reading matches the real character's; the
  AP-source tooltip updated to say the DM AP now counts as a frozen snapshot. Considered (and rejected)
  a live-syncing shadow-campaign alternative — see the decision's 2026-08-22 addendum. Display/budget
  only, `tools/PACT-CharGen-Webtool.html`, no `js/engine.js`/`DATA` change — parity 52/0.
- **2026-08-22 · fix(dm-console): removed character kept showing until a manual reload** — the
  unbind-character success handler patched its local `cloudRoster` copy and re-rendered only via
  `renderCloudRoster(el)`, which repaints `#campRoster`'s own card grid but not `#tableRoot` (Table
  view) or the Customisable card view. A DM viewing either of those still saw the just-removed
  character until something else forced a full `render()` (switching views, reloading). Now calls the
  shared `render()` dispatcher instead, which re-checks the active view and repaints whichever one is
  on screen. UI-only, `tools/DM-Console.html`, no `js/engine.js`/`DATA` involvement — parity 52/0.
- **2026-08-22 · data: Amble campaign — renamed "New Character" to "Archer" and reconciled its DM AP
  ledger (no code/version change)** — at the owner's request: (1) renamed the character both in
  `characters.name` and in its own event log's singleton `name` event (the LOG event is what
  CharGen/Live Sheet/DM Console actually display for a character with real build data — the DB column
  alone only covers the no-data-yet placeholder card, so both had to change); (2) replaced Archer's
  single 33 AP `ap_awards` entry with three itemized entries (Creation budget +30, Chapter 1 bonus +3,
  Chapter 3 set +17, later corrected to +16 per owner follow-up) totaling the same running `characters.ap`
  before/after each edit; (3) for the other 6 Amble characters, split each one's combined "Chapter 3 set
  + bonus" (+17 or +18) `ap_awards` entry into two — "Chapter 3 set" (+16) and "Chapter 3 bonus" (+1 or
  +2, whatever the original minus 16 was) — preserving each character's total AP and DM/timestamp
  attribution. All changes verified against `characters.ap` == `sum(ap_awards.amount)` after each step.
  Full record: `docs/sessions/2026-08-22-amble-archer-rename-and-ap-split.md`.
- **2026-08-22 · fix(dm-console): `/code-review high` before merge — unbinding a character left its
  checkbox stuck in Award AP; a name-fallback chain deduped** — `.unbind-btn` mutated `cloudRoster` and
  repainted via the internal `renderCloudRoster()`, bypassing the wrapper `renderCampAwardAp()` was
  hooked into; a removed character's tick-list checkbox lingered until the next full roster load, and
  awarding while it lingered surfaced a confusing RLS error (`award_ap()` refusing a now campaign-less
  character). Fixed by moving the `renderCampAwardAp()` call into `renderCloudRoster()` itself so no
  future caller can reintroduce the gap. Also factored the three-times-duplicated roster display-name
  fallback into `_rosterDisplayName()`. `dm-console-ui-e2e.mjs` 96/96, `economy-ui-e2e.mjs` 155/155,
  `engine-parity-ci.mjs` 52/52, `chargen-flows-e2e.mjs` 66/66. `D-GH-2026-08-22-dm-screen-generic-award-ap` (addendum).
- **🔴 2026-08-22 · fix(dm-console): "Declare for the party" has never actually fired — the click never
  reached its handler; feat(dm-console): party downtime moved next to Award AP, with a history** — moved
  the "🕐 Party downtime window" control from a bare ruleblock above the roster cards into its own
  subtile next to the new Award AP tile, per request, and added a "📒 History" view
  (`getDowntimeHistory()` in `js/dm.js` — a plain read of the already-append-only
  `campaign_downtime_declarations` table, no migration needed, same `.hist-modal` pattern as the
  per-character AP history). Doing the move surfaced a real, already-shipped bug: `#campDowntime` was a
  DOM **sibling** of `#campRoster`, but its only click handler (`.declare-btn`) was delegated on
  `#campRoster` itself — a sibling's click never bubbles through another sibling's listener. Verified
  directly: clicking "Declare for the party" has never called `declareDowntime()`, structurally, since
  this control was written — nothing ever tested the click itself, only that the button rendered. Fixed
  by pulling `.declare-btn`/`.downtime-hist-btn` into their own delegation scoped to the new
  `#campDowntimeTile` (a stable parent across re-renders). Verified end-to-end with a call-tracking stub;
  peek-lock coverage confirmed via the same re-sweep `_paintRoster()` already performs.
  `dm-console-ui-e2e.mjs` 96/96, `economy-ui-e2e.mjs` 155/155.
  `D-GH-2026-08-22-dm-screen-generic-award-ap` (addendum).
- **2026-08-22 · fix(dm-console): Campaign Rules' three locked cards wrapped into one actual "supercard";
  feat(dm-console): custom fields 1/2 shown on the default Card view** — the earlier same-day unlock-hint
  fix lived inside just one of the THREE cards the rules lock actually covers
  (`campRulesTile`/`campAdvancementTile`/`campCustomFieldsTile`), so a DM opening any card but that one
  still saw greyed-out fields unexplained. Wrapped all three, plus the "Save rules / Locked" row that
  used to float uncontained after them, in one outer `campRulesGroup` ("supercard", new
  `.subtile-group` class); moved the unlock hint to its top, outside every `<details>`, so it's visible
  on scroll with no clicks and unlocks all three cards at once (verified). Also: the campaign's two
  NUMBER custom fields ("Custom 1"/"Custom 2") now show as extra stat cells on the default Card view
  itself (alongside AP left/HP/AC/…), not only inside the collapsed DM tools section where they're
  edited — read-only there, only when the campaign actually named that slot; text1/text2 unchanged
  (DM-tools-only, they don't fit a stat-cell shape). `dm-console-ui-e2e.mjs` 96/96, `economy-ui-e2e.mjs`
  155/155. `D-GH-2026-08-22-dm-screen-generic-award-ap` (addendum).
- **2026-08-22 · fix(dm-console): Campaign Rules' lock hid the economy dropdown with no way to find the
  unlock control; Banned-list/Award-AP checkbox labels too low-contrast vs CharGen** — Campaign Rules
  locks by default on every campaign switch, but its only unlock button sits at the very bottom of a
  long panel while "Gold & downtime economy" sits in the middle — a DM sees a greyed-out dropdown with
  nothing nearby explaining why. Added `#ruleLockHint`, an always-visible clickable banner at the TOP of
  the panel that states the lock and toggles the same lock state `ruleLockBtn` already drives (excluded
  from the rules-lock's own disable-scan so it can't disable itself; still swept by the separate
  archived-peek lock, verified). Separately, `.rulegrid label` (every Banned-species/boons/masteries/
  drawbacks/arts checkbox, plus the new Award AP tick-list) switched from `color:var(--muted)` to
  CharGen's own `color:var(--ink);font-weight:700` — not a WCAG failure but a real, requested
  match-CharGen's-legibility fix. `dm-console-ui-e2e.mjs` 96/96. `D-GH-2026-08-22-dm-screen-generic-award-ap` (addendum).
- **2026-08-22 · fix(dm-console): the "📒 AP history" popup was hardcoded white, unreadable in dark
  theme** — `.hist-modal .inner` had `background:#fff` and its heading `color:var(--navy)`, neither
  theme-aware; the table's inherited (correctly theme-aware) light dark-theme text landed on that
  hardcoded white card, nearly illegible. Switched to `var(--card)` / `var(--heading)` — the same tokens
  every other card/heading in this file already uses, nothing new introduced. Verified across all five
  themes. Also clarified (no code change): the per-character award form's gold/bonus-time fields only
  appear when the campaign's Gold & downtime economy band (Campaign Rules) isn't "off" — by design, not
  a bug. `D-GH-2026-08-22-dm-screen-generic-award-ap` (addendum).
- **2026-08-22 · feat(dm-console): generic "Award AP" tick-list sub card; fix(dm-console): banned-
  drawback grid could go permanently stale mid-session; fix(tools): disabled/banned boon-drawback items
  hard to read in every theme** — new sub card under the campaign selector on DM Console's master card:
  tick any number of roster characters, set one AP amount + note, Award — each character gets its own
  independent `awardAp` call (a partial failure doesn't block the rest), same as the existing per-
  character form. Locked by the same archived-campaign peek guard as every other campaign-scoped
  control. `renderRuleGrids()` (Banned species/boons/masteries/drawbacks/arts) no longer renders its
  option list once and freezes forever — it now re-renders whenever the available option set actually
  changes, verified live by seeding a new `DATA.drawbacks` entry mid-session. (Audit found
  `js/engine-data.js` itself already had all 90 drawbacks in sync — no `DATA` change, no version bump —
  the staleness guard was the actual gap.) Disabled/banned/already-owned boon-drawback checkboxes and
  item-buttons (CharGen's `.gridck label.ck.barred`/`:disabled` rules, the Live Sheet's `.ib.dis`) go
  from 0.5–0.55 opacity to 0.7 — measured: the old values failed WCAG AA contrast (4.5:1) against every
  one of the five themes' own ink/card colors (3.08–4.68), 0.7 clears all five (5.58–6.63). DM Console
  has no equivalent disabled-checkbox styling of its own, so no change was needed there.
  `testing/scripts/dm-console-ui-e2e.mjs` 96/96, `engine-parity-ci.mjs` 52/52, `economy-ui-e2e.mjs`
  155/155, `chargen-flows-e2e.mjs` 66/66. `D-GH-2026-08-22-dm-screen-generic-award-ap`.
- **2026-08-20 · release: promote preview → main (v1.442)** — carries PR #438 (stepped-Premium pricing),
  PR #441 (unbar Rage/Wild Shape/Bardic Inspiration die), PR #440 (zcold cleanup), and the
  CI-path-filter-gap task-board entry. `BUILD` v1.439 → v1.442.
- **2026-08-20 · docs(version-sync): tag only meaningful promotions, not every one** — see
  `D-GH-2026-08-20-tag-only-meaningful-promotions`. Also found and documented a mispointed `v1.442` tag
  (pointed at the v1.439 merge commit) and confirmed the cloud-session tag-push 403 covers deletion too;
  the bad tag still needs manual removal.
- **2026-08-22 · data: deleted 3 owner-confirmed test characters from the live Amble campaign
  (no code/version change)** — `Sera Valor 3rd`, `Cedric Brightblade`, `Moss Stormspud (COPY)`, all
  already unbound from the campaign; ownership verified before deleting (2 of the 3 traced to a
  different test account than initially stated). Recoverable via `character_backups`. Also ran a
  headless AP-cost audit of the remaining 7 Amble characters against current pricing (v1.442 /
  `DATA.version` v0.358): 6 fit within their granted AP, Anders Pipeleaf is 4 AP over budget (flagged to
  owner, not yet resolved). Full record: `docs/sessions/2026-08-22-amble-dm-ap-audit-and-test-cleanup.md`.
- **2026-08-20 · rules(data): unbar Rage/Wild Shape/Bardic Inspiration die (no version bump)** — removes
  the `"bar":true` flag added 2026-08-19 (`D-GH-2026-08-19-bar-blocked-features`) to take these three
  features off the market while their flat-once Premium pricing defect was pending. That defect is now
  fixed (see the entry immediately below), so all three are selectable again in CharGen and Live Sheet.
  `bar` isn't consulted by `compute()`'s pricing, so no `DATA.version` bump. The five features barred for
  an unrelated reason (`Fighter/Paladin/Ranger/Rogue: Weapon Mastery`, `Fighter: Additional Fighting
  Style`) are untouched.
- **2026-08-20 · rules(engine): Rage/Wild Shape/Bardic Inspiration die -> stepped-Premium; hard prereq blocking; Sneak Attack/Martial Arts die/Unarmored Movement retrofitted (v0.358)** —
  implements `pact-guide`'s `D-2026-08-19-premium-autogrowth-to-stepped`: Rage, Wild Shape, and Bardic
  Inspiration die convert from flat-once Premium (grows free forever, buy once) to a Premium unlock plus
  named upgrade steps at half the ordinary tier/band price, chained by prerequisite, split into
  independent tracks (Rage: Uses/Damage; Wild Shape: Capability/Uses) that never gate each other. The
  engine's prerequisite check (previously Warlock-invocation-only, advisory-only) is now widened to any
  `f.prereq`-bearing feature **and** converted to an actual hard block — a violating purchase costs 0 AP
  and isn't owned, itemized under a new "Blocked purchases" ledger line rather than silently priced.
  Confirmed side effect: the 8 existing Warlock invocation prerequisites also go from warn-only to
  hard-blocked. Three more already-shipped Stepped features (Sneak Attack, Martial Arts die, Unarmored
  Movement) retrofitted to the identical half-price-after-unlock shape, using their real 5e level
  breakpoints (already correctly documented in the guide's own class tables, just never wired into
  `engine-data.js`). 12 new regression fixtures (`CG-021`–`CG-032`). `docs/PACT-Players-Guide.html`
  rewritten throughout on what Premium means and how the discount works; verified 0 price-mismatches
  against the live engine via `guide-price-check.mjs`. `DATA.version` **v0.357 → v0.358**. Full record:
  `D-GH-2026-08-20-premium-autogrowth-to-stepped`.
- **2026-08-20 · chore(version): `BUILD` → `v1.436` for PR #436 (`preview` → `main` promotion)** —
  ninth promotion under the PR-linked scheme. Major `1` carried forward; `DATA.version` deliberately
  untouched at `v0.357`. Carries the gold-and-downtime economy (PRs #433–#435) plus everything already
  on `preview` since PR #432 (21 new drawbacks/reprices/caster gate, drawback stat-cap enforcement, the
  `.bar`-blocked-features generalization). All 11 CI checks green before merge; regular merge commit
  (never squash) per `docs/VERSION-SYNC.md`.

- **2026-08-20 · fix: buyoffs weren't frozen, and the DM Console showed gross downtime instead of net
  — both caught by `/code-review ultra` before merging the coin-and-time-costs branch** —
  `buyoffDrawback()` (Live Sheet) never quoted, wallet-checked, or froze `gp`/`days` onto its emitted
  event, even though `wealthLedger()` charges buyoffs as real in-play purchases; `_paidFor()`'s
  live-list-price fallback meant a buyoff's cost silently moved under a later Standard→Fast band
  change — the exact hazard the freeze mechanism exists to prevent. Fixed by giving it the same
  quote/trade/shortfall/freeze treatment `buy()` already has. Separately, the DM Console's "Downtime
  available" line showed the window's raw declared total (base + bonus), never netted against the
  character's own spend, despite its own tooltip promising the netted figure — a DM could read "48
  days" for a character who had actually spent 42 of them. Fixed by threading the character's LOG
  through to `awardBody()` and computing `wealthWithDm()`'s `daysLeft` there, same composition the
  player-side wallet line already used. Gate → **155 checks** (from 151); both fixes verified to go
  red independently when reverted (4 failures, isolated to the checks naming them). See the Addendum
  in `D-GH-2026-08-19-tool-coin-time-costs`.
- **2026-08-19 · fix: downtime is a party-wide window, not a per-character bank — corrected same day,
  before any real balance existed** — walking through the gold-and-downtime economy below at the
  table surfaced that it had modelled gold and downtime as twins (both DM-granted, per-character,
  accumulating), which is wrong for downtime: it is a single window the DM declares for the **whole
  party at once**, and a new declaration **replaces** the old one rather than adding to it (owner:
  "spend it now or wait till another opportunity"). Left as originally built, switching the economy on
  would have marked every character permanently overdrawn and made the DM re-type the same figure
  once per player, every session, forever. `characters.downtime_days` dropped (fully computed now,
  never stored); `wealth_awards`→**`gold_awards`** (gold-only) and `award_wealth()`→**`award_gold()`**;
  new `campaign_downtime_declarations` ledger (nullable `character_id`: null = party base, set = a
  per-character bonus that resets along with the base) plus **`declare_downtime()`**/
  **`get_downtime_window()`** RPCs. `js/engine.js`: `wealthLedger()`'s `wealth`-event handling now
  sums `gp` but treats `days` as last-one-wins (the same event type, two different aggregation
  rules, on purpose); new `resolveDowntimeWindow()` mirrors `resolveEconomySetting()`'s campaign-vs-
  solo precedence exactly; `wealthWithDm()` rewritten so `daysLeft` is the window's size minus only
  the spend since it was declared, never an all-time total. DM Console: gold and an optional
  per-character **bonus time** field join the existing Award AP form ("same area as AP awards");
  downtime's party-wide base gets its own, separate declare control above the roster. Live Sheet
  gained the solo self-service control (**🎒 Record gold & downtime**) the original build never
  built despite reading a permanently-empty event type for it. Also found and fixed a real,
  unrelated bug on the way: the DM Console's campaign-rules cache never carried the economy band at
  all, so the original grant form could never have shown in any campaign. Gate → **151 checks**
  (from 120), verified to go red on both the reset-vs-accumulate rule and the no-window-overdraft
  rule. Follow-up migration `2026-08-19-downtime-window-revision.sql`, not an edit to the applied
  one — safe as a straight `ALTER`/`DROP`, since every character was still at 0/0. **Applied to the
  live Supabase project** the same day; `get_advisors` run straight after, no new issue classes. See
  the Addendum in `D-GH-2026-08-19-tool-coin-time-costs`.
- **2026-08-19 · feat: the gold-and-downtime economy, built into all three tools** — PACT's other two
  currencies (Players Guide §2/§16) had no implementation at all; only starting wealth existed. Both band
  tables now live in `js/economy-bands.js` and are surfaced on `DATA`, with the three settings the guide
  names — **Off / Standard / Fast**. Every priced row in all three tools shows its gold and downtime; the
  Live Sheet gains a wallet line, a purchase-time shortfall warning, the ledger's per-purchase figures and
  §16's coin-for-time trade; the DM Console gains the campaign-wide dial and a per-character grant form.
  **Creation stays free of both** (§2), enforced by reusing the engine's own creation lock rather than a
  second definition of "in play". **Soft warnings only, never a block** — §17 lets a DM waive any cost.
  DM-authoritative in a campaign, mirroring `characters.ap`: new `characters.gold`/`downtime_days`,
  `wealth_awards` ledger and `award_wealth()` RPC; a solo character's grants ride its own LOG. Costs
  freeze onto their own event so a mid-campaign band switch can't re-price history. New gate
  `testing/scripts/economy-ui-e2e.mjs` (**120 checks**, verified to go red); full suite green. No
  `DATA.version` bump — `compute()` is untouched. Also fixed a PWA caching bug the repo's audit caught:
  `economy-bands.js` joins `NETWORK_FIRST_RE`, `CACHE_NAME` → `pact-v9`. See
  `D-GH-2026-08-19-tool-coin-time-costs`.
- **2026-08-19 · rules(engine): 21 new drawbacks, three reprices, and a caster gate (v0.357)** — adds a
  phobia family (`Claustrophobic`, `Agoraphobic`, `Fear of Being Alone`, `Fear of the Dark`,
  `Fear of the Dead`, `Crawling Things`, `No Head for Heights`, `Gun Shy`) plus body/nerve and social
  entries, taking `DATA.drawbacks` **69 → 90**. Reprices `Sluggish` 2→1, `Mana-Sick` 3→2 and
  `Haunted / Phobia` 3→2 — **no live character held any of the three** (checked against the database), so
  nobody's earned AP moved. `Claustrophobic`/`Agoraphobic` are a deliberately mirrored pair with one clause
  and no extra rolls, replacing drafts whose "inside buildings" trigger was near-permanent and whose DC 12
  save fired at every dungeon doorway. New **`DATA.drawbackReq`** gate (`Mana Leak`, `Ritual-Blind`,
  `Wild Surge`) emits the ⛔ HARD marker when a caster-only drawback is taken by a character with no
  spellcasting discipline — priced for a caster it was free AP for a Fighter, and one number cannot serve
  both. Four proposals dropped: `Familiar Face` and `Fear of Water` were dominated by `Bad With Animals`
  and `Can't Swim` (which absorbed the deep-water save), `Compulsive Collector` and `Sleepwalker` had no
  mechanical teeth. `Light Sleeper` was dropped too — the name is already a 2 AP **boon**. Guide updated in
  both copies. **`/code-review max` before opening the PR found the gate wasn't actually enforced anywhere
  a player would hit it** — a placeholder `{name:'(none)'}` discipline (which is exactly what CharGen
  creates by default) defeated it entirely, `Ritual-Blind`/`Wild Surge` carried the same printed
  requirement but were left open, CharGen's UI let a non-caster tick the checkbox freely, and a comment
  claiming the ⛔ warning "blocks the cloud save" was false — nothing reads `.warnings` at save time. All
  fixed except the false comment's underlying gap (the Live Sheet's `takeDrawback()` bypasses
  `legalCheck()` entirely — pre-existing, affects the stat caps too, deferred to its own task).
  `verify-guide.mjs` gained a reverse check and stopped silently skipping unmatched rows (both confirmed to
  fail-then-pass by deliberately breaking each condition). `tool-pricing` 158 → **162**; parity 40/0;
  verify-guide 10/10; log-fuzz 500/500. Full record: `D-GH-2026-08-19-drawbacks-phobias-expansion`.
- **2026-08-19 · chore(version): `BUILD` → `v1.432` for PR #432 (`preview` → `main` promotion)** —
  eighth promotion under the PR-linked scheme. Major `1` carried forward; `DATA.version`
  deliberately untouched at `v0.356`. Docs-only promotion — synced across all five mirrors.

- **2026-08-19 · chore(version): `BUILD` → `v1.430` for PR #430 (`preview` → `main` promotion)** —
  seventh promotion under the PR-linked scheme. Major `1` carried forward; `DATA.version`
  deliberately untouched at `v0.356`. Synced across all five mirrors.

- **2026-08-19 · fix(rules): three broken features can no longer be newly bought — `Barbarian: Rage`,
  `Druid: Wild Shape`, `Bard: Bardic Inspiration die`** — owner reported real defects in each and needs
  them off the market while fixed. Generalizes v0.314's one-off `BARRED_FEATURES` array (which only ever
  covered `Fighter/Paladin/Ranger/Rogue: Weapon Mastery` and `Fighter: Additional Fighting Style`, and
  only in CharGen) into a single `DATA.features[lab].bar===true` flag, then applies it everywhere a
  feature can be newly purchased — a gap audit found three live paths, not one:
  - **CharGen**: the class-picker grid (`buildClassPickers()`, now derives the barred set from the flag
    instead of a second hardcoded list); the 🎲 Randomize action pool (`Object.keys(DATA.features).filter`
    at its origin-class-feature action, which had never excluded even the original five); and the
    free-typed "+ search all" box's reconciliation validator (`_CG_RECONCILE_VALID.feature`), which had
    accepted any real `DATA.features` key including barred ones — closing it only gates `emit()` for a
    NEW purchase, never re-validates an already-owned LOG row, so no existing save is touched.
  - **Live Sheet**: all three of its own buy-list builders (origin-class, cross-class, and the
    all-classes browse list) had never excluded the original five either — this repo's v0.314 bar had
    only ever reached CharGen. Now consistent across both tools.
  - **DM Console**: no feature-purchase path exists there; nothing to change.
  A barred feature stays in `DATA.features` and still prices normally via `compute()`'s lookup for anyone
  who already owns one — confirmed no live character owns any of the three (checked the `characters`
  table directly). Display-only: `compute()` output is unchanged for every existing build, so
  `DATA.version` stays at `v0.356`; no `testing/expected/` update needed. `testing/tests/engine-parity.html`
  40/0, `tool-pricing-ci` 158/0, `chargen-flows-e2e` 66/66, `log-fuzz` 500/500 all still pass.

- **2026-08-19 · chore(version): `BUILD` → `v1.429` for PR #429 (`preview` → `main` promotion)** — sixth
  promotion under the PR-linked scheme (`D-GH-2026-08-02-build-version-pr-linked`). Major `1` carried
  forward; `DATA.version` deliberately untouched at `v0.356` — this promotion changes no mechanics.
  Synced across all five mirrors: `js/engine.js` `BUILD`, CharGen's line-1 comment / `<title>` / header
  `.sub`, Live Sheet's line-1 comment, DM Console's `TOOL_VERSION`. `index.html` reads `BUILD` live and
  was not touched.

- **2026-08-19 · docs(guide): the on-page version block is copied back to the `pact-guide` master** —
  the served copy had carried `#guideVer`, its script and the `.guide-ver` CSS alone since it was added
  earlier today, which is exactly the divergence the next transfer from the master silently wipes. Both
  pieces are now in the master too (CSS above its `@media print` block; markup after `#navSearch`, before
  `<ul id='navList'>`, mirroring the served copy's order minus the served-only theme picker). Verified
  the other two of today's guide changes had already landed there — the `Soul Debt` rewording and all 23
  stat-cap descriptions were already in the master's prose, so only the version block was outstanding.
  `docs/VERSION-SYNC.md`'s ⛔ box now records the block as present in BOTH copies, so a future transfer
  carries it rather than treating it as served-only.

- **2026-08-19 · fix(guide): the version block had overwritten the print rule** — found while preparing
  the copy-back to `pact-guide`. `9f5e11f` added `.guide-ver`'s styling by *replacing the body of*
  `@media print{...}`, so printing the guide stopped hiding the nav sidebar, toggle, to-top button and
  progress bar, and the version block itself was scoped to print and therefore unstyled on screen. Both
  halves were wrong and neither was visible from the change itself. The print rule is restored
  byte-identical to its pre-`9f5e11f` text and the `.guide-ver` rules moved to screen scope (the block is
  a child of `#nav`, so print still hides it). `verify-guide.mjs` gains an 11th check, `print rule
  intact`, asserting both facts; confirmed FAIL against the unfixed file before being accepted. Display
  only — no rules change, no `DATA.version` bump.

- **2026-08-19 · test(livesheet): pin that a pre-lock ledger equals `compute()` across level-ups; the
  reported divergence is gone** — `fix/livesheet-draft-reconcile` was filed as a live bug needing an owner
  *rules ruling before any code*: a fresh Live Sheet character reading **34 against `compute()`'s 46**
  after one level-up and **44 against 83** by HD 5. **Re-measured on v0.356 through the real tool: drift
  is 0 at every step, in both purchase orders.** The Live Sheet still does not call `repriceDraft()`
  (checked), so the two rules stopped producing different numbers rather than one of them winning — which
  branch closed it is untraced. `tool-pricing-ci` now drives a pre-lock character through level-ups both
  ways and asserts `economy().spent === compute().total` (141 → **143**), so the agreement is asserted
  rather than assumed. The board task is narrowed to what actually remains — a decision-record edit
  saying which of D1/D2 governs — and downgraded from Risk **high** to **low**.

- **2026-08-19 · docs(tasks): record the duplicate non-stacking purchase overcharge** — found 2026-08-18
  while building `sim-combat-abuse.mjs` and, until now, **written down nowhere but that simulation's
  source**. A character buying the same non-stacking feature from two classes (Extra Attack being the
  clearest) is charged in full twice for one benefit; the sim carries a `NON_STACKING` group list purely
  to stop the optimiser gaming it, which is a simulation-side workaround for an engine-side gap. Not
  urgent — unreachable below tier 4, and it overcharges rather than undercharges — but it is a real
  overcharge on a legal build, and the rule needs defining before it can be priced.

- **2026-08-19 · docs(rules): the `Soul Debt` Long Rest exemption was removed deliberately — confirmed** —
  the v0.356 rewording dropped *"The Hit Points you recover at the end of a Long Rest are unaffected."*
  That was flagged at the time as possibly unintended, because the new text enumerates three sources after
  a colon and does not mention rests. **Owner confirmed the wording as written**, so a Long Rest is no
  longer carved out. Recorded here because a lone deleted sentence is precisely what a later reader
  restores as an accident; it was not one. Verified nothing else still carries the old exemption, and that
  the guide's other two `Soul Debt` passages (buy-off permanence in §14, and the narrative example) do not
  assume it. No text change — this entry exists solely so the deletion cannot be undone by mistake.

- **2026-08-19 · feat(rules): drawback stat caps are ENFORCED, in both directions, and documented
  everywhere** — owner's ruling. The cap text says two things — *"you may only take a capped drawback if
  your current score is at or below the cap"* and *"your score can never exceed 12"* — and both are now
  enforced. Measured before changing anything: the **Live Sheet already blocked both** (`⛔ Purchase
  blocked`), while **CharGen blocked neither**, which is why the guide had come to claim *"the tool only
  warns, it does not block"*. That claim was never true as a blanket statement. CharGen now disables a
  capped drawback whose cap the current score breaks, and clamps a score that would breach a cap it
  already holds (clamped to the cap — the highest legal value — with a `flash()` saying why; silently
  un-ticking a held drawback would delete a purchase and refund AP behind the player's back). The engine's
  warning gains the **⛔** marker the other hard prerequisites use.
  **Then the enforcement exposed what it was enforcing:** **seven** capped drawbacks had descriptions that
  never mentioned their cap — an invisible wall the moment blocking landed — and **five** more had the cap
  in the guide but not in the tools. All twelve now state it, in the house wording already used by the
  other sixteen, on **both** sides. Guide and `DATA.drawbackFx` now agree on **all 63** rows with a guide
  row, and **all 23 stat caps are documented**. `verify-guide` gains a **drawback text** check (9 → **10**)
  — added only once both sides agreed, since a gate that is red on arrival is not a gate. It decodes HTML
  entities and compares whole cells, the two mistakes that made my first pass report ten mismatches when
  three were real. Verified in both tools: take-above-cap refused, raise-above-cap refused/clamped, and
  raising to exactly the cap still allowed. No live character violates any cap (checked all 23 against
  every character). No `DATA.version` bump — `drawbackFx` is display-only and `compute()`'s numeric output
  is unchanged; only a warning string gained a marker.

- **2026-08-19 · docs(rules): reword the `Soul Debt` drawback, engine and guide together** — owner's text:
  *"A fiend skims the interest on your soul. Each time you regain Hit Points: every spell cast, every dose
  of a magic item, and every Hit Die spent regains 1d4 fewer Hit Points (minimum 1) — the rest feeds the
  debt."* Applied to `DATA.drawbackFx` **and** `docs/PACT-Players-Guide.html` in the same change. No
  `DATA.version` bump — `drawbackFx` is display-only and never read by `compute()`. **⚠ The new wording
  drops the old sentence "The Hit Points you recover at the end of a Long Rest are unaffected"**, which is
  a real table-facing change; flagged for confirmation rather than silently restored.
  **Found while doing it:** comparing *every* drawback rather than just the edited one turned up apparent
  drift in 10. **Seven were a bug in my comparison, not drift** — it tested `html.includes(engineText)`
  against raw HTML, so any description containing an apostrophe failed on `&#x27;` vs `'` while being
  identical. **Three are real**, and they are one pattern: `Missing Arm`, `Peg Leg` and `Berserk Temper`
  each have `drawbackFx` stating a stat cap as a hard entry requirement while the guide's table cell says
  the tool only warns and DMs must enforce it. Measured: a DEX 16 character with `Missing Arm` gets a
  warning and keeps DEX 16 — so the guide describes the tool correctly and `drawbackFx` describes the rule
  correctly, and §14's own prose sides with `drawbackFx`, contradicting the table two paragraphs away.
  Recorded as a task with a recommendation; **no gate added, deliberately** — it would be red on arrival,
  and gates here sit at 0 failed.

- **2026-08-19 · fix(ci): raise `tool-pricing-ci`'s readiness poll from 10s to 30s** — the gate now opens
  ~10 tabs across three tools, and CharGen alone is 376 KB plus a deferred module bridge; at 10s it failed
  roughly **one run in five** with `CharGen never became ready`, intermittently and only under that load.
  A readiness poll returns the instant its probe passes, so the higher ceiling costs nothing on a fast page
  and only decides how much contention it survives. Same budget and same fix as the CDP connect loop
  earlier today — the two were written 10s apart out of habit rather than reason. Six consecutive clean
  runs after the change, against one failure in five before it.

- **2026-08-19 · chore(version): `BUILD` → `v1.427` for PR #427 (`preview` → `main` promotion)** — fifth
  promotion in this run, and the first where **every item came from real use** rather than a gate: the
  AP-drain data-loss fix, heritage-pack visibility across all three tools, the DM Console's missing
  subclass abilities, four disagreeing version labels, DM-AP visibility, and the guide's on-page version
  block. `DATA.version` unchanged at **v0.356** — nothing here alters pricing. `tool-pricing-ci` 134 →
  **158** over the same span. Bumped before CI started.

- **2026-08-19 · fix(tools): DM-granted AP is visible in both player tools** — reported: *"i cannot see
  how many DM AP's there are in the chargen or livesheet"*. Both tools **did** have a display; two states
  rendered nothing useful. (1) The Live Sheet's chip was `_dmAp ? … : ''`, so a campaign character with
  **0 DM AP showed no DM component at all** — indistinguishable from the feature not existing. It now
  shows `0 from DM` whenever the character is campaign-bound, and still stays quiet for a purely local
  character, where it would be noise. (2) A CharGen **DM copy** is deliberately unbound
  (`_cgResetCloudApState()`), so since the grant became a campaign character's entire budget it opened
  reading `🔒 0 AP — player only` — which looks like lost AP rather than an unbound snapshot. It now reads
  `👁 N AP — DM copy, not campaign-bound`, and names the source's DM AP in its tooltip. That figure is
  **display-only**: `_cgDmOpts()` does not read it, so the copy still cannot spend AP belonging to a
  roster it is not part of — asserted by its own check. `tool-pricing-ci` 151 → **158**, covering all
  seven states across the two tools.

- **2026-08-19 · feat(guide): the Players Guide shows its versions on the page, both labelled** —
  reported: *"i also cannot see the version number in the pact-guide html?"* Correct — they existed only
  as head comments and in the `<title>`. A `#guideVer` block in the nav now renders **both axes**, which
  are deliberately different things: **Guide** (`content-version`, the prose's own version, v0.333) and
  **Rules documented** (`documents-rules`, the engine version the prose was last *reconciled* against).
  The second currently reads **"not yet reconciled"** — shown honestly rather than filled with
  `DATA.version`, because printing a number there would assert a reconciliation that never happened. Read
  from the markers at runtime, so stamping one updates the display and the two cannot drift; **no engine
  import**, since this file is shared by `pact-guide` and `pact-guide-public` where no engine sits beside
  it. `verify-guide`'s version-markers check now fails if the block is missing.

- **2026-08-19 · fix(dm-console): subclass purchases and heritage-pack traits are visible to the DM** —
  reported from real use: *"on the dm console i can see class abilities, but not subclass abilities. moss
  i cannot see 'Ranger › Beast Master: Primal Companion'"*. `buildSections()` rendered `s.features` and
  had **no subclass section at all** — `subAbilities` appeared nowhere in the file. The data was already
  on the record (`compute()`'s `itemize`/`lines`, carried since the roster summary was built); nothing
  rendered it. Now shown with its AP, read from `itemize`/`lines` so the labels are the engine's own
  (`Ranger › Beast Master: Primal Companion`) rather than a second formatting of the stored key
  (`Ranger|Beast Master|Primal Companion`). Added to **both** detail renderers — the cloud card and
  `detailHTML` — which had drifted apart. The same card's *Traits* list had the heritage-pack blindness
  fixed earlier in the two player tools, so `packTraitsFor()` is bridged here too and a Dwarf now shows
  their pack traits. `tool-pricing-ci` 150 → **151**.

- **🔴 2026-08-19 · fix(chargen): a character with drawbacks lost AP on every open** — reported from real
  use: *"each time i open moss stormspud from the DM screen in chargen or refresh, the AP budget decreases
  by 4."* Moss has 4 AP of drawbacks. Reproduced and it compounds without bound — award **79 → 75 → 71 →
  67 → 63**, rewriting the character's stored log downward once per open. **A live data-loss bug, not a
  display fault.** Cause: `_cgSyncAward()` and `_buildEventBurst()` both subtracted the drawback total out
  of the award — correct under D-GH41, when `b.budget` was awards + `drawbackEarned` combined, but v0.355
  moved that split into the engine (`foldBuild` now sets `b.budget` to awards only) and left both
  subtractions in place, making each a **second** subtraction. Both now emit the budget unchanged.
  **Nothing caught it because every gate opened a character exactly once**; `tool-pricing-ci` now runs
  load → regenerate → reconcile five times and asserts the award and spendable total never move (148 →
  **150**). Introduced by v0.355 (PR #424) and live on `main` since. **The fix stops the drain but cannot
  restore AP already lost** — affected characters need their award corrected by hand. See
  `D-GH-2026-08-19-award-drawback-double-subtract`.

- **2026-08-19 · docs(livesheet): drop "(prototype)" from the Live Sheet's `<title>`** — the browser tab
  read *"PACT — Live Character Sheet (prototype)"*, the only place any tool still called itself that, and
  the one label a player sees before the page even paints. Owner's call. Title only; nothing else
  referenced the word, and no gate depended on it (checked).

- **2026-08-19 · fix(tools): heritage-pack traits are visible in both tools — and still never stored** —
  reported from real use: buying a species pack ticked nothing in CharGen and showed nothing on the Live
  Sheet. A pack is charged as one line and its members are owned **implicitly** (`compute()`'s `_ownsR`
  already treats them as held, which is what makes prerequisites resolve), but that ownership was derived
  and **never exported**, so no UI could render it. New pure-`DATA` export **`packTraitsFor(species,
  species2)`**, plus `compute().packTraits`. CharGen ticks and disables the boxes; the Live Sheet's
  character sheet lists them. They are **not** written into `b.racialTraits` — in-pack traits price at 0
  only while the pack is yours, so a stored one plus a species change re-prices at the cross rate
  (measured: `Dwarf: Dwarven Resilience` is 0 AP on a Dwarf, silently 3 AP on an Elf). The fix's own first
  version had exactly that bug and **the new gate caught it, not a human**; a `data-packTick` marker now
  un-ticks only what the pack ticked. `tool-pricing-ci` 143 → **146**. No `DATA.version` bump — pricing is
  unchanged. See `D-GH-2026-08-19-heritage-pack-visibility`.

- **2026-08-19 · fix(tools): version labels are repainted after `engine-ready`, not only initialised** —
  on one page load with the engine on **v0.356**, CharGen's header read v0.356 while its info popup read
  **v0.339**, and the DM Console footer read **v0.176**. Same shape in both: painted at parse time from a
  hardcoded fallback, before the deferred module bridge fires `engine-ready`, and never repainted.
  `_cgPaintInfoVersions()` now also runs on `engine-ready`, and `_dmPaintRulesVer()` again in `_dmBoot()`
  after `RULES` is set — both keep their parse-time call so no label is blank mid-load. Nothing caught it
  because every existing check reads `DATA.version` directly and **none asserted what the page actually
  renders**; `tool-pricing-ci` now compares rendered text against the live version (146 → **148**), written
  as a contains-check so it survives version bumps. See
  `D-GH-2026-08-19-version-labels-paint-after-engine-ready`.

- **2026-08-19 · chore(version): `BUILD` → `v1.426` for PR #426 (`preview` → `main` promotion)** — fourth
  promotion in this run: the campaign drawback cap reaching both player tools, the pre-lock ledger gate,
  `docs/MAINTENANCE-MODE.md`, and the tool-pricing CI hardening. No rules change — `DATA.version` stays at
  **v0.356**. Mirrored across the five sites per `docs/VERSION-SYNC.md`; `index.html` reads `BUILD` live
  and is untouched. Bumped **before** opening CI this time rather than after, so the batch is not
  restarted — see the note in `docs/plans/2026-08-19-morning-review.md`.

- **2026-08-19 · fix(tools): the campaign drawback cap now reaches both player tools** — `drawbackCap`
  was wired into `DM-Console.html` and nowhere else (6 occurrences there, **0** in either player tool), so
  a player in a capped campaign saw the full grant while their DM saw the capped figure. Both tools now
  pass it on the same `'active'` gate they already use for `dmAp`/`ignorePlayerAp`, and the shape-reading
  is extracted once to **`drawbackCapFromRules()`** in `js/campaign.js` — which all three tools already
  import — rather than pasted into two more files. The displayed figure moved with the applied one: both
  panels now show the campaign's cap when one is enforced, and the Live Sheet's wording changes with it
  ("the guide caps them at 12 AP; confirm with your DM" → "your DM caps them at 8 AP, so the excess is not
  granted"). `tool-pricing-ci` 134 → **141**, asserted through each tool's own opts builder. No
  `DATA.version` bump — `compute()`'s output per `(build, opts)` is unchanged. Graduates
  `fix/drawback-cap-player-tools` off `TASK_BOARD_NEXT.md`. See
  `D-GH-2026-08-19-drawback-cap-player-tools`.

- **2026-08-19 · docs(ops): `docs/MAINTENANCE-MODE.md` — everything about taking the tools down** — a
  dedicated reference, and now the single source of truth: how to run the toggle (including from
  PowerShell, and that it does **not** need the repo root — it resolves the repo from the script's own
  location), the exact commit-to-`main` sequence and why it deliberately bypasses a `preview` promotion,
  what players actually see on `maintenance.html`, the `ON`/`OFF`/`INCONSISTENT` states and how to
  recover from the third, the `?maint=off` bypass, troubleshooting, and the 16 Aug history
  (`965a052` → `15610f6` → `964cca7`, OFF ever since). Two things it states that were written down
  nowhere: **the gate is client-side only — a sign, not a lock**, so it does not stop Supabase writes and
  is not sufficient cover for a migration or backfill; and `off` **deletes** `maintenance.html`, so
  hand-edited wording does not survive a cycle and belongs in the script's template. `HOW-TO-WORK.md`'s
  inline section is reduced to a pointer so the two cannot drift.

- **2026-08-19 · fix(ci): the tool-pricing gate depended on the runner image, and could not say so** — it
  went red on `2b293d8`, a commit containing nothing but version strings, while `fd1ba0f` — carrying every
  actual code change — passed. Chromium was present (the script's own "No Chromium found" guard never
  fired) but never bound its DevTools port; the run failed identically on two attempts on two different
  runners. Two causes, both fixed: the readiness loop polled for 10s and then **fell through without
  checking whether it had ever connected**, so the symptom was a bare `FAIL harness — fetch failed` from a
  line that looks nothing like a browser problem; and Chrome's stderr was thrown away by
  `stdio: 'ignore'`, so a browser that refused to start was indistinguishable from a slow one. The loop
  now waits 30s and, on exhaustion, prints the binary path, elapsed time, Chrome's exit code and captured
  stderr, and exits **3** — distinct from 1 (a real pricing failure) and 2 (no browser found at all).
  `tool-pricing.yml` now installs its own Chromium under `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`,
  which `findChrome()` already probes, instead of trusting whatever the image ships. CI-only; the app
  still has no npm dependency.

- **2026-08-19 · chore(version): `BUILD` → `v1.425` for PR #425 (`preview` → `main` promotion)** — third
  promotion in this run, carrying rules **v0.356** (drawbacks as a trade, surviving `ignore_player_ap`)
  and three stale player-facing labels: CharGen's hardcoded `>14` drawback warning, the Live Sheet's
  missing cap line, and CharGen's `+14 AP` second-origin hint against an engine charging 18. Mirrored in
  `js/engine.js` (`export const BUILD`), CharGen (line-1 comment, `<title>`, header `.sub`), Live Sheet
  (line-1 comment) and DM Console (`TOOL_VERSION`); `index.html` reads `BUILD` live and is untouched. The
  pre-release manual QA checklist was **not** run — three promotions have now shipped without it.

- **2026-08-19 · docs(tasks): graduate `fix/drawback-grant-vs-ignore-player-ap`** — added and answered the
  same day. Option **B** (the grant survives) chosen by the owner; the task's own **Done when** is met in
  full: the ruling is made, `compute()` implements it, `CG-019`/`CG-020` pin both toggle states, and the
  reasoning is recorded as `D-GH-2026-08-19-drawback-grant-vs-ignore-player-ap`.

- **2026-08-19 · feat(rules): a drawback survives `ignore_player_ap` — it is a trade, not player income
  (`DATA.version` **v0.356**)** — owner's ruling on the question v0.355 left open. The grant moves
  **outside** the `ignorePlayerAp` bracket: `playerAp` (awards) is what that toggle governs, and a
  drawback is a price the character pays every session, not AP the player accrued. Before this, a
  character in such a campaign stayed permanently Hexed and Leaden-Reflexed and got nothing for it while
  every surface still listed the drawbacks as active. `drawbackCap` still applies, so the two campaign
  controls now do one job each. `earnedWithDm()` — the frozen-ledger ceiling the Live Sheet displays —
  carves the same exception, or it and `compute()` would disagree by exactly the grant (the D-GH30
  divergence class); `log-fuzz` gained a **`ceilingDrift`** invariant asserting the two agree under three
  opts shapes. New fixtures **`CG-019`/`CG-020`** pin a character with drawbacks and no award events under
  both toggle states (parity 38 → **40**), and `dm-console-ui` 94 → **96** after its "switch is honoured"
  check went degenerate and was replaced with one that pins the actual split: a 10 AP award moves the
  ceiling, the drawback does not. **Live effect:** Amble's `Anders` (awards 0, drawbacks +6) goes 12 → 18
  AP left. See `D-GH-2026-08-19-drawback-grant-vs-ignore-player-ap`.

- **2026-08-19 · fix(tools): drawback-cap info in both player tools, and CharGen's stale second-origin
  price** — three player-facing label bugs, all found while adding cap information to the drawback
  sections. **(1)** CharGen's drawback panel warned at a hardcoded `>14` and said "over 14 AP" while
  colouring at `>12` and `DATA.drawbackCap` said 12 — it contradicted itself and the Players Guide in
  the same three lines, and a player on 13 or 14 AP was told nothing at all. Now reads `DATA.drawbackCap`
  throughout. **(2)** The Live Sheet's "Drawbacks (gain AP)" panel showed **no** cap information at all;
  it now carries a line reading the gain off `compute()`'s own itemised rows (so DM-custom drawbacks
  count — re-summing from `DATA` locally would have scored them 0). **(3)** CharGen's second-origin-class
  picker hint still said **`+14 AP`** six days after the price rose 14 → 18
  (`D-GH-2026-08-18-drawback-cap-and-second-origin`): the tool quoted 14 and the engine charged 18. The
  price now lives in `DATA.secondOriginAP`, read by both `engine.js` and the label, so the two cannot
  drift again. No `DATA.version` bump — `compute()` output is unchanged for every input; the new key
  only relocates a literal the engine already used.

- **2026-08-19 · docs(tasks): graduate "Drawbacks are counted twice", and split out what it did not
  settle** — the board task `fix/drawback-ap-double-count` (found 2026-08-07 on `Moss Stormspud (COPY)`)
  is closed by v0.354 + v0.355: a drawback is counted exactly once, and `playerAp` now means what
  `engine.js` always documented it to mean — awards only — so the "mislabelled player AP" half is fixed
  too. **One of its Done-when criteria is deliberately not met:** *"the same `remaining` whether
  `ignore_player_ap` is on or off"* was written for **model (a)**, and the owner chose **(b)**, under
  which the grant is player-side income and is dropped with the rest of the player's AP (spendable 41 vs
  37 on the task's own example). That is a design question, not a leftover bug, and is now its own NEXT
  task. The DM-view-only drawback cap found while verifying v0.355 is a second new NEXT task.

- **2026-08-19 · docs(chargen): tooltip on the "AP budget" field, now that it means awards only** — a
  hover hint on the label and the input: drawbacks are granted *on top* of this figure, so the spendable
  total in the header can be higher. No layout change; the field's own semantics are unchanged (it has
  always been the `award` event). Without it a player sees 79 in the field and 85 in the header with no
  explanation of the gap.

- **2026-08-19 · fix(rules): derive the drawback grant inside `compute()`, not from the caller
  (`DATA.version` **v0.355**)** — v0.354's fix delivered the grant through `b.budget` and documented that
  as a contract "every real caller" satisfied. CharGen doesn't fold: `readBuild()` reads the form, where
  `budget` is the award field alone — so **in the tool characters are made in, drawbacks were worth
  zero**, which is worse than the double-count v0.354 replaced. Model (b) is unchanged; the grant now
  comes from `b.drawbacks` inside `compute()`, and `b.budget` means awards only (`foldBuild()` and
  `rebuildStateFromEvents()` both pass `earned − drawbackEarned`). Two gates added, because **none of the
  38 parity fixtures could see this**: `engine-parity` asserts `total` and the *sign* of `remaining`,
  never the *value* of `budget`. `log-fuzz` gains an income invariant (`compute().budget ===
  economy().earned`) — which failed on its first run and exposed `rebuildStateFromEvents()`
  double-granting too — and `chargen-flows-e2e` gains ten checks driving a real drawback click in a real
  CharGen (56 → **66**). `CG-002`'s budget returns to 50. See
  `D-GH-2026-08-19-drawback-single-count` (Addendum).

- **2026-08-19 · chore(version): `BUILD` → `v1.424` for PR #424 (`preview` → `main` promotion)** — second
  promotion of the night, carrying the drawback single-count fix — **v0.355** by the time it merged, after
  the entry above — to the live site. The
  number after the dot is the promoting PR's number per `docs/VERSION-SYNC.md`; mirrored in `js/engine.js`
  (`export const BUILD`), CharGen (line-1 comment, `<title>`, header `.sub`), Live Sheet (line-1 comment)
  and DM Console (`TOOL_VERSION`). The pre-release manual QA checklist was **not** run — flagged in the PR
  body and in `docs/plans/2026-08-19-morning-review.md`.

- **2026-08-19 · fix(rules): a drawback is income, not negative spending — model (b) (`DATA.version`
  **v0.354**)** — drawbacks were worth **double**. `foldBuild()` sets `b.budget = economy().earned`, which
  already includes `drawbackEarned`, and `compute()` *also* subtracted the grant from `total`. A level-1
  Fighter awarded 79 AP taking four drawbacks had **131 AP** to spend against everyone else's 79 — +66%,
  live on `main` the week the first real characters were being built. Two corrections were possible and
  both give the right `remaining`; **(b)** was chosen: `total` counts positive purchases only and the
  budget carries the grant. It is what the guide already promises (*"Each drawback below grants AP up
  front"*), it avoids (a)'s *"spent −11"* for any level-1 character who takes a drawback before buying
  anything, and `economy()` already reported it that way — so (b) ends a disagreement instead of adding a
  third view. **Two things the plan had not named turned up in the doing:** the `b.budget` contract had to
  be written down (under (b) the grant arrives on that side and nowhere else, so three hand-authored
  fixtures needed their budgets corrected), and **legacy characters would have lost AP** — `economy()`
  counted grants only from `buy`/`cat:'drawback'` events, while older CharGen exports deliver them as a
  coalescing *patch* (`LS-001` carries one); that shape is now recognised. The ledger still shows
  `Drawbacks (refund) −14` with its itemised rows, via a new display-only line that does not touch
  `total`, so the rows-sum-to-heading invariant `tool-pricing-ci` asserts still holds. `log-fuzz`'s
  reconciliation invariant went from `spent − drawbackEarned === total` to `spent === total`. New
  fixture **`EV-019`** pins it end to end (budget 93, total 3, remaining **90**, was 104); five existing
  fixtures moved, each a correct consequence; parity 37 → **38**. See
  `D-GH-2026-08-19-drawback-single-count`.
- **2026-08-18 · feat(testing): worked-example arithmetic gate; six Appendix I budgets corrected** —
  docs/testing only, no `DATA.version` change. When the class unlock moved 7 → 8, three worked examples
  silently stopped adding up and **every gate passed**: `guide-price-check` verifies feature *prices*
  against the engine, and example arithmetic is a layer above the prices it is built from. New
  **`testing/scripts/guide-example-check.mjs`** checks every `Purchase | AP | Running` table —
  running-total accumulation, the closing `Total x / y`, the heading budget, and (the one that catches a
  price change *at the row*) that a spelled-out breakdown like `unlock Fighter (8) + Action Surge (4) +
  Second Wind (3)` sums to what the row charges. **30 tables, 586 purchase rows.** Now the 9th check in
  `verify-guide`; mutation-verified to go red on exactly the break that motivated it. It found **six
  pre-existing defects** — Appendix I heroes whose heading budget disagreed with their own table's Total
  by 2–4 AP (Wisp 99→101, Quill 237→241, Lyra Nightsong 252→256, Garruk Stonehand 276→278, Mistwalker
  312→314, Old Marrow 531→533); every table reconciles internally, so the headings were corrected to
  match. It also caught a real error from `ff6932e`: the header bumped 217→218 belonged to Appendix I's
  *War Priest Doran*, not §3's *The War Priest* — reverted. Three of its own first four findings were
  parser bugs (the guide writes negative AP as U+2212 and positive as `+N`, both skipped by
  `/^-?\d+$/`), which is recorded because a checker that mis-reports is worse than none.
- **2026-08-18 · fix(rules): remove the §11 subclass access gate (`DATA.version` **v0.353**)** — v0.347
  warned *"⛔ \<class\>: you cannot build from this class"* when a subclass ability or spell bundle came
  from a class that was neither origin nor unlocked. Gone one version later, and deliberately not
  replaced. Its premise was wrong — §11 endorses the cross-class per-feature route in as many words
  (*"the per-feature surcharge is cheaper for a single dip"*), so it warned against a purchase the
  published rules bless. Three of four cold reviewers said don't gate. It contradicted the §1 line
  (*"just a shopping list, not a multiclass puzzle"*) that settled the flat unlock a day later, so the
  engine was carrying both messages at once. **And it did not work:** the identical ability bought
  through the *feature* picker cost the same 23 AP and raised no warning at all, because all **192**
  subclass abilities are mirrored into `DATA.features` — its only effect was to scold one of two
  identical purchase paths. Removing it moved **no price**: `CG-012`/`CG-013` keep their totals (34, 33)
  and simply lose a warning, which is the cleanest evidence that three-tier bundle pricing never
  depended on it. The guide never carried the gate, so no guide change. If a gate is ever wanted again,
  close the mirror first (`refactor/subclass-purchase-unify`). See
  `D-GH-2026-08-18-remove-subclass-access-gate`.
- **2026-08-18 · feat(rules): class unlock becomes a flat 8 AP; the ladder table gains a clamp
  (`DATA.version` **v0.352**)** — the old **7 × classes-you-already-own** ladder contradicted the guide
  in two places. §11 says the class unlock *"mirrors how subclasses are bought"*, and the guide's actual
  subclass rule is *"a flat 15 AP to open, **however many you already have**"* — flat, and explicitly
  non-escalating. §1 sells cross-class as *"just a shopping list, not a multiclass puzzle"*; a price that
  depends on what you already own is a puzzle. The table also carried **five rungs for twelve classes**
  and was read with `|| 0`, so indexing past the end read as *free*: a **fifth** unlock deleted the whole
  class-access line and **refunded the 70 AP** paid for the first four, going negative with a second
  origin class. Now `[0, 8, 16, … 96]` read through a **clamp** — `|| 0` turns a programming error into a
  payment to the player. `7 + tier` measured as the *most* restrictive candidate once the simulator was
  corrected, and was rejected on fit rather than numbers: "commit early or pay more" is exactly what §1's
  *"grows in the direction you steer it"* rejects. Guide updated at **twelve** sites — seven statements of
  the formula plus five figures inside worked examples. New fixture `CG-018` pins the fifth unlock at
  40 AP (the rung that used to refund) and pins flatness; `CG-012`/`CG-013` moved +1 each; parity 36 →
  **37**. `tool-pricing-ci`'s unlock checks now read the expected figure from `DATA.unlockCum` rather than
  a hardcoded 7. **A gate gap this exposed:** three worked examples silently stopped adding up — line
  item, running total, stated budget and "Total x / y" all had to move by 1 — and `guide-price-check`
  passed throughout, because it verifies feature prices and not example arithmetic. A build-replay check
  that re-prices each worked example through `compute()` is worth having before the next pricing change.
  See `D-GH-2026-08-18-flat-class-unlock`.
- **2026-08-18 · feat(rules): campaign-enforced drawback cap, 2nd origin class 14 → 18 (`DATA.version`
  **v0.351**)** — two numbers, found together because one funded the other. **The drawback cap did not
  exist.** `js/engine.js` carried the comment *"§14: drawbacks grant AP, but no more than 14 AP total
  across a character"* above code that only warned; all 69 drawbacks together granted **217 AP**, more
  than a level-11 character's whole feature budget. The Players Guide meanwhile said **12** — three
  answers at once (guide 12, engine text 14, engine behaviour unlimited). `compute(b, opts)` now clamps
  when a campaign passes `opts.drawbackCap` and grants in full with an advisory warning otherwise: a
  campaign has a DM whose ruling the number represents, a solo build does not, and silently clamping an
  offline character would change what people can already make. Default **12** in `DATA.drawbackCap` so
  engine, both tools and guide quote one figure — nothing depended on 14, so the cheaper correction was
  to fix the comment rather than edit a published rule. **2nd origin class 14 → 18**: at 14 it paid for
  itself after six features, *and* matched the drawback allowance exactly, so two drawbacks (Hexed Luck 8
  + Leaden Reflexes 6) funded a whole second origin class for nothing and raised no warning at all. 18
  moves the break-even to eight and sits above the allowance. Guide updated at four sites plus §14.
  DM Console gains an on/off + figure in the rules panel, defaulting **on at 12** for campaigns that
  predate the rule. Fixtures: the build-fixture format gained **`_apOpts`** (compute's campaign-side
  second argument) — without it the campaign-only half of any rule is untestable in parity, which is
  precisely how this cap shipped unenforced; `CG-016`/`CG-017` are the same character with and without a
  campaign, 26 AP granted versus 12. Parity 34 → **36**, `dm-console-ui` 89 → **94**. `CG-009` moved
  79 → 83, the only fixture with a 2nd origin class. See
  `D-GH-2026-08-18-drawback-cap-and-second-origin`.
- **2026-08-17 · feat(guide): the Players Guide gets its own theme switcher, so one file can serve all
  three homes** — docs change, no `DATA.version` bump. Groundwork for collapsing the guide's three
  divergent copies into a single canonical artifact. Until now the guide only ever *read*
  `localStorage['pact-theme']`; PACT's `index.html` was the only thing that wrote it. That is fine while
  the guide lives behind the PWA, and useless everywhere else — a reader on the `pact-guide` master or
  on `pact-guide-public` got Parchment, or Midnight if their OS was dark, with **no way to change it**.
  A four-button switcher now sits in the nav sidebar under the section filter, writing the same key and
  the same four names `index.html` uses, so a choice made in either place carries to the other. Hidden in
  print. One asymmetry worth knowing: Parchment is the bare `:root`, so selecting it **removes**
  `data-theme` rather than setting `data-theme="parchment"` — there is no such block to match, and a
  switcher that set it would silently do nothing. New gate **`testing/scripts/guide-theme-e2e.mjs`** (24
  checks, its own workflow) drives a real browser: every theme applies, repaints, persists, marks its
  button and survives a reload, plus the no-choice defaults in both light and dark OS modes. That is the
  half `verify-guide.mjs` structurally cannot cover — it proves the theme CSS is *present*, never that
  clicking anything does something.
  **Context for the three copies:** they are `preview` (1,436,285 B, 10 WebP, 4 themes, Appendix J),
  the `pact-guide` master (1,164 lines, 1 JPEG, no themes, no Appendix J) and `pact-guide-public`
  (1,059,878 B, same shape as the master, plus a `survey/survey-prompt.js` hook whose own comment says
  it is harmless when unreachable). All three still claim `content-version: v0.333` while differing by
  ~376 KB and a whole appendix.
- **2026-08-17 · fix(chargen): the class-unlock checkbox was a dead control — the unlocked price tier was
  unreachable; plus three-tier row prices, a renamed-feature alias map, and four fixtures** — no
  `DATA.version` change (no price moved). Adding an end-to-end test that CharGen's displayed row price
  equals `compute()`'s charged ledger price turned up a bug the display fix would have papered over:
  **ticking "unlock \<class\>" did nothing at all.** No `unlockclass` event reached the LOG and the box
  sprang back — an inline `onchange="render()"` and `#form`'s own `input -> render()` both re-derived
  `checked` from a LOG that had no entry yet, un-ticked it, and the delegated handler then read
  `checked === false` and *retracted*. So the entire middle price tier shipped in v0.350 was unreachable
  from the UI. Fixed by binding the checklist delegation in the **capture** phase for both `input` and
  `change` (see `D-GH-2026-08-17-unlock-checkbox-dead-control`). The display half is fixed too: the row
  `.price` spans for features, subclass abilities and bundles knew only origin/cross and showed `cross`
  for an unlocked class while the ledger charged the sticker — a bundle read 11 AP and cost 8. All three
  now route through one `PRC(o,u,x)` helper. Also: **`DATA.featureAliases`** — this branch removed two
  `DATA.features` keys with no migration, and `compute()` drops an unknown key *silently*, so every saved
  character holding one lost the feature and its AP (`D-GH-2026-08-17-renamed-feature-aliases`);
  **`Elf: Wood Elf speed`** existed in `DATA.racial` but not `racialList`, so it was unbuyable; and a 0 AP
  `Species traits` line is now emitted when it has itemized detail under it, instead of leaving free
  heritage-pack traits filed under a heading `add()` had suppressed. Gates: **four new fixtures**
  (`CG-012`–`CG-015`) covering the three price tiers for bundles and for subclass abilities, pack traits,
  and the alias map — parity 30 → **34**; `chargen-flows-e2e` 46 → **56** with a real-click test of all
  three tiers and of retraction. Two checker holes closed: `guide-bundle-check`'s summary rows compared by
  `cell.includes()` (a mutation of `4` to `14 (9)` passed — six mutations now caught), and
  `engine-parity.html`'s hardcoded manifest had silently gone stale by six fixtures while `AGENTS.md`
  points humans at that page as the gate, so CI now fails if it drifts again. `launchChromium` was
  factored into `testing/scripts/lib/launch-chromium.mjs` and given to `sw-cache-e2e`, which had none and
  so could not run at all on a pre-provisioned machine. The commit message on `ee8dc41` is **wrong** about
  its own root cause — `renderCloudRoster` is a synchronous chain ending in one `innerHTML =`, so the
  40 ms sleep it replaced was never a race and the poll breaks on iteration 0; corrected in a comment at
  the site, and the real cause of those two CI failures is **not** diagnosed.
- **2026-08-17 · docs(guide): split the bonus-spell rules out of "Prepared casters", add Appendix J, and
  add a third checker that proves subclass bundles** — no rules change, so no `DATA.version` bump.
  The bonus-spell rules were buried inside the *Prepared casters* section even though they apply to every
  caster whose subclass grants an expanded list, known casters included — so a Sorcerer's and a Warlock's
  rules sat under a heading naming four classes neither of them is. Split into its own **Subclass bonus
  spells** section; *Prepared casters* shrinks to what it actually describes (Cleric, Druid, Paladin,
  Ranger). New **`testing/scripts/guide-bundle-check.mjs`** verifies every bundle against
  `DATA.subclasses[*].spellBundle` — a gap neither existing checker could reach (`guide-price-check` keys on
  `DATA.features`, `guide-spell-check` keys on spell level, so both reported bundle rows as
  `ambiguous`/unparsed and neither could prove one). It found four real defects plus one absence:
  **Circle of the Stars** sold a 5 AP bundle the guide never priced; the **Ranger** class table had no
  bonus-spells row at all despite two of its subclasses selling one; and the **Sorcerer** and **Warlock**
  rows printed a flat `8 (6)` where the real spread is 8–12 and 8–16 — the Sorcerer row quoting a price for
  Wild Magic, which has no bundle to buy. All four fixed; the checker is mutation-tested (7 injected faults,
  7 caught) and now also verifies Appendix J's own figures, so the table cannot drift from the engine.
  New **Appendix J: Subclass Bonus Spells** lists all 24 subclasses of the six bundle-granting classes with
  price, cantrips and the working — including explicit **none** rows for Wild Magic Sorcery, Beast Master
  and Hunter, because an omitted row reads as an oversight while a stated "none" reads as a rule. It is
  generated from the engine by `testing/scripts/gen-appendix-j.mjs`, not hand-typed. The working is real
  and **names the actual spells**, read from `DATA.spellGrants.subclassSpells`: a bundle prices the grants
  unlocking at character level ≤ 5 and everything above rides free, so Life Domain charges Bless, Cure
  Wounds, Aid, Lesser Restoration, Mass Healing Word and Revivify at `1+1+1+1+2+2 = 8`, dropping to 6 as
  origin. **20 of the 21 stored prices reproduce exactly.** Also corrected two prose claims: bundle
  cantrips are charged a flat 4 AP inside the bundle price rather than on the escalating §12 ladder, and
  a half-caster bundle prices four spells (Paladin) or two (Ranger), not four in both cases.
  > **Correction (same day, before this shipped).** A first pass at Appendix J *assumed* a grant shape
  > (two spells each at 1st/2nd/3rd) instead of reading `DATA.spellGrants`, whose existence had been
  > wrongly written off as "the engine stores only the lump price". That assumption reproduced only 16
  > prices and wrongly printed four Druid circles and Archfey Patron as "hand-set" — none of them are;
  > their lists simply aren't that shape (Circle of the Stars grants just a cantrip and Guiding Bolt,
  > hence 5 AP flat). **The real lone outlier is Circle of the Sea**, charged 11 (9) where its seven paid
  > grants total 12 (10) — the identical shape to Aberrant Sorcery, which *is* charged 12 (10). That is a
  > discrepancy, not a discount, and is now the only caveat printed in the appendix.
- **2026-08-17 · feat(rules): subclass spell bundles get the normal three price tiers — `DATA.version`
  v0.349 → v0.350** — bundles had only two (`isO ? origin : cross`), so a character who paid 7 AP to
  unlock a class and one who had never touched it paid the **same** bundle price. Unlocking bought a
  0 AP reduction on a bundle while saving real AP on that class's abilities. Bundles now price on the
  same three steps as any subclass ability: **origin / unlocked (sticker) / cross-class (sticker + 3)**,
  Tier 3 being where subclasses open. Life Domain is now 6 / 8 / 11.
  **No origin price changed and no unlocked price changed** — today's figure was already the sticker,
  it just wasn't labelled as one. The only new number is the cross-class price, which is the rung that
  didn't exist. Unlocking Cleric now repays itself inside two purchases (3 AP off a domain bundle plus
  4 AP off each domain ability) where it previously never repaid on a bundle at all.
  `spellBundle` gains `sticker` and `tier`; the old `cross` field becomes `sticker` and `cross` is the
  new surcharged figure. Guide rows need no edit — a bundle now prints `Sticker (Origin)` exactly like
  every other feature row, with cross-class implied by the ordinary +Tier rule.
  > **Why §13's spell-access exemption does not cover bundles.** "Spell access is free of the class tax"
  > governs the spell *economy* — Foundations, Ranks, slots, spells known, cantrips — where a per-purchase
  > +Tier surcharge compounds into something crushing. It was never meant to exempt one-off
  > spell-*granting* features, and the engine has always agreed: `Bard: Magical Secrets` (13/17/22),
  > `Warlock: Pact of the Tome` (18/18/19), `Wizard: Signature Spells` (14/20/27) and every other
  > spell-granting feature carry the full +Tier surcharge. Pact of the Tome is the exact analogue of a
  > bundle — one purchase, a fixed set of granted spells — so bundles taking the surcharge is the
  > *consistent* treatment, not an exception. Three of the four cold reviewers argued the opposite from
  > the guide's §13 wording alone; the guide now carries an explicit clarifying paragraph so the next
  > reader doesn't repeat it. See `docs/plans/cold-reviews/`.
- **2026-08-17 · fix(rules): split Circle of the Stars' spells from Star Map's free-cast — `DATA.version`
  v0.348 → v0.349** — the Stars bundle (Guidance + Guiding Bolt, 5 AP) and the Star Map ability were the
  same content sold twice: the guide's own row read *"Star Map (Guiding Bolt prepared + free-cast +
  Guidance cantrip)"*, so a player could buy both and pay 11 AP for one feature. Under the owner's call
  (AA2) the bundle keeps the spells and **Star Map now covers only the free-cast** — cast Guiding Bolt
  without a slot, proficiency-bonus times per long rest. Repriced **T3 Situational 6 (4) → T2 Per-Rest
  5 (4)**: the band was wrong (an attack spell that recharges on a long rest is Per-Rest, not Situational),
  and 5 sits just under the 6 AP that two 1st-level slots cost an origin caster — right, since the
  free-cast only ever casts one spell. Circle of the Stars is now 9 AP all-in at origin (5 bundle + 4 Star
  Map), against Land and Moon at 7 and Sea at 10.
  > **Star Map is stored in three places** — `DATA.features`, `DATA.subAbilMap`, and
  > `DATA.subclasses[…].abilities` — all pre-existing and all carrying the price. Editing only
  > `subclasses` left `compute()` charging the old figure and `guide-price-check` reporting a
  > `price-mismatch`, which is how the duplication was caught. **All 192 subclass abilities are mirrored
  > into `DATA.features` at the same price**; `subAbilMap` and `subclasses` agree everywhere else (0
  > drift), so this is a systematic mirror rather than a Star Map anomaly — but any future subclass-ability
  > reprice must touch all three.
- **2026-08-17 · fix(rules): reprice Circle of the Sea to match its own spell list — `DATA.version`
  v0.347 → v0.348** — the bundle was charged 11 (9) where its seven paid grants (Fog Cloud, Gust of Wind,
  Ray of Frost, Shatter, Thunderwave, Lightning Bolt, Water Breathing) total `1+1+4+1+1+2+2 = 12`, and
  10 as origin. Its list is exactly the shape of Aberrant Sorcery's — a cantrip plus two spells each at
  1st, 2nd and 3rd — and that one *was* charged 12 (10), so this was a 1 AP slip rather than a deliberate
  discount. Now 12 (10). **All 21 bundles derive exactly from their own spell lists**, so Appendix J no
  longer carries an outlier note. Guide updated in the same change: the Sea row and the Druid class
  summary (`varies 5–11` → `varies 5–12`). No `testing/expected/` update was needed — no fixture prices
  this bundle.
- **2026-08-17 · fix(rules): gate subclass abilities and spell bundles behind class access —
  `DATA.version` v0.346 → v0.347** — the guide says "each class you can build from gives you one subclass
  for free: pick it, and you may buy its expanded spell list and any of its abilities", but nothing
  enforced the *"you can build from"* half. A Fighter with no Cleric access could buy Life Domain's spell
  list for 8 AP, and since a bought bundle registers in `subUsed` it also claimed that domain as the
  class's free subclass — so no 15 AP subclass unlock landed either. Three lists from three foreign
  classes cost 35 AP with no class unlock, no subclass unlock, and no warning. `compute()` now pushes a
  ⛔ warning when a subclass purchase's class is neither an origin class nor unlocked. Warn rather than
  refuse, matching every other ⛔ prerequisite in `engine.js`; prices are unchanged, so no
  `testing/expected/` update was needed. Applies to subclass **abilities** as well as bundles — they
  share the `subUsed` mechanism and the one guide sentence covers both.
- **2026-08-16 · feat(rules): split a conflated Druid key, add three missing features, reprice Cunning
  Strike — `DATA.version` v0.346** — closes the last four guide↔engine name mismatches, all owner-adjudicated.
  (1) `Druid: Elemental Fury / Improved circle` fused two unrelated abilities — Elemental Fury (Druid L7)
  with an "Improved circle" that already exists separately as `Druid: Improved Circle Forms` at the *same*
  T4 Passive 14 (11). Renamed to `Druid: Elemental Fury`; added the genuinely missing
  `Druid: Improved Elemental Fury` (Druid L15) T6 Passive 21 (16). (2) Added
  `Monk: Disciplined Survivor (Focus)` T6 Premium 24 (19), absent from the engine entirely.
  (3) Renamed `Paladin: Aura expansions` → `Paladin: Aura range → 30 ft (L18)` — same feature, same price,
  the two sides just named it differently. (4) `Rogue: Cunning Strike` was **Situational** in both engine and
  guide; it is At-Will — repriced T4 At-Will 13 (10) (was 9 (6)) and the missing
  `Rogue: Improved Cunning Strike (L11)` T5 At-Will 16 (12) added, with the guide's two rows corrected to
  match. **Two key renames**: any saved character referencing the old names would be orphaned — acceptable
  only because the app is pre-launch (D-GH37). Parity 30/0, tool-pricing 134/0. Checker now reports
  **0 price-mismatch and 0 no-engine-key** across 421 rows.
- **2026-08-16 · feat(rules): stepped-purchase ladders that the guide advertised but the engine lacked —
  `DATA.version` v0.345** — nine features added. The guide listed stepped purchases (Second Wind 3/4 uses,
  Action Surge 2nd use, Indomitable 2/3 uses, Channel Divinity 3/4 uses, Brutal Strike improved L13/L17)
  that had no engine key at all, so they were unbuyable. Owner confirmed these purchases *should* exist,
  making it an engine addition rather than a guide deletion. Every price is `MASTER[tier][band]`-derived and
  matches the guide's printed cell exactly; entries follow the existing `Fighter: Extra Attack (2nd)/(3rd)`
  variant convention and are registered in `featureList` beside their base. Brutal Strike gained its missing
  **L13** rung in both engine and guide (T6 At-Will 19 (14)) — the guide had L9 and L17 but nothing between.
  Guide also: Star Map corrected `Bundle 5` → `T3 Situational 6 (4)`; `Agonising` → `Agonizing` ×7 to match
  the engine key. Parity 30/0, tool-pricing 134/0. **Two audit items needed no change at all** — the guide's
  `Extra Attack (3/4 attacks)` rows already matched `Fighter: Extra Attack (2nd)/(3rd)` exactly; the earlier
  triage's claim otherwise was a checker resolution failure, not a defect.
- **2026-08-16 · fix(testing): guide-price-check resolves variants and punctuation** — sibling variants are
  now found by bare name rather than the resolved key's class prefix (a class-agnostic table resolved to
  whichever class matched first, so `Fighter: Extra Attack (2nd)` was invisible), and typographic
  apostrophes are normalised for comparison only — the guide sets 111 of them as house style, and rewriting
  a player document's punctuation to match a data key would be a visible regression. `price-mismatch` 2 → 0.
- **2026-08-16 · feat(rules): heritage-pack membership + pricing model corrected — `DATA.version` v0.344** —
  In-pack species traits were stored `origin: 0`, which coupled a trait's *price* to its *pack membership*, so
  a trait leaving a pack silently became free. Already live as a defect (`Goliath: Long Stride (Speed 35)`
  was a free T1 trait) and about to bite three more. In-pack traits now carry their real
  `MASTER[tier][band]` origin price and `compute()` guards `r.pack && isO → 0`, so the pack — not a zeroed
  field — is what makes them free. Output-neutral: parity 30/0 throughout, `testing/expected/` unchanged.
  Rules changes in the same bump (owner-specified): `Elf: Fey Ancestry`, `Orc: Relentless Endurance` and
  `Dragonborn: Breath Weapon` leave their heritage packs; `Orc: Adrenaline Rush` corrected T2 → T1 with
  `cross: 4`; `Goliath: Long Stride` repriced to At-Will 4 (5); new `Elf: Wood Elf speed` At-Will 4 (5) —
  the guide listed it as an Elf lineage option but the engine had no entry for it. Pack prices unchanged at
  5 (Human −2); value spread narrows 7–13 → 7–10 AP. Guide landed the same change (atomicity rule): Ch10
  basics, Appendix B in-pack flags and prices, plus `DATA.packBasics`. All 29 Appendix B trait rows now
  reconcile against the engine with zero mismatches. See `D-GH-2026-08-16-heritage-pack-pricing`.
- **2026-08-16 · fix(guide): drop the guide's three PWA `<head>` tags so served copy == `pact-guide` master
  byte-for-byte** — `docs/PACT-Players-Guide.html` used to carry `<link rel="manifest">`, `<link rel="icon">`
  and `<link rel="apple-touch-icon">` that the master doesn't, and `docs/VERSION-SYNC.md`'s transfer
  procedure never mentioned them — so every hand-copy silently stripped them with no visible error (caught
  today when a `cp` of the v0.333 master did exactly that, before it was committed). Fixed by **removing**
  the tags rather than scripting their re-injection: they were near-inert. `manifest.json` already sets
  `scope:"/PACT/"` so the guide is in scope and opens in the installed app regardless, and
  `service-worker.js:26` already precaches the guide so offline never depended on them. Only real loss is
  the guide tab's favicon (LATER task raised). The two files are now byte-identical, `diff` is the transfer
  check, and a plain `cp` is correct — one whole class of transfer bug removed instead of automated around.
  Supersedes the `sync-guide-from-master.mjs` injector added earlier the same day (now deleted).
  No `DATA.version`/`BUILD` change.
- **2026-08-16 · feat(testing): mechanical guide-vs-engine price checker** — `testing/scripts/guide-price-check.mjs`
  diffs every priced feature row in the Players Guide against live `DATA`, encoding the pricing rule nothing
  had written down (non-repeatable `sticker = max(1, cross − tier)`, `engine.js:290`; repeatable stepped
  `MASTER[tier][band]` ladder, `engine.js:289`). Built because re-verifying the 2026-08 171-finding guide
  audit found its `Fix:` lines quote `origin`/`cross` where the guide's column needs `sticker` — wrong for
  findings #36, #41, #42 — so applying that audit verbatim would introduce new errors. Independently
  reproduces audit findings #24, #27, #29, #30, #31, #32, #35, #39, #40, #43, #45 without reading it, and
  flags rows its range never covered. **Established that the v0.333 master carries every one of these
  defects unchanged**, i.e. the 2026-08-16 session's claimed "applied and verified #22–48" never landed in
  Appendix A. Read-only. No `DATA.version`/`BUILD` change.
- **2026-08-16 · docs(agents): cross-project rules-change atomicity rule** — `AGENTS.md` now states that a
  mechanics change isn't finished until BOTH `js/engine.js` and the Players Guide land it, with
  `DATA.version` bumped exactly once (in the engine); names `pact-guide` (home-server MCP, project key
  `pact-guide`) as the guide **master** and this repo's `docs/PACT-Players-Guide.html` as a served copy;
  resolves the engine-vs-Python authority question explicitly in favour of `js/engine.js`, citing
  `pact-guide`'s own `D-2026-08-16-guide-audit-reconciliation-target`; and lists **six** rules-carrying
  copies that can drift — the task board said five, but `pact-guide`'s `py/engine.py` is a second,
  name-colliding engine that on 2026-08-16 nearly caused a completed 171-finding audit to be redone
  against the wrong file. Also corrected two stale version claims in the same section (`BUILD` v1.293 →
  v1.421, `DATA.version` v0.336 → v0.343) — both were wrong immediately above a new rule about version
  drift. Matching patch for `pact-guide`'s own `AGENTS.md` drafted for handover at
  `docs/plans/2026-08-16-pact-guide-agents-atomicity-patch.md` (not applied from here, per *Technical
  Access ≠ Scope*). Docs-only: no `DATA.version`/`BUILD` bump, no `compute()` change.
- **2026-08-12 · docs(version-sync): guide↔engine rules-version pointer, cross-project** — cold-reviewed
  plan (4 reviewers) at `docs/plans/2026-08-12-guide-engine-version-pointer.md`; implemented the PACT-repo
  half directly (`docs/VERSION-SYNC.md` new cross-project section, this decision record) and the
  `pact-guide` half via the home-server MCP connector (canonical guide renamed off its version, new
  `py/tools/stamp_guide_rules.mjs`, that project's own decision/task-board records). Mirrored branch:
  `main`. `documents-rules` is a deliberate reconciliation assertion, never auto-advanced by a vendor
  refresh — no first stamp applied yet (open follow-up in `pact-guide`'s `TASK_BOARD.md`). No
  `DATA.version`/`compute()` change. See `D-GH-2026-08-12-guide-engine-version-pointer`.
- **2026-08-12 · fix(chargen): bound the invite-peek call so it can't hang the accept/decline prompt** —
  `tryRedeem()`'s `peekPlayerInvite()` call (added by `feat/invite-peek-campaign-name`) had no timeout;
  an unresolved request left the whole accept/decline `confirm()` unreachable, silently — no error, no
  fallback, the prompt just never appeared. Caught via `testing/scripts/chargen-flows-e2e.mjs`'s
  "declining an invite is recoverable" check, which had failed identically on every `preview`→`main`
  promotion attempt since 2026-08-10 (PRs #402 through #417, all closed unmerged rather than fixed).
  Wrapped the peek in a 3000ms `Promise.race`, falling back to the existing nameless-prompt path (the
  same one already used for a caught peek failure) if it doesn't resolve in time — real players on a
  slow/flaky connection get the same protection. Test's own wait bumped to clear the new bound.
  `chargen-flows-e2e.mjs` 46/46, `engine-parity-ci.mjs` 30/0 (untouched — no `js/engine.js`/`DATA` change).
- **2026-08-11 · chore(version): BUILD → v1.413** — owner-requested bump outside the normal
  preview→main promotion-PR cadence (PR #413 merged claim-link straight to `main`, bypassing that
  flow; see the session's own note on the mismatch this created). Carried the major number (`1`)
  forward unchanged, PR-number half set to `413` per `docs/VERSION-SYNC.md`'s convention. Mirrored in
  all three tools (`PACT-CharGen-Webtool.html` line-1 comment/`<title>`/header `.sub`,
  `PACT-Live-Char-Sheet.html` line-1 comment, `DM-Console.html`'s `TOOL_VERSION`); `index.html`
  untouched (reads `BUILD` live). `DATA.version` unchanged. `tool-pricing-ci.mjs` 134/0.
- **2026-08-12 · docs: corrected `D-GH-2026-08-12-grit-steep-ladder`'s account of the bug brief** — its
  Context section claimed `pact-guide` had no Grit pricing function and that the brief's Python citation
  was actually `metamagic_ap()`. Both false: `py/pricing.py`'s `grit_ap()` has been `2*n` since
  2026-08-06, the divergence from engine.js was explicitly deliberate and documented there, and it had
  already been through two reversals (`D-2026-08-11-grit-pricing-correction`, then
  `-grit-steep-curve-final`). The error came from the home-server connector pointing at a retired copy of
  that project; fixed 2026-08-12 and re-verified against the live repo. The Grit change itself is
  unaffected and correct — it closes a known ~6-day divergence rather than making a fresh decision.
  Recorded as an Addendum on that record.
- **2026-08-12 · rules: Grit moves onto the Steep ladder — Nth purchase costs 2N** (`DATA.version`
  v0.342 → **v0.343**) — replaces the `[2,4,6,9,12,15,18]` table and its `m*(m+1)` extrapolation with a
  one-line `_gritPrice(n) => 2*n`. Owner's balance decision; also removes the only cubic-cumulative track
  in the game (every other `DATA` ladder already escalates linearly per purchase), and reuses the
  project's own existing name for this shape from `pact-guide/py/pricing.py`'s "Steep". Level-independence
  and the flat +1-per-purchase-past-CON-mod surcharge are both unchanged. No migration needed — verified
  against the live database that none of the 23 saved characters has a single Grit purchase.
  `testing/expected/` updated in the same change (CG-010 165 → 135, CG-011 197 → 167; the whole 30-AP
  delta is the Grit line, 147 → 117). `engine-parity-ci` 30/0, `tool-pricing-ci` 134/0. Supersedes the
  pricing half of `D-GH-2026-08-05-grit-ladder-correction`; recorded as
  `D-GH-2026-08-12-grit-steep-ladder`, whose Outstanding section tracks the guide reconciliation and the
  `pact-guide` version-drift fix.
- **2026-08-11 · fix: character claim-link tokens switched to plaintext storage** — owner decision,
  same day the feature shipped: "keep the plaintext, shown-once is fine for now." Flipped
  `character_claim` from the hash-only storage group (`dm`-invite bar) to the plaintext group
  (`player`-invite bar) in `campaign_invites_token_storage_check`, and rewrote
  `create_character_claim`/`redeem_character_claim` to store/look up the token directly, no
  `digest()` step. Zero `character_claim` rows existed yet, so this was a clean schema/RPC flip, not a
  data migration (`sql/migrations/2026-08-11-character-claim-plaintext-token.sql`, applied to the live
  Supabase project; `get_advisors` re-run clean). No client change needed. `tool-pricing-ci.mjs` 134/0.
  Recorded as an Addendum on `D-GH-2026-08-11-character-claim-link-copy-not-transfer`.
- **2026-08-11 · feat: DM hands off a character to a player via a claim link
  (`feat/character-ownership-claim-link`)** — a DM who owns a campaign-bound character (built/imported
  under their own account, then bound via the existing `bindCharacterToCampaign` — no new capability
  needed for that step) can now generate a single-use claim link from CharGen's ☁ Cloud menu; a player
  who redeems it gets their OWN new character, **copied** from the DM's (never a transfer — the source's
  `owner_id` is never written). New `campaign_invites` type `character_claim` (plaintext token storage,
  same bar as a player invite — see the follow-up entry immediately below and the decision record) plus
  two new RPCs, `create_character_claim`/`redeem_character_claim` (owner-of-source + DM-of-campaign gated
  to create; idempotent-on-repeat, single-use to redeem). DM-awarded `ap` carries over to the copy
  (recorded as its own `ap_awards` provenance row); the copy auto-binds to the source's campaign.
  CharGen-only in v1 (redemption via `?claim=` mirrors the existing `?invite=` flow); DM Console has no
  UI for this. Migration `sql/migrations/2026-08-11-character-claim-link.sql` applied to the live
  Supabase project; `get_advisors` clean after fixing a first-pass miss (the two new RPCs needed an
  explicit `revoke execute … from public` — Postgres grants EXECUTE to PUBLIC by default on every new
  function, same pattern every other RPC in `rls-policies.sql` already follows, just missed on the first
  apply). `tool-pricing-ci.mjs` 134/0, `engine-parity-ci.mjs` 30/0 (display/feature-only, `DATA.version`
  unchanged). Design record: `D-GH-2026-08-11-character-claim-link-copy-not-transfer` (Addendum,
  implementation).
- **2026-08-11 · docs: re-scoped `feat/character-ownership-claim-link` from transfer to copy** — the
  not-yet-started claim-link task now creates a new player-owned character row seeded from the DM's
  source character, instead of reassigning `owner_id` on the existing row. No RLS/ownership-model change
  needed; drops the task's risk from high to medium and removes the recommended cold-plan-review step.
  Recorded as `D-GH-2026-08-11-character-claim-link-copy-not-transfer`.
- **2026-08-11 · docs: dropped the "Port the AGENTS.md/skills scaffold to another repo" task** — removed
  from `docs/TASK_BOARD_NEXT.md` (owner: no longer relevant). No skill/scaffold work was done; this is a
  board-hygiene removal, not a graduation.
- **2026-08-11 · fix: keepalive scope narrowed back down + manual save routed through the push queue**
  — the two follow-ups tracked (not fixed) by the 2026-08-10 `/code-review ultra` cleanup, both resolved.
  (1) `feat/keepalive-scope-narrowing`: decided A2 (narrow, not accept-as-trade-off) — `withKeepalive()`
  is no longer called from the `pagehide` handler wrapping the whole settle-wait chain; each push attempt
  (the initial push and any chained retry) now opens its own narrow `withKeepalive()` span via a new
  `_cg/_lsKeepaliveWrap()` helper, called from inside `_cgCloudPushOnce()`/`_lsCloudPushOnce()` itself, so
  the shared `_keepaliveNext` flag no longer stays true for however long a retry chain takes — just for
  each attempt's own fetch. (2) `fix/manual-save-queue-bypass`: CharGen's `onSaveClick()`/
  `onJoinCampaignClick()` and Live Sheet's manual "☁ Save to cloud" button called `saveCharacter()`
  directly, racing the autosave queue's own push for the same character — fixed with a shared
  `_cg/_lsQueuedSaveCharacter()` helper that waits for any in-flight push to settle and shares the
  autosave queue's own busy-flag coordination, while keeping each caller's own success/failure UI (unlike
  the silent autosave path). Both fixes recorded as Addenda on `D-GH-2026-08-08-chargen-cloud-autosave-
  flush.md`. `testing/scripts/autosave-flush-latest-push-ci.mjs` extended to 14/14 (was 8/8): the pagehide
  scenario now proves per-attempt narrow spans (not one wide span) via a two-retry chain, and a new
  scenario proves a manual save waits for an in-flight autosave push instead of racing it.
- **2026-08-10 · docs/fix: `/code-review ultra` cleanup on the autosave-flush fix** — two confirmed findings
  fixed directly: (1) the fix's own code comments and CHANGELOG cited a decision-record ID
  (`D-GH-2026-08-10-autosave-flush-latest-push`) that was never actually created — corrected into a proper
  Addendum on the existing, directly-related `D-GH-2026-08-08-chargen-cloud-autosave-flush` record instead
  of inventing a new one; (2) `_cgFlushCloudSaveNow()`/`_lsFlushCloudSaveNow()`'s `if(!settled)
  return Promise.resolve();` guard was dead code — `_cgCloudPush()`/`_lsCloudPush()` unconditionally set
  `_cgCloudSaveBusy=true` before returning on every path, so `_cgCloudPushSettled()`/`_lsCloudPushSettled()`
  can never observe it false at that call site — removed, with a comment explaining why re-adding it would
  again be dead. Two other findings from the same review (the `withKeepalive()` scope now spanning
  multiple retries instead of one push; the manual "☁ Save to cloud" button bypassing the push queue
  entirely) are real but represent design/scope calls, not drive-by fixes — tracked as
  `feat/keepalive-scope-narrowing` and `fix/manual-save-queue-bypass` on `docs/TASK_BOARD_NEXT.md`.
  `engine-parity-ci.mjs` 30/0, `tool-pricing-ci.mjs` 134/0, `autosave-flush-latest-push-ci.mjs` 8/8 —
  all unaffected.
- **2026-08-10 · fix(tools): cloud-autosave flush waits for the LATEST push, not a stale one** —
  `fix/autosave-flush-latest-push`, from `/sweep-code-tasks`. Found by `/code-review ultra` on the B3
  branch: when a cloud autosave push was already in flight, `_cgCloudPush()`/`_lsCloudPush()`'s busy
  branch returned that STALE push's promise instead of the retry `_cgCloudSaveAgain` queues — so a
  deliberate tool-switch flush (`switchToLiveSheet`/`switchToCharGen`) raced against the wrong promise,
  navigated away, and the real retry (carrying whatever the latest edit actually was) fired later with
  no keepalive, right as the page tore down. Fixed in both tools identically: the busy branch now chains
  onto a new read-only `_cgCloudPushSettled()`/`_lsCloudPushSettled()` waiter that recursively tracks
  however many retries the queue actually needs (without itself triggering any — that would spuriously
  re-save unchanged state forever); the flush and the `pagehide` keepalive wrapper both await that
  instead of the push's own return value. New differential test,
  `testing/scripts/autosave-flush-latest-push-ci.mjs` — extracts the real push-queue functions from both
  tools' source, confirms a hand-reverted pre-fix copy actually reproduces the bug, then confirms the
  live code doesn't: 8/8. `engine-parity-ci.mjs` 30/0, `tool-pricing-ci.mjs` 134/0 — unaffected. See the
  Addendum on `D-GH-2026-08-08-chargen-cloud-autosave-flush` (this fix's own decision record cited an ID
  that didn't exist until a `/code-review ultra` pass caught it — corrected there, not a new record).
- **2026-08-10 · feat(engine): ban a class as a 2nd-origin-only pick** — `feat/banned-2nd-origin-class`,
  from `/sweep-code-tasks`. Mirrors the existing species asymmetric-ban pattern
  (`bannedOriginSpecies`/species2): `js/engine.js`'s `validate()` gains a new `bannedOriginClasses2` rule
  field, checked only against `originClass2`, alongside the existing `bannedOriginClasses` (which already
  bans a class in both slots — unaffected, still enforced). New "Banned as 2nd origin classes" grid in DM
  Console's Campaign Rules panel; CharGen's `oclass2` picker now live-filters against both
  `originClasses`/`originClasses2` (mirroring `spec2`'s `species`/`originSpecies` filter). No existing
  fixture sets the new field, so `compute()` output is unchanged for every current fixture — no
  `DATA.version` bump. Verified directly (4 cases: primary use allowed, 2nd-origin use rejected, existing
  symmetric ban still fires in both slots, `RULE_BAN_FIELDS` mapping present).
  `engine-parity-ci.mjs` 30/0, `tool-pricing-ci.mjs` 134/0 — both unaffected.
- **2026-08-10 · chore(ci): scheduled Supabase keep-alive workflow** — `chore/supabase-keep-alive`, from
  `/sweep-code-tasks`. The free-tier project auto-paused from inactivity on 2026-07-25, silently breaking
  login/register app-wide until manually restored. New `.github/workflows/supabase-keepalive.yml` pings
  Supabase's `/auth/v1/health` endpoint every 3 days using only the already-committed anon key (URL/key
  read directly from `js/supabase-client.js`, no duplicated literal). Chosen over a direct table read
  because every RLS-protected table correctly 401s an anonymous request, which would make a real outage
  indistinguishable from healthy RLS in the workflow's own pass/fail check. The ping call itself is
  confirmed live (a direct `curl` against the real project returns 200); the GitHub Actions wrapper
  (schedule/manual-dispatch) can't be confirmed from a non-default branch — GitHub 404s a dispatch
  attempt until the workflow lands on `preview` — see `D-GH-2026-08-10-supabase-keep-alive`'s "Verified"
  section for why, not glossed over. `get_advisors(security)` no new findings.
- **2026-08-10 · fix(campaign): `dm_edit_character_log` cross-validates a boon grant's buy/award
  amounts** — `fix/dm-edit-boon-amount-check`, from `/sweep-code-tasks`. Flagged by `/code-review ultra`
  on PR #403 and deliberately deferred at the time (see `D-GH-2026-08-10-dm-edit-events`'s addenda): the
  RPC allowlisted event type/cat but never checked a boon grant's `buy` cost against its accompanying
  `award` amount, so the "net 0 to spendable AP" promise DM Console's tooltip and the migration's own
  header comment both make was enforced only by the client always sending the pair together. Now
  FIFO-matched by value (mirroring `js/engine.js`'s `activeEvents()` `boughtOff`/`boonRemoved` pattern) —
  a mismatched or unmatched boon-buy is rejected; a standalone `award` stays permitted, since `award_ap()`
  already lets any campaign DM grant arbitrary AP unconditionally, so this was never a new privilege, only
  a correctness gap. Verified against 4 cases directly on the live function body; `get_advisors(security)`
  no new findings; `tool-pricing-ci.mjs` 134/0; `engine-parity-ci.mjs` unaffected, 30/0.
- **2026-08-10 · fix(sync): reconcile()'s own recovery push is now tracked by `_pushInFlight` too** —
  `fix/reconcile-push-inflight-tracking`, from `/sweep-code-tasks`. `js/sync.js`'s `reconcile()`
  `localNewer` branch called `pushCharacter()` directly, unlike `saveCharacter()`'s own already-tracked
  push — so while a device's offline edit was being recovered at boot/reconnect, `getSyncState(id)` had
  no way to see it as `SAVING` and fell through to a stale dirty/conflict/idle read for the whole
  duration. Fixed by wrapping it in `_pushInFlight.add()`/`.delete()`, mirroring `saveCharacter()`
  exactly. New differential test in `testing/scripts/sync-state-machine-ci.mjs` (confirmed to fail
  against the pre-fix code, not just pass vacuously): 24/0. `engine-parity-ci.mjs` 30/0,
  `sync-concurrency-ci.mjs` 12/0, `sync-autosave-toggle-ci.mjs` 4/0 — all unaffected.
- **2026-08-10 · feat(livesheet): show a signed-in player any campaign custom fields their DM marked
  visible** — `feat/custom-fields-player-display`, the player-facing follow-up to the DM Console custom
  fields feature below. The Live Sheet now calls the existing `get_character_visible_fields()` RPC on
  load and on an explicit cloud Load, and shows a `From your DM:` segment on the character sheet with
  each visible field's DM-set label and value (nothing rendered when none are configured/visible).
  Gated off for a DM's own read-only `?viewChar=` peek. `js/dm.js` gains `getVisibleCustomFields()`,
  co-located with the existing `setCharacterCustomFields()`. `engine-parity-ci.mjs` unaffected, 30/0. See
  the Addendum on `D-GH-2026-08-10-dm-custom-character-fields`.
- **2026-08-10 · feat(dm-console): campaign-level custom character fields + a Customisable card view**
  — owner request. DM Console gains up to 4 campaign-wide custom fields (2 numeric, 2 text) under
  Campaign Rules, each with a name and a per-field "visible to players" toggle (default OFF); a DM sets
  each character's values from that character's DM tools. A new 3rd view mode — "🧩 Customisable view"
  — lets a DM arrange 6 boxes per roster card from a catalog of built-in stats and the campaign's custom
  fields, persisted per-device (localStorage), same pattern as Table view's hidden-columns preference.
  Definitions ride the existing `campaigns.rules` jsonb (no new column); values ride a new
  `character_dm_notes.custom_fields` jsonb column (same DM-only table/RLS as player-name label/notes).
  The "visible to players" flag is enforced by a new `get_character_visible_fields()` SECURITY DEFINER
  RPC — no tool UI calls it yet (DM Console doesn't need to, and no player-facing surface exists yet);
  see `feat/custom-fields-player-display` on `docs/TASK_BOARD_NEXT.md`. `engine-parity-ci.mjs` unaffected,
  30/0. See `D-GH-2026-08-10-dm-custom-character-fields`.
- **2026-08-10 · feat(chargen): random name pools roughly tripled/quadrupled** — owner report: "i keep
  getting the same name." Each of the six naming styles held only ~12-16 first / ~8-10 last names;
  expanded every style to ≥40 first / ≥25 last, additively (originals kept, matching theme per style).
  `genName()` itself unchanged. `tool-pricing-ci.mjs` 134/0; `engine-parity-ci.mjs` unaffected, 30/0. See
  `D-GH-2026-08-10-expand-random-names`.
- **2026-08-10 · feat(chargen): two free-form, player-labeled custom description fields** — owner request.
  Own label, own sentence, no fixed prompt/random table (so no 🎲/🔒, unlike every other Appearance
  field). Rides the existing `ap_`-prefix patch delegation with no new commit wiring; the build→DOM
  reload direction needed its own fix (a real gap caught before shipping — a loaded character would have
  shown blank custom fields and the next edit would have overwritten the real saved value). See
  `D-GH-2026-08-10-custom-appearance-fields`.

- **2026-08-10 · fix(chargen): 🎲 Randomise all / 🪶 Auto-write now actually save the description they
  generate** — found live on a real Amble character: both set the DOM field's `.value` directly with no
  LOG write, so the randomised appearance/description looked correct on screen but vanished on the next
  reload, save, or Live Sheet ⇆ CharGen switch. A second, adjacent code path to
  `fix/sheet-tab-appearance-not-persisted` (the Setup-tab randomiser, not the Sheet tab's manual typing,
  which that fix already covers) that never got the same fix. Now routes both through the existing
  `_shCommitAppearanceField()`, skipping the commit while `_histSuspended` so `randomizeRoll()`'s "🎲
  Random" full-character button (which already does its own full LOG resync right after) doesn't waste
  ~20 redundant fold+compute passes per click (`/code-review` finding, fixed pre-merge — confirmed 28
  wasted calls before the guard, 0 after). New regression tests (confirmed to fail pre-fix, pass post-fix
  by hand-reverting each one). `tool-pricing-ci.mjs` 129/0; `engine-parity-ci.mjs` unaffected, 30/0. See
  `D-GH-2026-08-10-randomise-appearance-not-persisted`.

- **2026-08-10 · fix(dm-console, live-sheet): two `/code-review ultra` findings from PR #403's pre-merge
  review, fixed before merge** — (1) DM Console's ≤700px roster card fallback (`renderCards()`, a
  different code path from the table view's own `COLS`) still showed the raw, DM-AP-blind `earned`
  figure instead of `earnedTotal` — a DM viewing a fully-DM-funded character on a narrow screen would
  have seen the exact "AP Earned 0" bug `feat/ap-model-reconcile` was written to fix. (2) The Live
  Sheet's History & ledger only checked `boughtOff` (drawbacks) when marking a row `.dead` — a
  DM-removed boon's original purchase row stayed styled as a normal, active purchase; now reads
  `activeEvents().boonRemoved` too, mirroring the existing FIFO-by-purchase drawback logic (a retake
  afterward correctly stays live). Addenda added to `D-GH-2026-08-10-ap-model-reconcile` and
  `D-GH-2026-08-10-dm-edit-events`. `tool-pricing-ci.mjs` 125/0 (2 new checks, new
  `window._dmRenderCardsTest` seam); `engine-parity-ci.mjs` unaffected, 30/0 — both fixes are
  display-only.
  **Flagged, not fixed — filed as a follow-up task:** the same review found `dm_edit_character_log()`
  never cross-validates a DM-granted boon's paired `buy`/`award` amounts server-side; the "always net 0"
  guarantee is enforced by DM Console's client code only. Already an explicitly-documented trade-off in
  the migration's own header comment (an `award` alone is exactly what `award_ap()` already permits a DM
  to do through a separate path, so this isn't a new privilege) — not fixed in this PR to avoid scope
  creep into a new migration; see the task board for the follow-up (`/add-code-task` was unavailable in
  this session — added via the documented fallback instead).
- **2026-08-10 · fix(chargen): a persistent header banner marks a DM-copy character** — the only signal
  that a loaded character was a DM-viewed copy used to be a one-time `flash()` at open plus the
  `"(DM copy)"` name suffix, both easy to miss. New pinned `#cgDmCopyBanner` in the sticky header,
  styled **purple** (`#5a3d99`, matching the family of the existing `#cgInviteBanner` in the same header
  stack) rather than the red/orange issue-severity palette — this isn't a build-quality signal, so it
  doesn't borrow that language. Driven off the same name-suffix check on every render so it also
  reappears on a later reload of the same copy. Addendum to `D-GH-2026-08-10-chargen-dm-view`.
  `tool-pricing-ci.mjs` 123/0 (3 checks); display-only, no `DATA.version` change.
- **2026-08-10 · fix(chargen): DM AP no longer silently reads 0 after a Live Sheet → CharGen switch** —
  found live on a real Amble character. `_cgAdoptEnvelopeBinding()` gated its DM-AP refresh on
  `window._cloudSignedIn`, which the `'campaign-ready'` listener resets to `false` the instant it fires
  and only asynchronously re-sets afterward — a race that could skip the refresh for a genuinely
  signed-in user on either boot path (a Live Sheet handoff or a plain reload), while `_dmApStatus` still
  independently resolved to `'active'` — exactly the "🛡 0 AP — DM only" symptom. Now asks the auth
  bridge directly (`currentSession()`) instead, matching `_cgConsumeViewChar()`'s existing pattern. New
  regression test (confirmed to fail pre-fix, pass post-fix by hand-reverting). `tool-pricing-ci.mjs`
  126/0; `engine-parity-ci.mjs` unaffected, 30/0. See `D-GH-2026-08-10-dm-ap-lost-on-handoff`.
- **2026-08-10 · feat(engine): AP ledger shows what was LOST — bought-off drawbacks, DM-removed boons**
  (`DATA.version` v0.341 → v0.342) — a bought-off drawback or DM-removed boon drops out of `_replay()`'s
  fold entirely, so `compute()` (pure over the build) had NO way to show its cost — a drawback taken for
  2 then bought off for 6 appeared in no ledger line, while `economy()` correctly reported 6 spent. New
  "Lost purchases" ledger line (owner's chosen shape: adds to `compute().total`), itemising
  `"Bought off — X"`/`"Removed by DM — X"` rows. `activeEvents()` gained a `lost` key, built in its
  existing FIFO buyoff/removal-match pass; `_replay()` stamps it onto `b._lostPurchases` (same pattern as
  `_raceTraitLocked`/`_vigorRankTier`) for `compute()` to itemise — `compute()` still never reads the log
  directly. A repurchase (bought, bought off, bought again) shows both the active retake and the lost
  buyoff at once, by construction. Both tools' ledger renderers already itemise any line generically, so
  no new renderer plumbing was needed — just grouping (`LGROUPS`/`LG`/`SECTIONS`) and an explain-text
  entry in CharGen. Three existing fixtures' totals moved (EV-010 +6, EV-017 +6, EV-018 +25) —
  `testing/expected/expected-results.csv` updated; `engine-parity-ci.mjs` 30/0; `tool-pricing-ci.mjs`
  120/0 (4 new checks asserting the reconciliation identity `compute().total === economy().spent` for the
  single-buyoff no-repurchase case). See `D-GH-2026-08-10-ledger-show-lost-purchases`.
- **2026-08-10 · feat(campaign): Earned Lv accounts for DM AP; frozen-vs-repriced disagreement is now
  labelled** — a fully DM-funded character used to read "Earned Lv 0" with "0 earned" because
  `trackLevel(eco.earned)` can only see the character's own log — DM AP lives only on `characters.ap`.
  New pure `earnedWithDm(eco, opts)` export in `js/engine.js` (display-time composition, mirrors
  `compute()`'s own spendable formula; `economy()` itself untouched) bridged into both tools via the
  existing `window._engineFold` pattern. Live Sheet's Earned Lv/next-level and DM Console's apLevel/
  `earnedTotal` (detail summary + sortable roster column) now read from it. The card's frozen "AP left"
  vs the AP Ledger's repriced total staying allowed to disagree was already decided (G1, #355) — now
  labelled on both surfaces in both tools so a DM/player can tell which question each answers, rather
  than reading it as a bug. Low-tier campaigns (e.g. Amble's 36 AP, below the Standard curve's L0)
  reading below-curve Track-Level confirmed intended; no clamping added. `tool-pricing-ci.mjs` 116/0
  (new `window._dmAnalyzeTest` seam for DM Console); `engine-parity-ci.mjs` unaffected, 30/0. Fenwick
  Copperkettle's exact real numbers were not reproducible as a fixture in this session (no access to the
  real campaign data) — recorded explicitly in `D-GH-2026-08-10-ap-model-reconcile` rather than assumed
  pinned.
- **2026-08-10 · feat(campaign): a DM adds/removes boons and imposes drawbacks, recorded as a DM edit** —
  New `dm_edit_character_log` SECURITY DEFINER RPC — the only DM write path onto a player's
  `characters.stats`, server-stamped `seq`/`ts`/`dmEdit`/`dmId` (unforgeable for a different account),
  allowlisted to boon/drawback events only. Neutrality invariant (a DM edit never changes the player's
  spendable AP) holds via existing mechanics for boon grants (matched `[buy,award]` pair, one atomic
  write) and DM-imposed drawbacks (`cost:0`); boon removal is the one `js/engine.js` change — a new
  `boonRemoved` FIFO-by-purchase map (mirroring `D-GH-2026-08-06-buyoff-keyed-by-event`'s fix), no
  refund, the purchase stays visible and re-buyable. New fixture EV-018; no `DATA.version` bump (purely
  additive, all 30 fixtures unchanged). DM Console gained grant-boon/remove-boon/impose-drawback
  controls on the roster card DM-tools section, gated behind the existing archived-peek write-block. The
  Live Sheet renders DM-marked events distinctly, enforces its own undo barrier (mirroring the AP-award
  one), and `buyoffDrawback()` now honours a DM-imposed drawback's own locked/removal-cost flags instead
  of the unconditional 3×. CharGen gets the undo barrier only — no per-event history view to mark
  (documented scope boundary in `D-GH-2026-08-10-dm-edit-events`). Applied to the live Supabase project;
  advisor confirms no new finding class; grants and AP-integrity-trigger compatibility verified directly.
  `tool-pricing-ci.mjs` 113/0, `engine-parity-ci.mjs` 30/0. A full live end-to-end (two real distinct
  sessions) was not run in this session.
- **2026-08-10 · feat(campaign): a DM opens a roster character in CharGen via a safe copy** —
  DM Console's roster card gained "📋 Copy to CharGen" beside the existing read-only "👁 View" (Live
  Sheet). Per the owner's stated preference (`D-GH-2026-08-10-chargen-dm-view`), this is a fresh,
  freely-editable COPY under the DM's own account, not a locked read-only mode — safe by construction
  rather than by a twelve-entry-point guard list. Copy id is `SHA-256(source id, viewing DM's own id)`
  formatted as a UUID: deterministic per (source, DM) pair (overwrite-per-source, no schema change),
  structurally asserted to never equal the source id — the hazard the task doc called "the single thing
  most likely to be got wrong, and it destroys player data when it is." Cloud-saved immediately, labelled
  `"<name> (DM copy)"`, explicitly not campaign-bound. Uses `peekCharacter()`, never `loadCharacter()`
  (no ownership-check-free local cache leak). Gated in `tool-pricing-ci.mjs` (collision hazard + button
  wiring + real click routing); the full fetch→copy→save round trip needs a live signed-in session and
  was not run in this session. No `DATA.version`/`js/engine.js` change.
- **2026-08-10 · feat(campaign): invite links can name their campaign before redemption** — new
  `peek_player_invite(token)` SECURITY DEFINER RPC (`sql/migrations/2026-08-10-peek-player-invite.sql`)
  resolves a player-invite token to `{campaign_name, valid}` without redeeming it, mirroring
  `redeem_player_invite`'s own lookup/validity criteria. Scoped `authenticated`-only (not anon-callable) —
  `D-GH-2026-08-10-invite-peek-auth-scope` — since `feat/invite-rate-limiting` hasn't landed yet; the
  signed-out "dead link looks live" half of the original finding stays open, filed as
  `feat/invite-peek-signed-out-banner`. CharGen's `tryRedeem()` now names the campaign in its accept
  `confirm()` and short-circuits with a clear message for an already-dead token, before ever showing that
  prompt. Applied to the live Supabase project; advisor confirms no new finding class (same WARN every
  other authenticated-only RPC in this schema carries); grants verified directly (`authenticated` +
  owner only). `cloud-e2e` coverage for the full redemption flow needs a live signed-in session and
  was not run in this session.
- **2026-08-10 · fix(tools): unify the unnamed-character default to `'New Character'` everywhere** —
  DM Console converted the DB's own `'New Character'` default back to blank and substituted a different
  literal (`'Unnamed character'`) at display time, so a freshly-redeemed, never-named character showed
  one word to the player and another to their DM. Also unified every OTHER divergent placeholder for the
  same "no name yet" state — `'Unnamed Hero'`/`'Unnamed hero'`/`'Unnamed'`/`'(unnamed)'` across CharGen,
  the Live Sheet, DM Console's local-import path, `tools/characters.html`, and `index.html`'s
  recent-characters cards — onto the single stored convention, per D-GH-2026-08-10-unnamed-character-default.
  Display-only; no `DATA.version` change; existing characters unaffected (only what renders for the
  absent-name state changed, never what gets written). New DM Console coverage added to
  `tool-pricing-ci.mjs` (confirmed red against the original divergence first) since `dm-console-ui-e2e.mjs`
  (Playwright) couldn't run in this session.
- **2026-08-10 · fix(dm-console): give the three add-player routes a visible hierarchy** — the invite
  link (new character) is now the default, badged "✓ Usual choice — new player, no character yet" and
  shown first; the reusable Players code follows, captioned for the "already has a character" case; the
  local-file-import panel gained its own caption distinguishing it as a read-only viewer, not a
  campaign-roster join. Decision recorded in `D-GH-2026-08-10-add-player-hierarchy`. Copy/ordering-only;
  no `DATA.version` change. `dm-console-ui-e2e.mjs` (Playwright) couldn't run in this session — verified
  instead with an ad-hoc CDP check plus a headless screenshot.
- **2026-08-10 · fix(livesheet): History & ledger now surfaces derived species-pack costs** — Heritage
  pack / 2nd-origin-species pack are lines `compute()` derives from `b.species`/`b.species2` (per
  `fix/species-pack-not-charged`), never LOG events, so the printable sheet's AP Ledger priced them
  correctly while the event-only History & ledger panel showed only the 4 individual 0-cost racial-trait
  buy events with no sign of the AP the pack actually cost. History now renders the same `r.lines`
  entries as distinct italic "derived" rows, and each pack-included trait row is marked "· pack" (read
  from `DATA.racial[...].pack`, not inferred from cost) so a 0 AP line never reads as free. Gated in
  `tool-pricing-ci.mjs` against the Anders Tealeaf shape (Halfling + Gnome, 4 pack traits, 15 AP total)
  plus a regression guard that a genuinely-bought non-pack trait is never mislabelled. Display-only; no
  `DATA.version` change.
- **2026-08-10 · fix(chargen): rules-label `<title>` no longer clobbers the web-tool build version** —
  CharGen's `#cgPactver` chip was already reading `DATA.version` live (found already fixed, contrary to
  the stale task-board entry that filed this as still-hardcoded); the real live bug was in the
  `engine-ready` title-rewrite, which hardcoded a stale `v0.203` literal over the correct BUILD number
  every time it ran. Now reads the web-tool half back from the header `.sub` label (the same
  manually-mirrored-at-promotion value already on screen) instead of inventing a second copy of it.
  `docs/VERSION-SYNC.md` gained a "rules version display sites" table confirming all three tools read
  `DATA.version` live — no rules-label edit is ever needed at a rules bump. Gate added to
  `tool-pricing-ci.mjs` (confirmed red against the reverted wiring first). Display-only; no
  `DATA.version`/`BUILD` change.
- **2026-08-10 · chore(version): promote `preview` → `main`, `BUILD` v1.398 → v1.402 (PR #402)** —
  regular merge commit (never squash, per `docs/VERSION-SYNC.md`). Carries the AP-ledger integrity
  triggers below into production. `dm-console-ui`'s CI failure on the version-bump commit was flake, not
  a regression — confirmed the only diff was the `TOOL_VERSION` string and this same suite had
  flaked-then-passed on a nearby commit before; re-ran the job rather than pushing a speculative fix.
  Tagged `v1.402`.
- **2026-08-10 · feat(campaign): server-side AP-ledger integrity backstop for campaign-bound
  characters** — two BEFORE UPDATE Postgres triggers on `characters`
  (`sql/migrations/2026-08-10-campaign-ap-log-integrity.sql`), following a 7-AI external review of
  `pact-ap-overspend-problem.txt` (`z-cold/` on the `zcold` branch). `pact_enforce_ap_budget_consistency`
  sums frozen `buy`(non-patch)/`buyoff`/`names`/`award` LOG fields (never re-derives a price) and rejects
  a write only if that sum both increases and exceeds spendable AP, grandfathering already-over-budget
  characters. `pact_enforce_locked_history` makes Live Sheet's own `undo()` boundary — everything
  at-or-before the last non-discretionary, non-seed `award` event — append-only server-side, with
  `cat:'patch'` events (CharGen's `replacePatchSlot()`, Live Sheet's `_shCommitAppearanceField`) exempt so
  appearance/identity edits keep working. Closes the gap the 2026-08-09 client-side gate below can't: a
  raw PostgREST write bypassing the UI entirely. `/code-review ultra` on the PR found two real bypasses
  (a `disc`-flip that silently disabled the locked-history trigger; a `cat:'patch'` negative-cost trick
  masking real overspend) and fixing the first surfaced a third (CharGen's budget-seed award churning the
  lock boundary forward during ordinary drafting) — all three fixed and re-verified before merge, none
  left as follow-ups. Applied to the live project and verified end-to-end against disposable test data
  (never touching real characters); see `D-GH-2026-08-10-campaign-ap-log-integrity`. The Edge Function
  idea from the same review batch was deferred to the task board (`feat/ap-edge-function-validation`).
- **2026-08-09 · chore(repo): `z-cold`/`z-uploads` drop-zone folders, auto-synced to a dedicated
  `zcold` branch** — external background script watches both folders and auto-pushes anything
  dropped in them within seconds, via a git worktree + junction (not tracked on `preview`). See
  `D-GH-2026-08-09-zcold-autosync-setup`.
- **2026-08-09 · feat(campaign): block cloud save for campaign-bound characters over AP budget** —
  new per-campaign `rules.enforceApBudget` toggle (default true; jsonb key inside `campaigns.rules`, no
  migration/RLS change) blocks a campaign-bound character's *cloud* save — manual "Save to cloud" and
  autosave, in both CharGen and Live Sheet — once `compute()`'s `remaining < 0`. Local file Save is
  never affected either way, and neither is DM Console (no save path of its own). Client-side only,
  deliberately, mirroring `validate()`'s existing banned-item enforcement — `compute()` itself needed no
  change, `remaining < 0` already meant "over budget." Manual save shows a clear alert (over budget by N
  AP, DM has enforcement on) and never attempts the push; autosave skips silently after one warning per
  session, mirroring the existing `_cgConflictWarned`/`_lsConflictWarned` pattern exactly so a blocked
  debounce cycle isn't noise. Grandfathered: turning the setting on never retroactively touches an
  already-over-budget character. DM Console's new toggle (`tools/DM-Console.html`) copies the existing
  "ignore player-entered AP" lock-guarded checkbox+button pattern verbatim, and is threaded into the big
  "Save rules" button's own object literal so a routine rules save doesn't silently revert it (same
  treatment `dmNotes` already gets). 7 new gate assertions across both tools in
  `testing/scripts/tool-pricing-ci.mjs` (83/0 total; `engine-parity` 29/0 unaffected — `js/engine.js`
  untouched), isolating the gating logic from real AP-pricing arithmetic via a stubbed `compute()`.
  Confirmed red first: reverting only the two tool-file changes threw `ReferenceError:
  _lsOverApBudget is not defined` and failed the gate. Not verified in this session: the manual-save
  button end-to-end (its Cloud menu only renders once signed in, which this CDP harness can't do — the
  separate "Cloud (signed-in) e2e" CI check's job) and DM Console's new toggle UI behaviourally (no local
  harness covers that tool; its script blocks were confirmed to parse with no syntax errors). Graduates
  `feat/campaign-ap-budget-enforce` off `docs/TASK_BOARD_NEXT.md`. See
  `decisions/2026/D-GH-2026-08-09-campaign-ap-budget-enforce.md` for the full record.

- **2026-08-09 · fix(chargen,livesheet): the Sheet tab's Description/Appearance/Background fields now
  actually save** — owner report, live: *"when i go from chargen to live sheet and back, all the
  character descriptions disappear. They don't seem to save to the cloud file either when i click save."*
  Root cause: the fillable "📋 Sheet" tab's Appearance grid and Background & Personality block
  (gender/age/height/build/hair/eyes/skin/marks/voice/hometown/faith/ambition/fear/prized/companion/
  Description) are real `b.appearance` data, but were rendered through the same
  local-`localStorage`-scratchpad mechanism (`csSave`/`csLoad`) as genuinely scratch, no-LOG-concept
  fields (Player Name, Alignment, Notes, spell trackers) — and that scratchpad is keyed **separately per
  tool** (`pactSheetStore:chargen` vs `pactSheetStore:livesheet`). An edit on the Sheet tab never touched
  the LOG, so it was never part of what cloud Save actually sends
  (`{schema,rules,name,LOG,SEQ,id,campaignId}`), and reopening the character in the other tool read from
  an empty, different-namespace scratchpad — falling back to the real (unedited) LOG value, which looked
  exactly like the edit had vanished. Worse for Live Sheet specifically: it has no Setup-panel equivalent
  of CharGen's, so the Sheet tab is the *only* place these fields are ever edited there — every such edit
  was unconditionally lost on close, not merely on a tool switch.
  Fixed by routing those 16 fields into the real LOG instead: CharGen reuses its existing
  `PATCH_SLOTS.APPEARANCE`/`_cgSyncPatchSlot()` mechanism (the same one its own Setup panel already
  uses, so the two views can't disagree); Live Sheet gained a new `_shCommitAppearanceField()` that
  replaces the latest existing appearance-patch LOG event in place (appends one if none exists) rather
  than appending a fresh event on every edit — position-stable, so it can't move the ledger line and
  can't land at the end of the LOG where `undo()` could eat it instead of the player's last real
  purchase. Both merge the edited field into the FULL current appearance object first, so fields the
  Sheet doesn't show (nose, demeanour, quirk, likes, dislikes, father, mother, profession, familyfor,
  famevent, secret, drink) survive untouched — a naive subset-only write would have silently wiped them.
  `hydrateSheet()` now always paints these 16 fields from the live LOG value, never a stale local-scratch
  override, so this view can no longer silently diverge from what Save/cloud-sync actually persists.
  Pre-existing scratchpad data from before this fix is not migrated — there is no reliable way to know
  whether it was ever the intended value, so the LOG (cloud-synced, cross-tool) is the only trustworthy
  fallback. 4 new gate assertions per tool (8 total) in `testing/scripts/tool-pricing-ci.mjs` (76/0 total,
  `engine-parity` 29/0 unaffected — `js/engine.js` untouched), confirmed red first: reverting only the
  two tool-file changes threw `ReferenceError: _shCommitAppearanceField is not defined` and failed the
  gate. See `decisions/2026/D-GH-2026-08-09-sheet-tab-appearance-not-persisted.md` for the full record.

- **2026-08-09 · docs(tasks): remove stale `feat/creation-vs-awarded-ap` entry from `TASK_BOARD_NOW.md`** —
  picked up via `/run-code-task-jc` and found already fully shipped: the level+track selectors, the
  creation/awarded AP split, and `#budget` as a plain number input all landed 2026-08-05 (see this file's
  2026-08-05 entry and `decisions/2026/D-GH-2026-08-05-creation-vs-awarded-ap.md`); the one open question
  the board task still listed — removing `_buildEventBurst`'s blanket `noLock` tagging — was answered
  differently and closed 2026-08-06 (`D-GH-2026-08-06-creation-lock-survives-reload.md`: the owner kept
  the tagging and had CharGen append an explicit `creationLocked` event instead). No code change; the
  board entry was a stale duplicate of already-completed, already-documented work.
- **2026-08-09 · fix(chargen): a campaign-bound handoff/autosave resolves its DM AP instead of getting
  stuck "unavailable"** — closes the second half of `fix/campaign-binding-survives-reload` (the refresh
  half closed 2026-08-06; this is the "Live Sheet → CharGen switch" half, previously an unconfirmed
  boot-order hypothesis). Confirmed by tracing actual script execution order rather than a live browser
  (unavailable in this session, same constraint the board task flagged): CharGen has two
  `<script type="module">` blocks, deliberately kept separate — the first bridges `js/engine.js` and
  fires `engine-ready`; the second bridges auth/campaign/sync and fires `campaign-ready` **after** setting
  `window._campaignBridge`/`window._syncBridge`. Module scripts execute in document order, and
  `_cgBoot()` — which runs both `_cgConsumeHandoff()` (the Live Sheet handoff) and `_cgRestoreAutosave()`
  (a plain reload) — is wired to the `engine-ready` listener, so it always runs **before** the second
  module has even started. `_cgAdoptEnvelopeBinding()`, called from both paths, read
  `window._campaignBridge` to resolve a bound character's DM AP; with the bridge still `undefined`, the
  `C && await C.getCampaign(...)` guard silently short-circuited, `_dmApStatus` was left at the interim
  `'unavailable'` state, and nothing ever re-ran the resolve — so it stuck there permanently, not just
  for the handoff switch but for **any plain CharGen reload of a campaign-bound character's autosave**,
  which the board task hadn't identified as in scope. Fixed at the one shared function: if
  `window._campaignBridge` isn't set yet, await a one-shot `campaign-ready` listener before resolving —
  the "re-run it when that event arrives" option the board task named as acceptable, chosen over
  reordering the whole boot sequence because it's the smaller, more localized change. New gate assertion
  in `testing/scripts/tool-pricing-ci.mjs` simulates the exact race directly (no sign-in needed — it's a
  pure timing bug, not an auth one): stub the bridge as `undefined`, call `_cgAdoptEnvelopeBinding()`,
  assert it's still pending 50ms later, then set the bridge and fire `campaign-ready`, assert it resolves.
  Confirmed red against a revert of just the await-gate before trusting it. `engine-parity` (29/0) and the
  rest of `tool-pricing-ci` (68/0 total) unaffected — `js/engine.js` untouched. Graduates
  `fix/campaign-binding-survives-reload` off `docs/TASK_BOARD_NOW.md` — both halves are now closed.

- **2026-08-09 · fix(chargen): drop the mobile last-row collapse toggle — leave it flat and scrolling** —
  Second follow-up to the mobile header rework: `.mobile-action-bar`'s "▴ Less"/"▾ More" collapse toggle
  (added the same day) removed. The row already scrolls horizontally to reach anything off-screen, so
  collapsing it behind a tap added a step without saving anything a scroll didn't already handle. Reverted
  to a flat single-row strip — same 7 buttons (Sheet/Live Sheet/AI Portrait/Share/Name spells/Random/Info),
  `overflow-x:auto` directly on the row, no wrapper `<div>` or toggle button. `setMobActionsCollapsed()`/
  `toggleMobileActions()` and the `pactCgMobActionsCollapsed` localStorage key removed along with it.
  `testing/scripts/chargen-flows-e2e.mjs`'s collapse-specific checks replaced with simpler ones asserting
  the toggle/wrapper are gone and the row scrolls (49 → 46 checks — fewer, but covering the actual
  current shape instead of a removed feature).

- **2026-08-09 · fix(chargen): move the mobile 🎨 Theme selector to the right side of the first row** —
  Follow-up to the mobile header rework above: 🎨 Theme moved from between Redo and 📁 Local to the last
  slot in `.hd-mobnav`, after "Jump to section", with `margin-left:auto` so it hugs the row's right edge
  on any width — mirrors the desktop header's own `.hd-theme{margin-left:auto}` pattern for the same
  control. `testing/scripts/chargen-flows-e2e.mjs`: 48 → 49 checks (added an explicit
  `.hd-mobnav.lastElementChild === themeselMobile` assertion so the position, not just the row
  membership, is covered).

- **2026-08-09 · fix(chargen): mobile header rework — Local/Cloud on the first row, collapsible last row, fixed info modal** —
  CharGen's mobile header (`.hd-mobnav`/`.mobile-action-bar`) reorganized: 📁 Local/☁ Cloud moved from
  the last row into the first row alongside Undo/Redo/Theme (their popup menus still work — both are a
  single reparented element keyed off `btn.parentElement`, not the button's row); 🎲 Random moved the
  other way, off the first row and onto the last (Sheet/Live Sheet/AI Portrait/Share/Name spells/Info).
  The last row is now collapsible — a "▴ Less"/"▾ More" toggle hides the seven action buttons down to
  just itself, reclaiming vertical space for the builder below; the choice persists per-device via
  localStorage, defaulting to expanded (unchanged behavior) until first collapsed. Fixed a real flex-shrink
  bug found while screenshotting the new layout: the buttons inside the (still horizontally-scrollable)
  action strip were shrinking and wrapping their own labels onto 2-3 lines instead of scrolling —
  `flex-shrink:0` on the strip's children was the missing piece. Also fixed the info modal (`#infoBox`):
  it had no `max-height`/`overflow`, so its content — routinely taller than a phone viewport — just ran
  off both edges of the screen with no way to scroll and no way to reach the close button. Capped the box
  at `85vh` with internal scroll, and made the close button live in a sticky `.infotop` bar (mirroring
  `.shtop`, the same pattern `#sheetview`/`#explainview`/`#portraitview` already use for this exact
  problem) so it stays reachable at any scroll position. `testing/scripts/chargen-flows-e2e.mjs`: 27 → 48
  checks (new coverage for the row swap, menu reparenting after the move, collapse/expand/persist, and
  the info modal's scroll-cap + sticky-close-button behavior at a deliberately short 390×600 viewport).

- **2026-08-09 · feat(dm-console): warnings banner for stale invites + lock the Campaign Rules panel** —
  Two DM Console additions. (1) A "⚠ Worth a look" banner above the campaign panel, computed from the
  same `_invites` fetch the invite-list panels already use: flags an outstanding (unredeemed, unrevoked)
  player or co-DM invite issued 14+ days ago, and a player invite granting 0 AP (almost always a
  forgotten "Starting tier"). Reuses `_dmInviteSettled()` for the co-DM half so "is this one done" can't
  drift from the invite-list filter. (2) The Campaign Rules + Advancement panels (bans, house rules,
  budget curve, award pace, starting tier, "copy rules from…") now land **locked by default** on every
  campaign switch, mirroring the existing `ignore_player_ap` lock (`_setIgnoreLocked`) — a new
  Locked/Unlocked button beside "Save rules" gates all the inputs in both tiles plus the Save button
  itself; a successful save always re-locks. Composes for free with the existing archived-campaign peek
  lock (`_applyPeekLock`'s remember/restore already respects whatever `disabled` state this lock leaves
  behind). `testing/scripts/dm-console-ui-e2e.mjs` extended: the pre-existing "Save rules button is
  enabled on a live campaign" check was updated for the new default-locked behavior, plus new coverage
  for lock/unlock/re-lock and for the warnings banner (stale/fresh/settled/0-AP/exhausted-reusable
  cases) — 79 → 88 checks, all passing.

- **2026-08-09 · fix(security): harden the invitation system — close a live privilege-escalation bug** —
  `D-GH-2026-08-09-harden-invitation-system`. `campaigns.dm_invite_code` was readable by any campaign
  member and redeemable by any authenticated account system-wide, with no membership check and no rate
  limiting — a confirmed live bug (production data showed it was never actually exploited). Dropped
  `dm_invite_code`/`join_as_dm()`/`regenerate_dm_invite_code()` outright and unified co-DM invites onto
  the existing hardened player-invite model (`campaign_invites`, extended with `type`/`mode`/
  `redeemed_count`/`max_redemptions`; new `create_dm_invite()`/`redeem_dm_invite()`, hash-only token
  storage, single-use by default with reusable as an explicit DM opt-in). Player-invite tokens
  deliberately stay plaintext (unlike DM invites) since DM Console's invite list re-displays them — see
  the decision record for why. Went through a 6-reviewer cross-vendor cold review before implementation.
  New "Invite a co-DM" panel and "Join as co-DM" redemption row in DM Console replace the old static
  code display — also closes the previously-separate "Wire up joinAsDm()" task. `testing/scripts/
  audit.py`'s live RLS proof extended with 3 new adversarial checks. `DATA.version` unchanged (no rules
  logic touched); `engine-parity` 29/0, `dm-console-ui-e2e` 79/79, `audit.py --rls` 0 failed.
- **2026-08-08 · chore(agents): delete the 8 custom commands in `.claude/commands/` now superseded by identically-named skills** —
  `add-code-task`, `cleanup-code-branches`, `close-code-session`, `log-code-lesson`,
  `make-code-cold-plan-review`, `pick-code-task`, `run-code-task`, `sweep-code-tasks` all now exist as
  skills; the old command files were stale duplicates. Removed the files (and the now-empty
  `.claude/commands/` dir); no other project files changed.
- **2026-08-08 · docs(ui): CharGen — rewrite the Info panel, it described a flow removed months ago** —
  `D-GH-2026-08-08-chargen-header-followup-2` addendum. The "Sending to the Live Sheet" section still
  described the pre-D-GH40 export/converter flow — "click ⇆ Live Sheet, downloads a `-livesheet.json`
  file, Open the Live Sheet and use ⬆ Import" — a mechanism that no longer exists; the actual current
  button (⇆ Open in Live Sheet) does a one-click same-origin handoff with no file at all. "Saving your
  build" only mentioned the standalone Save/Load buttons this session's own header changes had already
  moved into the 📁 Local menu, and never mentioned ☁ Cloud at all — sign-in, autosave, cloud save/load,
  or campaign join. "Other outputs" listed one button (Sheet) out of four, a gap traced to a 2026-08-03
  HTML-truncation bug fix (D-GH-2026-08-03-sw-cache-e2e) that deliberately didn't guess at the original
  lost sentence — but never came back to document the other three buttons (AI Portrait, Share, Name
  spells) with new, accurate text either. Rewrote all three sections to match the current header exactly:
  Local vs. Cloud menus (with the New Character / Autosave / My Characters / campaign-join wording),
  Share + the real Open-in-Live-Sheet handoff, and the full Other-outputs list. Verified with DOM-text
  assertions (no screenshots): the stale `-livesheet.json`/Import wording is gone, and every current
  header feature (Local, Cloud, New Character, Autosave, My Characters, campaign, Open in Live Sheet, AI
  Portrait, Name spells, Sheet, Share) is now mentioned. `engine-parity` 29/0, `audit.py` 0 failed —
  docs-only, no `compute()`/rules involvement, no `DATA.version` change.

- **2026-08-08 · feat(ui): CharGen — mobile Local menu, version numbers visible in the Info panel** —
  `D-GH-2026-08-08-chargen-header-followup-2`. (1) Mobile had a Cloud dropdown (previous fix) but no
  equivalent for local actions — New Character lived alone in `.hd-mobnav`, Save/Load alone in
  `.mobile-action-bar`, none of them consolidated the way desktop's 📁 Local menu is. Added
  `#cgLocalBtnM` to `.mobile-action-bar`, reusing the same reparent-the-one-menu-element technique (and
  its "reparenting always shows the menu at its new location" fix) already proven for the mobile ☁ Cloud
  button, rather than duplicating `#cgLocalMenu`'s markup — removed the now-redundant standalone New/
  Save/Load buttons. (2) The header's "Web Tool · vX" / "PACT rules · vX" labels are `display:none`
  below 1150px, and `.hd-row2` itself is `display:none` below 768px — mobile had no way to see either
  version number at all. Added a line to the Info panel that copies the two header spans' live text
  (not hand-duplicated strings — one source of truth, no third place for `audit.py`'s version-mirror
  check to need updating). Verified with DOM-state assertions (rects/classList/textContent, no
  screenshots this round per instruction): mobile Local menu opens with real content, New Character from
  it mints a different id, a mobile→desktop resize round-trip re-opens correctly, and the Info panel's
  version line reads correctly on both mobile and desktop. `engine-parity` 29/0, `audit.py` 0 failed. No
  `compute()`/rules involvement, no `DATA.version` change.

- **2026-08-08 · fix(ui): CharGen — header no longer wraps on common laptop widths, mobile gets cloud
  access, New Character also offered from the ☁ Cloud menu** — `D-GH-2026-08-08-chargen-header-followup`,
  the owner's review of the local/cloud split found three real gaps, confirmed with real-browser
  screenshots at each width (not assumed): (1) `.hd-row2` overflowed and wrapped the theme selector onto
  its own line at ~1024-1150px, a very common laptop/half-screen width — fixed by hiding the two
  least-critical text labels ("Web Tool · vX" / "PACT rules · vX", both readable elsewhere) below 1150px,
  verified holding a single line down to 900px. (2) Mobile had **zero** cloud access — `.hd-row2`
  (where the cloud menu lives) is `display:none` below 768px, so a hidden ancestor hid the menu
  regardless of any new trigger button. Fixed by reparenting the ONE `#cgCloudMenu` element into
  whichever button's wrapper (desktop `#cgCloudBtn` or new mobile `#cgCloudBtnM`) triggered it, rather
  than duplicating the whole rich menu (auth state / campaign join / character list — real ID-collision
  risk across two DOM copies); also fixed `.mobile-action-bar`'s `overflow-x:auto` implicitly clipping
  the dropdown vertically too (the CSS overflow spec ties both axes together once either leaves
  `visible`) with an explicit `overflow-y:visible`. A same-session resize-without-closing edge case
  (open on mobile, resize to desktop, click the desktop trigger) was caught by an actual round-trip
  headless test and fixed: reparenting now always shows the menu at its new location instead of
  toggling it closed. (3) "🆕 New Character" is now offered from the ☁ Cloud menu too (previously only
  in 📁 Local) — it flushes a pending *cloud* autosave before detaching, so it's as much a cloud action
  as a local one. Verified: `engine-parity` 29/0, `audit.py` 0 failed, headless-Chromium checks at
  1024px/900px/1151px (no wrap) and a mobile→desktop→mobile menu round-trip. No `compute()`/rules
  involvement, no `DATA.version` change.

- **2026-08-08 · feat(ui): CharGen — split header into 📁 Local / ☁ Cloud menus, relabel Reset as 🆕 New
  Character, fix a debounce-redirect data-loss edge case** — `D-GH-2026-08-08-chargen-local-cloud-split-
  new-character`, a follow-up to the header declutter below after the owner reviewed the result: cloud
  actions still sat behind an unlabeled "⋯" while local Save/Load were loose buttons in the row below.
  New "📁 Local" dropdown (New Character/Save/Load) sits beside a re-labeled "☁ Cloud" dropdown on the
  same header row. Also traced "the reset doesn't really work as intended" to its root cause: Reset
  already silently minted a fresh character id on every use (never overwrites the character you had
  open, just detaches from it with zero indication) — relabeled to "🆕 New Character" with honest confirm
  text instead of building new in-place-wipe behavior. Fixed a real bug found while tracing this: a
  still-pending cloud autosave for the outgoing character could get silently redirected to the new blank
  character's id if its 3s debounce timer hadn't fired yet — now flushed first, the same mechanism
  `switchToLiveSheet()` already uses before navigating. Verified: `engine-parity` 29/0, `audit.py` 0
  failed, headless-Chromium smoke pass (menu open/close, New Character mints a different id, Save/Load
  still work, mobile nav shows "New" not "Reset"). No `compute()`/rules involvement, no `DATA.version`
  change.

- **2026-08-08 · feat(ui): header declutter across all three tools — remove redundant status text,
  move Autosave into the cloud menu, move "Last edited" into the info panel** —
  `D-GH-2026-08-08-header-declutter`, the closing follow-up to
  `docs/plans/2026-08-08-header-simplification-universal-autosave.md` (Part A/B are both shipped;
  this is the header-space cleanup that plan's own goal called for). (1) CharGen's `cgCloudStatus` /
  Live Sheet's `cloudStatusBadge` badges no longer show "Local only" / "Signed in — no campaign
  selected" — both states duplicated other header elements already visible (the sign-in link/campaign
  `<select>`, and the sync chip's own "🔒 Signed out" / "☁ Signed in" text); the badge now shows ONLY
  what nothing else says — a bound campaign's name/rules-fetch state. (2) The Autosave toggle moved
  from a persistent header chip into the ☁/⋯ cloud menu as a settings item — it's set-once-and-forget,
  not a live status, so it no longer competes with the sync chip and campaign controls for header
  space; same element ids (`cgAutosaveChk`/`lsAutosaveChk`) so the existing gate/toggle-handler code
  needed no changes. (3) The `.lastedited` span (the tool file's own last-modified date) moved out of
  the header into each tool's Info panel (CharGen/Live Sheet) or footnote (DM Console, which has no
  info modal) — freeing header space on every screen size, not just the mobile-only hide it had before.
  DM Console's copy had never actually been live (no `document.lastModified` script existed for it,
  unlike the other two tools) — fixed in passing rather than relocating stale hardcoded text. Verified
  with a real headless-Chromium smoke pass (populated timestamps, hidden redundant badges, cloud menus
  still open/render correctly) in addition to `engine-parity` 29/0 and `audit.py` 0 failed — no
  `compute()`/rules involvement, no `DATA.version` change.

- **2026-08-08 · fix(sync): two real bugs in `setAutosaveEnabled()`, caught by `/code-review ultra`
  before merge** — the B3 branch's own PR-template checklist calls for an ultra review on any change
  touching `sql/`; it found what regular verification hadn't. (1) `characters.updated_at` is bumped by
  an unconditional `BEFORE UPDATE` trigger even for an update that only touches `autosave_enabled` —
  without re-pinning `base_updated_at`/`_pageBase` to the trigger's new value, the same page's very next
  real save was refused as a false "changed on another device" conflict, caused by nothing but flipping
  the toggle. (2) Toggling autosave on a character with no local cache yet (a brand-new, never-saved
  build) silently no-opped — the user's explicit choice was discarded, not merely delayed, and the
  toggle UI would visibly snap back to checked. Both fixed; the failure-path rollback also needed a
  follow-up fix so a failed write on a never-cached character removes the placeholder record instead of
  leaving a phantom unconfirmed value. Both verified with a differential repro (fails on the pre-fix
  commit, passes on the fix) promoted into a permanent gate,
  `testing/scripts/sync-autosave-toggle-ci.mjs` (4/0, plus `sync-state-machine` 21/0, `sync-concurrency`
  12/0, `engine-parity` 29/0 all still clean). Two more findings from the same review — in
  **pre-existing** push-overlap machinery, one already shipped in CharGen before this branch, freshly
  (and faithfully) replicated into Live Sheet's new B3 scaffolding — were logged to
  `docs/TASK_BOARD_NEXT.md` rather than fixed here: they're bounded (local data isn't lost, only cloud
  sync can lag) and deserve their own scoped fix, not scope creep onto this branch. See
  `docs/plans/2026-08-08-shared-sync-chip-part-b.md`'s B3 implementation note. No `DATA.version` change.

- **2026-08-08 · feat(sync): universal cloud autosave with a per-character owner-reversible toggle**
  — Part B3 of `docs/plans/2026-08-08-shared-sync-chip-part-b.md`, implementing the C2 design decision
  (see `decisions/2026/D-GH-2026-08-08-universal-autosave-toggle.md`): every signed-in character now
  autosaves to the cloud by default, campaign-bound or not, governed by one `characters.autosave_enabled`
  boolean (default `true`) any owner can flip at any time via a new checkbox next to the sync chip in
  both editor tools. No RPC — a plain column grant under the existing owner-only `characters_update`/
  `characters_insert` row policies, mirroring `archived_at`'s precedent (unlike `award_ap()`, the writer
  here is always the row's own owner, so `award_ap`'s SECURITY DEFINER pattern doesn't apply). CharGen's
  autosave gate (`_cgCloudAutosave`/`_cgFlushCloudSaveNow`/pagehide) had its old campaign-bound-only
  check replaced outright, including a stale header comment that would otherwise have contradicted the
  code beneath it. Live Sheet gets cloud autosave for the first time — previously ☁ Save to cloud was
  its only cloud write path — mirroring CharGen's debounce/overlap-guard/keepalive-on-exit pattern
  exactly, plus an awaited flush before `switchToCharGen()`'s cross-tool navigation (same bug class as
  D-GH-2026-08-08-chargen-cloud-autosave-flush). Two real bugs caught before commit: (1) the same
  `_session`-is-private-to-a-different-closure mistake B2 already made once, this time in the toggle's
  enable/disable logic — fixed with a `window._lsSignedIn` boolean mirror, matching CharGen's existing
  `window._cloudSignedIn`; (2) `setAutosaveEnabled()` would have thrown a misleading "may have been
  deleted" error the first time anyone toggled autosave on a character never yet cloud-saved (zero rows
  matched because the row didn't exist yet, not because anything was wrong) — fixed with an existence
  check, plus carrying the toggle value through `pushCharacter()`'s first INSERT so a pre-save choice
  isn't silently discarded back to the default. Deliberately NOT done: the write-volume budget (no live
  traffic data available to measure against in this environment); DM Console's roster does not yet
  surface a character's toggle state (open follow-up, not required for B3's own done-when bar).
  **Migration applied to the live database on explicit owner confirmation** (same day) — verified
  post-apply: column exists as `boolean not null default true`; all 16 pre-existing characters read
  `true` (none silently flipped `false`); `authenticated` holds INSERT/SELECT/UPDATE on the column;
  `get_advisors(security)` showed no new finding attributable to this change.
  `testing/tests/engine-parity.html` 29/0, `tool-pricing` 67/0, `sync-state-machine` 21/0,
  `sync-concurrency` 12/0 — confirmed, not assumed unaffected. No live-browser visual verification was
  possible in this environment. No `DATA.version` change.
- **2026-08-08 · feat(sync): a shared cloud-sync status chip in all three tools, wired to the real
  state machine** — Part B2 of `docs/plans/2026-08-08-shared-sync-chip-part-b.md`, built on B1's
  `getSyncState`/`noteEdit`/`checkFreshness` (same day, earlier). New `chipPresentation()` in
  `js/sync.js` is the one place all three tools' icon/label/tone/aria-label for the six sync states come
  from, so the wording can't drift between copies. **Deviates from the plan's original "replace, don't
  add" framing**: reading the actual code found `cgCloudStatus`/`cloudStatusBadge` are dual-purpose
  (sign-in state AND campaign-rules-binding status), so replacing them would have been a real
  information loss — the new chip (`#cgSyncChip`, `#lsSyncChip`, class `synchip`) is additive instead,
  the lowest-risk default since the owner didn't weigh in when asked mid-implementation. `noteEdit()` is
  now actually wired into both editor tools' edit paths (CharGen's `_cgAutosave()`, Live Sheet's
  `save()`) and `checkFreshness()` fires on `visibilitychange`/`focus` in both, self-throttled. The
  `conflict` state reuses the existing `onBehind` confirm-and-reload primitive in both tools rather than
  a new "force sync" control (the prior plan review found that label actively misleading against the
  existing stale-save guard) — its wording now also points at the already-shipped ⬇ Export as a
  keep-a-copy-first step before the destructive reload. CharGen's `☁ Cloud` button is visually
  de-emphasized (shrunk to `⋯`) with the chip as the primary status element; **Live Sheet's stays
  undemoted** — it has no autosave until B3, so demoting its only cloud-save path now would have been a
  real regression, a correction a prior review round caught in v1 of this plan. DM Console gets the
  shared icon/aria-label vocabulary applied to its existing `#campWho` (kept as one text element, not
  given a separate chip — it usefully shows the signed-in email, which the editor-tool chip doesn't);
  its three write paths' own feedback (`award-status`, `dm-notes-status`) were checked, not assumed —
  `dm-notes-save` already has full Saving/Saved/Error text, `awardAp`'s success is shown via the
  immediate roster re-render (an explicit flash would just be overwritten by it), `unbindCharacter`'s
  card disappearing is its own confirmation — no changes needed there. Chip surfaces use `textContent`
  only, never a dynamic name (the mapping function's contract is fixed-enum-in, nothing dynamic to
  escape). Folds in and removes the now-superseded `docs/TASK_BOARD_NEXT.md` entry "Consistent, obvious
  sign-in indicator across the three tools." One real bug caught before commit: Live Sheet's freshness-
  check wiring initially referenced `_session`, private to a different script closure — would have
  silently no-op'd forever inside a swallowing `try/catch`; fixed by relying on `checkFreshness()`'s own
  internal signed-in guard instead. `testing/tests/engine-parity.html` 29/0, `tool-pricing` 67/0,
  `sync-state-machine` 21/0, `sync-concurrency` 12/0 — all confirmed, not assumed unaffected. No live-
  browser visual verification was possible in this environment; see the plan doc's B2 implementation
  note for what a manual pass should still check. No `DATA.version` change. Same branch-pinning
  deviation as Part A/B1 (implemented directly on this session's designated branch).

- **2026-08-08 · feat(sync): a real sync-state machine in js/sync.js — getSyncState/noteEdit/
  checkFreshness** — Part B1 of `docs/plans/2026-08-08-shared-sync-chip-part-b.md` (the shared cloud-sync
  status chip work), split out as pure sync-layer plumbing with no UI change yet. Adds six exported states
  (`signedOut > saving > conflict > behind > dirty > idle`, highest precedence first) via
  `getSyncState(id)`. Closes the 3-second debounce blind window a cold-review round confirmed: local
  autosave never touched `dirty` until a push actually fired, so a naive status read would report "all
  synced" for several seconds after a real edit. Fixed with two monotonic counters instead of a boolean —
  `editSeq` (bumped synchronously by the new `noteEdit()`, meant to be called at edit time, not
  debounce-fire time) and `savedSeq` (stamped with whatever `editSeq` a push captured *at push-start*,
  advanced only via `Math.max`) — `hasUnsavedEdits = dirty || editSeq > savedSeq` is race-safe against an
  edit landing while an earlier push for the same character is still in flight. **Found and fixed a real
  bug while writing the differential test for exactly this race**: `applyServerMeta()`'s final `lsSet(rec)`
  wrote back the *whole* in-memory record captured at push-start, silently overwriting a concurrently
  higher `editSeq`/`savedSeq` some other push or `noteEdit()` had already advanced in localStorage — the
  same failure class the counters exist to prevent, reintroduced one layer down. Fixed by merging against
  the currently-persisted values via `Math.max`, not just against the in-memory record's own copies. Also
  adds read-only `checkFreshness(id)` (deliberately separate from `reconcile()`, which mutates) for a
  persisted `behind` flag with real clear conditions — including the one a single reviewer caught and the
  other four missed: `reconcile()`'s own silent adopt-at-boot branches (both of them) now clear `behind`
  too, via a new shared `markInSyncWithServer()` helper, so a stale "cloud moved on" warning can't outlive
  a background auto-resolve. A failed freshness check never touches the persisted `behind` value — only a
  page-lifetime `lastCheckFailed` marker, decorating whichever of the 6 states is showing rather than
  growing a 7th. New standalone gate `testing/scripts/sync-state-machine-ci.mjs` (21 passed / 0 failed,
  differential on the editSeq/savedSeq race) — not yet wired into CI, same as `sync-concurrency-ci.mjs`.
  **Also fixed `sync-concurrency-ci.mjs` itself**, found broken by this session's own Part A change
  (`withKeepalive` added to `js/sync.js`'s import line 2026-08-08 earlier today, never re-run against this
  script since it isn't CI-wired) — now 12/0. `noteEdit()` isn't wired into any tool yet (that's Part
  B2/B3); this branch is sync-layer only. `testing/tests/engine-parity.html` 29/0, `tool-pricing` 67/0,
  both unaffected by design. No `DATA.version` change. Implemented directly on this session's designated
  branch rather than a fresh `feat/sync-state-machine` branch, per the harness's branch-pinning rule for
  this session (see the same deviation noted for Part A).

- **2026-08-08 · fix(chargen): a debounced cloud-autosave push no longer gets silently abandoned by
  navigation** — `_cgCloudAutosave()` only ever *scheduled* a push 3s after the last edit; nothing flushed
  a pending timer on navigation. CharGen's own "Open in Live Sheet" button (`switchToLiveSheet()`) walked
  straight into this: it called `_cgAutosave()` (re-arming a fresh 3000ms cloud-push timer) and then
  navigated away in the same breath, guaranteeing that queued push never fired — the last few seconds of
  edits before every tool switch silently never reached the cloud. `switchToLiveSheet()` now **awaits** a
  bounded flush (`_cgFlushCloudSaveNow`, 2.5s timeout) before navigating, so the in-app switch is a real
  guarantee, not a best-effort. Plain tab/browser close gets a best-effort `pagehide` flush using
  `fetch(...,{keepalive:true})` (new `withKeepalive()` in `js/supabase-client.js`, re-exported from
  `js/sync.js`) — `sendBeacon` was considered and rejected because it can't carry the Authorization/apikey
  headers an authenticated Supabase write needs. Page-lifecycle delivery is inherently best-effort on every
  browser/OS regardless of transport, so this is documented as such rather than claimed as a guarantee; the
  durable fallback for that case remains the local autosave (already written) plus the record's `dirty`
  flag retrying on this browser's next boot/reconnect. `_cgCloudPush()` now tracks its in-flight promise so
  a flush can await an already-running push instead of firing a duplicate or resolving early.
  Found and scoped while cold-reviewing a larger header-simplification/universal-autosave plan (4 models,
  2 vendor families — see `docs/plans/2026-08-08-header-simplification-universal-autosave.md`); this fix
  is split out as its own small, low-risk change (Part A) rather than folded into that larger, still-open
  design. `testing/tests/engine-parity.html` 29/0, `tool-pricing` 67/0, both unaffected by design (no
  rules-engine involvement). No `DATA.version` change.

- **2026-08-06 · fix(chargen): undo no longer un-locks a locked character, or reorders its purchases** —
  a regression from the same day's creation-lock work, found by asking whether the ordering problem was
  *"just randomize"*. It wasn't. `restoreFrame()` (undo/redo) restored the frame's LOG and then called
  `applyBuild(foldBuild(LOG))`, which **rebuilds the LOG from the DOM** by design under D5. The DOM has no
  control representing a `creationLocked` event, so the rebuild silently dropped it — **one undo unlocked
  a locked character** — and re-emitted the purchases in canonical rather than click order. Measured on
  six raises bought as CHA, WIS, INT, CON, DEX, STR: an undo→redo round-trip moved the creation boundary
  from **4 purchases to 6**, so two that had been priced post-lock became creation-priced. `restoreFrame()`
  now reinstates the frame's LOG verbatim after letting `applyBuild()` repaint, **superseding D5's
  DOM-rebuild default for undo/redo only** — the same call `_cgApplyEnvelope()` already makes, because
  applyBuild's DOM re-derivation diverges on anything the DOM cannot represent. Confirmed red against the
  reverted line. Display/state only; `DATA.version` unmoved.
- **2026-08-06 · fix(sync): a cloud save is refused if another device wrote first, instead of silently
  overwriting it** — `pushCharacter()` used a bare `.update(...).eq('id', …)` with **no concurrency guard
  at all**, and the entire event log lives in the `stats` blob — so the later writer replaced the earlier
  writer's whole history. Two devices on one character destroyed each other with no warning. Now guarded
  on `characters.updated_at`, which a BEFORE UPDATE trigger already maintains server-side, so nothing
  needs writing client-side. The fiddly part is that the client didn't *keep* the server's value:
  `saveCharacter()` stamps `updated_at` with the local clock on every edit, so a guard against it would
  never match and every save would look like a conflict. Added `base_updated_at`, holding the last value
  the server confirmed, carried across local edits and never re-stamped. **Two holes found in my own fix
  while auditing:** `reconcile()` adopts a server row with `lsSet({...server})` in two places, neither of
  which set `base_updated_at` — so the *first* save after a fresh load ran unguarded, which is exactly the
  two-device case. Both now stamp it. Zero rows updated no longer means one thing: an existence check
  tells "row not there yet, insert" apart from "someone wrote first, conflict", since inserting in the
  second case would collide on the primary key. A conflict returns `{synced:false, conflict:true}`, keeps
  the local edit and leaves the record dirty; the Live Sheet offers a reload, and CharGen's silent
  keystroke autosave breaks its silence **once** for this one outcome, because unlike an offline blip it
  will never resolve by retrying. A record with no known base value still saves exactly as it does today.
  **Not covered by any automated gate — the dependency-free suite cannot reach a signed-in Supabase
  session, so this needs the two-tab check in the PR before it merges.** No schema change; `DATA.version`
  unmoved.
- **2026-08-07 · chore(release): `BUILD` → `v1.378` (PR #378)** — promotion of `preview` → `main`, three
  commits under one theme: a character can no longer be lost quietly. Ships the `character_backups`
  trigger, the off-site Export backup button and its staleness warning, the offline ownership check, and
  the stale-cloud-save guard together with its recovery path and a new gate that reaches it. Major
  carried forward at `1` — per `docs/VERSION-SYNC.md` that is a named human decision, never inferred from
  the size of a promotion. Merged with a **regular merge commit, not a squash**: squashing a promotion
  severs the shared history between `preview` and `main`, so the next promotion's 3-way merge falls back
  to a stale ancestor (this happened for real between #293 and #294). `DATA.version` stays **v0.341** —
  nothing here changes `compute()` output. Mirrors synced in `js/engine.js` (source of truth), CharGen
  (line-1 comment, `<title>`, header `.sub`), Live Sheet (line-1 comment) and DM Console
  (`TOOL_VERSION`); `index.html` reads `BUILD` live and was not touched. All 10 CI checks green —
  `pricing` failed once with `fetch failed` on a **docs-only commit**, which is what identified it as an
  environment flake rather than a defect, and it passed on re-run. Tagging `main` as `v1.378` is still
  outstanding: tag/release pushes get a hard 403 from a cloud session.
- **2026-08-07 · fix(sync): ☁ Cloud → Load can finally recover a copy that is behind (DD1)** — completes
  the conflict story. `reconcile()` no longer swallows a refused push as "retry later": a refused push can
  *never* succeed, because the server has moved and this copy's base never will, so it now reports
  `{behind:true}`. `loadCharacter(id, {onBehind})` asks the caller before doing anything destructive, and
  only on an explicit yes discards the local copy and takes the server's. Both tools' single explicit-Load
  path (`loadCloudChar()`) supplies that prompt, naming the character and warning that unsaved local work
  is lost. **Omitting the callback leaves behaviour unchanged**, so background callers — `syncAll()`,
  campaign-rules refresh — can never silently discard work. This makes the conflict alert added earlier
  today truthful: it tells the user to use Cloud → Load, and Cloud → Load now works. Gate back to green at
  **12 passed / 0 failed**, with two new checks: a plain re-load keeps the local copy, and the caller is
  asked before anything is discarded. Both tools boot headless with 0 console errors; `engine-parity`
  29/0, `tool-pricing` 67/0. No `DATA.version` change.
- **2026-08-07 · test(sync): make the concurrency harness use real timestamps — and it immediately caught
  a second, unfixed defect** — the harness stubbed server times as `'T1'`/`'T2'`. `Date.parse` turns those
  into `NaN`, so `isNewerInstant()` always returned false, `reconcile()` always took its adopt branch, and
  the "recovers after re-loading" check passed for entirely the wrong reason. With real ISO instants it
  fails, correctly: **after a refused save, ☁ Cloud → Load cannot recover.** The local record is dirty and
  newer, so `reconcile()` takes its *push* branch, the guard refuses that push, `catch { /* retry later */ }`
  swallows it, and `loadCharacter()` returns the stale **local** record — so Load hands back your own copy,
  never the cloud's. The page can neither save nor recover, and the conflict dialog added earlier today
  points the user at exactly that control. This is the root cause of the original report that two browser
  profiles kept showing different states. **The gate is deliberately left red** (9 passed / 1 failed): a
  green gate here would be a lie, and the non-zero exit correctly blocks the branch until the recovery path
  is fixed. Not wired into CI, so nothing else breaks. No `DATA.version` change.
- **2026-08-07 · fix(sync): the stale-save guard now travels with the copy the page is holding** — the
  guard shipped on this branch could be defeated, and was, in production: a character went **43 AP spent
  → 47 → back to 43** across two separate Edge profiles with the guard active throughout. `initSync()`
  runs `syncAll()` on every page load and reconnect; `reconcile()`'s adopt branch refreshed
  `base_updated_at` **in localStorage**, while the still-open tool page held an older in-memory build it
  had no way to update. The next save then presented a *fresh base with stale content*, the guard
  matched, and the newer version was silently overwritten — worse than no guard, because it looked like
  one. (The branch's own earlier fix, stamping `base_updated_at` at those adopt sites, is what opened
  this.) The base is now pinned per **page** in memory — written only by `loadCharacter()` and by this
  page's own successful push, never by a background `reconcile()` — so storage can refresh freely without
  arming a stale page. New gate `testing/scripts/sync-concurrency-ci.mjs` (**10 passed / 0 failed**)
  replays the exact production sequence; it is *differential*, failing unless the bug still reproduces
  against a reverted copy, so it cannot pass vacuously. This closes the "no automated gate can reach
  this" gap the branch shipped with. No `DATA.version` change.
- **2026-08-07 · fix(chargen): a save conflict no longer reports itself as "Save failed"** — found by the
  manual two-tab check that `feat/sync-stale-save` requires. Of the three save paths, only two handled
  `res.conflict`: the Live Sheet's manual save and CharGen's autosave. CharGen's **manual** ☁ Save to
  cloud fell through to `throw res.error` and reported the conflict via the generic
  `alert('Save failed: …')` — untrue, and the most damaging thing that path could say. The save to the
  device succeeded; only the cloud push was refused, and the record stays dirty so nothing is lost. A
  player told "Save failed" reasonably concludes their work is gone and redoes it, or never learns
  another device is ahead. Deliberately **not** a copy of the Live Sheet's `confirm()` + `location.reload()`:
  CharGen boots from its local autosave (`_cgRestoreAutosave`), so a reload restores this device's build,
  not the other device's — offering one would be a lie in this tool. It points at ☁ Cloud → Load, which
  actually fetches from the cloud, and restores the button itself since the shared reset sits after the
  try/catch. Verified against the extracted function: conflict alerts correctly and re-enables the button,
  a genuine error still reports "Save failed", the success path is unchanged; CharGen boots with 0 console
  errors. No `DATA.version` change.
- **2026-08-07 · docs(sql): `sql/full-backup.sql` — the whole-database backup runbook** — completes the
  backup story with the one mechanism that sees everything, run from the Supabase dashboard rather than
  the app. Two forms: a per-character query that downloads as CSV with each `envelope` cell a loadable
  `pact-character/1` document, and a single-JSON bundle for archival. Documents who can run it and why
  nobody else can — `characters_select` caps any client at `owner_id = auth.uid() or
  is_campaign_dm(campaign_id)`, so even an account DMing every campaign reaches 6 of 15 — and records
  that an in-app admin backup was requested, considered and rejected rather than left unexplained (see
  the decision record's Addendum 2: a client-side allowlist can't do it, doing it properly means
  inventing the admin role this project deliberately lacks, and it would grant no new capability, only
  a weaker route to one `service_role` already has). Deliberately excludes `character_backups` and
  points at that migration's existing restore recipes instead of duplicating them. Both queries were
  executed against production before committing: Query A returns 15 rows, all restorable, all with
  owner emails; Query B a well-formed 101,676-char bundle. A `docs/HOW-TO-WORK.md` table now sets the
  three mechanisms side by side so they don't get mistaken for each other. No `DATA.version` change.
- **2026-08-07 · fix(sync): apply the ownership check on the offline character list too** —
  `listMyCharacters()`'s online branch filters `.eq('owner_id', …)` because `characters_select` also
  grants a DM read access to every character in campaigns they run; the offline branch made no such
  check, so "My Characters" meant something different depending on connectivity. It could not simply
  reuse the online branch's `dirty` test — offline, `dirty:false` is the normal resting state of the
  user's *own* synced characters, so that would have emptied the list of everything except unpushed
  work. Instead `reconcile()` now caches `owner_id` and the offline branch drops records positively
  known to belong to someone else, keeping unmarked ones (local-only, or cached before this change;
  they self-heal on the next reconcile). Previously latent — every path that could cache a foreign
  character is separately guarded — but it was the missing last line under a feature that now writes
  characters to a downloadable file. Verified headless against the real `sync.js`: a foreign record is
  dropped while own-synced, own-unpushed, local-only and legacy-unmarked records all survive.
  No `DATA.version` change.
- **2026-08-07 · feat(characters): warn when the backup is stale; scheduled-backup Routine deleted** —
  the weekly agent-run Routine was abandoned for good (it cannot carry its own connectors, and the
  bundle would have to pass through a model context it already exceeds), so the export is a manual
  act. Since the original failure was *nobody remembered*, My Characters now records the last
  successful export and shows a red warning bar — and turns the export button red — when it is 7+ days
  old or has never happened; fresh state is a quiet grey line so "you're covered" never competes for
  attention with "you're not". Tracked per browser, not per account, on purpose: the file sits on one
  device's disk, so an account-wide flag would let a desktop export silence a phone holding no copy.
  A localStorage read failure counts as "never exported" — every tie breaks toward the warning. An
  export where every character turns out to be unsaved now refuses to produce an empty file or reset
  the clock. Verified headless across never/20d/7d-boundary/2d/today plus a real export resetting
  stale→fresh. No `DATA.version` change.
- **2026-08-07 · feat(characters): "Export backup" on My Characters — the off-site half of the backup
  story** — the `character_backups` trigger (same date) is a safety net that lives in the *same
  database as the thing it protects* and is readable only from the Supabase dashboard. This is the
  copy the user holds, outside the app. Downloads every character the account can see as one JSON
  file; each `characters[].stats` is a plain `pact-character/1` envelope, so a single lost character
  is restored by a normal Load in CharGen or the Live Sheet with no conversion. Uses `peekCharacter()`
  rather than `loadCharacter()` — peek is explicitly read-only, so taking a backup can never mutate
  what it's backing up. **Archived characters are always included regardless of the "Show archived"
  checkbox** (that box filters a view; a backup silently thinned by a UI toggle is the exact gap this
  closes), and characters with no `stats.LOG` are reported by name rather than dropped. Verified
  headless against a stubbed data layer: archived row present in the bundle while hidden from the
  list, skipped rows named, envelope schema intact, campaign name resolved, and a character named
  `Fenwick <script>` produced 0 injected script elements. Note this is now the *primary* mechanism —
  a scheduled agent-run backup can't scale, since the bundle would have to pass through a model
  context (140 KB already exceeds it). No `DATA.version` change.
- **2026-08-07 · feat(sql): automatic pre-change snapshots for cloud characters (`character_backups`)** —
  a real player character was lost to `js/sync.js` `deleteCharacter()`, which is a literal hard
  `delete` (the 2026-07-25 `archived_at` soft-delete is a *separate*, reversible action, offered
  before it). Nothing captured the row on the way out, and an overwritten `stats` was equally
  unrecoverable, so a lost cloud character had no recovery path for anyone — including the project
  owner. New `character_backups` table plus a `BEFORE UPDATE OR DELETE` trigger on `characters`
  storing the pre-change row; retention keeps the newest 50 `update` snapshots per character and
  **never** prunes `delete` snapshots. No foreign keys (both `profiles`→`characters` and
  `characters`→`ap_awards` cascade, which would kill the backups with the row they exist to outlive);
  `SECURITY DEFINER` trigger (it fires as the player, who is granted nothing on the table);
  `clock_timestamp()` not `now()` for `captured_at` (transaction time ties, and the prune would then
  order by a random uuid). RLS on with zero policies and no client grant — the Supabase dashboard is
  the only reader, same posture as `feedback`; no new admin role. Verified in production with a probe
  character since removed: pre-change capture, no-op updates skipped, restore under the original id
  with the campaign binding intact, 60 updates pruned to exactly 50, advisor clean. **Not
  retroactive** — it cannot recover anything deleted before today. Off-site copy to Google Drive
  still to come. See `decisions/2026/D-GH-2026-08-07-character-backups.md`. No `DATA.version` change.
- **2026-08-06 · docs(agents): name the failure the A/B/A1/A2 convention keeps hitting, instead of
  restating the rule** — the owner asked why the lettered-options format keeps getting lost. It isn't
  lost: `AGENTS.md` is auto-imported every session and the rule was already there. The failure is
  narrower — the format gets applied to things *shaped like a question* and dropped from things *shaped
  like a status report*, and a closing "where we are / what's outstanding" summary routinely carries two
  or three real decisions as a bare numbered list. The section now says explicitly that status summaries,
  wrap-ups, "still on you" lists and `/close-code-session` action lists are all covered, and that
  **letters run for the whole session** rather than resetting per message — both failures observed on
  2026-08-06, the second when the letters restarted at A with A–H already spent. Written as a named
  trap with the date rather than a louder restatement, on the same reasoning as `H-039` in
  `ai-lessons-learned`: a preference that keeps slipping needs its trigger made unmissable, not repeated.
- **2026-08-06 · docs: gate counts replaced with wording that cannot go stale** — `AGENTS.md` (×4),
  `docs/HOW-TO-WORK.md` (×3) and `testing/README.md` all told agents to expect **26 passed**, and
  HOW-TO-WORK put tool-pricing at **16**. Measured today: **29** and **67**. A stale pass count is worse
  than none — it either masks a real failure or sends someone hunting a regression that isn't there.
  Rather than typing in a seventh copy of a number that moves every time a fixture is added, all of them
  now say **"expect 0 failed"** and point at `testing/expected/expected-results.csv` as the live baseline.
  The same treatment applied to the forward-looking `Done when:` lines on the task boards — including
  five `27/0` I wrote myself earlier today, which had already gone stale within hours, which is the
  argument for the change in miniature. **Deliberately left alone:** `CHANGELOG`, the changelog archive
  and `DECISIONS.md` records. *"parity 27/0"* in a decision record is accurate history of what was true
  when it shipped, not an instruction to anyone.
- **2026-08-06 · fix(chargen): the creation lock is recorded, so it survives a reload** — owner report:
  *"the higher character generation lock doesn't seem to fire."* It never could. **Both** of the engine's
  lock paths were dead in CharGen: the automatic one (`_spent > threshold`) is suppressed because
  `_buildEventBurst` tags every event `noLock:true`, and the explicit `creationLocked` event — which
  `js/engine.js:671` calls *"the primary intended trigger"* — **had never been emitted by any tool**;
  CharGen's only mention of it was inside a comment. And since `_locked` is derived state rebuilt on
  every `_replay()`, there was nothing to survive a page load even had it fired. `_cgRepriceDraft()` now
  appends `creationLocked` once `economy(LOG).spent` passes the threshold, mirroring `_replay()`'s own
  resolution (`js/engine.js:749-756`): armed-only (D-GH32 preserved), strictly-over, once, and never
  while an explicit unlock is in force. Chosen (owner, H2) over the task board's step 4 of *removing* the
  blanket `noLock` — that would have reopened **D-GH34**, since the burst's order is synthetic and the
  lock would land at an arbitrary point inside it. Measured on an imported over-budget character (140 AP
  against a 79 threshold): the lock is the **last** event, **12** buys precede it and **0** follow, every
  burst buy still carries `noLock`, and every racial trait is still stamped pre-lock. Gate +5 assertions;
  the firing, persistence and burst-ordering ones confirmed red against a reverted fire, and the
  unlock guard against its own revert (which produced `[creationLocked, creationUnlocked,
  creationLocked]` — a DM's unlock undone on the next keystroke). **Not delivered:** per-portion pricing
  inside an import (first 79 at creation prices, the rest post-lock) — the burst emits in canonical, not
  purchase, order, so there is no honest place to draw that line; `feat/creation-vs-awarded-ap` stays
  open for it. Engine untouched, so `DATA.version` is unmoved. Recorded in
  `decisions/2026/D-GH-2026-08-06-creation-lock-survives-reload.md`.
- **2026-08-06 · fix(login): sign-in now lands back on index.html instead of a redundant "signed in"
  panel** — `login.html` used to show its own post-auth screen ("Signed in as X.", "Open PACT tools",
  "Live Character Sheet", "Log out") after a successful sign-in, or when a signed-in visitor loaded the
  page directly. That panel duplicated `index.html`'s header, which already renders "Signed in as X ·
  Log out" via `js/auth.js` (`currentSession`/`myProfile`/`logout`). Replaced it with a redirect to
  `index.html`, checked in the same three places the old panel was shown: after login, after register
  (when email confirmation is off and a session exists immediately), and on page load for an already
  signed-in visitor — each still defers to `resumePendingInvite()` first, so the campaign-invite
  round-trip (CharGen → login.html → CharGen) is unaffected. Removed the now-dead `#signedView` markup/CSS
  and the `logout`/`myProfile` imports that only it used. Display only; `BUILD`/`DATA.version` unmoved.
- **2026-08-06 · fix(index): "Continue where you left off" moved into the For players section** — the
  resume-cards module (`#continueSection`) previously rendered as its own top-level section above the
  Player's Guide hero; it now nests at the bottom of the existing "For players" `tools-group`, below the
  three tool cards. Layout/markup-only move — the recent-characters module still finds its elements by id
  and its icon lookup still matches on tool-card `href`, both unaffected by DOM position. Display only;
  `BUILD`/`DATA.version` unmoved.
- **2026-08-06 · fix(livesheet): a refresh keeps the campaign binding, and a lookup no longer mints a
  character id** — owner report: *"when the page is refreshed, it loses the connection to campaign and I
  need to reload the character."* **The task board's diagnosis was wrong and is worth correcting:** it
  blamed `save()` for not passing `campaignId`, but `save()` has carried it since PR #312. The defect is
  on the **load** side — `load()` calls `_lsResetCloudApState()` (which nulls `_lsCampaignId`) and then
  restores `LOG`, `SEQ`, `rules` and `__charId` but never `d.campaignId`. The envelope had it all along;
  the restore threw it away. Now restored — and it is the tab's own autosave, so adopting its binding
  grants nothing the server's RLS wouldn't. Second half: the async fallback meant to recover the binding
  called `S.loadCharacter(currentCharId())`, and **`currentCharId()` mints a fresh random id when none is
  set** — so it queried a character that had never existed, got nothing, and set `_lsCampaignId = null`,
  wiping the binding again. Added `peekCharId()`, a read-only companion answering *"have we an id yet"*
  without minting, and the round-trip now bails when there is none. Gate +2 assertions covering the whole
  local save → wipe → load cycle, both confirmed red against reverts (binding → `null`; peek → mints an
  id). **Not addressed:** the Live Sheet → CharGen half, which the board flags as an unconfirmed
  boot-order hypothesis and which needs a signed-in browser to verify — the task stays open for it.
  Display/state only; `DATA.version` unmoved.
- **2026-08-06 · fix(engine): a bought-off drawback can be taken again** (`DATA.version` **v0.340 →
  v0.341**) — `activeEvents()` keyed its `boughtOff` map by drawback **value**, so any buyoff suppressed
  *every* buy of that value forever, including ones taken **after** the buyoff. Measured (the task's own
  repro): buy "Asthmatic", buy it off, take it again → build has no Asthmatic, `drawbackEarned:0`. The
  retake was accepted by the UI and silently ignored by the engine, with no warning. Worse, the Live
  Sheet's buy panel read the same value-keyed map to decide whether to *offer* a drawback at all, so a
  bought-off drawback rendered as a permanently disabled *"Bought off (3× cost paid)"* tile whose
  `onclick` only flashes a message — the retake wasn't just dropped if attempted, the UI made attempting
  it structurally unreachable. `boughtOff` now resolves per-**purchase**, not per-value: one forward pass
  matches each buyoff to the oldest not-yet-cancelled purchase of that value (FIFO by array position) —
  no `seq` field, no schema change, which is a deliberate departure from the task board's own suggested
  fix (the engine has no concept of `seq`; see `decisions/2026/D-GH-2026-08-06-buyoff-keyed-by-event.md`
  for why plain ordering covers every case without it). Existing single-buy/single-buyoff characters are
  unaffected — verified directly. The buy panel's blocking "Bought off" branch is removed outright: once
  cancellation is per-purchase, a drawback not currently held is simply available to take again. New
  fixture `EV-017`, mutation-tested by reverting the engine change and confirming it fails (`EV-015`/
  `EV-016` unaffected by the same revert). **This session's environment had no browser available**, so
  the two new Live Sheet UI gate assertions were pushed unexecuted, flagged as such in the decision
  record — and CI's first real run caught a genuine bug **in the test**, not the fix:
  `buyoffDrawback()`'s own affordability gate silently refused every buy-off because the test never
  funded an `award` event, so the fix itself was never actually exercised. Fixed and re-verified green
  against the real CI browser — exactly the failure mode the "not executed locally" flag exists to catch.
  Graduates the task off `docs/TASK_BOARD_NOW.md`.
- **2026-08-06 · feat(engine): `compute()` prices extra maneuvers — and the pricing escape is deleted**
  (`DATA.version` **v0.339 → v0.340**) — `repriceDraft()` re-derives every frozen cost as a `compute()`
  delta, and `compute()` never read `maneuverBuys`, so three maneuvers bought for 4+5+6 were rewritten to
  **0/0/0 while the maneuvers were kept** — 15 AP silently handed back on a CharGen round-trip, and since
  every pre-lock character is a draft, that reached all of them. `compute()` now charges the rung already
  in `DATA.maneuverBuy` (`base + step×n`, so three cost 15) on a new **`Extra maneuvers`** ledger line.
  The pleasing part: `priceOf()`'s ordinary whole-build diff now returns the right rung on its own
  (deltas verified 4, 5, 6, 7), so the Live Sheet's `_UNCHARGED_PRICERS` was **deleted, not updated** —
  the fourth escape `D-GH-2026-08-05-pricing-model` **D1** warned against is gone rather than relocated,
  which is what D1 meant by *"retired into that rule"*. One number now serves the affordability gate, the
  ledger and reprice, which previously disagreed by construction. New fixture `EV-016` — no fixture
  carried `maneuverBuys` at all, so the category had **zero coverage** while the suite read green, the
  same blind spot that had hidden Grit and Vigor. Parity 27/0 → **28/0**. Supersedes the pricing half of
  `D-GH-2026-08-06-maneuver-afford-gate`; recorded in
  `decisions/2026/D-GH-2026-08-06-reprice-preserves-uncharged-costs.md`.
- **2026-08-06 · fix(chargen): house-rule names and descriptions can no longer inject markup** — a DM's
  custom boon/drawback name and description are user-typed, and `houseRules` rides inside the saved
  `pact-character/1` envelope and the cloud `stats` column — so they render in **another user's** browser.
  That makes it stored XSS, not a display bug, and AGENTS.md's `esc()` rule a hard invariant (REV-12).
  Wider than filed: the reported site was `buildDrawGrid`, but the same raw interpolation was in
  `buildBoonGrid`, in **both** grids' `fx` descriptions, and in `buildDmList`'s visible name — six sites,
  all now through the shared `esc()` from `js/ui-helpers.js`. The DM-list handlers needed **two** layers:
  `JSON.stringify()` escapes quotes at the JS level, then `esc()` escapes for the attribute — `esc()`
  alone stops the injection but leaves `onclick="fn("a"b")"`, a syntax error that silently breaks the
  disable/remove buttons for any name containing a quote. Also renamed a `const esc = …` local that
  **shadowed the global `esc()` helper** in `buildArtGrid`'s scope, which is exactly what makes a later
  `esc()` call throw. Gate +2 assertions; both confirmed red against a real revert (un-escaped name
  materialises an `<img>`; single-layer handler neither parses nor fires). Note the element-count check
  is what carries the first assertion — `onerror` timing is unreliable headless, so asserting only on
  "did script run" would have passed while markup was injecting. Display-only; `DATA.version` unmoved.
- **2026-08-06 · fix(chargen): an epic boon's ability choice survives a whole-log rewrite** — silent data
  loss on a supported path: `epicBoonAbil` is set only by the Live Sheet's ✎ Names dialog and has no
  CharGen control, so `_domReadBuild()` never carried it and `replaceWholeLogFromBuild()` emitted a
  `names` event without it. A Live Sheet character with epic boons, opened in CharGen and re-saved, came
  back with its choices gone and a permanent *"&lt;boon&gt;: choose an ability to raise (+2)"* it could not
  clear. `replaceWholeLogFromBuild()` now recovers the value from the log it is about to replace and
  hands it to the burst on the build; the `names` event carries `eb`, and its emission guard fires on
  that alone (a character can have an ability choice and no named spells). **Two wrong fixes preceded the
  right one, both caught by driving the real tool rather than reasoning:** `_buildEventBurst()` declares
  its own `let LOG=[]`, so reading `LOG` there hits that binding's temporal dead zone — and the read sat
  in a `try/catch`, so it failed silently and recovered nothing; the top-level `LOG` is also a `let`, so
  `window.LOG` is undefined too. The capture has to happen in the caller. Gate +1 assertion, confirmed
  red against the reverted carry (returns `[null, 1]`). Display/entitlement field only — `DATA.version`
  unmoved, engine untouched.
- **2026-08-06 · chore(release): `BUILD` → `v1.367` (PR #367)** — small follow-up promotion of `preview` →
  `main`, immediately after `v1.365`: the Live Sheet rules-version fix plus its board entry. Major carried
  forward at `1`. `BUILD` mirrored from `js/engine.js` into CharGen's line-1 comment, `<title>` and header
  `.sub`, the Live Sheet's line-1 comment, and DM Console's `TOOL_VERSION`; `index.html` untouched (reads
  `BUILD` live). `DATA.version` stays at **v0.339** — nothing in this promotion changes `compute()` output.
- **2026-08-06 · fix(livesheet): the footer reads `DATA.version` live instead of a hardcoded literal** —
  found by checking the claim *"all tools show v0.339 now"* after the v1.365 promotion rather than
  asserting it. They didn't: the Live Sheet's footer read **`PACT v0.309`** while the rules were v0.339 —
  30 versions behind, and the only place that tool states a rules version at all (it has no *"PACT rules"*
  chip like CharGen). It was missed because `docs/VERSION-SYNC.md`'s mirror list doesn't name it. The
  footer now carries `#lsRulesVer` and `_lsBoot()` paints it from the `RULES` value it *already* read from
  `DATA.version` — the same live read DM Console uses — so it cannot drift again; the literal in the HTML
  is only the no-engine fallback. This also makes CharGen's header comment true for the first time: it
  claims the Live Sheet reads `DATA.version` live, which until now it did not. The two agent-facing
  `AI SESSION CONTEXT` headers were resynced with it (CharGen v0.337, Live Sheet v0.309 → v0.339).
  **Deliberately untouched:** the *Players Guide* provenance strings (*"verbatim from the v0.309 Players
  Guide"*, *"PACT-Players-Guide-v0.303.docx"*) — those record which edition the quoted text came from, so
  bumping them would assert a re-check that hasn't happened; and the `// v0.314:`-style annotations that
  mark when a feature landed. Gate +1 assertion comparing the footer to `DATA.version` itself rather than
  a fixed string, so it never needs updating at a rules bump; confirmed red against the reverted wiring
  (returns `v0.309`). Display-only — `DATA.version` and `BUILD` both unmoved.
- **2026-08-06 · chore(release): `BUILD` → `v1.365` (PR #365), and CharGen's stale rules labels resynced**
  — promotion of `preview` → `main`, 49 non-merge commits since `v1.358`. Major carried forward at `1`;
  per `docs/VERSION-SYNC.md` that is a named human decision, never inferred from the size of a promotion.
  `BUILD` mirrored from `js/engine.js` into CharGen's line-1 comment, `<title>` and header `.sub`, the
  Live Sheet's line-1 comment, and DM Console's `TOOL_VERSION`; `index.html` untouched (it reads `BUILD`
  live). `DATA.version` stays at **v0.339** — it moved once this window, for the Grit and Vigor pricing
  corrections, and nothing since changed `compute()` output. **Also resynced two user-visible *rules*
  labels that had drifted**, which the version-sync one-liner tells you not to touch during a promotion:
  CharGen's `<title>` read *Rules v0.338* and its `#cgPactver` chip read *PACT rules · v0.337* while
  `DATA.version` was v0.339 — CharGen hardcodes both, unlike the Live Sheet and DM Console which read
  `DATA.version` live, and the file's own comment says to resync them on a rules bump. The bump that
  should have done it was in this same window. Fixing a stale mirror to the already-current value is not
  a rules-version change, and shipping *"PACT rules · v0.337"* to `main` would have been a wrong fact in
  front of users; the same comment's own stale examples (`v0.337`, `v0.202`) were corrected with it.
- **2026-08-06 · feat(engine): the `Drawbacks (refund)` ledger line itemises what was taken** — owner-
  confirmed: a character with three drawbacks showed one lump sum and no way to see which three, while
  *Arts & Techniques*, *Species traits*, *Class features*, *Subclass abilities* and *Boons* all expanded
  into named rows. The drawbacks loop now collects pairs and calls `addItems("Drawbacks (refund)", …)`
  with the key matching the ledger line's label exactly — both tools already walk `itemize` generically,
  so there is no renderer change. Rows are **negative**, so they sum to the line total (`-drawGain`), the
  same relationship the other five itemised lines have with theirs; the value itemised is the one
  actually charged, so a house-ruled drawback shows its overridden AP, not the printed one. Unknown
  drawbacks are skipped, as all five sibling itemised loops already do — a drawback retired from the rules
  scores 0, and without the guard it rendered a phantom `<name> 0` row and could leave an `itemize` key
  with no matching ledger line (`add()` suppresses a zero total). `compute()` totals do not move and
  `testing/expected/` captures only totals and warnings (checked, not assumed), so **`DATA.version` is
  unmoved**. Note the rows are visible in **CharGen and DM Console** only — the Live Sheet's AP ledger
  maps `r.lines` and does not read `itemize` at all. Gate +11 assertions across the three fixes; every one
  that guards a specific behaviour was confirmed red against a deliberately reverted guard before being
  trusted, and step 6's check that *Boons* rows still render is in there too. **Not in this change:** the
  2026-08-05 scope extension — showing what was *lost* (a bought-off
  drawback, its buy-off cost, and a DM-removed boon) appears in no ledger line at all, and needs an owner
  decision on whether historical spend belongs in `compute()`'s ledger (`feat/ap-model-reconcile`) plus a
  line shape for a DM-edit feature that isn't built yet. The task stays on `docs/TASK_BOARD_NEXT.md`.
- **2026-08-06 · fix(livesheet): buying an extra maneuver goes through the affordability gate** —
  `buyManeuver()` called `emit()` directly, making it the one purchase path in the tool that skipped
  `buy()`'s frozen-economy check. Measured on a Fighter with *Combat Superiority* and **0 AP available**:
  four clicks charged 4, 5, 6 and 7 AP and took the character to **−22**, with no refusal and no warning.
  Now routed through `buy()`. Pricing needed an escape first — `maneuverBuys` is read only by the ✎ Names
  dialog's slot count and by no ledger line, so `compute()`'s build diff prices the purchase at 0 and the
  gate would have been a no-op; `mvbuy` therefore joins `_CTX_PRICERS` quoting its own rung
  (`4 + maneuverBuys`), the same escape `hd`, `abil` and `unlockclass` already use. The dialog now
  redraws only when the purchase lands, so a refusal leaves it open showing the flash. Verified: at 0 AP
  all four clicks are refused with *"Not enough AP: needs 4, have 0"*; at 15 AP the ladder still charges
  4, 5, 6 and then refuses the 7 with *"needs 7, have 0"*. Review then found the escape was in the wrong
  table: `_CTX_PRICERS` means *"the diff over-charges because this purchase changes the pricing context"*,
  and adding a fourth entry contradicts `D-GH-2026-08-05-pricing-model` **D1** outright. `mvbuy` now lives
  in its own `_UNCHARGED_PRICERS` — *"the diff is 0 because `compute()` charges nothing"* — which keeps D1's
  planned retirement of `_CTX_PRICERS` safe to carry out; folding an uncharged purchase in would have made
  maneuvers free again the day it happened. The rung itself moved into **`DATA.maneuverBuy`**
  (`{base:4, step:1}`), following D1's own finding that *"the escapes exist where the data was missing"* —
  it had never been in `DATA` at all. `DATA.version` deliberately unmoved (value unchanged, `compute()`
  never reads the key, parity 27/0); reasoning recorded in
  `decisions/2026/D-GH-2026-08-06-maneuver-afford-gate.md`.
- **2026-08-06 · fix(livesheet): epic boons can be bought again — an expected follow-up is no longer a
  hard block** — owner-confirmed: all 12 `epic:true` boons were unbuyable in the Live Sheet. `MUT.boon`
  pushes the label but cannot set `epicBoonAbil`, so `compute()` on the candidate build always raised
  *"&lt;boon&gt;: choose an ability to raise (+2)"*; that string matched neither `SOFT_WARN` nor anything
  else, so `buy()` classified it as a rules violation and refused with *⛔ Purchase blocked*. The warning
  is guidance, not a violation — the ability is chosen afterwards in the ✎ Names dialog. Added a third
  class, `EXPECTED_FOLLOWUP`, rather than widening `SOFT_WARN`: soft warnings mean "allowed but flagged,
  confirm through", and asking a player to confirm a warning that isn't one is the wrong prompt. `buy()`
  now flashes a pointer to the dialog instead. Measured on a HD-17 character with 804 AP: 12 of 12 epic
  boons blocked before, 12 of 12 bought after, with the guidance still raised on the build and
  *"Crossbow Expert: requires DEX 14+"* still hard-blocked. Two follow-on defects found in review and
  fixed here: the event was still storing the **unfiltered** `warns`, and the history ledger paints any
  row carrying one red — so an epic boon would have looked like a rules breach forever, including after
  the ability was chosen, and `warns` travels inside the saved envelope; `buy()` now stores `rest`. And
  `ib()` built its own classification with no knowledge of `EXPECTED_FOLLOWUP`, so every epic-boon tile
  stayed amber `.warn` while clicking it bought cleanly — the panel and `buy()` disagreeing about the
  same string. The tile keeps the guidance text and drops the styling. No engine change, so
  `DATA.version` unmoved.
- **2026-08-05 · fix(livesheet): a racial trait is gated by its tier, as CharGen already gated it** — owner
  report: *"Draconic flight requires T4, which works in CharGen but not the Live Sheet."* A trait's tier
  gates it by Hit Dice via `DATA.tierHD` (T4 needs 5 HD), and CharGen enforced that on its trait
  checkboxes. The Live Sheet used `DATA.tierHD` for class features, Eldritch Invocations and cross-class
  features but **not** for racial traits — `racialWhy()` checked only `minHD` and `reqRace`, and
  *Dragonborn: Draconic flight* is T4 with no `minHD` field at all, so nothing stopped it being bought at
  level 1. `racialWhy()` now checks the tier gate first; `minHD` stays as a stricter override for traits
  naming an explicit level (the breath-dice steps, Goliath's Large Form). Gate +2 assertions, the second
  driving the real buy panel for a Dragonborn so it proves the gate is wired rather than that the numbers
  exist in `DATA`. No `compute()` change, so `DATA.version` unmoved.
- **2026-08-05 · feat(engine): Vigor is priced per rank at the tier it was bought at** — closes the
  pre-lock reconciliation question (D8). `compute()` had no way to know *when* a Vigor rank was bought, so
  it re-priced the whole stack at today's tier: buy Vigor 2 at level 1 for 10 AP, level to 5, and the sheet
  said it cost 28 — charging 18 AP for Vigor already owned, purely for levelling. Vigor now carries
  `b._vigorRankTier`, stamping each rank with the tier in force when bought — the same mechanism
  `_raceTraitLocked` has always used for species traits. `_replay` fills it just before the mutator runs
  (the only point where the previous rank total is still visible); `compute()` prices each rank from its
  own stamp and falls back to today's tier for an unstamped build, so nothing changes for callers that
  don't replay a LOG. Two ranks bought at tier 1 stay at 10 after levelling, while a third bought after the
  level-up costs the tier-4 rate of 14 — both halves in one build. **This closes the tool divergence**:
  levelling 1→5 with Vigor 2 / Grit 3 now quotes 12 in *both* tools, where CharGen quoted 51. One
  divergence remains, `unlockclass` (CharGen −6 vs Live Sheet 7), tracked as `fix/chargen-context-pricing`.
  Like Grit, Vigor was **entirely ungated** — every fixture had `hardy: 0` and no event fixture bought it.
  New fixture EV-015 pins both halves; parity 26/0 → 27/0, verified by reverting the stamp (EV-015 fails,
  the other 26 pass). `DATA.version` unchanged: no price table moved, and an unstamped build computes
  exactly as before.
- **2026-08-05 · feat(chargen): pick a building level and budget track instead of an AP number** —
  the AP budget was a **751-option `<select>`** (`numOpts(0,750)`), which the owner called clunky, and the
  creation lock always measured against a flat `DATA.level1AP` of 79 no matter what the character's budget
  was. Two selectors — **building level (0–20)** and **budget track (lean / standard / generous)** — now
  derive all three numbers the tools need: **total AP** from the curve, **creation AP** (the track's
  level-1 figure, which is what the lock measures), and the remainder, which behaves as **awarded AP** at
  post-creation prices. A level-5 Standard character starts with 175 AP: the first 79 spends under creation
  pricing with the usual warnings, the other 96 as awards — which is the right shape, since a character
  beginning at level 5 has in rules terms already advanced (owner's design). Level 0 is handled by the same
  formula rather than a special case: its 55 AP total is below the level-1 figure, so creation AP clamps to
  the total and the whole prelude budget is creation spending. The threshold is written as an **appended**
  `creationLockConfig` event (D4 — never replaced or moved), so it persists in the save file with no schema
  change. `#budget` remains as a plain number input, derived from the two selectors but still directly
  editable for a table running a figure no curve produces. Two bugs found and fixed while building it: a
  render-time helper repainted the selectors from the budget and fought the user's own edit (the level
  snapped back before the new total landed); and "derive the level from the budget" has no unique answer at
  all — Lean level 6 and Standard level 5 both total 175 AP — so the selectors are now inputs only, with a
  hint line reporting the real figures. `relabel()` also gained an `options` guard, since it assumed a
  `<select>`. Gate: `tool-pricing-ci.mjs` 34 → 42, covering all three tracks, level 0 and level 20, the
  event-not-DOM threshold, and that the control is no longer a dropdown. Parity 26/0, log-fuzz 500/500,
  `DATA.version` unchanged — no `compute()` output moves.
- **2026-08-05 · fix(engine): Grit is priced by which purchase it is, not by your character tier** —
  **rules correction (owner), `DATA.version` v0.338 → v0.339.** `js/engine.js` indexed the Grit ladder
  (2/4/6/9/12/15/18) by the character's **tier**, so every Grit purchase cost the same and that cost rose
  as you levelled: three Grit cost 6 AP at level 1, **27 at level 5, 36 at level 9**. It is now indexed by
  **purchase number** and is level-independent — three Grit cost 12, whenever you buy them. Past the
  seven-entry table the steps run 2/4/6/8/10 (8th = 20, 9th = 24, then 30, 38, 48); both tools let a player
  buy well past 7, so the table had to extend. The past-CON-mod surcharge is now a **flat +1 per purchase**
  rather than the escalating `max(0, n − CONmod)` the code applied. Vigor is deliberately untouched: it
  really is tier-locked ("each rank costs the Passive band of your current Hit-Dice tier"), so with Vigor
  buying early is genuinely cheaper — the two are priced differently on purpose.
  **The Players Guide needs rewording to match** — it says "Situational by tier" in three places
  (`docs/PACT-Players-Guide.html` lines 671 and 675 ×2), which is what the old code implemented faithfully.
  Also corrected two plainly wrong CharGen labels found alongside: the control read "Grit (+5 HP)" and the
  HP formula "Toughness×5" where the engine and guide both say **+4**.
  **Test coverage: this was previously ungated entirely** — all 23 fixtures had `tough: 0`, so no parity
  test touched Grit pricing and none could have caught either the tier indexing or a regression. Added
  CG-010/CG-011: the same Grit-10 build at HD 1 and HD 9, whose Grit lines must both read 147, spanning the
  table and the extrapolation. Parity **24/0 → 26/0**; verified by reverting the fix (both new fixtures
  fail, the other 24 pass). tool-pricing 32/0, log-fuzz 500/500.
- **2026-08-05 · fix(chargen): a draft character's AP ledger now reconciles to `compute()`** — closes
  `fix/species-pack-not-charged`, the last of the four pricing branches. Before the creation lock fires a
  character is a draft with one pricing context, so what was paid must equal what the build costs today —
  but a purchase's cost was frozen when it was made and a *later* change to context left it stale.
  Measured in a real browser: buy four Halfling traits (ledger 13, `compute()` 13), switch species to
  Dwarf and the traits become cross-race purchases the ledger still records at own-species prices
  (13 vs 24); switch back and the identity patch quotes **−4**, taking the ledger to 2 against 13. That
  negative line is the same mechanism behind Anders Tealeaf's log summing to 15 against a `compute()` of
  33. Fixed in two independent halves: new `repriceDraft(log)` export in `js/engine.js` re-derives every
  pre-lock purchase's cost as its own sequential delta (riding `_replay`, which gained one optional
  callback, so racial `_raceTraitLocked` stamping and the lock bookkeeping stay single-source), called
  from CharGen's mutation paths **and from `_cgApplyEnvelope`** — the load path (file, `?handoff=`,
  autosave restore) that a pre-existing under-recorded ledger actually arrives by; and `replacePatchSlot()` now replaces in place instead of
  filter-and-appending, which had been moving a slot's event to the end of the log on every edit so the
  identity line priced traits that came *before* it. Post-lock purchases keep their frozen price
  (D5), and drawbacks are untouched — their recorded cost is income, not spend. The pass runs to a fixed
  point because re-pricing and the threshold lock are mutually recursive — the decision is made once for
  the whole log (`isCreationDraft()`, also exported), never per event, so it settles in one pass and a
  locked character's frozen prices are never re-derived. `DATA.version` unchanged:
  `compute()` output does not move, only what the ledger records. Gate: `tool-pricing-ci.mjs` 20→27,
  verified by reintroducing each half (reproduces −11 and −4 exactly); `log-fuzz.mjs` gained four
  `repriceDraft` invariants (non-mutating, idempotent, build-preserving, draft-reconciling) — those
  caught the non-idempotence, the drawback-income bug, and a duplicate-purchase mispricing that also
  hardened `_replay`'s proficiency dedupe. Code review then caught four more, all fixed here: the
  per-event lock decision needed O(events) passes to settle and could re-price a purchase frozen at 6 AP
  down to 2 (a D5 violation); the load path never re-priced at all; and the fuzz invariant's scope
  excluded every CharGen-shaped log, since `_cgEnsureLockArmed()` stamps `{auto:true}` into all of them.
  Gate 20→32; fuzz 500/500 clean across five fixed seeds and at 80 events/log; parity 24/0.
- **2026-08-05 · docs(decisions): reverse H2 — the species-pack fix is a `priceOf()` quoting-basis bug, not
  a ledger-accounting one** — two rounds of external cold review (5 reviewers, then 4) refuted the planned
  approach, and two code audits moved the diagnosis to `priceOf()`
  (`tools/PACT-Live-Char-Sheet.html:503-511`), which quotes a purchase as a **whole-build delta** and freezes
  that number into the log — so any purchase that changes pricing context bills the player for re-pricing
  everything they already own. Already escaped by hand three times (`abil`, `mbound`, `dbound`, the last two
  with an inline comment naming "the refund bug") and still live for **Level Up** (charges the hit-die step
  plus a full re-price of the existing Vigor/Grit stacks) and **class unlock** (quotes the unlock cost minus a
  retroactive discount on already-owned features of that class; can go negative). New model recorded as
  **D-GH-2026-08-05-pricing-model**: prices freeze at purchase, `compute().total` and the ledger sum are
  *meant* to diverge, and the **creation lock** — not which tool is open — decides whether a purchase is
  quoted by draft re-pricing or at listed price. Lock trigger = first spend past a threshold, stored as a
  `creationLockConfig` event (persists offline and online with no schema change), default `DATA.level1AP` = 79.
  Engine side is already built and fixture-covered; nothing in any tool emits the events, so `_locked` is
  `false` for every character today. `DATA.version` unchanged — no rules or `compute()` change, docs only.

- **2026-08-04 · chore(release): bump BUILD to v1.358 (PR #358)** — promotion of `preview` → `main`
  carrying the archived-campaign peek and the DM-AP roster fix. `DATA.version` unchanged at **v0.338**:
  `compute()` was not touched, only its caller was passing nothing. Two decisions recorded on the task
  board in the same change — **G1**, DM Console's "AP left" uses the frozen ledger (matching the Live
  Sheet's `buy()` gate) and the AP Ledger keeps the repriced total, with Fenwick Copperkettle as the
  worked example on the new `feat/ap-model-reconcile` entry; and **H2**, the species-pack fix takes the
  invariant route (recorded cost equals `compute()`'s delta by construction) rather than the narrower
  event-ordering fix.

- **2026-08-04 · fix(dm-console): roster priced every AP figure against player AP only, ignoring DM AP** —
  reported from the live Amble campaign, where characters showed "OVER BUDGET by 27 / 36 AP". DM AP is
  stored only on `characters.ap` and never in the character's log, but `dmAnalyze()` called `compute(b)`
  with **no** opts and reported `economy()`'s totals — and `economy()` can only see the log. So the card's
  "AP left", the table's "AP Avail", the ⚠ OVER BUDGET warning (`js/engine.js:423`) and the AP Ledger's
  `total / budget` line were all player-log-only. Amble runs `ignore_player_ap` with the whole budget
  granted as DM AP, so the entire budget was invisible and every character read as deeply overspent —
  contradicting what those same players saw on their own Live Sheets. `{dmAp, ignorePlayerAp}` now flows
  `dmAnalyze` → `analyzeAug` → `cloudAnalyze`, and `available` is `spendable − economy().spent` — the Live
  Sheet's own `_apRemaining()`, i.e. the frozen ledger, not `compute()`'s repriced total (D-GH30). Anders
  −15 → **12**, Cedric −36 → **0**, both bogus warnings gone. Toggling ignore-player-AP now re-fetches the
  roster it just re-budgeted. `dm-console-ui` 73 → **79** checks; 4 mutants killed. Display-only; no
  `DATA.version` bump. See `decisions/2026/D-GH-2026-08-04-dm-console-dm-ap-budget.md`.

- **2026-08-04 · feat(dm-console): read-only view of an archived campaign** — an archived campaign offered
  its name and an **Unarchive** button and nothing else, so checking an old campaign's roster, rules or
  notes meant putting it back in the active list first — mutating state purely to look at it. Its name is
  now a clickable control that opens the ordinary campaign panel, locked. Reuses `selectCampaign()`'s
  render path (no second renderer to drift), and enforces the read-only state **twice**: `_peekBlocks()`
  gates all eight write call sites — `setCampaignRules` ×2, `createPlayerInvite`, `setInviteRevoked`,
  `setIgnorePlayerAp`, `archiveCampaign`, `awardAp`, `setCharacterDmNotes`, `unbindCharacter` — and
  `_applyPeekLock()` disables the controls. Guarded, not hidden: the roster replaces its own `innerHTML`
  on every refresh, so cards come back enabled and the handler guard is the half that can't be defeated.
  A banner says why, `+ Create`/`Unarchive`/ⓘ stay live so the way out is never locked, and exiting
  restores each control's prior disabled state rather than blanket-enabling. `dm-console-ui` 44 → **73**
  checks; all 10 mutants killed. Display-only; no `DATA.version` bump.
  See `decisions/2026/D-GH-2026-08-04-archived-campaign-peek.md`.

- **2026-08-04 · fix(dm-console): three help strings still said the shared code grants no AP** — the
  Players-code tooltip claimed a code-join "gets a new character bound to this campaign, with no preset
  AP/budget", the invite note called it "a blank character with no preset AP", and the Starting-tier
  tooltip said its "only effect is to pre-fill" the invite box. All three predate #329/#331: a code-join
  now grants `rules.startingTier.ap` (79 when unset), and it binds the character the player is
  **currently building** rather than creating a blank one — the second thing all three got wrong.
  Reported by the owner, who read the tooltip and could not tell what their campaign actually grants.
  Display-only; no `DATA.version` bump.

- **2026-08-04 · fix(chargen/feedback): mobile clipping and the floating Feedback button** — two HIGHs
  from the usability review, both with deeper causes than reported. The clipped class grid was **three**
  stacked layout defects, not one: an **inline** `grid-template-columns` no media query could override;
  the UA stylesheet's `fieldset{min-width:min-content}`, which stops a fieldset shrinking below its
  content (section 7 sat at 596px inside a 362px form); and flex/grid children defaulting to
  `min-width:auto`, so `1fr` and `.grow{flex:1}` floored tracks at content width. With
  `body{overflow-x:hidden}` there was no scrollbar, so half the classes were simply invisible. Widening
  the check found **section 9 clipped too** — the innate-spell table sizing its own parent, so its
  `max-width:100%` resolved against a box it was itself inflating. The Feedback pill now measures the
  host tool's fixed bottom bars at runtime and clears them (Live Sheet's `#lmobar` carries Undo/Redo
  mid-play), rests semi-transparent, collapses to an icon under 520px, and can be dismissed for the
  session. `chargen-flows` grows to **21 checks**, all four new mobile ones verified RED against the
  reverted fixes.

- **2026-08-04 · fix(live-sheet/chargen): orphaned duplicate on tool handoff, and a one-way-door invite
  decline** — three findings from the usability review, triaged against the code rather than taken at
  face value. **(1)** Every CharGen cloud save passes `campaignId`; the Live Sheet's never did. That
  argument is the input to `saveCharacter`'s anti-fork guard: without it, an id that has drifted off the
  UUID format makes the sync layer **mint a new id and insert a fresh row** instead of adopting the
  campaign's existing one — stranding a campaign-less duplicate frozen at its pre-handoff state while the
  real bound row stops updating. `js/sync.js`'s own comment already described this exact failure. **(2)**
  Declining the invite prompt cleared the token and hid the banner, so a player who clicked Cancel lost
  the invite with no explanation and no way back; the token is kept now and the banner offers "Accept
  invite" / "Discard invite". **(3)** The "invite never shows as redeemed" report is **not a data bug** —
  `redeem_player_invite` stamps `redeemed_at`, `list_campaign_invites` returns it, the row renders
  "Redeemed", and 13 of 22 live invites carry it; verified end to end. The real problem was the roster and
  invite list going stale independently, so either panel's Refresh now reloads both. New
  `chargen-flows` gate (11 checks) covers handoff identity and decline recovery — verified RED against
  the reverted decline behaviour (5 of 11 failed). See
  `decisions/2026/D-GH-2026-08-04-handoff-identity-and-invite-decline.md`.

- **2026-08-04 · fix(sql): grant `service_role` its table privileges in `rls-policies.sql`** — production
  had **none**, and nothing noticed because the app never uses that role (it is the browser client
  throughout, on the anon key under RLS). It surfaced when `seed-review-stack.mjs` became the first
  thing to authenticate as `service_role` and every call returned "permission denied". Supabase's
  project defaults normally supply these, which is exactly why depending on them was wrong: this file's
  stated job is that a fresh project works. No widening — `service_role` already bypasses RLS by design
  and its key never reaches a browser.

- **2026-08-04 · fix(chargen): section-nav chips were mislabelled from 7 onward, one was dead, and Arts
  AP was shown on the wrong section** — found by the usability review. `SECTIONS` had **11** entries
  against the form's **10**: a standalone `Arts` entry survived after Arts & Techniques were merged into
  `Arts & Boons`. Because chips bind positionally (`SECTIONS[i]` → `#sec(i+1)`), every chip from 7 on
  carried the previous section's name — "Arts" jumped to *Class Access*, "Spellcasting" to *Arts* — and
  the 11th pointed at a `#sec11` that never existed. The quieter half: `updateSections()` breaks on the
  first matching entry, so **all Arts & Techniques spend was rendered as section 7's AP subtotal**, on
  *Class Access & Features*. Phantom entry removed; `buildSecNav()` now drops any chip whose target
  doesn't resolve and warns, so a future drift loses a chip instead of shipping a dead button; and
  `audit.py` gains a check (29 total) asserting `SECTIONS` and `buildForm()`'s `grp()` calls stay the
  same length — verified RED against the reintroduced bug.

- **2026-08-04 · test(dm-console): first automated UI coverage for the console** — `cloud-e2e` drives
  `js/campaign.js`/`js/dm.js` directly and never opens DM Console, so the rules panel could break on any
  change with every gate still green. `testing/scripts/dm-console-ui-e2e.mjs` (27 checks) covers the
  starting-tier model, its override semantics, and all three `startingTier` shapes `loadRulesIntoPanel`
  must survive. Needs no Supabase stack — supabase-js is vendored, so the module bridge loads offline and
  fires `campaign-ready` — which keeps it cheap enough to run on every PR. Verified RED before being
  committed (perturbing `TIER_BANDS.heroic` failed 2 checks), and it immediately caught a real one:
  legacy `legendary` (1.6 × 79 = 126) does not land on level 3 (127), so a mapped legacy value now keeps
  its saved number and shows as an override instead of displaying a level its figure doesn't match.

- **2026-08-04 · feat(dm-console): starting tier is now a level + a band, and an unconfigured campaign
  grants nothing** (SQL migration `2026-08-04-join-grant-absent-means-zero.sql`) — the old single ratio
  (Prelude 0.7× / Standard 1.0× / Veteran 1.3× / Legendary 1.6×) conflated "what level is this
  character" with "how well-resourced are they", and off a Standard L1 of 79 the presets were
  *literally* levels: 55 = L0, 79 = L1, 103 = L2. Now two dropdowns — **level 0–20**, priced off the
  campaign's own budget curve, and a band (**Gritty 0.85× / Standard 1.0× / Heroic 1.15×**) — with each
  level option showing its live AP. Old `{preset, ap}` maps across exactly. The Players-code row now
  states the grant where the code is copied ("grants **N AP**, once per character") with a link to
  change it. And the `absent → 79` default from earlier the same day is **reversed**: that 79 was a
  hardcoded input placeholder inside a collapsed panel, not a DM's choice, so an unconfigured campaign
  now grants 0 and says so on screen. Amble and any campaign with a saved figure are unaffected. Also
  fixes three help strings that still claimed the shared code granted no AP and created a blank
  character — it binds the character the player is *currently building*. See
  `decisions/2026/D-GH-2026-08-04-starting-tier-level-band.md`.

- **2026-08-04 · test(review): seeded review stack + usability/QoL review prompt** — `cloud-e2e` proves
  the signed-in paths work but tears the stack down immediately, so a usability review had no way to
  reach the cloud half of the app at all. `testing/scripts/seed-review-stack.mjs` seeds five accounts,
  three campaigns (configured / no-rules / archived), invites in four states, two players joining by the
  two different routes, awarded AP and DM notes — then serves the app and **stays up**. Deliberately
  includes mess an all-happy-path stack hides: an archived character, a revoked invite, an empty
  campaign, and a name carrying quotes, HTML tags and 60 chars of overflow to test `esc()` on every
  surface that renders it. Default mode is a throwaway local stack; `--live` targets a hosted project
  for when Docker isn't available, gated on three independent things, with `--reset` refused outright
  and `--purge` removing only tagged rows. `docs/review-prompts/usability-qol-review.md` is the
  paste-ready prompt. See `decisions/2026/D-GH-2026-08-04-review-stack-seed.md`.

- **2026-08-04 · fix(campaign): five review findings on the join grant** (SQL migration
  `2026-08-04-join-grant-bounds-and-default.sql`) — a campaign with **no** `rules.startingTier` granted 0
  while DM Console displayed 79; since `rules` defaults to `'{}'` and `createCampaign` never writes a tier,
  that was **3 of 4 live campaigns**, not an edge case. Absent now means 79. `'^[0-9]+$'` also accepted
  `'2147483648'`, whose `::integer` cast overflowed and **aborted the join** — now bounded to 7 digits, with
  anything malformed granting 0. DM Console's `parseInt(x,10) || 79` rewrote a DM's deliberate 0. And two
  paths read DM AP via `peekCharacter()`, which prefers the **local** copy — so a player whose DM had just
  paid them still saw 0 spendable AP, every purchase OVER BUDGET, and Randomize refusing; both now use a new
  `refreshServerAp()`. `cloud-e2e` gains three scenarios and goes 24 → 32 checks — including an
  unbind→rebind case, because the old "does not grant twice" check hit an early return and never reached the
  double-pay guard at all. See `decisions/2026/D-GH-2026-08-04-join-grant-followups.md`.

- **2026-08-04 · feat(campaign): joining by the shared code now grants the campaign's starting AP**
  (SQL migration `2026-08-04-campaign-starting-ap-on-join.sql`) — an invite created a character with its
  grant; joining by code only set `campaign_id`, so those players landed on **0 AP** with nothing saying
  so. `bind_character_to_campaign` now grants `rules.startingTier.ap`, the same figure that already
  pre-fills the invite, so one number governs both routes. Only on a genuine first bind, guarded against
  an unbind/rebind double-pay, additive, credited to the DM not the joining player, and a malformed rules
  blob grants nothing rather than blocking the join. Verified live (45 granted, provenance row written,
  rebind no-ops, malformed value joins cleanly at 0) and gated by a new `cloud-e2e` scenario.

- **2026-08-04 · fix(chargen): Randomize refuses instead of building an unaffordable character** — it used
  `spendable || DATA.level1AP || 79`, treating a legitimate **0** as "missing", so a character with no AP
  got a ~79 AP build it couldn't afford and was flagged OVER BUDGET the moment it finished. It now says
  "This character has no AP yet — ask your DM to grant some" and stops. Last instance of the falsy-zero
  bug class that caused the 79 AP conjured onto Cedric Brightblade.

- **2026-08-04 · chore(dm-console): remove six orphaned CSS rules** — `.grantCharList` / `.grantCharRow`
  and friends styled the per-character tick list deleted when grant codes stopped pretending to be
  per-character. Nothing carries those class names any more.

- **2026-08-04 · feat(dm-console): collapsible invite/advancement cards; the AP-ignore toggle is
  locked** — "Invite new player" and "Level budget curve · award pace · starting tier" are now
  `<details>`, collapsed by default, matching the pattern Campaign Rules already used; the campaign
  panel was a long unbroken scroll otherwise. **"Ignore player-entered AP" now sits behind a lock:** the
  checkbox is disabled until you click 🔒 Locked, changing it asks for confirmation spelling out the
  effect on every character in the campaign, and it re-locks immediately afterwards so an unlocked state
  is never left lying around. Selecting a campaign always lands locked. That setting decides whether
  every character's own log AP counts toward what they can spend — a stray click silently re-budgets the
  whole table, which is exactly how the original invite-AP confusion started.

- **2026-08-04 · fix(archive): archived characters and campaigns are actually hidden** — the archive
  feature (shipped 2026-07-25) was silently defeated outside the "My Characters" page: CharGen's and the
  Live Sheet's own cloud-load menus filtered on `kind` only and never looked at `archived_at`, so an
  archived character stayed fully loadable and playable in the two tools where characters are actually
  used. Both menus now exclude them. `listMyCampaigns()` gained the archived filter **by default** — it
  previously existed only as a local filter inside DM Console, so CharGen's campaign picker offered
  archived campaigns as selectable binding targets; DM Console now opts in with `{includeArchived:true}`
  because it needs them to offer Unarchive. `archiveCharacter()`/`unarchiveCharacter()` now check the
  updated row count: a Supabase UPDATE matching zero rows returns `error:null`, so a stale tab reported
  "Archived" success while nothing changed. DM Console's unarchive button escapes the campaign id, per
  the codebase's hard `esc()` rule. **Now gated:** four new `cloud-e2e` scenarios cover exactly this —
  the task noted "no automated gate catches this", and there is one now. Graduated off the 🔴 NOW board.
  Note the task's step 1 was already stale: `listCharacters()` had been consolidated into
  `listMyCharacters()` (which does select `archived_at`), so the duplication it described no longer
  existed — the live defect was the tools ignoring the field, not the query omitting it.

- **2026-08-03 · test(sw): a returning-visitor gate, and CharGen's dead service-worker registration** —
  new `testing/scripts/sw-cache-e2e.mjs` + CI workflow installs the real service worker, deploys a module
  change, and reloads *without* a hard refresh — the one state no other gate covers, and the only state in
  which the 2026-08-03 outage existed. Verified red on that exact bug (`events=["engine-ready"]` only,
  `does not provide an export named '__swProbe'`, exit 1) and green once fixed. Building it uncovered that
  **line 3905 of CharGen was the truncated fragment `<li><sp`**, unterminated since PR #210, which
  swallowed the `<script>` registering the service worker — so CharGen registered none of its own, masked
  only because `index.html` registers one for the whole `/PACT/` scope. A deep link straight to CharGen got
  no service worker, no offline support and no caching. Structure closed (the lost sentence is
  unrecoverable and is marked, not invented).

- **2026-08-03 · feat(vendor): the Supabase client is served from our own origin, not a CDN** — every
  cloud feature used to depend on `esm.sh` being reachable at page load, and an ES module import failure
  aborts the whole script, so an outage or an ad-blocker took the cloud half of every tool down. Now
  `js/vendor/supabase-js-2.110.2.js`, precached by the service worker. Uses the **official UMD build**
  (1 file, 206KB, zero imports) rather than esm.sh's ESM form, which resolves transitively to 6 files and
  268KB including injected node polyfills; adapted with a two-line export footer and no transform, since
  the UMD's top-level `var` is module-scoped inside an ES module. The version in the filename is
  load-bearing — an update is a new URL, so the SW can never serve it stale, which is what lets it stay
  cache-first. `audit.py`'s import-freshness check gained vendor awareness (it previously only matched
  same-directory imports and would have ignored `./vendor/…` entirely): it now fails on an unversioned
  vendor filename, a missing file, or one absent from `PRE_CACHE` — both new failure modes demonstrated
  red first. Verified with every third-party host blocked: all three tools fire their cloud event, which
  previously never fired at all.

- **2026-08-03 · fix(security): an invite's DM note is no longer readable by the player it describes**
  (SQL migration `2026-08-03-invite-note-dm-only.sql`) — `campaign_invites_select` lets a redeemer read
  their own row, and RLS being row-level meant that included the DM's `note`. Now withheld at the column
  level; the DM reads it through the SECURITY DEFINER `list_campaign_invites()`. Worth knowing: a
  column-level REVOKE cannot subtract from a table-level GRANT — the first attempt reported success and
  changed nothing — so the blanket grant is dropped and the columns granted explicitly. `select *` on
  this table now fails loudly for `authenticated` rather than silently omitting the column; nothing in
  `js/`/`tools/` selects it directly, so nothing breaks. Verified live as the `authenticated` role
  (note denied, `select *` denied, other columns fine) and as a simulated DM session (22 invites, notes
  intact). Advisor: no new findings.

- **2026-08-03 · fix(dm-console): the AP grant code stops pretending to be per-character; local tools
  grouped below the cloud campaign** — the grant card asked you to tick each character and set an amount
  each, implying every code was bound to a character. `dmMakeGrant()` encodes an **amount and a note and
  nothing else**, so every generated code worked for whoever pasted it — the UI described a binding the
  format never had. Reduced to one amount, one note, one code, with the sharing model stated plainly.
  The two non-cloud cards (Import roster · AP grant code) now sit inside one **Local files & grant
  codes** master card placed *below* Campaign (cloud), and dim with an explanation once the loaded
  campaign actually has characters — pointing at the roster's own Award AP instead. Dimmed, not
  disabled: importing a local file for reference while running a cloud campaign is still legitimate, so
  this is guidance rather than a lock, and hover/focus restores full opacity.

- **2026-08-03 · fix(chargen,livesheet): loading a campaign character no longer conjures 79 player AP;
  the tool-switch keeps its campaign** — three separate faults, all downstream of moving the invite grant
  into the DM pool. (1) `applyBuild` used `b.budget || DATA.level1AP`, treating a legitimate **0** as
  "missing". Harmless while every campaign character carried a LOG award; a data bug the moment their
  budget legitimately folded to 0 — each load wrote 79 into the field and `_cgSyncAward()` emitted
  `award 79`, manufacturing player AP from nothing. Inert on a campaign with `ignore_player_ap`, silently
  inflating the budget on any campaign without it. The budget `<select>` also started at 12 and so could
  not represent 0 at all: it blanked, and the empty-field fallback minted 79 regardless. Fixed at all
  three points — nullish default, a numeric parse that accepts 0, a 0 option in the select, and no
  zero-award minted for a character that has none. (2) The Live Sheet's handoff-receive never adopted the
  campaign binding, so a CharGen → Live Sheet → CharGen round-trip reported `campaignId: null` and the
  character appeared detached with 0 DM AP — the database row was never touched. It now adopts the
  binding and resolves the authoritative `ap` from the server. (3) The version banner was a one-shot side
  effect that never cleared, so a banner raised by an earlier stale load sat over a current-version
  character and contradicted the version line beside it; it is now recomputed from `loadedRules` on every
  render, like the line it disagreed with.

- **2026-08-03 · feat(dm-console): invites are listed, labelled and withdrawable** (SQL migrations
  `2026-08-03-invite-notes-and-revoke.sql`, `-invite-manager-grant-lockdown.sql`) — a generated invite
  link previously existed only wherever the DM pasted it, so unredeemed ones accumulated invisibly
  (Amble had nine) with no way to tell which was meant for whom or what AP it carried. Now: an optional
  **Note** when generating (which also becomes the note on the AP award the character receives), and an
  **Invites issued** list showing each invite's note, AP, issue date and state — Open / Redeemed (with
  redeemer and character) / Withdrawn — with copy and **Withdraw** on outstanding ones and Restore on
  withdrawn ones. Withdrawal is soft (`revoked_at`), so the record of what was issued survives; a revoked
  invite is refused at redemption, checked before the claiming UPDATE so it can't be consumed by a race.
  Redeemed invites are immutable. Two problems the Supabase advisor caught and this fixes: `create or
  replace` with a new signature had left the **old 3-argument `create_player_invite` alive alongside the
  new one** (dropped — PostgREST resolves a 3-key call against the defaulted 4-argument version), and all
  three new/changed functions had inherited Postgres's default `EXECUTE to PUBLIC`, making them
  `anon`-callable; now revoked to `authenticated` only, matching the existing convention. **Caveat:**
  `campaign_invites_select` lets a redeemer read their own row, so a player can read the note on the
  invite they redeemed — treat notes as labels, not private commentary.

- **2026-08-03 · fix(sw): a network-first module must not import a cache-first one** (`CACHE_NAME`
  `pact-v7` → `pact-v8`) — `js/sync.js` is network-first and began importing `isCloudCharId` from
  `js/character-store.js`, which was cache-first. Returning users therefore ran today's `sync.js` against
  a cached `character-store.js` with no such export, and a named ES import the target doesn't export is a
  **link-time** failure: the whole module graph refused to instantiate. The cloud bridge died on every
  normal load while the engine bridge (importing only pre-existing names) linked fine — producing a
  rendered-but-cloud-less app: empty "My Characters" for an account with 8 characters, invites never
  redeemed so the previous character stayed on screen, "Sign in for campaign rules" while signed in, and
  the Live Sheet's cloud-unreachable banner. A hard refresh bypasses the service worker, which is exactly
  why everything "worked after a hard refresh". `character-store.js` is now network-first and the cache
  name is bumped so already-broken browsers self-heal on next load. **New guard:**
  `testing/scripts/audit.py` check `service-worker import freshness` fails if any network-first module
  imports a cache-first one — verified to go red on this exact bug and green once fixed.

- **2026-08-03 · fix(chargen,characters): feedback button no longer covers the AP ledger; My Characters
  gets a Back control** — the fixed feedback button sat on the last rows of CharGen's ledger, so
  `#sumdetails` now reserves its footprint rather than moving an affordance all three tools share. My
  Characters only offered "All tools", so arriving from a tool left no way back to it; a Back button now
  appears when there's same-origin history to return to, and stays hidden when there isn't.

- **2026-08-03 · fix(invites,chargen,livesheet): an invite grant is a recorded award; a saved file keeps
  its campaign binding** (SQL migration `2026-08-03-invite-grant-award-row.sql`) — redemption now writes
  an `ap_awards` row for the grant, attributed to the DM who created the invite rather than the redeeming
  player. Without it `ap_awards` was empty campaign-wide, which also meant Live Sheet's
  clone-to-standalone — which converts DM AP into itemized log entries by reading that table — silently
  dropped a character's entire starting grant. Five existing characters backfilled. Separately, the local
  file, tool-handoff and share-link loads all zeroed DM AP; correct when it was a bonus on top of a LOG
  award, total budget loss once the grant became the whole budget (an exported campaign character opened
  at `budget 0 · remaining -14`, every purchase flagged over). Envelopes and handoff batons now carry the
  campaign **binding** only — never the AP number, which the engine's ANTI-DOUBLE-COUNT INVARIANT forbids
  in an export — and the reader resolves the authoritative `ap` from the server when signed in, or reports
  DM AP as *unavailable* when not. The binding is covered by the D-GH48 signature, so editing it reads as
  tampered. `#b=` share links deliberately unchanged: they carry the folded build, not the log, and are
  the one path where a stale AP number would spread to other people. See
  `decisions/2026/D-GH-2026-08-03-invite-grant-award-row.md`.

- **2026-08-03 · fix(sync): the UUID id migration must not fork a campaign-bound character** — the
  migration shipped in v1.309 minted a fresh UUID unconditionally, which INSERTS a new row. A
  campaign-bound character whose id had drifted onto the legacy format was therefore saved as a
  brand-new, campaign-less duplicate while its real bound row kept only the seed log. Hit on the first
  real character through the path: one build landed as two orphan rows (`campaign_id` null, `ap` 0)
  while the Amble-bound row still showed 2 events, so opening it looked like the work had vanished.
  `saveCharacter()` now takes an optional `campaignId` and, when migrating, adopts the server's
  existing row for that campaign instead of minting — the DB already enforces one character per player
  per campaign, so the row is unambiguous. CharGen passes it on all three cloud-save paths.

- **2026-08-03 · fix(characters): device-only rows can be archived, deleted, and seen** — archiving sent
  a legacy pre-UUID id to Postgres and threw `invalid input syntax for type uuid`; since Delete was
  only offered once archived, those orphan rows could not be removed at all. Archive/unarchive/delete
  now handle local-only ids entirely in localStorage (and skip the tombstone, which could never be
  cleared for an id `replayDelete()` can't send). Device-only rows get a direct "Delete from this
  device" instead of the cloud-only Archive step, with a confirm that says which copy is going. The
  page also no longer hides everything behind a "reconnect" card when offline — `listMyCharacters()`
  always had an offline branch, so withholding it hid exactly the at-risk device-only copies; campaign
  names now degrade to "Unknown campaign" rather than failing the whole list.

- **2026-08-03 · fix(sync): character ids are UUIDs — locally-born characters can finally reach the
  cloud** — `genCharId()` minted `'c'+base36` (e.g. `cmscl7ilrr5muh`) while `characters.id` is a
  Postgres `uuid`, so saving a locally-created character failed with `invalid input syntax for type
  uuid` — and since `saveCharacter()` writes localStorage before pushing, every attempt left an
  orphaned local copy, showing the same character twice in My Characters. Only cloud-born characters
  (invite redemption) had ever synced. Ids are now `crypto.randomUUID()` (with a `getRandomValues`
  v4 fallback for non-secure contexts); new `isCloudCharId()`; `saveCharacter()` migrates a legacy id
  on first push and returns it, and all four save call sites adopt it — the join-campaign path
  reassigns its local `id` too, since `bindCharacterToCampaign` runs straight afterwards. See
  `decisions/2026/D-GH-2026-08-03-uuid-character-ids.md`.

- **2026-08-03 · feat(characters): My Characters shows ☁ Cloud vs 📥 Device only** — both kinds rendered
  identically, so a character that had never reached the server looked as safe as one that had.
  `listMyCharacters()` now tags each row `cloud`/`pendingSync`; offline it reports what the device last
  knew (`!dirty`). This is also what lets an owner tell an orphaned local duplicate from the real row.

- **2026-08-03 · fix(invites): ONE AP grant per invite, paid as DM AP** (SQL migration
  `2026-08-03-invite-single-ap-grant.sql`) — an invite carried two numbers and the second, "Creation
  budget", was seeded into the character's LOG as **player** AP. `compute()` resolves
  `spendable = (ignorePlayerAp ? 0 : playerAp) + dmAp`, so on a campaign with "ignore player AP" set,
  the whole grant was awarded and discarded on the same pass. Live example: Amble issued 36 + 55, the
  player could spend 36, and CharGen announced "created with 55 AP budget". Now one "Starting AP" field
  paid into `characters.ap` — correct whichever way the toggle is set, and unlike a LOG award the
  player can't edit their own grant. Both RPCs keep their signatures and fold
  `starting_ap + starting_budget` server-side, so a Pages deploy and a DB migration need not be atomic
  and pre-migration invites still pay out in full; `starting_budget` is deprecated and always written 0
  but deliberately **not** dropped. Advisor re-run after the migration: no new findings. See
  `decisions/2026/D-GH-2026-08-03-invite-single-ap-grant.md`.

- **2026-08-03 · feat(chargen): cloud autosave for campaign-bound characters** — CharGen only ever wrote
  to the cloud on an explicit action, so a player who redeemed an invite and started building stayed
  invisible in their DM's roster until they happened to press Save. Now debounced (3 s after edits stop)
  for characters bound to a campaign — the one case where somebody else is waiting on the data. Solo
  local builds keep manual saving and today's traffic profile. Pushes never overlap (`pushCharacter()`
  is a bare update-then-insert with no dirty check, so a slow request overtaken by a fast one could land
  the older build last), and failures stay silent because the local autosave already holds the work.

- **2026-08-03 · fix(chargen,dm-console): campaign status line after a join; a named character keeps its
  name in the DM roster** — CharGen's header kept reading "Signed in — no campaign selected" for a
  demonstrably bound character: the `<select>` was built at sign-in *before* the join so
  `selEl.value = camp.id` no-opped, and `renderStatus()` was never called from outside its closure. New
  `_cgAdoptCampaign()` fixes both. In DM Console, a character the player had named and saved rendered as
  "Unnamed character" — `hasData` rightly requires a `buy` event, but the placeholder card never
  consulted the `name` column that `getRoster()` already selects.

- **2026-08-03 · fix(dm-console): Starting tier AP follows the budget curve's L1** — the tier is a ratio
  of L1, but only recomputed when the *tier* dropdown changed, so switching Standard→Generous left the
  invite prefill on the old number (Amble: tier 79 against a curve L1 of 83). Now recomputes when L1 or
  the curve preset moves, and never overwrites a DM's own 'custom' figure.

- **2026-08-03 · fix(dm-console): explain the advancement dials and the two invite AP fields** — added
  an ⓘ to each of “Level budget curve”, “Award pace (AP per session)” and “Starting tier (new-PC
  budget)” spelling out what each dial actually drives (and, for the budget curve, that it now also
  sets the creation-lock threshold — its note previously claimed “display only”). Rewrote the invite
  form's two tooltips: both grants are spendable, and the real difference is ownership — **Creation
  budget** becomes the first entry in the player's own AP ledger (“Starting creation budget (79 AP)”,
  theirs to undo/redo against), while **Bonus DM AP** lives on the character record server-side,
  DM-only, invisible in that ledger. The old Bonus DM AP tooltip said it “does NOT get spent building
  the character”, which was wrong: `compute()` sets `spendable = playerAp + dmAp`. UI text only.

- **2026-08-03 · fix(rules): the AP-by-level ladder is the Standard BUDGET curve — 50 → 79 at L1**
  (`DATA.version` **v0.337 → v0.338**) — `js/ap-by-level.js`'s `{1:50, 2:92 … 20:491}` was never a
  rules curve. Per the Players Guide it was the appendix roster of twenty pregenerated Emberwatch
  sample characters (“a 1st-level recruit (50 AP) to a 20th-level archmage (491 AP)”), transcribed
  into a table and subsequently mislabelled a “pace curve”. PACT has a **budget** curve (what a
  complete level-N build has spent: Standard L1 79/+24, Generous 83/+28) and an **award pace** (AP per
  *session*, ~7) — and no AP-earned-per-level schedule at all. The ladder is now derived from
  `LEVEL_BUDGET_CURVES.standard` by a new `budgetLadder({l1,inc})` covering levels **0–20** (level 0 =
  55 on both presets, the Guide's prelude tier, straight out of the same formula). `DATA.level1AP` and
  `DATA.defaultAp` become **79**, so a new solo character is offered a real level-1 budget and the
  creation lock's fallback threshold is right by default. Also updated CharGen's budget picker default
  and its stale hint (“L1 50 · L5 176 … L20 491”). Parity **24/0** with `testing/expected/` untouched
  — the four threshold fixtures had their filler spend and their matching award raised by the same
  delta, so `remaining` and every expected value held still; audit 27/0, fuzz 500/500, browser e2e
  3/3. See `decisions/2026/D-GH-2026-08-03-ap-budget-curve-standard.md`.

- **2026-08-03 · fix(engine): creation-lock threshold reads the campaign's BUDGET curve, not the pace
  curve** — *(“pace curve” here is the mislabel corrected by the entry above; the mechanism it
  describes is unaffected)* — the auto-lock compared AP spent against `DATA.level1AP` (50). That's the *pace* curve —
  AP **earned** by level. The lock asks "is this character finished being built?", a question about
  **spend**, which is the separate *budget* curve (what a complete level-N build costs: Standard
  L1=79, Generous L1=83, per-campaign). `D-GH-2026-07-14-advancement-tracks` had already flagged this
  exact conflation as a follow-up. New pure export `creationLockThreshold(campaignRules)` resolves
  `rules.levelBudgetCurve.l1`, falling back to `DATA.level1AP` for solo/untuned characters; CharGen's
  invite redemption stamps it into the character's log at seed time. For Amble (Generous) the
  threshold becomes **83**: a player can spend their whole 70 AP grant and stay in creation, locking
  only once in-play spending passes what a complete level-1 build costs. Verified the Players Guide's
  Level 0 (55 AP) also sits on the budget curve and already falls out of the existing formula — no
  table row is missing. No `DATA.version` bump (the threshold is a log event, so `compute()` output
  is unchanged for every pre-existing input). Parity 24/0. See the 2026-08-03 addendum in
  `decisions/2026/D-GH-2026-08-02-creation-lock-switch.md`.
- **2026-08-02 · feat(engine): creation-lock switch — the engine half (events, precedence, backward
  compatibility)** — PACT's rules price own-species racial traits cheap during creation and expensive
  if claimed later, but nothing could ever mark a character "finished," so the expensive branch was
  unreachable. Both states the app has actually shipped were wrong: pre-D-GH37 every trait priced
  *expensive* (local folds never produced the per-trait lock stamp, so `compute()` fell through to
  `baseBuild()`'s unconditionally-true `inPlay`); post-D-GH37 every trait prices *cheap* (real replay
  stamps `false`, no trigger exists). Measured at tier 3: 4 AP unlocked vs 10 locked. Adds
  `creationLockConfig{auto,threshold}` (last-write-wins per field) and `creationUnlocked`
  (last-write-wins with `creationLocked`, future-only, and suppressing the auto-lock so unlocking an
  over-threshold character isn't a same-pass no-op); documents the precedence rule above `_replay()`.
  Fully backward compatible — the plan's specified "defaults off" would have broken three existing
  fixtures that assert `campaignBound` alone arms the lock, so `auto` falls back to campaign
  membership when unconfigured. Parity 20/0 → **24/0** (4 new fixtures; all repo references to the
  old count updated). Engine only — no UI, and **no production data written**. See
  `decisions/2026/D-GH-2026-08-02-creation-lock-switch.md` and
  `docs/plans/2026-08-02-creation-lock-switch.md`.
- **2026-08-02 · fix(dm-console): clarify the two AP fields on a player invite** — the invite form's two
  number inputs were bare placeholders ("Starting DM AP" / "Starting budget") with no explanation, and
  they fund two genuinely different pools — which read as one confusing number in the resulting
  character's ledger. Now proper labels with ⓘ tooltips: **Bonus DM AP** ("extra AP always available on
  top of what the character earns — the same pool as clicking Award AP later; does NOT get spent
  building the character") and **Creation budget** ("how much AP the player has to spend BUILDING their
  character — the same starting budget every character gets, just customizable"). Also renamed the
  card's "DM AP (server total)" row to "Bonus DM AP" to match, and the invite-seeded ledger entry from
  the generic "Award — budget (N AP)" to "Starting creation budget (N AP)". Display-only; no change to
  which pool anything actually goes into. (`_cgSyncAward()`'s live-reconcile label deliberately left
  alone — its equality guard compares the whole event, so renaming it would churn every existing
  character's LOG on next load for a pure wording change.)
- **2026-08-02 · fix(dm-console): "View" button is always visible, next to Skills/Tools** — the "👁 View
  in Live Sheet" button (shipped earlier today) lived inside "DM tools (private)," a collapsible
  section that's closed by default on a fully-built character's card (same as every other section) —
  so it looked like the button was missing entirely on real characters, only showing on unbuilt
  placeholder cards (which have no collapsible sections at all). Moved it out to the always-visible
  top action row next to "🎯 Skills"/"🛠 Tools" on every cloud character (built or not), shortened the
  label to "👁 View". Award AP/History/Remove/notes stay inside the collapsible section — this is the
  one DM action reached for often enough to not want an extra click for.
- **2026-08-02 · fix(dm-console): dark-mode contrast on the Skills/Tools overlay popups** — the
  per-character "🎯 Skills"/"🛠 Tools" popup (and its own trigger buttons) had a hardcoded white
  background and navy/gray text, so in dark mode it showed as a light card floating on the dark page.
  Added a new `--info`/`--info-bg` theme variable pair (matching the existing `--good`/`--good-bg`
  pattern — there wasn't one for this "blue" highlight before) and switched `.ov-card`, `.ov-x`,
  `.ov-h`, `.ov-sub`, `.sktab` (proficient/expertise row highlighting, borders), and `.skbtn` to the
  theme variables already used elsewhere in this file. Light/dnd/royal/forest are visually unchanged
  (verified pixel-identical computed styles before/after); only dark mode's colors actually change.
- **2026-08-02 · fix(security): background auto-sync no longer caches every character a DM can see** —
  `js/sync.js`'s `syncAll()` (runs automatically on every signed-in page load) queried `characters`
  with no owner filter, relying entirely on RLS — for a DM that meant every player's character in
  every campaign they run got cached locally as routine background behavior. Previously harmless only
  because `listMyCharacters()`'s `dirty` check happened to exclude these downstream, not because the
  fetch itself was scoped correctly. Added `.eq('owner_id', user.id)`, same pattern as
  `listMyCharacters()`. See `decisions/2026/D-GH-2026-08-02-syncall-owner-scope.md`.
- **2026-08-02 · feat(dm-console): read-only "View in Live Sheet" for a player's character** — DM
  Console's cloud roster cards get a "👁 View in Live Sheet ↗" button opening the character's full
  sheet in a new tab, genuinely read-only. Doesn't reuse the existing `?cloudChar=` deep link (that
  makes the character the tab's active/editable one and immediately calls `save()`, risking cross-tab
  corruption of the shared local-autosave slot, and a new trigger for the `listMyCharacters()`
  local-cache leak if "☁ Save to cloud" were clicked). Instead: a new `?viewChar=` link fetches via
  `peekCharacter()` (never touches `localStorage`) and a `VIEW_ONLY` flag gates `emit()`/`save()`/
  `undo()`/`redo()` — the choke points every mutation already routes through — plus hides the controls
  that would otherwise look interactive. See
  `decisions/2026/D-GH-2026-08-02-dm-readonly-livesheet-view.md` (also flags a separate, pre-existing
  `syncAll()` finding worth a defense-in-depth follow-up).
- **2026-08-02 · fix(chargen): clearer message when a redundant invite finds an existing campaign
  membership** — a DM sent a player two invites to the same campaign; the second showed "Could not
  join campaign: You have already joined this campaign," reading as a failure though nothing actually
  went wrong (verified: the player has exactly one character, no data lost). Invites are anonymous
  single-use tokens with no player identity at generation time, so this can't be caught before
  redemption — `tryRedeem()`'s catch block now recognizes this specific case and shows "You're already
  in this campaign — this invite wasn't needed" instead. See
  `decisions/2026/D-GH-2026-08-02-invite-already-joined-message.md`.
- **2026-08-02 · fix(security): "My Characters" local-storage merge no longer resurrects other
  accounts' characters after the server-side leak fix** — a DM still saw 4 other accounts' characters
  on `tools/characters.html` after `listCharacters()`'s owner-filter fix shipped. Root cause was
  client-side: `listMyCharacters()`'s local-storage merge (meant to surface not-yet-synced drafts)
  trusted *any* character cached in `localStorage` by id as "mine," with no ownership check —
  `loadCharacter()`/`reconcile()` caches any character it can fetch (by design, for DM/campaign-role
  reads) with no owner check either, so a character viewed once while the server-side bug was live
  stuck in the local cache forever, on that device, even after the server fix. Now requires
  `dirty === true` (set only by this device's own unsynced `saveCharacter()` calls, cleared on
  successful push) for a local-only entry to count as "mine." Verified via a headless-Playwright unit
  test against the real `js/sync.js`. See
  `decisions/2026/D-GH-2026-08-02-listmycharacters-local-cache-leak.md`.
- **2026-08-02 · chore(release): `BUILD` format corrected to `v<major>.<PR#>` (v1.293)** — follow-up
  to the entry below: after PR #293 merged with `BUILD = "v293"`, clarified the intended format
  includes a manual major/epoch number ahead of the PR number (`v1.293`, not a bare PR number). The
  major is a plain manual value, starting at `1`, carried forward unchanged at every future promotion
  unless a human explicitly bumps it for a relaunch/milestone — never inferred from a promotion's
  contents. Corrected `js/engine.js` and all three tools' mirrors to `v1.293`; updated
  `docs/VERSION-SYNC.md`'s promotion procedure and `AGENTS.md` to match. See the addendum in
  `decisions/2026/D-GH-2026-08-02-build-version-pr-linked.md`.
- **2026-08-02 · docs(versioning): `BUILD` is now the promotion PR number, not a manual counter** —
  `js/engine.js`'s `BUILD` used to be an independently-incremented `v0.10x` string, bumped on an ad hoc
  schedule. It's now `v<N>` where `N` is the GitHub PR number that promotes `preview` → `main` (e.g.
  `v268` for PR #268), set once as part of that promotion PR and never inside a regular feature PR.
  Removes a manual "what's the next number" step (the same shared-mutable-counter hazard already
  documented for the old `D-GH<N>` decision numbering) and makes every build directly traceable to
  the exact PR diff it shipped — `github.com/Chompy78/PACT/pull/<N>` *is* the build. `DATA.version`
  (the separate rules-version axis) is unaffected. Updated `docs/VERSION-SYNC.md` (full promotion
  procedure) and `AGENTS.md`. See `decisions/2026/D-GH-2026-08-02-build-version-pr-linked.md`.
- **2026-08-02 · fix(security): CharGen's/Live Sheet's cloud "Load saved character" menu no longer
  leaks other players' characters to a DM** — live report: "why can I see 4 characters, I should only
  have 1." `js/sync.js`'s `listCharacters()` (used by both tools' ☁ Cloud menu) had no `owner_id`
  filter and relied entirely on RLS, whose `characters_select` policy deliberately also grants a DM
  read access to every character in campaigns they run (needed for DM Console's roster). Confirmed
  live against the production DB: the 4 rows belonged to 4 different Google accounts — other players
  who'd redeemed invites into a campaign the reporting user DMs, not characters they'd created. Deleted
  `listCharacters()` entirely (verified zero other callers) and pointed both cloud-menu call sites at
  the already-existing, explicitly owner-scoped `listMyCharacters()` (already used by `characters.html`).
  See `decisions/2026/D-GH-2026-08-01-dm-console-listcharacters-leak.md`.
- **2026-08-02 · fix(dm-console): cloud roster's "has this character been built yet" check no
  longer false-positives on CharGen's auto-synced default name** — the empty-invite placeholder fix
  earlier today treated a `buy`/`buyoff`/`names`/`name` event as evidence a player had actually
  built something, but CharGen's invite-redemption seed (`_cgApplyEnvelope`, tools/PACT-CharGen-
  Webtool.html ~line 2854) unconditionally re-syncs a `type:'name'` event from the boot-time
  `#cname` field as "back-compat" — even when that field still holds the server-assigned default
  "New Character" the player never touched. Every freshly-redeemed invite therefore already carried
  a `name` event alongside its seed `award`, so it still rendered the full baseBuild()-defaults card
  instead of the placeholder — confirmed live (a real campaign character showing "New Character",
  HP 6, AC 10, Purchases 0). `hasData` now checks for a real `buy` event only, matching the same
  definition the "Purchases" count elsewhere in this file already uses — `name`/`names`/`buyoff`
  events alone no longer count.
- **2026-08-02 · feat(dm-console): AP grant code is now per-character, both bottom panels are
  collapsible** — two live-testing follow-ups. (1) "AP grant code" (`#grantPanel`) generated one code
  for the whole party at one shared amount; it's now a `<details>` (collapsed by default, like the
  import panel) listing every character currently loaded (local imports + cloud roster, including
  not-yet-built placeholders) with a tick-box and its own amount field, so a DM can grant different AP
  to different players in one pass — "Generate code(s)" produces one code per ticked character, each
  shown with its own Copy button. (2) The "Campaign (cloud)" panel (`#campPanel`) is now also a
  `<details>` (open by default, since it hosts sign-in/campaign-select) — the collapse mechanics
  (chevron, marker suppression) were generalized from `#importPanel`-only CSS to a shared
  `details.panel` selector so all three bottom panels collapse identically.
- **2026-08-02 · fix(dm-console): cloud roster card no longer shows a fake "fully built" character for
  an unopened invite** — a freshly-redeemed player invite's LOG holds only the seed `award` event (no
  `buy`/`names`/`name`), but `cloudAnalyze()`'s `hasData` check only verified the LOG was an array, so
  it ran `dmAnalyze()` anyway and rendered a full card off `baseBuild()`'s bare engine defaults (Human
  Fighter, HP 6, AC 10, Speed 30′…) as if the player had actually chosen them — the exact "card just
  says 'New Character', no real details" reported from live testing. `hasData` now requires at least
  one real build event in the LOG; without one it falls back to the existing "No character data yet"
  placeholder, which already existed for this case but was never reached.
- **2026-08-02 · fix(dm-console): Table/Card view toggle now covers the cloud roster, dark-mode
  contrast on card headings/stat-strip/section-rows, collapsible local-import card** — four bugs from
  live testing. (1) Clicking "Table view" visibly did nothing for a DM with only cloud (campaign)
  characters loaded — the toggle only ever drove `#grid`/`#tableRoot` from the local `roster` array;
  `#campRoster` (cloud cards) was a separate container it never touched. Table view now merges local +
  cloud data (`_combinedRoster()`/`_rows()`/`_idOf()`), and `#campRoster` itself switches between its
  own rich cards and stepping aside for the shared table. Cloud roster is also now cleared on sign-out
  and campaign deselection, so stale data can't leak into a later Table view. (2) The 6 stat-strip boxes
  (HP/AC/Speed/Pass Perc/Prof/Save DC) had a hardcoded near-white background (`#fafcff`) instead of a
  theme variable, so in dark mode they stayed white while their (theme-aware) text went light-on-light.
  (3) Several card-view text colors (`.cname`, `.secrow`, `.kvrow .vv`, `.summary b`,
  `#campSection .cstitle`) used `--navy` directly, which dark mode redefines to a near-black shade for
  its OWN use as a *background* (header gradient, buttons) — unreadable as foreground text on the
  also-dark card background it actually sits on. Added a new `--heading` variable (indirects through
  `--navy` so dnd/royal/forest need no change; dark mode gets an explicit light override) and swapped
  those five selectors to it; also fixed `.secrow:hover`'s hardcoded near-white hover background the
  same way. (4) The redundant "Drop your players' exported .json files here" banner (`#empty`, shown
  above the Campaign Roster whenever no local file was imported — which is always, for a DM working
  purely from the cloud) is removed; the dropzone and "Import roster" panel are merged into one
  collapsible `<details>` card (collapsed by default), decluttering the page for the common case.
  Verified via headless Playwright against the real DM Console code (toggle with cloud-only data,
  dark-mode screenshot before/after, light-theme regression screenshot, collapsed/expanded import card,
  file import still working nested inside `<details>`); `engine-parity-ci.mjs` 20/0 and
  `random-manual-e2e.mjs` green (no `js/engine.js` change).

- **2026-08-01 · docs(agents): fix two more stale `AGENTS.md` bullets referencing removed
  `buildToLiveLog()`/`_lsImportFold`** — verified in `tools/PACT-CharGen-Webtool.html` (code comment at
  the old call site: "D-GH40: buildToLiveLog()/exportToLiveSheet() removed") that CharGen's last local
  `MUT` closures were deleted along with the whole dedicated-export path, not just superseded. Corrected
  the High-risk-files bullet, the Architecture MUT-bridging paragraph (CharGen's `MUT` is now fully
  bridged like the other two tools, no local exceptions), and the old "CharGen → Live Sheet export
  (D-GH3)" bullet to describe the current mechanism (shared save envelope + `switchToLiveSheet()`
  handoff, D-GH38). Docs-only.

- **2026-08-01 · docs(agents): fix stale `AGENTS.md` Persistence bullet describing `characters.stats`** —
  same pre-D-GH40 claim as the `sql/schema.sql` fix above ("CharGen = a flat build JSON; Live Sheet =
  an event log"), corrected to describe the one shared `{schema:'pact-character/1', ...}` envelope both
  tools have used since 2026-07-10. Docs-only.

- **2026-08-01 · docs(schema): fix stale `sql/schema.sql` comments describing `characters.stats`** —
  the header design notes and the `stats`/`kind` column comments still described the pre-D-GH40 state
  (CharGen = flat build JSON, Live Sheet = event log). Since D-GH40 (2026-07-10) both tools share one
  canonical envelope, `{schema:'pact-character/1', rules, name, LOG, SEQ, id}`; `kind` now only marks
  which tool owns/opens a character, not a different data shape. Docs-only, no schema/DDL change.

- **2026-08-01 · feat(dm-console): cloud campaign roster now renders as full character cards, plus
  "remove from campaign" and DM-private per-character notes** — three linked gaps found live-testing:
  (1) cloud (campaign) characters showed in a bare Player/Character/DM-AP table, not the rich card
  view local `.json` imports get. `#campRoster` now renders through the exact same `cardHTML()` /
  `buildSections()` / `analyzeAug()` pipeline as the import grid (full stats, skills, spellcasting,
  etc.), sharing the `[data-sk]`/`[data-tools]`/`[data-known]` overlay handlers via a small
  `findRosterEntry()` lookup that checks both rosters. (2) there was no way to remove a character from
  a campaign at all — `characters.campaign_id` had no "unset" path (only `join_campaign()` /
  `bind_character_to_campaign()` ever set it). Added `dm_unbind_character()` (SECURITY DEFINER RPC,
  mirrors `award_ap()`'s shape) — a soft "kick": the character and its data/AP survive, it just leaves
  the campaign's roster; exposed as a "Remove from campaign" button with a confirm dialog, deliberately
  *not* the local grid's quick corner "×" (that one's trivially reversible; unbinding isn't). (3) added
  DM-only player-name label + freeform notes per character, editable inline on each cloud card and
  saved via `setCharacterDmNotes()`. Stored in a new `character_dm_notes` table (not new `characters`
  columns — a blanket `select` grant on `characters` means any new column there would be visible to the
  character's own owner the moment their row passes RLS; a separate table with its own DM-only policy
  avoids that). DB migration applied to the live project + verified via `get_advisors` (no new issues).
  See `decisions/2026/D-GH-2026-08-01-dm-console-cloud-roster.md`.

- **2026-08-01 · feat(engine, chargen): warn when a Tradition has no Discipline chosen (`DATA.version`
  v0.336 → v0.337)** — a Tradition ("Arcane"/"Divine"/"Primal") with every discipline slot left at
  "(none)" was priced as a complete no-op: `compute()` skipped it entirely (no Foundation cost, no line
  items) with zero indication anything was incomplete. `js/engine.js` now pushes a
  `"<Tradition>: no Discipline chosen — pick one to activate this Tradition…"` warning for this state,
  which surfaces automatically as a real ⚠ issue (not an advisory ⓘ) in every tool's warnings/Issues tray
  since they all read `compute()`'s `warnings` live. CharGen additionally shows an inline red "⚠ No
  discipline chosen" marker directly on the empty discipline row (`tools/PACT-CharGen-Webtool.html`'s
  per-discipline render block), since that's the one tool where this state is actually reachable
  (Live Sheet's discipline buy buttons always target a named discipline). Bumped `DATA.version` because
  this changes `compute()`'s possible `warnings` output; the 20 parity fixtures don't exercise this state
  so `testing/expected/` needed no changes — confirmed 20/0 before and after. Mirrored the new version
  string into CharGen's hardcoded cosmetic labels (header comment, `<title>`, `#cgPactver`) and
  `docs/AI_review_prompt.md`.

- **2026-08-01 · fix(chargen): half-caster discipline cantrip picker silently discarded selections** —
  reported live: picking a cantrip count for a Paladin/Ranger discipline in CharGen showed a priced,
  fully-clickable dropdown but added no ledger line and deducted no AP. Root cause: `js/engine.js`'s LOG
  replay correctly zeroes `cantrips` for any discipline in `DATA.noCantrip` (half-casters can't take
  cantrips) on every fold, but `tools/PACT-CharGen-Webtool.html`'s `.disc-cant` `<select>` had no matching
  UI guard — Live Sheet already avoids this by simply not rendering the Cantrip buy button for these
  disciplines. Fixed by disabling the select and resetting its displayed value to 0 whenever the current
  discipline is in `DATA.noCantrip` (covers both picking a half-caster discipline directly and switching
  an existing discipline into one), with a tooltip explaining why. No `js/engine.js`/`compute()` change —
  reproduced and verified via a headless Playwright drive of the real CharGen UI (stubbed Supabase CDN
  import); `testing/tests/engine-parity.html` still 20/0.

- **2026-08-01 · feat(dm-console): restructure the Campaign (cloud) panel into per-purpose tiles, add DM
  notes, alphabetize banned lists** — the panel had grown into one long undifferentiated block. Split it
  into visually distinct nested tiles in order: Owner settings (ignore player-entered AP) → Invite new
  player (player/DM codes + invite generator) → Campaign Rules (banned lists, multi-discipline toggle,
  house rules) → Level budget curve / award pace / starting tier → a new DM notes tile (free-text,
  campaign-scoped, stored in the same `campaigns.rules` JSONB column as `rules.dmNotes`, own "Save notes"
  button) → New campaign / archived campaigns, with "Archive campaign" moved to the bottom of that tile.
  All seven banned-item grids (`ruleBannedSpecies`/`…OriginSpecies`/`…OriginClasses`/`…Masteries`/
  `…Boons`/`…Drawbacks`/`…Arts`) now render alphabetically instead of DATA's declaration order. No IDs
  renamed, no `js/engine.js` change; verified with a headless screenshot of the real page.

- **2026-07-29 · docs: correct every stale file-size figure in the read-budget guidance** — `AGENTS.md`'s
  "Don't read large files wholesale" section had a wrong number in each entry, and the same wrong number
  was reaching external reviewers. Measured: `js/engine.js` is **~66 KB / 924 lines**, not ~237 KB — that
  figure predated REV-14a splitting the `DATA` blob into `js/engine-data.js` (**~189 KB on ~13 lines**),
  which is the genuinely expensive file in `js/` and wasn't in the list at all. Also
  `docs/PACT-Players-Guide.html` **~1.4 MB** (listed as ~657 KB) and `tools/*.html` **~127–376 KB**
  (listed as "320–520 KB each"). Fixed in all three *live* locations — `AGENTS.md`, `js/engine.js`'s
  header comment, and `docs/AI_review_prompt.md`, the template used to commission external engine
  reviews, which described the file as "~237 KB (mostly a large DATA blob)" and so primed reviewers to
  misjudge it (the review behind the perf work below came from that template). The list now carries its
  measurement date and says to re-measure rather than trust it. Historical mentions in
  `decisions/2026/D-009.md`, the PWA-migration record, `docs/sessions/*` and the changelog archive were
  deliberately left alone — those figures were correct when written. See addendum in
  `decisions/2026/D-GH-2026-07-29-file-review-4plpe3.md`.

- **2026-07-29 · perf(engine): make LOG replay linear, drop a redundant `activeEvents()` pass** —
  acted on an external perf review of `js/engine.js` after verifying and benchmarking each claim.
  (1) `_replay()`'s nine single-instance proficiency lists were deduped with
  `filter((v,i) => arr.indexOf(v) === i)` — a full rescan per element; now `[...new Set(arr)]`, same
  first-occurrence order, O(n) instead of O(n²): **`foldBuild()` on a 2000-event log went 6.48 ms →
  0.44 ms (~14.6×)** and is now linear rather than quadratic in log length. (2) `foldBuild()` and
  `rebuildStateFromEvents()` each ran `activeEvents()` twice (once via `_replay()`, once via
  `economy()`); `_replay()` now returns its snapshot and a private `_economyFrom()` tallies from it —
  worth ~23% of a fold at 500 events, with **no change to public `economy(events)`**, which stays
  single-argument for the three tools that bridge it. (3) `b.unlockedClasses` (four loops),
  `b.racialTraits` and `skillList` membership tests now use a Set built once instead of a per-iteration
  `indexOf` scan. Two of the review's suggestions were **measured and rejected**: `structuredClone`
  (its top-ranked item) is 1.9–3.1× *slower* than the JSON round-trip for every shape this engine
  clones and cost ~20% on `rebuildStateFromEvents()`, and caching `DATA.*` in locals was unmeasurable
  (V8 inline caches) — `clone()` now carries an inline note recording the benchmark so it isn't
  "modernized" again. Async Web Crypto signing was rejected as breaking `_sha256hex`'s documented
  synchronous/`file://` constraint. No behaviour change: parity **20/0**, `log-fuzz` 3000 iterations
  clean, plus a differential test against the pre-change engine over the fixtures and 4000 random LOGs
  (**20,021 checks, 0 mismatches**). `DATA.version` and `BUILD` deliberately unchanged — no mechanics
  or user-visible change. See
  `decisions/2026/D-GH-2026-07-29-file-review-4plpe3.md`.

- **2026-07-29 · docs: fix `/make-code-cold-plan-review` Step 7 triage gap + sync `docs/SKILLS.md`** —
  `/code-review` on PR #276 found two issues in the previous same-day change: (1) Step 7 had no defined
  action for a `blocking`-severity finding that reviewers agreed on and that hit none of the four explicit
  stop-and-ask triggers, and separately left it ambiguous whether "reviewers disagreeing" was an
  unconditional stop-trigger or only when the new disinterested-agent pass failed to resolve it. Fixed by
  making `blocking` findings always return to the user for the final call (even once the agent pass
  confirms them), and making unresolved disagreement an unconditional stop while a resolved
  minor/moderate disagreement may be applied directly. (2) `docs/SKILLS.md`'s "cold-review loop" section and
  skill-reference bullet, the human-readable authority on this skill, hadn't been updated alongside the
  prior change — now describes the cross-vendor guidance, adversarial/severity-confidence framing,
  disinterested-agent second opinion, and structured outcome table. See addendum in
  `decisions/2026/D-GH-2026-07-29-custom-skills-commands.md`.

- **2026-07-29 · docs: strengthen `/make-code-cold-plan-review` with cross-vendor, adversarial, and
  consensus-matrix guidance** — based on research into cross-model code/plan review practice (see
  `decisions/2026/D-GH-2026-07-29-custom-skills-commands.md`): (1) Step 4 now explicitly tells the user to
  prefer a reviewer from a different vendor family than the plan's author, since same-family review repeats
  its own blind spots; (2) the generated "Reviewer instructions" section now asks the reviewer to actively
  try to refute the plan (not just "check it over") and to tag each finding with a severity
  (blocking/moderate/minor) and confidence (high/low); (3) the "Review outcome" stub is now a structured
  table (finding, severity, confidence, raised-by, cross-family agreement, disposition) instead of a
  free-text summary; (4) Step 7's triage now sends any `blocking`-severity or reviewer-disputed finding to a
  fresh, context-free `Agent` call for a disinterested second opinion before the plan's own author decides,
  to avoid the same session grading its own homework. Added `Agent` to the command's `allowed-tools`.

- **2026-07-28 · docs: migrate DECISIONS.md/CHANGELOG.md/docs/TASK_BOARD.md to the split-file pattern** —
  `DECISIONS.md` (371,703 bytes, 112 full records + 1 orphaned index-only entry) is now a thin index over
  `decisions/2026/D-*.md` (41,077 bytes live). `docs/TASK_BOARD.md` (35,953 bytes) split into
  `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by its existing bands. `CHANGELOG.md` (271,870 bytes, 281
  entries) rotated everything older than 2026-07-17 into `docs/CHANGELOG-archive-2026-06-29-to-2026-07-16.md`
  (238 entries, ~233KB), keeping 43 entries live (~40KB) — extending this project's own pre-existing
  `docs/history/CHANGELOG-full.md` rotation precedent (D-002/D-003) rather than inventing a new pattern for
  changelog entries specifically. Also fixed `docs/dev-status.html`'s live client-side fetch/parse of the
  task board (it fetched a single `TASK_BOARD.md` at runtime; now fetches and merges all three band files)
  and updated every other file with a hardcoded `docs/TASK_BOARD.md` reference (`AGENTS.md`,
  `.github/copilot-instructions.md`, `.github/pull_request_template.md`, `docs/SKILLS.md`,
  `docs/HOW-TO-WORK.md`, `docs/roadmap.html`) — `.claude/commands/*.md` needed no changes, already
  hardened for either file shape by `D-GH-2026-07-28-command-format-agnostic`. Every-session-relevant read
  path (AGENTS.md + DECISIONS.md + TASK_BOARD_NOW.md + live CHANGELOG.md) dropped from ~705KB to ~109KB
  (~85%). See `DECISIONS.md` D-GH-2026-07-28-decisions-changelog-task-board-split for the full rationale.
- **2026-07-28 · docs: add 'technical access != scope' rule** — Added a "Technical Access ≠ Scope" section
  to `AGENTS.md`, after direct testing on Home AI Server confirmed a session with broad, non-enforced
  access would cross into a different project's files if asked. See `DECISIONS.md`
  D-GH-2026-07-28-technical-access-not-scope.
- **2026-07-28 · docs(commands): make task-board/decisions commands format-agnostic** — hardened all 7
  `.claude/commands/*.md` files that read or write `docs/TASK_BOARD.md`/`DECISIONS.md` to check for the
  split-file shape (`TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md`, a thin `DECISIONS.md` index over
  `decisions/<year>/D-*.md`) before assuming today's single-file layout. No content migration — this
  project's own `DECISIONS.md`/`CHANGELOG.md` are still the current single-file shape, tracked as their
  own future task. See D-GH-2026-07-28-command-format-agnostic.
- **2026-07-26 · fix(dm-console): sticky header down to one row, theme dropdown readable** — the sticky
  `header.topbar` stacked title/summary/last-edited/actions as separate block elements (~4-5 rows); moved
  the summary/last-edited line into a new non-sticky `.subbar` right below it, and made the header itself
  a single flex row (home link, title, actions) — sticky scroll now only ever pins that one ~53px row.
  Separately, `#dmThemeSel`'s native `<option>` popup inherited the closed box's white text with no
  explicit background, rendering white-on-the-browser's-default-white in every theme; added
  `#dmThemeSel option{color:#1F3864;background:#fff}` so the list is readable regardless of the header's
  current `--navy`/`--blue` (which only paint the closed box, never the native popup).

- **2026-07-25 · docs(add-code-task): drop the pre-commit approval gate** — `/add-code-task` now shows the
  drafted task block and proceeds straight to committing it to `docs/TASK_BOARD.md` in the same turn,
  instead of waiting for an explicit "yes"/"looks good" first (D-GH-2026-07-25-add-task-drop-approval-gate).
- **2026-07-25 · feat(characters): "My Characters" page — archive/delete, campaign grouping, open-in-tool
  deep links** — new `tools/characters.html`: every cloud-saved character (CharGen + Live Sheet) in one
  signed-in, online-only view, grouped by campaign name (via `listMyCampaigns()`) with a "No campaign"
  bucket, and a "Show archived" toggle (archived rows hidden by default). Each row: Open in CharGen/Live
  Sheet (disabled with an "empty" tag for `hasData:false` rows), Archive/Unarchive (reversible), and —
  only once archived — Delete permanently (uses the existing, previously UI-less `deleteCharacter()`).
  `js/sync.js` gained `listMyCharacters()` (owner-scoped, unlike `listCharacters()` which also returns a
  DM's-eye view via `is_campaign_dm`), `archiveCharacter()`/`unarchiveCharacter()`. DB: `characters` gained
  `archived_at timestamptz` + `grant update (archived_at) on characters to authenticated` — no RPC needed,
  unlike `campaigns.archived_at`, because `characters_update`'s RLS is already owner-only (see
  D-GH-2026-07-25-character-archive). CharGen and Live Sheet both gained a `?cloudChar=<id>` boot-time deep
  link (each tool's existing cloud-load logic extracted into a shared `loadCloudChar(id,label)`, called by
  both the menu click and the new boot handler) so the new page's "Open in ..." buttons can hand off to a
  specific saved character. Discoverability: a "📋 My Characters" link in each tool's ☁ Cloud menu, plus a
  card on `index.html`.
- **2026-07-25 · fix(sync, live-sheet, chargen): "No character data found" on cloud-load** — reported as
  every entry in Live Sheet's "Load saved character" list failing with this error. Root-caused against
  the **live database** (not just code): all 4 affected rows had `stats` = `{}` or `{"note":"hello"}` —
  pre-launch test/stub data with no `LOG` array, not corrupted real saves. Deleted the 4 stub rows
  (`piuprrrnaotrtxucrtsb`, table `characters`). Separately hardened both tools against this class of row
  recurring (e.g. a redeemed player invite a player never opened): `js/sync.js`'s `listCharacters()` now
  selects `stats->LOG` and returns a `hasData` flag per character; both CharGen's and Live Sheet's
  cloud-load menus render a `hasData:false` row as an inert, greyed "empty" entry (shown, not hidden — a
  player should still be able to see it exists) instead of a clickable button that resolves to the
  generic error after the user already committed to loading it. Verified end-to-end in a real browser
  (both tools) with a mocked signed-in session carrying one real and one stub character: the stub renders
  as a non-interactive `<div>` with no click handler attached, the real one still loads correctly.
  Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): "Award" button silently clipped off-screen on narrow viewports** —
  reported as "no button to push AP to players." Reproduced: the Campaign Roster's Award AP cell needs
  ~250px for its amount/note/button row, but `#campRoster table{width:100%}` forces the table to fit
  its container regardless, and `#campRoster{overflow:hidden}` (there for the rounded corners) silently
  clips whatever doesn't fit instead of wrapping or scrolling — confirmed via a real headless-browser
  render at 320-414px widths that the Award button's bounding box extended well past the visible
  container, while the amount input (visible) stayed in view, matching exactly what was reported. Fixed
  by wrapping the table in its own `.roster-scroll` (`overflow-x:auto`, table `min-width:560px`) so
  narrow viewports scroll horizontally to reach Award/History instead of losing them — verified the
  scroll region activates, the button becomes reachable and clickable after scrolling, and desktop
  widths are unaffected (button was already fully visible there). Display-only; no `DATA.version` bump.

- **2026-07-25 · fix: favicon on every remaining HTML page** — follow-up to the index/DM-Console
  favicon fix. Swept every `.html` file in the repo (`find . -iname "*.html"`, excluding
  `docs/history/` archives) and added the same `assets/icons/PACT_favicon.png` `<link rel="icon">` to
  the 9 that still had none: `login.html`, `404.html`, `docs/PACT-Players-Guide.html`,
  `docs/dev-status.html`, `docs/roadmap.html`, `testing/campaign-test.html`, `testing/sync-test.html`,
  `testing/tests/engine-parity.html`, `testing/tests/sync-timestamp.html` — relative path depth adjusted
  per file's location. `docs/PACT-Players-Guide.html` edited via a targeted `Edit` (not a full read) per
  its own "never read wholesale" note — confirmed the exact existing `<link>` text via a 1-line `Read`
  first. Verified every page+icon pair resolves 200 via both direct HTTP requests and a real browser
  (favicon request observed firing from each page's actual served location) — `404.html`'s favicon
  request couldn't be observed in the local test harness because the page's existing
  `window.location.replace()` redirect fires immediately (expected; it correctly returns to `/PACT/` on
  the real site), but the `<link>` tag itself and direct icon fetch both confirmed present/200.
  Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(index, dm-console): consistent browser-tab favicon across the whole app** —
  `index.html` had its own one-off inline SVG "P" emblem (a different icon than every other page); DM
  Console had **no** `<link rel="icon">` at all (a deliberate omission from an earlier favicon pass —
  D-GH-2026-07-19-pwa-manifest-icon-coverage — now reversed at explicit request). Both now use the same
  `assets/icons/PACT_favicon.png` CharGen/Live Sheet already use (relative path, matching those two
  tools' existing convention). Verified via real HTTP requests (not just file existence) that the
  favicon resolves with a 200 from both pages' actual served locations. `login.html` still has no
  favicon — out of scope of this ask, left alone. Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): Campaign panel on its own row; Import Roster dims when a cloud
  campaign is active** — `#campPanel` had no explicit flex-basis (`flex:1 1 300px`), so at wide enough
  viewports it could sit alongside Import Roster/AP Grant Code instead of getting its own row, despite
  being the longest of the three panels. Changed to `flex:1 1 100%` (matching the `#drop` drop-zone's
  existing "always its own full row" pattern) — Campaign now always renders below the other two,
  full-width. Separately: Import Roster (local `.json` drag-drop) and a loaded cloud campaign's live
  roster are two independent, coexisting features — confirmed neither UI state hides the other
  (`selectCampaign()` never touches `#grid`/`#empty`). Reported as confusing which one "is" the
  campaign; added a `dimmed` class (opacity .55, full opacity on hover) toggled on `#importPanel`
  whenever a campaign is selected, plus a small clarifying note — dims rather than disables, since
  local-file review alongside an active campaign remains a legitimate use. Verified in a real browser
  (both themes, wide viewport) with a full mocked Supabase session exercising the actual
  `selectCampaign()`/`updateAuth()` code paths. Display-only; no `DATA.version` bump.

- **2026-07-25 · feat(dm-console): boon/drawback tooltips in Campaign Rules banned-lists** — the
  "Banned boons"/"Banned drawbacks" checkbox grids showed only names, no description of what each
  actually does. Added an optional 3rd element to `RULE_GRIDS` entries (a per-name tooltip-text
  function) and a conditional `title=` attribute in `renderRuleGrids()`'s shared render template —
  reads `DATA.boons[name].fx` / `DATA.drawbackFx[name]` directly (the same data every other tool
  already reads for these descriptions; confirmed via research that CharGen/Live Sheet already
  normalize both maps to a common `.fx` shape and CharGen's racial-trait checkboxes already use the
  identical `title=`-from-DATA pattern), so there's exactly one source of truth and no new text to
  keep in sync. Also investigated adding a symmetric "banned as 2nd origin classes" list to mirror
  "2nd origin species" — found it would be a no-op: `validate()` already bans a class in both
  `originClass`/`originClass2` slots via the single existing `bannedOriginClasses` list; species has
  a *second*, asymmetric list only because it also supports an "okay as primary, not as bonus 2nd"
  case that classes never had modeled. Logging the asymmetric-class-ban feature as a separate task
  rather than building it here (a real engine design decision, not this task's scope). Verified
  end-to-end in a real browser with a full mocked Supabase session (not just CSS, this time — the
  actual `campaign-ready`-gated render path executed): 88/88 boons and 69/69 drawbacks carry correct
  tooltip text; the five unaffected grids (species, 2nd origin species, origin classes, masteries,
  arts) confirmed to have no `title=` regression. Display-only; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): campaign-panel polish — layout order, code tooltips, oversized fields**
  — Three follow-ups from live feedback on the campaign create/archive feature. (1) "New campaign" and
  "Archived campaigns" moved from the top of the Campaign panel (shown before any selected-campaign detail,
  confusing on every load) to the bottom, in that order — selected-campaign details now show first. (2)
  Added a small ⓘ button next to the Players/DMs invite codes (hover *or* click, matching existing
  `title`-attribute hint patterns like `.warnicon`/`.tamper` elsewhere in this file) explaining what each
  reusable code does — while wiring this up, confirmed `joinAsDm()` (the co-DM redemption RPC) has no
  consuming UI in *any* tool, same class of dead-code gap `createCampaign()` had before this session; not
  fixed here, flagged to the user as a possible follow-up task. (3) `body` never set an explicit
  `font-size`, so every `.field` input and non-`.sm` `.btn` (which both use `font:inherit`) fell back to
  the browser default (~16px) against the rest of the UI's deliberate 11–14px scale — reported as
  "Starting DM AP"/"Starting Budget AP" (invite-form placeholders) looking oversized, but affected every
  `.field`/plain `.btn` in the tool. Fixed at the root with one `body{font-size:14px}` rather than
  patching each selector. All three verified in a real browser — including, for the first time this
  session, with the `campaign-ready`-gated JS (create/archive/info-button click handlers) actually
  exercised via a stubbed `supabase-client.js` import (this sandbox has no network path to esm.sh, so
  earlier same-session screenshots only verified CSS/layout, not click wiring — noted for the record).
  Display-only; no `DATA.version` bump.

- **2026-07-25 · feat(dm-console): add theme selector (Default/Dark/D&D·Parchment/Royal/Forest)** — DM
  Console had zero UI to change theme (only ever picked up dark mode from OS `prefers-color-scheme`,
  no way to override it, and none of Live Sheet/CharGen's other 3 themes existed there at all). Added a
  `<select id="dmThemeSel">` in the top bar (matching Live Sheet/CharGen's existing `#themesel` pattern),
  a `dmSetTheme()` persisting to `localStorage['pact-dm-theme']`, and three new `[data-theme]` variable
  blocks (`dnd`/`royal`/`forest`) mapped onto DM Console's own token set (`--navy`/`--navy2`/`--blue`/
  `--blue-lt`/`--light`/`--paper`/`--card`/`--ink`/`--muted`/`--line`/status-color pairs) — colors chosen
  to match the other two tools' equivalent themes where a direct token existed, derived consistently
  from the existing `default`/`dark` blocks' pattern where DM Console has extra tokens the others don't.
  Verified all 5 themes in a real browser (init script, live switch, and page-reload persistence) —
  campaign panels/buttons from the two contrast fixes above render correctly in every theme, confirming
  those fixes were token-based rather than color-literal. Display-only CSS; no `DATA.version` bump.

- **2026-07-25 · feat(dm-console): create + archive/unarchive campaigns** — DM Console had no way to
  create or remove a campaign. Wired up the existing (previously dead-code) `createCampaign()` behind a
  new "+ New campaign" row, and added reversible archive (not hard delete — see D-GH-2026-07-25-
  campaign-archive for why) via new `archive_campaign()`/`unarchive_campaign()` RPCs, an "Archive
  campaign" button (owner-only, confirm-gated), and an "Archived campaigns" panel with per-row Unarchive.
  New `campaigns.archived_at` column, genuinely owner-only via a column-level UPDATE grant lockdown
  (mirrors `characters.ap`'s existing pattern) — closes a gap where the previous blanket grant would have
  let any co-DM write it directly. Applied live via Supabase MCP (`get_advisors` clean beyond the
  standard boilerplate every RPC here already has), persisted as
  `sql/migrations/2026-07-25-campaign-archive.sql` + `sql/schema.sql`/`sql/rls-policies.sql`. Also fixed
  `.btn.ghost` (Copy/Unarchive buttons), found unreadable in light theme while verifying the new UI —
  same root cause as the panel/dark-theme fixes below. Display-only CSS; no `DATA.version` bump.

- **2026-07-25 · fix(dm-console): dark-theme contrast — buttons, chips, table headers, and field
  values were unreadable** — follow-up to the panel/label fix below. Root cause: `[data-theme="dark"]`'s
  `--light` custom property was `#475569` (a medium slate), nearly the same luminance as `--navy`
  (`#0f1729`) and `--blue` (`#1a3a5c`) in dark mode — so every component pairing `--light`+`--navy`
  (`.btn`, `.chip`, `.card .csub .tier`, `#tableRoot table.awards th`/`.badge`, `#campRoster th`) and the
  header's own `.summary` subtitle text collapsed to ~1.5:1 contrast (WCAG AA needs 4.5:1). Fixed by
  changing dark theme's `--light` to an actually pale value (`#c9d6ec`) — one token, fixes every affected
  component at once (verified: Sign in/Generate code/Copy/Save rules buttons, roster table headers,
  tier/award badges). Separately, `.field`/`#campSel` had a hardcoded near-white background (both themes)
  but `color:var(--ink)` (theme-varying — light gray in dark mode), so typed/selected values were
  near-invisible; changed to `color:var(--navy)`, matching the already-correct convention its sibling
  `.field.ro` uses for the same fixed-light-background pattern. `#tableRoot`'s own locally-scoped
  variables (always light, by design, unaffected by `[data-theme]`) were left untouched. Display-only,
  no `DATA.version` bump; verified visually in both themes via headless screenshot.

- **2026-07-25 · fix(dm-console): panel/label text illegible against its own card background** —
  `#importPanel`/`#grantPanel`/`#campPanel`'s `.ptitle`, `label.lbl`, `.grantnote`, and ~15 similar
  Campaign-Rules labels/notes used `var(--light)` (a pale near-white blue) as text color, styled for the
  navy hero header they were copy-pasted from — but these panels actually sit in `<main>` on the light
  `--paper` background, making the text nearly invisible (reported: "AP grant code" / "Amount" / "Note
  (optional)" / the whole-party grant note unreadable). Fixed by giving `.panel` a proper card treatment
  (`--card` background, `--line` border, `--shadow`, matching `.card` elsewhere) and switching all
  panel-scoped label/note text to `--muted` (checkbox labels to `--ink`), the same variables already used
  for equivalent labels elsewhere in this tool (`.xtra .xlabel`, `.cglabel`). `.hrchip` house-rule chips
  got a real chip background (`--paper`/`--line`) for the same reason. Display-only CSS/JS-template
  change — no `DATA.version` bump. Verified visually in both light and dark theme via a headless
  screenshot. Left the header's own (correctly-placed) `--light` text and the pale-bg/navy-text chip
  components (`.chip`, table headers, badges) untouched — a separate, unreported low-contrast issue
  affecting those chips/buttons and `.field` input values specifically in dark theme was noticed but not
  fixed here (out of scope of the report); worth a follow-up task if it bothers users in practice.

- **2026-07-21 · docs(sessions): corrected the 2026-07-20/2026-07-21 date-labeling mistake** — fixed
  everywhere across `family-hub`, `wildlife-explorer`, and PACT's own two session notes about them:
  decision IDs, `CHANGELOG.md` entry dates, and session-note filenames. Left every reference to the
  *other*, genuinely-pre-existing `2026-07-20` dates untouched in both target repos (family-hub's
  original Copilot planning session, wildlife-explorer's Milestone-5 planning log) — those are real,
  not mislabeled. Also left the two decision IDs a separate, concurrent status-review session added to
  wildlife-explorer (`D-2026-07-20-web-session-branch-override`, `D-2026-07-20-branch-model-confirmed`)
  untouched — no basis to assume those are wrong too. Done as new commits in each repo, not history
  rewrites, since `family-hub`'s and `wildlife-explorer`'s originals were already pushed.

- **2026-07-21 · docs(sessions): light-ported the memory-layer scaffold to a fifth repo,
  PACT_Players**: a Quartz-based campaign-content site, not a software project — full scaffold skipped
  (no `AGENTS.md`, no Effort/Risk task board), only `CHANGELOG.md`/`DECISIONS.md`/`sessions/` (repo-root,
  not `docs/sessions/` — that's Quartz's own vendored docs) plus 4 of 8 skills. Mid-port, discovered a
  concurrent session had already authored a real `TASKS.md`; adopted it rather than overwriting with a
  placeholder. Also caught (not yet fully corrected) a session-wide date-labeling mistake — this and the
  prior two ports were mislabeled `2026-07-20` when the actual date was `2026-07-21`. See
  `docs/sessions/2026-07-21-port-agents-scaffold-to-pact-players.md`.

- **2026-07-21 · docs(sessions): ported the AGENTS.md/skills scaffold to a fourth repo,
  wildlife-explorer**: additive, not build-fresh — unlike family-hub (ported moments earlier the same
  session), this repo already had a real governance file (`AI.md`) and a genuinely working
  `npm run check` test/build/encoding-audit gate, so `AGENTS.md` was scoped as a thin process-layer
  supplement rather than a competing entry point; `AI.md` was left completely untouched. Confirms a
  "three independent axes" shape space (governance layer / product docs / real verification gate, each
  present or absent independently) rather than a simple blank-vs-mature spectrum. Nothing in PACT itself
  changed beyond this session note; see
  `docs/sessions/2026-07-21-port-agents-scaffold-to-wildlife-explorer.md` for the full detail
  (target-repo decisions logged in wildlife-explorer's own `DECISIONS.md`).

- **2026-07-21 · docs(sessions): ported the AGENTS.md/skills scaffold to a third repo, family-hub**:
  same manual copy-and-adapt pattern as the `petdetective`/`homelife` ports, done directly against the
  local clone at `C:/Users/user/dev/family-hub`. A genuinely third target-repo shape — not blank-slate,
  not mature-with-conflicting-conventions, but rich product-planning docs with zero AI-workflow
  governance layer. Nothing in PACT itself changed beyond this session note; see
  `docs/sessions/2026-07-21-port-agents-scaffold-to-family-hub.md` for the full detail (target-repo
  decisions logged in family-hub's own `DECISIONS.md`, not duplicated here).

- **2026-07-20 · feat(tooling): close-code-session stages/commits/pushes once you approve the letter**:
  removed the `git add`/`git commit`/`git push` tool restriction at the user's explicit request — Part 3
  now surfaces "stage, commit, and push" as one of its lettered follow-ups and runs it once approved,
  instead of only ever printing the command for manual hand-off. The shared-checkout mitigation (never
  `git add -A`/`.`, always name exact files, re-check `git status` right before staging) is unchanged and
  still applies regardless of who runs the add. Merging, rebasing, resetting, and deleting are still always
  disallowed. See `D-GH-2026-07-20-close-code-session-run-commit`.

- **2026-07-20 · chore(repo): swept 126 stale remote branches + 6 local worktree remnants**: local
  cleanup removed 1 merged local branch/worktree (`feat/clone-char-standalone`, its lock stale — the
  claimed PID wasn't running) and 5 orphaned `.git/worktrees/` admin dirs left over from past
  `ExitWorktree` runs that never fully cleaned up (these were also the cause of the "Permission
  denied" noise on every `git fetch` this session and prior sessions — resolved). Remote cleanup
  classified all 129 `origin/*` branches against their PR history (`main`/`preview` never touched):
  114 merged via PR, 2 closed without merging, 2 with no PR but fully absorbed into `preview`, and 8
  with no PR and genuine unique commits — all verified superseded/already-shipped duplicates from
  concurrent sessions except one (`claude/remote-control-149hqs`, held back pending its stored-XSS
  fix); confirmed that fix already shipped via an identical parallel-session commit already on `main`
  (`8660d42`, same message/timestamp as the held branch's `b3f7df3`), then deleted it too. Full
  methodology and the Windows/Git-Bash CRLF pitfall hit along the way: see
  `docs/sessions/2026-07-20-remote-branch-worktree-cleanup.md`.

- **2026-07-20 · docs(tooling): close-code-session's session-note step writes without pausing**:
  Part 1 item 3 (`docs/sessions/<date>-<topic>.md`) now says explicitly that once the write
  criteria are evaluated, the file is written (or skipped) immediately in the same turn — no
  presenting the evaluation as a question and waiting for a reply first. Closes the gap flagged
  in the `TASK_BOARD.md` entry this graduates; the user had been missing session-note writes
  because a prior run paused for confirmation that the skill never actually required.

- **2026-07-19 · docs(terminology): replaced "roadmap" with "task board" everywhere it referred to
  `docs/TASK_BOARD.md`**: `AGENTS.md`, `docs/SKILLS.md`, `docs/HOW-TO-WORK.md`, and all 6
  `.claude/commands/*.md` skill files (9 files, ~38 occurrences) — including `/add-code-task`'s own
  future-commit template (`docs(roadmap): ...` → `docs(task-board): ...`), so new task-board-addition
  commits use the new scope going forward. `CHANGELOG.md`/`DECISIONS.md`/`docs/sessions/*.md` left
  untouched, same as the earlier `-code-` command rename — dated historical record, not rewritten.
  "Roadmap" was never a stale filename reference (the file has always been `docs/TASK_BOARD.md`), just
  informal vocabulary for the same thing; the two terms coexisting caused real confusion, so picked one.
  Docs/skill-file text only — no code or rules touched, parity unaffected (still 20/0).

- **2026-07-19 · chore(release): bump BUILD to v0.203**: mirrored across all three tools per
  `docs/VERSION-SYNC.md` (CharGen's line-1 comment, `<title>`, header `.sub` label, and its
  JS-side title-template string; Live Sheet's line-1 comment; DM Console's `TOOL_VERSION`).
  Cosmetic build-number bump only — `DATA.version` unchanged, parity still 20/0. The earlier
  cloud-session restriction that blocked a plain `git tag`+`git push` and a `gh api .../releases`
  POST (see `docs/sessions/2026-07-19-github-release-tag-cloud-session-restriction.md`) was
  specific to that cloud-session proxy — a local session tagged `v0.203` and pushed it on
  2026-07-19 without issue, and GitHub auto-generated the matching Release from the tag push.
  Both now exist: https://github.com/Chompy78/PACT/releases/tag/v0.203.

- **2026-07-19 · fix(feedback) — fixed CSS specificity collision hiding the anon checkbox
  incorrectly**: `js/feedback.js`'s `.pact-fb-anon{display:flex}` rule had the same
  specificity/origin as the browser's built-in `[hidden]{display:none}` rule and won by source order,
  so `anonWrap.hidden = true` (the signed-out default) never actually hid the "submit anonymously"
  checkbox row. Scoped the selector to `.pact-fb-anon:not([hidden])` so the browser's own `[hidden]`
  rule applies again. Verified in a real browser (Playwright/Chromium, isolated harness with a stubbed
  Supabase client): signed-out now computes `display:none` (no checkbox/empty box); signed-in still
  computes `display:flex` with a working, checkable checkbox. Display-only, no `DATA.version`/engine
  impact; parity still 20/0.

- **2026-07-19 · fix(feedback) — inlined the "submit anonymously" checkbox with its contact note**:
  `js/feedback.js`'s checkbox (shown only to signed-in users) previously rendered as its own row below
  the "Optional — only if you'd like a reply..." note; both now share one flex row
  (`.pact-fb-note-row`), checkbox first. Verified in a real browser (Playwright/Chromium, isolated
  harness with a stubbed Supabase client) at both a normal width and the 420px mobile breakpoint, in
  both the signed-out (checkbox absent) and signed-in (checkbox inline) states. Display-only, no
  `DATA.version`/engine impact; parity still 20/0. While verifying, found a separate pre-existing bug
  (the signed-out checkbox isn't actually hidden due to a CSS specificity collision) — filed as its own
  roadmap task rather than folded into this fix, since it predates this change and isn't scoped to it.
- **2026-07-19 · chore(release) — graduated A6 (tag releases to build version)**: confirmed done —
  `v0.107` was tagged with a GitHub Release on 2026-07-17; no further action needed, so the task-board
  entry (which had flagged itself for human confirmation) is removed.

- **2026-07-19 · fix(pwa) — closed the last two PWA-completeness gaps: manifest + apple-touch-icon on
  every HTML entry point**: `login.html` and `docs/PACT-Players-Guide.html` gained `<link rel="manifest">`
  (previously only `index.html` and the three tools declared it); all five non-`index.html` entry points
  (`login.html`, the Player's Guide, and all three tools) gained `<link rel="apple-touch-icon"
  href="/PACT/icons/apple-touch-icon.png">`, matching the tag `index.html` got in the previous PWA fix —
  DM Console included, since the browser-tab-favicon exclusion it got in an earlier change was never
  reasoned to extend to the home-screen icon. Every new link uses the absolute `/PACT/...` path, matching
  `manifest.json`'s own convention (the existing tool favicon links use a relative path — a pre-existing
  inconsistency, left as-is). HTML well-formedness verified (all 5 files parse cleanly); no `js/engine.js`
  change, parity 20/0.

- **2026-07-19 · fix(pwa) — bumped service-worker cache + widened network-first coverage + wired the
  missing apple-touch-icon**: `CACHE_NAME` `pact-v6`→`pact-v7`, forcing already-installed/returning users
  to pick up `js/character-store.js` (cache-first; holds this session's Continue-feature `recordAutosave`,
  which was otherwise stuck stale for them indefinitely). Also widened `NETWORK_FIRST_RE` to cover
  `js/ui-helpers.js` (holds `esc()`, the shared XSS-escaping helper all three tools call), `js/ap-by-level.js`,
  and `js/advancement.js` — same "costs nothing, only speeds up fix propagation" reasoning as
  D-GH-2026-07-16-sw-network-first-security-modules, applied to three files that were added since and never
  covered; added all three to `PRE_CACHE` too, matching every other network-first file. Separately, added a
  `<link rel="apple-touch-icon">` to `index.html` — the correctly-sized asset (`/icons/apple-touch-icon.png`)
  already existed and was in `manifest.json`, but no page actually referenced it via the explicit tag iOS
  Safari's "Add to Home Screen" relies on most reliably. Engine untouched, parity 20/0.

- **2026-07-19 · chore(commands) — renamed all 8 Claude Code custom commands to carry `-code-`**: `add-task`→
  `add-code-task`, `cleanup-branches`→`cleanup-code-branches`, `close-session`→`close-code-session`,
  `log-ai-lessons`→`log-code-lesson`, `pick-task`→`pick-code-task`, `plan-for-review`→
  `make-code-cold-plan-review`, `run-task`→`run-code-task`, `sweep-tasks`→`sweep-code-tasks` — distinguishes
  them at a glance from the author's separate `-chat-` Claude.ai Skills. Updated every cross-reference in
  `.claude/commands/*.md`, `AGENTS.md`, `docs/SKILLS.md` (which also gained an old→new mapping table),
  `docs/HOW-TO-WORK.md`, `docs/TASK_BOARD.md`, and `.gitignore`. `CHANGELOG.md`/`DECISIONS.md`/
  `docs/sessions/` deliberately left using the old names — dated historical record, not rewritten.

- **2026-07-18 · feat(tools) — CharGen and Live Sheet now show the anvil/hammer PACT favicon**: moved
  `assets/PACT_favicon.png` → `assets/icons/PACT_favicon.png` and added `<link rel="icon"
  type="image/png" href="../assets/icons/PACT_favicon.png">` to the two non-DM tools' `<head>` (right after
  the manifest link). DM Console deliberately left unchanged. Verified in a real browser: both tabs load the
  favicon (200) and DM Console has no icon link. Asset/display-only — no `DATA.version` or `BUILD` change.
- **2026-07-18 · feat(landing) — "Continue where you left off" recent-characters section**: `index.html`
  now shows resume cards for your last 3 distinct characters plus a collapsible timeline of the last 10
  autosaves, each resuming into the right tool via the existing `?handoff=` baton. Backed by a new shared
  versioned-autosave store in `js/character-store.js` (`recordAutosave`/`readRecent`, key `pactRecentV1`):
  both tools now additively feed it from their autosave (never touching their own restore slot, fully
  guarded). Capture uses time **and** difference — identical snapshots are skipped, rapid same-character
  edits coalesce, and a new snapshot is cut only on a ≥2-min gap, a tool switch, or a ≥5-event jump — so a
  keystroke burst can't fill it with duplicates. Character names render via `textContent` (XSS-safe). BUILD
  v0.201→v0.202; engine untouched (parity 20/0). See `DECISIONS.md` D-GH-2026-07-18-continue-recent-chars.
- **2026-07-18 · fix(chargen) — made CharGen's rules-version display read live from `DATA.version`**: 
  CharGen's header shows "PACT rules · vX" in both a `.hd-pactver` span and the `<title>` tag, but both 
  were hardcoded to v0.336 instead of reading `window.DATA.version` at `engine-ready` like Live Sheet 
  and DM Console already do. Added `id="cgPactver"` to the span and an event listener that updates both 
  the span text and the page title with the live version. Display-only — no rules/`compute()` change, 
  `DATA.version` unchanged. Mirrors the now-documented follow-up to the prior v0.332→v0.336 display-drift fix.

- **2026-07-18 · docs(agents) — refreshed stale version parentheticals in AGENTS.md**: The Versioning 
  section's "currently" notes for BUILD and DATA.version had drifted since PR #251: listed v0.107 
  and v0.332. Updated both to match the live values at merge time (real: v0.202 per js/engine.js — 
  bumped again since this PR was first opened, caught during its pre-merge rebase — and v0.336 per 
  js/engine-data.js). Docs-only — no code or rules change.
- **2026-07-18 · feat(theming) — extended localStorage-based theme switching to guide and DM Console**: 
  PACT-Players-Guide.html now supports the same 4-theme system as index.html (parchment/midnight/dragonfire/contrast) 
  with localStorage persistence. DM Console gained dark-mode support with system preference fallback, maintaining 
  its modern design language. CharGen and Live Sheet already had theme switching. Theming pattern now consistent 
  across all public-facing UIs.

- **2026-07-17 · fix(chargen) — synced CharGen's hardcoded rules-version display to the real
  `DATA.version`**: CharGen showed "Rules v0.332" (title + `.hd-pactver` header label + two doc comments)
  while the engine's canonical `DATA.version` had advanced to **v0.336** — a pre-existing display drift.
  Updated all four spots to v0.336. CharGen is the only tool that hardcodes this (Live Sheet and DM Console
  already read `DATA.version` live at `engine-ready`, so they can't drift); the misleading comment claiming
  the label "tracks DATA.version" was corrected to say it's hardcoded, and a follow-up to make CharGen
  live-read it too was noted. Display-only — no rules/`compute()` change, `DATA.version` untouched.

- **2026-07-17 · refactor(engine) — REV-14a: extracted the `DATA` rules dataset out of `js/engine.js`
  into its own `js/engine-data.js` module**: `engine.js` shrinks from ~189 KB (dominated by one 189 KB
  `DATA` literal line) to ~65 KB and now imports + re-exports `DATA` unchanged, so every tool/importer
  sees the identical surface — matching the existing `ap-by-level.js`/`advancement.js` externalization
  pattern. Byte-identical output verified: the moved literal is character-identical **and** deep-equal to
  the original, `engine-parity` (incl. warnings) reports **20/0**, and all 14 named exports are unchanged.
  `service-worker.js` updated (cache `pact-v5`→`pact-v6`, `engine-data.js` precached + network-first) so
  the rules dataset keeps `engine.js`'s immediate-fix-propagation semantics instead of going stale on a
  cache-first copy (see `DECISIONS.md`). No rules change — `DATA.version` unchanged (still v0.336); `BUILD`
  bumped **v0.200 → v0.201** (non-trivial structural build) and mirrored across the three tools per
  `docs/VERSION-SYNC.md`. Real-browser boot check (Chromium, all three tools): `engine-ready` fires, the
  bridges' `DATA` mutation succeeds (confirming `.js` is not frozen), and `compute()` runs clean. Follow-up
  **REV-14b** (split `compute()` into named sub-pricers) stays open; a cold-reviewed plan for the whole of
  REV-14 lives at `docs/plans/2026-07-17-engine-breakup-rev14.md`.

- **2026-07-17 · docs(roadmap) — scored `docs/TASK_BOARD.md`'s remaining untagged items with
  Effort/Risk tags**: REV-14, real icons, both landing-page follow-ups, A1/A3/A7's remaining scope, and
  the `MUT.patch` rename/restriction idea now carry the three-factor Risk breakdown, so they're visible
  to `/sweep-tasks` (most land at `Risk: high` — architectural/engine-touching or new live-data-table
  work — with real icons the one `Risk: low` exception, blocked only on art). The vague "Supporting
  reference tasks" bullets were deliberately left untagged — not scoped enough to rate. Also flagged
  (not fixed): A6's release-tagging work already shipped (v0.107) but was never marked done here.

- **2026-07-17 · fix(tooling) — `run-task.md`'s worktree-base check replaced with exact-equality, not
  ancestry**: the documented `git merge-base --is-ancestor origin/preview HEAD` check (and an
  undocumented "sharper" ancestry variant used ad hoc this session) both give a false positive right
  after a `preview`→`main` promotion — a worktree wrongly based on `origin/main` still passes, since
  `origin/preview` is reachable from `main`'s tip via the promotion merge. Replaced with
  `[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/preview)" ]`, which can't be fooled the same way.
  See `DECISIONS.md` D-GH-2026-07-17-worktree-base-check-exact-equality.

- **2026-07-17 · docs(tooling) — synced `docs/SKILLS.md` with the sweep-tasks/add-task changes it had
  missed**: the Ambiguity-High cross-tool-migration rule, `/sweep-tasks`' cap-backfill and stricter
  `$ARGUMENTS` parsing, and a corrected `/code-review ultra` description (it can silently fall back to
  a local max-effort pass, not always a billed cloud review).

- **2026-07-17 · refactor(auth) — shared `onSessionChange(session)` helper for `js/auth.js`,
  migrated 4 of 5 call sites**: adds `onSessionChange`, a one-argument wrapper around
  `onAuthChange(event, session)` that structurally rules out the argument-order bug — CharGen's 3
  call sites and DM Console's 1 (both previously bitten by it) now use it. Live Sheet's single call
  site (also previously bitten) keeps the raw, order-dependent `onAuthChange` since it genuinely
  needs the event string for its `SIGNED_OUT` branch — that site is **not** structurally protected by
  this change, only documented against (see `DECISIONS.md`). Display/UI-only, no `js/engine.js`/
  `DATA` involvement, parity still 20/0.

- **2026-07-17 · fix(tooling) — 15 findings from a `/code-review ultra` pass on `/sweep-tasks`/
  `/add-task` fixed**: worktree-leak on park paths, TaskList entries left stuck `in_progress`, no
  cap-backfill on drop/park, undefined bumped-to-high review tier, undefined PR-number capture,
  unvalidated `$ARGUMENTS` batch-size parsing, unguarded direct pushes to `preview`, a diff-size-check/
  add-task-example contradiction, a missing cross-tool-migration Ambiguity callout, plus stale-doc
  fixes in `docs/TASK_BOARD.md` and `AGENTS.md` — see `DECISIONS.md`
  D-GH-2026-07-17-sweep-tasks-review-fixes for the full list.

## How to add an entry
Add at the TOP. Format:
`- **<date> · <type> — <headline>** (<proof: tests pass, files touched>). <what changed, condensed>.`
`<type>` ∈ `feature · rule · fix · data · UI · tooling · docs`. Note `DATA.version` only if it changed.

---

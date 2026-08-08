# Plan: Shared cloud-sync status chip + universal autosave (Part B) — v2

## Implementation note (B1, 2026-08-08)
B1 is implemented (`js/sync.js`: `getSyncState`, `noteEdit`, `checkFreshness`, `markInSyncWithServer`;
gate: `testing/scripts/sync-state-machine-ci.mjs`, 21/0). Writing the differential test for the
editSeq/savedSeq race (B1 step 2 below) found a bug this plan's own design didn't anticipate:
`applyServerMeta()`'s final `lsSet(rec)` wrote back the *whole* in-memory record captured at push-start,
silently overwriting a higher `editSeq`/`savedSeq` a concurrent `noteEdit()` or sibling push had already
advanced in localStorage — the same failure class the counters exist to prevent, one layer down. Fixed by
merging against the *currently persisted* values via `Math.max`, not just the in-memory record's own
copies. Left here as a reminder that "two disinterested design passes agreed this is race-safe" is not the
same as "implementing it exposes no further races" — B2/B3 should expect the same, not assume the design
work already caught everything.

## Implementation note (B2, 2026-08-08)
B2 is implemented with one deliberate deviation from this plan's original framing, made because the
user declined to weigh in when asked mid-implementation and "keep both, additively" was the lowest-risk
default: **the new chip does NOT replace `cgCloudStatus`/`renderStatus()` (CharGen) or
`cloudStatusBadge`/`renderCloudStatusBadge()` (Live Sheet).** Reading the actual code found those
elements are dual-purpose — they carry campaign-rules-binding status ("☁ Campaign: Amble — DM rules
active" etc.), not just sign-in state — so a literal replace would have been a real information loss,
not a pure simplification. The new chip (`#cgSyncChip`/`#lsSyncChip`, class `synchip`, shared
`chipPresentation()` in `js/sync.js`) is **additive**, sitting alongside the existing status line. This
is a partial win on the original "replace, don't add" goal, not the clean swap the plan described —
worth revisiting explicitly (with the owner, not assumed again) if the two-element header still feels
cluttered once this ships. DM Console's `#campWho` was NOT given a separate chip element — its existing
text now carries the shared icon/aria-label from `chipPresentation()` while keeping its own layout
(it usefully shows the signed-in email, which the editor-tool chip does not).

Also found while implementing: DM Console's `award-status` element (item 7) turned out to be
**already-adequate, not a gap** — its apparent "no success message" turned out to be because
`renderCloudRoster()` re-renders the whole card immediately after a successful award, showing the
updated AP total; an explicit "Awarded!" flash would just be overwritten by that re-render a moment
later. No change made there — verified, not assumed.

One real bug caught before commit, not in review: the freshness-check wiring in Live Sheet initially
referenced `_session`, a variable private to a *different* script closure (the `sync-ready` listener),
which would have silently thrown-and-been-swallowed by the surrounding `try/catch` on every call —
`checkFreshness()` never actually running. Fixed by relying on `checkFreshness()`'s own internal
signed-in guard instead of duplicating (and getting wrong) an external one.

## Implementation note (B3, 2026-08-08)
B3 is implemented per the C2 design decision above (`characters.autosave_enabled boolean default
true`, one owner-reversible toggle, no RPC — a plain column grant under the existing owner-only
`characters_update`/`characters_insert` policies, mirroring `archived_at`'s precedent exactly rather
than `award_ap()`'s SECURITY DEFINER pattern, since the writer here is always the row's own owner).

CharGen's `_cgCloudAutosave()`/`_cgFlushCloudSaveNow()`/pagehide handler had their `window._cgCampaignBound`
gate replaced outright with a shared `_cgAutosaveGate()` (signed-in + `getAutosaveEnabled()`), and the
stale header comment describing the old campaign-bound-only scoping was corrected in the same change —
it would otherwise have flatly contradicted the code three lines below it. Live Sheet's equivalent
scaffolding (`_lsCloudAutosave`/`_lsCloudPush`/`_lsFlushCloudSaveNow`/pagehide/`switchToCharGen` flush)
is new — mirrored from CharGen's pattern exactly, since Live Sheet had no cloud autosave at all before
this. A toggle checkbox (`#cgAutosaveToggle`/`#lsAutosaveToggle`) sits next to the sync chip in both
tools, refreshed on the same triggers as the chip itself.

**A second real bug caught before commit**, same class as B2's: `_lsAutosaveGate()` and the toggle's
enable/disable logic initially read `_session` directly — the exact variable private to a different
script closure that B2 already got wrong once. Fixed by introducing `window._lsSignedIn`, a plain
boolean mirror of `_session` set alongside it in the `onAuthChange`/`currentSession()` handlers — the
same pattern CharGen already uses (`window._cloudSignedIn`). Left here because it is the *second* time
this exact mistake happened in the same file across B2 and B3, which says the risk is the file's
closure structure itself (private auth state, autosave logic living in a different script block), not
an isolated slip — worth remembering for any *future* code added to Live Sheet's autosave/chip paths,
not just this one.

**A third gap caught before commit, not from the plan's own risk list**: the original `setAutosaveEnabled()`
design (an UPDATE, matching `_setArchived()`'s pattern) would have thrown a misleading "may have been
deleted" error the first time a player toggled autosave on a brand-new character that had never been
cloud-saved yet — zero rows matched not because anything was wrong, but because the row simply didn't
exist. Fixed with an existence check that only treats zero-rows-but-exists as a real error, plus
carrying `autosave_enabled` through `pushCharacter()`'s INSERT (and its RLS insert-column grant) so a
pre-save toggle choice isn't silently discarded back to the column default the moment the row is finally
created.

**Not done, deliberately deferred, not silently skipped:** the write-volume budget (plan step 6, "needs
a real number before this merges") — no live traffic/quota data was available to measure against in
this environment. DM Console's roster does not yet surface a character's toggle state (flagged as an
open follow-up in the C2 decision record, not required for B3's own "done when" bar).

**Migration applied to the live database (2026-08-08, on explicit owner confirmation)**, via
`mcp__Supabase__apply_migration` against project `piuprrrnaotrtxucrtsb`. Verified post-apply, not
assumed: the column exists as `boolean not null default true`; all 16 pre-existing character rows read
`autosave_enabled = true` (zero silently flipped to `false` — confirms the "on by default" framing held
in practice, not just in the SQL); `information_schema.column_privileges` shows `authenticated` holding
INSERT/SELECT/UPDATE on the column. `get_advisors(type: security)` afterward showed no NEW finding
attributable to this change — every `SECURITY DEFINER` warning listed is a pre-existing, intentional
RPC (`award_ap`, `join_campaign`, etc.); this migration added no function, only a column and two column
grants.

## Goal
Give PACT's three tools one shared, honest cloud-sync status indicator (replacing three inconsistent
signed-in/out badges) and make cloud autosave the default for any character whose owner has actually
consented to it, not just campaign-bound ones — closing the specific design gaps two rounds of cold review
found blocking, with real mechanisms this time rather than named-but-unspecified fields.

## Context
This is **Part B** of a two-part effort; Part A already shipped (the flush-on-navigate fix — see
`docs/plans/2026-08-08-header-simplification-universal-autosave.md` and
`decisions/2026/D-GH-2026-08-08-chargen-cloud-autosave-flush.md`). This document is **v2** of the Part B
plan: v1 was cold-reviewed by 5 models — but only **3 vendor families**, not 5: Anthropic (Claude Opus
4.8) appeared **twice** under two different filenames, one of which was mislabeled as a different vendor
("deep" — the review's own self-identification line says Claude Opus, not the vendor the filename implied;
an actual review from that vendor appears not to have happened). The other four were OpenAI-lineage (×2:
GPT-5.6 Luna, GPT-5 via M365 Copilot) and, genuinely new this round, **Moonshot AI's Kimi** (×1) — real
third-family diversity. All 5 converged, near-unanimously, on the same core defect: v1 *named* the right
concepts (a `pendingEdit` flag, a persisted `behind` signal, an eligibility rule) without specifying the
mechanism precisely enough to implement without reintroducing the exact bugs this work exists to fix. v2
below replaces each named-but-unspecified piece with a concrete mechanism, verified against three
disinterested design passes (see Review outcome).

**Repo facts a reviewer needs** (verified in code): PACT is a static, vanilla-JS app (no framework/
bundler/npm) on GitHub Pages; Supabase is the only backend, reached client-side, RLS-protected. The three
tools (`tools/PACT-Live-Char-Sheet.html`, `tools/PACT-CharGen-Webtool.html`, `tools/DM-Console.html`) are
deliberately separate standalone HTML files with no shared UI framework — only a few shared JS modules
exist (`js/engine.js`, `js/sync.js`, `js/character-store.js`, `js/auth.js`, `js/campaign.js`,
`js/supabase-client.js`). Hard rule: every player-controlled value reaching innerHTML/an attribute must
pass through `esc()` — cloud data crosses users (DM Console renders other players' data). This project
already routes sensitive per-row state through narrow `SECURITY DEFINER` RPCs rather than bare column
grants — confirmed in `sql/rls-policies.sql`: `characters_update`'s only column-level grant is
`grant update (name, kind, stats) on public.characters` (line 228); `ap` and `campaign_id` are deliberately
excluded from it and can only change via RPCs like `award_ap()`. The eligibility design below follows that
same, already-established pattern rather than inventing a new one. After any change, a fixture-based
regression test (`testing/tests/engine-parity.html`) must report 0 failed; a separate rules-dataset version
bumps only for `compute()`-output changes — this work is display+sync-orchestration only and is not
expected to need that bump.

**Standing, owner-approved scope (unchanged):** one shared six-state chip vocabulary — **canonical table**,
resolving the v1 naming drift a majority of reviewers flagged:

| Display name | Internal state | Precedence |
|---|---|---|
| Signed out | `signedOut` | 1 (highest — overrides all) |
| Saving | `saving` | 2 |
| Newer on cloud + unsaved changes | `conflict` (= dirty+behind) | 3 |
| Newer version on cloud | `behind` | 4 |
| Unsaved changes | `dirty` | 5 |
| Signed in | `idle` | 6 (lowest) |

Replaces Live Sheet's `cloudStatusBadge`/`renderCloudStatusBadge()`, CharGen's `cgCloudStatus`/
`renderStatus()`, and DM Console's `campWho`/`updateAuth()`; folds in and removes the still-open
`docs/TASK_BOARD_NEXT.md` entry "Consistent, obvious sign-in indicator across the three tools." The chip
**replaces** existing elements. Cloud autosave becomes the default for any consenting character.

## Assumptions vs. verified facts

**Verified (read directly in the code):**
- `js/sync.js`'s local cache record (`lsGet`/`lsSet`, keyed `pact-char-<id>`) already carries `dirty` and
  `base_updated_at` (set in `saveCharacter()`, `applyServerMeta()`, and `reconcile()`'s adopt branch) —
  `base_updated_at` is a real, already-persisted field, not an assumption a prior review flagged it as.
- `window._syncBridge` differs per tool: CharGen has `withKeepalive` (added by Part A), Live Sheet doesn't
  yet, DM Console has **no** `_syncBridge` at all — its bridge is `window._campBridge`
  (`awardAp, getAwardHistory, unbindCharacter, setCharacterDmNotes, ...`), confirming its three real write
  paths are structurally separate from the character-build sync model this chip is designed around.
- Both editor tools already have a reusable conflict-resolution primitive: `loadCharacter(id, {onBehind})`,
  already wired to a confirm-and-reload prompt in both tools' `loadCloudChar()`.
- `sql/rls-policies.sql`'s existing pattern for sensitive per-row state: narrow column grants
  (`name, kind, stats` only) plus `SECURITY DEFINER` RPCs for anything else (`ap`, `campaign_id`) — the
  template the B3 eligibility design below reuses rather than inventing a parallel mechanism.

**Assumed (proposed below, needs owner sign-off, not decided here):**
- The B3 migration choice for characters already eligible under today's definition (opt-in prompt vs.
  blanket backfill) — see B3 step 4.
- 30s as the freshness-check throttle and the write-volume budget for B3 — both need a number, proposed
  as a starting point, not measured.

## Proposed approach
Three sequential branches, matching this project's one-task-per-branch convention.

**B1 — `feat/sync-state-machine`: state machine + behind-detection. No UI change.**
1. `getSyncState(id)` in `js/sync.js`, returning one of the 6 internal states per the precedence table
   above (`signedOut` checked first, independent of everything below it).
2. **Close the debounce blind window with two monotonic counters, not a boolean**, on the same cache
   record: `editSeq` (bumped synchronously by a new `noteEdit(id)`, called by each tool at the exact point
   an edit is detected — the same call site that already starts the debounce timer) and `savedSeq`
   (stamped by `saveCharacter()`/`applyServerMeta()` with whatever `editSeq` was captured *at push-start*,
   advanced only via `Math.max(rec.savedSeq||0, capturedSeq)` so a late/out-of-order confirmation can never
   regress it). `hasUnsavedEdits = editSeq > savedSeq` — provably race-safe against an edit arriving while
   a push is already in flight, and requires no cross-module flag-passing since both numbers live on the
   record `getSyncState()` already reads. (Resolves the race all 5 v1 reviewers flagged; verified via a
   disinterested design pass — see Review outcome.)
3. **`behind` joins `dirty` on the same cache record** (not a new key, not `_pageBase` — that map is
   deliberately page-lifetime-only and would not survive a reload, which `behind` needs to). Add
   `checkFreshness(id)` — read-only, `select id, updated_at ... eq('id', id)`, mirroring `reconcile()`'s
   existing select shape — comparing to `base_updated_at`, never pushing or adopting.
4. **All four "local now matches server" events route through one shared helper**, `_markInSyncWithServer
   (rec, serverUpdatedAt)`, instead of four independent inline writes: a successful push
   (`applyServerMeta()`), `checkFreshness()` finding the server unchanged, the explicit reload action (B2),
   and — the condition v1 missed — **`reconcile()`'s own silent adopt-at-boot branch**, both call sites.
   This closes the gap Kimi's review caught: a `behind:true` set mid-session must not survive as a stale
   warning past the next boot's successful auto-adopt.
5. **Failure semantics**: a failed `checkFreshness()` call never writes the persisted `behind` value —
   "last known truth stands" is the only default that can't actively mislead. It sets a separate,
   page-lifetime-only `_lastCheckFailed` marker (same lifecycle class as the existing `_pageBase` map),
   decorating whichever of the 6 states is showing (a muted secondary indicator, not a 7th state), and is
   gated off entirely when offline/signed-out so the expected offline case never masquerades as a failure.
6. Wire `visibilitychange`/`focus` in both editor tools to call `checkFreshness()`, throttled to at most
   once per 30s (starting value, not measured — flagged below).
7. **First-class B1 test, not deferred to B3**: character-switch-while-a-save-is-pending must not let
   character A's save completion clear or relabel character B's pending state — the `editSeq`/`savedSeq`
   design in step 2 already makes this safe by construction (both are keyed per-character on the record),
   but it needs an explicit test, since the race is structural to the design, not incidental.
8. Explicitly **not** in scope: idle-interval polling, realtime/websocket detection — deferred per both
   review rounds' cross-family consensus.

**B2 — `feat/shared-sync-chip`: chip UI + conflict resolution + DM Console's own scope. Built on B1.**
1. One shared, pure state→`{icon, label, ariaLabel, tone}` mapping function, taking only the fixed 6
   states (plus the `_lastCheckFailed` decoration) as input — **never a raw character/campaign name**. Any
   tool composing a dynamic name near the chip does so via `textContent`/DOM properties, not `innerHTML` —
   this is the actual risk surface a prior review correctly identified (the mapper itself has nothing to
   escape; the tool-side composition does).
2. Chip markup replaces the three existing badges, namespaced ids per tool, wrapped in
   `role="status" aria-live="polite"` (`assertive` for the `conflict` state specifically) so a state
   transition is announced to assistive tech, not just visually shown.
3. **Conflict resolution** (`conflict` = dirty+behind): a distinct, honestly-labeled action — not "Force
   sync now." Reuses the existing `onBehind` primitive (`loadCharacter(id,{onBehind})`), but the prompt
   text states plainly that accepting discards local edits, and offers the already-shipped Export/backup
   feature as a "keep a copy first" step before the destructive reload — no new export mechanism needed,
   just pointing an existing one at this moment. Cancel leaves the `conflict` state exactly as it was;
   accepting transitions through `_markInSyncWithServer` (B1 step 4), clearing both `dirty` and `behind`.
4. **CharGen only** gets "Save to cloud" demoted to a chip-reachable fallback in this branch — Live Sheet
   keeps it as its primary action until B3 gives it autosave, avoiding the regression window a prior review
   caught (Live Sheet's *only* cloud-save path would otherwise get harder to find with nothing automatic
   to replace it).
5. **DM Console gets the signed-in/out subset only**, explicitly not the full six-state machine — its
   header never represents a specific character's build-sync state (it doesn't hold one open the way the
   editor tools do). Its own three write paths (`awardAp`, `setCharacterDmNotes`, `unbindCharacter`) get
   their own inline per-action feedback at the point of action — **check first** whether the existing
   `award-status` element already covers this before adding a parallel mechanism. The shared mapping
   function's DM Console call omits a character id entirely (a `signedIn`-only variant), rather than being
   asked to represent a state that doesn't apply to it.
6. `esc()`/safe-composition applies to every chip surface: label, tooltip/title, aria-label.
7. Remove the folded-in task-board entry from `docs/TASK_BOARD_NEXT.md`.

**B3 — `feat/universal-cloud-autosave`: one universal toggle. Design decided (owner, 2026-08-08, "C2"
below); implementation not yet started.**

**Superseded design decision.** The original consent model below (a one-way `cloud_autosave_consented_at`
stamp, with `campaignBound` as a separate always-on pathway) is **replaced** by a simpler one the owner
chose directly: **one visible, freely-reversible per-character toggle — "Autosave to cloud: On/Off" —
that applies uniformly to every character, including campaign-bound ones.** This was a genuine two-option
decision:
- **C1 (not chosen):** keep campaign-bound characters locked to always-on (no toggle), giving the free
  toggle only to non-campaign characters — preserves the DM-visibility guarantee campaign autosave was
  originally built for (2026-08-03: "a player who redeemed an invite... stayed invisible in their DM's
  roster until they happened to press Save"), at the cost of two different rules for two character types.
- **C2 (chosen):** the toggle is genuinely universal. A player *can* turn off autosave on a campaign
  character, and the DM's roster can go stale until that player manually saves again — accepted
  explicitly as a known, intended possibility, not an overlooked edge case. **This is a real behavior
  change from today**, where campaign-bound autosave has no off switch at all.

**Revised B3 approach:**
1. **One stored boolean, not a one-way consent timestamp.** Add `characters.autosave_enabled boolean not
   null default true` (see step 4 for why `true`). Written via a `SECURITY DEFINER` RPC
   (`set_autosave_enabled(character_id, enabled)`), mirroring the existing `award_ap()`/`characters_update`
   column-grant pattern. Freely settable in both directions by the character's owner — this is a
   preference, not a consent event, so there is no "spend it once" framing to preserve.
2. **The gate collapses to one check:** autosave fires whenever `autosave_enabled` is true — full stop, no
   `campaignBound || …` special case. Campaign-bound and non-campaign characters are governed by the exact
   same flag; nothing in the client code needs to know which kind of character it's looking at to decide
   whether to autosave.
3. **UI: a real, visible toggle control** (not a one-time prompt) — near the new sync chip in both editor
   tools' headers, and its current state should be legible from the chip/header without opening a menu, so
   a DM-relevant "this player has autosave off" fact isn't buried. Consider whether DM Console's roster
   should also surface a character's toggle state, given C2's accepted staleness risk — the DM is the
   party most affected by a player switching it off, and today has no way to know it happened.
4. **Rollout default: `true` for every character, existing and new, campaign-bound or not.** Unlike the
   superseded consent model, this is *not* retroactive enrollment in the ethically-loaded sense the prior
   design worried about — the toggle is immediately visible and immediately reversible, so defaulting on
   is closer to "shipping a new, on-by-default feature" than "silently opting someone into something
   hidden." Characters that want to stay local-only-by-habit lose nothing they can't get back with one
   click. No opt-in prompt, no migration ceremony.
5. Add the equivalent autosave scaffolding to the Live Sheet (debounce, `withKeepalive` flush, awaited
   flush before its own cross-tool switch) — mirroring Part A's CharGen pattern, not re-deriving it. Note
   for scoping, not yet a decision: Live Sheet's edit pattern during live play (rapid small HP/spell-slot
   changes) differs qualitatively from CharGen's character-building session — evaluate whether the same
   debounce interval is actually appropriate before assuming it transfers unchanged.
6. **Write-volume gate needs a real number before this merges**, not just "re-measure": define an expected
   writes-per-active-session budget and a measurement method (e.g. count actual save attempts across a
   representative CharGen+Live Sheet session), and compare against Supabase's applicable quota headroom.
   "Re-measured, still fine" must be a checkable claim, not a vibe.

## Files involved
- `js/sync.js` — `getSyncState()`, `noteEdit()`, `checkFreshness()`, `_markInSyncWithServer()`,
  `_lastCheckFailed`, the eligibility read (B1/B3).
- `sql/schema.sql` / a new `sql/migrations/*.sql` — `autosave_enabled` column, default `true` (B3).
- `sql/rls-policies.sql` — `set_autosave_enabled()` RPC, alongside the existing `award_ap()`-style pattern (B3).
- A new small shared module (or a function in `js/sync.js`) for the state→label/icon/aria mapping (B2).
- `tools/PACT-CharGen-Webtool.html` — chip markup, conflict action, `noteEdit()` call sites, drop the
  campaign-bound-only gate (B2/B3).
- `tools/PACT-Live-Char-Sheet.html` — chip markup, conflict action, add cloud autosave (B2/B3).
- `tools/DM-Console.html` — signed-in/out chip visuals only; verify/adjust `award-status`-style elements
  near `awardAp`/`setCharacterDmNotes`/`unbindCharacter` (B2).
- `docs/TASK_BOARD_NEXT.md` — remove the folded-in sign-in-indicator entry (B2).
- `CHANGELOG.md` / `DECISIONS.md` — one entry per branch; a decision record for the B3 consent model and
  its migration choice.

## Out of scope
- Realtime/websocket staleness detection, true idle-interval polling — deferred past this plan.
- Same-browser multi-tab coordination (`BroadcastChannel`) — documented as a known limitation (`behind`
  detection is focus/visibility-gated, so a background tab in the same browser won't see another same-
  browser tab's edits until it regains focus), not built; revisit if it surfaces in real use.
- Any change to the existing stale-save guard or `pushCharacter()`'s concurrency logic.
- Rules engine, `compute()`, `DATA.version` — display + sync-orchestration only.

## Alternatives considered
- **A tool-owned boolean `pendingEdit`, patched with an in-flight tracking flag** — rejected: strictly more
  moving parts (two independently-owned flags plus a happens-before ordering) to reconstruct what a
  monotonic counter pair gives for free.
- **Inferring autosave consent from cloud-row existence** (B3's original v1 design) — rejected: conflates
  a server fact (a row exists) with a user-intent fact (this person consented), which can diverge in both
  directions (auto-bound campaign character with no manual save; stale/cross-device cache implying
  consent that was never given).
- **A one-way consent timestamp + `campaignBound` as a separate always-on pathway** (B3's superseded
  second design) — replaced by the owner's own simpler choice (C2): a single reversible boolean covering
  every character uniformly. Rejected specifically because two different rules for two character types
  was the more complex answer, once "visible and reversible" removed the ethical weight that justified
  the complexity in the first place.
- **C1 — lock campaign-bound characters to always-on, toggle only for the rest** — considered, not chosen;
  see the B3 decision block above for the tradeoff (DM-visibility guarantee vs. one uniform rule).
- **Reusing `reconcile()` for the focus/visibility freshness check** — rejected: it can push or adopt as a
  side effect, which a mere freshness check should never risk.

## Risks / open questions
- **C2's accepted consequence**: a DM's roster can go stale if a player switches off autosave on a
  campaign-bound character, with no current plan for the DM to be told this happened (B3 step 3 raises
  surfacing it in DM Console's roster, not yet designed). Accepted by the owner as a known tradeoff, not
  an oversight — but the DM-facing visibility gap is still open.
- 30s freshness throttle and the B3 write-volume budget are starting numbers, not measured ones.
- Live Sheet's debounce cadence during live play vs. CharGen's during building — worth independent
  evaluation before assuming Part A's pattern transfers unchanged (B3 step 5).
- `award-status`-style elements in DM Console may only partially cover the three write paths — verify
  before building a parallel mechanism (B2 step 5).

## Verification
- `testing/tests/engine-parity.html` → 0 failed on every branch.
- **B1:** fixture/table-driven test asserting the precedence order and the `editSeq`/`savedSeq` merge
  under the exact race scenario reviewers described (edit arrives mid-push); a two-*browser* check (not
  two same-browser tabs, which would partially exercise the explicitly-deferred multi-tab case) for the
  parts needing a live session; character-switch-during-pending-save as a named test case.
- **B2:** visual check in light/dark across all three tools; a malicious-name fixture asserting safe
  rendering across every dynamic chip surface (label, tooltip, aria-label); a live conflict-resolution run
  confirming both the accept path (state clears via `_markInSyncWithServer`) and Cancel (state unchanged).
- **B3:** the expanded matrix from the prior review (offline/failed-push, expired-auth mid-session,
  character-switch-mid-save) plus: toggling `autosave_enabled` off on a campaign-bound character actually
  stops the autosave (proving the gate is genuinely unconditional, not campaign-bound-overridden); the
  toggle is visible and correctly reflects server state after a reload/cross-device check.

## Done when
**B1+B2 done:** the state machine has a race-safe unsaved-edit signal and a persisted `behind` with all
four clear conditions and defined failure semantics; the chip renders from one shared mapping function
identically (per the canonical table) across all three tools, with DM Console's narrower subset; the
conflict state has a working, honestly-labeled, cancelable resolution action; `testing/tests/
engine-parity.html` stays 0 failed.

**B3 done:** every character, campaign-bound or not, autosaves to the cloud by default with one visible,
freely-reversible per-character toggle governing it uniformly; the toggle survives a pre-save choice
through a character's first cloud insert; `testing/tests/engine-parity.html` and the sync test scripts
stay 0 failed.

**Still open, not part of B3's own bar but worth tracking before calling the whole plan closed:** the
write-volume budget (plan step 6) is unmeasured — no live traffic/quota data was available in this
environment; the migration was written but not applied to the live database (needs explicit
confirmation, a separate step from code review); DM Console's roster does not surface a character's
toggle state (the C2 decision's named follow-up); no real-browser visual verification has been done for
B2 or B3.

---

## Reviewer instructions
**Before anything else, state which AI model and settings you are** — e.g. "GPT-5 (default)", "Claude
Opus 4.x (extended thinking)", "Gemini 2.x Pro", or "human reviewer" — as the very first line of your
response.

You are reviewing this plan **cold, with no access to the codebase** — only the text above. Judge logic,
clarity, scope, and risk — not code correctness you cannot verify.

**Default posture: try to refute this plan.** This is v2 of a plan whose v1 was found broken in several
concrete ways by 5 independent reviews; don't assume v2 fixed everything just because it responds to each
prior finding — check whether it actually did. Specifically:
1. Does the proposed approach achieve the goal? Argue against it before for it.
2. Which assumptions look shaky, and what breaks if wrong?
3. Is anything in "Alternatives considered" actually better?
4. What's missing — an edge case, a risk, a verification step?
5. Are "Verification" and "Done when" objectively checkable?
6. Should this be split further? Is anything in "Out of scope" load-bearing?
7. This plan claims to resolve specific findings from its own v1 review round — for the `editSeq`/
   `savedSeq` design, the `behind` persistence/clear-condition/failure design, and the consent/eligibility
   design in particular, judge whether each is actually implementable and race-safe as described, not just
   more detailed than before.

Tag each finding `blocking`/`moderate`/`minor` and `high`/`low` confidence. If a section is solid, say so
briefly. **Deliver your review as a Markdown file**, led by your model/settings line, named
`sync-chip-part-b-v2-review-<your-model>.md`.

---

## Review outcome
- **v1 reviewers (5 files, 3 vendor families):** Claude Opus 4.8 ×2 (Anthropic — one filename ("deep")
  self-identified as Claude Opus despite implying a different vendor; treat as same-family repeat, not
  cross-family confirmation), GPT-5.6 Luna (OpenAI), GPT-5 via M365 Copilot (OpenAI), Kimi (Moonshot AI —
  genuine third family).
- **Disinterested design passes (this session, no conversation context):** 3, covering the `pendingEdit`
  race, `behind` persistence/failure semantics, and autosave eligibility — verdicts folded directly into
  this v2's Proposed approach above rather than left as findings to re-litigate.

| Finding | Severity | Confidence | Raised by | Cross-family agreement | Disposition |
|---|---|---|---|---|---|
| `pendingEdit`↔`getSyncState()` seam unspecified + edit-during-save race | blocking | high | all 5 | yes (3 families) | accept — replaced with `editSeq`/`savedSeq` |
| `behind` storage location unspecified | blocking/moderate | high | 4 of 5 | yes | accept — joins `dirty` on the cache record |
| `behind` clear-conditions miss `reconcile()`'s adopt branch | blocking | high | Kimi only | no (1 family) | accept — correct on the merits, folded in regardless of single-sourcing |
| No offline/error/unknown state for failed freshness checks | moderate | high | 4 of 5 | yes | accept — transient decoration, not a 7th state |
| Eligibility inferred from cache/row-existence, not durable consent | blocking | high | 3 of 5 | yes | accept — real column + RPC, mirrors existing `award_ap()` pattern |
| "Nothing retroactively enrolled" false for already-cloud-saved characters | moderate | high | Kimi | no (1 family, but a plain logical contradiction) | accept — verified directly against my own text |
| `campaignBound` gate not reconciled with the consent rule | blocking | high | M365 Copilot | no (1 family) | accept — campaign-bound is now its own named consent story |
| B2 demotes Live Sheet's manual save ahead of B3's autosave | moderate | high | Claude Opus | no (1 family, but a plain contradiction) | accept — B2 now scopes the demotion to CharGen only |
| Conflict resolution is discard-only, unlabeled as lossy | moderate | high | 3 of 5 | yes | accept — explicit loss warning + reuse existing Export as a keep-a-copy step |
| `base_updated_at` treated as unverified assumption | moderate | high | Claude Opus (1 of the 2) | n/a | reject — false alarm, already verified earlier this session |
| Chip vocabulary naming drift; `signedOut` missing from precedence | minor | high | 4 of 5 | yes | accept — canonical table added |
| No `aria-live` region for state transitions | moderate | high | Kimi only | no (1 family) | accept — cheap, clearly correct, folded in |
| DM Console "one shared six-state chip" wording contradicts its narrower scope | moderate | high | 4 of 5 | yes | accept — goal wording + explicit signedIn-only call pattern |
| 30s throttle / B3 write-volume have no acceptance threshold | moderate | high | 4 of 5 | yes | accept as open question — needs a number before B3 merges, not resolved here |
| Live Sheet debounce assumed identical to CharGen's | moderate | medium | Kimi only | no (1 family) | accept as open question — flagged in B3, not resolved here |

- **Materially changed the plan?** Yes — every mechanism v1 only named (`pendingEdit`, persisted `behind`,
  eligibility) now has a concrete, disinterested-reviewed design; B2/B3 sequencing corrected to avoid a
  regression window; the consent model no longer contradicts its own stated claim.
- **Without this round of review:** v1 would have shipped three plausible-looking but actually broken
  mechanisms — a status chip that could show "all synced" while real edits were silently lost to the race,
  a "behind" warning that could get stuck stale forever, and an autosave rule that retroactively enrolled
  existing characters while claiming not to.

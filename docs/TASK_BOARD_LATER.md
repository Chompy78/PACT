# PACT — Task Board

> Written for agentic assistants (VS Code Copilot & Claude Code). With `AGENTS.md` committed, you don't
> repeat project context — **paste one task at a time**, review the diff, accept. Each task ends with a
> **Done when** check.
>
> **Rules for this file** (see `AGENTS.md`):
> 1. Holds only **open / planned** work. When a task is DONE, **move it into `CHANGELOG.md`** in the same change.
> 2. **Single writer.** Agents: *output* new items in this format for the human to fold in — don't append directly.
> 3. One task per branch. The open git branch is the "in flight" signal.
>
> **`REV-NN` items** come from the 2026-06-29 code review. Full evidence, code, and acceptance criteria
> live in **`docs/PACT-Code-Review-2026-06-29.md`** — commit that file alongside this task board so the
> pointers resolve. Findings are filed by severity: HIGH → Now, MEDIUM → Next, LOW → Later.

Completed work (PWA shell, auth, cloud sync, campaigns, hardening, landing-page redesign, PHB data,
**REV-01** regression gate, **REV-02** SW same-origin cache fix, **REV-03** SW network-first,
**CU-1** agent docs, **CU-2** version sync, **CU-3** repo tidy, **CU-6** DM Console rename, **CU-4** branch
prune, PWA stale-version reload-prompt fix, Live Sheet mobile density/collapse) has landed and graduated
to `CHANGELOG.md`.


## Merge concurrent character edits instead of refusing them — TODO
Branch `feat/character-log-merge`. The deep fix behind `fix/optimistic-character-save` (NOW), which only
*refuses* a stale write. Do that one first; this supersedes its behaviour rather than conflicting with it.

**Why this is the right end state for THIS data model.** A PACT character is not an opaque document — it
is an append-only event log (`{schema, rules, name, LOG, SEQ, id}`). Two people editing the same character
are usually appending different events, not overwriting the same field, so the "conflict" is an artefact
of storing the log inside a single `stats` JSONB blob and writing the blob whole. Reconcile the two logs
by `seq`/`ts` and most conflicts stop existing.

That is a genuinely better outcome than the NOW task's refusal: a DM adding a boon while the player buys a
skill should end with the character having both, not with one of them being told to reload and redo.

**What makes it non-trivial:**
- The merge has to happen client-side, before the write, because the server stores one blob. So both
  logs must be fetched, merged and pushed — with the guard from the NOW task still protecting the push.
- Event order matters for pricing. The engine replays in log order, and `_replay`'s creation-lock and
  per-purchase stamps depend on that order. Two logs interleaved by timestamp could price differently
  than either did alone. Check this against `repriceDraft()` and `_vigorRankTier` before trusting a merge.
- Singleton events (`name`, `award`, patch slots) do not append — they replace. A naive union would
  produce two `name` events, or double an award. These need per-type merge rules, not one rule.
- Genuinely conflicting edits still exist (both sides change species) and need a human answer.

**Effort:** high · **Risk:** high — ambiguity high (the per-event-type merge rules are a real design
problem, and the ordering interaction with pricing is subtle); damage scale high (sync layer, all three
tools, player data); damage likelihood high (untestable without a live signed-in session). Not
sweep-eligible. Wants a cold plan review before implementation.

```text
1. DO NOT START until fix/optimistic-character-save has landed - refusing a stale write is the safety
   net this builds on, and it stays as the fallback whenever a merge cannot be resolved automatically.
2. Classify every event type as append-mergeable or singleton-replace BEFORE writing merge code. The
   list is in js/engine.js's event documentation plus CharGen's PATCH_SLOTS.
3. Prove the ordering question with the fuzzer rather than by reasoning: merge two randomly generated
   logs, then assert the merged log still satisfies the invariants log-fuzz.mjs already checks
   (idempotent reprice, no NaN, ledger reconciles for a draft).
4. Anything that cannot be merged automatically falls back to the NOW task's refusal + reload, with the
   conflicting field named. Never guess between two human intentions.
5. engine-parity must stay at its current count; this is a sync-layer change and must not move compute().
```

**Done when:** two independent edits to the same character both survive a save, singleton events merge
correctly rather than duplicating, the fuzzer confirms merged logs satisfy the same invariants as
authored ones, and anything unmergeable still falls back to a clear refusal.

---

> **Format note (2026-07-28):** split from a single `docs/TASK_BOARD.md` into `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by the existing NOW/NEXT/LATER bands — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`. Same rules apply to all three files.

---

# ⚪ LATER — low-severity fixes + ideas (not scheduled)

---

## Engine review cleanup: drawback buyoff IDs, signature guard, baseBuild dedupe, noLock scoping — TODO
Branch chore/engine-review-cleanup. Four small, low-risk js/engine.js hardening/cleanup items surfaced by
the 2026-07-14 engine.js review (see session discussion); bundled as one low-risk batch per AGENTS.md's
"quick" bundling allowance — each item still gets its own commit and CHANGELOG line.
**Effort:** medium · **Risk:** high — ambiguity is high on item 4 (noLock scoping is explicitly framed
as a real design call between a structural fix and a rename-only, with possible compute()/DATA.version
impact); damage scale is also high (touches js/engine.js directly, item 1 also touches CharGen's
separate hand-copied import-fold path); worst-of across the bundled 4 items lands the whole task at
high regardless of how contained items 2-3 are alone — never eligible for /sweep-code-tasks.

```text
1. Drawback buyoff matches by label, not a stable ID. `activeEvents()`/`_replay()` key `boughtOff` off
   `e.refVal` against the drawback's own label string (`e.payload.v`) — a renamed or duplicate-labeled
   drawback can mis-associate a buyoff. Give each `buy` (drawback) event a stable id at creation and have
   `buyoff` events carry `refEventId` instead of `refVal`; keep label-matching as a fallback for legacy
   logs with no id. This touches how Live Sheet (and CharGen's `_lsImportFold`/`buildToLiveLog` import
   path, per D-GH3) construct these events, not just engine.js — check CharGen's embedded import-fold
   copy emits/consumes the new field too, since it's a separate hand-copied path (see AGENTS.md
   high-risk-files note). Best done after Task 6, or update CharGen's embedded copy in the same PR.

2. `verifyPayload()`'s docstring claims "Never throws," but `_canonicalJSON()` recurses with no cycle
   guard — a circular in-memory object (not a JSON-parsed one, where cycles can't occur) would stack
   overflow uncaught. Wrap the top-level call in try/catch and return a defined error status (e.g.
   `{signed:true, valid:false, status:'error'}`) on exception, so the "never throws" contract is actually
   true regardless of input shape.

3. `baseBuild()`'s object literal declares `lineage:'', racialSpells:[]` twice (harmless — the later
   assignment silently wins). Remove the duplicate.

4. `noLock:true` in `_replay()` is currently scoped only by a comment (intended for CharGen's one-shot
   import burst) — nothing structurally prevents any `buy`/`buyoff`/`names` event from setting it and
   permanently dodging the creationLocked auto-trigger threshold. Add a structural constraint (e.g. only
   honor `noLock` for events before any real spend/finalize event in the log) or at minimum rename the
   field to make its narrow intended scope unambiguous (e.g. `importBurst`), and note the decision either
   way in DECISIONS.md.

If any of these changes alters compute() output for an existing fixture (most likely item 4, if it
changes when a build is considered creation-locked), bump DATA.version and update testing/expected/ in
the same PR; items 1–3 are expected to be output-neutral. Log a decision as
D-GH-<date>-engine-review-cleanup if item 1 or 4 changes real behavior (not just internal naming).
```

**Done when:** drawback buyoffs resolve by a stable event reference (with legacy label fallback), `verifyPayload()` cannot throw on any input, `baseBuild()`'s duplicate fields are removed, `noLock`'s scope is structurally constrained or renamed to make misuse unambiguous, and `testing/tests/engine-parity.html` is still 20/0.

---

---

**Low-severity review findings:**
- **REV-14** — (optional, engine-targeted) Extract `DATA` into `engine-data.json`; split `compute()` into
  named sub-pricers. Only safe once REV-01 gives real assertions; dedicated PR, byte-identical output.
  **Effort:** high · **Risk:** high — damage scale is high (edits `compute()` directly, the engine's
  single source of pricing truth) and damage likelihood is medium (the parity gate exists but has a
  known fixture-coverage gap on some warning-text paths, per REV-01's own follow-up note) — worst-of
  lands at high regardless of the decomposition's own ambiguity being only medium.

**Polish & hardening** (from the Task 5 audit session):
- **Real icons** — replace the placeholder 192/512/180 PNGs with real artwork (needs your art).
  **Effort:** low · **Risk:** low — a static-asset swap, one obviously-right way to do it, instantly and
  visually verifiable, no code/logic touched. (Blocked on human-supplied artwork, not on classification.)

**Supporting reference tasks** (run when needed, intentionally untagged — too undefined in scope to
rate Effort/Risk meaningfully until one is actually picked up and scoped):
- Supabase project setup · Icon & asset list (192/512/180) · Offline UX spec · Future-features roadmap.

**Improvements** (recommended action first; the *then* line is a lower-priority upgrade with its caveat):
- **A1 — Engine API contract.** *(base shipped 2026-07-13)* Full JSDoc contract now sits atop `js/engine.js`.
  *Remaining (optional):* a dev-only `engine.d.ts` for IDE autocomplete — *caveat:* a new format to maintain;
  can read as "TypeScript creeping in." **Effort:** medium · **Risk:** medium — ambiguity is medium (a
  real but low-stakes call: auto-generate vs. hand-maintain, and whether to add it at all given the
  caveat above); damage scale is low (dev-tooling only, no runtime impact); damage likelihood is low (a
  wrong `.d.ts` only misleads an IDE, immediately visible to whoever hits it).
- **A3 — Client error visibility.** *(base shipped 2026-07-13)* Global `error`/`unhandledrejection` surface +
  Report-issue link now on all pages. *Remaining (lower priority):* log errors to a Supabase table once
  sign-in is the default — *caveats:* extra write traffic + a privacy note to document. **Effort:**
  medium · **Risk:** high — ambiguity is medium (schema/sampling/PII-scrubbing decisions, but bounded);
  damage scale is high (a new live-data table + RLS policy is a security/trust-boundary change, the
  same class as the feedback-widget's anon-write table decision, D-GH-2026-07-15-feedback-widget);
  damage likelihood is medium (the per-change checklist's Supabase-advisor check is a real gate, but a
  manual one, not CI-enforced) — worst-of driven by damage scale.
- **A7 — Lighthouse 85 → 90.** *(base shipped 2026-07-16)* Lighthouse CI now runs on every PR
  touching `index.html`/assets (D-GH-2026-07-16-lighthouse-ci), gated on a measured baseline
  (perf 100, a11y 98-100, best-practices 96, seo 100), so regressions auto-catch going forward.
  *Remaining (lower priority, higher risk):* split/lazy-load the engine (= REV-14) for a further
  score gain — *caveat:* a big engine change; do it only after REV-01 makes the gate real. **Effort:**
  high · **Risk:** high — ambiguity is high (an architectural engine-loading change with real
  trade-offs, no single obviously-right split); damage scale is high (touches `js/engine.js` directly);
  damage likelihood is medium (the parity gate runs in Node, so an async-loading-order bug specific to
  the browser might not be caught by it) — worst-of high, driven by ambiguity and damage scale both.
- **General engine maintainability (from the 2026-07-14 review).** `compute()` does normalization,
  pricing, validation, and warning-generation all in one ~350-line function — biggest source of risk when
  editing it (see REV-14 above for its own Effort/Risk — this is the same underlying work, not a second
  task). `MUT.patch` (`Object.assign(b, p.patch)`) can write arbitrary build fields and is named like
  an ordinary mutator despite being import-only — consider renaming (e.g. `importPatch`) and/or
  restricting its allowed fields. **Effort:** medium · **Risk:** high — ambiguity is medium (rename-only
  vs. rename-plus-field-restriction is a low-stakes call once the import contract is understood); damage
  scale is high (touches `js/engine.js`'s public `MUT` export, which CharGen's separate hand-copied
  import-fold path also depends on per AGENTS.md's high-risk-files note); damage likelihood is medium
  (the parity gate covers the bridged `MUT` usage in all three tools, but CharGen's import-fold closure
  is a separate hand-copied path the bridged fixtures don't fully exercise) — worst-of driven by damage
  scale. No fix scheduled; noted for whoever next does a larger engine refactor.
**Code-review follow-ups (from `feat/campaign-ap-model`)** — low-severity cleanup flagged by
`/code-review`, not fixed in that PR (low risk / negligible impact either way); heading currently empty,
nothing to tag:

## Restore a favicon for the served Players Guide — TODO
Branch `fix/guide-favicon`. On 2026-08-16 the guide's three PWA `<head>` tags — `<link rel="manifest">`,
`<link rel="icon">` and `<link rel="apple-touch-icon">` — were **removed** so that
`docs/PACT-Players-Guide.html` stays byte-identical to `pact-guide`'s master, killing a whole class of
silent transfer bug (every hand-`cp` had been stripping them unnoticed). See `CHANGELOG.md` and
`docs/VERSION-SYNC.md`. That trade was deliberate, but it has one real cost: the guide tab now shows a
generic browser favicon, because GitHub Pages only falls back to `/favicon.ico` at the **origin** root
(`chompy78.github.io/favicon.ico`), which isn't ours to set — nothing under `/PACT/` can supply one.

**The constraint that makes this non-trivial:** any fix that edits only this repo's copy is disqualified
by construction — it would reintroduce the divergence the removal existed to eliminate, and
`docs/VERSION-SYNC.md` now names a clean `diff` against the master as the transfer check.

**Effort:** low · **Risk:** low — ambiguity is the driving factor (whether a relative-path icon can
satisfy this repo, `pact-guide`, and `pact-guide-public` at once is *not* yet verified); damage scale and
likelihood are both minimal (one `<link>` tag, `git revert`-able, no rules or player data touched).

```text
1. Weigh the options — verify, don't assume:
   a. Give the MASTER a relative icon link and place a matching icon at the same relative path in every
      repo that serves the guide (this one, pact-guide, and pact-guide-public, which serves it publicly).
      Keeps the files identical. Confirm the relative path actually resolves in all three.
   b. Accept the generic favicon; close as won't-fix with the reasoning recorded.
   c. Something else — but anything that edits only the PACT-side copy is out by definition.
2. Re-check the two other removed tags, in case either matters more than the 2026-08-16 analysis found.
   Both conclusions were reasoned but NOT device-tested:
   - `<link rel="manifest">` — judged redundant because `manifest.json` already sets `scope:"/PACT/"`,
     so the guide is in scope and opens inside the installed app anyway.
   - `<link rel="apple-touch-icon">` — judged to matter only if someone home-screens the guide page
     itself rather than the app at `/PACT/`. Worth one real iOS check.
3. Docs-only unless option (a) ships: do NOT bump `DATA.version` or `BUILD`; log in `CHANGELOG.md`.
```

**Done when:** the guide tab shows the PACT favicon on GitHub Pages **and**
`diff <pact-guide master> docs/PACT-Players-Guide.html` is still clean — or the task is closed as
won't-fix with the reasoning recorded in `DECISIONS.md`.

## Investigate a DM-side per-purchase discount or waiver — TODO
Branch `feat/economy-purchase-discount`. Follows the gold-and-downtime economy
(`D-GH-2026-08-19-tool-coin-time-costs`). **Deliberately deferred, not forgotten** — the owner chose the
workaround at build time, and it may well be the permanent answer. Revisit only if it chafes in real play.

**What is missing.** There is no way for a DM to discount ONE named purchase. The rules assume it:
§16's "Mentors, specialists, and rare resources" (a legendary mentor waives the gold on Sneak Attack)
and §17's "the DM can waive or reduce any cost at any time, AP, gold, or downtime".

**Why it was deferred.** The DM grants the gold back with a note, which balances exactly — the character
spends 350 gp and receives 350 gp, net zero, power unchanged. Note the trap this avoids: granting **AP**
instead is NOT equivalent. AP is the power currency, so covering a gold cost with AP leaves the gold
still owed *and* hands the character spare AP for something else — it converts a brake into an
accelerator. The DM Console's Award AP form already takes gold directly (`award_gold`), plus
per-character bonus downtime (`declare_downtime`), so the correct move is one step, not a workaround
with friction.

**Two levels — investigate both before building either.**

*Display-only.* Surface what the engine already computes. `wealthLedger().entries` carries `discounted`,
`listGp` and `listDays` per purchase, and **no tool reads `entries[]` at all** — the Live Sheet builds its
history ledger straight from `LOG` using each event's own frozen `gp`/`days`. So a purchase that did not
pay list price shows its adjusted figures with no indication that they *are* adjusted; this already
affects any player who took §16's coin-for-time trade. Showing "paid 175 gp (list 350)" needs no SQL, no
new event type, and no engine change — the fields are retained for exactly this (see the comment at
`wealthLedger()`'s `entries.push`).

*A DM-settable discount.* **Do NOT build this by amending the purchase event.** The LOG is append-only,
and `dm_edit_character_log` deliberately allowlists only `buy/cat:boon`, `buy/cat:drawback`, `award` and
`dmRemoveBoon` — its own header says it "is deliberately not a general editor", and widening it to let a
DM rewrite arbitrary purchase events would hand the console the general log editor that RPC exists to
refuse. Follow the pattern `buyoff`/`dmRemoveBoon` already establish instead: a LATER event that modifies
an earlier purchase without editing it, resolved by matching inside `activeEvents()`. Sketch — a
`dmAdjustCost` event carrying a reference plus the new `gp`/`days`, resolved into an overrides map that
`wealthLedger()` consults BEFORE the event's own frozen figures, which in turn fall back to list price.
Touches: engine (`activeEvents`/`_paidFor`/`wealthLedger`), a migration extending the allowlist, DM
Console UI, Live Sheet ledger display, and `testing/scripts/economy-ui-e2e.mjs`.

**Weigh the rules framing first.** §16 calls mentor discounts "adventure rewards, not a shopping
option… The point is to make training a story, not a transaction." A DM typing a number into a form may
be the wrong texture for that rule entirely, which is a real case for staying on the grant-back
workaround permanently rather than a reason to delay.

**Done when:** a decision record (or an addendum on `D-GH-2026-08-19-tool-coin-time-costs`) states which
of the three governs and why — including "the workaround is the answer" as a legitimate outcome — and, if
either build option is chosen, it ships with `testing/scripts/economy-ui-e2e.mjs` covering it.

## Consider moving Current HP / Temp HP / Hit Dice left into LOG-backed data — TODO
```
In tools/PACT-Live-Char-Sheet.html, Current HP, Temp HP, and Hit Dice left are NOT part of the
event-sourced character (LOG/cloud `stats`). They live entirely in a localStorage-only scratchpad —
`_sheetStoreKey()` ('pactCharSheetManual:' + SHEET_TOOL, e.g. 'pactCharSheetManual:livesheet'),
written/read via `_csStore()`/`csSave(id,fieldId,val)`/`csLoad(id)`, seeded by `_mfIn('curHP',
String(r.hp), ...)` where r.hp is only the computed-max-HP DEFAULT, and rehydrated per character by
`hydrateSheet(id)` on load. This means these fields are per-device, per-browser: not synced to the
cloud, not visible to a DM, not shared between a player's phone and laptop, and lost if local storage
is cleared. This is already disclosed in the UI (the "📱 This device only — not saved to the cloud or
shared with other devices" hint added under the HP/Temp HP/Hit Dice box).

Investigate whether this should change, and if so how. Two options, not a foregone conclusion:

(a) Migrate into the LOG-backed path (the way `appearance` was migrated in an earlier change) so these
    fields sync to the cloud and are visible to a DM. This is a real schema/design decision, not a
    mechanical fix — it raises:
      - Does every HP tick belong in the append-only LOG as its own event (damage/heal/temp-HP-grant),
        or does it become a mutable "current state" field alongside LOG rather than derived from it —
        which breaks the project's "never store derived values, derive at runtime" rule as currently
        understood, since current HP is inherently a running total that only makes sense as either an
        event stream or a stored snapshot, not a pure recompute like AP/gold?
      - Migration story for characters that already have local-only HP values sitting in
        localStorage today — do they get folded in on next load, silently dropped, or left as-is?
      - Interaction with undo/redo and the time-travel/scrub UI (`foldBuild(uptoIdx)`) — if HP becomes
        LOG-backed, scrubbing to an earlier point must show HP as it was at that point, which is a
        bigger behavioral change than the other LOG-backed fields.
    Given the schema implications, run this through /make-code-cold-plan-review before implementing
    either direction.

(b) Leave as-is. The localStorage scratchpad plus the already-shipped "device only" hint is treated as
    the permanent, intentional answer — Current HP/Temp HP/Hit Dice left are combat-transient bookkeeping
    a player tracks per-session, not part of the character's durable build. This needs no further work.

Do not implement either option without a decision — this task is to weigh them, not to pick (a) by
default.
```
**Effort:** decision + (if (a) chosen) medium-large implementation · **Risk:** low to investigate;
medium-high to implement (a) — it changes what "the character" durably contains and touches undo/redo,
time-travel scrub, and the cloud sync path.

**Done when:** a decision record states which option governs and why (including "leave as-is, the
device-only hint is the permanent answer" as a legitimate outcome) — and, if (a) is chosen, it ships
with an engine-parity/tool-pricing-ci fixture covering HP behavior under undo/redo and time-travel scrub.

---

## CharGen writes HD as a replace-in-place patch slot, destroying HD history — TODO
Branch `refactor/hd-event-vocabulary`. The two tools record Hit Dice in **different event vocabularies**:
the Live Sheet appends `cat:'hd'` events (`payload.to`), while CharGen writes a replace-in-place
`cat:'patch'` slot (`PATCH_SLOTS.HD_PROF`, carrying `hd` and `profBonus` together). A CharGen-authored
character therefore carries **no record of what its HD was when any purchase was made** — the LOG is not a
true history for that field. Consequences: (a) purchase-time gating ("legal when bought stays legal", the
principled answer to a character whose HD is later lowered by undo — R4 of the HD-gate cold review) is
impossible for those characters, even though `_replay()` already stamps purchase-time tier for Vigor ranks
and could do the same here; (b) anything reasoning about HD over time silently reads 1. Found the hard way
on 2026-08-27, when a live-data query filtered on `cat='hd'` and every CharGen character came back as 1 HD.
**Effort:** high · **Risk:** high — damage scale is the driver: it changes the event vocabulary that 25
live characters' saved LOGs are written in, so it needs a migration story, not just a code change.
Ambiguity is medium (which vocabulary wins is a real design call) and likelihood medium.

```text
1. Decide which vocabulary is canonical: append-only `cat:'hd'` events (real history, but CharGen's patch
   slots exist to keep identity edits replaceable rather than accumulating) or a patch slot that records
   its prior value. Record the decision — this is the architectural question, the rest is mechanics.
2. Whichever wins, both tools must emit it. Watch PATCH_SLOTS.HD_PROF: it bundles hd WITH profBonus, so
   splitting hd out changes the slot's shape and replacePatchSlot()'s in-place semantics.
3. Migration: 25 live characters exist (the app is NOT pre-launch). Old LOGs must keep folding to the same
   build — foldBuild()/MUT must read both shapes indefinitely, or a one-time migration must be written and
   verified against a copy of the live data first.
4. Only once history is trustworthy, revisit purchase-time gating as its own task — do not bundle it here.
5. Behaviour-preserving for existing builds: fold output must be identical before vs after. Do NOT bump
   DATA.version unless compute() output genuinely changes.
```

**Done when:** both tools record HD changes in one vocabulary that preserves prior values; folding any
existing saved LOG (old or new shape) yields an identical build; a fixture covers each shape.

---

## Restore `file://` support — a deliberate consideration, not a bug to fix — TODO
Branch `feat/file-protocol-support`. **Filed 2026-09-02 as the deferred half of a decision the owner
already made.** The other half shipped: **two** of the three tools — CharGen and Live Sheet — carried
*"Must run by opening the file directly (file://)"* in their HARD CONSTRAINTS blocks. That claim had been
false since D-GH26 and was deleted rather than defended. (DM Console has no such block; its only `file://`
mention is an incidental storage-fallback comment. An earlier write-up of this said all three carried the
claim — it did not, and the error is corrected here rather than only in the decision record, because this
is the file whoever picks the task up will actually read.) This entry exists so the *capability* is not silently forgotten along with the false claim.
Nothing is broken today — the app is served over http and works. This is a question about whether a
use case the project once had should come back.

**What was measured** (headless Chromium, each tool opened directly off disk, 2026-09-02):

| tool | engine loaded | `DATA.version` |
|---|---|---|
| CharGen | **no** | `null` |
| Live Sheet | **no** | `null` |
| DM Console | **no** | `null` |

Browsers refuse ES-module loads from a `file://` origin, so the `engine-ready` bridge never fires and
`window.DATA` never exists. The tools are non-functional off disk, not degraded. That has been true since
the D-GH26 safe-subset migration moved the rules engine into `js/engine.js`, and **nobody reported it in
that whole window** — which is the single most useful datum here, and argues for leaving this closed.

**The case for reopening it:** the scenario is real for a tabletop tool — hand a player one `.html` file,
no server, no network, no install. That is what "single self-contained .html" was originally protecting.

**The case against, and why this is LATER and not NEXT:** the only realistic route is inlining the engine
into each tool at build time, and `AGENTS.md` bars a build step outright ("Vanilla JS only — no
frameworks, bundlers, TypeScript, or npm"). So this cannot be picked up as an implementation task. It
needs a decision to relax a hard rule first, and that decision has a real cost: a build step means the
committed `tools/*.html` stop being the thing you edit, which is a bigger change to how this repo works
than the feature is worth unless someone actually wants `file://` back.

**Effort:** high · **Risk:** high — not technically, but architecturally: it reopens a settled constraint.

```text
0. DO NOT START THIS AS CODE. The first deliverable is a decision record answering: is a distributable
   single-file build worth introducing a build step for? If the answer is no, close this task by moving
   it to CHANGELOG.md as declined — a recorded "no" is the useful outcome, not a failure.
1. If yes: scope the build step before writing it. Which artifacts are generated vs authored, where they
   live, what stops an agent editing the generated copy, and how docs/VERSION-SYNC.md's mirroring rules
   interact with a generated file. AGENTS.md's "no build step" line must be amended in the same change,
   not worked around.
2. Only then implement. An inline-the-module transform is the small part; keeping the served /PACT/ path
   and the file:// path from diverging is the part that will actually cost time.
3. Whatever is decided, do not re-add a "must run via file://" line to any tool header unless it has been
   verified by opening each tool off disk and confirming window.DATA is present. That unverified line is
   what created this task.
```

**Done when:** a decision record states whether `file://` is a supported use case — and if the answer is
no, this task is closed as declined rather than left open; if yes, all three tools load off disk with
`window.DATA` present, verified by loading each one, and `AGENTS.md`'s no-build-step rule has been
amended rather than contradicted.


# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

# PACT — Roadmap

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
> live in **`docs/PACT-Code-Review-2026-06-29.md`** — commit that file alongside this roadmap so the
> pointers resolve. Findings are filed by severity: HIGH → Now, MEDIUM → Next, LOW → Later.

Completed work (PWA shell, auth, cloud sync, campaigns, hardening, landing-page redesign, PHB data,
**REV-01** regression gate, **REV-02** SW same-origin cache fix, **REV-03** SW network-first,
**CU-1** agent docs, **CU-2** version sync, **CU-3** repo tidy, **CU-6** DM Console rename, **CU-4** branch
prune, PWA stale-version reload-prompt fix, Live Sheet mobile density/collapse) has landed and graduated
to `CHANGELOG.md`.

---

# 🔴 NOW — high-severity fixes + cleanup

_(none currently — the last NOW item, the full engine module-bridge migration, graduated to
`CHANGELOG.md` on 2026-07-10.)_

---

# 🟡 NEXT — medium-severity fixes + remaining build work

---

## Fix: race-losing join_campaign/redeem_player_invite calls surface a raw DB error — TODO
Branch fix/campaign-join-race-friendly-error. `join_campaign` and `redeem_player_invite`'s character-insert have no `unique_violation` exception handler, unlike `bind_character_to_campaign` (which got one in D-GH-2026-07-13-campaign-bind-character).

```text
A race that beats either RPC's pre-check surfaces a raw Postgres "duplicate key value violates unique
constraint" error to the client instead of the friendly "You have already joined this campaign" message.
Pre-existing, found during /code-review on PR #203 and deferred there as out of scope for a "no behavior
change" refactor.

Wrap the INSERT in join_campaign and the INSERT in redeem_player_invite's new-character branch in the
same begin/exception when unique_violation then raise exception '...' pattern bind_character_to_campaign
already uses (sql/schema.sql), each with the exact message text that function's own pre-check already
raises. New dated migration mirroring the change into sql/schema.sql. Re-run
testing/tests/engine-parity.html (20/0, unaffected) and the Supabase advisor after applying.
```

**Done when:** `join_campaign` and `redeem_player_invite` both convert a `unique_violation` race into their own existing friendly "already joined" message instead of a raw Postgres error; parity still 20/0.

---

## Feature: Advancement tracks + D&D 2024 level equivalency — TODO
Branch feat/advancement-tracks. Store AP-per-level advancement tracks (slow/average/fast + custom) and a D&D 2024 equivalent level reference table; let DMs select or customise a track per campaign.

```text
Add advancement track data to js/engine.js DATA (or a separate js/advancement.js imported by the engine) as a display-only reference — never read by compute(). Each track (slow/average/fast) defines cumulative AP thresholds per level. Also add a D&D 2024 equivalent level mapping (PACT AP total → approximate D&D 2024 level) as a display reference only.

In DM Console, add a campaign setting for advancement track: the DM can pick slow/average/fast or define a custom track (AP values per level). Store the selection in the campaign record in Supabase (DM-authoritative, RLS-protected).

In Live Sheet (and optionally DM Console), display the character's current D&D 2024 equivalent level as a read-only label derived from total AP spent + the D&D equivalency table.

Display-only — do NOT bump DATA.version; just log in CHANGELOG.

Note: the AP-by-level table is now externalized in `js/ap-by-level.js` (D-GH49, exposed as `DATA.apByLevel`). Build advancement tracks on top of that single source — reuse `AP_BY_LEVEL` as the "average" baseline rather than duplicating the AP ladder here.
```

**Done when:** advancement tracks are stored in engine data; a DM can select or customise a track per campaign; the Live Sheet shows the D&D 2024 equivalent level label; parity still 20/0.

---

## Feature: In-app user feedback widget (Supabase-backed) — TODO
Branch feat/feedback-widget. Add a small feedback form to all four player-facing pages — CharGen, Live Sheet, DM Console, and the Player's Guide — that saves free-text feedback to a new Supabase table, readable only via the Supabase dashboard (no in-app admin view in v1).

```text
1. New Supabase table `feedback`: id uuid pk default gen_random_uuid(), user_id uuid references profiles(id)
   on delete set null (nullable — anonymous/signed-out feedback is allowed), source text not null check
   (source in ('chargen','livesheet','dmconsole','guide')), message text not null check (length(message)
   between 1 and 2000), page_url text, created_at timestamptz not null default now(). New dated migration
   in sql/migrations/, mirrored into sql/schema.sql.

2. RLS: insert-only. Grant insert to both `anon` and `authenticated` (the guide and CharGen work
   signed-out) with a policy that just enforces the check constraints above — no select policy for either
   role. Feedback is read via the Supabase dashboard (service role), not through the app, so no admin
   UI/read path is needed for v1.

3. Add a small shared client helper (e.g. `js/feedback.js`) exporting `submitFeedback({source, message,
   pageUrl})`, reusing the existing `js/supabase-client.js` singleton — usable from a `<script
   type="module">` on any of the four pages.

4. UI: a small floating "Feedback" button in the corner of each page opening a minimal textarea + submit,
   with an inline success/error state. Feedback text is never rendered back into any page's DOM in v1 (no
   admin view reads it), so `esc()` is not required now — but the moment any in-app view displays stored
   feedback, that becomes mandatory per AGENTS.md's stored-XSS rule.

5. Note: `docs/PACT-Players-Guide.html` currently has ZERO existing module/Supabase wiring (unlike the
   three tools, which already import `supabase-client.js`) — it needs a fresh `<script type="module">`
   added, not just a call into existing bridge code. It's also ~657 KB — search for the closing `</body>`
   or an existing `<script>` tag rather than reading the file wholesale (see AGENTS.md).

6. After applying the migration, run the Supabase advisor and skim recent logs (per the per-change
   checklist — this touches SQL/RLS). Re-run testing/tests/engine-parity.html (unaffected — no
   js/engine.js change, should stay 20/0).

Display/process-only — does not touch js/engine.js or DATA.version; just log in CHANGELOG.
```

**Done when:** all four pages have a working feedback button that inserts a row into the new `feedback` table (signed-in and signed-out); RLS allows insert-only for `anon`/`authenticated` with no select path; parity still 20/0.

---

## Advancement-tracks follow-up: end-to-end browser verification — TODO
Branch test/advancement-tracks-e2e. Drive the advancement dials shipped in `feat/advancement-tracks` (PR #206) through a real browser with an AI/browser-automation tool, since they need Supabase auth + a live campaign the headless parity gate can't exercise.

```text
Depends on PR #206 (feat/advancement-tracks) being merged first. Using a browser-automation/AI tool
(signed in to a test Supabase account with a live campaign):
1. DM Console → Campaign Rules: confirm the three new controls (Level budget curve, Award pace, Starting
   tier) render, the L20 preview updates live, and preset<->field sync works (picking Generous sets
   83/+28; editing a number flips the preset to Custom).
2. Save rules -> reload -> confirm all three persist in campaigns.rules.
3. Change Starting tier -> confirm the player-invite "Starting budget" field pre-fills and stays editable.
4. As a player bound to that campaign, open Live Sheet -> confirm the header shows "≈ Track-Level N"
   derived from AP spent against the campaign's tuned curve; an unbound character falls back to Standard.
5. Check the browser console for errors at each step.
Fold the reproducible parts into the existing e2e harness (testing/scripts, character-gen-e2e.yml) if
practical. Display-only feature — no DATA.version/compute() involvement; parity still 20/0.
```

**Done when:** the DM-panel↔bound-player advancement-dials round-trip is verified working in a real browser (save/load/persist, invite pre-fill, Track-Level label), with any bugs found either fixed or filed.

---

## Live Sheet economy-line: tuned-curve vs earned-AP pace readout — TODO
Branch feat/livesheet-eco-track-level. Decide and implement whether Live Sheet's `#eco` economy line should move to the campaign's tuned budget curve or stay an earned-AP pace readout.

```text
Follows feat/advancement-tracks (PR #206). That PR replaced the header "≈ AP-Level" chip (earned AP vs the
fixed default DATA.levelAP table) with "≈ Track-Level" (AP spent vs the campaign's tuned levelBudgetCurve),
but deliberately LEFT the separate #eco economy line (tools/PACT-Live-Char-Sheet.html, the
$('eco').innerHTML block) showing "Lv L · X AP to reach equivalent of Lv L+1" computed from eco.earned
against DATA.levelAP — a distinct earning-pace widget.

Decide: (a) leave it as an earned-AP pace readout (it answers a different question than Track-Level),
(b) move it onto the tuned budget curve for consistency with the header, or (c) show both, clearly
labelled. Then implement the choice, making the label unambiguous about which metric it is so it doesn't
read as a third competing "level" number.

Display-only — do NOT bump DATA.version; just log in CHANGELOG. If the reasoning is non-obvious, log a
DECISIONS.md note as D-GH-<date>-livesheet-eco-track-level.
```

**Done when:** the `#eco` economy line's level readout is either intentionally kept as an earned-AP pace metric or moved to the tuned curve, with an unambiguous label distinguishing it from the header Track-Level; parity still 20/0.

---

# ⚪ LATER — low-severity fixes + ideas (not scheduled)

## Engine review cleanup: drawback buyoff IDs, signature guard, baseBuild dedupe, noLock scoping — TODO
Branch chore/engine-review-cleanup. Four small, low-risk js/engine.js hardening/cleanup items surfaced by
the 2026-07-14 engine.js review (see session discussion); bundled as one low-risk batch per AGENTS.md's
"quick" bundling allowance — each item still gets its own commit and CHANGELOG line.

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

**Low-severity review findings:**
- **REV-14** — (optional, engine-targeted) Extract `DATA` into `engine-data.json`; split `compute()` into
  named sub-pricers. Only safe once REV-01 gives real assertions; dedicated PR, byte-identical output.

**Polish & hardening** (from the Task 5 audit session):
- **Real icons** — replace the placeholder 192/512/180 PNGs with real artwork (needs your art).

**Landing-page follow-ups** (deferred from the redesign):
- Extend theming to the guide and tools (index-only today).
- "Continue / recent characters" on the landing page (needs the tools' save format).
- iOS "Add to Home Screen" hint (no `beforeinstallprompt` on iOS Safari).

**Supporting reference tasks** (run when needed):
- Supabase project setup · Icon & asset list (192/512/180) · Offline UX spec · Future-features roadmap.

**Improvements** (recommended action first; the *then* line is a lower-priority upgrade with its caveat):
- **A1 — Engine API contract.** *(base shipped 2026-07-13)* Full JSDoc contract now sits atop `js/engine.js`.
  *Remaining (optional):* a dev-only `engine.d.ts` for IDE autocomplete — *caveat:* a new format to maintain;
  can read as "TypeScript creeping in."
- **A3 — Client error visibility.** *(base shipped 2026-07-13)* Global `error`/`unhandledrejection` surface +
  Report-issue link now on all pages. *Remaining (lower priority):* log errors to a Supabase table once
  sign-in is the default — *caveats:* extra write traffic + a privacy note to document.
- **A6 — Tag releases to the build version.** `git tag v0.x` (matching `BUILD`) + a GitHub Release per
  ship, for a labelled rollback point. *Then (lighter alternative):* tags only, no notes — *caveat:* less
  context on what each release shipped.
- **A7 — Lighthouse 85 → 90.** Add a Lighthouse CI GitHub Action to auto-catch perf regressions. *Then
  (lower priority, higher risk):* split/lazy-load the engine (= REV-14) for the real score gain —
  *caveats:* a big engine change; do it only after REV-01 makes the gate real.
- **Harden `search_path` on SECURITY DEFINER functions against temp-table shadowing.** Every SECURITY
  DEFINER function in `sql/schema.sql`/`sql/rls-policies.sql` (11+ instances, pre-existing) sets
  `search_path = public` without also listing `pg_temp`, which doesn't fully close the classic
  session-local-temp-table-shadowing pitfall. Low real-world exploitability today (Supabase/PostgREST
  clients have no raw-SQL/DDL path), but worth closing repo-wide rather than piecemeal — a partial fix
  across only some functions would be worse than no fix. Change every `set search_path = public` to
  `set search_path = public, pg_temp` consistently; new dated migration; re-run
  `testing/tests/engine-parity.html` (20/0) and the Supabase advisor. Found during `/code-review` on
  PR #203. Branch `fix/harden-search-path-pg-temp`.
- **General engine maintainability (from the 2026-07-14 review).** `compute()` does normalization,
  pricing, validation, and warning-generation all in one ~350-line function — biggest source of risk when
  editing it. `MUT.patch` (`Object.assign(b, p.patch)`) can write arbitrary build fields and is named like
  an ordinary mutator despite being import-only — consider renaming (e.g. `importPatch`) and/or
  restricting its allowed fields. No fix scheduled; noted for whoever next does a larger engine refactor.
**Code-review follow-ups (from `feat/campaign-ap-model`)** — low-severity cleanup flagged by
`/code-review`, not fixed in that PR (low risk / negligible impact either way):

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

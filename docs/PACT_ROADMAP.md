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

# ⚪ LATER — low-severity fixes + ideas (not scheduled)

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
**Code-review follow-ups (from `feat/campaign-ap-model`)** — low-severity cleanup flagged by
`/code-review`, not fixed in that PR (low risk / negligible impact either way):

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

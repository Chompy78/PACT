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

---

> **Format note (2026-07-28):** split from a single `docs/TASK_BOARD.md` into `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by the existing NOW/NEXT/LATER bands — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`. Same rules apply to all three files.

---

# 🔴 NOW — high-severity fixes + cleanup

## Fix archive feature: listCharacters()/listMyCharacters() parity + unarchive row-count/esc gaps — TODO
Branch fix/archive-filter-parity. Root-cause fix for a live production bug: `js/sync.js`'s `listCharacters()`
(still called by CharGen's and Live Sheet's own cloud-load menus) never selects `archived_at`, so archived
characters still show as fully loadable/playable in the two tools where characters are actually used — the
archive feature (shipped 2026-07-25, `a876591`) is silently defeated outside the new "My Characters" page.
**Effort:** medium · **Risk:** high — damage scale is high (touches live user data: archived characters
remain playable in production right now) and damage likelihood is high (no automated gate catches this —
`engine-parity.html` doesn't cover cloud query shape, so it's pure reliance on someone noticing); ambiguity
is medium (the merge-vs-sync-fields choice on `listCharacters()`/`listMyCharacters()` is a low-stakes call,
not a genuine trade-off). Worst-of lands at high on damage scale/likelihood — **not eligible for
`/sweep-code-tasks`**, do this one manually.

```text
1. In `js/sync.js`, generalize `listCharacters()` and `listMyCharacters()` (currently near-duplicate
   whole-function copies — the second was added for the new "My Characters" page and diverged by adding
   `archived_at` to its select) into one function parameterized for owner-only/extra-columns, rather than
   keeping two copies that can drift again. At minimum, `archived_at` must reach every caller — including
   CharGen's and Live Sheet's existing "Load saved character" cloud-load menus.
2. In each of `tools/PACT-CharGen-Webtool.html` and `tools/PACT-Live-Char-Sheet.html`, use the returned
   `archived_at` to exclude (or visibly tag, DM's/player's call — default to excluding, matching how the
   new "My Characters" page already treats archived rows) archived characters from the load-menu list.
3. In `js/campaign.js`, add the archived-campaign filter to `listMyCampaigns()` itself (it currently only
   exists as a one-off local filter inside `tools/DM-Console.html`'s `loadCampaigns()`), so CharGen's own
   (currently unfiltered) campaign picker — confirmed via grep to call the same `listMyCampaigns()` — also
   stops leaking archived campaigns through as selectable rules-filter/binding targets. Remove the
   now-redundant local filter in `DM-Console.html`.
4. In `js/sync.js`, fix `archiveCharacter()`/`unarchiveCharacter()` to check the row count after the
   Supabase update (a zero-row-match UPDATE returns `error: null`, so a stale-tab race currently reports
   "Archived" success with nothing actually changed) — follow the existing `.select()` + length-check
   pattern this same file already uses in `pushCharacter()`.
5. In `tools/DM-Console.html`'s unarchive button markup, wrap the interpolated campaign `id` in `esc()` —
   currently only `c.name` is escaped, inconsistent with this codebase's hard `esc()` rule (AGENTS.md) even
   though campaign ids are server-generated UUIDs today (low exploitability, but a real deviation from the
   pattern `tools/characters.html`'s equivalent code already follows).
6. Log a `D-GH-2026-07-<DD>-archive-filter-parity` decision record if the merge-vs-sync-fields choice on
   step 1 needs a non-obvious *why* recorded (e.g. why one generalized function over keeping two synced
   copies).
```

**Done when:** archiving a character in "My Characters" makes it stop appearing in CharGen's and Live
Sheet's "Load saved character" menus; archiving a campaign makes it stop appearing in CharGen's campaign
picker; a two-tab archive race no longer reports false success; the DM Console unarchive button's campaign
id is escaped; `testing/tests/engine-parity.html` still 20/0 (display/filtering-only change — do NOT bump
`DATA.version`).

---

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

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

## Feature: Campaign join/invite UI (two onboarding paths) — TODO
Branch feat/campaign-join-flow. Wire up the missing player-facing UI for actually joining a campaign — `join_campaign()` exists as a tested SQL RPC but has zero production UI anywhere in the app today (confirmed 2026-07-11), and it only ever creates a blank character, with no path for an existing character to join.

```text
Two distinct onboarding paths, both needed:

PATH A — DM invites a brand-new player (no character yet):
- DM Console gets an "Invite new player" action that generates a single-use invite token, distinct from
  the existing shared campaign invite_code — this one is per-player and consumed on redemption (a second
  login can't reuse it).
- The invite carries two DM-set values at creation time: the initial AP award, and the origin AP
  cutover/budget the character must be built against (e.g. "Level 1, 50 AP") — this becomes the
  character's legitimate starting budget, so the fresh build the player creates against it can't be
  "illegal" (over-budget); there's no build to retroactively validate, only a budget to build within.
- Redeeming the invite (needs its own UI — likely in Live Sheet or a dedicated join screen) creates a
  brand-new character bound to the campaign, pre-loaded with that starting AP as a real award (reuse the
  existing award_ap()/ap_awards path, not a new AP mechanism).
- This likely needs a new SQL migration: a per-player invite token table (code, campaign_id, ap amount,
  origin budget, redeemed_by/redeemed_at, single-use enforcement) plus a SECURITY DEFINER RPC to redeem it
  — do not bolt this onto the existing shared `invite_code` column, which is intentionally a different,
  reusable mechanism.

PATH B — an existing player (with an already-built character) joins a campaign:
- A "Join campaign with existing character" action: the player picks one of their own already-built
  characters (full creation/purchase log) plus a campaign invite code.
- Validate the existing LOG against the target campaign's rules using the engine's existing `validate()`
  (js/engine.js) — do not reimplement rule-checking. Non-blocking: surface violations as warnings/flags
  for the player and DM to see, rather than refusing the join outright (matches how campaign-rule
  violations are already surfaced elsewhere in the app, e.g. CharGen/Live Sheet's live-filter warnings).
- This binds `campaign_id` on the EXISTING character record rather than creating a new blank one — the
  current `characters_insert` RLS policy forces `campaign_id is null` on direct insert and the UPDATE
  grant doesn't include `campaign_id` either, so this needs a new SECURITY DEFINER RPC (parallel to
  `join_campaign()`, but taking an existing character id instead of creating a blank row).
- Any AP already present on that existing character (i.e. anything in its own event log — the
  honor-system tier, see D-GH-2026-07-11-clone-campaign-character-standalone) stays exactly as-is and is
  NEVER reclassified as DM-Console-verified `ap`. The DM-Console `ap` running total (characters.ap) starts
  at 0 for the now-bound character, same as any other campaign character — only award_ap() ever sets it,
  never this import.

Given the data-model/RLS surface (new invite-token table, two new SECURITY DEFINER RPCs, campaign_id
binding on an existing row) and two new UI flows across two tools, this is a strong candidate for
/plan-for-review before implementation — a wrong approach here would be expensive to unwind.
```

**Done when:** a DM can invite a brand-new player and that player can build a character against the DM-set starting budget entirely through the UI; a player with an existing character can join a campaign through the UI, sees any rule violations flagged rather than being silently blocked, and keeps their existing AP as player-made; parity still 20/0.

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

## Retire the PACTRULES code + carry campaign rules via a LOG snapshot — TODO
Branch refactor/retire-pactrules-code. Remove the redundant local PACTRULES "campaign code" path from both tools and instead carry DM-authoritative campaign restrictions in the character's own event log. Full design: `docs/plans/2026-07-12-campaign-rules-snapshot.md`.

```text
The restriction MVP — bannedDrawbacks/bannedArts enforced via validate() and hidden from the pickers —
already shipped (PR #174, in CHANGELOG). This task is the remaining half:

(a) Retire the local PACTRULES "#3" path from BOTH tools + test fixtures:
    - remove b.campaign, the cat:'campaign' buy event + MUT.campaign mutator (js/engine.js),
      the _campEnc/_campDec PACTRULES codec, and the "House rules code / Campaign" UI in
      CharGen and Live Sheet;
    - drop any "campaign" entries from testing/fixtures/ (pre-launch, so existing cat:'campaign'
      events / shared PACTRULES codes going inert is acceptable — no real data to migrate).
(b) Carry campaign restrictions offline via a LOG rules-snapshot (same materialization pattern as
    the creation lock):
    - on bind + on each sync while online-in-a-campaign, the client writes/refreshes a rules-snapshot
      LOG event materialized from campaigns.rules;
    - add a resolveRules() that returns the LIVE cloud rules when online-in-a-campaign (authoritative,
      player can't touch them) else the LOG snapshot; point the existing validate()/cloudRuleBarred()
      call sites at it — do NOT reimplement any rule logic;
    - removing the snapshot (e.g. after leaving/cloning out of a campaign) is a logged LOG action, so
      it leaves an auditable trail.
Leave b.houseRules (#2, the DM-customisations / non-core toggle) completely untouched — it is a
different, engine-read feature.
Display/validation-only — validate()/cloudRuleBarred() are never read by compute(); do NOT bump
DATA.version, just log in CHANGELOG. Log the trust-boundary reasoning as
D-GH-2026-07-12-retire-pactrules-code in DECISIONS.md.
```

**Done when:** the PACTRULES "#3" code path is gone from both tools + fixtures; a bound character carries a refreshed rules snapshot in its LOG that applies offline and is overridden by live cloud rules when online; removing the snapshot is a logged action; `b.houseRules` (#2) is unaffected; parity still 20/0.

---

# ⚪ LATER — low-severity fixes + ideas (not scheduled)

**Low-severity review findings:**
- **REV-13** — Dead grant maps `grantSk/grantTl/grantIn` in `engine.js` (~:62) are never populated. Wire up
  or remove; don't change pricing without updating the REV-01 baseline in the same PR.
- **REV-14** — (optional, engine-targeted) Extract `DATA` into `engine-data.json`; split `compute()` into
  named sub-pricers. Only safe once REV-01 gives real assertions; dedicated PR, byte-identical output.

**Polish & hardening** (from the Task 5 audit session):
- **Real icons** — replace the placeholder 192/512/180 PNGs with real artwork (needs your art).
- **Pin/bundle supabase-js** — it's `@supabase/supabase-js@2` (major-pinned only); pin the exact version
  (or vendor a local copy) so a CDN minor update can't change offline behaviour.

**Landing-page follow-ups** (deferred from the redesign):
- Extend theming to the guide and tools (index-only today).
- "Continue / recent characters" on the landing page (needs the tools' save format).
- iOS "Add to Home Screen" hint (no `beforeinstallprompt` on iOS Safari).

**Supporting reference tasks** (run when needed):
- Supabase project setup · Icon & asset list (192/512/180) · Offline UX spec · Future-features roadmap.

**Improvements** (recommended action first; the *then* line is a lower-priority upgrade with its caveat):
- **A1 — Engine API contract.** Add a JSDoc block atop `js/engine.js` (signatures + one line per export) so
  agents grasp the API without reading 238 KB. *Then (optional):* a dev-only `engine.d.ts` for IDE
  autocomplete — *caveat:* a new format to maintain; can read as "TypeScript creeping in."
- **A3 — Client error visibility.** Add a global `onerror`/`unhandledrejection` handler logging to the
  console + a "Report issue" link in the footer. *Then (lower priority):* log errors to a Supabase table
  once sign-in is the default — *caveats:* extra write traffic + a privacy note to document.
- **A4 — DECISIONS.md index.** Add a one-line-per-decision index at the top + the rule "next code =
  highest + 1" (and fix the dup via CU-5). *Then (lower priority):* auto-generate the index — *caveat:*
  depends on AUD-1 existing.
- **A5 — Bulk "back up all characters."** Add a "Back up all" button → one JSON bundle, plus restore, so a
  localStorage user can't lose everything to a browser clear. *Then:* the Supabase migration supersedes it
  — *caveat:* keep the local backup until cloud sign-in is the default.
- **A6 — Tag releases to the build version.** `git tag v0.x` (matching `BUILD`) + a GitHub Release per
  ship, for a labelled rollback point. *Then (lighter alternative):* tags only, no notes — *caveat:* less
  context on what each release shipped.
- **A7 — Lighthouse 85 → 90.** Add a Lighthouse CI GitHub Action to auto-catch perf regressions. *Then
  (lower priority, higher risk):* split/lazy-load the engine (= REV-14) for the real score gain —
  *caveats:* a big engine change; do it only after REV-01 makes the gate real.
**Code-review follow-ups (from `feat/campaign-ap-model`)** — low-severity cleanup flagged by
`/code-review`, not fixed in that PR (low risk / negligible impact either way):

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

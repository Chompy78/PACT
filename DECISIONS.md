# PACT — Decisions (why it's built this way)

> Authoritative record of decisions **still in force**. One entry per decision:
> **Context → Options → Decision → Why → Status.** Newest at the TOP.
> `CHANGELOG.md` records *what* changed; this records *why*.

---

## D-GH4 · Data model: per-campaign non-exclusive roles, no player cap, ap locked at the column level
- **Context:** Task 3 needed the Supabase schema + RLS. The plan assumed a global Player/DM role, a 5-player
  cap, and "the characters UPDATE policy must exclude the [points] column from player writes." (The plan
  called the DM-awarded points "xp"; PACT's currency is **AP**, so the column is `ap` — see also the rename.)
- **Options (roles):** (i) global role flag on the profile; (ii) roles derived per-campaign from the
  relationship (DM = `campaigns.dm_id`; player = owning a character in that campaign), allowed to overlap
  even within one campaign.
- **Options (ap):** (i) a row policy / trigger that rejects ap changes; (ii) revoke blanket UPDATE and grant
  UPDATE only on player-writable columns, with a DM-only `award_ap()` SECURITY DEFINER RPC as the sole ap
  write path.
- **Decision:** per-campaign overlapping roles (no stored role column); **no player cap** (overrides the
  plan's "up to 5"); ap protected by a column-level GRANT plus `award_ap()`. Joining and code regeneration go
  through SECURITY DEFINER RPCs (`join_campaign`, `regenerate_invite_code`) so players never need broad read
  access to `campaigns`. Cross-table RLS checks live in SECURITY DEFINER helpers to avoid policy recursion.
- **Why:** the same person can run one table and play at another (or even play in their own game), which a
  global flag can't express. Postgres RLS can't scope an UPDATE to columns, so the column GRANT is the only
  airtight ap guard — a row policy would still let a player set ap in an otherwise-valid update.
- **Status:** IN FORCE. Plan doc (`docs/PWA-BUILD-PLAN.md` Task 4) still says "up to 5 players" and needs
  updating to match.

## D-GH3 · CharGen exports now match the Live Sheet's native event format
- **Context:** CharGen → Live Sheet exports were bundling itemized purchases into coarse patch events, so imported drawbacks could not be bought off and ledger entries were missing for individual purchases.
- **Options:** (i) keep the coarse patch export and patch the Live Sheet to infer itemized buys from patches; (ii) change the exporter to emit discrete native buy events for each itemized purchase while preserving the existing totals and ordering.
- **Decision:** (ii). The export now writes the same discrete buy events the Live Sheet would create when an item is bought natively, while keeping structural patches for scalar and blob-style fields.
- **Why:** imported characters should be indistinguishable from hand-built ones in the Live Sheet, including buy-off behavior, per-item ledger lines, and per-item cost drift.
- **Status:** IN FORCE.

## D-GH2 · Carry the changelog / decisions / narrative discipline into the GitHub repo
- **Context:** the pre-GitHub Cowork project kept a rich `CHANGELOG.md`, `DECISIONS.md`, and session
  narratives. The new GitHub repo had an architecture instructions file (`pact-agent-instructions.md`) but
  no logging discipline — so context would stop travelling between AI sessions.
- **Options:** (i) keep the logging notes only in Cowork; (ii) move the three logging docs into the repo and
  make the AI-agent instructions require updating them on every change.
- **Decision:** (ii). One master instructions file (`AGENTS.md`, copied to `CLAUDE.md` +
  `.github/copilot-instructions.md`) now carries BOTH the architecture/PWA plan AND a "log as you go" rule
  that points every agent at `CHANGELOG.md` / `DECISIONS.md` / `docs/sessions/`.
- **Why:** in-repo docs version with the code and show up in every diff/PR, so the discipline is enforced by
  review instead of memory; one master file copied to the tool-specific names means Copilot and Claude both
  follow identical rules without re-pasting context each session.
- **Status:** IN FORCE.

## D-GH1 · Repo layout: one shared `js/engine.js`, tools are UI-only, deploy via GitHub Pages
- **Context:** moving PACT from Cowork (engine inlined into each standalone HTML tool) to GitHub Pages.
- **Options:** (i) standalone single-file tools with the engine inlined in each; (ii) centralise the engine
  in one `js/engine.js` and have the tools import it via a module bridge; (iii) both.
- **Decision:** (ii) — `js/engine.js` is the single source of truth; `tools/*.html` import it; the site is
  served by GitHub Pages at `/PACT/`.
- **Why:** one engine to edit means the three tools can never silently diverge; Pages gives a free public
  URL. Trade-off: tools are no longer single-file/offline (the PWA task restores offline via a service worker).
- **Status:** IN FORCE.

## D-014 · PHB pages + drawback text are display data — fill them, keep `DATA.version` v0.322, bump build to v0.106
- **Context:** the long-standing open thread was "PHB page numbers + 69 drawback descriptions, awaiting John's source." John supplied a PHB-rules JSONL (`Feat`/`Equipment` entries carry a `page`) and the Players-Guide **v0.324** HTML (drawback table). On inspection the tools showed `drawbackFx` was **already fully populated** (69 strings) — the restart-status note was stale — and `masteryFx` already carried the effect text with `page:null`.
- **Options:** (i) treat the new guide as authoritative and **overwrite all 69** drawback strings; (ii) **reconcile** — diff the engine text against the guide and change only what differs; (iii) skip drawbacks (already filled) and only add pages. Also: whether to bump `DATA.version` to v0.324, and whether to bump the build counter.
- **Decision:** (ii) reconcile. Pages: `masteryFx[*].page`=214 (all 8, from the JSONL `Equipment` "(mastery)" rows) and `page` on **41/43** arts matched by name to the JSONL `Feat` rows (Blessed/Druidic Warrior absent → left page-less, no fabrication). Drawbacks: **53 already identical**, **10 synced** to the guide's fuller wording, **6 split `Affliction —` rows kept** (guide stores them as one combined row). `DATA.version` **stays v0.322**; build bumped **v0.105→v0.106**.
- **Why:** the 10 drawback diffs only *added* DEX/WIS cap clauses that `drawbackMaxStats` **already enforces** — so the change is display-only, not a rules/mechanics change, and bumping `DATA.version` (→ gate expectations in G4/G5) would misrepresent that. Overwriting all 69 (i) risked clobbering correct text with parse noise; reconciling is the minimal, auditable change. A build bump is the CONTEXT §6 convention for a significant build and keeps John's original v0.105 tar a distinct artifact. Surgical `JSON.stringify` round-trip replacement on `src/engine/data.js` (verified the serialization appears verbatim first) kept the diff to exactly the three sub-objects.
- **Status:** DONE (v0.106) — 46 gates green; G1 (build-check) + G3 (version-consistency) verify the bump is consistent. **One open question for John:** the 6 `Affliction —` entries have no cap clause in their text (caps still enforced via `drawbackMaxStats`); append "…capped at 10" to each for parity with the synced 10, or leave split-and-terse? Awaiting his call.

## D-013 · Outline labels never reset within a session (continue A→Z→AA, not restart at A1)
- **Context:** the INDEX "Output format (ALWAYS)" rule restarted the outline at A1/B1 at the top of **every** response, so a handle like "A1" was unique only *within one message* and collided across turns — the user could not reliably refer back to an item from an earlier reply ("I get confused as you reuse the A1, A2").
- **Options:** (i) per-response number prefix — stamp each reply, handles become `2A1`, `3B2`; (ii) **don't reset the capital letters** — keep climbing A…Z then AA, AB… across the whole session, item numbers reset within each group; (iii) topic/semantic group tags (`BUILD-1`, `FIXTURES-2`).
- **Decision:** (ii) — never reset the letters. Each response continues at the next free letter where the last one stopped; spreadsheet-style AA, AB… after Z; numbers reset to 1 inside each new group.
- **Why:** reuses the A1/A2 syntax the user already knows (no new prefix to learn) while making every handle globally unique for the life of the session, so "D2" addresses exactly one item. Per-prefix (i) was heavier to type/track; semantic tags (iii) can still collide when a topic recurs.
- **Status:** DONE — INDEX "Output format (ALWAYS)" updated. Style-only convention (not gate-enforceable — same class as the other prose-style rules, per D-005: gates verify version *strings*, not output *style*).

## D-012 · Character test fixtures — engine-verified generation (SPEC'D, not built)
- **Context:** need sample character files for GitHub testing.
- **Scope:** 1 empty character · 4 valid CharGen builds at **50 / 150 / 250 / 500 AP** (diverse archetypes, ~90–100% of budget) · 4 invalid builds (spread: **over-budget · missing-prereq · illegal-buy · cap/duplicate**) · the 4 valids re-expressed as **Live-Sheet histories** folding to the *identical* build · a manifest. Output: `tests/fixtures/samples/`. Stamp `rules:"v0.322"`.
- **Options:** hand-author the JSON · generate by driving the real engine.
- **Decision:** generate by driving the engine — `loadEngine` (from `scripts/headless.cjs`) → `foldBuild`/`setLOG`/`compute`/`economy`; price every buy via the marginal delta `compute(after).total − compute(before).total`; verify each file (legal + within budget for valids; the intended ⛔/over-budget for invalids); CharGen flavour = one award + bulk build, Live-Sheet flavour = multiple awards + granular buys folding to the same build.
- **Why:** AP pricing/legality is too complex to hand-write; engine-verification guarantees the fixtures actually load and validate. Files are `{rules,name,LOG,SEQ}` event logs (build is folded from the LOG).
- **Status:** CLOSED (v0.104) — **John authored the sample fixtures manually**, outside this record's engine-generation plan; no longer an action item. Record kept for the rationale (per D-003). *(Optional follow-up: the manual files can still be validated by loading them through the engine — `loadEngine` → `foldBuild`/`compute` — to confirm they load and price legally, which was the original reason for engine-generation.)*

## D-011 · GitHub hosting model — CLOSED (standalone single-file / offline)
- **Context:** project will be published to GitHub; want "a single DM section where DMs do everything".
- **Options:** (i) GitHub Pages site loading one shared `engine.js` (true on-disk dedup, online only); (ii) standalone single-file downloads (offline, what we have); (iii) both — `src/` as source, Pages for the live site + built single-file downloads for offline.
- **Decision (v0.104, CLOSED per John — "close permanently"):** commit to the **standalone single-file / offline model** (option ii) as the delivery format — the engine stays **inlined** in each tool via `src/engine/*.js` + `scripts/build.cjs` (already in place per D-009). Standing up a GitHub **Pages** site (i/iii) is **no longer an open blocker**: if ever wanted it is purely **additive** (a Pages front-end over the same `src/`) and does **not** change the offline downloads or reopen this question.
- **Why:** the offline single-file path is a hard constraint (`PACT-CONTEXT.md` §4.1 — runs from `file://`, no network/build step), so the delivery format was effectively forced; committing now unblocks the DM-console merge (D-010 / G2) without waiting on a publishing decision.
- **Status:** CLOSED (v0.104). Reversible only by a deliberate new decision if publishing requirements change.

## D-010 · DM consoles — merge into one "DM section" (DONE v0.105)
- **Context:** two consoles (CardGrid, DataTable) are the same tool, two layouts; user wants one DM home.
- **Options:** keep two files · merge into one console with a Card/Table toggle.
- **Decision:** merge — but as its own verified step, **not** folded into Option A.
- **Why:** it's a UI change needing visual QA (not a provable mechanical one); Option A already de-dups their engine, so the remaining win is product/UX, not tokens. Tied to D-011 (hosting → CLOSED single-file/offline).
- **Status:** DONE (v0.105). Merged into `dm-consoles/DM Console - Unified-v0.015.html` (CardGrid card view default + DataTable table view, topbar toggle, one shared engine/roster). The two originals were retired; John signed off ("I like the unified dm console"). integrity-audit **M6** now expects 1 console; build-check **G1** + 46 gates green.

## D-009 · Option A — single-source engine via in-place byte-identical build (not templates, not file-merge)
- **Context:** the engine (~238 KB) was duplicated byte-identical across 4 HTML tools; edits were hand-mirrored.
- **Options:** leave as-is · merge the two big tools · external `engine.js` via `<script src>` (breaks standalone) · templates + markers + build · in-place brace-match build that rewrites the engine block inside each tool.
- **Decision:** in-place build — `src/engine/*.js` is the source; `scripts/build.cjs` re-inlines it into each tool.
- **Why:** the first build is **provably byte-identical** (tools unchanged), so adoption was non-destructive and verifiable; tools stay standalone single files; reuses the existing brace-matcher; minimal churn. The engine stays physically inlined (standalone requirement) — dedup is at the *source/edit* level, not on disk.
- **Status:** DONE. Enforced by `build-check` (gate G1).

## D-008 · Don't merge CharGen + Live-Sheet
- **Context:** they're the two biggest files and share the engine.
- **Options:** merge into one build-to-play tool · keep separate.
- **Decision:** keep separate.
- **Why:** different jobs and different economic models (builder budget-meter vs in-play event log + frozen pricing); merging is a risky product change for a partial win. Option A is the better token fix.
- **Status:** DONE (decided). Could revisit only as a deliberate product goal.

## D-007 · Three-layer history docs + log-as-you-go
- **Context:** need to capture *why* and *discussion*, not just *what*, without bloating the changelog.
- **Options:** put reasoning in the changelog · separate docs per concern.
- **Decision:** CHANGELOG = *what* (condensed); `DECISIONS.md` = *why* (this file); `archive/sessions/` = *discussion/dead-ends* (history). Log substantive changes before finishing a session.
- **Why:** keeps the changelog scannable; makes "why is it this way" findable; matches the changelog's own "reasoning lives in archive/" note.
- **Status:** DONE.

## D-006 · Addressable test codes (A–G), not renamed test files
- **Context:** ~45 gates with domain names; user wanted to run them by short handle ("run test C3").
- **Options:** rename files to generic codes · add a code layer on top.
- **Decision:** code layer — keep the meaningful filenames; `audit-all.cjs` runs by code/group/`--list`; catalogue in `tests/TESTS.md`.
- **Why:** renaming loses the meaning that tells you what failed and risks breaking the suite; a lookup layer gives addressability with zero risk.
- **Status:** DONE.

## D-005 · Machine-checkable version marker + gates, because a doc can't watch itself
- **Context:** front-door docs can silently go stale (the v0.313/v0.309 note already had).
- **Options:** trust discipline · gate it.
- **Decision:** a `<!-- PACT-CURRENT … -->` marker checked against the tools by `version-consistency` (G3); plus `changelog-gate` (G6) for undocumented version bumps.
- **Why:** a gate can verify a version *string*; it can't verify prose *style* (that stays an instruction). Enforce what's enforceable.
- **Status:** DONE.

## D-004 · File types: prose = Markdown, flat tables = TSV, queried records = JSON
- **Context:** "should some docs be JSON/JSONL for efficiency?"
- **Decision:** keep prose in Markdown; tabular data in TSV (no repeated keys); nested records in JSON.
- **Why:** converting prose to JSON *adds* tokens and hurts readability; TSV is the leanest for tables. The project already split this way (prices = TSV, spells = JSON).
- **Status:** DONE (confirmed; no change needed).

## D-003 · Keep history (archive), don't delete
- **Context:** cleanup of stale/finished files (CHANGELOG, ki-audit, old restart sections, fuzz harness).
- **Decision:** move them to `archive/` (marked non-authoritative, never auto-read) — don't delete.
- **Why:** deletion is irreversible and loses rationale (e.g. the ki-audit's source-verified tagging); archiving removes the token cost without destroying the record. Originals also survive in the input tar.
- **Status:** DONE.

## D-002 · Many small single-purpose files + archived history, NOT a merged megafile
- **Context:** "can we combine the md files and stay token-efficient?"
- **Decision:** keep small focused files; move history out of the live read-path into `archive/`.
- **Why:** token cost = content *loaded*, not file count; small files let a session open only what it needs. Merging forces loading everything (or fragile anchors). Live read-path trimmed ~111 KB → ~32 KB.
- **Status:** DONE.

## D-001 · Front-door `INDEX.md` as the single entry point
- **Context:** a fresh session loaded too much (or the wrong/stale doc) to orient.
- **Decision:** one small `INDEX.md` read first — bootstrap line, read-order, file map, conventions; everything else subordinate and linked.
- **Why:** a session orients from ~8 KB instead of ~2 MB and is told what to open; the bootstrap line (or an auto-loaded pointer) is what makes a session actually read it.
- **Status:** DONE.

# Overnight round — phase 2b, the wallet warning (Q2) and the server freeze (D2/E1) — 2026-10-04 → 05

**Owner's instruction (paraphrased):** plan phase 2b, Q2 and the server freeze; do all of it without me, as best you can; use the cold-review API skill to check each plan; I want it all done when I get back.

## What was done

| Item | Result | Where |
|---|---|---|
| Cold-reviewed plans (3) | Each reviewed by two API models (`gemini-3.6-flash`, `openai/gpt-oss-120b`; they self-identified wrongly, logged by real id). One severe finding (how to classify patch events) also judged by a fresh no-context subagent. Triage written into each plan's *Review outcome*. | `docs/plans/2026-10-04-server-freeze-d2-e1.md`, `…-chargen-post-lock-2b-spellcasting.md`, `…-chargen-wallet-warning-q2.md`; reviews in `docs/sessions/cold-reviews/` |
| Phase 2b-1 | After the lock CharGen **refuses** edits to spellcasting, innate spells, martial binding, out-of-tradition cantrips and origin fields (instead of rewriting them in place). Found and fixed two real defects on the way (a repaint recursion; CharGen rewriting a locked campaign character's budget award on load). | #579, merged |
| Server freeze stage 1 (D2 + E1) | Migration + rollback written, rehearsed on Docker (36 attacks work today → 61/61 pass, rollback byte-identical; CI job `freeze-rehearsal`), replayed against 457 real saves, round-tripped through the real tools (0 differences). **NOT applied to the live database.** | #580, merged (files only) |
| Q2 step 1 | The Live Sheet's wallet / shortfall / trade-offer decision moved into the engine as `walletState`/`walletCheck`; 66,589-comparison gate against a frozen copy; Live Sheet behaviour unchanged (155-check economy gate). | #581, merged |
| Q2 step 2 | CharGen shows the same shortfall warning and §16 trade offer after the lock (DM gold + party window fetched at campaign resolve; unconfirmed figures are never silently zero; one aggregated confirm per edit; Cancel abandons the purchase as in the Live Sheet). | #582 |
| Board | Added `feat/server-freeze-apply` and `feat/chargen-2b2-traditions-diff`. The flaky random-quality gate is already tracked as `fix/random-fighter-int-priming`. | `docs/TASK_BOARD_NEXT.md` |

## Decisions taken on the owner's behalf (please overrule any you disagree with)

1. **Spellcasting after the lock is refused, not diffed (yet).** Both reviewers (Gemini strongly) recommended shipping the safe refusals first. 2b-1 does that; the real diff is the optional task `feat/chargen-2b2-traditions-diff`.
2. **`customProfs` (free-text proficiencies) is refused after the lock** — the Live Sheet has no equivalent; it is the DM's to add. (A correction to the earlier plan, which assumed it mapped to tools.)
3. **Server freeze is fail-closed on field names** with a *permanent* exempt list (appearance, houseRules, gold) and a *temporary* one (spellcasting, innate, martial binding, dabbler cantrips, species, origin classes, size, lineage) that stage 2 deletes. Cold reviewers + the judge agreed.
4. **Q2: Cancel at the trade-offer box abandons the purchase** (the Live Sheet's rule). My first port continued at the list price; the head-to-head test caught it.
5. **Q2: one shortfall confirm per edit**, trade offers per step against a running wallet; all-or-nothing.
6. **Feature PRs were merged into `preview` on green CI**, as in the rest of this session. **Nothing was promoted to `main`.**

## Deliberately NOT done (the only things waiting on the owner)

- **Applying the server freeze to the live database.** It is a live security boundary on every campaign character save; a wrong rule refuses honest saves, and a cached older client would see "locked character history… reload". It should come *after* promoting `preview` → `main` (so shipped clients include #579 and the refusals). Everything needed is on the board as `feat/server-freeze-apply`, with the rollback ready.
- **Promoting `preview` → `main`.** A release decision; `preview` now carries #579, #580 (files only), #581, #582 (once merged) on top of v1.577.

## Findings worth knowing

- **The audit found a real client defect before the freeze could hurt anyone:** opening a locked campaign character that began in the Live Sheet moved its "Imported budget" award from index 0 to the end and added a name event — an honest save the freeze would have refused. Fixed in #579.
- **Backup replay:** 573 saved states → 457 real saves; the new rule refuses 24 the old one allowed; all 24 are history rewrites after a lock (in-place edits, rebuilt/reordered logs by the old "rebuild from form" bug, and four admin repair writes of 2026-10-04). None is a flow the current clients make.
- **Threat model made explicit:** the client stamps its own AP costs and the server cannot re-price, so the freeze protects against accidents and stale copies, not a determined cheater who appends free purchases.
- **Harness gotchas:** the browser tests need Playwright from `testing/node_modules` (a fresh worktree needs a symlink); the Groq free tier has an 8,000 tokens/minute cap (run reviews one at a time); OpenRouter's free tier refused these requests.
- **Squash titles:** the squash commit for #576 on `preview` kept an out-of-date "wip … still red" title; the PR, CHANGELOG and plan describe it correctly.
- **Stale board entry:** `feat/server-freeze-at-lock` is superseded by `feat/server-freeze-apply` for what remains (the skill only appends; it was not edited by hand).

## Questions for the owner

1. **Apply the freeze?** If yes: promote first, then the steps on the board; stage 2 can follow once 2b-1 is live.
2. **Is phase 2b-2 (buying spells in CharGen after the lock) worth the risk,** or is "spellcasting is Live-Sheet-only after the lock" good enough? The reviewers leaned to the latter.
3. **Promote now?** Everything on `preview` has passed CI and local audits.
4. Is refusing free-text custom proficiencies after the lock acceptable (DM adds them)?

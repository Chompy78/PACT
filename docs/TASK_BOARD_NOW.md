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

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

## Attunement/Ki/Sorcery points go free — or refund AP — past the end of their price tables — TODO
Branch `fix/uncapped-ladder-clamp`. Found in the 2026-08-22 full-tool audit. `js/engine.js:269` (Attunement)
and `:428/:431` (Ki, Sorcery) price via `DATA.table[n] || 0`. All three tracks are deliberately uncapped by
design (no HD gate), so nothing stops a player buying past the table's last index — `attune` has 13
entries, `kiCum` 25, `sorcCum` 21. Once the index runs past the end, the lookup falls through to `0`, and
because none of the three are in Live Sheet's `_CTX_PRICERS` special-case list, their marginal cost is a
whole-build `compute()` delta — which goes **negative** the moment the boundary is crossed. Verified by
executing the shipped engine directly: `attune 12→13: −180 AP` (refund), `attune 13→14: 0 AP` (free),
`ki 24→25: −156 AP`, `sorcery 20→21: −90 AP`. Reachable purely by clicking Live Sheet's existing "buy the
next one" buttons repeatedly — no LOG editing needed. Ki has no HD gate and a 25-entry table, so this is
plausibly hit in ordinary long high-level play, not a contrived edge case. CharGen isn't exposed (its
dropdowns are hard-capped within table bounds).

**Effort:** medium · **Risk:** medium — ambiguity is low (the fix pattern already exists in this file:
Grit was rewritten as `_gritPrice(n)=2*n` for exactly this reason, and `unlockCum` already uses an
index-clamp with a comment stating the lesson: "a clamp under-charges at worst; `|| 0` paid the player");
damage scale is medium (touches `js/engine.js`, the single source of truth, and changes `compute()` output
for any build that already bought past a table boundary — though only the *marginal* price of NEW
purchases past the bound changes, frozen ledger entries on existing characters are unaffected); damage
likelihood is low once fixed (closes a live, currently-exploitable gap). **Bundle with the other engine
findings below (`fix/engine-pricing-edge-cases` is the suggested combined branch)** — all four touch
`compute()`/`activeEvents()` and should share one `DATA.version` bump and one `testing/expected/` update
rather than four separate ones.

```text
1. Prefer clamping the lookup index to the table's last valid entry (DATA.attune[Math.min(attune,
   DATA.attune.length-1)], same pattern as unlockCum) over a closed-form formula rewrite — lower risk,
   smaller diff, and these three ladders don't have Grit's "designed to grow past today's table" framing.
2. Apply the same clamp to kiCum and sorcCum.
3. Add a parity fixture per track: buy one past the table's last entry, assert compute() total does NOT
   decrease and the marginal cost of that purchase is the table's LAST entry's per-unit cost (or 0 if the
   ladder is meant to plateau — decide and record which).
4. This changes compute() output only for previously-out-of-bounds states — bump DATA.version and update
   testing/expected/ in the same PR (per AGENTS.md, any compute() output change requires this).
5. Note in DECISIONS.md whether this is a "mechanics change" requiring a Players Guide update — it isn't:
   the intended rule (uncapped-by-design) doesn't change, only the engine's enforcement of the existing
   table-boundary behavior is fixed. Say so explicitly so a future session doesn't chase a guide edit that
   isn't needed.
```

**Done when:** buying past any of the three tracks' table bounds no longer produces a negative or
zero-cost purchase; a parity fixture pins the boundary case for all three; `DATA.version` bumped and
`testing/expected/` updated; engine-parity 0 failed; `DECISIONS.md` records the guide-non-impact finding.

## compute() has no upper bound on ability scores — an out-of-range score reduces AP cost — TODO
Branch `fix/engine-pricing-edge-cases` (bundle with the task above). `js/engine.js:219-220` warns when a
score is below 6 but has no equivalent check or clamp above 20 (`DATA.ABIL` only defines keys 2-20).
Verified: a build with STR 25 costs **40 AP less** than one with a legitimately-bought STR 20, while
giving a strictly better modifier (+7 vs +5). Not reachable through CharGen's shipped stepper (hard-capped
2-20) — but reachable by anything that trusts `compute()` directly: a hand-edited save, DM Console's edit
path, a reloaded tampered file. Live Sheet's own buy-panel pricer already clamps at 20 for its own
purposes — proof the hazard is known, just never closed at the source.

**Effort:** low · **Risk:** low — ambiguity is low (clamp to [2,20], symmetric to the existing below-6
warning); damage scale is low (only affects already-out-of-spec builds, not reachable through any shipped
tool's UI today); damage likelihood is low.

```text
1. Clamp st[a] (and the DATA.ABIL lookup) to [2,20] inside compute() itself.
2. Add a warning symmetrical to the existing "below the normal floor of 6" one for scores above 20.
3. Parity fixture: a build with an out-of-range score prices identically to the same build clamped to 20.
4. Bundle the DATA.version bump/testing/expected update with the other engine findings in this branch.
```

**Done when:** an out-of-range ability score can no longer reduce AP cost below what the clamped score
would cost; a parity fixture pins it; covered by the same version bump as the rest of this branch.

## Live Sheet's cloud-save "over budget?" gate re-prices at today's rules instead of the frozen ledger — TODO
Branch `fix/livesheet-budget-gate-frozen-ledger`. `tools/PACT-Live-Char-Sheet.html:657-661` (autosave gate)
and `:2774-2783` (manual "Save to cloud" button) both gate on
`compute(foldBuild(null), _dmOpts()).remaining < 0` — which re-prices every owned item against TODAY's
`DATA` tables. Every other AP-left display in this file correctly reads the frozen ledger
(`economy(idx).spent`) instead. A routine price-table change after a purchase was frozen can push
`compute().remaining` negative even though the frozen ledger never went over budget: the debounced
autosave silently stops pushing (warns once per session, silent every cycle after), and the manual save
button shows a scary "⛔ N AP over budget" message contradicting the non-negative number in the header. A
price *decrease* runs the bug in reverse, silently bypassing a DM's budget enforcement. `enforceApBudget`
defaults to enforced, so this reaches every campaign-bound character by default.

**Effort:** low · **Risk:** low — ambiguity is low (swap to the same frozen-ledger formula already used
everywhere else in this file — `_apRemaining(compute(...).spendable, economy(null).spent) < 0`, using
functions already defined here); damage scale is low (display/gate logic only, no LOG/compute() change);
damage likelihood is low (the correct pattern is already proven correct at every other call site in the
same file).

```text
1. Replace both call sites (:657-661, :2774-2783) with _apRemaining(compute(foldBuild(null),
   _dmOpts()).spendable, economy(null).spent) < 0.
2. This is the same underlying question as the open feat/ap-model-reconcile item (NEXT board) — note the
   cross-reference in DECISIONS.md but don't block this fix on that item; it's independently fixable today.
3. tool-pricing-ci.mjs: add a case where a price-table change after freeze does NOT trip the budget gate
   for a character whose frozen ledger is within budget.
```

**Done when:** both gate sites use the frozen-ledger formula; a regression case proves a post-freeze price
change no longer trips (or bypasses) the gate; tool-pricing-ci.mjs 0 failed.

## Importing a JSON file into Live Sheet has no confirmation before it replaces the current character — TODO
Branch `fix/livesheet-import-confirm`. `tools/PACT-Live-Char-Sheet.html:360` (file input),
`:1181-1190` (`importJSON()`). Immediately overwrites `LOG`/`SEQ`, clears `REDO`, and saves — no
`confirm()`, unlike `resetAll()` which does confirm. A misclick or wrong file silently and irrecoverably
replaces the in-progress character; a pending cloud autosave (plausible given the 3s debounce) is lost
with nothing to recover it from.

**Effort:** low · **Risk:** low — a `confirm()` addition matching an existing pattern in the same file.

```text
1. Add confirm('Import will replace your current character and its history. Continue?') before the
   LOG=d.LOG assignment in importJSON(), mirroring resetAll()'s existing pattern.
```

**Done when:** importing a JSON file prompts for confirmation before replacing the current character;
declining leaves the current character untouched.

## DM Console roster card shows stale AP left / Level after awarding AP or gold alone — TODO
Branch `fix/dm-console-roster-award-staleness`. `tools/DM-Console.html:2313-2354` vs `:2159-2162`,
`:1635-1683`. The award handler patches `entry.dm.ap` directly and only triggers a full roster reload when
a bonus-days value was also entered; otherwise it repaints from the existing (now-stale) `summary` object.
The card's prominent "AP left" stat and Level badge both read from that stale `summary`, not `dm.ap` — only
the DM-tools panel's "DM-granted AP" sub-row updates correctly. A DM awarding just AP or gold (the common
case) sees the right number buried in a sub-panel and the wrong number at the top of the card until the
next full refresh.

**Effort:** low · **Risk:** low — either re-run `cloudAnalyze` on the one affected row, or simplify by
calling `window._dmReloadRoster()` unconditionally instead of branching on whether bonus days were
entered; a slightly heavier refresh in exchange for a card that's never wrong.

```text
1. In the award success handler, call window._dmReloadRoster() unconditionally (drop the bonus!==0
   branch), or re-run cloudAnalyze() on just the awarded row if avoiding the full reload is worth the
   extra complexity — default to the simpler unconditional-reload fix unless it's measurably slow.
```

**Done when:** awarding AP or gold alone (no bonus days) immediately shows the correct "AP left" and Level
on the roster card, not just in the DM-tools sub-panel.

## DM Console's party-wide downtime declaration has no confirmation despite being destructive — TODO
Branch `fix/dm-console-downtime-confirm`. `tools/DM-Console.html:2556-2571`. The code's own comment states
a bonus granted under the old window is wiped by this call, campaign-wide, not banked. Every other
setting with comparable blast radius in this file (ignore-player-AP toggle, enforce-budget toggle, campaign
archive) has a `confirm()`; this one's only guard blocks an empty field, not a mistaken value. A fat-
fingered "30" instead of "3" silently discards every character's unspent downtime with one click.

**Effort:** low · **Risk:** low — a `confirm()` addition matching an existing pattern in the same file.

```text
1. Add a confirm() before B.declareDowntime(...), reusing the explanatory copy already in the surrounding
   help text ("unspent time from the last window is gone, not banked").
```

**Done when:** declaring a new party downtime window prompts for confirmation naming the consequence;
declining leaves the existing window untouched.

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

## The creation lock un-fires on every reload — a CharGen character can never stay locked — TODO
Branch `fix/creation-lock-survives-reload`. Reported by the owner ("the higher character generation lock
doesn't seem to fire in solo mode"). Measured in a real browser 2026-08-05, fresh solo CharGen character,
default 79 AP threshold:

| step | `economy().spent` | lock fired? | `noLock` events |
|---|---:|---|---|
| fresh boot | 0 | no | 8 of 9 |
| three stats to 20 | 120 | **yes** | 8 of 11 |
| HD 9, Vigor 5, Grit 10 | 382 | **yes** | 8 of 13 |
| **after a reload** | 382 | **NO** | 10 of 11 |

So it is not that the lock never fires — it fires, and then a reload launders it away.

**Cause.** `_buildEventBurst` tags every event it emits `noLock:true` (the `const ev=o=>{…o.noLock=true;…}`
line in `tools/PACT-CharGen-Webtool.html`), and `_replay` only accumulates the lock's spend counter for
events *without* that tag (`js/engine.js`: `else if (!e.noLock) _spent += _spendCost(e)`).
`replaceWholeLogFromBuild()` regenerates the ENTIRE log through that burst on boot / load /
autosave-restore, so after any reload the lock-relevant spend is ~0 again — while `economy().spent` still
reports the real figure. The two deliberately disagree, and only one drives the lock.

**Why the tagging exists — do not simply delete it.** D-GH34: a synthetic import burst is a whole finished
character fabricated in one pass, not an editing history, and a character who legitimately *starts* above
level 1 can exceed the anchor without creation being over. Blanket-tagging stopped imports self-triggering
the lock. The defect is that the same mechanism also erases a lock that had genuinely fired.

**This is a retroactive-unlock hole** — the exact hazard D4 guards against
(`decisions/2026/D-GH-2026-08-05-pricing-model.md`), reached by a different route: not by moving a config
event, but by re-tagging every purchase on reload. Post-lock prices are meant to be frozen and dearer;
laundering back to draft makes them cheap again.

**Effort:** medium · **Risk:** high — ambiguity is high (it needs a rules answer about what ends creation
for a character who legitimately starts at level 5, which is what D-GH34 was protecting); damage scale
medium (tool/engine interaction, no data loss); damage likelihood medium. Not sweep-eligible.

```text
1. ANSWERED by the owner 2026-08-05 - see "Split starting AP into creation AP + awarded AP" below, which
   supersedes the three candidates originally listed here. Creation AP stays the DEFAULT figure and is
   what the lock measures; anything above it is awarded AP. Build that first: it removes the reason the
   noLock blanket-tagging exists, so this bug goes away rather than being patched.
2. Do NOT persist a fired lock as an event as a shortcut - that conflicts with D5, where the automatic
   lock is deliberately DERIVED and reversible so undo can un-fire it. The split above keeps that intact.
3. Whatever is chosen, add the reload case to testing/scripts/tool-pricing-ci.mjs: a character taken past
   its threshold must still read as locked after replaceWholeLogFromBuild() has run. That one assertion
   is the whole gap.
4. While here: nothing tells the player the lock HAS fired. The "Creation AP not confirmed" notice clears
   at exactly that moment (by design), so the only signal is prices quietly getting dearer. Consider a
   short positive notice - "creation pricing has ended" - so the transition is legible.
5. engine-parity must stay 26/0. If compute() output moves, update testing/expected/ and bump
   DATA.version in the same PR.
```

**Done when:** a character taken past its creation threshold is still locked after a reload, the rules
answer for above-level-1 starts is recorded under `decisions/2026/`, a gate asserts the reload case, and
engine-parity still reports 26/0.

## Split starting AP into creation AP + awarded AP (and fix CharGen's clunky budget entry) — TODO
Branch `feat/creation-vs-awarded-ap`. Owner's design, 2026-08-05. **Do this before
`fix/creation-lock-survives-reload`** — it removes that bug's cause instead of patching it.

**The idea.** A character's starting AP is currently one number, and the creation lock measures against a
flat `DATA.level1AP` (79). Those should be two different things:

- **Creation AP** — the default figure for the chosen track (Standard 79, Generous 83, Lean 75, Level-0
  prelude 55, or custom). This is what the creation lock measures, and creation prices and warnings apply
  while spending it.
- **Awarded AP** — everything above that. Treated exactly like DM-awarded AP in the Live Sheet: it is
  post-creation, so it buys at post-lock prices.

So a 5th-level starting character is given their full starting AP however the DM sets it, spends the first
~79 under creation pricing with the usual warnings, and the remainder behaves as awards. That is the
correct shape: a character who begins at level 5 has, in rules terms, already advanced.

**Why it matters beyond tidiness.** `_buildEventBurst` blanket-tags every event `noLock:true` purely so a
high-budget starting character isn't instantly locked (D-GH34). With the split, that reason disappears —
creation AP is always the default, so the threshold is never wrong — and with it goes the reload-unlock
bug: see `fix/creation-lock-survives-reload` above, where a reload currently launders a locked character
back to draft.

**Two UI pieces:**
1. **CharGen has no awarded-AP entry at all.** The Live Sheet does (`award()`, which appends a `type:'award'`
   event). CharGen needs the equivalent so a DM or player can set the extra AP on a starting character.
2. **CharGen's budget control is a dropdown and is clunky** (owner). Replace it with a plainer entry — a
   number field, or a track picker plus a number, so a custom figure doesn't mean hunting a list.

**Effort:** medium · **Risk:** medium — ambiguity medium (the split is decided, but where the boundary is
recorded in the LOG is an open design call); damage scale medium (touches the award/budget model both
tools read); damage likelihood low (parity + tool-pricing gates cover the numbers). Not sweep-eligible.

```text
1. Decide how the split is RECORDED before writing UI. The LOG already carries `award` events and
   `creationLockConfig{threshold}`. Natural shape: creation AP is the threshold (already an event, already
   append-only per D4), and awarded AP is one or more ordinary `award` events. Check that against how
   economy() computes earned/spent, and write the answer into
   decisions/2026/D-GH-2026-08-05-pricing-model.md as an amendment - it changes D3.
2. CharGen: add an awarded-AP entry mirroring the Live Sheet's award(). Route it through the LOG-mutation
   API (emit), not a DOM shim - readBuild() is foldBuild(LOG) since the Chunk 6 flip.
3. CharGen: replace the budget dropdown with a number entry (keep the track presets reachable - they feed
   DATA.levelBudgetCurves and the creation-AP confirm prompt already reads them).
4. Once creation AP is always the default, REMOVE the blanket noLock tagging in _buildEventBurst and
   confirm the D-GH34 case it protected is still safe: an imported higher-budget character must not
   self-trigger the lock on its own total. That is the whole point of doing this task first.
5. Gate it in testing/scripts/tool-pricing-ci.mjs: a character with creation AP 79 + 170 awarded must show
   creation pricing for the first 79 and post-lock pricing after, AND still be locked after a reload.
6. engine-parity must stay 26/0. If compute() output moves, update testing/expected/ and bump DATA.version
   in the same PR.
```

**Done when:** starting AP is split into creation AP and awarded AP, CharGen can set both, its budget
control is no longer a dropdown, a 5th-level starting character gets creation pricing only for the
creation-AP portion, the lock survives a reload, and engine-parity still reports 26/0.

---

> **Format note (2026-07-28):** split from a single `docs/TASK_BOARD.md` into `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by the existing NOW/NEXT/LATER bands — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`. Same rules apply to all three files.

---

# 🔴 NOW — high-severity fixes + cleanup

## epicBoonAbil is silently dropped on a CharGen round-trip — TODO
Branch `fix/chargen-preserve-epicboonabil`. Found while auditing the pricing model
(`decisions/2026/D-GH-2026-08-05-pricing-model.md`); unrelated to it. Filed NOW because it is silent
data loss on a supported path, not a display bug.
**Effort:** low · **Risk:** low — ambiguity low (one obviously-right fix: carry the field through the
two places that already carry its siblings); damage scale low (one field on one character); damage
likelihood low (additive, and the parity gate plus a round-trip fixture check it) — worst-of lands at low.

```text
1. Only the Live Sheet ever SETS epicBoonAbil, via the `names` event (tools/PACT-Live-Char-Sheet.html
   :1499-1509), applied by MUT.names (js/engine.js:485).
2. CharGen never reads it: _domReadBuild() has no such field, and CG_NAMES (tools/PACT-CharGen-Webtool
   .html:2842) is built as {dab,inn,feat,lang,grants,tr} with no `eb`. So the `names` event emitted by
   _buildEventBurst omits it, and replaceWholeLogFromBuild() rebuilds a log without it.
3. Net: open a Live-Sheet character with epic boons in CharGen and its ability choices vanish. The
   character then permanently shows "<boon>: choose an ability to raise (+2)" (js/engine.js:110).
4. Fix: carry epicBoonAbil through _domReadBuild() and CG_NAMES so a round-trip preserves it. It is a
   display/entitlement field, not a price — compute() reads it only via the stat bump at :110.
5. DATA.version does NOT move (no rules or compute() change).
```
**Done when:** a Live-Sheet character with epicBoonAbil set is opened in CharGen, saved, reopened in the
Live Sheet, and still has its ability choices; a fixture covers the round-trip; engine-parity 24/0.


# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

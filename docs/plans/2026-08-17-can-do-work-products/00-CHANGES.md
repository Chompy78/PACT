# What changed in this revision — and what deliberately didn't

You asked me to go through the two earlier zips and see if anything could be done
better. This file is the audit trail. Short version: the analysis held up well on a
re-read against the source boards; the improvements are **one accuracy correction**,
**one self-containment gap**, and **traceability** — not a rewrite.

## Changed

### 1. Accuracy correction — the empty NOW board (the important one)
On re-reading the *actual* `TASK_BOARD_NOW.md`, it is **empty** (header + conventions,
zero tasks). My first pass took the NEXT/LATER cross-references at face value and
stated three `(NOW)` tasks — `fix/buyoff-keyed-by-event`,
`fix/optimistic-character-save`, `fix/harden-invitation-system` — as **settled hard
blockers that "must land first"**. That was overconfident: none of the three is an
open NOW task, and none is in any board's completed-work list, so their status is
**indeterminate from the files provided**.

- **New file `00-BLOCKER-REGISTER.md`** documents the discrepancy, both
  interpretations (done → dependents unblocked; missing → board gap), and the exact
  `grep`/`git branch` check to resolve it.
- **Caveat banners added** to the four files that leaned on those blockers: `02`
  (dm-edit-events decision), `20` (character-log-merge cold-plan), `30` (dm-edit-events
  code approach), `60` (invite-rate-limiting). Each now points to the register instead
  of asserting the prerequisite as fact.

*Why this matters:* if those three are actually done, **`feat/dm-edit-events` and
`feat/character-log-merge` are unblocked now** — a materially different schedule than
my first pass implied.

### 2. Self-containment — folded the "can't do" bucket into the zip
The 🔴 can't-do list previously lived only in the chat message. It's now a table in
`00-BLOCKER-REGISTER.md` (task → hard blocker → what unblocks it), so the zip is a
complete picture on its own.

### 3. Traceability
- Added this `00-CHANGES.md`.
- Added a dependency-chain diagram + a single file→task index (in the register), so
  both zips are navigable from one page.

## Deliberately NOT changed (and why)

- **`01` drawback-ap-double-count, `03` campaign-ap-budget spec, `04` pace-curve
  pack** — re-checked line-by-line against the task text; every figure and site
  traces correctly. No change needed; editing for its own sake would risk drift.
- **The recommendations in `10`** (add-player default = Players code;
  unnamed-default = store-blank; invite-peek = anon-callable) — still stand on
  re-examination; each already carries its reasoning and a DECISIONS.md stub.
- **The AP-cluster sequencing in `50`** — unchanged; it follows the task text's own
  "settle X once, here" instructions.
- **No line numbers were "corrected."** I don't have the repo, so every `~:NNN`
  pointer is quoted from the task text as-is — inventing precision I can't verify
  would be worse than leaving the board's own pointers intact. The docs already say
  "re-grep before editing".

## Net effect
Same substance, one real correction (NOW-board status), and now self-contained +
auditable. If the `grep` in the register shows those three tasks are done, tell me
and I'll re-issue the affected sequencing notes as "unblocked, start now."

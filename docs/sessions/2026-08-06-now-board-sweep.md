# 2026-08-06 — clearing the 🔴 NOW board, and what two sessions running at once actually costs

Shipped: six NOW items, two promotions (`v1.367`, `v1.376`), four tasks filed. The interesting parts
aren't the fixes — they're the three places where the *stated* problem and the *real* problem differed,
and the two collisions with a second agent session working the same board.

## The task board was wrong twice, in opposite directions

**`fix/campaign-binding-survives-reload` blamed the wrong side.** Its finding 1 said `save()` doesn't pass
`campaignId`, marked it "almost certainly the refresh bug", and laid it out in a table. `save()` has
passed it since **PR #312**. The real defect was on the *load* side: `load()` calls
`_lsResetCloudApState()` (nulling `_lsCampaignId`) and then restores `LOG`, `SEQ`, `rules` and `__charId`
— but never `d.campaignId`. The envelope carried the binding all along; the restore threw it away.

The lesson isn't "the board lies". It's that a code-level diagnosis written without running anything is a
*hypothesis*, and this one was confident enough to look like a finding. Checking it cost two minutes.

**`feat/creation-vs-awarded-ap` asked for work that was already done.** Its remaining half wanted
per-portion pricing inside a build — the first 79 AP at creation prices, the rest post-lock. Measuring
first showed interactive building *already* does exactly that: `emit()` doesn't tag `noLock`, so every
click appends in real order and the lock lands where cumulative spend actually crossed the threshold.
It survives a native save/load too. What remained was only the paths where a character arrives whole, and
for those there is no purchase order to record — the information does not exist. "Give the burst a real
purchase sequence" wasn't hard there, it was impossible.

## The creation lock: both mechanisms were dead

The owner reported the lock "doesn't seem to fire". It never could. The engine has two paths and CharGen
had neither:

- **automatic** (`_spent > threshold`) — suppressed, because `_buildEventBurst` tags every event
  `noLock:true`. That tagging is the D-GH34 fix and had to stay.
- **explicit** (`creationLocked`) — `js/engine.js:671` calls it *"the primary intended trigger"*, and
  **no tool had ever emitted one**. CharGen's only mention of it was inside a comment.

The board's step 4 said to remove the `noLock` tagging. That would have reopened D-GH34: the burst's order
is synthetic, so the lock would land at an arbitrary point inside it. The owner chose H2 — record the lock
as an event — which sidesteps the ordering question entirely. Measured on an imported over-budget
character: lock is the **last** event, 12 buys before it, 0 after, racial traits still pre-lock.

**And it immediately exposed a regression of its own.** Recording the lock as an event only helps if
nothing discards the event. `restoreFrame()` (undo/redo) rebuilds the LOG from the DOM by design under
**D5** — and the DOM has no control representing a `creationLocked`. So one undo un-locked a locked
character. Worse, an undo→redo round-trip moved the creation boundary from 4 purchases to 6, silently
re-pricing two purchases at creation rates. Found only because the owner asked *"is this whole issue just
for randomise characters?"* — a question about scope that turned into a bug report.

## Two collisions with the other session

**One duplicated task.** While building `fix/buyoff-keyed-by-event` — engine change, fixture, gate
assertions, decision record, the lot — the other session shipped the same fix and merged it to `preview`.
My push was rejected, which is the *only* reason I found out. I read their implementation, verified it
independently (back-compat byte-identical, retake works, gates green) and deleted mine. Theirs keys on
array position with FIFO matching and argues, correctly, that fixtures carry no `seq`.

**One promotion.** After explaining to the owner exactly what promoting `preview` → `main` would take, the
other session did it — PR #376 — between that message and the command to proceed.

Neither caused damage. Both wasted work, and the second made me look like I didn't know the repo's state.

The root cause is structural: **both sessions are assigned the branch `claude/get-ready-i52ojw`.**
`AGENTS.md` relies on "one task per branch — the open branch is the in-flight signal" for coordination,
and that signal cannot work when two agents share one branch name. The task board can't substitute: the
other session graduated the buy-off entry as it merged, but I'd read the board before that.

## The stop hook was wrong three times, and once dangerously

`~/.claude/stop-hook-git-check.sh` compares the local branch to its upstream and says "push these". In a
workflow that merges each PR into `preview` and continues *from* `preview`, the feature-branch ref lags by
exactly the merge commit — so it fires on commits that are already on the remote.

Twice that was harmless. The third time, the local branch shared a name with **PR #374's head**, and the
remote held two commits the local didn't: the unmerged sync guard and undo fix. Pushing to satisfy the
hook would have destroyed them. Git would have rejected it as non-fast-forward — and forcing past that
rejection is exactly how work gets lost.

Every time, the check that settled it was `git merge-base --is-ancestor HEAD origin/preview`.

## What got left, and why

- **`fix/optimistic-character-save`** (PR #374) — written, not merged. No automated gate can reach a
  signed-in Supabase session, and a wrong save guard either keeps destroying characters or stops sync
  entirely. It needs a ten-minute two-tab check that only the owner can run.
- **`feat/randomize-emits-in-order`** — filed rather than built. The owner picked E2 (undo fix *plus*
  randomize); I did the undo fix and filed randomize, because it means mapping ~30 mutator lambdas to
  event shapes and I wasn't going to hold a live regression fix behind that refactor.
- **`feat/dm-creation-lock`** — the owner's scoping ("cloud characters in a campaign") dissolved its open
  question rather than answering it. A DM lock only exists where there's a DM, campaigns are cloud, and a
  cloud row is server-mediated — so it can be genuinely enforced in RLS rather than honoured by the
  client. Risk re-rated medium → high accordingly.

## One process fix landed

The owner asked why the A/B/A1/A2 convention keeps getting lost. It wasn't lost — `AGENTS.md` is
auto-imported every session. The failure is narrower: the format gets applied to things *shaped like a
question* and dropped from things *shaped like a status report*. `AGENTS.md` now names that trap
explicitly, and says letters run for the whole session. Same reasoning as `H-039` in `ai-lessons-learned`:
when a written preference keeps slipping, repetition isn't the fix — making the trigger unmissable is.

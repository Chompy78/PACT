# "Finish creating" missing for a campaign character — a note, and the phone button CharGen never had — 2026-10-11

**Owner's decisions this session:** A2 (tell the player why the button is missing), B1 (fix CharGen's phone toolbar in the same PR), C1 (merge after B), D2 (allow agents to run `gh pr merge`), E1 (clean up the branch and worktree).

## The question was "how do I trigger the lock", the answer was "there is no limit"
The owner could not find how to end creation for **Wren Ch4 end**, expecting a lock at 82 AP plus drawbacks. Read-only check of the live row: the log holds `creationLockConfig{auto:true}` (CharGen's default arming), then `creationLockConfig{threshold:null}` labelled "Creation limit cleared - joined a campaign", stamped by the server trigger `pact_campaign_move_clears_creation`. With no threshold, `creationCeiling().enforced` is false, and both player tools hide **✔ Finish creating** without a word. Nothing was broken; the DM simply had to set the limit (DM Console → Creation limit → Set limit, entering 82 only, since the drawback grant is added live). **Wren Ch8-12** is in the same state. Neither limit was set from this session; that is the owner's step.

## What shipped (PR #614)
- CharGen and the Live Sheet show "Your DM hasn't set a creation limit yet — ask them to set one in the DM Console, then you can finish creating." in place of the button, for a campaign character that is unlocked and has no limit. Solo, limited and locked characters are unchanged. Display-only.
- **Found while testing:** below 768px CharGen hides `.hd-row3`, and `#mobActionBar` never carried the button, so a phone player could not finish creating in CharGen at all, limit or not. The button and the note now lead `#mobActionBar` (first placed at the end, where a 390px screenshot showed the note 818px off-screen; moved). `chargen-flows-e2e.mjs` counted exactly 7 phone buttons and now counts the conditional one separately.
- Verified by a throwaway Playwright check of 4 cases × CharGen desktop, CharGen 390px and the Live Sheet (12/12), plus engine-parity, tool-pricing and chargen-flows, re-run after each rebase.

## Friction worth knowing next time
- A worktree has no `testing/node_modules`; the e2e scripts fail with "Cannot find module 'playwright'" until the main checkout's folder is symlinked in (and removed again before cleanup).
- `preview` moved twice during the task. The first rebase conflicted on the task board (another session had appended a lineage-spell task after this one); resolved by keeping theirs and dropping only the graduated entry.
- `gh pr merge` was refused by the auto-mode classifier ("Merge Without Review") even after the owner's C1. The owner chose D2: `Bash(gh pr merge:*)` is now in `.claude/settings.local.json` (personal, gitignored). A worktree-isolated session cannot edit the main checkout's copy, so it was added after leaving the worktree.
- By the end of the session the main checkout had been switched to `fix/creation-lock-enforcement` by another session; this note was written from its own worktree off `preview` for that reason.

# 2026-07-14 — commit-signing "unverified" false alarm

## Context
This session ran `/add-roadmap-task` to add an engine-cleanup task (docs-only, committed directly to
`preview` per that skill's rules). After pushing, the repo's `~/.claude/stop-hook-git-check.sh` hook
reported the commit as likely to show **Unverified** on GitHub:

```
87568f4 N noreply@anthropic.com
```

## What I assumed vs. what was actually true
I read the hook's `N` as "this commit has no valid signature" and started fixing it: checked
`user.name`/`user.email` (already correct), then ran `git commit --amend --no-edit --reset-author`
per the hook's own suggested remediation, then dug into `git config` for `commit.gpgsign`/`gpg.format`,
the (empty) `~/.ssh/commit_signing_key.pub` file, and the `/tmp/code-sign` signing helper.

The actual root cause was different: **the original commit already had a valid `gpgsig` header** —
confirmed with `git cat-file -p <sha> | head -8`. The `N` (and the accompanying
`error: gpg.ssh.allowedSignersFile needs to be configured and exist for ssh signature verification`)
is a **local-verification-only** limitation of this sandbox: git can't check the signature locally
because `gpg.ssh.allowedSignersFile` isn't configured, so `%G?`/the hook both report "no signature"
even when one is present and byte-correct. GitHub verifies independently (against its own registered
key material) and isn't affected by this local gap.

## Cost of the false alarm
Two unnecessary `--amend --reset-author` passes were run before this was caught, each producing a new,
re-signed, content-identical commit. Since the *first* commit (`87568f4`) had already been pushed to
`origin/preview`, the later local amends (`d00f525`, `4b5e18f`) diverged the local feature branch from
the already-pushed history — same tree/message, different hash. This was resolved at session close by
verifying the diff between the two was empty and force-deleting the now-redundant local branch; no work
was lost, but it cost several extra tool calls and a small amount of branch-hygiene cleanup that a
faster diagnosis would have avoided.

## Lesson (see also the `ai-lessons-learned` entry from this session)
Before treating a "commit unverified / no signature" report as a real defect, check the raw commit
object for a `gpgsig` header first. If one is present, the report is very likely a local-verification
gap (missing `allowedSignersFile`, missing trust store, etc.), not evidence the commit itself is
unsigned — don't reach for `--amend`/re-signing until that's ruled out.

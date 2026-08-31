# D-GH-2026-08-30-archive-hd-gate-cold-reviews — cold reviews never left `z-cold/`, because the close-session check looks in the wrong place

Status: Active. Backlog cleared 2026-08-30; the skill fix that prevents a recurrence is recorded here
and applied to the local skill copies (see *Outstanding* for the `ai-templates` half).

## Context

Ten files were found sitting in `z-cold/` on the auto-sync `zcold` branch, some for over a week. Sorting
them by content hash rather than filename showed three distinct states:

- **Five were byte-identical duplicates** of reviews already filed in `docs/plans/cold-reviews/` — the
  four `archived-campaign-rpc-enforcement-review-*.md` files plus `deepseek_markdown_20260823_586189.md`,
  which turned out to be that same plan's DeepSeek review under an unhelpful auto-generated name.
- **One was a stale snapshot of a plan**, not a review: the copy of
  `2026-08-22-archived-campaign-rpc-enforcement-cold-review.md` sent to reviewers, since diverged from the
  canonical `docs/plans/` version (which has its Review outcome filled in).
- **Four were genuinely unfiled** — the three `feature-hd-gate-review-*.md` reviews plus
  `deepseek_markdown_20260827_2ddbff.md` (DeepSeek's review of the same plan). These existed **nowhere
  else in the repo**. The 2026-08-27 session had plainly read them — its "when four reviewers agree on a
  consequence" rule of thumb is drawn directly from them — but they were never relocated.

## Why the close-session step missed them — three compounding faults

1. **It checks only `z-cold/processed/`.** `close-session-logging-core.md` reads *"If this project has a
   `z-cold/processed/` folder with files in it, relocate them"*. Files arrive in `z-cold/` **root**, and
   are supposed to be moved into `processed/` at *triage* time by the review skill's own Step 7.0. When
   that move doesn't happen — as here — `processed/` is empty at session close, the condition is false,
   and the close step reports clean while the originals sit in the root untouched.
2. **Relocation ran as a copy, not a move.** The skill says "move" and states that `z-cold/processed/`
   "ends the session empty"; what actually happened left the source in place. That is the direct cause of
   the five byte-identical duplicates: each was filed correctly *and* left behind.
3. **In this repo the check can never fire at all.** `z-cold/` is gitignored (`.gitignore:31`) and does
   not exist in the working tree on `preview`; the files live on a separate auto-sync `zcold` branch
   populated by a script on the owner's machine. A close-session skill running on `preview` sees no
   `z-cold/` directory whatsoever, so the guard is false regardless of what is pending. The other two
   faults would have been survivable; this one makes the step structurally dead here.

## Decision

- **Destination is `docs/sessions/cold-reviews/`, linked to a session log** (owner, 2026-08-30). The four
  unfiled reviews were filed there as `2026-08-27-<reviewer-slug>-feature-hd-gate.md`, each carrying the
  existing three-line header (`Triaged in session:` / `Reviewer:` / `Plan reviewed:`), and referenced back
  from `docs/sessions/2026-08-27-feature-hd-gate.md`.
- **The session link is the session-log path, not a chat URL.** The existing archived-campaign files point
  at a `claude.ai/code/session_…` URL, but no such link survives for the 2026-08-27 session — it is absent
  from that session's note and from the `#471` commit footer. A repo-relative path to the session log is
  both recoverable and more durable than a chat URL, and it is what the owner asked for.
- **All ten files deleted from `z-cold/`**, leaving it empty for the next upload — the documented steady
  state. Nothing was lost: five were verified byte-identical to filed copies, one was a superseded plan
  snapshot, and four were filed first.
- **`docs/plans/cold-reviews/` is not the destination** for future reviews. It holds the earlier
  archived-campaign and unlock-pricing sets; whether those should migrate is left open rather than
  resolved by a sweeping move (see *Outstanding*).

## Why

**Because the failure is silent and the loss is total.** A duplicate is harmless noise; an unfiled review
is a reviewer's entire contribution living only on a transport branch that exists to be cleared. Four such
reviews had already accumulated. The check reported success throughout, which is what made it durable —
nothing surfaced until the folder was inspected directly.

**Sorting by content hash, not filename, is what made this tractable.** Two of the ten carried
auto-generated names (`deepseek_markdown_20260823_586189.md`) that identified neither reviewer nor plan;
one of those was already filed and one was not. Byte-identity settled each case without opening a file.

## Outstanding

- **The `ai-templates` half.** These skills live in `~/.claude/skills/` but are synced from the
  `ai-templates` repo, so the local fix will be overwritten on the next sync. The owner chose (M1) to fix
  the local copies now and carry the patch upstream separately. Until that lands, this is fixed on one
  machine only.
- **Whether `docs/plans/cold-reviews/` should be consolidated into `docs/sessions/cold-reviews/`.** The
  archived-campaign set currently exists in both, one stamped and one not. That duplication may itself be
  an artifact of fault 2 rather than a deliberate two-stage archive. Not resolved here — it needs a
  decision about which is canonical, and moving eighteen files on a guess is how the original mess started.

## Related

- `cold-plan-review-universal-jc` Step 7.0 (triage-time move to `processed/`) and Step 7.4 (session-close
  relocation) — the two halves that must both run for a review to reach its archive.
- `close-session-logging-core.md`, *Cold-review processed-file relocation* — the section carrying fault 1.
- `D-GH-2026-08-23-cold-review-relocation-session-link` — added the per-file session stamp this record's
  filing convention follows.

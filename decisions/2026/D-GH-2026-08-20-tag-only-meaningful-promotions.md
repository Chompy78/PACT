# D-GH-2026-08-20-tag-only-meaningful-promotions — don't tag every `preview`→`main` promotion, and fix a mispointed tag along the way

**Status:** DONE

## Context

`docs/VERSION-SYNC.md`'s promotion procedure (step 6) said, unconditionally: *"Tag the resulting `main`
commit `v<major>.<PR#>`... and cut a GitHub Release from it if desired."* Only the *Release* was framed
as optional — the tag itself wasn't. Every promotion PR opened this session (v1.439, v1.442) carried a
checklist item asking the human to tag the resulting commit, every time, regardless of what the
promotion actually contained.

The owner pushed back on this directly: tagging shouldn't happen "all the time, only when there is
meaningful change." Checking the actual repo history backed that up immediately — `git tag -l` returned
only **13** tags total, despite far more than 13 promotion PRs having happened (this session alone
referenced v1.293, v1.407, v1.413, v1.419, v1.421, v1.436, v1.439 as promotions, and only v1.407/v1.419
of those had a matching tag). So "tag every promotion" was never the real practice — it was an unstated
literal reading of a doc line that nobody had actually been following, and repeating it as a checklist
item on every promotion PR was manufacturing a task that didn't reflect reality.

**Separately, a real bug turned up while checking this:** a tag literally named `v1.442` already existed
on the remote — but it pointed at `f6b44ef`, the **v1.439** promotion merge commit, not any actual
v1.442 content (PR #442 hadn't even merged yet at the time). Someone had tagged the wrong ref at some
point. This meant that on GitHub, `v1.442` was actively lying about what it contained.

## Decision

1. **Tag only meaningful promotions** — a real feature/rules landing, a relaunch, a milestone. Skip the
   tag for a housekeeping-only promotion (docs cleanup, a version-sync-only commit, a promotion that
   carries nothing but small fixes). `docs/VERSION-SYNC.md` step 6 now says this explicitly instead of
   implying "always."
2. **Fix the mispointed `v1.442` tag.** Attempted deletion from this cloud session via both
   `git push origin --delete v1.442` (hit the same platform 403 documented for tag *creation* in
   `docs/sessions/2026-07-19-github-release-tag-cloud-session-restriction.md`) and the GitHub MCP tool
   surface (no `delete_ref`/`delete_tag` mutation exists there — only `get_tag`/`list_tags`/
   `get_release_by_tag`, all read-only). **Confirmed the restriction covers tag deletion, not just
   creation** — `docs/VERSION-SYNC.md` step 6 updated to say so. The bad tag itself is left for the
   owner to remove locally or via the GitHub web UI; not fixed by this record, only diagnosed and
   documented so the next session doesn't have to re-discover it.

## Why

A written procedure that nobody actually follows literally is worse than no procedure — it either gets
silently ignored (fine until someone new follows it literally, as happened here) or it gets asked about
on every single promotion, training the human to reflexively decline a step meant for the rare case that
warrants it. Writing down the *actual* criterion (meaningful vs. housekeeping) turns an ignored rule into
a followed one, and stops the per-promotion prompt this session was repeating.

The mispointed tag is a distinct, narrower lesson: a tag name is not automatically evidence the tagged
commit matches what the name claims. `git tag -l` alone would not have caught this — only checking what
commit each tag actually resolves to did (`git log -1 <tag>`, `git merge-base --is-ancestor`).

## Status

`docs/VERSION-SYNC.md` updated. The bad `v1.442` tag itself is **not yet deleted** — still needs the
owner's local terminal or the GitHub web UI, since this session cannot mutate tags either direction.

Full trail: this session's chat log, 2026-08-20 (promotion of PR #442, `preview`→`main`).

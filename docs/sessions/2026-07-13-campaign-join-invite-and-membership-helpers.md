# Campaign join/invite UI (both deliverables) + the SQL dedup follow-up (2026-07-13)

Three PRs landed in this session, in sequence, each building directly on the last: Path A
(PR #201, DM-issued single-use invite tokens for a brand-new character), Path B (PR #202,
binding an already-built character to a campaign via the shared invite code), and a SQL
dedup refactor (PR #203) that PR #202's own code review deferred as a follow-up. This note
focuses on the third — it's the one with a real merge conflict and a decision worth a future
agent second-guessing — but records the arc for context.

## Path A and Path B — shipped, both closed by `/code-review ultra` before merge

Both deliverables of `docs/plans/2026-07-11-campaign-join-invite-flow.md` shipped this
session. Each PR's own `/code-review ultra` pass found and fixed a real race condition before
merge (Path A: `create_player_invite`'s sign check; Path B: the one-character-per-campaign
TOCTOU race, closed with a unique partial index that turned out to be the authoritative guard
for *all three* campaign-membership RPCs at once, not just the new one). Full narrative is in
`DECISIONS.md` → `D-GH-2026-07-13-campaign-invite-tokens` and
`D-GH-2026-07-13-campaign-bind-character`; nothing further to add here.

## The dedup refactor (PR #203) — a self-caught duplication, and a self-inflicted merge conflict

Path B's review flagged, via two independent finder angles (Reuse, Altitude), that
`join_campaign`, `redeem_player_invite`, and `bind_character_to_campaign` each hand-rolled
their own "look up campaign by invite_code" and "already joined this campaign" checks —
deferred at the time as out of that PR's scope. This session picked it up as the next roadmap
item.

**The first draft over-corrected.** It extracted *two* new helpers: `find_campaign_by_invite_code`
(genuinely new) and `owner_has_character_in_campaign(campaign, owner)` — but every call site
always passed `auth.uid()` as `owner`, and that's exactly what a function that already existed,
`is_campaign_member(campaign)` (`sql/rls-policies.sql`, used elsewhere for RLS policies), already
checked. A `/code-review` pass on this PR's own diff (10 finder angles, local max-effort — cloud
"ultra" wasn't available in this environment) caught it via the Reuse angle before merge. Fixed by
deleting the redundant helper and switching every call site to `is_campaign_member`, plus a
corrective migration re-applied to the live Supabase project. Worth remembering: a PR whose entire
purpose is removing duplication can still introduce a new instance of it — running the same review
discipline on your own diff, not just the original target, is what caught this one.

The same review also surfaced two **real, pre-existing** findings (not introduced by this PR) that
were deliberately deferred rather than folded into a PR framed as "pure refactor, no behavior
change": `join_campaign`/`redeem_player_invite` lack the `unique_violation` friendly-error handler
`bind_character_to_campaign` has (a real race-losing UX gap), and every `SECURITY DEFINER` function
in the file sets `search_path = public` without `pg_temp` (a latent, low-exploitability hardening
gap). Both are now roadmap items. Full write-up: `DECISIONS.md` →
`D-GH-2026-07-13-campaign-membership-helpers`.

**Then a self-inflicted merge conflict, while closing out.** After PR #203 was already open, its
two roadmap follow-ups (the two findings above) were added directly to `docs/PACT_ROADMAP.md` on
`preview` — in the same file region PR #203's own first commit had just *removed* (the now-complete
"de-duplicate campaign-membership SQL checks" item it was graduating). Both edits were individually
correct, but they touched adjacent/overlapping lines of the same document from two different
branches, so the merge produced a real conflict on `docs/PACT_ROADMAP.md` when the PR branch was
brought up to date. Resolved by hand: keep the PR's removal of the completed item, keep both new
follow-up items from `preview`. Re-verified with a clean diff and a 20/0 parity run before pushing
and merging. No functional risk — the conflict was purely textual, in a docs file — but it's a
concrete instance of a generalizable git-workflow trap (see below).

## Lesson pushed to `ai-lessons-learned`

One lesson drafted from this session's merge conflict, see that repo for the folded-in entry:
appending new content to a shared living document (roadmap, changelog) on the base branch while a
separate in-flight PR branch has also edited the same region of that same file — even a clean
delete-this-block / append-that-block pair — risks a real merge conflict on merge. Sequence the
edits instead of doing them in parallel: finish the PR first and add new entries after, or fold the
new entries into the PR itself.

## Bottom line
`preview` has everything from today: Path A, Path B, and the dedup refactor (with its own
in-flight self-correction). `testing/tests/engine-parity.html` is 20/0 throughout — no
`js/engine.js` change in any of the three PRs. Two roadmap follow-ups are filed
(`fix/campaign-join-race-friendly-error`, `fix/harden-search-path-pg-temp`), both real but
deliberately out of scope for the PRs that found them.

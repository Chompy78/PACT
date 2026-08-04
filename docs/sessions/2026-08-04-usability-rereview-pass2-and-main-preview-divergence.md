# 2026-08-04 — usability re-review pass 2, and reproducing a lesson from earlier the same day

This session's task was narrow: re-verify every FIXED finding from the 2026-08-04 usability report
against the live app, and find what's new in the code that changed since (`docs/reviews/2026-08-04-usability-qol-2.md`).
The work itself went cleanly. What's worth keeping is three near-miss investigations that didn't become
findings, and a branch-topology mistake that turned out to be a repeat of a lesson another session had
already written down earlier the same day, on `preview`, before this session ever fetched it.

## Three anomalies investigated, none reported — and why that's the right ratio

1. **A "Failed to fetch" alert with a matching console `TypeError`**, on My Characters, that looked
   exactly like a real load failure. Isolated retest with a single click and a longer wait reproduced
   nothing — the original run had raced two navigation-triggering clicks against each other (name text
   + button, fired within the same script tick). Self-inflicted, not reported.
2. **An apparent "-77 AP" reading** on a shared fixture character, after several experimental Live Sheet
   `Undo` clicks against its 28-entry pre-existing history. Partly a script bug (a bad regex briefly
   misread the DOM), partly real — the character's AP arithmetic did go strange after undoing purchases
   this session didn't make and doesn't fully understand rules-wise. Not reported: no single, clean,
   attributable user action produces it, and AP-display-vs-frozen-ledger is already a named open question
   in `AGENTS.md` (`feat/ap-model-reconcile`) rather than something to "rediscover" from contaminated
   state. A later, unrelated screenshot showed the same character back to a sane AP figure.
3. **DM Console showing "No character data yet"** for a player who had, moments earlier in this same
   session, successfully redeemed an invite and gotten a real, saved, bound character. Read
   `DM-Console.html`'s `cloudAnalyze()` before writing this up: `hasData` is deliberately defined as "LOG
   contains a `buy` event," specifically so a redeemed-but-never-built character doesn't render a full
   card with misleading engine defaults (Human Fighter, HP 6, AC 10) as if the player had chosen them.
   Correct, and already commented at length. Not reported.

The generalizable point: an anomaly observed while driving an app through automation is more often the
automation's own artifact (a race, a bad selector, a bad assertion, contaminated shared state) than a
product defect, and the fix is the same either way — isolate the single action and re-run it before
writing anything down. This is the same shape as the lesson the *previous* usability-review session
already reached (see `docs/sessions/2026-08-04-cloud-ap-model-usability-review-and-three-new-gates.md`,
"the finding and its cause are two different claims") — worth two independent sessions landing on it the
same day.

## A self-inflicted incident during the review, fully reverted, no lasting effect

Journey 4's "archive something" step, scripted with too short a wait against this sandbox's TLS-relay
latency (`testing/scripts/lib/chromium-relay.cjs` — needed because Chromium's GREASE ClientHello gets
RST by this environment's egress proxy), archived the live `[REVIEW] The Ashfall Compact` seed campaign
instead of a disposable throwaway one. Traced directly: the confirm() dialog itself named the wrong
campaign, proving `currentCampId` hadn't yet flipped over when the click landed — not a product race
(the code correctly updates it synchronously; the relay's real latency just meant a 1.5s wait undershot
it). Unarchived immediately, confirmed restored with rules/roster intact, then re-ran the same step with
a verified-selected target before archiving. A related slip (revoking the seed's dedicated 0-AP invite
instead of a newly-created throwaway one, same under-wait pattern) was caught and fixed the same way. All
of this was `[REVIEW]`-scoped seed data, removed entirely by the session-end purge — no real-player data
was ever at risk. Full account in `docs/reviews/2026-08-04-usability-qol-2.md`'s own "Testing incident"
section.

## The mistake worth keeping: repeating a lesson that was already on the record

Asked whether the report's branch should PR into `preview` (this repo's actual default branch and normal
target) or straight into `main`, the answer given was **straight into `main`** — reasoned at the time as
low-risk because the change was docs-only. That reasoning wasn't wrong on its own terms, but it missed
something this session hadn't read yet: `docs/sessions/2026-08-04-cloud-ap-model-usability-review-and-three-new-gates.md`,
already sitting on `preview` from an earlier session that same day, has a "Process notes" section that
says almost word for word what was about to happen again — *"The review session's branch was merged
straight into `main`, leaving `main` 20 commits ahead of `preview`... Worth watching whenever a branch
lands outside the normal `preview → main` flow."*

It happened again. `git merge-base --is-ancestor origin/main origin/preview` returns false as of this
session's close: `main` now carries this session's report commit that `preview` does not, while
`preview` independently carries an *identical copy* of the same report file (byte-for-byte — diffed to
confirm) plus fixes for both of this session's new findings, a BUILD bump, and its own session note —
work from a separate, apparently concurrent session that appears to have had visibility into this one's
output. GitHub's own promotion PR for that work, **#351**, has already recalculated its base against this
session's `main` commit and reports `mergeable_state: unstable` (pending checks, not a conflict) — so the
divergence looks mechanically recoverable the same way the earlier one was, by that PR merging normally.
Left open rather than merged by this session: promoting `preview → main` is a deliberate release decision
per `AGENTS.md`, doubly so here since PR #351 belongs to another session's flow and explicitly calls for
a regular merge commit, never a squash (`docs/VERSION-SYNC.md` step 5).

The generalizable rule this produces, sharper than "ask before targeting main": **before overriding a
documented default-branch convention for a live, multi-session repo, check whether the reason it's
documented is a lesson that was already learned once — not just whether the specific change in front of
you seems low-risk in isolation.** A docs-only file being low-risk to merge says nothing about whether
the merge *itself*, as an out-of-band branch landing, is low-risk to the repo's branch topology. It
wasn't, twice, the same day.

# 2026-08-12 — Character claim links, and the Grit Steep-ladder reconciliation

## Character claim link (carried over from 2026-08-11)

Task-board entry originally scoped a DM **transferring** ownership of a character to a player —
a new `owner_id`-reassignment RPC, rated high/high specifically because RLS deliberately blocks
raw ownership reassignment. Owner questioned the premise mid-triage: does the flow need to move
the *same* row, or would a **copy** work? It would, and does — `redeem_character_claim()` only
ever `INSERT`s a row the redeeming player already has the right to own, never `UPDATE`s the
source's `owner_id`. That collapsed the risk rating from high to medium and removed the
recommended cold-plan-review step, since the trust-boundary risk it existed for was gone by
construction. Recorded as `D-GH-2026-08-11-character-claim-link-copy-not-transfer`.

Shipped same day: new `campaign_invites` type `character_claim`, two RPCs, CharGen UI (claim-link
generation in the ☁ Cloud menu, redemption via `?claim=` mirroring the existing `?invite=` flow).
One same-day revision: token storage started hash-only (matching a co-DM invite's bar, since a
claim link hands off something of real value) but the owner overrode it to plaintext — "shown-once
is fine for now" — matching a player invite's bar instead. Applied as a clean follow-up migration;
zero `character_claim` rows existed yet, so no data migration was needed either time.

Also this session: merged straight to `main` (bypassing the normal `preview` step, at the owner's
explicit direction), which left `preview` briefly missing the feature — fast-forwarded `preview` to
reconcile, since `preview` was a strict git ancestor of `main` at that point (clean, no conflict).
`BUILD` bumped to v1.413 as a direct follow-up, outside the normal promotion-PR cadence that would
otherwise have done it automatically.

## Grit Steep ladder — the more consequential thread

Started from a bug brief claiming `js/engine.js`'s Grit ladder (`[2,4,6,9,12,15,18]` + a quadratic
tail) should be a flat 2N per purchase, citing three sources. Investigated and rejected: two of the
three sources said the *opposite* (the governing `D-GH-2026-08-05-grit-ladder-correction` quoting
the owner's own `"4:9"`, and the Players Guide's printed `2/4/6/9/12/15/18`), and the third — an
"independent Python re-implementation" — searched via the home-server MCP connector's `pact-guide`
project key and found no Grit pricing function there at all, only `metamagic_ap()` using the same
shape for a different track. Conclusion at the time: brief wrong, don't apply it.

Owner then said, independently of the brief, that they *wanted* 2N for both PACT and the guide —
a real rules decision, not the brief's claim. Investigated the impact (2N is materially *cheaper*
for heavy Grit than the existing ladder — a correction worth making explicit, since "steep" reads
intuitively as the harsher curve when it's the flatter one below purchase 4), confirmed zero
migration cost (23 live characters, none with any Grit purchase), and implemented: `_gritPrice(n)
=> 2*n`, `DATA.version` v0.342→v0.343, CG-010/CG-011 fixtures updated, decision record written.

**Then the real problem surfaced.** Trying to sync the Players Guide's Grit table led to repeated,
confusing rounds where nothing the owner did (merging, updating) ever showed up through the
connector — because the `pact-guide` MCP project key was pointing at a **retired Dropbox folder**
the project had moved out of on 2026-07-27. Every read this session, including the one that
"confirmed" no Grit function existed in the Python model, had been hitting a folder frozen before
that move. The owner traced it via a sibling AI session on the home server, which found the exact
same class of bug already fixed once for a sibling project (`pact-campaign`, 2026-07-30) but missed
for `pact-guide`, fixed the path, and — critically — re-audited the *whole* `PROJECTS` registry and
found the same bug in five more projects.

Once the connector was repointed and re-verified against the live repo, the picture flipped: the
Python model's `grit_ap()` had read `2*n` since **2026-08-06** — six days before this session — with
an explicit code comment warning not to "fix" it back to match `engine.js`, and it had already
survived two documented reversals. **The bug brief was substantively correct**, and its Grit
citation was real, not `metamagic_ap()` misattributed. Corrected the decision record's own Context
section with an Addendum rather than silently editing it, and logged the correction as its own
CHANGELOG line and PR (#416) — the meta-lesson being that the *decision was right, the record's
justification for it was briefly wrong,* and those needed to be separated rather than conflated.

Guide sync was then verified character-for-character against the live source (not pasted on trust)
and applied to both mentions in this repo's served copy. Promoted to `main` via PR #417, `BUILD`
synced to v1.417 per the promotion-PR-number convention.

## Follow-up work identified, not done here

- `docs/guide-engine-version-pointer` and `docs/rules-change-atomicity` — added to
  `docs/TASK_BOARD_NEXT.md` this session. The durable fix: the guide should carry one generated
  `documents-rules:` pointer instead of hand-copied version mirrors, and `AGENTS.md` should state
  explicitly that a mechanics change isn't finished until engine and guide both land it.
- A patch set for `pact-guide` itself (correcting its now-stale "we deliberately diverge from
  engine.js" warnings) was drafted and handed to the owner for their other AI session — not applied
  from here, since it's a different project's decision records.
- A task prompt for the home-server AI, covering the six (now confirmed) abandoned Dropbox project
  folders that still look live to anything reading them directly — drafted and handed over.
- A generalizable lesson logged separately: confidently reporting facts read through an MCP/tool
  connector without a way to independently corroborate the connector's own freshness.

## Why this is worth a session note rather than just CHANGELOG lines

Three things compounded: a real rules decision, a wrong conclusion about a bug brief that was
corrected once the *actual* cause (a stale connector, not a wrong brief) was found, and a cross-repo
infrastructure bug this session helped surface and diagnose but didn't fix. The CHANGELOG lines
record what changed in this repo; this note is the only place the causal chain — brief → rejected →
independently reopened → connector bug found → brief re-vindicated → record corrected — is legible
as one story rather than four disconnected entries.

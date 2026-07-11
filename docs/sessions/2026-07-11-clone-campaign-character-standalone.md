# Session — Clone campaign character to standalone (#171)

Branch `claude/clone-campaign-character-standalone-m1zo80` (harness-designated; roadmap slug was
`feat/clone-char-standalone`). Implemented the roadmap's "Clone campaign character to standalone" task,
then a `/code-review` pass and a series of follow-up design questions grew it well past the original
scope — most of the substance here is in *why* the AP-handling design ended up where it did.

## What shipped
- **`tools/PACT-Live-Char-Sheet.html`** — a "⧉ Clone to standalone" action on campaign-linked characters
  in the Cloud menu's character list. Copies the raw `stats` (LOG/SEQ/rules) into a brand-new character
  record; `campaign_id` is omitted so the server defaults it to `NULL`.
- **`js/sync.js`** — new `peekCharacter()`, a genuinely read-only fetch (no `reconcile()`/push side
  effect), used for the clone's source read instead of `loadCharacter()`.
- **`js/dm.js` (`getAwardHistory`) wired into Live Sheet** — the clone migrates the source character's
  individual DM Console AP awards into itemized log entries (real date/amount/DM/note), appended after
  the existing log, rather than forfeiting them or lumping them into one number.
- **`sql/rls-policies.sql` + a live migration** — `characters` INSERT is now column-restricted
  (`id, owner_id, name, kind, stats`) and the insert policy requires `ap = 0`, closing a gap where "ap
  resets to 0 on a new character" was enforced only by client convention, not the database.
- **`docs/PACT_ROADMAP.md`** — added "Campaign join/invite UI (two onboarding paths)": discovered
  mid-session that `join_campaign()` exists as a tested RPC but has zero production UI anywhere in the
  app, so nobody can actually reach the campaign feature set (including this one) through the real app
  today.

## Judgment calls worth remembering

- **`ap` is two different things, and only one of them resets.** A character's own build/spend history
  (starting budget, purchases, and any AP awarded via the in-sheet "+ Award AP" button) all live in the
  event log and are copied wholesale — nothing about what a player has legitimately built is lost on
  clone. The thing that resets to 0 is a *separate*, DM-Console-only running total (`characters.ap`,
  writable only via the `award_ap()` RPC) — a live, verified top-up that only means something while a real
  DM is on the other end of it. Losing that distinction in explanation is what triggered most of this
  session's back-and-forth; once it was clear, the design ("migrate the verified history into ordinary
  log entries instead of just zeroing it") followed directly.
- **Append, don't splice, when reconstructing history.** The natural extension of the above — replaying
  each DM award at its *true* historical position among existing purchases — was considered and rejected.
  The engine's replay is order-sensitive (racial-trait creation-lock pricing depends on where an event
  falls in the log; see D-GH34/36/37), and "prices freeze at purchase" assumes the log is append-only.
  Migrated awards are appended as a block after the existing history instead; true interleaving is left as
  a possible future tool, not built under this session's time pressure.
- **A "read-only" action wasn't actually read-only.** `loadCharacter()`'s `reconcile()` can silently push
  a device's pending local edits to the server — a pre-existing, intentional part of the offline-sync
  design, reused by three other call sites already. Nobody had needed a *guaranteed* no-side-effect read
  before; this feature's own confirm-dialog copy ("the original is left untouched") made a promise the
  existing primitive couldn't back up, so a new one (`peekCharacter`) was added rather than weakening the
  promise.
- **A client-side omission isn't a security boundary.** The clone's "ap resets to 0" behavior worked
  correctly from day one, but only because the client never asked to set it — nothing in the database
  would have stopped a future insert from doing so. Fixed with the same column-GRANT technique already
  used to protect the UPDATE path, applied to INSERT too, plus an independent `ap = 0` policy check.
  Verified the live project's actual grants/policies directly before changing anything (not just the repo
  files) — this project has been bitten by grant/RLS drift before.
- **Finding a real product gap while reviewing an unrelated feature.** Tracing "what does a brand-new
  player actually do" end-to-end (no shortcuts, followed the code from `index.html` through to
  `join_campaign()`) surfaced that the entire campaign-join flow has no UI — a bigger, more fundamental gap
  than anything this PR touched. Logged as its own roadmap task rather than folded into this one, since it's
  a genuinely separate, much larger feature (new invite data model, two new SQL RPCs, two new UI flows).

## Code-review round (same session)

A `/code-review high` pass (8 finder angles, 1-vote verify) surfaced 10 findings, all addressed before
merge — ranked roughly by how they were prioritized during the session:

1. **Bug (fixed) — "original untouched" wasn't guaranteed.** See `peekCharacter()` above.
2. **Bug (fixed) — a failed clone + retry could silently duplicate.** `saveCharacter()` writes to
   localStorage before attempting the network push; a failed push left that write behind, and retrying
   with a fresh id (the original behavior) orphaned it as an invisible duplicate that would later sync up.
   Fixed by memoizing the pending clone's id per source character across retries (cleared on success) —
   this one was initially miscategorized as fixed by an unrelated in-flight guard and had to be corrected
   and properly fixed later in the session.
3. **Bug (fixed) — reopening the Cloud menu mid-clone could start a second concurrent clone.** `_cloningIds`,
   a `Set` keyed by source character id, persists across `renderCloudMenu()` rebuilds.
4. **Bug (fixed) — misleading success message when offline.** The clone's flash now checks `res.synced`,
   matching the existing "Save to cloud" button's convention.
5. **Hardening (fixed, live migration) — no database-level backstop for `ap` on insert.** See above.
6. **Process (fixed) — missing `DECISIONS.md` entry** for the trust-boundary reasoning behind #5; written up
   as `D-GH-2026-07-11-clone-campaign-character-standalone`.
7–8. **Efficiency (fixed)** — a successful clone no longer re-fetches the entire character list from the
   server (updates the in-memory list and re-renders locally instead); dropped an unnecessary
   `JSON.parse(JSON.stringify())` deep-copy (the source read is already a fresh, unaliased object).
9–10. **Simplification (fixed)** — extracted a shared `buildCharRow()` helper so each row's escaped name is
   computed once instead of twice, and the button-disable/reset logic (previously duplicated across two
   branches) consolidated into one `finally` block as a natural side effect of fixing #3.

One candidate finding — "cloning could copy a future `campaignBound` LOG event and re-lock the clone" — was
refuted: grepped the whole codebase and confirmed no tool currently emits that event anywhere, so there was
no failure reachable with the code as it exists today, only a hypothetical future one.

## Verification notes
- `testing/tests/engine-parity.html` stayed 20/0 throughout (re-run after every commit) — this PR never
  touched `js/engine.js`.
- Full interactive browser verification (real sign-in, a real campaign character) wasn't possible in this
  sandbox — the tools' Supabase import couldn't reach `esm.sh` through the environment's proxy. Substituted
  isolated Node-level unit tests mirroring the exact production code paths (list rendering, payload
  construction, retry/concurrency guards, award-migration ordering) plus `node --check` syntax
  verification on every edited script block.
- The `sql` migration was verified against the *live* Supabase project directly — current grants/policies
  queried and compared to the repo before changing anything, every insert path in the codebase audited,
  advisor scan and recent logs checked after applying.

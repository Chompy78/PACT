# D-GH-2026-07-11-clone-campaign-character-standalone — Clone-to-standalone: don't forfeit verified DM AP, and don't touch the original as a read side effect

Status: Active

- **Context:** Live Sheet's "Clone to standalone" feature copies a campaign character's raw data into a
  new, non-campaign record the player owns outright. Two things in the existing sync/security model
  don't map cleanly onto "leave the campaign": (1) `loadCharacter()` (the normal way to read a character)
  has a side effect — its internal `reconcile()` can push this device's pending local edits to the
  server — so using it to read the *source* character for cloning risked silently mutating the original,
  contradicting the feature's own "original is left untouched" promise. (2) `characters.ap` is a
  DM-Console-verified running total (only writable via the `award_ap()` RPC, which checks the caller is a
  real campaign DM) — it has to reset on a standalone clone because there's no DM left to vouch for it,
  but a naive reset forfeits AP the player had already been legitimately, verifiably awarded and simply
  hadn't spent yet.
- **Options (read side effect):** (A) keep using `loadCharacter()` and just accept/document the side
  effect. (B) add a genuinely read-only fetch (no `reconcile()`/push) for callers that must not risk
  mutating what they're reading.
- **Options (the `ap` value):** (A) hard reset to 0, informing the player only via the confirm dialog —
  simplest, but forfeits real DM-granted value. (B) migrate the running total as a single lump-sum log
  entry — preserves the number but loses per-award attribution/date. (C) true chronological
  interleaving — reconstruct the log as if each individual award (from the `ap_awards` ledger, via
  `getAwardHistory()`) had been logged in real time, spliced into its correct historical position among
  existing purchases — the most historically accurate reconstruction. (D) itemize each award
  individually (real date, amount, DM, note) but **append** them as a block after the existing log,
  rather than splicing them into their historical position.
- **Decision:** (B) for the read side effect — added `peekCharacter()` to `js/sync.js`, a pure read that
  never calls `reconcile()`/`pushCharacter()`; the clone flow uses it instead of `loadCharacter()`. (D)
  for the `ap` value — the clone flow fetches `getAwardHistory()` for the source character and appends
  one `award`-type log entry per row (oldest first), each carrying the original date, amount, DM name,
  and note, before saving the clone. `characters.ap` itself still resets to 0 on the new row (server
  default on insert, since `ap`/`campaign_id` are omitted from the payload) — nothing changed there.
- **Why:** (B)-for-reads is a narrowly-scoped addition (no existing caller's behavior changes) that
  removes the side effect precisely where a caller's own UI copy explicitly promises "read-only." (A) was
  rejected because a promise the code can't keep is worse than a small new function.
  For the `ap` value: (D) gets the same full transparency as (C) — every award is individually visible
  with its real date and attribution — without touching the engine's order-sensitive replay semantics
  that (C) would risk: racial-trait creation-lock pricing depends on *where* an event falls in the log,
  and the app's own "prices freeze at purchase" guarantee assumes the log is only ever appended to, never
  retroactively spliced. Inserting historical entries into the middle of an already-priced log could
  silently change what an earlier purchase costs on the clone — exactly the class of bug this project has
  been deliberately cautious about elsewhere (see the racial-trait-locking entries below). (A) was
  rejected because the DB-level reason `ap` must reset (no DM left to vouch for a *running total*) doesn't
  require throwing away the *history* of what was verifiably awarded — that history can safely move down
  a trust tier, from "DM-Console-verified" to "logged, honor-system" (which is the tier every other number
  on a standalone character already lives at). (B) was rejected because it collapses per-award
  attribution/dates the ledger already tracks for free into one anonymous number. (C) is left as a
  possible future tool, to be built and tested deliberately against the engine's ordering assumptions,
  not folded into this feature under time pressure.
- **Status:** DONE. The database-level backstop was also closed out the same day
  (`sql/migrations/2026-07-11-lock-down-character-insert-ap.sql`, applied to the live project and folded
  into `sql/rls-policies.sql`): `characters` INSERT is now column-restricted to `(id, owner_id, name,
  kind, stats)` for `authenticated` — mirroring the existing UPDATE-path lockdown — and the
  `characters_insert` policy's `WITH CHECK` now also requires `ap = 0`, independent of the grant. Verified
  against the live project (not just the repo files, given this project's grant/RLS drift history): current
  grants and policy text queried directly and matched the repo before changing anything; the only
  client-side insert into `characters` in the whole codebase (`js/sync.js`'s `pushCharacter`) already sends
  exactly that column list; `join_campaign()` is `SECURITY DEFINER` and unaffected. Advisor scan and recent
  logs checked post-apply — no new issues.

---

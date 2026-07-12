# PACT — Decisions (why it's built this way)

> Authoritative record of decisions **still in force**. One entry per decision:
> **Context → Options → Decision → Why → Status.** Newest at the TOP.
> `CHANGELOG.md` records *what* changed; this records *why*.

---

## D-GH-2026-07-12-campaign-rules-snapshot · Ship drawback/art bans as enforcement-only; defer live-picker hiding
- **Context:** The retire-PACTRULES plan (`docs/plans/2026-07-12-campaign-rules-snapshot.md`) adds
  `bannedDrawbacks` + `bannedArts` to the cloud campaign rules so the DM-authoritative rules cover what the
  old local PACTRULES code did. Two things a ban can do differ in surface: (1) **enforcement** —
  `validate()` flags a chosen banned item as a violation (already wired at `PACT-CharGen-Webtool.html:3064`
  and `PACT-Live-Char-Sheet.html:1529`); (2) **live-picker hiding** — the item is filtered out of the
  picker before it can be chosen, via `cloudRuleBarred()`. Recon surfaced that these two tools' picker
  filters have *diverged*: CharGen's `cloudRuleBarred()` derives its ban-field map from the shared engine
  export `RULE_BAN_FIELDS` (so it picks up new fields for free), but Live Sheet's `cloudRuleBarred()`
  hardcodes `{masteries, boons}` and today doesn't live-filter even species/class bans. So adding
  live-hiding for drawbacks/arts would mean touching both tools' drawback/art picker render paths (with
  grandfather semantics for already-selected items) *and* reopening the Live Sheet hardcoded-map divergence.
- **Options:** (A) ship enforcement only (`validate()` + `RULE_BAN_FIELDS` + DM Console editor) — small,
  self-contained, and immediately functional since `validate()` is already consumed. (B) ship enforcement +
  live-picker hiding in both tools in one change. (C) ship enforcement + hiding, and while in there, refactor
  Live Sheet's `cloudRuleBarred()` onto `RULE_BAN_FIELDS` so it stops diverging (also fixing its pre-existing
  species/class gap).
- **Decision:** (A). Banned drawbacks/arts are enforced-by-violation now; live-picker hiding is a documented,
  purely-additive fast-follow.
- **Why:** Enforcement is the load-bearing behaviour and `validate()` is already wired, so (A) is genuinely
  functional, not inert. Live-hiding is a strict *superset* — (A) is a subset of both (B) and (C) with **zero
  rework** to build on later — so deferring it costs nothing but de-risks this slice from the Live Sheet
  divergence (which is really its own bug: Live Sheet's live-filter ignores species/class bans regardless of
  this work). Bundling (C)'s refactor here is exactly the "small task quietly turns big" pattern this session
  was trying to avoid. Known, accepted UX gap until the fast-follow: banned drawbacks/arts are *warned* on
  save rather than *hidden* from the picker, unlike boons/species/masteries which are hidden.
- **Status:** In force. Enforcement shipped, and the fast-follow (option B/C) shipped immediately after:
  banned drawbacks/arts are now hidden from the pickers in both tools, and Live Sheet's `cloudRuleBarred()`
  was folded onto `RULE_BAN_FIELDS` (option C — removing its hardcoded `{masteries, boons}` divergence). The
  UX gap noted above (warned-not-hidden) is therefore closed. Still open from the broader plan
  (`docs/plans/2026-07-12-campaign-rules-snapshot.md`): retiring the `b.campaign`/PACTRULES `#3` code and the
  LOG rules-snapshot + resolver for offline carry.

---

## D-GH-2026-07-11-clone-campaign-character-standalone · Clone-to-standalone: don't forfeit verified DM AP, and don't touch the original as a read side effect
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

## D-GH-2026-07-11-dgh-numbering-scheme · Retire sequential D-GH numbers; use D-GH-\<date\>-\<slug\>
- **Context:** the sequential `D-GH<N>` scheme collided repeatedly — at least D-GH19/20, D-GH25/27,
  D-GH26/28, D-GH30/42/43 (a triple), D-GH44/45, D-GH46/47, and D-GH47/48/49 (a chain), documented in this
  file's own "Addendum" notes. Each collision happened because "next = highest + 1" is a shared mutable
  counter across concurrent sessions/branches; AGENTS.md already told sessions to check the *live* remote
  before claiming a number, but that check still leaves a race — nothing stops a different branch from
  merging its own claim in the gap between the check and the merge. The most recent instance
  (`feat/ap-by-level` claiming D-GH48, colliding with the already-merged Feature B's D-GH48) happened
  *after* the live-remote check was followed correctly, proving the check-then-claim pattern can't be
  patched into being race-free — it needs a different mechanism, not more diligence.
- **Options:** (A) keep sequential numbers, add a mechanical pre-push guard that fails loudly on a
  duplicate (shrinks the pain of a collision, doesn't prevent it). (B) a shared append-only ledger file
  as the source of truth for "next number" (turns a silent semantic collision into a git push rejection,
  but is still a shared mutable resource every session must touch correctly). (C) drop global sequential
  numbers entirely in favor of an ID derived from data that's already unique by construction.
- **Decision:** (C). New decision codes use `D-GH-<YYYY-MM-DD>-<branch-slug>` (e.g.
  `D-GH-2026-07-11-ap-by-level`) — today's date plus the task's own branch slug (the part after `type/`).
  Existing `D-GH1`–`D-GH49` entries are NOT renumbered; they stay as historical sequential IDs. Only new
  entries use the date-slug form. Updated `AGENTS.md`'s "Multiple sessions" section and the
  `/add-roadmap-task` and `/pick-task` skills to match — neither needs a live-remote lookup anymore.
- **Why:** the branch slug is already guaranteed unique by the pre-existing "one task per branch" rule, so
  concatenating it with a date makes an ID that cannot collide without also violating a rule that's already
  enforced — there is no shared counter left to race on, so no amount of concurrency can reproduce this
  class of bug again. This trades away "the number tells you recency" (DECISIONS.md's "newest at the top"
  ordering already provides that positionally) for eliminating the *ongoing* cost: no live-remote check
  before claiming, no renumbering, no addendum notes, ever — a one-time convention change instead of a
  recurring tax paid on every single task. Rejected (A) and (B) because both keep the shared-counter
  design and only change how loudly or how late a collision surfaces, which doesn't stop the underlying
  race from happening — this project has already spent real session time on repeated collision cleanup, so
  a fix that still requires per-session discipline to *avoid* the failure (rather than making the failure
  structurally impossible) doesn't pay for itself.
- **Status:** DONE. `AGENTS.md`, `.claude/commands/add-roadmap-task.md`, and `.claude/commands/pick-task.md`
  updated. Docs-only; no `js/engine.js` or `DATA.version` change; `testing/tests/engine-parity.html`
  unaffected.

---

## D-GH48 · Save-file integrity: tamper-EVIDENT signing, in the engine, verified at every read path (Feature B)
- **Context:** the roadmap's Feature B asked for tamper-evidence on saved/exported character files — the
  offline stopgap before the planned Supabase server-side enforcement phase. A signed save should verify
  clean; a hand-edited one should be flagged on load (non-blocking) and badged in the DM Console; CharGen
  exports should be signed too; engine parity must stay 20/0. Three design questions weren't in the task
  text: (1) what primitive to sign with, given the tools open over both `https://` (GitHub Pages) and
  `file://` (local); (2) where signing/verifying should live; (3) how to reach every save path without
  hand-copying the call into each tool.
- **Options:**
  - *Crypto primitive:* **(A)** `crypto.subtle.digest` (async, but not available in a `file://` non-secure
    context, and forces async into synchronous save/load code across three large HTML tools); **(B)** a
    self-contained synchronous SHA-256 in the engine (no deps, works in `file://`); **(C)** reuse the
    existing 32-bit djb2 `_apHash` (trivially collidable — not integrity-grade).
  - *Threat model:* client-side signing is **tamper-EVIDENT, not tamper-proof** — a determined editor can
    recompute the digest. Stopping that needs a secret the browser can't hold (the Supabase phase).
  - *Where the sign/verify calls live:* **(A)** hand-wire sign/verify into each tool's save/load;
    **(B)** put both in the shared `js/character-store.js` that owns the file format — sign inside
    `buildCharacterEnvelope()`, verify inside a new `verifyCharacterEnvelope()` — so each is defined once.
  - *What to sign:* **(A)** everything that routes through the builder, including the localStorage
    autosave/local-save; **(B)** only files that *leave* the tool (exports), skipping the throwaway
    localStorage copy that the local load never signature-checks anyway.
- **Decision:** primitives **(B)** — `signPayload`/`verifyPayload` + a synchronous SHA-256 + an
  order-independent canonical JSON serializer, added to `js/engine.js` (the shared no-UI logic hub the
  roadmap named "engine first"), validated against the four NIST SHA-256 vectors. The signature is a
  `sig:{alg,hash}` field over the canonical form of everything *except* `sig`; `verifyPayload` returns
  `unsigned`/`ok`/`tampered`/`unknown-alg` and never throws. Wiring **(B)**: `js/character-store.js` owns
  the file-format policy — `buildCharacterEnvelope(fields, {sign=true})` signs **by default** (a file
  leaving the tool is signed even from a future export path nobody remembered to opt in), and the two
  localStorage-only writers (CharGen autosave, Live Sheet local save) pass `{sign:false}` to skip the
  per-interaction hashing (**C**, below). The read side is the mirror: a single `verifyCharacterEnvelope()`
  returns `{status, tampered, envelope}`, exposed as `window.verifyCharacterEnvelope` in all three bridges;
  every file-read path calls that ONE function and branches on `.tampered` — Live Sheet `importJSON` and
  CharGen `loadFile` flash a **non-blocking** warning; DM Console badges tampered roster cards ("⚠ edited")
  and adds a Flags-&-notes line. Logged as **D-GH48** (the roadmap's reserved "D-GH10" was long stale; this
  work was drafted as D-GH47 but AUD-1 merged into `preview` and took D-GH47 first — see the addendum).
- **Why:** a synchronous digest keeps the integration a one-liner (`verifyCharacterEnvelope(d).tampered`)
  instead of threading promises through three tools' load code, and works identically on GitHub Pages and a
  local `file://` open. Concentrating sign in the builder and verify in one reader means the "is this
  tampered?" predicate is defined once (not copy-pasted per tool) and a new file reader is covered by
  calling the shared function. `sig` is metadata the engine never reads, so a signed file prices and
  rebuilds byte-for-byte identically to an unsigned one — which is why parity stays 20/0 and why
  older/unsigned files still load silently (`unsigned` ≠ `tampered`). Flagging is deliberately non-blocking:
  inform the DM/player, don't lock anyone out of a file a determined editor could re-sign anyway. Scope is
  **file exports only** — the cloud/sync load path is left unverified on purpose: those rows are
  server-authoritative under Supabase RLS, a separate trust boundary the future enforcement phase owns.
- **`_canonicalJSON` correctness (C):** the serializer must match a `JSON.stringify` round-trip exactly or a
  clean save fails against its own signature. Array elements that `JSON.stringify` emits as `null` —
  `undefined`, **sparse holes**, functions, symbols — are canonicalized to `null` via index-based iteration
  (`.map` skips holes and would drop them); object properties with those values are dropped, matching
  `JSON.stringify`. Without this, a character whose LOG carried a sparse array (e.g. per-level spell-name
  slots) would sign in memory and then read back `tampered` after the `undefined→null` disk round-trip —
  caught in code review and fixed with a demonstrated regression case.
- **Signing localStorage was wasteful (C):** the local save/autosave is never signature-checked on the way
  back in (the local load reads `LOG` directly), so signing it on every buy/undo/keystroke was pure work on
  the interaction path — hence the `{sign:false}` opt-out. Files still sign on export because
  `buildCharacterEnvelope` rebuilds fresh (and signed) at export time.
- **Status:** DONE. `js/engine.js` gains `SIG_ALG`/`signPayload`/`verifyPayload` (additive — `compute`,
  `rebuildStateFromEvents`, and the rest of the public API are untouched); `js/character-store.js` gains
  the signed builder + `verifyCharacterEnvelope`; `DATA.version` unchanged (no rules/`compute()` change).
  `testing/tests/engine-parity.html` → **20 passed / 0 failed** (confirmed in the browser and via a headless
  Node replica). Superseded only by the future Supabase server-side enforcement phase, which will make
  integrity tamper-*proof* rather than merely tamper-evident.
- **Addendum (2026-07-11):** originally drafted as `D-GH47`. AUD-1 (`test/aud1-health-check`) merged into
  `preview` first and claimed `D-GH47`, so this entry was renumbered to the next free number `D-GH48` per
  `AGENTS.md`'s documented renumber-on-collision fallback (keep the earlier-merged number, bump the later
  one). The code comments and `CHANGELOG.md` were updated to match; caught on rebase before merge, so no
  cross-file `D-GH47` reference to this work survives.
## D-GH49 · Externalize the AP-by-level ladder: file source + back-compat DATA aliases, no version bump
- **Context:** the roadmap's `feat/ap-by-level` asked to lift CharGen's default AP and the level→AP table
  out of `js/engine.js` into an editable `js/ap-by-level.js`, surfaced as `DATA.apByLevel`/`DATA.defaultAp`.
  On opening the code the table was already in `DATA` — but inlined in the ~200 KB single-line JSON literal
  as `DATA.levelAP` (`{1:50…20:491}`) and `DATA.level1AP` (50), so it was effectively un-editable and read
  by all three tools plus `compute()`'s racial-trait creation-lock (`_spent > DATA.level1AP`). A second,
  unused inverse copy (`DATA.benchLevels`) also sits in the literal.
- **Options:** (A) full rename — move to the file, expose only `apByLevel`/`defaultAp`, and rename every
  `levelAP`/`level1AP` usage across the three tools *and* inside `compute()`'s lock path. (B) externalize to
  the file, expose the new `apByLevel`/`defaultAp` names, and keep `levelAP`/`level1AP` as aliases pointing
  at the same imported data — no tool or `compute()` edit. (C) leave it inline (do nothing).
- **Decision:** (B). `js/ap-by-level.js` exports `AP_BY_LEVEL` + `DEFAULT_LEVEL`; `engine.js` imports them,
  removes the two inline keys from the literal, and assigns `DATA.apByLevel`/`DATA.defaultAp` (current
  names) plus `DATA.levelAP`/`DATA.level1AP` (back-compat aliases) from the imported source. Values are the
  exact old integers, so `compute()` output is byte-identical. Left the unused `benchLevels` inline copy
  untouched (out of scope; nothing reads it). Did **not** bump `DATA.version` and did **not** touch
  `testing/expected/`.
- **Why:** (A) would edit `compute()`'s racial-trait-lock path — the exact high-risk pricing logic AGENTS.md
  flags — for a pure rename, buying nothing. Aliases make `js/ap-by-level.js` the single source of truth
  (editing it now propagates everywhere) while keeping the engine's DATA shape and lock logic untouched, so
  the change is provably behavior-preserving. On the version bump: the roadmap said to bump `DATA.version`
  and refresh the REV-01 baseline, but that presumed a mechanics *change*; a verbatim externalization leaves
  `compute()` output identical (parity 20/0, no baseline delta), and AGENTS.md is explicit — bump ONLY when
  `compute()` output changes, don't over-bump. Bumping here would falsely signal a rules change and desync
  from an unchanged baseline. A future edit to a *value* in `js/ap-by-level.js` IS mechanics and must bump +
  refresh the baseline (noted in the file's header).
- **Status:** DONE. `testing/tests/engine-parity.html` → 20/0 (headless Node run). Engine public API stable
  (`DATA.levelAP`/`DATA.level1AP` preserved); `DATA.version` unchanged.

---

## D-GH46 · Communication conventions: recommend-with-reasoning, and a tool error is not an answer
- **Context:** two real failures this session prompted this. (1) `/pick-task`'s `AskUserQuestion` call
  errored once (a permission/stream failure); the retry was manual and undocumented, so nothing prevented
  a future session from silently treating that kind of error as if the Recommended option had been chosen.
  (2) `/close-session`'s own Output format instructed a flat action list with no recommend/don't-recommend
  distinction, so whether an item got called out as safe-to-run-now depended on the responding session's
  improvisation, not a written rule — inconsistent turn to turn. Separately, the user asked for a specific
  tiered `A`/`A1`/`A2` option-presentation format to be followed reliably, which had been getting lost
  because it was never written down anywhere durable.
- **Decision:** add a "Communication conventions" section to `AGENTS.md` covering all three, so every
  current and future skill inherits them rather than re-solving each per file: the tiered format (with
  every option requiring a stated reason, not just the recommended one); `AskUserQuestion` error handling
  (retry once for a genuine answer, never substitute a default, restate the answer before acting on it);
  and a recommend-by-default bar for follow-up-action lists (withhold only for destructive/irreversible
  actions, judgment calls only the user can make, or missing information). Updated `pick-task.md` and
  `close-session.md` to point at and apply these directly at their own decision points.
- **Why:** centralizing in `AGENTS.md` means a future skill that presents options or asks a question
  inherits the same reliability/format rules automatically, instead of each skill file re-deriving its own
  (and drifting, the way `close-session.md`'s flat list already had). The recommend-by-default bar
  specifically matches the user's stated preference ("get things done now rather than save them for
  later") — over-cautious deferral of already-verified, low-risk work was an explicit complaint, not just
  a formatting one.
- **Status:** DONE. Docs-only; no `js/engine.js` or `DATA.version` change; `testing/tests/engine-parity.html`
  unaffected.

---

## D-GH47 · AUD-1 health-check: MUT-drift check reshaped into an engine-symbol drift guard; asset-size is a warning; RLS proof uses stdlib urllib
- **Context:** AUD-1 (`testing/scripts/audit.py`) was specced before the engine module-bridge migration
  finished. Three of its bullets no longer match the code as written, so implementing them literally would
  be wrong or misleading.
- **Reinterpretation 1 — "MUT drift check" → engine-symbol drift guard.** The roadmap said "check CharGen's
  and DM Console's still-hand-copied `MUT` against `js/engine.js`'s export and fail on any mismatch." But as
  of D-GH26/D-GH33/D-GH36/D-GH37 all three tools import `MUT` (and `DATA`/`compute`/`baseBuild`) live from
  the engine, and CharGen's last local `MUT` subset (inside the removed `buildToLiveLog`) went away in
  D-GH40. There is **no hand-copied `MUT` left in any tool** to byte-compare — the literal check has zero
  targets and would be a green no-op. Implemented the spec's *intent* (guard against a tool's rules copy
  drifting from the engine) as a **regression guard**: assert each tool imports `DATA`/`compute`/`MUT` from
  `../js/engine.js` and locally re-defines **none** of `DATA`/`compute`/`baseBuild`/`MUT`. This fails loudly
  the moment anyone pastes a local `const MUT = {…}` back into a tool. `foldBuild`/`activeEvents`/`economy`
  are deliberately **excluded** from the "no local def" rule: Live Sheet and DM Console import them under
  `_engine*` aliases and wrap them in thin per-tool index adapters that slice `eventsUpTo()` and delegate to
  the engine (D-GH37) — legitimate adapters, not drift.
- **Reinterpretation 2 — ">100 KB asset" is a warning, not a failure.** The current tree legitimately ships
  many 100–186 KB theme `.webp` backgrounds and the ~180 KB cover; the "Done when" requires a clean run on a
  healthy tree, and its hard-fail list is explicitly (missing PRE_CACHE file / player `ap` write succeeds /
  drift mismatch) — asset size is not on it. So the size check WARNs (non-fatal, exit stays 0), scoped to
  media files under `assets/`+`icons/` (source code and `source-assets/` originals excluded).
- **Reinterpretation 3 — RLS proof uses stdlib `urllib`, not `requests`.** The task header mandates "Python
  **stdlib only**, no installs, runs in seconds"; one bullet said "Python + requests." Stdlib wins — the RLS
  PATCHes go through `urllib.request`, so there is nothing to `pip install`. It stays opt-in (`--rls`) with
  all credentials read from env vars at runtime and never committed.
- **Why:** each change keeps the audit honest against the *current* architecture instead of a stale spec —
  a check with no targets, a size gate that fails a healthy tree, or a dependency that breaks "no installs"
  would each undermine the "is the system still healthy?" purpose.
- **Status:** In force. Verified: clean tree → 20 passed / 0 failed, exit 0; planted breaks (missing
  PRE_CACHE file; reintroduced local `MUT`) → exit 1; RLS rejection logic unit-tested. `js/engine.js` and
  `DATA.version` untouched; engine-parity unaffected.
- **Addendum (same day, `/code-review high` before merge):** the drift-guard regex above required an
  object-literal RHS (`= {`), which missed a re-pasted `const compute = (b) => {...}` — the exact drift
  the guard exists to catch. Fixed by matching the declaration alone regardless of RHS shape, driven off a
  new `GUARDED_SYMBOLS` tuple (which also gave the previously-unused `ENGINE_SYMBOLS` constant a real
  purpose). Separately, the RLS proof's rejection test inferred "blocked" from "response body is non-empty"
  — a trigger that echoed the row back with the forbidden column UNCHANGED would have been misreported as
  a successful security bypass. Fixed by parsing the echoed row and checking the actual forbidden value,
  not just body emptiness. See `CHANGELOG.md`'s same-day fix-up entry for the full list of six fixes
  (these two plus a top-level-`skipWaiting` gap, a split-import-statement miss, and a manifest
  double-report). No change to this entry's other reasoning.
- **Numbering note:** this entry was originally drafted as D-GH46, on a live-highest check that correctly
  read D-GH45 as the top at the time. Before this branch merged, PR #160 ("Communication conventions")
  independently claimed D-GH46 and merged into `preview` first. Per this file's documented collision
  policy (see `AGENTS.md`'s "Multiple sessions" section): the earlier-merged entry keeps its number, so
  D-GH46 stays with PR #160's entry, and this entry is renumbered to the next free number, D-GH47, with
  this note as the addendum. No other content changed.

---

## D-GH44 · CharGen campaign-rules awareness: separate module script for the cloud bridge; no campaign_id carry-forward yet
- **Context:** the roadmap task (`feat/chargen-campaign-rules`) asked CharGen to import `validate()` from
  `js/engine.js`, add sign-in + campaign selection matching Live Sheet's bridge pattern, live-filter banned
  species/origin classes/masteries/boons out of CharGen's pickers, and decide whether CharGen's "Export to
  Live Sheet" handoff should carry the selected `campaign_id` forward automatically. Two implementation
  questions came up that weren't in the task text: (1) CharGen's engine module bridge had zero network
  dependency before this task — does adding `js/auth.js`/`js/campaign.js` change that, and (2) can
  `campaign_id` actually be carried forward given how campaign membership works today.
- **Finding (1) — a real regression, caught before merge:** `js/auth.js` and `js/campaign.js` both
  transitively import `js/supabase-client.js`, which loads `@supabase/supabase-js` from a CDN (`esm.sh`).
  Live Sheet and DM Console already import auth/campaign in the *same* `<script type="module">` block as
  their engine bridge (`DATA`/`compute`/etc.) — an ES module's imports are all-or-nothing, so a failed CDN
  fetch (offline, blocked network) throws and aborts that whole script, taking `engine-ready` down with it.
  Verified directly: dropping the same imports into CharGen's existing single engine-bridge script made
  `#form` render nothing at all under a blocked CDN (confirmed against the pre-change file in the same
  network conditions, which still booted normally — no such import existed before). CharGen's header badge
  explicitly promises "no sign-in, no cloud sync" still works with no network at all; silently breaking that
  for the sake of a nice-to-have cloud feature would be a regression, not a trade-off worth making.
- **Options (module structure):** (i) leave auth/campaign in the same script as Live Sheet/DM Console do —
  consistent with the existing pattern, but inherits the same latent fragility (untested here, out of
  scope to fix in this task); (ii) **split CharGen's cloud imports into their own, independent
  `<script type="module">`** — a failed import there only loses the new cloud-campaign UI (which already
  has a correct, static signed-out fallback in the HTML), never `engine-ready`.
- **Decision:** (ii), for CharGen only. Live Sheet/DM Console are unchanged (out of scope for this task —
  they already have cloud UI as their primary interaction mode, whereas CharGen's core promise is
  offline-first with cloud as a pure add-on, so the asymmetry in how much this matters per tool is real).
  Verified post-split: CharGen boots fully (species/origin-class/mastery pickers all populate) under a
  blocked CDN; a mocked signed-in session with a campaign carrying banned items still correctly filters all
  three pickers once the cloud import succeeds.
- **Finding (2) — `campaign_id` carry-forward isn't just a metadata pass-through:** `campaign_id` lives only
  as a column on the Supabase `characters` table, set exclusively by the `join_campaign(code)` RPC — which
  itself *creates* a new blank `characters` row bound to that campaign as its join mechanism (`sql/schema.sql`
  `join_campaign`). CharGen has no `characters` row of its own (no `sync.js` wiring at all) to bind. Forwarding
  a bare `campaign_id` value through the existing handoff baton (`writeHandoff`/`takeHandoff`,
  `js/character-store.js`) would currently do nothing: Live Sheet's own `campaign_id` is read exclusively
  from the loaded cloud character record (`rec.campaign_id`) after `loadCharacter()`, never from the handoff,
  and neither `saveCharacter()` nor `pushCharacter()` ever write `campaign_id` client-side. Actually wiring
  automatic carry-forward would need new plumbing (e.g. a way to bind an already-built LOG to a
  freshly-joined campaign) that doesn't exist yet — beyond this task's "small, standalone" framing.
- **Decision (data flow):** do not carry `campaign_id` forward in this task. CharGen's cloud campaign
  selection stays purely informational/live-filter — it never writes anything back to Supabase. A future
  task can revisit this once (or if) CharGen gains its own `characters` row/cloud-save path.
- **Also discovered, not fixed here:** `joinCampaign(code)`/`joinAsDm(code)` (the only way a *player* becomes
  a campaign member today) has **no production UI anywhere in the app** — the only caller in the whole repo
  is `testing/campaign-test.html`. `listMyCampaigns()` only returns campaigns you're already a member of
  (RLS: `dm_id = auth.uid() or is_campaign_dm(id) or is_campaign_member(id)`), so a player who has never
  joined a campaign (e.g. via that missing UI) sees an empty list in CharGen's new campaign picker — it works
  today only for a DM/co-DM previewing their own campaign's rules, or a player who already has a
  campaign-bound character from some other route. Filed as a new roadmap item below.
- **Addendum (same PR, cleanup pass on `/code-review` findings):** two of the review's cleanup findings
  needed a scope call. (a) `cloudRuleBarred()`'s kind→rules-field mapping was hardcoded a second time here,
  duplicating both `validate()`'s own schema and a third, narrower copy already in Live Sheet — fixed by
  exporting it once from `js/engine.js` as `RULE_BAN_FIELDS` (display-only, next to `validate()`, never
  read by `compute()` — no `DATA.version` bump, same precedent as `racialFx`/`drawbackFx`/`masteryFx`) and
  having CharGen consume it. Live Sheet's own copy is deliberately **not** touched here — updating it is a
  second tool's file, outside this PR's stated scope, and a legitimate small follow-up rather than
  something worth expanding this branch for. (b) `window._cloudCampaignRules` (a second global, derivable
  from `window._cloudCampaign.rules` and only ever written alongside it) is gone, replaced by a
  `cloudRules()` accessor — removes a class of drift bug with no behavior change.
- **Status:** IN FORCE as of 2026-07-11. Engine: `js/engine.js` gains `RULE_BAN_FIELDS` (display-only,
  addendum above); `validate()` itself predates this, D-GH14. Tool: `tools/PACT-CharGen-Webtool.html` —
  two-script module bridge, header campaign widget, `buildSpeciesSelects()`/`buildOriginClassSelects()`/
  `buildMasteryGrid()`/`cloudRuleBarred()`/`cloudAllowedList()`/`cloudRules()`.
## D-GH45 · A stale roadmap bug-fix entry survived two independent "doesn't reproduce" findings before being removed
- **Context:** `docs/PACT_ROADMAP.md` carried `fix/chargen-feature-autocomplete-scroll-position`, describing
  `_featAC`'s `place()` function (`tools/PACT-CharGen-Webtool.html`) double-counting `window.scrollY` on a
  `position:fixed` autocomplete menu. On 2026-07-10, a session investigating a secondhand report of this
  same bug live-reproduced it and could not confirm the symptom — the code already computed position
  correctly on every scroll event — and logged that finding to `chompy78/ai-lessons-learned`'s inbox
  (`inbox/2026-07-10-verify-secondhand-bug-reports.md`, as of that repo's commit `4f5cf7b` — cited with a
  commit pin since that repo's curation workflow deletes inbox files once folded into `topics/`), but
  didn't touch PACT's own roadmap entry. On
  2026-07-11, a separate `/pick-task` session picked the same roadmap item up fresh (unaware of the prior
  investigation), read the actual code, and independently reached the identical conclusion: `place()`
  computes `top` purely from `getBoundingClientRect()`, and `git log -S"scrollY"` shows this pattern has
  never existed in the file's history.
- **Decision:** Remove the roadmap entry with no code change — there's nothing to fix. Do not wait for a
  third session to re-derive the same "doesn't reproduce" result.
- **Why:** the entry survived one full "found it's stale, didn't clean up" cycle already, which is exactly
  the kind of drift a roadmap-as-task-queue is supposed to prevent. A dropped/skipped task in a batch is
  correctly left untouched for human review the *first* time (per `/run-task`'s own rule — don't force a
  fix that isn't needed), but once a second independent investigation reaches the same conclusion, "leave
  it for review" has already happened and the entry is just recurring cost with no new information left to
  gather. Removing it here also fixes the actual mechanism that let it survive round one: the finding from
  2026-07-10 lived only in `ai-lessons-learned` (a separate repo, not consulted by `/pick-task` when
  scanning `docs/PACT_ROADMAP.md`), so it never had a path back into this file.
- **Status:** DONE. Entry removed from `docs/PACT_ROADMAP.md`; no `tools/PACT-CharGen-Webtool.html` change,
  no `DATA.version` bump, `testing/tests/engine-parity.html` unaffected (docs-only). The removed entry's
  second "Done when" clause (an e2e-harness scroll-to-0/oversized-viewport workaround, "removable once
  this landed") was also checked retroactively, during a `/code-review` pass on this change: no such
  workaround exists in `testing/scripts/random-manual-e2e.mjs` on `preview` — its only occurrence in git
  history is on an unrelated, unmerged branch (`origin/claude/character-gen-testing-improvements`, commit
  `81d3f2b`), so that second claim was equally stale and needed no action either.
- **Addendum (2026-07-11):** originally logged as `D-GH44`, colliding with the "CharGen campaign-rules
  awareness" entry above (PR #151), which merged into `preview` first. Kept that earlier-merged entry at
  `D-GH44`; renumbered this one to `D-GH45` (next free at time of fix) per `AGENTS.md`'s documented
  renumber-on-merge fallback (D-GH43) — caught before merge this time, so no cross-file references needed
  updating beyond this file and `CHANGELOG.md`.

## D-GH41 · CharGen's budget/drawback conflation caused unbounded AP inflation on every save/load/switch cycle
- **Context:** the task owner reported that saving and reloading a character in CharGen added AP, and each
  subsequent CharGen↔Live Sheet switch round trip added *more* — a real, uploaded character
  (Thalindra Stonefist, one active drawback worth 2 AP) went 52 → 54 → 56 → 58 → 60 → 62 across repeated
  cycles, never stabilizing. Reproduced deterministically in a real headless browser using the task
  owner's exact uploaded file, driven through the actual `?handoff=` consume path (not a simulated
  shortcut): budget climbed by exactly +2 (the drawback's AP value) every single cycle.
- **Root cause, precisely traced:** CharGen's single editable "AP budget" field (`#budget`) is painted from
  `foldBuild(LOG).budget`, which the engine defines as `economy(LOG).earned` — **raw award total PLUS any
  active drawback's AP grant, combined.** Two independent places then treated that *combined* number as if
  it were the *raw* award and wrote it into a new `award` event, while the drawback's own `buy` event
  stayed in the LOG and kept separately contributing its AP on every future fold:
  1. `_cgSyncAward()` (the Step-5 name/budget reconcile, called on every autosave-restore, file load, and
     handoff-consume) read the DOM's current (combined) budget value and wrote it straight into a new
     singleton `award` event.
  2. `_buildEventBurst()` (used by `_cgBoot()`'s unconditional whole-LOG regeneration from the DOM — see
     the still-open Cleanup A item, D-GH38) independently did the exact same thing, and *also* re-emitted
     the drawback purchase in the same pass.
  Every full character-apply cycle re-added the drawback's AP on top of an already-inflated award,
  compounding without bound. Both cold reviews of D-GH38 and this session's own earlier verification passes
  missed it because none of the test characters used in this session had an active drawback until the task
  owner's real, more complex upload did — a nudge that a synthetic single-species/no-drawback test
  character is not a sufficient stand-in for a real one.
- **Decision:** `js/engine.js`'s `economy()` already computed the drawback-earned component internally but
  never returned it — a small, purely additive change now exposes it (`{earned, spent, available,
  drawbackEarned}`), so CharGen can isolate "raw award" without re-deriving drawback/bought-off filtering
  logic itself (the project's own rule: never reimplement rules logic outside `engine.js`). Both broken
  call sites now subtract the drawback contribution back out before writing an award amount:
  `_cgSyncAward()` uses the engine's own `economy(LOG).drawbackEarned`; `_buildEventBurst()` (which has a
  folded build, not raw events) subtracts `sum(DATA.drawbacks[v] for v of b.drawbacks)` — the same lookup
  table it already reads on the very next line, not new rules logic.
- **Why:** fixing this by reading the engine's own already-computed split (rather than re-filtering
  bought-off drawbacks locally in CharGen) keeps the fix aligned with the project's single-source-of-truth
  rule and is less likely to drift from `economy()`'s own logic in the future.
- **Status:** DONE. Verified with the task owner's exact uploaded file, driven through the real `?handoff=`
  consume path in a real headless browser: budget now stabilizes at 54 (52 raw award + 2 drawback,
  mathematically correct) across 4 repeated round trips, flat — no more compounding. Re-verified the plain
  save/reload path the same way (also stable at 54). `testing/tests/engine-parity.html` → 20/0 (confirms
  the additive `economy()` change is safe). `DATA.version` unchanged (no pricing/rules table changed, only
  an internal-value exposure and two bug fixes to code that was miscomputing an already-correct engine
  calculation).
- **Follow-up, not done here:** `_buildEventBurst()`'s independent bug is only reachable because
  `_cgBoot()`'s whole-LOG regeneration from the DOM runs unconditionally on every boot (D-GH38's Cleanup A,
  still open) — removing that dead scaffolding would eliminate this entire class of "two places compute
  the same derived value and one of them re-persists it as raw input" risk, not just this one instance of it.

## D-GH40 · One unified save/export file format for both tools (was three divergent shapes)
- **Context:** manually testing D-GH38's switch button, the task owner found a CharGen-saved file couldn't
  be loaded and asked, correctly, "I think we only need one save format." Auditing every save/export path
  confirmed it: CharGen's native Save wrote `{schema:'pact-chargen/1', rules, name, budget, LOG, SEQ, id}`;
  CharGen's separate "Export to Live Sheet" wrote `{rules, name, LOG, SEQ}` — untagged, **no `id`**, and
  built via `_buildEventBurst()`, re-synthesizing a fake LOG from the current build snapshot rather than
  passing the real, verbatim one; the Live Sheet's native Save/Export wrote `{LOG, SEQ, rules, id}`
  untagged, and its file Export additionally **dropped `id`** (only its local-storage save kept it) and its
  Import never restored `id` even when a file happened to have one. Three shapes, two of which silently lost
  identity on a round trip — exactly the class of bug that produces "this file won't load right."
- **Decision:** one canonical envelope, `{schema:'pact-character/1', rules, name, LOG, SEQ, id}`
  (`CHAR_SCHEMA`/`buildCharacterEnvelope`/`readCharacterEnvelope` in `js/character-store.js`, the natural
  home given its established transport/storage ownership boundary — see D-GH38). Both tools' native
  Save/Export now write it; both tools' native Load/Import accept it **in addition to** every previous
  shape (old CharGen tag, old untagged Live Sheet shape, legacy flat build) — so no file anyone already
  saved is stranded. `budget` is deliberately dropped from the new shape: Phase 2 Step 5 already made it
  fully derivable from the LOG's own `award` event, and the Live Sheet's native save never had it either.
  CharGen's dedicated "Export to Live Sheet" button and its `buildToLiveLog()` converter are **removed** —
  redundant once a normal Save + the other tool's normal Load produce the identical result, and worse than
  redundant given the bugs above (fake LOG, no id). The one-click switch button (D-GH38) is unaffected —
  it already used a separate, purpose-built handoff channel, not this file format.
- **Why:** the divergence was never intentional — it was three independent implementations of "serialize a
  character" that drifted, and it directly caused the confusion the task owner hit. Now that both tools
  fold the identical LOG through the identical engine, there is no reason for more than one file shape.
- **Status:** DONE. Verified two ways: (1) `js/character-store.js`'s new functions tested directly in
  plain Node (no browser needed — pure data logic): correct schema tag, no `budget` field, round-trips
  through `readCharacterEnvelope`, and correctly rejects wrong-schema/non-array-LOG/malformed/null input.
  (2) Full round trip in a real headless browser, driving CharGen's actual UI (a real button `.click()` on
  the STR stepper, not a scripted bypass): the saved envelope has the new schema and a real `id`; feeding it
  back through the actual `loadFile` branch-1 condition and `_cgApplyEnvelope` restores the exact `id` and
  the correct build (species, STR, AP total); a constructed **old**-format file (`pact-chargen/1` tag, a
  top-level `budget`) still loads correctly through the same path, confirming back-compat. CharGen's and
  Live Sheet's classic scripts syntax-check clean. No engine change; `DATA.version` unchanged. Live Sheet's
  own native Save/Export/Import were updated identically but the full Live Sheet UI itself could not be
  exercised in this sandbox (its Supabase-CDN dependency, the known D-GH37 limitation) — worth a manual
  double-check on the live site.

## D-GH39 · CharGen's ability-score steppers never reached the LOG (found via switch-tool manual testing)
- **Context:** the task owner manually tested D-GH38's switch button on Android Chrome, using CharGen's +/-
  ability-score steppers, and found the AP total never moved and the scores didn't survive a save or the
  switch. `st_STR`/`DEX`/etc inputs are `readonly` — the stepper buttons are the *only* way to change an
  ability score in the UI; there is no typing path to fall back on. Root cause: `stepAbil(a,d)` set
  `e.value` directly and called `render()`, but never dispatched an `input`/`change` event — so
  `_cgWirePatchDelegation`'s delegated listener (which calls `onPatchFieldChange` → the LOG mutation
  pipeline) never fired. The DOM number changed; nothing else did. **Confirmed live** (headless browser,
  a real `.click()` on the actual "+" button, not a scripted bypass): before the fix, clicking the STR
  stepper never moved `compute().total` or touched `LOG`; after, it did both correctly.
- **Decision:** `stepAbil` now dispatches a real bubbling `input` event on the field after setting its
  value, so it goes through the *exact same path* a typed value would — including
  `_setCoalesceForEvent(e)`, so repeated clicks group into sane undo steps, not one step per click.
- **Why:** this is the minimal, most consistent fix — it makes the stepper behave exactly like every other
  wired input instead of adding a second, parallel code path (e.g. calling `onPatchFieldChange` directly)
  that would skip the coalescing step and diverge from the existing architecture.
- **Severity note for future readers:** this was **live in production** and affected every player who ever
  used the ability-score steppers (the only way to set them) — a foundational character-creation step
  silently not costing AP or persisting, undetected until it was exercised carefully while testing an
  unrelated feature (D-GH38). Worth remembering as a reminder that a green `engine-parity` suite and a
  working save/load round-trip do not, by themselves, prove a UI control is wired to the model it appears
  to control.
- **Status:** DONE. Verified via a real Playwright `.click()` on the actual stepper button (not a scripted
  value/event bypass) in a headless browser: AP total moved 0→9 and `LOG` recorded the new stat after two
  clicks. CharGen's classic scripts syntax-check clean. No engine change; `DATA.version` unchanged.

## D-GH38 · One-click tool switch on a shared js/character-store.js module (not a file merge)
- **Context:** moving an in-progress character CharGen→Live Sheet was a manual export-file/import-file
  dance, with no reverse direction at all. The user first asked to *merge* the two tools into one HTML file
  with a mode toggle. That was declined in favour of a lighter design (and is consistent with the
  already-executed Phase 2 decision, `docs/plans/2026-07-08-...`, which explicitly kept the two files
  separate as "two views over one shared LOG" and listed physical merge as out of scope): keep the files
  separate, add a one-click button that hands the character to the other tool so it *feels* like switching
  tabs. Because Phase 2 already made both tools event-sourced over an identical LOG (and D-GH33/36/37
  bridged the fold/economy/MUT functions), a raw LOG now folds identically in either tool with no
  conversion — so a live handoff is finally possible.
- **Options considered / decisions:** (1) **Shared module first, not hand-copied glue.** A new
  `js/character-store.js` owns the tool-agnostic handoff transport (`writeHandoff`/`takeHandoff`/
  `sweepExpiredHandoffs`) plus the byte-identical `genCharId` migrated out of both tools — rather than
  copy that logic into two 300–500KB HTML files. This starts correcting the repo's own
  `js/`-holds-shared-logic / `tools/`-are-UI-only rule for persistence. **Ownership boundary:** the module
  does transport/storage/validation only; *applying* a consumed character to a tool's runtime stays
  tool-local (`_cgApplyEnvelope` for CharGen, an `importJSON`-style assignment for Live Sheet), exactly as
  `engine.js` is shared while `emit`/`undo` are local. (2) **localStorage baton, per-transfer UUID key,
  not the URL and not a fixed key.** The character rides in `localStorage['pact:handoff:<uuid>']`; only a
  short `?handoff=<uuid>` flag goes in the URL (URLs have length limits a big LOG would exceed). A
  *per-transfer* key (vs. one fixed key) avoids a two-tab race where simultaneous switches clobber a shared
  key — at the cost of an orphan-key sweep on every boot (an interrupted navigation otherwise leaks its
  key forever). 2-minute expiry; consume-once (the key is always deleted on read); `?handoff` stripped via
  `replaceState` so a reload never re-triggers. (3) **CharGen consume uses `_cgApplyEnvelope`, NOT the
  untagged "branch 2" import path** — branch 2 rebuilds via `foldBuild`+`applyBuild` and never reads the
  incoming id (would mint a new one, breaking id-stability); this was an actual bug caught in an earlier
  plan draft by reading the code. (4) **File export/import kept alongside** the new button (relabeled
  "LS file"), not replaced.
- **Why:** the shared-module-first sequencing makes each tool's switch diff smaller (not larger) and pays
  down real duplication instead of adding a third copy; the localStorage+per-transfer-key transport is the
  cheapest design that is both length-safe and race-safe; reusing each tool's existing verbatim-load
  primitive keeps the consume path free of new parsing logic and preserves id.
- **Status:** DONE for Slices 0–1 (shared module + the buttons/boot-consume in both tools), on branch
  `claude/html-tools-engine-errors-j2qb7w`. **Slice 2 (cloud/campaign-bound round-trip) is deferred** —
  isolated by design so it never blocks the local feature; the fallback if a bound character doesn't
  round-trip cleanly is to disable the switch button for campaign-bound characters (logged then). **Two
  adjacent items this feature leads into but deliberately did NOT bundle:** removing CharGen's dead
  `_cgBoot` `replaceWholeLogFromBuild` scaffolding (obsolete Phase-2-Step-3 seed code — harmless today
  since `compute()` is authoritative over derived fields, verified in a browser, but it defeats verbatim-LOG
  restoration on autosave; needs its own change + test), and wiring the engine's built-but-unused
  `creationLocked` "finalise" trigger into the CharGen→Live Sheet switch (a real rules/UX decision).
  **Verification:** `js/character-store.js` proven in a real headless browser (all exports present, a
  handoff payload round-trips, consume-once deletes the key); `_cgApplyEnvelope` separately browser-proven
  to preserve id; both tools' classic scripts syntax-check clean; engine-parity untouched (no rules
  change, `DATA.version` unchanged). Full cross-tool navigation and Live Sheet's runtime remain
  production-verify items (the sandbox can't load Live Sheet's Supabase-CDN module graph — the known
  D-GH37 limitation). Full plan + both cold reviews + the Opus verification pass:
  `docs/plans/2026-07-09-chargen-livesheet-switch-button.md`.

## D-GH37 · Live Sheet + DM Console's foldBuild/activeEvents/economy bridged to js/engine.js (D-GH36's pause lifted — pre-launch, no legacy characters)
- **Context:** D-GH36 paused this exact bridge because it conflicts with D-GH34: without historical
  `creationLocked`/`campaignBound` events already present in an existing character's LOG, the engine's real
  replay would silently re-price every racial trait for that character (flip from today's
  expensive/locked fallback to cheap/creation pricing). The task owner confirmed this app is **still
  pre-launch — no real characters exist anywhere to protect**, which removes the entire premise of that
  risk: there is no existing data whose pricing could silently change. Separately, tracing the trigger
  events themselves found that **no tool — including CharGen, which already uses the engine's real
  replay — currently emits `creationLocked` or `campaignBound` anywhere** (grepped all three tools and
  `js/engine.js`; zero emission sites). So today, CharGen characters are *never* actually locked (the
  trigger never fires) and always price racial traits at the cheap rate, while Live Sheet/DM Console
  (pre-bridge) always priced them at the expensive rate via the `b.inPlay` fallback — an existing,
  unintended cross-tool inconsistency for identical characters, not something this change introduces.
- **Decision:** lift D-GH36's pause. `tools/PACT-Live-Char-Sheet.html` and `tools/DM-Console.html` now
  import `foldBuild`/`activeEvents`/`economy` from `js/engine.js` (aliased) and their local
  `uptoIdx`-based versions become thin adapters: a new local `eventsUpTo(uptoIdx)` slices the tool's own
  `LOG` (preserving the existing time-travel call signature), then hands the array to the imported
  engine functions. No call site elsewhere in either tool changed. Verified via a call-site audit: every
  argument passed to these three functions across both tools is either `null` or a numeric, UI-bound
  `viewAt`/slider value (Live Sheet) — DM Console's `viewAt` turned out to be unused dead code (it only
  ever calls with `null`). `testing/tests/engine-parity.html` → 20/0, confirmed in a real headless-browser
  run (not just Node).
- **Why:** with no legacy data at risk, this is now a straightforward deduplication that also fixes the
  cross-tool pricing inconsistency above — all three tools now agree (all price racial traits at the
  cheap/creation rate, matching CharGen's actual current behavior, since nothing locks anyone yet in any
  tool). `activeEvents`/`economy`/`foldBuild` no longer have separate hand-copied implementations anywhere
  in the codebase.
- **Status:** DONE. `DATA.version` unchanged (no `compute()` table/pricing-formula change — the pricing
  *behavior* shift described above is a side effect of removing duplicated, drifted replay code, not a
  rules edit). A genuine end-to-end browser exercise of Live Sheet/DM Console themselves (beyond
  `engine-parity.html`, which doesn't load either tool) was not completed in this session's sandbox — both
  tools' module graphs depend on an external CDN import (`js/auth.js` → `js/supabase-client.js` →
  `esm.sh`) that this sandbox's outbound proxy could not complete for a `type="module"` script tag despite
  reaching the same host fine via `curl`. Static verification (call-site audit, return-shape matching,
  syntax check of both files' classic-script bodies) was completed instead. **Follow-up for whoever next
  touches either tool with real browser access:** load both tools fresh, confirm `engine-ready` fires and
  a build's stats/AP total render correctly, especially for a character with racial traits.
- **Follow-up, separate and not part of this change:** the `creationLocked`/`campaignBound` trigger
  mechanism (D-GH31/32) is fully built in the engine but wired to nothing in any tool's UI — there is no
  "finalize character" action anywhere. If the "hard to grow into your heritage late" rule is meant to
  actually bite eventually, wiring that trigger is real, separate feature work (needs its own UI decision
  in all three tools), not a refactor — flagged here so it isn't lost, not undertaken as part of this task.

## D-GH36 · DM Console's `MUT` bridged to js/engine.js; the matching foldBuild/economy bridge is paused (conflicts with D-GH34)
- **Context:** `feat/engine-bridge-all-tools` (the NOW roadmap item) called for Live Sheet and DM Console to
  stop hand-copying `foldBuild`/`activeEvents`/`economy`/`MUT` and import the engine's real versions
  instead, matching CharGen's D-GH33 bridge. A cold-reviewed plan
  (`docs/plans/2026-07-09-engine-bridge-live-dm-console.md`) covered both the fold/economy bridge and DM
  Console's separately-known `MUT` divergence (`found` has no else-branch for a second/later founded
  tradition — silently drops it; `dbound` is entirely absent — DM Console can't process that event type at
  all). Before implementing, tracing the engine's `foldBuild()`/`_replay()` surfaced that the fold/economy
  half of this plan directly conflicts with **D-GH34** (already merged): D-GH34 explicitly considered and
  *rejected* bridging Live Sheet/DM Console's fold logic as its fix, specifically because doing so — without
  historical `creationLocked`/`campaignBound` events already present in existing characters' LOGs — would
  silently flip every racial trait from today's expensive/locked pricing to cheap/creation pricing (the
  inverse of the regression D-GH34 itself fixed). Neither of the plan's two independent cold reviews caught
  this (no code access); it surfaced only once the engine's `_replay()` was actually read.
- **Decision:** split the plan's two independent halves. (1) **`MUT` bridge: done now.** DM Console imports
  `MUT` from `js/engine.js` (matching Live Sheet, which already did this); its local copy — and the two
  confirmed bugs — are gone. `MUT` has no relationship to `_raceTraitLocked`/replay-driven pricing, so this
  half is genuinely behavior-preserving except for the two intentional bug fixes. (2) **`foldBuild`/
  `activeEvents`/`economy` bridge: paused.** Left as the still-open, not-yet-designed part of
  `feat/engine-bridge-all-tools` — needs a lock-state migration strategy for existing LOGs before it can
  proceed safely; see the plan doc's Addendum for the open design question.
- **Why:** the two halves are independent — `MUT`'s bugs are real, verified, and low-risk to fix immediately;
  the fold/economy bridge is not (it silently touches live AP totals and directly contradicts a very recent,
  deliberate decision). Splitting them lets the safe half land now instead of blocking on the harder
  problem, and keeps `feat/engine-bridge-all-tools` honestly scoped to what's actually unresolved rather than
  re-closing a question D-GH34 already settled.
- **Status:** DONE (MUT bridge only). Verified: `tools/DM-Console.html`'s only two `MUT` call sites
  (`MUT.names(b,e)` and `MUT[e.cat](b,e.payload)`, both inside its local `foldBuild`) are compatible with the
  engine's `MUT` shape. `testing/tests/engine-parity.html` → 20/0 (headless-browser run, not just Node).
  DM Console's own browser-level smoke test was inconclusive in this sandbox — its module graph depends on
  `js/auth.js` → `js/supabase-client.js` → an external `esm.sh` CDN import that this sandbox's proxy could
  not complete (confirmed identical failure on the pre-change code via `git stash`, so not a regression from
  this change). `feat/engine-bridge-all-tools`'s fold/economy half remains open in
  `docs/PACT_ROADMAP.md`/AGENTS.md, now with the D-GH34 conflict documented so it isn't re-attempted naively.

## D-GH35 · CharGen event-sourcing model: build-equality undo, authoritative file loads, and a non-locking budget award
- **Context:** Phase 2 Steps 4–5 made CharGen event-sourced end-to-end — snapshot-based undo/redo, event-log
  persistence `{schema,rules,name,budget,LOG,SEQ,id}`, and `name`/`budget` as first-class LOG events
  (`name`/`award`). Three sub-decisions in that work are non-obvious enough that a future agent would
  otherwise re-litigate them.
- **Options / Decisions:**
  1. **Undo restore = DOM-rebuild (build-equality), NOT `LOG = frame.log` (event-equality).** `restoreFrame`
     sets `LOG = f.log` then calls `applyBuild(foldBuild(f.log))`, which *rebuilds* the LOG from the DOM it
     just wrote (via `_buildEventBurst`) rather than keeping `f.log` verbatim. An internal first-pass review
     (finding **F2**) proposed making `LOG = f.log` the default to preserve exact event identity; the
     external cold reviewer argued against it, and the code settled it: CharGen's LOG is *already*
     regenerated synthetically (fresh `seq`/`ts`, blanket `noLock`) on **every** whole-build op, so exact
     event identity was never a guarantee. The contract is **build equality**, and the single canonical LOG
     builder is `_buildEventBurst`. `LOG = f.log` is kept only as a documented bug-containment fallback if a
     field ever fails to round-trip (it didn't). *(F2 was reversed.)*
  2. **A native saved file DOES reinstate the authoritative saved LOG** (`_cgApplyEnvelope` sets
     `LOG = d.LOG` verbatim after the DOM repaint) — the opposite of undo. Reason: `size` (and any
     compute-managed field parked in a hidden control) does **not** round-trip through `applyBuild`'s DOM
     re-derivation, and a persisted file must reload *exactly* as saved ("what you saved is what you load").
     Undo is an in-session op where build-equality suffices; a file load is a durable artifact where the
     stored LOG is authoritative. Different contracts for the two paths, on purpose.
  3. **The CharGen budget `award` must NOT lock undo history** (the roadmap's "AP-award lock semantics"
     turned out to be a *negative* requirement). In the Live Sheet an `award` locks history (actual-play
     integrity); CharGen budget is a freely-editable creation parameter, so it must stay undoable. CharGen's
     snapshot undo has no award-lock guard, so this is correct by construction; the award is tagged
     `noLock` to also stay out of the creation-pricing lock.
- **Why:** the LOG is a *build-equality artifact*, not a pristine event history — so undo optimises for
  surfacing `applyBuild`/`_buildEventBurst` divergence bugs (rebuild, don't mask), while file load optimises
  for exact reproduction (trust the saved bytes). Conflating the two would either mask bugs (undo) or lose
  compute-managed fields like `size` (load).
- **Status:** In force (build v0.200, on `main`). A back-compat reconcile in `_cgApplyEnvelope` heals older
  (Step-4) files whose top-level name/budget drifted from a stale LOG `name`/`award`.

## D-GH34 · compute() supports two racial-trait pricing formats: replay-derived (presence-based) and legacy (inPlay fallback)
- **Context:** an 8-angle code review of the D-GH31/32/33 work (run before any further Phase 2
  implementation) found that D-GH31 introduced a live, shipping regression: `compute()`'s racial-trait
  pricing switched from reading a whole-build `b.inPlay` flag (unconditionally `true` via `baseBuild()`,
  so every tool always got correct, expensive current-tier pricing) to reading a per-trait
  `b._raceTraitLocked[label]` map populated **only** inside the engine's own internal `_replay()`. Two of
  the three UI tools (the ongoing event-sourced character-sheet tool and the DM-facing roster tool) each
  have their own separate, hand-copied, index-based `foldBuild` — a known, pre-existing, documented
  architecture fact, not something D-GH31 touched — that never calls `_replay()` and so never populates
  `_raceTraitLocked`. Result: racial-trait pricing in those two tools silently and permanently dropped to
  the cheap creation rate for every character, forever — not a narrow migration edge case, a total loss
  of the tier upcharge the rules intend ("always hard to grow into your heritage late"). A related display
  feature (a "paying a premium vs. creation-basis pricing" comparison banner, driven by forcing
  `inPlay:false` on a comparison copy) went silently inert for the same root-cause reason. Separately, the
  `noLock:true` mechanism (built in D-GH31 specifically anticipating "a future CharGen-style export") was
  never actually wired into the one function that produces such an export (`buildToLiveLog()`) — currently
  dormant since nothing yet emits `campaignBound`, but would have mispriced racial traits in
  higher-budget imported characters as soon as that landed. Both were confirmed via independent code
  review (4 of 8 finder angles independently converged on the pricing regression) and formal verification
  before this fix; a cold-reviewed plan (`docs/plans/2026-07-08-racial-trait-pricing-regression-fix.md`)
  was written and revised before implementation.
- **Options considered:** (A) a presence-based per-trait fallback inside `compute()` itself — if a trait
  has a real `_raceTraitLocked` entry, use it (whichever value); if the entry is absent entirely, fall
  back to `b.inPlay`. (B) actually bridge the two affected tools onto the engine's real, array-parameter
  `foldBuild`/`activeEvents`/`economy` (replacing their local index-based copies) — the already-separately-
  tracked `feat/engine-bridge-all-tools` migration, previously found to have real signature-incompatibility
  problems needing its own design work. (C) have each affected tool's local fold logic manually compute
  and set its own `_raceTraitLocked` map — a third, tool-local copy of the same bookkeeping `_replay()`
  already does.
- **Decision:** (A). `compute()`'s racial-trait pricing now checks **key presence, not truthiness** —
  `Object.prototype.hasOwnProperty.call(b._raceTraitLocked, label)` — because the engine's real replay can
  legitimately set an entry to `false` (a trait bought before any lock trigger fired, a genuine "not
  locked" answer), and that must not be conflated with "no entry at all, unknown, fall back." Present
  (either value) → use it directly. Absent → fall back to `b.inPlay`, which `baseBuild()` still sets `true`
  unconditionally, exactly restoring the two affected tools' pre-D-GH31 behavior. This is a **permanent,
  intentional dual-format contract**, not a temporary shim: `compute()` now knowingly supports
  replay-derived builds and independently-constructed ("legacy") builds side by side. Separately,
  `buildToLiveLog()`'s single `ev()` emission funnel now tags every event `noLock:true` unconditionally
  (not per-call-site), so no future addition to that function can accidentally skip the tag.
- **Why:** (A) over (B) because bridging the two tools' fold logic is a large, already-separately-tracked
  migration with known unresolved design problems — pulling it into a bug-fix-scoped task would both blow
  the scope and preempt that work. (A) over (C) because manually re-deriving the lock state in tool-local
  code is exactly the "reimplement rules logic outside the shared engine" the project's own rule forbids,
  and would create a third copy to keep in sync — the opposite direction of D-GH33's cleanup in the same
  area. The general lesson for future engine changes, worth restating: **an engine change that introduces
  state derived only from replaying a LOG (rather than a value every build starts with) must either
  remain compatible with callers that construct build objects independently of that replay path, or
  explicitly define and document the compatibility boundary where it doesn't** — D-GH31 did neither for a
  caller (the two hand-copied local folds) that already existed and was already known to bypass the
  engine's real replay function.
- **Status:** DONE. `DATA.version` v0.334→v0.335. Presence-based fallback verified directly: a
  Live-Sheet/DM-Console-shaped build (racial traits, `inPlay:true`, no `_raceTraitLocked` at all) now
  prices at 11 AP (locked/expensive), matching pre-regression behavior exactly, vs. 6 AP (cheap) before
  this fix; the "creation-basis reprice" banner now produces a genuinely different number again
  (32 vs. 29 for a test build) instead of always matching the headline total. `buildToLiveLog()` verified
  in a real browser: all emitted events carry `noLock:true`; a high-budget (150 AP) build with racial
  traits, exported and later bound to a campaign, stays correctly creation-priced (6 AP) instead of
  mispricing to the locked rate. Three new fixtures (`CG-004`–`CG-006`) cover the no-map fallback, mixed
  per-trait state, and a specific presence-vs-truthiness regression guard (a value chosen so a future
  regression to `!!map[label]` truthiness-only checking would produce a different, wrong total — 10
  instead of the correct 12 — making that exact mistake fail a test instead of shipping silently).
  `testing/tests/engine-parity.html` → 16/0.

## D-GH33 · CharGen imports the real js/engine.js MUT/foldBuild/activeEvents/economy/baseBuild (Phase 2 step 2)
- **Context:** Phase 2's plan (step 2) called for replacing CharGen's two local, throwaway copies of
  `MUT`/`foldBuild`/`activeEvents`/`economy`/`baseBuild` with the real, already-exported `js/engine.js`
  versions, and explicitly flagged as a risk to check first: "behaviour parity between engine's
  `MUT`/`foldBuild`/`activeEvents`/`economy` and CharGen's local throwaway copies... if they've drifted,
  swapping them introduces regressions that look like save-format bugs."
- **The parity check found real drift** in CharGen's local copy (nested inside `_lsImportFold(LOG)`, used
  only when importing a Live-Sheet-shaped file into CharGen) — matching, byte-for-byte, a divergence this
  project had already documented for DM Console's separate local `MUT` copy: `MUT.found` had no
  else-branch for "this tradition already exists — add a second discipline to it," so a second `found`
  event for an already-founded tradition slot was silently dropped instead of appending a discipline
  (multi-discipline spellcasters lost their second discipline on import); and `MUT.dbound` (the
  discipline-bound flag) didn't exist in the local copy at all, so `dbound` events silently no-opped.
  `baseBuild()` was verified byte-identical; the local `activeEvents`/`economy`/`foldBuild` were
  behaviorally equivalent to the engine's (just index- vs array-parameterized, and only ever called with
  the full log in this specific usage, so the signature difference didn't block a direct swap here).
  A second, smaller local `MUT` subset inside `buildToLiveLog()` (export path, used only to compute
  before/after price deltas) had no drift — every category it used matched the engine's mutator exactly —
  but was still replaced with the real import as unnecessary duplication.
- **Decision:** CharGen's module bridge now imports `MUT`, `foldBuild`, `activeEvents`, `economy`,
  `baseBuild` from `js/engine.js` alongside its existing `DATA`/`compute` (D-GH26). `_lsImportFold(LOG)`
  collapses to a direct call to the real `foldBuild(LOG)` (the array-parameter engine version) — the
  bug fixes above are an automatic side effect, not separately implemented. `buildToLiveLog()`'s smaller
  local `MUT` subset is deleted in favor of the same import. CharGen's live editing state (DOM/
  `readBuild()`/`render()`/the ~75 UI handler sites) is untouched — this step only changes what backs
  the import and export paths, not how a character is built interactively.
- **Why:** this is exactly the parity check the Phase 2 plan called for before the swap, done in the
  order the plan specified (verify parity, then swap) rather than swapping first and discovering drift as
  a live regression. The bugs found were real and shipping — any multi-discipline character (or one with
  a bound discipline) exported from Live Sheet and re-imported into CharGen for further editing would have
  silently lost data. Fixing them as a byproduct of the planned engine-bridge work, rather than as a
  separate targeted patch, means there's now exactly one `MUT`/`foldBuild` implementation for this codebase
  to keep correct, not three (engine.js, CharGen's import copy, CharGen's export copy).
- **Status:** DONE. Verified in a real browser: CharGen boots clean with the expanded bridge
  (`DATA.version` v0.334 confirmed live); a synthetic two-discipline-plus-`dbound` LOG round-trips through
  `_lsImportFold` correctly (previously would have dropped the second discipline and the bound flag); a
  representative build (species, skills, racial traits) round-trips through `buildToLiveLog` →
  `foldBuild` → `compute()` at an identical price before and after. `testing/tests/engine-parity.html`
  unaffected (13/0 — this step touched no `js/engine.js` code). CharGen's `js/engine-v0-snapshot.js`
  frozen comparison copy is deliberately **not** updated to include this fix — it's meant to stay pinned
  to its original 2026-07-08 snapshot for Phase 2 before/after comparison, so this bug fix is intentionally
  only visible in the live tool, not the v0 comparison baseline.

## D-GH32 · Automatic `creationLocked` requires a `campaignBound` event; the explicit trigger doesn't
- **Context:** Phase 2 of the CharGen/Live-Sheet unification effort (`docs/plans/2026-07-08-chargen-
  livesheet-unification-phase2.md`) settled a fuller design for `creationLocked` than D-GH31 shipped:
  four trigger paths (explicit "Finalise character" button, automatic threshold, retroactive-on-binding,
  and first locking DM AP award), and specifically that the *automatic* threshold trigger should only
  ever fire for a character that has joined a real cloud campaign — a purely local, never-bound character
  should stay creation-priced indefinitely regardless of how much it spends; only an explicit action can
  lock it. D-GH31 shipped the automatic trigger unconditionally (any character crossing `DATA.level1AP`
  auto-locked, local or not) — correct for that phase's narrower scope, but not the final intended rule.
- **A naming risk surfaced during implementation and is recorded here to prevent future confusion:**
  `js/engine.js` already has an unrelated `MUT.campaign` mutator (`cat:'campaign'`), set by Live Sheet's
  `applyCampaignCode()` — this is a **local, offline, code-paste house-rules feature** (a DM types up
  banned boons/drawbacks/arts and shares a text code), already flagged elsewhere in this project's roadmap
  as a confusing naming collision with the *real* cloud campaign system. The new `campaignBound` event
  introduced here is unrelated to `b.campaign`/`cat:'campaign'` — it represents real cloud-campaign
  membership. Verified directly: today, real campaign membership lives only as a `campaign_id` column on
  a character's row in Supabase (`js/campaign.js`'s `listMyCampaigns`/`getCampaign`), invisible to pure
  LOG replay — which is exactly why a LOG-level `campaignBound` event is necessary at all: `_replay()` has
  no database access and needs some in-LOG signal to know whether a character has ever been bound.
- **Decision:** in `_replay()` (`js/engine.js`), the automatic (threshold-based) `creationLocked` inference
  now requires a `campaignBound` event to have occurred earlier in the LOG; the explicit `creationLocked`
  event remains unconditional (fires regardless of campaign binding — it's the primary intended trigger).
  If `campaignBound` arrives *after* spend has already crossed the threshold, the automatic lock fires
  retroactively at the exact point of binding (not applied to purchases before it). `campaignBound`
  carries a campaign ID payload but `_replay()` doesn't otherwise interpret it — it's purely a boolean
  gate for this mechanism today. `DATA.version` v0.333→v0.334 (a real behavior change, not display-only).
- **Why:** without this gate, a player who never joins a campaign — building and playing a character
  entirely locally, exactly like CharGen's existing standalone use case — would have their racial-trait
  pricing silently jump to the expensive tier-based rate the moment cumulative spend crossed the anchor,
  with no DM, no campaign, and no explicit action from the player. That's surprising and punitive for the
  offline/local use case this project explicitly supports (`AGENTS.md`: "Local-only still works"). Gating
  on campaign membership means the automatic trigger only ever applies where a DM is actually present to
  set expectations; a solo/local player can only lock in via their own explicit action.
- **Status:** DONE. Engine-only (`_replay()` in `js/engine.js`); no tool emits `campaignBound` yet — that
  wiring is Phase 2 step 6. Existing D-GH31 fixtures `EV-003`/`EV-007` updated to include a `campaignBound`
  event (preserving their original per-purchase-tagging/`noLock` test intent under the new gate); two new
  fixtures added: `EV-008` (a local character's spend crossing the anchor does NOT auto-lock) and `EV-009`
  (a late `campaignBound` event retroactively locks going forward, not retroactively repricing purchases
  before it). `testing/tests/engine-parity.html` → 13/0.

## D-GH31 · A LOG-driven `creationLocked` event/threshold replaces the dead `b.inPlay` flag (engine Phase 1)
- **Context:** the owner proposed unifying CharGen and Live Sheet onto one event-sourced character model,
  with an explicit trigger marking when "character generation" ends and creation pricing stops applying —
  a more fundamental alternative to reconciling `compute()`/`economy()` (D-GH30's deferred
  `feat/ap-model-reconcile`). Investigation found `js/engine.js`'s `compute()` already had a `b.inPlay`
  flag doing exactly this, narrowly (racial/species trait pricing only) and inertly: `baseBuild()` sets
  `inPlay:true` unconditionally, and a repo-wide search found `inPlay:false` set in exactly one place — a
  display-only comparison, never real build state. A self-contained plan (`docs/plans/2026-07-08-creation-
  pricing-trigger-phase1.md`) was written, cold-reviewed (15 findings, all accepted), and revised before
  implementation.
- **Options considered (racial-trait repricing scope, Option A/B/C from the plan):** (A) generalize
  post-lock repricing to all purchase categories; (B) keep it racial-traits-only, just make the existing
  mechanic real; (C) make category scope data-driven via `DATA`. Also considered, and rejected during the
  plan's cold review: a single whole-build `inPlay` boolean set once triggered — rejected because it has
  no memory of purchase order, reproducing D-GH30's exact bug shape (a later state retroactively repricing
  earlier purchases).
- **Decision:** shipped **Option B** (racial-traits-only, matching today's scope) via **per-purchase
  tagging, not a whole-build flag**. `_replay()` walks the LOG once, tracking a one-way-ratchet `locked`
  state (an explicit `creationLocked` event, or cumulative AP spend exceeding `DATA.level1AP`, whichever
  comes first) and tags each racial-trait purchase with the lock state as of *just before* that specific
  purchase — so purchase order within one build is respected. `compute()`'s racial-trait pricing branch
  reads this per-trait tag (`b._raceTraitLocked[label]`) instead of `b.inPlay`; a build with no tag for a
  given trait (e.g. a flat one-shot creation build with no LOG at all) always prices at the creation rate,
  by design. A build-time correction: the plan assumed `DATA.level1AP` didn't exist (a regex miss during
  planning — the real text is `"level1AP":50` inside `js/engine.js`'s single-line `DATA` object literal,
  not matched by a `level1AP\s*:` search); it already existed as `50`. The plan's "Step 0" precursor was
  therefore unnecessary and skipped; the real value was used directly. A second gap, found only by
  actually building and testing the mechanism (not caught by cold review): a one-shot import/creation
  burst whose total legitimately exceeds the anchor (e.g. a higher-level starting character) would
  self-trigger the automatic lock partway through the burst, mispricing racial traits bought later in that
  *same* burst — before any real in-play spending occurred. Fixed with an event-level `noLock: true` flag:
  a `buy`/`buyoff`/`names` event so tagged is excluded from the automatic-threshold accumulation (real AP
  accounting via `economy()` is unaffected); a future CharGen-style export can tag its whole synthetic
  burst this way, while genuine post-import spending (untagged) still triggers the lock normally. Verified
  by fixture (`EV-006`/`EV-007`).
- **Why:** per-purchase tagging over a whole-build flag because the alternative provably reproduces
  D-GH30's bug class — this was the cold review's single most consequential finding. Option B over A/C
  because it's the smallest change that proves the event model, tagging design, and migration strategy,
  with the narrowest surface to verify; A/C are deferred to a future phase once B is proven in real use.
  Migration: `inPlay` is verified `true` for every existing character today, so the new logic can only
  ever make an existing low-AP character's racial-trait pricing *cheaper*, never more expensive — no
  separate migration mechanism needed, the same replay-time inference just runs uniformly on old and new
  LOGs alike.
- **Status:** DONE for the engine mechanism (`js/engine.js` `DATA.version` v0.332→v0.333; 6 new fixtures,
  `EV-002`–`EV-007`; `testing/tests/engine-parity.html` → 11/0). **Not done:** no tool emits a
  `creationLocked` event yet — CharGen, Live Sheet, and DM Console are all untouched in this phase, so
  nothing about either tool's real behavior changes until a Phase 2 (CharGen rewired onto this model) or
  Phase 3 (per-campaign/DM threshold configuration) lands. `feat/ap-model-reconcile` (D-GH30's deferred
  item) is superseded by this decision and closed in `docs/PACT_ROADMAP.md`/`CHANGELOG.md`.

## D-GH30 · Live Sheet's "AP left" reads the frozen ledger (`economy()`), not `compute()`'s retroactive recompute
- **Context:** the roadmap task `fix/livesheet-undo-bug` was filed as "undo() produces incorrect state,"
  suspecting the permanent "−1 AP, floor 1" discount from Martially/Magically Bound toggles wasn't being
  restored on undo. Investigation (replaying `undo()` across every event type and diffing against a full
  LOG re-fold) disproved that: `undo()` is a pure pop-and-refold and already matches
  `rebuildStateFromEvents()` byte-for-byte in every case tested. The real defect was a display bug: buying
  a cross-class feature *then* binding that class makes the headline "AP left" (`compute().remaining`,
  which retroactively discounts every feature of that class, including ones bought before the bind) drift
  one AP above the frozen-ledger `economy().available` that actually gates purchases (`buy()`,
  tools/PACT-Live-Char-Sheet.html:445) — a "phantom AP" the sheet advertises but won't let you spend.
  `priceOf()` already hard-codes a `-2` delta for `mbound`/`dbound` specifically to dodge this same
  "refund bug" in the frozen ledger (tools/PACT-Live-Char-Sheet.html:421) — the headline display just
  hadn't been given the same treatment.
- **Options considered:** (A) point the Live Sheet's three "AP left" displays (desktop econ line, mobile
  sticky bar, floating badge) at `economy().available` instead of `compute().remaining` — display-only,
  no engine change; (B) change `compute()`/`rebuildStateFromEvents()` in `js/engine.js` to stop
  retroactively discounting — but that logic is *correct* for CharGen's one-shot, order-free recompute,
  so this would need to be event-order-aware and risks CharGen regressions, a `DATA.version` bump, and
  `testing/expected` updates.
- **Decision:** (A). Live Sheet now displays `eco.available` in all three "AP left" locations
  (tools/PACT-Live-Char-Sheet.html:593-594). No `js/engine.js` change, no `DATA.version` bump,
  `engine-parity.html` stays 5/0 unaffected. Normal characters (who never bind a class after buying that
  class's other features) see no change in the displayed number.
- **Why:** smallest change that makes the sheet self-consistent with its own buy-gate and matches the
  app's existing "prices freeze at purchase / no retroactive refund" tooltips; avoids touching shared
  rules logic that CharGen depends on behaving the current way. The underlying model conflict — `compute()`
  is stateless/order-free by design, but event-sourced tools want frozen-at-purchase pricing — is **not**
  resolved by this fix, only the one user-visible symptom. That reconciliation (whether `js/engine.js`
  should grow a frozen-ledger-aware remaining-AP export, or the current per-tool split is the permanent
  design) is intentionally deferred — see the new NEXT roadmap item.
- **Status:** DONE for the display fix. The long-term engine-vs-ledger reconciliation is open — tracked in
  `docs/PACT_ROADMAP.md` NEXT.
## D-GH42 · Cloud/campaign status badge reads existing sync-ready state — no new cloud/auth plumbing
- **Context:** the "Cloud/campaign state is invisible to players" roadmap task needed Live Sheet to show a
  persistent sign-in + campaign-rules-fetch-status badge outside the ☁ Cloud dropdown. This was picked and
  built while another session was concurrently on `feat/engine-bridge-all-tools`, actively migrating
  `activeEvents`/`economy`/`foldBuild` (and touching the tools' bootstrap/module-bridge code) across all
  three tools — the same files this task needed to touch.
- **Options considered:** (A) add a dedicated status-tracking module/service with its own auth/campaign
  polling; (B) derive the badge purely from state the existing `sync-ready` closure already computes
  (`_session` from `A.onAuthChange`/`A.currentSession()`, campaign name + fetch outcome from the existing
  `refreshCloudCampaignRules()` and the cloud-load-btn handler), adding only two new local variables
  (`_campaignName`, `_rulesStatus`) and a `renderCloudStatusBadge()` call at their existing update sites.
- **Decision:** (B). No new fetches, no new globals beyond the two closure-local display variables, and
  zero edits to `js/engine.js`/`js/auth.js`/`js/sync.js`/`js/campaign.js` or the module-bridge bootstrap
  block itself — only the pre-existing `sync-ready` listener body and static header/toolbar markup in
  `tools/PACT-CharGen-Webtool.html`/`tools/PACT-Live-Char-Sheet.html` changed.
- **Why:** keeps this a strictly additive, display-only diff with minimal surface overlap against the
  concurrently in-flight engine-bridge migration, so both branches rebase cleanly against `preview`
  regardless of merge order. (A) was rejected as unnecessary duplication of state `refreshCloudCampaignRules()`
  already tracks, and as a larger, riskier diff for a display-only task.
- **Status:** DONE. If a future bridge migration changes how `_cloudCampaignRules`/campaign data is
  fetched, `renderCloudStatusBadge()`'s two call sites (`refreshCloudCampaignRules()` and the cloud-load
  button handler in `tools/PACT-Live-Char-Sheet.html`) are the only places that need updating.
- **Addendum (2026-07-10, docs-consistency audit):** originally logged as `D-GH30`, colliding with two
  other same-day entries also claimed as `D-GH30` (this one and "D-GH numbering: verify against the live
  remote…", both merged within ~8 minutes of each other on 2026-07-08 — the live-remote-check policy that
  same pair of collisions prompted "narrows the window but can't fully close it," per its own Why). Kept
  the earlier-merged "Live Sheet's 'AP left' reads the frozen ledger" entry at `D-GH30`; renumbered this
  one to `D-GH42` (next free at time of fix). `CHANGELOG.md`'s "surface cloud/campaign status" entry
  updated to match.

## D-GH43 · D-GH numbering: verify against the live remote before claiming, and treat renumber-on-merge as the accepted collision fallback
- **Context:** three separate D-GH decision-number collisions have already happened — D-GH19/D-GH20,
  D-GH25/D-GH27, D-GH26/D-GH28 — each because a session computed "next number = highest + 1" from a local
  snapshot read earlier in the session, then a concurrent session independently claimed the same number
  before either landed. Squash-merges hide the collision (git auto-merges the duplicate header cleanly, no
  conflict), so it's only ever caught by a human/agent noticing after the fact. This matches a general
  lesson now indexed in the cross-project `ai-lessons-learned` repo (H-022): "highest + 1" IDs computed from
  a local snapshot collide under concurrency — check against live remote state, or accept
  renumber-on-merge as policy.
- **Options considered:** (A) leave the convention as-is and keep fixing collisions ad hoc after they're
  noticed; (B) switch to a non-colliding ID scheme (date-suffixed or UUID) for all future entries; (C) keep
  the sequential `D-GH<N>` format — it's cross-referenced across `AGENTS.md`, the roadmap, and ~30 existing
  entries, so renumbering the scheme would be disruptive for no real gain — but (i) require checking the
  **live** remote `DECISIONS.md` immediately before claiming the next number, not a stale local read from
  earlier in the session, and (ii) explicitly document renumber-on-merge-collision as the accepted fallback
  rather than an ad hoc scramble each time it happens.
- **Decision:** (C). Before claiming a new `D-GH<N>` number, fetch the live default branch and re-derive the
  highest in-use number directly from it, e.g.:
  `git fetch origin preview && git show origin/preview:DECISIONS.md | grep -oE 'D-GH[0-9]+' | sort -t H -k2 -n -u | tail -1`
  — not from an earlier read in the session. If a collision still happens after merge (two sessions claimed
  the same number before either pushed — the live check narrows this window but can't fully close it), the
  fix is: keep the earlier-merged entry's number, renumber the later one to the next free number, and add an
  addendum note under the renumbered entry (the exact pattern already used for all three prior collisions) —
  no debate needed, this is now expected, documented behavior. Recorded in `AGENTS.md`'s "Multiple sessions"
  section.
- **Why:** (A) keeps paying the same recurring cost with no fix. (B) was rejected — the sequential format is
  cross-referenced by dozens of existing entries, the roadmap, and `AGENTS.md`; swapping formats doesn't
  eliminate the underlying race (a fresh scheme still needs a live check to avoid *other* kinds of drift) and
  adds churn for no proportionate benefit given collisions are rare (3 in 29 entries) and cheap to resolve
  post-hoc once the fallback is a known, documented step rather than a fire drill. (C) fixes the actual root
  cause named in every prior collision's addendum — a stale, non-live number check — while keeping the
  fallback that's already been proven to work three times.
- **Status:** DONE.
- **Addendum (2026-07-10, docs-consistency audit):** originally logged as `D-GH30`, colliding with two
  other same-day entries also claimed as `D-GH30` — including, ironically, this decision's own live-check
  policy: the collision happened anyway because the other `D-GH30` (the "Cloud/campaign status badge"
  entry) merged only ~8 minutes earlier, inside the window this decision's own Why already acknowledged
  the live check "narrows... but can't fully close." Kept the earlier-merged "Live Sheet's 'AP left' reads
  the frozen ledger" entry at `D-GH30`; renumbered this one to `D-GH43` (next free at time of fix, after
  `D-GH42` above). `AGENTS.md`'s numbering note and `CHANGELOG.md`'s "fix the recurring D-GH
  decision-number collision" entry updated to match; the four-collision count now reads D-GH19/20,
  D-GH25/27, D-GH26/28, D-GH30/42/43.

---

## D-GH29 · M365 Copilot is used only as a cold reviewer of self-contained plans — never as a repo-aware assistant
- **Context:** the project owner wanted to cut Claude Code token usage by routing project/doc review
  through **Microsoft 365 Copilot (Business)** (via M365 Chat / SharePoint / OneDrive / Edge — explicitly
  *not* GitHub or VS Code Copilot). M365 Copilot has no local repo access, no git, no code execution, and
  no repo-level code understanding; it only grounds on content explicitly given to it. Parsing 10 recent
  session transcripts showed the token premise was wrong anyway: cost is dominated by cache reads (~235M
  tokens = standing context re-read every turn), while *all* doc reads combined were ~114k — a rounding
  error. But one pattern had independently proven useful in practice: Claude drafting a plan and Copilot
  critiquing it.
- **Options considered:** (A) full pipeline — Copilot reviews the repo (via a OneDrive mirror), generates
  implementation task packs, Claude validates/implements; (B) keep only **Claude → Copilot → Claude cold
  plan review** — Claude writes a self-contained plan, Copilot critiques *plan quality* (no repo access),
  Claude triages and implements; (C) drop Copilot from the coding workflow entirely.
- **Decision:** (B). The `/plan-for-review` skill produces a self-contained plan; the human pastes it to
  M365 Copilot for a cold critique (logic/scope/assumptions/risks/acceptance/verification), then pastes the
  critique back for Claude to triage (accept/reject/defer/→test/→doc/→roadmap). Gated by: *use cold review
  only if a wrong approach would cost more than one implementation cycle to undo.* Rejected the OneDrive
  mirror, a separate `PACT-AI-CONTEXT.md`, and any Copilot-generated code/architecture.
- **Why:** the value is **avoided rework**, not saved tokens — and it works *because* the plan is
  self-contained, so Copilot's lack of repo/code awareness stops mattering (it reviews the writing, not the
  code). (A) was rejected because it assumes a code-awareness Copilot doesn't have (blind task packs Claude
  must re-derive), targets a token problem the data disproved, and the OneDrive mirror adds a `robocopy
  /MIR` data-loss footgun + indexing lag for no real gain; a separate context file duplicates `AGENTS.md`.
  (C) throws away a pattern the owner confirmed useful. Claude stays the final authority and verifies every
  Copilot finding against the actual code before acting.
- **Status:** DONE (PR #124). The *when* lives in `AGENTS.md`'s Agent-guidance rubric; the *how* in
  `docs/SKILLS.md` and `.claude/commands/plan-for-review.md`.

## D-GH27 · `/pick-task` may bundle several quick tasks into one branch/PR — the one exception to "one task per branch"
- **Context:** each `/pick-task` → `/run-task` cycle pays a fixed overhead regardless of task size — a
  live roadmap fetch, an `engine-parity` run, a rebase onto `preview`, and a PR — on top of the actual
  edit. For a genuinely small/low-risk task (docs-only, config, single-tool CSS/UI, the same class
  `/pick-task`'s "quick" filter already identifies), that fixed cost dominates the total token spend.
  The repo's existing convention is "one task per branch" (the open branch is the concurrency-safety
  signal for other sessions), so any batching has to not break that signal for tasks it doesn't cover.
- **Options considered:** (A) leave batching out of scope — every task, however small, still pays the
  full per-task overhead; (B) let `/pick-task` bundle several *quick-filtered* tasks into one shared
  branch/worktree/PR, provided each one is independently pre-flighted (branch-collision + effort/model
  checks) and none touch overlapping files; (C) batch any tasks regardless of size/risk classification.
- **Decision:** (B). Bundling is opt-in (offered via a clickable `AskUserQuestion`, never automatic),
  capped at 3 tasks total (primary pick + up to 2 more), and restricted to tasks that already passed
  Step 2's "looks small/quick" test *and* Step 3's per-task pre-flight individually — a candidate that
  fires the Opus/xhigh escalation trigger, or collides on files with another batch member, drops out of
  the batch rather than being forced through. Each bundled task still gets its own commit and its own
  `CHANGELOG.md`/roadmap-graduation line; only the branch/worktree/rebase/`engine-parity`-run/PR
  machinery is shared.
- **Why:** (C) was rejected because "one task per branch" exists specifically so a branch's existence
  reliably tells a concurrent session "someone's already on this," and so a PR stays one reviewable/
  revertible unit — bundling anything above quick/low-risk size would erode both properties for no
  proportionate token savings (a large task's edit cost dwarfs the fixed per-task overhead anyway, so
  there's nothing to amortize). (A) was rejected because the fixed overhead is real and the roadmap
  already has several genuinely independent quick items (docs-only checklist additions, config toggles)
  that gain nothing from individual branches/PRs. (B) keeps the collision-safety property for everything
  it doesn't cover, and keeps per-task traceability (commits, CHANGELOG lines) even for what it does.
- **Status:** DONE.
- **Addendum (2026-07-05):** originally logged as `D-GH25`, picked on a branch rebased before another
  session's PR (#113, retiring the leaked-password-protection roadmap item) independently claimed the
  same number. Both landed on `preview` via squash-merges that silently concatenated rather than
  conflicting — the same "clean auto-merge hides the collision" failure mode as the prior `D-GH19`/
  `D-GH20` incidents. Renumbered to `D-GH27` in a follow-up fix once found; `D-GH26` stays reserved for
  the engine module-bridge migration task per `docs/PACT_ROADMAP.md`.

## D-GH28 · Homepage theme artwork is hand-authored SVG, not photos/illustrations
- **Context:** the roadmap task asked for theme-specific image pools for a new homepage banner, randomly
  selected per active theme and re-rolled on switch. No image-generation tool was available in this
  session, and fetching real photos/illustrations from the web carries unclear licensing (and the project
  has a hard rule against generating/guessing URLs not related to programming help).
- **Options considered:** (A) fetch freely-licensed stock art from the web; (B) leave the feature as
  scaffolding only (pool/selection/re-roll logic wired, no real images) for a human to fill in later; (C)
  hand-author small original SVG banners, palette-matched to each theme's existing CSS custom properties.
- **Decision:** (C). Four SVGs added: `assets/themes/light/{parchment-scroll,heraldic-crest}.svg`,
  `assets/themes/dark/{starfield,dragon-ember}.svg`.
- **Why:** avoids any licensing risk entirely, needs no build step or external fetch (fits the "vanilla JS,
  static files only" hard rule), stays lightweight (a few KB of vector paths vs. photo-sized rasters), and
  reuses the same hex values as each theme's `--bg`/`--accent`/etc. so the artwork reads as intentional
  rather than a generic placeholder. (B) was rejected because a fully-wired feature with empty pools isn't
  actually demoable or "done"; (A) was rejected on licensing grounds.
- **Status:** DONE. Revisit if a human wants to swap in real illustrated art later — the pool arrays in
  `index.html`'s theme-switcher script are the only place that needs updating (`artPools.light`/`.dark`).
- **Addendum (2026-07-05):** originally logged as `D-GH26`, picked before a rebase surfaced that number
  as explicitly reserved for the engine module-bridge migration task (`docs/PACT_ROADMAP.md`, "don't
  reuse D-GH26 for anything else in the meantime"). Renumbered to `D-GH28` before this branch's PR
  landed — same class of collision as the `D-GH19`/`D-GH20`/`D-GH25` incidents, caught this time before
  merge rather than after.
- **Update (2026-07-05):** the SVG placeholders in the dark pool (`starfield.svg`, `dragon-ember.svg`)
  were superseded by real artwork (`assets/themes/dark/book-{closed,open}{,-banner}.webp`, supplied by
  the project owner) and deleted. The light pool still uses the original SVGs — no equivalent real art
  provided yet for that bucket. `source-assets/images/` was added alongside this for the full-resolution
  originals behind the new webp files (see `source-assets/README.md`).
- **Update (2026-07-05, superseding the above):** the project owner supplied dedicated banner art for
  all four named themes (2 images each), not just the dark ones. The light/dark-bucket model this
  decision originally established is retired — `artPools` is now keyed directly by theme name
  (`parchment`/`midnight`/`dragonfire`/`contrast`), each theme showing only art actually made for it.
  `assets/themes/light/` is deleted outright (superseded by `assets/themes/parchment/` and
  `assets/themes/contrast/`). `assets/themes/dark/` is also deleted, but its 2 interim book-art webp files
  were kept at the project owner's request rather than discarded — restored from git history into
  `assets/themes/midnight/`, where they now sit alongside midnight's 2 dedicated images (4 total in that
  pool). No SVG placeholders remain anywhere in the pools — every theme now has real supplied art. The
  Player's Guide cover (`pact-cover.jpg`) was also swapped to a smaller `assets/pact-cover.webp` in the
  same change, unrelated to the theme pools but supplied in the same asset batch.
- **Note:** `artPools` is a hand-written JS object in `index.html` — adding a file to a theme's directory
  does nothing on its own. There's no server-side directory listing or build step on a static GitHub
  Pages site, so every image path must be added to the relevant `artPools.<theme>` array explicitly.
## D-GH26 · Engine module-bridge migration shipped as a safe subset (DATA/compute/baseBuild + Live Sheet MUT), not the full seven symbols
- **Context:** The "Full engine module-bridge migration" roadmap task (and `AGENTS.md`, and D-GH9) framed
  all three tools as hand-copying seven symbols — `DATA`, `compute`, `MUT`, `baseBuild`, `activeEvents`,
  `economy`, `foldBuild` — and asked to migrate them by importing all seven onto `window` and deleting the
  local copies. A compat check **before editing** found the premise only partly true, and that a literal
  import-and-delete would break the tools:
  - **`activeEvents`/`economy`/`foldBuild` are signature-incompatible.** The engine exports take an events
    *array* — `foldBuild(events)`; all three tools' versions take an *index* and close over a script-level
    `LOG` — `foldBuild(uptoIdx)`, called as `foldBuild(null)`/`foldBuild(viewAt)`. Importing the engine
    versions and deleting the local ones would break event-sourcing + time-travel in Live Sheet/DM Console
    and the import-fold path in CharGen. Reconciling them means rewriting every call site to pass `LOG`
    slices — a much larger change to the event-replay core than the task described.
  - **CharGen has no top-level `baseBuild`/`MUT`/`activeEvents`/`economy`/`foldBuild` at all** — only
    `DATA` and `compute`. The rest are local closures inside `_lsImportFold`/`buildToLiveLog` (the D-GH3
    export bridge), specialized, not the engine's versions.
  - **DM Console's `MUT` diverges** — its `found` lacks the add-discipline-to-existing-tradition
    else-branch and it is missing `dbound` (D-GH9 updated engine + Live Sheet in lockstep but not DM
    Console). Bridging DM's `MUT` is a real behavioral change, not a no-op.
  - `DATA` (byte-identical across all four when parsed), `compute` (each tool's `compute(b)` is the
    engine's minus the additive `opts`/`spendable` block — a safe superset), `baseBuild` (identical modulo
    a trailing comment), and Live Sheet's `MUT` (identical to the engine's) **are** cleanly bridgeable.
- **Options:** (A) do the literal full migration — rewrite all `activeEvents`/`economy`/`foldBuild` call
  sites, reconcile DM's `MUT`, untangle Live Sheet's dual `validate` — a large, risky change to two
  event-sourced tools that can't be browser-verified headlessly; (B) bridge only the verified-compatible
  subset now (`DATA`+`compute`+`baseBuild` for all three, plus `MUT` for Live Sheet), leave the index-based
  event functions and DM's divergent `MUT` local, and carve the reconciliation into a separate task; (C)
  don't touch code, just correct the roadmap.
- **Decision:** (B), chosen by the user after the compat evidence was laid out. Each tool now imports its
  safe subset in a `<script type="module">` that copies the symbols onto `window` and dispatches
  `engine-ready`; each tool's UI bootstrap is gated on that event (deferred modules execute after the
  classic scripts, so the symbols aren't present at parse time — an ungated bootstrap would throw). The
  inline `DATA`/`compute` (all three), `baseBuild` (Live Sheet, DM Console) and `MUT` (Live Sheet only)
  copies were deleted; the per-tool display-only `DATA.racialFx` augmentation moved into each module bridge.
  CharGen — previously fully local with no module bridge — gained its first one.
- **Why:** the task's real point is to stop the duplicated rules *data and calculator* from drifting;
  `DATA` (a 194 KB table) and `compute` (a ~330-line function) per tool are the bulk of that and are
  provably safe to bridge. The event-sourcing functions are a different kind of code — stateful closures
  with a deliberately different (index-based) API — whose migration is a separate, larger piece of work
  with real regression risk to the buy→event→replay path, not worth folding in here. Keeping DM's `MUT`
  local preserves its current replay behavior exactly (bridging it is a latent-bug fix to be done
  deliberately, with its own test). Verified in a real browser: all three tools boot with no console
  errors, `compute`/`foldBuild`/`economy` produce correct values, a Live Sheet buy still emits exactly one
  event, DM's `dmAnalyze` replays the LS-001 fixture to total 78, and `engine-parity.html` stays 5/0.
- **Status:** IN FORCE. Bridged: `DATA`, `compute`, `baseBuild` (+ Live Sheet `MUT`). Still local:
  `activeEvents`, `economy`, `foldBuild` (all three), `MUT` (CharGen local closures; DM Console divergent).
  Supersedes the `DATA`/`compute`/`baseBuild` portion of D-GH9's "still copy-pasted" status. The remaining
  reconciliation (event-function signatures + DM `MUT`) is handed back to the roadmap as a revised task.

## D-GH24 · CharGen/Live Sheet theme-restore check stays at the bottom of `<body>`, not inline in `<head>`
- **Context:** the theme-selector fix (PR #109) added a `prefers-color-scheme: dark` fallback to both
  tools' theme-restore IIFE, matching `index.html`'s "saved choice wins, else system dark, else default"
  logic. The roadmap task that spawned this fix explicitly suggested also moving the check inline into
  `<head>` (as `index.html` does) to avoid a flash of the wrong theme before JS runs, and asked to "note
  in the PR if that's not practical and why."
- **Options considered:** (A) move the restore IIFE into an inline `<head>` `<script>`, matching
  `index.html`'s pattern exactly; (B) leave the check where it already ran (near the end of `<body>`,
  after the header markup), only adding the `matchMedia` fallback in place.
- **Decision:** (B).
- **Why:** `index.html`'s theme system is `documentElement`-scoped (`html[data-theme=...]`), which is set
  before `<body>` exists — that's *why* it can safely run in `<head>`. CharGen's and Live Sheet's theme
  CSS is `body`-scoped (`body[data-theme="dark"]`, etc., dozens of selectors across both files'
  stylesheets) and `document.body` doesn't exist yet while `<head>` is parsing, so the same early-run
  trick isn't a drop-in port — it would require converting every `body[data-theme=...]` selector in both
  tools to `html[data-theme=...]` first, a materially larger and riskier CSS change than this fix's scope
  (mobile-hidden + desktop-clipped selector, plus the dark-mode default). A future agent picking up the
  "flash of wrong theme on load" follow-up should start from the CSS-scope conversion, not from the
  restore-script's position — the script's position was never the blocker.
- **Status:** DONE (for this fix's scope). The `<head>`-timed version remains open as unclaimed follow-up
  work, not currently tracked as its own roadmap item.

## D-GH25 · Leaked-password-protection roadmap item retired, not enabled
- **Context:** the 2026-07-02 post-merge security audit flagged `auth_leaked_password_protection`
  (Supabase Auth checks new/changed passwords against HaveIBeenPwned) as disabled, and a roadmap item
  asked for it to be enabled by hand in the Supabase dashboard (no code/migration involved — Auth config
  isn't reachable via any MCP tool or SQL). On attempting the toggle, the project owner found Supabase
  gates this feature behind a paid plan tier.
- **Options considered:** (A) upgrade the Supabase plan to enable it; (B) leave the toggle off and drop
  the roadmap item.
- **Decision:** (B). The project owner declined to pay for a plan upgrade for this one feature.
- **Why:** cost/benefit — PACT is a hobby tabletop-tool suite, not a project with a security budget; the
  underlying risk (reused/breached passwords) is mitigated by the free `auth_leaked_password_protection`
  advisor continuing to flag it on every future security-advisor check, so the gap stays visible even
  though it's not fixed.
- **Status:** DONE (roadmap item removed; not revisited unless the plan tier changes or the owner
  reconsiders).
## D-GH23 · `/pick-task` Step 1 delegates its four `git show` fetches to an Explore subagent
- **Context:** `/pick-task` (née `/next-task` Step 1) needs the live `preview`-branch copies of
  `AGENTS.md`, `docs/PACT_ROADMAP.md`, `testing/tests/engine-parity.html`, and
  `testing/expected/expected-results.csv` before it can pick or pre-flight a task — but reading all four
  inline puts their full content in the picking session's own context for a result that's really just
  four facts (branch convention, pass count, NOW/NEXT TODOs, highest `D-GH#`).
- **Options considered:** (A) keep the four `git show` calls inline, as `/next-task` always did; (B)
  delegate the fetch-and-summarize step to an `Explore`-type subagent via the `Agent` tool, returning only
  the compact summary.
- **Decision:** (B). `/log-ai-lessons` already uses this exact pattern for its directory/glob case (delegate
  the bulk reading, keep only the drafted output) — this extends the same convention to `/pick-task`.
- **Why:** the picking session doesn't need the raw file contents to stay in its own context for the rest
  of the conversation; only the four derived facts do. Not retrofitted onto `/close-session`, which reads
  local repo state rather than fetching remote files, so the same justification doesn't apply there.
- **Status:** DONE.
- **Addendum (2026-07-04):** the subagent delegation isolates the read cost from the *picking session's*
  context, but doesn't reduce the *total* tokens spent — the subagent still pays for all four files, fresh,
  on every invocation. Auditing that cost found `testing/tests/engine-parity.html` (10KB) contributed
  nothing toward the "current expected pass count" fact: that number is just the row count in
  `testing/expected/expected-results.csv`, which is fetched separately. Dropped the `engine-parity.html`
  fetch; Step 1 now pulls three files, not four. `testing/tests/engine-parity.html` is unaffected — it's
  still the actual test harness `/run-task` runs; only its role in the `/pick-task` fetch is gone.

## D-GH22 · `/run-task` uses native Claude Code worktrees (`EnterWorktree`), superseding the "Option A" sibling `pact-worktrees/` folder layout
- **Context:** `/next-task`'s manual worktree code (`git worktree add -b <slug> <worktrees-root>/pact-worktrees/<slug> origin/preview`, plus `-C <path>` on every later git call) had a path-arithmetic bug — `worktrees-root` was already defined as ending in `pact-worktrees`, so the `git worktree add` line doubled it into `.../pact-worktrees/pact-worktrees/<slug>`. Fixing that bug was itself an open question at the same time Claude Code's native `--worktree` flag / `EnterWorktree` tool (v2.1.50+) became available, which does the create/branch/cleanup automatically instead of via ~30 lines of manual prompt logic.
- **Options considered:** (A) fix the doubled-path bug in place, keeping the sibling
  `<repo-parent>/pact-worktrees/<slug>` folder layout previously agreed as the intended structure
  ("Option A" — one `pact-worktrees/` folder next to the PACT folder, each task inside it); (B) adopt
  native `EnterWorktree`/`--worktree`, which always creates worktrees under `.claude/worktrees/<name>/`
  inside the repo itself — there is no setting to redirect that location short of a `WorktreeCreate` hook,
  which replaces the tool's git logic entirely and was ruled out of scope for this change.
- **Decision:** (B). **This explicitly supersedes the earlier "Option A: sibling `pact-worktrees/` folder"
  decision** — worktrees now live at `.claude/worktrees/<slug>/` (added to `.gitignore`), not next to the
  repo. `EnterWorktree` sanitizes `/` out of its `name` argument (`feat/foo` → directory
  `feat+foo`, branch `worktree-feat+foo`), so `/run-task` Step 4 renames the branch with `git branch -m`
  immediately after creation — verified working directly in-session (see `run-task.md` Step 4 for the
  exact caveats). Worktrees branch from the repository's actual GitHub default branch, confirmed to be
  `preview` (`git remote show origin` → `HEAD branch: preview`), so no `worktree.baseRef` override is
  needed.
- **Why:** the automation/safety wins (trust handling, automatic branch creation, cleanup on exit,
  project-scoped plugin inheritance) outweigh the cosmetic location change, and there's no way to keep
  both the native tooling and the old sibling-folder layout without adding a new hook, which this change
  was scoped to avoid.
- **Status:** DONE.

## D-GH21 · `/plan-for-review` output is a trust-boundary crossing artifact — secrets excluded by instruction, not by gate
- **Context:** the new `/plan-for-review` skill (`.claude/commands/plan-for-review.md`) drafts a plan and
  writes it to `docs/plans/<date>-<slug>.md`, explicitly designed so a *different* AI tool with no repo
  access can review it cold. That means the doc is expected to leave PACT's trust boundary (pasted into
  an unrelated third-party AI/chat), unlike every other skill's output, which stays inside this repo/session.
- **Options considered:** (A) no special handling — same as any other docs file; (B) instruct the drafting
  step to never inline secrets/credentials/tokens, describing constraints instead of quoting values; (C)
  add an automated scan (e.g. a gitleaks-style check) before the file is written.
- **Decision:** (B) — an explicit instruction in the skill (Step 3) to paraphrase the *existence* of a
  constraint rather than quote sensitive values, plus keeping the write→commit→push stages separate and
  each individually opt-in, so a drafted plan doesn't leave the local filesystem (let alone the repo)
  without an explicit ask.
- **Why:** this was flagged independently by three cold-reviewer passes run against the skill's own first
  output (a plan for adding itself) — confirming the risk is real, not hypothetical, for a skill whose
  entire purpose is producing self-contained docs for an external reader. (C) was rejected as
  disproportionate machinery for a docs-only, human-in-the-loop workflow (every write already requires
  explicit approval per Step 5); revisit if `docs/plans/` usage grows enough that an automated check
  becomes worth the overhead.
- **Status:** DONE. No secret has ever actually been written via this skill; this is a preventive
  instruction, not a response to an incident.

## D-GH20 · `ai-lessons-learned` auto-load in remote sessions: nudge-and-let-the-agent-decide, not auto-clone
- **Context:** a `SessionStart` hook (`.claude/hooks/session-start.sh`) was built to auto-load a
  separate, private cross-project repo (`chompy78/ai-lessons-learned`) into every remote/cloud
  session's context, using a fine-grained PAT (`AI_LESSONS_TOKEN`) to `git clone` it. Retesting
  with a freshly regenerated, correctly-scoped PAT still failed identically. Root-caused: remote
  sessions route all `github.com`/`api.github.com` traffic through a policy-enforcing proxy that
  injects the *session's own* scoped GitHub App credentials, overriding any PAT in the URL —
  a session can only reach repos in its explicit scope, and `ai-lessons-learned` wasn't in it.
  The only working fix was calling the `add_repo` agent tool from inside a turn — which a
  non-interactive shell hook cannot do, and which is documented to be invoked only when a task
  actually calls for it, not unconditionally every session.
- **Options considered:** (A) split into a private source repo + a public mirror containing only
  `INDEX.md`, auto-published by a GitHub Action, fetched by the hook via a plain unauthenticated
  `curl` of `raw.githubusercontent.com` — empirically verified viable (that domain is *not*
  gated by the session's GitHub-scoping proxy: tested against a public repo and a public Gist
  fully outside this session's scope, both returned real content; the private repo's raw URL
  correctly 404s unauthenticated); (B) GitHub Pages built from the private repo — dead end, Pages
  from a private repo still requires GitHub auth to view, hitting the same scoping wall; (C) drop
  automatic fetching entirely — the hook just prints a short reminder in remote sessions, and the
  agent calls `add_repo` + reads `INDEX.md` itself only when the current task looks relevant.
- **Decision:** (C). Rewrote `.claude/hooks/session-start.sh` to remove all `git
  clone`/`AI_LESSONS_TOKEN` logic; it now only prints a fixed, small reminder string in remote
  sessions pointing at the repo and telling the agent to pull it in itself if warranted.
  `AI_LESSONS_TOKEN` is no longer read anywhere in this repo.
- **Why:** the user expects `ai-lessons-learned` to accumulate a lot of private session detail
  over time and wants it to stay **fully** private — not "mostly private with a small public
  index," which is what option A would have required (once `INDEX.md` is published anywhere
  public, even a curated summary, it's a permanent trust boundary: cached/scraped copies can
  outlive a later switch back to private). Given that, the token cost of "fully automatic every
  session" (paying to load `INDEX.md` even on sessions that never touch it) was judged not worth
  crossing that boundary for. Option (C) trades full automation for near-zero cost on unrelated
  sessions and a full pull-in on sessions that actually need it.
- **Status:** DONE. Hook rewritten and verified (remote: prints reminder, exit 0; non-remote:
  silent, exit 0). Local-machine loading (`~/.claude/CLAUDE.md` `@`-import of `INDEX.md`) is
  unaffected — it never went through this proxy in the first place.

---

## D-GH19 · Live Sheet mobile CSS: `!important` to fix a silent cascade-order shadowing bug
- **Context:** While fixing the "Live Sheet unusably cramped on small mobile screens" roadmap task,
  found that most of the existing `@media(max-width:600px)` mobile-tuning block (`.abrow`/`.kpis`
  ability-score columns, `.ib`/`.cath` font/padding bumps) had **no visible effect at all** — verified
  live with a headless browser: at a 375px viewport, `.abrow`'s computed `grid-template-columns` was
  still 6 equal columns, not the intended 3. Root cause: that `@media` block is declared near the top of
  `tools/PACT-Live-Char-Sheet.html`'s `<style>`, **before** several unconditional base rules for the same
  selectors (`.abrow`, `.kpis`, `.ib`, `.cath`) that appear later in the file. CSS resolves equal-specificity
  conflicts by source order — the later rule wins regardless of whether it's the "general" or "specific"
  one conceptually — so the later, unconditional desktop rule silently beat the earlier mobile override at
  every width, including mobile. This is a pre-existing, previously-undiagnosed bug, not something
  introduced by this task; the "M1" comment on that block reads as though the 3-column mobile override was
  already working.
- **Options:** (i) reorder the whole `<style>` block so all `@media` overrides come after every
  unconditional rule they need to beat; (ii) raise specificity of the shadowed mobile declarations with
  `!important`, touching only the specific properties proven to be shadowed; (iii) leave the pre-existing
  breakage alone and only guard the new `.slotgrid`/`.spcols`/`.shabrow`/`.shkpis` rules added by this task.
- **Decision:** (ii), for both the new CSS added by this task **and** the pre-existing `.abrow`/`.kpis`/
  `.ib`/`.cath` overrides directly relevant to "text and tap targets are legible" (the task's own
  Done-when). Added `!important` only to the specific declarations verified shadowed (`grid-template-columns`
  on `.abrow`/`.kpis`/`.shabrow`/`.shkpis`/`.slotgrid`/`.spcols`; `font-size`/`padding` on `.ib`/`.cath`) —
  not blanket-applied across the block.
- **Why:** (i) is the textbook-correct fix but means reordering ~250 lines of CSS in a 2700-line file with
  at least one other later, overlapping `@media(max-width:880px)` block touching some of the same
  selectors (`.top`, `.top h1`) — verified the specific overlap is low-risk (a 15px-vs-16px `.top h1` font
  difference) but a full audit of every possible downstream interaction was out of scope for this task.
  (iii) would leave the task's own Done-when condition failing for a reason the roadmap task's diagnosis
  never anticipated. `!important` here matches an existing convention already used in this same file's
  `@media print` overrides for these exact selectors (`.spcols`/`.slotgrid`), suggesting a prior author hit
  the identical shadowing problem and reached for the same fix.
- **Status:** DONE. Verified live (headless browser, 375px viewport): `.abrow`/`.kpis` now compute 3 equal
  columns, `.ib`/`.cath` now compute the intended larger font-size/padding, `.slotgrid`/`.spcols`/
  `.shabrow`/`.shkpis` compute the new small-phone column counts, desktop (1280px) unchanged. A full
  reordering of the stylesheet (option i) is left as a follow-up if this class of bug resurfaces elsewhere
  in the file.

---

## D-GH18 · CharGen's `liveBase()` field diff vs `baseBuild()`: fixed the missing array, left `inPlay` out on purpose
- **Context:** CharGen's `⇆ Live Sheet` export crashed for any character with ≥1 species/racial trait —
  `buildToLiveLog()`'s local `liveBase()` (its own hand-copied duplicate of `js/engine.js`'s `baseBuild()`
  shape) was missing `racialTraits:[]`, so the local MUT's unguarded `b.racialTraits.push(p.v)` threw on
  `undefined`. The roadmap task asked for a full field diff against `baseBuild()` plus an audit of every
  other `.push()` in that local MUT, not just the one-line fix.
- **Options:** (i) add every field `liveBase()` is missing relative to `baseBuild()`, for full structural
  parity; (ii) add only `racialTraits:[]` plus whatever else the audit shows is actually load-bearing.
- **Decision:** (ii). Added `racialTraits:[]` only. The rest of the diff — `languageNames`, `grantNames`,
  `dabblerCantripNames`, `innateNames`, `featNames`, `size` — is never reached via an unguarded `.push()`
  in `buildToLiveLog`'s local MUT (every read elsewhere is already `||[]`/`||{}`-guarded), so leaving them
  unset causes no crash. One field, `inPlay`, was deliberately **not** copied even though it's in
  `baseBuild()`: all three tools' own hand-copied pricing logic branches racial-trait tier cost on
  `b.inPlay` (grown-into-tier MASTER pricing vs. origin/creation pricing), and Live Sheet's own code
  explicitly recomputes on `inPlay:false` for imported characters "so an imported creation character shows
  no phantom drift" (`tools/PACT-Live-Char-Sheet.html` ~L907). `liveBase()`'s `run`/`base0` already get
  the correct (undefined → falsy → creation-basis) pricing for a freshly-exported character; adding
  `inPlay:true` would have silently switched exported racial traits onto in-play tier pricing and changed
  `compute()` output for every export with a racial trait.
- **Why:** the two objects (`liveBase()` vs. `baseBuild()`) aren't actually meant to be identical —
  `baseBuild()` represents a generic engine-default build, while `liveBase()` specifically seeds a
  *freshly created, not-yet-in-play* export. Blindly closing every diffed field for "parity" would have
  fixed a docs-style mismatch while introducing a real pricing regression. Future field-diff sweeps
  between these two (or the eventual Task 6 bridge migration) should re-check `inPlay`'s semantics before
  copying it forward.
- **Status:** DONE. `racialTraits:[]` added; export verified in-browser (species with a racial trait no
  longer throws); the other diffed fields left as-is with this note explaining why.

---

## D-GH17 · REV-07: invite codes from `gen_random_bytes`, code length/rate-limiting deferred
- **Context:** `gen_invite_code()` built each of 6 characters via `floor(random()*36)` — Postgres's
  plain PRNG, not cryptographically secure. Invite codes gate `join_campaign`/`join_as_dm` and function as
  shared secrets, so a predictable generator is a soft spot even though the review rated it MEDIUM (a
  successful guess only lets an attacker create their own character in someone else's campaign; RLS still
  scopes all other data). The review's fix suggested three independent moves: (1) switch to a CSPRNG, (2)
  consider lengthening codes to 8 chars, (3) consider rate-limiting `join_campaign`.
- **Options:** (i) all three in one change; (ii) CSPRNG only, leave length/rate-limiting as follow-ups.
- **Decision:** (ii). `gen_invite_code()` now pulls 6 bytes from `gen_random_bytes()` (pgcrypto, already
  enabled) and reduces each mod 36 onto the existing alphabet — same 6-char length, same
  `^[A-Z0-9]{6}$` check regex, only the entropy source changes.
- **Why:** the review's own acceptance criteria for REV-07 only requires the CSPRNG swap (codes stay
  unique, still match the check regex, sourced from `gen_random_bytes`) — length and rate-limiting were
  phrased as "consider" / optional hardening, not required. Lengthening ripples into the `check` constraint
  and any UI that assumes 6 chars; rate-limiting needs a new attempt-tracking table or edge-function config.
  Both are real, separable follow-ups better scoped and reviewed on their own rather than folded into a
  MEDIUM entropy fix. mod-36 over the raw byte has a small bias toward earlier alphabet characters (256
  isn't a multiple of 36) — judged negligible for a 6-char invite code; rejection sampling was not worth
  the added complexity here.
- **Status:** DONE for the CSPRNG swap. Code length and `join_campaign` rate-limiting remain open,
  lower-priority hardening — not re-filed as a new roadmap item since the original REV-07 entry already
  covers them if picked up later.

---
## D-GH9 · Feature A found Live Sheet does NOT bridge DATA/compute/MUT from js/engine.js — edited both copies
- **Context:** The roadmap task (and `AGENTS.md`'s Architecture section) describe Live Sheet and DM Console
  as already on a "module bridge" that imports `DATA`, `compute`, `baseBuild`, `MUT`, `activeEvents`,
  `economy`, and `foldBuild` from `js/engine.js` onto `window`, with only CharGen still embedding its own
  copy (Task 6). While implementing Feature A's `found`/`dbound` MUT extension, direct inspection showed
  this is false for the mutation/pricing layer: Live Sheet's only `<script type="module">` block imports
  `validate` (from `js/engine.js`) plus sync/auth/campaign helpers — `DATA`, `compute`, `MUT`,
  `activeEvents`, `economy`, and `foldBuild` are separate, hand-written top-level declarations in the same
  file, and the file's own header comment (line 27) explicitly documents this as intentional: *"SHARED,
  DUPLICATED CODE ... copy-pasted into BOTH html files and must stay byte-for-byte in sync."* DM Console
  has the identical pattern (its own local `compute()`/`MUT`, only auth/campaign/dm helpers bridged). So
  editing `js/engine.js`'s `MUT` alone would have been a no-op for the actual running tool — the "Engine
  first, then the tools" task ordering only holds if you also patch the tool's own copy.
- **Options:** (i) trust `AGENTS.md`'s claim and edit only `js/engine.js` (would silently produce
  non-functional "Add discipline"/"Open another tradition" buttons — engine tests would stay green while
  the live tool didn't work); (ii) **edit both `js/engine.js`'s `MUT` and Live Sheet's local `MUT`
  identically**, keeping the two byte-for-byte in sync per the file's own stated invariant; (iii) use this
  task to actually migrate Live Sheet onto a real bridge for `DATA`/`compute`/`MUT` (out of scope — that's
  a separate, larger migration essentially identical to Task 6, not something to fold into a pricing
  feature).
- **Decision:** (ii). `found` (extended to add a discipline to an already-open tradition, not just found a
  new one) and the new `dbound` setter were added to both copies in lockstep. `compute()` itself needed no
  change in either file — both copies already priced `d.bound` and iterated all traditions/disciplines
  correctly before this change (dead code, unreachable via any UI path until `found`/`dbound` could
  produce that state), which is why the original task's "Engine first... ZERO compute() change" framing
  was directionally right even though its premise about the bridge was wrong.
- **Why:** `AGENTS.md` is supposed to be the single, trustworthy source of architecture truth for any agent
  picking up a task cold — "Engine first, then the tools" only makes sense read literally if the tools
  actually consume the engine. Silently going along with the stale claim would have shipped a feature that
  passes `engine-parity.html` (which only ever imports `js/engine.js`) while doing nothing in the browser.
- **Status:** IN FORCE. `AGENTS.md`'s Architecture bullet ("Three UI-only tools... load the engine via a
  module bridge") is now known to be accurate only for `validate()` plus sync/auth/campaign/dm helpers —
  `DATA`/`compute`/`MUT`/`baseBuild`/`activeEvents`/`economy`/`foldBuild` are still copy-pasted into Live
  Sheet and DM Console exactly as CharGen's are. Correcting `AGENTS.md`'s wording, and/or actually
  finishing the bridge migration for all three tools (Task 6 currently only scopes CharGen), is filed as a
  new roadmap item rather than done here — out of scope for a spellcasting pricing feature.

## D-GH15 · Function EXECUTE grants: explicit `authenticated`, not implicit `PUBLIC`
- **Context:** Supabase's security advisor (run via the newly-connected Supabase MCP) flagged `award_ap`
  and the now-dropped `award_xp` as callable by the unauthenticated `anon` role via `/rest/v1/rpc/*`.
  Investigation showed this wasn't specific to those two functions: every `SECURITY DEFINER` function in
  the schema still carried Postgres's default EXECUTE-to-`PUBLIC` grant, which none of the migrations had
  ever explicitly revoked — confirmed live via `has_function_privilege('anon', ..., 'EXECUTE')` returning
  `true` across the board. `award_ap` itself was never actually exploitable (its `is_campaign_dm()` guard
  rejects any caller without a real `auth.uid()` match, and `anon` has zero table-level grants anywhere in
  the schema), but the grant not matching intent is exactly the kind of drift that turns into a real bug
  later if an internal guard is ever refactored without someone re-checking the grant surface.
- **Options:** (i) leave it — internal guards already prevent exploitation; (ii) **revoke the default
  `PUBLIC` grant on `award_ap`, matching the explicit `authenticated` grant it already has** (this
  decision's scope); (iii) do the same across all ~12 flagged functions in one pass, including the
  RLS-helper predicates (`is_campaign_dm`, `is_campaign_member`, etc.) that have no explicit grant at all
  today and rely solely on `PUBLIC` for `authenticated` to work.
- **Decision:** (ii) for now — `award_ap`'s `PUBLIC` grant revoked, `award_xp` dropped outright (dead code
  from the XP → AP rename, zero references in `js/` or `sql/`). (iii) was investigated and confirmed safe
  (verified `anon` has no SELECT/INSERT/UPDATE/DELETE on any table, and every client-facing RPC call in
  `js/` maps only to functions that already have an explicit `authenticated` grant) but deliberately not
  applied in the same pass — it touches ~12 functions across the schema, which is a larger blast radius
  than what was being discussed when the fix was requested. Left as a scoped, ready-to-apply follow-up.
- **Why:** a `SECURITY DEFINER` function's grant should express who is *meant* to call it, not rely purely
  on internal logic to reject the rest — the internal guard and the grant are two independent layers, and
  this project has already been burned once (REV-04, D-GH12) by a case where only one of those layers was
  actually enforcing the boundary.
- **Status:** IN FORCE as of 2026-07-02 for `award_ap`/`award_xp`. The broader ~12-function grant cleanup
  is scoped and safe but NOT yet applied — pending a separate explicit go-ahead.
- **Addendum (2026-07-10):** the broader cleanup landed — `sql/migrations/2026-07-10-lock-down-remaining-
  function-grants.sql`, mirrored into `sql/rls-policies.sql`. One nuance the original plan's "Done when"
  wording glossed over: for the three trigger-only functions (`handle_new_user`, `add_owner_as_dm`,
  `set_updated_at`), revoking the `PUBLIC` grant with no replacement leaves `authenticated_can_execute`
  `false` too, not just `anon`'s — verified live post-migration. That's correct and intended (Postgres
  rejects any direct `/rest/v1/rpc/*` call to a `returns trigger` function regardless of grant, so no role
  ever needed explicit EXECUTE on these), it just doesn't match a literal "authenticated_can_execute=true
  for all ~13" reading of the done-when criteria — noting it here so a future agent checking grants doesn't
  mistake it for a regression. All 11 non-trigger functions show `anon=false` / `authenticated=true` as
  planned; `get_advisors` post-migration shows no new findings (remaining WARNs are pre-existing and
  out of scope: `authenticated`-callable `SECURITY DEFINER` functions, which is intentional for RPCs meant
  to be called by signed-in users, and unrelated leaked-password-protection). Also skimmed `get_logs`
  (postgres service) post-migration per the AGENTS.md per-change checklist — only the expected
  `apply_migration` statement and routine connection/checkpoint lines, no errors.

---
## D-GH16 · Campaign rules follow-up: live-filter pickers where a pick surface exists, not everywhere
- **Context:** D-GH14 shipped enforcement, but only at the last possible moment — Live Sheet's "Save to
  cloud" click. A player who builds around a banned choice only finds out after the fact and has to undo
  work. The obvious full fix (give CharGen, where species/origin class are actually chosen, live
  campaign-rule awareness) needs sign-in + campaign selection in a tool that has neither today, plus Task
  6 (CharGen isn't on the shared engine bridge yet) — real scope, filed separately as its own roadmap item
  rather than rushed in. This decision covers the smaller, immediate piece: what Live Sheet itself can
  live-filter right now.
- **Options:** (i) leave enforcement at cloud-push only (status quo, cheap, but doesn't touch the actual
  complaint); (ii) **live-filter every banned category everywhere the app could conceivably show it**;
  (iii) **live-filter only categories Live Sheet actually lets a player pick**, and be explicit that the
  rest stay push-time-only.
- **Decision:** (iii). Checked what Live Sheet actually exposes as a live pick: weapon masteries and
  boons are genuinely selectable there, so both are now filtered out of their pickers the moment a
  banned item's campaign rule is known — a banned option simply never appears to select. Species,
  origin class, and multi-discipline are **not** pickable in Live Sheet at all (species/origin class are
  fixed at character creation — set in CharGen or the initial build — and multi-discipline purchasing
  doesn't exist yet, pending Feature A); there is no picker to filter, so those three stay enforced only
  at "Save to cloud" (D-GH14), same as before this change.
- **Decision (owned-but-now-banned items):** an item the player already owns stays visible in the picker
  list (shown as owned, not hidden) even if a DM later bans it. Hiding it entirely would make it
  unmanageable through the UI — the owned-item control is also how a player would undo/sell it back — so
  filtering only ever removes *not-yet-purchased* banned options, never something already on the sheet.
  D-GH14's "Save to cloud" block still catches the already-owned case if it's ever pushed.
- **Decision (when rules are fetched):** Live Sheet has no automatic server reconcile on a plain page
  load — cloud sync only happens when the player interacts with the cloud menu. Added a fetch on
  sign-in/session-ready (`refreshCloudCampaignRules()`) so filtering is live from the moment the page is
  usable, not just after an explicit "Load"; the existing "Load a saved character" flow was extended to
  reuse its already-fetched campaign object instead of a second network round-trip. The authoritative
  check at cloud-push in D-GH14 still re-fetches fresh rules independently — the live-filter is a UX
  layer on top, not a replacement for it.
- **Why:** matches the same trust posture as D-GH14 — client-side guardrails for honest workflows, not a
  security boundary — and avoids overselling what this pass delivers: it measurably shortens the
  "build → get blocked → go back" loop for masteries/boons, and is honest that species/class/multi-disc
  still can't be caught early until the CharGen work lands.
- **Status:** IN FORCE as of 2026-07-02. `tools/PACT-Live-Char-Sheet.html`: `cloudRuleBarred()`,
  `refreshCloudCampaignRules()`, mastery/boon picker filters. Follow-up filed as a new roadmap item
  ("CharGen campaign-rules awareness") for the species/origin-class/multi-discipline gap.

## D-GH14 · Campaign rules enforcement: separate `validate()` export, blocked at cloud push
- **Context:** the roadmap item ("DM campaign rules — configure and enforce") asked for DMs to ban
  species/masteries/boons/origin classes/origin species and toggle multi-discipline per campaign, with
  Live Sheet hard-locking characters that violate them. Its draft text said "assign D-GH7" for this
  decision, but D-GH7 was already taken (dual-source AP/co-DMs) by the time this was picked up — same
  situation Feature A/B hit with D-GH3 — so this is filed as the next free code instead. Two questions
  needed answers: (1) does enforcement live inside `compute()` or a separate export, and (2) where does
  Live Sheet actually block — every local edit, or only the point data leaves the browser?
- **Options (API shape):** (i) fold rule-checking into `compute()`'s existing `warnings` array — no new
  export, but couples an optional, campaign-scoped, DM-authored check into the one function every build
  op depends on, and every caller (fixtures, CharGen, DM Console's own embedded pricer) would need a
  `campaignRules` argument whether or not it applies to them; (ii) **a new pure `validate(b, rules)`
  export**, called only where campaign enforcement actually matters.
- **Decision (API shape):** (ii). `validate()` (`js/engine.js`, exported after `rebuildStateFromEvents`)
  takes a build and the campaign's `rules` JSON and returns `{ ok, violations: [{code, message}] }`. It
  never touches `compute()`, pricing, or `DATA` — so `DATA.version` does not bump and every existing
  fixture/caller is unaffected by this change.
- **Options (where Live Sheet blocks):** (i) run `validate()` on every keystroke/purchase and block the
  offending buy inline — most "hard-lock", but Live Sheet's local autosave (`save()`, line ~800) fires
  continuously and isn't itself a submission to anyone; blocking it would make the tool unusable offline
  and for solo play; (ii) **block only the "☁ Save to cloud" push** (`js/sync.js`'s `saveCharacter`
  caller in Live Sheet) — the one point a build actually leaves the browser and reaches the shared
  campaign.
- **Decision (where):** (ii). Local edits and localStorage autosave are never blocked; a rule-violating
  character can still be built and played solo. Clicking "Save to cloud" for a character with a
  `campaign_id` fetches that campaign's live `rules` via `getCampaign()` and calls `validate()`; on any
  violation the push is aborted with an `alert()` listing every broken rule (message text, not just a
  code), and nothing reaches Supabase.
- **Why:** this matches the architecture's existing trust boundary — the server enforces what actually
  matters (RLS on `characters.ap`, `campaign_id`), and the client enforces UX-level guardrails that can't
  be bypassed by a normal player workflow but aren't trying to survive a hostile client (same posture as
  the pre-existing local `PACTRULES:` boon/drawback/art barring already in Live Sheet, which this doesn't
  replace — that mechanism is offline/code-shared and unrelated to the new Supabase-backed campaign
  object). Gating at push means the one expensive, meaningful check (a live campaign lookup) happens once
  per save, not on every render.
- **Schema:** `campaigns.rules` (jsonb, default `{}`) — `{ bannedSpecies: [], bannedOriginSpecies: [],
  bannedOriginClasses: [], bannedMasteries: [], bannedBoons: [], multiDisciplineAllowed: true,
  houseRules: {} }`. Every field defaults to "no restriction" so an empty/missing rules object never
  produces a violation. No new RLS policy was needed: `campaigns` has no column-level `UPDATE` grant (the
  blanket table grant covers every column) and the existing `campaigns_update` row policy already
  restricts writes to `is_campaign_dm(id)`; players get read-only visibility via `campaigns_select`.
- **Status:** IN FORCE as of 2026-07-02. Engine: `js/engine.js` `validate()`. Migration:
  `sql/migrations/2026-07-02-campaign-rules.sql`. DM UI: `tools/DM-Console.html` Campaign Rules panel.
  Enforcement: `tools/PACT-Live-Char-Sheet.html` `cloudSaveBtn` handler.

## D-GH13 · Regression gate design: CSV baseline + two-mode runner
- **Context:** REV-01 found the parity gate hard-coded `pass: true` and left `expected-results.csv` blank, so it only proved `compute()` doesn't throw, not that outputs are correct. The fix needed to assert real values, but the baseline values had to be confirmed by a human against the PHB before being committed — the agent can't verify rule correctness independently.
- **Options:** (i) hardcode expected values directly in the JS; (ii) **store expected values in a CSV** loaded at runtime, with a separate "Capture" mode to dump the live engine output for human review; (iii) a Node.js CI script (deferred as REV-11 — Node not required for the app).
- **Decision:** (ii). `engine-parity.html` has two buttons: **Capture baseline** (runs all fixtures, outputs ready-to-paste CSV rows for human review) and **Run tests / assert** (fetches `expected-results.csv` at runtime and fails any fixture whose actual value differs from the stored expected). CG-003 additionally hardwires `remaining < 0` and the "OVER BUDGET" string check regardless of the CSV, since those are structural invariants of the fixture.
- **Why:** the CSV is human-editable and lives next to the fixtures — a future agent updating a fixture can update its expected row in the same PR without touching JS. The two-mode split enforces the "human reviews before committing" policy without blocking the gate indefinitely. Note: **CG-001 total = 2 AP, not 0** — an "empty" build still pays for Hit Die 1: `DATA.HD[0].cum = 2`. Every character pays this; it is the entry cost for existing. Languages at 1, all stats at 10, and everything else on the empty fixture are all 0 AP.
- **Status:** IN FORCE as of 2026-07-01 (REV-01). Gate: `testing/tests/engine-parity.html`; baseline: `testing/expected/expected-results.csv`.

## D-GH12 · Campaign RLS: `campaign_id` column locked to SECURITY DEFINER path
- **Context:** REV-04 found that the player UPDATE grant on `characters` included `campaign_id`. A player could set their own `campaign_id` to any campaign UUID, bypassing the `join_campaign()` invite-code flow and joining campaigns without the DM's knowledge or invite code.
- **Options:** (i) add a row-level policy that validates the target campaign exists and the player holds an invite — this requires reading `campaigns` from inside an RLS policy, hitting the same recursion problem that forced SECURITY DEFINER elsewhere (D-GH4); (ii) **remove `campaign_id` from the column-level UPDATE grant** so no direct write to that column is possible at all; DM-side paths that need to set it use SECURITY DEFINER functions that bypass RLS.
- **Decision:** (ii). `campaign_id` removed from the player column-level UPDATE grant. The INSERT policy also tightened with `AND campaign_id IS NULL` so a player cannot insert a character pre-joined to an arbitrary campaign. `join_campaign()` (SECURITY DEFINER) is the sole path for assigning `campaign_id` on a character.
- **Why:** column-level grants are the only airtight guard at the Postgres layer — a row policy can be satisfied by a carefully crafted update that meets the condition; removing the column from the grant makes the write structurally impossible regardless of row state. The SECURITY DEFINER trust boundary is already established (D-GH4); this extends it consistently to cover campaign membership.
- **Status:** IN FORCE as of 2026-06-30 (REV-04). Migration: `sql/migrations/2026-06-30-rev04-campaign-rls.sql`.

## D-GH11 · Service worker caching strategy: network-first for app shell + engine
- **Context:** `service-worker.js` used a single cache-first path for all same-origin requests. A fix shipped to `js/engine.js` or any HTML page would not reach returning users until the SW's own bytes changed and the browser re-installed it — potentially days later.
- **Options:** (i) **network-first** for `*.html` + `engine.js`, falling back to cache offline; (ii) **stale-while-revalidate** (serve cache immediately, revalidate in background — fix takes a second visit); (iii) **derive `CACHE_NAME` from `BUILD`** so activate purges old caches on each release (SW can't `import` ES modules, so reading `BUILD` requires a string-grep or hardcoded sync step); (iv) keep cache-first everywhere (current, breaks prompt delivery of fixes).
- **Decision:** (i) network-first for `*.html` pages (`/\.html$/` + `/PACT/$`) and `js/engine.js`. All other same-origin assets (icons, supporting JS) remain cache-first. `CACHE_NAME` stays static — the activate handler already purges old caches when it changes manually. Option (iii) deferred: benefit is automatic purging, cost is a build-step or string-sync just to read one constant.
- **Why:** a rules fix that doesn't reach users until the next SW update is a silent correctness regression. Network-first is minimal overhead: one extra round-trip on warm hits, offline still works via cache fallback.
- **Status:** IN FORCE as of build v0.107 (REV-03).

## D-GH7 · Campaign play: dual-source AP, co-DMs, and an award ledger
- **Context:** wiring cloud save into the Live Sheet collided with the AP model. The Live Sheet self-awards
  AP via log events (player-writable), but `characters.ap` was meant to be DM-authoritative and
  uncheatable. We also need to know *which* DM gave an award, and a campaign can have more than one DM.
- **Options (AP):** (i) server `ap` is the only budget (breaks solo/honor-system play); (ii) log stays the
  only source (players can self-grant infinite AP by editing their log — defeats the security goal);
  (iii) **both sources coexist, with a per-campaign toggle.**
- **Decision (AP):** (iii). Budget = DM-granted (`characters.ap`) **+** player-entered (log awards), unless
  the campaign's `ignore_player_ap` flag is on, in which case only DM-granted counts. Solo characters (no
  campaign) just use player-entered. Tools show the breakdown and flag any difference.
- **Decision (DMs):** a campaign can have **multiple DMs**. `campaigns.dm_id` stays as the *owner/creator*;
  a new `campaign_dms` table lists everyone who can DM. `is_campaign_dm()` checks membership, so all DM
  powers extend to co-DMs. Two ways to become a co-DM: a **separate DM invite code** (`join_as_dm`) and the
  **owner promoting an existing member** (`promote_to_dm`, owner-only).
- **Decision (attribution):** AP awards are recorded in an `ap_awards` ledger (character, dm_id, amount,
  note, time); `award_ap()` writes a ledger row stamped with the calling DM and updates the running
  `characters.ap` total. So every award is attributed and auditable.
- **Why:** dual-source keeps security available *where the DM wants it* without crippling solo/honor play;
  the ledger gives attribution + history (matching the Live Sheet's event-sourced ethos); a membership
  table is the only way to express co-DMs, and offering both join paths covers self-service and curated add.
- **Status:** IN FORCE. Supersedes D-GH4's "one DM per campaign / single `ap` write". Schema + RLS updated;
  client (DM Console, Live Sheet AP combination) follows.

## D-GH4 · Data model: per-campaign non-exclusive roles, no player cap, ap locked at the column level
- **Context:** Task 3 needed the Supabase schema + RLS. The plan assumed a global Player/DM role, a 5-player
  cap, and "the characters UPDATE policy must exclude the [points] column from player writes." (The plan
  called the DM-awarded points "xp"; PACT's currency is **AP**, so the column is `ap` — see also the rename.)
- **Options (roles):** (i) global role flag on the profile; (ii) roles derived per-campaign from the
  relationship (DM = `campaigns.dm_id`; player = owning a character in that campaign), allowed to overlap
  even within one campaign.
- **Options (ap):** (i) a row policy / trigger that rejects ap changes; (ii) revoke blanket UPDATE and grant
  UPDATE only on player-writable columns, with a DM-only `award_ap()` SECURITY DEFINER RPC as the sole ap
  write path.
- **Decision:** per-campaign overlapping roles (no stored role column); **no player cap** (overrides the
  plan's "up to 5"); ap protected by a column-level GRANT plus `award_ap()`. Joining and code regeneration go
  through SECURITY DEFINER RPCs (`join_campaign`, `regenerate_invite_code`) so players never need broad read
  access to `campaigns`. Cross-table RLS checks live in SECURITY DEFINER helpers to avoid policy recursion.
- **Why:** the same person can run one table and play at another (or even play in their own game), which a
  global flag can't express. Postgres RLS can't scope an UPDATE to columns, so the column GRANT is the only
  airtight ap guard — a row policy would still let a player set ap in an otherwise-valid update.
- **Status:** IN FORCE. Plan doc (`docs/PWA-BUILD-PLAN.md` Task 4) still says "up to 5 players" and needs
  updating to match.

## D-GH8 · PWA service-worker registration lives in every tool page (Task 1)
- **Context:** the PWA shell (manifest, `service-worker.js`, `404.html`, icons) had landed and `index.html` registered the SW, but the three `tools/*.html` pages did not — so installing/offline only worked from the menu, not the tools themselves.
- **Options:** (i) register the SW only from `index.html` and rely on scope to cover the tools; (ii) add the registration block to each tool page explicitly.
- **Decision:** (ii). The shared registration script + `<link rel="manifest" href="/PACT/manifest.json">` were added to all three tool pages, using absolute `/PACT/` paths, with an in-page "new version ready / Reload" bar on `updatefound`.
- **Why:** each tool is a directly-bookmarkable/installable entry point; explicit per-page registration guarantees the manifest + update prompt regardless of how the user arrived. Engine logic untouched.
- **Status:** IN FORCE.

## D-GH6 · Versioning scheme — three independent numbers
- **Context:** the header now displays version info and it was ambiguous which number means what.
- **Decision:** keep three independent counters: **(1) Tool/build version** — the `v0.x` in each tool's top comment, `<title>`, and header label (CharGen & Live Sheet bumped 0.106 → **0.107**); **(2) PACT rules version** — `DATA.version`, canonical and stamped on saved JSON, shown as "PACT rules · v0.322", kept in sync CharGen ↔ Live Sheet and bumped only when mechanics change; **(3) DM Console** — its own `TOOL_VERSION` counter (0.014 → **0.015**).
- **Why:** rules changes and cosmetic tool changes have different audiences and cadences; conflating them would force needless `DATA.version` bumps (and re-validation) for pure UI work.
- **Status:** IN FORCE.

## D-GH5 · Mobile header uses an "app-shell" layout, not `position:fixed/sticky`
- **Context:** after the header rebuild, the header would not stay pinned on a real Pixel, even though it worked on desktop and in a narrow desktop window.
- **Investigation:** a self-reporting diagnostic proved the header was *positioned* correctly on the phone — `getBoundingClientRect().top === 0` at full scroll, `scrollingElement === <html>`, no inner scrollers — but it wasn't being **repainted** at top:0 while the whole window scrolled a heavy (~500 KB) page (a mobile-Chrome compositor limitation). A `transform:translateZ(0)` GPU hint didn't fix it; switching `fixed`↔`sticky` made no difference.
- **Options:** (i) keep fighting the compositor with GPU hints / position tweaks; (ii) stop scrolling the window on mobile altogether and adopt an app-shell.
- **Decision:** (ii), mobile (≤768px) only: `body` becomes a flex column with `height:100dvh; overflow:hidden`; the header is a **static** `flex:0 0 auto` bar; `.layout` becomes its own scroll area (`flex:1; overflow-y:auto`). The header is no longer inside the scrolling region, so it can't scroll away. Desktop keeps `position:sticky` + window scroll. "Jump to section" scrolls the inner area via `scrollIntoView` when the header is static. **Header information architecture** alongside this: desktop = 4 rows (name+AP · title+versions+last-edited+theme · action buttons · nav chips); mobile = 2 rows (name+AP · Random/Reset/Jump-to-section). Breakpoints kept independent: header 768px, layout grid 920px, phone tuning 600/380px.
- **Why:** robust on real hardware and the correct base for the planned PWA (app-shell is the standard PWA layout). Trade-off: in a plain browser tab the mobile address bar no longer auto-hides on scroll — moot once installed as a PWA.
- **Status:** IN FORCE.

## D-GH3 · CharGen exports now match the Live Sheet's native event format
- **Context:** CharGen → Live Sheet exports were bundling itemized purchases into coarse patch events, so imported drawbacks could not be bought off and ledger entries were missing for individual purchases.
- **Options:** (i) keep the coarse patch export and patch the Live Sheet to infer itemized buys from patches; (ii) change the exporter to emit discrete native buy events for each itemized purchase while preserving the existing totals and ordering.
- **Decision:** (ii). The export now writes the same discrete buy events the Live Sheet would create when an item is bought natively, while keeping structural patches for scalar and blob-style fields.
- **Why:** imported characters should be indistinguishable from hand-built ones in the Live Sheet, including buy-off behavior, per-item ledger lines, and per-item cost drift.
- **Status:** IN FORCE.

## D-GH2 · Carry the changelog / decisions / narrative discipline into the GitHub repo
- **Context:** the pre-GitHub Cowork project kept a rich `CHANGELOG.md`, `DECISIONS.md`, and session
  narratives. The new GitHub repo had an architecture instructions file (`pact-agent-instructions.md`) but
  no logging discipline — so context would stop travelling between AI sessions.
- **Options:** (i) keep the logging notes only in Cowork; (ii) move the three logging docs into the repo and
  make the AI-agent instructions require updating them on every change.
- **Decision:** (ii). One master instructions file (`AGENTS.md`, copied to `CLAUDE.md` +
  `.github/copilot-instructions.md`) now carries BOTH the architecture/PWA plan AND a "log as you go" rule
  that points every agent at `CHANGELOG.md` / `DECISIONS.md` / `docs/sessions/`.
- **Why:** in-repo docs version with the code and show up in every diff/PR, so the discipline is enforced by
  review instead of memory; one master file copied to the tool-specific names means Copilot and Claude both
  follow identical rules without re-pasting context each session.
- **Status:** IN FORCE.

## D-GH1 · Repo layout: one shared `js/engine.js`, tools are UI-only, deploy via GitHub Pages
- **Context:** moving PACT from Cowork (engine inlined into each standalone HTML tool) to GitHub Pages.
- **Options:** (i) standalone single-file tools with the engine inlined in each; (ii) centralise the engine
  in one `js/engine.js` and have the tools import it via a module bridge; (iii) both.
- **Decision:** (ii) — `js/engine.js` is the single source of truth; `tools/*.html` import it; the site is
  served by GitHub Pages at `/PACT/`.
- **Why:** one engine to edit means the three tools can never silently diverge; Pages gives a free public
  URL. Trade-off: tools are no longer single-file/offline (the PWA task restores offline via a service worker).
- **Status:** IN FORCE.

## D-014 · PHB pages + drawback text are display data — fill them, keep `DATA.version` v0.322, bump build to v0.106
- **Context:** the long-standing open thread was "PHB page numbers + 69 drawback descriptions, awaiting John's source." John supplied a PHB-rules JSONL (`Feat`/`Equipment` entries carry a `page`) and the Players-Guide **v0.324** HTML (drawback table). On inspection the tools showed `drawbackFx` was **already fully populated** (69 strings) — the restart-status note was stale — and `masteryFx` already carried the effect text with `page:null`.
- **Options:** (i) treat the new guide as authoritative and **overwrite all 69** drawback strings; (ii) **reconcile** — diff the engine text against the guide and change only what differs; (iii) skip drawbacks (already filled) and only add pages. Also: whether to bump `DATA.version` to v0.324, and whether to bump the build counter.
- **Decision:** (ii) reconcile. Pages: `masteryFx[*].page`=214 (all 8, from the JSONL `Equipment` "(mastery)" rows) and `page` on **41/43** arts matched by name to the JSONL `Feat` rows (Blessed/Druidic Warrior absent → left page-less, no fabrication). Drawbacks: **53 already identical**, **10 synced** to the guide's fuller wording, **6 split `Affliction —` rows kept** (guide stores them as one combined row). `DATA.version` **stays v0.322**; build bumped **v0.105→v0.106**.
- **Why:** the 10 drawback diffs only *added* DEX/WIS cap clauses that `drawbackMaxStats` **already enforces** — so the change is display-only, not a rules/mechanics change, and bumping `DATA.version` (→ gate expectations in G4/G5) would misrepresent that. Overwriting all 69 (i) risked clobbering correct text with parse noise; reconciling is the minimal, auditable change. A build bump is the CONTEXT §6 convention for a significant build and keeps John's original v0.105 tar a distinct artifact. Surgical `JSON.stringify` round-trip replacement on `src/engine/data.js` (verified the serialization appears verbatim first) kept the diff to exactly the three sub-objects.
- **Status:** DONE (v0.106) — 46 gates green; G1 (build-check) + G3 (version-consistency) verify the bump is consistent. **One open question for John:** the 6 `Affliction —` entries have no cap clause in their text (caps still enforced via `drawbackMaxStats`); append "…capped at 10" to each for parity with the synced 10, or leave split-and-terse? Awaiting his call.

## D-013 · Outline labels never reset within a session (continue A→Z→AA, not restart at A1)
- **Context:** the INDEX "Output format (ALWAYS)" rule restarted the outline at A1/B1 at the top of **every** response, so a handle like "A1" was unique only *within one message* and collided across turns — the user could not reliably refer back to an item from an earlier reply ("I get confused as you reuse the A1, A2").
- **Options:** (i) per-response number prefix — stamp each reply, handles become `2A1`, `3B2`; (ii) **don't reset the capital letters** — keep climbing A…Z then AA, AB… across the whole session, item numbers reset within each group; (iii) topic/semantic group tags (`BUILD-1`, `FIXTURES-2`).
- **Decision:** (ii) — never reset the letters. Each response continues at the next free letter where the last one stopped; spreadsheet-style AA, AB… after Z; numbers reset to 1 inside each new group.
- **Why:** reuses the A1/A2 syntax the user already knows (no new prefix to learn) while making every handle globally unique for the life of the session, so "D2" addresses exactly one item. Per-prefix (i) was heavier to type/track; semantic tags (iii) can still collide when a topic recurs.
- **Status:** DONE — INDEX "Output format (ALWAYS)" updated. Style-only convention (not gate-enforceable — same class as the other prose-style rules, per D-005: gates verify version *strings*, not output *style*).

## D-012 · Character test fixtures — engine-verified generation (SPEC'D, not built)
- **Context:** need sample character files for GitHub testing.
- **Scope:** 1 empty character · 4 valid CharGen builds at **50 / 150 / 250 / 500 AP** (diverse archetypes, ~90–100% of budget) · 4 invalid builds (spread: **over-budget · missing-prereq · illegal-buy · cap/duplicate**) · the 4 valids re-expressed as **Live-Sheet histories** folding to the *identical* build · a manifest. Output: `tests/fixtures/samples/`. Stamp `rules:"v0.322"`.
- **Options:** hand-author the JSON · generate by driving the real engine.
- **Decision:** generate by driving the engine — `loadEngine` (from `scripts/headless.cjs`) → `foldBuild`/`setLOG`/`compute`/`economy`; price every buy via the marginal delta `compute(after).total − compute(before).total`; verify each file (legal + within budget for valids; the intended ⛔/over-budget for invalids); CharGen flavour = one award + bulk build, Live-Sheet flavour = multiple awards + granular buys folding to the same build.
- **Why:** AP pricing/legality is too complex to hand-write; engine-verification guarantees the fixtures actually load and validate. Files are `{rules,name,LOG,SEQ}` event logs (build is folded from the LOG).
- **Status:** CLOSED (v0.104) — **John authored the sample fixtures manually**, outside this record's engine-generation plan; no longer an action item. Record kept for the rationale (per D-003). *(Optional follow-up: the manual files can still be validated by loading them through the engine — `loadEngine` → `foldBuild`/`compute` — to confirm they load and price legally, which was the original reason for engine-generation.)*

## D-011 · GitHub hosting model — CLOSED (standalone single-file / offline)
- **Context:** project will be published to GitHub; want "a single DM section where DMs do everything".
- **Options:** (i) GitHub Pages site loading one shared `engine.js` (true on-disk dedup, online only); (ii) standalone single-file downloads (offline, what we have); (iii) both — `src/` as source, Pages for the live site + built single-file downloads for offline.
- **Decision (v0.104, CLOSED per John — "close permanently"):** commit to the **standalone single-file / offline model** (option ii) as the delivery format — the engine stays **inlined** in each tool via `src/engine/*.js` + `scripts/build.cjs` (already in place per D-009). Standing up a GitHub **Pages** site (i/iii) is **no longer an open blocker**: if ever wanted it is purely **additive** (a Pages front-end over the same `src/`) and does **not** change the offline downloads or reopen this question.
- **Why:** the offline single-file path is a hard constraint (`PACT-CONTEXT.md` §4.1 — runs from `file://`, no network/build step), so the delivery format was effectively forced; committing now unblocks the DM-console merge (D-010 / G2) without waiting on a publishing decision.
- **Status:** CLOSED (v0.104). Reversible only by a deliberate new decision if publishing requirements change.

## D-010 · DM consoles — merge into one "DM section" (DONE v0.105)
- **Context:** two consoles (CardGrid, DataTable) are the same tool, two layouts; user wants one DM home.
- **Options:** keep two files · merge into one console with a Card/Table toggle.
- **Decision:** merge — but as its own verified step, **not** folded into Option A.
- **Why:** it's a UI change needing visual QA (not a provable mechanical one); Option A already de-dups their engine, so the remaining win is product/UX, not tokens. Tied to D-011 (hosting → CLOSED single-file/offline).
- **Status:** DONE (v0.105). Merged into `dm-consoles/DM Console - Unified-v0.015.html` (CardGrid card view default + DataTable table view, topbar toggle, one shared engine/roster). The two originals were retired; John signed off ("I like the unified dm console"). integrity-audit **M6** now expects 1 console; build-check **G1** + 46 gates green.

## D-009 · Option A — single-source engine via in-place byte-identical build (not templates, not file-merge)
- **Context:** the engine (~238 KB) was duplicated byte-identical across 4 HTML tools; edits were hand-mirrored.
- **Options:** leave as-is · merge the two big tools · external `engine.js` via `<script src>` (breaks standalone) · templates + markers + build · in-place brace-match build that rewrites the engine block inside each tool.
- **Decision:** in-place build — `src/engine/*.js` is the source; `scripts/build.cjs` re-inlines it into each tool.
- **Why:** the first build is **provably byte-identical** (tools unchanged), so adoption was non-destructive and verifiable; tools stay standalone single files; reuses the existing brace-matcher; minimal churn. The engine stays physically inlined (standalone requirement) — dedup is at the *source/edit* level, not on disk.
- **Status:** DONE. Enforced by `build-check` (gate G1).

## D-008 · Don't merge CharGen + Live-Sheet
- **Context:** they're the two biggest files and share the engine.
- **Options:** merge into one build-to-play tool · keep separate.
- **Decision:** keep separate.
- **Why:** different jobs and different economic models (builder budget-meter vs in-play event log + frozen pricing); merging is a risky product change for a partial win. Option A is the better token fix.
- **Status:** DONE (decided). Could revisit only as a deliberate product goal.

## D-007 · Three-layer history docs + log-as-you-go
- **Context:** need to capture *why* and *discussion*, not just *what*, without bloating the changelog.
- **Options:** put reasoning in the changelog · separate docs per concern.
- **Decision:** CHANGELOG = *what* (condensed); `DECISIONS.md` = *why* (this file); `archive/sessions/` = *discussion/dead-ends* (history). Log substantive changes before finishing a session.
- **Why:** keeps the changelog scannable; makes "why is it this way" findable; matches the changelog's own "reasoning lives in archive/" note.
- **Status:** DONE.

## D-006 · Addressable test codes (A–G), not renamed test files
- **Context:** ~45 gates with domain names; user wanted to run them by short handle ("run test C3").
- **Options:** rename files to generic codes · add a code layer on top.
- **Decision:** code layer — keep the meaningful filenames; `audit-all.cjs` runs by code/group/`--list`; catalogue in `tests/TESTS.md`.
- **Why:** renaming loses the meaning that tells you what failed and risks breaking the suite; a lookup layer gives addressability with zero risk.
- **Status:** DONE.

## D-005 · Machine-checkable version marker + gates, because a doc can't watch itself
- **Context:** front-door docs can silently go stale (the v0.313/v0.309 note already had).
- **Options:** trust discipline · gate it.
- **Decision:** a `<!-- PACT-CURRENT … -->` marker checked against the tools by `version-consistency` (G3); plus `changelog-gate` (G6) for undocumented version bumps.
- **Why:** a gate can verify a version *string*; it can't verify prose *style* (that stays an instruction). Enforce what's enforceable.
- **Status:** DONE.

## D-004 · File types: prose = Markdown, flat tables = TSV, queried records = JSON
- **Context:** "should some docs be JSON/JSONL for efficiency?"
- **Decision:** keep prose in Markdown; tabular data in TSV (no repeated keys); nested records in JSON.
- **Why:** converting prose to JSON *adds* tokens and hurts readability; TSV is the leanest for tables. The project already split this way (prices = TSV, spells = JSON).
- **Status:** DONE (confirmed; no change needed).

## D-003 · Keep history (archive), don't delete
- **Context:** cleanup of stale/finished files (CHANGELOG, ki-audit, old restart sections, fuzz harness).
- **Decision:** move them to `archive/` (marked non-authoritative, never auto-read) — don't delete.
- **Why:** deletion is irreversible and loses rationale (e.g. the ki-audit's source-verified tagging); archiving removes the token cost without destroying the record. Originals also survive in the input tar.
- **Status:** DONE.

## D-002 · Many small single-purpose files + archived history, NOT a merged megafile
- **Context:** "can we combine the md files and stay token-efficient?"
- **Decision:** keep small focused files; move history out of the live read-path into `archive/`.
- **Why:** token cost = content *loaded*, not file count; small files let a session open only what it needs. Merging forces loading everything (or fragile anchors). Live read-path trimmed ~111 KB → ~32 KB.
- **Status:** DONE.

## D-001 · Front-door `INDEX.md` as the single entry point
- **Context:** a fresh session loaded too much (or the wrong/stale doc) to orient.
- **Decision:** one small `INDEX.md` read first — bootstrap line, read-order, file map, conventions; everything else subordinate and linked.
- **Why:** a session orients from ~8 KB instead of ~2 MB and is told what to open; the bootstrap line (or an auto-loaded pointer) is what makes a session actually read it.
- **Status:** DONE.

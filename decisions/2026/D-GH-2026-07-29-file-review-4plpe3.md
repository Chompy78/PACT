# D-GH-2026-07-29-file-review-4plpe3 — Engine perf review: which external suggestions were taken, and which were measured and rejected

Status: Active

- **Context:** An external review of `js/engine.js` (GitHub Copilot Chat, pasted in as
  `pact_copilot_review.md`) proposed nine CPU/GC optimizations, ordered by claimed impact, and offered
  three rollout tiers. Every claim was first verified against the real code with an `Explore` agent
  (none were taken on trust), then the approved subset was implemented and **measured** rather than
  assumed. The review's own item 9 — "profile before a mass refactor" — turned out to be the only
  advice that mattered for prioritisation, because measuring inverted the review's stated ordering.
- **Options:** The reviewer offered (1) a "small, low-risk, big-win" set = its items 1/3/5/7
  (`structuredClone`, Set-based membership, Set-based dedupe, cached `DATA.*` locals);
  (2) that set plus item 2 (consolidating the duplicated `activeEvents()` pass); (3) a full refactor
  additionally including item 4 (de-`forEach`-ing hot loops) and item 7's async Web Crypto signing.
  User selected (1) then (2).
- **Decision:** Implemented **items 3, 5 and 2**. **Rejected items 1 and 7 on measurement**, rejected
  item 6 (async crypto) on an explicit pre-existing design constraint, and left item 4 undone as
  unjustified. Specifically:
  - **Item 5 — Set-based dedupe in `_replay()` (taken; the only asymptotic win).** The nine
    single-instance proficiency lists were deduped with `arr.filter((v,i) => arr.indexOf(v) === i)`,
    i.e. a full rescan per element. Replaced with `[...new Set(arr)]`. Order is preserved by
    construction (Set iteration order is insertion order, and both forms keep the first occurrence),
    and the lists hold strings, so the one semantic difference between the two forms — `indexOf`
    can never match `NaN` where Set's SameValueZero can — is unreachable.
  - **Item 3 — Set for repeated membership tests (taken, small).** `b.unlockedClasses` was
    `indexOf`-scanned once per iteration in four separate loops (features, subclass abilities,
    traditions, disciplines); `b.racialTraits` likewise inside `_ownsR`; `skillList` once per
    expertise entry. Each now builds one membership Set. The underlying arrays are untouched, so
    nothing order-dependent changed. Not applied to `DATA.prepared`/`DATA.noCantrip`: those are
    small static arrays checked a handful of times per call, where building a Set costs more than
    the scans it replaces.
  - **Item 2 — duplicate `activeEvents()` pass (taken, via a private helper).** `foldBuild()` and
    `rebuildStateFromEvents()` each called `_replay(log)` then `economy(log)`, and both of those
    independently re-ran `activeEvents()` — a redundant `filter(Boolean)` allocation plus a redundant
    `boughtOff` sweep over the whole log. `_replay()` now returns the snapshot it already had to
    resolve, and a new **private** `_economyFrom(evs, boughtOff)` tallies from it.
  - **Item 1 — `structuredClone` (REJECTED; the review's own #1 priority).** Measured on Node 22
    across every shape this engine actually clones — `weaponProf` map, stats block, string, number,
    small array, nested traditions entry — `JSON.parse(JSON.stringify())` won **every** case by
    1.9–3.1×, and swapping it in cost **~20% on `rebuildStateFromEvents()`** over the real fixtures.
  - **Item 7 — cache `DATA.*` in locals (REJECTED).** Measured delta was *negative* (≈−2.5 ns/op,
    i.e. −0.08% of one `compute()` call): V8's inline caches already make repeated monomorphic
    property access free.
  - **Item 6 — async Web Crypto signing (REJECTED).** `_sha256hex`'s own comment states it is
    synchronous and dependency-free specifically so it works in `file://` contexts with no
    SubtleCrypto/secure-context requirement. `crypto.subtle` is async and secure-context-only, so
    this would break a documented constraint *and* force `signPayload`/`verifyPayload` async — a
    breaking API change — for a hash that is not on any hot path.
  - **Item 4 — de-`forEach` hot loops (NOT DONE).** ~12 `forEach` closures, mostly single-pass over
    per-character arrays with at most tradition→discipline (2-level) nesting. With `compute()` at
    ~0.02 ms there is nothing here to win, and it would mean broad churn in the highest-risk
    function in the repo.
- **Why:** Two reasons this is recorded rather than left implicit.

  **First, the measurements invert the review's priority order, and the inversion is not obvious.**
  `compute()` on a real character costs ~0.02 ms and the arrays it iterates hold single-digit-to-low-tens
  entries, so the review's Set/property-caching items were optimizing microseconds; whereas replay was
  **quadratic** in log length (500-event log 0.49 ms → 2000-event 6.48 ms: 4× the events for 13× the
  time), which the review never identified. Fixing item 5 alone made `foldBuild()` on a 2000-event log
  **~14.6× faster (6.48 → 0.44 ms)** and linear. Item 2 removes a pass worth ~23% of a fold at 500
  events. Items 1 and 7 were net-negative or unmeasurable. A future agent handed a similar
  "low-risk, big-win" list should assume nothing about ordering without a benchmark — an external
  reviewer with no repo access cannot know which arrays are small, and here it guessed wrong on its
  own top-ranked item.

  **Second, `clone()` and `economy()` now look "unmodernized" on purpose.** `clone()` keeps an inline
  comment recording the benchmark, because "replace JSON round-trip with `structuredClone`" is exactly
  the kind of change a future reviewer will propose again; without the note it reads as an oversight
  rather than a measured decision. And item 2 was implemented as a **private** `_economyFrom()` rather
  than the reviewer's suggested optional second parameter on public `economy(events, pre)`: `economy`
  is bridged into all three tools (D-GH37) and called there in single-argument form, and AGENTS.md
  requires `engine.js`'s public API stay stable — the private split gets the identical win with zero
  public surface change and without promoting `activeEvents()`'s return shape into the contract of a
  second function.

  Reusing a pre-replay snapshot is safe because `_replay()` never writes to an event or to the log
  array — it reads event fields and mutates the build. `boughtOff` depends only on `e.type`/`e.refVal`,
  and the tally only on `e.type`/`e.amount`/`e.cat`/`e.cost`/`e.payload.v`, so a snapshot taken before
  the replay is identical to one taken after. This is asserted, not just argued (below).
- **Status:** Active. Verification: `testing/scripts/engine-parity-ci.mjs` **20 passed / 0 failed**;
  `testing/scripts/log-fuzz.mjs --iterations 3000 --events 60` clean; and a throwaway **differential
  test** ran the pre-change engine and the post-change engine side by side over the real fixtures plus
  4000 randomly generated LOGs (including `null` holes, drawback buy-offs, `creationLocked`/
  `campaignBound`/`noLock` combinations), comparing `compute()`, `economy()`, `activeEvents()`,
  `foldBuild()` and `rebuildStateFromEvents()` output as JSON — **20,021 checks, 0 mismatches.**
  `DATA.version` deliberately NOT bumped (the differential test proves `compute()` output is
  unchanged, so this is not a mechanics change), and `BUILD` deliberately NOT bumped (no user-visible
  change; a bump would mean touching three tool files to mirror a number nothing observable moved).

  Also fixed, same branch — see the addendum below: `engine.js`'s header comment claimed "~238 KB" and
  `AGENTS.md` claimed "~237 KB" for a file that is ~66 KB. On investigation *every* size figure in
  `AGENTS.md`'s read-budget list was stale, and the same wrong number was being handed to external
  reviewers via `docs/AI_review_prompt.md`.

## Addendum (2026-07-29) — the stale-size figures, and why they mattered to this very review

Flagged while verifying the perf claims above, then fixed on this branch once approved.

- **What was wrong.** `AGENTS.md`'s "Don't read large files wholesale" section — whose entire job is to
  inform agents' read-budget decisions — had a wrong number in every entry. Measured 2026-07-29:
  `js/engine.js` **~66 KB / 924 lines** (claimed ~237 KB); `docs/PACT-Players-Guide.html` **~1.4 MB**
  (claimed ~657 KB, i.e. understated by more than half); `tools/*.html` **~127–376 KB** (claimed
  "320–520 KB each", so DM Console at ~127 KB was overstated ~2.5×). And the actual biggest file in
  `js/` — `js/engine-data.js`, **~189 KB on ~13 lines** — was not in the list at all.
- **Root cause.** The ~237/238 KB figure was `engine.js` *before* REV-14a split the `DATA` blob out into
  `js/engine-data.js`. After the split, the number stayed attached to `engine.js` instead of following the
  data, so the list pointed agents away from the expensive file and toward the cheap one. The Players
  Guide and tool figures simply drifted as those files grew.
- **Why it mattered here specifically.** `docs/AI_review_prompt.md` — the live template used to
  commission external `engine.js` reviews — repeated the same figure as "**~237 KB** (mostly a large DATA
  blob)". The Copilot review that prompted this whole task was produced from that template, and its
  recommendations are consistent with believing the file was a large, hot data-heavy module: it
  prioritized allocation/GC micro-optimizations and `structuredClone`, and ranked the one genuinely
  quadratic defect fifth. A reviewer with no repo access can only reason from what the prompt tells it,
  so a stale size in the prompt is not a cosmetic docs bug — it degrades the review it buys.
- **Decision:** corrected all three *live* locations (`AGENTS.md`, `js/engine.js`'s header,
  `docs/AI_review_prompt.md`), added `engine-data.js` to the read-budget list, said plainly that
  `engine.js` is now small enough to read in full when the task targets it, and added to
  `AI_review_prompt.md` the fact that `compute()` costs ~0.02 ms on per-character arrays — so the next
  external reviewer is not set up to make the same misjudgement.
- **Deliberately NOT changed:** the same figures appearing in `decisions/2026/D-009.md`,
  `D-GH-2026-07-19-pwa-vs-capacitor-migration.md`, `docs/sessions/*`, and
  `docs/CHANGELOG-archive-*`. Those are historical records and the number was *correct when written*
  (pre-split); rewriting them would falsify the record rather than fix it. Only live, forward-looking
  guidance was touched.
- **Durability:** the `AGENTS.md` list now carries the measurement date plus an instruction to
  re-measure rather than trust it, because a confidently-wrong size is worse than no size — it silently
  misdirects the decision it exists to inform, which is exactly how this survived a 2–4× drift unnoticed.

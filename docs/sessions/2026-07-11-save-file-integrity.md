# Session — Save-file integrity (Feature B, D-GH48)

Branch `feat/save-integrity`. Implemented the roadmap's Feature B: tamper-evidence on saved/exported
character files.

## What shipped
- **Engine (`js/engine.js`)** — `SIG_ALG`, `signPayload()`, `verifyPayload()`, plus a self-contained
  synchronous SHA-256 and an order-independent canonical JSON serializer. All additive; `compute()` /
  `rebuildStateFromEvents()` untouched, `DATA.version` unchanged.
- **`js/character-store.js`** — owns the file-format policy. `buildCharacterEnvelope(fields, {sign=true})`
  signs by default (exports) and opts out with `{sign:false}` for the localStorage copies; the read-side
  mirror `verifyCharacterEnvelope()` returns `{status, tampered, envelope}`.
- **Three tools** — each bridge exposes `window.verifyCharacterEnvelope`. Live Sheet `importJSON` and
  CharGen `loadFile` flash a **non-blocking** warning on a `tampered` file; DM Console badges tampered
  roster cards (`⚠ edited`) and adds a Flags-&-notes line. (Both the `{sign:false}` opt-out and the single
  shared reader landed in the code-review round below — the first pass signed every save and checked
  `verifyPayload().status` in each tool.)

## Judgment calls worth remembering
- **Spec docs didn't exist.** The roadmap pointed at `IMPLEMENT-save-integrity.md` +
  `ENGINE-INTEGRITY-prompt.md`; neither is in the repo. Designed from the roadmap's "Done when" criteria
  and the existing code conventions instead.
- **Synchronous SHA-256, not `crypto.subtle`.** SubtleCrypto is async and unavailable in a `file://`
  non-secure context; the tools open both over GitHub Pages and locally. A synchronous pure-JS digest
  keeps every read-path integration a one-liner and works everywhere. Validated against the four NIST
  vectors before wiring anything.
- **Signing in the builder, verification in one shared reader.** Both live in `js/character-store.js` (the
  file-format owner): sign in `buildCharacterEnvelope`, verify in `verifyCharacterEnvelope`. A future save
  path is signed by default and a future reader is covered by calling the shared verifier — the "is this
  tampered?" predicate exists in exactly one place. (The verification centralization was a code-review
  refinement; the first pass had each tool poke at `verifyPayload().status`.)
- **`sig` is inert metadata.** The engine never reads it, so signed files price/rebuild byte-for-byte
  identically to unsigned — this is what keeps parity at 20/0 and lets older/unsigned files load silently
  (`unsigned` ≠ `tampered`). Flagging is non-blocking on purpose: inform, don't lock out.
- **Decision number: D-GH48, after two corrections.** The roadmap's reserved "D-GH10" was long stale, and a
  loose `sort -t H` over the DECISIONS grep mis-reported a max of "D-GH47"; a targeted grep put the true max
  at **D-GH46**, so this was drafted as **D-GH47**. On the pre-merge rebase, AUD-1 had already merged into
  `preview` and taken D-GH47, so this renumbered to **D-GH48** per AGENTS.md's renumber-on-collision
  fallback (with an addendum in `DECISIONS.md`). Exactly the collision class that rule exists for.
- **DM Console has two card renderers.** The default `view==='card'` path renders via `cardHTML()` → `#grid`;
  `renderTable()` (table view) calls `renderBody()` + `renderCards()`. The badge had to be added to
  `cardHTML` (the live default) *and* the table-view name column — an end-to-end browser test caught that
  the first pass had only patched the table-view functions.

## Code-review round (same session)
A `/code-review` pass over the diff surfaced one real bug and four cleanups; all were addressed before merge:
- **Bug (fixed) — false "tampered" on clean saves.** `_canonicalJSON` rendered `undefined`/sparse-hole
  array elements as empty while `JSON.stringify` (which writes the file) renders them as `null`, so a
  character with a sparse LOG array signed in-memory but read back `tampered` after the disk round-trip.
  Fixed with index-based iteration emitting `null` (`.map` skips holes); regression demonstrated then
  re-verified clean.
- **Efficiency — don't sign the localStorage copy.** `buildCharacterEnvelope(fields, {sign})` now signs by
  default (exports) but the autosave/local-save pass `{sign:false}` — that copy is never verified on load,
  so per-buy hashing was wasted work.
- **Altitude + dedup — one shared reader.** Added `verifyCharacterEnvelope()` next to the builder; all three
  tools call it (via `window.verifyCharacterEnvelope`) and branch on a single `.tampered` boolean instead of
  each poking at `verifyPayload().status`. Engine keeps the primitives; character-store owns file-format
  policy; tools are UI. The old `window.verifyPayload` exposure was removed.
- **UX — compose the load flashes** so a file that is both tampered and a different rules version shows both
  notices, not just the tamper one.

## Verification
- `testing/tests/engine-parity.html` → **20 passed / 0 failed** (browser + a headless Node replica), re-run
  after the review refinements.
- Live browser checks (before and after the review round): all three tools boot (`engine-ready`, no console
  errors); export envelopes are signed (`PACT-SHA256-v1`) while `{sign:false}` local saves are not;
  clean/round-tripped files verify `ok`, edited files `tampered`, unsigned files `unsigned`. Drove real
  clean + tampered files through the DM Console file-input pipeline and confirmed the `⚠ edited` badge
  renders on exactly the tampered cards.

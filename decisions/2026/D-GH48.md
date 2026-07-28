# D-GH48 — Save-file integrity: tamper-EVIDENT signing, in the engine, verified at every read path (Feature B)

Status: Active

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

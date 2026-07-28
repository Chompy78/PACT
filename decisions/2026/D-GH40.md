# D-GH40 — One unified save/export file format for both tools (was three divergent shapes)

Status: Active

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

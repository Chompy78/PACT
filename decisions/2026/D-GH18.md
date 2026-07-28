# D-GH18 — CharGen's `liveBase()` field diff vs `baseBuild()`: fixed the missing array, left `inPlay` out on purpose

Status: Active

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

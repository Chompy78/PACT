# D-GH-2026-08-24-warn-missing-data-refs — warn (don't silently no-op) when compute() hits a DATA reference that's been retired

Status: Active

## Context

Several `compute()` lookups silently no-op when a character references a racial trait/boon/drawback (and
other categories) that has been removed or renamed from `DATA` — surfaced while discussing what happens
if existing content gets removed from the rules. `js/engine.js`'s own docstring already documented one
instance of this class of bug (the `FEAT_ALIAS` comment: "compute()'s `if(!f)continue;` silently DROPS
the purchase — the character loses the feature and the AP it cost, with no warning anywhere"), but the
fix was never generalized to the other categories with the identical shape.

## Decision

Audited every `DATA`-lookup-then-`continue` pattern in `compute()`, not just the three the task board
named (racial traits, boons, drawbacks). Full site list, verified against the actual code rather than
assumed complete from the task text: **arts, racial traits, features, subAbilities, subSpellBundles,
boons, drawbacks** — 7 sites. Checked masteries, class/subclass reference counting, and feats too, per
the task's own instruction to check "for the same pattern" — none of the three has it: masteries price
by count (`DATA.mastery[mast.length]`), not by per-name lookup; `unlockedClasses` is used for counting
logic, not a DATA-table lookup; "feats" isn't a real category in this data model (no `b.feats` field
exists at all — likely already covered under "features").

**`/code-review ultra` found an 8th site the original audit missed:** `b.racialSpells` (lineage
spell-likes, looked up via `_lin.find(x=>x[0]===nm)`) has the identical shape — a per-name `DATA`
lookup that silently contributed 0 AP with no warning on a miss. Verified directly against
`js/engine.js` before fixing; same fix pattern (`_lin.find` fails → push the same warning wording,
`continue`, unchanged pricing behavior otherwise). New fixture **CG-038** (`lineage: "Drow"`,
`racialSpells: ["Retired Spell Not In Lineage"]`) covers it the same way CG-037 covers boons.

At each of the 7 sites, added exactly one line: when the lookup fails, push a warning naming the missing
reference (`"<label> is no longer in the rules data — no cost/effect applied"`) before the existing
`continue`. Existing skip/zero-fallback pricing behavior is completely unchanged — confirmed by 0 output
drift across all 57 pre-existing `engine-parity` fixtures.

Deliberately did **not** centralize the 7 sites behind a shared `_lookupOrWarn()` helper, per the task's
own default ("minimal, additive, lowest risk... don't use this task to also refactor `compute()`'s
overall structure — that's REV-14b's job"). Each site kept its own existing ad hoc structure, plus one
new line.

**Two sites needed real judgment to avoid a false positive, not a mechanical copy-paste:**
- `subSpellBundles`: the lookup (`DATA.subclasses[cls][sub].spellBundle`) is overloaded — a falsy result
  means either "this class/subclass combo doesn't exist in `DATA` at all" (a genuine missing reference)
  or "this subclass exists but legitimately sells no spell bundle" (the common, correct case for most
  subclasses). Only the former warns — checked the subclass object itself (`_sc`) before checking its
  `.spellBundle` field, rather than warning on any falsy `_bn`.
- `racialTraits` and `features` are **also** iterated by a secondary loop further down `compute()` for
  unrelated checks (cross-species/`reqRace` gates for traits; the prereq-chain walk for features) that
  would independently hit the same missing-reference case. Deliberately did **not** add a second warning
  in either secondary loop — doing so would push 2–3 duplicate "is no longer in the rules data" lines for
  one stale label. The primary pricing loop is the single canonical checkpoint; documented this once, in
  a consolidated comment at the first warning site, rather than repeating the reasoning at each secondary
  loop.

**Deviated from the task board's own suggested wording.** The task text proposed a `⚠` emoji-prefixed
message. Checked the actual convention in `engine.js` before writing anything: no `⚠` (or any warning
emoji other than `⛔` for hard violations) appears anywhere in the file's existing `W.push` calls — the
overwhelming majority of advisory warnings are plain text with no prefix at all. Used plain text,
matching the file's actual, verified convention over the task board's off-the-cuff suggestion.

**New fixture, CG-037** (a boon name absent from `DATA.boons`, built from the same minimal base as
CG-001): confirms the missing reference contributes 0 AP (total 2, identical to CG-001's baseline,
unaffected by the unrecognized boon) while the expected warning fires. Computed via `compute()` directly
before writing the expected CSV row/warnings entry, not guessed. `testing/tests/engine-parity.html`'s
`FIXTURES` manifest updated in the same change. **CG-038** (added for the code-review addendum above)
follows the identical pattern for the `racialSpells` site.

**`/code-review ultra` also found a real stored-XSS regression the original 7-site change introduced.**
Every prior warning in `compute()` names a curated `DATA` key (a rules-authored string); these 8 new
"is no longer in the rules data" warnings are the first case where the *label itself* is
attacker-controlled free text — whatever a signed-in user stored as a boon/trait/feature/spell name
before it was retired from `DATA` now flows verbatim into `compute().warnings`, and both CharGen and
Live Sheet render that array into `innerHTML` unescaped at the two sites that surface it:
`tools/PACT-CharGen-Webtool.html`'s warning-list renderer and `tools/PACT-Live-Char-Sheet.html`'s
"Rule warning: " issue line. DM Console's equivalent render already used `esc()`, which is what exposed
the other two as the actual bug rather than a pattern. Fixed both call sites with `esc(w)`, matching
the file's own existing convention (Live Sheet's adjacent line 1307-1309 already did this for a
different, pre-existing "no longer in rules" check — the fix brings the new sites in line with a
pattern already present in the same file, not a new one). Verified with two new `tool-pricing-ci.mjs`
regression tests (one per tool) that push a `boon` LOG entry with an `<img src=x onerror=...>` payload
as the label and assert (a) no live `<img>` element lands in the DOM (`querySelector('img')` false) and
(b) the escaped text is present in the rendered HTML (`innerHTML.includes('&lt;img')` true) — both
confirmed to fail red against the reverted fix before being trusted as green confirmations of the real
one.

## Why

- **Silent data loss with no trace is worse than a visible, harmless warning.** A character who loses a
  purchased feature's cost/effect because the rules content was renamed or retired had no way to know
  anything had changed — the AP simply stopped doing anything, with the stale label still sitting on
  the sheet looking legitimate.
- **The false-positive risk at `subSpellBundles` was real, not theoretical.** A naive "warn on any falsy
  bundle" would have fired on every ordinary subclass that simply doesn't sell a spell bundle — the
  common case, not the exception — which would have made the new warning noise rather than signal.
- **Duplicate warnings for one stale label would have undermined trust in the warning itself.** A player
  seeing the same "is no longer in the rules data" line three times for one racial trait would reasonably
  assume something is more broken than it is.
- **A warning that names attacker-controlled text is a new trust boundary, not a cosmetic addition.**
  Every other warning in `compute()` echoes a curated `DATA` key; these are the first to echo whatever a
  user previously stored as a free-text label. Skipping `esc()` at the two render sites would have turned
  a "helpful diagnostic" feature into a stored-XSS path the moment cloud data crosses between users —
  exactly the class of bug `AGENTS.md`'s `esc()` hard invariant (REV-12) exists to prevent, and exactly
  why `/code-review` treats it as a blocking finding rather than a style nit.

## Verification

`engine-parity-ci.mjs`: 59/0 (57 pre-existing fixtures unaffected, CG-037 and CG-038 exercise the two
new warning paths with values computed directly from `compute()`, not guessed). `tool-pricing-ci.mjs`:
170/0 (168 pre-existing checks unaffected, plus the 2 new XSS-regression tests — one per tool — both
confirmed to fail red against the reverted fix before being trusted green).

## Status

Shipped. `docs/TASK_BOARD_LATER.md`'s entry graduated to `CHANGELOG.md` in the same change.

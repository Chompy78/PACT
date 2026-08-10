# D-GH-2026-08-10-custom-appearance-fields — two free-form, player-labeled detail fields

Status: **Active**, 2026-08-10.

## Context

Owner request, same session as the appearance-persistence fix: CharGen's Appearance panel has ~28 fixed
fields (Gender, Age, Hair, Hometown, Faith, …), each a PACT-defined prompt with its own random table. The
owner wanted two additional slots for detail that doesn't fit any existing prompt — "2 custom description
fields which can be a sentence each."

## Options

- **A — Fixed, PACT-defined prompts** (matching every existing field's shape exactly — e.g. "Catchphrase",
  "Secret shame" as permanent labels). Simplest to build; no new UI pattern.
- **B — Fully custom, player-labeled** (the player types their own short label AND their own sentence —
  a blank "add your own detail" slot). More flexible; needs a new UI shape (a label input beside the
  value input) nothing else on this panel currently has. **Chosen** (owner's explicit pick).

## Decision

Two fields, each a pair of plain text inputs — one for the player's own label, one for their sentence —
with no fixed prompt and, deliberately, **no 🎲 randomiser and no 🔒 lock**: every other field's dice
button rolls from a themed table (`APPEAR[field]`), and there is no sensible random content for a slot
whose *meaning* the player invents. IDs: `ap_custom1Label`/`ap_custom1Text`/`ap_custom2Label`/
`ap_custom2Text` — the `ap_` prefix is deliberate, not cosmetic (see Why).

New `appearance` keys: `custom1Label`, `custom1Text`, `custom2Label`, `custom2Text`. Added to:
1. The Appearance panel markup (`apCustomField(idx)`, a new small builder beside the existing `apField()`).
2. `_domReadBuild()`'s `appearance` object construction (the DOM→build direction).
3. `applyBuild()`'s appearance-field restore list (the build→DOM direction — **the one direction the
   original per-field enumeration made genuinely easy to silently miss**: skipping it wouldn't break
   saving, only *reloading* — a loaded character would show blank custom fields, and the next unrelated
   appearance edit would then overwrite the real value with that blank, since `_domReadBuild()` reads
   live DOM state. Caught by hand-reading `applyBuild`'s own field list before writing any code, and
   locked in with a dedicated regression test — see Verification).

Deliberately **not** added to: the Sheet tab's own curated "Background & Personality" mini-panel (which
already omits ~15 of the 26 pre-existing fields — Father, Mother, Likes, Dislikes, Quirk, Demeanour, and
more — so leaving two more out is consistent with existing precedent, not a new gap), the AI-portrait
prompt builder (not a visual trait), and `genDescription()`'s auto-composed paragraph (a custom sentence
doesn't fit that template's fixed voice — "They are… They have… A characteristic habit:…" — and forcing
it in would read worse than leaving the two fields to stand on their own).

## Why

**The `ap_` id prefix is why this needed almost no new wiring.** `_cgPatchSlotForId(id)` already routes
*any* id starting with `ap_` (not `_lock`-suffixed) into `PATCH_SLOTS.APPEARANCE` via prefix matching —
a mechanism built for exactly this kind of extensibility. Manual typing into either new field commits to
the LOG through the *existing* generic delegation with zero new event-wiring code; the same mechanism
that already handles all 26 fixed fields' manual typing handles these two automatically. The only code
genuinely needed was the field's own DOM markup and its two mentions in the DOM↔build translation
(`_domReadBuild()`/`applyBuild()`) that every field already has to have.

## Verification

`testing/scripts/tool-pricing-ci.mjs`: 3 new checks — typing into a custom field commits via the existing
delegation with no new wiring; a loaded build correctly repopulates both custom fields' DOM inputs (the
`applyBuild` direction — **hand-verified to fail without that one-line fix**, reverted it alone and
re-ran before committing, confirming the exact silent-data-loss-on-reload gap named above); custom fields
are never touched by "🎲 Randomise all". 132/0 overall at this point in the session (grew again with the
name-pool check that follows). `engine-parity-ci.mjs` unaffected, 30/0 — Setup-panel UI/data-shape only,
no `DATA.version` change.

## Related

- `D-GH-2026-08-10-randomise-appearance-not-persisted` — same session, same panel; the persistence
  mechanism (`_shCommitAppearanceField`, `_cgPatchSlotForId`'s prefix match) this feature builds on.

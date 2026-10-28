# D-GH-2026-10-25-free-subclass-bare-pick — a free-subclass pick holds no slot until something is bought from it (rules v0.387)

**Context.** Owner decision N3 (2026-10-04). The Players Guide (§13/§14) says: "Your first subclass in each class you can build from is free
to open — but opening it is all that's free. Pick it, then buy each piece you want." `js/engine.js` priced it differently:
`free = freeSub[cls] || used[0]`, then EVERY other subclass used in that class paid `DATA.subUnlock` (15 AP). So a free pick with NOTHING
bought from it still held the free slot. Name Circle of the Moon free, buy nothing from it, then buy abilities from Circle of the Land: the
Land abilities were charged the 15 AP unlock although Land was the only subclass the player actually opened.

**Live measurement** (read-only, 2026-10-25, before any change; histories folded with the old and the new engine and `compute().total`
compared): 12 live characters carry any free-subclass event; 6 of them hold a BARE pick (nothing bought from that subclass); NONE has an
ability or spell list from a different subclass of the same class, so **0 characters' totals move**. (Today's Amble characters Moss and
Skylar are among the six and are unaffected, as the task predicted.) Event-sourced characters keep their frozen ledger either way.

**Options.**

- **Q1 — the engine.**
  - A. Honour `freeSub[cls]` only when that subclass appears in `subUsed` (a counted ability or spell list); otherwise fall back to the first
    subclass actually used.
  - **Decision: A.** One expression in the unlock loop. `subUsed` already excludes blocked (Hit-Dice / prerequisite) and duplicate abilities, so a
    pick whose only purchases are blocked is also bare, which matches "owned" meaning "bought".

- **Q2 — grant ownership.** `ownedChoiceGrants()` also treated a bare pick as owning the subclass. Made consistent: a pick owns the subclass only
  with a bought piece (an ability, or for a pick a spell list). Today this changes nothing, since the only subclass grants (Eldritch Knight,
  Arcane Trickster) are barred; it stops a bare pick reopening six free off-list spells the day they are un-barred.

- **Q3 — does CharGen stop recording a bare pick?** The task's step 2 said yes.
  - A. Filter `freeSub` in CharGen's `readBuild()` until a piece is bought. B. Leave CharGen alone: the engine ignores a bare pick.
  - **Decision: B — a deviation from the task, for the owner to confirm.** In CharGen the "— free subclass —" dropdown is the form's own state
    and is separate from the ability picker; filtering it out of the build would blank the dropdown on every reload, undo and cloud load, and
    the Live Sheet's "Free subclass →" buy would still write the event. With the engine as the single authority a recorded bare pick is
    harmless (it prices and grants nothing), so there is nothing to un-write. Doing A later is a CharGen-only follow-up.

- **Q4 — Players Guide.** The Guide's prose already stated the rule; the engine disagreed. One explicit sentence was added to "Buying a
  subclass" in BOTH the served copy and the `pact-guide` master: "A subclass you name but buy nothing from holds no place: the free one is the
  first subclass you actually buy a piece of, whichever one you named." `verify-guide.mjs` passes before and after.

**Version.** `DATA.version` v0.386 -> v0.387, once, in the engine; the three tool labels follow (`version-label-ci.mjs` 10/10).

**Pinned by** parity fixtures CG-096 (bare Moon pick + Land bought: 73 -> 58), CG-097 (used pick honoured: 84, unchanged), CG-098 (bare pick,
nothing bought: 52), CG-099 (bare pick + only a Land spell list: 74 -> 59). `engine-parity` 140 passed / 0 failed.

**Status.** Accepted pending the owner's confirmation of Q3.

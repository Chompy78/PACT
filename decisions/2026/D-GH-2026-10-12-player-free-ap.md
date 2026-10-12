# D-GH-2026-10-12-player-free-ap — players can't grant themselves AP or get AP back after the lock

**Context.** The 2026-10-12 logic audit (`fix/player-free-ap` on the task board) found six ways a player could grant themselves AP,
or get AP back, outside the DM's control:
1. Live Sheet's DM tools strip ("+ Award AP", "+ Discount", "⎘ AP code") was live on a player's own campaign character. The award
   has no `noLock`, so it gives spendable AP (unless the DM set `ignore_player_ap`) and becomes a permanent undo barrier and a
   server freeze boundary.
2. CharGen's DM Calls toggles and DM customisations were player-editable on campaign characters and after the creation lock. Both
   are priced (`compute()` reads `b.houseRules`): a custom drawback at 60 AP grants 60 AP.
3. CharGen's starting gold (`ECONOMY` slot, 1 AP per step) could be lowered after Finish creating, refunding AP.
4. The server's freeze (`pact_patch_exempt_keys()`, applied 2026-10-10) treats `houseRules` and `gold` as "no-AP" fields that stay
   editable after a lock. Both are priced.
5. A locked campaign character with no award in its LOG (budget 0) could type a budget and append a fresh award. Read from the SQL
   (the database was not reachable this session): the server accepts it. `pact_enforce_locked_history()` is append-only past the
   lock/award boundary, and `pact_enforce_ap_budget_consistency()` counts the new award as player-earned AP unless
   `ignore_player_ap` is on.
6. Turning the DM "Bound" option off cleared `#martiallyBound` on screen only (the grant stayed in the `MISC` patch, still −2 AP),
   and its `[id^="mbound_"]` selector matched nothing (the boxes are `.disc-bound`), so Magically Bound was never cleared.

The owner was away. Each choice below was taken under standing instruction **H2** (pick the most conservative option: the one that
refuses, locks or hides rather than grants AP or opens an edit).

**Options and decisions.**

- **Q1 — which Live Sheet buttons, and on what test of "campaign character".**
  - A. Hide only "+ Award AP". B. Hide "+ Award AP", "+ Discount" and "⎘ AP code" (all three let a player mint AP), keep
    "⎀ Redeem". C. Hide the whole strip, Redeem included.
  - **Decision: B**, keyed on `window._lsCampaignId` (any route — autosave, file, cloud row). `award()` and `makeGrant()` also
    refuse, so a stray call can't bypass the hidden buttons. Redeem stays: a DM-issued code is the documented way a DM hands a party
    AP, and its `grantId` makes it distinguishable from a typed award. A Live Sheet binding is not "confirmed" the way CharGen's is;
    the any-route test is the conservative one, and a stale binding only hides buttons until the cloud load corrects it.
  - Known, left alone: an AP code is tamper-evident, not secret (`js/ap-grant-code.js` header). A player can still mint one in
    the DM Console (or by hand) and redeem it. That is the module's documented, accepted limit; the server's `ap` column remains
    the only authoritative DM AP.

- **Q2 — should a SOLO self-award become `noLock`?** (the task asked the owner to decide.)
  - A. Make it `noLock` (no undo barrier, no freeze boundary). B. Leave it unchanged.
  - **Decision: B.** Changing it would alter the undo semantics of every existing solo log that already carries such an award, and
    a solo player is their own DM. Revisit with the owner.

- **Q3 — when are CharGen's DM house rules read-only?**
  - A. Any-route campaign binding or after the lock. B. Confirmed binding (`_cgCreationApIsDms()`, #634) or after the lock.
  - **Decision: B**, as directed. An unconfirmed binding (offline, signed out, stale file after an unbind) leaves a possibly-solo
    player's own table rules usable before the lock. After the lock they are fixed for everyone, solo included. The controls are
    disabled (still readable), and every writer refuses (`dmAdd`, `dmDisableBuiltin`, `dmRemove`, `dmToggleDisable`,
    `updateDmToggles`, and the `HOUSE_RULES` path of `onPatchFieldChange`).

- **Q4 — starting gold after the lock: refuse only a decrease, or both?**
  - A. Refuse a decrease, allow an increase as an in-play purchase. B. Refuse both.
  - **Decision: B.** The Live Sheet has no gold purchase to mirror, so an increase would have no vetted in-play price. Gold earned in
    play goes through the Live Sheet's 🎒 Record gold & downtime, or a DM grant. `economy` joins `_CG_POSTLOCK_SLOTS`.
    `fix/chargen-post-lock-purchases` is not extended.

- **Q5 — the server's exempt list (item 4).**
  - A. Write a migration that removes `houseRules` and `gold` from `pact_patch_exempt_keys()`, marked NOT APPLIED. B. Correct the
    `feat/server-freeze-at-lock` board entry so the next server change carries it.
  - **Decision: B.** No unapplied SQL is left lying around. The client now refuses both fields after the lock, so the server change is
    defence in depth, not the only guard. Before applying it, the owner should measure the blast radius: live locked characters
    whose saves rewrite `houseRules`/`gold` would start being refused.

- **Q6 — item 5's test of "campaign character".**
  - **Decision:** any-route binding (`_cgIsCampaignBound()`) and locked, the same test `_cgLockFloor()` already applies to this field
    when an award exists. Solo locked characters keep editing their own budget, which is unchanged. The budget field is disabled
    in that state, and `_cgSyncAward()` refuses a changed figure and puts the field back.

- **Item 6** was a plain bug, so no decision was needed. Both grants are now cleared through the LOG (`MISC` and `TRADITIONS`
  slots). The Martially Bound reset still asks first, as before.

**Why.** Each player-side path to AP or an AP refund after the DM takes over is closed in the client. Solo play is left as it was,
and so is the one legitimate DM-to-player channel that lives in the player's tool (Redeem). The server change stays a recorded
follow-up, not a silent assumption.

**Status.** Provisional: the owner was away, taken under standing instruction H2, reversible (client-only; no migration written).

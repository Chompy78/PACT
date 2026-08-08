# D-GH-2026-08-08-chargen-local-cloud-split-new-character

**Context.** After `D-GH-2026-08-08-header-declutter` shipped, the owner reviewed CharGen's resulting
header and flagged it as still not great: cloud actions sat behind a lone icon-only "⋯" button in the
header's top row (`.hd-row2`), while local Save/Load lived as separate plain buttons in the row below
(`.hd-row3`) — two different concepts, in two different places, one of them unlabeled. Separately, the
owner noted two related gaps: there is no "New Character" button, and "the reset doesn't really work as
intended anymore."

Investigating the second point (code read, not assumed): `resetBuild()` → `applyBuild({})` already mints a
**brand-new character id** on every call, because a blank build has no `.id` and `applyBuild()`'s own
existing logic falls through to `genCharId()`. This was apparently deliberate, but nothing in the UI told
the user it happened — hitting Reset on a saved character silently detaches from it and starts an
anonymous new one, while the original stays exactly as last saved. If the user kept editing after Reset, a
new orphan row would appear in their cloud characters list with no explanation. A further, real bug was
found while tracing this: if an edit lands inside the 3-second cloud-autosave debounce window and Reset
fires before that timer completes, the pending push gets silently redirected to the *new* id's blank
envelope when it fires (`_cgCloudPushOnce()` reads `currentCharId()`/`_cgEnvelope()` at fire time, not
schedule time) — the outgoing character's last pre-reset edit never reaches the cloud.

**Options considered (Reset/New Character semantics, presented to the owner):**
- **A — merge them.** Relabel Reset to "🆕 New Character," keep its existing new-ID behavior (nothing
  about the previous character is touched), and make the confirm text say plainly what happens. Lowest
  risk/effort — the underlying behavior already works, this only makes it honest and discoverable.
- **B — keep them separate.** Reset reverts to true in-place semantics (wipes the *currently open*
  character back to blank, same ID — so a saved cloud character would be overwritten on the next
  autosave), with a new, distinct New Character button for the detach-to-fresh-ID case. More flexible but
  reintroduces a real overwrite risk on Reset that would need a strong data-loss warning.

**Decision:** A, chosen directly by the owner.

**Why.** The in-place "wipe this exact character, same ID" semantics Option B would have restored is
exactly the behavior the *current* code doesn't have and would need new code (and a much scarier confirm
dialog) to build — Option A instead makes the code's actual, already-tested behavior honest, which is
both less work and safer.

**What changed, concretely:**
1. `resetBuild()`'s internal id-minting behavior is unchanged; a new `newCharacter()` wrapper flushes any
   pending cloud autosave for the character being left behind (`_cgFlushCloudSaveNow()`, the same
   mechanism `switchToLiveSheet()` already uses before navigating) *before* calling `resetBuild()` —
   closing the debounce-redirect data-loss window described above.
2. Both places the old "↺ Reset" button lived (`.hd-row3` desktop toolbar, `.hd-mobnav` mobile bar) now
   read "🆕 New Character" / "🆕 New," calling `newCharacter()`, with confirm text that states plainly what
   survives: *"Start a new character? Any changes not yet saved (to the cloud or a file) will be lost.
   Your current theme is kept."* (Deliberately not "your current character stays safe" — for a signed-out,
   never-explicitly-saved character, the single-slot local autosave IS destroyed, so an unconditional safety
   claim would have been false.)
3. A new "📁 Local" dropdown (mirroring the existing "☁ Cloud" dropdown's open/close pattern) now holds
   New Character, Save to file, and Load from file as menu items, replacing the standalone Save/Load
   buttons that used to live in `.hd-row3`. It sits in `.hd-row2`, directly beside the Cloud dropdown (which
   got its icon-only "⋯" label back to a readable "☁ Cloud" now that it has a labeled sibling to be
   distinguished from) — satisfying "clearly split local and cloud into separate items on one header row."
4. Mobile is unaffected beyond the Reset→New Character rename: `.hd-row2`/`.hd-row3` (where both dropdowns
   live) are already hidden below 768px in favor of the separate `.hd-mobnav`/`.mobile-action-bar` rows —
   a pre-existing gap (cloud sign-in/campaign/autosave controls have no mobile-nav equivalent at all) that
   is out of scope for this change and not touched here.

**Verification:** `engine-parity-ci.mjs` 29/0, `audit.py` 0 failed (no rules/`compute()` involvement, no
`DATA.version` change), plus a headless-Chromium smoke pass confirming: the Local menu opens/closes and
contains all three actions, clicking New Character mints a different `currentCharId()` value and closes
the menu, the mobile nav shows "New" not "Reset," and Save/Load still function without throwing.

**Status:** DECIDED and SHIPPED (2026-08-08, branch `claude/header-save-state-clarity-bt6sjy`).

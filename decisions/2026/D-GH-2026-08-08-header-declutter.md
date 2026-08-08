# D-GH-2026-08-08-header-declutter

**Context.** `docs/plans/2026-08-08-header-simplification-universal-autosave.md`'s stated goal was to
replace PACT's three inconsistent cloud-status badges with one shared design and stop the manual
"☁ Save to cloud" button from being the thing a user has to remember to click. Part A (navigation flush
fix) and Part B (shared sync chip + universal autosave, `docs/plans/2026-08-08-shared-sync-chip-part-b.md`)
both shipped, but B2's own implementation note explicitly kept the new sync chip *additive* rather than
replacing the older campaign-rules-binding badges (`cgCloudStatus` in CharGen, `cloudStatusBadge` in Live
Sheet) — reasoning that those badges were dual-purpose (also carrying campaign-binding info the chip
doesn't). That left CharGen and Live Sheet's headers with 5-6 always-visible cloud-related elements: the
status badge, a sign-in link, a campaign `<select>`, the sync chip, an Autosave checkbox, and the ⋯/☁
cloud menu button — several of them saying the same thing in different words (e.g. the badge's "Signed in
— no campaign selected" duplicated both the campaign `<select>`'s own "— no campaign —" state and the sync
chip's "☁ Signed in" text). The owner asked directly for this to be simplified, plus for the header's
"Last edited" (file build) timestamp to move somewhere that doesn't cost header space on every screen
size, not just mobile.

**Options considered (presented to the owner):**
- **A — minimal dedup.** Remove only the exact redundant text named, plus its signed-out mirror. Lowest
  risk, smallest diff, leaves the ~6-element cluster otherwise unchanged.
- **B — moderate consolidation.** Everything in A, plus fold the Autosave toggle into the existing ⋯/☁
  cloud menu as a settings item, since it's a set-once-and-forget setting, not a live status. Drops the
  always-visible cluster to 3 elements (sync chip, sign-in-link-or-campaign-dropdown, ⋯/☁ menu). Moderate
  effort, still low risk — mostly relocating already-working code, not new logic.
- **C — full redesign.** Replace the whole cluster with one button opening a popover holding sign-in,
  campaign picker, autosave toggle, and save/load together. Biggest visual win, highest effort/risk — a
  new shared popover component, in an environment with no real-browser interactive verification available
  beyond a scripted smoke pass; per `AGENTS.md` this scale of UI rework would warrant its own
  `/make-code-cold-plan-review` rather than folding into this task.

**Decision:** B, chosen directly by the owner.

**Why.** A meaningfully reduces visible clutter without the added risk and scope of building a new shared
UI component (C) in an environment that can't do interactive manual QA — a scripted headless-Chromium
smoke pass (element visibility, populated timestamps, menu open/render) is the strongest verification
available here, and B's changes are small and mechanical enough for that to be sufficient confidence; C's
would not be.

**What changed, concretely:**
1. `cgCloudStatus` (CharGen) / `cloudStatusBadge` (Live Sheet) now render **only** the campaign-bound
   state (a campaign name plus whether its rules fetched successfully) — the "not signed in" and "signed
   in, no campaign" branches are hidden (`display:none`) rather than shown with duplicate text, since the
   sign-in link, campaign `<select>`, and sync chip already cover those states.
2. The Autosave toggle (`cgAutosaveChk`/`lsAutosaveChk`, same element ids reused) moved from a persistent
   header chip into the ⋯/☁ cloud menu, rendered fresh (with the correct `checked` state) each time the
   menu opens. No change to the gate/toggle-handler functions themselves (`_cgAutosaveGate()`,
   `_cgOnAutosaveToggle()`, and their Live Sheet twins) — only where the checkbox lives in the DOM.
3. The `.lastedited` span (the tool file's own `document.lastModified` build date — not a character's
   save time) moved out of the header into each tool's Info panel (CharGen/Live Sheet, via a new
   `#infoLastEdited` element inside `#infoBox`) or footnote (DM Console, which has no info modal). DM
   Console's version of this text had never actually been live — no `document.lastModified` script existed
   for it, unlike the other two tools, so it was a permanently-stale hardcoded placeholder; fixed in
   passing rather than relocating stale text verbatim.

**A defect caught and fixed during implementation, worth naming:** the population script for
`#infoLastEdited` was initially placed in the `<script>` block immediately following the info modal's
*opening* markup — which runs before the browser has parsed `#infoLastEdited` itself (it lives further
down, inside `#infoBox`). `document.getElementById()` returned `null` at that point and the timestamp
silently never populated. Caught by comparing byte offsets of the markup vs. the script call in the raw
file (not by browser testing, which was done afterward as confirmation) before it ever reached a real
page load. Fixed by moving each population script to run after its target element's markup, in DOM order.

**Deferred, not done here:** DM Console's own header (topbar + `campWho`) was left unchanged — it was
already minimal (no overlapping status elements) going into this task, so Option B's cluster-reduction
target didn't apply to it. Option C (a single unified cloud popover) remains available as a future task if
the owner wants to revisit it, scoped as its own cold-plan-reviewed change per `AGENTS.md`.

**Verification:** `testing/scripts/engine-parity-ci.mjs` 29/0 (no rules/`compute()` involvement, no
`DATA.version` change); `testing/scripts/audit.py` 0 failed; a one-off headless-Chromium smoke script
(not committed — this is UI-only relocation, not new logic warranting a permanent gate) confirmed, for
all three tools: the last-edited timestamp populates with real text, the header no longer contains the
removed redundant strings, and the cloud/⋯ menus still open and render without console errors.

**Status:** DECIDED and SHIPPED (2026-08-08, branch `claude/header-save-state-clarity-bt6sjy`).

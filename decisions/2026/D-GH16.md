# D-GH16 — Campaign rules follow-up: live-filter pickers where a pick surface exists, not everywhere

Status: Active

- **Context:** D-GH14 shipped enforcement, but only at the last possible moment — Live Sheet's "Save to
  cloud" click. A player who builds around a banned choice only finds out after the fact and has to undo
  work. The obvious full fix (give CharGen, where species/origin class are actually chosen, live
  campaign-rule awareness) needs sign-in + campaign selection in a tool that has neither today, plus Task
  6 (CharGen isn't on the shared engine bridge yet) — real scope, filed separately as its own roadmap item
  rather than rushed in. This decision covers the smaller, immediate piece: what Live Sheet itself can
  live-filter right now.
- **Options:** (i) leave enforcement at cloud-push only (status quo, cheap, but doesn't touch the actual
  complaint); (ii) **live-filter every banned category everywhere the app could conceivably show it**;
  (iii) **live-filter only categories Live Sheet actually lets a player pick**, and be explicit that the
  rest stay push-time-only.
- **Decision:** (iii). Checked what Live Sheet actually exposes as a live pick: weapon masteries and
  boons are genuinely selectable there, so both are now filtered out of their pickers the moment a
  banned item's campaign rule is known — a banned option simply never appears to select. Species,
  origin class, and multi-discipline are **not** pickable in Live Sheet at all (species/origin class are
  fixed at character creation — set in CharGen or the initial build — and multi-discipline purchasing
  doesn't exist yet, pending Feature A); there is no picker to filter, so those three stay enforced only
  at "Save to cloud" (D-GH14), same as before this change.
- **Decision (owned-but-now-banned items):** an item the player already owns stays visible in the picker
  list (shown as owned, not hidden) even if a DM later bans it. Hiding it entirely would make it
  unmanageable through the UI — the owned-item control is also how a player would undo/sell it back — so
  filtering only ever removes *not-yet-purchased* banned options, never something already on the sheet.
  D-GH14's "Save to cloud" block still catches the already-owned case if it's ever pushed.
- **Decision (when rules are fetched):** Live Sheet has no automatic server reconcile on a plain page
  load — cloud sync only happens when the player interacts with the cloud menu. Added a fetch on
  sign-in/session-ready (`refreshCloudCampaignRules()`) so filtering is live from the moment the page is
  usable, not just after an explicit "Load"; the existing "Load a saved character" flow was extended to
  reuse its already-fetched campaign object instead of a second network round-trip. The authoritative
  check at cloud-push in D-GH14 still re-fetches fresh rules independently — the live-filter is a UX
  layer on top, not a replacement for it.
- **Why:** matches the same trust posture as D-GH14 — client-side guardrails for honest workflows, not a
  security boundary — and avoids overselling what this pass delivers: it measurably shortens the
  "build → get blocked → go back" loop for masteries/boons, and is honest that species/class/multi-disc
  still can't be caught early until the CharGen work lands.
- **Status:** IN FORCE as of 2026-07-02. `tools/PACT-Live-Char-Sheet.html`: `cloudRuleBarred()`,
  `refreshCloudCampaignRules()`, mastery/boon picker filters. Follow-up filed as a new roadmap item
  ("CharGen campaign-rules awareness") for the species/origin-class/multi-discipline gap.

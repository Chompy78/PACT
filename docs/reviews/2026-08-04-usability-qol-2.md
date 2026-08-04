# PACT usability & QoL re-review — 2026-08-04, pass 2 (v1.343)

> **Filename note.** This is a second pass on the same calendar date as the previous report
> (`2026-08-04-usability-qol.md`), so it's suffixed `-2` rather than overwriting it — the prior
> file's outcome annotations are exactly what this pass is diffing against, and `docs/reviews/README.md`
> is explicit that these are kept precisely so a later pass can be compared to an earlier one.

**Environment proven live before any finding.** Signed in as `dm@review.pact.test` through real
headless Chromium routed via `testing/scripts/lib/chromium-relay.cjs` (the loopback TLS-terminating
relay this sandbox needs — Chromium's GREASE ClientHello gets RST'd by this environment's egress
proxy otherwise) and fetched that account's own `profiles` row straight from the live REST API:
`200`, `{"display_name":"DM Morgan"}`. That's a genuine backend round trip, not a relayed artifact,
before a single UI journey was walked.

**Dialog handling, stated per flow.** A global `page.on('dialog', ...)` handler was registered
before touching any tool, and every confirm()/prompt() this pass triggered is logged with its exact
message, which branch was taken, and the resulting dialog count — see each finding/journey note
below. Two confirm-gated flows were deliberately walked down BOTH branches this pass (invite
decline-then-accept in Journey 2; a real invite-withdraw and a real campaign-archive in Journey 4/5).

**Seed stack:** `node testing/scripts/seed-review-stack.mjs --live` — 5 accounts, 3 campaigns,
invites in 4 states, as documented in the script header. **Purge run and confirmed at the end of
this session:** `node testing/scripts/seed-review-stack.mjs --live --purge` exited 0, log ends
`purge complete — cascades removed their profiles, characters, campaigns, invites and awards.`
All 5 `@review.pact.test` accounts were removed.

**Escaping/XSS check (the task's own CRITICAL trigger): PASSED on every reachable surface,
including one CharGen surface the last pass couldn't reach.** The seeded
`Bob "The Knife" <b>O'Malley</b> & Sons …` character rendered as literal, escaped text everywhere
it could be exercised — My Characters, and (new this pass) CharGen's own "☁ Cloud → Load saved
character" list, which renders the same string twice per row (visible text **and** an HTML
attribute) and escapes both correctly. See the CharGen-load NOT ASSESSED note below for the one
gap: a data-authoring quirk in the seed script means this specific character can't be loaded into
CharGen/Live Sheet's own name field to check that exact path.

---

## Findings

Two new items surfaced this pass. Nothing regressed — every fix independently re-verified below
held up, several with stronger evidence than the original report had (pixel-level overlap math
instead of eyeballed screenshots, a fully keyboard-only path instead of a mixed one). Ordered worst
first.

### DM Console's "Invites issued" list hides every redeemed/withdrawn invite by default, with no count — "which invite went to whom" isn't answerable without knowing to tick a checkbox
Severity: MEDIUM
Status:   NEW
Where:    DM Console — Campaign (cloud) → Invite new player → Invites issued
Repro:    1. Sign in as dm@, select a campaign with a mix of open/redeemed/withdrawn invites. 2. Expand "Invite new player." 3. Read the "Invites issued" list without clicking anything else.
Impact:   The default list shows OPEN invites only. In the test campaign this pass (5 issued invites: 1 open, 2 redeemed, 2 withdrawn), the default view showed exactly 1 row — the other 4, including which player redeemed which link, were completely invisible until "Show redeemed & withdrawn" was ticked. The checkbox itself is clearly labeled and easy enough to find, but nothing on the collapsed row hints that 4 more invites exist behind it (no count, no badge) — a DM skimming this panel to answer "which invite did I send Sam" would see one open invite and reasonably conclude that's the whole history. This is the task's own framing for the DM journey, and it isn't answerable from the panel's default state.
Evidence: default state text dump: `"Review journey4 throwaway invite …\n10 AP\nOPEN\n..."` (1 row) vs. after ticking the box: 5 rows including `"Sam — veteran tier, joining mid-campaign\n120 AP\nREDEEMED\nRedeemed 2026-08-04 by Player Sam — Sera Valor"` and 2 `WITHDRAWN` rows — captured in the same session, same campaign, only the checkbox state differed.
Fix:      Add a count to the "Show redeemed & withdrawn" label itself (e.g. "Show redeemed & withdrawn (4)") so the collapsed state at least signals there's history behind it, the same pattern already used for the campaign-rules and invite-tile summary badges elsewhere in this file.

### CharGen's Info dialog close button still has no accessible name — the focus-trap fix shipped, the aria-label part of the same fix didn't
Severity: LOW
Status:   NEW
Where:    CharGen — "ℹ️ Info" dialog close control, `tools/PACT-CharGen-Webtool.html:4035`
Repro:    1. Open the Info dialog (mouse or keyboard). 2. Inspect the close button's accessible name.
Impact:   The 2026-08-04 pass's MEDIUM finding here had two asks in its Fix line: trap Tab/Shift+Tab (done, verified below) **and** "add `role="dialog"` + `aria-modal="true"` + an `aria-label` on the close button" (only the first two of those three landed). The button is still `<button class="close-btn" onclick="closeInfo()">&#x2715;</button>` — no `aria-label`, no `title`. Its accessible name is whatever a screen reader makes of the raw "✕" glyph (typically read as a symbol name, not the word "Close"), so a non-sighted keyboard user reaches a working close control but doesn't get a clear label for what it does. Everything else about the dialog's keyboard behavior — initial focus, the trap itself, Escape, focus restoration to the opener — is solid; this is a narrow, cheap leftover, not a regression of the part that was actually fixed.
Evidence: `document.querySelector('.close-btn').outerHTML` → `<button class="close-btn" onclick="closeInfo()">✕</button>` (no `aria-label`/`title` attributes), captured in this session; screenshots `j1-08-info-modal-tabbing.png`, `j8-08-info-modal-keyboard.png`.
Fix:      Add `aria-label="Close"` (or `title="Close"`) to the button — a one-attribute change.

---

## VERIFICATION SUMMARY

Every finding the previous report marked **FIXED** outright, re-checked against the running app
this pass. All held. Items marked "not re-verified" below weren't part of this pass's assigned
journeys (1–8) and are carried to NOT ASSESSED rather than assumed.

| # | Finding (previous severity) | Verified this pass | Evidence |
|---|---|---|---|
| 1 | CRITICAL — invited player can never get a playable character | **STILL HOLDS** | Journey 2: signed-out invite → sign-in redirect preserved the token → declined (dialog 1, dismissed) → banner offered "Accept invite"/"Discard invite", no drop → accepted (dialog 2, accepted) → character created, bound, 0/79 AP. My Characters: exactly 1 row, no orphan. |
| 2 | HIGH — CharGen ↔ Live Sheet handoff forks a duplicate | **STILL HOLDS** | Journey 3: CharGen edit → Live Sheet (award via 2 prompt() dialogs, handled) → back to CharGen → My Characters shows exactly 1 "Aldric Valor" row, same id both legs. |
| 3 | HIGH — Feedback button overlaps controls (mobile Live Sheet/DM Console, desktop DM Console) | **STILL HOLDS** | Journey 7: pixel-precise `getBoundingClientRect()` overlap math (not eyeballed) — Live Sheet pill vs. bottom bar/Undo/Redo: no overlap (12px clear gap). DM Console pill vs. "Banned origin classes" grid: no overlap, no checkbox covered. |
| 4 | HIGH — CharGen quick-nav off-by-one, "11 Arts & Boons" dead | **STILL HOLDS** | Journey 1: chip bar now reads 7 Classes/8 Subclasses/9 Spellcasting/10 Arts & Boons (10 chips, 10 sections, no orphan 11); clicking "7 Classes" lands on section 7 correctly (screenshot). |
| 5 | HIGH — mobile Class Access & Features grid clipped | **STILL HOLDS** | Journey 7: `document.documentElement.scrollWidth === clientWidth === 390` at 390×844, and section 7's own scrollWidth/clientWidth also equal (360=360) — no horizontal overflow anywhere on the page or within the section. |
| 6 | HIGH — DM roster requires manual refresh to show a new joiner | not re-verified this pass | Every DM Console load this pass was a fresh navigation (which trivially shows current data); the specific "tab already open, player joins, refocus without reload" scenario wasn't exercised. |
| 7 | HIGH — AP shown inconsistently, roster card shows none without drilling in | **STILL HOLDS** | Journey 4: roster card's always-visible stat strip leads with "AP LEFT" (3 / 3 for the two built characters) — no need to expand DM tools. |
| 8 | MEDIUM — CharGen Cloud button white-on-white | **STILL HOLDS** | Journey 1: `color: rgb(255,255,255)` on effective ancestor background `rgb(31,56,100)` (dark navy) — clearly legible in screenshot, not the previous 1:1 white-on-white. |
| 9 | MEDIUM — Info modal no focus trap | **STILL HOLDS** (see NEW LOW above for the one leftover sub-item) | Journeys 1 & 8: `role="dialog"` `aria-modal="true"`, initial focus on close button, 15–20 consecutive Tabs never escaped `#infoBox` (checked twice, once mouse-opened, once fully keyboard-opened from a cold page load), Escape closes and restores focus to the opener. |
| 10 | MEDIUM — Invites/Rules/Archived hidden with no summary badge | **STILL HOLDS** | Journey 4: collapsed "CAMPAIGN RULES" row reads "· 1 ban · 2 house rules · joins grant 79 AP" without expanding. (Note the adjacent, narrower NEW MEDIUM above — the invite list's *redeemed/withdrawn* rows specifically still lack this treatment.) |
| 11 | MEDIUM — brand-new campaign gives no pointer to "Invite new player" | **STILL HOLDS** | Journeys 5 & 6: a freshly created campaign's empty roster immediately reads "No characters in this campaign yet. **Invite a player**" (clickable hint), reproduced on two independently created campaigns. |
| 12 | MEDIUM — "Starting AP" tooltip claims pre-fill, field was empty | **STILL HOLDS** | Journey 4: tooltip text captured verbatim this pass states the condition ("Pre-filled … WHEN that campaign has one saved; if this box is empty it means none is set, and the invite will grant 0") rather than promising an unconditional pre-fill. |
| 13 | LOW — ability-score labels/badges below WCAG AA contrast | not re-verified this pass | No automated contrast pass was run this pass; out of the 8 assigned journeys' scope. |
| 14 | LOW — save/load toast red, silent, never auto-dismisses | **STILL HOLDS** | Journey 1: toast is tone-aware (green `rgb(20,83,45)` for a success message, not the old maroon), carries `role="status"` `aria-live="polite"`, and disappears on its own (confirmed via the 2.6s `setTimeout` in `js/ui-helpers.js`, and observed clearing in practice). |
| 15 | LOW — no confirmation after archiving a campaign | **STILL HOLDS** | Journey 4: green toast "Archived '[REVIEW] DM Journey4 Archive Target' — find it under 'Show archived' to restore it." — names the campaign, points at the way back. |
| 16 | LOW — two near-identical "DM notes" fields | **STILL HOLDS** | Journey 4 screenshot: per-character field reads "DM notes about THIS CHARACTER — private, the player never sees these," distinct from the campaign-level field's own scoped label. |
| 17 | LOW — DM roster AC renders as truncated "10 /" | **STILL HOLDS** | Journey 4 screenshot: AC now shows a clean "10" beside a placeholdered "+AC" pill, not a bare trailing slash. |

Not included above (excluded by design, per the task brief): the four **NOT DONE**/**WON'T FIX**
items (archived-campaign read-only view, three-ways-to-join hierarchy, default-name mismatch,
native `confirm()` for campaign-join) are recorded product decisions, not re-litigated. The three
**NOT A BUG**/**PARTIALLY FIXED**/**NOT REPRODUCED** items (stale invites list — superseded by this
pass's own new MEDIUM above on a related but distinct angle; revoked-invite-signed-out banner;
console error on DM sign-in) were spot-checked incidentally this pass (see Journey notes) and
nothing changed their prior status.

---

## NOT ASSESSED

- **CharGen/Live Sheet's own name-rendering path for the exact Bob O'Malley payload.** The seeded
  test character's dangerous name lives in the `characters.name` DB column (patched directly by
  the seed script to plant it without a normal save), but CharGen/Live Sheet read the character's
  *own* LOG-embedded name instead, which still holds the pre-patch value ("Untitled draft"). So
  this specific character can never surface the string through those two tools' own rendering —
  checked the seed script and `_cgApplyEnvelope()` directly to confirm why, rather than assume. A
  real player's name edit always writes both together, so this split can't occur through normal
  use; it's a limitation of how this review's test data was authored, not a product gap. Every
  other surface that *could* receive the string (My Characters, CharGen's Cloud picker) escaped it
  correctly, and CharGen/Live Sheet's shared `#cname` field was exercised safely with ordinary
  names throughout every journey this pass, with no code-level reason to expect content-dependent
  handling — but a live check of the dangerous string through that exact path is honestly unverified.
- **DM Console's escaping of a dangerous name on a BOUND (campaign-visible) character.** The
  seed's XSS test character is deliberately unbound, so it correctly never appears in DM Console at
  all (confirmed — no leak). This means DM Console's own `esc()`-wrapped name rendering was
  verified by code inspection (every name-producing call site in `DM-Console.html` — roster cards,
  invite rows, data attributes — routes through the shared `esc()` helper) rather than by watching
  the exact payload render live through it.
- **DM roster auto-refresh on tab refocus** (prior HIGH #6 above) — every DM Console visit this
  pass was a fresh page load; the specific "already-open tab, player joins elsewhere, refocus
  without reloading" scenario wasn't set up.
- **Automated contrast pass** (ability-score labels/badges, prior LOW #13) — not run this pass.
- **Journeys 1/3/4's full click-by-click sequences at 390×844** beyond the specific clipping and
  Feedback-overlap checks the task called out as regression-prone — those two were checked with
  pixel-level precision; the rest of each journey's flow wasn't independently re-walked at mobile
  width this pass.
- **DM Console's "📊 Skill Matrix" and "📒 AP Ledger" top-bar buttons** — visible in every DM
  Console screenshot this pass, never opened.
- **The reusable "Players:"/"DMs:" join codes** — every join this pass went through the single-use
  invite-link path; the reusable-code paths weren't exercised.
- **Clipboard-copy UX** for invite/join codes — not visually verified.
- **Dark-theme contrast** — not checked this pass.
- **"Delete permanently" on an archived character** (new UI, noticed in Journey 6, not documented
  in the prior report) — exists and is clearly destructive; not exercised, out of scope for a
  usability pass and not something to trigger against seed data casually.

## THEMES

Nothing found this pass rises above MEDIUM, and every fix the last report claimed held up under
direct re-verification — a strong result for a codebase that a week ago had a fully broken
new-player funnel. The one real theme is a narrower version of the last report's biggest one:
campaign state that's true in the database still sometimes needs an extra click to *see* — this
time it's a DM's own invite history hiding behind an unbadged checkbox rather than a stale cache.
Both new findings this pass are small and mechanical (a label count, an `aria-label`) rather than
structural. Three different near-miss investigations this session each initially looked like real
defects (a "Failed to fetch" alert, a misread AP figure, an "Unnamed character" placeholder) and
each turned out to be either this reviewer's own script racing itself or deliberate, well-commented
product behavior — worth naming as a theme in its own right: this codebase's edge-case handling is
now specific and intentional enough that a shallow read of the screen is more likely to produce a
false positive than a missed real bug, which is a good problem to have.

## Testing incident (full account; no lasting effect)

An early attempt at Journey 4's "archive something" step, run with too short a wait against this
sandbox's TLS-relay latency, archived the live "[REVIEW] The Ashfall Compact" campaign instead of
a disposable throwaway one — traced to the DM Console's own `currentCampId` not yet having flipped
over when the click landed (proven by the confirm() dialog itself naming the wrong campaign), not a
product race condition: a re-run with proper waits selected and archived the correct target every
time. Unarchived Ashfall Compact immediately and confirmed it was restored with its rules/roster
intact before continuing. A related slip in the same script also revoked the seed's dedicated 0-AP
invite instead of a newly created throwaway one; fixed by revoking the correct one afterward by
exact text match. Net effect: the seed's "0-AP" test invite is now also revoked, which still served
Journey 6's mess-check fine (just as a combined case rather than a pristine one). All of this was
[REVIEW]-scoped seed data, removed entirely by the purge above — no real-player data was ever
touched.

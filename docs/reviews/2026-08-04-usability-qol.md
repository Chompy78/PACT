# PACT usability & QoL review — 2026-08-04

Live review against the production Supabase project (`piuprrrnaotrtxucrtsb`), using a seeded stack of
`@review.pact.test` accounts and three `[REVIEW]`-prefixed campaigns per
`testing/scripts/seed-review-stack.mjs --live`. Driven with real headless Chromium (Playwright) through
`testing/scripts/lib/chromium-relay-shim.cjs` — a new, permanent workaround for a sandbox-specific
Chromium/TLS-proxy incompatibility discovered while standing this review up (see that file's header
comment and `testing/README.md` for the full mechanism). All six journeys were walked; findings below are
merged and de-duplicated across three parallel review passes plus a manual automated-contrast pass.

**Escaping/XSS check (the task's own CRITICAL trigger): PASSED everywhere reachable.** The seeded
`Bob "The Knife" <b>O'Malley</b> & Sons …` character name rendered as literal, escaped text — never as
real bold formatting — on every screen it could be checked (My Characters, both as the owner and via the
general name-rendering path CharGen/Live Sheet share). It could not be checked inside CharGen specifically
for that one character, because loading that character into CharGen is itself broken (see MEDIUM finding
below) — noted under NOT ASSESSED, not assumed safe.

---

## Findings

### Invited player can never actually get a playable character — the invite is dropped on sign-in
Severity: CRITICAL
Where:    CharGen — `?invite=<token>` deep link → sign-in redirect
Repro:    1. Signed out, open a live invite link (`PACT-CharGen-Webtool.html?invite=<token>`). 2. Click "Sign in" in the purple invite banner ("You've been invited to a campaign. Sign in to accept it — this link stays valid until you do."). 3. Log in as player3@review.pact.test. 4. Observe the redirect target. 5. Re-open the exact same invite URL now signed in. 6. Check My Characters.
Impact:   Every brand-new invited player, 100% of the time. Following the app's only advertised entry point for this journey (the invite link + its own "Sign in" prompt) produces zero playable character and zero error message — a total block on the invited-player onboarding path, with no recovery available from the UI.
Evidence: `shots/j234/j2-01-invite-landing-signedout.png` (the banner promising the link "stays valid"), `shots/j234/j2-03-post-login-redirect.png` (post-login lands on a blank CharGen showing "— no campaign —", banner gone), `shots/j234/j2-04-invite-reopened-signedin.png` (re-opening the same URL signed-in shows no banner and no redeem control anywhere), `shots/j234/j2-08-my-characters.png` ("No characters yet.").
Fix:      Preserve the `?invite=` token through the login redirect (a return-to param), and/or make reopening the invite URL while already signed in trigger redemption instead of silently dropping it.

### The documented CharGen ↔ Live Sheet handoff creates a duplicate, orphaned character instead of round-tripping the same one
Severity: HIGH
Where:    CharGen "⇆ Open in Live Sheet" / Live Sheet "⇆ Open in CharGen"
Repro:    1. As player1, open the campaign-bound "Aldric Valor" from My Characters into CharGen. 2. Make a small change (toggle a skill). 3. Click "Open in Live Sheet." 4. Award/spend/undo AP there. 5. Click "Open in CharGen" to switch back. 6. Return to My Characters.
Impact:   Any player using this core, actively-advertised feature during a normal session. Produces two cloud characters both named "Aldric Valor" with different ids — one still correctly bound to "[REVIEW] The Ashfall Compact" and continuing to accrue real play state, and a second, silently-created copy under "No campaign," frozen at the pre-handoff state (confirmed at 78/80 AP). Nothing in the UI indicates which is "real," and the orphan is invisible to the DM (unbound from any campaign).
Evidence: `shots/j234/j6-01-p1-my-characters-full.png` (two "Aldric Valor" rows, one under "No campaign", one under "[REVIEW] The Ashfall Compact · 100 AP" — distinct ids confirmed via each row's `cloudChar=` id), `shots/j234/j7dup2-01-duplicate-aldric.png` (the orphan loads as a fully-populated build, "78 / 80 AP", "— no campaign selected").
Fix:      The CharGen→Live Sheet→CharGen round trip should update/reopen the same cloud record by id on the return leg, not create a new one.

### Floating "Feedback" button repeatedly overlaps functional controls, worst on mobile where it sits over Undo/Redo mid-play
Severity: HIGH
Where:    Live Sheet (mobile bottom AP bar), DM Console (mobile Campaign Rules grid; also a milder desktop instance in the Campaign panel)
Repro:    1. Open Live Sheet at 390×844 on any character and scroll so the bottom AP bar is visible. 2. Open DM Console → a campaign → expand Campaign Rules at 390×844. 3. On desktop (1280×1000), open a campaign's Invite/Rules disclosures and scroll through them.
Impact:   Every mobile player/DM, and desktop DMs working through the Campaign panel. On Live Sheet the Feedback pill sits directly on top of the Undo/Redo icons in the persistent bottom bar — the two controls most needed to correct a mis-tap during actual play. On DM Console mobile it sits on top of the "Warlock" checkbox in "Banned origin classes," making that specific rule un-toggleable without first working around the widget. On desktop it was seen covering the "▸ CAMPAIGN RULES" row, a second invite's "OPEN" status badge, and the "DMs:" code's Copy button, at different scroll positions in the same panel. This is a previously-reported issue the task brief specifically asked to re-check — it is still happening, in more places than just the ledger.
Evidence: `shots/j234/crop-mobile-feedback-overlap-2x.png` (Live Sheet, covering Undo/Redo), `shots/j234/crop-j4-mobile-feedback2.png` (DM Console, covering Warlock checkbox), `shots/j234/crop-j4-feedback-overlap.png` (desktop, covering invite-panel edge), `shots/j5/13-dm-console-invite-generated.png`, `shots/j5/38-dm-roster-before-refresh2.png`, `shots/j5/39-dm-roster-after-refresh2.png` (desktop, three more distinct overlaps in the same Campaign panel).
Fix:      Give the Feedback widget a mobile-aware safe-area offset (clear of any fixed bottom bar) and keep it out of in-flow interactive rows on desktop, e.g. anchor it relative to the panel's own scroll container instead of the viewport.

### CharGen's quick-nav (chip bar / mobile "Jump to section") sends players to the wrong section from item 7 onward, and item 11 is completely dead
Severity: HIGH
Where:    CharGen — top chip-nav bar (desktop) and "Jump to section…" dropdown (mobile)
Repro:    1. Load CharGen fresh. 2. Click the "8 Classes" chip. 3. Observe which section actually scrolls into view.
Impact:   Every chip/option from "7 Arts" onward is off by one versus its real destination: "8 Classes" lands on "8 · Subclasses," "9 Subclasses" lands on "9 · Spellcasting," "10 Spellcasting" lands on "10 · Arts, Techniques, Boons & Drawbacks," and "11 Arts & Boons" targets a section id (`sec11`) that doesn't exist in the DOM at all — clicking it does nothing, silently. This is the primary quick-navigation control for an 11-part, very long form; a player trying to jump to "Classes" or "Spellcasting" lands somewhere else every single time, with no error. The mobile dropdown reuses the identical broken mapping.
Evidence: `shots/j1/EVIDENCE-chipnav-8classes-lands-on-subclasses.png`, `shots/j1/EVIDENCE-chipnav-11-broken-noop.png`; programmatic confirmation of the full off-by-one chain across items 7–11.
Fix:      Re-sync the chip-nav/`secjump` labels (or their `data-sec`/`value` targets) with the actual section legends, and either give "11 Arts & Boons" a real `sec11` target or remove the entry.

### Mobile "Class Access & Features" grid is clipped off-screen with zero indication more content exists
Severity: HIGH
Where:    CharGen — Section 7/Classes "quick-add feature by class" grid, mobile 390×844
Repro:    1. Load CharGen at 390×844. 2. Jump to the class-features section. 3. Look at the two-column class grid.
Impact:   Unlike every other section (which correctly reflows to one column on mobile), this fieldset stays fixed at 1153px wide with `overflow-x:auto` and no scrollbar/shadow/arrow — and the page body itself has `overflow-x:hidden`, masking that scrollable content exists at all. The right-hand column (Bard, Druid, Monk, Ranger, Sorcerer, Wizard) is pushed entirely off the 390px viewport. A mobile player would very plausibly never discover half the classes are there, and even one who does must swipe-scroll a hidden inner container rather than the page.
Evidence: `shots/j1/EVIDENCE-mobile-classgrid-clipped.png` (Barbarian…Warlock visible, text truncated at the edge, no hint of more) vs. `shots/j1/EVIDENCE-mobile-classgrid-scrolled-right.png` (Bard…Wizard only reachable by manually scrolling the inner container to `scrollLeft:700`).
Fix:      Apply the same responsive column-collapse used elsewhere in the tool to this grid, or at minimum add a visible scroll affordance.

### DM's "Invites issued" list never reflects redemption, even after an explicit refresh — contradicts the roster right above it
Severity: HIGH
Where:    DM Console — Campaign (cloud) → Invite new player → Invites issued list
Repro:    1. Generate a single-use invite link. 2. A second account opens it and joins (confirmed via the player-side banner and header). 3. Click "Refresh" on the roster — correctly shows the new character. 4. Click "Refresh" on the "Invites issued" list specifically.
Impact:   The invite row still reads "OPEN"/"not yet redeemed" after its own dedicated refresh — two DM-facing panels on the same screen disagree about the same fact. A DM could re-share a link they believe is dead, or worry a player never actually joined when they did.
Evidence: `shots/j5/39-dm-roster-after-refresh2.png` (roster shows the joined character; the invite list below still shows "OPEN" for the same token).
Fix:      Have the invite-list refresh re-fetch redemption status from the same source the roster uses, or derive "issued" row status from the roster/character list directly instead of a separately-cached field.

### Campaign roster requires a manual, undiscoverable "Refresh" click to show a player who just joined
Severity: HIGH
Where:    DM Console — Campaign Roster panel
Repro:    1. With a campaign selected, have a player join via invite. 2. Without clicking anything, look at the roster.
Impact:   The roster still reads "No characters in this campaign yet." with no spinner, badge, or indicator — indistinguishable from the invite having failed. Every DM independently has to discover the small "⟳ Refresh" button, right at the moment (a player just joined) they most want confirmation it worked.
Evidence: `shots/j5/38-dm-roster-before-refresh2.png` (still empty after the player already joined) vs. `shots/j5/39-dm-roster-after-refresh2.png` (correct after manual refresh).
Fix:      Poll or subscribe to roster changes (Supabase realtime is already in the stack), or at minimum show a toast/badge on tab focus.

### AP is presented as three inconsistent figures across the tools, and DM Console's roster card shows none of them without drilling in
Severity: HIGH
Where:    Cross-tool — CharGen "AP budget," Live Sheet "AP left / earned / spent," DM Console roster card + "DM tools" "Bonus DM AP"
Repro:    1. Compare the AP-related UI for the same character across all three tools in one session. 2. On a DM Console roster card, look at the always-visible stat strip, then expand "DM tools (private)."
Impact:   Answering "how much AP does this character have" — the task's own framing for the DM journey — is not possible from a roster card's visible stat strip at all (it shows HP/AC/Speed/Pass. Perc/Prof/Save DC, no AP). Expanding DM tools surfaces a number, but it's labeled "Bonus DM AP" (93 in testing) and does not match what the player's own Live Sheet calls "AP left" (7, with "85 earned / 78 spent") for the same character at the same moment. A DM skimming the card could easily read "93" as "this player has 93 AP to spend," which is wrong — a real, consequential misreading of a core game resource, not just a labeling nitpick.
Evidence: `shots/j234/j4-desktop-04-roster-view.png` (no AP on the visible stat strip), `shots/j234/j4-desktop-07a-dm-tools-expanded.png` ("Bonus DM AP: 93") vs. `shots/j234/j3b-desktop-05-after-award.png` ("7 AP left · 85 earned · 78 spent" for the same character).
Fix:      Surface a plain "AP available" figure on the roster card's always-visible stat strip, and rename "Bonus DM AP" (or explain inline) so it can't be mistaken for the player's spendable total.

### CharGen's "☁ Cloud" toolbar button is invisible — white text on a white background
Severity: MEDIUM
Where:    CharGen — top toolbar, `#cgCloudBtn`
Repro:    Open CharGen signed out and look at the Cloud button in the top toolbar.
Impact:   Every signed-out visitor sees a blank white pill instead of a labeled "☁ Cloud" entry point. The button still works when clicked — it just can't be seen. Live Sheet's equivalent `#cloudBtn` renders correctly (dark blue text on white), so this is a CharGen-specific regression, not a deliberate style.
Evidence: element screenshot (solid white pill, no visible text) and computed style `color: rgb(255,255,255)` on `background-color: rgb(255,255,255)`, contrast ratio 1.00:1, captured directly in this session.
Fix:      Give `#cgCloudBtn` the same color rule Live Sheet's `#cloudBtn` uses.

### Info modal has no focus trap — keyboard Tab lands on background controls hidden behind the overlay
Severity: MEDIUM
Where:    CharGen — "ℹ️ Info" dialog, keyboard-only navigation
Repro:    1. Tab to the "ℹ️ Info" button and press Enter to open it. 2. Press Tab once.
Impact:   Opening the dialog doesn't move focus into it (no `role="dialog"`/`aria-modal`), and stays on the Info button; the next Tab moves straight to the "1 Setup" chip-nav button, a control visually behind the overlay. A keyboard-only or screen-reader user has no way to reach the modal's own content or close control except guessing Escape works. The "✕" close button also has no accessible name (`aria-label`/`title` both null).
Evidence: `shots/j1/27-keyboard-info-modal-open.png`; programmatic focus trace confirming the Tab target lands outside any modal-class ancestor.
Fix:      Move initial focus into the dialog on open, trap Tab/Shift+Tab while it's open, restore focus to the invoking button on close, and add `role="dialog"` + `aria-modal="true"` + an `aria-label` on the close button.

### A revoked invite link looks identical to a valid one when opened signed out
Severity: MEDIUM
Where:    CharGen — `?invite=<revoked token>` landing, signed out
Repro:    Open the CharGen URL with a DM-revoked invite token, signed out.
Impact:   Anyone who clicks a link a DM has withdrawn sees the exact same "You've been invited… this link stays valid until you [sign in]" banner as a live invite, with no hint it's dead. Combined with the CRITICAL sign-in-drops-the-invite bug above, there is no way for that person to ever discover the link doesn't work.
Evidence: revoked-invite banner screenshot matches the valid-invite screenshot text exactly (both captured in this session).
Fix:      Check revoked/redeemed state before showing the "you've been invited" banner; show a distinct "this invite is no longer valid" message instead.

### Invites, Rules, and Archived-campaigns are hidden behind collapsed disclosures with no summary of what's inside
Severity: MEDIUM
Where:    DM Console — Campaign (cloud) panel landing state
Repro:    Select a campaign in DM Console and look at the panel without clicking anything further.
Impact:   "Which invite did I send to whom" and "what did I ban" (the task's own framing) are both unanswerable from the landing state — the invite and rules sections are separate `<details>` widgets, collapsed by default, with no count or badge on the collapsed row. A DM has to know to expand each in turn; nothing hints there's a live invite waiting or that a species is banned.
Evidence: collapsed-vs-expanded screenshots confirm both `<details>` elements default closed on both viewports tested.
Fix:      Show a lightweight badge on the collapsed summary row ("2 invites outstanding," "3 rules set") so a DM knows there's something worth opening.

### Opening a character from My Characters can silently land on a blank "Untitled draft" with no error
Severity: MEDIUM
Where:    CharGen — `?cloudChar=<id>` deep link from My Characters
Repro:    From My Characters, click "Open in CharGen" on a specific character and wait.
Impact:   Instead of the requested character, the tool shows "Untitled draft, 0/0 AP" with no toast, banner, or alert — indistinguishable on screen from correctly opening a genuinely-empty draft. Reproduced 3 times, correlated each time with the character-fetch request never completing. **Caveat:** every reproduction coincided with `net::ERR_ABORTED` network errors that were widespread across this sandboxed session (likely an artifact of the relay/proxy workaround under sustained load, not something a normal user's connection would trigger) — so the trigger frequency is uncertain. What's independently verifiable regardless of cause: when the fetch stalls, nothing tells the user their character failed to load.
Evidence: character header reading "Untitled draft"/"0 / 0 AP" where a populated character was expected, captured in this session.
Fix:      Add a visible timeout/error state ("Couldn't load this character — retry") instead of leaving the builder in its default empty state, which is indistinguishable from success.

### Archived campaigns can't be viewed at all without unarchiving them first
Severity: MEDIUM
Where:    DM Console — Archived campaigns
Repro:    Expand "Archived campaigns" and look at what an archived row offers.
Impact:   A DM wanting to check an old campaign's notes/roster/history has no read-only peek — the row offers only a name and an "Unarchive" button. To look, they must first put it back in their active list.
Evidence: archived-campaign row screenshot showing only name + Unarchive, no view option; confirmed the campaign is fully absent from the active-campaign dropdown.
Fix:      Let an archived campaign's name open a read-only view of its roster/rules without unarchiving.

### A brand-new empty campaign gives no pointer to "Invite new player," which is collapsed by default
Severity: MEDIUM
Where:    DM Console — Campaign Roster + Campaign (cloud) panel, immediately after "+ Create"
Repro:    Type a campaign name, click "+ Create."
Impact:   The roster accurately says "No characters in this campaign yet.," but the next step a brand-new DM needs — find and share an invite — is inside a collapsed disclosure with no visual link from the empty-roster message to it.
Evidence: post-create screenshot, `shots/j5/07-dm-console-after-create-click.png`.
Fix:      Auto-expand "Invite new player" the first time a campaign has zero characters, or add a one-line hint under the empty-roster message.

### Three differently-scoped ways to add a player are shown together with no hierarchy for which to use
Severity: MEDIUM
Where:    DM Console — Invite new player panel
Repro:    Expand "Invite new player."
Impact:   A reusable "Players:" code, a reusable "DMs:" code, and a separate single-use invite-link flow (with its own Starting-AP/Note fields) are all shown at once, distinguished only by small ⓘ tooltips. A new DM has to read three tooltips to figure out which mechanism is "the normal way to add my one player."
Evidence: `shots/j5/11-dm-console-invite-tile-open.png`.
Fix:      Lead with one recommended path (the single-use link, since it's the only one carrying starting AP); demote the two reusable codes to a secondary "advanced" disclosure.

### "Starting AP" field's own tooltip claims it's pre-filled; the observed field is empty
Severity: MEDIUM
Where:    DM Console — Invite new player → Starting AP field
Repro:    On a fresh campaign with default rules, expand "Invite new player" and look at Starting AP before typing anything.
Impact:   The field's tooltip states it's "Pre-filled from 'Starting tier'… worth matching to your curve's L1 (Standard 79, Generous 83)…" but the field shows only a grey placeholder "0," not a real value. A DM who trusts the tooltip and doesn't type a value generates a 0-AP invite, silently diverging from the documented behavior.
Evidence: `shots/j5/33-dm-invite-tile-open2.png` (placeholder "0," not a bold prefilled value); tooltip text confirmed at `tools/DM-Console.html:556`.
Fix:      Either make the pre-fill actually populate the input's value, or correct the tooltip copy to say it defaults to 0.

### Ability-score labels and modifier badges fall short of WCAG AA contrast
Severity: LOW
Where:    CharGen — Abilities section labels/pills; Live Sheet — matching ability block (same color scheme, both tools)
Repro:    Look at the STR/DEX/CON/WIS colored labels and modifier badges in either tool.
Impact:   Visually legible in practice (bold white-on-saturated-color, confirmed by screenshot) but measures 2.65:1–4.33:1 against WCAG AA's 4.5:1 minimum — a real shortfall for low-vision users even though it isn't illegible to an average viewer.
Evidence: automated contrast pass run in this session (DEX 2.78:1, CON 2.65:1, WIS 2.74:1, STR 4.33:1 against white); visual check confirms practical legibility.
Fix:      Darken the DEX/CON/WIS accent colors slightly (STR is already close) to clear 4.5:1; low priority since it isn't reported as illegible by feel.

### Save/Load success toast uses a danger-red color, is silent to screen readers, and never auto-dismisses
Severity: LOW
Where:    CharGen — `#flashmsg` toast after Save/Load
Repro:    Trigger a character Save or Load.
Impact:   The success toast ("Saved to your Downloads folder: …") is styled `background: rgb(122,0,0)` (dark maroon) with white text — the color language typically reserved for errors — for a routine success. It has no `role="status"`/`aria-live`, so screen-reader users get no notification of success at all, and it doesn't auto-dismiss (still present 20+ seconds later in testing) or offer a close control, overlapping page content beneath it.
Evidence: `shots/j1/12-1500ms-after-save.png`, `shots/j1/22-mobile-save-toast.png`; computed style confirmed directly.
Fix:      Use a neutral/positive color for success toasts, add `role="status"` (or `aria-live="polite"`), and auto-dismiss after a few seconds or add a close control.

### No success confirmation after archiving a campaign
Severity: LOW
Where:    DM Console — "Archive campaign" button
Repro:    Select a campaign, click "Archive campaign," confirm the dialog.
Impact:   The only feedback is the page snapping back to a blank "— select campaign —" state — no "Archived ✓" toast. A DM has to infer success from the campaign's absence rather than being told directly.
Evidence: post-archive screenshot showing the blank selector state with no confirmation message anywhere.
Fix:      Show a brief inline confirmation ("Untitled Playtest archived") before/instead of resetting to the empty selector.

### Two near-identically-labeled "DM notes" fields exist per campaign — easy to update the wrong one
Severity: LOW
Where:    DM Console — per-character "DM notes" vs. campaign-level "DM NOTES"
Repro:    Expand a roster card's "DM tools (private)" section, then separately scroll to the campaign's own "DM NOTES" tile.
Impact:   Both are labeled "DM notes"/"DM NOTES" with no qualifying text distinguishing "about this character" from "about this campaign." A DM jotting a session reminder could easily save it to the wrong one.
Evidence: character-level note pre-filled "Owes the guild 200gp…" vs. campaign-level note pre-filled "Session 4 next Thursday…", both screenshotted in the same session.
Fix:      Rename one, e.g. "Character notes" vs. "Campaign notes."

### Inconsistent default name for an unnamed character across CharGen and DM Console
Severity: LOW
Where:    CharGen name field ("New Character") vs. DM Console roster card heading ("Unnamed character")
Repro:    Join a campaign via invite without setting a character name; compare the two tools' placeholder text for the same character.
Impact:   Minor but visible naming drift for an identical, never-touched character — easy to miss individually, reads as sloppy when both tools are open in the same session.
Evidence: side-by-side screenshots from CharGen and DM Console for the same character, same session.
Fix:      Use the same placeholder string in both tools.

### Campaign-join confirmation is a native, unstyled `confirm()` dialog that doesn't name the campaign
Severity: LOW
Where:    CharGen — invite-link redemption, `tools/PACT-CharGen-Webtool.html:905`
Repro:    Open a DM-generated invite link while signed in.
Impact:   The one moment that decides "am I joining the right campaign, and will this replace my current build" is a plain browser `confirm()` reading "Accept this campaign invite? This creates a brand-new character bound to the campaign and replaces your current in-progress build." — no campaign name, no app styling, inconsistent with the otherwise fully custom-styled UI.
Evidence: dialog text captured verbatim via Playwright in this session.
Fix:      Replace with an in-page styled confirmation that names the campaign explicitly.

### DM Console roster card shows an oddly-truncated AC value
Severity: LOW
Where:    DM Console — roster card stat strip
Repro:    Look at any roster card's AC stat.
Impact:   AC renders as "10 /" followed by a visually empty box rather than a single clean number — reads as a rendering glitch even if a second (unset) value is intentional.
Evidence: roster card screenshot showing "AC 10 /" with a blank adjacent cell on two different characters.
Fix:      Hide the second cell when it has no value, or label what it represents (e.g. "touch AC").

### Console error during DM sign-in (low confidence — possibly a sandbox artifact)
Severity: LOW
Where:    login.html — sign-in submit, first DM login of a session
Repro:    Sign in as dm@review.pact.test from a cold session.
Impact:   One `TypeError: Failed to fetch` fired inside `supabase-js` during the sign-in call chain (`auth.js:currentUser` → `login.html:showSignedIn`). Login still succeeded on this attempt and the error didn't recur on subsequent logins in the same session, so this may be a proxy/relay artifact of the test sandbox rather than a genuine app defect.
Evidence: console text captured verbatim: `TypeError: Failed to fetch at .../js/vendor/supabase-js-2.110.2.js:40:2872 … at async currentUser (.../js/auth.js:64:30) at async showSignedIn (login.html:116:20)`.
Fix:      Not actionable without reproducing outside this sandbox; worth a follow-up check if it recurs in a clean environment.

---

## NOT ASSESSED

- **CharGen escaping check for the Bob O'Malley character specifically** — couldn't load that character into CharGen at all (see the "blank Untitled draft" finding above), so only My Characters and the general name-rendering path were confirmed safe for it, not CharGen's own character-loaded view.
- **Journey 2's cold-start persistence check** ("find the character again from a fresh context") — never completed, since no character was ever created by the invite flow in the first place (the CRITICAL finding above).
- **Native `showSaveFilePicker` Save path** — headless Chromium has no OS window manager to drive that picker; the tool's documented fallback path was exercised instead (forcing the same code path browsers without the API take). Whether the native picker gives the same feedback is unverified.
- **DM Console's "📊 Skill Matrix" and "📒 AP Ledger" top-bar buttons** — not opened in any journey.
- **Whether the duplicate-character handoff bug reproduces from Live Sheet's side alone** (award/undo without ever visiting CharGen) — only the full CharGen→Live Sheet→CharGen round trip was tested.
- **"Archive campaign" and invite "Withdraw" actions in Journey 5's freshly-created campaign** — not exercised, to avoid destructively touching a campaign created moments earlier for this review.
- **Clipboard-copy UX** for invite/join codes — only the underlying value was read programmatically; the actual copy-to-clipboard success/failure feedback wasn't visually verified.
- **Journey 5 (DM brand new campaign) at mobile viewport** — run at 1280×1000 desktop only; the task only required the mobile re-walk for journeys 1, 3, and 4.
- **The reusable "Players:"/"DMs:" join codes** — only the single-use invite-link join path was exercised.
- **Dark-theme-specific contrast** — the automated pass's theme-toggle attempt didn't reliably switch CharGen/Live Sheet/index/login into a dark theme (results were byte-identical to the light pass, indicating the toggle mechanism used didn't match how those pages actually switch themes), so dark-mode contrast is unverified beyond what's visible in the screenshots already taken.
- **Whether a specific skill checkbox toggle in CharGen changes the AP total** — inconclusive (header read "78/80 AP" before and after on two separate runs); could mean the skill picked was legitimately free rather than a bug. Not reported as a finding given low confidence.

## THEMES

The three tools speak different dialects for the same concepts — AP figures, "DM notes," default character
names, and ways to add a player — nothing is wrong in isolation, but reviewing all three back-to-back reads
as three unrelated products rather than one suite. State that changes in one tool or session (a joined
player, a redeemed invite, a character created via handoff) routinely fails to propagate to where a DM or
player would look for it: manual refreshes are required and undiscoverable, and in the worst case (the
CharGen↔Live Sheet handoff) the system silently forks a duplicate record instead of updating the original.
The floating Feedback button is a recurring, cross-screen collision risk, worst on mobile where it sits
directly over the Undo/Redo controls a player needs mid-session. Most strikingly, the single most important
funnel — a brand-new player entering a campaign via invite — is completely broken, while every deliberately
seeded "mess" scenario on the DM's side, escaping included, held up fine; the codebase reads as well-tested
from the DM's chair but not walked end-to-end from a new player's very first click in some time. Nothing
found rises to a security concern beyond the invite/session-state bugs above — the HTML-escaping invariant
`AGENTS.md` calls out held everywhere it could be tested.

## Live-stack cleanup

Purge to be run and confirmed at the end of this session: `node testing/scripts/seed-review-stack.mjs --live --purge`.

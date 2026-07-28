# D-GH-2026-07-18-continue-recent-chars — a landing "Continue" list, backed by a versioned autosave store

Status: Active

**Context.** The roadmap's "Continue / recent characters" task assumed `index.html` could just scan
existing localStorage and list recent characters. Tracing the real storage model showed that assumption
is false for the common case: each tool autosaves to a *single* overwrite slot (`pactCharGenAutosaveV2`,
`pactLiveSheet`) — so at most one character per tool is ever retained — and the genuine multi-character
collection (`js/sync.js`, keys `pact-chars` + `pact-char-<id>`) only fills when a **signed-in** user clicks
"☁ Save to cloud" (those users already have an in-tool cloud-load menu). Neither tool reads an
"open character X" URL param; the only deep-link is the 2-minute one-shot `?handoff=` baton, and plainly
navigating to a tool just restores *its own* slot. So a useful "Continue" list for the signed-out majority
needs more than one retained character — which the single-slot autosave can't provide.

**Options.** (A1) index.html-only, show just the ≤2 current slots — honest but thin. (A2) Merge the cloud
`sync.js` store — but it's empty for signed-out users and partly duplicates the cloud-load menu. (A3)
Extend autosave into a small **versioned history** so multiple recent characters/snapshots survive, and
read that on the landing page. The user chose A3, refining it to "a combination of the last 3 characters
and the last 10 autosaves," and explicitly asked that the autosave-capture trigger consider *both* elapsed
time *and* the difference from the previous snapshot (else a keystroke burst yields 10 identical entries).

**Decision.** Added `recordAutosave(entry)` + `readRecent()` to the shared `js/character-store.js`
(one localStorage key, `pactRecentV1`) holding two lists: **`chars`** — the last 3 *distinct* characters
(keyed by id, fallback name; latest state each; drives the resume cards) — and **`saves`** — a rolling ring
of the last 10 autosave *snapshots* (a recovery timeline). Capture policy is time+difference: a snapshot
identical to the newest ring slot is skipped; a changed snapshot of the same character/tool within
`RECENT_COALESCE_MS` (2 min) and smaller than `RECENT_BIG_DELTA` (5 log events) **coalesces** into the
newest slot; otherwise a **new** slot is cut (≥2-min gap, character/tool switch, or big jump). Both tools
call `recordAutosave` once inside their existing autosave, purely **additively** (their own restore slot is
untouched) and fully guarded (a throw here can never break a real save). `index.html` reads the store in a
`<script type="module">`, renders resume cards + a collapsible autosaves timeline, and resumes each entry
through the **existing `?handoff=` baton** — staged at pointer/keyboard interaction time so it's always
inside its 2-min TTL and middle-click/cmd-click open a fresh baton too; a plain tool URL is the fallback.
Character names render via `textContent` only. BUILD bumped v0.201→v0.202; `js/engine.js` untouched.

**Why.** Single-slot autosave structurally can't back a multi-character "Continue" list, and the cloud store
doesn't exist for signed-out users — so retaining recent characters/snapshots locally is the minimum that
makes the feature real for everyone. Keeping the logic in `character-store.js` (not the tools) means one
implementation both tools share and the landing page reads. Making it additive + guarded keeps all the risk
off the tools' real save path. Time+difference capture is the user's explicit requirement and prevents a
keystroke burst from flushing the ring. Reusing the proven handoff baton means **zero** new tool navigation
code and no new deep-link surface; interaction-time staging sidesteps the baton's TTL and preserves
middle-click. `textContent` honours the repo's XSS invariant (REV-12) for a value another user could set.
Known trade-off: a character worked on in *both* tools appears as two entries (two genuine resume points),
and old ring snapshots store full LOGs — bounded by the 3+10 caps and a quota-shed fallback in the writer.

**Status.** In force. Verified headless (Playwright): section hidden with no store; renders + reveals with
data; newest-first; XSS name rendered as literal text (no execution/injection); autosaves timeline shown
when >1; a **real** CharGen autosave writes `pactRecentV1` with a real 9-event LOG; clicking a card stages
a `?handoff=` baton, navigates, and the tool reloads that exact character. Store capture heuristic unit-
tested (11/11). Engine parity 20/0.

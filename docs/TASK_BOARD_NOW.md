# PACT — Task Board

> Written for agentic assistants (VS Code Copilot & Claude Code). With `AGENTS.md` committed, you don't
> repeat project context — **paste one task at a time**, review the diff, accept. Each task ends with a
> **Done when** check.
>
> **Rules for this file** (see `AGENTS.md`):
> 1. Holds only **open / planned** work. When a task is DONE, **move it into `CHANGELOG.md`** in the same change.
> 2. **Single writer.** Agents: *output* new items in this format for the human to fold in — don't append directly.
> 3. One task per branch. The open git branch is the "in flight" signal.
>
> **`REV-NN` items** come from the 2026-06-29 code review. Full evidence, code, and acceptance criteria
> live in **`docs/PACT-Code-Review-2026-06-29.md`** — commit that file alongside this task board so the
> pointers resolve. Findings are filed by severity: HIGH → Now, MEDIUM → Next, LOW → Later.

Completed work (PWA shell, auth, cloud sync, campaigns, hardening, landing-page redesign, PHB data,
**REV-01** regression gate, **REV-02** SW same-origin cache fix, **REV-03** SW network-first,
**CU-1** agent docs, **CU-2** version sync, **CU-3** repo tidy, **CU-6** DM Console rename, **CU-4** branch
prune, PWA stale-version reload-prompt fix, Live Sheet mobile density/collapse) has landed and graduated
to `CHANGELOG.md`.

## Campaign binding is lost on refresh, and on the Live Sheet → CharGen switch — TODO
Branch `fix/campaign-binding-survives-reload`. Reported by the owner from real use, 2026-08-05: "when the
page is refreshed, it loses the connection to campaign and I need to reload the character. Same as when I
move from livesheet to chargen."

**NOT VERIFIED IN A BROWSER.** Both paths need a signed-in session and a real campaign, which a CLI
session has no credentials for. What follows is a code-level diagnosis — treat the first finding as solid
(it is a plain omission) and the second as a hypothesis to confirm before coding.

### Finding 1 — the local autosave drops `campaignId` (this is almost certainly the refresh bug)

`buildCharacterEnvelope()` takes a `campaignId` and includes it only when passed
(`js/character-store.js:83-86`). Three Live Sheet call sites, and they disagree:

| call site | passes `campaignId`? |
|---|---|
| `exportJSON()` — file save | yes |
| cloud save (`~:2009`) | yes |
| **`save()` — the localStorage autosave (`~:624`)** | **NO** |

The autosave is exactly what a page refresh restores from. `load()` then calls
`_lsResetCloudApState()`, which sets `window._lsCampaignId = null` — so after a refresh the binding is
gone and can only come back via the async cloud round-trip in `refreshCloudCampaignRules()`.

That round-trip is itself fragile: it resolves the campaign by re-fetching the character record with
`S.loadCharacter(window.currentCharId())`, and **`currentCharId()` MINTS A NEW RANDOM ID when `__charId`
is unset** (`~:428`). If the restore has not populated `__charId` before that runs, the lookup asks the
server for a character that has never existed, gets nothing, and concludes "no campaign" — and the tab is
now holding a different id than the character it is showing.

### Finding 2 — the switch to CharGen may be a boot-order race, not a missing value

The handoff baton DOES carry the binding (`writeHandoff` stores `campaignId`,
`js/character-store.js:147`; the Live Sheet passes it at `~:702`; CharGen calls
`_cgAdoptEnvelopeBinding(p)` right after applying the envelope). So the value is not being dropped —
which makes a race the likelier explanation. `_cgConsumeHandoff()` runs "at the very top of boot, ahead
of loadFromHash()/autosave", i.e. gated on `engine-ready`, while `_cgResolveDmApStatus()` needs
`window._campaignBridge`, which is published on the later `campaign-ready`. If the resolve fires before
that bridge exists it bails and the status stays `unavailable`.

**Both of these have been fixed once before, in a narrower form** — see the comment above
`refreshCloudCampaignRules()` (a reload used to leave the AP chip on "player only") and the comment in
`_cgConsumeHandoff` (switching tools used to silently zero a campaign player's AP). So this is a third
instance of the same class, which argues for fixing it where the value lives rather than per-path again.

**Effort:** medium · **Risk:** medium — ambiguity medium (finding 1's fix is obvious; finding 2 needs
confirming first); damage scale medium (touches the AP model both tools read, and a mis-minted
`__charId` could write a character under the wrong id); damage likelihood medium (no automated cover —
the cloud paths cannot run in the dependency-free gate). Not sweep-eligible.

```text
1. CONFIRM FIRST, with the owner or a signed-in browser: on refresh, does the AP chip read "player only"
   while the character data is intact? And does the tab's character id CHANGE across the refresh
   (compare currentCharId() before and after)? That second question separates a display bug from a
   genuine identity bug, and they need different fixes.
2. Fix finding 1 regardless - pass campaignId in save()'s buildCharacterEnvelope call, as the other two
   call sites already do. One argument, and it makes the binding survive without any cloud round-trip.
3. Guard currentCharId(): minting a fresh id inside a getter is the hazard. A read-only accessor for the
   "do we have an id yet" question would stop a lookup ever inventing one. Check the other callers before
   changing it - the minting behaviour is load-bearing for genuinely new characters.
4. For finding 2, if confirmed: order the handoff's campaign resolve after campaign-ready rather than
   engine-ready, or re-run it when that event arrives.
5. Add whatever cover is possible without credentials: the envelope-shape half (does save()'s envelope
   carry campaignId?) is assertable in testing/scripts/tool-pricing-ci.mjs with no sign-in at all.
6. engine-parity must stay at 0 failed.
```

**Done when:** refreshing a campaign-bound character keeps its campaign and AP without reloading, the
same holds after switching Live Sheet → CharGen, the character id is stable across a refresh, and a gate
asserts the autosave envelope carries the binding.

---

> **Format note (2026-07-28):** split from a single `docs/TASK_BOARD.md` into `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by the existing NOW/NEXT/LATER bands — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`. Same rules apply to all three files.

---

# 🔴 NOW — high-severity fixes + cleanup

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

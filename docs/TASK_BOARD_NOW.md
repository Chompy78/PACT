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

## Split starting AP into creation AP + awarded AP (and fix CharGen's clunky budget entry) — TODO
Branch `feat/creation-vs-awarded-ap`. Owner's design, 2026-08-05. **Do this before
`fix/creation-lock-survives-reload`** — it removes that bug's cause instead of patching it.

**The idea.** A character's starting AP is currently one number, and the creation lock measures against a
flat `DATA.level1AP` (79). Those should be two different things:

- **Creation AP** — the default figure for the chosen track (Standard 79, Generous 83, Lean 75, Level-0
  prelude 55, or custom). This is what the creation lock measures, and creation prices and warnings apply
  while spending it.
- **Awarded AP** — everything above that. Treated exactly like DM-awarded AP in the Live Sheet: it is
  post-creation, so it buys at post-lock prices.

So a 5th-level starting character is given their full starting AP however the DM sets it, spends the first
~79 under creation pricing with the usual warnings, and the remainder behaves as awards. That is the
correct shape: a character who begins at level 5 has, in rules terms, already advanced.

**Why it matters beyond tidiness.** `_buildEventBurst` blanket-tags every event `noLock:true` purely so a
high-budget starting character isn't instantly locked (D-GH34). With the split, that reason disappears —
creation AP is always the default, so the threshold is never wrong — and with it goes the reload-unlock
bug: see `fix/creation-lock-survives-reload` above, where a reload currently launders a locked character
back to draft.

**Two UI pieces:**
1. **CharGen has no awarded-AP entry at all.** The Live Sheet does (`award()`, which appends a `type:'award'`
   event). CharGen needs the equivalent so a DM or player can set the extra AP on a starting character.
2. **CharGen's budget control is a dropdown and is clunky** (owner). Replace it with a plainer entry — a
   number field, or a track picker plus a number, so a custom figure doesn't mean hunting a list.

**Effort:** medium · **Risk:** medium — ambiguity medium (the split is decided, but where the boundary is
recorded in the LOG is an open design call); damage scale medium (touches the award/budget model both
tools read); damage likelihood low (parity + tool-pricing gates cover the numbers). Not sweep-eligible.

```text
1. Decide how the split is RECORDED before writing UI. The LOG already carries `award` events and
   `creationLockConfig{threshold}`. Natural shape: creation AP is the threshold (already an event, already
   append-only per D4), and awarded AP is one or more ordinary `award` events. Check that against how
   economy() computes earned/spent, and write the answer into
   decisions/2026/D-GH-2026-08-05-pricing-model.md as an amendment - it changes D3.
2. CharGen: add an awarded-AP entry mirroring the Live Sheet's award(). Route it through the LOG-mutation
   API (emit), not a DOM shim - readBuild() is foldBuild(LOG) since the Chunk 6 flip.
3. CharGen: replace the budget dropdown with a number entry (keep the track presets reachable - they feed
   DATA.levelBudgetCurves and the creation-AP confirm prompt already reads them).
4. Once creation AP is always the default, REMOVE the blanket noLock tagging in _buildEventBurst and
   confirm the D-GH34 case it protected is still safe: an imported higher-budget character must not
   self-trigger the lock on its own total. That is the whole point of doing this task first.
5. Gate it in testing/scripts/tool-pricing-ci.mjs: a character with creation AP 79 + 170 awarded must show
   creation pricing for the first 79 and post-lock pricing after, AND still be locked after a reload.
6. engine-parity must stay 26/0. If compute() output moves, update testing/expected/ and bump DATA.version
   in the same PR.
```

**Done when:** starting AP is split into creation AP and awarded AP, CharGen can set both, its budget
control is no longer a dropdown, a 5th-level starting character gets creation pricing only for the
creation-AP portion, the lock survives a reload, and engine-parity still reports 26/0.

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
6. engine-parity must stay 27/0.
```

**Done when:** refreshing a campaign-bound character keeps its campaign and AP without reloading, the
same holds after switching Live Sheet → CharGen, the character id is stable across a refresh, and a gate
asserts the autosave envelope carries the binding.

## Cloud saves are last-write-wins today — two devices silently clobber each other — TODO
Branch `fix/optimistic-character-save`. Found 2026-08-05 while designing DM edits, but **this is a live
bug now, not a future one**. Nothing about it needs the DM feature.

`pushCharacter()` (`js/sync.js:126`) writes with a bare
`.update({name, kind, stats}).eq('id', rec.id)` — **no concurrency guard of any kind.** The whole event
log lives in the `stats` blob, so the later writer replaces the earlier writer's entire history. Open the
same character in the Live Sheet on a phone and CharGen on a laptop, edit both, and one of them loses
everything with no warning.

The database is already set up for the fix: `characters.updated_at` is maintained by a **BEFORE UPDATE
trigger** (`trg_characters_updated_at` → `set_updated_at()`, verified against the live project), so every
successful write bumps it server-side and the client never has to set it.

**The non-obvious part — the client does not currently keep the server's value.** `applyServerMeta()`
(`js/sync.js:150`) stores the server's `updated_at` on the local record, but `saveCharacter()` then
**overwrites it with the local clock** (`updated_at: nowIso()`, `~:94`) before pushing. So by push time
the record no longer knows what the server last said. A guard written against `rec.updated_at` would
therefore never match and every save would look like a conflict. The fix needs a separate field — a
`base_updated_at` holding the last value the server confirmed — kept distinct from the local stamp.

**Also do not conflate the two "0 rows updated" cases.** Today a 0-row update means "row does not exist,
insert it" (`~:139`). With a guard, 0 rows means *either* that *or* "someone else changed it first" — and
inserting in the second case would collide on the primary key. The two must be told apart with an
existence check before deciding.

**Effort:** medium · **Risk:** high — ambiguity medium (the approach is settled, the base-value plumbing
is the fiddly bit); damage scale high (it is the sync layer all three tools depend on, and the local
record shape changes for existing users); damage likelihood high (**it cannot be tested without a
signed-in browser and a real project — the dependency-free gate cannot reach it**, and a mistake here
means either silent data loss continues or nothing syncs at all). Not sweep-eligible.

```text
1. Add base_updated_at to the local record: set it in applyServerMeta() from the server's value, and do
   NOT let saveCharacter()'s local nowIso() stamp overwrite it. Existing local records have no such
   field - treat a missing one as "unknown", which must fall back to today's unguarded behaviour rather
   than failing every save.
2. Guard the update: .eq('updated_at', rec.base_updated_at) when it is known. On 0 rows, do an existence
   check to tell "not there yet" (insert) from "someone else wrote first" (conflict).
3. Return the conflict distinctly - {synced:false, conflict:true} - and let the record stay dirty, which
   is the path an offline failure already takes. Do NOT throw away the local edit.
4. Surface it: the user needs to be told their copy is behind and offered a reload, not left with a
   silently unsynced character.
5. VERIFY WITH A REAL SIGNED-IN SESSION before merging - two tabs, edit both, confirm the second is
   refused rather than clobbering. Say plainly in the PR that this was manually verified; do not imply
   the automated gates covered it, because they cannot.
6. No schema change is needed (the trigger already exists), so no migration - but run the Supabase
   advisor anyway per AGENTS.md if any policy is touched.
```

**Done when:** a stale write is refused rather than overwriting, the local edit survives the refusal, the
user is told, a record with no known base value still saves as it does today, and the two-tab case has
been manually verified with a real session.

---

> **Format note (2026-07-28):** split from a single `docs/TASK_BOARD.md` into `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by the existing NOW/NEXT/LATER bands — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`. Same rules apply to all three files.

---

# 🔴 NOW — high-severity fixes + cleanup

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

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

---

> **Format note (2026-07-28):** split from a single `docs/TASK_BOARD.md` into `TASK_BOARD_NOW.md`/`_NEXT.md`/`_LATER.md` by the existing NOW/NEXT/LATER bands — see `decisions/2026/D-GH-2026-07-28-decisions-changelog-task-board-split.md`. Same rules apply to all three files.

---

# 🔴 NOW — high-severity fixes + cleanup

# Conventions
- One task per branch/commit; re-open `engine-parity.html` after each.
- Keep `js/engine.js` off-limits unless a task targets it.
- When a task here is done, move it to `CHANGELOG.md` — don't leave DONE items here.

## Close esc() gaps in CharGen and Live Sheet (stored XSS) — TODO
Branch `fix/esc-gap-chargen-livesheet`. Found in a 2026-08-22 full-tool playability/usability/logic audit
(published as a Claude artifact, not a repo file — findings CharGen C1/C2 and Live Sheet L2/L3/L4, item #1
in that audit's suggested fix order). Five sites across CharGen and Live Sheet render a player-controlled
value into `innerHTML`/an HTML attribute without passing it through `esc()`/`_csEsc()`, violating this
file's own hard invariant ("every player-controlled value that reaches innerHTML/an attribute must pass
through esc()"). Three are reachable through completely ordinary UI use, no tampering required, and are
cross-user reachable via cloud sync / share links / DM Console's roster and `?viewChar=` view — a DM
viewing a player's cloud-saved character is the textbook case this invariant exists to prevent.

**Effort:** medium · **Risk:** low — ambiguity is low (the fix at 4 of 5 sites is literally "wrap in the
existing `esc()`/`_csEsc()` helper already used by every sibling field in the same function"; only the
buy-off button's `onclick` needs a small structural change — a `data-v` attribute plus a delegated click
handler — to close both the missing-escape and a second, independent attribute-injection issue on the same
field); damage scale is low (render-layer only, no `compute()`/`DATA.version` change); damage likelihood is
low (the correct pattern already exists everywhere else in both files — nothing novel to get wrong, just a
consistent gap to close).

```text
1. tools/PACT-CharGen-Webtool.html:5139 (renderCharSheet) — b.languageNames joined into innerHTML
   unescaped; every sibling field in this function uses _csEsc() except this one. Fix:
   b.languageNames.filter(Boolean).map(_csEsc).join(', '). This function is duplicated byte-for-byte into
   tools/PACT-Live-Char-Sheet.html:1973 — fix both.
2. tools/PACT-CharGen-Webtool.html:5142 and :5162 (renderCharSheet) — mastery and drawback labels joined
   unescaped. Not reachable via normal UI (checkbox-constrained), but MUT.mastery/MUT.drawback in
   js/engine.js and foldBuild() don't validate against the known vocabulary before storing, so a
   hand-edited save/share-link/compromised cloud record can carry an arbitrary string here. Fix:
   _csEsc() each entry before joining, matching the correctly-escaped Tools & Instruments line immediately
   above (:5144).
3. tools/PACT-Live-Char-Sheet.html:1298-1300 (validate(), built) and :1495-1498 (rendered into
   #tray.innerHTML) — "Feature/Boon/Drawback no longer in rules: "+e.payload.v interpolated raw. Reachable
   via the unrestricted JSON import path (importJSON, no schema/whitelist check on payload.v — only a
   non-blocking signature warning that loads the file either way), cloud sync, and DM Console's
   ?viewChar= read-only view of another player's character. Fix: esc(e.payload.v) at each of the three
   interpolation points.
4. tools/PACT-Live-Char-Sheet.html:1471 — the drawback buy-off button's onclick handler HTML-escapes only
   the single quote used as the JS-string delimiter; the surrounding double-quoted HTML attribute is not
   escaped, so e.payload.v containing e.g. x" onmouseover="alert(1) breaks out of the attribute and injects
   an arbitrary event handler. Same reachability as #3 (same underlying field). Fix: switch to
   data-v="'+esc(v)+'" plus an event-delegated click handler reading dataset.v, rather than trying to
   double-escape a value that needs to survive both a JS string literal and an HTML attribute.
5. tools/PACT-Live-Char-Sheet.html:1414, 1415, 1973, 1976 — saves/skills/tools+instruments/languageNames/
   masteries list renders join arrays into innerHTML without esc(). Same reachability as #3 (import/cloud/
   viewChar, no value whitelist enforced on load). Note :1973/:1976 are the renderCharSheet duplicate
   covered by items 1-2 above — don't double-fix. Fix: .map(esc).join(', ') at :1414/:1415, or route
   through the existing _ftip/_aTip helpers that already escape (matching how the on-screen masteries
   summary panel already handles the same data correctly, unlike its print-sheet duplicate).
6. After fixing: run testing/tests/engine-parity.html (expect 0 failed — render-layer fixes only, but
   confirm compute() output is unaffected). Manually verify by round-tripping a language name / drawback /
   feature-warning string containing `<img src=x onerror=alert(1)>` and a value containing a literal
   double-quote through: (a) CharGen's Name spells & languages dialog → Sheet view, (b) a JSON import into
   Live Sheet, (c) DM Console's roster/viewChar view of that character — confirm no script execution and
   the raw text renders literally in all three.
```

**Done when:** all 5 sites use `esc()`/`_csEsc()` consistently with the rest of each function; the manual
XSS round-trip above shows no execution in CharGen, Live Sheet, or DM Console; `engine-parity.html` reports
0 failed; `CHANGELOG.md` is updated (security-relevant fix, not display-only — `DATA.version` stays
untouched since no pricing/compute() output changes); `DECISIONS.md` gets an entry, since this is a
security-model/trust-boundary fix — exactly the kind of non-obvious "why" (cloud data crosses users) the
per-change checklist calls for.

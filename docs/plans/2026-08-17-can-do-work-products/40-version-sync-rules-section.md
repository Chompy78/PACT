# `fix/chargen-rules-label-live` — the writable half, ready to fold in

This task has a genuinely writable deliverable **now**: the new **rules-version
section for `docs/VERSION-SYNC.md`**. The code wiring + gate need the repo, but the
doc section below is complete. Sweep-eligible overall (all three ratings low).

**Why this exists (keep for the record):** during the v1.365 promotion the Live
Sheet footer read "PACT v0.309" while `DATA.version` was v0.339 — thirty versions
stale — and CharGen's two labels were at v0.338/v0.337. The Live Sheet's was fixed
by making it **live** (PR #366). CharGen's were fixed by **correcting the values
only**, so they will drift again at the next `DATA.version` bump. `VERSION-SYNC.md`
currently lists only the BUILD mirror sites, so no rules-version mirror is on any
checklist — that's the structural gap this section closes.

---

## Paste-ready section for `docs/VERSION-SYNC.md`

```markdown
## Rules-version display sites

`DATA.version` (the rules version) is shown in several places. A site marked
**live** reads `window.DATA.version` at boot and needs **no promotion step**. A
site marked **manual** is a hardcoded mirror and MUST be updated by hand at every
rules bump — these are the ones that drift.

| Site | File / anchor | Live or manual | Promotion step needed? |
|---|---|---|---|
| DM Console | `tools/DM-Console.html:1830` | **live** | No |
| Live Sheet footer | `#lsRulesVer` (`PACT-Live-Char-Sheet.html`, `_lsBoot()`) | **live** | No |
| CharGen chip | `#cgPactver` (`tools/PACT-CharGen-Webtool.html`) | **live** *(after fix/chargen-rules-label-live)* | No |
| CharGen `<title>` — rules half | `<title>… · Rules vX.Y</title>` | **manual** | Yes — the `<title>` also carries the BUILD version (below), which stays a hand-edited mirror |

> The point of listing the live sites is that a live site needs no promotion step.
> Only the **manual** rows above belong on the rules-bump checklist.

### Do NOT touch at a rules bump
- **Players Guide provenance strings** — "verbatim from the v0.309 Players Guide"
  (Live Sheet ~:1223, ~:1244) and "Rules source of truth:
  PACT-Players-Guide-v0.303.docx" (both tools, line 9). These record which edition
  the quoted text came from; bumping them asserts a re-check that hasn't happened.
- **`// v0.314:`-style annotations** — they mark when a feature landed, not the
  current version.
```

*(Adjust the exact version strings in the "do NOT touch" bullet to whatever the repo
currently shows; the sites and their live/manual classification are the durable
part.)*

---

## Wiring + gate (needs the repo — your half)

1. **`#cgPactver` chip** — the easy one, exactly parallel to the shipped Live Sheet
   fix: paint it in `_cgBoot()` (~:4169, already gated on engine-ready at ~:4212)
   from `window.DATA.version`. Copy the Live Sheet's wiring **and its fallback-literal
   comment**.
2. **`<title>` — handle with care.** It mixes BOTH version axes. The BUILD half MUST
   stay a manual mirror (`VERSION-SYNC.md` names `<title>` a BUILD mirror site and
   the promotion step edits it by hand). So either set **only the rules half** live
   (build the title string in `_cgBoot` from a manual BUILD literal + live
   `DATA.version`), or leave `<title>` alone and say so in the CHANGELOG. **Do NOT
   make the whole title live** — that silently removes a documented promotion step.
3. **Gate:** copy the assertion from `testing/scripts/tool-pricing-ci.mjs` ("the Live
   Sheet footer shows the live `DATA.version`") for CharGen. **Compare against
   `DATA.version` itself, never a fixed string**, so the check never needs touching
   at a rules bump — that maintenance burden is what caused the drift. **Prove it
   fails before trusting it:** revert the wiring and confirm it goes red.
4. Display-only → **do NOT bump `DATA.version` or BUILD**; log in CHANGELOG.

**Done when:** CharGen's `#cgPactver` chip renders `DATA.version` with no hardcoded
rules value in the render path; a gate asserts it by comparing against `DATA.version`
itself and was confirmed red against the reverted wiring; `docs/VERSION-SYNC.md`
lists every rules-version display site marked live or manual (section above);
`engine-parity` still 0 failed.

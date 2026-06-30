# PACT — Code Review & Remediation Brief

> **Audience:** an AI coding agent (Claude Code / Copilot) working in this repo, plus the human maintainer (John / Chompy78).
> **Purpose:** a self-contained review that an agent can read cold and act on without re-deriving context. Every finding has a stable ID, severity, evidence with `file:line` references, a concrete fix (with code), and acceptance criteria.
> **Reviewed at:** 2026-06-29. **Engine version observed:** `DATA.version = "v0.322"`. **Branch observed:** `feature/campaign-play`.
> **How this review was produced:** static reading of every source/SQL/doc file, plus a live Node import of `js/engine.js` run against the three build fixtures and the LS-001 live-sheet fixture (results quoted in REV-01).

---

## 0. How to use this document

- Findings are grouped **HIGH → MEDIUM → LOW**. Within each, work top-to-bottom.
- Each finding is tagged `REV-NN`. When you open a PR, reference the IDs you address (e.g. "Closes REV-01, REV-02").
- **Hard project constraints that override any fix below** (from `CLAUDE.md`): vanilla JS only — *no frameworks, bundlers, TypeScript, or npm runtime deps*; GitHub Pages only — *no server-side code*; service-worker `scope` and manifest `start_url` must stay `/PACT/`; the three tools' UI must keep working unchanged unless the task is explicitly about changing them; treat `js/engine.js`'s public API as fixed unless the task targets the engine.
- **Do not bump `DATA.version`** for non-mechanics changes (it is the *rules* version). Display-only data (`masteryFx`, `drawbackFx`, `racialFx`, PHB `page` fields) are documentation edits.
- After any change, the regression gate must still pass — **but read REV-01 first, because the gate currently proves almost nothing.**

---

## 1. Architecture orientation (so an agent understands the system)

### 1.1 What PACT is
A static, client-only tabletop-RPG tool suite hosted on GitHub Pages at `https://chompy78.github.io/PACT/`. It is mid-migration from "localStorage + JSON import/export" to a **PWA + Supabase** cloud-save and campaign layer (Tasks 1–5 in `docs/PWA-BUILD-PLAN.md`).

### 1.2 The layers

| Layer | Files | Role |
|---|---|---|
| **Rules engine** (source of truth) | `js/engine.js` | Exports `DATA`, `compute(build)`, `rebuildStateFromEvents(base, events)`, `baseBuild`, `MUT`, `activeEvents`, `economy`, `foldBuild`. All pricing/derivation lives here. Derived stats (HP, AC, AP, warnings) are **never stored** — always recomputed. |
| **UI tools** (UI only) | `tools/PACT-CharGen-Webtool.html`, `tools/PACT-Live-Char-Sheet.html`, `tools/DM Console.html` | Each loads the engine via a "module bridge": an inline `<script type="module">` imports `../js/engine.js`, copies the API onto `window`, and dispatches an `engine-ready` event that gates the classic UI script. `tools/` and `js/` must remain siblings so `../js/engine.js` resolves. |
| **PWA shell** | `index.html`, `manifest.json`, `service-worker.js`, `404.html`, `icons/` | Installable app shell + offline caching. |
| **Auth/cloud** | `js/supabase-client.js`, `js/auth.js`, `js/sync.js`, `js/campaign.js`, `js/dm.js`, `login.html` | Supabase Auth (email/password), cloud character save + offline sync, campaign create/join, DM roster + AP awards. |
| **Database** | `sql/schema.sql`, `sql/rls-policies.sql` | Postgres schema + Row-Level Security. Apply `schema.sql` first, then `rls-policies.sql`. |
| **Tests** | `testing/` | Browser-run "engine parity" pack + fixtures. See REV-01. |
| **Memory/docs** | `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `DECISIONS.md`, `CHANGELOG.md`, `docs/` | Project memory and working guide. |

### 1.3 Two character data shapes (important for any data-touching change)
- **CharGen** produces a **flat build JSON** (see `testing/fixtures/builds/CG-002-valid-50ap-build.json`).
- **Live Sheet** produces an **append-only event log** `{ LOG, SEQ, rules }`. Events are `award` (grants AP / budget), `buy` (applies `MUT[cat]`), `buyoff` (removes a drawback), `names` (folds in spell/feat names), `name` (sets character name).
- The cloud stores **only** the raw shape in `characters.stats`. `characters.ap` is a **separate, server-authoritative, DM-only** column.

### 1.4 Roles are per-campaign and derived (never a stored flag)
- You are **DM** of a campaign where `campaigns.dm_id = you`.
- You are a **player** in a campaign where you own a `characters` row with that `campaign_id`.
- The same user can be DM in one campaign and player in another — and even both within one campaign. There is intentionally **no global "is DM" flag**.

### 1.5 The intended build/test/release workflow
1. Branch, one task at a time.
2. Edit `js/engine.js` only if the task targets the engine; otherwise treat its API as fixed.
3. Open `testing/tests/engine-parity.html` → expect **5 passed / 0 failed**.
4. Update `CHANGELOG.md` (+ `DECISIONS.md` / `docs/sessions/` if applicable).
5. Open a PR.

---

## 2. What is already good (preserve these properties)

These are deliberate strengths. **Any fix must not regress them.**

- **Single source of truth.** Rules live only in `js/engine.js`; tools and tests import it. "Never store derived values" is honoured throughout.
- **Event-sourcing is clean.** `foldBuild` → `economy` → `compute` is a tidy pipeline; `_replay` dedupes single-instance proficiency lists and strips cantrips from half-casters, so replays are idempotent on those fields.
- **RLS design is excellent and subtle:**
  - **Column-level `ap` lockdown** (`sql/rls-policies.sql:131-132`): `revoke update … ; grant update (name, campaign_id, kind, stats) …`. This is the correct way to make one column DM-only, because Postgres RLS *cannot* restrict an `UPDATE` to specific columns. (But see REV-04 — the same grant list creates a different hole.)
  - **`SECURITY DEFINER` helpers** (`is_campaign_dm`, `is_campaign_member`, `shares_campaign`) deliberately bypass RLS to break the `campaigns`↔`characters` policy recursion. The comment at `rls-policies.sql:11-14` shows this was understood, not stumbled into.
  - **`award_ap()` is the only `ap` write path**, re-checks `is_campaign_dm` server-side, so it is safe even if called directly.
- **Key hygiene is correct.** `js/supabase-client.js` ships only the **publishable** key with an explicit "NEVER put the secret/service_role key in here" note. A full-repo scan found **no** `service_role`/secret leak.
- **XSS is handled in the DM Console today.** Despite ~74 `innerHTML` writes across the tools, user-controlled fields (`name`, species, warnings, labels, filenames, list items) are wrapped in an `esc()` helper. This is correct — see REV-12 for the invariant to maintain as cloud data starts crossing users.
- **Strong in-repo memory discipline** (`CLAUDE.md`/`DECISIONS.md`/`docs/sessions/`). Keep logging as you go.

---

## 3. HIGH severity

### REV-01 — The regression gate proves "doesn't throw", not "is correct"
**Severity:** HIGH · **Type:** test integrity / false confidence · **Status:** open
**Files:** `testing/tests/engine-parity.html:62-104`, `testing/expected/expected-results.csv` (empty), `testing/pack-manifest.json`

**Why this is #1.** The entire workflow (`CLAUDE.md` §"Per-change checklist", §"Hard rules") hinges on "expect 5 passed / 0 failed" as the safety net after *any* change. But the runner marks a test passed whenever `compute()` / `rebuildStateFromEvents()` simply **don't throw** — it never compares the returned AP total or warnings to any expected baseline.

**Evidence (current runner):**
```js
// testing/tests/engine-parity.html — runBuildTests()
const build = await loadJson(fixturePath);
const computed = compute(build);
results.push({ type: "chargen", fixture: fixturePath, pass: true, /* ... */ });   // pass is hard-coded true
```
`testing/expected/expected-results.csv` has the header row plus 5 fixture rows with **every expected column blank** (`legacy_ap_total`, `new_engine_ap_total`, `…_warnings`, `…_valid`, `pass` are all empty). And `testing/pack-manifest.json` states:
> `"note": "Actual source HTML and exported JSON were not accessible in sandbox; placeholder fixtures must be replaced with real exports before final sign-off."`

**Live values observed (Node import of the engine against the committed fixtures):**
```
engine version: v0.322
CG-001-default-empty-build : total=2  budget=50 remaining=48 warnings=0
CG-002-valid-50ap-build    : total=50 budget=50 remaining=0  warnings=0
CG-003-over-budget-build   : total=67 budget=50 remaining=-17 warnings=1
LS-001-clean-generator-export: ok=true total=77 budget=80 eventsApplied=28
```
CG-002 computing to exactly 50 (its name promises "valid-50ap") and CG-003 going over budget are *encouraging* — but **nothing asserts them**, so a future edit that silently reprices a boon from 6→8 AP still reports 5/0.

**Fix (do this before relying on the gate for any other REV):**
1. Capture the current known-good outputs into `testing/expected/expected-results.csv` — at minimum `new_engine_ap_total` and `new_engine_warnings` (count) per fixture. Treat the values above as the seed *only after* a human confirms they are correct against the PHB/guide; the agent must not invent expected numbers.
2. Rewrite the runner so each test **asserts** `compute(build).total === expected.ap_total` and `warnings.length === expected.warnings`, setting `pass` from the comparison, not a literal.
3. For `CG-003`, additionally assert `remaining < 0` and that the "OVER BUDGET" warning is present.
4. For `LS-001`/`EV-001`, assert `rebuildStateFromEvents(...).ok`, `total`, and `eventsApplied`.
5. Keep the human-readable JSON dump, but make the summary `failed` count reflect real mismatches.

**Acceptance criteria:**
- Deliberately perturbing one price in `DATA` makes the gate report at least one **failed** test.
- With no code change, the gate reports 5 passed / 0 failed against the captured baseline.
- The empty columns in `expected-results.csv` are populated and consumed by the runner.

**Companion (see REV-11):** the same assertions should run headless in CI so the gate isn't a manual browser click.

---

### REV-02 — Service worker caches Supabase API reads, poisoning the sync layer
**Severity:** HIGH · **Type:** correctness / data-staleness / privacy · **Status:** open
**File:** `service-worker.js:41-59`

**What happens.** The `fetch` handler is cache-first for *every* GET and caches *any* response that is 200 and not `opaque`:
```js
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;                              // <-- cache-first for ALL GETs
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));   // <-- caches cross-origin CORS 200s too
        return response;
      }) /* ... */;
    })
  );
});
```
supabase-js (PostgREST) issues **`GET`** for selects (`listCharacters`, `reconcile`, `getRoster`, `getCampaign`, …). Those responses are `type:"cors"`, status 200 → they get cached. Consequences:
1. **Stale reads:** once cached, a character/roster read returns the old body forever (cache-first), directly undermining the last-write-wins reconciliation in `js/sync.js`. The user edits on device B, device A keeps serving the cached row.
2. **Sensitive data at rest:** other players'/characters' JSON (visible to a DM) is written into Cache Storage, persisting beyond the session.

**Fix.** Restrict the SW to **same-origin app-shell assets**. Bypass anything to the Supabase origin (and ideally the esm.sh CDN module, which is immutable-versioned and fine to let the browser HTTP-cache):
```js
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Only ever touch our own GitHub Pages origin; never API/CDN traffic.
  if (url.origin !== self.location.origin) return;            // let the network handle Supabase/esm.sh
  // ... same-origin cache strategy (see REV-03 for which strategy) ...
});
```

**Acceptance criteria:**
- After loading a roster, going offline, and editing the same character on another device, the first online read on the original device returns the **server** value, not a cached one.
- DevTools → Application → Cache Storage contains only `/PACT/...` same-origin assets, never `*.supabase.co` responses.

---

### REV-03 — Cache-first + static `CACHE_NAME` means a shipped `engine.js` never reaches returning users
**Severity:** HIGH · **Type:** PWA release correctness · **Status:** open
**File:** `service-worker.js:1-15, 41-59`

**What happens.** `CACHE_NAME = 'pact-v1'` is a constant, and `js/engine.js` is in `PRE_CACHE` served cache-first. A returning user is served the cached engine until the **service-worker file's own bytes** change (which is what triggers `install`/the "new version ready" bar in `index.html:48-63`). Ship a rules fix that touches **only** `js/engine.js` and:
- the SW bytes are unchanged → no new install → no update prompt;
- the app-shell fetch for `engine.js` is satisfied cache-first from `pact-v1` → **the old engine runs indefinitely.**

Because the engine is the single source of truth for all pricing, a "fixed" rule can silently not ship. This is the highest-impact PWA bug.

**Fix (pick one, prefer A):**
- **A. Network-first (or stale-while-revalidate) for the app shell + engine**, falling back to cache offline. This keeps offline support while always preferring a fresh engine when online.
- **B. Cache-busting version token.** Bump `CACHE_NAME` (e.g. derive it from `DATA.version` or a build/release string) on every release so `activate` purges old caches. This pairs naturally with the existing `activate` cleanup that deletes non-current caches (`service-worker.js:33-39`).

Recommended combination: network-first for `*.html` + `js/engine.js`; cache-first only for static, content-addressed assets (icons). Document the chosen strategy in `DECISIONS.md` (Context → Options → Decision → Why → Status).

**Acceptance criteria:**
- Editing only `js/engine.js`, deploying, and reloading a previously-installed PWA serves the **new** engine (verify `DATA.version` or a known new price) without manually clearing storage.
- Offline still loads the last-known app shell and tools.

---

### REV-04 — A player can attach themselves to any campaign, bypassing the invite-code gate
**Severity:** HIGH (design intent) / practical risk reduced by UUID unguessability · **Type:** access control · **Status:** open
**Files:** `sql/rls-policies.sql:112-114` (insert policy) and `:131-132` (update grant); intended path is `sql/schema.sql:137-163` (`join_campaign`)

**What happens.** The intended *only* way to join is `join_campaign(p_code)` — it validates the invite code and blocks double-joins. But:
- `characters_insert` only checks ownership: `with check (owner_id = auth.uid())` — it says nothing about `campaign_id`.
- `campaign_id` is in the player-writable column grant: `grant update (name, campaign_id, kind, stats) on public.characters to authenticated;`

So an authenticated player can **directly insert or update** a character row setting `campaign_id` to any campaign UUID — no invite code, no `join_campaign`, and the "you already joined" guard is skipped. The DM of that campaign would then see the stranger's character (and the stranger gains the member view that RLS grants).

**Mitigating factor:** campaign IDs are `gen_random_uuid()`, so not practically enumerable. This lowers exploitability but the access model is weaker than the design claims ("players never need broad read access … joining goes through `join_campaign`").

**Fix (pick one):**
- **A (preferred):** remove `campaign_id` from the player update grant and make `join_campaign()` the sole writer of `campaign_id` (it's already `SECURITY DEFINER`). Add an explicit "leave campaign" RPC if leaving is needed.
- **B:** keep the grant but constrain it with policy `WITH CHECK`:
  ```sql
  -- insert: a player may only create a character that is unassigned or in a campaign they already belong to
  create policy characters_insert on public.characters
    for insert with check (
      owner_id = auth.uid()
      and (campaign_id is null or is_campaign_member(campaign_id))
    );
  -- update: same constraint on the post-image
  create policy characters_update on public.characters
    for update using (owner_id = auth.uid())
    with check (owner_id = auth.uid()
      and (campaign_id is null or is_campaign_member(campaign_id)));
  ```
  (Note: `is_campaign_member` is `SECURITY DEFINER` so it won't recurse.)

**Acceptance criteria:**
- A manual `insert`/`update` setting `campaign_id` to a campaign the caller never joined via code is **rejected**.
- `join_campaign(valid_code)` still succeeds and still blocks a second join.
- Existing roster/award flows are unchanged.

---

## 4. MEDIUM severity

### REV-05 — Sync "is local newer?" compares timestamps lexicographically across two clocks
**Severity:** MEDIUM · **Type:** sync correctness / lost updates · **Status:** open
**File:** `js/sync.js:125`

```js
const localNewer = local.dirty && local.updated_at > server.updated_at;
```
`local.updated_at` is `new Date().toISOString()` → e.g. `2026-06-29T09:18:52.123Z` (millisecond precision, `Z` suffix). `server.updated_at` comes from Postgres `timestamptz` and may serialize as `2026-06-29T09:18:52.123456+00:00` (microseconds, `+00:00` offset). String comparison then breaks because:
- precision differs (`.123` vs `.123456`), and
- `'Z'` (0x5A) sorts **after** `'+'` (0x2B), so an equal instant can compare "local newer".

Result: spurious "local wins" → the local copy overwrites a genuinely newer server copy (lost update), or the reverse.

**Fix:** compare parsed instants, not strings:
```js
const localNewer = local.dirty && Date.parse(local.updated_at) > Date.parse(server.updated_at);
```
Even better long-term: let the **server** be the clock authority (the `set_updated_at` trigger already stamps `now()`); have the client treat its local `updated_at` as provisional and only trust server timestamps for ordering. Also consider a small epsilon or a monotonic `rev` counter to avoid equal-millisecond ties.

**Acceptance criteria:** two edits one millisecond apart across devices reconcile to the genuinely later write; add a unit test that feeds mixed `Z` / `+00:00` / differing-precision strings and asserts correct ordering.

---

### REV-06 — Offline delete resurrects on reconnect
**Severity:** MEDIUM · **Type:** sync correctness · **Status:** open
**File:** `js/sync.js:150-157`

```js
export async function deleteCharacter(id) {
  if (navigator.onLine && await currentUser()) {
    const { error } = await supabase.from('characters').delete().eq('id', id);
    if (error) throw error;
  }
  lsRemove(id);     // runs even when offline → server row survives
}
```
Offline, the server delete is skipped but `lsRemove` still runs. On reconnect, `listCharacters`/`syncAll` pulls the still-present server row back and re-creates the local copy — the character "comes back from the dead." This is inconsistent with the careful "never delete local before a confirmed server write" rule the rest of the module follows.

**Fix:** mirror the dirty-write retry buffer with a **tombstone**. Maintain a `pact-deletes` list of ids pending server deletion; `syncAll`/the `online` handler replays them (`delete().eq('id', …)`) and only then clears the tombstone. `listCharacters` must filter out ids present in the tombstone so they don't reappear in the UI before the delete lands.

**Acceptance criteria:** delete while offline → character stays gone in the UI; on reconnect the server row is removed and never re-pulled.

---

### REV-07 — Invite codes use `random()` (non-CSPRNG), no rate limiting
**Severity:** MEDIUM · **Type:** security hardening · **Status:** open
**File:** `sql/schema.sql:38-53` (`gen_invite_code`), `:137-163` (`join_campaign`)

Codes are 6 chars from a 36-symbol alphabet via `floor(random()*36)` — `random()` is a non-cryptographic PRNG, and `join_campaign` has no attempt throttling. The keyspace (~2.18 billion) plus predictable PRNG plus unlimited guesses makes codes more enumerable than ideal. Stakes are modest (a successful guess only lets the attacker create *their own* character in that campaign, and RLS still scopes data), but it's a soft spot.

**Fix:**
- Generate from a CSPRNG: build the code from `gen_random_bytes(n)` (pgcrypto is already enabled at `schema.sql:22`) mapped onto the alphabet, instead of `random()`.
- Consider lengthening to 8 chars, and/or add rate limiting on `join_campaign` (e.g. a per-user attempt counter, or rely on Supabase edge rate limits).
- Optionally expire/rotate codes; `regenerate_invite_code` already exists for manual rotation.

**Acceptance criteria:** codes still match `^[A-Z0-9]{6,}$` (update the `check` if you lengthen), still unique, and are sourced from `gen_random_bytes`.

---

### REV-08 — The three "identical" instruction files have already drifted
**Severity:** MEDIUM · **Type:** process / agent-correctness · **Status:** open
**Files:** `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`

`CLAUDE.md` mandates: *"Copy this file to `CLAUDE.md` … and `.github/copilot-instructions.md` … Keep all three identical."* In reality `CLAUDE.md` and `AGENTS.md` are byte-identical, but `.github/copilot-instructions.md` is **stale**:
- missing the entire **"CharGen → Live Sheet export (D-GH3)"** section,
- its **File map / Testing** bullets are an older, shorter version,
- it still calls `docs/ENGINE-DATA-UPDATE.md` "the first task" (the others say "now complete").

An agent reading the Copilot file gets outdated guidance about the export contract and the test pack — exactly the areas REV-01 and the export logic depend on.

**Fix:** stop hand-copying. Options:
- **A:** keep one canonical file (e.g. `AGENTS.md`) and make the others thin pointers, or generate them in a tiny prebuild/commit hook.
- **B:** add a CI step that fails if the three files diverge (a `diff` / checksum check). This is cheap and self-enforcing.
Then re-sync `.github/copilot-instructions.md` to current content.

**Acceptance criteria:** the three files are identical (or generated from one), and CI/an automated check guards it.

---

## 5. LOW severity / cleanup

### REV-09 — Committed dev scratch file leaks a local path
**Severity:** LOW · **File:** `.tmp-verify.mjs` (tracked; shows modified in `git status`)
Line 26 hard-codes `c:/Users/JohnChow/Downloads/Owain_Marsh-livesheet.json`. It cannot run for anyone else and leaks a local username/path. **Fix:** delete it, or move a sanitised version under `docs/history/` and read its input from a repo fixture (e.g. `testing/fixtures/live-sheets/...`) instead of an absolute path.

### REV-10 — `.claude/` is gitignored *after* being committed
**Severity:** LOW · **Files:** `.gitignore` (adds `.claude/`), but `.claude/agents/Claude Aventa.agent.md` and `.claude/settings.local.json` are already tracked.
`.gitignore` does not untrack already-committed files, so the local editor files remain in the repo. **Fix:** `git rm --cached -r .claude` (keep them on disk), then commit; the ignore rule will keep them out going forward. Confirm nothing else depends on those tracked files first.

### REV-11 — No CI; the gate is a manual browser click
**Severity:** LOW (but force-multiplies REV-01) · **Files:** `.github/` (only holds `copilot-instructions.md`)
There is no GitHub Actions workflow, so nothing runs on PR. The engine is a clean ES module and imports/runs under Node with no changes (verified). **Fix:** add a minimal headless runner that imports `js/engine.js`, runs `compute()`/`rebuildStateFromEvents()` over `testing/fixtures/**`, and **asserts** against `testing/expected/expected-results.csv` (the REV-01 baseline) — exit non-zero on mismatch. Wire it as a GitHub Action on PRs to `preview`/`main`. This keeps "no npm *runtime* deps" intact (a dev-only Action runner is fine; no bundler ships to users).

> Reference scaffold the agent can adapt (Node, no deps):
> ```js
> import { compute, rebuildStateFromEvents, DATA } from '../js/engine.js';
> import { readFileSync } from 'node:fs';
> // load expected-results.csv → map by test_id; for each fixture compute() and assert
> // total === expected.new_engine_ap_total and warnings.length === expected.new_engine_warnings;
> // process.exit(failures ? 1 : 0)
> ```

### REV-12 — Keep the `esc()` invariant as cloud data starts crossing users
**Severity:** LOW today (correct now), rising as REV-02/sync land · **Files:** `tools/*.html` (~74 `innerHTML` writes)
Today the DM Console escapes all user-controlled fields via `esc()` (e.g. `tools/DM Console.html:1175` name column `disp: a => esc(a.name||'Unnamed Hero')`, and `detailHTML` wraps warnings/labels/filenames). Once cloud sync makes **one user's** character data render in **another user's** DM Console, any unescaped `innerHTML` sink becomes stored XSS. **Action:** treat "every interpolated player-controlled value passes through `esc()`" as a hard invariant; when adding any new `innerHTML` sink that includes character data (names, appearance free-text, notes), escape it. Consider a brief checklist line in `CLAUDE.md` under "Hard rules".

### REV-13 — Dead "granted proficiency" maps in `compute()`
**Severity:** LOW (cleanup / latent intent) · **File:** `js/engine.js` (~`:62-73`)
`const grantSk={}, grantTl={}, grantIn={};` are declared and never populated, so `skillList.filter(s=>!grantSk[s])`, the tools filter, and the instruments filter are permanent no-ops (nothing is ever "granted-free"). Either:
- **wire it up** if granted-free skills/tools (from background/subclass) are supposed to reduce paid counts, or
- **remove** the indirection so the code states what it actually does.
Decide based on the rules intent (check `DECISIONS.md` / the guide) and log the decision. **Do not** change pricing behaviour without updating the REV-01 baseline in the same PR.

### REV-14 — Engine maintainability: one giant `DATA` blob + one ~320-line `compute()`
**Severity:** LOW (structural; optional) · **File:** `js/engine.js:18` (`DATA` single line), `:32-358` (`compute`)
The dataset is a single minified line and `compute()` is one dense function with terse single-letter locals — it works and is well-commented in spots, but it's hard to review and impossible to unit-test in pieces. There's already a `docs/engine-data-update.json`. **Optional refactor (engine-targeted task only):**
- extract `DATA` into an imported `js/engine-data.json` (data edits then can't break logic, and reviews of "display-only" changes become trivial);
- split `compute()` into named sub-pricers (`priceAbilities`, `priceSpellcasting`, `priceFeatures`, …) returning `{lines, warnings, total}` fragments.
**Guard rails:** keep the public API and every `compute()` output byte-identical; this is only safe once REV-01 gives real assertions. Treat as a dedicated PR, not a drive-by.

---

## 6. Suggested execution order (for an agent picking this up)

1. **REV-01** — make the gate real (unblocks safe work on everything else). Capture baseline → assert → confirm a deliberate perturbation fails.
2. **REV-11** — wrap that gate in CI (headless Node runner).
3. **REV-02 + REV-03** — fix the service worker together (same file, one PR): same-origin-only caching + network-first app shell/engine. Re-verify offline still works.
4. **REV-04** — close the `campaign_id` join bypass in RLS; re-run any auth/campaign manual checks.
5. **REV-05 + REV-06** — sync correctness (timestamp parsing + delete tombstones), with new unit tests.
6. **REV-07, REV-08** — invite-code CSPRNG + instruction-file de-drift/guard.
7. **REV-09, REV-10, REV-13** — cleanups.
8. **REV-12** — add the escaping invariant to `CLAUDE.md`; enforce in review.
9. **REV-14** — optional engine refactor, only after REV-01 is solid.

Each PR: update `CHANGELOG.md`; add a `DECISIONS.md` entry for any architectural/process choice (Context → Options → Decision → Why → Status); keep `DATA.version` unchanged unless mechanics actually change.

---

## 7. Per-finding quick index

| ID | Severity | Area | File(s) |
|----|----------|------|---------|
| REV-01 | HIGH | Test integrity | `testing/tests/engine-parity.html`, `testing/expected/expected-results.csv`, `testing/pack-manifest.json` |
| REV-02 | HIGH | SW caches API reads | `service-worker.js:41-59` |
| REV-03 | HIGH | Stale engine on deploy | `service-worker.js:1-15,41-59` |
| REV-04 | HIGH | Campaign join bypass | `sql/rls-policies.sql:112-114,131-132`; `sql/schema.sql:137-163` |
| REV-05 | MED | Timestamp comparison | `js/sync.js:125` |
| REV-06 | MED | Offline delete resurrection | `js/sync.js:150-157` |
| REV-07 | MED | Invite-code entropy | `sql/schema.sql:38-53` |
| REV-08 | MED | Instruction-file drift | `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md` |
| REV-09 | LOW | Committed scratch file | `.tmp-verify.mjs` |
| REV-10 | LOW | `.claude/` tracked despite ignore | `.gitignore`, `.claude/*` |
| REV-11 | LOW | No CI | `.github/` |
| REV-12 | LOW→ | Escaping invariant | `tools/*.html` |
| REV-13 | LOW | Dead grant maps | `js/engine.js:62-73` |
| REV-14 | LOW | Engine structure | `js/engine.js:18,32-358` |

*End of brief.*

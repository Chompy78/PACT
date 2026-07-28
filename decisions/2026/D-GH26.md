# D-GH26 — Engine module-bridge migration shipped as a safe subset (DATA/compute/baseBuild + Live Sheet MUT), not the full seven symbols

Status: Active

- **Context:** The "Full engine module-bridge migration" roadmap task (and `AGENTS.md`, and D-GH9) framed
  all three tools as hand-copying seven symbols — `DATA`, `compute`, `MUT`, `baseBuild`, `activeEvents`,
  `economy`, `foldBuild` — and asked to migrate them by importing all seven onto `window` and deleting the
  local copies. A compat check **before editing** found the premise only partly true, and that a literal
  import-and-delete would break the tools:
  - **`activeEvents`/`economy`/`foldBuild` are signature-incompatible.** The engine exports take an events
    *array* — `foldBuild(events)`; all three tools' versions take an *index* and close over a script-level
    `LOG` — `foldBuild(uptoIdx)`, called as `foldBuild(null)`/`foldBuild(viewAt)`. Importing the engine
    versions and deleting the local ones would break event-sourcing + time-travel in Live Sheet/DM Console
    and the import-fold path in CharGen. Reconciling them means rewriting every call site to pass `LOG`
    slices — a much larger change to the event-replay core than the task described.
  - **CharGen has no top-level `baseBuild`/`MUT`/`activeEvents`/`economy`/`foldBuild` at all** — only
    `DATA` and `compute`. The rest are local closures inside `_lsImportFold`/`buildToLiveLog` (the D-GH3
    export bridge), specialized, not the engine's versions.
  - **DM Console's `MUT` diverges** — its `found` lacks the add-discipline-to-existing-tradition
    else-branch and it is missing `dbound` (D-GH9 updated engine + Live Sheet in lockstep but not DM
    Console). Bridging DM's `MUT` is a real behavioral change, not a no-op.
  - `DATA` (byte-identical across all four when parsed), `compute` (each tool's `compute(b)` is the
    engine's minus the additive `opts`/`spendable` block — a safe superset), `baseBuild` (identical modulo
    a trailing comment), and Live Sheet's `MUT` (identical to the engine's) **are** cleanly bridgeable.
- **Options:** (A) do the literal full migration — rewrite all `activeEvents`/`economy`/`foldBuild` call
  sites, reconcile DM's `MUT`, untangle Live Sheet's dual `validate` — a large, risky change to two
  event-sourced tools that can't be browser-verified headlessly; (B) bridge only the verified-compatible
  subset now (`DATA`+`compute`+`baseBuild` for all three, plus `MUT` for Live Sheet), leave the index-based
  event functions and DM's divergent `MUT` local, and carve the reconciliation into a separate task; (C)
  don't touch code, just correct the roadmap.
- **Decision:** (B), chosen by the user after the compat evidence was laid out. Each tool now imports its
  safe subset in a `<script type="module">` that copies the symbols onto `window` and dispatches
  `engine-ready`; each tool's UI bootstrap is gated on that event (deferred modules execute after the
  classic scripts, so the symbols aren't present at parse time — an ungated bootstrap would throw). The
  inline `DATA`/`compute` (all three), `baseBuild` (Live Sheet, DM Console) and `MUT` (Live Sheet only)
  copies were deleted; the per-tool display-only `DATA.racialFx` augmentation moved into each module bridge.
  CharGen — previously fully local with no module bridge — gained its first one.
- **Why:** the task's real point is to stop the duplicated rules *data and calculator* from drifting;
  `DATA` (a 194 KB table) and `compute` (a ~330-line function) per tool are the bulk of that and are
  provably safe to bridge. The event-sourcing functions are a different kind of code — stateful closures
  with a deliberately different (index-based) API — whose migration is a separate, larger piece of work
  with real regression risk to the buy→event→replay path, not worth folding in here. Keeping DM's `MUT`
  local preserves its current replay behavior exactly (bridging it is a latent-bug fix to be done
  deliberately, with its own test). Verified in a real browser: all three tools boot with no console
  errors, `compute`/`foldBuild`/`economy` produce correct values, a Live Sheet buy still emits exactly one
  event, DM's `dmAnalyze` replays the LS-001 fixture to total 78, and `engine-parity.html` stays 5/0.
- **Status:** IN FORCE. Bridged: `DATA`, `compute`, `baseBuild` (+ Live Sheet `MUT`). Still local:
  `activeEvents`, `economy`, `foldBuild` (all three), `MUT` (CharGen local closures; DM Console divergent).
  Supersedes the `DATA`/`compute`/`baseBuild` portion of D-GH9's "still copy-pasted" status. The remaining
  reconciliation (event-function signatures + DM `MUT`) is handed back to the roadmap as a revised task.

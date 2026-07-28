# D-GH11 — Service worker caching strategy: network-first for app shell + engine

Status: Active

- **Context:** `service-worker.js` used a single cache-first path for all same-origin requests. A fix shipped to `js/engine.js` or any HTML page would not reach returning users until the SW's own bytes changed and the browser re-installed it — potentially days later.
- **Options:** (i) **network-first** for `*.html` + `engine.js`, falling back to cache offline; (ii) **stale-while-revalidate** (serve cache immediately, revalidate in background — fix takes a second visit); (iii) **derive `CACHE_NAME` from `BUILD`** so activate purges old caches on each release (SW can't `import` ES modules, so reading `BUILD` requires a string-grep or hardcoded sync step); (iv) keep cache-first everywhere (current, breaks prompt delivery of fixes).
- **Decision:** (i) network-first for `*.html` pages (`/\.html$/` + `/PACT/$`) and `js/engine.js`. All other same-origin assets (icons, supporting JS) remain cache-first. `CACHE_NAME` stays static — the activate handler already purges old caches when it changes manually. Option (iii) deferred: benefit is automatic purging, cost is a build-step or string-sync just to read one constant.
- **Why:** a rules fix that doesn't reach users until the next SW update is a silent correctness regression. Network-first is minimal overhead: one extra round-trip on warm hits, offline still works via cache fallback.
- **Status:** IN FORCE as of build v0.107 (REV-03).

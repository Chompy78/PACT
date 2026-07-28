# D-GH8 — PWA service-worker registration lives in every tool page (Task 1)

Status: Active

- **Context:** the PWA shell (manifest, `service-worker.js`, `404.html`, icons) had landed and `index.html` registered the SW, but the three `tools/*.html` pages did not — so installing/offline only worked from the menu, not the tools themselves.
- **Options:** (i) register the SW only from `index.html` and rely on scope to cover the tools; (ii) add the registration block to each tool page explicitly.
- **Decision:** (ii). The shared registration script + `<link rel="manifest" href="/PACT/manifest.json">` were added to all three tool pages, using absolute `/PACT/` paths, with an in-page "new version ready / Reload" bar on `updatefound`.
- **Why:** each tool is a directly-bookmarkable/installable entry point; explicit per-page registration guarantees the manifest + update prompt regardless of how the user arrived. Engine logic untouched.
- **Status:** IN FORCE.

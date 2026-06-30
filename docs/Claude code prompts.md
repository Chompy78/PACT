### Next item

Read AGENTS.md and docs/PACT\_ROADMAP.md. Pick the next open task — the highest-priority "— TODO" in the

NOW bucket, top to bottom — and tell me which one it is with a one-line summary. WAIT for my OK before

changing anything. Once I confirm: work token-efficiently per AGENTS.md (read each file once, grep instead

of reading whole files, one editing pass, no re-reads), follow the per-change checklist (one branch, run

the test gate, update CHANGELOG/DECISIONS, graduate the task out of the roadmap when done), then open a PR

into preview. Don't touch js/engine.js unless the task targets the engine.

When you know this, suggest what model and effort I should use for this task. If not using Sonnet and Medium, make sure this if highlighted (Ideally make red) so i can easily notice it. Tell me if there may be some point to changing and what it would do.
Also do a token efficient analysis if this may cause problems, and suggest if a deep search for problems is warranted despite using more tokens. Give recommendations.











#### Commit, push, and merge — plain English:



Commit is saving a snapshot of your changes locally on your machine. Think of it like hitting Save in a document, but with a label describing what you changed. Nothing leaves your computer.



Push is uploading those saved snapshots to GitHub (the remote server). Until you push, your commits only exist locally — nobody else can see them, and they're not backed up online.



Merge is combining two separate lines of work into one. In this project, preview is where work happens first (staging). When it's ready, you merge it into main, which is what the live site on GitHub Pages serves. Merging takes all the commits from preview and folds them into main.



So the flow is always: commit → push → merge — save locally, upload, then promote to the live branch.


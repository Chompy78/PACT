#!/bin/bash
set -uo pipefail

# Only nudges in remote/cloud sessions (Claude Code on the web) — on a persistent local
# machine, ai-lessons-learned's INDEX.md is loaded directly via a @-import in
# ~/.claude/CLAUDE.md instead, so no nudge is needed there.
#
# Remote sessions can't auto-clone the (private) ai-lessons-learned repo here: this hook
# is a non-interactive shell script and `add_repo` is an agent tool, not a shell command —
# and `add_repo` is only meant to be invoked when a task actually calls for that repo, not
# unconditionally on every session. So instead of fetching content, this just prints a
# short reminder; the agent decides whether the current task warrants pulling it in.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cat <<'EOF'
[ai-lessons-learned] A private, cross-project repo of durable AI-coding lessons exists at
chompy78/ai-lessons-learned (not automatically in this session's GitHub scope). If this
session's task touches a general engineering pattern, gotcha, or lesson that isn't specific
to PACT, call add_repo(owner="chompy78", repo="ai-lessons-learned"), clone it, and read
INDEX.md before proceeding. Otherwise, ignore this.
EOF

exit 0

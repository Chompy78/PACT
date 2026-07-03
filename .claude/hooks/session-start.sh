#!/bin/bash
set -uo pipefail

# Only runs in remote/cloud sessions (Claude Code on the web) — on a local machine,
# the ai-lessons-learned INDEX.md is loaded instead via a @-import in ~/.claude/CLAUDE.md.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO_URL="https://github.com/chompy78/ai-lessons-learned.git"
REPO_DIR="/tmp/ai-lessons-learned"

if [ -z "${AI_LESSONS_TOKEN:-}" ]; then
  echo "[ai-lessons-learned] AI_LESSONS_TOKEN not set in this environment — skipping, session starts normally." >&2
  exit 0
fi

if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" pull --quiet >/dev/null 2>&1 || true
else
  git clone --quiet "https://x-access-token:${AI_LESSONS_TOKEN}@${REPO_URL#https://}" "$REPO_DIR" >/dev/null 2>&1 || true
fi

if [ -f "$REPO_DIR/INDEX.md" ]; then
  cat "$REPO_DIR/INDEX.md"
else
  echo "[ai-lessons-learned] Could not load INDEX.md this session (clone/pull failed) — skipping." >&2
fi

exit 0

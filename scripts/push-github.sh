#!/usr/bin/env bash
# Pushes the current branch to GitHub using the GITHUB_PAT secret.
# Called by the "Sync to GitHub" Replit workflow.
set -euo pipefail

if [ -z "${GITHUB_PAT:-}" ]; then
  echo "❌ GITHUB_PAT secret is not set. Add it in the Replit Secrets tab."
  exit 1
fi

# Strip all whitespace/newlines — guards against accidental paste of URL or trailing chars
PAT_CLEAN=$(printf '%s' "$GITHUB_PAT" | tr -d '[:space:]')

if [ -z "$PAT_CLEAN" ]; then
  echo "❌ GITHUB_PAT is blank after trimming whitespace. Please re-add it in Secrets."
  exit 1
fi

REPO_URL="https://${PAT_CLEAN}@github.com/evilos619-cell/sammystore.git"
BRANCH=$(git --no-optional-locks rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")

echo "🚀 Pushing branch '${BRANCH}' to GitHub…"

# Capture output, mask token, then print — use pipefail-safe approach
PUSH_OUT=$(git --no-optional-locks push "$REPO_URL" "${BRANCH}:${BRANCH}" 2>&1) || {
  echo "$PUSH_OUT" | node -e "
    const p = process.env.PAT_CLEAN;
    let b = '';
    process.stdin.on('data', d => b += d);
    process.stdin.on('end', () => process.stdout.write(b.split(p).join('****')));
  "
  echo "❌ Push failed. Check the error above."
  exit 1
}

echo "$PUSH_OUT" | PAT_CLEAN="$PAT_CLEAN" node -e "
  const p = process.env.PAT_CLEAN;
  let b = '';
  process.stdin.on('data', d => b += d);
  process.stdin.on('end', () => process.stdout.write(b.split(p).join('****')));
"

echo "✅ Successfully pushed to https://github.com/evilos619-cell/sammystore"

#!/usr/bin/env bash
set -euo pipefail

# scripts/sync-upstream.sh
# Ergonomic, safe upstream sync runner for Subin-Gurung49/t3code

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET_REF="${1:-upstream/main}"

echo "==> Validating git status..."
if [ -n "$(git status --porcelain | grep -v '?? skills/')" ]; then
  echo "Error: Working tree has unstaged or uncommitted changes. Please commit or stash first."
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
PRE_SYNC_FORK_SHA="$(git rev-parse HEAD)"

echo "==> Fetching upstream (without tags)..."
git fetch --no-tags upstream

RESOLVED_TARGET_SHA="$(git rev-parse "$TARGET_REF^{commit}")"
echo "==> Current HEAD: $PRE_SYNC_FORK_SHA ($CURRENT_BRANCH)"
echo "==> Target ref:   $TARGET_REF ($RESOLVED_TARGET_SHA)"

COMMITS_BEHIND="$(git rev-list --count HEAD.."$RESOLVED_TARGET_SHA")"
if [ "$COMMITS_BEHIND" -eq 0 ]; then
  echo "Already up-to-date with $TARGET_REF! Nothing to sync."
  exit 0
fi

echo "==> Behind by $COMMITS_BEHIND commits. Initiating merge..."

# Create a timestamped sync branch if currently on main
SYNC_BRANCH="sync/upstream-$(date +%Y%m%d-%H%M%S)"
echo "==> Creating branch $SYNC_BRANCH..."
git checkout -b "$SYNC_BRANCH"

echo "==> Attempting merge (--no-ff, --no-commit)..."
if ! git merge --no-ff --no-commit "$RESOLVED_TARGET_SHA"; then
  echo ""
  echo "⚠️ Merge conflicts encountered!"
  
  # Check if pnpm-lock.yaml is among the conflicts
  if git status --porcelain | grep -q "UU pnpm-lock.yaml"; then
    echo "==> Auto-resolving pnpm-lock.yaml from target checkpoint $RESOLVED_TARGET_SHA..."
    git checkout "$RESOLVED_TARGET_SHA" -- pnpm-lock.yaml
    echo "==> Regenerating lockfile..."
    pnpm install --lockfile-only || true
    git add pnpm-lock.yaml
  fi

  UNRESOLVED=$(git diff --name-only --diff-filter=U)
  if [ -n "$UNRESOLVED" ]; then
    echo "Remaining unresolved conflicting files:"
    echo "$UNRESOLVED"
    echo ""
    echo "Please resolve conflicts in these files, then run:"
    echo "  pnpm install --frozen-lockfile"
    echo "  vp run check:changed $PRE_SYNC_FORK_SHA"
    echo "  git commit -m 'chore(sync): merge $TARGET_REF ($RESOLVED_TARGET_SHA)'"
    exit 1
  fi
fi

echo "==> Restoring lockfile consistency..."
pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile

echo "==> Running validation check against pre-sync baseline ($PRE_SYNC_FORK_SHA)..."
vp run check:changed "$PRE_SYNC_FORK_SHA"

echo "==> Committing merge..."
git commit -m "chore(sync): merge $TARGET_REF into $CURRENT_BRANCH"

echo ""
echo "✅ Merge completed successfully on $SYNC_BRANCH!"
echo "To fast-forward main, run:"
echo "  git checkout $CURRENT_BRANCH"
echo "  git merge --ff-only $SYNC_BRANCH"
echo "  git merge-base --is-ancestor $RESOLVED_TARGET_SHA $CURRENT_BRANCH"

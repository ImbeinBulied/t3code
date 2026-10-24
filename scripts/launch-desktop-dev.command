#!/bin/zsh -l
set -euo pipefail

# Resolve symlinks so the installed macOS launcher stays bound to this checkout.
repo_root="${0:A:h:h}"
dev_home="$repo_root/.t3"
cd "$repo_root"

if ! command -v vp >/dev/null 2>&1; then
  print -u2 'Vite+ (vp) is missing from your login shell. See docs/operations/development.md.'
  exit 1
fi

mkdir -p "$dev_home"
touch "$dev_home/desktop-dev-launcher.lock"
zmodload zsh/system
if ! zsystem flock -t 0 -f launcher_lock_fd "$dev_home/desktop-dev-launcher.lock" 2>/dev/null; then
  print 'Electron dev mode is already starting or running. Use its existing terminal and app window.'
  exit 0
fi

unset ELECTRON_RUN_AS_NODE
print "Starting Electron dev mode with data in $dev_home"
vp run dev:desktop --home-dir "$dev_home" "$@" 2>&1 | tee "$dev_home/desktop-dev-launcher.log"

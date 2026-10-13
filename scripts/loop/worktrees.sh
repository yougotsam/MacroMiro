#!/usr/bin/env bash
# Separate git worktrees for research / backtest / risk so parallel agents never edit the same checkout.
# Same repo, no new repo. Usage: scripts/loop/worktrees.sh [add|list|remove] [research|backtest|risk|all]
set -euo pipefail
cmd=${1:-list}; which=${2:-all}
root=$(git rev-parse --show-toplevel); base=$(dirname "$root")/MacroMiro-wt
names=(research backtest risk); [ "$which" != all ] && names=("$which")
case "$cmd" in
  add) for n in "${names[@]}"; do
         [ -d "$base/$n" ] && { echo "exists: $base/$n"; continue; }
         git -C "$root" worktree add -b "wt/$n" "$base/$n" HEAD >/dev/null && echo "added $base/$n (branch wt/$n)"; done ;;
  list) git -C "$root" worktree list ;;
  remove) for n in "${names[@]}"; do [ -d "$base/$n" ] && git -C "$root" worktree remove "$base/$n" && echo "removed $base/$n"; done ;;
  *) echo "usage: $0 [add|list|remove] [research|backtest|risk|all]"; exit 1 ;;
esac

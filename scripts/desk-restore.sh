#!/bin/sh
# If the local desk journal is missing, pull the latest PRIVATE backup and unpack it.
# A journal that is already here is kept. This script does not send an order and does not touch the public code repo.
set -eu
REPO="yougotsam/MacroMiro-desk-backup"
DEST="${DESK_RESTORE_DIR:-/workspace/data/desk}"
PARENT="$(dirname "$DEST")"
JOURNAL="$DEST/oms-journal.jsonl"

if [ -s "$JOURNAL" ]; then
  echo "desk-restore: local journal kept"
  exit 0
fi

if [ "$DEST" = "/workspace/data/desk" ]; then
  for p in /proc/[0-9]*; do
    cmd=$(tr "\0" " " < "$p/cmdline" 2>/dev/null || true)
    case "$cmd" in
      *scripts/desk-engine.ts*)
        echo "desk-restore: engine is running and the journal is missing; refusing to unpack under it" >&2
        exit 1
        ;;
    esac
  done
fi

vis="$(gh repo view "$REPO" --json visibility,isPrivate --jq '[.visibility, (.isPrivate|tostring)] | join(" ")' 2>/dev/null || true)"
case "$vis" in
  "PRIVATE true") ;;
  *) echo "desk-restore: refusing, $REPO visibility is '${vis:-unknown}'" >&2; exit 1 ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git clone --depth 1 "https://github.com/${REPO}.git" "$WORK/repo"
if [ ! -s "$WORK/repo/desk-latest.tar.gz" ]; then
  echo "desk-restore: private repo has no tarball" >&2
  exit 1
fi
mkdir -p "$PARENT"
tar -C "$PARENT" -xzf "$WORK/repo/desk-latest.tar.gz" --exclude='desk/engine.pid'
if [ ! -s "$JOURNAL" ]; then
  echo "desk-restore: unpacked backup still has no journal" >&2
  exit 1
fi
echo "desk-restore: restored journal from $REPO"
exit 0

#!/bin/bash
# Push a tarball of data/desk to the PRIVATE repo yougotsam/MacroMiro-desk-backup.
# Refuses if that repo is public. Does not add a remote to the public code repo. Does not send an order.
set -eu
cd /workspace
REPO="yougotsam/MacroMiro-desk-backup"

vis="$(gh repo view "$REPO" --json visibility,isPrivate --jq '[.visibility, (.isPrivate|tostring)] | join(" ")' 2>/dev/null || true)"
if [ -z "$vis" ]; then
  gh repo create "$REPO" --private --description "Private MacroMiro desk data backup. Not the trading code."
  vis="$(gh repo view "$REPO" --json visibility,isPrivate --jq '[.visibility, (.isPrivate|tostring)] | join(" ")')"
fi
case "$vis" in
  "PRIVATE true") ;;
  *) echo "refusing: $REPO visibility is '$vis', not PRIVATE" >&2; exit 1 ;;
esac

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/stage"

tar -C /workspace/data -czf "$WORK/stage/desk-latest.tar.gz" \
  --exclude='desk/engine.pid' \
  --exclude='*.pem' \
  --exclude='*.key' \
  --exclude='*secret*' \
  --exclude='*token*' \
  desk

python3 - "$WORK/stage" "$STAMP" <<'PY'
import hashlib, json, os, sys
stage, stamp = sys.argv[1], sys.argv[2]
path = os.path.join(stage, "desk-latest.tar.gz")
size = os.path.getsize(path)
if size > 95_000_000:
    raise SystemExit(f"refusing: tarball is {size} bytes, over the 95MB git file limit")
digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
row = {"at": stamp, "sha256": digest, "bytes": size, "excludes": ["engine.pid", "*.pem", "*.key", "*secret*", "*token*"]}
open(os.path.join(stage, "manifest.json"), "w").write(json.dumps(row, indent=2) + "\n")
open(os.path.join(stage, "backups.jsonl"), "w").write(json.dumps(row) + "\n")
print(digest, size)
PY

if ! git clone --depth 1 "https://github.com/${REPO}.git" "$WORK/repo" 2>"$WORK/clone.err"; then
  mkdir -p "$WORK/repo"
  git -C "$WORK/repo" init -b main
  git -C "$WORK/repo" remote add origin "https://github.com/${REPO}.git"
fi
# Keep the hash history. Replace only the latest tarball.
if [ -f "$WORK/repo/backups.jsonl" ]; then
  cat "$WORK/repo/backups.jsonl" "$WORK/stage/backups.jsonl" > "$WORK/repo/backups.jsonl"
else
  cp "$WORK/stage/backups.jsonl" "$WORK/repo/backups.jsonl"
fi
cp "$WORK/stage/desk-latest.tar.gz" "$WORK/repo/desk-latest.tar.gz"
cp "$WORK/stage/manifest.json" "$WORK/repo/manifest.json"
git -C "$WORK/repo" config user.name "YouGotSam"
git -C "$WORK/repo" config user.email "yougotsam@users.noreply.github.com"
git -C "$WORK/repo" add desk-latest.tar.gz manifest.json backups.jsonl
if git -C "$WORK/repo" diff --cached --quiet; then
  echo "desk-backup: nothing new"
  exit 0
fi
git -C "$WORK/repo" commit -m "Desk data snapshot ${STAMP}"
git -C "$WORK/repo" push -u origin HEAD:main
echo "desk-backup: pushed ${STAMP} to ${REPO}"

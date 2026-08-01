#!/usr/bin/env bash
#
# Pull every app from the busybar-apps community gallery into apps/local/, so you
# can test them in the emulator without keeping a second hand-maintained copy.
# The gallery is the single source of truth; re-run this whenever it changes.
#
#   ./tools/pull-apps.sh                                   # from the published gallery on GitHub
#   BUSYBAR_APPS_DIR=../busybar-apps ./tools/pull-apps.sh  # from a local gallery checkout
#
# apps/local/ is gitignored, so nothing pulled here is ever committed. Your own
# private apps in apps/local/ that aren't in the gallery are left untouched.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/apps/local"
GALLERY_REPO="https://github.com/maxswinkels/busybar-apps.git"

tmp=""
if [ -n "${BUSYBAR_APPS_DIR:-}" ]; then
  SRC="$BUSYBAR_APPS_DIR"
elif [ -d "$ROOT/../busybar-apps/apps" ]; then
  SRC="$ROOT/../busybar-apps"
else
  tmp="$(mktemp -d)"
  echo "Fetching the gallery from $GALLERY_REPO ..."
  git clone --depth 1 --quiet "$GALLERY_REPO" "$tmp"
  SRC="$tmp"
fi

[ -d "$SRC/apps" ] || { echo "error: no apps/ folder found in $SRC" >&2; exit 1; }
mkdir -p "$DEST"

n=0
for d in "$SRC"/apps/*/; do
  slug="$(basename "$d")"
  [ -f "$d/app.py" ] || continue
  mkdir -p "$DEST/$slug"
  # Runtime files only: skip gallery-publishing artifacts and caches, and keep the
  # emulator's per-app .venv so it isn't rebuilt on every pull.
  rsync -a \
    --exclude 'manifest.yaml' --exclude 'manifest.yml' --exclude 'preview.*' \
    --exclude '__pycache__' --exclude '.venv' --exclude '.git' \
    "$d" "$DEST/$slug/"
  echo "  + $slug"
  n=$((n + 1))
done

[ -n "$tmp" ] && rm -rf "$tmp"
echo "Pulled $n app(s) from the gallery into apps/local/"

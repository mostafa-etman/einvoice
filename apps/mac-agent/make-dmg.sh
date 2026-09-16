#!/usr/bin/env bash
# Wrap the built .app into a drag-to-Applications DMG (hdiutil, macOS only).
# Usage: ./make-dmg.sh [osx-x64|osx-arm64]
# Requires: ./package-macos-app.sh $RID already produced the .app
set -euo pipefail

RID="${1:-osx-x64}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="eInvoice Signing Agent.app"
APP="$ROOT/dist/$RID/$APP_NAME"
VOL_NAME="eInvoice Signing Agent"
DMG="$ROOT/dist/eInvoice-Signing-Agent-${RID}.dmg"
STAGE="$ROOT/dist/$RID/dmg-stage"

if [[ "$RID" != "osx-x64" && "$RID" != "osx-arm64" ]]; then
  echo "Usage: $0 [osx-x64|osx-arm64]"
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS (got $(uname -s)). It uses hdiutil."
  exit 1
fi

if [[ ! -d "$APP" ]]; then
  echo "App not found: $APP"
  echo "Build it first: ./package-macos-app.sh $RID"
  exit 1
fi

echo "==> Staging DMG contents…"
rm -rf "$STAGE"
mkdir -p "$STAGE"
# ditto preserves macOS metadata better than cp -R
ditto "$APP" "$STAGE/$APP_NAME"
ln -s /Applications "$STAGE/Applications"

echo "==> Creating $DMG…"
mkdir -p "$ROOT/dist"
rm -f "$DMG"
# HFS+ + UDZO is widely readable; Applications symlink = drag-to-install UX.
hdiutil create \
  -volname "$VOL_NAME" \
  -srcfolder "$STAGE" \
  -ov \
  -fs HFS+ \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$DMG"

rm -rf "$STAGE"

echo
echo "DMG: $DMG"
echo "Give this file to clients. They open it and drag \"$APP_NAME\" onto Applications."
echo
echo "Unsigned Gatekeeper (until you notarize):"
echo "  after install:  xattr -cr \"/Applications/$APP_NAME\""
echo "  then right-click the app → Open → Open."

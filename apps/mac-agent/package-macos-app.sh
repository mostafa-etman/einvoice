#!/usr/bin/env bash
# Build a self-contained .app on macOS. Run this ON THE MAC after pulling the repo.
# Usage: ./package-macos-app.sh [osx-x64|osx-arm64]
set -euo pipefail

RID="${1:-osx-x64}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
PUBLISH="$ROOT/dist/$RID/publish"
APP_NAME="eInvoice Signing Agent.app"
APP="$ROOT/dist/$RID/$APP_NAME"

if [[ "$RID" != "osx-x64" && "$RID" != "osx-arm64" ]]; then
  echo "Usage: $0 [osx-x64|osx-arm64]"
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS (got $(uname -s))."
  exit 1
fi

echo "==> Publishing Einvoice.Agent.Mac ($RID, self-contained)…"
dotnet publish "$ROOT/Einvoice.Agent.Mac.csproj" \
  -c Release \
  -r "$RID" \
  --self-contained true \
  -p:PublishSingleFile=false \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -o "$PUBLISH"

echo "==> Assembling $APP_NAME…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"
# Copy the published runtime + Avalonia natives next to the executable.
cp -R "$PUBLISH/." "$APP/Contents/MacOS/"
chmod +x "$APP/Contents/MacOS/Einvoice.Agent.Mac"

echo
echo "Built: $APP"
echo "Next:  ./make-dmg.sh $RID"
echo "   or: ./build-and-package.sh $RID  (app + dmg)"
echo
echo "First-run: install Egypt Trust / ePass Castle middleware so"
echo "         /usr/local/lib/libcastle.1.0.0.dylib exists, then insert the USB token."

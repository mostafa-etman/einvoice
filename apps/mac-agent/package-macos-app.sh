#!/usr/bin/env bash
# Build a self-contained .app on macOS. Run this ON THE MAC after pulling the repo.
# Usage: ./package-macos-app.sh [osx-x64|osx-arm64]
#
# Brace every expansion (${VAR}). macOS ships bash 3.2; with a UTF-8 locale,
# $APP_NAME followed by a Unicode ellipsis is a different unbound identifier.
set -euo pipefail

RID="${1:-osx-x64}"
ROOT="$(cd "$(dirname "${0}")" && pwd)"
APP_NAME="eInvoice Signing Agent"
APP_BUNDLE="${APP_NAME}.app"
PUBLISH="${ROOT}/dist/${RID}/publish"
APP="${ROOT}/dist/${RID}/${APP_BUNDLE}"
PLIST="${ROOT}/Info.plist"
EXECUTABLE="Einvoice.Agent.Mac"

if [[ "${RID}" != "osx-x64" && "${RID}" != "osx-arm64" ]]; then
  echo "Usage: ${0} [osx-x64|osx-arm64]"
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS (got $(uname -s))."
  exit 1
fi

if [[ ! -f "${PLIST}" ]]; then
  echo "Missing Info.plist: ${PLIST}"
  exit 1
fi

echo "==> Publishing Einvoice.Agent.Mac (${RID}, self-contained)..."
dotnet publish "${ROOT}/Einvoice.Agent.Mac.csproj" \
  -c Release \
  -r "${RID}" \
  --self-contained true \
  -p:PublishSingleFile=false \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -o "${PUBLISH}"

if [[ ! -f "${PUBLISH}/${EXECUTABLE}" ]]; then
  echo "Publish did not produce ${PUBLISH}/${EXECUTABLE}"
  exit 1
fi

echo "==> Assembling ${APP_BUNDLE}..."
rm -rf "${APP}"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"
cp "${PLIST}" "${APP}/Contents/Info.plist"
# Copy the published runtime + Avalonia natives next to the executable.
cp -R "${PUBLISH}/." "${APP}/Contents/MacOS/"
chmod +x "${APP}/Contents/MacOS/${EXECUTABLE}"

echo
echo "Built: ${APP}"
echo "  CFBundleName / display name: ${APP_NAME}"
echo "  executable: Contents/MacOS/${EXECUTABLE}"
echo "  LSUIElement: menu-bar extra (see Info.plist)"
echo "Next:  ./make-dmg.sh ${RID}"
echo "   or: ./build-and-package.sh ${RID}  (app + dmg)"
echo
echo "First-run: install Egypt Trust / ePass Castle middleware so"
echo "         /usr/local/lib/libcastle.1.0.0.dylib exists, then insert the USB token."

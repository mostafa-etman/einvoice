#!/usr/bin/env bash
# One shot: publish the .app, then wrap it in a distributable .dmg.
# Usage: ./build-and-package.sh [osx-x64|osx-arm64]
set -euo pipefail

RID="${1:-osx-x64}"
ROOT="$(cd "$(dirname "${0}")" && pwd)"

if [[ "${RID}" != "osx-x64" && "${RID}" != "osx-arm64" ]]; then
  echo "Usage: ${0} [osx-x64|osx-arm64]"
  exit 1
fi

"${ROOT}/package-macos-app.sh" "${RID}"
"${ROOT}/make-dmg.sh" "${RID}"

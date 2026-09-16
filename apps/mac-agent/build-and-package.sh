#!/usr/bin/env bash
# One shot: publish the .app, then wrap it in a distributable .dmg.
# Usage: ./build-and-package.sh [osx-x64|osx-arm64]
set -euo pipefail

RID="${1:-osx-x64}"
ROOT="$(cd "$(dirname "$0")" && pwd)"

"$ROOT/package-macos-app.sh" "$RID"
"$ROOT/make-dmg.sh" "$RID"

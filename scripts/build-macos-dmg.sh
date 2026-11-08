#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"

npx tauri build --bundles app,dmg "$@"

DMG_PATH="$(find "$PROJECT_ROOT/src-tauri/target/release/bundle/dmg" -maxdepth 1 -type f -name '*_aarch64.dmg' -print -quit)"
if [[ -z "$DMG_PATH" ]]; then
  printf '没有找到 Apple Silicon DMG。\n' >&2
  exit 1
fi

bash "$PROJECT_ROOT/scripts/package-macos-dmg.sh" "$DMG_PATH"

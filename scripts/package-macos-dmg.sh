#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf '用法：%s <tauri-dmg>\n' "$0" >&2
  exit 2
fi

DMG_PATH="$1"
if [[ ! -f "$DMG_PATH" ]]; then
  printf '找不到 DMG：%s\n' "$DMG_PATH" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
ASSET_DIR="$SCRIPT_DIR/macos-dmg"
for required_file in README.txt install.command; do
  if [[ ! -f "$ASSET_DIR/$required_file" ]]; then
    printf '缺少 DMG 安装资源：%s\n' "$ASSET_DIR/$required_file" >&2
    exit 1
  fi
done

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/artificer-dmg.XXXXXX")"
MOUNT_DIR="$TEMP_ROOT/mount"
WORK_STEM="$TEMP_ROOT/writable"
OUTPUT_STEM="$TEMP_ROOT/packed"
MOUNTED=0

cleanup() {
  if [[ "$MOUNTED" -eq 1 ]]; then
    hdiutil detach "$MOUNT_DIR" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TEMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$MOUNT_DIR"
hdiutil convert "$DMG_PATH" -format UDRW -o "$WORK_STEM" >/dev/null
WORK_DMG="$WORK_STEM.dmg"
hdiutil attach -nobrowse -noautoopen -readwrite -mountpoint "$MOUNT_DIR" "$WORK_DMG" >/dev/null
MOUNTED=1

/usr/bin/install -m 0644 "$ASSET_DIR/README.txt" "$MOUNT_DIR/README.txt"
/usr/bin/install -m 0755 "$ASSET_DIR/install.command" "$MOUNT_DIR/一键安装.command"
sync

hdiutil detach "$MOUNT_DIR" >/dev/null
MOUNTED=0
hdiutil convert "$WORK_DMG" -format UDZO -o "$OUTPUT_STEM" >/dev/null
OUTPUT_DMG="$OUTPUT_STEM.dmg"
mv -f -- "$OUTPUT_DMG" "$DMG_PATH"

printf '已将安装说明和一键安装脚本写入：%s\n' "$DMG_PATH"

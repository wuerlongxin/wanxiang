#!/bin/bash
set -euo pipefail

APP_NAME="万象卡域.app"
SOURCE_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
SOURCE_APP="$SOURCE_DIR/$APP_NAME"
TARGET_APP="/Applications/$APP_NAME"

fail() {
  printf '\n安装失败：%s\n' "$1" >&2
  printf '按回车退出。'
  read -r
  exit 1
}

if [[ ! -d "$SOURCE_APP/Contents/MacOS" ]]; then
  fail "没有在当前 DMG 中找到完整的 $APP_NAME。"
fi

SOURCE_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$SOURCE_APP/Contents/Info.plist" 2>/dev/null || true)"
if [[ "$SOURCE_BUNDLE_ID" != "com.wanxiang.deck" ]]; then
  fail "应用 Bundle ID 校验失败。"
fi

if [[ "$TARGET_APP" != "/Applications/万象卡域.app" ]]; then
  fail "安装目标路径校验失败。"
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  printf '警告：这个版本面向 Apple Silicon（arm64），当前设备是 %s。\n' "$(uname -m)"
fi

printf '即将把 %s 安装到 %s。\n' "$APP_NAME" "$TARGET_APP"
printf '系统会请求一次管理员密码，用于写入应用程序目录。\n\n'

if [[ -e "$TARGET_APP" ]]; then
  TARGET_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TARGET_APP/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$TARGET_BUNDLE_ID" != "com.wanxiang.deck" ]]; then
    fail "已有同名应用不是万象卡域，已停止安装以避免覆盖其他程序。"
  fi
  printf '正在替换已有版本……\n'
  sudo /bin/rm -rf -- "$TARGET_APP"
fi

sudo /usr/bin/ditto --rsrc --extattr "$SOURCE_APP" "$TARGET_APP"

printf '正在执行 sudo xattr -dr com.apple.quarantine……\n'
# A locally created DMG may not carry this attribute; the post-check handles both cases.
sudo /usr/bin/xattr -dr com.apple.quarantine "$TARGET_APP" 2>/dev/null || true
if /usr/bin/xattr -lr "$TARGET_APP" 2>/dev/null | /usr/bin/grep -q 'com.apple.quarantine'; then
  fail "无法移除应用的下载隔离属性。"
fi

printf '\n安装完成：%s\n' "$TARGET_APP"
/usr/bin/open "$TARGET_APP"
printf '应用已启动。按回车关闭此窗口。'
read -r

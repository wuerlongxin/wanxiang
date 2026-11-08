万象卡域 macOS 安装说明
========================

适用版本：Apple Silicon（arm64）

这个安装包使用 ad-hoc 签名，尚未经过 Apple 公证。macOS 可能会因为下载隔离属性阻止应用启动。

推荐安装方式
------------

1. 确认 DMG 来自万象卡域 GitHub Release，并在发布页核对 SHA-256 校验值。
2. 双击“一键安装.command”。如果 Finder 第一次阻止它，请右键该文件，选择“打开”，再确认运行。
3. 脚本会请求当前 macOS 账户密码，将“万象卡域.app”安装到“/Applications”。
4. 安装完成后，脚本会执行下面的命令移除下载隔离属性，然后打开应用：

   sudo xattr -dr com.apple.quarantine "/Applications/万象卡域.app"

这一步只移除 macOS 的下载隔离标记，不等同于代码签名或安全审查。请只对你确认来源和校验值的安装包执行。

手动安装备用方式
----------------

如果无法双击脚本，可以在“终端”中把“万象卡域.app”复制到应用程序目录，然后执行：

   sudo xattr -dr com.apple.quarantine "/Applications/万象卡域.app"
   open "/Applications/万象卡域.app"

应用也可以直接从 DMG 拖到“Applications”快捷方式。首次启动仍可能要求你在“系统设置 → 隐私与安全性”中确认。

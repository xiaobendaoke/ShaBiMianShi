#!/bin/zsh
set -eu
cd -- "${0:A:h}"

# 应用的 userData 被固定在 ~/Library/Application Support/面试狗-独立版，
# 该路径是指向本仓库 personal/app-data 的符号链接（见 personal/MIGRATION.md）。
# 仓库改名或移动会让它变成悬空链接，此时 Electron 无法创建 SingletonLock，
# requestSingleInstanceLock() 返回 false，应用会误报“旧实例仍在运行”。
# 这里在启动前自动把链接指回本仓库，仓库改名也不会再断。
data_link="$HOME/Library/Application Support/面试狗-独立版"
data_dir="${0:A:h}/personal/app-data"
mkdir -p "$data_dir"
if [[ -L "$data_link" ]]; then
  if [[ "$(readlink "$data_link")" != "$data_dir" ]]; then
    rm -f "$data_link"
    ln -s "$data_dir" "$data_link"
  fi
elif [[ -e "$data_link" ]]; then
  print -u2 "警告：$data_link 不是符号链接，未改动；应用数据可能不在本仓库内。"
else
  ln -s "$data_dir" "$data_link"
fi

# 打包产物不会随 git pull 自动更新：源码变了必须重新 npm run pack。
# 若源码比应用包新，先提示（不自动打包，避免启动时长时间等待）。
app_path=$(/usr/bin/plutil -extract path raw -o - release/latest-build.json)
if [[ ! -d "$app_path" ]]; then
  print '找不到最新应用，请先运行 npm run pack。'
  exit 1
fi
newest_source=$(command find src vite.config.ts package.json -type f -newer "$app_path/Contents/Info.plist" -print -quit 2>/dev/null || true)
if [[ -n "$newest_source" ]]; then
  print "提示：源码比当前应用包新（例如 $newest_source），如需最新版本请先运行 npm run pack。"
fi

# Use Launch Services so macOS records permissions against the packaged application.
/usr/bin/open -n "$app_path"

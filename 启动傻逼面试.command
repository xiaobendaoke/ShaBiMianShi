#!/bin/zsh
set -eu
cd -- "${0:A:h}"
app_path=$(/usr/bin/plutil -extract path raw -o - release/latest-build.json)
if [[ ! -d "$app_path" ]]; then
  print '找不到最新应用，请先运行 npm run pack。'
  exit 1
fi
# Use Launch Services so macOS records permissions against the packaged application.
/usr/bin/open -n "$app_path"

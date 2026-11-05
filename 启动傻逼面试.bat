@echo off
chcp 65001 >nul
if exist "%~dp0release\win-unpacked\傻逼面试.exe" (
  start "" "%~dp0release\win-unpacked\傻逼面试.exe"
) else (
  echo 尚未打包，请先在项目目录执行 npm run pack:win
)

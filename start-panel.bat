@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo 正在启动 SVG 实时面板服务器...
echo 打开浏览器：http://localhost:3456
echo 关闭本窗口即可停止服务
echo.
start "" "http://localhost:3456"
node panel-server.js

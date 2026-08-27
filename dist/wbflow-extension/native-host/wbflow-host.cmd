@echo off
rem WBFlow native host 包装脚本：调用 node 执行宿主逻辑
rem Chrome 将本脚本作为可执行文件启动，stdin/stdout 由 wbflow-host.cjs 处理
setlocal
node "%~dp0wbflow-host.cjs"
exit /b %errorlevel%

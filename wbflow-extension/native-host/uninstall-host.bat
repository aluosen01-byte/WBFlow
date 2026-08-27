@echo off
rem WBFlow Native Host 卸载脚本
echo 正在卸载 WBFlow Native Host...
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.wbflow.host" /f >nul 2>nul
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.wbflow.host" /f >nul 2>nul
if exist "%~dp0com.wbflow.host.json" del "%~dp0com.wbflow.host.json"
echo 已卸载（Chrome/Edge 注册表项与宿主清单已删除）
pause

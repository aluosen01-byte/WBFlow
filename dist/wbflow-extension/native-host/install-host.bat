@echo off
rem ============================================================
rem  WBFlow Native Host 一键安装脚本（Windows）
rem  作用：注册 Native Messaging Host，使 WBFlow 扩展可以自动
rem        启动后端服务（无需手动 npm start）
rem  用法：双击运行本脚本，或右键"以管理员身份运行"（推荐）
rem ============================================================
setlocal enabledelayedexpansion

echo.
echo  ============================================
echo   WBFlow 后端自动启动 - 宿主安装
echo  ============================================
echo.

rem ---- 1. 探测 node.exe ----
set "NODE=%~dp0..\..\..\node.exe"
where node >nul 2>nul
if %errorlevel%==0 (
  for /f "delims=" %%i in ('where node') do (
    set "NODE=%%i"
    goto :node_found
  )
)
if not exist "%NODE%" (
  echo  [错误] 未找到 node.exe，请先安装 Node.js 并加入 PATH
  pause
  exit /b 1
)
:node_found
echo  [1/4] Node.js 路径: %NODE%

rem ---- 2. 定位项目根目录（本脚本位于 wbflow-extension\native-host\） ----
set "HOST_DIR=%~dp0"
for %%I in ("%HOST_DIR%..\..") do set "PROJECT_DIR=%%~fI"
echo  [2/4] 项目目录: %PROJECT_DIR%
if not exist "%PROJECT_DIR%\server\index.js" (
  echo  [错误] 未找到 server\index.js，项目目录定位失败
  pause
  exit /b 1
)

rem ---- 3. 生成 native host manifest ----
set "MANIFEST_FILE=%HOST_DIR%com.wbflow.host.json"
set "HOST_CMD=%HOST_DIR%wbflow-host.cmd"

> "%MANIFEST_FILE%" (
  echo {
  echo   "name": "com.wbflow.host",
  echo   "description": "WBFlow backend launcher (auto start npm-style server)",
  echo   "path": "%HOST_CMD:\=\\%",
  echo   "type": "stdio",
  echo   "allowed_origins": ["chrome-extension://x2nu5mja2llgqeiowytsijptru/"]
  echo }
)
echo  [3/4] 已生成宿主清单: %MANIFEST_FILE%

rem ---- 4. 写注册表（Chrome + Edge） ----
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.wbflow.host" /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul
if %errorlevel%==0 (
  echo  [4/4] Chrome 注册成功
) else (
  echo  [警告] Chrome 注册失败，请以管理员身份运行
)
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.wbflow.host" /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul
if %errorlevel%==0 (
  echo  Edge 注册成功
) else (
  echo  [警告] Edge 注册失败，请以管理员身份运行
)

echo.
echo  ============================================
echo   安装完成！
echo   - 若扩展已加载，请到 chrome://extensions 点击"重新加载"
echo   - 之后打开 WBFlow 扩展设置或商品页时，后端服务将自动启动
echo   - 若后端未自动启动，可手动运行: npm start
echo  ============================================
echo.
if /i "%~1"=="/silent" exit /b 0
pause

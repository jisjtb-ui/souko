@echo off
chcp 65001 >nul
setlocal EnableExtensions
title souko 開発サーバーの再起動

rem ============================================================
rem  開発サーバーを停止してから起動し直します。
rem  ------------------------------------------------------------
rem  補足: コードを変更しただけなら再起動は不要です。
rem        Vite の HMR と tsx watch により自動で反映されます。
rem        設定ファイルを変えたときや、様子がおかしいときにお使いください。
rem ============================================================

pushd "%~dp0"

echo ============================================================
echo   souko 開発サーバーを再起動します
echo ============================================================
echo.

call "%~dp0stop.bat" nopause

echo.
echo プロセスの終了を待っています...
timeout /t 3 /nobreak >nul

echo.
call "%~dp0dev.bat"
set "RC=%ERRORLEVEL%"

popd
endlocal
exit /b %RC%

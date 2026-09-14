@echo off
chcp 65001 >nul
setlocal EnableExtensions
title souko 開発サーバーの停止

rem ============================================================
rem  souko の開発サーバーだけを停止します。
rem  ------------------------------------------------------------
rem  「node.exe を全部終了」といった乱暴なことはしません。
rem  停止対象は次の条件を満たすものだけです。
rem
rem    (A) 実行コマンドにこのプロジェクトのパスを含む node.exe
rem        → npm run dev で起動する vite / tsx / tsc はすべて
rem          このフォルダの node_modules から実行されるため、
rem          souko のプロセスだけを正確に選べます。
rem    (B) (A) が使えない場合の保険として、
rem        ポート 5173 / 5178 を LISTENING している node.exe
rem
rem  引数に nopause を渡すと最後の一時停止を行いません (restart.bat 用)。
rem ============================================================

set "WEB_PORT=5173"
set "API_PORT=5178"
set "NOPAUSE="
if /i "%~1"=="nopause" set "NOPAUSE=1"

pushd "%~dp0"
set "SOUKO_ROOT=%CD%"
set "STOPPED=0"

echo ============================================================
echo   souko 開発サーバーの停止
echo ============================================================
echo   対象フォルダ : %SOUKO_ROOT%
echo.

rem -------------------------------------------------- (A) パスで特定
where powershell >nul 2>&1
if errorlevel 1 goto BY_PORT

echo このプロジェクトの Node.js プロセスを探しています...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=$env:SOUKO_ROOT; $ps=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Contains($root) }); if ($ps.Count -eq 0) { exit 1 }; foreach ($p in $ps) { Write-Host ('  停止: PID ' + $p.ProcessId); Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; exit 0"
if errorlevel 1 goto BY_PORT
set "STOPPED=1"
goto BY_PORT

rem ------------------------------------------- (B) ポートで取りこぼし確認
:BY_PORT
echo.
echo ポートの使用状況を確認しています...
call :STOP_PORT %WEB_PORT% "UI (Vite)"
call :STOP_PORT %API_PORT% "API (Express)"

echo.
if "%STOPPED%"=="0" goto NOTHING
echo 停止しました。
goto END

:NOTHING
echo souko の開発サーバーは起動していませんでした。

:END
popd
endlocal & if not "%NOPAUSE%"=="1" pause
exit /b 0

rem ============================================================
rem  サブルーチン: 指定ポートを使っている node.exe を停止する
rem    %1 = ポート番号 / %2 = 表示名
rem ============================================================
:STOP_PORT
set "TARGET_PID="
for /f "tokens=5" %%p in ('netstat -ano -p TCP ^| findstr /r /c:":%~1 .*LISTENING"') do set "TARGET_PID=%%p"

if not defined TARGET_PID (
  echo   ポート %~1 %~2 : 使用されていません
  goto :eof
)

rem 無関係のアプリを落とさないよう、node.exe かどうかを必ず確認する
set "IMAGE="
for /f "tokens=1 delims=," %%i in ('tasklist /fi "PID eq %TARGET_PID%" /nh /fo csv 2^>nul') do set "IMAGE=%%~i"

if not defined IMAGE (
  echo   ポート %~1 %~2 : PID %TARGET_PID% の情報を取得できませんでした
  goto :eof
)

echo %IMAGE% | findstr /i /c:"node.exe" >nul
if errorlevel 1 (
  echo   ポート %~1 %~2 : PID %TARGET_PID% は %IMAGE% のため停止しません
  echo        souko 以外のアプリがこのポートを使用している可能性があります。
  goto :eof
)

echo   ポート %~1 %~2 : PID %TARGET_PID% を停止します
taskkill /PID %TARGET_PID% /T /F >nul 2>&1
if errorlevel 1 (
  echo        停止できませんでした。管理者として実行するとうまくいく場合があります。
  goto :eof
)
set "STOPPED=1"
goto :eof

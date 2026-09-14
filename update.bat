@echo off
chcp 65001 >nul
setlocal EnableExtensions
title souko の更新

rem ============================================================
rem  souko を最新版に更新します。
rem  ------------------------------------------------------------
rem  git pull で最新のコードを取得し、依存パッケージに変更が
rem  あったときだけ npm install を実行します。
rem
rem  引数に nopause を渡すと最後の一時停止を行いません。
rem  (dev.bat から呼び出す用)
rem ============================================================

set "NOPAUSE="
if /i "%~1"=="nopause" set "NOPAUSE=1"

pushd "%~dp0"
if errorlevel 1 goto ERR_PUSHD

echo ============================================================
echo   souko の更新
echo ============================================================
echo   フォルダ : %CD%
echo.

rem ---------------------------------------------------------- git
where git >nul 2>&1
if errorlevel 1 goto ERR_NO_GIT
if not exist ".git\" goto ERR_NO_REPO

rem 開発サーバーが動いているとファイルを掴んで更新に失敗することがある
call :GET_PORT_PID 5173 WEB_PID
if defined WEB_PID goto ERR_RUNNING

rem -------------------------------------------- ローカル変更の確認
echo [1/4] 変更の有無を確認しています...
set "DIRTY="
for /f "delims=" %%l in ('git status --porcelain 2^>nul') do set "DIRTY=1"
if defined DIRTY goto ERR_DIRTY
echo       未コミットの変更はありません

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
echo       現在のブランチ : %BRANCH%

rem ------------------------------------------- 更新前の状態を控える
for /f "delims=" %%h in ('git rev-parse HEAD 2^>nul') do set "BEFORE=%%h"
set "LOCK_BEFORE="
if exist "package-lock.json" for /f "delims=" %%h in ('certutil -hashfile "package-lock.json" MD5 ^| findstr /r "^[0-9a-f][0-9a-f]*$"') do set "LOCK_BEFORE=%%h"

rem ------------------------------------------------------- git pull
echo.
echo [2/4] 最新版を取得しています (git pull)...
git pull --ff-only
if errorlevel 1 goto ERR_PULL

for /f "delims=" %%h in ('git rev-parse HEAD 2^>nul') do set "AFTER=%%h"
echo.
if "%BEFORE%"=="%AFTER%" goto NO_CHANGE
echo       更新しました。
echo.
echo       取り込んだ変更:
git --no-pager log --oneline "%BEFORE%..%AFTER%"
goto CHECK_DEPS

:NO_CHANGE
echo       すでに最新です。
set "LOCK_AFTER=%LOCK_BEFORE%"
goto AFTER_DEPS

rem --------------------------------------------- 依存パッケージ確認
:CHECK_DEPS
echo.
echo [3/4] 依存パッケージを確認しています...
set "LOCK_AFTER="
if exist "package-lock.json" for /f "delims=" %%h in ('certutil -hashfile "package-lock.json" MD5 ^| findstr /r "^[0-9a-f][0-9a-f]*$"') do set "LOCK_AFTER=%%h"

if not exist "node_modules\" goto DO_INSTALL
if "%LOCK_BEFORE%"=="%LOCK_AFTER%" goto SKIP_INSTALL
echo       package-lock.json が変わったため npm install を実行します。
goto DO_INSTALL

:SKIP_INSTALL
echo       変更なし。npm install はスキップします。
goto AFTER_DEPS

:DO_INSTALL
echo.
call npm install
if errorlevel 1 goto ERR_INSTALL

:AFTER_DEPS
echo.
echo [4/4] 完了
echo.
echo ------------------------------------------------------------
echo   更新が終わりました。dev.bat で開発サーバーを起動できます。
echo ------------------------------------------------------------
popd
endlocal & if not "%NOPAUSE%"=="1" pause
exit /b 0

rem ============================================================
rem  サブルーチン
rem ============================================================
:GET_PORT_PID
set "%~2="
for /f "tokens=5" %%p in ('netstat -ano -p TCP ^| findstr /r /c:":%~1 .*LISTENING"') do set "%~2=%%p"
goto :eof

rem ============================================================
rem  エラー処理
rem ============================================================

:ERR_PUSHD
echo [エラー] プロジェクトフォルダへ移動できませんでした: %~dp0
endlocal
pause
exit /b 1

:ERR_NO_GIT
echo.
echo ------------------------------------------------------------
echo   [エラー] git がインストールされていません。
echo.
echo   自動更新には Git が必要です。
echo   https://git-scm.com/download/win からインストールしてください。
echo.
echo   Git を使わない場合は、配布元から zip をダウンロードし直して
echo   フォルダごと入れ替えてください。
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b 1

:ERR_NO_REPO
echo.
echo ------------------------------------------------------------
echo   [エラー] このフォルダは Git リポジトリではありません。
echo.
echo   zip をダウンロードして展開した場合、更新履歴が含まれないため
echo   自動更新できません。次のどちらかをお使いください。
echo.
echo     - 配布元から zip を取り直してフォルダごと入れ替える
echo     - git clone で取得し直す（以後は update.bat が使えます）
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b 1

:ERR_RUNNING
echo.
echo ------------------------------------------------------------
echo   [エラー] 開発サーバーが起動中です。PID %WEB_PID%
echo.
echo   更新中にファイルが書き換わると不具合の原因になります。
echo   stop.bat で停止してから、もう一度 update.bat を実行してください。
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b 1

:ERR_DIRTY
echo.
echo ------------------------------------------------------------
echo   [中止] このフォルダに未コミットの変更があります。
echo.
git --no-pager status --short
echo.
echo   上書きしてしまわないよう、更新を中止しました。
echo   変更を残したい場合は、別の場所にコピーを取ってから
echo   次のいずれかを行ってください。
echo.
echo     - 変更を確定する : git add -A ^&^& git commit -m "作業内容"
echo     - 変更を捨てる   : git restore .
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b 1

:ERR_PULL
echo.
echo ------------------------------------------------------------
echo   [エラー] git pull に失敗しました。
echo.
echo   よくある原因:
echo     - インターネットに接続できていない
echo     - 認証情報の期限切れ
echo     - ローカルの履歴が枝分かれしている（早送り更新できない）
echo         上のログに "Not possible to fast-forward" と出ている場合は、
echo         このフォルダに独自の変更が積まれています。
echo         配布元から取り直すか、手動で解決してください。
echo.
echo   上に表示されている git のメッセージもご確認ください。
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b 1

:ERR_INSTALL
echo.
echo ------------------------------------------------------------
echo   [エラー] npm install に失敗しました。
echo.
echo   インターネット接続やプロキシ設定をご確認ください。
echo   node_modules フォルダを削除してから dev.bat を実行すると
echo   入れ直せます。
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b 1

@echo off
chcp 65001 >nul
setlocal EnableExtensions
title souko 開発サーバー

rem ============================================================
rem  souko 開発サーバー起動スクリプト
rem  ------------------------------------------------------------
rem  Node.js確認 → node_modules確認 → npm install → 開発サーバー起動
rem  → ブラウザ自動起動 までをまとめて実行します。
rem
rem  このバッチが置かれているフォルダを基準に動くため、
rem  プロジェクトフォルダごと移動しても、パスに日本語や空白が
rem  含まれていても動作します。
rem ============================================================

rem UI(Vite) と API(Express) のポート。packages/web/vite.config.ts に合わせています。
set "WEB_PORT=5173"
set "API_PORT=5178"

rem 開発サーバーが実際に立ち上がったかを記録する目印ファイル
set "SOUKO_UP_FLAG=%TEMP%\souko-dev-up.flag"
del "%SOUKO_UP_FLAG%" >nul 2>&1

pushd "%~dp0"
if errorlevel 1 goto ERR_PUSHD

echo ============================================================
echo   souko 開発サーバー
echo ============================================================
echo   フォルダ : %CD%
echo.

rem ---------------------------------------------------- 1) Node.js
echo [1/5] Node.js と npm を確認しています...
where node >nul 2>&1
if errorlevel 1 goto ERR_NO_NODE
where npm >nul 2>&1
if errorlevel 1 goto ERR_NO_NPM

for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
for /f "delims=" %%v in ('npm -v') do set "NPM_VER=%%v"
for /f "tokens=1,2 delims=v." %%a in ('node -v') do (
  set "NODE_MAJOR=%%a"
  set "NODE_MINOR=%%b"
)
echo       Node.js %NODE_VER% / npm %NPM_VER%

if not defined NODE_MAJOR goto VER_OK
if %NODE_MAJOR% LSS 22 goto ERR_OLD_NODE
if %NODE_MAJOR% GTR 22 goto VER_OK
if %NODE_MINOR% LSS 5 goto ERR_OLD_NODE
:VER_OK

rem ------------------------------------------------ 2) package.json
echo [2/5] package.json を確認しています...
if not exist "package.json" goto ERR_NO_PKG
echo       OK

rem ----------------------------------------------- 3) node_modules
echo [3/5] 依存パッケージを確認しています...
if exist "node_modules\" goto HAVE_MODULES
echo       node_modules が見つかりません。npm install を実行します。
echo       初回は数分かかることがあります。
echo.
call npm install
if errorlevel 1 goto ERR_INSTALL
echo.
echo       npm install が完了しました。
goto MODULES_OK
:HAVE_MODULES
echo       インストール済みのため npm install はスキップします
:MODULES_OK

rem -------------------------------------------------- 4) ポート確認
echo [4/5] ポートを確認しています。UI %WEB_PORT% / API %API_PORT%
call :GET_PORT_PID %WEB_PORT% WEB_PID
call :GET_PORT_PID %API_PORT% API_PID
if defined WEB_PID goto ALREADY_RUNNING
if defined API_PID goto PORT_API_BUSY
echo       空いています

rem ---------------------------------------------- 5) 開発サーバー起動
echo [5/5] 開発サーバーを起動します...
echo.
echo   UI  : http://localhost:%WEB_PORT%/    ブラウザを自動で開きます
echo   API : http://localhost:%API_PORT%/
echo.
echo   コードを変更すると自動で反映されます。Vite の HMR と tsx watch が
echo   効いているため、変更のたびに再起動する必要はありません。
echo.
echo   停止   : このウィンドウで Ctrl+C 、または stop.bat
echo   再起動 : restart.bat
echo ------------------------------------------------------------
echo.

rem 起動が終わるのを待ってからブラウザを開く。先に開くと接続エラーになるため。
set "BROWSER_WATCH="
where powershell >nul 2>&1
if errorlevel 1 goto NO_BROWSER
set "BROWSER_WATCH=1"
start "souko browser" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=%WEB_PORT%; for($i=0;$i -lt 240;$i++){ try { $c=New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1',$p); $c.Close(); $null=New-Item -ItemType File -Path $env:SOUKO_UP_FLAG -Force; Start-Process ('http://localhost:'+$p+'/'); break } catch { Start-Sleep -Milliseconds 500 } }"
goto RUN_DEV

:NO_BROWSER
echo   [注意] powershell が見つからないため、ブラウザは自動で開きません。
echo          起動後に http://localhost:%WEB_PORT%/ を手動で開いてください。
echo.

:RUN_DEV
call npm run dev
set "DEV_EXIT=%ERRORLEVEL%"
echo.

rem 目印ファイルがあれば「一度は起動できた」ので、Ctrl+C での終了と区別できる
if exist "%SOUKO_UP_FLAG%" goto DEV_STOPPED
if not defined BROWSER_WATCH goto DEV_UNKNOWN
goto ERR_DEV

:DEV_STOPPED
del "%SOUKO_UP_FLAG%" >nul 2>&1
echo 開発サーバーを終了しました。
popd
endlocal
exit /b 0

:DEV_UNKNOWN
echo 開発サーバーが終了しました。終了コード %DEV_EXIT%
echo エラーで終了した場合は、上のログの内容をご確認ください。
popd
endlocal
pause
exit /b %DEV_EXIT%

rem ============================================================
rem  サブルーチン
rem ============================================================

rem 指定ポートを LISTENING しているプロセスIDを取得する
rem   %1 = ポート番号 / %2 = 結果を格納する変数名。見つからなければ未定義。
:GET_PORT_PID
set "%~2="
for /f "tokens=5" %%p in ('netstat -ano -p TCP ^| findstr /r /c:":%~1 .*LISTENING"') do set "%~2=%%p"
goto :eof

rem ============================================================
rem  正常系の分岐
rem ============================================================

:ALREADY_RUNNING
echo.
echo ------------------------------------------------------------
echo   開発サーバーはすでに起動しています。ポート %WEB_PORT% / PID %WEB_PID%
echo   二重に起動せず、ブラウザだけを開きます。
echo.
echo   停止したいとき     : stop.bat
echo   起動し直したいとき : restart.bat
echo ------------------------------------------------------------
echo.
start "" "http://localhost:%WEB_PORT%/"
popd
endlocal
pause
exit /b 0

:PORT_API_BUSY
echo.
echo ------------------------------------------------------------
echo   [エラー] APIポート %API_PORT% が別のプロセスに使われています。PID %API_PID%
echo.
echo   考えられる原因:
echo     - souko のサーバーが別のウィンドウで起動したままになっている
echo       stop.bat を実行してから、もう一度お試しください。
echo     - npm start で本番用サーバーを起動したままになっている
echo       そのウィンドウで Ctrl+C を押して終了してください。
echo     - 別のアプリが %API_PORT% を使用している
echo       そのアプリを終了するか、ポートを変更してください。
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b 1

rem ============================================================
rem  エラー処理
rem ============================================================

:ERR_PUSHD
echo [エラー] プロジェクトフォルダへ移動できませんでした。
echo          パス: %~dp0
echo          ネットワークドライブ上にある場合は、ローカルにコピーしてお試しください。
endlocal
pause
exit /b 1

:ERR_NO_NODE
echo.
echo ------------------------------------------------------------
echo   [エラー] Node.js がインストールされていません。
echo.
echo   このプロジェクトには Node.js 22.5.0 以上 が必要です。
echo   推奨: Node.js 22 LTS もしくは 24 LTS
echo.
echo   https://nodejs.org/ja/download からインストーラーを入手し、
echo   インストール後にこのウィンドウを閉じて開き直してから、
echo   もう一度 dev.bat を実行してください。
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b 1

:ERR_NO_NPM
echo.
echo ------------------------------------------------------------
echo   [エラー] npm が見つかりません。
echo.
echo   Node.js は入っているようですが、npm にパスが通っていません。
echo   Node.js を公式インストーラーで入れ直すと解消することが多いです。
echo   https://nodejs.org/ja/download
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b 1

:ERR_OLD_NODE
echo.
echo ------------------------------------------------------------
echo   [エラー] Node.js のバージョンが古すぎます。
echo.
echo   現在 : %NODE_VER%
echo   必要 : 22.5.0 以上   推奨: 22 LTS もしくは 24 LTS
echo.
echo   このプロジェクトは Node.js 標準の node:sqlite を使用しているため、
echo   22.5.0 未満では動作しません。
echo   https://nodejs.org/ja/download から新しい版をインストールしてください。
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b 1

:ERR_NO_PKG
echo.
echo ------------------------------------------------------------
echo   [エラー] package.json が見つかりません。
echo.
echo   フォルダ: %CD%
echo.
echo   dev.bat は souko プロジェクトの一番上のフォルダ、
echo   package.json と同じ階層に置いてください。
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
echo   よくある原因:
echo     - インターネットに接続できていない、またはプロキシ設定が必要
echo     - 社内ネットワークから npm レジストリに接続できない
echo     - node_modules が壊れている
echo       node_modules フォルダを削除してから、もう一度実行してください。
echo     - フォルダに書き込み権限が無い
echo.
echo   上に表示されている npm のエラーメッセージもご確認ください。
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b 1

:ERR_DEV
echo ------------------------------------------------------------
echo   [エラー] 開発サーバーを起動できませんでした。終了コード %DEV_EXIT%
echo.
echo   よくある原因:
echo     - ポート %WEB_PORT% または %API_PORT% が使用中
echo       stop.bat を実行してから、もう一度お試しください。
echo     - 依存パッケージが壊れている
echo       node_modules フォルダを削除して dev.bat を再実行してください。
echo     - TypeScript のコンパイルエラー
echo       上のログのエラー内容をご確認ください。check.bat でも確認できます。
echo ------------------------------------------------------------
popd
endlocal
pause
exit /b %DEV_EXIT%

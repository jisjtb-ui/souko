@echo off
chcp 65001 >nul
setlocal EnableExtensions
title souko 開発環境チェック

rem ============================================================
rem  現在のプロジェクトで実行できるチェックをまとめて実行します。
rem  ------------------------------------------------------------
rem  このプロジェクトには lint ツール (eslint など) が導入されていないため、
rem  lint は実行しません。存在しないツールを勝手に追加はしていません。
rem ============================================================

pushd "%~dp0"
if errorlevel 1 goto ERR_PUSHD

set "NG=0"

echo ============================================================
echo   souko 開発環境チェック
echo ============================================================
echo   フォルダ : %CD%
echo.

rem -------------------------------------------------- 実行環境
echo [1/6] 実行環境
where node >nul 2>&1
if errorlevel 1 goto ERR_NO_NODE
where npm >nul 2>&1
if errorlevel 1 goto ERR_NO_NPM
for /f "delims=" %%v in ('node -v') do echo       Node.js : %%v
for /f "delims=" %%v in ('npm -v') do echo       npm     : %%v
echo       必要要件: Node.js 22.5.0 以上
echo.

rem ------------------------------------------------ package.json
echo [2/6] package.json
if not exist "package.json" goto ERR_NO_PKG
echo       OK
echo.

rem ------------------------------------------------- 依存関係
echo [3/6] 依存関係
if not exist "node_modules\" (
  echo       node_modules がありません。dev.bat を実行すると自動でインストールされます。
  set "NG=1"
  goto AFTER_DEPS
)
call npm ls --depth 0
if errorlevel 1 (
  echo       依存関係に過不足がある可能性があります。npm install をお試しください。
  set "NG=1"
) else (
  echo       OK
)
:AFTER_DEPS
echo.

rem ------------------------------------------------- 型チェック
echo [4/6] TypeScript 型チェック (npm run typecheck)
call npm run typecheck
if errorlevel 1 (
  echo       [NG] 型エラーがあります。
  set "NG=1"
) else (
  echo       [OK] 型エラーはありません。
)
echo.

rem ----------------------------------------------------- テスト
echo [5/6] テスト (npm test)
call npm test
if errorlevel 1 (
  echo       [NG] 失敗したテストがあります。
  set "NG=1"
) else (
  echo       [OK] すべてのテストが通りました。
)
echo.

rem ----------------------------------------------------- ビルド
echo [6/6] 本番ビルド (npm run build)
call npm run build
if errorlevel 1 (
  echo       [NG] ビルドに失敗しました。
  set "NG=1"
) else (
  echo       [OK] ビルドできました。
)
echo.

echo ============================================================
if "%NG%"=="0" (
  echo   すべてのチェックが通りました。
) else (
  echo   問題が見つかりました。上のログをご確認ください。
)
echo ============================================================
echo.
echo   ※ lint は未導入のため実行していません。
echo.
popd
endlocal
pause
exit /b 0

:ERR_PUSHD
echo [エラー] プロジェクトフォルダへ移動できませんでした: %~dp0
endlocal
pause
exit /b 1

:ERR_NO_NODE
echo.
echo   [エラー] Node.js がインストールされていません。
echo            https://nodejs.org/ja/download からインストールしてください。
echo            必要バージョン: 22.5.0 以上 (推奨: 22 LTS もしくは 24 LTS)
popd
endlocal
pause
exit /b 1

:ERR_NO_NPM
echo.
echo   [エラー] npm が見つかりません。Node.js を入れ直してください。
popd
endlocal
pause
exit /b 1

:ERR_NO_PKG
echo.
echo   [エラー] package.json が見つかりません。
echo            check.bat は souko プロジェクトの一番上のフォルダに置いてください。
popd
endlocal
pause
exit /b 1

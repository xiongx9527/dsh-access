@echo off
setlocal
chcp 65001 >nul
rem dsh-access one-click installer for Windows.
rem Actual install logic lives in scripts\install.mjs.
rem Usage: double-click this file, or run it from a cmd window.
rem   - From a cloned repo:  install.bat
rem   - Standalone:          download install.bat and run it anywhere

if exist "scripts\install.mjs" goto run

where node >nul 2>nul || (
  echo [dsh-access] Node.js not found. Install Node.js 22.5+ first: https://nodejs.org/
  exit /b 1
)
where git >nul 2>nul || (
  echo [dsh-access] git not found. Install Git first: https://git-scm.com/download/win
  exit /b 1
)

set "DEST=%USERPROFILE%\dsh-access"
if defined DSH_PASSWORDS_DIR set "DEST=%DSH_PASSWORDS_DIR%"
if exist "%DEST%" (
  echo [dsh-access] Directory already exists: %DEST%
  echo [dsh-access] Reinstall: delete it first, but back up .env and data\ inside.
  exit /b 1
)
git clone --depth 1 https://github.com/slywalker2006/dsh-access.git "%DEST%"
if errorlevel 1 exit /b 1
cd /d "%DEST%"

:run
node scripts\install.mjs
exit /b %errorlevel%

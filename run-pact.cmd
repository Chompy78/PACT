@echo off
rem ============================================================================
rem  PACT - open the app in your browser (Windows).
rem
rem  Double-click this file in File Explorer. No terminal knowledge needed.
rem  It shows which branch you are on, lets you switch to another one, then
rem  starts the local server and opens the app.
rem
rem  WHY THIS EXISTS: a branch has no web address of its own - GitHub Pages only
rem  serves `main` - so unmerged work can only be looked at by running it
rem  locally. This wraps the fetch / checkout / serve steps so the sequencing
rem  lives here, where PowerShell's syntax rules cannot get in the way (Windows
rem  PowerShell 5.1 rejects `&&`, which is what trips people up doing it by hand).
rem ============================================================================

setlocal
cd /d "%~dp0"

echo.
echo   ============================================================
echo     PACT - open the app in your browser
echo   ============================================================
echo.

rem --- check the two things this needs are installed --------------------------
where git >nul 2>&1
if errorlevel 1 goto no_git
where node >nul 2>&1
if errorlevel 1 goto no_node

rem --- show where we are ------------------------------------------------------
for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "CURRENT=%%B"
echo   You are on branch:  %CURRENT%
echo.
echo   Press ENTER to open this branch as-is,
echo   or paste a branch name to switch to it first.
echo.

set "TARGET="
set /p "TARGET=  Branch name (or just press ENTER):  "

if "%TARGET%"=="" goto serve

rem --- switch branches --------------------------------------------------------
echo.
echo   Fetching %TARGET% ...
git fetch origin %TARGET%
if errorlevel 1 goto fetch_failed

echo   Switching to %TARGET% ...
git checkout %TARGET%
if errorlevel 1 goto checkout_failed

echo.
echo   Now on %TARGET%.

:serve
echo.
echo   Starting the app. Your browser should open in a moment.
echo   Leave this window open while you use it - closing it stops the app.
echo.
echo   When you are finished, come back here and press Ctrl+C, then run:
echo       git checkout preview
echo.
node testing\scripts\serve.mjs
goto end

rem --- problems, explained in full ------------------------------------------
:no_git
echo   PROBLEM: Windows cannot find Git.
echo.
echo   Install "Git for Windows" from https://git-scm.com/download/win
echo   then close this window and double-click this file again.
goto end

:no_node
echo   PROBLEM: Windows cannot find Node.
echo.
echo   Install Node.js from https://nodejs.org (choose the LTS button),
echo   then close this window and double-click this file again.
goto end

:fetch_failed
echo.
echo   PROBLEM: could not fetch a branch called "%TARGET%".
echo.
echo   Check the spelling - branch names are case-sensitive and usually look
echo   like  claude/get-ready-i52ojw  or  fix/some-thing.
goto end

:checkout_failed
echo.
echo   PROBLEM: could not switch to "%TARGET%".
echo.
echo   The usual cause is unsaved changes to files you are part-way through
echo   editing. Git will not switch branches while those would be lost.
echo   To see what is in the way, run:   git status
goto end

:end
echo.
pause
endlocal

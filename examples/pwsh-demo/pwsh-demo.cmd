@echo off
bun --cwd "%~dp0." src\main.ts %*
exit /b %errorlevel%

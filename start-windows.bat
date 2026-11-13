@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ist nicht installiert. Bitte Node.js 22.13 oder neuer von https://nodejs.org/ installieren.
  pause
  exit /b 1
)
echo Hauskosten-Manager wird gestartet ...
echo Nach dem Start im Browser http://127.0.0.1:4317 aufrufen.
echo Zum Beenden Strg+C druecken.
node server.js
pause

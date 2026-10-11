@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js fehlt. Bitte von https://nodejs.org installieren und danach nochmal starten. & pause & exit /b 1)
if not exist node_modules (echo Installiere Pakete ^(einmalig^) ... & call npm install --omit=dev)
node server.js
pause

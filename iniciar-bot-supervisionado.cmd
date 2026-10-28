@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if not exist "logs" mkdir "logs"

echo ============================================================
echo  eduardo_bot - 192.168.0.74:25567 - SUPERVISIONADO
echo  Log: %CD%\logs\bot-run.log
echo  Reinicia sozinho se o bot cair (10s..60s).
echo  Para encerrar: Ctrl+C
echo ============================================================
echo.

node iniciar-bot.js --supervise
set "CODE=%ERRORLEVEL%"

echo.
echo [iniciar-bot] Supervisor encerrado (codigo %CODE%).
pause

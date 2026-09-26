@echo off
rem Inicia o servidor pz-server (Forge 1.20.1) no Windows.
rem   start-server.bat              -> 4 GB de heap
rem   set MC_RAM=6G  (antes de rodar start-server.bat)
rem Variaveis: MC_RAM (padrao 4G), MC_MIN_RAM (1G), JAVA (java), BACKUP (1/0), BACKUP_KEEP (5)
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if not defined MC_RAM set MC_RAM=4G
if not defined MC_MIN_RAM set MC_MIN_RAM=1G
if not defined JAVA set JAVA=java
if not defined BACKUP set BACKUP=1
if not defined BACKUP_KEEP set BACKUP_KEEP=5
set FORGE=1.20.1-47.4.10
set ARGS=libraries\net\minecraftforge\forge\%FORGE%\win_args.txt

"%JAVA%" -version >nul 2>nul || (
  call :fail "Java nao encontrado. Instale o Java 17 (https://adoptium.net) ou defina JAVA=C:\caminho\bin\java.exe"
  exit /b 1
)
if not exist "%ARGS%" (
  call :fail "Forge %FORGE% nao instalado. Rode install-server.ps1 primeiro."
  exit /b 1
)
findstr /b "eula=true" eula.txt >nul 2>nul || (
  call :fail "EULA nao aceita. Rode: powershell -ExecutionPolicy Bypass -File install-server.ps1 -AcceptEula"
  exit /b 1
)

rem Backup do mundo antes de iniciar (tar vem no Windows 10+).
if "%BACKUP%"=="1" if exist world (
  if not exist backups mkdir backups
  for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set STAMP=%%t
  echo Backup do mundo em backups\world-!STAMP!.tar.gz...
  tar -czf "backups\world-!STAMP!.tar.gz" world || (
    call :fail "backup do mundo falhou (disco cheio?). Use set BACKUP=0 para pular."
    exit /b 1
  )
  powershell -NoProfile -Command "Get-ChildItem backups\world-*.tar.gz | Sort-Object LastWriteTime -Descending | Select-Object -Skip %BACKUP_KEEP% | Remove-Item"
)

echo Iniciando Forge %FORGE% com %MC_RAM% de RAM...
"%JAVA%" -Xms%MC_MIN_RAM% -Xmx%MC_RAM% -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:InitiatingHeapOccupancyPercent=15 @%ARGS% nogui %*
set CODE=%ERRORLEVEL%

if "%CODE%"=="0" goto :ok
echo.
echo ---- ultimas linhas de logs\latest.log ----
powershell -NoProfile -Command "if (Test-Path logs\latest.log) { Get-Content logs\latest.log -Tail 25 }"
powershell -NoProfile -Command "$c = Get-ChildItem crash-reports\*.txt -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($c) { 'Relatorio de crash mais recente: ' + $c.FullName }"
call :fail "o servidor terminou com codigo %CODE%. Veja TROUBLESHOOTING.md."
exit /b %CODE%

:ok
echo Servidor encerrado normalmente.
pause
exit /b 0

:fail
echo.
echo ================================================================
echo  ERRO: %~1
echo ================================================================
pause
exit /b 1

@echo off
setlocal
cd /d "%~dp0"
title MultiWhats - Gestor Multi-Cuenta

where node >nul 2>nul
if errorlevel 1 goto no_node

if not exist "%~dp0package.json" goto no_app

if exist "node_modules\electron\dist\electron.exe" goto launch

echo.
echo Instalando dependencias por primera vez... (puede tardar un poco)
echo.
call npm install
if errorlevel 1 goto fail_install

if not exist "node_modules\electron\dist\electron.exe" (
    echo Descargando Electron...
    node "node_modules\electron\install.js"
)
if errorlevel 1 goto fail_install
if not exist "node_modules\electron\dist\electron.exe" goto fail_install

:launch
echo.
echo Iniciando MultiWhats...
rem OJO: el path de la app NO debe terminar en barra invertida, o Windows
rem la interpreta como comilla escapada y Electron no encuentra la app.
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0

:no_node
echo.
echo [ERROR] No se encontro Node.js.
echo Descargalo gratis desde: https://nodejs.org  (version LTS)
echo.
pause
exit /b 1

:no_app
echo.
echo [ERROR] No se encontro el archivo del programa (package.json).
echo Asegurate de abrir "iniciar.bat" desde su propia carpeta.
echo.
pause
exit /b 1

:fail_install
echo.
echo [ERROR] Fallo la instalacion. Revisa tu conexion a internet e intenta de nuevo.
echo Si el problema continua, revisa el archivo de registro:
echo   %APPDATA%\multiwatts\startup.log
echo.
pause
exit /b 1

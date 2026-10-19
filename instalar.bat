@echo off
setlocal
cd /d "%~dp0"
title Instalando MultiWhats

where node >nul 2>nul
if errorlevel 1 goto no_node

echo Instalando dependencias de MultiWhats...
call npm install
if errorlevel 1 goto fail

if not exist "node_modules\electron\dist\electron.exe" (
    echo Descargando Electron...
    node "node_modules\electron\install.js"
)
if errorlevel 1 goto fail

echo.
echo Instalacion completada. Ahora abre "iniciar.bat" para usar la app.
pause
exit /b 0

:no_node
echo.
echo [ERROR] No se encontro Node.js.
echo Descargalo gratis desde: https://nodejs.org  (version LTS)
echo.
pause
exit /b 1

:fail
echo.
echo [ERROR] Fallo la instalacion. Revisa tu conexion a internet e intenta de nuevo.
echo.
pause
exit /b 1

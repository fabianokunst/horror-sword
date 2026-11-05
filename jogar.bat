@echo off
setlocal
title Horror Sword
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale em https://nodejs.org e rode este arquivo de novo.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\vite.cmd" (
  echo Instalando dependencias, so acontece na primeira vez...
  call npm install
  if errorlevel 1 (
    echo Falha ao instalar as dependencias.
    pause
    exit /b 1
  )
)

echo.
echo Iniciando Horror Sword... o navegador vai abrir sozinho.
echo Para encerrar o jogo, feche esta janela.
echo.
call npm run dev -- --open
pause

@echo off
title AeroPrint3D
cls
echo ==================================================
echo   AeroPrint3D - Sistema de Ordens de Servico
echo ==================================================
echo.
echo [1/2] Abrindo o sistema no seu navegador...
start http://localhost:8080
echo.
echo [2/2] Iniciando o servidor local...
node server.js

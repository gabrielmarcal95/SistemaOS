@echo off
title Encerrar AeroPrint3D
echo ==================================================
echo   Encerrando o Servidor AeroPrint3D...
echo ==================================================
echo.
taskkill /F /IM node.exe
echo.
echo Servidor encerrado com sucesso! O sistema foi parado.
pause

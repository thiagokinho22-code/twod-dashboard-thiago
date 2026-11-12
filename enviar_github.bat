@echo off
title Conectando TwoD Hub ao GitHub...
cd /d "%~dp0"
set "PATH=C:\Program Files\Git\cmd;%LOCALAPPDATA%\Programs\Git\cmd;%PATH%"
echo.
echo ========================================================
echo   TwoD Hub - Conexao com GitHub
echo ========================================================
echo.
echo Enviando o projeto para https://github.com/thiagokinho22-code/twod-dashboard-thiago ...
echo Uma janela do navegador pode se abrir para autorizar o acesso.
echo.
git push -u origin main
echo.
if %ERRORLEVEL% EQU 0 (
    echo ========================================================
    echo   SUCESSO! O projeto foi publicado no GitHub com exito!
    echo ========================================================
) else (
    echo Ocorreu um erro ou a autenticacao foi cancelada.
)
echo.
pause

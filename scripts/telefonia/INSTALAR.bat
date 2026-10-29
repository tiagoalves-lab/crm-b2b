@echo off
rem Dois cliques para instalar (ou reinstalar) a telefonia do CRM Gama.
rem Sem acento neste arquivo de proposito: o cmd le o arquivo como ANSI.
title Telefonia do CRM Gama
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0preparar-instalacao.ps1"
echo.
pause

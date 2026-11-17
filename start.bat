@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
echo =================================================
echo   Khoi dong Wedding Photo Curator (Local App)
echo   Truy cap trinh duyet: http://127.0.0.1:3001
echo   (Giu cua so nay mo trong khi su dung ung dung)
echo =================================================
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:3001"
"C:\Program Files\nodejs\node.exe" server/index.js
pause

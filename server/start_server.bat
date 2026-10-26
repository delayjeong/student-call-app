@echo off
setlocal
rem TEACHER_KEY, DEVICE_KEY 환경변수를 먼저 설정하세요 (각 12자 이상, 서로 다르게).
rem   set TEACHER_KEY=...
rem   set DEVICE_KEY=...
cd /d "%~dp0"
python app.py
pause

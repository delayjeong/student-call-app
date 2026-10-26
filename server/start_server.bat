@echo off
setlocal
if "%TEACHER_KEY%"=="" set TEACHER_KEY=change-teacher-key
if "%DEVICE_KEY%"=="" set DEVICE_KEY=change-device-key
python app.py
pause

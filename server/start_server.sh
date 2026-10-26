#!/usr/bin/env sh
: "${TEACHER_KEY:=change-teacher-key}"
: "${DEVICE_KEY:=change-device-key}"
export TEACHER_KEY DEVICE_KEY
exec python3 app.py

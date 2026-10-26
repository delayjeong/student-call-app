#!/usr/bin/env sh
# TEACHER_KEY, DEVICE_KEY 환경변수를 먼저 설정하세요 (각 12자 이상, 서로 다르게).
#   export TEACHER_KEY='...'
#   export DEVICE_KEY='...'
cd "$(dirname "$0")"
exec python3 app.py

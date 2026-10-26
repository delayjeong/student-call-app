# 학생 호출 시스템 v0.1

구성:
- `android/`: 전자칠판용 Android APK 소스 (Android 15 대응)
- `server/`: 교사용 웹 + 반별 SSE 호출 서버

## 동작
1. 각 전자칠판에 동일 APK를 설치합니다.
2. 최초 설정에서 서버 주소, 학년, 반, 수신기 키를 저장합니다.
3. `호출 수신 시작`을 누르고 `다른 앱 위에 표시` 권한을 허용합니다.
4. 교사용 웹에서 반/학생/호출 위치를 입력하고 호출합니다.
5. 대상 `classId`와 일치하는 전자칠판만 중앙 팝업을 10초간 표시합니다.

## 서버 실행
Python 3.11+ 및 `aiohttp` 필요.

```bash
cd server
export TEACHER_KEY='교사용-비밀키'
export DEVICE_KEY='전자칠판-수신키'
python app.py
```

Windows PowerShell:
```powershell
cd server
$env:TEACHER_KEY='교사용-비밀키'
$env:DEVICE_KEY='전자칠판-수신키'
python app.py
```

기본 포트: `8080`
교사용 웹: `http://서버IP:8080/`

## 프로토타입 네트워크 주의
APK는 학교 LAN 테스트를 위해 cleartext HTTP를 허용합니다. 실제 운영 배포에서는 HTTPS를 권장합니다.

## Android 설치 후 설정
- 서버 주소: 예) `http://192.168.1.10:8080`
- 학년/반: 예) `1`, `5`
- 수신기 키: 서버의 `DEVICE_KEY` 값
- 오버레이 권한 허용
- 알림 권한 허용(Android 13+)
- `호출 수신 시작`

## Android 15
수신기는 사용자 조작으로 시작되는 `remoteMessaging` foreground service로 동작하며 상시 알림을 표시합니다. 호출 팝업은 `TYPE_APPLICATION_OVERLAY`를 사용합니다.

## GitHub Actions로 APK 만들기
프로젝트를 GitHub 저장소에 올리면 `.github/workflows/build-apk.yml`이 Android SDK 35로 APK를 빌드합니다.
Actions → `Build Android APK` → Run workflow → Artifact에서 `StudentCallReceiver-v0.1-debug`를 받으면 됩니다.

## v0.1 보안 범위
- 교사용 호출: `TEACHER_KEY`
- 전자칠판 수신: `DEVICE_KEY`
- 반 격리: 호출의 `classId`와 수신기의 등록 반이 일치할 때만 표시
- 실제 운영: HTTPS, 충분히 긴 랜덤 키, 서버 접근 제한 권장

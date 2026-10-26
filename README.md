# 학생 호출 시스템

선생님이 휴대폰·PC에서 **학생 이름 + 호출 위치 + 반**을 입력하고 호출하면,
해당 반 전자칠판(Android)에 수업 화면 위로 팝업이 뜹니다.

```
🔔 학생 호출
김수학 선생님 호출
김민수 학생
교무실로 오세요
      [확인]
15초 후 자동으로 닫힙니다.
```

구성:
- `server/`: 교사용 웹 + 반별 실시간(SSE) 호출 서버 (Python, aiohttp)
- `android/`: 전자칠판용 수신 앱 (Android 8 ~ 15, Rockchip RK3588 전자칠판에서 사용 목적)

Firebase·Google 계정 없이 학교 안 서버 한 대로 동작합니다.

## 기능
**교사용 웹**
- 학년/반 선택, 학생 이름 입력, 위치 빠른 선택(교무실·행정실·상담실·보건실·과학실·기타 직접 입력)
- 선생님 이름·교사용 키는 브라우저에 저장 → 평소에는 학생 이름만 입력하고 호출
- 선택한 반의 전자칠판 연결 대수 표시
- 연속 전송 방지(3초 잠금)
- 최근 호출: 전자칠판 **표시 확인**(표시된 대수), **호출 취소**(1분 이내), **다시 표시**

**전자칠판 앱**
- 다른 앱(Flexcil, PDF 등) 위에 중앙 팝업, 알림음, [확인] 버튼, 15초 후 자동 닫힘
- 호출이 여러 건이면 대기열에 넣어 순서대로 표시
- 학년/반 드롭다운으로 한 번만 등록
- ☑ 전자칠판을 켜면 자동으로 수신 시작 (앱 업데이트 후에도 자동 재시작)
- ☑ 호출음 사용
- 연결이 끊기면 자동 재접속

## 서버 실행
Python 3.11+ 필요.

키는 **12자 이상**, 교사용 키와 수신기 키는 **서로 달라야** 합니다. 조건을 만족하지 않으면 서버가 시작되지 않습니다.
키 만들기: `python -c "import secrets; print(secrets.token_urlsafe(24))"`

```bash
cd server
pip install -r requirements.txt
export TEACHER_KEY='여기에-교사용-키'
export DEVICE_KEY='여기에-수신기-키'
python app.py
```

Windows (명령 프롬프트):
```bat
cd server
pip install -r requirements.txt
set TEACHER_KEY=여기에-교사용-키
set DEVICE_KEY=여기에-수신기-키
start_server.bat
```

Docker:
```bash
docker build -t student-call server
docker run -d --restart unless-stopped -p 8080:8080 -e TEACHER_KEY=... -e DEVICE_KEY=... student-call
```

선택 환경변수:
| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8080` | 포트 |
| `GRADES` | `3` | 교사용 웹의 학년 수 |
| `CLASSES` | `10` | 교사용 웹의 학년당 반 수 |

교사용 웹: `http://서버IP:8080/`

서버는 전자칠판과 선생님 기기가 모두 접속할 수 있는 학교 내부 PC에서 항상 켜 두세요. 서버 IP는 고정해 두는 것이 좋습니다.

## 전자칠판 설치
1. APK 설치 (아래 "APK 만들기" 참고)
2. 앱 실행 → 서버 주소(예: `http://192.168.1.10:8080`), 학년/반, 수신기 키(`DEVICE_KEY`) 입력
3. `1. 다른 앱 위에 표시 권한 허용`
   - 설정 화면이 열리지 않는 기기: 설정 → 앱 → 특별한 앱 액세스 → 다른 앱 위에 표시
   - 또는 관리자 PC에서 `adb shell appops set kr.school.studentcall SYSTEM_ALERT_WINDOW allow`
4. `2. 배터리 최적화 제외`
5. `3. 호출 수신 시작` → 알림 권한 허용
6. `테스트 팝업`으로 표시 확인, 교사용 웹에서 해당 반 연결 대수가 1대 이상인지 확인

상단 알림에 `2-3 연결됨 · 호출 대기 중`이 보이면 정상입니다. 이후에는 전자칠판을 껐다 켜도 자동으로 수신을 시작합니다.

## APK 만들기 (GitHub Actions)
Actions → `Build Android APK` → Run workflow → 완료 후 Artifacts에서 APK를 받습니다.

### 서명 키 등록 (한 번만, 꼭 하세요)
서명 키를 등록하지 않으면 debug APK가 만들어지는데, **빌드할 때마다 서명이 달라져서** 새 버전을 설치하려면 기존 앱을 지우고 설정을 다시 입력해야 합니다.

1. Java가 설치된 PC에서 키 만들기 (파일과 비밀번호는 안전하게 보관하세요. 잃어버리면 모든 전자칠판에서 앱을 다시 설치해야 합니다):
   ```bash
   keytool -genkeypair -v -keystore release.jks -alias studentcall -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 release.jks > release.jks.b64     # Windows PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes("release.jks")) > release.jks.b64
   ```
2. GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret:
   | 이름 | 값 |
   |---|---|
   | `SIGNING_KEYSTORE_BASE64` | `release.jks.b64` 파일 내용 |
   | `SIGNING_STORE_PASSWORD` | 키스토어 비밀번호 |
   | `SIGNING_KEY_ALIAS` | `studentcall` |
   | `SIGNING_KEY_PASSWORD` | 키 비밀번호 |
3. 이후 빌드부터 같은 키로 서명된 release APK가 만들어집니다. 버전 코드는 Actions 실행 번호로 자동 증가합니다.

`release.jks`는 절대 저장소에 커밋하지 마세요 (`.gitignore`에 포함되어 있음).

## API
모든 키는 HTTP 헤더로 전달합니다 (주소에 넣지 않으므로 서버 로그에 남지 않음).

| 메서드 | 경로 | 헤더 | 설명 |
|---|---|---|---|
| GET | `/api/health` | – | 상태, 전체 연결 수 |
| GET | `/api/config` | – | 학년·반 수 |
| GET | `/api/devices` | `X-Teacher-Key` | 반별 연결 대수 |
| POST | `/api/call` | `X-Teacher-Key` | `{classId:"2-3", teacher, student, location}` |
| POST | `/api/cancel` | `X-Teacher-Key` | `{id}` |
| GET | `/api/recent` | `X-Teacher-Key` | 최근 20건 (`shown`, `cancelled` 포함) |
| GET | `/api/stream?classId=2-3&deviceId=…` | `X-Device-Key` | 전자칠판 수신(SSE) |
| POST | `/api/ack` | `X-Device-Key` | `{id, deviceId}` 팝업 표시 확인 |

`classId`는 `학년-반` 숫자 형식(`2-3`)만 허용합니다.
`deviceId`(1~64자)는 `/api/stream`, `/api/ack`에서 필수입니다. 같은 `deviceId`로 다시 접속하면 이전 연결을 대체하고, 이전 연결에서 아직 보내지 못한 호출은 새 연결로 옮겨 보냅니다. 같은 IP에서 키가 5분 안에 10번 틀리면 잠시 차단됩니다.

## 테스트
```bash
cd server
python test_server.py
python test_routing.py
```

## 보안 범위와 한계
- 교사용 키 / 수신기 키 2개를 공유하는 구조입니다. 수신기 키를 아는 사람은 어느 반 호출이든 받아 볼 수 있으므로, 키를 학생에게 노출하지 마세요.
- 교사 이름은 직접 입력하는 값이라 본인 확인은 하지 않습니다.
- 수신기 키와 특정 전자칠판의 `deviceId`를 모두 아는 사람은 그 전자칠판의 연결을 대체할 수 있습니다. `deviceId`는 기기마다 무작위로 만들어지고 API로 공개되지 않습니다.
- 기본 설정은 학교 내부망용 HTTP입니다. 학생 이름이 오가므로 운영 시에는 HTTPS(예: Caddy 등 앞단 프록시)와 서버 접근 제한을 권장합니다.
- 호출 기록은 서버 메모리에만 있고, 서버를 다시 시작하면 사라집니다.

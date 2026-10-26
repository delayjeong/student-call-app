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

학교에 서버 PC를 켜 둘 필요 없이 **Google 스프레드시트 + Apps Script**로 동작합니다.

```
선생님 휴대폰·PC ── Apps Script 교사용 웹 ──▶ Google 스프레드시트 (호출 기록)
                                              ▲
전자칠판 APK ── 10초마다 "우리 반 새 호출 있나요?" ──┘  → 있으면 팝업
```

| 폴더 | 내용 |
|---|---|
| `apps-script/` | Apps Script 코드 (`Code.gs`, `Teacher.html`) — 스프레드시트에 붙여넣기 |
| `android/` | 전자칠판 수신 앱 (Android 8 ~ 15) |
| `legacy/python-server/` | 이전 방식(학교 PC에서 실행하는 Python 서버). 참고용, 현재 APK와는 호환되지 않음 |

**설치 방법은 [SETUP.md](SETUP.md)를 따라 하세요.**

## 기능
**교사용 웹 (Apps Script)**
- 학년/반 선택, 학생 이름, 위치 빠른 선택(교무실·행정실·상담실·보건실·과학실·기타 직접 입력)
- 선생님 이름·교사용 키는 브라우저에 저장 → 평소에는 학생 이름만 입력하고 호출
- 선택한 반에서 최근 확인한 전자칠판 대수 표시
- 연속 전송 방지(3초 잠금)
- 최근 호출: 전자칠판 **표시 확인**(표시된 대수), **호출 취소**(3분 이내), **다시 표시**
- 운영 시간 밖에는 호출 버튼이 잠김

**전자칠판 앱**
- 다른 앱(Flexcil, PDF 등) 위에 중앙 팝업, 알림음, [확인] 버튼, 15초 후 자동 닫힘
- '다른 앱 위에 표시' 권한을 받지 못한 기기에서는 화면 위쪽 중요 알림으로 표시 (화면이 꺼져 있거나 잠겨 있으면 전체 화면 호출)
- 호출이 여러 건이면 순서대로 표시
- 학년/반 드롭다운으로 한 번만 등록
- 전자칠판을 켜면 자동으로 수신 시작, 호출음 켜기/끄기
- **운영 시간(기본 08:00~22:00, 한국 시간)에만 확인** — 밖에서는 Google에 요청하지 않음

**스프레드시트**
- `호출기록` 시트에 모든 호출이 남음 (번호, 시각, 반, 선생님, 학생, 위치, 상태, 표시 대수)
- 보관 기간(기본 7일)이 지난 기록은 매일 새벽 3시에 자동 삭제

## 설정 바꾸기
Apps Script 편집기 → 프로젝트 설정(⚙) → **스크립트 속성**에서 바꾼 뒤, 스프레드시트 메뉴 **학생 호출 → 설정 변경 반영**을 누르세요.
전자칠판은 다음 확인 때 새 값을 받으므로 APK를 다시 설치할 필요가 없습니다.

| 속성 | 기본값 | 설명 |
|---|---|---|
| `ACTIVE_HOURS` | `08:00-22:00` | 운영 시간 (한국 시간). 밖에서는 호출 불가, 전자칠판도 확인하지 않음 |
| `POLL_SECONDS` | `10` | 전자칠판 확인 간격(초, 3~60). 줄이면 빨라지지만 요청이 늘어남 |
| `GRADES` / `CLASSES` | `3` / `10` | 교사용 웹의 학년 수 / 학년당 반 수 |
| `LOCATIONS` | `교무실,행정실,상담실,보건실,과학실` | 위치 빠른 선택 버튼 (쉼표로 구분) |
| `KEEP_DAYS` | `7` | 호출 기록 보관 일수 |
| `TEACHER_KEY` / `DEVICE_KEY` | (자동 생성) | 메뉴 **키 새로 만들기**로 바꾸세요 |

## 동작 방식과 한계
- **지연**: 호출 후 전자칠판 표시까지 보통 수 초, 가장 늦으면 확인 간격 + 2~3초(기본 약 13초).
- **요청량**: 전자칠판 1대가 운영 시간 14시간 동안 10초마다 확인하면 하루 약 5,000회입니다.
  확인 요청은 Apps Script 캐시만 읽도록 만들어, 무료 Gmail 계정의 "속성 읽기/쓰기 하루 5만 회" 제한에 걸리지 않습니다.
  Google은 웹앱 요청 수의 하루 상한을 공개하지 않으므로, 처음에는 몇 반에서 시험한 뒤 늘리세요.
  Apps Script 편집기의 **실행** 메뉴에서 오류가 늘어나는지 확인할 수 있습니다.
- 운영 시간 밖, 또는 전자칠판이 꺼져 있던 동안 보낸 호출은 표시되지 않습니다. 3분이 지난 호출도 표시하지 않습니다.
- **보안**: 교사용 키 / 수신기 키 두 개를 공유하는 구조입니다. 웹앱 주소와 교사용 키를 학생에게 노출하지 마세요.
  교사 이름은 직접 입력하는 값이라 본인 확인은 하지 않습니다.
- **개인정보**: 학생 이름이 Google 스프레드시트에 저장됩니다. 스프레드시트의 링크 공유를 끄고, 관리자만 접근하게 하세요.

## APK 받기
`main`에 코드가 올라가면 서명된 APK가 자동으로 만들어져 **[Releases](https://github.com/delayjeong/student-call-app/releases)**에 올라갑니다.
가장 위(Latest)의 `StudentCallReceiver-번호.apk`를 받아 전자칠판에 설치하세요.

- 예전 PC 서버 방식 앱(build-13 이하)을 덮어 설치하면, 처음 실행할 때 예전 서버 주소와 수신기 키가 자동으로 지워지고
  "새 방식으로 바뀌었습니다" 안내가 나옵니다. 웹앱 주소와 새 수신기 키를 입력한 뒤 **호출 수신 시작**을 누르세요. 학년/반은 그대로 남습니다.
- 웹앱 주소는 `https://script.google.com/macros/s/…/exec` 형식만 입력할 수 있습니다.

## APK 만들기 (GitHub Actions)
Actions → `Build Android APK` → Run workflow → 완료 후 Artifacts에서 APK를 받습니다.

### 서명 키 등록 (한 번만, 꼭 하세요)
서명 키를 등록하지 않으면 debug APK가 만들어지는데, **빌드할 때마다 서명이 달라져서** 새 버전을 설치하려면 기존 앱을 지우고 설정을 다시 입력해야 합니다.

1. Java(JDK)가 설치된 PC에서 키 만들기 (파일과 비밀번호는 안전하게 보관하세요. 잃어버리면 모든 전자칠판에서 앱을 다시 설치해야 합니다):
   ```bash
   keytool -genkeypair -v -keystore release.jks -alias studentcall -keyalg RSA -keysize 2048 -validity 10000
   ```
   비밀번호는 한 번만 묻습니다 (키 비밀번호도 같은 값이 됩니다).
2. 키 파일을 글자(base64)로 바꿔 복사:
   ```powershell
   # Windows PowerShell — 클립보드로 바로 복사 (파일로 저장하면 UTF-16이 되어 빌드가 실패하므로 '>' 사용 금지)
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\release.jks")) | Set-Clipboard
   ```
   ```bash
   # macOS / Linux
   base64 < release.jks | tr -d '\n'
   ```
3. GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret:
   | 이름 | 값 |
   |---|---|
   | `SIGNING_KEYSTORE_BASE64` | 2단계에서 복사한 글자 전체 |
   | `SIGNING_STORE_PASSWORD` | 키를 만들 때 정한 비밀번호 |
   | `SIGNING_KEY_ALIAS` | `studentcall` |
   | `SIGNING_KEY_PASSWORD` | 위와 같은 비밀번호 |
4. 이후 빌드부터 같은 키로 서명된 release APK가 만들어집니다. 버전 코드는 Actions 실행 번호로 자동 증가합니다.

`release.jks`는 절대 저장소에 커밋하지 마세요 (`.gitignore`에 포함되어 있음).

## 전자칠판 확인 API
`GET <웹앱 주소>?action=poll&classId=2-3&deviceId=<기기ID>&key=<수신기 키>&after=<마지막 번호>&acked=<표시한 번호들>`

- `after`가 비어 있으면 지난 호출 없이 기준 번호(`lastId`)만 돌려줍니다 (앱 시작 / 운영 시간 시작).
- `acked`: 직전 확인 이후 팝업을 표시한 호출 번호 (쉼표 구분). 교사 화면의 "표시 N대"가 됩니다.
- 응답: `{ok, lastId, pollSeconds, activeStart, activeEnd, calls:[{id, classId, teacher, student, location, sentAt}], cancelled:[id…]}`

## 테스트
```bash
node apps-script/test/test.js            # Apps Script 로직 (Google 서비스 모형 위에서 실행)
cd apps-script && node test/teacher-page.js   # 교사용 화면을 브라우저로 검사 (Playwright 필요)
gradle -p android :app:testDebugUnitTest      # 운영 시간 계산
```

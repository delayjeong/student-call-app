import asyncio
import hmac
import json
import os
import re
import sys
import time
import uuid
from collections import OrderedDict, defaultdict, deque
from pathlib import Path

from aiohttp import web

BASE = Path(__file__).parent
TEACHER_KEY = os.environ.get("TEACHER_KEY", "")
DEVICE_KEY = os.environ.get("DEVICE_KEY", "")
PORT = int(os.environ.get("PORT", "8080"))
GRADES = int(os.environ.get("GRADES", "3"))
CLASSES = int(os.environ.get("CLASSES", "10"))
MIN_KEY_LENGTH = 12

# 인증 실패 제한: IP당 FAIL_WINDOW초 안에 FAIL_LIMIT회 실패하면 차단
FAIL_LIMIT = 10
FAIL_WINDOW = 300

CLASS_ID_RE = re.compile(r"^[1-9][0-9]?-[1-9][0-9]?$")

# classId -> set(asyncio.Queue)
subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
recent_calls = deque(maxlen=100)
# callId -> 팝업을 표시한 deviceId 집합 (오래된 것부터 정리)
acks: "OrderedDict[str, set[str]]" = OrderedDict()
failed_auth: dict[str, deque] = defaultdict(deque)


def json_error(message: str, status: int = 400):
    return web.json_response({"ok": False, "error": message}, status=status)


def key_problem(name: str, value: str) -> str | None:
    if not value or value.startswith("change-"):
        return f"{name} 환경변수를 설정해 주세요."
    if len(value) < MIN_KEY_LENGTH:
        return f"{name}는 {MIN_KEY_LENGTH}자 이상이어야 합니다."
    return None


def normalize_class_id(raw: str) -> str | None:
    raw = (raw or "").strip()
    if not CLASS_ID_RE.match(raw):
        return None
    return raw


def client_ip(request: web.Request) -> str:
    return request.remote or "unknown"


def is_blocked(request: web.Request) -> bool:
    q = failed_auth.get(client_ip(request))
    if not q:
        return False
    now = time.monotonic()
    while q and now - q[0] > FAIL_WINDOW:
        q.popleft()
    return len(q) >= FAIL_LIMIT


def check_key(request: web.Request, header: str, expected: str) -> web.Response | None:
    """키가 맞으면 None, 틀리면 오류 응답을 돌려준다."""
    if is_blocked(request):
        return json_error("too many failed attempts", 429)
    given = request.headers.get(header, "")
    if expected and hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8")):
        return None
    failed_auth[client_ip(request)].append(time.monotonic())
    return json_error("invalid key", 401)


async def index(request: web.Request):
    return web.FileResponse(BASE / "static" / "index.html")


async def health(request: web.Request):
    return web.json_response({
        "ok": True,
        "service": "student-call-server",
        "time": int(time.time()),
        "connectedDevices": sum(len(v) for v in subscribers.values()),
    })


async def config(request: web.Request):
    return web.json_response({"ok": True, "grades": GRADES, "classes": CLASSES})


async def devices(request: web.Request):
    if (err := check_key(request, "X-Teacher-Key", TEACHER_KEY)):
        return err
    return web.json_response({
        "ok": True,
        "connectedClasses": {k: len(v) for k, v in subscribers.items() if v},
    })


async def stream(request: web.Request):
    if (err := check_key(request, "X-Device-Key", DEVICE_KEY)):
        return err
    class_id = normalize_class_id(request.query.get("classId", ""))
    device_id = (request.query.get("deviceId") or "unknown").strip()[:64]
    if not class_id:
        return json_error("classId must look like '1-5'")

    q: asyncio.Queue = asyncio.Queue(maxsize=20)
    subscribers[class_id].add(q)

    response = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
    try:
        await response.prepare(request)
        hello = {"type": "connected", "classId": class_id, "deviceId": device_id}
        await response.write(f"data: {json.dumps(hello, ensure_ascii=False)}\n\n".encode("utf-8"))
        while True:
            try:
                item = await asyncio.wait_for(q.get(), timeout=20)
                payload = json.dumps(item, ensure_ascii=False)
                await response.write(f"data: {payload}\n\n".encode("utf-8"))
            except asyncio.TimeoutError:
                await response.write(b": keepalive\n\n")
    except (ConnectionResetError, asyncio.CancelledError, BrokenPipeError):
        pass
    finally:
        subscribers[class_id].discard(q)
        if not subscribers[class_id]:
            subscribers.pop(class_id, None)
    return response


async def call_student(request: web.Request):
    if (err := check_key(request, "X-Teacher-Key", TEACHER_KEY)):
        return err
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON")

    class_id = normalize_class_id(str(body.get("classId", "")))
    teacher = str(body.get("teacher", "")).strip()
    student = str(body.get("student", "")).strip()
    location = str(body.get("location", "")).strip()

    if not class_id:
        return json_error("classId must look like '1-5'")
    if not all([teacher, student, location]):
        return json_error("teacher, student, location are required")
    if len(teacher) > 30 or len(student) > 30 or len(location) > 40:
        return json_error("input too long")

    message = {
        "type": "call",
        "id": str(uuid.uuid4()),
        "classId": class_id,
        "teacher": teacher,
        "student": student,
        "location": location,
        "sentAt": int(time.time() * 1000),
    }
    recent_calls.appendleft(message)
    acks[message["id"]] = set()
    while len(acks) > recent_calls.maxlen:
        acks.popitem(last=False)

    delivered = broadcast(class_id, message)
    return web.json_response({"ok": True, "delivered": delivered, "message": message})


def broadcast(class_id: str, message: dict) -> int:
    delivered = 0
    for q in list(subscribers.get(class_id, set())):
        try:
            q.put_nowait(message)
            delivered += 1
        except asyncio.QueueFull:
            pass
    return delivered


async def cancel_call(request: web.Request):
    if (err := check_key(request, "X-Teacher-Key", TEACHER_KEY)):
        return err
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON")
    call_id = str(body.get("id", ""))
    target = next((m for m in recent_calls if m["id"] == call_id), None)
    if target is None:
        return json_error("unknown call id", 404)
    target["cancelled"] = True
    broadcast(target["classId"], {"type": "cancel", "id": call_id, "classId": target["classId"]})
    return web.json_response({"ok": True})


async def ack(request: web.Request):
    if (err := check_key(request, "X-Device-Key", DEVICE_KEY)):
        return err
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON")
    call_id = str(body.get("id", ""))
    device_id = str(body.get("deviceId", "unknown"))[:64]
    if call_id not in acks:
        return json_error("unknown call id", 404)
    acks[call_id].add(device_id)
    return web.json_response({"ok": True})


async def recent(request: web.Request):
    if (err := check_key(request, "X-Teacher-Key", TEACHER_KEY)):
        return err
    items = [dict(m, shown=len(acks.get(m["id"], ()))) for m in list(recent_calls)[:20]]
    return web.json_response({"ok": True, "items": items})


app = web.Application(client_max_size=64 * 1024)
app.router.add_get("/", index)
app.router.add_get("/api/health", health)
app.router.add_get("/api/config", config)
app.router.add_get("/api/devices", devices)
app.router.add_get("/api/stream", stream)
app.router.add_post("/api/call", call_student)
app.router.add_post("/api/cancel", cancel_call)
app.router.add_post("/api/ack", ack)
app.router.add_get("/api/recent", recent)
app.router.add_static("/static/", BASE / "static")

if __name__ == "__main__":
    problems = [p for p in (key_problem("TEACHER_KEY", TEACHER_KEY), key_problem("DEVICE_KEY", DEVICE_KEY)) if p]
    if TEACHER_KEY and TEACHER_KEY == DEVICE_KEY:
        problems.append("TEACHER_KEY와 DEVICE_KEY는 서로 달라야 합니다.")
    if problems:
        for p in problems:
            print("ERROR:", p, file=sys.stderr)
        print("예) python -c \"import secrets; print(secrets.token_urlsafe(24))\" 로 키를 만드세요.", file=sys.stderr)
        sys.exit(1)
    print(f"Student Call Server listening on 0.0.0.0:{PORT}")
    web.run_app(app, host="0.0.0.0", port=PORT, access_log_format='%a %t "%r" %s %b')

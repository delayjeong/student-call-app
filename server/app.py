import asyncio
import json
import os
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path

from aiohttp import web

BASE = Path(__file__).parent
TEACHER_KEY = os.environ.get("TEACHER_KEY", "change-teacher-key")
DEVICE_KEY = os.environ.get("DEVICE_KEY", "change-device-key")
PORT = int(os.environ.get("PORT", "8080"))

# classId -> set(asyncio.Queue)
subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
recent_calls = deque(maxlen=100)


def json_error(message: str, status: int = 400):
    return web.json_response({"ok": False, "error": message}, status=status)


async def index(request: web.Request):
    return web.FileResponse(BASE / "static" / "index.html")


async def health(request: web.Request):
    return web.json_response({
        "ok": True,
        "service": "student-call-server",
        "time": int(time.time()),
        "connectedClasses": {k: len(v) for k, v in subscribers.items() if v},
    })


async def stream(request: web.Request):
    class_id = (request.query.get("classId") or "").strip()
    key = request.query.get("key") or ""
    device_id = (request.query.get("deviceId") or "unknown").strip()

    if not class_id:
        return json_error("classId is required")
    if key != DEVICE_KEY:
        return json_error("invalid device key", 401)

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
    await response.prepare(request)

    try:
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
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON")

    teacher_key = str(body.get("teacherKey", ""))
    if teacher_key != TEACHER_KEY:
        return json_error("invalid teacher key", 401)

    class_id = str(body.get("classId", "")).strip()
    teacher = str(body.get("teacher", "")).strip()
    student = str(body.get("student", "")).strip()
    location = str(body.get("location", "")).strip()

    if not all([class_id, teacher, student, location]):
        return json_error("classId, teacher, student, location are required")
    if len(teacher) > 30 or len(student) > 30 or len(location) > 40 or len(class_id) > 20:
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

    delivered = 0
    for q in list(subscribers.get(class_id, set())):
        try:
            q.put_nowait(message)
            delivered += 1
        except asyncio.QueueFull:
            pass

    return web.json_response({"ok": True, "delivered": delivered, "message": message})


async def recent(request: web.Request):
    key = request.query.get("teacherKey") or ""
    if key != TEACHER_KEY:
        return json_error("invalid teacher key", 401)
    return web.json_response({"ok": True, "items": list(recent_calls)[:20]})


app = web.Application(client_max_size=64 * 1024)
app.router.add_get("/", index)
app.router.add_get("/api/health", health)
app.router.add_get("/api/stream", stream)
app.router.add_post("/api/call", call_student)
app.router.add_get("/api/recent", recent)
app.router.add_static("/static/", BASE / "static")

if __name__ == "__main__":
    print(f"Student Call Server listening on 0.0.0.0:{PORT}")
    if TEACHER_KEY.startswith("change-") or DEVICE_KEY.startswith("change-"):
        print("WARNING: change TEACHER_KEY and DEVICE_KEY before real use")
    web.run_app(app, host="0.0.0.0", port=PORT, access_log_format='%a %t "%r" %s %b')

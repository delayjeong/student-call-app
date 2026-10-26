import asyncio
import json
import os
import subprocess
import sys

os.environ["TEACHER_KEY"] = "test-teacher-key"
os.environ["DEVICE_KEY"] = "test-device-key"

from aiohttp.test_utils import TestClient, TestServer
import app as student_app

T = {"X-Teacher-Key": "test-teacher-key"}
D = {"X-Device-Key": "test-device-key"}
CALL = {"classId": "1-5", "teacher": "김수학", "student": "김민수", "location": "교무실"}


async def read_data(resp):
    while True:
        line = await asyncio.wait_for(resp.content.readline(), 2)
        if not line:
            raise RuntimeError("stream ended")
        s = line.decode("utf-8").strip()
        if s.startswith("data: "):
            return json.loads(s[6:])


async def main():
    client = TestClient(TestServer(student_app.app))
    await client.start_server()
    try:
        h = await client.get("/api/health")
        assert h.status == 200 and (await h.json())["ok"]

        c = await (await client.get("/api/config")).json()
        assert c["grades"] == 3 and c["classes"] == 10

        # 키는 헤더로만 받는다
        assert (await client.post("/api/call", json=CALL)).status == 401
        assert (await client.post("/api/call", json=dict(CALL, teacherKey="test-teacher-key"))).status == 401
        assert (await client.get("/api/stream?classId=1-5&key=test-device-key")).status == 401
        # 교사 키로 수신 불가, 수신기 키로 호출 불가
        assert (await client.get("/api/stream?classId=1-5", headers={"X-Device-Key": "test-teacher-key"})).status == 401
        assert (await client.post("/api/call", json=CALL, headers={"X-Teacher-Key": "test-device-key"})).status == 401

        # classId 형식 검증
        for bad in ["05-1", "1반", "1-0", "", "1-5-1"]:
            r = await client.post("/api/call", json=dict(CALL, classId=bad), headers=T)
            assert r.status == 400, bad
        assert (await client.get("/api/stream?classId=01-5", headers=D)).status == 400

        # 호출 → 수신 → 표시 확인(ack) → 최근 기록에 반영
        s = await client.get("/api/stream?classId=1-5&deviceId=board-a", headers=D)
        assert (await read_data(s))["type"] == "connected"
        dev = await (await client.get("/api/devices", headers=T)).json()
        assert dev["connectedClasses"] == {"1-5": 1}

        good = await client.post("/api/call", json=CALL, headers=T)
        data = await good.json()
        assert good.status == 200 and data["delivered"] == 1
        msg = await read_data(s)
        assert msg["id"] == data["message"]["id"]

        assert (await client.post("/api/ack", json={"id": msg["id"], "deviceId": "board-a"})).status == 401
        assert (await client.post("/api/ack", json={"id": "nope", "deviceId": "board-a"}, headers=D)).status == 404
        assert (await client.post("/api/ack", json={"id": msg["id"], "deviceId": "board-a"}, headers=D)).status == 200
        items = (await (await client.get("/api/recent", headers=T)).json())["items"]
        assert items[0]["id"] == msg["id"] and items[0]["shown"] == 1

        # 호출 취소 → 같은 반 전자칠판에 cancel 전달
        assert (await client.post("/api/cancel", json={"id": msg["id"]})).status == 401
        assert (await client.post("/api/cancel", json={"id": "nope"}, headers=T)).status == 404
        assert (await client.post("/api/cancel", json={"id": msg["id"]}, headers=T)).status == 200
        cancel = await read_data(s)
        assert cancel == {"type": "cancel", "id": msg["id"], "classId": "1-5"}
        items = (await (await client.get("/api/recent", headers=T)).json())["items"]
        assert items[0]["cancelled"] is True
        s.close()

        # 인증 실패 반복 시 차단
        for _ in range(student_app.FAIL_LIMIT):
            await client.get("/api/recent", headers={"X-Teacher-Key": "wrong"})
        assert (await client.get("/api/recent", headers=T)).status == 429
        student_app.failed_auth.clear()
        assert (await client.get("/api/recent", headers=T)).status == 200
        print("SERVER TEST PASS")
    finally:
        await client.close()


def test_refuses_weak_keys():
    here = os.path.dirname(os.path.abspath(__file__))
    for teacher, device in [("", "x" * 12), ("change-teacher-key", "x" * 12), ("short", "y" * 12), ("z" * 12, "z" * 12)]:
        env = dict(os.environ, TEACHER_KEY=teacher, DEVICE_KEY=device, PORT="0")
        r = subprocess.run([sys.executable, "app.py"], cwd=here, env=env, capture_output=True, timeout=10)
        assert r.returncode == 1, (teacher, device, r)
    print("KEY CHECK TEST PASS")


asyncio.run(main())
test_refuses_weak_keys()

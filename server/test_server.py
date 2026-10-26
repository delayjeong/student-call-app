import asyncio
import json
import os
from aiohttp.test_utils import TestClient, TestServer

os.environ.setdefault("TEACHER_KEY", "test-teacher")
os.environ.setdefault("DEVICE_KEY", "test-device")
import app as student_app

async def main():
    server = TestServer(student_app.app)
    client = TestClient(server)
    await client.start_server()
    try:
        h = await client.get('/api/health')
        assert h.status == 200 and (await h.json())['ok']
        bad = await client.post('/api/call', json={'teacherKey':'bad','classId':'1-5','teacher':'김수학','student':'김민수','location':'교무실'})
        assert bad.status == 401
        good = await client.post('/api/call', json={'teacherKey':'test-teacher','classId':'1-5','teacher':'김수학','student':'김민수','location':'교무실'})
        data = await good.json()
        assert good.status == 200 and data['ok'] and data['message']['classId']=='1-5'
        print('SERVER TEST PASS')
    finally:
        await client.close()

asyncio.run(main())

import asyncio
import os

os.environ['TEACHER_KEY']='test-teacher-key'
os.environ['DEVICE_KEY']='test-device-key'

from aiohttp.test_utils import TestClient, TestServer
import app as student_app

T={'X-Teacher-Key':'test-teacher-key'}
D={'X-Device-Key':'test-device-key'}

async def read_data(resp):
    while True:
        line = await asyncio.wait_for(resp.content.readline(), 2)
        if not line:
            raise RuntimeError('stream ended')
        s=line.decode('utf-8').strip()
        if s.startswith('data: '):
            import json
            return json.loads(s[6:])

async def wait_eof(resp):
    """SSE 이벤트 뒤의 빈 줄은 건너뛰고 실제 스트림 종료(EOF)를 기다린다."""
    while True:
        line=await asyncio.wait_for(resp.content.readline(),2)
        if line==b'':
            return

async def main():
    server=TestServer(student_app.app)
    client=TestClient(server)
    await client.start_server()
    try:
        # 기본 반 격리: 1-5 호출은 1-5만 받아야 한다.
        s15=await client.get('/api/stream?classId=1-5&deviceId=a',headers=D)
        s14=await client.get('/api/stream?classId=1-4&deviceId=b',headers=D)
        assert (await read_data(s15))['type']=='connected'
        assert (await read_data(s14))['type']=='connected'

        r=await client.post('/api/call',json={
            'classId':'1-5','teacher':'김수학','student':'김민수','location':'교무실'
        },headers=T)
        j=await r.json()
        assert j['delivered']==1, j
        m15=await read_data(s15)
        assert m15['type']=='call' and m15['classId']=='1-5' and m15['student']=='김민수'
        try:
            await asyncio.wait_for(read_data(s14), .35)
            raise AssertionError('1-4 received a 1-5 call')
        except asyncio.TimeoutError:
            pass
        print('ROUTING TEST PASS: 1-5 only')
        s15.close(); s14.close()

        # 같은 전자칠판이 네트워크 재연결 등으로 다시 접속해도 서버에는 1대로만
        # 등록되고 이후 호출 역시 한 번만 전달되어야 한다.
        old=await client.get('/api/stream?classId=2-3&deviceId=board-x',headers=D)
        assert (await read_data(old))['type']=='connected'
        new=await client.get('/api/stream?classId=2-3&deviceId=board-x',headers=D)
        assert (await read_data(new))['type']=='connected'

        devices=await (await client.get('/api/devices',headers=T)).json()
        assert devices['connectedClasses'].get('2-3')==1, devices

        r=await client.post('/api/call',json={
            'classId':'2-3','teacher':'김과학','student':'박학생','location':'상담실'
        },headers=T)
        j=await r.json()
        assert j['delivered']==1, j
        msg=await read_data(new)
        assert msg['type']=='call' and msg['student']=='박학생'

        # 대체된 이전 스트림은 sentinel을 받고 닫혀야 한다.
        await wait_eof(old)
        print('RECONNECT TEST PASS: duplicate device replaced')
        old.close(); new.close()
    finally:
        await client.close()

asyncio.run(main())

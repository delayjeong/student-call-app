import asyncio
import os

os.environ['TEACHER_KEY']='test-teacher-key'
os.environ['DEVICE_KEY']='test-device-key'

from aiohttp.test_utils import TestClient, TestServer
import app as student_app

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

async def main():
    server=TestServer(student_app.app)
    client=TestClient(server)
    await client.start_server()
    try:
        s15=await client.get('/api/stream?classId=1-5&deviceId=a',headers=D)
        s14=await client.get('/api/stream?classId=1-4&deviceId=b',headers=D)
        assert (await read_data(s15))['type']=='connected'
        assert (await read_data(s14))['type']=='connected'

        r=await client.post('/api/call',json={
            'classId':'1-5','teacher':'김수학','student':'김민수','location':'교무실'
        },headers={'X-Teacher-Key':'test-teacher-key'})
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
    finally:
        await client.close()

asyncio.run(main())

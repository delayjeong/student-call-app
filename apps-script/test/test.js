const assert = require('assert');
const { load, kst } = require('./gas-mock');

const { gas, state } = load();
const poll = q => JSON.parse(gas.doGet({ parameter: Object.assign({ action: 'poll' }, q) }).content);
const plain = x => JSON.parse(JSON.stringify(x));

// 초기 설정
gas.setup();
const T = state.props.TEACHER_KEY, D = state.props.DEVICE_KEY;
assert.ok(T && D && T !== D && T.length >= 32);
assert.deepStrictEqual(plain(state.triggers), ['cleanupOldRows']);
gas.setup();
assert.strictEqual(state.props.TEACHER_KEY, T);
assert.deepStrictEqual(plain(state.triggers), ['cleanupOldRows']);
const sheet = state.sheets['호출기록'];
assert.strictEqual(sheet.rows[0][0], '번호');
assert.deepStrictEqual(sheet.rows[0].slice(8, 10), ['유형', '전달사항']);
assert.deepStrictEqual(plain(gas.getConfig().classCounts), [5, 5, 4]);

// 교사용 웹 / 잘못된 요청
assert.strictEqual(gas.doGet({ parameter: {} }).file, 'Teacher');
assert.strictEqual(JSON.parse(gas.doGet({ parameter: { action: 'x' } }).content).error, 'unknown action');
assert.strictEqual(poll({ key: 'wrong', classId: '1-5', deviceId: 'a' }).error, 'invalid key');
assert.strictEqual(poll({ key: D, classId: '01-5', deviceId: 'a' }).ok, false);
assert.strictEqual(poll({ key: D, classId: '3-5', deviceId: 'a' }).ok, false, '3학년은 4반까지만 허용');
assert.strictEqual(poll({ key: D, classId: '1-5', deviceId: '' }).ok, false);
assert.strictEqual(poll({ key: D, classId: '1-5', deviceId: 'x'.repeat(65) }).ok, false);
assert.throws(() => gas.callStudent('wrong', { classId: '1-5', teacher: 'a', student: 'b', location: 'c' }), /교사용 키/);
assert.throws(() => gas.callStudent(D, { classId: '1-5', teacher: 'a', student: 'b', location: 'c' }), /교사용 키/);
assert.throws(() => gas.callStudent(T, { classId: '1반', teacher: 'a', student: 'b', location: 'c' }), /반 선택/);
assert.throws(() => gas.callStudent(T, { classId: '1-5', teacher: '', student: 'b', location: 'c' }), /모두 입력/);
assert.throws(() => gas.callStudent(T, { classId: '1-5', teacher: 'a', student: 'b'.repeat(31), location: 'c' }), /너무 깁니다/);
assert.throws(() => gas.sendNotice(T, { target: '4-*', teacher: 'a', message: 'b' }), /전달 대상/);
assert.throws(() => gas.sendNotice(T, { target: '1-*', teacher: 'a', message: '' }), /전달사항/);

// 앱 시작 직후: 기준 번호만 받는다
let r = poll({ key: D, classId: '1-5', deviceId: 'board-15' });
assert.deepStrictEqual([r.ok, r.lastId, r.calls.length, r.pollSeconds, r.activeStart, r.activeEnd], [true, 0, 0, 10, '08:00', '22:00']);
poll({ key: D, classId: '1-4', deviceId: 'board-14' });

// 호출 → 해당 반만 받는다
const c1 = gas.callStudent(T, { classId: '1-5', teacher: '김수학', student: '김민수', location: '교무실' });
assert.deepStrictEqual(plain(c1), { id: 1, onlineDevices: 1 });
r = poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '0' });
assert.strictEqual(r.calls.length, 1);
assert.deepStrictEqual(Object.keys(r.calls[0]).sort(), ['classId', 'id', 'location', 'message', 'sentAt', 'student', 'teacher', 'type']);
assert.strictEqual(r.calls[0].type, 'call');
assert.strictEqual(r.calls[0].message, '');
assert.strictEqual(r.calls[0].student, '김민수');
assert.strictEqual(poll({ key: D, classId: '1-4', deviceId: 'board-14', after: '0' }).calls.length, 0);
assert.strictEqual(poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '1' }).calls.length, 0);

// 표시 확인: 같은 기기 중복·다른 반 기기는 세지 않는다
poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '1', acked: '1' });
poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '1', acked: '1' });
poll({ key: D, classId: '1-4', deviceId: 'board-14', after: '1', acked: '1' });
assert.strictEqual(sheet.rows[1][7], 1);
poll({ key: D, classId: '1-5', deviceId: 'board-15b', after: '1', acked: '1,abc,-3' });
assert.strictEqual(sheet.rows[1][7], 2);

let dash = gas.getDashboard(T);
assert.strictEqual(dash.items[0].shown, 2);
assert.deepStrictEqual(plain(dash.online), { '1-5': 2, '1-4': 1 });

// 취소
const c2 = gas.callStudent(T, { classId: '1-5', teacher: '김수학', student: '박서연', location: '상담실' });
gas.cancelCall(T, c2.id);
r = poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '1' });
assert.deepStrictEqual([r.calls.length, r.cancelled], [0, [2]]);
assert.strictEqual(sheet.rows[2][6], '취소');
assert.strictEqual(gas.getDashboard(T).items[0].cancelled, true);
assert.throws(() => gas.cancelCall(T, 999), /찾을 수 없습니다/);

// 캐시가 지워져도 시트에서 재구성
const c3 = gas.callStudent(T, { classId: '2-3', teacher: '이영어', student: '최유진', location: '보건실' });
state.cache.clear();
r = poll({ key: D, classId: '2-3', deviceId: 'board-23', after: '0' });
assert.deepStrictEqual(r.calls.map(c => c.id), [c3.id]);
assert.strictEqual(r.lastId, 3);
r = poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '1' });
assert.deepStrictEqual(r.cancelled, [2]);

// 확인 요청은 PropertiesService를 쓰지 않는다
const before = state.propOps;
for (let i = 0; i < 200; i++) poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '3' });
assert.strictEqual(state.propOps, before, 'poll must not touch PropertiesService when cache is warm');

// 3분이 지난 호출은 표시하지 않는다
const c4 = gas.callStudent(T, { classId: '3-1', teacher: 'a', student: 'b', location: 'c' });
state.now += 4 * 60 * 1000;
assert.strictEqual(poll({ key: D, classId: '3-1', deviceId: 'board-31', after: '0' }).calls.length, 0);
assert.strictEqual(gas.getDashboard(T).online['1-4'], undefined);

// 보관 기간 지난 기록 삭제
state.now += 8 * 24 * 60 * 60 * 1000;
gas.callStudent(T, { classId: '1-1', teacher: 'a', student: 'new', location: 'c' });
gas.cleanupOldRows();
assert.deepStrictEqual(sheet.rows.slice(1).map(r => r[4]), ['new']);
assert.strictEqual(gas.getDashboard(T).items.length, 1);
assert.strictEqual(sheet.rows[1][0], c4.id + 1);

// 설정 값 범위 제한
state.props.POLL_SECONDS = '1'; gas.clearCaches();
assert.strictEqual(gas.getConfig().pollSeconds, 3);
assert.deepStrictEqual(plain(gas.getConfig().locations), ['교무실', '행정실', '상담실', '보건실', '과학실']);

// 운영 시간
const call = () => gas.callStudent(T, { classId: '1-1', teacher: 'a', student: 'b', location: 'c' });
state.now = kst(7, 59); assert.throws(call, /운영 시간\(08:00~22:00\)/); assert.strictEqual(gas.getConfig().activeNow, false);
state.now = kst(8, 0); call(); assert.strictEqual(gas.getConfig().activeNow, true);
state.now = kst(19, 0); call();
state.now = kst(21, 59); call();
state.now = kst(22, 0); assert.throws(call, /운영 시간/);
state.props.ACTIVE_HOURS = ' 07:30 - 16:00 '; gas.clearCaches();
assert.deepStrictEqual([gas.getConfig().activeStart, gas.getConfig().activeEnd], ['07:30', '16:00']);
state.now = kst(7, 45); call();
state.props.ACTIVE_HOURS = '25:00-99'; gas.clearCaches();
assert.deepStrictEqual([gas.getConfig().activeStart, gas.getConfig().activeEnd], ['08:00', '22:00']);

// 전달사항: 반 전달 + 학년 전체 전달
state.now = kst(10, 0); gas.clearCaches();
let baseline = poll({ key: D, classId: '1-1', deviceId: 'board-11' }).lastId;
poll({ key: D, classId: '1-2', deviceId: 'board-12' });
poll({ key: D, classId: '2-1', deviceId: 'board-21' });
const nClass = gas.sendNotice(T, { target: '1-1', teacher: '정연기', message: '1반 전달 테스트' });
assert.strictEqual(nClass.onlineDevices, 1);
r = poll({ key: D, classId: '1-1', deviceId: 'board-11', after: String(baseline) });
assert.strictEqual(r.calls.length, 1);
assert.deepStrictEqual([r.calls[0].type, r.calls[0].message], ['notice', '1반 전달 테스트']);
assert.strictEqual(poll({ key: D, classId: '1-2', deviceId: 'board-12', after: String(baseline) }).calls.length, 0);

baseline = nClass.id;
const nGrade = gas.sendNotice(T, { target: '1-*', teacher: '정연기', message: '1학년 전체 전달 테스트' });
assert.strictEqual(nGrade.onlineDevices, 2);
for (const cid of ['1-1', '1-2']) {
  r = poll({ key: D, classId: cid, deviceId: cid === '1-1' ? 'board-11' : 'board-12', after: String(baseline) });
  assert.strictEqual(r.calls.length, 1);
  assert.deepStrictEqual([r.calls[0].classId, r.calls[0].type, r.calls[0].teacher, r.calls[0].message], ['1-*', 'notice', '정연기', '1학년 전체 전달 테스트']);
}
assert.strictEqual(poll({ key: D, classId: '2-1', deviceId: 'board-21', after: String(baseline) }).calls.length, 0);
dash = gas.getDashboard(T);
assert.strictEqual(dash.gradeOnline['1'], 2);
assert.strictEqual(dash.items[0].type, 'notice');
assert.strictEqual(dash.items[0].message, '1학년 전체 전달 테스트');

console.log('APPS SCRIPT TEST PASS');

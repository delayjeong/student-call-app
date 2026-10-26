const assert = require('assert');
const { load, kst } = require('./gas-mock');

const { gas, state } = load();
const poll = q => JSON.parse(gas.doGet({ parameter: Object.assign({ action: 'poll' }, q) }).content);
// vm 안에서 만든 객체는 프로토타입이 달라 deepStrictEqual이 실패하므로 평범한 객체로 바꿔 비교
const plain = x => JSON.parse(JSON.stringify(x));

// 초기 설정
gas.setup();
const T = state.props.TEACHER_KEY, D = state.props.DEVICE_KEY;
assert.ok(T && D && T !== D && T.length >= 32);
assert.deepStrictEqual(plain(state.triggers), ['cleanupOldRows']);
gas.setup(); // 다시 실행해도 키·트리거가 바뀌지 않는다
assert.strictEqual(state.props.TEACHER_KEY, T);
assert.deepStrictEqual(plain(state.triggers), ['cleanupOldRows']);
const sheet = state.sheets['호출기록'];
assert.strictEqual(sheet.rows[0][0], '번호');

// 교사용 웹 / 잘못된 요청
assert.strictEqual(gas.doGet({ parameter: {} }).file, 'Teacher');
assert.strictEqual(JSON.parse(gas.doGet({ parameter: { action: 'x' } }).content).error, 'unknown action');
assert.strictEqual(poll({ key: 'wrong', classId: '1-5', deviceId: 'a' }).error, 'invalid key');
assert.strictEqual(poll({ key: D, classId: '01-5', deviceId: 'a' }).ok, false);
assert.strictEqual(poll({ key: D, classId: '1-5', deviceId: '' }).ok, false);
assert.strictEqual(poll({ key: D, classId: '1-5', deviceId: 'x'.repeat(65) }).ok, false);
assert.throws(() => gas.callStudent('wrong', { classId: '1-5', teacher: 'a', student: 'b', location: 'c' }), /교사용 키/);
assert.throws(() => gas.callStudent(D, { classId: '1-5', teacher: 'a', student: 'b', location: 'c' }), /교사용 키/);
assert.throws(() => gas.callStudent(T, { classId: '1반', teacher: 'a', student: 'b', location: 'c' }), /반 형식/);
assert.throws(() => gas.callStudent(T, { classId: '1-5', teacher: '', student: 'b', location: 'c' }), /모두 입력/);
assert.throws(() => gas.callStudent(T, { classId: '1-5', teacher: 'a', student: 'b'.repeat(31), location: 'c' }), /너무 깁니다/);

// 앱 시작 직후: 기준 번호만 받는다
let r = poll({ key: D, classId: '1-5', deviceId: 'board-15' });
assert.deepStrictEqual([r.ok, r.lastId, r.calls.length, r.pollSeconds, r.activeStart, r.activeEnd], [true, 0, 0, 10, '08:00', '22:00']);
poll({ key: D, classId: '1-4', deviceId: 'board-14' });

// 호출 → 해당 반만 받는다
const c1 = gas.callStudent(T, { classId: '1-5', teacher: '김수학', student: '김민수', location: '교무실' });
assert.deepStrictEqual(plain(c1), { id: 1, onlineDevices: 1 });
r = poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '0' });
assert.strictEqual(r.calls.length, 1);
assert.deepStrictEqual(Object.keys(r.calls[0]).sort(), ['classId', 'id', 'location', 'sentAt', 'student', 'teacher']);
assert.strictEqual(r.calls[0].student, '김민수');
assert.strictEqual(poll({ key: D, classId: '1-4', deviceId: 'board-14', after: '0' }).calls.length, 0);
// 이미 받은 번호 이후로는 다시 오지 않는다
assert.strictEqual(poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '1' }).calls.length, 0);

// 표시 확인: 같은 기기 중복·다른 반 기기·다른 반 번호는 세지 않는다
poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '1', acked: '1' });
poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '1', acked: '1' });
poll({ key: D, classId: '1-4', deviceId: 'board-14', after: '1', acked: '1' });
assert.strictEqual(sheet.rows[1][7], 1);
poll({ key: D, classId: '1-5', deviceId: 'board-15b', after: '1', acked: '1,abc,-3' });
assert.strictEqual(sheet.rows[1][7], 2);

// 대시보드
let dash = gas.getDashboard(T);
assert.strictEqual(dash.items[0].shown, 2);
assert.deepStrictEqual(plain(dash.online), { '1-5': 2, '1-4': 1 });

// 취소 → 같은 반 전자칠판에 cancelled로 전달, 새 호출 목록에서는 빠진다
const c2 = gas.callStudent(T, { classId: '1-5', teacher: '김수학', student: '박서연', location: '상담실' });
gas.cancelCall(T, c2.id);
r = poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '1' });
assert.deepStrictEqual([r.calls.length, r.cancelled], [0, [2]]);
assert.strictEqual(sheet.rows[2][6], '취소');
assert.strictEqual(gas.getDashboard(T).items[0].cancelled, true);
assert.throws(() => gas.cancelCall(T, 999), /찾을 수 없습니다/);

// 캐시가 지워져도(축출) 시트에서 다시 만들어 같은 결과
const c3 = gas.callStudent(T, { classId: '2-3', teacher: '이영어', student: '최유진', location: '보건실' });
state.cache.clear();
r = poll({ key: D, classId: '2-3', deviceId: 'board-23', after: '0' });
assert.deepStrictEqual(r.calls.map(c => c.id), [c3.id]);
assert.strictEqual(r.lastId, 3);
r = poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '1' });
assert.deepStrictEqual(r.cancelled, [2]);

// 확인 요청은 PropertiesService를 쓰지 않는다 (무료 계정 하루 5만 회 제한)
const before = state.propOps;
for (let i = 0; i < 200; i++) poll({ key: D, classId: '1-5', deviceId: 'board-15', after: '3' });
assert.strictEqual(state.propOps, before, 'poll must not touch PropertiesService when cache is warm');

// 3분이 지난 호출은 표시하지 않는다 (꺼져 있던 칠판이 켜졌을 때)
const c4 = gas.callStudent(T, { classId: '3-1', teacher: 'a', student: 'b', location: 'c' });
state.now += 4 * 60 * 1000;
assert.strictEqual(poll({ key: D, classId: '3-1', deviceId: 'board-31', after: '0' }).calls.length, 0);
// 오래 확인하지 않은 기기는 연결 대수에서 빠진다
assert.strictEqual(gas.getDashboard(T).online['1-4'], undefined);

// 보관 기간 지난 기록 삭제
state.now += 8 * 24 * 60 * 60 * 1000;
gas.callStudent(T, { classId: '1-1', teacher: 'a', student: 'new', location: 'c' });
gas.cleanupOldRows();
assert.deepStrictEqual(sheet.rows.slice(1).map(r => r[4]), ['new']);
assert.strictEqual(gas.getDashboard(T).items.length, 1);
// 행이 지워진 뒤에도 번호는 이어진다
assert.strictEqual(sheet.rows[1][0], c4.id + 1);

// 설정 값 범위 제한
state.props.POLL_SECONDS = '1'; gas.clearCaches();
assert.strictEqual(gas.getConfig().pollSeconds, 3);
assert.deepStrictEqual(plain(gas.getConfig().locations), ['교무실', '행정실', '상담실', '보건실', '과학실']);

// 운영 시간 (기본 08:00~22:00, 한국 시간)
const call = () => gas.callStudent(T, { classId: '1-1', teacher: 'a', student: 'b', location: 'c' });
state.now = kst(7, 59); assert.throws(call, /운영 시간\(08:00~22:00\)/); assert.strictEqual(gas.getConfig().activeNow, false);
state.now = kst(8, 0); call(); assert.strictEqual(gas.getConfig().activeNow, true);
state.now = kst(19, 0); call();
state.now = kst(21, 59); call();
state.now = kst(22, 0); assert.throws(call, /운영 시간/);
state.props.ACTIVE_HOURS = ' 07:30 - 16:00 '; gas.clearCaches();
assert.deepStrictEqual([gas.getConfig().activeStart, gas.getConfig().activeEnd], ['07:30', '16:00']);
state.now = kst(7, 45); call();
state.props.ACTIVE_HOURS = '25:00-99'; gas.clearCaches(); // 잘못된 값이면 기본값
assert.deepStrictEqual([gas.getConfig().activeStart, gas.getConfig().activeEnd], ['08:00', '22:00']);

console.log('APPS SCRIPT TEST PASS');

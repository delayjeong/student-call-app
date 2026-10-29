const assert = require('assert');
const { load, kst } = require('./gas-mock');
const { gas, state } = load();
const poll = q => JSON.parse(gas.doGet({ parameter: Object.assign({ action: 'poll' }, q) }).content);
const plain = x => JSON.parse(JSON.stringify(x));
const localAt = (h, m=0) => { const d = new Date(kst(h,m) + 9*3600e3); const p=n=>String(n).padStart(2,'0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}T${p(h)}:${p(m)}`; };

gas.setup();
const T=state.props.TEACHER_KEY,D=state.props.DEVICE_KEY;
assert.ok(T&&D&&T!==D&&T.length>=32);
assert.deepStrictEqual(plain(state.triggers),['cleanupOldRows','processScheduledItems']);
gas.setup();assert.deepStrictEqual(plain(state.triggers),['cleanupOldRows','processScheduledItems']);
const sheet=state.sheets['호출기록'], scheduleSheet=state.sheets['예약전송'];
assert.deepStrictEqual(sheet.rows[0].slice(8,10),['유형','전달사항']);
assert.strictEqual(scheduleSheet.rows[0][0],'예약번호');
assert.deepStrictEqual(plain(gas.getConfig().classCounts),[5,5,4]);

assert.strictEqual(gas.doGet({parameter:{}}).file,'Teacher');
assert.strictEqual(poll({key:'wrong',classId:'1-5',deviceId:'a'}).error,'invalid key');
assert.strictEqual(poll({key:D,classId:'3-5',deviceId:'a'}).ok,false);
assert.throws(()=>gas.callStudent('wrong',{target:'1-1',teacher:'a',student:'b',location:'c'}),/교사용 키/);
assert.throws(()=>gas.callStudent(T,{target:'4-*',teacher:'a',student:'b',location:'c'}),/대상 선택/);
assert.throws(()=>gas.callStudent(T,{target:'1-1',teacher:'a',student:'',location:'c'}),/학생 이름/);
assert.throws(()=>gas.sendNotice(T,{target:'1-*',teacher:'a',message:''}),/전달사항/);

let r=poll({key:D,classId:'1-5',deviceId:'board-15'});
assert.deepStrictEqual([r.ok,r.lastId,r.calls.length],[true,0,0]);
poll({key:D,classId:'1-4',deviceId:'board-14'});
const c1=gas.callStudent(T,{target:'1-5',teacher:'김수학',student:'김민수',location:'교무실'});
assert.deepStrictEqual(plain(c1),{id:1,onlineDevices:1});
assert.strictEqual(sheet.rows[1][2],'1-5');
r=poll({key:D,classId:'1-5',deviceId:'board-15',after:'0'});assert.strictEqual(r.calls[0].student,'김민수');
assert.strictEqual(poll({key:D,classId:'1-4',deviceId:'board-14',after:'0'}).calls.length,0);
poll({key:D,classId:'1-5',deviceId:'board-15',after:'1',acked:'1'});assert.strictEqual(sheet.rows[1][7],1);
const c2=gas.callStudent(T,{target:'1-5',teacher:'김수학',student:'박서연',location:'상담실'});gas.cancelCall(T,c2.id);
r=poll({key:D,classId:'1-5',deviceId:'board-15',after:'1'});assert.deepStrictEqual([r.calls.length,r.cancelled],[0,[2]]);

// Google Sheets가 1-5를 2026-01-05 날짜로 바꿔 둔 기존 행도 clearCaches 때 복구한다.
sheet.rows[1][2]=new Date(Date.UTC(2026,0,4,15,0));
state.cache.clear();gas.clearCaches();
assert.strictEqual(sheet.rows[1][2],'1-5');
assert.strictEqual(gas.getDashboard(T).items.find(x=>x.id===1).classId,'1-5');

state.cache.set('config',JSON.stringify({pollSeconds:10,activeStart:'08:00',activeEnd:'22:00',teacherKey:T,deviceKey:D}));
assert.deepStrictEqual(plain(gas.getConfig().classCounts),[5,5,4]);

state.cache.clear();gas.clearCaches();
let baseline=poll({key:D,classId:'2-1',deviceId:'board-21'}).lastId;
poll({key:D,classId:'2-2',deviceId:'board-22'});poll({key:D,classId:'1-1',deviceId:'board-11'});
const cg=gas.callStudent(T,{target:'2-*',teacher:'정연기',student:'홍길동',location:'교무실'});
assert.strictEqual(cg.onlineDevices,2);
for(const [cid,did] of [['2-1','board-21'],['2-2','board-22']]){r=poll({key:D,classId:cid,deviceId:did,after:String(baseline)});assert.deepStrictEqual([r.calls[0].classId,r.calls[0].type,r.calls[0].student],['2-*','call','홍길동']);}
assert.strictEqual(poll({key:D,classId:'1-1',deviceId:'board-11',after:String(baseline)}).calls.length,0);
baseline=cg.id;const ng=gas.sendNotice(T,{target:'2-*',teacher:'정연기',message:'전달 테스트'});assert.strictEqual(ng.onlineDevices,2);
r=poll({key:D,classId:'2-1',deviceId:'board-21',after:String(baseline)});assert.deepStrictEqual([r.calls[0].type,r.calls[0].message],['notice','전달 테스트']);

state.now=kst(10,0);state.cache.clear();gas.clearCaches();
let s=gas.createSchedule(T,{type:'notice',target:'1-1',teacher:'정연기',message:'예약 전달',scheduleAt:localAt(10,5)});
assert.strictEqual(scheduleSheet.rows.find(x=>x[0]===s.id)[2],'1-1');
assert.strictEqual(gas.getSchedules(T).length,1);
// 예약 시트에 이미 날짜형으로 저장된 대상도 동일하게 복구한다.
const scheduledRow=scheduleSheet.rows.find(x=>x[0]===s.id);
scheduledRow[2]=new Date(Date.UTC(2025,11,31,15,0));
state.cache.clear();gas.clearCaches();
assert.strictEqual(scheduledRow[2],'1-1');
assert.strictEqual(gas.getSchedules(T)[0].target,'1-1');
gas.updateSchedule(T,s.id,{type:'notice',target:'1-*',teacher:'정연기',message:'수정된 예약',scheduleAt:localAt(10,6)});
assert.deepStrictEqual([gas.getSchedules(T)[0].target,gas.getSchedules(T)[0].message],['1-*','수정된 예약']);
gas.cancelSchedule(T,s.id);assert.strictEqual(gas.getSchedules(T).length,0);

baseline=poll({key:D,classId:'3-1',deviceId:'board-31'}).lastId;poll({key:D,classId:'3-2',deviceId:'board-32'});
s=gas.createSchedule(T,{type:'call',target:'3-*',teacher:'정연기',student:'김학생',location:'수학실',scheduleAt:localAt(10,5)});
assert.strictEqual(gas.getSchedules(T).length,1);state.now=kst(10,6);gas.processScheduledItems();assert.strictEqual(gas.getSchedules(T).length,0);
for(const [cid,did] of [['3-1','board-31'],['3-2','board-32']]){r=poll({key:D,classId:cid,deviceId:did,after:String(baseline)});assert.strictEqual(r.calls.some(x=>x.type==='call'&&x.student==='김학생'&&x.classId==='3-*'),true);}
assert.strictEqual(scheduleSheet.rows.find(x=>x[0]===s.id)[8],'전송완료');

state.now=kst(10,0);assert.throws(()=>gas.createSchedule(T,{type:'call',target:'1-1',teacher:'a',student:'b',location:'c',scheduleAt:localAt(23,0)}),/운영 시간/);
assert.throws(()=>gas.createSchedule(T,{type:'call',target:'1-1',teacher:'a',student:'b',location:'c',scheduleAt:localAt(9,0)}),/현재보다 이후/);
const call=()=>gas.callStudent(T,{target:'1-1',teacher:'a',student:'b',location:'c'});state.now=kst(7,59);assert.throws(call,/운영 시간/);state.now=kst(8,0);call();state.now=kst(22,0);assert.throws(call,/운영 시간/);

state.now=kst(10,0);state.cache.clear();gas.clearCaches();poll({key:D,classId:'1-1',deviceId:'board',after:'999'});const before=state.propOps;for(let i=0;i<50;i++)poll({key:D,classId:'1-1',deviceId:'board',after:'999'});assert.strictEqual(state.propOps,before);
console.log('APPS SCRIPT TEST PASS');

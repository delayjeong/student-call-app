// 교사용 화면(Teacher.html)을 실제 브라우저에서 열어 핵심 운영 흐름을 검사한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { load } = require('./gas-mock');

(async () => {
  const { gas, state } = load();
  gas.setup();
  const T = state.props.TEACHER_KEY, D = state.props.DEVICE_KEY;
  const poll = q => JSON.parse(gas.doGet({ parameter: Object.assign({ action: 'poll', key: D }, q) }).content);
  poll({ classId: '2-3', deviceId: 'board-23' });
  poll({ classId: '2-1', deviceId: 'board-21' });

  const html = fs.readFileSync(path.join(__dirname, '..', 'Teacher.html'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.exposeFunction('__gas', (name, args) => {
    try { return JSON.stringify({ ok: gas[name](...JSON.parse(args)) }); }
    catch (e) { return JSON.stringify({ err: e.message }); }
  });
  await page.addInitScript(() => {
    window.google = { script: { get run() {
      let ok = () => {}, fail = () => {};
      const o = {
        withSuccessHandler(f) { ok = f; return p; },
        withFailureHandler(f) { fail = f; return p; }
      };
      const p = new Proxy(o, { get: (t, k) => k in t ? t[k] : (...a) =>
        window.__gas(k, JSON.stringify(a)).then(r => {
          const v = JSON.parse(r);
          'err' in v ? fail(new Error(v.err)) : ok(v.ok);
        })
      });
      return p;
    } } };
  });

  await page.clock.setFixedTime(new Date(state.now));
  await page.route('https://gas.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://gas.test/');
  await page.waitForFunction(() => document.querySelectorAll('#grade option').length === 3);

  // 실제 학급 구성 5/5/4
  await page.selectOption('#grade', '3'); await page.dispatchEvent('#grade', 'change');
  assert.strictEqual(await page.locator('#classNo option').count(), 4);
  await page.selectOption('#grade', '2'); await page.dispatchEvent('#grade', 'change');
  assert.strictEqual(await page.locator('#classNo option').count(), 5);

  // 학생 이름 예시 제거 + 호출 위치 직접 입력 전용
  assert.strictEqual(await page.getAttribute('#student', 'placeholder'), null);
  assert.strictEqual(await page.locator('#locations').count(), 0);
  assert.strictEqual(await page.locator('#callLocation').count(), 1);

  // 교사용 키 저장 후 입력값 비노출
  await page.fill('#teacher', '김수학'); await page.dispatchEvent('#teacher', 'change');
  await page.fill('#teacherKeyInput', T); await page.click('#saveKeyBtn');
  await page.waitForFunction(() => document.querySelector('#keyState').textContent.includes('저장됨'));
  assert.strictEqual(await page.inputValue('#teacherKeyInput'), '');

  // 교사용 키 공유로 전체 교사가 중앙 TTS 음소거 설정을 변경할 수 있다.
  await page.click('#muteSettings summary');
  await page.waitForFunction(() => document.querySelector('#muteSource').textContent.includes('시간표가 없습니다'));
  assert.strictEqual(await page.inputValue('#muteScope'),'all');
  await page.click('#muteAddBtn');
  await page.locator('#muteTimes input').nth(0).fill('08:40');
  await page.locator('#muteTimes input').nth(1).fill('09:30');
  page.once('dialog', d=>d.accept());
  await page.click('#muteSaveBtn');
  await page.waitForFunction(() => document.querySelector('#muteStatus').textContent.includes('저장했습니다'));
  assert.deepStrictEqual(gas.getMuteSchedules(T).rules.all,['08:40-09:30']);
  assert.strictEqual(poll({classId:'2-3',deviceId:'mute-board'}).muteWindows,'08:40-09:30');

  await page.selectOption('#muteScope','grade');
  await page.selectOption('#muteGrade','2');
  assert.ok((await page.textContent('#muteSource')).includes('전체 공통'));
  assert.strictEqual(await page.locator('#muteTimes .mute-time-row').count(),1);
  await page.click('#muteTimes .mute-time-row button');
  page.once('dialog', d=>d.accept());
  await page.click('#muteSaveBtn');
  await page.waitForFunction(() => document.querySelector('#muteStatus').textContent.includes('저장했습니다'));
  assert.strictEqual(poll({classId:'2-3',deviceId:'mute-board'}).muteWindows,'');
  assert.strictEqual(poll({classId:'1-3',deviceId:'mute-board'}).muteWindows,'08:40-09:30');
  page.once('dialog', d=>d.accept());
  await page.click('#muteResetBtn');
  await page.waitForFunction(() => document.querySelector('#muteStatus').textContent.includes('삭제했습니다'));
  assert.strictEqual(poll({classId:'2-3',deviceId:'mute-board'}).muteWindows,'08:40-09:30');
  // 테스트 종료 시 초기 상태 복구
  gas.deleteMuteSchedule(T,'all');


  // 전체 반 연결 현황: 서버의 실시간 대시보드 데이터를 그대로 사용
  await page.waitForFunction(() => document.querySelector('#boardMonitorSummary').textContent.includes('연결 2/14개 반'));
  await page.click('#boardMonitor summary');
  assert.strictEqual(await page.locator('.monitor-cell').count(), 14);
  assert.strictEqual(await page.locator('.monitor-cell.connected').count(), 2);
  assert.ok((await page.locator('.monitor-cell[data-class="2-3"]').textContent()).includes('1대 연결'));
  assert.ok((await page.locator('.monitor-cell[data-class="3-4"]').textContent()).includes('미확인'));
  await page.click('#refreshMonitorBtn');
  await page.waitForFunction(() => document.querySelector('#boardMonitorUpdated').textContent.includes('마지막 확인'));


  // 특정 반 학생 호출
  await page.selectOption('#grade', '2'); await page.dispatchEvent('#grade', 'change');
  await page.selectOption('#classNo', '3'); await page.dispatchEvent('#classNo', 'change');
  await page.fill('#student', '김민수');
  await page.fill('#callLocation', '상담실');
  await page.click('#sendBtn');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('호출했습니다'));
  let r = poll({ classId: '2-3', deviceId: 'board-23', after: '0' });
  assert.strictEqual(r.calls.some(x => x.student === '김민수' && x.location === '상담실'), true);

  // 학년 전체 학생 호출
  await page.waitForTimeout(3100);
  const baseline = poll({ classId: '2-3', deviceId: 'board-23' }).lastId;
  await page.selectOption('#callScope', 'grade');
  await page.fill('#student', '이학생');
  await page.fill('#callLocation', '교무실');
  page.once('dialog', d => d.accept());
  await page.click('#sendBtn');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('2학년 전체'));
  for (const [cid, did] of [['2-1','board-21'], ['2-3','board-23']]) {
    r = poll({ classId: cid, deviceId: did, after: String(baseline) });
    assert.strictEqual(r.calls.some(x => x.classId === '2-*' && x.type === 'call' && x.student === '이학생'), true);
  }

  // 학년 전체 전달
  await page.waitForTimeout(3100);
  await page.click('#modeNotice');
  await page.selectOption('#noticeScope', 'grade');
  await page.fill('#message', '5교시 수업 장소가 변경되었습니다.');
  page.once('dialog', d => d.accept());
  await page.click('#sendBtn');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('전달했습니다'));

  // 예약 전송 + 약 1분 오차 안내
  await page.waitForTimeout(3100);
  await page.selectOption('#sendMode', 'schedule');
  await page.dispatchEvent('#sendMode', 'change');
  assert.ok((await page.textContent('#scheduleBox')).includes('약 1분 정도 오차'));
  await page.fill('#message', '예약 전달 테스트');
  const local = new Date(state.now + 9 * 3600e3);
  const pad = n => String(n).padStart(2, '0');
  const scheduleAt = `${local.getUTCFullYear()}-${pad(local.getUTCMonth()+1)}-${pad(local.getUTCDate())}T10:05`;
  await page.fill('#scheduleAt', scheduleAt);
  page.once('dialog', d => d.accept());
  await page.click('#sendBtn');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('예약을 저장'));
  await page.waitForFunction(() => document.querySelector('#schedules').textContent.includes('예약 전달 테스트'));
  assert.strictEqual(gas.getSchedules(T).length, 1);

  // 예약 수정 화면 진입
  await page.click('button[data-sact=edit]');
  assert.strictEqual(await page.inputValue('#sendMode'), 'schedule');
  assert.strictEqual(await page.inputValue('#message'), '예약 전달 테스트');
  await page.click('#cancelEditBtn');

  // 예약 취소
  page.once('dialog', d => d.accept());
  await page.click('button[data-sact=cancel]');
  await page.waitForFunction(() => document.querySelector('#schedules').textContent.includes('예약 없음'));
  assert.strictEqual(gas.getSchedules(T).length, 0);

  // 운영 시간 밖 즉시 전송 비활성
  await page.selectOption('#sendMode', 'now');
  await page.dispatchEvent('#sendMode', 'change');
  await page.clock.setFixedTime(new Date('2026-10-28T13:30:00Z')); // 22:30 KST
  await page.evaluate(() => renderHours());
  assert.ok(await page.isDisabled('#sendBtn'));
  assert.ok((await page.textContent('#sendBtn')).includes('운영 시간이 아닙니다'));

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('TEACHER PAGE TEST PASS');
})().catch(e => { console.error(e); process.exit(1); });

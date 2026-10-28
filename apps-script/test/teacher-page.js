// 교사용 화면(Teacher.html)을 실제 브라우저에서 열고 google.script.run을 모형 Apps Script에 연결해 검사한다.
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

  const html = fs.readFileSync(path.join(__dirname, '..', 'Teacher.html'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.exposeFunction('__gas', (name, args) => {
    try { return JSON.stringify({ ok: gas[name](...JSON.parse(args)) }); } catch (e) { return JSON.stringify({ err: e.message }); }
  });
  await page.addInitScript(() => {
    window.google = { script: { get run() {
      let ok = () => {}, fail = () => {};
      const o = { withSuccessHandler(f) { ok = f; return p; }, withFailureHandler(f) { fail = f; return p; } };
      const p = new Proxy(o, { get: (t, k) => k in t ? t[k] : (...a) => window.__gas(k, JSON.stringify(a)).then(r => { const v = JSON.parse(r); 'err' in v ? fail(new Error(v.err)) : ok(v.ok); }) });
      return p;
    } } };
  });
  await page.clock.setFixedTime(new Date(state.now));
  await page.route('https://gas.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://gas.test/');
  await page.waitForFunction(() => document.querySelectorAll('#grade option').length === 3);

  // 학급 구성 5/5/4
  await page.selectOption('#grade', '3');
  await page.dispatchEvent('#grade', 'change');
  assert.strictEqual(await page.locator('#classNo option').count(), 4);
  await page.selectOption('#grade', '2');
  await page.dispatchEvent('#grade', 'change');
  assert.strictEqual(await page.locator('#classNo option').count(), 5);

  // 교사용 키는 검증 후 저장되고 입력창에서는 사라진다
  assert.ok(await page.locator('#settings').evaluate(e => e.open), '처음에는 교사 설정이 펼쳐져 있어야 한다');
  await page.fill('#teacher', '김수학'); await page.dispatchEvent('#teacher', 'change');
  await page.fill('#teacherKeyInput', 'wrong'); await page.click('#saveKeyBtn');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('교사용 키가 올바르지'));
  await page.fill('#teacherKeyInput', T); await page.click('#saveKeyBtn');
  await page.waitForFunction(() => document.querySelector('#keyState').textContent.includes('저장됨'));
  assert.strictEqual(await page.inputValue('#teacherKeyInput'), '');
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('studentcall_teacherKey')), T);

  await page.selectOption('#grade', '2'); await page.dispatchEvent('#grade', 'change');
  await page.selectOption('#classNo', '3'); await page.dispatchEvent('#classNo', 'change');
  await page.waitForFunction(() => document.querySelector('#devicesCall').textContent.includes('2학년 3반 전자칠판 연결: 1대'));
  assert.ok((await page.textContent('#hours')).includes('08:00~22:00'));

  // 학생 호출
  await page.fill('#student', '김민수'); await page.click('text=상담실'); await page.click('#callBtn');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('호출했습니다'));
  assert.ok(await page.isDisabled('#callBtn'), '호출 직후 3초 잠금');
  let r = poll({ classId: '2-3', deviceId: 'board-23', after: '0' });
  assert.deepStrictEqual(r.calls.map(c => [c.type, c.student, c.location]), [['call', '김민수', '상담실']]);
  poll({ classId: '2-3', deviceId: 'board-23', after: '1', acked: '1' });
  await page.click('#refreshBtn');
  await page.waitForFunction(() => document.querySelector('#recent').textContent.includes('표시 1대'));

  // 취소 및 다시 표시
  await page.click('button[data-act=cancel]');
  await page.waitForFunction(() => document.querySelector('#recent').textContent.includes('취소됨'));
  r = poll({ classId: '2-3', deviceId: 'board-23', after: '1' });
  assert.deepStrictEqual(r.cancelled, [1]);
  await page.click('button[data-act=resend]');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('다시 표시'));
  assert.strictEqual(poll({ classId: '2-3', deviceId: 'board-23', after: '1' }).calls.length, 1);

  // 기타 위치 직접 입력 / HTML 이스케이프
  await page.waitForTimeout(3100);
  await page.fill('#student', '<b>x</b>'); await page.click('text=기타'); await page.fill('#customLocation', '도서관'); await page.click('#callBtn');
  await page.waitForFunction(() => document.querySelector('#recent').textContent.includes('<b>x</b> → 도서관'));

  // 학년 전체 전달: 같은 학년 모든 반 수신, 다른 학년은 미수신
  await page.waitForTimeout(3100);
  poll({ classId: '2-1', deviceId: 'board-21' });
  const baseline = poll({ classId: '2-3', deviceId: 'board-23' }).lastId;
  await page.click('#modeNotice');
  await page.selectOption('#noticeScope', 'grade');
  await page.fill('#message', '5교시 수업 장소가 물리실로 변경되었습니다.');
  page.once('dialog', d => d.accept());
  await page.click('#noticeBtn');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('2학년 전체에 전달했습니다'));
  for (const [cid, did] of [['2-1','board-21'], ['2-3','board-23']]) {
    r = poll({ classId: cid, deviceId: did, after: String(baseline) });
    assert.strictEqual(r.calls.length, 1);
    assert.deepStrictEqual([r.calls[0].classId, r.calls[0].type, r.calls[0].message], ['2-*', 'notice', '5교시 수업 장소가 물리실로 변경되었습니다.']);
  }
  poll({ classId: '1-1', deviceId: 'board-11' });
  assert.strictEqual(poll({ classId: '1-1', deviceId: 'board-11', after: String(baseline) }).calls.length, 0);
  assert.ok((await page.textContent('#recent')).includes('전달사항: 5교시 수업 장소가 물리실로 변경되었습니다.'));

  if (process.argv[2]) await page.screenshot({ path: process.argv[2], fullPage: true });

  // 운영 시간 밖: 연속전송 잠금이 풀린 뒤 호출/전달 모두 비활성
  await page.waitForTimeout(3100);
  await page.clock.setFixedTime(new Date('2026-10-28T13:30:00Z')); // 22:30 KST
  await page.evaluate(() => renderHours());
  assert.ok(await page.isDisabled('#callBtn'));
  assert.ok(await page.isDisabled('#noticeBtn'));
  assert.ok((await page.textContent('#noticeBtn')).includes('운영 시간이 아닙니다'));

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('TEACHER PAGE TEST PASS');
})().catch(e => { console.error(e); process.exit(1); });

// 교사용 화면(Teacher.html)을 실제 브라우저에서 열고 google.script.run을 모형 Apps Script에 연결해 검사한다.
// 실행: node test/teacher-page.js [스크린샷 경로]
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
  poll({ classId: '2-3', deviceId: 'board' });

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
  // 브라우저 시계도 한국 시간 10:00으로 고정
  await page.clock.setFixedTime(new Date(state.now));
  await page.route('https://gas.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto('https://gas.test/');
  await page.waitForFunction(() => document.querySelectorAll('#grade option').length === 3);

  assert.ok(await page.locator('#settings').evaluate(e => e.open), '처음에는 교사 설정이 펼쳐져 있어야 한다');
  await page.fill('#teacher', '김수학'); await page.dispatchEvent('#teacher', 'change');
  await page.fill('#teacherKey', 'wrong'); await page.dispatchEvent('#teacherKey', 'change');
  await page.waitForFunction(() => document.querySelector('#recent').textContent.includes('교사용 키가 올바르지'));
  await page.fill('#teacherKey', T); await page.dispatchEvent('#teacherKey', 'change');
  await page.selectOption('#grade', '2'); await page.selectOption('#classNo', '3'); await page.dispatchEvent('#classNo', 'change');
  await page.waitForFunction(() => document.querySelector('#devices').textContent.includes('2-3 전자칠판 연결: 1대'));
  assert.ok((await page.textContent('#hours')).includes('08:00~22:00'));

  await page.fill('#student', '김민수'); await page.click('text=상담실'); await page.click('#callBtn');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('호출했습니다'));
  assert.ok(await page.isDisabled('#callBtn'), '호출 직후 3초 잠금');

  // 전자칠판이 받아서 표시 확인
  let r = poll({ classId: '2-3', deviceId: 'board', after: '0' });
  assert.deepStrictEqual(r.calls.map(c => [c.student, c.location]), [['김민수', '상담실']]);
  poll({ classId: '2-3', deviceId: 'board', after: '1', acked: '1' });
  await page.click('#refreshBtn');
  await page.waitForFunction(() => document.querySelector('#recent').textContent.includes('표시 1대'));

  // 취소
  await page.click('button[data-act=cancel]');
  await page.waitForFunction(() => document.querySelector('#recent').textContent.includes('취소됨'));
  r = poll({ classId: '2-3', deviceId: 'board', after: '1' });
  assert.deepStrictEqual(r.cancelled, [1]);

  // 다시 표시
  await page.click('button[data-act=resend]');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('다시 표시'));
  assert.strictEqual(poll({ classId: '2-3', deviceId: 'board', after: '1' }).calls.length, 1);

  // 기타 위치 직접 입력, 이름이 HTML로 해석되지 않는지
  await page.waitForTimeout(3100);
  await page.fill('#student', '<b>x</b>'); await page.click('text=기타'); await page.fill('#customLocation', '도서관'); await page.click('#callBtn');
  await page.waitForFunction(() => document.querySelector('#recent').textContent.includes('<b>x</b> → 도서관'));
  if (process.argv[2]) await page.screenshot({ path: process.argv[2], fullPage: true });

  // 운영 시간 밖 (한국 시간 22:30): 버튼 비활성
  await page.clock.setFixedTime(new Date(state.now + 12.5 * 3600e3));
  await page.evaluate(() => renderHours());
  assert.ok(await page.isDisabled('#callBtn'));
  assert.ok((await page.textContent('#callBtn')).includes('운영 시간이 아닙니다'));

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('TEACHER PAGE TEST PASS');
})().catch(e => { console.error(e); process.exit(1); });

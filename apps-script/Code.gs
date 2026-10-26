/**
 * 학생 호출 시스템 — Google Apps Script 서버
 *
 * 스프레드시트(확장 프로그램 → Apps Script)에 붙여넣어 사용한다.
 * - 교사용 웹: 웹앱 주소를 그냥 열면 호출 화면(Teacher.html)이 나온다.
 * - 전자칠판 APK: 웹앱 주소?action=poll&classId=1-5&deviceId=...&key=...&after=...&acked=...
 *
 * 전자칠판이 10초마다 확인하므로 poll 경로는 CacheService만 사용한다.
 * (무료 Gmail 계정은 PropertiesService 읽기/쓰기가 하루 5만 회로 제한된다.)
 */

var SHEET_NAME = '호출기록';
var HEADERS = ['번호', '보낸 시각', '반', '선생님', '학생', '위치', '상태', '표시 대수'];
var COL = { ID: 1, TIME: 2, CLASS: 3, TEACHER: 4, STUDENT: 5, LOCATION: 6, STATUS: 7, SHOWN: 8 };
var STATUS_CALLED = '호출';
var STATUS_CANCELLED = '취소';

var DEFAULTS = {
  GRADES: '3',
  CLASSES: '10',
  POLL_SECONDS: '10',
  KEEP_DAYS: '7',
  ACTIVE_HOURS: '08:00-22:00',
  LOCATIONS: '교무실,행정실,상담실,보건실,과학실'
};

// 이보다 오래된 호출은 전자칠판에 표시하지 않는다 (꺼져 있다가 켜진 칠판에 지난 호출이 뜨지 않도록)
var FRESH_MS = 3 * 60 * 1000;
var CACHE_TTL = 6 * 60 * 60; // CacheService 최대 6시간
var CONFIG_TTL = 10 * 60;
var CLASS_ID_RE = /^[1-9][0-9]?-[1-9][0-9]?$/;
var MAX_DEVICE_ID_LENGTH = 64;
var MAX_LEN = { teacher: 30, student: 30, location: 40 };
var TIME_ZONE = 'Asia/Seoul';
var HOURS_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])-([01][0-9]|2[0-3]):([0-5][0-9])$/;

// ───────────────────────── 스프레드시트 메뉴 / 초기 설정 ─────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('학생 호출')
    .addItem('초기 설정 (처음 한 번)', 'setup')
    .addItem('키 보기', 'showKeys')
    .addItem('키 새로 만들기', 'regenerateKeys')
    .addItem('설정 변경 반영 (캐시 비우기)', 'clearCaches')
    .addToUi();
}

/** 시트 준비, 키 생성, 오래된 기록 자동 삭제 트리거 등록. 여러 번 실행해도 안전하다. */
function setup() {
  var sheet = getSheet_();
  var props = PropertiesService.getScriptProperties();
  var current = props.getProperties();
  var updates = {};
  Object.keys(DEFAULTS).forEach(function (k) { if (!current[k]) updates[k] = DEFAULTS[k]; });
  if (!current.TEACHER_KEY) updates.TEACHER_KEY = newKey_();
  if (!current.DEVICE_KEY) updates.DEVICE_KEY = newKey_();
  if (!current.NEXT_ID) updates.NEXT_ID = String(lastIdInSheet_(sheet) + 1);
  props.setProperties(updates);

  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'cleanupOldRows'; });
  if (!hasTrigger) ScriptApp.newTrigger('cleanupOldRows').timeBased().everyDays(1).atHour(3).create();

  clearCaches();
  showKeys();
}

function showKeys() {
  var p = PropertiesService.getScriptProperties();
  var msg = '교사용 키 (선생님들께 공유):\n' + p.getProperty('TEACHER_KEY') +
    '\n\n수신기 키 (전자칠판 앱에 입력):\n' + p.getProperty('DEVICE_KEY') +
    '\n\n학생에게 노출되지 않도록 주의하세요.';
  try { SpreadsheetApp.getUi().alert('학생 호출 키', msg, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { Logger.log(msg); }
}

function regenerateKeys() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('키 새로 만들기', '기존 키는 더 이상 쓸 수 없게 됩니다. 모든 선생님과 전자칠판에 새 키를 다시 입력해야 합니다. 계속할까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperties({ TEACHER_KEY: newKey_(), DEVICE_KEY: newKey_() });
  clearCaches();
  showKeys();
}

/** 스크립트 속성(학년 수, 확인 간격 등)을 직접 바꾼 뒤 바로 반영하고 싶을 때 실행. */
function clearCaches() {
  var cfg = loadConfig_();
  var keys = ['config', 'lastId'];
  for (var g = 1; g <= cfg.grades; g++) for (var c = 1; c <= cfg.classes; c++) keys.push('calls:' + g + '-' + c);
  CacheService.getScriptCache().removeAll(keys);
}

/** 매일 새벽 트리거: 보관 기간이 지난 호출 기록 삭제 (학생 개인정보 최소 보관). */
function cleanupOldRows() {
  var sheet = getSheet_();
  var cfg = config_();
  var last = sheet.getLastRow();
  if (last < 2) return;
  var cutoff = Date.now() - cfg.keepDays * 24 * 60 * 60 * 1000;
  var times = sheet.getRange(2, COL.TIME, last - 1, 1).getValues();
  var n = 0;
  while (n < times.length && new Date(times[n][0]).getTime() < cutoff) n++;
  if (n > 0) sheet.deleteRows(2, n);
}

// ───────────────────────── 웹앱 진입점 ─────────────────────────

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'poll') return json_(handlePoll_(p));
  if (p.action) return json_({ ok: false, error: 'unknown action' });
  return HtmlService.createHtmlOutputFromFile('Teacher')
    .setTitle('학생 호출')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ───────────────────────── 전자칠판 (APK) API ─────────────────────────

/**
 * 전자칠판 확인 요청.
 * after가 비어 있으면(앱 시작 직후) 지난 호출은 주지 않고 기준 번호(lastId)만 돌려준다.
 * acked에는 직전 확인 이후 팝업을 표시한 호출 번호들이 쉼표로 들어온다.
 */
function handlePoll_(p) {
  var cfg = config_();
  if (!safeEqual_(p.key, cfg.deviceKey)) return { ok: false, error: 'invalid key' };
  var classId = String(p.classId || '').trim();
  if (!CLASS_ID_RE.test(classId)) return { ok: false, error: "classId must look like '1-5'" };
  var deviceId = String(p.deviceId || '').trim();
  if (!deviceId || deviceId.length > MAX_DEVICE_ID_LENGTH) return { ok: false, error: 'deviceId is required' };

  if (p.acked) recordAcks_(classId, deviceId, String(p.acked).split(','));
  markSeen_(classId, deviceId, cfg);

  var base = { ok: true, lastId: lastId_(), pollSeconds: cfg.pollSeconds, activeStart: cfg.activeStart, activeEnd: cfg.activeEnd };
  var after = parseInt(p.after, 10);
  if (isNaN(after)) { base.calls = []; base.cancelled = []; return base; }

  var now = Date.now();
  var recent = classCalls_(classId);
  base.calls = recent.filter(function (c) { return c.id > after && !c.cancelled && now - c.sentAt < FRESH_MS; })
    .map(function (c) { return { id: c.id, classId: c.classId, teacher: c.teacher, student: c.student, location: c.location, sentAt: c.sentAt }; });
  base.cancelled = recent.filter(function (c) { return c.cancelled; }).map(function (c) { return c.id; });
  return base;
}

function recordAcks_(classId, deviceId, rawIds) {
  var ids = rawIds.map(function (s) { return parseInt(s, 10); }).filter(function (n) { return n > 0; }).slice(0, 20);
  if (!ids.length) return;
  withLock_(function () {
    var cache = CacheService.getScriptCache();
    var known = {};
    classCalls_(classId, true).forEach(function (c) { known[c.id] = true; });
    ids.forEach(function (id) {
      if (!known[id]) return; // 다른 반 호출 번호로 표시 확인을 조작하지 못하도록
      var key = 'acks:' + id;
      var devices = JSON.parse(cache.get(key) || '[]');
      if (devices.indexOf(deviceId) >= 0) return;
      devices.push(deviceId);
      cache.put(key, JSON.stringify(devices), CACHE_TTL);
      var row = findRow_(id);
      if (row) getSheet_().getRange(row, COL.SHOWN).setValue(devices.length);
    });
  });
}

/** 반별로 최근에 확인 요청을 보낸 전자칠판 (교사 화면의 "연결 N대" 표시용). */
function markSeen_(classId, deviceId, cfg) {
  var cache = CacheService.getScriptCache();
  var key = 'seen:' + classId;
  var seen = JSON.parse(cache.get(key) || '{}');
  var now = Date.now();
  // 매 확인마다 쓰지 않고 확인 간격의 절반이 지났을 때만 갱신
  if (seen[deviceId] && now - seen[deviceId] < cfg.pollSeconds * 500) return;
  seen[deviceId] = now;
  var limit = onlineWindowMs_(cfg);
  Object.keys(seen).forEach(function (d) { if (now - seen[d] > limit) delete seen[d]; });
  cache.put(key, JSON.stringify(seen), CACHE_TTL);
}

// ───────────────────────── 교사용 웹 (google.script.run) ─────────────────────────

function getConfig() {
  var cfg = config_();
  return { grades: cfg.grades, classes: cfg.classes, locations: cfg.locations, pollSeconds: cfg.pollSeconds,
    activeStart: cfg.activeStart, activeEnd: cfg.activeEnd, activeNow: isActiveNow_(cfg) };
}

function callStudent(teacherKey, data) {
  requireTeacher_(teacherKey);
  data = data || {};
  var classId = String(data.classId || '').trim();
  var teacher = String(data.teacher || '').trim();
  var student = String(data.student || '').trim();
  var location = String(data.location || '').trim();
  if (!CLASS_ID_RE.test(classId)) throw new Error('반 형식이 올바르지 않습니다.');
  if (!teacher || !student || !location) throw new Error('선생님 이름, 학생 이름, 위치를 모두 입력해 주세요.');
  if (teacher.length > MAX_LEN.teacher || student.length > MAX_LEN.student || location.length > MAX_LEN.location) throw new Error('입력이 너무 깁니다.');
  var cfg = config_();
  // 운영 시간 밖에는 전자칠판이 확인하지 않으므로 호출을 받지 않는다
  if (!isActiveNow_(cfg)) throw new Error('운영 시간(' + cfg.activeStart + '~' + cfg.activeEnd + ')이 아니라 전자칠판에 표시되지 않습니다.');

  return withLock_(function () {
    // 캐시가 비어 있으면 시트에서 다시 만들기 때문에, 새 행을 쓰기 전에 목록을 먼저 읽는다 (중복 방지)
    var list = classCalls_(classId, true);
    var props = PropertiesService.getScriptProperties();
    var id = parseInt(props.getProperty('NEXT_ID') || '1', 10);
    props.setProperty('NEXT_ID', String(id + 1));
    var now = new Date();
    getSheet_().appendRow([id, now, classId, teacher, student, location, STATUS_CALLED, 0]);
    var call = { id: id, classId: classId, teacher: teacher, student: student, location: location, sentAt: now.getTime(), cancelled: false };
    putClassCalls_(classId, list.concat([call]));
    CacheService.getScriptCache().put('lastId', String(id), CACHE_TTL);
    return { id: id, onlineDevices: onlineCount_(classId) };
  });
}

function cancelCall(teacherKey, id) {
  requireTeacher_(teacherKey);
  id = parseInt(id, 10);
  return withLock_(function () {
    var row = findRow_(id);
    if (!row) throw new Error('호출 기록을 찾을 수 없습니다.');
    var sheet = getSheet_();
    var classId = String(sheet.getRange(row, COL.CLASS).getValue());
    sheet.getRange(row, COL.STATUS).setValue(STATUS_CANCELLED);
    var list = classCalls_(classId, true);
    list.forEach(function (c) { if (c.id === id) c.cancelled = true; });
    putClassCalls_(classId, list);
    return { ok: true };
  });
}

/** 교사 화면용: 최근 호출 20건 + 반별 연결 대수. */
function getDashboard(teacherKey) {
  requireTeacher_(teacherKey);
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  var items = [];
  if (last >= 2) {
    var n = Math.min(20, last - 1);
    var rows = sheet.getRange(last - n + 1, 1, n, HEADERS.length).getValues();
    items = rows.reverse().map(function (r) {
      return {
        id: Number(r[COL.ID - 1]), sentAt: new Date(r[COL.TIME - 1]).getTime(), classId: String(r[COL.CLASS - 1]),
        teacher: String(r[COL.TEACHER - 1]), student: String(r[COL.STUDENT - 1]), location: String(r[COL.LOCATION - 1]),
        cancelled: r[COL.STATUS - 1] === STATUS_CANCELLED, shown: Number(r[COL.SHOWN - 1]) || 0
      };
    });
  }
  var cfg = config_();
  var keys = [];
  for (var g = 1; g <= cfg.grades; g++) for (var c = 1; c <= cfg.classes; c++) keys.push('seen:' + g + '-' + c);
  var all = CacheService.getScriptCache().getAll(keys);
  var now = Date.now(), limit = onlineWindowMs_(cfg), online = {};
  Object.keys(all).forEach(function (k) {
    var seen = JSON.parse(all[k]);
    var count = Object.keys(seen).filter(function (d) { return now - seen[d] <= limit; }).length;
    if (count) online[k.slice(5)] = count;
  });
  return { items: items, online: online, freshMs: FRESH_MS };
}

/** 교사용 키 확인만 (설정 화면에서 키를 입력했을 때). */
function checkTeacherKey(teacherKey) {
  requireTeacher_(teacherKey);
  return true;
}

// ───────────────────────── 내부 도우미 ─────────────────────────

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
  return sheet;
}

function loadConfig_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  function num(k, min, max) { var n = parseInt(p[k] || DEFAULTS[k], 10); return Math.min(max, Math.max(min, isNaN(n) ? parseInt(DEFAULTS[k], 10) : n)); }
  var hours = HOURS_RE.exec(String(p.ACTIVE_HOURS || '').replace(/\s/g, '')) || HOURS_RE.exec(DEFAULTS.ACTIVE_HOURS);
  return {
    activeStart: hours[1] + ':' + hours[2],
    activeEnd: hours[3] + ':' + hours[4],
    teacherKey: p.TEACHER_KEY || '',
    deviceKey: p.DEVICE_KEY || '',
    grades: num('GRADES', 1, 6),
    classes: num('CLASSES', 1, 20),
    pollSeconds: num('POLL_SECONDS', 3, 60),
    keepDays: num('KEEP_DAYS', 1, 365),
    locations: String(p.LOCATIONS || DEFAULTS.LOCATIONS).split(',').map(function (s) { return s.trim(); }).filter(String)
  };
}

/** 설정은 캐시에서 읽는다 (확인 요청마다 PropertiesService를 읽지 않도록). */
function config_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('config');
  if (hit) return JSON.parse(hit);
  var cfg = loadConfig_();
  cache.put('config', JSON.stringify(cfg), CONFIG_TTL);
  return cfg;
}

function lastId_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('lastId');
  if (hit !== null && hit !== undefined) return parseInt(hit, 10);
  var id = parseInt(PropertiesService.getScriptProperties().getProperty('NEXT_ID') || '1', 10) - 1;
  cache.put('lastId', String(id), CACHE_TTL);
  return id;
}

/**
 * 반별 최근 호출 목록 (FRESH_MS 이내). 캐시가 비어 있으면 시트 끝부분에서 다시 만든다.
 * 다시 만드는 동안 새 호출이 저장되면 덮어쓸 수 있으므로 재구성은 잠금 안에서만 한다.
 * 이미 잠금을 잡은 호출자는 locked=true로 부른다.
 */
function classCalls_(classId, locked) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('calls:' + classId);
  if (hit) return JSON.parse(hit);
  if (!locked) return withLock_(function () { return classCalls_(classId, true); });
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  var list = [];
  if (last >= 2) {
    var n = Math.min(200, last - 1);
    var cutoff = Date.now() - FRESH_MS;
    sheet.getRange(last - n + 1, 1, n, HEADERS.length).getValues().forEach(function (r) {
      var sentAt = new Date(r[COL.TIME - 1]).getTime();
      if (String(r[COL.CLASS - 1]) !== classId || sentAt < cutoff) return;
      list.push({
        id: Number(r[COL.ID - 1]), classId: classId, teacher: String(r[COL.TEACHER - 1]), student: String(r[COL.STUDENT - 1]),
        location: String(r[COL.LOCATION - 1]), sentAt: sentAt, cancelled: r[COL.STATUS - 1] === STATUS_CANCELLED
      });
    });
  }
  putClassCalls_(classId, list);
  return list;
}

function putClassCalls_(classId, list) {
  var cutoff = Date.now() - FRESH_MS;
  var trimmed = list.filter(function (c) { return c.sentAt >= cutoff; }).slice(-30);
  CacheService.getScriptCache().put('calls:' + classId, JSON.stringify(trimmed), CACHE_TTL);
}

function findRow_(id) {
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < 2 || !(id > 0)) return 0;
  var hit = sheet.getRange(2, COL.ID, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function lastIdInSheet_(sheet) {
  var last = sheet.getLastRow();
  return last >= 2 ? Number(sheet.getRange(last, COL.ID).getValue()) || 0 : 0;
}

/** 지금(한국 시간)이 운영 시간 [시작, 끝) 안인지. */
function isActiveNow_(cfg) {
  var now = minutes_(Utilities.formatDate(new Date(), TIME_ZONE, 'HH:mm'));
  var start = minutes_(cfg.activeStart), end = minutes_(cfg.activeEnd);
  return start <= end ? (now >= start && now < end) : (now >= start || now < end);
}

function minutes_(hhmm) { var p = hhmm.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }

function onlineWindowMs_(cfg) { return Math.max(30, cfg.pollSeconds * 3) * 1000; }

function onlineCount_(classId) {
  var cfg = config_();
  var seen = JSON.parse(CacheService.getScriptCache().get('seen:' + classId) || '{}');
  var now = Date.now(), limit = onlineWindowMs_(cfg);
  return Object.keys(seen).filter(function (d) { return now - seen[d] <= limit; }).length;
}

function requireTeacher_(key) {
  if (!safeEqual_(key, config_().teacherKey)) throw new Error('교사용 키가 올바르지 않습니다.');
}

function safeEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!b || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function newKey_() { return Utilities.getUuid().replace(/-/g, ''); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

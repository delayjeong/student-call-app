/**
 * 학생 호출·전달 시스템 — Google Apps Script 서버
 *
 * - 교사용 웹: 웹앱 주소를 열면 호출/전달 화면이 나온다.
 * - 전자칠판 APK: 웹앱 주소?action=poll&classId=1-5&deviceId=...&key=...&after=...&acked=...
 * - 특정 반 전달: classId=1-3
 * - 학년 전체 전달: 내부 대상 1-* / 2-* / 3-* (각 반 수신기가 함께 받음)
 */

var SHEET_NAME = '호출기록';
var HEADERS = ['번호', '보낸 시각', '반/대상', '선생님', '학생', '위치', '상태', '표시 대수', '유형', '전달사항'];
var COL = { ID: 1, TIME: 2, CLASS: 3, TEACHER: 4, STUDENT: 5, LOCATION: 6, STATUS: 7, SHOWN: 8, TYPE: 9, MESSAGE: 10 };
var TYPE_CALL = 'call';
var TYPE_NOTICE = 'notice';
var STATUS_CALLED = '호출';
var STATUS_NOTICE = '전달';
var STATUS_CANCELLED = '취소';

var DEFAULTS = {
  CLASS_COUNTS: '5,5,4',
  POLL_SECONDS: '10',
  KEEP_DAYS: '7',
  ACTIVE_HOURS: '08:00-22:00',
  LOCATIONS: '교무실,행정실,상담실,보건실,과학실'
};

var FRESH_MS = 3 * 60 * 1000;
var CACHE_TTL = 6 * 60 * 60;
var CONFIG_TTL = 10 * 60;
var CLASS_ID_RE = /^[1-9][0-9]?-[1-9][0-9]?$/;
var GRADE_TARGET_RE = /^[1-9][0-9]?-\*$/;
var MAX_DEVICE_ID_LENGTH = 64;
var MAX_LEN = { teacher: 30, student: 30, location: 40, message: 200 };
var TIME_ZONE = 'Asia/Seoul';
var HOURS_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])-([01][0-9]|2[0-3]):([0-5][0-9])$/;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('학생 호출')
    .addItem('초기 설정 (처음 한 번)', 'setup')
    .addItem('키 보기', 'showKeys')
    .addItem('키 새로 만들기', 'regenerateKeys')
    .addItem('설정 변경 반영 (캐시 비우기)', 'clearCaches')
    .addToUi();
}

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

function clearCaches() {
  var cfg = loadConfig_();
  var keys = ['config', 'lastId'];
  for (var g = 1; g <= cfg.classCounts.length; g++) {
    keys.push('calls:' + g + '-*');
    for (var c = 1; c <= cfg.classCounts[g - 1]; c++) keys.push('calls:' + g + '-' + c);
  }
  CacheService.getScriptCache().removeAll(keys);
}

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

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'poll') return json_(handlePoll_(p));
  if (p.action) return json_({ ok: false, error: 'unknown action' });
  return HtmlService.createHtmlOutputFromFile('Teacher')
    .setTitle('학생 호출')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function handlePoll_(p) {
  var cfg = config_();
  if (!safeEqual_(p.key, cfg.deviceKey)) return { ok: false, error: 'invalid key' };
  var classId = String(p.classId || '').trim();
  if (!validExactClass_(classId, cfg)) return { ok: false, error: 'invalid classId' };
  var deviceId = String(p.deviceId || '').trim();
  if (!deviceId || deviceId.length > MAX_DEVICE_ID_LENGTH) return { ok: false, error: 'deviceId is required' };
  if (p.acked) recordAcks_(classId, deviceId, String(p.acked).split(','));
  markSeen_(classId, deviceId, cfg);
  var base = { ok: true, lastId: lastId_(), pollSeconds: cfg.pollSeconds, activeStart: cfg.activeStart, activeEnd: cfg.activeEnd };
  var after = parseInt(p.after, 10);
  if (isNaN(after)) { base.calls = []; base.cancelled = []; return base; }
  var gradeTarget = classId.split('-')[0] + '-*';
  var now = Date.now();
  var recent = classCalls_(classId).concat(classCalls_(gradeTarget));
  recent.sort(function (a, b) { return a.id - b.id; });
  var seenIds = {};
  base.calls = recent.filter(function (c) {
      if (seenIds[c.id]) return false;
      seenIds[c.id] = true;
      return c.id > after && !c.cancelled && now - c.sentAt < FRESH_MS;
    })
    .map(function (c) {
      return { id: c.id, classId: c.classId, type: c.type || TYPE_CALL, teacher: c.teacher,
        student: c.student || '', location: c.location || '', message: c.message || '', sentAt: c.sentAt };
    });
  base.cancelled = recent.filter(function (c) { return c.cancelled; }).map(function (c) { return c.id; })
    .filter(function (id, i, a) { return a.indexOf(id) === i; });
  return base;
}

function recordAcks_(classId, deviceId, rawIds) {
  var ids = rawIds.map(function (s) { return parseInt(s, 10); }).filter(function (n) { return n > 0; }).slice(0, 20);
  if (!ids.length) return;
  withLock_(function () {
    var cache = CacheService.getScriptCache();
    var known = {};
    var gradeTarget = classId.split('-')[0] + '-*';
    classCalls_(classId, true).concat(classCalls_(gradeTarget, true)).forEach(function (c) { known[c.id] = true; });
    ids.forEach(function (id) {
      if (!known[id]) return;
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

function markSeen_(classId, deviceId, cfg) {
  var cache = CacheService.getScriptCache();
  var key = 'seen:' + classId;
  var seen = JSON.parse(cache.get(key) || '{}');
  var now = Date.now();
  if (seen[deviceId] && now - seen[deviceId] < cfg.pollSeconds * 500) return;
  seen[deviceId] = now;
  var limit = onlineWindowMs_(cfg);
  Object.keys(seen).forEach(function (d) { if (now - seen[d] > limit) delete seen[d]; });
  cache.put(key, JSON.stringify(seen), CACHE_TTL);
}

function getConfig() {
  var cfg = config_();
  return { classCounts: cfg.classCounts, locations: cfg.locations, pollSeconds: cfg.pollSeconds,
    activeStart: cfg.activeStart, activeEnd: cfg.activeEnd, activeNow: isActiveNow_(cfg) };
}

function callStudent(teacherKey, data) {
  requireTeacher_(teacherKey);
  data = data || {};
  var cfg = config_();
  var classId = String(data.classId || '').trim();
  var teacher = String(data.teacher || '').trim();
  var student = String(data.student || '').trim();
  var location = String(data.location || '').trim();
  if (!validExactClass_(classId, cfg)) throw new Error('반 선택이 올바르지 않습니다.');
  if (!teacher || !student || !location) throw new Error('선생님 이름, 학생 이름, 위치를 모두 입력해 주세요.');
  if (teacher.length > MAX_LEN.teacher || student.length > MAX_LEN.student || location.length > MAX_LEN.location) throw new Error('입력이 너무 깁니다.');
  requireActive_(cfg);
  return appendItem_(classId, TYPE_CALL, teacher, student, location, '');
}

function sendNotice(teacherKey, data) {
  requireTeacher_(teacherKey);
  data = data || {};
  var cfg = config_();
  var target = String(data.target || data.classId || '').trim();
  var teacher = String(data.teacher || '').trim();
  var message = String(data.message || '').trim();
  if (!validTarget_(target, cfg)) throw new Error('전달 대상이 올바르지 않습니다.');
  if (!teacher || !message) throw new Error('선생님 이름과 전달사항을 입력해 주세요.');
  if (teacher.length > MAX_LEN.teacher || message.length > MAX_LEN.message) throw new Error('전달사항은 ' + MAX_LEN.message + '자 이내로 입력해 주세요.');
  requireActive_(cfg);
  return appendItem_(target, TYPE_NOTICE, teacher, '', '', message);
}

function appendItem_(target, type, teacher, student, location, message) {
  return withLock_(function () {
    var list = classCalls_(target, true);
    var props = PropertiesService.getScriptProperties();
    var id = parseInt(props.getProperty('NEXT_ID') || '1', 10);
    props.setProperty('NEXT_ID', String(id + 1));
    var now = new Date();
    var status = type === TYPE_NOTICE ? STATUS_NOTICE : STATUS_CALLED;
    getSheet_().appendRow([id, now, target, teacher, student, location, status, 0, type, message]);
    var item = { id: id, classId: target, type: type, teacher: teacher, student: student, location: location,
      message: message, sentAt: now.getTime(), cancelled: false };
    putClassCalls_(target, list.concat([item]));
    CacheService.getScriptCache().put('lastId', String(id), CACHE_TTL);
    return { id: id, onlineDevices: onlineCountTarget_(target) };
  });
}

function cancelCall(teacherKey, id) {
  requireTeacher_(teacherKey);
  id = parseInt(id, 10);
  return withLock_(function () {
    var row = findRow_(id);
    if (!row) throw new Error('기록을 찾을 수 없습니다.');
    var sheet = getSheet_();
    var target = String(sheet.getRange(row, COL.CLASS).getValue());
    sheet.getRange(row, COL.STATUS).setValue(STATUS_CANCELLED);
    var list = classCalls_(target, true);
    list.forEach(function (c) { if (c.id === id) c.cancelled = true; });
    putClassCalls_(target, list);
    return { ok: true };
  });
}

function getDashboard(teacherKey) {
  requireTeacher_(teacherKey);
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  var items = [];
  if (last >= 2) {
    var n = Math.min(20, last - 1);
    var rows = sheet.getRange(last - n + 1, 1, n, HEADERS.length).getValues();
    items = rows.reverse().map(rowToItem_);
  }
  var cfg = config_();
  var keys = [];
  for (var g = 1; g <= cfg.classCounts.length; g++) {
    for (var c = 1; c <= cfg.classCounts[g - 1]; c++) keys.push('seen:' + g + '-' + c);
  }
  var all = CacheService.getScriptCache().getAll(keys);
  var now = Date.now(), limit = onlineWindowMs_(cfg), online = {}, gradeOnline = {};
  Object.keys(all).forEach(function (k) {
    var seen = JSON.parse(all[k]);
    var ids = Object.keys(seen).filter(function (d) { return now - seen[d] <= limit; });
    if (!ids.length) return;
    var classId = k.slice(5);
    online[classId] = ids.length;
    var grade = classId.split('-')[0];
    if (!gradeOnline[grade]) gradeOnline[grade] = {};
    ids.forEach(function (id) { gradeOnline[grade][id] = true; });
  });
  Object.keys(gradeOnline).forEach(function (g) { gradeOnline[g] = Object.keys(gradeOnline[g]).length; });
  return { items: items, online: online, gradeOnline: gradeOnline, freshMs: FRESH_MS };
}

function checkTeacherKey(teacherKey) { requireTeacher_(teacherKey); return true; }

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.setFrozenRows(1);
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  return sheet;
}

function rowToItem_(r) {
  var type = String(r[COL.TYPE - 1] || TYPE_CALL);
  return {
    id: Number(r[COL.ID - 1]), sentAt: new Date(r[COL.TIME - 1]).getTime(), classId: String(r[COL.CLASS - 1]),
    type: type, teacher: String(r[COL.TEACHER - 1]), student: String(r[COL.STUDENT - 1] || ''),
    location: String(r[COL.LOCATION - 1] || ''), message: String(r[COL.MESSAGE - 1] || ''),
    cancelled: r[COL.STATUS - 1] === STATUS_CANCELLED, shown: Number(r[COL.SHOWN - 1]) || 0
  };
}

function loadConfig_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  function num(k, min, max) {
    var n = parseInt(p[k] || DEFAULTS[k], 10);
    return Math.min(max, Math.max(min, isNaN(n) ? parseInt(DEFAULTS[k], 10) : n));
  }
  var hours = HOURS_RE.exec(String(p.ACTIVE_HOURS || '').replace(/\s/g, '')) || HOURS_RE.exec(DEFAULTS.ACTIVE_HOURS);
  var counts = String(p.CLASS_COUNTS || DEFAULTS.CLASS_COUNTS).split(',').map(function (s) {
    var n = parseInt(s, 10); return isNaN(n) ? 1 : Math.max(1, Math.min(20, n));
  }).slice(0, 6);
  if (!counts.length) counts = [5, 5, 4];
  return {
    activeStart: hours[1] + ':' + hours[2], activeEnd: hours[3] + ':' + hours[4],
    teacherKey: p.TEACHER_KEY || '', deviceKey: p.DEVICE_KEY || '', classCounts: counts,
    pollSeconds: num('POLL_SECONDS', 3, 60), keepDays: num('KEEP_DAYS', 1, 365),
    locations: String(p.LOCATIONS || DEFAULTS.LOCATIONS).split(',').map(function (s) { return s.trim(); }).filter(String)
  };
}

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

function classCalls_(target, locked) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('calls:' + target);
  if (hit) return JSON.parse(hit);
  if (!locked) return withLock_(function () { return classCalls_(target, true); });
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  var list = [];
  if (last >= 2) {
    var n = Math.min(300, last - 1);
    var cutoff = Date.now() - FRESH_MS;
    sheet.getRange(last - n + 1, 1, n, HEADERS.length).getValues().forEach(function (r) {
      var sentAt = new Date(r[COL.TIME - 1]).getTime();
      if (String(r[COL.CLASS - 1]) !== target || sentAt < cutoff) return;
      var item = rowToItem_(r);
      list.push({ id: item.id, classId: target, type: item.type, teacher: item.teacher, student: item.student,
        location: item.location, message: item.message, sentAt: sentAt, cancelled: item.cancelled });
    });
  }
  putClassCalls_(target, list);
  return list;
}

function putClassCalls_(target, list) {
  var cutoff = Date.now() - FRESH_MS;
  var trimmed = list.filter(function (c) { return c.sentAt >= cutoff; }).slice(-50);
  CacheService.getScriptCache().put('calls:' + target, JSON.stringify(trimmed), CACHE_TTL);
}

function findRow_(id) {
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < 2 || !(id > 0)) return 0;
  var hit = sheet.getRange(2, COL.ID, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}
function lastIdInSheet_(sheet) { var last = sheet.getLastRow(); return last >= 2 ? Number(sheet.getRange(last, COL.ID).getValue()) || 0 : 0; }
function isActiveNow_(cfg) { var now = minutes_(Utilities.formatDate(new Date(), TIME_ZONE, 'HH:mm')); var start = minutes_(cfg.activeStart), end = minutes_(cfg.activeEnd); return start <= end ? (now >= start && now < end) : (now >= start || now < end); }
function requireActive_(cfg) { if (!isActiveNow_(cfg)) throw new Error('운영 시간(' + cfg.activeStart + '~' + cfg.activeEnd + ')이 아니라 전자칠판에 표시되지 않습니다.'); }
function minutes_(hhmm) { var p = hhmm.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
function onlineWindowMs_(cfg) { return Math.max(30, cfg.pollSeconds * 3) * 1000; }
function onlineCountClass_(classId) { var cfg = config_(); var seen = JSON.parse(CacheService.getScriptCache().get('seen:' + classId) || '{}'); var now = Date.now(), limit = onlineWindowMs_(cfg); return Object.keys(seen).filter(function (d) { return now - seen[d] <= limit; }).length; }
function onlineCountTarget_(target) {
  if (CLASS_ID_RE.test(target)) return onlineCountClass_(target);
  var cfg = config_(); var grade = parseInt(target.split('-')[0], 10); if (!(grade >= 1 && grade <= cfg.classCounts.length)) return 0;
  var ids = {};
  for (var c = 1; c <= cfg.classCounts[grade - 1]; c++) {
    var classId = grade + '-' + c; var seen = JSON.parse(CacheService.getScriptCache().get('seen:' + classId) || '{}'); var now = Date.now(), limit = onlineWindowMs_(cfg);
    Object.keys(seen).forEach(function (d) { if (now - seen[d] <= limit) ids[d] = true; });
  }
  return Object.keys(ids).length;
}
function validExactClass_(classId, cfg) { if (!CLASS_ID_RE.test(classId)) return false; var p = classId.split('-'), g = parseInt(p[0], 10), c = parseInt(p[1], 10); return g >= 1 && g <= cfg.classCounts.length && c >= 1 && c <= cfg.classCounts[g - 1]; }
function validTarget_(target, cfg) { if (validExactClass_(target, cfg)) return true; if (!GRADE_TARGET_RE.test(target)) return false; var g = parseInt(target.split('-')[0], 10); return g >= 1 && g <= cfg.classCounts.length; }
function requireTeacher_(key) { if (!safeEqual_(key, config_().teacherKey)) throw new Error('교사용 키가 올바르지 않습니다.'); }
function safeEqual_(a, b) { a = String(a || ''); b = String(b || ''); if (!b || a.length !== b.length) return false; var diff = 0; for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function withLock_(fn) { var lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) throw new Error('요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); try { return fn(); } finally { lock.releaseLock(); } }
function newKey_() { return Utilities.getUuid().replace(/-/g, ''); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

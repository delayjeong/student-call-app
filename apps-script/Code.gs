/**
 * 학생 호출·전달 시스템 — Google Apps Script 서버
 * - 학생 호출/전달: 특정 반 또는 학년 전체
 * - 예약 전송: 예약전송 시트 + 1분 주기 트리거
 */
var SHEET_NAME = '호출기록';
var SCHEDULE_SHEET_NAME = '예약전송';
var HEADERS = ['번호', '보낸 시각', '반/대상', '선생님', '학생', '위치', '상태', '표시 대수', '유형', '전달사항'];
var SCHEDULE_HEADERS = ['예약번호', '예약 시각', '대상', '유형', '선생님', '학생', '위치', '전달사항', '상태', '생성 시각', '전송 시각'];
var COL = { ID: 1, TIME: 2, CLASS: 3, TEACHER: 4, STUDENT: 5, LOCATION: 6, STATUS: 7, SHOWN: 8, TYPE: 9, MESSAGE: 10 };
var SCOL = { ID: 1, TIME: 2, TARGET: 3, TYPE: 4, TEACHER: 5, STUDENT: 6, LOCATION: 7, MESSAGE: 8, STATUS: 9, CREATED: 10, SENT: 11 };
var TYPE_CALL = 'call', TYPE_NOTICE = 'notice';
var STATUS_CALLED = '호출', STATUS_NOTICE = '전달', STATUS_CANCELLED = '취소';
var SCHEDULE_PENDING = '예약', SCHEDULE_SENT = '전송완료', SCHEDULE_CANCELLED = '취소';
var DEFAULTS = { CLASS_COUNTS: '5,5,4', POLL_SECONDS: '10', KEEP_DAYS: '7', ACTIVE_HOURS: '08:00-22:00' };
var FRESH_MS = 3 * 60 * 1000, CACHE_TTL = 6 * 60 * 60, CONFIG_TTL = 10 * 60;
var CLASS_ID_RE = /^[1-9][0-9]?-[1-9][0-9]?$/, GRADE_TARGET_RE = /^[1-9][0-9]?-\*$/;
var SCHEDULE_AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
var MAX_DEVICE_ID_LENGTH = 64, MAX_LEN = { teacher: 30, student: 30, location: 40, message: 200 };
var TIME_ZONE = 'Asia/Seoul', KST_OFFSET_MS = 9 * 60 * 60 * 1000;
var HOURS_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])-([01][0-9]|2[0-3]):([0-5][0-9])$/;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('학생 호출')
    .addItem('초기 설정 (처음 한 번)', 'setup')
    .addItem('키 보기', 'showKeys')
    .addItem('키 새로 만들기', 'regenerateKeys')
    .addItem('설정 변경 반영 (캐시 비우기)', 'clearCaches')
    .addToUi();
}

function setup() {
  var sheet = getSheet_();
  getScheduleSheet_();
  var props = PropertiesService.getScriptProperties(), current = props.getProperties(), updates = {};
  Object.keys(DEFAULTS).forEach(function (k) { if (!current[k]) updates[k] = DEFAULTS[k]; });
  if (!current.TEACHER_KEY) updates.TEACHER_KEY = newKey_();
  if (!current.DEVICE_KEY) updates.DEVICE_KEY = newKey_();
  if (!current.NEXT_ID) updates.NEXT_ID = String(lastIdInSheet_(sheet) + 1);
  if (!current.NEXT_SCHEDULE_ID) updates.NEXT_SCHEDULE_ID = String(lastScheduleId_() + 1);
  props.setProperties(updates);
  ensureTrigger_('cleanupOldRows', function (t) { return t.timeBased().everyDays(1).atHour(3); });
  ensureTrigger_('processScheduledItems', function (t) { return t.timeBased().everyMinutes(1); });
  clearCaches();
  showKeys();
}

function ensureTrigger_(handler, build) {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === handler; });
  if (!exists) build(ScriptApp.newTrigger(handler)).create();
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
  repairStoredTargets_();
  var cfg = loadConfig_(), keys = ['config', 'lastId'];
  for (var g = 1; g <= cfg.classCounts.length; g++) {
    keys.push('calls:' + g + '-*');
    for (var c = 1; c <= cfg.classCounts[g - 1]; c++) keys.push('calls:' + g + '-' + c);
  }
  CacheService.getScriptCache().removeAll(keys);
}

function cleanupOldRows() {
  var sheet = getSheet_(), cfg = config_(), last = sheet.getLastRow();
  if (last >= 2) {
    var cutoff = Date.now() - cfg.keepDays * 24 * 60 * 60 * 1000;
    var times = sheet.getRange(2, COL.TIME, last - 1, 1).getValues(), n = 0;
    while (n < times.length && new Date(times[n][0]).getTime() < cutoff) n++;
    if (n > 0) sheet.deleteRows(2, n);
  }
  cleanupOldSchedules_();
}

function cleanupOldSchedules_() {
  var sheet = getScheduleSheet_(), last = sheet.getLastRow();
  if (last < 2) return;
  var cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  var rows = sheet.getRange(2, 1, last - 1, SCHEDULE_HEADERS.length).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    var status = String(rows[i][SCOL.STATUS - 1] || '');
    var basis = new Date(rows[i][SCOL.SENT - 1] || rows[i][SCOL.CREATED - 1]).getTime();
    if (status !== SCHEDULE_PENDING && basis && basis < cutoff) sheet.deleteRows(i + 2, 1);
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'poll') return json_(handlePoll_(p));
  if (p.action) return json_({ ok: false, error: 'unknown action' });
  return HtmlService.createHtmlOutputFromFile('Teacher').setTitle('학생 호출').addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
  var gradeTarget = classId.split('-')[0] + '-*', now = Date.now();
  var recent = classCalls_(classId).concat(classCalls_(gradeTarget));
  recent.sort(function (a, b) { return a.id - b.id; });
  var seenIds = {};
  base.calls = recent.filter(function (c) {
    if (seenIds[c.id]) return false;
    seenIds[c.id] = true;
    return c.id > after && !c.cancelled && now - c.sentAt < FRESH_MS;
  }).map(function (c) {
    return { id: c.id, classId: c.classId, type: c.type || TYPE_CALL, teacher: c.teacher, student: c.student || '', location: c.location || '', message: c.message || '', sentAt: c.sentAt };
  });
  base.cancelled = recent.filter(function (c) { return c.cancelled; }).map(function (c) { return c.id; }).filter(function (id, i, a) { return a.indexOf(id) === i; });
  return base;
}

function recordAcks_(classId, deviceId, rawIds) {
  var ids = rawIds.map(function (s) { return parseInt(s, 10); }).filter(function (n) { return n > 0; }).slice(0, 20);
  if (!ids.length) return;
  withLock_(function () {
    var cache = CacheService.getScriptCache(), known = {}, gradeTarget = classId.split('-')[0] + '-*';
    classCalls_(classId, true).concat(classCalls_(gradeTarget, true)).forEach(function (c) { known[c.id] = true; });
    ids.forEach(function (id) {
      if (!known[id]) return;
      var key = 'acks:' + id, devices = JSON.parse(cache.get(key) || '[]');
      if (devices.indexOf(deviceId) >= 0) return;
      devices.push(deviceId);
      cache.put(key, JSON.stringify(devices), CACHE_TTL);
      var row = findRow_(id);
      if (row) getSheet_().getRange(row, COL.SHOWN).setValue(devices.length);
    });
  });
}

function markSeen_(classId, deviceId, cfg) {
  var cache = CacheService.getScriptCache(), key = 'seen:' + classId, seen = JSON.parse(cache.get(key) || '{}'), now = Date.now();
  if (seen[deviceId] && now - seen[deviceId] < cfg.pollSeconds * 500) return;
  seen[deviceId] = now;
  var limit = onlineWindowMs_(cfg);
  Object.keys(seen).forEach(function (d) { if (now - seen[d] > limit) delete seen[d]; });
  cache.put(key, JSON.stringify(seen), CACHE_TTL);
}

function getConfig() {
  var cfg = config_();
  return { classCounts: cfg.classCounts, pollSeconds: cfg.pollSeconds, activeStart: cfg.activeStart, activeEnd: cfg.activeEnd, activeNow: isActiveNow_(cfg) };
}

function callStudent(teacherKey, data) {
  requireTeacher_(teacherKey);
  data = normalizeItemData_(data, TYPE_CALL);
  requireActive_(config_());
  return appendItem_(data.target, TYPE_CALL, data.teacher, data.student, data.location, '');
}

function sendNotice(teacherKey, data) {
  requireTeacher_(teacherKey);
  data = normalizeItemData_(data, TYPE_NOTICE);
  requireActive_(config_());
  return appendItem_(data.target, TYPE_NOTICE, data.teacher, '', '', data.message);
}

function normalizeItemData_(data, type) {
  data = data || {};
  var cfg = config_();
  var target = String(data.target || data.classId || '').trim();
  var teacher = String(data.teacher || '').trim();
  var student = String(data.student || '').trim();
  var location = String(data.location || '').trim();
  var message = String(data.message || '').trim();
  if (!validTarget_(target, cfg)) throw new Error('대상 선택이 올바르지 않습니다.');
  if (!teacher) throw new Error('선생님 이름을 입력해 주세요.');
  if (teacher.length > MAX_LEN.teacher) throw new Error('선생님 이름이 너무 깁니다.');
  if (type === TYPE_CALL) {
    if (!student || !location) throw new Error('학생 이름과 호출 위치를 모두 입력해 주세요.');
    if (student.length > MAX_LEN.student || location.length > MAX_LEN.location) throw new Error('입력이 너무 깁니다.');
    return { target: target, type: type, teacher: teacher, student: student, location: location, message: '' };
  }
  if (type === TYPE_NOTICE) {
    if (!message) throw new Error('전달사항을 입력해 주세요.');
    if (message.length > MAX_LEN.message) throw new Error('전달사항은 ' + MAX_LEN.message + '자 이내로 입력해 주세요.');
    return { target: target, type: type, teacher: teacher, student: '', location: '', message: message };
  }
  throw new Error('유형이 올바르지 않습니다.');
}

function appendItem_(target, type, teacher, student, location, message) {
  return withLock_(function () {
    var list = classCalls_(target, true), props = PropertiesService.getScriptProperties();
    var id = parseInt(props.getProperty('NEXT_ID') || '1', 10);
    props.setProperty('NEXT_ID', String(id + 1));
    var now = new Date(), status = type === TYPE_NOTICE ? STATUS_NOTICE : STATUS_CALLED;
    appendRowWithTextTarget_(getSheet_(), [id, now, target, teacher, student, location, status, 0, type, message], COL.CLASS);
    var item = { id: id, classId: target, type: type, teacher: teacher, student: student, location: location, message: message, sentAt: now.getTime(), cancelled: false };
    putClassCalls_(target, list.concat([item]));
    CacheService.getScriptCache().put('lastId', String(id), CACHE_TTL);
    return { id: id, onlineDevices: onlineCountTarget_(target) };
  });
}

function createSchedule(teacherKey, data) {
  requireTeacher_(teacherKey);
  var type = String((data && data.type) || '').trim();
  var item = normalizeItemData_(data, type), schedule = validateScheduleAt_(data && data.scheduleAt);
  return withLock_(function () {
    var props = PropertiesService.getScriptProperties(), id = parseInt(props.getProperty('NEXT_SCHEDULE_ID') || '1', 10);
    props.setProperty('NEXT_SCHEDULE_ID', String(id + 1));
    appendRowWithTextTarget_(getScheduleSheet_(), [id, new Date(schedule.ms), item.target, item.type, item.teacher, item.student, item.location, item.message, SCHEDULE_PENDING, new Date(), ''], SCOL.TARGET);
    return { id: id, scheduleAt: schedule.local };
  });
}

function updateSchedule(teacherKey, id, data) {
  requireTeacher_(teacherKey);
  id = parseInt(id, 10);
  var row = findScheduleRow_(id);
  if (!row) throw new Error('예약을 찾을 수 없습니다.');
  var sheet = getScheduleSheet_();
  if (String(sheet.getRange(row, SCOL.STATUS).getValue()) !== SCHEDULE_PENDING) throw new Error('이미 처리된 예약은 수정할 수 없습니다.');
  var type = String((data && data.type) || '').trim();
  var item = normalizeItemData_(data, type), schedule = validateScheduleAt_(data && data.scheduleAt);
  var created = sheet.getRange(row, SCOL.CREATED).getValue() || new Date();
  setRowWithTextTarget_(sheet, row, [id, new Date(schedule.ms), item.target, item.type, item.teacher, item.student, item.location, item.message, SCHEDULE_PENDING, created, ''], SCOL.TARGET);
  return { id: id, scheduleAt: schedule.local };
}

function cancelSchedule(teacherKey, id) {
  requireTeacher_(teacherKey);
  id = parseInt(id, 10);
  var row = findScheduleRow_(id);
  if (!row) throw new Error('예약을 찾을 수 없습니다.');
  var sheet = getScheduleSheet_();
  if (String(sheet.getRange(row, SCOL.STATUS).getValue()) !== SCHEDULE_PENDING) throw new Error('이미 처리된 예약입니다.');
  sheet.getRange(row, SCOL.STATUS).setValue(SCHEDULE_CANCELLED);
  return { ok: true };
}

function getSchedules(teacherKey) {
  requireTeacher_(teacherKey);
  var sheet = getScheduleSheet_(), last = sheet.getLastRow();
  if (last < 2) return [];
  var cfg = config_();
  return sheet.getRange(2, 1, last - 1, SCHEDULE_HEADERS.length).getValues()
    .filter(function (r) { return String(r[SCOL.STATUS - 1]) === SCHEDULE_PENDING; })
    .map(function (r) { return scheduleRowToItem_(r, cfg); })
    .sort(function (a, b) { return a.scheduleAt - b.scheduleAt; })
    .slice(0, 50);
}

function scheduleRowToItem_(r, cfg) {
  var ms = new Date(r[SCOL.TIME - 1]).getTime();
  return {
    id: Number(r[SCOL.ID - 1]), scheduleAt: ms, scheduleLocal: formatKstLocal_(ms),
    target: targetCellValue_(r[SCOL.TARGET - 1], cfg), type: String(r[SCOL.TYPE - 1]), teacher: String(r[SCOL.TEACHER - 1]),
    student: String(r[SCOL.STUDENT - 1] || ''), location: String(r[SCOL.LOCATION - 1] || ''), message: String(r[SCOL.MESSAGE - 1] || ''),
    status: String(r[SCOL.STATUS - 1])
  };
}

function processScheduledItems() {
  var sheet = getScheduleSheet_(), last = sheet.getLastRow();
  if (last < 2) return;
  var rows = sheet.getRange(2, 1, last - 1, SCHEDULE_HEADERS.length).getValues(), now = Date.now(), cfg = config_();
  rows.forEach(function (r, i) {
    if (String(r[SCOL.STATUS - 1]) !== SCHEDULE_PENDING) return;
    var due = new Date(r[SCOL.TIME - 1]).getTime();
    if (!due || due > now) return;
    try {
      var type = String(r[SCOL.TYPE - 1]);
      appendItem_(targetCellValue_(r[SCOL.TARGET - 1], cfg), type, String(r[SCOL.TEACHER - 1]), String(r[SCOL.STUDENT - 1] || ''), String(r[SCOL.LOCATION - 1] || ''), String(r[SCOL.MESSAGE - 1] || ''));
      sheet.getRange(i + 2, SCOL.STATUS).setValue(SCHEDULE_SENT);
      sheet.getRange(i + 2, SCOL.SENT).setValue(new Date());
    } catch (e) { Logger.log('예약 #' + r[SCOL.ID - 1] + ' 전송 실패: ' + e); }
  });
}

function validateScheduleAt_(raw) {
  var s = String(raw || '').trim(), m = SCHEDULE_AT_RE.exec(s);
  if (!m) throw new Error('예약 날짜와 시간을 확인해 주세요.');
  var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], min = +m[5];
  if (h > 23 || min > 59) throw new Error('예약 날짜와 시간을 확인해 주세요.');
  var ms = Date.UTC(y, mo - 1, d, h - 9, min), localCheck = new Date(ms + KST_OFFSET_MS);
  if (localCheck.getUTCFullYear() !== y || localCheck.getUTCMonth() !== mo - 1 || localCheck.getUTCDate() !== d || localCheck.getUTCHours() !== h || localCheck.getUTCMinutes() !== min) throw new Error('예약 날짜와 시간을 확인해 주세요.');
  if (ms <= Date.now()) throw new Error('예약 시각은 현재보다 이후여야 합니다.');
  var cfg = config_();
  if (!isActiveMinutes_(h * 60 + min, cfg)) throw new Error('예약 시각은 운영 시간(' + cfg.activeStart + '~' + cfg.activeEnd + ') 안으로 지정해 주세요.');
  return { ms: ms, local: s };
}

function formatKstLocal_(ms) {
  var d = new Date(ms + KST_OFFSET_MS);
  function p(n) { return String(n).padStart(2, '0'); }
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

function cancelCall(teacherKey, id) {
  requireTeacher_(teacherKey);
  id = parseInt(id, 10);
  return withLock_(function () {
    var row = findRow_(id);
    if (!row) throw new Error('기록을 찾을 수 없습니다.');
    var sheet = getSheet_(), target = targetCellValue_(sheet.getRange(row, COL.CLASS).getValue(), config_());
    sheet.getRange(row, COL.STATUS).setValue(STATUS_CANCELLED);
    var list = classCalls_(target, true);
    list.forEach(function (c) { if (c.id === id) c.cancelled = true; });
    putClassCalls_(target, list);
    return { ok: true };
  });
}

function getDashboard(teacherKey) {
  requireTeacher_(teacherKey);
  var cfg = config_(), sheet = getSheet_(), last = sheet.getLastRow(), items = [];
  if (last >= 2) {
    var n = Math.min(20, last - 1), rows = sheet.getRange(last - n + 1, 1, n, HEADERS.length).getValues();
    items = rows.reverse().map(function (r) { return rowToItem_(r, cfg); });
  }
  var keys = [];
  for (var g = 1; g <= cfg.classCounts.length; g++) for (var c = 1; c <= cfg.classCounts[g - 1]; c++) keys.push('seen:' + g + '-' + c);
  var all = CacheService.getScriptCache().getAll(keys), now = Date.now(), limit = onlineWindowMs_(cfg), online = {}, gradeOnline = {};
  Object.keys(all).forEach(function (k) {
    var seen = JSON.parse(all[k]), ids = Object.keys(seen).filter(function (d) { return now - seen[d] <= limit; });
    if (!ids.length) return;
    var classId = k.slice(5); online[classId] = ids.length;
    var grade = classId.split('-')[0];
    if (!gradeOnline[grade]) gradeOnline[grade] = {};
    ids.forEach(function (id) { gradeOnline[grade][id] = true; });
  });
  Object.keys(gradeOnline).forEach(function (g) { gradeOnline[g] = Object.keys(gradeOnline[g]).length; });
  return { items: items, online: online, gradeOnline: gradeOnline, freshMs: FRESH_MS };
}

function checkTeacherKey(teacherKey) { requireTeacher_(teacherKey); return true; }

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.setFrozenRows(1);
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  return sheet;
}

function getScheduleSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sheet = ss.getSheetByName(SCHEDULE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SCHEDULE_SHEET_NAME);
    sheet.setFrozenRows(1);
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange('J:K').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
  sheet.getRange(1, 1, 1, SCHEDULE_HEADERS.length).setValues([SCHEDULE_HEADERS]).setFontWeight('bold');
  return sheet;
}

function appendRowWithTextTarget_(sheet, values, targetCol) {
  var row = values.slice(), target = String(row[targetCol - 1] == null ? '' : row[targetCol - 1]);
  row[targetCol - 1] = '';
  sheet.appendRow(row);
  var targetCell = sheet.getRange(sheet.getLastRow(), targetCol);
  targetCell.setNumberFormat('@');
  targetCell.setValue(target);
}

function setRowWithTextTarget_(sheet, rowNumber, values, targetCol) {
  var row = values.slice(), target = String(row[targetCol - 1] == null ? '' : row[targetCol - 1]);
  row[targetCol - 1] = '';
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  var targetCell = sheet.getRange(rowNumber, targetCol);
  targetCell.setNumberFormat('@');
  targetCell.setValue(target);
}

function repairStoredTargets_() {
  var cfg = loadConfig_();
  repairTargetColumn_(getSheet_(), COL.CLASS, cfg);
  repairTargetColumn_(getScheduleSheet_(), SCOL.TARGET, cfg);
}

function repairTargetColumn_(sheet, col, cfg) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var range = sheet.getRange(2, col, last - 1, 1), values = range.getValues(), changed = false;
  values.forEach(function (r) {
    var normalized = targetCellValue_(r[0], cfg);
    if (validTarget_(normalized, cfg) && (typeof r[0] !== 'string' || r[0] !== normalized)) {
      r[0] = normalized;
      changed = true;
    }
  });
  range.setNumberFormat('@');
  if (changed) range.setValues(values);
}

function targetCellValue_(value, cfg) {
  cfg = cfg || config_();
  var s = String(value == null ? '' : value).trim();
  if (validTarget_(s, cfg)) return s;
  var isDate = Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime());
  if (isDate) {
    var fromDate = dateToClassTarget_(value, cfg);
    if (fromDate) return fromDate;
  }
  if (/\bGMT[+-]\d{4}\b/.test(s)) {
    var parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      var fromString = dateToClassTarget_(parsed, cfg);
      if (fromString) return fromString;
    }
  }
  return s;
}

function dateToClassTarget_(date, cfg) {
  var md = Utilities.formatDate(date, TIME_ZONE, 'M-d').split('-');
  var candidate = parseInt(md[0], 10) + '-' + parseInt(md[1], 10);
  return validExactClass_(candidate, cfg) ? candidate : '';
}

function rowToItem_(r, cfg) {
  var type = String(r[COL.TYPE - 1] || TYPE_CALL);
  return {
    id: Number(r[COL.ID - 1]), sentAt: new Date(r[COL.TIME - 1]).getTime(), classId: targetCellValue_(r[COL.CLASS - 1], cfg), type: type,
    teacher: String(r[COL.TEACHER - 1]), student: String(r[COL.STUDENT - 1] || ''), location: String(r[COL.LOCATION - 1] || ''),
    message: String(r[COL.MESSAGE - 1] || ''), cancelled: r[COL.STATUS - 1] === STATUS_CANCELLED, shown: Number(r[COL.SHOWN - 1]) || 0
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
  return { activeStart: hours[1] + ':' + hours[2], activeEnd: hours[3] + ':' + hours[4], teacherKey: p.TEACHER_KEY || '', deviceKey: p.DEVICE_KEY || '', classCounts: counts, pollSeconds: num('POLL_SECONDS', 3, 60), keepDays: num('KEEP_DAYS', 1, 365) };
}

function config_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('config');
  if (hit) {
    try {
      var cached = JSON.parse(hit);
      if (cached && Array.isArray(cached.classCounts) && cached.classCounts.length && cached.activeStart && cached.activeEnd && cached.pollSeconds && cached.teacherKey !== undefined && cached.deviceKey !== undefined) return cached;
    } catch (e) {}
    cache.removeAll(['config']);
  }
  var cfg = loadConfig_();
  cache.put('config', JSON.stringify(cfg), CONFIG_TTL);
  return cfg;
}

function lastId_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('lastId');
  if (hit !== null && hit !== undefined) return parseInt(hit, 10);
  var id = parseInt(PropertiesService.getScriptProperties().getProperty('NEXT_ID') || '1', 10) - 1;
  cache.put('lastId', String(id), CACHE_TTL);
  return id;
}

function classCalls_(target, locked) {
  var cache = CacheService.getScriptCache(), hit = cache.get('calls:' + target);
  if (hit) return JSON.parse(hit);
  if (!locked) return withLock_(function () { return classCalls_(target, true); });
  var sheet = getSheet_(), last = sheet.getLastRow(), list = [], cfg = config_();
  if (last >= 2) {
    var n = Math.min(300, last - 1), cutoff = Date.now() - FRESH_MS;
    sheet.getRange(last - n + 1, 1, n, HEADERS.length).getValues().forEach(function (r) {
      var sentAt = new Date(r[COL.TIME - 1]).getTime();
      if (targetCellValue_(r[COL.CLASS - 1], cfg) !== target || sentAt < cutoff) return;
      var item = rowToItem_(r, cfg);
      list.push({ id: item.id, classId: target, type: item.type, teacher: item.teacher, student: item.student, location: item.location, message: item.message, sentAt: sentAt, cancelled: item.cancelled });
    });
  }
  putClassCalls_(target, list);
  return list;
}

function putClassCalls_(target, list) {
  var cutoff = Date.now() - FRESH_MS, trimmed = list.filter(function (c) { return c.sentAt >= cutoff; }).slice(-50);
  CacheService.getScriptCache().put('calls:' + target, JSON.stringify(trimmed), CACHE_TTL);
}

function findRow_(id) {
  var sheet = getSheet_(), last = sheet.getLastRow();
  if (last < 2 || !(id > 0)) return 0;
  var hit = sheet.getRange(2, COL.ID, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function findScheduleRow_(id) {
  var sheet = getScheduleSheet_(), last = sheet.getLastRow();
  if (last < 2 || !(id > 0)) return 0;
  var hit = sheet.getRange(2, SCOL.ID, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function lastIdInSheet_(sheet) { var last = sheet.getLastRow(); return last >= 2 ? Number(sheet.getRange(last, COL.ID).getValue()) || 0 : 0; }
function lastScheduleId_() { var s = getScheduleSheet_(), last = s.getLastRow(); return last >= 2 ? Number(s.getRange(last, SCOL.ID).getValue()) || 0 : 0; }
function isActiveNow_(cfg) { var now = minutes_(Utilities.formatDate(new Date(), TIME_ZONE, 'HH:mm')); return isActiveMinutes_(now, cfg); }
function isActiveMinutes_(now, cfg) { var start = minutes_(cfg.activeStart), end = minutes_(cfg.activeEnd); return start <= end ? (now >= start && now < end) : (now >= start || now < end); }
function requireActive_(cfg) { if (!isActiveNow_(cfg)) throw new Error('운영 시간(' + cfg.activeStart + '~' + cfg.activeEnd + ')이 아니라 전자칠판에 표시되지 않습니다.'); }
function minutes_(hhmm) { var p = hhmm.split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
function onlineWindowMs_(cfg) { return Math.max(30, cfg.pollSeconds * 3) * 1000; }

function onlineCountClass_(classId) {
  var cfg = config_(), seen = JSON.parse(CacheService.getScriptCache().get('seen:' + classId) || '{}'), now = Date.now(), limit = onlineWindowMs_(cfg);
  return Object.keys(seen).filter(function (d) { return now - seen[d] <= limit; }).length;
}

function onlineCountTarget_(target) {
  if (CLASS_ID_RE.test(target)) return onlineCountClass_(target);
  var cfg = config_(), grade = parseInt(target.split('-')[0], 10);
  if (!(grade >= 1 && grade <= cfg.classCounts.length)) return 0;
  var ids = {};
  for (var c = 1; c <= cfg.classCounts[grade - 1]; c++) {
    var classId = grade + '-' + c, seen = JSON.parse(CacheService.getScriptCache().get('seen:' + classId) || '{}'), now = Date.now(), limit = onlineWindowMs_(cfg);
    Object.keys(seen).forEach(function (d) { if (now - seen[d] <= limit) ids[d] = true; });
  }
  return Object.keys(ids).length;
}

function validExactClass_(classId, cfg) {
  if (!CLASS_ID_RE.test(classId)) return false;
  var p = classId.split('-'), g = parseInt(p[0], 10), c = parseInt(p[1], 10);
  return g >= 1 && g <= cfg.classCounts.length && c >= 1 && c <= cfg.classCounts[g - 1];
}

function validTarget_(target, cfg) {
  if (validExactClass_(target, cfg)) return true;
  if (!GRADE_TARGET_RE.test(target)) return false;
  var g = parseInt(target.split('-')[0], 10);
  return g >= 1 && g <= cfg.classCounts.length;
}

function requireTeacher_(key) { if (!safeEqual_(key, config_().teacherKey)) throw new Error('교사용 키가 올바르지 않습니다.'); }
function safeEqual_(a, b) { a = String(a || ''); b = String(b || ''); if (!b || a.length !== b.length) return false; var diff = 0; for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function withLock_(fn) { var lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) throw new Error('요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); try { return fn(); } finally { lock.releaseLock(); } }
function newKey_() { return Utilities.getUuid().replace(/-/g, ''); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

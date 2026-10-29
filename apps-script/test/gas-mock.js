// Apps Script 서비스(SpreadsheetApp, CacheService 등)의 최소 모형.
// Code.gs를 Node에서 그대로 실행해 로직을 검증하기 위한 것이다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

/** 한국 시간 기준 오늘 hh:mm의 epoch ms */
function kst(h, m = 0) { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h - 9, m); }

function load() {
  const state = { now: kst(10), propOps: 0, sheets: {}, cache: new Map(), props: {}, triggers: [] };

  class Range {
    constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
    getValues() { const out = []; for (let r = 0; r < this.nr; r++) { const row = this.sheet.rows[this.row - 1 + r] || []; out.push(Array.from({ length: this.nc }, (_, c) => row[this.col - 1 + c] ?? '')); } return out; }
    setValues(v) { v.forEach((vals, r) => { const i = this.row - 1 + r; this.sheet.rows[i] = this.sheet.rows[i] || []; vals.forEach((x, c) => { this.sheet.rows[i][this.col - 1 + c] = x; }); }); return this; }
    getValue() { return this.getValues()[0][0]; }
    setValue(x) { return this.setValues([[x]]); }
    setFontWeight() { return this; }
    setNumberFormat() { return this; }
    createTextFinder(text) {
      const range = this; let done = false;
      return { matchEntireCell() { return this; }, findNext() {
        if (done) return null; done = true;
        const vals = range.getValues();
        for (let r = 0; r < vals.length; r++) for (let c = 0; c < vals[r].length; c++) if (String(vals[r][c]) === text) { const row = range.row + r; return { getRow: () => row }; }
        return null; } };
    }
  }
  class Sheet {
    constructor() { this.rows = []; }
    getLastRow() { return this.rows.length; }
    getRange(a, b, c, d) { if (typeof a === 'string') return new Range(this, 1, 2, 0, 1); return new Range(this, a, b, c || 1, d || 1); }
    appendRow(r) { this.rows.push(r.slice()); }
    deleteRows(start, n) { this.rows.splice(start - 1, n); }
    setFrozenRows() {}
  }
  const ss = {
    getSheetByName: n => state.sheets[n] || null,
    insertSheet: n => (state.sheets[n] = new Sheet()),
  };
  const cache = {
    get: k => (state.cache.has(k) ? state.cache.get(k) : null),
    put: (k, v) => { if (typeof v !== 'string') throw new Error('cache value must be string'); if (v.length > 100000) throw new Error('cache value too large'); state.cache.set(k, v); },
    getAll: keys => Object.fromEntries(keys.filter(k => state.cache.has(k)).map(k => [k, state.cache.get(k)])),
    removeAll: keys => keys.forEach(k => state.cache.delete(k)),
  };
  const props = {
    getProperties: () => { state.propOps++; return { ...state.props }; },
    getProperty: k => { state.propOps++; return state.props[k] ?? null; },
    setProperty: (k, v) => { state.propOps++; state.props[k] = String(v); },
    setProperties: o => { state.propOps++; Object.entries(o).forEach(([k, v]) => { state.props[k] = String(v); }); },
  };
  const chain = () => new Proxy({}, { get: () => () => chain() });

  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => { throw new Error('no ui'); } },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: { getProjectTriggers: () => state.triggers.map(h => ({ getHandlerFunction: () => h })), newTrigger: h => { state.triggers.push(h); return chain(); } },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => {
        if (tz !== 'Asia/Seoul') throw new Error('unsupported timezone');
        const k = new Date(d.getTime() + 9 * 3600e3);
        if (fmt === 'HH:mm') return String(k.getUTCHours()).padStart(2, '0') + ':' + String(k.getUTCMinutes()).padStart(2, '0');
        if (fmt === 'M-d') return String(k.getUTCMonth() + 1) + '-' + String(k.getUTCDate());
        throw new Error('unsupported format');
      },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutputFromFile: f => ({ file: f, setTitle() { return this; }, addMetaTag() { return this; } }) },
    Logger: { log() {} },
    JSON, Math, Object, String, Number, parseInt, isNaN,
  };
  // 시간은 state.now로 조절한다
  ctx.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super(state.now); } static now() { return state.now; } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return { gas: ctx, state };
}

module.exports = { load, kst };

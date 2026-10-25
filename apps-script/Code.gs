/**
 * Kartičky VŠCHT – backend nad Google Sheetem (stejný princip jako Trénink deník).
 * Nasazení: viz README.md (Rozšíření → Apps Script → vložit tento soubor → spustit setup → Nasadit jako webovou aplikaci).
 *
 * GET  ?action=ping&token=…   → { ok, name, version }
 * GET  ?action=pull&token=…   → { ok, rows: { klic: { json, ts } } }
 * POST {"action":"push","token":…,"rows":[{key,json}]}  → přepíše řádky podle klíče
 *
 * List „Stav“: sloupec A klíč (srs_CHT, srs_MAT, …, meta), B čas zápisu, C… JSON rozdělený po 45 000 znacích
 * (Google Sheets dovolí max. 50 000 znaků v buňce). Slučování karet dělá appka, tady se jen ukládá.
 */

const VERSION = 1;
const SHEET = 'Stav';
const CHUNK = 45000;

/** Spusť jednou ručně: založí list a vygeneruje token (najdeš ho v protokolu provádění). */
function setup() {
  sheet_();
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  Logger.log('TOKEN: ' + token);
}

function doGet(e) {
  return handle_(() => {
    auth_(e.parameter.token);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (e.parameter.action === 'ping') return { name: ss.getName(), version: VERSION };
    if (e.parameter.action === 'pull') {
      const sh = sheet_(), last = sh.getLastRow(), rows = {};
      if (last >= 2) {
        const vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
        vals.forEach(r => { if (r[0]) rows[r[0]] = { ts: String(r[1]), json: r.slice(2).join('') }; });
      }
      return { rows, version: VERSION };
    }
    throw new Error('Neznámá akce');
  });
}

function doPost(e) {
  return handle_(() => {
    const body = JSON.parse(e.postData.contents);
    auth_(body.token);
    if (body.action !== 'push') throw new Error('Neznámá akce');
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = sheet_(), last = sh.getLastRow();
      const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => r[0]) : [];
      const now = new Date().toISOString();
      (body.rows || []).forEach(({ key, json }) => {
        if (!/^(srs_[A-Z]+|meta)$/.test(key)) return;
        const parts = [];
        for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
        let idx = keys.indexOf(key), row;
        if (idx < 0) { keys.push(key); row = keys.length + 1; } else row = idx + 2;
        const width = Math.max(sh.getLastColumn(), parts.length + 2);
        const vals = [key, now].concat(parts);
        while (vals.length < width) vals.push('');
        sh.getRange(row, 1, 1, width).setNumberFormat('@').setValues([vals]);
      });
      return { saved: (body.rows || []).length };
    } finally {
      lock.releaseLock();
    }
  });
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange(1, 1, 1, 3).setValues([['klic', 'ts', 'json']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function auth_(token) {
  const ok = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!ok || token !== ok) throw new Error('Špatný token');
}

function handle_(fn) {
  let out;
  try { out = Object.assign({ ok: true }, fn()); }
  catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

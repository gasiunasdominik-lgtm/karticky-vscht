// Studium VŠCHT – plán semestru + opakovací kartičky (FSRS). Offline PWA, sync s Google Sheetem přes Apps Script.
// Data: cards.json (build_study.py) a semestr.json (semestr_export.py) ze složky 3_VŠCHT; stav v localStorage + fronta změn.

// ---------- FSRS-4.5 (výchozí parametry)
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5, FACTOR = 19 / 81, MAXIVL = 365;
const clampD = d => Math.min(10, Math.max(1, d));
const D0 = g => clampD(W[4] - (g - 3) * W[5]);
const Rof = (t, S) => Math.pow(1 + FACTOR * t / S, DECAY);
const ivlOf = (S, ret) => S / FACTOR * (Math.pow(ret, 1 / DECAY) - 1);
function nextState(st, g, today) {
  if (!st || !st.reps) return { S: W[g - 1], D: D0(g), last: today, reps: 1, lapses: g === 1 ? 1 : 0 };
  const t = Math.max(0, today - st.last), R = Rof(t, st.S);
  const D = clampD(W[7] * D0(3) + (1 - W[7]) * (st.D - W[6] * (g - 3)));
  let S;
  if (g === 1) S = Math.min(st.S, W[11] * Math.pow(st.D, -W[12]) * (Math.pow(st.S + 1, W[13]) - 1) * Math.exp((1 - R) * W[14]));
  else S = st.S * (1 + Math.exp(W[8]) * (11 - st.D) * Math.pow(st.S, -W[9]) * (Math.exp((1 - R) * W[10]) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1));
  return { S, D, last: today, reps: st.reps + 1, lapses: st.lapses + (g === 1 ? 1 : 0) };
}

// ---------- čas: den začíná ve 4:00
const DAY = 864e5;
const dayNum = (dt = new Date()) => { const x = new Date(dt.getTime() - 4 * 3600e3); return Math.floor(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / DAY); };
const isoToDay = s => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY);
const dayIso = n => new Date(n * DAY).toISOString().slice(0, 10);
const DN = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
const fmtD = n => { const d = new Date(n * DAY); return d.getUTCDate() + '. ' + (d.getUTCMonth() + 1) + '.'; };
const fmtDW = n => DN[new Date(n * DAY).getUTCDay()] + ' ' + fmtD(n);
const inDays = n => n === 0 ? 'dnes' : n === 1 ? 'zítra' : `za ${n} dní`;
const fmtIvl = n => n < 1 ? 'dnes' : n === 1 ? '1 d' : n < 30 ? n + ' d' : n < 365 ? (n / 30).toFixed(n < 60 ? 1 : 0) + ' měs' : '1 rok';
const mins = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);

const SUBJN = { MAT: 'Matematika', OAC: 'OAC přednášky', OACC: 'OAC cvičení', CBV: 'CBV', CHT: 'CHT', TOX: 'TOX', PCP: 'PCP' };
const DECKN = { 1: 'Teorie (CHT, TOX, OAC)', 2: 'MATLAB a zkratky', 3: 'CBV vzorce a postupy', 4: 'Ostatní (MAT, OACC, PCP)', 9: 'Doplňky (před zkouškou)' };
const TYPN = { J: '', F: 'Filozofie', V: 'Vzorec', P: 'Postup', K: 'Příkaz', D: 'Doplněk' };
const SUBJS = Object.keys(SUBJN);
const EXAM = { MAT: '2027-01-11', OAC: '2027-01-11', OACC: '2027-01-11', CHT: '2027-01-13', TOX: '2027-01-13', CBV: '2026-12-15', PCP: '2026-12-10' };
// odškrtnuté položky přenesené ze starého dashboardu (artefakt Semestr ZS 26/27, 25. 10. 2026)
const SEED_DONE = ['chm', 'cht-mail', 'g-cbv1', 'g-cbv2', 'g-cbv3', 'g-mat1', 'g-oac1', 'g-oac3', 'mat-mail', 'noc-vedy', 'pcp-mail', 'w-mat',
  'r-2026-09-20MAT-T01dohnat: celý list', 'r-2026-09-21MAT-T01vybavování (sekce 7)', 'r-2026-09-21MAT-T02dohnat: celý list', 'r-2026-09-21MAT-T03nové: celý list',
  'r-2026-09-22MAT-T02vybavování (sekce 7)', 'r-2026-09-22MAT-T03vybavování (sekce 7)'];

let DATA = null, SEM = null, CARDS = [], BYID = {}, W1 = 0, TOPICS = [];
let srs = {}, log = {}, done = {};
let set = { newPerDay: 20, ret: 0.9, ahead: false, dopl: false, test: true, ts: 0 };
const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* plné úložiště */ } },
};
function toast(t) { const x = el('div', 'toast', t); document.body.appendChild(x); setTimeout(() => x.remove(), 2200); }
const tag = s => el('span', 'tag ' + s, s);

// ---------- úložiště + fronta změn (klíče: srs_<PŘEDMĚT>, meta, done)
const shardOf = id => (BYID[id] || {}).s || 'X';
let dirty = new Set(ls.get('k_dirty', []));
function persist() { ls.set('k_srs', srs); ls.set('k_log', log); ls.set('k_set', set); ls.set('k_done', done); ls.set('k_dirty', [...dirty]); }
function markDirty(id) { dirty.add('srs_' + shardOf(id)); dirty.add('meta'); persist(); schedulePush(); }
function mergeRec(a, b) { if (!a) return b; if (!b) return a; return (b[3] > a[3] || (b[3] === a[3] && b[0] > a[0])) ? b : a; }
const isDone = id => !!(done[id] && done[id][0]);
function setDone(id, v) { done[id] = [v, Date.now()]; dirty.add('done'); persist(); schedulePush(); }

// ---------- sync s Google Sheetem (Apps Script web app)
const syncCfg = () => { const c = ls.get('k_sync', null); return c && c.url && c.token ? c : null; };
let syncing = false, pushT = null, lastPull = 0;
function syncLabel(t) { $('syncChip').textContent = t; }
function syncState() {
  const c = syncCfg();
  $('syncHint').hidden = !!c;
  if (!c) return syncLabel('jen v zařízení');
  if (!navigator.onLine) return syncLabel(dirty.size ? `offline · ${dirty.size} čeká` : 'offline');
  syncLabel(dirty.size ? `${dirty.size} čeká na odeslání` : '☁️ synchronizováno');
}
async function api(cfg, method, payload) {
  const url = new URL(cfg.url);
  let res;
  if (method === 'GET') {
    Object.entries({ ...payload, token: cfg.token }).forEach(([k, v]) => url.searchParams.set(k, v));
    res = await fetch(url, { cache: 'no-store' });
  } else {
    // text/plain = bez CORS preflightu, který Apps Script neumí
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, token: cfg.token }) });
  }
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function payloadFor(key) {
  if (key === 'meta') return JSON.stringify({ log, set });
  if (key === 'done') return JSON.stringify(done);
  if (key === 'srs_DIAG') return JSON.stringify(diag);
  const sh = key.slice(4), part = {};
  for (const [id, v] of Object.entries(srs)) if (shardOf(id) === sh) part[id] = v;
  return JSON.stringify(part);
}
async function pull(cfg) {
  const d = await api(cfg, 'GET', { action: 'pull' });
  let changed = false;
  for (const [key, row] of Object.entries(d.rows || {})) {
    let v; try { v = JSON.parse(row.json); } catch { continue; }
    if (key === 'meta') {
      for (const [k, l] of Object.entries(v.log || {})) if (!log[k] || l[0] > log[k][0]) { log[k] = l; changed = true; }
      if (v.set && (v.set.ts || 0) > (set.ts || 0)) { set = { ...set, ...v.set }; changed = true; }
    } else if (key === 'done') {
      for (const [id, r] of Object.entries(v)) if (!done[id] || r[1] > done[id][1]) { done[id] = r; changed = true; }
    } else if (key === 'srs_DIAG') {
      for (const [id, r] of Object.entries(v)) if (!diag[id] || (r.ts || 0) > (diag[id].ts || 0)) { diag[id] = r; changed = true; }
      ls.set('k_diag', diag);
    } else if (key.startsWith('srs_')) {
      for (const [id, r] of Object.entries(v)) { const m = mergeRec(srs[id], r); if (m !== srs[id]) { srs[id] = m; changed = true; } }
    }
  }
  lastPull = Date.now();
  return changed;
}
async function push(cfg) {
  const keys = [...dirty];
  if (!keys.length) return;
  await api(cfg, 'POST', { action: 'push', rows: keys.map(k => ({ key: k, json: payloadFor(k) })) });
  keys.forEach(k => dirty.delete(k));
  persist();
}
async function syncNow(manual) {
  const cfg = syncCfg();
  if (!cfg || syncing) { syncState(); return; }
  if (!navigator.onLine) { syncState(); if (manual) toast('Bez připojení – odešle se později'); return; }
  syncing = true; syncLabel('synchronizuji…');
  try {
    const changed = await pull(cfg);
    await push(cfg);
    persist();
    if (changed) refresh();
    syncState();
    if (manual) toast('Synchronizováno');
  } catch (e) {
    syncLabel('sync selhal');
    if (manual) toast('Sync selhal: ' + e.message);
  }
  syncing = false;
}
function schedulePush() { syncState(); clearTimeout(pushT); pushT = setTimeout(() => syncNow(false), 4000); }

// ---------- výpočty kartiček
const today = () => dayNum();
const weekNow = () => Math.floor((today() - W1) / 7) + 1;

// ---------- plán semestru
const semWeek = () => Math.min(22, Math.max(1, weekNow()));
// skupina Anki je z doby před vlastními kartičkami – odemykání teď dělá appka sama
const weekGroups = w => (w ? w.groups : []).filter(g => !/Anki/.test(g.h));
const GPRIO = ['📝', '✍️', '📖', '🧭', '🔁'];
const gRank = g => { const i = GPRIO.findIndex(p => g.h.startsWith(p)); return i < 0 ? 9 : i; };
function todoItem(id, text, meta, onChange, tg) {
  const li = el('li'); if (isDone(id)) li.className = 'done';
  const lb = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.checked = isDone(id);
  cb.onchange = () => { setDone(id, cb.checked); li.classList.toggle('done', cb.checked); if (onChange) onChange(); };
  const tx = el('span'), t = el('span', 't');
  if (tg) t.appendChild(tag(tg));
  t.append(text); tx.appendChild(t); if (meta) tx.appendChild(el('span', 'm', meta));
  lb.append(cb, tx); li.appendChild(lb); return li;
}
function revDue() {
  const t = dayIso(today());
  return SEM.plan.filter(p => p.date <= t && !isDone('r-' + p.date + p.id + p.typ));
}
// hromadné odškrtnutí = 10+ položek opakování se stejným časem zápisu; najde poslední takovou dávku
function lastBulk() {
  const by = {};
  for (const [id, v] of Object.entries(done)) if (id.startsWith('r-') && v[0] && v[1] > Date.now() - 3 * DAY) (by[v[1]] = by[v[1]] || []).push(id);
  const ts = Object.keys(by).map(Number).filter(k => by[k].length >= 10).sort((a, b) => b - a)[0];
  if (!ts) return null;
  const d = new Date(ts);
  return { ts, ids: by[ts], when: `${d.getDate()}. ${d.getMonth() + 1}. ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` };
}
function undoBulk(bulk) { const now = Date.now(); for (const id of bulk.ids) done[id] = [false, now]; dirty.add('done'); persist(); schedulePush(); }
function inCamp() { const td = today(); return td >= isoToDay(SEM.camp[0]) && td <= isoToDay(SEM.camp[1]); }

// ---------- sekce
const TABS = ['ucit', 'mapa', 'plan', 'vic', 'predmety'];   // staré obrazovky (Dnes, Týden, Kartičky) jsou odstraněné, výchozí je Učit
let TAB = 'ucit', KSEG = ls.get('k_seg', 'opak');
function go(tab) {
  if (!TABS.includes(tab)) tab = 'ucit';
  TAB = tab;
  document.querySelectorAll('section[data-tab]').forEach(s => s.hidden = s.dataset.tab !== tab);
  document.querySelectorAll('nav.dock button').forEach(b => b.toggleAttribute('aria-current', false));
  const b = document.querySelector(`nav.dock [data-go="${tab}"]`); if (b) b.setAttribute('aria-current', 'page');
  if (TABS.includes(tab) && location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  refresh(); window.scrollTo({ top: 0 });
}
function refresh() {
  if (!DATA || !SEM) return;
  renderHeader();
  if (TAB === 'ucit') renderUcit();
  if (TAB === 'mapa') renderMapa();
  if (TAB === 'plan') renderPlan();
  if (TAB === 'predmety') renderPredmety();
  if (TAB === 'vic') renderVic();
}
function renderHeader() {
  const wk = weekNow(); $('wkChip').textContent = inCamp() ? 'soustředění' : wk >= 1 && wk <= 14 ? `${wk}. týden` : wk > 14 ? 'zkouškové' : 'před semestrem';
  syncState();
}

// ----- PŘEDMĚTY
let pSel = ls.get('k_psel', 'Vše');
function evTimeline(filter) {
  const td = today(), wk = weekNow(), box = el('div', 'tl'), groups = new Map();
  for (const e of SEM.ev.filter(filter)) { const k = Math.min(Math.floor((isoToDay(e[0]) - W1) / 7) + 1, 15); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  for (const k of [...groups.keys()].sort((a, b) => a - b)) {
    const ws = W1 + (k - 1) * 7, row = el('div', 'tlw');
    if (k < 15 && ws + 7 <= td) row.classList.add('past'); if (k === wk) row.classList.add('cur'); if (k === 6 || k === 7) row.classList.add('camp');
    const wkl = el('div', 'wk'); if (k >= 15) wkl.appendChild(el('b', null, 'zk.')); else { wkl.appendChild(el('b', null, k + '.')); wkl.append(fmtD(ws)); }
    const evs = el('div');
    for (const e of groups.get(k)) {
      const x = el('div', 'ev'), t = el('span', 't'); t.append(tag(e[1]), e[2]);
      if (e[4] === 'est') t.appendChild(el('span', 'flag', 'odhad dne')); if (e[4] === 'hit') t.appendChild(el('span', 'flag hit', 'koliduje'));
      x.append(t, el('span', 'd', fmtDW(isoToDay(e[0])) + (e[3] ? ' · ' + e[3] : ''))); evs.appendChild(x);
    }
    row.append(wkl, evs); box.appendChild(row);
  }
  return box;
}
function panel(title, ...kids) { const p = el('div', 'panel'); if (title) { const ph = el('div', 'ph'); ph.appendChild(el('h3', null, title)); p.appendChild(ph); } p.append(...kids); return p; }
function renderPredmety() {
  const ch = $('pChips'); ch.textContent = '';
  for (const s of ['Vše', ...SUBJS]) { const b = el('button', 'chip', s === 'Vše' ? 'Kalendář' : s); b.type = 'button'; b.setAttribute('aria-pressed', String(s === pSel)); b.onclick = () => { pSel = s; ls.set('k_psel', s); renderPredmety(); }; ch.appendChild(b); }
  const body = $('pBody'); body.textContent = '';
  if (pSel === 'Vše') {
    body.appendChild(panel('Všechny testy a termíny', evTimeline(() => true)));
    const qs = el('ol', 'qs'); for (const [k, q] of SEM.qs) { const li = el('li'); li.append(tag(k), q); qs.appendChild(li); }
    body.appendChild(panel('Otevřené otázky pro vyučující', qs));
    const ln = el('div', 'links'); for (const [k, t, u] of SEM.links) { const a = el('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; a.append(tag(k), t); ln.appendChild(a); }
    body.appendChild(panel('Rychlé odkazy', ln));
    return;
  }
  const s = pSel, sj = SEM.subj.find(x => x[0] === s);
  if (sj) { const p = el('div', 'panel req'); p.append(el('h2', null, sj[1]), el('p', null, sj[2]), el('code', null, sj[3])); body.appendChild(p); }
  const td = today(), up = SEM.ev.filter(e => e[1] === s);
  body.appendChild(panel('Testy a termíny', up.length ? evTimeline(e => e[1] === s) : el('div', 'note', 'Žádné termíny.')));
  const gets = SEM.get.filter(g => g[1] === s);
  if (gets.length) {
    const ul = el('ul', 'todo');
    for (const [id, , t, u, typ] of gets) {
      const li = todoItem(id, t, typ === 'dl' ? ' ' : 'čekám na zveřejnění');
      if (typ === 'dl' && u) { const a = el('a', null, 'otevřít ↗'); a.href = u; a.target = '_blank'; a.rel = 'noopener'; li.querySelector('.m').appendChild(a); }
      ul.appendChild(li);
    }
    body.appendChild(panel('Stáhnout a hlídat', ul));
  }
  const ln = SEM.links.filter(l => l[0] === s);
  if (ln.length) { const box = el('div', 'links'); for (const [, t, u] of ln) { const a = el('a', null, t); a.href = u; a.target = '_blank'; a.rel = 'noopener'; box.appendChild(a); } body.appendChild(panel('Odkazy', box)); }
  const qs = SEM.qs.filter(q => q[0] === s);
  if (qs.length) { const ol = el('ol', 'qs'); for (const [, q] of qs) ol.appendChild(el('li', null, q)); body.appendChild(panel('Otázky pro vyučující', ol)); }
}

// ----- VÍC
function renderVic() {
  const ul = $('todo'); ul.textContent = '';
  for (const [id, t, m] of SEM.todo) ul.appendChild(todoItem(id, t, m, () => { $('todoSum').textContent = `${SEM.todo.filter(x => isDone(x[0])).length} z ${SEM.todo.length}`; }));
  $('todoSum').textContent = `${SEM.todo.filter(x => isDone(x[0])).length} z ${SEM.todo.length}`;
  if (!$('tahak').childElementCount) $('tahak').innerHTML = SEM.tahak;   // vlastní obsah z dashboardu (semestr.html)
  const c = ls.get('k_sync', {}) || {};
  if (document.activeElement !== $('syUrl')) $('syUrl').value = c.url || '';
  if (document.activeElement !== $('syTok')) $('syTok').value = c.token || '';
  $('genMsg').textContent = `${UT.length} témat k učení (${UC && UC.gen || '?'}) a plán semestru (${SEM.gen}) ze složky 3_VŠCHT.`;
}

// ---------- UČIT: jeden další krok · diagnostika · mapa znalostí · vrstvy V0–V4 (uceni.json + obsah/<ID>.json z build_uceni.py)
// diag[tid] = { st, lv, h:[[den, id, g]], nx, up, ts } · st: 'B' nebráno · 'X' nerozumím · 1 neumím · 2 zhruba · 3 skoro · 4 umím
// témata, která Dominik nedělá (v PCP místo Excelu čistě MATLAB) – vyřazená z Učit, Plánu, Mapy i dluhu
const NEDELAM = /^Excel\b/i;
let UC = null, UT = [], UBY = {}, diag = {}, UQ = null, UOPEN = null, OBS = {};
let UCTX = { min: 25, kde: 'doma', ts: 0, ...ls.get('k_uctx', {}) };
const STN = { 0: 'neověřeno', B: 'nebráno', X: 'nerozumím', 1: 'neumím', 2: 'zhruba', 3: 'skoro', 4: 'umím' };
const STC = { 0: 'u-0', B: 'u-b', X: 'u-x', 1: 'u-1', 2: 'u-2', 3: 'u-3', 4: 'u-4' };
const LVN = ['Základ – o čem to je', 'Jádro a první příklady', 'Proč to tak je + příklady', 'Testová úroveň', 'Výzva'];
const GAP = [1, 2, 4, 7, 14];
const KDE = { cesta: 'Cesta', doma: 'Doma', skola: 'Pauza ve škole' };
const STEPMIN = [8, 20, 30, 35, 40];      // odhad minut na posun o vrstvu
const stOf = t => (diag[t.id] || {}).st ?? 0;
const lvOf = t => (diag[t.id] || {}).lv || 0;
const taught = t => t.d && isoToDay(t.d) <= today();
const isTheory = t => !t.np || !Object.keys(t.np).length;
function mathify(root) {
  if (!window.katex || !root) return;
  root.querySelectorAll('[data-tex]:not([data-done])').forEach(e => {
    try { katex.render(e.dataset.tex, e, { displayMode: e.classList.contains('display'), throwOnError: false, output: 'html' }); } catch { e.textContent = e.dataset.tex; }
    e.dataset.done = '1';
  });
}
// tabulky ve výkladu: textové se na úzkém displeji přeskládají do karet po řádcích, krátké zůstanou tabulkou se scrollem (žádné úzké sloupce)
function fixTables(root) {
  const W = Math.min(window.innerWidth || 400, 760) - 72;
  for (const t of root.querySelectorAll('table')) {
    if (t.closest('.tscroll') || t.classList.contains('tstack')) continue;
    const rows = [...t.rows]; if (!rows.length) continue;
    const len = c => plainT(c.innerHTML).replace(/\s+/g, ' ').trim().length;
    const hr = rows[0].querySelector('th') || t.tHead ? rows[0] : null, body = rows.filter(r => r !== hr);
    const nc = Math.max(...rows.map(r => r.cells.length)), cells = body.flatMap(r => [...r.cells]);
    const avg = cells.reduce((a, c) => a + len(c), 0) / Math.max(1, cells.length);
    const colW = [...Array(nc)].map((_, i) => Math.max(...rows.map(r => r.cells[i] ? Math.min(len(r.cells[i]), 32) : 0)));
    const est = colW.reduce((a, w) => a + w * 7.6 + 22, 0);             // přirozená šířka tabulky v px (odhad)
    if (est > W && avg > 12) {                                          // nevešla by se a je to text → karty
      t.classList.add('tstack'); if (hr) hr.classList.add('thead');
      const lab = hr ? [...hr.cells].map(c => plainT(c.innerHTML).replace(/\s+/g, ' ').trim()) : [];
      for (const r of body) [...r.cells].forEach((c, i) => { if (lab[i] && i > 0) c.dataset.l = lab[i]; if (!len(c) && !c.querySelector('img,[data-tex]')) c.classList.add('emp'); });
    } else {
      const w = el('div', 'tscroll'); t.replaceWith(w); w.appendChild(t);
      for (const r of rows) for (const c of r.cells) { const n = len(c); if (n > 28) c.classList.add('tw'); else if (n <= 18) c.classList.add('tn'); }
    }
  }
}
const H = (cls, htmlStr) => { const d = el('div', cls); d.innerHTML = htmlStr; fixTables(d); mathify(d); return d; };
function topicTest(t) {
  let best = null; const td = today();
  for (const x of UC.tests) {
    if (x.s !== t.s) continue; const d = isoToDay(x.d); if (d < td) continue;
    const i = t.test.indexOf(x.n); const ok = i >= 0 && !/[IVX]/.test(t.test[i + x.n.length] || '');
    if (ok && (!best || d < best.day)) best = { day: d, n: x.n };
  }
  if (!best) { const ex = EXAM[t.s]; if (ex && isoToDay(ex) >= td) best = { day: isoToDay(ex), n: t.s === 'CBV' ? 'Test II' : t.s === 'PCP' ? 'II. test' : 'zkouška' }; }
  return best;
}
// fáze podle toho, kolik zbývá do testu → cílová vrstva
function phase(dd) {
  if (dd <= 2) return { k: 'zachrana', n: 'poslední chvíle – jen to podstatné ze všech témat', tgt: 1 };
  if (dd <= 7) return { k: 'dotahovani', n: 'dotahování – testové příklady', tgt: 3 };
  if (dd <= 21) return { k: 'budovani', n: 'budování – jádro a příklady', tgt: 2 };
  return { k: 'zaklad', n: 'dost času – nejdřív všechno do šířky, pak do hloubky', tgt: 1 };
}
// kolik minut je potřeba / k dispozici do testu předmětu
function budget(s) {
  const ts = UT.filter(t => t.s === s && taught(t)); if (!ts.length) return null;
  const nt = ts.map(topicTest).filter(Boolean).sort((a, b) => a.day - b.day)[0]; if (!nt) return null;
  const dd = nt.day - today(), ph = phase(dd);
  let need = 0; for (const t of ts) { const tt = topicTest(t); if (!tt || tt.day !== nt.day) continue; for (let l = lvOf(t); l < ph.tgt; l++) need += STEPMIN[l]; }
  const active = new Set(UT.filter(t => taught(t) && topicTest(t) && topicTest(t).day - today() <= 21).map(t => t.s)).size || 1;
  const have = Math.round(Math.max(0, dd) * 6 / 7 * 100 / Math.max(1, active));
  return { nt, dd, ph, need, have, tight: need > have };
}
function target(t) {
  const ts = topicTest(t); if (!ts) return 2;
  const b = budget(t.s), dd = ts.day - today(); let tg = phase(dd).tgt;
  if (b && b.tight) tg = Math.min(tg, Math.max(1, lvOf(t) + 1));     // nestíhá se → do šířky
  const ss = UT.filter(x => x.s === t.s && taught(x) && stOf(x) !== 'B');
  if (ss.length && ss.every(x => lvOf(x) >= tg)) tg = Math.min(4, tg + 1);    // všechno na cíli → růst dál
  return tg;
}
const reviewDue = t => { const r = diag[t.id]; return r && r.nx && r.nx <= today() && lvOf(t) > 0; };
const forgotten = t => { const r = diag[t.id]; return r && r.nx && today() > r.nx + GAP[Math.min(4, lvOf(t))]; };
function prio(t) {
  if (!taught(t) || stOf(t) === 'B') return -1;
  const ts = topicTest(t), dd = ts ? ts.day - today() : 60, urg = 1 / (1 + Math.max(0, dd) / 7);
  const gap = target(t) - lvOf(t);
  let p = gap > 0 ? gap * urg : 0;
  if (stOf(t) === 'X') p += 0.3 * urg;
  if (reviewDue(t)) p += (forgotten(t) ? 0.6 : 0.3) * urg;
  if (stOf(t) === 0) p += 0.5 * urg;
  return p;
}
// ----- varianta D „Dvě koleje“: aktuální kolej (látka ze dne ještě ten den) + dluhová kolej (dohánění), sprint 10 dní před testem
const dowNow = () => ((new Date().getDay() + 6) % 7) + 1;
const blockKde = b => b.t === 'cesta' ? 'cesta' : /pauza|škol/i.test(b.co) ? 'skola' : 'doma';
const isAkt = b => /dnešní/i.test(b.co);
const isLehky = b => /lehk|opakov/i.test(b.co) && !/nanečisto/i.test(b.co);
const KDEI = { cesta: 'Cesta', doma: 'Doma', skola: 'Škola' };
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
function learnBlocks(d) { return ((SEM && SEM.rezim && SEM.rezim[d]) || []).filter(b => b.t === 'uceni' || b.t === 'cesta'); }
// témata z posledních přednášek, která ještě nejsou zpracovaná (aktuální kolej)
function aktTopics() {
  const td = today();
  return UT.filter(t => t.d && isoToDay(t.d) <= td && isoToDay(t.d) >= td - 3 && stOf(t) !== 'B' && lvOf(t) < 1)
    .sort((a, b) => b.d.localeCompare(a.d));
}
const ZDNE = ['z neděle', 'z pondělí', 'z úterý', 'ze středy', 'ze čtvrtka', 'z pátku', 'ze soboty'];
const aktLab = t => !t.d || isoToDay(t.d) === today() ? 'dnešní' : ZDNE[new Date(t.d + 'T12:00').getDay()];   // „dnešní“ jen když přednáška byla opravdu dnes
function sprints() { return SUBJS.map(s => ({ s, b: budget(s) })).filter(x => x.b && x.b.dd <= 10).sort((a, b) => a.b.dd - b.b.dd); }
// dluh = minuty práce, než budou všechna probraná témata aspoň na své cílové vrstvě
function debtMin(s) {
  let n = 0;
  for (const t of UT) {
    if ((s && t.s !== s) || !taught(t) || stOf(t) === 'B') continue;
    if (stOf(t) === 0) n += 2;
    for (let l = lvOf(t); l < Math.max(1, target(t)); l++) n += STEPMIN[l];
  }
  return n;
}
function logDebt() { try { const h = ls.get('k_debt', {}); h[today()] = debtMin(); ls.set('k_debt', h); } catch { /* nic */ } }
// automatický kontext z rozvrhu, pokud si ho uživatel v posledních 90 min nezměnil
function autoCtx() {
  if (Date.now() - (UCTX.ts || 0) < 90 * 60e3 || !SEM || !SEM.rezim) return UCTX;
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes(), bl = learnBlocks(dowNow());
  const b = bl.find(x => mins(x.a) <= m && m < mins(x.b)) || bl.find(x => mins(x.a) > m && mins(x.a) - m <= 20);
  if (!b) return UCTX;
  const left = Math.max(5, mins(b.b) - Math.max(m, mins(b.a)));
  const min = [10, 25, 50, 90].reduce((a, o) => o <= left ? o : a, 10);
  return { ...UCTX, kde: blockKde(b), min, auto: b.co, akt: isAkt(b), mock: /nanečisto/i.test(b.co), lehky: isLehky(b) };
}
// co konkrétně udělat s tématem
// ----- fáze tématu: učení (výklad + první příklady) → cvičení (těžší příklady) → opakování (otázky + testová úloha)
const PRAKT = new Set(['MAT', 'CBV', 'PCP', 'OACC']);
const fazeOf = t => { const lv = lvOf(t); return stOf(t) === 'X' || lv <= 0 ? 'uceni' : lv <= 2 ? 'cviceni' : 'opakovani'; };
const FAZE = { uceni: 'Učení – výklad a první příklady', cviceni: 'Cvičení – těžší příklady', opakovani: 'Opakování – ověř, že to drží' };
function zadani(t, kde, f, min = 50) {   // co, s čím a kritérium splnění bloku
  const papir = kde !== 'cesta' && PRAKT.has(t.s), kratce = !papir && (kde === 'cesta' || min <= 25);
  const pom = papir ? `papír a tužka${t.s === 'CBV' ? ', kalkulačka' : ''}${t.s === 'PCP' ? ', MATLAB (piš sám, bez Copilota)' : ''} · list ${t.id} na reMarkable` : 'mobil (appka)';
  const co = f === 'uceni' ? (papir ? 'přečti výklad se schématy → projdi řešený příklad → 2 příklady sám na papír → 2 otázky' : kratce ? 'přečti krátký výtah (jen to, na co se zeptám) → 3 otázky; celý výklad máš na rozbalení' : 'přečti výklad se schématy → projdi řešený příklad → 3 otázky z toho, co jsi četl')
    : f === 'cviceni' ? (papir ? 'na co si dát pozor → 3 příklady o úroveň těžší na papír → 1 otázka' : 'na co si dát pozor → 4 otázky')
      : (papir ? '1 testová úloha na čas → 3 otázky' : '4 otázky napříč tématem');
  return { pom, co, krit: 'vyjde aspoň 2/3 příkladů a otázek', papir, kratce };
}
function stepFor(t, kde, min, akt) {
  if (reviewDue(t) && lvOf(t) >= target(t)) return { k: 'rev', m: 5, lab: 'Rychlé opakování', why: forgotten(t) ? 'dlouho jsi to neviděl' : 'opakování je na řadě', ...zadani(t, kde, 'opakovani') };
  const f = fazeOf(t), z = zadani(t, kde, f, min), m = Math.min(min, f === 'uceni' ? (z.papir ? 30 : 15) : f === 'cviceni' ? (z.papir ? 30 : 10) : (z.papir ? 20 : 8));
  return { k: 'learn', f, m, lab: FAZE[f], why: akt ? (aktLab(t) === 'dnešní' ? 'dnešní přednáška – zpracuj ji ještě dnes' : `přednáška ${aktLab(t)} – zpracuj ji co nejdřív`) : stOf(t) === 'X' ? 'tady jsi nerozuměl – začneme přirovnáním a výkladem' : '', ...z };
}
// doma a v pauze přednost praktickým předmětům (MAT, CBV, PCP, OAC cvičení), na cestě teorii a opakování
const placeW = (t, kde) => kde === 'cesta' ? (PRAKT.has(t.s) ? 0.6 : 1.4) : (PRAKT.has(t.s) ? 1.6 : 0.6);
function plan(ctx, used = new Set(), max = 3) {
  const out = []; let left = ctx.min;
  if (ctx.mock) { const s = mockSubj(); if (s) { out.push({ mock: s, s: { k: 'mock', m: Math.min(left, 60), lab: `Test nanečisto – ${SUBJN[s]}`, co: '4 úlohy na čas jako v testu, pak oprava podle řešení', pom: 'papír, tužka, bez poznámek', krit: 'aspoň 3 ze 4 úloh správně' } }); return out; } }
  const opak = t => fazeOf(t) === 'opakovani' || (reviewDue(t) && lvOf(t) >= target(t));
  const add = (t, akt) => {
    if (used.has(t.id) || left < 2 || out.length >= max) return;
    if (ctx.kde === 'cesta' && PRAKT.has(t.s) && !opak(t)) return;              // na cestě praktické předměty jen jako opakování
    if (ctx.lehky && PRAKT.has(t.s) && fazeOf(t) === 'uceni') return;           // lehký blok: žádná nová praktická látka na papír
    const s = stepFor(t, ctx.kde, left, akt); if (s.m > left + 3 || (s.f === 'uceni' && s.m < 8)) return; out.push({ t, s, ts: topicTest(t), akt }); used.add(t.id); left -= s.m;   // výklad pod 8 min nemá smysl
  };
  for (const t of aktTopics()) if ((ctx.kde === 'cesta') !== PRAKT.has(t.s)) add(t, true);   // dnešní praktické doma/v pauze, dnešní teorie na cestě
  const cand = UT.filter(t => prio(t) > 0 && !used.has(t.id)).sort((a, b) => prio(b) * placeW(b, ctx.kde) - prio(a) * placeW(a, ctx.kde) || lvOf(a) - lvOf(b));
  for (const t of cand) add(t, false);
  return out;
}
// test nanečisto: praktický předmět s nejbližším testem
const mockTopics = s => UT.filter(t => t.s === s && taught(t) && stOf(t) !== 'B' && lvOf(t) >= 1 && ['2', '3'].some(l => (t.np || {})[l]));   // jen témata, která už prošla výkladem
function mockSubj() { const c = SUBJS.filter(s => PRAKT.has(s) && mockTopics(s).length >= 2).map(s => ({ s, b: budget(s) })).filter(x => x.b).sort((a, b) => a.b.dd - b.b.dd); return c.length ? c[0].s : null; }
// plán celého dne: zbývající učební bloky a co v nich
function dayPlan() {
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes(), used = new Set(), out = [];
  for (const b of learnBlocks(dowNow())) {
    if (mins(b.b) <= m) continue;
    const len = mins(b.b) - Math.max(m, mins(b.a)); if (len < 8) continue;
    const ctx = { min: Math.min(len, b.t === 'cesta' ? 30 : len), kde: blockKde(b), akt: isAkt(b), mock: /nanečisto/i.test(b.co), lehky: isLehky(b) };
    out.push({ b, ctx, items: plan(ctx, used, 6), cur: mins(b.a) <= m });
  }
  return out;
}

// ----- obrazovka Učit
function renderUcit() {
  if (!UC) return;
  const box = $('uMain'); box.textContent = ''; box.classList.add('fresh'); delete box.dataset.si;
  if (UQ) return drawUQ();
  logDebt();
  const ctx = autoCtx(), p = plan(ctx);
  // 1) sprint nebo nejbližší test jednou větou
  const sp = sprints()[0];
  if (sp) {
    const s = el('div', 'usprint');
    s.append(el('b', null, `Sprint: ${SUBJN[sp.s]} – ${sp.b.nt.n} ${inDays(sp.b.dd)}`), el('span', null, sp.b.tight ? `potřeba ~${fmtMin(sp.b.need)}, máš ~${fmtMin(sp.b.have)} → jedeme do šířky` : `potřeba ~${fmtMin(sp.b.need)} z ~${fmtMin(sp.b.have)}, stíháš`));
    box.appendChild(s);
  } else {
    const near = SUBJS.map(s => ({ s, b: budget(s) })).filter(x => x.b).sort((a, b) => a.b.dd - b.b.dd)[0];
    if (near) box.appendChild(el('div', 'uhead', `${SUBJN[near.s]} · ${near.b.nt.n} ${inDays(near.b.dd)} — ${near.b.ph.n}`));
  }
  // 2) kontext (kde, kolik času)
  const cx = el('details', 'uctx'); const sm = el('summary');
  sm.textContent = `${KDE[ctx.kde]} · ${ctx.min} min${ctx.auto ? ' · podle rozvrhu' : ''} ▾`; cx.appendChild(sm);
  const pick = (opts, cur, on) => { const r = el('div', 'row'); for (const [v, lab] of opts) { const b = el('button', 'chip', lab); b.type = 'button'; b.setAttribute('aria-pressed', String(v === cur)); b.onclick = () => on(v); r.appendChild(b); } return r; };
  const setCtx = o => { UCTX = { ...UCTX, ...o, ts: Date.now() }; delete UCTX.auto; delete UCTX.akt; delete UCTX.lehky; ls.set('k_uctx', UCTX); renderUcit(); };
  cx.append(pick([[10, '10 min'], [25, '25 min'], [50, '50 min'], [90, '1,5 h']], ctx.min, v => setCtx({ min: v, kde: ctx.kde })),
    pick(Object.entries(KDE), ctx.kde, v => setCtx({ kde: v, min: ctx.min })),
    el('div', 'note', ctx.kde === 'cesta' ? 'Na cestě: opakování a lehké čtení.' : 'Doma a v pauze: nová látka, schémata a těžší příklady.'));
  box.appendChild(cx);
  // 3) jeden hlavní krok
  if (!p.length) box.appendChild(panel(null, el('p', null, 'Teď nic nehoří. Odpočívej, nebo si v Mapě vyber téma, které tě zajímá.')));
  else {
    const it = p[0], c = el('div', 'unow' + (it.akt ? ' akt' : ''));
    const top = el('div', 'row'); top.append(tag(it.mock || it.t.s), el('span', 'kolej', it.mock ? 'test nanečisto' : it.akt ? (aktLab(it.t) === 'dnešní' ? 'dnešní látka' : `látka ${aktLab(it.t)}`) : 'dohánění'), el('span', 'note', `${it.s.m} min${it.ts ? ` · ${it.ts.n} ${inDays(it.ts.day - today())}` : ''}`));
    c.append(top, el('h2', null, it.mock ? SUBJN[it.mock] : it.t.n), el('div', 'ustep', it.s.lab));
    if (it.s.why) c.appendChild(el('div', 'note', it.s.why));
    if (it.s.co) { const dl = el('dl', 'uzadl'); for (const [k, v] of [['Co', it.s.co], ['S čím', it.s.pom], ['Splněno, když', it.s.krit]]) if (v) dl.append(el('dt', null, k), el('dd', null, v)); c.appendChild(dl); }
    if (!it.mock) c.appendChild(ladder(it.t));
    const b = el('button', 'primary', 'Začít'); b.type = 'button'; b.onclick = () => go2(it, ctx); c.appendChild(b);
    box.appendChild(c);
    if (p.length > 1) {
      const pl = el('div', 'list unext'); pl.appendChild(el('div', 'note', 'Potom'));
      for (const x of p.slice(1)) { if (x.mock) continue; const r = el('button', 'urow'); r.type = 'button'; r.append(el('i', 'dot ' + STC[stOf(x.t)]), el('span', 't', `${x.t.n} – ${x.s.lab.toLowerCase()}`), el('span', 'note', x.s.m + ' min')); r.onclick = () => go2(x, ctx); pl.appendChild(r); }
      box.appendChild(pl);
    }
  }
  // 4) dnešní plán jednou řádkou + nová látka k ověření
  const dp = dayPlan(), tot = dp.filter(x => x.b.t !== 'cesta').reduce((a, x) => a + (mins(x.b.b) - mins(x.b.a)), 0);
  if (dp.length) { const b = el('button', 'ghost uwide', `Dnes ještě ${dp.length} ${dp.length === 1 ? 'blok' : dp.length < 5 ? 'bloky' : 'bloků'} · ${fmtMin(tot)} učení ›`); b.type = 'button'; b.onclick = () => go('plan'); box.appendChild(b); }
}

// ----- PLÁN: dnešní bloky, testy, dluh
function sparkline(vals) {
  const w = 300, h = 60, n = vals.length; if (n < 2) return null;
  const mx = Math.max(...vals), mn = Math.min(...vals, 0), X = i => 4 + i * (w - 8) / (n - 1), Y = v => h - 6 - (v - mn) / Math.max(1, mx - mn) * (h - 14);
  const pts = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const s = `<svg viewBox="0 0 ${w} ${h}" class="spark" role="img" aria-label="vývoj dluhu"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="${X(n - 1)}" cy="${Y(vals[n - 1])}" r="4" fill="currentColor"/></svg>`;
  const d = el('div'); d.innerHTML = s; return d.firstChild;
}
function renderPlan() {
  if (!UC || !SEM) return;
  const box = $('pMain'); box.textContent = ''; logDebt();
  // dnes
  const dp = dayPlan(), pd = panel('Dnes');
  if (!dp.length) pd.appendChild(el('p', 'note', 'Na dnešek už žádný učební blok nezbývá. Odpočívej.'));
  for (const x of dp) {
    const bl = el('div', 'pblock' + (x.cur ? ' cur' : ''));
    const hd = el('div', 'row'); hd.append(el('span', 'ptime', `${x.b.a}–${x.b.b}`), ...(() => { const co = x.b.co.replace(/^\s*\p{Extended_Pictographic}\uFE0F?\s*/u, ''); return co.toLowerCase().startsWith(KDEI[x.ctx.kde].toLowerCase()) ? [el('b', null, co)] : [el('span', 'pk ' + x.ctx.kde, KDEI[x.ctx.kde]), el('b', null, co)]; })());
    bl.appendChild(hd);
    const ul = el('div', 'list');
    if (!x.items.length) ul.appendChild(el('div', 'note', x.b.t === 'cesta' ? 'opakování v appce nebo odpočinek' : 'volno na cokoli z Mapy'));
    for (const it of x.items) { const r = el('button', 'urow'); r.type = 'button'; r.append(el('i', 'dot ' + (it.mock ? 'u-x' : STC[stOf(it.t)])), el('span', 't', it.mock ? `${it.s.lab} · ${it.s.pom}` : `${it.akt ? '● ' : ''}${it.t.n} – ${it.s.lab.toLowerCase()} · ${it.s.pom}`), el('span', 'note', it.s.m + ' min')); r.onclick = () => { go('ucit'); go2(it, x.ctx); }; ul.appendChild(r); }
    bl.appendChild(ul); pd.appendChild(bl);
  }
  pd.appendChild(el('div', 'note', '● = čerstvá látka z posledních přednášek (aktuální kolej), ostatní = dohánění. Plán se přepočítá po každém splněném kroku.'));
  box.appendChild(pd);
  // testy
  const pt = panel('Testy a sprinty'), ul = el('div', 'list');
  for (const s of SUBJS) {
    const b = budget(s); if (!b) continue;
    const r = el('div', 'ptest' + (b.dd <= 10 ? ' sprint' : ''));
    r.append(tag(s), el('span', 't', `${b.nt.n} ${inDays(b.dd)}`), el('span', 'note', b.dd <= 10 ? `sprint · potřeba ${fmtMin(b.need)} / máš ${fmtMin(b.have)}` : `za ${Math.max(0, b.dd - 10)} dní začne sprint`));
    ul.appendChild(r);
  }
  pt.append(ul, el('div', 'note', '10 dní před testem dostane předmět přednost v dohánění (sprint).'));
  box.appendChild(pt);
  // dluh
  const h = ls.get('k_debt', {}), days = Object.keys(h).map(Number).sort((a, b) => a - b), vals = days.map(d => h[d]);
  const now = debtMin(), pdl = panel('Dluh k dohnání');
  pdl.appendChild(el('p', 'ubig', `${fmtMin(now)} práce`));
  const sl = sparkline(vals); if (sl) pdl.appendChild(sl); else pdl.appendChild(el('div', 'note', 'Graf se začne kreslit od zítřka.'));
  const bars = el('div', 'pbars'); const mx = Math.max(1, ...SUBJS.map(s => debtMin(s)));
  for (const s of SUBJS) { const v = debtMin(s); if (!v) continue; const r = el('div', 'pbar'); const i = el('i', null); i.style.width = Math.round(v / mx * 100) + '%'; i.style.background = `var(--c-${s})`; r.append(el('span', null, SUBJN[s]), el('div', 'track'), el('span', 'note', fmtMin(v))); r.children[1].appendChild(i); bars.appendChild(r); }
  pdl.append(bars, el('div', 'note', 'Dluh = kolik minut chybí, aby každé probrané téma bylo aspoň na své cílové vrstvě.'));
  box.appendChild(pdl);
}
function go2(it, ctx) { if (it.mock) return startMock(it.mock); if (it.s.k === 'diag') startDiag(1, [it.t]); else if (it.s.k === 'rev') startLearn(it.t, ctx, true); else startLearn(it.t, ctx); }
// žebřík vrstev (animovaný ukazatel, kde v tématu jsi)
function ladder(t) {
  const d = el('div', 'ladder'), lv = lvOf(t), st = stOf(t);
  for (let i = 0; i < 5; i++) { const s = el('span', i < lv ? 'on' : i === lv && st !== 0 ? 'cur' : ''); s.title = LVN[i]; d.appendChild(s); }
  return d;
}

// ----- MAPA
function renderMapa() {
  if (!UC) return; const box = $('mMain'); box.textContent = '';
  if (UOPEN && UBY[UOPEN]) return topicSheet(UBY[UOPEN]);
  const tt = UT.filter(t => taught(t) && stOf(t) !== 'B'), cnt = s => tt.filter(t => stOf(t) === s || (s === 1 && stOf(t) === 'X')).length;
  box.appendChild(panel(null, el('p', 'ubig', `Umíš ${cnt(4) + cnt(3)} z ${tt.length} probraných témat`),
    el('div', 'note', `zhruba ${cnt(2)} · zatím ne ${cnt(1)} · neověřeno ${cnt(0)}`)));
  for (const s of SUBJS) {
    const ts = UT.filter(t => t.s === s); if (!ts.length) continue;
    const b = budget(s), det = el('details', 'panel usubj'); const sum = el('summary');
    const bar = el('div', 'sbar'); const tk = ts.filter(taught);
    for (const k of [4, 3, 2, 1, 'X', 0]) { const n = tk.filter(t => stOf(t) === k).length; if (n) { const i = el('i', STC[k]); i.style.flex = n; bar.appendChild(i); } }
    sum.append(el('b', null, SUBJN[s]), el('span', 'note', b ? `${b.nt.n} ${inDays(b.dd)}` : ''), bar);
    det.appendChild(sum);
    if (b) det.appendChild(el('div', 'note', b.tight ? `Do testu potřebuješ asi ${Math.round(b.need / 60)} h, máš asi ${Math.round(b.have / 60)} h – plán proto jede do šířky (u každého tématu jen to podstatné).` : `Do testu potřebuješ asi ${Math.max(1, Math.round(b.need / 60))} h z asi ${Math.round(b.have / 60)} h, co máš – stíháš.`));
    const ul = el('div', 'list');
    for (const t of ts) {
      const st = stOf(t), row = el('button', 'urow'); row.type = 'button';
      row.append(el('i', 'dot ' + (taught(t) ? STC[st] : 'u-f')), el('span', 't', t.n), el('span', 'note', taught(t) ? (st ? STN[st] : 'neověřeno') : fmtD(isoToDay(t.d))));
      row.onclick = () => { UOPEN = t.id; renderMapa(); window.scrollTo({ top: 0 }); }; ul.appendChild(row);
    }
    det.appendChild(ul); box.appendChild(det);
  }
  const ex = el('button', 'link', 'Poslat výsledky Claudovi'); ex.type = 'button'; ex.onclick = exportDiag; box.appendChild(ex);
}
async function loadObs(tid) { if (OBS[tid]) return OBS[tid]; const r = await fetch(`obsah/${tid}.json`); OBS[tid] = await r.json(); return OBS[tid]; }
async function topicSheet(t) {
  const box = $('mMain'); box.textContent = '';
  const back = el('button', 'ghost', '‹ Mapa'); back.type = 'button'; back.onclick = () => { UOPEN = null; renderMapa(); };
  const hd = panel(null, el('h2', null, t.n), el('div', 'note', `${SUBJN[t.s]} · ${STN[stOf(t)]} · ${LVN[lvOf(t)]}`), ladder(t));
  const r = el('div', 'row');
  const b1 = el('button', 'primary', 'Učit teď'); b1.type = 'button'; b1.onclick = () => { go('ucit'); startLearn(t, autoCtx()); };
  const b2 = el('button', 'ghost', 'Ověřit znovu'); b2.type = 'button'; b2.onclick = () => { go('ucit'); startDiag(1, [t]); };
  r.append(b1, b2); hd.appendChild(r); box.append(back, hd);
  const o = await loadObs(t.id);
  const secs = [['cil', 'Co budeš umět'], ['pre', 'Nejdřív se zkus'], ['v0', 'O čem to je'], ['jadro', 'Jádro'], ['proc', 'Proč to tak je'], ['rp', 'Řešené příklady'], ['chyby', 'Časté chyby'], ['souv', 'Souvislosti']];
  for (const [k, n] of secs) if (o[k]) { const d = el('details', 'panel fold'); const s = el('summary'); s.appendChild(el('h3', null, n)); d.appendChild(s); d.appendChild(H('ucont', o[k])); box.appendChild(d); }
}

// ----- běh: diagnostika (2 otázky na téma) a učební blok (kroky)
function startDiag(n, only) {
  const list = only || UT.filter(t => taught(t) && stOf(t) === 0).sort((a, b) => ((topicTest(a) || {}).day || 1e9) - ((topicTest(b) || {}).day || 1e9) || a.d.localeCompare(b.d)).slice(0, n);
  if (!list.length) return toast('Není co ověřovat');
  UQ = { mode: 'diag', topics: list, ti: 0, step: 0, gs: [], shown: false, n: list.length };
  if (TAB !== 'ucit') go('ucit'); else renderUcit(); window.scrollTo({ top: 0 });
}
// ----- výňatky z výkladu: k otázce najde místo ve výkladu, kde je odpověď (krátký výklad na cestu, zdůvodnění po chybě)
const STOPW = new Set('jak jaka jake jaky jaci jakou co se si je jsou byt pro pri nebo ktery ktera ktere kterou kterym cim kde kdy proc tak take ten tato tento tyto toho tim jeho jejich jen ani ale aby kdyz nez jako podle mezi pred pod nad bez pomoci the and'.split(' '));
const normT = s => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const stemW = w => { w = normT(w); return !w || STOPW.has(w) ? '' : /\d/.test(w) ? w : w.length >= 3 ? w.slice(0, 5) : ''; };
const plainT = h => (h || '').replace(/data-tex="([^"]*)"/g, '> $1 <').replace(/<[^>]+>/g, ' ');
const stems = s => { const o = new Set(); for (const w of normT(s).split(/[^a-z0-9]+/)) { const x = stemW(w); if (x) o.add(x); } return o; };
const CHUNKS = new Map();
function chunksOf(key, html) {
  if (CHUNKS.has(key)) return CHUNKS.get(key);
  const tp = document.createElement('template'); tp.innerHTML = html || ''; const list = []; let h = null;
  for (const n of [...tp.content.children]) {
    if (/^H[1-6]$/.test(n.tagName)) { h = n.textContent; continue; }
    const parts = /^(UL|OL)$/.test(n.tagName) && n.children.length > 2 ? [...n.children].map(li => { const u = document.createElement(n.tagName); u.appendChild(li.cloneNode(true)); return u; }) : [n];
    for (const p of parts) list.push({ h, html: p.outerHTML, fig: p.matches('figure,img') || !!p.querySelector('img'), math: p.matches('.math'), colon: /:\s*$/.test(p.textContent), st: stems(plainT(p.outerHTML) + ' ' + [...p.querySelectorAll('img')].map(i => i.alt).join(' ')) });
  }
  const df = {}; for (const c of list) for (const w of c.st) df[w] = (df[w] || 0) + 1;
  const r = { list, df }; CHUNKS.set(key, r); return r;
}
// indexy úseků výkladu k otázce (nejlepší + případně druhý blízký), vzorec se přibere ke svému odstavci
function chunkIdx(C, q) {
  const aa = stems(plainT(q.a)), qa = stems(plainT(q.q));
  const sc = C.list.map(c => { let s = 0; for (const w of aa) if (c.st.has(w)) s += 2 / C.df[w]; for (const w of qa) if (!aa.has(w) && c.st.has(w)) s += 1 / C.df[w]; return s; });
  const ord = sc.map((s, i) => i).sort((a, b) => sc[b] - sc[a]); if (!ord.length || sc[ord[0]] < 1) return [];
  const out = [ord[0]]; if (ord.length > 1 && sc[ord[1]] >= sc[ord[0]] * 0.7) out.push(ord[1]);
  for (const i of [...out]) { const c = C.list[i]; if (c.colon && C.list[i + 1] && C.list[i + 1].math) out.push(i + 1); if (c.math && i > 0) out.push(i - 1); }
  return out;
}
// obrázek-kotva k otázce: podle popisku obrázku, jinak obrázek ze stejné podsekce jako odpověď (nejbližší); -1 = nic
function figIdx(C, q) {
  const aa = stems(plainT(q.a)), qa = stems(plainT(q.q)); let best = -1, bs = 0; const sc = [];
  C.list.forEach((c, i) => { if (!c.fig) return; let s = 0; for (const w of aa) if (c.st.has(w)) s += 2 / C.df[w]; for (const w of qa) if (!aa.has(w) && c.st.has(w)) s += 1 / C.df[w]; sc[i] = s; if (s > bs) { bs = s; best = i; } });
  if (bs >= 1) return best;
  const t = chunkIdx(C, q)[0]; if (t == null || C.list[t].h == null) return -1;
  let near = -1; C.list.forEach((c, i) => { if (c.fig && sc[i] > 0 && c.h === C.list[t].h && (near < 0 || Math.abs(i - t) < Math.abs(near - t))) near = i; });   // jen obrázek, který s otázkou něco sdílí
  return near;
}
const figFor = (key, html, q) => { const C = chunksOf(key, html), i = figIdx(C, q); return i < 0 ? '' : C.list[i].html; };
// ----- karta látky: obrázek látky (struktura ze SMILES / skupenství v barvě) + větve z odpovědí tématu (kotvy/<ID>.json)
const KOT = {};
let KOTI = null;   // seznam témat, která mají karty (kotvy/_index.json) – jinde se nic nestahuje
async function loadKot(tid) { if (!KOTI) { try { KOTI = new Set(await (await fetch('kotvy/_index.json')).json()); } catch { KOTI = new Set(); } } if (!KOTI.has(tid)) return (KOT[tid] = []); if (!(tid in KOT)) { try { const r = await fetch(`kotvy/${tid}.json`); KOT[tid] = r.ok ? await r.json() : []; } catch { KOT[tid] = []; } } return KOT[tid]; }
const rawTok = s => plainT(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
// shoda klíčového slova: vzorce (velká písmena/číslice) přesně a s rozlišením velikosti, slova podle kmene (5 znaků)
function kwHit(kw, toks, low) {
  const parts = rawTok(kw).filter(x => !/^\d+$/.test(x)); if (!parts.length) return false;
  return parts.every(x => /[A-Z0-9]/.test(x) || x.length < 4 ? toks.has(x) : low.has(normT(x).slice(0, 5)));
}
function kotTok(text) { const t = rawTok(text); return [new Set(t), new Set(t.map(x => normT(x).slice(0, 5)))]; }
// nejlepší karta k otázce (zmínka v otázce váží víc než v odpovědi)
function kotFor(cards, q) {
  if (!cards || !cards.length) return null;
  const [qt, ql] = kotTok(q.q), [at, al] = kotTok(q.a); let best = null, bs = 0;
  for (const k of cards) { let s = 0; for (const w of k.kw) { if (kwHit(w, qt, ql)) s += 2; else if (kwHit(w, at, al)) s += 1; } if (s > bs) { bs = s; best = k; } }
  return best;
}
const KBR = [['vl', 'Vlastnosti'], ['vy', 'Výroba a reakce'], ['po', 'Použití'], ['ne', 'Účinek a nebezpečí']];
const kbrOf = q => { const x = normT(plainT(q.q)); return /nebezp|toxi|jed|otrav|exploz|antidot|prizna|ucin|karcino|poskoz|smrt|zasah|mechan|inhib|terat|mutag|navyk|zavisl/.test(x) ? 'ne' : /pouzi|vyuzi|k cemu|slouzi|spotreb|uplatn|surovin/.test(x) ? 'po' : /vyrab|vyrob|vznik|ziska|synte|rovnic|reakc|katalyz|pripr|odstran|rozklad|proces|konverz|oxid/.test(x) ? 'vy' : 'vl'; };
// SmilesDrawer se načte až při první struktuře
let SDP = null;
const loadSD = () => SDP || (SDP = new Promise((ok, ko) => { const sc = document.createElement('script'); sc.src = 'vendor/smiles-drawer/smiles-drawer.min.js'; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc); }));
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
function statePic(st, c) {                   // ikona skupenství v barvě látky
  const d = `color-mix(in srgb, ${c} 70%, #000)`;
  const g = st === 'g' ? `<circle cx="22" cy="34" r="11" fill="${c}" fill-opacity=".55" stroke="${d}"/><circle cx="36" cy="26" r="13" fill="${c}" fill-opacity=".7" stroke="${d}"/><circle cx="45" cy="38" r="9" fill="${c}" fill-opacity=".5" stroke="${d}"/>`
    : st === 'l' ? `<path d="M32 8 C32 8 14 30 14 40 a18 18 0 0 0 36 0 C50 30 32 8 32 8Z" fill="${c}" stroke="${d}" stroke-width="1.5"/><path d="M24 40 a8 8 0 0 0 6 8" stroke="#fff" stroke-opacity=".6" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
      : `<path d="M32 6 L54 19 L54 45 L32 58 L10 45 L10 19 Z" fill="${c}" stroke="${d}" stroke-width="1.5"/><path d="M32 6 L32 32 L54 19 M32 32 L10 19 M32 32 L32 58" stroke="${d}" stroke-opacity=".45" fill="none"/><path d="M10 19 L32 32 L32 58 L10 45 Z" fill="#000" fill-opacity=".12"/>`;
  return `<svg viewBox="0 0 64 64" class="kpic-st" aria-hidden="true">${g}</svg>`;
}
// karta: střed (obrázek, název, vzorec, vzhled) + větve s fakty z odpovědí; fakt aktuální otázky zvýrazněn
function kotCard(k, t, curQ) {
  const box = el('div', 'kcard'), mid = el('div', 'kmid'), pic = el('div', 'kpic');
  if (k.smi) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'kpic-smi'); pic.appendChild(svg); pic.insertAdjacentHTML('beforeend', `<span class="kdot" style="background:${k.c}"></span>`);
    loadSD().then(() => SmilesDrawer.parse(k.smi, tree => { new SmilesDrawer.SvgDrawer({ width: 240, height: 170, bondThickness: 1.1, padding: 12 }).draw(tree, svg, dark() ? 'dark' : 'light'); }, () => { pic.innerHTML = statePic(k.st, k.c); })).catch(() => { pic.innerHTML = statePic(k.st, k.c); }); }
  else pic.innerHTML = statePic(k.st, k.c);
  const nm = el('div', 'kname', k.n); mid.append(pic, nm);
  if (k.f) { const f = el('div', 'kf'); f.dataset.tex = `\\ce{${k.f}}`; f.className = 'kf math'; mid.appendChild(f); }
  if (k.vz) mid.appendChild(el('div', 'kvz', k.vz));
  box.appendChild(mid);
  const seen = new Set(), by = {};
  const qs = [...(curQ ? [curQ] : []), ...t.qs.filter(q => q !== curQ)].filter(q => kotFor([k], q) && kotFor(KOT[t.id], q) === k);
  for (const q of qs) { const a = plainT(q.a).replace(/\s+/g, ' ').trim(), key = normT(a).slice(0, 40); if (seen.has(key)) continue; seen.add(key); const b = kbrOf(q); (by[b] = by[b] || []).push({ a: a.length > 130 ? a.slice(0, 127) + '…' : a, cur: q === curQ }); }
  const br = el('div', 'kbr'); let n = 0;
  for (const [id, lab] of KBR) { const L = (by[id] || []).slice(0, 3); if (!L.length) continue; n++; const b = el('div', 'kb kb-' + id); b.appendChild(el('div', 'kbl', lab)); const ul = el('ul'); for (const x of L) ul.appendChild(el('li', x.cur ? 'cur' : null, x.a)); b.appendChild(ul); br.appendChild(b); }
  if (n) box.appendChild(br);
  mathify(box); return box;
}
// karty k několika otázkám (bez opakování)
function kotCards(t, qs, curQ) { const out = [], used = new Set(); for (const q of qs) { const k = kotFor(KOT[t.id], q); if (k && !used.has(k)) { used.add(k); out.push(kotCard(k, t, curQ || q)); } } return out; }
// HTML výňatku k otázkám (v pořadí výkladu, s nadpisy podsekcí); '' když se nic nenašlo
function excerpt(key, html, qs) {
  const C = chunksOf(key, html), pick = new Set(); for (const q of qs) { for (const i of chunkIdx(C, q)) pick.add(i); const f = figIdx(C, q); if (f >= 0) pick.add(f); }
  let out = '', h = null;
  for (const i of [...pick].sort((a, b) => a - b)) { const c = C.list[i]; if (c.h && c.h !== h) { out += `<h4>${c.h.replace(/</g, '&lt;')}</h4>`; h = c.h; } out += c.html; }
  return out;
}
// výňatek se zvýrazněnými slovy z odpovědi
function markedDiv(html, terms) {
  const d = el('div', 'ucont uex'); d.innerHTML = html; fixTables(d);
  const tw = document.createTreeWalker(d, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('[data-tex],figcaption') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodes = []; while (tw.nextNode()) nodes.push(tw.currentNode);
  for (const n of nodes) {
    const s = n.nodeValue; let last = 0, hit = false; const fr = document.createDocumentFragment();
    for (const m of s.matchAll(/[\p{L}\p{N}]+/gu)) { if (m[0].length < 2 || !terms.has(stemW(m[0]))) continue; hit = true; fr.append(s.slice(last, m.index), el('mark', null, m[0])); last = m.index + m[0].length; }
    if (hit) { fr.append(s.slice(last)); n.replaceWith(fr); }
  }
  mathify(d); return d;
}
async function startLearn(t, ctx, review) {
  await loadKot(t.id);
  const o = await loadObs(t.id), lv = lvOf(t), f = review ? 'opakovani' : fazeOf(t), z = zadani(t, ctx.kde, f, ctx.min), short = ctx.min <= 10;
  const recent = new Set(((diag[t.id] || {}).h || []).filter(x => x[2] === 3 && x[0] >= today() - 1).map(x => x[1]));
  const base = t.qs.filter(q => !q.c && !recent.has(q.id)), cards = t.qs.filter(q => q.c && !recent.has(q.id));
  const P = n => (o.lv[String(n)] || []).slice();
  const steps = [];
  const C = (title, k) => o[k] && steps.push({ k: 'c', title, html: o[k] });
  const Q = (n, pool) => pool.slice(0, n).forEach(q => steps.push({ k: 'q', q }));
  const X = (n, cnt) => P(n).slice(0, cnt).forEach(p => steps.push({ k: 'p', p, lv: n }));
  if (f === 'uceni') {
    if (o.an) steps.push({ k: 'c', title: 'Představ si to takhle', html: o.an, an: true });
    const ex = z.kratce ? excerpt(t.id, o.jadro, base.slice(0, 3)) : '';
    if (ex) steps.push({ k: 'c', title: 'Krátce – přesně to, na co se pak zeptám', html: ex, full: o.jadro, kq: base.slice(0, 3) });   // krátký blok: jen úseky k otázkám, celý výklad na rozbalení
    else { C('Výklad – přečti, schémata si prohlédni', 'jadro'); if (steps.length) steps[steps.length - 1].kq = base.slice(0, z.papir ? 2 : 3); if (!short && !z.kratce) C('Takhle to vypadá v testu – projdi postup', 'rp'); }
    if (z.papir) { X(1, 2); Q(2, base); } else Q(3, base);            // otázky jen z toho, co právě bylo ve výkladu (první otázky listu = jádro)
  } else if (f === 'cviceni') {
    C('Na co si dát pozor', 'chyby');
    if (z.papir) { X(Math.min(3, lv + 1), short ? 1 : 3); if (!P(Math.min(3, lv + 1)).length) X(2, 3); Q(1, base.slice(2)); } else Q(4, [...base.slice(2), ...cards]);
  } else {
    if (z.papir) { X(P(3).length ? 3 : 2, 1); Q(3, [...cards, ...base].sort(() => Math.random() - .5)); } else Q(4, [...cards, ...base].sort(() => Math.random() - .5));
  }
  if (!steps.some(s => s.k !== 'c')) Q(3, [...base, ...cards]);
  steps.unshift({ k: 'zad', z, f });
  UQ = { mode: 'learn', t, o, lv, f, review, steps, i: 0, gs: [], shown: false, z };
  if (TAB !== 'ucit') go('ucit'); else renderUcit(); window.scrollTo({ top: 0 });
}
function startMock(s) {
  const tt = mockTopics(s), items = [];
  for (const lvl of [3, 2]) for (const t of tt.sort(() => Math.random() - .5)) { if (items.length >= 4) break; const n = (t.np || {})[String(lvl)]; if (n && !items.some(x => x.t === t)) items.push({ t, lvl }); }
  if (!items.length) return toast('Na test nanečisto zatím nemáš probrané látky – nejdřív výklad v Učit');
  Promise.all(items.map(x => loadObs(x.t.id))).then(os => {
    const steps = [{ k: 'zad', mock: true, z: { co: `${items.length} úlohy jako v testu. Počítej na papír na čas (~${items.length * 11} min), pak teprve odkrývej výsledky.`, pom: 'papír, tužka, bez poznámek' + (s === 'CBV' ? ', kalkulačka' : ''), krit: `aspoň ${Math.ceil(items.length * 0.75)} z ${items.length} úloh správně` } }];
    items.forEach((x, i) => { const arr = os[i].lv[String(x.lvl)] || []; const p = arr[Math.floor(Math.random() * arr.length)]; if (p) steps.push({ k: 'p', p, lv: x.lvl, t: x.t }); });
    UQ = { mode: 'learn', mock: s, t: items[0].t, steps, i: 0, gs: [], shown: false, t0: Date.now() };
    if (TAB !== 'ucit') go('ucit'); else renderUcit(); window.scrollTo({ top: 0 });
  });
}
const diagQ = (t, step) => step === 0 ? t.qs[0] : t.qs[Math.min(t.qs.length - 1, 3)];
function topBar(label, frac) {
  const r = el('div', 'stop'); const end = el('button', 'ghost', 'Konec'); end.type = 'button'; end.onclick = () => { UQ = null; renderUcit(); syncNow(false); };
  const pg = el('div', 'prog'); const i = el('i'); i.style.width = Math.round(frac * 100) + '%'; pg.appendChild(i);
  r.append(end, pg, el('span', 'note', label)); return r;
}
function btns(list) { const g = el('div', 'ugr'); for (const [lab, cls, fn] of list) { const b = el('button', cls, lab); b.type = 'button'; b.onclick = fn; g.appendChild(b); } return g; }
function drawUQ() {
  const box = $('uMain'); box.textContent = '';
  const si = `${UQ.mode}:${UQ.ti || 0}:${UQ.step || 0}:${UQ.i || 0}`; box.classList.toggle('fresh', box.dataset.si !== si); box.dataset.si = si;   // animace jen při novém kroku, ne při odkrytí odpovědi
  if (UQ.mode === 'diag') {
    const t = UQ.topics[UQ.ti], q = diagQ(t, UQ.step);
    box.appendChild(topBar(`${UQ.ti + 1}/${UQ.n}`, UQ.ti / UQ.n));
    const c = el('div', 'card ucard'); c.append(el('div', 'meta', `${SUBJN[t.s]} · ${t.n}`), H('q', q.q)); if (UQ.shown) c.appendChild(H('a', q.a)); box.appendChild(c);
    box.appendChild(!UQ.shown
      ? btns([['Ukázat odpověď', 'primary', () => { UQ.shown = true; drawUQ(); }], ['Nevím', 'ghost', () => diagGrade(1, q)], ['Nerozumím otázce', 'ghost', () => diagGrade('X', q)], ['Ještě jsme nebrali', 'ghost', () => diagGrade('B', q)]])
      : btns([['Věděl jsem', 'g3', () => diagGrade(3, q)], ['Zhruba', 'g2', () => diagGrade(2, q)], ['Nevěděl', 'g1', () => diagGrade(1, q)]]));
    return;
  }
  const t = UQ.t, s = UQ.steps[UQ.i];
  box.appendChild(topBar(UQ.mock ? `Test nanečisto · ${SUBJN[UQ.mock]}` : t.n, UQ.i / UQ.steps.length));
  const next = () => { UQ.i++; UQ.shown = false; UQ.fb = null; if (UQ.i >= UQ.steps.length) return learnDone(); drawUQ(); window.scrollTo({ top: 0 }); };
  if (s.k === 'zad') {                                   // zadání bloku: co, s čím, kritérium
    const c = el('div', 'card ucard uzad');
    c.append(el('div', 'meta', UQ.mock ? 'Test nanečisto' : FAZE[UQ.f]), el('h2', null, UQ.mock ? SUBJN[UQ.mock] : t.n));
    const dl = el('dl'); for (const [k, v] of [['Co uděláš', s.z.co], ['S čím', s.z.pom], ['Kritérium', s.z.krit]]) dl.append(el('dt', null, k), el('dd', null, v));
    c.appendChild(dl); box.appendChild(c);
    box.appendChild(btns([['Jdu na to', 'primary', next]])); return;
  }
  if (s.k === 'c') {
    const c = el('div', 'card ucard ucontent' + (s.an ? ' uan' : '')); c.append(el('div', 'meta', s.title), H('ucont', s.html));
    if (s.kq) { const kc = kotCards(t, s.kq); if (kc.length) c.append(el('div', 'meta', kc.length > 1 ? 'Látky, na které si to pověsíš' : 'Látka, na kterou si to pověsíš'), ...kc); }
    if (s.full) { const d = el('details', 'ufb'), sm = el('summary'); sm.textContent = 'Celý výklad (když máš čas)'; d.append(sm); d.ontoggle = () => { if (d.open && d.children.length < 2) d.append(H('ucont', s.full)); }; c.appendChild(d); }
    box.appendChild(c);
    box.appendChild(btns([['Přečteno, dál', 'primary', next]])); return;
  }
  const pt = s.t || t;
  if (s.k === 'p') {
    const c = el('div', 'card ucard'); c.append(el('div', 'meta', `${UQ.mock ? pt.n + ' · ' : ''}Příklad ${s.p.n} · spočítej na papír, pak odkryj`), H('q', s.p.z));
    if (UQ.shown) { c.append(el('div', 'meta', 'Výsledek'), H('a', s.p.r || '—')); if (UQ.shown === 'sol' && s.p.s) c.append(el('div', 'meta', 'Postup krok za krokem'), H('ucont', s.p.s)); }
    box.appendChild(c);
    const id = `p:${pt.id}:${s.p.n}`;
    box.appendChild(!UQ.shown ? btns([['Ukázat výsledek', 'primary', () => { UQ.shown = true; drawUQ(); }], ['Nevím, jak začít – ukaž postup', 'ghost', () => { UQ.shown = 'sol'; rec(pt, id, 1); UQ.gs.push(1); drawUQ(); }]])
      : UQ.shown === 'sol' ? btns([['Prošel jsem postup, dál', 'primary', next]])
        : btns([['Vyšlo', 'g3', () => { rec(pt, id, 3); UQ.gs.push(3); next(); }], ['Nevyšlo – ukaž postup', 'g1', () => { rec(pt, id, 1); UQ.gs.push(1); UQ.shown = 'sol'; drawUQ(); }]]));
    return;
  }
  const q = s.q, c = el('div', 'card ucard'); c.append(el('div', 'meta', q.c ? `${q.c} · odpověz sám, pak otoč` : 'Odpověz sám, pak otoč'), H('q', q.q));
  if (UQ.shown) { if (UQ.fb) c.appendChild(el('div', 'meta', 'Měl jsi odpovědět')); c.appendChild(H('a' + (UQ.fb ? ' uans' : ''), q.a)); }
  if (UQ.shown && !UQ.fb && UQ.o) {                     // kotva: obrázek, na který si odpověď pověsíš (ne před odpovědí, aby ji neprozradil)
    const k = kotFor(KOT[t.id], q); if (k) c.append(el('div', 'meta', 'Látka, na kterou si to pověs'), kotCard(k, t, q));
    else { const fh = figFor(t.id, UQ.o.jadro, q); if (fh) c.append(el('div', 'meta', 'Obrázek, na který si to pověs'), H('ucont ukotva', fh)); }
  }
  if (UQ.fb && UQ.o) {                                   // po špatné odpovědi: jen místo ve výkladu, kde to je, se zvýrazněním
    const ex = excerpt(t.id, UQ.o.jadro, [q]), kk = kotFor(KOT[t.id], q);
    if (kk) c.append(el('div', 'meta', 'Látka, na kterou si to pověs'), kotCard(kk, t, q));
    if (ex) c.append(el('div', 'meta', 'Kde to je ve výkladu'), markedDiv(ex, stems(plainT(q.a))));
    const d = el('details', 'ufb'); d.open = !ex && UQ.f === 'uceni'; const sm = el('summary'); sm.textContent = ex ? 'Celý výklad' : 'Proč – výklad k tématu'; d.append(sm, H('ucont', UQ.o.jadro || UQ.o.v0 || ''));
    if (UQ.o.chyby) { const d2 = el('details', 'ufb'); const s2 = el('summary'); s2.textContent = 'Časté chyby'; d2.append(s2, H('ucont', UQ.o.chyby)); c.append(d, d2); } else c.appendChild(d);
  }
  box.appendChild(c);
  const g = gr => { rec(t, q.id, gr); UQ.gs.push(gr); if (gr <= 1 && !UQ.fb) { UQ.fb = true; UQ.shown = true; drawUQ(); return; } next(); };
  box.appendChild(UQ.fb ? btns([['Rozumím, dál', 'primary', next]])
    : !UQ.shown ? btns([['Ukázat odpověď', 'primary', () => { UQ.shown = true; drawUQ(); }], ['Nerozumím', 'ghost', () => g(0)]])
      : btns([['Věděl jsem', 'g3', () => g(3)], ['Zhruba', 'g2', () => g(2)], ['Nevěděl', 'g1', () => g(1)]]));
}
function saveDiag(tid, r) { diag[tid] = { ...r, ts: Date.now() }; ls.set('k_diag', diag); dirty.add('srs_DIAG'); persist(); schedulePush(); }
function rec(t, id, g) { const r = diag[t.id] || { h: [] }; saveDiag(t.id, { ...r, h: [...(r.h || []), [today(), id, g]].slice(-60) }); }
function grade2st(gs) {
  if (gs.includes('B')) return 'B'; if (gs.includes('X')) return 'X';
  const n = gs.map(Number); if (n[0] <= 1) return 1; if (n[0] === 2) return 2;
  if (n.length < 2) return 3; return n[1] === 3 ? 4 : n[1] === 2 ? 3 : 2;
}
function nextRev(t, lv) { const ts = topicTest(t); let nx = today() + GAP[Math.min(lv, 4)]; if (ts && nx >= ts.day) nx = Math.max(today() + 1, ts.day - 1); return nx; }
function diagGrade(g, q) {
  const t = UQ.topics[UQ.ti]; UQ.gs.push(String(g));
  const r = diag[t.id] || { h: [] }; r.h = [...(r.h || []), [today(), q.id, g === 'X' ? 0 : g === 'B' ? -1 : g]].slice(-60);
  if (UQ.step === 0 && g === 3 && t.qs.length > 1) { saveDiag(t.id, r); UQ.step = 1; UQ.shown = false; return drawUQ(); }
  const st = grade2st(UQ.gs), lv = { X: 0, 1: 0, 2: 1, 3: 2, 4: 3 }[st] ?? 0;
  saveDiag(t.id, { ...r, st: st === 'B' || st === 'X' ? st : +st, lv: Math.max(lv, Math.min(lvOf(t), lv + 1)), nx: st === 'B' ? 0 : today() + 1, up: today() });
  UQ.ti++; UQ.step = 0; UQ.gs = []; UQ.shown = false;
  if (UQ.ti >= UQ.topics.length) { const n = UQ.n; UQ = null; toast(`Ověřeno: ${n} ${n === 1 ? 'téma' : 'témat'}`); renderUcit(); syncNow(false); return; }
  drawUQ();
}
// co v bloku nevyšlo (hodnocené kroky jdou ve stejném pořadí jako známky)
function badItems() {
  const gr = UQ.steps.filter(s => s.k === 'p' || s.k === 'q'), out = [];
  UQ.gs.forEach((g, i) => { const s = gr[i]; if (!s || g > 1) return; out.push(s.k === 'p' ? { l: `${s.t && UQ.mock ? s.t.n + ' – ' : ''}příklad ${s.p.n}`, a: s.p.r } : { l: plainT(s.q.q).replace(/\s+/g, ' ').trim(), a: s.q.a }); });
  return out;
}
function learnDone() {
  const bi = badItems(), gs = UQ.gs, ok = gs.filter(g => g === 3).length, n = gs.length, pass = n ? ok >= Math.ceil(n * 2 / 3) : true;
  if (UQ.mock) {
    const need = Math.ceil(n * 0.75), min = Math.round((Date.now() - UQ.t0) / 60000);
    return blockResult(`Test nanečisto: ${ok}/${n} úloh`, ok >= need ? `Splněno (potřeba ${need}). Čas ${min} min.` : `Nesplněno (potřeba ${need}). Čas ${min} min. Úlohy, které nevyšly, přijdou v příštích blocích jako cvičení.`, ok >= need, bi);
  }
  const t = UQ.t, r = { ...(diag[t.id] || { h: [] }) }, bad = gs.filter(g => g <= 1).length;
  let lv = r.lv || 0, nxt;
  if (UQ.review) { if (bad > ok) lv = Math.max(0, lv - 1); }
  else if (pass && r.up !== today()) { lv = Math.min(4, lv + 1); r.up = today(); }
  else if (!pass && bad > ok) lv = Math.max(0, lv - 1);
  const st = lv >= 3 ? 4 : lv === 2 ? 3 : lv === 1 ? 2 : (r.st === 'X' && !ok ? 'X' : 1);
  saveDiag(t.id, { ...r, lv, st, nx: nextRev(t, lv) });
  const nf = lv <= 0 ? 'znovu učení – s jiným příkladem' : lv <= 2 ? 'cvičení (těžší příklady)' : 'opakování v rozestupu';
  const nd = nextRev(t, lv) - today();
  nxt = pass ? `Splněno. Příště ${inDays(nd)}: ${nf}.` : `Ještě ne. Příště ${inDays(Math.min(nd, 1))}: ${nf}. Výklad a postupy máš v Mapě u tématu.`;
  blockResult(`${t.n}: ${ok}/${n} správně (potřeba ${Math.ceil(n * 2 / 3)})`, nxt, pass, bi);
}
function blockResult(head, txt, pass, bad = []) {
  UQ = null; const box = $('uMain'); box.textContent = ''; box.classList.add('fresh'); delete box.dataset.si;
  const c = el('div', 'card ucard ures ' + (pass ? 'ok' : 'ne')); c.append(el('div', 'meta', pass ? 'Kritérium bloku splněno ✓' : 'Kritérium bloku zatím nesplněno'), el('h2', null, head), el('p', null, txt));
  if (bad.length) { const ul = el('ul', 'ubad'); for (const b of bad) { const li = el('li'); li.append(el('b', null, b.l)); if (b.a) li.append(H('ubada', b.a)); ul.appendChild(li); } c.append(el('div', 'meta', 'Co nevyšlo – příště začneš tímhle'), ul); }
  box.appendChild(c); box.appendChild(btns([['Další krok', 'primary', () => renderUcit()]])); syncNow(false); window.scrollTo({ top: 0 });
}

// export výsledků jako text (pro vložení do chatu, když sync neběží)
async function exportDiag() {
  const L = [`DIAG ${dayIso(today())}`]; const qmap = {};
  for (const t of UT) for (const q of t.qs) qmap[q.id] = q.q.replace(/<span class="math[^"]*" data-tex="([^"]*)"><\/span>/g, '$$$1$$').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
  for (const t of UT) {
    const r = diag[t.id]; if (!r) continue;
    const bad = (r.h || []).filter(x => x[2] <= 1 && x[2] >= 0).map(x => (x[2] === 0 ? '?' : '-') + (qmap[x[1]] || x[1]).slice(0, 70));
    L.push(`${t.id}|${r.st}|V${r.lv || 0}${bad.length ? '|' + [...new Set(bad)].join(' ; ') : ''}`);
  }
  const txt = L.join('\n');
  try { if (navigator.share) { await navigator.share({ text: txt }); return; } } catch { /* zrušeno */ }
  try { await navigator.clipboard.writeText(txt); toast('Zkopírováno – vlož to Claudovi do chatu'); }
  catch { const ta = el('textarea'); ta.value = txt; ta.style.width = '100%'; ta.rows = 8; $('mMain').prepend(ta); ta.select(); toast('Označ a zkopíruj text nahoře'); }
}

// ---------- ovládání
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
$('syncChip').onclick = () => syncCfg() ? syncNow(true) : go('vic');

$('sySave').onclick = async () => {
  const url = $('syUrl').value.trim(), token = $('syTok').value.trim();
  if (!url || !token) { $('syMsg').textContent = 'Vyplň URL i token.'; return; }
  ls.set('k_sync', { url, token });
  $('syMsg').textContent = 'Zkouším spojení…';
  try {
    const d = await api({ url, token }, 'GET', { action: 'ping' });
    $('syMsg').textContent = `Spojení OK – tabulka „${d.name}“. Nahrávám stav…`;
    for (const s of SUBJS) dirty.add('srs_' + s); dirty.add('meta'); dirty.add('done'); dirty.add('srs_DIAG'); persist();
    await syncNow(false);
    $('syMsg').textContent = `Spojení OK – tabulka „${d.name}“. Synchronizuje se.`;
  } catch (e) { $('syMsg').textContent = 'Spojení selhalo: ' + e.message + '. Zkontroluj URL (končí /exec), token a že nasazení má přístup „Kdokoli“.'; }
};
$('syNow').onclick = () => syncNow(true);
$('exBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ v: 3, diag, srs, log, set, done })], { type: 'application/json' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `studium-zaloha-${dayIso(today())}.json`; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); $('exMsg').textContent = 'Záloha stažena.';
};
$('imFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (!d.srs && !d.diag) throw new Error('bad'); let n = 0, nd = 0;
    for (const [k, v] of Object.entries(d.diag || {})) if (!diag[k] || (v.ts || 0) > (diag[k].ts || 0)) { diag[k] = v; nd++; }
    if (nd) { ls.set('k_diag', diag); dirty.add('srs_DIAG'); }
    for (const [k, v] of Object.entries(d.srs || {})) { if (!BYID[k]) continue; const m = mergeRec(srs[k], v); if (m !== srs[k]) { srs[k] = m; n++; dirty.add('srs_' + shardOf(k)); } }
    for (const [k, v] of Object.entries(d.log || {})) if (!log[k] || v[0] > log[k][0]) log[k] = v;
    for (const [k, v] of Object.entries(d.done || {})) if (!done[k] || v[1] > done[k][1]) done[k] = v;
    dirty.add('meta'); dirty.add('done'); persist(); schedulePush(); refresh(); $('exMsg').textContent = `Obnoveno: ${nd} témat z mapy znalostí.`;
  } catch { $('exMsg').textContent = 'Soubor není záloha.'; }
  e.target.value = '';
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (dirty.size) syncNow(false); }
  else { if (Date.now() - lastPull > 60e3) syncNow(false); if (!UQ) refresh(); }
});
window.addEventListener('online', () => syncNow(false));
window.addEventListener('offline', syncState);
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (!UQ && TABS.includes(t) && t !== TAB) go(t); });

// ---------- start
srs = ls.get('k_srs', {}); diag = ls.get('k_diag', {}); log = ls.get('k_log', {}); set = { ...set, ...ls.get('k_set', {}) }; done = ls.get('k_done', null);
if (!done) { done = {}; for (const id of SEED_DONE) done[id] = [true, 1]; persist(); }
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  // nová verze appky: service worker se aktivuje sám (skipWaiting) → jednou přenačíst, ať je vidět hned
  const hadCtl = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadCtl && !reloaded && !UQ) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('./sw.js').then(r => { r.update(); document.addEventListener('visibilitychange', () => { if (!document.hidden) r.update(); }); });
}
Promise.all([fetch('cards.json').then(r => r.json()), fetch('semestr.json').then(r => r.json()), fetch('uceni.json').then(r => r.json()).catch(() => null)]).then(([d, sm, uc]) => {
  if (uc) { UC = uc; UT = uc.topics.filter(t => !NEDELAM.test(t.n)); UBY = Object.fromEntries(UT.map(t => [t.id, t])); }
  DATA = d; SEM = sm; CARDS = d.cards; BYID = Object.fromEntries(CARDS.map(c => [c.id, c])); W1 = isoToDay(d.w1);
  const tm = new Map();
  for (const c of CARDS) { if (!tm.has(c.t)) tm.set(c.t, { t: c.t, tn: c.tn, s: c.s, w: c.w }); else tm.get(c.t).w = Math.min(tm.get(c.t).w, c.w); }
  TOPICS = [...tm.values()].sort((a, b) => a.s.localeCompare(b.s) || a.w - b.w || a.t.localeCompare(b.t));
  const t = location.hash.slice(1); go(TABS.includes(t) ? t : 'ucit');
  syncNow(false);
}).catch(() => { document.querySelector('main').prepend(el('div', 'panel note', 'Data se nepodařilo načíst. Napoprvé je potřeba internet, pak už appka jde offline.')); syncLabel('offline'); });

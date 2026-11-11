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
    if (changed && !S) refresh();
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
function nextTest(s, from) { let best = null; for (const t of DATA.tests) { if (t.s !== s) continue; const d = isoToDay(t.d); if (d >= from && (!best || d < best.day)) best = { day: d, n: t.n }; } return best; }
function unlocked(c) {
  if (c.d === '9') { if (set.dopl || weekNow() >= 15) return true; const ex = EXAM[c.s]; return ex ? isoToDay(ex) - today() <= 21 : false; }
  return c.w <= weekNow() + (set.ahead ? 1 : 0);
}
const testRank = c => { const t = nextTest(c.s, today()); return t ? t.day : 99999; };
const Rnow = (r, td) => Rof(Math.max(0, td - r[0]), r[1]);
const newToday = () => (log[dayIso(today())] || [0, 0, 0])[2];
const newLeft = () => Math.max(0, set.newPerDay - newToday());
function pools(filter) {
  const td = today(), due = [], fresh = [];
  for (const c of CARDS) {
    if (filter && !filter(c)) continue;
    const r = srs[c.id];
    if (r) { if (r[5] <= td) due.push(c); } else if (unlocked(c)) fresh.push(c);
  }
  due.sort((a, b) => testRank(a) - testRank(b) || Rnow(srs[a.id], td) - Rnow(srs[b.id], td));
  fresh.sort((a, b) => a.w - b.w || testRank(a) - testRank(b));
  return { due, fresh };
}
function schedIvl(st, c, g) {
  let iv = g === 1 ? 1 : Math.max(1, Math.round(ivlOf(st.S, set.ret)));
  if (iv > 4) { const h = parseInt(c.id.slice(0, 4), 16) / 65535; iv = Math.round(iv * (0.95 + 0.1 * h)); }
  iv = Math.min(iv, MAXIVL);
  if (set.test) { const t = nextTest(c.s, today() + 1); if (t) { const lim = t.day - 1 - today(); if (lim >= 1 && iv > lim && lim >= Math.min(3, iv)) iv = lim; } }
  return iv;
}
const toSt = r => r ? { last: r[0], S: r[1], D: r[2], reps: r[3], lapses: r[4] } : null;
function topicStats(t) {
  let n = 0, due = 0, fresh = 0, lock = 0, known = 0, lap = 0, reps = 0; const td = today();
  for (const c of CARDS) { if (c.t !== t) continue; n++; const r = srs[c.id]; if (r) { if (r[5] <= td) due++; if (r[1] >= 21) known++; lap += r[4]; reps += r[3]; } else if (unlocked(c)) fresh++; else lock++; }
  return { n, due, fresh, lock, known, lap, reps };
}

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
const TABS = ['ucit', 'mapa', 'tyden', 'vic', 'dnes', 'karticky', 'predmety'];
let TAB = 'ucit', KSEG = ls.get('k_seg', 'opak');
function go(tab) {
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
  if (TAB === 'dnes') renderDnes();
  if (TAB === 'tyden') renderTyden();
  if (TAB === 'karticky') renderKarticky();
  if (TAB === 'ucit') renderUcit();
  if (TAB === 'mapa') renderMapa();
  if (TAB === 'predmety') renderPredmety();
  if (TAB === 'vic') renderVic();
}
function renderHeader() {
  const wk = weekNow(); $('wkChip').textContent = inCamp() ? 'soustředění' : wk >= 1 && wk <= 14 ? `${wk}. týden` : wk > 14 ? 'zkouškové' : 'před semestrem';
  const { due, fresh } = pools(); const n = due.length + Math.min(newLeft(), fresh.length);
  $('badge').hidden = true; $('badge').textContent = n;
  syncState();
}

// ----- DNES
function renderNow() {
  const box = $('nowCard'); box.textContent = '';
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
  const put = (small, strong, how, after) => { box.append(el('small', null, small), el('strong', null, strong)); if (how) box.appendChild(el('span', 'how', how)); if (after) box.appendChild(el('span', 'after', after)); };
  if (inCamp()) return put('Soustředění', 'Kartičky a audio', 'Nové listy neplánuj. Opakuj kartičky na cestách, nové jen polovinu.');
  if (m >= 21 * 60 + 20 || m < 6 * 60 + 20) return put('Teď', 'Spánek (21:20–6:20)', 'Ráno se sem podívej, co je na řadě.');
  const bl = SEM.rezim[((now.getDay() + 6) % 7) + 1] || [];
  const cur = bl.find(b => mins(b.a) <= m && m < mins(b.b)), nxt = bl.find(b => mins(b.a) > m);
  const show = cur || nxt;
  if (!show) return put('Teď', 'Volno');
  put(`${cur ? 'Teď' : 'Za chvíli'} · ${show.a}–${show.b}`, show.co, show.jak, cur && nxt ? `Potom ${nxt.a}: ${nxt.co}` : '');
}
let selDay = ((new Date().getDay() + 6) % 7) + 1;
function renderSched() {
  const realDay = ((new Date().getDay() + 6) % 7) + 1, DNY = ['', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
  const ch = $('dayChips'); ch.textContent = '';
  for (let i = 1; i <= 7; i++) { const b = el('button', 'chip', DNY[i] + (i === realDay ? ' · dnes' : '')); b.type = 'button'; b.setAttribute('aria-pressed', String(i === selDay)); b.onclick = () => { selDay = i; renderSched(); }; ch.appendChild(b); }
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes(), ol = $('sched'); ol.textContent = '';
  for (const b of SEM.rezim[selDay] || []) {
    const li = el('li', b.t); if (selDay === realDay && mins(b.a) <= m && m < mins(b.b)) li.classList.add('cur'); else if (selDay === realDay && mins(b.b) <= m) li.classList.add('gone');
    li.append(el('span', 'tm', `${b.a}–${b.b}`), el('span', 'co', b.co)); if (b.jak) li.appendChild(el('span', 'jak', b.jak)); ol.appendChild(li);
  }
}
function renderDnes() {
  const td = today();
  renderNow();
  $('dTitle').textContent = `Dnes · ${fmtDW(td)}`;
  const { due, fresh } = pools(); const nNew = Math.min(newLeft(), fresh.length);
  $('hDue').textContent = due.length; $('hNew').textContent = nNew; $('hDone').textContent = (log[dayIso(td)] || [0])[0];
  $('dEta').textContent = due.length + nNew ? `asi ${Math.max(1, Math.round((due.length * 8 + nNew * 20) / 60))} min` : '';
  $('startAll').disabled = due.length + nNew === 0; $('startAll').textContent = due.length + nNew ? `Začít kartičky (${due.length + nNew})` : 'Kartičky na dnes hotové';
  const backlog = fresh.length - nNew;
  $('hNote').textContent = backlog > 0 ? `Odemčených nových čeká ještě ${backlog} – víc nových za den nastavíš ve Víc.` : '';
  // týden
  const w = SEM.tydny.find(x => x.n === semWeek()); const gs = weekGroups(w);
  let all = 0, ok = 0; const open = [];
  for (const g of gs) for (const it of g.items) { all++; if (isDone(it[0])) ok++; else open.push({ g, it }); }
  const dm = fmtD(td).replace(/\s/g, ' ');
  open.sort((a, b) => (b.it[1].includes(dm) - a.it[1].includes(dm)) || gRank(a.g) - gRank(b.g));
  $('wkBar').style.width = (all ? ok / all * 100 : 0) + '%';
  $('wkSum').textContent = all ? `${ok} z ${all} hotovo${open.length > 6 ? ` · ukazuju 6 nejdůležitějších z ${open.length}` : ''}` : 'Tento týden nic naplánováno.';
  const ul = $('dWeek'); ul.textContent = '';
  for (const { g, it } of open.slice(0, 6)) ul.appendChild(todoItem(it[0], it[1], g.h.replace(/^\S+\s/, '') + (it[2] ? ' · ' + it[2] : ''), () => setTimeout(renderDnes, 350)));
  if (all && !open.length) ul.appendChild(el('li', 'empty', 'Všechno z tohoto týdne je hotové.'));
  // opakování listů
  // jen poslední 3 dny – starší zpoždění by seznam zahltilo (kartičky je stejně pokrývají)
  const rAll = revDue(), t = dayIso(td), cut = dayIso(td - 3);
  const rd = rAll.filter(p => p.date >= cut), old = rAll.filter(p => p.date < cut);
  $('revSum').textContent = rd.length ? `${rd.length} na dnes` : '';
  const ru = $('dRev'); ru.textContent = '';
  for (const p of rd.slice(0, 6)) ru.appendChild(todoItem('r-' + p.date + p.id + p.typ, `${p.id} ${p.tema}`, p.typ + (p.date < t ? ` · od ${+p.date.slice(8, 10)}. ${+p.date.slice(5, 7)}.` : ''), () => setTimeout(renderDnes, 350), p.subj));
  if (!rd.length) { const nx = SEM.plan.find(p => p.date > t); ru.appendChild(el('li', 'empty', nx ? `Dnes nic. Další ${+nx.date.slice(8, 10)}. ${+nx.date.slice(5, 7)}.: ${nx.id}` : 'Dnes nic.')); }
  else if (rd.length > 6) ru.appendChild(el('li', 'empty', `+ ${rd.length - 6} dalších`));
  if (old.length) {
    // dvojí klepnutí – jedno omylem nic neodškrtne
    const li = el('li', 'empty'), b = el('button', 'link', `Odškrtnout ${old.length} starších (zpoždění z minulých dní)`); b.type = 'button';
    let armed = null;
    b.onclick = () => {
      if (!armed) { b.textContent = `Opravdu odškrtnout ${old.length} položek? Klepni znovu`; armed = setTimeout(() => { armed = null; b.textContent = `Odškrtnout ${old.length} starších (zpoždění z minulých dní)`; }, 4000); return; }
      clearTimeout(armed); const ts = Date.now(); for (const p of old) done['r-' + p.date + p.id + p.typ] = [true, ts]; dirty.add('done'); persist(); schedulePush(); renderDnes(); toast(`Odškrtnuto ${old.length} položek – vrátit jde hned pod seznamem`);
    };
    li.appendChild(b); ru.appendChild(li);
  }
  const bulk = lastBulk();
  if (bulk) {
    const li = el('li', 'empty'), b = el('button', 'link', `↶ Vrátit hromadné odškrtnutí ${bulk.ids.length} položek (${bulk.when})`); b.type = 'button';
    b.onclick = () => { undoBulk(bulk); renderDnes(); toast(`Vráceno ${bulk.ids.length} položek`); };
    li.appendChild(b); ru.appendChild(li);
  }
  // termíny
  const evb = $('dEv'); evb.textContent = '';
  for (const e of SEM.ev.filter(e => isoToDay(e[0]) >= td).slice(0, 4)) {
    const r = el('div', 'li'), nm = el('span', 'nm'), d = isoToDay(e[0]) - td;
    nm.append(tag(e[1]), e[2]); nm.appendChild(el('small', null, `${fmtDW(isoToDay(e[0]))} · ${inDays(d)}`));
    r.append(nm, el('span', 'num note', d <= 7 ? `${d} d` : '')); evb.appendChild(r);
  }
  if ($('schedBox').open) renderSched();
}

// ----- TÝDEN
let wkSel = null;
const openG = new Set(ls.get('k_openG', []));
function renderTyden() {
  if (wkSel == null) wkSel = semWeek();
  const w = SEM.tydny.find(x => x.n === wkSel); const box = $('weekGroups'); box.textContent = '';
  if (!w) { $('wkTitle').textContent = 'mimo semestr'; return; }
  const od = isoToDay(w.od), dd = isoToDay(w.do);
  $('wkTitle').textContent = `${w.n > 14 ? 'zkouškové · ' : ''}${w.n}. týden · ${fmtD(od)}–${fmtD(dd)}${w.camp ? ' · soustředění' : ''}${w.n === semWeek() ? ' · teď' : ''}`;
  let all = 0, ok = 0;
  for (const g of weekGroups(w)) {
    const okG = g.items.filter(it => isDone(it[0])).length; all += g.items.length; ok += okG;
    const d = el('details', 'grp'); const key = w.n + g.h;
    d.open = openG.has(key) || (okG < g.items.length && gRank(g) <= 2);
    d.addEventListener('toggle', () => { d.open ? openG.add(key) : openG.delete(key); ls.set('k_openG', [...openG]); });
    const sm = el('summary'); sm.append(el('b', null, g.h), el('span', 'cnt' + (okG === g.items.length ? ' full' : ''), `${okG}/${g.items.length}`)); if (g.kdy) sm.appendChild(el('small', null, g.kdy));
    const ul = el('ul', 'todo');
    for (const [id, t, m] of g.items) ul.appendChild(todoItem(id, t, m, renderTydenCounts));
    d.append(sm, ul); box.appendChild(d);
  }
  $('wkBar2').style.width = (all ? ok / all * 100 : 0) + '%';
  $('wkProg').textContent = `Hotovo ${ok} z ${all}`;
}
function renderTydenCounts() { const sY = window.scrollY; renderTyden(); window.scrollTo({ top: sY }); }

// ----- KARTIČKY
function renderKarticky() {
  document.querySelectorAll('#kSeg button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.k === KSEG)));
  document.querySelectorAll('section[data-tab="karticky"] > [data-k]').forEach(p => p.hidden = p.dataset.k !== KSEG);
  if (KSEG === 'opak') { renderPick(); renderDecks(); }
  if (KSEG === 'temata') renderTopics();
  if (KSEG === 'stat') renderStats();
}
function renderPick() {
  const box = $('studyPick'); box.textContent = '';
  const add = (label, sub, fn) => { const b = el('button', 'li'); b.type = 'button'; const nm = el('span', 'nm', label); nm.appendChild(el('small', null, sub)); b.append(nm, el('span', 'c-due', '›')); b.onclick = fn; box.appendChild(b); };
  const { due, fresh } = pools();
  add('Vše na dnes', `${due.length} opakování + ${Math.min(newLeft(), fresh.length)} nových`, () => startSession(null, false, 'Vše na dnes'));
  for (const s of SUBJS) {
    const p = pools(c => c.s === s); const n = p.due.length + Math.min(newLeft(), p.fresh.length); if (!n) continue;
    add(SUBJN[s], `${p.due.length} opakování + ${Math.min(newLeft(), p.fresh.length)} nových`, () => startSession(c => c.s === s, false, SUBJN[s]));
  }
  add('Jen filozofie témat', 'odemčené karty typu Filozofie, procvičení bez vlivu na plán', () => startSession(c => c.y === 'F' && (srs[c.id] || unlocked(c)), true, 'Filozofie'));
}
function renderDecks() {
  const td = today(), box = $('decks'); box.textContent = '';
  for (const dk of Object.keys(DECKN)) {
    const cs = CARDS.filter(c => c.d === dk); let du = 0, nw = 0, lock = 0, known = 0;
    for (const c of cs) { const r = srs[c.id]; if (r) { if (r[5] <= td) du++; if (r[1] >= 21) known++; } else if (unlocked(c)) nw++; else lock++; }
    const b = el('button', 'li'); b.type = 'button'; const nm = el('span', 'nm', DECKN[dk]);
    nm.appendChild(el('small', null, `${cs.length} kartiček · ${known} pevně v paměti`));
    const bar = el('div', 'bar'); const bi = el('i'); bi.style.width = (cs.length ? known / cs.length * 100 : 0) + '%'; bar.appendChild(bi); nm.appendChild(bar);
    const ct = el('span', 'counts'); ct.append(el('span', 'c-due', du), el('span', 'c-new', Math.min(nw, newLeft())), el('span', 'c-lock', lock));
    b.append(nm, ct); b.onclick = () => startSession(c => c.d === dk, false, DECKN[dk]); box.appendChild(b);
  }
}
let subjF = ls.get('k_subj', 'CHT');
function renderTopics() {
  const ch = $('subjChips'); ch.textContent = '';
  for (const s of SUBJS) { const b = el('button', 'chip', SUBJN[s]); b.type = 'button'; b.setAttribute('aria-pressed', String(s === subjF)); b.onclick = () => { subjF = s; ls.set('k_subj', s); renderTopics(); }; ch.appendChild(b); }
  const box = $('topicList'); box.textContent = '';
  for (const tp of TOPICS.filter(t => t.s === subjF)) {
    const st = topicStats(tp.t); const d = el('details', 'fz'); const sm = el('summary');
    const lk = st.lock === st.n;
    sm.append(el('b', null, tp.t + ' '), tp.tn, el('span', 'note', ` · ${tp.w < 99 ? tp.w + '. týden' : 'bez týdne'} · ${lk ? 'zamčeno' : `${st.known}/${st.n} v paměti`}${st.due ? ` · ${st.due} k opakování` : ''}`));
    d.appendChild(sm);
    d.addEventListener('toggle', () => {
      if (!d.open || d.dataset.f) return; d.dataset.f = 1;
      const body = el('div', 'fzq');
      const bar = el('div', 'bar'); const bi = el('i'); bi.style.width = (st.known / st.n * 100) + '%'; bar.appendChild(bi); body.appendChild(bar);
      const fz = CARDS.filter(c => c.t === tp.t && c.y === 'F');
      if (fz.length) { body.appendChild(el('h3', null, 'Filozofie tématu')); for (const c of fz) { const x = el('div'); x.append(el('b', null, c.q), c.a); body.appendChild(x); } }
      const row = el('div', 'row');
      const b1 = el('button', 'ghost', 'Procvičit téma'); b1.type = 'button'; b1.onclick = () => startSession(c => c.t === tp.t && c.d !== '9', true, tp.t);
      const b2 = el('button', 'ghost', 'Opakovat podle plánu'); b2.type = 'button'; b2.disabled = !(st.due || st.fresh); b2.onclick = () => startSession(c => c.t === tp.t, false, tp.t);
      row.append(b1, b2); body.appendChild(row); d.appendChild(body);
    });
    box.appendChild(d);
  }
}
function renderStats() {
  const td = today();
  let tot = 0, ag = 0, days = 0; for (let i = 0; i < 28; i++) { const L = log[dayIso(td - i)]; if (L && L[0]) { tot += L[0]; ag += L[1]; days++; } }
  let streak = 0; for (let i = 0; i < 400; i++) { const L = log[dayIso(td - i)]; if (L && L[0]) streak++; else if (i === 0) continue; else break; }
  const inMem = Object.values(srs).filter(r => r[1] >= 21).length, started = Object.keys(srs).length;
  const k = $('kpis'); k.textContent = '';
  for (const [l, v, s] of [['Hotovo dnes', (log[dayIso(td)] || [0])[0], ''], ['Úspěšnost 28 d', tot ? Math.round(100 * (1 - ag / tot)) + ' %' : '–', `${tot} hodnocení`], ['Rozjeto / v paměti', `${started} / ${inMem}`, `z ${CARDS.length}`], ['Série', streak + ' d', 'dny v řadě s opakováním']]) {
    const x = el('div', 'kpi'); x.append(el('span', 'l', l), el('span', 'v', v)); if (s) x.appendChild(el('span', 'note', s)); k.appendChild(x);
  }
  const fc = new Array(14).fill(0); for (const r of Object.values(srs)) { const i = Math.max(0, r[5] - td); if (i < 14) fc[i]++; }
  const w = 600, h = 160, L = 36, R = 6, T = 10, B = 22, ih = h - T - B, iw = w - L - R, mx = Math.max(5, ...fc), nice = Math.ceil(mx / 5) * 5; let g = '';
  for (let q = 0; q <= 4; q++) { const y = T + ih - ih * q / 4; g += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 6}" y="${y + 3}" text-anchor="end">${Math.round(nice * q / 4)}</text>`; }
  const bw = iw / 14; fc.forEach((v, i) => {
    const bh = ih * v / nice, x = L + i * bw + bw * .15; const dd = new Date((td + i) * DAY);
    g += `<rect x="${x}" y="${T + ih - bh}" width="${bw * .7}" height="${bh}" rx="2" fill="${i === 0 ? 'var(--accent)' : 'var(--chart)'}"><title>${fmtD(td + i)}: ${v}</title></rect><text x="${x + bw * .35}" y="${h - 7}" text-anchor="middle">${i === 0 ? 'dnes' : DN[dd.getUTCDay()]}</text>`;
  });
  $('fc').innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Předpověď opakování">${g}</svg>`;
  const hb = $('heat'); hb.textContent = ''; const mxh = Math.max(20, ...Array.from({ length: 28 }, (_, i) => (log[dayIso(td - 27 + i)] || [0])[0]));
  for (let i = 0; i < 28; i++) { const L2 = log[dayIso(td - 27 + i)] || [0, 0, 0]; const x = el('i'); if (L2[0]) x.style.background = `color-mix(in srgb, var(--good) ${25 + 75 * Math.min(1, L2[0] / mxh)}%, var(--chip))`; x.title = `${fmtD(td - 27 + i)}: ${L2[0]}`; hb.appendChild(x); }
  $('heatMsg').textContent = days ? `${days} z 28 dní s opakováním.` : 'Zatím žádné opakování.';
  let rows = ''; for (const s of SUBJS) {
    let n = 0, un = 0, st = 0, kn = 0, du = 0;
    for (const c of CARDS) { if (c.s !== s) continue; n++; const r = srs[c.id]; if (r) { st++; if (r[1] >= 21) kn++; if (r[5] <= td) du++; un++; } else if (unlocked(c)) un++; }
    const t = nextTest(s, td);
    rows += `<tr><td><span class="dot" style="background:var(--c-${s})"></span>${SUBJN[s]}</td><td class="n">${n}</td><td class="n">${un}</td><td class="n">${st}</td><td class="n">${kn}</td><td class="n">${du}</td><td class="n">${t ? fmtD(t.day) : '–'}</td></tr>`;
  }
  $('subjTbl').innerHTML = `<thead><tr><th>Předmět</th><th class="n">Karet</th><th class="n">Odemčeno</th><th class="n">Rozjeto</th><th class="n">V paměti</th><th class="n">Dnes</th><th class="n">Test</th></tr></thead><tbody>${rows}</tbody>`;
  const wl = TOPICS.map(t => ({ ...t, ...topicStats(t.t) })).filter(t => t.reps >= 6).map(t => ({ ...t, rate: t.lap / t.reps })).sort((a, b) => b.rate - a.rate).slice(0, 6);
  const wb = $('weak'); wb.textContent = '';
  if (!wl.length) wb.appendChild(el('div', 'note', 'Ukáže se po prvních opakováních.'));
  for (const t of wl) {
    const r = el('div', 'li'), nm = el('span', 'nm'); const dot = el('span', 'dot'); dot.style.background = `var(--c-${t.s})`;
    nm.append(dot, el('b', null, t.t + ' '), t.tn, el('small', null, `${Math.round(t.rate * 100)} % Znovu · ${t.reps} hodnocení`));
    const b = el('button', 'ghost', 'Procvičit'); b.type = 'button'; b.onclick = () => startSession(c => c.t === t.t && c.d !== '9', true, t.t); r.append(nm, b); wb.appendChild(r);
  }
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
  // kartičky předmětu
  const p = pools(c => c.s === s), cs = CARDS.filter(c => c.s === s), kn = cs.filter(c => srs[c.id] && srs[c.id][1] >= 21).length;
  const kp = el('div', 'col'); const bar = el('div', 'bar big4'); const bi = el('i'); bi.style.width = (cs.length ? kn / cs.length * 100 : 0) + '%'; bar.appendChild(bi);
  const row = el('div', 'row'); const b1 = el('button', 'ghost', `Opakovat (${p.due.length + Math.min(newLeft(), p.fresh.length)})`); b1.type = 'button'; b1.disabled = !(p.due.length || p.fresh.length); b1.onclick = () => startSession(c => c.s === s, false, SUBJN[s]);
  const b2 = el('button', 'ghost', 'Témata'); b2.type = 'button'; b2.onclick = () => { subjF = s; ls.set('k_subj', s); KSEG = 'temata'; ls.set('k_seg', KSEG); go('karticky'); };
  row.append(b1, b2); kp.append(el('div', 'note', `${cs.length} kartiček · ${kn} pevně v paměti · ${p.due.length} k opakování`), bar, row);
  body.appendChild(panel('Kartičky', kp));
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
  $('sNew').value = set.newPerDay; $('sRet').value = String(set.ret); $('sAhead').checked = set.ahead; $('sDopl').checked = set.dopl; $('sTest').checked = set.test;
  const c = ls.get('k_sync', {}) || {};
  if (document.activeElement !== $('syUrl')) $('syUrl').value = c.url || '';
  if (document.activeElement !== $('syTok')) $('syTok').value = c.token || '';
  const kt = $('kTopic'); if (!kt.options.length) for (const t of TOPICS) { const o = el('option', null, `${t.t} ${t.tn}`); o.value = t.t; kt.appendChild(o); }
  $('genMsg').textContent = `${CARDS.length} kartiček (${DATA.gen}) a plán semestru (${SEM.gen}) ze složky 3_VŠCHT.`;
}

// ---------- opakování kartiček
let S = null;
function startSession(filter, cram, label) {
  const td = today(); let queue;
  if (cram) {
    queue = CARDS.filter(filter).sort((a, b) => { const ra = srs[a.id], rb = srs[b.id]; return (ra ? Rnow(ra, td) : 0) - (rb ? Rnow(rb, td) : 0); }).slice(0, 60);
  } else {
    const { due, fresh } = pools(filter); const nw = fresh.slice(0, newLeft());
    queue = []; let i = 0, j = 0;
    while (i < due.length || j < nw.length) { for (let k = 0; k < 4 && i < due.length; k++) queue.push(due[i++]); if (j < nw.length) queue.push(nw[j++]); }
  }
  if (!queue.length) { toast('V tomto výběru teď nic není.'); return; }
  S = { queue, cram, label, done: 0, cur: null, shown: false, hist: [], from: TAB };
  go('study'); $('dock').hidden = true; $('gradesBar').hidden = false;
  next();
}
function next() { if (!S.queue.length) { finish(); return; } S.cur = S.queue.shift(); S.shown = false; $('typeIn').value = ''; draw(); }
const claudeUrl = q => 'https://claude.ai/new?q=' + encodeURIComponent(q);
function aiLinks() {
  const c = S.cur, typed = $('typeIn').value.trim();
  $('typeBox').hidden = !ls.get('k_type', false) || !c;
  $('typeBtn').hidden = S.shown;
  $('typeBtn').textContent = $('typeBox').hidden ? 'Odpovědět vlastními slovy' : 'Bez psaní';
  $('explBtn').hidden = !S.shown;
  $('checkBtn').hidden = !S.shown || !typed;
  if (!S.shown) return;
  $('explBtn').href = claudeUrl(`Jsem student 1. ročníku VŠCHT (${SUBJN[c.s]}, téma ${c.t} ${c.tn}). Nejdéle mi trvá pochopit filozofii – proč to tak je a jak to zapadá do celku. Vysvětli mi česky a srozumitelně (max. 6 vět), proč platí tahle odpověď, z jakého principu plyne, a dej mi jednu pomůcku na zapamatování.\n\nOtázka: ${c.q}\nOdpověď: ${c.a}`);
  if (typed) $('checkBtn').href = claudeUrl(`Jsi zkoušející na VŠCHT (1. ročník, ${SUBJN[c.s]}, téma ${c.t} ${c.tn}). Porovnej moji odpověď se správnou. Hodnoť věcnou správnost, ne styl. Řekni verdikt (správně / částečně / špatně), co chybí nebo je špatně, a doporuč hodnocení 1–4 (1 Znovu, 2 Těžké, 3 Dobře, 4 Snadno).\n\nOtázka: ${c.q}\nSprávná odpověď: ${c.a}\nMoje odpověď: ${typed}`);
}
function draw() {
  const c = S.cur, r = srs[c.id];
  $('card').style.setProperty('--cs', `var(--c-${c.s})`);
  const m = $('cMeta'); m.textContent = '';
  if (TYPN[c.y]) m.appendChild(el('span', 'typ', TYPN[c.y]));
  m.appendChild(el('span', null, `${c.t} · ${c.tn}`));
  m.appendChild(el('span', 'chip', S.cram ? 'procvičování' : r ? 'opakování' : 'nová'));
  $('cQ').textContent = c.q; $('cA').textContent = c.a; $('cA').hidden = !S.shown; $('cHint').hidden = S.shown;
  $('prog').style.width = (S.done / Math.max(1, S.done + S.queue.length + 1) * 100) + '%';
  $('left').textContent = S.queue.length + 1; $('undo').disabled = !S.hist.length;
  $('aiRow').hidden = false; aiLinks();
  const g = $('grades'); g.textContent = '';
  if (!S.shown) { const b = el('button', 'show', 'Ukázat odpověď'); b.type = 'button'; b.onclick = reveal; g.appendChild(b); return; }
  const st = toSt(r);
  [['Znovu', 1], ['Těžké', 2], ['Dobře', 3], ['Snadno', 4]].forEach(([n, gr]) => {
    const b = el('button', 'g' + gr); b.type = 'button';
    let lab;
    if (S.cram) lab = gr <= 2 ? 'ještě jednou' : 'ok';
    else if (gr === 1 || (!st && gr === 2)) lab = 'za chvíli';
    else lab = fmtIvl(schedIvl(nextState(st, gr, today()), c, gr));
    b.append(el('span', null, n), el('small', null, lab)); b.onclick = () => grade(gr); g.appendChild(b);
  });
}
function reveal() { if (!S || S.shown || !S.cur) return; S.shown = true; draw(); }
function grade(g) {
  const c = S.cur, td = today();
  S.hist.push({ c, prev: srs[c.id] ? [...srs[c.id]] : null, log: JSON.stringify(log[dayIso(td)] || null), q: S.queue.slice(), done: S.done });
  if (S.cram) { if (g <= 2) S.queue.splice(Math.min(3, S.queue.length), 0, c); }
  else {
    const prev = srs[c.id], wasNew = !prev, ns = nextState(toSt(prev), g, td);
    const relearn = g === 1 || (wasNew && g === 2);
    const iv = relearn ? 0 : schedIvl(ns, c, g);
    srs[c.id] = [ns.last, +ns.S.toFixed(3), +ns.D.toFixed(3), ns.reps, ns.lapses, td + iv];
    const k = dayIso(td), L = log[k] || [0, 0, 0]; L[0]++; if (g === 1) L[1]++; if (wasNew) L[2]++; log[k] = L;
    if (relearn) S.queue.splice(Math.min(g === 1 ? 3 : 6, S.queue.length), 0, c);
    markDirty(c.id);
  }
  S.done++; next();
}
function undo() {
  if (!S || !S.hist.length) return; const h = S.hist.pop();
  if (!S.cram) { if (h.prev) srs[h.c.id] = h.prev; else delete srs[h.c.id]; const k = dayIso(today()), L = JSON.parse(h.log); if (L) log[k] = L; else delete log[k]; markDirty(h.c.id); }
  S.queue = h.q; S.done = h.done; S.cur = h.c; S.shown = true; draw();
}
function finish() {
  S.cur = null;
  $('grades').textContent = ''; $('cMeta').textContent = ''; $('cA').hidden = true; $('cHint').hidden = true; $('aiRow').hidden = true; $('typeBox').hidden = true;
  $('cQ').textContent = S.cram ? `Procvičeno: ${S.done} kartiček (${S.label}).` : `Hotovo – ${S.done} hodnocení. Další kartičky přijdou podle plánu.`;
  const b = el('button', 'show', 'Zpět'); b.type = 'button'; b.onclick = endSession; $('grades').appendChild(b);
  syncNow(false);
}
function endSession() { const from = S ? S.from : 'dnes'; S = null; $('dock').hidden = false; $('gradesBar').hidden = true; syncNow(false); go(TABS.includes(from) ? from : 'dnes'); }

// ---------- UČIT: jeden další krok · diagnostika · mapa znalostí · vrstvy V0–V4 (uceni.json + obsah/<ID>.json z build_uceni.py)
// diag[tid] = { st, lv, h:[[den, id, g]], nx, up, ts } · st: 'B' nebráno · 'X' nerozumím · 1 neumím · 2 zhruba · 3 skoro · 4 umím
let UC = null, UT = [], UBY = {}, diag = {}, UQ = null, UOPEN = null, OBS = {};
let UCTX = { min: 25, kde: 'doma', ts: 0, ...ls.get('k_uctx', {}) };
const STN = { 0: 'neověřeno', B: 'nebráno', X: 'nerozumím', 1: 'neumím', 2: 'zhruba', 3: 'skoro', 4: 'umím' };
const STC = { 0: 'u-0', B: 'u-b', X: 'u-x', 1: 'u-1', 2: 'u-2', 3: 'u-3', 4: 'u-4' };
const LVN = ['Základ – o čem to je', 'Jádro a první příklady', 'Proč to tak je + příklady', 'Testová úroveň', 'Výzva'];
const GAP = [1, 2, 4, 7, 14];
const KDE = { cesta: '🚆 Cesta', doma: '🏠 Doma', skola: '🏫 Pauza' };
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
const H = (cls, htmlStr) => { const d = el('div', cls); d.innerHTML = htmlStr; mathify(d); return d; };
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
// automatický kontext z rozvrhu (Dnes → režim), pokud si ho uživatel v posledních 90 min nezměnil
function autoCtx() {
  if (Date.now() - (UCTX.ts || 0) < 90 * 60e3 || !SEM || !SEM.rezim) return UCTX;
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes(), bl = SEM.rezim[((now.getDay() + 6) % 7) + 1] || [];
  const b = bl.find(x => mins(x.a) <= m && m < mins(x.b)) || bl.find(x => mins(x.a) > m && mins(x.a) - m <= 20);
  if (!b) return UCTX;
  const left = Math.max(5, mins(b.b) - Math.max(m, mins(b.a))), tx = (b.co + ' ' + (b.jak || '')).toLowerCase();
  const kde = /cesta|vlak|tramvaj/.test(tx) ? 'cesta' : /blok|doma|večer/.test(tx) ? 'doma' : 'skola';
  const opts = [10, 25, 50, 90]; const min = opts.reduce((a, o) => o <= left ? o : a, 10);
  return { ...UCTX, kde, min, auto: b.co };
}
// co konkrétně udělat s tématem (krok učení)
function stepFor(t, kde, min) {
  if (stOf(t) === 0) return { k: 'diag', m: 2, lab: 'Ověřit, co víš', why: 'nová látka' };
  if (reviewDue(t) && lvOf(t) >= target(t)) return { k: 'rev', m: 3, lab: 'Rychlé opakování', why: forgotten(t) ? 'dlouho jsi to neviděl' : 'opakování je na řadě' };
  const lv = lvOf(t), m = Math.min(min, kde === 'doma' ? STEPMIN[lv] + 5 : 10);
  return { k: 'learn', lv, m, lab: LVN[lv], why: stOf(t) === 'X' ? 'tady jsi nerozuměl – jdeme od základu' : '' };
}
function plan(ctx) {
  const cand = UT.filter(t => prio(t) > 0).sort((a, b) => prio(b) - prio(a) || lvOf(a) - lvOf(b));
  const out = []; let left = ctx.min;
  for (const t of cand) {
    if (left < 2 || out.length >= 3) break;
    const s = stepFor(t, ctx.kde, left); if (s.m > left + 3) continue;
    out.push({ t, s, ts: topicTest(t) }); left -= s.m;
  }
  return out;
}

// ----- obrazovka Učit
function renderUcit() {
  if (!UC) return;
  const box = $('uMain'); box.textContent = '';
  if (UQ) return drawUQ();
  const ctx = autoCtx(), p = plan(ctx);
  // 1) nejbližší test jednou větou
  const near = SUBJS.map(s => ({ s, b: budget(s) })).filter(x => x.b).sort((a, b) => a.b.dd - b.b.dd)[0];
  if (near) box.appendChild(el('div', 'uhead', `${SUBJN[near.s]} · ${near.b.nt.n} ${inDays(near.b.dd)} — ${near.b.tight ? 'času je málo, jedeme do šířky' : near.b.ph.n}`));
  // 2) kontext (kde, kolik času) – jedna řádka, rozbalí se na výběr
  const cx = el('details', 'uctx'); const sm = el('summary'); sm.textContent = `${KDE[ctx.kde]} · ${ctx.min} min${ctx.auto ? ' · podle rozvrhu' : ''} ▾`; cx.appendChild(sm);
  const pick = (opts, cur, on) => { const r = el('div', 'row'); for (const [v, lab] of opts) { const b = el('button', 'chip', lab); b.type = 'button'; b.setAttribute('aria-pressed', String(v === cur)); b.onclick = () => on(v); r.appendChild(b); } return r; };
  const setCtx = o => { UCTX = { ...UCTX, ...o, ts: Date.now() }; delete UCTX.auto; ls.set('k_uctx', UCTX); renderUcit(); };
  cx.append(pick([[10, '10 min'], [25, '25 min'], [50, '50 min'], [90, '1,5 h']], ctx.min, v => setCtx({ min: v, kde: ctx.kde })),
    pick(Object.entries(KDE), ctx.kde, v => setCtx({ kde: v, min: ctx.min })));
  box.appendChild(cx);
  // 3) jeden hlavní krok
  if (!p.length) { box.appendChild(panel(null, el('p', null, 'Teď nic nehoří. Odpočívej, nebo si v Mapě vyber téma, které tě zajímá.'))); }
  else {
    const it = p[0], c = el('div', 'unow');
    const top = el('div', 'row'); top.append(tag(it.t.s), el('span', 'note', `${it.s.m} min${it.ts ? ` · ${it.ts.n} ${inDays(it.ts.day - today())}` : ''}`));
    c.append(top, el('h2', null, it.t.n), el('div', 'ustep', it.s.lab));
    if (it.s.why) c.appendChild(el('div', 'note', it.s.why));
    c.appendChild(ladder(it.t));
    const b = el('button', 'primary', 'Začít'); b.type = 'button'; b.onclick = () => go2(it, ctx); c.appendChild(b);
    box.appendChild(c);
    if (p.length > 1) {
      const pl = el('div', 'list unext'); pl.appendChild(el('div', 'note', 'Potom'));
      for (const x of p.slice(1)) { const r = el('button', 'urow'); r.type = 'button'; r.append(el('i', 'dot ' + STC[stOf(x.t)]), el('span', 't', `${x.t.n} – ${x.s.lab.toLowerCase()}`), el('span', 'note', x.s.m + ' min')); r.onclick = () => go2(x, ctx); pl.appendChild(r); }
      box.appendChild(pl);
    }
  }
  // 4) nová látka k ověření (jen když nějaká je)
  const nd = UT.filter(t => taught(t) && stOf(t) === 0);
  if (nd.length) { const b = el('button', 'ghost uwide', `Nová látka k ověření: ${nd.length} ${nd.length === 1 ? 'téma' : nd.length < 5 ? 'témata' : 'témat'} · ~${nd.length * 2} min`); b.type = 'button'; b.onclick = () => startDiag(nd.length); box.appendChild(b); }
}
function go2(it, ctx) { if (it.s.k === 'diag') startDiag(1, [it.t]); else if (it.s.k === 'rev') startLearn(it.t, ctx, true); else startLearn(it.t, ctx); }
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
async function startLearn(t, ctx, review) {
  const o = await loadObs(t.id), lv = lvOf(t), doma = ctx.kde === 'doma', short = ctx.min <= 10;
  const recent = new Set(((diag[t.id] || {}).h || []).filter(x => x[2] === 3 && x[0] >= today() - 1).map(x => x[1]));
  let qs = t.qs.filter(q => !recent.has(q.id)); if (lv >= 2) qs = qs.slice().reverse();
  const P = n => (o.lv[String(n)] || []);
  const steps = [];
  const C = (title, k) => o[k] && steps.push({ k: 'c', title, html: o[k] });
  const Q = n => qs.slice(0, n).forEach(q => steps.push({ k: 'q', q }));
  const X = (n, cnt) => P(n).slice(0, cnt).forEach(p => steps.push({ k: 'p', p, lv: n }));
  if (review) Q(2);
  else if (lv === 0) { C('Co budeš umět', 'cil'); if (!short && o.pre) steps.push({ k: 'c', title: 'Nejdřív zkus odpovědět (nevadí, když nevíš)', html: o.pre, pre: true }); C('O čem to je', 'v0'); Q(2); }
  else if (lv === 1) { C('Jádro', 'jadro'); if (doma && !short) { C('Řešené příklady – takhle to vypadá v testu', 'rp'); X(1, 2); } Q(short ? 2 : 3); }
  else if (lv === 2) { if (!short) C('Proč to tak je', 'proc'); if (doma) X(2, short ? 1 : 3); else if (!short) C('Řešené příklady – takhle to vypadá v testu', 'rp'); Q(short ? 2 : 3); }
  else if (lv === 3) { if (doma && P(3).length) X(3, short ? 1 : 3); else C('Časté chyby', 'chyby'); Q(short ? 2 : 4); }
  else { if (doma && P(4).length) X(4, short ? 1 : 2); else C('Souvislosti', 'souv'); Q(short ? 2 : 4); }
  if (!steps.length) Q(3);
  UQ = { mode: 'learn', t, lv, review, steps, i: 0, gs: [], shown: false, pcp: t.s === 'PCP' && doma && lv >= 1 };
  if (TAB !== 'ucit') go('ucit'); else renderUcit(); window.scrollTo({ top: 0 });
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
  box.appendChild(topBar(t.n, UQ.i / UQ.steps.length));
  if (UQ.pcp && UQ.i === 0) box.appendChild(el('div', 'uhint', 'MATLAB piš sám, bez Copilota. Copilota použij až na kontrolu hotového kódu.'));
  const next = () => { UQ.i++; UQ.shown = false; if (UQ.i >= UQ.steps.length) return learnDone(); drawUQ(); window.scrollTo({ top: 0 }); };
  if (s.k === 'c') {
    const c = el('div', 'card ucard ucontent'); c.append(el('div', 'meta', s.title), H('ucont', s.html)); box.appendChild(c);
    box.appendChild(btns([[s.pre ? 'Hotovo, teď výklad' : 'Rozumím, dál', 'primary', next]])); return;
  }
  if (s.k === 'p') {
    const c = el('div', 'card ucard'); c.append(el('div', 'meta', `Příklad ${s.p.n} · spočítej na papír`), H('q', s.p.z));
    if (UQ.shown) { c.append(el('div', 'meta', 'Výsledek'), H('a', s.p.r || '—')); if (UQ.shown === 'sol' && s.p.s) c.append(el('div', 'meta', 'Řešení krok za krokem'), H('ucont', s.p.s)); }
    box.appendChild(c);
    const id = `p:${t.id}:${s.p.n}`;
    box.appendChild(!UQ.shown ? btns([['Ukázat výsledek', 'primary', () => { UQ.shown = true; drawUQ(); }], ['Nevím, jak začít', 'ghost', () => { UQ.shown = 'sol'; rec(t, id, 1); UQ.gs.push(1); drawUQ(); }]])
      : UQ.shown === 'sol' ? btns([['Projel jsem řešení, dál', 'primary', next]])
        : btns([['Vyšlo', 'g3', () => { rec(t, id, 3); UQ.gs.push(3); next(); }], ['Nevyšlo – ukaž řešení', 'g1', () => { rec(t, id, 1); UQ.gs.push(1); UQ.shown = 'sol'; drawUQ(); }]]));
    return;
  }
  const q = s.q, c = el('div', 'card ucard'); c.append(el('div', 'meta', q.c ? `${q.c} · odpověz sám, pak otoč` : 'Odpověz sám, pak otoč'), H('q', q.q)); if (UQ.shown) c.appendChild(H('a', q.a)); box.appendChild(c);
  const g = gr => { rec(t, q.id, gr); UQ.gs.push(gr); next(); };
  box.appendChild(!UQ.shown ? btns([['Ukázat odpověď', 'primary', () => { UQ.shown = true; drawUQ(); }], ['Nerozumím', 'ghost', () => g(0)]])
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
function learnDone() {
  const t = UQ.t, r = { ...(diag[t.id] || { h: [] }) }, gs = UQ.gs, ok = gs.filter(g => g === 3).length, bad = gs.filter(g => g <= 1).length;
  let lv = r.lv || 0, msg;
  const pass = gs.length ? ok >= Math.ceil(gs.length * 2 / 3) : true;
  if (UQ.review) { if (bad > ok) { lv = Math.max(0, lv - 1); msg = 'Trochu se to vytratilo – vrátíme se o krok.'; } else msg = 'Pořád to drží.'; }
  else if (pass && r.up !== today()) { lv = Math.min(4, lv + 1); r.up = today(); msg = lv === 4 ? 'Výborně, téma umíš.' : `Posun: ${LVN[lv].toLowerCase()}.`; }
  else if (pass) msg = 'Správně. Další krok až zítra – přes noc se to usadí.';
  else if (bad > ok) { lv = Math.max(0, lv - 1); msg = 'Zatím to nesedí – příště jednodušeji a s víc vysvětlením.'; }
  else msg = 'Napůl. Zopakujeme brzy.';
  const st = lv >= 4 ? 4 : lv === 3 ? 4 : lv === 2 ? 3 : lv === 1 ? 2 : (r.st === 'X' && !ok ? 'X' : 1);
  saveDiag(t.id, { ...r, lv, st, nx: nextRev(t, lv) });
  UQ = null; toast(msg); renderUcit(); syncNow(false);
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
document.querySelectorAll('#kSeg button').forEach(b => b.onclick = () => { KSEG = b.dataset.k; ls.set('k_seg', KSEG); renderKarticky(); });
$('startAll').onclick = () => startSession(null, false, 'Vše na dnes');
$('back').onclick = endSession; $('undo').onclick = undo; $('card').onclick = reveal;
$('syncChip').onclick = () => syncCfg() ? syncNow(true) : go('vic');
$('schedBox').addEventListener('toggle', () => { if ($('schedBox').open) renderSched(); });
$('wkPrev').onclick = () => { if (wkSel > 1) { wkSel--; renderTyden(); } };
$('wkNext').onclick = () => { if (wkSel < Math.max(...SEM.tydny.map(w => w.n))) { wkSel++; renderTyden(); } };
$('typeBtn').onclick = () => { const on = $('typeBox').hidden; ls.set('k_type', on); aiLinks(); if (on) $('typeIn').focus(); };
$('typeIn').oninput = () => { if (S && S.shown) aiLinks(); };
document.addEventListener('keydown', e => {
  if (!S || !S.cur || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!S.shown) reveal(); else grade(3); }
  else if (S.shown && '1234'.includes(e.key)) grade(+e.key);
  else if (e.key === 'z' || e.key === 'Z') undo();
  else if (e.key === 'Escape') endSession();
});
const saveSet = () => { set.ts = Date.now(); dirty.add('meta'); persist(); schedulePush(); refresh(); toast('Uloženo'); };
$('sNew').onchange = e => { set.newPerDay = Math.max(0, Math.min(200, +e.target.value || 0)); saveSet(); };
$('sRet').onchange = e => { set.ret = +e.target.value; saveSet(); };
$('sAhead').onchange = e => { set.ahead = e.target.checked; saveSet(); };
$('sDopl').onchange = e => { set.dopl = e.target.checked; saveSet(); };
$('sTest').onchange = e => { set.test = e.target.checked; saveSet(); };
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
$('kBtn').onclick = () => {
  const t = $('kTopic').value, td = today(); let n = 0;
  for (const c of CARDS) { if (c.t !== t || c.d === '9' || srs[c.id]) continue; const h = parseInt(c.id.slice(0, 4), 16); srs[c.id] = [td, 7, 5, 1, 0, td + 1 + (h % 7)]; n++; markDirty(c.id); }
  $('kMsg').textContent = n ? `${t}: ${n} kartiček rozloženo do opakování na příštích 7 dní.` : `${t}: nic k přesunutí, všechny už jsou v plánu.`; refresh();
};
$('exBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ v: 2, srs, log, set, done })], { type: 'application/json' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `studium-zaloha-${dayIso(today())}.json`; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); $('exMsg').textContent = 'Záloha stažena.';
};
$('imFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (!d.srs) throw new Error('bad'); let n = 0;
    for (const [k, v] of Object.entries(d.srs)) { if (!BYID[k]) continue; const m = mergeRec(srs[k], v); if (m !== srs[k]) { srs[k] = m; n++; dirty.add('srs_' + shardOf(k)); } }
    for (const [k, v] of Object.entries(d.log || {})) if (!log[k] || v[0] > log[k][0]) log[k] = v;
    for (const [k, v] of Object.entries(d.done || {})) if (!done[k] || v[1] > done[k][1]) done[k] = v;
    dirty.add('meta'); dirty.add('done'); persist(); schedulePush(); refresh(); $('exMsg').textContent = `Obnoveno: ${n} kartiček.`;
  } catch { $('exMsg').textContent = 'Soubor není záloha.'; }
  e.target.value = '';
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (dirty.size) syncNow(false); }
  else { if (Date.now() - lastPull > 60e3) syncNow(false); if (!S) refresh(); }
});
window.addEventListener('online', () => syncNow(false));
window.addEventListener('offline', syncState);
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (!S && TABS.includes(t) && t !== TAB) go(t); });
setInterval(() => { if (TAB === 'dnes' && !S) renderNow(); }, 60e3);

// ---------- start
srs = ls.get('k_srs', {}); diag = ls.get('k_diag', {}); log = ls.get('k_log', {}); set = { ...set, ...ls.get('k_set', {}) }; done = ls.get('k_done', null);
if (!done) { done = {}; for (const id of SEED_DONE) done[id] = [true, 1]; persist(); }
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('./sw.js');
Promise.all([fetch('cards.json').then(r => r.json()), fetch('semestr.json').then(r => r.json()), fetch('uceni.json').then(r => r.json()).catch(() => null)]).then(([d, sm, uc]) => {
  if (uc) { UC = uc; UT = uc.topics; UBY = Object.fromEntries(UT.map(t => [t.id, t])); }
  DATA = d; SEM = sm; CARDS = d.cards; BYID = Object.fromEntries(CARDS.map(c => [c.id, c])); W1 = isoToDay(d.w1);
  const tm = new Map();
  for (const c of CARDS) { if (!tm.has(c.t)) tm.set(c.t, { t: c.t, tn: c.tn, s: c.s, w: c.w }); else tm.get(c.t).w = Math.min(tm.get(c.t).w, c.w); }
  TOPICS = [...tm.values()].sort((a, b) => a.s.localeCompare(b.s) || a.w - b.w || a.t.localeCompare(b.t));
  const t = location.hash.slice(1); go(TABS.includes(t) ? t : 'ucit');
  syncNow(false);
}).catch(() => { document.querySelector('main').prepend(el('div', 'panel note', 'Data se nepodařilo načíst. Napoprvé je potřeba internet, pak už appka jde offline.')); syncLabel('offline'); });

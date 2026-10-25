// Kartičky VŠCHT – opakování ze studijních listů (FSRS), offline PWA, sync s Google Sheetem přes Apps Script.
// Data: localStorage (stav karet, log, nastavení) + fronta změn; cards.json generuje build_study.py ze studijních listů.

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
const fmtIvl = n => n < 1 ? 'dnes' : n === 1 ? '1 d' : n < 30 ? n + ' d' : n < 365 ? (n / 30).toFixed(n < 60 ? 1 : 0) + ' měs' : '1 rok';

const SUBJN = { MAT: 'Matematika', OAC: 'OAC přednášky', OACC: 'OAC cvičení', CBV: 'CBV', CHT: 'CHT', TOX: 'TOX', PCP: 'PCP' };
const DECKN = { 1: 'Teorie (CHT, TOX, OAC)', 2: 'MATLAB a zkratky', 3: 'CBV vzorce a postupy', 4: 'Ostatní (MAT, OACC, PCP)', 9: 'Doplňky (před zkouškou)' };
const TYPN = { J: '', F: 'Filozofie', V: 'Vzorec', P: 'Postup', K: 'Příkaz', D: 'Doplněk' };
const SUBJS = Object.keys(SUBJN);
const EXAM = { MAT: '2027-01-11', OAC: '2027-01-11', OACC: '2027-01-11', CHT: '2027-01-13', TOX: '2027-01-13', CBV: '2026-12-15', PCP: '2026-12-10' };

let DATA = null, CARDS = [], BYID = {}, W1 = 0, TOPICS = [];
let srs = {}, log = {};
let set = { newPerDay: 20, ret: 0.9, ahead: false, dopl: false, test: true, ts: 0 };
const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* plné úložiště */ } },
};
function toast(t) { const x = el('div', 'toast', t); document.body.appendChild(x); setTimeout(() => x.remove(), 2200); }

// ---------- úložiště + fronta změn (klíče: srs_<PŘEDMĚT>, meta)
const shardOf = id => (BYID[id] || {}).s || 'X';
let dirty = new Set(ls.get('k_dirty', []));
function persist() { ls.set('k_srs', srs); ls.set('k_log', log); ls.set('k_set', set); ls.set('k_dirty', [...dirty]); }
function markDirty(id) { dirty.add('srs_' + shardOf(id)); dirty.add('meta'); persist(); schedulePush(); }
function mergeRec(a, b) { if (!a) return b; if (!b) return a; return (b[3] > a[3] || (b[3] === a[3] && b[0] > a[0])) ? b : a; }

// ---------- sync s Google Sheetem (Apps Script web app)
const syncCfg = () => { const c = ls.get('k_sync', null); return c && c.url && c.token ? c : null; };
let syncing = false, pushT = null, lastPull = 0;
function syncLabel(t) { $('syncChip').textContent = t; }
function syncState() {
  const c = syncCfg();
  $('syncHint').hidden = !!c || ls.get('k_hint_off', false);
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

// ---------- výpočty
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

// ---------- sekce
const TABS = ['dnes', 'opak', 'temata', 'prehled', 'vic'];
let TAB = 'dnes';
function go(tab) {
  TAB = tab;
  document.querySelectorAll('section[data-tab]').forEach(s => s.hidden = s.dataset.tab !== tab);
  document.querySelectorAll('nav.dock button').forEach(b => b.toggleAttribute('aria-current', false));
  const b = document.querySelector(`nav.dock [data-go="${tab}"]`); if (b) b.setAttribute('aria-current', 'page');
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  refresh(); window.scrollTo({ top: 0 });
}
function refresh() {
  if (!DATA) return;
  renderHeader();
  if (TAB === 'dnes') renderDnes();
  if (TAB === 'opak' && !S) renderPick();
  if (TAB === 'temata') renderTopics();
  if (TAB === 'prehled') renderPrehled();
  if (TAB === 'vic') renderVic();
}
function renderHeader() {
  const wk = weekNow(); $('wkChip').textContent = wk >= 1 && wk <= 14 ? `${wk}. týden` : wk > 14 ? 'zkouškové' : 'před semestrem';
  const { due, fresh } = pools(); const n = due.length + Math.min(newLeft(), fresh.length);
  $('badge').hidden = !n; $('badge').textContent = n;
  syncState();
}
function renderDnes() {
  const td = today(); const { due, fresh } = pools(); const nNew = Math.min(newLeft(), fresh.length);
  const d = new Date(td * DAY); $('dTitle').textContent = `Dnes · ${DN[d.getUTCDay()]} ${fmtD(td)}`;
  $('hDue').textContent = due.length; $('hNew').textContent = nNew; $('hDone').textContent = (log[dayIso(td)] || [0])[0];
  $('dEta').textContent = due.length + nNew ? `asi ${Math.max(1, Math.round((due.length * 8 + nNew * 20) / 60))} min` : '';
  const backlog = fresh.length - nNew;
  $('hNote').textContent = due.length + nNew === 0 ? (backlog ? 'Na dnes hotovo. Další nové přibudou zítra.' : 'Na dnes hotovo.')
    : backlog > 0 ? `Odemčených nových čeká ještě ${backlog}. Když máš čas, zvyš počet nových za den ve Víc.` : 'Všechno odemčené máš rozjeté.';
  $('startAll').disabled = due.length + nNew === 0; $('startAll').textContent = due.length + nNew ? `Začít (${due.length + nNew})` : 'Hotovo';
  const tb = $('tests'); tb.textContent = '';
  const up = DATA.tests.map(t => ({ ...t, day: isoToDay(t.d) })).filter(t => t.day >= td).slice(0, 5);
  if (!up.length) tb.appendChild(el('div', 'note', 'Žádný test v kalendáři.'));
  for (const t of up) {
    const r = el('div', 'li'), nm = el('span', 'nm'), dd = t.day - td;
    const dot = el('span', 'dot'); dot.style.background = `var(--c-${t.s})`; nm.append(dot, `${SUBJN[t.s]} – ${t.n}`);
    nm.appendChild(el('small', null, fmtD(t.day) + (dd === 0 ? ' · dnes' : dd === 1 ? ' · zítra' : ` · za ${dd} dní`)));
    const b = el('button', 'ghost', 'Procvičit'); b.type = 'button';
    b.onclick = () => startSession(c => c.s === t.s && c.d !== '9' && (srs[c.id] || unlocked(c)), true, `${SUBJN[t.s]} – před testem`);
    r.append(nm, b); tb.appendChild(r);
  }
  const box = $('decks'); box.textContent = '';
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
function renderPrehled() {
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
function renderVic() {
  $('sNew').value = set.newPerDay; $('sRet').value = String(set.ret); $('sAhead').checked = set.ahead; $('sDopl').checked = set.dopl; $('sTest').checked = set.test;
  const c = ls.get('k_sync', {}) || {};
  if (document.activeElement !== $('syUrl')) $('syUrl').value = c.url || '';
  if (document.activeElement !== $('syTok')) $('syTok').value = c.token || '';
  const kt = $('kTopic'); if (!kt.options.length) for (const t of TOPICS) { const o = el('option', null, `${t.t} ${t.tn}`); o.value = t.t; kt.appendChild(o); }
  $('genMsg').textContent = `${CARDS.length} kartiček ze studijních listů, vygenerováno ${DATA.gen}.`;
}

// ---------- opakování
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
  S = { queue, cram, label, done: 0, cur: null, shown: false, hist: [] };
  go('opak'); $('studyIdle').hidden = true; $('studyBox').hidden = false; $('dock').hidden = true; $('gradesBar').hidden = false;
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
function endSession() { S = null; $('studyBox').hidden = true; $('studyIdle').hidden = false; $('dock').hidden = false; $('gradesBar').hidden = true; syncNow(false); go('dnes'); }

// ---------- ovládání
document.querySelectorAll('nav.dock button').forEach(b => b.onclick = () => go(b.dataset.go));
$('startAll').onclick = () => startSession(null, false, 'Vše na dnes');
$('back').onclick = endSession; $('undo').onclick = undo; $('card').onclick = reveal;
$('syncChip').onclick = () => syncCfg() ? syncNow(true) : go('vic');
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
    for (const s of SUBJS) dirty.add('srs_' + s); dirty.add('meta'); persist();
    await syncNow(false);
    $('syMsg').textContent = `Spojení OK – tabulka „${d.name}“. Pokrok se synchronizuje.`;
  } catch (e) { $('syMsg').textContent = 'Spojení selhalo: ' + e.message + '. Zkontroluj URL (končí /exec), token a že nasazení má přístup „Kdokoli“.'; }
};
$('syNow').onclick = () => syncNow(true);
$('kBtn').onclick = () => {
  const t = $('kTopic').value, td = today(); let n = 0;
  for (const c of CARDS) { if (c.t !== t || c.d === '9' || srs[c.id]) continue; const h = parseInt(c.id.slice(0, 4), 16); srs[c.id] = [td, 7, 5, 1, 0, td + 1 + (h % 7)]; n++; markDirty(c.id); }
  $('kMsg').textContent = n ? `${t}: ${n} kartiček rozloženo do opakování na příštích 7 dní.` : `${t}: nic k přesunutí, všechny už jsou v plánu.`; refresh();
};
$('exBtn').onclick = () => {
  const blob = new Blob([JSON.stringify({ v: 1, srs, log, set })], { type: 'application/json' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `karticky-zaloha-${dayIso(today())}.json`; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); $('exMsg').textContent = 'Záloha stažena.';
};
$('imFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (!d.srs) throw new Error('bad'); let n = 0;
    for (const [k, v] of Object.entries(d.srs)) { if (!BYID[k]) continue; const m = mergeRec(srs[k], v); if (m !== srs[k]) { srs[k] = m; n++; dirty.add('srs_' + shardOf(k)); } }
    for (const [k, v] of Object.entries(d.log || {})) if (!log[k] || v[0] > log[k][0]) log[k] = v;
    dirty.add('meta'); persist(); schedulePush(); refresh(); $('exMsg').textContent = `Obnoveno: ${n} kartiček.`;
  } catch { $('exMsg').textContent = 'Soubor není záloha kartiček.'; }
  e.target.value = '';
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (dirty.size) syncNow(false); }
  else { if (Date.now() - lastPull > 60e3) syncNow(false); if (!S) refresh(); }
});
window.addEventListener('online', () => syncNow(false));
window.addEventListener('offline', syncState);
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (!S && TABS.includes(t) && t !== TAB) go(t); });

// ---------- start
srs = ls.get('k_srs', {}); log = ls.get('k_log', {}); set = { ...set, ...ls.get('k_set', {}) };
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('./sw.js');
fetch('cards.json').then(r => r.json()).then(d => {
  DATA = d; CARDS = d.cards; BYID = Object.fromEntries(CARDS.map(c => [c.id, c])); W1 = isoToDay(d.w1);
  const tm = new Map();
  for (const c of CARDS) { if (!tm.has(c.t)) tm.set(c.t, { t: c.t, tn: c.tn, s: c.s, w: c.w }); else tm.get(c.t).w = Math.min(tm.get(c.t).w, c.w); }
  TOPICS = [...tm.values()].sort((a, b) => a.s.localeCompare(b.s) || a.w - b.w || a.t.localeCompare(b.t));
  const t = location.hash.slice(1); go(TABS.includes(t) ? t : 'dnes');
  syncNow(false);
}).catch(() => { $('hNote').textContent = 'Kartičky se nepodařilo načíst. Napoprvé je potřeba internet, pak už jdou offline.'; syncLabel('offline'); });

// Notities: alles staat ook op het apparaat zelf (localStorage), zodat je offline kunt schrijven.
// Wijzigingen gaan op de achtergrond naar de server (/api/sync) en komen zo op je andere apparaten.

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const native = window.NotitiesNative || null;
const glassUi = !!(native?.glassUi && native.glassUi());
const TRASH_DAYS = 30;
const DAY = 86400000;
const COLORS = [
  ['', 'Geen kleur'], ['rood', 'Rood'], ['oranje', 'Oranje'], ['geel', 'Geel'],
  ['groen', 'Groen'], ['blauw', 'Blauw'], ['paars', 'Paars'], ['grijs', 'Grijs']
];
const VIEWS = {
  notities: 'Notities',
  lijsten: 'Lijsten',
  herinneringen: 'Herinneringen',
  gedeeld: 'Gedeeld',
  archief: 'Archief',
  prullenbak: 'Prullenbak'
};
const SOURCE = 'https://github.com/timmmmmmmmn/notities';

const state = {
  me: null,
  notes: new Map(),
  cursor: 0,
  openId: null,
  view: 'notities',
  label: null,
  query: '',
  layout: pref('layout', 'kaarten'),
  sort: pref('sort', 'bewerkt'),
  reading: new Set(),
  online: navigator.onLine,
  syncing: false,
  again: false,
  syncError: false
};

if (glassUi) document.documentElement.classList.add('glass');

// ---------- Iconen: één set lijnpaden (24×24) voor de website én het glazen menu in de app ----------

const ICONS = {
  note: 'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5M8.5 13h7M8.5 17h5',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20',
  pin: 'M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 15v5',
  tag: 'M3.5 12.5V5A1.5 1.5 0 0 1 5 3.5h7.5l8 8-9 9zM8 8h.01',
  palette: 'M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-1 1.6-2.1-.5-1.3.4-2.4 1.8-2.4H17a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.5-9zM7.5 11h.01M10 7.5h.01M14.5 7.5h.01',
  archive: 'M3.5 4.5h17v4h-17zM5 8.5v10A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-10M10 12.5h4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  copy: 'M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  share: 'M12 4v11M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5',
  history: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5z',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  check: 'M4.5 12.8 9.8 18.5 19.5 5.5',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  rows: 'M4 5h16M4 12h16M4 19h16',
  sort: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  download: 'M12 4v11M8 11l4 4 4-4M5 19h14',
  calendar: 'M5 5h14a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6.5A1.5 1.5 0 0 1 5 5zM3.5 10h17M8 3v4M16 3v4',
  person: 'M12 4.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7zM5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6 6 18',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M10 5h8M6 19h8M14 5l-4 14',
  heading: 'M6 5v14M18 5v14M6 12h12',
  bullet: 'M10 6h10M10 12h10M10 18h10M5 6h.01M5 12h.01M5 18h.01',
  checkbox: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 12l3 3 5-6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  quote: 'M5 7h5v5H6.5L5 17M14 7h5v5h-3.5L14 17',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  pdf: 'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14 3v5h5M9 13h1.5a1.5 1.5 0 0 1 0 3H9v-3zM9 16v2M14 13v5M14 13h2M14 15.5h1.5',
  sync: 'M20 11a8 8 0 0 0-14.3-4.3L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4.3L20 15M20 20v-5h-5'
};

function icon(name, cls = '') {
  return `<svg class="i${name === 'more' ? ' dots' : ''}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ''}"/></svg>`;
}

function fillIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => {
    if (el.tagName === 'SPAN') el.outerHTML = icon(el.dataset.icon);
    else el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  });
}

// ---------- Hulpjes ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function newId() {
  const b = crypto.getRandomValues(new Uint8Array(15));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
}

function store(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* vol of geblokkeerd: dan alleen in het geheugen */ }
}

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}

function pref(key, fallback) {
  return load(`notities:${key}`) ?? fallback;
}

async function api(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin'
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error(data?.error || `Fout ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MAANDEN_LANG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

function startOfDay(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function hhmm(d) {
  return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function when(t, long = false) {
  const d = new Date(t);
  const today = startOfDay();
  if (t >= today) return long ? `vandaag ${hhmm(d)}` : hhmm(d);
  if (t >= today - DAY) return long ? `gisteren ${hhmm(d)}` : 'gisteren';
  const date = `${d.getDate()} ${MAANDEN[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
  return long ? `${date} ${hhmm(d)}` : date;
}

// Voor herinneringen: ook vooruit kijken ("morgen 09:00", "vr 14 nov 18:00").
function whenAhead(t) {
  const d = new Date(t);
  const day = startOfDay(t);
  const today = startOfDay();
  const time = hhmm(d);
  if (day === today) return `vandaag ${time}`;
  if (day === today + DAY) return `morgen ${time}`;
  if (day === today - DAY) return `gisteren ${time}`;
  if (day > today && day < today + 6 * DAY) return `${DAGEN[d.getDay()]} ${time}`;
  return `${DAGEN[d.getDay()].slice(0, 2)} ${d.getDate()} ${MAANDEN[d.getMonth()]} ${time}`;
}

function haptic(kind = 'tick') {
  try { native?.haptic?.(kind); } catch (e) {}
}

let toastTimer;
function toast(text, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { el.hidden = true; action.run(); };
    el.appendChild(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2800);
}

const isPhone = () => matchMedia('(max-width: 759px)').matches;

// ---------- Lijsten: elke regel is "[ ] tekst" of "[x] tekst" ----------

function parseItems(body) {
  if (!body) return [];
  return body.split('\n').map((line) => {
    const m = line.match(/^\[( |x)\] ?(.*)$/);
    return m ? { done: m[1] === 'x', text: m[2] } : { done: false, text: line };
  });
}

function joinItems(items) {
  return items.map((i) => `[${i.done ? 'x' : ' '}] ${i.text.replace(/\n/g, ' ')}`).join('\n');
}

// ---------- Markdown voor de leesweergave (bewust klein en veilig: eerst alles escapen) ----------

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

function markdown(text) {
  const lines = text.split('\n');
  let html = '';
  let list = null; // 'ul' of 'ol'
  let para = [];
  const flushPara = () => {
    if (para.length) html += `<p>${para.map(inline).join('<br>')}</p>`;
    para = [];
  };
  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara(); closeList();
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      html += `<pre><code>${esc(code.join('\n'))}</code></pre>`;
      continue;
    }
    let m;
    if ((m = line.match(/^\s*(?:[-*]\s+)?\[( |x|X)\]\s?(.*)$/))) {
      flushPara(); closeList();
      if (!m[2].trim()) continue;
      const done = m[1] !== ' ';
      html += `<label class="task${done ? ' done' : ''}"><input type="checkbox" data-line="${i}"${done ? ' checked' : ''}><span>${inline(m[2])}</span></label>`;
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara(); closeList();
      html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara(); closeList();
      html += `<blockquote>${inline(m[1])}</blockquote>`;
    } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      flushPara(); closeList();
      html += '<hr>';
    } else if (!line.trim()) {
      flushPara(); closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara(); closeList();
  return html || '<p class="empty-md">Nog niets om te lezen.</p>';
}

// Platte tekst voor kaartjes: zonder Markdown-tekens.
function plain(s) {
  return s.replace(/^\s*(?:[-*]\s+)?\[[ xX]\]\s*$/gm, '')
    .replace(/^\s*(?:[-*]\s+)?\[ \]\s?/gm, '☐ ').replace(/^\s*(?:[-*]\s+)?\[[xX]\]\s?/gm, '☑ ')
    .replace(/^\s*[-*]\s+/gm, '• ').replace(/^#{1,3}\s+/gm, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|\s)[*_]([^*_\n]+)[*_]/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^>\s?/gm, '').replace(/`/g, '');
}

// ---------- Opslag op het apparaat ----------

const storeKey = () => `notities:${state.me.id}`;
let saveTimer;

function saveLocal(now = false) {
  clearTimeout(saveTimer);
  const write = () => store(storeKey(), { cursor: state.cursor, notes: [...state.notes.values()] });
  if (now) write();
  else saveTimer = setTimeout(write, 250);
}

function loadLocal() {
  const data = load(storeKey());
  state.notes = new Map((data?.notes || []).map((n) => [n.id, normalize(n)]));
  state.cursor = data?.cursor || 0;
}

function normalize(n) {
  return { labels: [], color: '', archived_at: null, remind_at: null, owner_name: null, can_write: true, shared_count: 0, ...n };
}

// Gedeeld door iemand anders, en of ik er dan in mag schrijven.
const fromOther = (n) => !!n.owner_name;
const readOnly = (n) => !!n.deleted_at || (fromOther(n) && !n.can_write);

// Elke wijziging: als "nog niet verstuurd" markeren en straks synchroniseren.
function touch(note, fields, { keepTime = false } = {}) {
  Object.assign(note, fields, { dirty: (note.dirty || 0) + 1 });
  if (!keepTime) note.updated_at = Date.now();
  state.notes.set(note.id, note);
  saveLocal();
  scheduleSync(1200);
  if (['remind_at', 'deleted_at', 'archived_at', 'title', 'purged'].some((k) => k in fields)) scheduleReminders();
}

// ---------- Synchronisatie ----------

let syncTimer;
function scheduleSync(ms = 0) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, ms);
}

function syncText() {
  const waiting = [...state.notes.values()].filter((n) => n.dirty).length;
  if (!state.online) return waiting ? `Offline · ${waiting} nog niet online opgeslagen` : 'Offline · alles staat op dit apparaat';
  if (state.syncError) return 'Synchroniseren mislukt, nieuwe poging volgt';
  if (state.syncing || waiting) return 'Synchroniseren…';
  return 'Alles is gesynchroniseerd';
}

function setSyncState() {
  const el = $('#syncDot');
  const waiting = [...state.notes.values()].some((n) => n.dirty);
  el.className = 'sync-dot' + (!state.online ? ' off' : state.syncError ? ' err' : state.syncing || waiting ? ' busy' : '');
  el.title = syncText();
  el.setAttribute('aria-label', syncText());
}

async function sync() {
  if (!state.me) return;
  if (state.syncing) { state.again = true; return; }
  state.syncing = true;
  state.again = false;
  setSyncState();
  try {
    let more = true;
    while (more) {
      const dirty = [...state.notes.values()].filter((n) => n.dirty).slice(0, 100);
      const sent = new Map(dirty.map((n) => [n.id, n.dirty]));
      const res = await api('sync', {
        method: 'POST',
        body: {
          since: state.cursor,
          changes: dirty.map((n) => ({
            id: n.id, base_rev: n.rev || 0, title: n.title, body: n.body, kind: n.kind, pinned: n.pinned,
            labels: n.labels, color: n.color, archived_at: n.archived_at, remind_at: n.remind_at,
            deleted_at: n.deleted_at, purged: n.purged, created_at: n.created_at, updated_at: n.updated_at
          }))
        }
      });
      for (const [id, count] of sent) {
        const n = state.notes.get(id);
        if (n && n.dirty === count) n.dirty = 0;
      }
      for (const id of res.conflicts) {
        const n = state.notes.get(id);
        if (n) n.dirty = 0;
      }
      if (res.conflicts.length) toast('Een notitie was ook op een ander apparaat gewijzigd. Je versie staat ernaast als kopie.');
      applyRemote(res.notes);
      state.cursor = res.cursor;
      more = res.more || (dirty.length === 100 && [...state.notes.values()].some((n) => n.dirty));
    }
    state.syncError = false;
    state.online = true;
    saveLocal(true);
  } catch (err) {
    if (err.status === 401) return signedOut();
    if (err.status) state.syncError = true;
    else state.online = false;
    scheduleSync(state.online ? 15000 : 30000);
  } finally {
    state.syncing = false;
    setSyncState();
    if (state.again) scheduleSync(300);
  }
}

function applyRemote(list) {
  let openChanged = false;
  for (const s of list) {
    const local = state.notes.get(s.id);
    if (local && local.dirty) {
      local.rev = s.rev; // tijdens het versturen verder getypt: die tekst gaat de volgende keer mee
      continue;
    }
    if (s.purged) state.notes.delete(s.id);
    else state.notes.set(s.id, normalize({ ...s, dirty: 0 }));
    if (s.id === state.openId) openChanged = true;
  }
  if (list.length) {
    renderChips();
    renderList();
    scheduleReminders();
  }
  if (openChanged) {
    if (state.notes.has(state.openId)) fillEditor(true);
    else closeNote();
  }
}

// Notities die al 30 dagen in de prullenbak liggen, definitief weg.
function emptyOldTrash() {
  const limit = Date.now() - TRASH_DAYS * DAY;
  for (const n of state.notes.values()) {
    if (n.deleted_at && n.deleted_at < limit && !n.purged) purge(n, true);
  }
}

function purge(n, quiet) {
  if (!n.rev) {
    state.notes.delete(n.id); // nooit verstuurd: alleen hier weghalen
    saveLocal();
  } else {
    touch(n, { purged: true, title: '', body: '', labels: [], remind_at: null });
  }
  if (!quiet) renderAll();
}

// ---------- Overzicht ----------

const alive = (n) => !n.purged && !n.deleted_at;

function allLabels() {
  const set = new Set();
  for (const n of state.notes.values()) if (alive(n)) for (const l of n.labels) set.add(l);
  return [...set].sort((a, b) => a.localeCompare(b, 'nl'));
}

function inView(n) {
  switch (state.view) {
    case 'prullenbak': return !n.purged && !!n.deleted_at;
    case 'archief': return alive(n) && !!n.archived_at;
    case 'herinneringen': return alive(n) && !!n.remind_at;
    case 'lijsten': return alive(n) && !n.archived_at && n.kind === 'lijst';
    case 'gedeeld': return alive(n) && (fromOther(n) || n.shared_count > 0);
    default: return alive(n) && (!n.archived_at || !!state.query.trim());
  }
}

function sorter() {
  if (state.view === 'prullenbak') return (a, b) => b.deleted_at - a.deleted_at;
  if (state.view === 'herinneringen') return (a, b) => a.remind_at - b.remind_at;
  const by = {
    bewerkt: (a, b) => b.updated_at - a.updated_at,
    gemaakt: (a, b) => b.created_at - a.created_at,
    titel: (a, b) => (a.title || '').localeCompare(b.title || '', 'nl')
  }[state.sort] || ((a, b) => b.updated_at - a.updated_at);
  return state.view === 'archief' ? by : (a, b) => (b.pinned - a.pinned) || by(a, b);
}

function visibleNotes() {
  const q = fold(state.query.trim());
  return [...state.notes.values()]
    .filter(inView)
    .filter((n) => !state.label || n.labels.includes(state.label))
    .filter((n) => !q || fold(n.title + '\n' + n.body + '\n' + n.labels.join(' ')).includes(q))
    .sort(sorter());
}

function highlight(text, q) {
  if (!q) return esc(text);
  const i = fold(text).indexOf(fold(q));
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

function titleOf(n) {
  return n.title.trim() || (n.kind === 'lijst' ? 'Lijst zonder titel' : 'Notitie zonder titel');
}

function previewLine(n) {
  if (n.kind === 'lijst') {
    const items = parseItems(n.body).filter((i) => i.text.trim());
    const done = items.filter((i) => i.done).length;
    const open = items.filter((i) => !i.done).map((i) => i.text.trim());
    return items.length ? `${done}/${items.length} · ${open.join(', ') || 'alles afgevinkt'}` : 'Lege lijst';
  }
  return plain(n.body).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' · ') || 'Geen tekst';
}

function remindTag(n) {
  if (!n.remind_at) return '';
  const late = n.remind_at < Date.now();
  return `<span class="tag ${late ? 'late' : 'remind'}">${icon('bell')}${esc(whenAhead(n.remind_at))}</span>`;
}

function shareTag(n) {
  if (fromOther(n)) return `<span class="tag shared">${icon('person')}Van ${esc(n.owner_name.split(' ')[0])}</span>`;
  if (n.shared_count > 0) return `<span class="tag shared">${icon('person')}Gedeeld</span>`;
  return '';
}

function cardHtml(n, q) {
  let body;
  if (q && !fold(n.title).includes(fold(q)) && fold(n.body).includes(fold(q))) {
    const at = fold(n.body).indexOf(fold(q));
    const snip = (at > 40 ? '…' : '') + n.body.slice(Math.max(0, at - 40), at + 120).replace(/\[[ x]\] /g, '');
    body = `<span class="card-b">${highlight(snip, q)}</span>`;
  } else if (n.kind === 'lijst') {
    const items = parseItems(n.body).filter((i) => i.text.trim());
    const shown = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)].slice(0, 7);
    body = shown.map((i) => `<span class="card-ck${i.done ? ' done' : ''}">${esc(i.text)}</span>`).join('');
    if (items.length > shown.length) body += `<span class="card-more">+ ${items.length - shown.length} meer</span>`;
    if (!items.length) body = '<span class="card-more">Lege lijst</span>';
  } else {
    const text = plain(n.body).trim();
    body = text ? `<span class="card-b">${esc(text.slice(0, 600))}</span>` : '';
  }
  const foot = remindTag(n) + shareTag(n) + n.labels.map((l) => `<span class="tag">${esc(l)}</span>`).join('') +
    (n.archived_at && state.view !== 'archief' ? '<span class="tag">Archief</span>' : '');
  const showTitle = n.title.trim() || n.kind === 'lijst' || !body;
  return `<button class="card${n.id === state.openId ? ' on' : ''}" data-id="${n.id}"${n.color ? ` data-color="${n.color}"` : ''}>
    ${n.pinned && state.view !== 'archief' ? icon('pin', 'pin') : ''}
    ${showTitle ? `<span class="card-t">${highlight(titleOf(n), q)}</span>` : ''}
    ${body}
    ${foot ? `<span class="card-foot">${foot}</span>` : ''}
  </button>`;
}

function rowHtml(n, q) {
  const time = state.view === 'prullenbak' ? n.deleted_at : state.view === 'herinneringen' ? null : n.updated_at;
  return `<button class="row-item${n.id === state.openId ? ' on' : ''}" data-id="${n.id}"${n.color ? ` data-color="${n.color}"` : ''}>
    <span class="sw"></span>
    <span class="row-main">
      <span class="row-t"><b>${highlight(titleOf(n), q)}</b>${time ? `<time>${when(time)}</time>` : remindTag(n)}</span>
      <span class="row-p">${highlight(previewLine(n), q)}</span>
    </span>
  </button>`;
}

function renderList() {
  const list = $('#list');
  const notes = visibleNotes();
  const q = state.query.trim();
  $('#viewTitle').textContent = state.label && state.view === 'notities' ? state.label : VIEWS[state.view];

  const banner = $('#banner');
  banner.hidden = !['prullenbak', 'archief'].includes(state.view);
  if (state.view === 'prullenbak') {
    banner.innerHTML = `<span>Notities hier worden na ${TRASH_DAYS} dagen definitief verwijderd.</span>${notes.length ? '<button type="button" id="emptyTrash">Prullenbak legen</button>' : ''}`;
  } else if (state.view === 'archief') {
    banner.innerHTML = '<span>Gearchiveerde notities staan niet in je overzicht, maar je vindt ze wel met zoeken.</span>';
  }

  if (!notes.length) {
    const msg = q ? `Niets gevonden voor “${esc(q)}”.`
      : state.label ? `Nog niets met het label “${esc(state.label)}”.`
      : {
        prullenbak: 'De prullenbak is leeg.',
        archief: 'Nog niets gearchiveerd.',
        herinneringen: 'Geen herinneringen. Tik in een notitie op het belletje om er een te zetten.',
        lijsten: 'Nog geen lijsten. Maak er een met de plusknop.',
        gedeeld: 'Nog niets gedeeld. Open een notitie en kies in het menu “Delen met…”.',
        notities: 'Nog geen notities. Maak je eerste met de plusknop.'
      }[state.view];
    list.innerHTML = `<div class="list-empty">${icon(state.view === 'herinneringen' ? 'bell' : state.view === 'prullenbak' ? 'trash' : 'note')}<span>${msg}</span></div>`;
    return;
  }

  const draw = state.layout === 'kaarten' ? cardHtml : rowHtml;
  const group = (items) => {
    const html = items.map((n) => draw(n, q)).join('');
    return state.layout === 'kaarten' ? `<div class="cards">${html}</div>` : `<div class="rows">${html}</div>`;
  };
  let html = '';
  if (state.view === 'herinneringen') {
    const now = Date.now();
    const late = notes.filter((n) => n.remind_at < now);
    const soon = notes.filter((n) => n.remind_at >= now);
    if (late.length) html += `<div class="list-h">Verlopen</div>${group(late)}`;
    if (soon.length) html += `<div class="list-h">Gepland</div>${group(soon)}`;
  } else if (!['prullenbak', 'archief'].includes(state.view) && notes.some((n) => n.pinned) && notes.some((n) => !n.pinned)) {
    html += `<div class="list-h">Vastgepind</div>${group(notes.filter((n) => n.pinned))}`;
    html += `<div class="list-h">Overige</div>${group(notes.filter((n) => !n.pinned))}`;
  } else {
    html = group(notes);
  }
  list.innerHTML = html;
}

function renderChips() {
  const labels = allLabels();
  const el = $('#chips');
  if (state.label && !labels.includes(state.label)) state.label = null;
  const show = labels.length > 0 && state.view !== 'prullenbak';
  el.hidden = !show;
  if (!show) return;
  el.innerHTML = `<button class="chip" type="button" data-label="" aria-pressed="${!state.label}">Alles</button>` +
    labels.map((l) => `<button class="chip" type="button" data-label="${esc(l)}" aria-pressed="${state.label === l}">${icon('tag')}${esc(l)}</button>`).join('');
}

function renderNav() {
  const tabs = ['notities', 'lijsten', 'herinneringen', 'meer'];
  const active = tabs.includes(state.view) ? state.view : 'meer';
  $$('#navPill [data-nav]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.nav === active)));
  $('#navInd').style.transform = `translateX(${tabs.indexOf(active) * 100}%)`;
  syncGlassBar();
}

function renderAll() {
  renderChips();
  renderList();
  renderNav();
  setSyncState();
}

let listTimer;
function renderListSoon() {
  clearTimeout(listTimer);
  listTimer = setTimeout(() => { renderChips(); renderList(); }, 300);
}

function setView(v) {
  state.view = v;
  if (v === 'prullenbak') state.label = null;
  if (state.openId) closeNote();
  $('#list').scrollTop = 0;
  renderAll();
}

// ---------- Glazen navigatie in de Android-app ----------

let barFrame = 0;
function syncGlassBar() {
  if (!glassUi || barFrame) return;
  barFrame = requestAnimationFrame(() => {
    barFrame = 0;
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const names = { notities: 'note', lijsten: 'list', herinneringen: 'bell', meer: 'more' };
    const tabs = $$('#navPill [data-nav]').map((b) => ({ id: b.dataset.nav, title: b.textContent.trim(), icon: ICONS[names[b.dataset.nav]] }));
    const active = $('#navPill [aria-current="true"]')?.dataset.nav || 'notities';
    const visible = !$('#app').hidden && !pdf && $('#sheetBack').hidden && getComputedStyle($('#side')).display !== 'none';
    try {
      native.glassBar(JSON.stringify({
        pill: box($('#navPill')), add: box($('#navAdd')), tabs, active,
        dark: document.documentElement.dataset.theme === 'donker', visible
      }));
    } catch (e) {}
  });
}

window.notitiesGlassNav = (id) => (id === 'add' ? newNote() : navTo(id, $(`#navPill [data-nav="${id}"]`)));

function navTo(id, from) {
  haptic();
  if (id === 'meer') return moreMenu(from || $('#navPill [data-nav="meer"]'));
  setView(id);
}

// ---------- Editor ----------

const editor = $('#editor');
const edTitle = $('#edTitle');
const edBody = $('#edBody');
const current = () => state.notes.get(state.openId);

function openNote(id, { push = true, focus = false } = {}) {
  const prev = state.openId;
  if (prev && prev !== id) dropIfEmpty(prev);
  if (!state.notes.has(id)) return;
  state.openId = id;
  $('#app').classList.add('open');
  document.body.classList.add('editing');
  $('#emptyPane').hidden = true;
  editor.hidden = false;
  fillEditor();
  renderList();
  syncGlassBar();
  if (push && isPhone() && history.state?.note !== id) {
    history[history.state?.note ? 'replaceState' : 'pushState']({ note: id }, '');
  }
  $('#edScroll').scrollTop = 0;
  if (focus) edTitle.focus();
}

function closeNote(fromHistory = false) {
  if (state.openId) dropIfEmpty(state.openId);
  state.openId = null;
  $('#app').classList.remove('open');
  document.body.classList.remove('editing');
  editor.hidden = true;
  $('#emptyPane').hidden = false;
  renderAll();
  if (!fromHistory && history.state?.note) history.back();
}

// Lege notitie verlaten? Dan hoeft hij niet te blijven bestaan.
function dropIfEmpty(id) {
  const n = state.notes.get(id);
  if (!n || n.deleted_at || fromOther(n) || n.title.trim() || n.body.replace(/\[[ x]\]/g, '').trim() || n.remind_at) return;
  purge(n, true);
}

function newNote(kind = state.view === 'lijsten' ? 'lijst' : 'tekst', fields = {}) {
  if (!['notities', 'lijsten'].includes(state.view)) state.view = 'notities';
  const t = Date.now();
  const n = normalize({
    id: newId(), title: '', body: '', kind, pinned: false, labels: state.label ? [state.label] : [],
    deleted_at: null, purged: false, created_at: t, updated_at: t, rev: 0, dirty: 0, ...fields
  });
  state.notes.set(n.id, n);
  if (fields.title || fields.body) touch(n, {});
  state.query = '';
  $('#search').value = '';
  renderNav();
  openNote(n.id, { focus: !fields.title });
  haptic();
  return n;
}

function fillEditor(remote = false) {
  const n = current();
  if (!n) return;
  const trash = !!n.deleted_at;
  const locked = readOnly(n);
  editor.classList.toggle('readonly', locked);
  editor.classList.toggle('trashed', trash);
  if (n.color) editor.dataset.color = n.color; else delete editor.dataset.color;
  edTitle.readOnly = locked;
  edBody.readOnly = locked;
  if (!(remote && document.activeElement === edTitle)) edTitle.value = n.title;

  const banner = $('#noteBanner');
  banner.hidden = !trash && !n.archived_at && !locked;
  if (locked && !trash) {
    $('#noteBannerText').textContent = `Gedeeld door ${n.owner_name}. Je kunt meelezen, maar niet bewerken.`;
    $('#noteBannerActions').innerHTML = '<button class="btn small" type="button" data-act="copy">Kopie maken</button>';
  } else if (trash) {
    $('#noteBannerText').textContent = 'Deze notitie staat in de prullenbak.';
    $('#noteBannerActions').innerHTML = '<button class="btn small" type="button" data-act="restore">Terugzetten</button><button class="btn small danger" type="button" data-act="purge">Definitief verwijderen</button>';
  } else if (n.archived_at) {
    $('#noteBannerText').textContent = 'Gearchiveerd.';
    $('#noteBannerActions').innerHTML = '<button class="btn small" type="button" data-act="unarchive">Terug naar notities</button>';
  }

  $('#pinBtn').setAttribute('aria-pressed', String(!!n.pinned));
  $('#pinBtn').hidden = trash;
  $('#pinBtn').setAttribute('aria-label', n.pinned ? 'Losmaken' : 'Vastpinnen');
  $('#remindBtn').hidden = trash;
  updateRemindChip();
  updateMeta();
  renderTags();

  const list = n.kind === 'lijst';
  const reading = !list && (state.reading.has(n.id) || locked);
  $('#fmtBar').hidden = list || locked;
  $('#fmtBar').classList.toggle('reading', reading);
  $('#previewBtn').setAttribute('aria-pressed', String(reading));
  edBody.hidden = list || reading;
  $('#preview').hidden = list || !reading;
  $('#checklist').hidden = !list;
  if (list) renderChecklist(remote);
  else if (reading) $('#preview').innerHTML = markdown(n.body);
  else {
    if (!(remote && document.activeElement === edBody)) edBody.value = n.body;
    grow(edBody);
  }
}

function updateMeta() {
  const n = current();
  if (!n) return;
  let stats;
  if (n.kind === 'lijst') {
    const items = parseItems(n.body).filter((i) => i.text.trim());
    stats = `${items.filter((i) => i.done).length} van ${items.length} klaar`;
  } else {
    const words = (n.body.match(/\S+/g) || []).length;
    stats = `${words} ${words === 1 ? 'woord' : 'woorden'}${words > 200 ? ` · ${Math.ceil(words / 220)} min lezen` : ''}`;
  }
  $('#edMeta').textContent = `${n.updated_at === n.created_at ? 'Gemaakt' : 'Bewerkt'} ${when(n.updated_at, true)} · ${stats}`;
}

function updateRemindChip() {
  const n = current();
  const chip = $('#remindBtn');
  chip.classList.toggle('set', !!n?.remind_at && n.remind_at >= Date.now());
  chip.classList.toggle('late', !!n?.remind_at && n.remind_at < Date.now());
  $('#remindText').textContent = n?.remind_at ? whenAhead(n.remind_at) : '';
  chip.setAttribute('aria-label', n?.remind_at ? `Herinnering ${whenAhead(n.remind_at)}` : 'Herinnering zetten');
}

function renderTags() {
  const n = current();
  const share = fromOther(n) ? `<button class="tag shared" type="button" data-share>${icon('person')}Van ${esc(n.owner_name)}</button>`
    : n.shared_count > 0 ? `<button class="tag shared" type="button" data-share>${icon('person')}Gedeeld met ${n.shared_count}</button>` : '';
  $('#edTags').innerHTML = share + n.labels.map((l) => `<button class="tag" type="button" data-tag="${esc(l)}">${icon('tag')}${esc(l)}</button>`).join('') +
    `<button class="tag add" type="button" data-tag="">${icon('plus')}Label</button>`;
}

function grow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

edTitle.addEventListener('input', () => {
  const n = current();
  if (!n) return;
  touch(n, { title: edTitle.value });
  updateMeta();
  renderListSoon();
});

edTitle.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const n = current();
  if (n?.kind === 'lijst') {
    const first = $('#openItems textarea');
    if (first) first.focus(); else addItem(0);
  } else if (state.reading.has(n.id)) {
    setReading(false);
  } else {
    edBody.focus();
    edBody.setSelectionRange(0, 0);
  }
});

edBody.addEventListener('input', () => {
  const n = current();
  if (!n) return;
  touch(n, { body: edBody.value });
  grow(edBody);
  updateMeta();
  renderListSoon();
});

// Opsommingen doorzetten: Enter na "- iets" of "[ ] iets" begint een nieuwe regel van dezelfde soort.
edBody.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && (e.key === 'b' || e.key === 'i')) {
    e.preventDefault();
    format(e.key === 'b' ? 'bold' : 'italic');
    return;
  }
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  const v = edBody.value;
  const pos = edBody.selectionStart;
  const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
  const line = v.slice(lineStart, pos);
  const m = line.match(/^(\s*)([-*•]|\d+[.)]|\[[ x]\]|[-*] \[[ x]\])\s/);
  if (!m) return;
  e.preventDefault();
  if (line.trim() === m[0].trim()) {
    edBody.setRangeText('', lineStart, pos, 'end'); // lege opsomming: stoppen
  } else {
    let marker = m[2];
    if (/^\d+/.test(marker)) marker = `${parseInt(marker, 10) + 1}${marker.slice(-1)}`;
    marker = marker.replace('[x]', '[ ]');
    edBody.setRangeText(`\n${m[1]}${marker} `, pos, edBody.selectionEnd, 'end');
  }
  edBody.dispatchEvent(new Event('input'));
});

function format(kind) {
  const n = current();
  if (!n || n.kind === 'lijst') return;
  if (state.reading.has(n.id)) setReading(false);
  const ta = edBody;
  ta.focus();
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const sel = v.slice(s, e);
  const wrap = (mark, placeholder) => {
    const text = sel || placeholder;
    ta.setRangeText(`${mark}${text}${mark}`, s, e, 'end');
    ta.setSelectionRange(s + mark.length, s + mark.length + text.length);
  };
  const prefix = (p) => {
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    const nl = v.indexOf('\n', e);
    const lineEnd = nl === -1 ? v.length : nl;
    const lines = v.slice(lineStart, lineEnd).split('\n');
    const all = lines.every((l) => l.startsWith(p));
    ta.setRangeText(lines.map((l) => (all ? l.slice(p.length) : p + l)).join('\n'), lineStart, lineEnd, 'end');
  };
  if (kind === 'bold') wrap('**', 'vet');
  else if (kind === 'italic') wrap('*', 'schuin');
  else if (kind === 'heading') prefix('## ');
  else if (kind === 'bullet') prefix('- ');
  else if (kind === 'checkbox') prefix('[ ] ');
  else if (kind === 'quote') prefix('> ');
  else if (kind === 'link') {
    const text = sel || 'linktekst';
    ta.setRangeText(`[${text}](https://)`, s, e, 'end');
    const at = s + text.length + 3;
    ta.setSelectionRange(at, at + 8);
  }
  ta.dispatchEvent(new Event('input'));
}

$('#fmtBar').addEventListener('mousedown', (e) => { if (e.target.closest('[data-fmt]')) e.preventDefault(); });
$('#fmtBar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-fmt]');
  if (b) { haptic(); format(b.dataset.fmt); }
});

function setReading(on) {
  const n = current();
  if (!n) return;
  if (on) state.reading.add(n.id); else state.reading.delete(n.id);
  fillEditor();
  if (!on) edBody.focus();
}

$('#previewBtn').addEventListener('click', () => {
  haptic();
  setReading(!state.reading.has(state.openId));
});

// Afvinkvakjes in de leesweergave werken echt.
$('#preview').addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  const n = current();
  const lines = n.body.split('\n');
  const i = +e.target.dataset.line;
  lines[i] = lines[i].replace(/\[( |x|X)\]/, e.target.checked ? '[x]' : '[ ]');
  touch(n, { body: lines.join('\n') });
  haptic(e.target.checked ? 'confirm' : 'tick');
  e.target.closest('.task').classList.toggle('done', e.target.checked);
  renderListSoon();
});

// ---------- Checklist ----------

function renderChecklist(remote = false) {
  const n = current();
  if (remote && document.activeElement?.closest?.('.ck')) return; // niet onder iemands vingers verspringen
  const items = parseItems(n.body);
  const row = (it, i) => `<div class="ck${it.done ? ' done' : ''}" data-i="${i}">
      <input type="checkbox" ${it.done ? 'checked' : ''} aria-label="Afvinken">
      <textarea rows="1" enterkeyhint="next" aria-label="Item">${esc(it.text)}</textarea>
      <button class="del" type="button" aria-label="Item verwijderen">${icon('close')}</button>
    </div>`;
  const real = items.filter((i) => i.text.trim());
  const count = items.filter((i) => i.done).length;
  const pct = real.length ? Math.round((real.filter((i) => i.done).length / real.length) * 100) : 0;
  $('#openItems').innerHTML = (real.length ? `<div class="progress" title="${pct}% klaar"><span style="width:${pct}%"></span></div>` : '') +
    items.map((it, i) => (it.done ? '' : row(it, i))).join('');
  $('#doneItems').innerHTML = items.map((it, i) => (it.done ? row(it, i) : '')).join('');
  $('#doneWrap').hidden = !count;
  $('#doneSummary').textContent = `${count} afgevinkt`;
  $$('.ck textarea').forEach(grow);
}

function itemsOf() {
  return parseItems(current().body);
}

function saveItems(items, rerender = true) {
  touch(current(), { body: joinItems(items) });
  updateMeta();
  renderListSoon();
  if (rerender) renderChecklist();
}

function focusItem(i, atEnd = true) {
  const ta = $(`.ck[data-i="${i}"] textarea`);
  if (!ta) return;
  ta.focus();
  const p = atEnd ? ta.value.length : 0;
  ta.setSelectionRange(p, p);
}

function addItem(at, text = '') {
  const items = itemsOf();
  items.splice(at, 0, { done: false, text });
  saveItems(items);
  focusItem(at, false);
}

$('#addItem').addEventListener('click', () => {
  const items = itemsOf();
  let at = 0;
  for (let i = items.length - 1; i >= 0; i--) if (!items[i].done) { at = i + 1; break; }
  addItem(at);
});

$('#checklist').addEventListener('input', (e) => {
  const ck = e.target.closest('.ck');
  if (!ck || e.target.tagName !== 'TEXTAREA') return;
  const items = itemsOf();
  // Geplakte tekst met meerdere regels wordt meerdere items.
  const parts = e.target.value.split('\n');
  const i = +ck.dataset.i;
  items[i].text = parts[0];
  if (parts.length > 1) {
    items.splice(i + 1, 0, ...parts.slice(1).filter((p) => p.trim()).map((p) => ({ done: false, text: p })));
    saveItems(items);
    focusItem(i + parts.length - 1);
    return;
  }
  grow(e.target);
  saveItems(items, false);
});

$('#checklist').addEventListener('keydown', (e) => {
  const ck = e.target.closest('.ck');
  if (!ck || e.target.tagName !== 'TEXTAREA') return;
  const i = +ck.dataset.i;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    const ta = e.target;
    const items = itemsOf();
    items[i].text = ta.value.slice(0, ta.selectionStart);
    items.splice(i + 1, 0, { done: false, text: ta.value.slice(ta.selectionEnd) });
    saveItems(items);
    focusItem(i + 1, false);
  } else if (e.key === 'Backspace' && e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
    const items = itemsOf();
    const same = items.map((it, j) => j).filter((j) => items[j].done === items[i].done);
    const prev = same[same.indexOf(i) - 1];
    if (prev === undefined && e.target.value) return;
    e.preventDefault();
    if (prev !== undefined) {
      const len = items[prev].text.length;
      items[prev].text += items[i].text;
      items.splice(i, 1);
      saveItems(items);
      const ta = $(`.ck[data-i="${prev}"] textarea`);
      ta?.focus();
      ta?.setSelectionRange(len, len);
    } else {
      items.splice(i, 1);
      saveItems(items);
      edTitle.focus();
    }
  }
});

$('#checklist').addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  const items = itemsOf();
  items[+e.target.closest('.ck').dataset.i].done = e.target.checked;
  haptic(e.target.checked ? 'confirm' : 'tick');
  saveItems(items);
  if (e.target.checked && items.every((i) => i.done || !i.text.trim())) toast('Alles afgevinkt!');
});

$('#checklist').addEventListener('click', (e) => {
  const del = e.target.closest('.del');
  if (!del) return;
  const items = itemsOf();
  items.splice(+del.closest('.ck').dataset.i, 1);
  saveItems(items);
});

// ---------- Acties op een notitie ----------

function togglePin(n = current()) {
  touch(n, { pinned: !n.pinned }, { keepTime: true });
  haptic('confirm');
  if (n.id === state.openId) fillEditor();
  renderList();
  toast(n.pinned ? 'Vastgepind' : 'Losgemaakt');
}

function toTrash(n = current()) {
  if (!n) return;
  if (fromOther(n)) {
    // Niet van mij: alleen uit mijn notities halen; bij de eigenaar blijft hij gewoon bestaan.
    if (n.id === state.openId) closeNote();
    purge(n);
    haptic('reject');
    toast(`Weggehaald uit je notities (blijft bij ${n.owner_name.split(' ')[0]})`);
    return;
  }
  if (!n.title.trim() && !n.body.trim()) {
    if (n.id === state.openId) closeNote();
    return;
  }
  touch(n, { deleted_at: Date.now(), pinned: false }, { keepTime: true });
  haptic('reject');
  if (n.id === state.openId) closeNote(); else renderAll();
  toast('Naar de prullenbak', { label: 'Ongedaan maken', run: () => { touch(n, { deleted_at: null }, { keepTime: true }); renderAll(); } });
}

function archive(n = current(), on = true) {
  touch(n, { archived_at: on ? Date.now() : null, pinned: on ? false : n.pinned }, { keepTime: true });
  haptic('confirm');
  if (on && n.id === state.openId) closeNote();
  else {
    if (n.id === state.openId) fillEditor();
    renderAll();
  }
  toast(on ? 'Gearchiveerd' : 'Terug in je notities', on ? { label: 'Ongedaan maken', run: () => { touch(n, { archived_at: null }, { keepTime: true }); renderAll(); } } : undefined);
}

function restore(n = current()) {
  touch(n, { deleted_at: null }, { keepTime: true });
  state.view = 'notities';
  openNote(n.id);
  renderNav();
  toast('Teruggezet');
}

let purgeArmed = 0;
function purgeOpen(btn) {
  // Twee keer kiezen om definitief te verwijderen (geen pop-upvenster nodig).
  if (Date.now() - purgeArmed > 4000) {
    purgeArmed = Date.now();
    if (btn) {
      btn.textContent = 'Nog een keer tikken';
      setTimeout(() => { btn.textContent = 'Definitief verwijderen'; }, 4000);
    } else toast('Kies nog een keer om definitief te verwijderen');
    return;
  }
  purgeArmed = 0;
  const n = current();
  closeNote();
  purge(n);
  toast('Definitief verwijderd');
}

$('#noteBannerActions').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'restore') restore();
  if (act === 'purge') purgeOpen(e.target);
  if (act === 'unarchive') archive(current(), false);
  if (act === 'copy') duplicate(current());
});

function convert(n = current()) {
  if (n.kind === 'tekst') {
    const items = n.body.split('\n').filter((l) => l.trim()).map((l) => ({
      done: /^\s*(?:[-*]\s+)?\[[xX]\]/.test(l),
      text: l.replace(/^\s*([-*•]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s?/, '')
    }));
    touch(n, { kind: 'lijst', body: joinItems(items) });
  } else {
    touch(n, { kind: 'tekst', body: parseItems(n.body).map((i) => `[${i.done ? 'x' : ' '}] ${i.text}`).join('\n') });
  }
  fillEditor();
  renderList();
}

function duplicate(n = current()) {
  const t = Date.now();
  const copy = normalize({ ...n, id: newId(), title: n.title ? `${n.title} (kopie)` : '', pinned: false, remind_at: null, created_at: t, rev: 0, dirty: 0, owner_name: null, can_write: true, shared_count: 0 });
  touch(copy, {});
  openNote(copy.id);
  toast('Kopie gemaakt');
}

function noteText(n) {
  const body = n.kind === 'lijst' ? parseItems(n.body).map((i) => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n') : n.body;
  return [n.title, body].filter(Boolean).join('\n\n');
}

async function shareNote(n = current()) {
  const text = noteText(n);
  try {
    if (native?.share) native.share(n.title || 'Notitie', text);
    else if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: n.title, text });
    else { await navigator.clipboard.writeText(text); toast('Tekst gekopieerd'); }
  } catch (e) { /* geannuleerd */ }
}

function setColor(n, color) {
  touch(n, { color }, { keepTime: true });
  if (n.id === state.openId) fillEditor();
  renderList();
}

// ---------- Herinneringen ----------

function remindAt(dayOffset, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function nextWeekday(day, hour) {
  const add = ((day - new Date().getDay() + 7) % 7) || 7;
  return remindAt(add, hour);
}

const fired = new Set(load('notities:fired') || []);

function setReminder(n, at) {
  touch(n, { remind_at: at }, { keepTime: true });
  haptic('confirm');
  if (n.id === state.openId) updateRemindChip();
  renderList();
  if (at) {
    toast(`Herinnering ${whenAhead(at)}`);
    if (!native && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  } else toast('Herinnering weggehaald');
}

function reminderSheet(n = current()) {
  const now = Date.now();
  const options = [
    ['Over een uur', hhmm(new Date(now + 3600e3)), now + 3600e3],
    ...(new Date().getHours() < 17 ? [['Vanavond', '18:00', remindAt(0, 18)]] : []),
    ['Morgenochtend', '09:00', remindAt(1, 9)],
    ['Morgenavond', '18:00', remindAt(1, 18)],
    ['Zaterdag', '10:00', nextWeekday(6, 10)],
    ['Volgende week', 'maandag 09:00', nextWeekday(1, 9)]
  ];
  const local = new Date((n.remind_at || remindAt(1, 9)) - new Date().getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
  const body = openSheet('Herinnering', `
    <p class="muted small">${n.remind_at ? `Nu ingesteld op <b>${esc(whenAhead(n.remind_at))}</b>.` : native ? 'Je telefoon geeft een melding op het gekozen moment.' : 'Je krijgt een melding op het gekozen moment, zolang deze site openstaat. In de Android-app komt de melding altijd.'}</p>
    <div class="quick">${options.map(([t, s], i) => `<button type="button" data-q="${i}">${esc(t)}<small>${esc(s)}</small></button>`).join('')}</div>
    <label class="field-label" for="remindPick">Of kies zelf</label>
    <div class="add-row"><input class="field" id="remindPick" type="datetime-local" value="${local}"><button class="btn primary" type="button" id="remindSet">Zetten</button></div>
    ${n.remind_at ? '<div class="group"><button class="btn danger" type="button" id="remindClear">Herinnering weghalen</button></div>' : ''}`);
  body.onclick = (e) => {
    const q = e.target.closest('[data-q]');
    if (q) { setReminder(n, options[+q.dataset.q][2]); closeSheet(); }
    if (e.target.id === 'remindSet') {
      const at = new Date($('#remindPick').value).getTime();
      if (!at) return toast('Kies een datum en tijd');
      setReminder(n, at);
      closeSheet();
    }
    if (e.target.id === 'remindClear') { setReminder(n, null); closeSheet(); }
  };
}

// Op de website: melding zolang de pagina openstaat. In de app plant Android de meldingen zelf in.
function checkReminders() {
  if (!state.me) return;
  const now = Date.now();
  for (const n of state.notes.values()) {
    const key = `${n.id}@${n.remind_at}`;
    if (!alive(n) || !n.remind_at || n.remind_at > now || now - n.remind_at > 6 * 3600e3 || fired.has(key)) continue;
    fired.add(key);
    store('notities:fired', [...fired].slice(-200));
    renderList();
    if (native) continue;
    toast(`Herinnering: ${titleOf(n)}`, { label: 'Openen', run: () => window.notitiesOpen(n.id) });
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const msg = new Notification(titleOf(n), { body: previewLine(n), icon: '/icons/icon-192.png', tag: n.id });
        msg.onclick = () => { window.focus(); window.notitiesOpen(n.id); };
      } catch (e) {}
    }
  }
  if (state.openId) updateRemindChip();
}

let remindTimer;
function scheduleReminders() {
  if (!native?.setReminders) return;
  clearTimeout(remindTimer);
  remindTimer = setTimeout(() => {
    const now = Date.now();
    const list = [...state.notes.values()]
      .filter((n) => alive(n) && !n.archived_at && n.remind_at && n.remind_at > now - 60e3)
      .map((n) => ({ id: n.id, at: n.remind_at, title: titleOf(n), text: previewLine(n) }));
    try { native.setReminders(JSON.stringify(list)); } catch (e) {}
  }, 500);
}

// Vanuit een melding of snelkoppeling in de app.
window.notitiesOpen = (id) => {
  const n = state.notes.get(id);
  if (!n) return false;
  state.view = n.deleted_at ? 'prullenbak' : n.archived_at ? 'archief' : state.view === 'herinneringen' ? 'herinneringen' : 'notities';
  closeSheet();
  renderNav();
  openNote(id);
  return true;
};

window.notitiesToast = (text) => toast(text);

window.notitiesNew = (kind, title, text) => {
  if (!state.me) return false;
  closeSheet();
  if (kind === 'dag') return dayNote();
  newNote(kind === 'lijst' ? 'lijst' : 'tekst', text || title ? { title: title || '', body: text || '' } : {});
  return true;
};

// ---------- Labels ----------

function labelSheet(n = current()) {
  const draw = () => {
    const labels = [...new Set([...allLabels(), ...n.labels])].sort((a, b) => a.localeCompare(b, 'nl'));
    return `<div class="opts">${labels.map((l) => `<label class="opt"><input type="checkbox" data-l="${esc(l)}"${n.labels.includes(l) ? ' checked' : ''}><span class="grow">${esc(l)}</span></label>`).join('') || '<p class="muted small">Nog geen labels. Maak hieronder je eerste.</p>'}</div>
      <form class="add-row" id="labelForm"><input class="field" id="labelNew" placeholder="Nieuw label, bijv. School" maxlength="40" autocomplete="off"><button class="btn primary" type="submit">Toevoegen</button></form>`;
  };
  const body = openSheet('Labels', draw());
  const apply = (labels) => {
    touch(n, { labels }, { keepTime: true });
    if (n.id === state.openId) renderTags();
    renderChips();
    renderList();
  };
  body.onchange = (e) => {
    const l = e.target.dataset?.l;
    if (l === undefined) return;
    apply(e.target.checked ? [...n.labels, l] : n.labels.filter((x) => x !== l));
  };
  body.onsubmit = (e) => {
    e.preventDefault();
    const name = $('#labelNew').value.trim().slice(0, 40);
    if (!name) return;
    if (!n.labels.includes(name)) apply([...n.labels, name]);
    body.innerHTML = draw();
    $('#labelNew').focus();
  };
}

function manageLabels() {
  const draw = () => {
    const labels = allLabels();
    const count = (l) => [...state.notes.values()].filter((n) => alive(n) && n.labels.includes(l)).length;
    return labels.length
      ? `<div class="opts">${labels.map((l) => `<div class="opt"><input class="field grow" value="${esc(l)}" data-old="${esc(l)}" maxlength="40" aria-label="Label ${esc(l)}"><small>${count(l)}</small><button class="icon-btn" type="button" data-del="${esc(l)}" aria-label="Label ${esc(l)} verwijderen">${icon('trash')}</button></div>`).join('')}</div><p class="muted small">Pas een naam aan om het label overal te hernoemen. Verwijderen haalt alleen het label weg, niet de notities.</p>`
      : '<p class="muted small">Je hebt nog geen labels. Geef een notitie een label met de knop “Label” onder de titel.</p>';
  };
  const body = openSheet('Labels beheren', draw());
  const each = (fn) => {
    for (const n of state.notes.values()) {
      if (n.purged) continue;
      const next = [...new Set(fn(n.labels))];
      if (next.join('\u0000') !== n.labels.join('\u0000')) touch(n, { labels: next }, { keepTime: true });
    }
    renderAll();
    body.innerHTML = draw();
  };
  body.onchange = (e) => {
    const old = e.target.dataset?.old;
    const name = e.target.value?.trim().slice(0, 40);
    if (!old || !name || name === old) return;
    if (state.label === old) state.label = name;
    each((ls) => ls.map((l) => (l === old ? name : l)));
    toast(`Hernoemd naar “${name}”`);
  };
  body.onclick = (e) => {
    const del = e.target.closest('[data-del]')?.dataset.del;
    if (!del) return;
    if (state.label === del) state.label = null;
    each((ls) => ls.filter((l) => l !== del));
    toast(`Label “${del}” verwijderd`);
  };
}

// ---------- Eerdere versies ----------

async function versionsSheet(n = current()) {
  const body = openSheet('Eerdere versies', '<p class="muted small">Laden…</p>');
  if (!n.rev) {
    body.innerHTML = '<p class="muted small">Deze notitie is nog niet online opgeslagen, dus er zijn nog geen eerdere versies.</p>';
    return;
  }
  let list;
  try { list = await api(`notes/${n.id}/versions`); } catch (err) {
    body.innerHTML = `<p class="muted small">${err.status ? esc(err.message) : 'Eerdere versies zijn alleen online te bekijken.'}</p>`;
    return;
  }
  const show = () => {
    body.innerHTML = list.length
      ? `<p class="muted small">Werk je later weer aan een notitie, dan wordt de vorige tekst bewaard (hooguit één per kwartier, de laatste 50).</p><div class="opts">${list.map((v, i) => `<button class="opt" type="button" data-v="${i}"><span class="grow">${esc(when(v.saved_at, true))}<small>${esc(v.title || '(geen titel)')} · ${esc(plain(v.body).replace(/\[[ x]\] /g, '').slice(0, 80))}</small></span>${icon('next')}</button>`).join('')}</div>`
      : '<p class="muted small">Nog geen eerdere versies. Die ontstaan vanzelf als je een notitie later weer aanpast.</p>';
  };
  show();
  body.onclick = (e) => {
    if (e.target.closest('#vBack')) return show();
    const restoreBtn = e.target.closest('#vRestore');
    if (restoreBtn) {
      const v = list[+restoreBtn.dataset.v];
      touch(n, { title: v.title, body: v.body, kind: v.kind });
      if (n.id === state.openId) fillEditor();
      renderList();
      closeSheet();
      toast('Eerdere versie teruggezet');
      return;
    }
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const v = list[+b.dataset.v];
    const text = v.kind === 'lijst' ? parseItems(v.body).map((i) => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n') : v.body;
    body.innerHTML = `<p class="muted small">Versie van ${esc(when(v.saved_at, true))}</p>
      <div class="version-view"><b>${esc(v.title)}</b>\n\n${esc(text)}</div>
      <div class="row"><button class="btn primary" type="button" id="vRestore" data-v="${b.dataset.v}">Deze versie terugzetten</button><button class="btn" type="button" id="vBack">Terug</button></div>`;
  };
}

// ---------- Delen met andere gebruikers ----------

async function shareSheet(n = current()) {
  const id = n.id;
  const body = openSheet('Delen', '<p class="muted small">Laden…</p>');
  if (!n.rev || n.dirty) await sync();
  if (!state.notes.get(id)?.rev) {
    body.innerHTML = '<p class="muted small">Deze notitie moet eerst online opgeslagen zijn. Probeer het opnieuw als je verbinding hebt.</p>';
    return;
  }
  let shares = [];
  let people = [];
  const load = async () => {
    [shares, people] = await Promise.all([api(`notes/${id}/shares`), api('people')]);
  };
  try { await load(); } catch (err) {
    body.innerHTML = `<p class="muted small">${err.status ? esc(err.message) : 'Delen kan alleen als je online bent.'}</p>`;
    return;
  }
  const draw = () => {
    const free = people.filter((p) => !shares.some((s) => s.username === p.username));
    body.innerHTML = `
      <p class="muted small">Wie je toevoegt, ziet deze notitie bij zijn eigen notities. Labels, kleur en vastpinnen houdt ieder voor zich.</p>
      <div class="group">
        <h3>Gedeeld met</h3>
        ${shares.length ? shares.map((s) => `<div class="share-row"><div><b>${esc(s.full_name)}</b><span>${esc(s.username)}</span></div>
          <label><input type="checkbox" data-write="${esc(s.username)}"${s.can_write ? ' checked' : ''}>Mag bewerken</label>
          <button class="icon-btn" type="button" data-del="${s.user_id}" aria-label="Niet meer delen met ${esc(s.full_name)}">${icon('close')}</button></div>`).join('')
          : '<p class="muted small">Nog met niemand.</p>'}
      </div>
      <form class="share-add" id="shareForm">
        <h3 class="muted small" style="margin:0">Iemand toevoegen</h3>
        ${free.length ? `<div class="people">${free.map((p) => `<button class="chip" type="button" data-pick="${esc(p.username)}">${esc(p.full_name)}</button>`).join('')}</div>` : ''}
        <input class="field" id="shareUser" placeholder="Gebruikersnaam" autocapitalize="none" spellcheck="false" autocomplete="off">
        <label class="check"><input type="checkbox" id="shareWrite" checked>Mag bewerken</label>
        <button class="btn primary" type="submit">Delen</button>
      </form>`;
  };
  const save = async (username, canWrite) => {
    try {
      const r = await api(`notes/${id}/shares`, { method: 'POST', body: { username, can_write: canWrite } });
      await load();
      draw();
      sync();
      return r;
    } catch (err) { toast(err.status ? err.message : 'Delen kan alleen als je online bent.'); }
  };
  draw();
  body.onclick = async (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { $('#shareUser').value = pick.dataset.pick; $('#shareUser').focus(); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      try {
        await api(`notes/${id}/shares/${del.dataset.del}`, { method: 'DELETE' });
        await load();
        draw();
        sync();
        toast('Niet meer gedeeld');
      } catch (err) { toast(err.message); }
    }
  };
  body.onchange = (e) => {
    const w = e.target.dataset?.write;
    if (w) save(w, e.target.checked);
  };
  body.onsubmit = async (e) => {
    e.preventDefault();
    const username = $('#shareUser').value.trim();
    if (!username) return toast('Kies iemand of vul een gebruikersnaam in');
    const r = await save(username, $('#shareWrite').checked);
    if (r) { haptic('confirm'); toast(`Gedeeld met ${r.full_name}`); }
  };
}

// ---------- PDF bekijken (de Android-app opent PDF's met Notities als je dat kiest) ----------

let pdf = null;

function setZoom(on) {
  $('meta[name="viewport"]').setAttribute('content', on
    ? 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover'
    : 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content');
  try { native?.pdfZoom?.(on); } catch (e) {}
}

window.notitiesPdf = (info) => {
  pdf = info;
  closeMenu();
  closeSheet();
  document.body.classList.add('pdf-open');
  $('#pdfView').hidden = false;
  $('#pdfName').textContent = info.name;
  $('#pdfInfo').textContent = `${info.pages.length} ${info.pages.length === 1 ? 'pagina' : "pagina's"} · knijp om in te zoomen`;
  $('#pdfPages').innerHTML = info.pages.map((p, i) =>
    `<img src="/__pdf/${encodeURIComponent(info.token)}/${i}.jpg" width="${p.w}" height="${p.h}" loading="${i < 2 ? 'eager' : 'lazy'}" alt="Pagina ${i + 1}">`).join('');
  window.scrollTo(0, 0);
  setZoom(true);
  syncGlassBar();
  return true;
};

function closePdf() {
  if (!pdf) return;
  pdf = null;
  setZoom(false);
  document.body.classList.remove('pdf-open');
  $('#pdfView').hidden = true;
  $('#pdfPages').innerHTML = '';
  syncGlassBar();
}

function pdfToNote() {
  if (!state.me) return toast('Log eerst in om er een notitie van te maken');
  let text = '';
  try { text = native?.pdfText?.(pdf.token) || ''; } catch (e) {}
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const file = pdf.name;
  const name = file.replace(/\.pdf$/i, '');
  closePdf();
  newNote('tekst', { title: name, labels: ['PDF'], body: text.trim() || `Uit de PDF “${file}”. De tekst kon niet worden uitgelezen; tik hier om je eigen aantekeningen te schrijven.` });
  toast(text.trim() ? 'Notitie gemaakt met de tekst uit de PDF' : 'Notitie gemaakt');
}

$('#pdfBack').addEventListener('click', closePdf);
$('#pdfMenu').addEventListener('click', (e) => menu(e.currentTarget, [
  { title: 'Notitie maken van de tekst', icon: 'note', run: pdfToNote },
  { title: 'Delen', icon: 'share', run: () => native?.pdfShare?.(pdf.token) },
  { title: 'Openen met een andere app', icon: 'pdf', run: () => native?.pdfOpenWith?.(pdf.token) },
  { separator: true },
  { title: 'Terug naar je notities', icon: 'back', run: closePdf }
]));

// ---------- Dagnotitie, exporteren, sneltoetsen ----------

function dayNote() {
  const d = new Date();
  const dag = DAGEN[d.getDay()];
  const title = `${dag[0].toUpperCase()}${dag.slice(1)} ${d.getDate()} ${MAANDEN_LANG[d.getMonth()]} ${d.getFullYear()}`;
  const found = [...state.notes.values()].find((n) => alive(n) && n.title === title && n.labels.includes('Dagboek'));
  if (found) {
    state.view = found.archived_at ? 'archief' : 'notities';
    renderNav();
    openNote(found.id);
    touch(found, { body: `${found.body.replace(/\s+$/, '')}\n\n${hhmm(d)} ` });
    fillEditor();
  } else {
    newNote('tekst', { title, labels: ['Dagboek'], body: `${hhmm(d)} ` });
  }
  edBody.focus();
  edBody.setSelectionRange(edBody.value.length, edBody.value.length);
  return true;
}

function exportAll() {
  const notes = [...state.notes.values()].filter(alive).sort((a, b) => b.updated_at - a.updated_at);
  const md = notes.map((n) => {
    const meta = [n.labels.length ? `Labels: ${n.labels.join(', ')}` : '', `Bewerkt: ${when(n.updated_at, true)}`].filter(Boolean).join(' · ');
    const body = n.kind === 'lijst' ? parseItems(n.body).map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n') : n.body;
    return `# ${titleOf(n)}\n\n_${meta}_\n\n${body}`;
  }).join('\n\n---\n\n');
  if (native?.share) return native.share('Notities', md);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = `notities-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${notes.length} notities geëxporteerd`);
}

function shortcutsSheet() {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const rows = [
    [`${mod} Alt N`, 'Nieuwe notitie'], [`${mod} Alt L`, 'Nieuwe lijst'], [`${mod} Alt D`, 'Dagnotitie'], [`${mod} K`, 'Zoeken'],
    [`${mod} B / ${mod} I`, 'Vet / schuin'], [`${mod} E`, 'Lezen of bewerken'], ['Esc', 'Menu, paneel of notitie sluiten']
  ];
  openSheet('Sneltoetsen', `<div class="opts">${rows.map(([k, t]) => `<div class="opt"><span class="grow">${t}</span>${k.split(' / ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</div>`).join('')}</div>`);
}

// ---------- Menu's ----------
// In de Android-app (13+) toont de app zelf een glazen menu; op de website een gewoon plat menu.
// rows: { id, title, subtitle, icon, checked, destructive, separator, heading, swatch, run }

let menuPicks = new Map();
window.notitiesGlassPick = (id) => menuPicks.get(id)?.();

function menu(from, rows) {
  rows = rows.filter(Boolean).map((r, i) => ({ ...r, id: r.id || String(i) }));
  menuPicks = new Map(rows.filter((r) => r.run).map((r) => [r.id, r.run]));
  haptic();
  const box = from.getBoundingClientRect();
  if (native?.glassMenu) {
    try {
      const dark = document.documentElement.dataset.theme === 'donker';
      const items = rows.map(({ run, swatch, icon: name, ...r }) => ({ ...r, ...(name ? { icon: ICONS[name] } : {}) }));
      if (native.glassMenu(JSON.stringify({ x: box.left, y: box.top, w: box.width, h: box.height, dark, items }))) return;
    } catch (e) { /* dan het gewone menu */ }
  }
  closeMenu();
  const back = document.createElement('div');
  back.className = 'menu-back';
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  const checks = rows.some((r) => r.checked !== undefined);
  el.innerHTML = rows.map((r) => {
    if (r.separator) return '<hr>';
    if (r.heading) return `<div class="menu-h">${esc(r.title)}</div>`;
    const lead = r.swatch !== undefined ? `<span class="sw"${r.swatch ? ` data-color="${r.swatch}"` : ''}></span>` : r.icon ? icon(r.icon) : '';
    return `<button role="menuitem" data-id="${esc(r.id)}" class="${r.destructive ? 'destructive' : ''}"${r.disabled ? ' disabled' : ''}>
      ${checks ? `<span class="ck-mark">${r.checked ? '✓' : ''}</span>` : ''}${lead}
      <span>${esc(r.title)}${r.subtitle ? `<small>${esc(r.subtitle)}</small>` : ''}</span></button>`;
  }).join('');
  document.body.append(back, el);
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = box.right - w;
  if (left < 12) left = box.left;
  left = Math.max(12, Math.min(left, innerWidth - w - 12));
  let top = box.bottom + 6;
  if (top + h > innerHeight - 12) top = Math.max(12, box.top - h - 6);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  back.onclick = closeMenu;
  el.onclick = (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    closeMenu();
    menuPicks.get(b.dataset.id)?.();
  };
  el.querySelector('button')?.focus({ preventScroll: true });
}

function closeMenu() {
  $$('.menu, .menu-back').forEach((e) => e.remove());
}

function colorMenu(from, n) {
  menu(from, COLORS.map(([c, name]) => ({ title: name, swatch: c, checked: n.color === c, run: () => setColor(n, c) })));
}

function noteMenu(from = $('#noteMenuBtn'), n = current()) {
  if (!n) return;
  if (n.deleted_at) return menu(from, [
    { title: 'Terugzetten', icon: 'history', run: () => restore(n) },
    { title: 'Definitief verwijderen', icon: 'trash', destructive: true, run: () => { if (state.openId !== n.id) openNote(n.id); purgeArmed = Date.now(); purgeOpen(); } }
  ]);
  const list = n.kind === 'lijst';
  const open = n.id === state.openId;
  const done = open && list && !readOnly(n) && parseItems(n.body).some((i) => i.done);
  const other = fromOther(n);
  menu(from, [
    !open && { title: n.pinned ? 'Losmaken' : 'Vastpinnen', icon: 'pin', run: () => togglePin(n) },
    { title: 'Kleur', subtitle: COLORS.find(([c]) => c === n.color)?.[1], icon: 'palette', run: () => colorMenu(from, n) },
    { title: 'Labels', subtitle: n.labels.join(', ') || 'Geen', icon: 'tag', run: () => labelSheet(n) },
    { title: n.remind_at ? 'Herinnering wijzigen' : 'Herinnering', subtitle: n.remind_at ? whenAhead(n.remind_at) : undefined, icon: 'bell', run: () => reminderSheet(n) },
    other
      ? { title: `Gedeeld door ${n.owner_name}`, subtitle: n.can_write ? 'Jullie kunnen allebei bewerken' : 'Alleen lezen', icon: 'person', disabled: true }
      : { title: 'Delen met…', subtitle: n.shared_count ? `Gedeeld met ${n.shared_count}` : undefined, icon: 'person', run: () => shareSheet(n) },
    { separator: true },
    open && !readOnly(n) && { title: list ? 'Omzetten naar tekst' : 'Omzetten naar lijst', icon: list ? 'pencil' : 'list', run: () => convert(n) },
    done && { title: 'Alles weer openzetten', icon: 'check', run: () => saveItems(itemsOf().map((i) => ({ ...i, done: false }))) },
    done && { title: 'Afgevinkte items wissen', icon: 'trash', run: () => saveItems(itemsOf().filter((i) => !i.done)) },
    { title: 'Kopie maken', icon: 'copy', run: () => duplicate(n) },
    { title: native?.share || matchMedia('(pointer: coarse)').matches ? 'Delen' : 'Tekst kopiëren', icon: 'share', run: () => shareNote(n) },
    { title: 'Eerdere versies', icon: 'history', run: () => versionsSheet(n) },
    { separator: true },
    { title: n.archived_at ? 'Terug naar notities' : 'Archiveren', icon: 'archive', run: () => archive(n, !n.archived_at) },
    other
      ? { title: 'Weghalen uit mijn notities', icon: 'trash', destructive: true, run: () => toTrash(n) }
      : { title: 'Naar prullenbak', icon: 'trash', destructive: true, run: () => toTrash(n) }
  ]);
}

function moreMenu(from) {
  const count = (fn) => [...state.notes.values()].filter(fn).length;
  const trash = count((n) => !n.purged && n.deleted_at);
  const arch = count((n) => alive(n) && n.archived_at);
  const shared = count((n) => alive(n) && (fromOther(n) || n.shared_count > 0));
  const amount = (k) => (k ? `${k} ${k === 1 ? 'notitie' : 'notities'}` : 'Leeg');
  menu(from, [
    { title: 'Dagnotitie van vandaag', icon: 'calendar', run: dayNote },
    { title: 'Nieuwe lijst', icon: 'list', run: () => newNote('lijst') },
    { separator: true },
    { title: 'Gedeeld', subtitle: amount(shared), icon: 'person', run: () => setView('gedeeld') },
    { title: 'Archief', subtitle: amount(arch), icon: 'archive', run: () => setView('archief') },
    { title: 'Prullenbak', subtitle: amount(trash), icon: 'trash', run: () => setView('prullenbak') },
    { title: 'Labels beheren', icon: 'tag', run: manageLabels },
    { separator: true },
    { title: 'Nu synchroniseren', subtitle: syncText(), icon: 'sync', run: () => { state.syncError = false; sync(); } },
    { title: native?.share ? 'Alles delen als tekst' : 'Alles exporteren', subtitle: 'Markdown', icon: 'download', run: exportAll },
    !isPhone() && { title: 'Sneltoetsen', icon: 'keyboard', run: shortcutsSheet },
    { title: 'Instellingen', subtitle: state.me.full_name, icon: 'person', run: openSettings },
    { title: 'Broncode', subtitle: 'GitHub', icon: 'code', run: () => window.open(SOURCE, '_blank', 'noopener') }
  ]);
}

function viewMenu(from) {
  menu(from, [
    { heading: true, title: 'Weergave' },
    { title: 'Kaarten', icon: 'grid', checked: state.layout === 'kaarten', run: () => setLayout('kaarten') },
    { title: 'Lijst', icon: 'rows', checked: state.layout === 'lijst', run: () => setLayout('lijst') },
    { heading: true, title: 'Sorteren' },
    { title: 'Laatst bewerkt', checked: state.sort === 'bewerkt', run: () => setSort('bewerkt') },
    { title: 'Laatst gemaakt', checked: state.sort === 'gemaakt', run: () => setSort('gemaakt') },
    { title: 'Titel (A–Z)', checked: state.sort === 'titel', run: () => setSort('titel') }
  ]);
}

function setLayout(v) { state.layout = v; store('notities:layout', v); renderList(); }
function setSort(v) { state.sort = v; store('notities:sort', v); renderList(); }

// Lang indrukken (telefoon) of rechtsklikken (laptop) op een notitie: snelle acties.
$('#list').addEventListener('contextmenu', (e) => {
  const item = e.target.closest('[data-id]');
  if (!item) return;
  e.preventDefault();
  haptic('long');
  noteMenu(item, state.notes.get(item.dataset.id));
});

// ---------- Paneel ----------

function openSheet(title, html) {
  closeMenu();
  $('#sheetTitle').textContent = title;
  const body = $('#sheetBody');
  body.onclick = body.onchange = body.onsubmit = null;
  body.innerHTML = html;
  body.scrollTop = 0;
  const wasOpen = !$('#sheetBack').hidden;
  $('#sheetBack').hidden = false;
  if (!wasOpen && isPhone()) history.pushState({ ...history.state, sheet: true }, '');
  syncGlassBar();
  return body;
}

function closeSheet(fromHistory = false) {
  if ($('#sheetBack').hidden) return;
  $('#sheetBack').hidden = true;
  syncGlassBar();
  if (!fromHistory && history.state?.sheet) history.back();
}

$('#sheetClose').addEventListener('click', () => closeSheet());
$('#sheetBack').addEventListener('click', (e) => { if (e.target.id === 'sheetBack') closeSheet(); });

// ---------- Instellingen ----------

function theme(p) {
  try { localStorage.setItem('theme', p); } catch (e) {}
  const dark = p === 'donker' || (p === 'systeem' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'donker' : 'licht';
  try { native?.setDark(dark); } catch (e) {}
  $$('#themeSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === p)));
  syncGlassBar();
}

function themePref() {
  try { return localStorage.getItem('theme') || 'systeem'; } catch (e) { return 'systeem'; }
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => theme(themePref()));

function openSettings() {
  const body = openSheet('Instellingen', $('#settingsTpl').innerHTML);
  $('#meUser', body).textContent = `Ingelogd als ${state.me.username}`;
  $('#meName', body).value = state.me.full_name;
  $('#meEmail', body).value = state.me.email;
  theme(themePref());

  const notes = [...state.notes.values()].filter(alive);
  const words = notes.reduce((s, n) => s + (n.body.replace(/\[[ x]\]/g, '').match(/\S+/g) || []).length + (n.title.match(/\S+/g) || []).length, 0);
  const ticked = notes.filter((n) => n.kind === 'lijst').flatMap((n) => parseItems(n.body)).filter((i) => i.done).length;
  $('#stats', body).innerHTML = `<h3>Jouw notities</h3>
    <div class="stat"><b>${notes.length}</b><span>notities</span></div>
    <div class="stat"><b>${words.toLocaleString('nl-NL')}</b><span>woorden</span></div>
    <div class="stat"><b>${ticked}</b><span>afgevinkt</span></div>
    <div class="stat"><b>${allLabels().length}</b><span>labels</span></div>`;

  if (native?.appVersion) {
    $('#appGroup', body).hidden = false;
    $('#appVersion', body).textContent = `Versie ${native.appVersion()} · nieuwe versies worden vanzelf geïnstalleerd`;
  }
  $('#adminGroup', body).hidden = !state.me.is_admin;
  if (state.me.is_admin) loadUsers();

  body.onclick = (e) => {
    const seg = e.target.closest('#themeSeg button[data-v]');
    if (seg) theme(seg.dataset.v);
    if (e.target.id === 'updateBtn') native?.checkForUpdate?.();
    if (e.target.id === 'logoutBtn') logout(e.target);
  };
  body.onsubmit = async (e) => {
    e.preventDefault();
    if (e.target.id === 'meForm') {
      try {
        await api('me', { method: 'PATCH', body: { full_name: $('#meName').value, email: $('#meEmail').value } });
        state.me.full_name = $('#meName').value.trim();
        state.me.email = $('#meEmail').value.trim().toLowerCase();
        store('notities:me', state.me);
        showError('#meError', null);
        toast('Opgeslagen');
      } catch (err) { showError('#meError', err); }
    }
    if (e.target.id === 'pwForm') {
      try {
        await api('me/password', { method: 'POST', body: { current: $('#pwCur').value, password: $('#pwNew').value } });
        e.target.reset();
        showError('#pwError', null);
        toast('Wachtwoord gewijzigd');
      } catch (err) { showError('#pwError', err); }
    }
  };
}

async function loadUsers() {
  const el = $('#adminList');
  try {
    const users = await api('admin/users');
    el.innerHTML = users.map((u) => `<div class="user" data-id="${u.id}">
        <div><b>${esc(u.full_name)}${u.status === 'pending' ? '<span class="pill wait">Wacht</span>' : u.status === 'disabled' ? '<span class="pill off">Uit</span>' : u.is_admin ? '<span class="pill">Beheerder</span>' : ''}</b>
        <span>${esc(u.username)} · ${esc(u.email)} · ${u.notes} notities</span></div>
        ${u.id === state.me.id ? '' : `<button class="icon-btn" data-user-menu type="button" aria-label="Acties voor ${esc(u.full_name)}">${icon('more')}</button>`}
      </div>`).join('');
    el.onclick = (e) => {
      const b = e.target.closest('[data-user-menu]');
      if (!b) return;
      e.stopPropagation();
      const u = users.find((x) => x.id === +b.closest('.user').dataset.id);
      const set = (status) => api(`admin/users/${u.id}`, { method: 'PATCH', body: { status } }).then(loadUsers).catch((err) => toast(err.message));
      menu(b, [
        u.status !== 'active' && { title: u.status === 'pending' ? 'Goedkeuren' : 'Weer inschakelen', icon: 'check', run: () => set('active') },
        u.status === 'active' && { title: 'Uitschakelen', icon: 'close', run: () => set('disabled') },
        { title: 'Nieuw wachtwoord maken', icon: 'pencil', run: async () => {
          try {
            const r = await api(`admin/users/${u.id}/reset-password`, { method: 'POST' });
            toast(`Nieuw wachtwoord voor ${u.username}: ${r.password}`, { label: 'Kopiëren', run: () => navigator.clipboard.writeText(r.password) });
          } catch (err) { toast(err.message); }
        } },
        { separator: true },
        { title: 'Account verwijderen', subtitle: 'Ook alle notities', icon: 'trash', destructive: true, run: async () => {
          if (b.dataset.armed) {
            await api(`admin/users/${u.id}`, { method: 'DELETE' }).catch((err) => toast(err.message));
            loadUsers();
          } else {
            b.dataset.armed = '1';
            toast('Kies nog een keer “Account verwijderen” om het echt te doen');
            setTimeout(() => delete b.dataset.armed, 6000);
          }
        } }
      ]);
    };
  } catch (err) {
    el.innerHTML = `<p class="muted small">${esc(err.status ? err.message : 'Gebruikers zijn alleen online te beheren.')}</p>`;
  }
}

function showError(id, err) {
  const el = $(id);
  if (!el) return;
  el.textContent = err ? err.message || err : '';
  el.hidden = !err;
}

async function logout(btn) {
  const waiting = [...state.notes.values()].some((n) => n.dirty);
  if (waiting && !btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = 'Niet alles is online opgeslagen. Toch uitloggen?';
    return;
  }
  try { await api('logout', { method: 'POST' }); } catch (e) {}
  store(storeKey(), undefined);
  try { native?.setReminders?.('[]'); } catch (e) {}
  signedOut();
}

// ---------- Inloggen ----------

function showAuth(which = 'login') {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#loginForm').hidden = which !== 'login';
  $('#registerForm').hidden = which !== 'register';
  $('#pendingCard').hidden = which !== 'pending';
  syncGlassBar();
}

function signedOut() {
  state.me = null;
  store('notities:me', undefined);
  closeSheet();
  showAuth('login');
}

$('#toRegister').addEventListener('click', (e) => { e.preventDefault(); showAuth('register'); });
$('#toLogin').addEventListener('click', (e) => { e.preventDefault(); showAuth('login'); });
$('#pendingBack').addEventListener('click', () => showAuth('login'));

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('login', { method: 'POST', body: { login: f.login.value, password: f.password.value, remember: true } });
    showError('#loginError', null);
    f.reset();
    await start();
  } catch (err) {
    showError('#loginError', err.status ? err : 'Geen verbinding. Inloggen kan alleen online.');
  }
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('register', {
      method: 'POST',
      body: { username: f.username.value, full_name: f.full_name.value, email: f.email.value, password: f.password.value }
    });
    showError('#registerError', null);
    f.reset();
    if (r.status === 'active') await start();
    else showAuth('pending');
  } catch (err) {
    showError('#registerError', err.status ? err : 'Geen verbinding. Probeer het opnieuw als je online bent.');
  }
});

// ---------- Opstarten ----------

async function start() {
  let me = null;
  try {
    me = await api('me');
    store('notities:me', me);
  } catch (err) {
    if (err.status === 401) return signedOut();
    me = load('notities:me'); // offline: verder met wat we nog weten
    state.online = false;
    if (!me) return showAuth('login');
  }
  const switched = !state.me || state.me.id !== me.id;
  state.me = me;
  if (switched) loadLocal();
  $('#auth').hidden = true;
  $('#app').hidden = false;
  emptyOldTrash();
  renderAll();
  scheduleReminders();
  sync();
  try { native?.ready?.(); } catch (e) {}
}

fillIcons();

$('#list').addEventListener('click', (e) => {
  const item = e.target.closest('[data-id]');
  if (item) openNote(item.dataset.id);
});
$('#banner').addEventListener('click', (e) => {
  if (e.target.id !== 'emptyTrash') return;
  if (!e.target.dataset.armed) {
    e.target.dataset.armed = '1';
    e.target.textContent = 'Zeker weten? Tik nog een keer';
    return;
  }
  for (const n of [...state.notes.values()]) if (n.deleted_at && !n.purged) purge(n, true);
  renderAll();
  toast('Prullenbak geleegd');
});
$('#chips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-label]');
  if (!c) return;
  haptic();
  state.label = c.dataset.label || null;
  renderAll();
});
$('#navPill').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nav]');
  if (b) navTo(b.dataset.nav, b);
});
$('#navAdd').addEventListener('click', () => newNote());
$('#emptyNew').addEventListener('click', () => newNote('tekst'));
$('#emptyList').addEventListener('click', () => newNote('lijst'));
$('#viewBtn').addEventListener('click', (e) => viewMenu(e.currentTarget));
$('#noteMenuBtn').addEventListener('click', () => noteMenu());
$('#pinBtn').addEventListener('click', () => togglePin());
$('#remindBtn').addEventListener('click', () => reminderSheet());
$('#backBtn').addEventListener('click', () => closeNote());
$('#edTags').addEventListener('click', (e) => {
  if (e.target.closest('[data-share]')) return fromOther(current()) ? null : shareSheet();
  if (e.target.closest('[data-tag]')) labelSheet();
});
$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });

window.addEventListener('popstate', () => {
  if (!history.state?.sheet) closeSheet(true);
  if (!history.state?.note && state.openId && isPhone()) closeNote(true);
});

// Terug-knop van Android: eerst menu/paneel/notitie sluiten, dan pas de app wegzetten.
window.notitiesBack = () => {
  if ($('.menu')) { closeMenu(); return true; }
  if (pdf) { closePdf(); return true; }
  if (!$('#sheetBack').hidden) { closeSheet(); return true; }
  if (state.openId && isPhone()) { closeNote(); return true; }
  if (state.query) { state.query = ''; $('#search').value = ''; renderList(); return true; }
  if (state.label) { state.label = null; renderAll(); return true; }
  if (state.view !== 'notities') { setView('notities'); return true; }
  return false;
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('.menu')) return closeMenu();
    if (!$('#sheetBack').hidden) return closeSheet();
    if (state.openId && !['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) return closeNote();
  }
  if (!state.me || $('#app').hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.altKey && e.code === 'KeyN') { e.preventDefault(); newNote('tekst'); }
  if (mod && e.altKey && e.code === 'KeyL') { e.preventDefault(); newNote('lijst'); }
  if (mod && e.altKey && e.code === 'KeyD') { e.preventDefault(); dayNote(); }
  if (mod && !e.altKey && e.code === 'KeyK') {
    e.preventDefault();
    if (isPhone() && state.openId) closeNote();
    $('#search').focus();
    $('#search').select();
  }
  if (mod && !e.altKey && e.code === 'KeyE' && current()?.kind === 'tekst') { e.preventDefault(); setReading(!state.reading.has(state.openId)); }
});

window.addEventListener('online', () => { state.online = true; sync(); });
window.addEventListener('offline', () => { state.online = false; setSyncState(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { sync(); checkReminders(); }
  else if (state.me) saveLocal(true);
});
window.addEventListener('pagehide', () => { if (state.me) saveLocal(true); });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 20000);
setInterval(checkReminders, 15000);
setInterval(() => { if (state.openId) { updateMeta(); updateRemindChip(); } }, 60000);
window.addEventListener('resize', () => { if (!edBody.hidden) grow(edBody); syncGlassBar(); });

if ('serviceWorker' in navigator && !native) navigator.serviceWorker.register('/sw.js').catch(() => {});

const cached = load('notities:me');
if (cached) { state.me = cached; loadLocal(); $('#app').hidden = false; renderAll(); } // meteen tonen, daarna controleren
theme(themePref());
try { native?.ready?.(); } catch (e) {} // bijv. een PDF die al klaarstaat
start();

// Notities: alles staat ook op het apparaat zelf (localStorage), zodat je offline kunt schrijven.
// Wijzigingen gaan op de achtergrond naar de server (/api/sync) en komen zo op je andere apparaten.

const $ = (s) => document.querySelector(s);
const native = window.NotitiesNative || null;
const TRASH_DAYS = 30;
const DAY = 86400000;

const state = {
  me: null,
  notes: new Map(),
  cursor: 0,
  openId: null,
  view: 'alles', // of 'prullenbak'
  query: '',
  online: navigator.onLine,
  syncing: false,
  again: false,
  syncError: false
};

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

function when(t, long = false) {
  const d = new Date(t);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  if (d >= today) return long ? `vandaag ${time}` : time;
  if (d >= today - DAY) return long ? `gisteren ${time}` : 'gisteren';
  const date = `${d.getDate()} ${MAANDEN[d.getMonth()]}${d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : ''}`;
  return long ? `${date} ${time}` : date;
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
  state.notes = new Map((data?.notes || []).map((n) => [n.id, n]));
  state.cursor = data?.cursor || 0;
}

// Elke wijziging: tijd bijwerken, als "nog niet verstuurd" markeren en straks synchroniseren.
function touch(note, fields) {
  Object.assign(note, fields, { updated_at: Date.now(), dirty: (note.dirty || 0) + 1 });
  state.notes.set(note.id, note);
  saveLocal();
  scheduleSync(1200);
}

// ---------- Synchronisatie ----------

let syncTimer;
function scheduleSync(ms = 0) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, ms);
}

function setSyncState() {
  const el = $('#syncState');
  const waiting = [...state.notes.values()].filter((n) => n.dirty).length;
  el.className = 'sync';
  if (!state.online) {
    el.classList.add('off');
    el.textContent = waiting ? `Offline · ${waiting} nog niet opgeslagen online` : 'Offline · alles staat op dit apparaat';
  } else if (state.syncError) {
    el.classList.add('err');
    el.textContent = 'Synchroniseren mislukt, nieuwe poging volgt';
  } else if (state.syncing || waiting) {
    el.classList.add('busy');
    el.textContent = 'Synchroniseren…';
  } else {
    el.textContent = 'Alles is gesynchroniseerd';
  }
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
    else state.notes.set(s.id, { ...s, dirty: 0 });
    if (s.id === state.openId) openChanged = true;
  }
  if (list.length) renderList();
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
    touch(n, { purged: true, title: '', body: '' });
  }
  if (!quiet) renderList();
}

// ---------- Lijst ----------

function visibleNotes() {
  const q = fold(state.query.trim());
  const trash = state.view === 'prullenbak';
  return [...state.notes.values()]
    .filter((n) => !n.purged && !!n.deleted_at === trash)
    .filter((n) => !q || fold(n.title + '\n' + n.body).includes(q))
    .sort((a, b) => (trash ? b.deleted_at - a.deleted_at : (b.pinned - a.pinned) || (b.updated_at - a.updated_at)));
}

function preview(n) {
  if (n.kind === 'lijst') {
    const items = parseItems(n.body).filter((i) => i.text.trim());
    const done = items.filter((i) => i.done).length;
    const open = items.filter((i) => !i.done).map((i) => i.text.trim());
    return items.length ? `${done}/${items.length} · ${open.join(', ') || 'alles afgevinkt'}` : 'Lege lijst';
  }
  const lines = n.body.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, 3).join(' · ') || 'Geen tekst';
}

function highlight(text, q) {
  if (!q) return esc(text);
  const i = fold(text).indexOf(fold(q));
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

function renderList() {
  const list = $('#list');
  const notes = visibleNotes();
  const q = state.query.trim();
  const trash = state.view === 'prullenbak';
  $('#listTitle').textContent = trash ? 'Prullenbak' : 'Notities';
  $('#trashBar').hidden = !trash;

  if (!notes.length) {
    list.innerHTML = `<div class="list-empty">${
      q ? `Niets gevonden voor “${esc(q)}”.` : trash ? 'De prullenbak is leeg.' : 'Nog geen notities. Maak je eerste notitie met de plusknop.'
    }</div>`;
    setSyncState();
    return;
  }

  let html = '';
  const pinned = !trash && notes.some((n) => n.pinned);
  notes.forEach((n, i) => {
    if (pinned && i === 0) html += '<div class="list-h">Vastgepind</div>';
    if (pinned && !n.pinned && notes[i - 1]?.pinned) html += '<div class="list-h">Overige</div>';
    const title = n.title.trim() || (n.kind === 'lijst' ? 'Lijst zonder titel' : 'Notitie zonder titel');
    let text = preview(n);
    if (q && !fold(n.title).includes(fold(q)) && fold(n.body).includes(fold(q))) {
      const at = fold(n.body).indexOf(fold(q));
      text = (at > 30 ? '…' : '') + n.body.slice(Math.max(0, at - 30), at + 90).replace(/\s+/g, ' ').replace(/\[[ x]\] /g, '');
    }
    html += `<button class="item${n.id === state.openId ? ' on' : ''}" data-id="${n.id}" role="listitem">
      <span class="item-t"><b>${highlight(title, q)}</b><time>${when(trash ? n.deleted_at : n.updated_at)}</time></span>
      <span class="item-p">${highlight(text, q)}${n.dirty ? '<i class="dirty-dot" title="Nog niet online opgeslagen"></i>' : ''}</span>
    </button>`;
  });
  list.innerHTML = html;
  setSyncState();
}

// ---------- Editor ----------

const editor = $('#editor');
const edTitle = $('#edTitle');
const edBody = $('#edBody');

function openNote(id, { push = true, focus = false } = {}) {
  const prev = state.openId;
  if (prev && prev !== id) dropIfEmpty(prev);
  state.openId = id;
  $('#app').classList.add('open');
  $('#emptyPane').hidden = true;
  editor.hidden = false;
  fillEditor();
  renderList();
  if (push && matchMedia('(max-width: 759px)').matches && history.state?.note !== id) {
    history[history.state?.note ? 'replaceState' : 'pushState']({ note: id }, '');
  }
  $('#edScroll').scrollTop = 0;
  if (focus) edTitle.focus();
}

function closeNote(fromHistory = false) {
  if (state.openId) dropIfEmpty(state.openId);
  state.openId = null;
  $('#app').classList.remove('open');
  editor.hidden = true;
  $('#emptyPane').hidden = false;
  renderList();
  if (!fromHistory && history.state?.note) history.back();
}

// Lege notitie verlaten? Dan hoeft hij niet te blijven bestaan.
function dropIfEmpty(id) {
  const n = state.notes.get(id);
  if (!n || n.deleted_at || n.title.trim() || n.body.replace(/\[[ x]\]/g, '').trim()) return;
  purge(n, true);
}

function newNote(kind = 'tekst') {
  if (state.view === 'prullenbak') setView('alles');
  const t = Date.now();
  const n = { id: newId(), title: '', body: '', kind, pinned: false, deleted_at: null, purged: false, created_at: t, updated_at: t, rev: 0, dirty: 0 };
  state.notes.set(n.id, n);
  state.query = '';
  $('#search').value = '';
  openNote(n.id, { focus: true });
  haptic();
}

function fillEditor(remote = false) {
  const n = state.notes.get(state.openId);
  if (!n) return;
  const trash = !!n.deleted_at;
  editor.classList.toggle('readonly', trash);
  $('#trashNote').hidden = !trash;
  edTitle.readOnly = trash;
  edBody.readOnly = trash;
  if (!(remote && document.activeElement === edTitle)) edTitle.value = n.title;
  $('#pinBtn').setAttribute('aria-pressed', String(!!n.pinned));
  $('#pinBtn').hidden = trash;
  $('#pinBtn').setAttribute('aria-label', n.pinned ? 'Losmaken' : 'Vastpinnen');
  updateMeta();

  const list = n.kind === 'lijst';
  edBody.hidden = list;
  $('#checklist').hidden = !list;
  if (list) renderChecklist(remote);
  else {
    if (!(remote && document.activeElement === edBody)) {
      const pos = edBody.selectionStart;
      edBody.value = n.body;
      if (remote && document.activeElement === edBody) edBody.setSelectionRange(pos, pos);
    }
    grow(edBody);
  }
}

function updateMeta() {
  const n = state.notes.get(state.openId);
  if (!n) return;
  const words = n.kind === 'lijst' ? `${parseItems(n.body).filter((i) => i.text.trim()).length} items` : `${(n.body.match(/\S+/g) || []).length} woorden`;
  $('#edMeta').textContent = `${n.updated_at === n.created_at ? 'Gemaakt' : 'Bewerkt'} ${when(n.updated_at, true)} · ${words}`;
}

function grow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

edTitle.addEventListener('input', () => {
  const n = state.notes.get(state.openId);
  if (!n) return;
  touch(n, { title: edTitle.value });
  updateMeta();
  renderListSoon();
});

edTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const n = state.notes.get(state.openId);
    if (n?.kind === 'lijst') {
      const first = $('#openItems textarea');
      if (first) first.focus(); else addItem(0);
    } else {
      edBody.focus();
      edBody.setSelectionRange(0, 0);
    }
  }
});

edBody.addEventListener('input', () => {
  const n = state.notes.get(state.openId);
  if (!n) return;
  touch(n, { body: edBody.value });
  grow(edBody);
  updateMeta();
  renderListSoon();
});

let listTimer;
function renderListSoon() {
  clearTimeout(listTimer);
  listTimer = setTimeout(renderList, 300);
}

// ---------- Checklist ----------

function renderChecklist(remote = false) {
  const n = state.notes.get(state.openId);
  const focused = document.activeElement?.closest?.('.ck');
  if (remote && focused) return; // niet onder iemands vingers verspringen
  const items = parseItems(n.body);
  const row = (it, i) => `<div class="ck${it.done ? ' done' : ''}" data-i="${i}">
      <input type="checkbox" ${it.done ? 'checked' : ''} aria-label="Afvinken">
      <textarea rows="1" enterkeyhint="next" aria-label="Item">${esc(it.text)}</textarea>
      <button class="del" type="button" aria-label="Item verwijderen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>`;
  $('#openItems').innerHTML = items.map((it, i) => (it.done ? '' : row(it, i))).join('');
  const done = items.map((it, i) => (it.done ? row(it, i) : '')).join('');
  $('#doneItems').innerHTML = done;
  const count = items.filter((i) => i.done).length;
  $('#doneWrap').hidden = !count;
  $('#doneSummary').textContent = `${count} afgevinkt`;
  document.querySelectorAll('.ck textarea').forEach(grow);
}

function itemsOf() {
  return parseItems(state.notes.get(state.openId).body);
}

function saveItems(items, rerender = true) {
  const n = state.notes.get(state.openId);
  touch(n, { body: joinItems(items) });
  updateMeta();
  renderListSoon();
  if (rerender) renderChecklist();
}

function focusItem(i, atEnd = true) {
  const ta = document.querySelector(`.ck[data-i="${i}"] textarea`);
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
  // Nieuw item komt na het laatste open item.
  let at = items.length;
  for (let i = items.length - 1; i >= 0; i--) if (!items[i].done) { at = i + 1; break; }
  if (!items.some((i) => !i.done)) at = 0;
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
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    items[i].text = before;
    items.splice(i + 1, 0, { done: false, text: after });
    saveItems(items);
    focusItem(i + 1, false);
  } else if (e.key === 'Backspace' && e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
    const items = itemsOf();
    const open = items.map((it, j) => j).filter((j) => items[j].done === items[i].done);
    const prev = open[open.indexOf(i) - 1];
    if (prev === undefined && e.target.value) return;
    e.preventDefault();
    const rest = items[i].text;
    if (prev !== undefined) {
      const len = items[prev].text.length;
      items[prev].text += rest;
      items.splice(i, 1);
      saveItems(items);
      const ta = document.querySelector(`.ck[data-i="${prev}"] textarea`);
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
});

$('#checklist').addEventListener('click', (e) => {
  const del = e.target.closest('.del');
  if (!del) return;
  const items = itemsOf();
  items.splice(+del.closest('.ck').dataset.i, 1);
  saveItems(items);
});

// ---------- Acties op een notitie ----------

function togglePin() {
  const n = state.notes.get(state.openId);
  touch(n, { pinned: !n.pinned });
  haptic('confirm');
  fillEditor();
  renderList();
  toast(n.pinned ? 'Vastgepind' : 'Losgemaakt');
}

function toTrash() {
  const n = state.notes.get(state.openId);
  if (!n) return;
  if (!n.title.trim() && !n.body.trim()) {
    closeNote();
    return;
  }
  touch(n, { deleted_at: Date.now(), pinned: false });
  haptic('reject');
  closeNote();
  toast('Naar de prullenbak', {
    label: 'Ongedaan maken',
    run: () => { touch(n, { deleted_at: null }); openNote(n.id); }
  });
}

function restore() {
  const n = state.notes.get(state.openId);
  touch(n, { deleted_at: null });
  setView('alles');
  openNote(n.id);
  toast('Teruggezet');
}

let purgeArmed = 0;
function purgeOpen() {
  // Twee keer tikken om definitief te verwijderen (geen pop-upvenster nodig).
  const btn = $('#purgeBtn');
  if (Date.now() - purgeArmed > 4000) {
    purgeArmed = Date.now();
    btn.textContent = 'Nog een keer tikken om te verwijderen';
    setTimeout(() => { btn.textContent = 'Definitief verwijderen'; }, 4000);
    return;
  }
  purgeArmed = 0;
  btn.textContent = 'Definitief verwijderen';
  const n = state.notes.get(state.openId);
  closeNote();
  purge(n);
  toast('Definitief verwijderd');
}

function convert() {
  const n = state.notes.get(state.openId);
  if (n.kind === 'tekst') {
    const lines = n.body.split('\n').filter((l) => l.trim()).map((l) => ({ done: false, text: l.replace(/^\s*([-*•]|\d+[.)])\s+/, '') }));
    touch(n, { kind: 'lijst', body: joinItems(lines) });
  } else {
    touch(n, { kind: 'tekst', body: parseItems(n.body).map((i) => i.text).join('\n') });
  }
  fillEditor();
  renderList();
}

function duplicate() {
  const n = state.notes.get(state.openId);
  const t = Date.now();
  const copy = { ...n, id: newId(), title: n.title ? `${n.title} (kopie)` : '', pinned: false, created_at: t, rev: 0, dirty: 0 };
  touch(copy, {});
  openNote(copy.id);
  toast('Kopie gemaakt');
}

async function copyText() {
  const n = state.notes.get(state.openId);
  const body = n.kind === 'lijst' ? parseItems(n.body).map((i) => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n') : n.body;
  const text = [n.title, body].filter(Boolean).join('\n\n');
  try {
    if (native?.share) native.share(n.title || 'Notitie', text);
    else if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: n.title, text });
    else { await navigator.clipboard.writeText(text); toast('Gekopieerd'); }
  } catch (e) { /* geannuleerd */ }
}

function uncheckAll() {
  const items = itemsOf().map((i) => ({ ...i, done: false }));
  saveItems(items);
}

function removeChecked() {
  saveItems(itemsOf().filter((i) => !i.done));
}

// ---------- Menu's ----------
// In de Android-app (13+) toont de app zelf een glazen menu; op de website een gewoon plat menu.
// rows: { id, title, subtitle, icon, destructive, separator, run }

const ICONS = {
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  share: '<path d="M12 4v11M8 8l4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  check: '<path d="M4.5 12.8 9.8 18.5 19.5 5.5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>'
};

let menuPicks = new Map();
window.notitiesGlassPick = (id) => menuPicks.get(id)?.();

function menu(from, rows) {
  rows = rows.map((r, i) => ({ ...r, id: r.id || String(i) }));
  menuPicks = new Map(rows.filter((r) => r.run).map((r) => [r.id, r.run]));
  haptic();
  const box = from.getBoundingClientRect();
  if (native?.glassMenu) {
    try {
      const dark = document.documentElement.dataset.theme === 'donker';
      const items = rows.map(({ run, ...r }) => r);
      if (native.glassMenu(JSON.stringify({ x: box.left, y: box.top, w: box.width, h: box.height, dark, items }))) return;
    } catch (e) { /* dan het gewone menu */ }
  }
  closeMenu();
  const back = document.createElement('div');
  back.className = 'menu-back';
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = rows.map((r) => (r.separator ? '<hr>' : `<button role="menuitem" data-id="${esc(r.id)}" class="${r.destructive ? 'destructive' : ''}">
      ${r.icon && ICONS[r.icon] ? `<svg viewBox="0 0 24 24">${ICONS[r.icon]}</svg>` : ''}
      <span>${esc(r.title)}${r.subtitle ? `<small>${esc(r.subtitle)}</small>` : ''}</span></button>`)).join('');
  document.body.append(back, el);
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(box.right - w, innerWidth - w - 12);
  left = Math.max(12, left);
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
  document.querySelectorAll('.menu, .menu-back').forEach((e) => e.remove());
}

function noteMenu() {
  const n = state.notes.get(state.openId);
  if (!n) return;
  if (n.deleted_at) return menu($('#noteMenuBtn'), [
    { title: 'Terugzetten', icon: 'folder', run: restore },
    { title: 'Definitief verwijderen', icon: 'trash', destructive: true, run: () => { purgeArmed = Date.now(); purgeOpen(); } }
  ]);
  const list = n.kind === 'lijst';
  const done = list && parseItems(n.body).some((i) => i.done);
  menu($('#noteMenuBtn'), [
    { title: list ? 'Omzetten naar tekst' : 'Omzetten naar lijst', icon: list ? 'pencil' : 'list', run: convert },
    ...(done ? [
      { title: 'Alles weer openzetten', icon: 'check', run: uncheckAll },
      { title: 'Afgevinkte items wissen', icon: 'trash', run: removeChecked }
    ] : []),
    { title: 'Kopie maken', icon: 'copy', run: duplicate },
    { title: native?.share || matchMedia('(pointer: coarse)').matches ? 'Delen' : 'Tekst kopiëren', icon: 'share', run: copyText },
    { separator: true },
    { title: 'Naar prullenbak', icon: 'trash', destructive: true, run: toTrash }
  ]);
}

function mainMenu(from) {
  const trash = [...state.notes.values()].filter((n) => n.deleted_at && !n.purged).length;
  menu(from, [
    { title: 'Nieuwe lijst', icon: 'list', run: () => newNote('lijst') },
    state.view === 'prullenbak'
      ? { title: 'Terug naar notities', icon: 'folder', run: () => setView('alles') }
      : { title: 'Prullenbak', subtitle: trash ? `${trash} ${trash === 1 ? 'notitie' : 'notities'}` : 'Leeg', icon: 'trash', run: () => setView('prullenbak') },
    { separator: true },
    { title: 'Instellingen', subtitle: state.me.full_name, icon: 'person', run: openSettings }
  ]);
}

function setView(v) {
  state.view = v;
  if (state.openId) closeNote();
  renderList();
}

// ---------- Instellingen ----------

function theme(pref) {
  try { localStorage.setItem('theme', pref); } catch (e) {}
  const dark = pref === 'donker' || (pref === 'systeem' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'donker' : 'licht';
  try { native?.setDark(dark); } catch (e) {}
  document.querySelectorAll('#themeSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === pref)));
}

function themePref() {
  try { return localStorage.getItem('theme') || 'systeem'; } catch (e) { return 'systeem'; }
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => theme(themePref()));

function openSettings() {
  $('#settingsBack').hidden = false;
  $('#meUser').textContent = `Ingelogd als ${state.me.username}`;
  $('#meName').value = state.me.full_name;
  $('#meEmail').value = state.me.email;
  theme(themePref());
  if (native?.appVersion) {
    $('#appGroup').hidden = false;
    $('#appVersion').textContent = `Versie ${native.appVersion()}`;
  }
  $('#adminGroup').hidden = !state.me.is_admin;
  if (state.me.is_admin) loadUsers();
  if (matchMedia('(max-width: 759px)').matches) history.pushState({ ...history.state, settings: true }, '');
}

function closeSettings(fromHistory = false) {
  if ($('#settingsBack').hidden) return;
  $('#settingsBack').hidden = true;
  if (!fromHistory && history.state?.settings) history.back();
}

async function loadUsers() {
  const el = $('#adminList');
  try {
    const users = await api('admin/users');
    el.innerHTML = users.map((u) => `<div class="user" data-id="${u.id}">
        <div><b>${esc(u.full_name)}${u.status === 'pending' ? '<span class="pill wait">Wacht</span>' : u.status === 'disabled' ? '<span class="pill off">Uit</span>' : u.is_admin ? '<span class="pill">Beheerder</span>' : ''}</b>
        <span>${esc(u.username)} · ${esc(u.email)} · ${u.notes} notities</span></div>
        ${u.id === state.me.id ? '' : `<button class="icon-btn" data-user-menu type="button" aria-label="Acties voor ${esc(u.full_name)}"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></button>`}
      </div>`).join('');
    el.onclick = (e) => {
      const b = e.target.closest('[data-user-menu]');
      if (!b) return;
      const u = users.find((x) => x.id === +b.closest('.user').dataset.id);
      const set = (status) => api(`admin/users/${u.id}`, { method: 'PATCH', body: { status } }).then(loadUsers).catch((err) => toast(err.message));
      menu(b, [
        ...(u.status !== 'active' ? [{ title: u.status === 'pending' ? 'Goedkeuren' : 'Weer inschakelen', icon: 'check', run: () => set('active') }] : []),
        ...(u.status === 'active' ? [{ title: 'Uitschakelen', icon: 'clock', run: () => set('disabled') }] : []),
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
    el.innerHTML = `<p class="muted small">${esc(err.message)}</p>`;
  }
}

function showError(id, err) {
  const el = $(id);
  el.textContent = err ? err.message || err : '';
  el.hidden = !err;
}

$('#meForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('me', { method: 'PATCH', body: { full_name: $('#meName').value, email: $('#meEmail').value } });
    state.me.full_name = $('#meName').value.trim();
    state.me.email = $('#meEmail').value.trim().toLowerCase();
    store('notities:me', state.me);
    showError('#meError', null);
    toast('Opgeslagen');
  } catch (err) { showError('#meError', err); }
});

$('#pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('me/password', { method: 'POST', body: { current: $('#pwCur').value, password: $('#pwNew').value } });
    $('#pwForm').reset();
    showError('#pwError', null);
    toast('Wachtwoord gewijzigd');
  } catch (err) { showError('#pwError', err); }
});

$('#themeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-v]');
  if (b) theme(b.dataset.v);
});

$('#logoutBtn').addEventListener('click', async () => {
  const waiting = [...state.notes.values()].some((n) => n.dirty);
  if (waiting && !$('#logoutBtn').dataset.armed) {
    $('#logoutBtn').dataset.armed = '1';
    $('#logoutBtn').textContent = 'Niet alles is online opgeslagen. Toch uitloggen?';
    return;
  }
  try { await api('logout', { method: 'POST' }); } catch (e) {}
  store(storeKey(), undefined);
  signedOut();
});

$('#settingsClose').addEventListener('click', () => closeSettings());
$('#settingsBack').addEventListener('click', (e) => { if (e.target.id === 'settingsBack') closeSettings(); });
$('#updateBtn').addEventListener('click', () => native?.checkForUpdate?.());

// ---------- Inloggen ----------

function showAuth(which = 'login') {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#loginForm').hidden = which !== 'login';
  $('#registerForm').hidden = which !== 'register';
  $('#pendingCard').hidden = which !== 'pending';
}

function signedOut() {
  state.me = null;
  store('notities:me', undefined);
  closeSettings();
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
  state.me = me;
  loadLocal();
  $('#auth').hidden = true;
  $('#app').hidden = false;
  emptyOldTrash();
  renderList();
  setSyncState();
  sync();
}

$('#list').addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (item) openNote(item.dataset.id);
});
$('#newBtn').addEventListener('click', () => newNote());
$('#fab').addEventListener('click', () => newNote());
$('#emptyNew').addEventListener('click', () => newNote());
$('#moreBtn').addEventListener('click', (e) => mainMenu(e.currentTarget));
$('#noteMenuBtn').addEventListener('click', noteMenu);
$('#pinBtn').addEventListener('click', togglePin);
$('#backBtn').addEventListener('click', () => closeNote());
$('#restoreBtn').addEventListener('click', restore);
$('#purgeBtn').addEventListener('click', purgeOpen);
$('#trashBack').addEventListener('click', () => setView('alles'));
$('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); });

window.addEventListener('popstate', () => {
  if (!history.state?.settings) closeSettings(true);
  if (!history.state?.note && state.openId && matchMedia('(max-width: 759px)').matches) closeNote(true);
});

// Terug-knop van Android: eerst menu/instellingen/notitie sluiten, dan pas de app wegzetten.
window.notitiesBack = () => {
  if (document.querySelector('.menu')) { closeMenu(); return true; }
  if (!$('#settingsBack').hidden) { closeSettings(); return true; }
  if (state.openId && matchMedia('(max-width: 759px)').matches) { closeNote(); return true; }
  if (state.view === 'prullenbak') { setView('alles'); return true; }
  if (state.query) { state.query = ''; $('#search').value = ''; renderList(); return true; }
  return false;
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('.menu')) return closeMenu();
    if (!$('#settingsBack').hidden) return closeSettings();
  }
  if (!state.me) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.altKey && e.code === 'KeyN') { e.preventDefault(); newNote(); }
  if (mod && e.code === 'KeyK') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
});

window.addEventListener('online', () => { state.online = true; sync(); });
window.addEventListener('offline', () => { state.online = false; setSyncState(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sync();
  else if (state.me) saveLocal(true);
});
window.addEventListener('pagehide', () => { if (state.me) saveLocal(true); });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 20000);
setInterval(() => { if (state.openId) updateMeta(); }, 60000);
window.addEventListener('resize', () => { if (!edBody.hidden) grow(edBody); });

if ('serviceWorker' in navigator && !native) navigator.serviceWorker.register('/sw.js').catch(() => {});

const cached = load('notities:me');
if (cached) { state.me = cached; loadLocal(); $('#app').hidden = false; renderList(); } // meteen tonen, daarna controleren
theme(themePref());
start();

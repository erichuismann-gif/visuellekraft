'use strict';

/* =========================================================
   Ylvis Klo-Plan
   Alle Daten (inkl. Fotos) liegen lokal im Browser (IndexedDB).
   ========================================================= */

const TYPES = {
  pipi:   { label: 'Pipi',   icon: '💧' },
  kacka:  { label: 'Kacka',  icon: '💩' },
  beides: { label: 'Beides', icon: '💧💩' },
};
const PHOTO_MAX_SIDE = 1600;   // Fotos werden verkleinert, damit der Speicher reicht
const PHOTO_QUALITY = 0.82;

/* ---------- Datenbank ---------- */
const db = (() => {
  let dbPromise;
  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('ylvi-klo', 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore('entries', { keyPath: 'id' });
          store.createIndex('time', 'time');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  async function tx(mode, fn) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction('entries', mode);
      const result = fn(t.objectStore('entries'));
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  return {
    all: () => tx('readonly', (s) => s.getAll()),
    put: (entry) => tx('readwrite', (s) => s.put(entry)),
    remove: (id) => tx('readwrite', (s) => s.delete(id)),
  };
})();

/* ---------- Hilfsfunktionen ---------- */
const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(str) {
  const [date, time] = str.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min);
}
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Montag = 0
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const fmtTime = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDayLong = (d) => d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDayShort = (d) => d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

function dayTitle(d) {
  const today = startOfDay(new Date());
  const diff = Math.round((today - startOfDay(d)) / 86400000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  return fmtDayLong(d);
}

function ago(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.${min % 60 ? ` ${min % 60} Min.` : ''}`;
  const days = Math.floor(h / 24);
  return `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

function countTypes(list) {
  const c = { pipi: 0, kacka: 0 };
  for (const e of list) {
    if (e.type === 'pipi' || e.type === 'beides') c.pipi++;
    if (e.type === 'kacka' || e.type === 'beides') c.kacka++;
  }
  return c;
}

/* ---------- Fotos ---------- */
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
      i.src = url;
    });
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', PHOTO_QUALITY));
    return blob || file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Objekt-URLs für Fotos zwischenspeichern und beim Neuzeichnen aufräumen
const photoUrls = new Map();
function photoUrl(entry) {
  if (!entry.photo) return null;
  let u = photoUrls.get(entry.id);
  if (!u || u.blob !== entry.photo) {
    if (u) URL.revokeObjectURL(u.url);
    u = { blob: entry.photo, url: URL.createObjectURL(entry.photo) };
    photoUrls.set(entry.id, u);
  }
  return u.url;
}
function cleanupPhotoUrls() {
  const ids = new Set(state.entries.map((e) => e.id));
  for (const [id, u] of photoUrls) {
    if (!ids.has(id)) { URL.revokeObjectURL(u.url); photoUrls.delete(id); }
  }
}

/* ---------- Zustand ---------- */
const state = {
  entries: [],
  view: 'list',
  weekStart: startOfWeek(new Date()),
};

async function load() {
  state.entries = (await db.all()).sort((a, b) => b.time - a.time);
  cleanupPhotoUrls();
  render();
}

/* ---------- Darstellung ---------- */
function render() {
  renderStatus();
  if (state.view === 'list') renderList(); else renderWeek();
}

function renderStatus() {
  const last = state.entries[0];
  const now = Date.now();
  if (!last) { $('#status').textContent = 'Noch keine Einträge'; return; }
  const lastKacka = state.entries.find((e) => e.type !== 'pipi' && e.time <= now);
  let txt = `Zuletzt ${TYPES[last.type].icon} ${ago(now - last.time)}`;
  if (lastKacka && lastKacka !== last) txt += ` · 💩 ${ago(now - lastKacka.time)}`;
  $('#status').textContent = txt;
}

function renderList() {
  const todayStart = startOfDay(new Date()).getTime();
  const todays = state.entries.filter((e) => e.time >= todayStart && e.time < todayStart + 86400000);
  const c = countTypes(todays);
  const withPhoto = state.entries.filter((e) => e.photo).length;
  $('#todaySummary').innerHTML = `
    <div class="stat"><b>${c.pipi}</b><span>💧 Pipi heute</span></div>
    <div class="stat"><b>${c.kacka}</b><span>💩 Kacka heute</span></div>
    <div class="stat"><b>${withPhoto}</b><span>📷 Beweisfotos</span></div>`;

  const list = $('#list');
  if (!state.entries.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">🐱</div>
      <p>Noch nichts eingetragen.<br>Tippe unten auf <b>＋ Eintrag</b>, wenn Ylvi auf dem Klo war.</p></div>`;
    return;
  }

  const groups = new Map();
  for (const e of state.entries) {
    const k = dayKey(new Date(e.time));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  let html = '';
  for (const items of groups.values()) {
    const d = new Date(items[0].time);
    const gc = countTypes(items);
    html += `<div class="day-head"><span>${esc(dayTitle(d))}</span><span>💧 ${gc.pipi} · 💩 ${gc.kacka}</span></div>`;
    for (const e of items) {
      const url = photoUrl(e);
      const t = TYPES[e.type];
      const thumb = url
        ? `<img class="thumb" src="${url}" alt="Beweisfoto" data-photo="${e.id}">`
        : `<span class="thumb empty">kein<br>Foto</span>`;
      html += `
        <div class="entry" role="button" tabindex="0" data-edit="${e.id}">
          ${thumb}
          <div class="entry-main">
            <div class="entry-time">${fmtTime(new Date(e.time))}<span class="badge ${e.type}">${t.icon} ${t.label}</span></div>
            <div class="entry-note">${e.note ? esc(e.note) : '&nbsp;'}</div>
          </div>
        </div>`;
    }
  }
  list.innerHTML = html;
}

function renderWeek() {
  const start = state.weekStart;
  const end = addDays(start, 7);
  $('#weekLabel').textContent =
    `${start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ` +
    `${addDays(end, -1).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

  const todayKey = dayKey(new Date());
  let html = '';
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const from = day.getTime();
    const to = addDays(day, 1).getTime();
    const items = state.entries.filter((e) => e.time >= from && e.time < to).sort((a, b) => a.time - b.time);
    const c = countTypes(items);
    const dots = items.map((e) => {
      const d = new Date(e.time);
      const pct = ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100;
      return `<button class="${e.type}" style="left:${pct.toFixed(2)}%" data-edit="${e.id}"
        title="${fmtTime(d)} ${TYPES[e.type].label}" aria-label="${fmtTime(d)} ${TYPES[e.type].label}"></button>`;
    }).join('');
    const chips = items.map((e) =>
      `<button class="chip" data-edit="${e.id}">${TYPES[e.type].icon} ${fmtTime(new Date(e.time))}${e.photo ? ' 📷' : ''}</button>`
    ).join('');
    html += `
      <div class="wday${dayKey(day) === todayKey ? ' is-today' : ''}">
        <div class="wday-head">
          <strong>${esc(fmtDayShort(day))}</strong>
          <span class="wday-counts">${items.length ? `💧 ${c.pipi} · 💩 ${c.kacka}` : '–'}</span>
        </div>
        <div class="timeline">${dots}</div>
        <div class="timeline-scale"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 Uhr</span></div>
        ${chips ? `<div class="wday-times">${chips}</div>` : ''}
      </div>`;
  }
  $('#week').innerHTML = html;
}

/* ---------- Formular ---------- */
const form = $('#entryForm');
const dlg = $('#entryDialog');
let editing = null;      // Eintrag, der gerade bearbeitet wird (oder null = neu)
let pendingPhoto;        // undefined = unverändert, null = entfernt, Blob = neu
let previewUrl = null;

function setPreview(blob) {
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  const img = $('#photoPreview');
  if (blob) {
    previewUrl = URL.createObjectURL(blob);
    img.src = previewUrl;
    img.hidden = false;
  } else {
    img.removeAttribute('src');
    img.hidden = true;
  }
  $('#removePhoto').hidden = !blob;
}

function openForm(entry = null) {
  editing = entry;
  pendingPhoto = undefined;
  form.reset();
  $('#formTitle').textContent = entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag';
  $('#deleteBtn').hidden = !entry;
  form.time.value = toLocalInput(entry ? new Date(entry.time) : new Date());
  form.type.value = entry ? entry.type : 'pipi';
  form.note.value = entry?.note || '';
  setPreview(entry?.photo || null);
  dlg.showModal();
}

function closeForm() {
  dlg.close();
  setPreview(null);
  editing = null;
}

async function handlePhotoInput(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    pendingPhoto = await compressImage(file);
    setPreview(pendingPhoto);
  } catch (err) {
    toast(err.message);
  }
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!form.time.value) return;
  const photo = pendingPhoto === undefined ? (editing?.photo || null) : pendingPhoto;
  const entry = {
    id: editing ? editing.id : uid(),
    created: editing ? editing.created : Date.now(),
    time: fromLocalInput(form.time.value).getTime(),
    type: form.type.value,
    note: form.note.value.trim(),
    photo,
  };
  try {
    await db.put(entry);
  } catch (err) {
    toast('Speichern fehlgeschlagen: ' + (err?.message || err));
    return;
  }
  const wasNew = !editing;
  closeForm();
  toast(wasNew ? (photo ? 'Eintrag mit Beweisfoto gespeichert ✓' : 'Eintrag gespeichert ✓') : 'Änderungen gespeichert ✓');
  await load();
});

$('#cameraInput').addEventListener('change', handlePhotoInput);
$('#galleryInput').addEventListener('change', handlePhotoInput);
$('#removePhoto').addEventListener('click', () => { pendingPhoto = null; setPreview(null); });
$('#cancelBtn').addEventListener('click', closeForm);
dlg.addEventListener('cancel', () => setPreview(null));
$('#deleteBtn').addEventListener('click', async () => {
  if (!editing || !confirm('Diesen Eintrag wirklich löschen?')) return;
  await db.remove(editing.id);
  closeForm();
  toast('Eintrag gelöscht');
  await load();
});

/* ---------- Foto groß ---------- */
function showPhoto(entry) {
  $('#photoLarge').src = photoUrl(entry);
  const d = new Date(entry.time);
  $('#photoCaption').textContent = `${TYPES[entry.type].icon} ${TYPES[entry.type].label} · ${fmtDayLong(d)}, ${fmtTime(d)} Uhr`;
  $('#photoDialog').showModal();
}
$('#photoDialog').addEventListener('click', (e) => { if (e.target === $('#photoDialog')) $('#photoDialog').close(); });

/* ---------- Klicks in Liste & Wochenplan ---------- */
function findEntry(id) { return state.entries.find((e) => e.id === id); }

document.addEventListener('click', (ev) => {
  const photoEl = ev.target.closest('[data-photo]');
  if (photoEl) { const e = findEntry(photoEl.dataset.photo); if (e) showPhoto(e); return; }
  const editEl = ev.target.closest('[data-edit]');
  if (editEl) { const e = findEntry(editEl.dataset.edit); if (e) openForm(e); }
});
document.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('.entry[data-edit]')) {
    ev.preventDefault();
    const e = findEntry(ev.target.dataset.edit);
    if (e) openForm(e);
  }
});

$('#addBtn').addEventListener('click', () => openForm());

/* ---------- Tabs & Woche ---------- */
document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    state.view = b.dataset.view;
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    $('#view-list').hidden = state.view !== 'list';
    $('#view-week').hidden = state.view !== 'week';
    render();
  });
});
$('#prevWeek').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, -7); renderWeek(); });
$('#nextWeek').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, 7); renderWeek(); });

/* ---------- Menü: Backup ---------- */
const menu = $('#menu');
$('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
async function dataUrlToBlob(url) { return (await fetch(url)).blob(); }

async function exportBackup() {
  const entries = await Promise.all(state.entries.map(async (e) => ({
    ...e,
    photo: e.photo ? await blobToDataUrl(e.photo) : null,
  })));
  const data = JSON.stringify({ app: 'ylvi-klo', version: 1, exported: new Date().toISOString(), entries });
  const blob = new Blob([data], { type: 'application/json' });
  const name = `ylvi-klo-backup-${dayKey(new Date())}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Ylvis Klo-Plan Backup' }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'ylvi-klo' || !Array.isArray(data.entries)) throw new Error('Keine gültige Backup-Datei');
    let n = 0;
    for (const e of data.entries) {
      if (!e.id || !TYPES[e.type] || typeof e.time !== 'number') continue;
      await db.put({
        id: e.id, created: e.created || e.time, time: e.time, type: e.type,
        note: e.note || '',
        photo: e.photo ? await dataUrlToBlob(e.photo) : null,
      });
      n++;
    }
    toast(`${n} Einträge importiert ✓`);
    await load();
  } catch (err) {
    toast('Import fehlgeschlagen: ' + err.message);
  }
}

menu.addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  menu.hidden = true;
  if (action === 'export') exportBackup();
  if (action === 'import') $('#importFile').click();
});
$('#importFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) importBackup(f);
});

/* ---------- Start ---------- */
load().catch((err) => toast('Datenbank-Fehler: ' + err.message));
setInterval(renderStatus, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

// Browser bitten, die Daten nicht automatisch zu löschen
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

'use strict';

/* =========================================================
   Ylvis Klo-Plan – gemeinsame Version
   Einträge liegen in einer Supabase-Datenbank, Fotos im
   Supabase-Speicher. Alle angemeldeten Personen sehen dieselben Daten.
   ========================================================= */

const TYPES = {
  pipi:   { label: 'Pipi',   icon: '💧' },
  kacka:  { label: 'Kacka',  icon: '💩' },
  beides: { label: 'Beides', icon: '💧💩' },
};
const TABLE = 'entries';
const BUCKET = 'photos';
const PHOTO_MAX_SIDE = 1600;
const PHOTO_QUALITY = 0.82;
const SIGNED_URL_SECONDS = 60 * 60 * 6;

/* ---------- Hilfsfunktionen ---------- */
const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

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
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Montag
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const fmtTime = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDayLong = (d) => d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDayShort = (d) => d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

function dayTitle(d) {
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
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
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}
function showError(el, msg) { el.textContent = msg || ''; el.hidden = !msg; }
function notice(msg) { showError($('#notice'), msg); }
function countTypes(list) {
  const c = { pipi: 0, kacka: 0 };
  for (const e of list) {
    if (e.type !== 'kacka') c.pipi++;
    if (e.type !== 'pipi') c.kacka++;
  }
  return c;
}
function friendlyError(err) {
  const msg = (err && (err.message || err.error_description || String(err))) || '';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Keine Verbindung. Prüfe das Internet und versuche es erneut.';
  if (/Invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/Email not confirmed/i.test(msg)) return 'Die E-Mail-Adresse ist noch nicht bestätigt. Bestätige sie im Supabase-Dashboard.';
  if (/JWT|expired|not authenticated|row-level security|permission/i.test(msg)) return 'Keine Berechtigung. Melde dich ab und wieder an.';
  if (/Payload too large|exceeded the maximum/i.test(msg)) return 'Das Foto ist zu groß.';
  if (/Password should be/i.test(msg)) return 'Das Passwort ist zu kurz oder zu einfach.';
  return 'Das hat nicht geklappt: ' + msg;
}

function showScreen(name) {
  $('#setupScreen').hidden = name !== 'setup';
  $('#loginScreen').hidden = name !== 'login';
  $('#appScreen').hidden = name !== 'app';
  $('#menuBtn').hidden = name !== 'app';
  if (name !== 'app') $('#menu').hidden = true;
}

/* ---------- Lokaler Speicher (IndexedDB) ----------
   Wird genutzt, solange keine Datenbank eingerichtet ist. */
const localDb = (() => {
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
      const req = fn(t.objectStore('entries'));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  return {
    all: () => tx('readonly', (s) => s.getAll()),
    get: (id) => tx('readonly', (s) => s.get(id)),
    put: (rec) => tx('readwrite', (s) => s.put(rec)),
    remove: (id) => tx('readwrite', (s) => s.delete(id)),
  };
})();
const localPhotoUrls = new Map(); // 'local:<id>' -> Objekt-URL

/* ---------- Verbindung ---------- */
const cfg = window.YLVI_CONFIG || {};
let mode = 'cloud';  // 'local' = nur auf diesem Gerät, 'cloud' = gemeinsame Datenbank
let sb = null;
let me = null;       // angemeldete Person
let channel = null;

/* ---------- Zustand ---------- */
const state = {
  entries: [],
  loaded: false,
  view: 'list',
  weekStart: startOfWeek(new Date()),
};
const signedUrls = new Map(); // Foto-Pfad -> { url, expires }

function myName() {
  return (me && me.user_metadata && me.user_metadata.name) || (me && me.email ? me.email.split('@')[0] : '');
}

/* ---------- Daten laden ---------- */
let loading = null;
let reloadAgain = false;

async function loadEntries() {
  if (loading) { reloadAgain = true; return loading; }
  loading = (async () => {
    if (mode === 'local') {
      await loadLocalEntries();
      state.loaded = true;
      render();
      return;
    }
    const { data, error } = await sb
      .from(TABLE)
      .select('id,time,type,note,photo_path,author,created_at')
      .order('time', { ascending: false })
      .limit(5000);
    if (error) throw error;
    state.entries = (data || [])
      .filter((r) => TYPES[r.type])
      .map((r) => ({
        id: r.id,
        time: Date.parse(r.time),
        type: r.type,
        note: r.note || '',
        photo: r.photo_path || null,
        author: r.author || '',
      }));
    await refreshSignedUrls();
    state.loaded = true;
    notice('');
    render();
  })();
  try {
    await loading;
  } catch (err) {
    notice(friendlyError(err));
    state.loaded = true;
    render();
  } finally {
    loading = null;
    if (reloadAgain) { reloadAgain = false; loadEntries(); }
  }
}

async function loadLocalEntries() {
  const rows = await localDb.all();
  for (const u of localPhotoUrls.values()) URL.revokeObjectURL(u);
  localPhotoUrls.clear();
  state.entries = rows
    .filter((r) => TYPES[r.type] && typeof r.time === 'number')
    .sort((a, b) => b.time - a.time)
    .map((r) => {
      let photo = null;
      if (r.photo instanceof Blob) {
        photo = 'local:' + r.id;
        localPhotoUrls.set(photo, URL.createObjectURL(r.photo));
      }
      return { id: r.id, time: r.time, type: r.type, note: r.note || '', photo, author: '' };
    });
}

async function refreshSignedUrls() {
  const now = Date.now();
  const missing = [...new Set(state.entries.map((e) => e.photo).filter(Boolean))]
    .filter((p) => { const s = signedUrls.get(p); return !s || s.expires < now + 5 * 60 * 1000; });
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(chunk, SIGNED_URL_SECONDS);
    if (error) { console.warn('Foto-Links:', error); continue; }
    for (const item of data || []) {
      if (item.signedUrl) signedUrls.set(item.path, { url: item.signedUrl, expires: now + SIGNED_URL_SECONDS * 1000 });
    }
  }
}
function photoUrl(path) {
  if (!path) return null;
  if (path.startsWith('local:')) return localPhotoUrls.get(path) || null;
  return signedUrls.get(path)?.url || null;
}

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadEntries, 250);
}

function subscribeLive() {
  if (channel) return;
  channel = sb
    .channel('entries-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, scheduleReload)
    .subscribe();
}
function unsubscribeLive() {
  if (channel) { sb.removeChannel(channel); channel = null; }
}

/* ---------- Darstellung ---------- */
function render() {
  renderStatus();
  if (state.view === 'list') renderList(); else renderWeek();
}

function renderStatus() {
  const el = $('#status');
  if (!me && mode !== 'local') { el.textContent = 'Klo-Tagebuch für Ylvi'; return; }
  if (!state.loaded) { el.textContent = 'Einträge werden geladen…'; return; }
  const now = Date.now();
  const past = state.entries.filter((e) => e.time <= now);
  const last = past[0];
  if (!last) { el.textContent = 'Noch keine Einträge'; return; }
  const lastKacka = past.find((e) => e.type !== 'pipi');
  let txt = `Zuletzt ${TYPES[last.type].icon} ${ago(now - last.time)}`;
  if (lastKacka && lastKacka !== last) txt += ` · 💩 ${ago(now - lastKacka.time)}`;
  el.textContent = txt;
}

function renderList() {
  const t0 = startOfDay(new Date()).getTime();
  const todays = state.entries.filter((e) => e.time >= t0 && e.time < t0 + 86400000);
  const c = countTypes(todays);
  $('#todaySummary').innerHTML = `
    <div class="stat"><b>${c.pipi}</b><span>💧 Pipi heute</span></div>
    <div class="stat"><b>${c.kacka}</b><span>💩 Kacka heute</span></div>
    <div class="stat"><b>${state.entries.filter((e) => e.photo).length}</b><span>📷 Beweisfotos</span></div>`;

  const list = $('#list');
  if (!state.entries.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">🐱</div>
      <p>${state.loaded
        ? 'Noch nichts eingetragen.<br>Tippe unten auf <b>＋ Eintrag</b>, wenn Ylvi auf dem Klo war.'
        : 'Einträge werden geladen…'}</p></div>`;
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
    const gc = countTypes(items);
    html += `<div class="day-head"><span>${esc(dayTitle(new Date(items[0].time)))}</span><span>💧 ${gc.pipi} · 💩 ${gc.kacka}</span></div>`;
    for (const e of items) {
      const t = TYPES[e.type];
      const url = photoUrl(e.photo);
      const thumb = url
        ? `<img class="thumb" src="${esc(url)}" alt="Beweisfoto" loading="lazy" data-photo="${esc(e.id)}">`
        : e.photo
          ? `<span class="thumb empty">Foto<br>lädt…</span>`
          : `<span class="thumb empty">kein<br>Foto</span>`;
      html += `
        <div class="entry" role="button" tabindex="0" data-edit="${esc(e.id)}">
          ${thumb}
          <div class="entry-main">
            <div class="entry-time">${fmtTime(new Date(e.time))}<span class="badge ${e.type}">${t.icon} ${t.label}</span>${e.author ? `<span class="author">${esc(e.author)}</span>` : ''}</div>
            <div class="entry-note">${e.note ? esc(e.note) : '&nbsp;'}</div>
          </div>
        </div>`;
    }
  }
  list.innerHTML = html;
}

function renderWeek() {
  const start = state.weekStart;
  $('#weekLabel').textContent =
    `${start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ` +
    `${addDays(start, 6).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
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
      const lbl = `${fmtTime(d)} ${TYPES[e.type].label}`;
      return `<button class="${e.type}" style="left:${pct.toFixed(2)}%" data-edit="${esc(e.id)}" title="${lbl}" aria-label="${lbl}"></button>`;
    }).join('');
    const chips = items.map((e) =>
      `<button class="chip" data-edit="${esc(e.id)}">${TYPES[e.type].icon} ${fmtTime(new Date(e.time))}${e.photo ? ' 📷' : ''}</button>`
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

/* ---------- Fotos ---------- */
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden. Bitte ein anderes Foto wählen.'));
      i.src = url;
    });
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', PHOTO_QUALITY));
    if (!blob) throw new Error('Das Foto konnte nicht verarbeitet werden.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- Formular ---------- */
const form = $('#entryForm');
const dlg = $('#entryDialog');
let editing = null;   // Eintrag, der bearbeitet wird (null = neu)
let pendingPhoto;     // undefined = unverändert, null = entfernt, Blob = neu
let previewUrl = null;

function setPreview(src) {
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  const img = $('#photoPreview');
  if (src instanceof Blob) { previewUrl = URL.createObjectURL(src); src = previewUrl; }
  if (src) { img.src = src; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
  $('#removePhoto').hidden = !src;
}

function openForm(entry = null) {
  editing = entry;
  pendingPhoto = undefined;
  form.reset();
  showError($('#formError'), '');
  $('#formTitle').textContent = entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag';
  $('#deleteBtn').hidden = !entry;
  $('#saveBtn').disabled = false;
  form.time.value = toLocalInput(entry ? new Date(entry.time) : new Date());
  form.type.value = entry ? entry.type : 'pipi';
  form.note.value = entry?.note || '';
  const meta = $('#entryMeta');
  meta.hidden = !(entry && entry.author);
  meta.textContent = entry && entry.author ? `Eingetragen von ${entry.author}` : '';
  setPreview(entry?.photo ? photoUrl(entry.photo) : null);
  dlg.showModal();
}
function closeForm() {
  if (dlg.open) dlg.close();
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
    showError($('#formError'), '');
  } catch (err) {
    showError($('#formError'), err.message);
  }
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!form.time.value) return;
  const saveBtn = $('#saveBtn');
  saveBtn.disabled = true;
  showError($('#formError'), '');

  const id = editing ? editing.id : uid();
  const oldPhoto = editing?.photo || null;
  let photoPath = oldPhoto;
  let uploaded = null;

  if (mode === 'local') {
    try {
      const prev = editing ? await localDb.get(id) : null;
      const photo = pendingPhoto instanceof Blob ? pendingPhoto
        : pendingPhoto === null ? null
        : (prev && prev.photo) || null;
      await localDb.put({
        id,
        created: prev ? prev.created : Date.now(),
        time: fromLocalInput(form.time.value).getTime(),
        type: form.type.value,
        note: form.note.value.trim().slice(0, 500),
        photo,
      });
      const wasNew = !editing;
      closeForm();
      toast(wasNew ? (photo ? 'Eintrag mit Beweisfoto gespeichert ✓' : 'Eintrag gespeichert ✓') : 'Änderungen gespeichert ✓');
      await loadEntries();
    } catch (err) {
      showError($('#formError'), 'Speichern auf dem Handy hat nicht geklappt: ' + (err?.message || err));
      saveBtn.disabled = false;
    }
    return;
  }

  try {
    if (pendingPhoto instanceof Blob) {
      uploaded = `${id}/${Date.now()}.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(uploaded, pendingPhoto, { contentType: 'image/jpeg', upsert: false });
      if (error) { uploaded = null; throw error; }
      photoPath = uploaded;
    } else if (pendingPhoto === null) {
      photoPath = null;
    }

    const row = {
      time: fromLocalInput(form.time.value).toISOString(),
      type: form.type.value,
      note: form.note.value.trim().slice(0, 500),
      photo_path: photoPath,
    };
    const { error } = editing
      ? await sb.from(TABLE).update(row).eq('id', id)
      : await sb.from(TABLE).insert({ id, ...row, author: myName() });
    if (error) throw error;

    if (oldPhoto && oldPhoto !== photoPath) {
      sb.storage.from(BUCKET).remove([oldPhoto]).catch(() => {});
    }
    const wasNew = !editing;
    closeForm();
    toast(wasNew ? (photoPath ? 'Eintrag mit Beweisfoto gespeichert ✓' : 'Eintrag gespeichert ✓') : 'Änderungen gespeichert ✓');
    await loadEntries();
  } catch (err) {
    if (uploaded) sb.storage.from(BUCKET).remove([uploaded]).catch(() => {});
    showError($('#formError'), friendlyError(err));
    saveBtn.disabled = false;
  }
});

$('#cameraInput').addEventListener('change', handlePhotoInput);
$('#galleryInput').addEventListener('change', handlePhotoInput);
$('#removePhoto').addEventListener('click', () => { pendingPhoto = null; setPreview(null); });
$('#cancelBtn').addEventListener('click', closeForm);
dlg.addEventListener('close', () => setPreview(null));

$('#deleteBtn').addEventListener('click', async () => {
  const question = mode === 'local'
    ? 'Diesen Eintrag wirklich löschen?'
    : 'Diesen Eintrag wirklich löschen? Das gilt auch für alle anderen.';
  if (!editing || !confirm(question)) return;
  const entry = editing;
  if (mode === 'local') {
    try { await localDb.remove(entry.id); } catch (err) {
      showError($('#formError'), 'Löschen hat nicht geklappt: ' + (err?.message || err));
      return;
    }
    closeForm();
    toast('Eintrag gelöscht');
    await loadEntries();
    return;
  }
  const { error } = await sb.from(TABLE).delete().eq('id', entry.id);
  if (error) { showError($('#formError'), friendlyError(error)); return; }
  if (entry.photo) sb.storage.from(BUCKET).remove([entry.photo]).catch(() => {});
  closeForm();
  toast('Eintrag gelöscht');
  await loadEntries();
});

/* ---------- Foto groß ---------- */
function showPhoto(entry) {
  const url = photoUrl(entry.photo);
  if (!url) return;
  $('#photoLarge').src = url;
  const d = new Date(entry.time);
  $('#photoCaption').textContent =
    `${TYPES[entry.type].icon} ${TYPES[entry.type].label} · ${fmtDayLong(d)}, ${fmtTime(d)} Uhr` +
    (entry.author ? ` · ${entry.author}` : '');
  $('#photoDialog').showModal();
}
$('#closePhoto').addEventListener('click', () => $('#photoDialog').close());
$('#photoDialog').addEventListener('click', (e) => { if (e.target === $('#photoDialog')) $('#photoDialog').close(); });

/* ---------- Klicks in Liste & Wochenplan ---------- */
const findEntry = (id) => state.entries.find((e) => e.id === id);
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

/* ---------- Anmeldung ---------- */
$('#loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true;
  showError($('#loginError'), '');
  const { error } = await sb.auth.signInWithPassword({
    email: $('#loginEmail').value.trim(),
    password: $('#loginPassword').value,
  });
  btn.disabled = false;
  if (error) showError($('#loginError'), friendlyError(error));
  // Erfolg wird über onAuthStateChange verarbeitet
});

function askName() {
  $('#nameInput').value = (me && me.user_metadata && me.user_metadata.name) || '';
  showError($('#nameError'), '');
  $('#nameDialog').showModal();
}
$('#nameForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $('#nameInput').value.trim();
  if (!name) return;
  const { data, error } = await sb.auth.updateUser({ data: { name } });
  if (error) { showError($('#nameError'), friendlyError(error)); return; }
  if (data && data.user) me = data.user;
  $('#nameDialog').close();
  $('#menuUser').textContent = `Angemeldet als ${myName()}`;
  toast(`Hallo ${name}!`);
});

$('#passwordForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $('#passwordInput').value });
  if (error) { showError($('#passwordError'), friendlyError(error)); return; }
  $('#passwordDialog').close();
  toast('Passwort geändert ✓');
});
$('#passwordCancel').addEventListener('click', () => $('#passwordDialog').close());

/* ---------- Menü ---------- */
const menu = $('#menu');
$('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
menu.addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  menu.hidden = true;
  if (action === 'name') askName();
  if (action === 'password') {
    $('#passwordInput').value = '';
    showError($('#passwordError'), '');
    $('#passwordDialog').showModal();
  }
  if (action === 'logout') await sb.auth.signOut();
});

/* ---------- Sitzungswechsel ---------- */
function onSignedIn(user) {
  const first = !me;
  me = user;
  $('#menuUser').textContent = `Angemeldet als ${myName()}`;
  showScreen('app');
  if (first) {
    state.loaded = false;
    render();
    loadEntries();
    subscribeLive();
    checkLocalEntries();
    if (!(user.user_metadata && user.user_metadata.name)) askName();
  }
}

/* ---------- Lokale Einträge in die Datenbank übernehmen ---------- */
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function checkLocalEntries() {
  let rows = [];
  try { rows = await localDb.all(); } catch { /* kein lokaler Speicher */ }
  const box = $('#migrateBox');
  if (!rows.length) { box.hidden = true; return; }
  $('#migrateText').textContent = rows.length === 1
    ? 'Auf diesem Handy liegt noch 1 Eintrag aus der Zeit ohne Datenbank.'
    : `Auf diesem Handy liegen noch ${rows.length} Einträge aus der Zeit ohne Datenbank.`;
  $('#migrateBtn').disabled = false;
  box.hidden = false;
}

$('#migrateBtn').addEventListener('click', async () => {
  const btn = $('#migrateBtn');
  btn.disabled = true;
  let rows;
  try { rows = await localDb.all(); } catch (err) { $('#migrateText').textContent = friendlyError(err); return; }
  let done = 0;
  for (const r of rows) {
    $('#migrateText').textContent = `Übernehme Einträge… ${done} von ${rows.length}`;
    const id = isUuid(r.id) ? r.id : uid();
    let path = null;
    try {
      if (r.photo instanceof Blob) {
        path = `${id}/${r.created || r.time}.jpg`;
        const { error } = await sb.storage.from(BUCKET)
          .upload(path, r.photo, { contentType: r.photo.type || 'image/jpeg', upsert: true });
        if (error) throw error;
      }
      const { error } = await sb.from(TABLE).upsert({
        id,
        time: new Date(r.time).toISOString(),
        type: r.type,
        note: (r.note || '').slice(0, 500),
        photo_path: path,
        author: myName(),
      });
      if (error) throw error;
      await localDb.remove(r.id);
      done++;
    } catch (err) {
      $('#migrateText').textContent = `${done} von ${rows.length} übernommen. Fehler: ${friendlyError(err)} Tippe erneut auf „Übernehmen“.`;
      btn.disabled = false;
      await loadEntries();
      return;
    }
  }
  $('#migrateBox').hidden = true;
  toast(`${done} Einträge übernommen ✓`);
  await loadEntries();
});
function onSignedOut() {
  me = null;
  unsubscribeLive();
  state.entries = [];
  state.loaded = false;
  signedUrls.clear();
  $('#migrateBox').hidden = true;
  $('#loginPassword').value = '';
  showScreen('login');
  renderStatus();
}

/* ---------- Start ---------- */
function startLocal() {
  mode = 'local';
  showScreen('app');
  $('#menuBtn').hidden = true;
  $('#localHint').hidden = false;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  render();
  loadEntries();
  setInterval(renderStatus, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
}

function start() {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    startLocal();
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    showScreen('setup');
    $('#setupScreen').innerHTML = '<h2>Keine Verbindung</h2><p>Die App braucht beim Start Internet. Prüfe die Verbindung und lade die Seite neu.</p>';
    $('#status').textContent = 'Offline';
    return;
  }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  sb.auth.onAuthStateChange((event, session) => {
    // Supabase empfiehlt, im Callback nichts zu awaiten – daher entkoppelt.
    setTimeout(() => {
      if (session && session.user) onSignedIn(session.user);
      else onSignedOut();
    }, 0);
  });

  setInterval(renderStatus, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && me) loadEntries();
  });
}

start();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

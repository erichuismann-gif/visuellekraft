'use strict';

/* =========================================================
   Ylvis Klo-Plan
   Protokoll der Pipi-Besuche (Blasenprobleme) und der Medikation.
   Ohne config.js: lokal auf dem Gerät (IndexedDB).
   Mit config.js: gemeinsame Supabase-Datenbank für mehrere Personen.
   ========================================================= */

/* ---------- Versionsprüfung ----------
   Nach einem Update kann der Browser kurzzeitig alte und neue Dateien
   mischen. Passt die Seite nicht zu diesem Skript, einmal frisch laden. */
const APP_VERSION = '7';
(() => {
  const pageVersion = document.querySelector('meta[name="ylvi-version"]')?.content;
  if (pageVersion === APP_VERSION) {
    try { sessionStorage.removeItem('ylvi-reloaded'); } catch { /* egal */ }
    return;
  }
  let already = false;
  try { already = sessionStorage.getItem('ylvi-reloaded') === APP_VERSION; } catch { /* egal */ }
  if (!already) {
    try { sessionStorage.setItem('ylvi-reloaded', APP_VERSION); } catch { /* egal */ }
    location.replace(location.pathname + '?update=' + Date.now());
  }
  throw new Error('Veraltete Seite – wird neu geladen');
})();

/* ---------- Fehler sichtbar machen statt endlos „lädt“ ---------- */
window.addEventListener('error', (e) => {
  const n = document.getElementById('notice');
  if (n) { n.hidden = false; n.textContent = 'Fehler: ' + (e.message || 'unbekannt') + ' – bitte die App komplett schließen und neu öffnen.'; }
});
window.addEventListener('unhandledrejection', (e) => {
  const n = document.getElementById('notice');
  if (n) { n.hidden = false; n.textContent = 'Fehler: ' + ((e.reason && e.reason.message) || e.reason || 'unbekannt'); }
});

const TABLE = 'entries';
const MED_TABLE = 'medications';
const BUCKET = 'photos';
const PHOTO_MAX_SIDE = 1600;
const PHOTO_QUALITY = 0.82;
const SIGNED_URL_SECONDS = 60 * 60 * 6;

// Bekannte Medikation, die beim ersten Start einmalig eingetragen wird
// (feste IDs, damit nichts doppelt entsteht, wenn mehrere Geräte starten).
const MED_SEED = [
  { id: 'seed-fluoxetin-5', name: 'Fluoxetin', dose: 5, start: null, note: 'Wegen Rolling Skin Syndrome' },
  { id: 'seed-fluoxetin-2-5', name: 'Fluoxetin', dose: 2.5, start: '2026-11-17', note: 'Herunterfahren auf Empfehlung der Tierärztin (Verdacht: Blasenprobleme durch Fluoxetin)' },
];
const MED_SEED_FLAG = 'ylvi-med-seeded';

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
const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function fromDateInput(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
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
const fmtDate = (d) => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtNum = (n, digits = 1) => n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

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
function fmtDuration(ms) {
  const h = Math.floor(ms / 3600000);
  const min = Math.round((ms % 3600000) / 60000);
  return min ? `${h} Std. ${min} Min.` : `${h} Std.`;
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
function friendlyError(err) {
  const msg = (err && (err.message || err.error_description || String(err))) || '';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Keine Verbindung. Prüfe das Internet und versuche es erneut.';
  if (/Invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/Email not confirmed/i.test(msg)) return 'Die E-Mail-Adresse ist noch nicht bestätigt. Bestätige sie im Supabase-Dashboard.';
  if (/JWT|expired|not authenticated|row-level security|permission/i.test(msg)) return 'Keine Berechtigung. Melde dich ab und wieder an.';
  if (/Payload too large|exceeded the maximum/i.test(msg)) return 'Das Foto ist zu groß.';
  if (/Password should be/i.test(msg)) return 'Das Passwort ist zu kurz oder zu einfach.';
  if (/medications/i.test(msg) && /does not exist|schema cache/i.test(msg)) return 'Die Medikations-Tabelle fehlt. Führe supabase-setup.sql noch einmal im SQL Editor aus.';
  return 'Das hat nicht geklappt: ' + msg;
}

function showScreen(name) {
  $('#setupScreen').hidden = name !== 'setup';
  $('#loginScreen').hidden = name !== 'login';
  $('#appScreen').hidden = name !== 'app';
  $('#menuBtn').hidden = name !== 'app';
  if (name !== 'app') $('#menu').hidden = true;
}

/* ---------- Lokaler Speicher (IndexedDB) ---------- */
const idb = (() => {
  let dbPromise;
  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('ylvi-klo', 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('entries')) {
            db.createObjectStore('entries', { keyPath: 'id' }).createIndex('time', 'time');
          }
          if (!db.objectStoreNames.contains('meds')) db.createObjectStore('meds', { keyPath: 'id' });
        };
        req.onblocked = () => {
          // Eine ältere Version der App hält den Speicher noch offen
          notice('Die App ist noch in einem anderen Fenster geöffnet (z. B. auf dem Home-Bildschirm oder in einem anderen Tab). Bitte alle Fenster der App schließen und sie neu öffnen.');
        };
        req.onsuccess = () => {
          const db = req.result;
          // Spätere Updates nicht blockieren: Verbindung freigeben, wenn eine neuere Version sie braucht
          db.onversionchange = () => { db.close(); notice('Die App wurde aktualisiert. Bitte neu laden.'); };
          resolve(db);
        };
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  function store(name) {
    async function tx(mode, fn) {
      const d = await open();
      return new Promise((resolve, reject) => {
        const t = d.transaction(name, mode);
        const req = fn(t.objectStore(name));
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
  }
  return { entries: store('entries'), meds: store('meds') };
})();
const localDb = idb.entries;
const localMeds = idb.meds;
const localPhotoUrls = new Map(); // 'local:<id>' -> Objekt-URL

/* ---------- Verbindung ---------- */
const cfg = window.YLVI_CONFIG || {};
let mode = 'cloud';  // 'local' = nur auf diesem Gerät, 'cloud' = gemeinsame Datenbank
let sb = null;
let me = null;
let channel = null;

/* ---------- Zustand ---------- */
const state = {
  entries: [],   // nur Pipi (ältere Kacka-Einträge werden ausgeblendet)
  meds: [],      // Medikations-Änderungen
  loaded: false,
  view: 'list',
  weekStart: startOfWeek(new Date()),
};
const signedUrls = new Map();

function myName() {
  return (me && me.user_metadata && me.user_metadata.name) || (me && me.email ? me.email.split('@')[0] : '');
}
const isUrine = (type) => type !== 'kacka'; // 'pipi' und früheres 'beides'

/* ---------- Daten laden ---------- */
let loading = null;
let reloadAgain = false;

let loadWatchdog = null;
function armLoadWatchdog() {
  clearTimeout(loadWatchdog);
  loadWatchdog = setTimeout(() => {
    if (!state.loaded) {
      notice('Das Laden dauert ungewöhnlich lange. Bitte die App komplett schließen (auch auf dem Home-Bildschirm) und neu öffnen.');
    }
  }, 10000);
}

async function loadEntries() {
  if (!state.loaded) armLoadWatchdog();
  if (loading) { reloadAgain = true; return loading; }
  loading = (async () => {
    if (mode === 'local') {
      await loadLocalData();
    } else {
      await loadCloudData();
    }
    await seedMedsOnce();
    state.loaded = true;
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

async function loadCloudData() {
  const [entriesRes, medsRes] = await Promise.all([
    sb.from(TABLE).select('id,time,type,note,photo_path,author,created_at').order('time', { ascending: false }).limit(5000),
    sb.from(MED_TABLE).select('id,name,dose_mg,start_date,note,author,created_at'),
  ]);
  if (entriesRes.error) throw entriesRes.error;
  state.entries = (entriesRes.data || [])
    .filter((r) => isUrine(r.type))
    .map((r) => ({
      id: r.id,
      time: Date.parse(r.time),
      type: 'pipi',
      note: r.note || '',
      photo: r.photo_path || null,
      author: r.author || '',
    }));
  if (medsRes.error) {
    notice(friendlyError(medsRes.error));
  } else {
    notice('');
    state.meds = (medsRes.data || []).map((r) => ({
      id: r.id,
      name: r.name,
      dose: Number(r.dose_mg),
      start: r.start_date || null,
      note: r.note || '',
      author: r.author || '',
      created: Date.parse(r.created_at) || 0,
    }));
  }
  await refreshSignedUrls();
}

async function loadLocalData() {
  const [rows, meds] = await Promise.all([localDb.all(), localMeds.all()]);
  for (const u of localPhotoUrls.values()) URL.revokeObjectURL(u);
  localPhotoUrls.clear();
  state.entries = rows
    .filter((r) => isUrine(r.type) && typeof r.time === 'number')
    .sort((a, b) => b.time - a.time)
    .map((r) => {
      let photo = null;
      if (r.photo instanceof Blob) {
        photo = 'local:' + r.id;
        localPhotoUrls.set(photo, URL.createObjectURL(r.photo));
      }
      return { id: r.id, time: r.time, type: 'pipi', note: r.note || '', photo, author: '' };
    });
  state.meds = meds.map((m) => ({ ...m, created: m.created || 0 }));
}

async function seedMedsOnce() {
  let flag = null;
  try { flag = localStorage.getItem(MED_SEED_FLAG); } catch { /* egal */ }
  if (flag) return;
  if (!state.meds.length) {
    const now = Date.now();
    const recs = MED_SEED.map((s, i) => ({ ...s, created: now + i }));
    if (mode === 'local') {
      for (const r of recs) await localMeds.put(r);
      state.meds = recs;
    } else {
      const { error } = await sb.from(MED_TABLE).upsert(recs.map(medToRow));
      if (error) return; // z. B. Tabelle fehlt – später erneut versuchen
      state.meds = recs;
    }
  }
  try { localStorage.setItem(MED_SEED_FLAG, '1'); } catch { /* egal */ }
}

function medToRow(m) {
  return { id: m.id, name: m.name, dose_mg: m.dose, start_date: m.start, note: m.note || '', author: m.author || myName() };
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
    .channel('ylvi-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, scheduleReload)
    .on('postgres_changes', { event: '*', schema: 'public', table: MED_TABLE }, scheduleReload)
    .subscribe();
}
function unsubscribeLive() {
  if (channel) { sb.removeChannel(channel); channel = null; }
}

/* ---------- Medikation: Helfer ---------- */
const dosesOn = (day) => YlviMeds.doseOn(state.meds, day);
const doseLabel = (day, long = false) => YlviMeds.label(state.meds, dosesOn(day), { long });

function changeText(change) {
  // "Fluoxetin: 5 mg → 2,5 mg"
  const before = change.start
    ? YlviMeds.doseOn(state.meds.filter((m) => m.name === change.name), addDays(YlviMeds.keyToDate(change.start), -1))[0]
    : null;
  const to = YlviMeds.fmtDose(change.dose);
  return before ? `${change.name}: ${YlviMeds.fmtDose(before.dose)} → ${to}` : `${change.name}: ${to}`;
}

/* ---------- Darstellung ---------- */
function render() {
  renderStatus();
  if (state.view === 'list') renderList();
  else if (state.view === 'week') renderWeek();
  else renderMeds();
}

function renderStatus() {
  const el = $('#status');
  const medEl = $('#medStatus');
  if (!me && mode !== 'local') { el.textContent = 'Pipi-Protokoll für Ylvi'; medEl.hidden = true; return; }
  if (!state.loaded) { el.textContent = 'Einträge werden geladen…'; return; }
  const now = Date.now();
  const last = state.entries.find((e) => e.time <= now);
  el.textContent = last ? `Zuletzt Pipi ${ago(now - last.time)}` : 'Noch keine Einträge';
  const cur = doseLabel(new Date(), true);
  medEl.hidden = !cur;
  medEl.textContent = cur ? `💊 ${cur}` : '';
}

function renderList() {
  const now = new Date();
  const t0 = startOfDay(now).getTime();
  const today = state.entries.filter((e) => e.time >= t0 && e.time < t0 + 86400000).length;
  const last7 = state.entries.filter((e) => e.time >= t0 - 6 * 86400000 && e.time < t0).length; // 6 volle Tage + heute separat
  const avg7 = (last7 + today) / 7;
  const doses = dosesOn(now);
  const doseVal = doses.length ? YlviMeds.label(state.meds, doses) : '–';
  const doseSub = doses.length === 1 ? `${doses[0].name}${doses[0].change.start ? ` seit ${fmtDayShort(YlviMeds.keyToDate(doses[0].change.start))}` : ''}` : 'Medikation';
  $('#todaySummary').innerHTML = `
    <div class="stat"><b>${today}</b><span>💧 Pipi heute</span></div>
    <div class="stat"><b>${fmtNum(avg7)}</b><span>Ø pro Tag (7 Tage)</span></div>
    <div class="stat"><b>${esc(doseVal)}</b><span>💊 ${esc(doseSub)}</span></div>`;

  const list = $('#list');
  if (!state.entries.length && !state.meds.some((m) => m.start)) {
    list.innerHTML = `<div class="empty-state"><div class="big">🐱</div>
      <p>${state.loaded
        ? 'Noch nichts eingetragen.<br>Tippe unten auf <b>＋ Eintrag</b>, wenn Ylvi Pipi gemacht hat.'
        : 'Einträge werden geladen…'}</p></div>`;
    return;
  }

  // Tage mit Einträgen oder Dosisänderungen
  const groups = new Map();
  for (const e of state.entries) {
    const k = dayKey(new Date(e.time));
    if (!groups.has(k)) groups.set(k, { entries: [], changes: [] });
    groups.get(k).entries.push(e);
  }
  for (const m of state.meds) {
    if (!m.start) continue;
    if (!groups.has(m.start)) groups.set(m.start, { entries: [], changes: [] });
    groups.get(m.start).changes.push(m);
  }
  const keys = [...groups.keys()].sort().reverse();

  let html = '';
  for (const k of keys) {
    const g = groups.get(k);
    const day = YlviMeds.keyToDate(k);
    const dl = doseLabel(day);
    html += `<div class="day-head"><span>${esc(dayTitle(day))}</span><span>💧 ${g.entries.length}${dl ? ` · 💊 ${esc(dl)}` : ''}</span></div>`;
    for (const e of g.entries) {
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
            <div class="entry-time">${fmtTime(new Date(e.time))}<span class="badge pipi">💧 Pipi</span>${e.author ? `<span class="author">${esc(e.author)}</span>` : ''}</div>
            <div class="entry-note">${e.note ? esc(e.note) : '&nbsp;'}</div>
          </div>
        </div>`;
    }
    for (const m of g.changes) {
      html += `<button class="med-row" data-med="${esc(m.id)}">💊 ${esc(changeText(m))}${m.note ? `<span>· ${esc(m.note)}</span>` : ''}</button>`;
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
    const dl = doseLabel(day);
    const changed = YlviMeds.changesOn(state.meds, day).length > 0;
    const dots = items.map((e) => {
      const d = new Date(e.time);
      const pct = ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100;
      const lbl = `${fmtTime(d)} Pipi`;
      return `<button class="pipi" style="left:${pct.toFixed(2)}%" data-edit="${esc(e.id)}" title="${lbl}" aria-label="${lbl}"></button>`;
    }).join('');
    const chips = items.map((e) =>
      `<button class="chip" data-edit="${esc(e.id)}">💧 ${fmtTime(new Date(e.time))}${e.photo ? ' 📷' : ''}${e.note ? ' ✎' : ''}</button>`
    ).join('');
    html += `
      <div class="wday${dayKey(day) === todayKey ? ' is-today' : ''}">
        <div class="wday-head">
          <strong>${esc(fmtDayShort(day))}${dl ? `<span class="dose-chip${changed ? ' changed' : ''}" title="${changed ? 'Dosis geändert' : 'Dosis'}">💊 ${esc(dl)}</span>` : ''}</strong>
          <span class="wday-counts">${items.length ? `💧 ${items.length}` : '–'}</span>
        </div>
        <div class="timeline">${dots}</div>
        <div class="timeline-scale"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 Uhr</span></div>
        ${chips ? `<div class="wday-times">${chips}</div>` : ''}
      </div>`;
  }
  $('#week').innerHTML = html;
}

function renderMeds() {
  const now = new Date();
  const doses = dosesOn(now);
  $('#medCurrent').innerHTML = doses.length
    ? doses.map((d) => `<b>${esc(d.name)} ${esc(YlviMeds.fmtDose(d.dose))}</b><span>${d.change.start ? `seit ${esc(fmtDayLong(YlviMeds.keyToDate(d.change.start)))}` : 'seit Beginn der Aufzeichnung'}</span>`).join('<br>')
    : '<b>Keine Medikation eingetragen</b><span>Tippe auf „Dosis ändern“, um eine einzutragen.</span>';

  // Vergleich je Dosis, ab dem ersten Eintrag bis heute
  const cmpEl = $('#medCompare');
  if (!state.entries.length || !state.meds.length) {
    cmpEl.innerHTML = '<p class="muted">Sobald Pipi-Einträge und Medikation vorhanden sind, siehst du hier den Vergleich.</p>';
  } else {
    const first = startOfDay(new Date(Math.min(...state.entries.map((e) => e.time))));
    const rows = YlviMeds.compare(state.entries, state.meds, first, addDays(startOfDay(now), 1), Date.now());
    cmpEl.innerHTML = `<table class="cmp">
      <thead><tr><th>Dosis</th><th class="num">Tage</th><th class="num">Pipi</th><th class="num">Ø pro Tag</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><b>${esc(YlviMeds.label(state.meds, r.doses) || 'ohne')}</b><small>${esc(fmtDayShort(r.from))} – ${esc(fmtDayShort(addDays(r.to, -1)))}</small></td>
        <td class="num">${r.days}</td>
        <td class="num">${r.count}</td>
        <td class="num big">${fmtNum(r.avg)}</td>
      </tr>`).join('')}</tbody></table>
      <p class="muted small" style="margin-top:6px">Der heutige Tag zählt schon mit, auch wenn er noch nicht vorbei ist.${rows.some((r) => r.longestGap) ? ` Längste Pause: ${rows.map((r) => `${esc(YlviMeds.label(state.meds, r.doses))} ${r.longestGap ? fmtDuration(r.longestGap) : '–'}`).join(' · ')}` : ''}</p>`;
  }

  // Verlauf (neueste zuerst)
  const list = YlviMeds.sorted(state.meds).reverse();
  $('#medList').innerHTML = list.length
    ? list.map((m) => `<button class="med-item" data-med="${esc(m.id)}">
        <span class="when">${m.start ? esc(fmtDate(YlviMeds.keyToDate(m.start))) : 'seit Beginn'}</span>
        <span class="what"><b>${esc(changeText(m))}</b>${m.note ? `<span>${esc(m.note)}</span>` : ''}${m.author ? `<span> · ${esc(m.author)}</span>` : ''}</span>
      </button>`).join('')
    : '<p class="muted">Noch keine Einträge.</p>';
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

/* ---------- Formular: Pipi-Eintrag ---------- */
const form = $('#entryForm');
const dlg = $('#entryDialog');
let editing = null;
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
  $('#formTitle').textContent = entry ? 'Pipi bearbeiten' : 'Pipi eintragen';
  $('#deleteBtn').hidden = !entry;
  $('#saveBtn').disabled = false;
  form.time.value = toLocalInput(entry ? new Date(entry.time) : new Date());
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
        type: 'pipi',
        note: form.note.value.trim().slice(0, 500),
        photo,
      });
      const wasNew = !editing;
      closeForm();
      toast(wasNew ? (photo ? 'Pipi mit Beweisfoto gespeichert ✓' : 'Pipi gespeichert ✓') : 'Änderungen gespeichert ✓');
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
      type: 'pipi',
      note: form.note.value.trim().slice(0, 500),
      photo_path: photoPath,
    };
    const { error } = editing
      ? await sb.from(TABLE).update(row).eq('id', id)
      : await sb.from(TABLE).insert({ id, ...row, author: myName() });
    if (error) throw error;
    if (oldPhoto && oldPhoto !== photoPath) sb.storage.from(BUCKET).remove([oldPhoto]).catch(() => {});
    const wasNew = !editing;
    closeForm();
    toast(wasNew ? (photoPath ? 'Pipi mit Beweisfoto gespeichert ✓' : 'Pipi gespeichert ✓') : 'Änderungen gespeichert ✓');
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
  } else {
    const { error } = await sb.from(TABLE).delete().eq('id', entry.id);
    if (error) { showError($('#formError'), friendlyError(error)); return; }
    if (entry.photo) sb.storage.from(BUCKET).remove([entry.photo]).catch(() => {});
  }
  closeForm();
  toast('Eintrag gelöscht');
  await loadEntries();
});

/* ---------- Formular: Medikation ---------- */
const medDlg = $('#medDialog');
let editingMed = null;

function openMedForm(med = null) {
  editingMed = med;
  showError($('#medError'), '');
  const latest = YlviMeds.sorted(state.meds).pop();
  $('#medFormTitle').textContent = med ? 'Medikation bearbeiten' : 'Dosis ändern';
  $('#medName').value = med ? med.name : (latest ? latest.name : 'Fluoxetin');
  $('#medDose').value = med ? String(med.dose).replace('.', ',') : '';
  $('#medFromBeginning').checked = !!(med && med.start === null);
  $('#medStart').value = med && med.start ? med.start : toDateInput(new Date());
  $('#medStart').disabled = $('#medFromBeginning').checked;
  $('#medNote').value = med ? med.note || '' : '';
  $('#medDelete').hidden = !med;
  $('#medSave').disabled = false;
  $('#medNames').innerHTML = YlviMeds.names(state.meds).map((n) => `<option value="${esc(n)}"></option>`).join('');
  medDlg.showModal();
  if (!med) $('#medDose').focus();
}

$('#medFromBeginning').addEventListener('change', () => { $('#medStart').disabled = $('#medFromBeginning').checked; });
$('#medCancel').addEventListener('click', () => medDlg.close());
$('#addMedBtn').addEventListener('click', () => openMedForm());

$('#medForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $('#medName').value.trim();
  const dose = Number($('#medDose').value.trim().replace(',', '.'));
  const start = $('#medFromBeginning').checked ? null : $('#medStart').value || null;
  if (!name) return;
  if (!Number.isFinite(dose) || dose < 0) { showError($('#medError'), 'Bitte die Dosis als Zahl in mg eingeben, z. B. 2,5.'); return; }
  if (!$('#medFromBeginning').checked && !start) { showError($('#medError'), 'Bitte ein Datum wählen.'); return; }
  const rec = {
    id: editingMed ? editingMed.id : uid(),
    name,
    dose,
    start,
    note: $('#medNote').value.trim().slice(0, 300),
    created: editingMed ? editingMed.created : Date.now(),
    author: editingMed ? editingMed.author : myName(),
  };
  $('#medSave').disabled = true;
  try {
    if (mode === 'local') {
      await localMeds.put(rec);
    } else {
      const { error } = await sb.from(MED_TABLE).upsert(medToRow(rec));
      if (error) throw error;
    }
    medDlg.close();
    toast(`💊 ${name} ${YlviMeds.fmtDose(dose)} gespeichert ✓`);
    await loadEntries();
  } catch (err) {
    showError($('#medError'), friendlyError(err));
    $('#medSave').disabled = false;
  }
});

$('#medDelete').addEventListener('click', async () => {
  if (!editingMed || !confirm('Diese Medikations-Änderung wirklich löschen?')) return;
  try {
    if (mode === 'local') await localMeds.remove(editingMed.id);
    else {
      const { error } = await sb.from(MED_TABLE).delete().eq('id', editingMed.id);
      if (error) throw error;
    }
    medDlg.close();
    toast('Gelöscht');
    await loadEntries();
  } catch (err) {
    showError($('#medError'), friendlyError(err));
  }
});

/* ---------- Foto groß ---------- */
function showPhoto(entry) {
  const url = photoUrl(entry.photo);
  if (!url) return;
  $('#photoLarge').src = url;
  const d = new Date(entry.time);
  $('#photoCaption').textContent = `💧 Pipi · ${fmtDayLong(d)}, ${fmtTime(d)} Uhr` + (entry.author ? ` · ${entry.author}` : '');
  $('#photoDialog').showModal();
}
$('#closePhoto').addEventListener('click', () => $('#photoDialog').close());
$('#photoDialog').addEventListener('click', (e) => { if (e.target === $('#photoDialog')) $('#photoDialog').close(); });

/* ---------- Klicks ---------- */
const findEntry = (id) => state.entries.find((e) => e.id === id);
document.addEventListener('click', (ev) => {
  const photoEl = ev.target.closest('[data-photo]');
  if (photoEl) { const e = findEntry(photoEl.dataset.photo); if (e) showPhoto(e); return; }
  const medEl = ev.target.closest('[data-med]');
  if (medEl) { const m = state.meds.find((x) => x.id === medEl.dataset.med); if (m) openMedForm(m); return; }
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
    $('#view-meds').hidden = state.view !== 'meds';
    render();
  });
});
$('#prevWeek').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, -7); renderWeek(); });
$('#nextWeek').addEventListener('click', () => { state.weekStart = addDays(state.weekStart, 7); renderWeek(); });

/* ---------- PDF für den Tierarzt ---------- */
const pdfDlg = $('#pdfDialog');
let pdfResult = null;

function pdfRange() {
  const fromV = $('#pdfFrom').value;
  const toV = $('#pdfTo').value;
  if (!fromV || !toV) return null;
  let from = startOfWeek(fromDateInput(fromV));
  let to = startOfWeek(fromDateInput(toV));
  if (to < from) [from, to] = [to, from];
  return { from, to, end: addDays(to, 7) };
}
function updatePdfInfo() {
  const r = pdfRange();
  document.querySelectorAll('.presets .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  if (!r) { $('#pdfRange').textContent = ''; return; }
  const weeks = Math.round((r.end - r.from) / (7 * 86400000));
  const inRange = state.entries.filter((e) => e.time >= r.from.getTime() && e.time < r.end.getTime());
  const photos = inRange.filter((e) => e.photo).length;
  $('#pdfRange').textContent =
    `${weeks} ${weeks === 1 ? 'Woche' : 'Wochen'}: Mo ${r.from.toLocaleDateString('de-DE')} bis So ${addDays(r.end, -1).toLocaleDateString('de-DE')} · ${inRange.length} Einträge`;
  $('#pdfPhotoCount').textContent = photos ? `(${photos} Fotos)` : '(keine im Zeitraum)';
  $('#pdfPhotos').disabled = !photos;
  const thisWeek = startOfWeek(new Date()).getTime();
  if (r.to.getTime() === thisWeek) {
    const chip = document.querySelector(`.presets .chip[data-weeks="${weeks}"]`);
    if (chip) chip.setAttribute('aria-pressed', 'true');
  }
  resetPdfResult();
}
function setPdfWeeks(weeks) {
  const thisWeek = startOfWeek(new Date());
  $('#pdfFrom').value = toDateInput(addDays(thisWeek, -7 * (weeks - 1)));
  $('#pdfTo').value = toDateInput(addDays(thisWeek, 6));
  updatePdfInfo();
}
function resetPdfResult() {
  pdfResult = null;
  $('#pdfCreate').textContent = 'PDF erstellen';
  $('#pdfCreate').disabled = false;
  showError($('#pdfProgress'), '');
}

$('#pdfBtn').addEventListener('click', () => {
  showError($('#pdfError'), '');
  const shownWeek = state.weekStart;
  $('#pdfFrom').value = toDateInput(addDays(shownWeek, -21));
  $('#pdfTo').value = toDateInput(addDays(shownWeek, 6));
  updatePdfInfo();
  pdfDlg.showModal();
  YlviPdf.loadLib().catch(() => {});
});
document.querySelectorAll('.presets .chip').forEach((c) => c.addEventListener('click', () => setPdfWeeks(Number(c.dataset.weeks))));
$('#pdfFrom').addEventListener('change', updatePdfInfo);
$('#pdfTo').addEventListener('change', updatePdfInfo);
$('#pdfNotes').addEventListener('change', resetPdfResult);
$('#pdfPhotos').addEventListener('change', resetPdfResult);
$('#pdfCancel').addEventListener('click', () => pdfDlg.close());
pdfDlg.addEventListener('close', resetPdfResult);

async function getPhotoBlob(entry) {
  if (!entry.photo) return null;
  if (mode === 'local') {
    const rec = await localDb.get(entry.id);
    return rec && rec.photo instanceof Blob ? rec.photo : null;
  }
  await refreshSignedUrls();
  const url = photoUrl(entry.photo);
  if (!url) return null;
  const res = await fetch(url);
  return res.ok ? res.blob() : null;
}
function canSharePdf(file) {
  return matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] });
}
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

$('#pdfForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('#pdfCreate');
  showError($('#pdfError'), '');

  if (pdfResult) {
    const file = new File([pdfResult.blob], pdfResult.filename, { type: 'application/pdf' });
    if (canSharePdf(file)) {
      try {
        await navigator.share({ files: [file], title: 'Ylvis Klo-Plan' });
        pdfDlg.close();
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    downloadBlob(pdfResult.blob, pdfResult.filename);
    toast('PDF gespeichert ✓');
    pdfDlg.close();
    return;
  }

  const r = pdfRange();
  if (!r) return;
  const weeks = Math.round((r.end - r.from) / (7 * 86400000));
  if (weeks > 104) { showError($('#pdfError'), 'Bitte höchstens 2 Jahre auf einmal exportieren.'); return; }
  btn.disabled = true;
  btn.textContent = 'Wird erstellt…';
  const prog = $('#pdfProgress');
  showError(prog, 'PDF wird erstellt…');
  try {
    const result = await YlviPdf.create(state.entries, {
      from: r.from,
      to: r.to,
      meds: state.meds,
      includeNotes: $('#pdfNotes').checked,
      includePhotos: $('#pdfPhotos').checked && !$('#pdfPhotos').disabled,
      getPhotoBlob,
      onProgress: (t) => showError(prog, t),
    });
    pdfResult = result;
    const kb = Math.max(1, Math.round(result.blob.size / 1024));
    const size = kb > 1024 ? `${(kb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${kb} KB`;
    showError(prog, `Fertig: ${result.filename} (${size})`);
    const file = new File([result.blob], result.filename, { type: 'application/pdf' });
    btn.textContent = canSharePdf(file) ? 'PDF teilen' : 'PDF herunterladen';
    btn.disabled = false;
  } catch (err) {
    showError(prog, '');
    showError($('#pdfError'), err && err.message ? err.message : 'Das PDF konnte nicht erstellt werden.');
    btn.textContent = 'PDF erstellen';
    btn.disabled = false;
  }
});

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
    checkLocalData();
    if (!(user.user_metadata && user.user_metadata.name)) askName();
  }
}
function onSignedOut() {
  me = null;
  unsubscribeLive();
  state.entries = [];
  state.meds = [];
  state.loaded = false;
  signedUrls.clear();
  $('#migrateBox').hidden = true;
  $('#loginPassword').value = '';
  showScreen('login');
  renderStatus();
}

/* ---------- Lokale Daten in die Datenbank übernehmen ---------- */
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function readLocalForMigration() {
  const [rows, meds] = await Promise.all([
    localDb.all().catch(() => []),
    localMeds.all().catch(() => []),
  ]);
  return { rows: rows.filter((r) => isUrine(r.type)), allRows: rows, meds };
}

async function checkLocalData() {
  const { rows, meds } = await readLocalForMigration();
  const box = $('#migrateBox');
  if (!rows.length && !meds.length) { box.hidden = true; return; }
  const parts = [];
  if (rows.length) parts.push(rows.length === 1 ? '1 Pipi-Eintrag' : `${rows.length} Pipi-Einträge`);
  if (meds.length) parts.push(meds.length === 1 ? '1 Medikations-Eintrag' : `${meds.length} Medikations-Einträge`);
  $('#migrateText').textContent = `Auf diesem Handy liegen noch ${parts.join(' und ')} aus der Zeit ohne Datenbank.`;
  $('#migrateBtn').disabled = false;
  box.hidden = false;
}

$('#migrateBtn').addEventListener('click', async () => {
  const btn = $('#migrateBtn');
  btn.disabled = true;
  const { rows, allRows, meds } = await readLocalForMigration();
  let done = 0;
  try {
    for (const m of meds) {
      const { error } = await sb.from(MED_TABLE).upsert(medToRow({ ...m, author: m.author || myName() }));
      if (error) throw error;
      await localMeds.remove(m.id);
    }
    for (const r of rows) {
      $('#migrateText').textContent = `Übernehme Einträge… ${done} von ${rows.length}`;
      const id = isUuid(r.id) ? r.id : uid();
      let path = null;
      if (r.photo instanceof Blob) {
        path = `${id}/${r.created || r.time}.jpg`;
        const { error } = await sb.storage.from(BUCKET)
          .upload(path, r.photo, { contentType: r.photo.type || 'image/jpeg', upsert: true });
        if (error) throw error;
      }
      const { error } = await sb.from(TABLE).upsert({
        id,
        time: new Date(r.time).toISOString(),
        type: 'pipi',
        note: (r.note || '').slice(0, 500),
        photo_path: path,
        author: myName(),
      });
      if (error) throw error;
      await localDb.remove(r.id);
      done++;
    }
    // Frühere Kacka-Einträge werden nicht übernommen, sondern lokal entfernt
    for (const r of allRows) if (!isUrine(r.type)) await localDb.remove(r.id).catch(() => {});
  } catch (err) {
    $('#migrateText').textContent = `${done} von ${rows.length} übernommen. Fehler: ${friendlyError(err)} Tippe erneut auf „Übernehmen“.`;
    btn.disabled = false;
    await loadEntries();
    return;
  }
  $('#migrateBox').hidden = true;
  toast(`${done} Einträge übernommen ✓`);
  await loadEntries();
});

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

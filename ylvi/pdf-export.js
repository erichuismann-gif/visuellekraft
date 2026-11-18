'use strict';

/* =========================================================
   PDF-Export für den Tierarzt
   Wochenübersicht der Pipi-Besuche über mehrere Wochen (A4 hoch),
   mit Medikation (Dosis je Tag, Vergleich je Dosis),
   optional Notizen und Beweisfotos.
   Nutzt jsPDF (vendor/jspdf.umd.min.js, MIT-Lizenz) und meds.js.
   ========================================================= */

const YlviPdf = (() => {
  const A4 = { w: 210, h: 297 };
  const M = 15;                       // Seitenrand
  const CONTENT_W = A4.w - 2 * M;
  const LABEL_W = 24;                 // Spalte "Mo 09.11." + Dosis
  const COUNT_W = 22;                 // Spalte rechts "3 Pipi"
  const BAR_X = M + LABEL_W;
  const BAR_W = CONTENT_W - LABEL_W - COUNT_W;
  const ROW_H = 10;
  const BAR_H = 4.6;
  const FOOTER_Y = A4.h - 8;

  const C = {
    text: [36, 31, 53],
    muted: [100, 95, 124],
    line: [218, 220, 236],
    bar: [239, 242, 251],
    accent: [214, 63, 140],
    pipi: [217, 169, 31],
    attempt: [180, 55, 42],
    white: [255, 255, 255],
  };

  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const fmtDateShort = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fmtNum = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const startOfWeek = (d) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }
  function fmtDuration(ms) {
    const h = Math.floor(ms / 3600000);
    const min = Math.round((ms % 3600000) / 60000);
    if (h >= 48) return `${Math.floor(h / 24)} Tage ${h % 24} Std.`;
    return min ? `${h} Std. ${min} Min.` : `${h} Std.`;
  }
  function longestGap(times) {
    let best = 0;
    for (let i = 1; i < times.length; i++) best = Math.max(best, times[i] - times[i - 1]);
    return best;
  }

  let libPromise = null;
  function loadLib() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/jspdf.umd.min.js';
        s.onload = () => (window.jspdf && window.jspdf.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('PDF-Bibliothek fehlt')));
        s.onerror = () => { libPromise = null; reject(new Error('Die PDF-Funktion konnte nicht geladen werden. Prüfe die Internetverbindung.')); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  async function blobToJpegDataUrl(blob, maxSide = 900) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Bild nicht lesbar'));
        i.src = url;
      });
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return { data: c.toDataURL('image/jpeg', 0.75), w: c.width, h: c.height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Rundes Foto als JPEG mit weißem Rand (JPEG kennt keine Transparenz) */
  async function roundPhoto(dataUrl, px = 360) {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Foto nicht lesbar'));
      i.src = dataUrl;
    });
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, px, px);
    g.save();
    g.beginPath();
    g.arc(px / 2, px / 2, px / 2 - 2, 0, Math.PI * 2);
    g.clip();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, px, px);
    g.restore();
    return c.toDataURL('image/jpeg', 0.85);
  }

  /**
   * @param {Array} entries  Pipi-Einträge [{id, time(ms), note, photo, author}]
   * @param {Object} opts    {from: Date, to: Date, meds: [], includeNotes, includePhotos,
   *                          getPhotoBlob(entry) => Promise<Blob|null>, onProgress(text)}
   */
  async function create(entries, opts) {
    const JsPDF = await loadLib();
    const progress = opts.onProgress || (() => {});
    const meds = opts.meds || [];
    const weekStart0 = startOfWeek(opts.from);
    const weekEnd = addDays(startOfWeek(opts.to), 7); // exklusiv
    const weeks = Math.round((weekEnd - weekStart0) / (7 * 86400000));
    const rangeFrom = weekStart0.getTime();
    const rangeTo = weekEnd.getTime();
    const now = Date.now();
    const effTo = Math.min(rangeTo, addDays(startOfDay(new Date(now)), 1).getTime());

    const inRange = entries
      .filter((e) => e.type !== 'kacka' && e.time >= rangeFrom && e.time < rangeTo)
      .sort((a, b) => a.time - b.time);
    const authors = new Set(inRange.map((e) => e.author).filter(Boolean));

    const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    doc.setProperties({ title: 'Ylvis Klo-Plan', subject: 'Pipi-Protokoll für den Tierarzt', creator: 'Ylvis Klo-Plan' });
    const rangeText = `${fmtDate(weekStart0)} – ${fmtDate(addDays(weekEnd, -1))}`;

    const setColor = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    const fill = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    const stroke = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
    const font = (style, size, color = C.text) => { doc.setFont('helvetica', style); doc.setFontSize(size); setColor(color); };

    let y = M;
    function ensureSpace(h) {
      if (y + h > FOOTER_Y - 4) { doc.addPage(); y = M; return true; }
      return false;
    }
    function pipiDot(x, cy) {
      stroke(C.white);
      doc.setLineWidth(0.3);
      fill(C.pipi);
      doc.circle(x, cy, 1.55, 'FD');
    }
    function attemptMarker(x, cy) {
      // hohler roter Ring mit Kreuz – auch schwarz-weiß gedruckt erkennbar
      fill(C.white);
      stroke(C.attempt);
      doc.setLineWidth(0.45);
      doc.circle(x, cy, 1.45, 'FD');
      doc.setLineWidth(0.3);
      doc.line(x - 0.75, cy - 0.75, x + 0.75, cy + 0.75);
      doc.line(x - 0.75, cy + 0.75, x + 0.75, cy - 0.75);
    }
    const isAttempt = (e) => e.type === 'versuch';
    const marker = (e, x, cy) => (isAttempt(e) ? attemptMarker(x, cy) : pipiDot(x, cy));
    function doseMarker(x, cy) {
      fill(C.accent);
      doc.triangle(x - 1.3, cy - 1.6, x - 1.3, cy + 1.6, x + 1.5, cy, 'F');
    }
    function sectionTitle(text, sub) {
      font('bold', 11);
      doc.text(text, M, y + 4);
      if (sub) {
        const w = doc.getTextWidth(text);
        font('normal', 8, C.muted);
        doc.text(sub, M + w + 3, y + 4);
      }
      y += 8;
    }
    function table(cols, rows, { boldCol = -1 } = {}) {
      const header = () => {
        font('bold', 8, C.muted);
        let x = M;
        for (const [h, w, align] of cols) {
          doc.text(h, align === 'right' ? x + w - 2 : x, y, { align: align === 'right' ? 'right' : 'left' });
          x += w;
        }
        y += 1.8;
        stroke(C.line);
        doc.setLineWidth(0.2);
        doc.line(M, y, A4.w - M, y);
        y += 4;
      };
      header();
      for (const row of rows) {
        font('normal', 8.5);
        const last = cols.length - 1;
        const wrapped = doc.splitTextToSize(String(row[last] || ''), cols[last][1]);
        const h = Math.max(1, wrapped.length) * 3.8 + 1.4;
        if (ensureSpace(h + 2)) header();
        let x = M;
        row.forEach((v, i) => {
          const [, w, align] = cols[i];
          font(i === boldCol ? 'bold' : 'normal', 8.5);
          if (i === last) doc.text(wrapped, x, y);
          else doc.text(String(v), align === 'right' ? x + w - 2 : x, y, { align: align === 'right' ? 'right' : 'left' });
          x += w;
        });
        y += h;
      }
    }

    /* ---------- Kopf ---------- */
    let titleX = M;
    if (opts.ylviPhoto) {
      try {
        const round = await roundPhoto(opts.ylviPhoto);
        const D = 17;
        doc.addImage(round, 'JPEG', M, y - 1, D, D, undefined, 'FAST');
        stroke(C.accent);
        doc.setLineWidth(0.6);
        doc.circle(M + D / 2, y - 1 + D / 2, D / 2, 'S');
        titleX = M + D + 4;
      } catch { /* ohne Foto weiter */ }
    }
    font('bold', 20);
    doc.text('Ylvis Klo-Plan', titleX, y + 7);
    font('normal', 10.5, C.muted);
    doc.text('Protokoll Urinabsatz (Pipi) von Katze Ylvi', titleX, y + 13);
    font('bold', 10.5);
    doc.text(`Zeitraum: ${rangeText}`, A4.w - M, y + 7, { align: 'right' });
    font('normal', 9, C.muted);
    doc.text(`${weeks} ${weeks === 1 ? 'Woche' : 'Wochen'} · erstellt am ${fmtDate(new Date())}`, A4.w - M, y + 13, { align: 'right' });
    y += 19;
    stroke(C.line);
    doc.setLineWidth(0.3);
    doc.line(M, y, A4.w - M, y);
    y += 6;

    /* ---------- Zusammenfassung ---------- */
    const effDays = Math.max(1, Math.round((effTo - rangeFrom) / 86400000));
    const times = inRange.filter((e) => !isAttempt(e)).map((e) => e.time);
    const attemptCount = inRange.filter(isAttempt).length;
    let maxDay = { n: 0, d: null };
    for (let d = 0; d < effDays; d++) {
      const a = addDays(weekStart0, d).getTime();
      const b = addDays(weekStart0, d + 1).getTime();
      const n = times.filter((t) => t >= a && t < b).length;
      if (n > maxDay.n) maxDay = { n, d: new Date(a) };
    }
    const stats = [
      ['Pipi gesamt', `${times.length}`, `Ø ${fmtNum(times.length / effDays)} pro Tag (${effDays} Tage)`],
      ['Versuche ohne Erfolg', `${attemptCount}`, `Ø ${fmtNum(attemptCount / effDays)} pro Tag`],
      ['Meiste Pipi an einem Tag', maxDay.n ? `${maxDay.n}` : '–', maxDay.d ? `${WD[maxDay.d.getDay()]} ${fmtDate(maxDay.d)}` : ''],
      ['Längste Pause', times.length > 1 ? fmtDuration(longestGap(times)) : '–', 'zwischen zwei Pipi'],
    ];
    const colW = CONTENT_W / 4;
    stats.forEach(([label, value, sub], i) => {
      const x = M + i * colW + (i ? 1.5 : 0);
      fill(C.bar);
      doc.roundedRect(x, y, colW - 1.5, 21, 2, 2, 'F');
      font('normal', 8, C.muted);
      doc.text(label, x + 3, y + 5.5);
      font('bold', 13);
      doc.text(value, x + 3, y + 12.5);
      font('normal', 7.5, C.muted);
      doc.text(sub, x + 3, y + 17.5);
    });
    y += 25;
    font('normal', 7.5, C.muted);
    doc.text(
      `Ausgewertet bis ${fmtDate(new Date(effTo - 1))} (der heutige Tag zählt mit). ` +
      'Enthält nur beobachtete und eingetragene Pipi und Versuche. Versuche zählen nicht als Pipi.',
      M, y
    );
    y += 7;

    /* ---------- Medikation ---------- */
    if (meds.length) {
      // relevante Änderungen: die zu Beginn gültigen + alle im Zeitraum
      const atStart = YlviMeds.doseOn(meds, weekStart0).map((d) => d.change);
      const within = YlviMeds.sorted(meds).filter((m) => m.start && m.start > YlviMeds.dayKey(weekStart0) && YlviMeds.keyToDate(m.start).getTime() < rangeTo);
      const rel = [...atStart, ...within];
      if (rel.length) {
        sectionTitle('Medikation', within.length ? 'Dosisänderungen sind in der Zeitleiste pink markiert' : '');
        const multi = YlviMeds.names(meds).length > 1;
        const codes = YlviMeds.codes(meds);
        table(
          multi
            ? [['Ab', 24], ['Medikament', 28], ['Kürzel', 15], ['Dosis', 20], ['Hinweis', CONTENT_W - 87]]
            : [['Ab', 26], ['Medikament', 32], ['Dosis', 22], ['Hinweis', CONTENT_W - 80]],
          rel.map((m) => {
            const when = m.start ? fmtDate(YlviMeds.keyToDate(m.start)) : 'vorher';
            return multi
              ? [when, m.name, codes.get(m.name), YlviMeds.fmtDose(m.dose), m.note || '']
              : [when, m.name, YlviMeds.fmtDose(m.dose), m.note || ''];
          }),
          { boldCol: multi ? 3 : 2 }
        );
        y += 2;

        const cmp = YlviMeds.compare(inRange, meds, weekStart0, weekEnd, now);
        if (cmp.length > 1 || (cmp.length === 1 && within.length === 0)) {
          ensureSpace(8 + 6 + cmp.length * 5.2);
          sectionTitle('Pipi je Dosis', 'im gewählten Zeitraum');
          table(
            [['Dosis', 34], ['Zeitraum', 36], ['Tage', 12, 'right'], ['Pipi', 12, 'right'], ['Ø Pipi/Tag', 20, 'right'],
              ['Versuche', 17, 'right'], ['Ø Vers./Tag', 21, 'right'], ['', 4], ['Längste Pause', CONTENT_W - 156]],
            cmp.map((p) => [
              YlviMeds.compact(meds, p.doses) || 'ohne',
              `${fmtDateShort(p.from)} – ${fmtDate(addDays(p.to, -1))}`,
              String(p.days), String(p.count), fmtNum(p.avg),
              String(p.attempts), fmtNum(p.avgAttempts), '',
              p.longestGap ? fmtDuration(p.longestGap) : '–',
            ]),
            { boldCol: 4 }
          );
          y += 2;
        }
      }
    }

    /* ---------- Legende ---------- */
    ensureSpace(10);
    font('normal', 8.5);
    pipiDot(M + 2, y - 1);
    doc.text('Pipi', M + 5, y);
    let lx = M + 5 + doc.getTextWidth('Pipi') + 7;
    attemptMarker(lx + 1.5, y - 1);
    doc.text('Versuch ohne Erfolg (V)', lx + 4.5, y);
    lx += 4.5 + doc.getTextWidth('Versuch ohne Erfolg (V)') + 7;
    doc.text('* = mit Notiz', lx, y);
    lx += doc.getTextWidth('* = mit Notiz') + 7;
    if (meds.length) {
      doseMarker(lx + 1.5, y - 1);
      doc.text('Dosisänderung', lx + 4.5, y);
    }
    font('normal', 8.5, C.muted);
    doc.text('Zeitleiste je Tag von 0 bis 24 Uhr', A4.w - M, y, { align: 'right' });
    y += 7;

    /* ---------- Wochen ---------- */
    const WEEK_HEAD = 13;
    const weekHeight = WEEK_HEAD + 7 * ROW_H + 5;
    const todayKey = startOfDay(new Date()).getTime();

    for (let w = 0; w < weeks; w++) {
      const ws = addDays(weekStart0, w * 7);
      const we = addDays(ws, 7);
      ensureSpace(weekHeight);
      const wEntries = inRange.filter((e) => e.time >= ws.getTime() && e.time < we.getTime());
      const wDays = Math.max(0, Math.min(7, Math.round((Math.min(we.getTime(), effTo) - ws.getTime()) / 86400000)));

      font('bold', 11);
      doc.text(`KW ${isoWeek(ws)}`, M, y + 4.5);
      const kwW = doc.getTextWidth(`KW ${isoWeek(ws)}`);
      font('normal', 10, C.muted);
      doc.text(`${WD[ws.getDay()]} ${fmtDateShort(ws)} – ${WD[addDays(we, -1).getDay()]} ${fmtDate(addDays(we, -1))}`, M + kwW + 3, y + 4.5);
      font('bold', 9.5);
      const wp = wEntries.filter((e) => !isAttempt(e)).length;
      const wt = wEntries.filter(isAttempt).length;
      doc.text(`Pipi ${wp}${wDays ? ` · Ø ${fmtNum(wp / wDays)}/Tag` : ''}${wt ? ` · Versuche ${wt}` : ''}`, A4.w - M, y + 4.5, { align: 'right' });

      font('normal', 6.5, C.muted);
      for (let hh = 0; hh <= 24; hh += 3) {
        const x = BAR_X + (BAR_W * hh) / 24;
        doc.text(hh === 24 ? '24 Uhr' : String(hh), x, y + 11, { align: hh === 0 ? 'left' : hh === 24 ? 'right' : 'center' });
      }
      y += WEEK_HEAD;

      for (let d = 0; d < 7; d++) {
        const day = addDays(ws, d);
        const next = addDays(day, 1);
        const items = wEntries.filter((e) => e.time >= day.getTime() && e.time < next.getTime());
        const isToday = day.getTime() === todayKey;
        const future = day.getTime() > now;
        const by = y + 1;
        const changed = meds.length && YlviMeds.changesOn(meds, day).length > 0;
        const dl = meds.length ? YlviMeds.compact(meds, YlviMeds.doseOn(meds, day)) : '';

        if (changed) {
          // Akzentlinie über dem Tag der Dosisänderung
          stroke(C.accent);
          doc.setLineWidth(0.5);
          doc.line(M, y + 0.1, A4.w - M, y + 0.1);
        }

        // Tag + Dosis
        font(isToday ? 'bold' : 'normal', 9, future ? C.muted : C.text);
        doc.text(`${WD[day.getDay()]} ${fmtDateShort(day)}`, M, by + BAR_H - 0.8);
        if (dl) {
          if (changed) {
            doseMarker(M + 1.3, by + BAR_H + 2.2);
            font('bold', 6.8, C.accent);
            doc.text(dl, M + 3.6, by + BAR_H + 3.2);
          } else {
            font('normal', 6.8, C.muted);
            doc.text(dl, M, by + BAR_H + 3.2);
          }
        }

        // Balken mit Raster
        fill(C.bar);
        doc.roundedRect(BAR_X, by, BAR_W, BAR_H, 1, 1, 'F');
        doc.setLineWidth(0.15);
        for (let hh = 3; hh < 24; hh += 3) {
          stroke(hh % 6 === 0 ? C.line : [228, 231, 244]);
          const x = BAR_X + (BAR_W * hh) / 24;
          doc.line(x, by, x, by + BAR_H);
        }
        if (isToday) {
          stroke(C.accent);
          doc.setLineWidth(0.4);
          doc.roundedRect(BAR_X, by, BAR_W, BAR_H, 1, 1, 'S');
        }
        // erst Pipi, dann Versuche darüber zeichnen
        for (const e of [...items].sort((a, b) => isAttempt(a) - isAttempt(b))) {
          const t = new Date(e.time);
          marker(e, BAR_X + (BAR_W * (t.getHours() * 60 + t.getMinutes())) / 1440, by + BAR_H / 2);
        }

        // Anzahl rechts
        const nP = items.filter((e) => !isAttempt(e)).length;
        const nT = items.length - nP;
        font(items.length ? 'bold' : 'normal', 9, items.length ? C.text : C.muted);
        doc.text(items.length ? `${nP} Pipi` : (future ? '' : '–'), A4.w - M, by + BAR_H - 0.8, { align: 'right' });
        if (nT) {
          font('bold', 6.8, C.attempt);
          doc.text(`+ ${nT} ${nT === 1 ? 'Versuch' : 'Versuche'}`, A4.w - M, by + BAR_H + 3.2, { align: 'right' });
        }

        // Uhrzeiten unter dem Balken
        if (items.length) {
          font('normal', 6.5, C.muted);
          const txt = items.map((e) => `${fmtTime(new Date(e.time))}${isAttempt(e) ? ' V' : ''}${e.note ? '*' : ''}`).join('    ');
          const lines = doc.splitTextToSize(txt, BAR_W);
          doc.text(lines[0] + (lines.length > 1 ? ' …' : ''), BAR_X, by + BAR_H + 3.2);
        }
        stroke([232, 234, 245]);
        doc.setLineWidth(0.15);
        doc.line(M, y + ROW_H - 0.3, A4.w - M, y + ROW_H - 0.3);
        y += ROW_H;
      }
      y += 5;
    }

    /* ---------- Notizen ---------- */
    const withNotes = inRange.filter((e) => e.note);
    if (opts.includeNotes && withNotes.length) {
      ensureSpace(24);
      y += 2;
      sectionTitle('Notizen', 'in der Zeitleiste mit * markiert');
      const showAuthor = authors.size > 0;
      const cols = showAuthor
        ? [['Datum', 28], ['Zeit', 14], ['Art', 18], ['Von', 22], ['Notiz', CONTENT_W - 82]]
        : [['Datum', 28], ['Zeit', 14], ['Art', 18], ['Notiz', CONTENT_W - 60]];
      table(cols, withNotes.map((e) => {
        const d = new Date(e.time);
        const base = [`${WD[d.getDay()]} ${fmtDate(d)}`, fmtTime(d), isAttempt(e) ? 'Versuch' : 'Pipi'];
        return showAuthor ? [...base, e.author || '', e.note] : [...base, e.note];
      }));
    }

    /* ---------- Fotos ---------- */
    const withPhotos = inRange.filter((e) => e.photo);
    if (opts.includePhotos && withPhotos.length && opts.getPhotoBlob) {
      doc.addPage();
      y = M;
      sectionTitle('Beweisfotos');
      y += 2;
      const cellW = (CONTENT_W - 6) / 2;
      const imgMaxH = 68;
      const cellH = imgMaxH + 12;
      let col = 0;
      for (let i = 0; i < withPhotos.length; i++) {
        const e = withPhotos[i];
        progress(`Fotos werden eingefügt… ${i + 1} von ${withPhotos.length}`);
        if (col === 0 && y + cellH > FOOTER_Y - 4) { doc.addPage(); y = M; }
        const x = M + col * (cellW + 6);
        let img = null;
        try {
          const blob = await opts.getPhotoBlob(e);
          if (blob) img = await blobToJpegDataUrl(blob);
        } catch { img = null; }
        if (img) {
          const ratio = Math.min(cellW / img.w, imgMaxH / img.h);
          const w = img.w * ratio;
          const h = img.h * ratio;
          doc.addImage(img.data, 'JPEG', x + (cellW - w) / 2, y + (imgMaxH - h) / 2, w, h, undefined, 'FAST');
        } else {
          fill(C.bar);
          doc.rect(x, y, cellW, imgMaxH, 'F');
          font('normal', 9, C.muted);
          doc.text('Foto nicht verfügbar', x + cellW / 2, y + imgMaxH / 2, { align: 'center' });
        }
        const d = new Date(e.time);
        marker(e, x + 2, y + imgMaxH + 4);
        font('bold', 8.5);
        doc.text(`${WD[d.getDay()]} ${fmtDate(d)}, ${fmtTime(d)} Uhr${isAttempt(e) ? ' · Versuch ohne Erfolg' : ''}`, x + 5, y + imgMaxH + 5);
        if (e.note) {
          font('normal', 7.5, C.muted);
          const nl = doc.splitTextToSize(e.note, cellW - 5);
          doc.text(nl[0] + (nl.length > 1 ? ' …' : ''), x + 5, y + imgMaxH + 8.6);
        }
        col = (col + 1) % 2;
        if (col === 0) y += cellH;
      }
    }

    /* ---------- Fußzeile ---------- */
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      font('normal', 7.5, C.muted);
      doc.text(`Ylvis Klo-Plan · ${rangeText}`, M, FOOTER_Y);
      doc.text(`Seite ${p} von ${pages}`, A4.w - M, FOOTER_Y, { align: 'right' });
    }

    progress('PDF wird gespeichert…');
    const iso = (d) => fmtDate(d).split('.').reverse().join('-');
    const filename = `Ylvi-Pipi-Protokoll_${iso(weekStart0)}_bis_${iso(addDays(weekEnd, -1))}.pdf`;
    return { blob: doc.output('blob'), filename };
  }

  return { create, loadLib };
})();

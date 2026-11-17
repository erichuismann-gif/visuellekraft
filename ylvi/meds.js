'use strict';

/* =========================================================
   Medikation – gemeinsame Logik für App und PDF
   Eine Änderung: { id, name, dose (mg, 0 = abgesetzt),
                    start ('YYYY-MM-DD' oder null = seit Beginn), note }
   Die Dosis an einem Tag ist die letzte Änderung je Medikament,
   deren Startdatum an oder vor diesem Tag liegt.
   ========================================================= */

const YlviMeds = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const keyToDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  function fmtDose(mg) {
    if (mg === 0) return 'abgesetzt';
    return `${Number(mg).toLocaleString('de-DE', { maximumFractionDigits: 3 })} mg`;
  }

  function sorted(changes) {
    return [...changes].sort((a, b) => {
      if (a.start === b.start) return (a.created || 0) - (b.created || 0);
      if (a.start === null) return -1;
      if (b.start === null) return 1;
      return a.start < b.start ? -1 : 1;
    });
  }

  /** Gültige Dosis je Medikament an einem Tag: [{name, dose, change}] */
  function doseOn(changes, day) {
    const key = typeof day === 'string' ? day : dayKey(day);
    const byName = new Map();
    for (const c of sorted(changes)) {
      if (c.start === null || c.start <= key) byName.set(c.name, c);
    }
    return [...byName.values()].map((c) => ({ name: c.name, dose: c.dose, change: c }));
  }

  const names = (changes) => [...new Set(changes.map((c) => c.name))];

  /** Kurzer Text: bei nur einem Medikament nur die Dosis, sonst "Name Dosis, …" */
  function label(changes, doses, { long = false } = {}) {
    if (!doses.length) return '';
    if (!long && names(changes).length === 1) return fmtDose(doses[0].dose);
    return doses.map((d) => `${d.name} ${fmtDose(d.dose)}`).join(', ');
  }

  const changesOn = (changes, day) => {
    const key = typeof day === 'string' ? day : dayKey(day);
    return changes.filter((c) => c.start === key);
  };

  /** Zeitabschnitte mit gleicher Dosis innerhalb [from, to): [{from, to, doses, label}] */
  function periods(changes, from, to) {
    const result = [];
    if (!changes.length) return result;
    const bounds = [...new Set(changes.map((c) => c.start).filter(Boolean))]
      .map(keyToDate)
      .filter((d) => d > from && d < to)
      .sort((a, b) => a - b);
    const cuts = [startOfDay(from), ...bounds, to];
    for (let i = 0; i < cuts.length - 1; i++) {
      const doses = doseOn(changes, cuts[i]);
      const lbl = label(changes, doses, { long: true });
      const prev = result[result.length - 1];
      if (prev && prev.label === lbl) prev.to = cuts[i + 1];
      else result.push({ from: cuts[i], to: cuts[i + 1], doses, label: lbl });
    }
    return result;
  }

  /**
   * Vergleich der Pipi-Häufigkeit je Dosis-Abschnitt.
   * Gezählt werden nur Tage bis einschließlich heute.
   */
  function compare(entries, changes, from, to, now = Date.now()) {
    const end = Math.min(to.getTime(), addDays(startOfDay(new Date(now)), 1).getTime());
    return periods(changes, from, new Date(Math.max(end, from.getTime())))
      .map((p) => {
        const a = p.from.getTime();
        const b = p.to.getTime();
        const days = Math.round((b - a) / 86400000);
        const times = entries.filter((e) => e.time >= a && e.time < b).map((e) => e.time).sort((x, y) => x - y);
        let gap = 0;
        for (let i = 1; i < times.length; i++) gap = Math.max(gap, times[i] - times[i - 1]);
        return { ...p, days, count: times.length, avg: days ? times.length / days : 0, longestGap: gap };
      })
      .filter((p) => p.days > 0);
  }

  return { fmtDose, sorted, doseOn, label, changesOn, periods, compare, names, dayKey, keyToDate };
})();

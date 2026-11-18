'use strict';
/* Cut detection: turns the per-frame measurements from the scanner into shot changes */
const CutDetect = (() => {
  const SENS = { low: 1.4, medium: 1, high: 0.72 };
  function median(a, s, e) {
    const v = []; for (let i = Math.max(0, s); i < Math.min(a.length, e); i++) v.push(a[i]);
    if (!v.length) return 0; v.sort((x, y) => x - y); return v[v.length >> 1];
  }
  // m = { n, K, fps, h1, d1, h3, hk, br }  ->  [{ f, kind: 'cut'|'dissolve', score }]  (f = first frame of the new shot)
  function detect(m, { sens = 'medium', gradual = true, minShotSec = 0.4 } = {}) {
    const { n, K, fps, h1, d1, h3, hk } = m;
    const T = SENS[sens] || 1;
    const out = [];
    const W = Math.max(8, Math.round(fps * 0.5));
    // ---- hard cuts ----
    for (let i = 1; i < n; i++) {
      const d = d1[i], h = h1[i];
      if (d < 0.035 * T && h < 0.4 * T) continue;
      const med = median(d1, i - W, i - 1) * 0.5 + median(d1, i + 2, i + W) * 0.5;
      const strong = d >= 0.07 * T && d >= 3 * med + 0.015 && h >= 0.1 * T;
      const colour = h >= 0.45 * T && d >= 0.035 * T && d >= 2 * med + 0.01;
      if (!strong && !colour) continue;
      // a flash / strobe returns to the picture it came from
      if (i + 2 < n && h3[i + 2] < 0.35 * h) continue;
      if (i >= 3 && h3[i] < 0.35 * h) continue;
      // keep only the local peak
      if ((i > 1 && d1[i - 1] > d && h1[i - 1] > h * 0.8) || (i + 1 < n && d1[i + 1] > d && h1[i + 1] > h * 0.8)) continue;
      out.push({ f: i, kind: 'cut', score: Math.min(1, Math.max(d * 2.5, h)) });
    }
    // ---- dissolves, fades, and changes the cut test missed ----
    if (gradual && K > 0) {
      const gT = 0.3 * T, minRun = Math.round(K * 0.6), maxRun = K + Math.round(fps * 4);
      let i = K;
      while (i < n) {
        if (hk[i] < gT) { i++; continue; }
        let e = i, peak = 0, gap = 0;
        while (e + 1 < n && (hk[e + 1] >= gT || gap < 2)) { e++; if (hk[e] >= gT) gap = 0; else gap++; if (hk[e] > peak) peak = hk[e]; }
        while (e > i && hk[e] < gT) e--;
        const s = i; i = e + 1;
        const len = e - s + 1;
        if (len < minRun || len > maxRun) continue;
        const before = median(hk, s - K, s - 2), after = median(hk, e + 2, e + K);
        if (before > 0.45 * peak || after > 0.45 * peak || before > gT * 0.8 || after > gT * 0.8) continue;
        const centre = Math.round((s + e - K) / 2) + 1;
        const reach = Math.max(Math.round(K / 2), Math.round((len - K) / 2) + 3);
        if (out.some((c) => Math.abs(c.f - centre) <= reach)) continue;
        if (centre <= 0 || centre >= n) continue;
        out.push({ f: centre, kind: len > K + 3 ? 'dissolve' : 'cut', score: Math.min(1, peak) });
      }
    }
    out.sort((a, b) => a.f - b.f);
    // ---- minimum shot length: keep the stronger of two close changes ----
    const minLen = Math.max(1, Math.round(minShotSec * fps));
    const res = [];
    for (const c of out) {
      const last = res[res.length - 1];
      if (c.f < minLen) continue;
      if (last && c.f - last.f < minLen) { if (c.score > last.score) res[res.length - 1] = c; continue; }
      res.push(c);
    }
    return res;
  }
  return { detect };
})();
if (typeof module !== 'undefined') module.exports = CutDetect;

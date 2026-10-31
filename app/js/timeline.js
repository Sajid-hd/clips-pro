'use strict';
/* Canvas timeline: ruler, clips, waveform, cache stripe, marks, in/out, playhead */
const Timeline = (() => {
  const cv = $('#timeline');
  const ctx = cv.getContext('2d');
  let vs = 0, ve = 1, lastTotal = 0, full = true;
  let drag = null, menuCb = null;
  const ROW = { ruler: 18, gap: 3, clips: 30, wave: 22, cache: 4 };
  const NICE = [1, 2, 5, 10, 12, 24, 25, 48, 50, 100, 120, 240, 250, 500, 1000, 1200, 2400, 5000, 10000, 24000, 50000, 100000, 250000];

  function heights() {
    const hasWave = S.clips.some((c) => c.media.peaks);
    const showCache = Settings.get('showCache');
    const h = ROW.ruler + ROW.gap + ROW.clips + (hasWave ? ROW.gap + ROW.wave : 0) + (showCache ? ROW.gap + ROW.cache : 0) + 2;
    return { h, hasWave, showCache };
  }
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const { h } = heights();
    if (cv.style.height !== h + 'px') cv.style.height = h + 'px';
    const W = Math.max(10, Math.round(cv.clientWidth * dpr)), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  }
  new ResizeObserver(() => { resize(); draw(); }).observe(cv);

  function span() { return Math.max(1e-6, ve - vs); }
  function xOf(f) { return ((f - vs) / span()) * cv.clientWidth; }
  function frameAt(x) { const T = Player.total(); return clamp(Math.floor(vs + (x / cv.clientWidth) * span()), 0, Math.max(0, T - 1)); }

  function setRange(a, b) {
    const T = Math.max(1, Player.total());
    const minSpan = Math.min(T, 12);
    let s = clamp(b - a, minSpan, T);
    a = clamp(a, 0, T - s);
    vs = a; ve = a + s; full = s >= T - 1e-6;
    syncSlider();
  }
  function fit() { setRange(0, Math.max(1, Player.total())); draw(); }
  function syncSlider() {
    const T = Math.max(1, Player.total());
    const minSpan = Math.min(T, 12);
    const r = T <= minSpan ? 0 : Math.log(T / span()) / Math.log(T / minSpan);
    $('#zoom').value = String(Math.round(clamp(r, 0, 1) * 1000));
  }
  function fromSlider(v) {
    const T = Math.max(1, Player.total()); const minSpan = Math.min(T, 12);
    const s = T * Math.pow(minSpan / T, v / 1000);
    const c = S.frame + 0.5;
    setRange(c - s / 2, c + s / 2); draw();
  }
  function zoomAt(x, factor) {
    const f = vs + (x / cv.clientWidth) * span();
    const s = span() * factor;
    setRange(f - (x / cv.clientWidth) * s, f - (x / cv.clientWidth) * s + s); draw();
  }
  function follow() {
    const T = Player.total();
    if (T !== lastTotal) { const wasFull = full || lastTotal === 0; lastTotal = T; if (wasFull) setRange(0, Math.max(1, T)); else setRange(vs, ve); }
    if (full) return;
    const f = S.frame;
    if (f < vs || f >= ve) { const s = span(); const a = S.playing && S.dir > 0 ? f - s * 0.1 : f - s * 0.5; setRange(a, a + s); }
  }

  function labelFor(g) {
    return S.display === 'source' ? String(g + 1) : Player.frameText(g);
  }

  function draw() {
    resize(); follow();
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth; const { hasWave, showCache } = heights();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, cv.height / dpr);
    const T = Player.total();
    const yR = 0, yC = ROW.ruler + ROW.gap, yW = yC + ROW.clips + ROW.gap, yK = (hasWave ? yW + ROW.wave : yC + ROW.clips) + ROW.gap;
    const Hfull = (showCache ? yK + ROW.cache : (hasWave ? yW + ROW.wave : yC + ROW.clips));
    ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--mono');
    ctx.textBaseline = 'top';
    // clip-row background
    ctx.fillStyle = '#141518'; ctx.fillRect(0, yC, W, ROW.clips);
    if (hasWave) ctx.fillRect(0, yW, W, ROW.wave);
    if (!T) { ctx.fillStyle = '#6b6f77'; ctx.fillText('No media', 8, yC + 10); return; }
    const ppf = W / span();

    // ---- ruler ----
    if (ppf >= 26) {
      const a = Math.floor(vs), b = Math.min(T - 1, Math.ceil(ve));
      for (let f = a; f <= b; f++) {
        const x = xOf(f);
        if (f === S.frame) { ctx.fillStyle = '#3d8bfd40'; ctx.fillRect(x, yR, ppf, ROW.ruler); }
        ctx.fillStyle = '#34363c'; ctx.fillRect(Math.round(x), yR, 1, ROW.ruler);
        ctx.fillStyle = f === S.frame ? '#ffffff' : (f % 5 === 0 ? '#9a9ea6' : '#6b6f77');
        ctx.fillText(labelFor(f), x + 3, yR + 4);
      }
    } else {
      let step = NICE.find((n) => n * ppf >= 70) || NICE[NICE.length - 1];
      const minor = step >= 10 ? step / (step % 12 === 0 ? 4 : 5) : 1;
      if (minor * ppf >= 5) {
        ctx.fillStyle = '#2a2c31';
        for (let f = Math.ceil(vs / minor) * minor; f < ve; f += minor) ctx.fillRect(Math.round(xOf(f)), yR + 12, 1, 6);
      }
      for (let f = Math.ceil(vs / step) * step; f < ve; f += step) {
        const x = Math.round(xOf(f));
        ctx.fillStyle = '#3b3e45'; ctx.fillRect(x, yR + 6, 1, 12);
        ctx.fillStyle = '#9a9ea6'; ctx.fillText(labelFor(f), x + 3, yR + 2);
      }
    }

    // ---- clips ----
    const st = Player.starts();
    const cur = Player.curClip();
    if (S.mode === 'sequence') {
      S.clips.forEach((c, i) => {
        const x0 = xOf(st[i]), x1 = xOf(st[i] + Player.len(c));
        if (x1 < 0 || x0 > W) return;
        const isCur = c === cur;
        ctx.fillStyle = isCur ? '#4a7cb0' : (c.media.status === 'ready' || c.media.status === 'loading' ? '#345a80' : '#6a4a2a');
        roundRect(Math.max(x0, -4) + 1, yC + 1, Math.min(x1, W + 4) - Math.max(x0, -4) - 2, ROW.clips - 2, 4); ctx.fill();
        if (isCur) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke(); }
        textIn(c.media.name + (c.mute ? ' (muted)' : ''), Math.max(x0, 0) + 8, yC + 9, Math.min(x1, W) - Math.max(x0, 0) - 14);
      });
    } else {
      const n = S.clips.length; const rh = Math.max(5, (ROW.clips - 2) / n);
      S.clips.forEach((c, i) => {
        const x0 = xOf(0), x1 = xOf(Player.len(c));
        const y = yC + 1 + i * rh;
        ctx.fillStyle = c === cur ? '#4a7cb0' : '#345a80';
        ctx.fillRect(Math.max(0, x0), y, Math.min(W, x1) - Math.max(0, x0), rh - 1);
        if (rh >= 12) textIn(c.media.name, Math.max(0, x0) + 6, y + (rh - 11) / 2, Math.min(W, x1) - 12);
      });
    }

    // ---- waveform ----
    if (hasWave) {
      ctx.fillStyle = '#4fbf7d';
      const mid = yW + ROW.wave / 2, amp = ROW.wave / 2 - 1;
      const hear = Player.hearClip();
      for (let x = 0; x < W; x++) {
        const f0 = vs + (x / W) * span(), f1 = vs + ((x + 1) / W) * span();
        let c, l0, l1;
        if (S.mode === 'sequence') {
          if (f0 >= T) break;
          const L = Player.locate(Math.floor(f0)); c = L.clip;
          l0 = L.local + (f0 - Math.floor(f0)); l1 = l0 + (f1 - f0);
        } else { c = hear; if (!c || f0 >= Player.len(c)) continue; l0 = c.tin + f0; l1 = c.tin + f1; }
        const p = c && c.media.peaks; if (!p || c.mute) continue;
        const r = 100 / c.media.fps;
        const i0 = Math.floor(l0 * r), i1 = Math.max(i0 + 1, Math.ceil(l1 * r));
        let mx = 0; for (let i = i0; i < i1 && i < p.length; i++) if (p[i] > mx) mx = p[i];
        const h = Math.max(0.5, mx * amp);
        ctx.fillRect(x, mid - h, 1, h * 2);
      }
    }

    // ---- cache stripe ----
    if (showCache) {
      ctx.fillStyle = '#2f3136'; ctx.fillRect(0, yK, W, ROW.cache);
      const addRanges = (c, offset) => {
        const b = c.el.buffered; const f = c.media.fps;
        for (let k = 0; k < b.length; k++) {
          const a = offset + b.start(k) * f - c.tin, e = offset + b.end(k) * f - c.tin;
          const lo = Math.max(offset, a), hi = Math.min(offset + Player.len(c), e);
          if (hi > lo) { const x0 = xOf(lo), x1 = xOf(hi); ctx.fillRect(x0, yK, Math.max(1, x1 - x0), ROW.cache); }
        }
      };
      ctx.fillStyle = '#4f8fd9';
      if (S.mode === 'sequence') S.clips.forEach((c, i) => addRanges(c, st[i]));
      else S.clips.forEach((c) => addRanges(c, 0));
    }

    // ---- in / out ----
    if (S.inF != null || S.outF != null) {
      const a = Player.startF(), b = Player.endF() + 1;
      ctx.fillStyle = '#00000070';
      const xa = xOf(a), xb = xOf(b);
      if (xa > 0) ctx.fillRect(0, yC, xa, Hfull - yC);
      if (xb < W) ctx.fillRect(xb, yC, W - xb, Hfull - yC);
      ctx.strokeStyle = '#6aa6ff'; ctx.lineWidth = 2;
      if (S.inF != null) bracket(xa, yC - 2, Hfull - yC + 4, 1);
      if (S.outF != null) bracket(xb, yC - 2, Hfull - yC + 4, -1);
    }

    // ---- marks ----
    ctx.fillStyle = '#e8c27a';
    for (const m of S.marks) {
      const x = xOf(m + 0.5); if (x < -5 || x > W + 5) continue;
      ctx.save(); ctx.translate(x, yR + ROW.ruler - 4); ctx.rotate(Math.PI / 4); ctx.fillRect(-3.5, -3.5, 7, 7); ctx.restore();
    }

    // ---- playhead ----
    const px = ppf >= 26 ? xOf(S.frame) + ppf / 2 : xOf(S.frame + 0.5);
    ctx.fillStyle = '#ff5a4d';
    ctx.fillRect(Math.round(px) - 1, yR, 2, Hfull);
    ctx.beginPath(); ctx.moveTo(px - 5, yR); ctx.lineTo(px + 5, yR); ctx.lineTo(px, yR + 6); ctx.closePath(); ctx.fill();
  }
  function roundRect(x, y, w, h, r) {
    if (w < 0) w = 0; r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function textIn(t, x, y, maxW) {
    if (maxW < 20) return;
    ctx.save(); ctx.beginPath(); ctx.rect(x - 2, y - 4, maxW, 20); ctx.clip();
    ctx.fillStyle = '#ffffff'; ctx.font = '12px ' + getComputedStyle(document.body).getPropertyValue('--font');
    ctx.fillText(t, x, y); ctx.restore();
    ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--mono');
  }
  function bracket(x, y, h, dir) {
    ctx.beginPath(); ctx.moveTo(x + 6 * dir, y); ctx.lineTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + 6 * dir, y + h); ctx.stroke();
  }

  // ---- interaction ----
  cv.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !Player.total()) return;
    const r = cv.getBoundingClientRect(); const x = e.clientX - r.left;
    const T = Player.total();
    const near = (f) => f != null && Math.abs(xOf(f) - x) <= 6;
    if (S.inF != null && near(S.inF)) drag = { kind: 'in' };
    else if (S.outF != null && near(S.outF + 1)) drag = { kind: 'out' };
    else if (e.shiftKey) { const f = frameAt(x); drag = { kind: 'range', a: f }; Player.commit(); S.inF = f; S.outF = f; }
    else { drag = { kind: 'scrub', last: -1 }; }
    if (drag.kind === 'scrub') { const f = frameAt(x); drag.last = f; Player.goto(f, true); }
    const move = (ev) => {
      const xx = ev.clientX - r.left; const f = frameAt(xx);
      if (drag.kind === 'scrub') { if (f !== drag.last) { drag.last = f; Player.goto(f, true); } }
      else if (drag.kind === 'in') { S.inF = clamp(f, 0, S.outF != null ? S.outF : T - 1); Player.goto(S.inF, true); }
      else if (drag.kind === 'out') { S.outF = clamp(f, S.inF != null ? S.inF : 0, T - 1); Player.goto(S.outF, true); }
      else if (drag.kind === 'range') { S.inF = Math.min(drag.a, f); S.outF = Math.max(drag.a, f); Player.goto(f, true); }
      if (xx < 0 && !full) { setRange(vs - span() * 0.02, ve - span() * 0.02); }
      if (xx > r.width && !full) { setRange(vs + span() * 0.02, ve + span() * 0.02); }
      draw();
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); drag = null; draw(); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(); const x = e.clientX - r.left;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const d = (e.deltaX || e.deltaY) / cv.clientWidth * span();
      setRange(vs + d, ve + d); draw();
    } else zoomAt(x, e.deltaY > 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!Player.total()) return;
    const r = cv.getBoundingClientRect(); const f = frameAt(e.clientX - r.left);
    if (menuCb) menuCb(f, e.clientX, e.clientY);
  });

  return { draw, fit, fromSlider, zoomAt, set onMenu(fn) { menuCb = fn; }, isFull: () => full, reset() { lastTotal = 0; } };
})();

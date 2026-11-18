'use strict';
/* Canvas timeline: ruler, clips, waveform, cache stripe, marks, in/out, playhead */
const Timeline = (() => {
  const cv = $('#timeline');
  const ctx = cv.getContext('2d');
  let vs = 0, ve = 1, lastTotal = 0, full = true;
  let drag = null, menuCb = null, hover = null, snapX = null, hoverCut = null;
  const tip = el('div', { id: 'tl-tip', hidden: true }); $('#timeline-wrap').append(tip);
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
        textIn(c.media.name + (c.mute ? ' (muted)' : ''), Math.max(x0, 0) + 8, yC + (S.ranges.length || S.inF != null ? 3 : 9), Math.min(x1, W) - Math.max(x0, 0) - 14);
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

    // ---- numbered ranges ----
    const yB = yC, hB = Hfull - yC;
    const hot = drag && drag.edge ? drag : hover;
    const isHot = (id, e) => hot && hot.id === id && hot.edge === e;
    const selR = Ranges.sel();
    if (selR || (S.inF != null && S.outF != null)) {
      const a = Player.startF(), b = Player.endF() + 1;
      ctx.fillStyle = '#00000070';
      const xa = xOf(a), xb = xOf(b);
      if (xa > 0) ctx.fillRect(0, yC, xa, Hfull - yC);
      if (xb < W) ctx.fillRect(xb, yC, W - xb, Hfull - yC);
    }
    S.ranges.forEach((r, i) => {
      const xa = xOf(r.a), xb = xOf(r.b + 1);
      if (xb < -10 || xa > W + 10) return;
      const on = r.id === S.selRange, off = r.on === false;
      ctx.globalAlpha = off ? 0.45 : 1;
      ctx.fillStyle = on ? '#3d8bfd38' : '#3d8bfd1c'; ctx.fillRect(xa, yB, xb - xa, hB);
      ctx.strokeStyle = on ? '#6aa6ff' : '#4f7fc0'; ctx.lineWidth = on ? 2 : 1.5;
      bracket(xa, yC - 2, hB + 4, 1); bracket(xb, yC - 2, hB + 4, -1);
      // number badge
      const t = Ranges.label(r);
      ctx.font = 'bold 10px ' + getComputedStyle(document.body).getPropertyValue('--font');
      const tw = Math.min(90, ctx.measureText(t).width + 10);
      if (xb - xa >= tw + 4) {
        const cx = clamp((Math.max(xa, 0) + Math.min(xb, W)) / 2, xa + tw / 2 + 2, xb - tw / 2 - 2);
        const by = yC + ROW.clips - 15;
        ctx.fillStyle = on ? '#3d8bfd' : '#2b4f80'; roundRect(cx - tw / 2, by, tw, 13, 3); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save(); ctx.beginPath(); ctx.rect(cx - tw / 2, by, tw, 13); ctx.clip(); ctx.fillText(t, cx, by + 7); ctx.restore();
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      }
      ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--mono');
      ctx.globalAlpha = 1;
      if (isHot(r.id, 'a')) hotEdge(xa, yC, hB, 1);
      if (isHot(r.id, 'b')) hotEdge(xb, yC, hB, -1);
    });
    // In / Out that is not a numbered range yet ( [ pressed, waiting for ] )
    if (!selR && (S.inF != null || S.outF != null)) {
      ctx.strokeStyle = '#6aa6ff'; ctx.lineWidth = 2;
      const xa = xOf(Player.startF()), xb = xOf(Player.endF() + 1);
      if (S.inF != null) { bracket(xa, yC - 2, hB + 4, 1); if (isHot('io', 'a')) hotEdge(xa, yC, hB, 1); }
      if (S.outF != null) { bracket(xb, yC - 2, hB + 4, -1); if (isHot('io', 'b')) hotEdge(xb, yC, hB, -1); }
      if (S.inF != null && S.outF == null) {
        const t = String(S.ranges.length + 1) + ' …'; ctx.font = 'bold 11px ' + getComputedStyle(document.body).getPropertyValue('--font');
        const tw = ctx.measureText(t).width + 10, by = yC + ROW.clips - 15;
        ctx.fillStyle = '#3d8bfd'; roundRect(xa + 4, by, tw, 13, 3); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(t, xa + 9, by + 7); ctx.textBaseline = 'top';
        ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--mono');
      }
    }
    // clip edges (trim)
    if (hot && hot.clip) { const i = S.clips.indexOf(hot.clip); if (i >= 0) { const x = hot.edge === 'a' ? xOf(st[i]) : xOf(st[i] + Player.len(hot.clip)); hotEdge(x, yC, hB, hot.edge === 'a' ? 1 : -1); } }
    if (snapX != null) { ctx.fillStyle = '#ffd166'; ctx.fillRect(Math.round(snapX), 0, 1, Hfull); }

    // ---- marks ----
    ctx.fillStyle = '#e8c27a';
    for (const m of S.marks) {
      const x = xOf(m + 0.5); if (x < -5 || x > W + 5) continue;
      if (hoverCut && hoverCut.mark === m) continue;
      ctx.save(); ctx.translate(x, yR + ROW.ruler - 4); ctx.rotate(Math.PI / 4); ctx.fillRect(-3.5, -3.5, 7, 7); ctx.restore();
    }
    // the cut / mark under the mouse: lit line, bigger dot, and a ✕ to delete the mark
    if (hoverCut && !drag) {
      const xl = hoverCut.mark != null ? xOf(hoverCut.mark + 0.5) : xOf(hoverCut.f);
      ctx.fillStyle = '#ffd16699'; ctx.fillRect(Math.round(xl) - 1, yC, 2, Hfull - yC);
      if (hoverCut.mark != null) {
        ctx.fillStyle = '#ffd166';
        ctx.save(); ctx.translate(xl, yR + ROW.ruler - 5); ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10); ctx.restore();
        const bx = xl + 13, by = yR + 9; hoverCut.bx = bx; hoverCut.by = by;
        ctx.fillStyle = hoverCut.onX ? '#ff5a4d' : '#3a2422'; ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bx - 3, by - 3); ctx.lineTo(bx + 3, by + 3); ctx.moveTo(bx + 3, by - 3); ctx.lineTo(bx - 3, by + 3); ctx.stroke();
      }
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
  // a lit trim edge: bright bar with a soft glow on the inside
  function hotEdge(x, y, h, dir) {
    const g = ctx.createLinearGradient(x, 0, x + 14 * dir, 0);
    g.addColorStop(0, '#6aa6ffaa'); g.addColorStop(1, '#6aa6ff00');
    ctx.fillStyle = g; ctx.fillRect(dir > 0 ? x : x - 14, y, 14, h);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x) - (dir > 0 ? 0 : 3), y - 3, 3, h + 6);
    ctx.fillRect(dir > 0 ? x : x - 9, y - 3, 9, 3); ctx.fillRect(dir > 0 ? x : x - 9, y + h, 9, 3);
  }
  function bracket(x, y, h, dir) {
    ctx.beginPath(); ctx.moveTo(x + 6 * dir, y); ctx.lineTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + 6 * dir, y + h); ctx.stroke();
  }

  // ---- interaction ----
  const EDGE = 6;
  // what is under the mouse: a range edge, the In/Out edge, a clip edge, or a range body
  function hitAt(x, y) {
    const T = Player.total(); if (!T) return null;
    const near = (f) => Math.abs(xOf(f) - x) <= EDGE;
    const cand = [];
    const selR = Ranges.sel();
    const order = selR ? [selR, ...S.ranges.filter((r) => r !== selR)] : S.ranges;
    for (const r of order) {
      if (near(r.a)) cand.push({ id: r.id, edge: 'a', d: Math.abs(xOf(r.a) - x) + (r === selR ? 0 : 0.5) });
      if (near(r.b + 1)) cand.push({ id: r.id, edge: 'b', d: Math.abs(xOf(r.b + 1) - x) + (r === selR ? 0 : 0.5) });
    }
    if (!selR) {
      if (S.inF != null && near(S.inF)) cand.push({ id: 'io', edge: 'a', d: Math.abs(xOf(S.inF) - x) });
      if (S.outF != null && near(S.outF + 1)) cand.push({ id: 'io', edge: 'b', d: Math.abs(xOf(S.outF + 1) - x) });
    }
    if (cand.length) { cand.sort((p, q) => p.d - q.d); return cand[0]; }
    // clip edges in the clip row (sequence mode)
    const yC = ROW.ruler + ROW.gap;
    if (S.mode === 'sequence' && y >= yC && y < yC + ROW.clips) {
      const st = Player.starts();
      for (let i = 0; i < S.clips.length; i++) {
        const c = S.clips[i], x0 = xOf(st[i]), x1 = xOf(st[i] + Player.len(c));
        if (x1 - x0 < 16) continue;
        if (Math.abs(x - x0) <= EDGE && x >= x0 - 2) return { clip: c, edge: 'a' };
        if (Math.abs(x - x1) <= EDGE && x <= x1 + 2) return { clip: c, edge: 'b' };
      }
    }
    return null;
  }
  // a mark (yellow dot) or a cut between two ranges near x
  function cutNear(x) {
    let best = 8, hit = null;
    for (const m of S.marks) { const d = Math.abs(xOf(m + 0.5) - x); if (d < best) { best = d; hit = { f: m, mark: m }; } }
    for (const r of S.ranges) {
      if (!Ranges.cutAt(r.a)) continue;
      const d = Math.abs(xOf(r.a) - x);
      if (d < best) { best = d; hit = { f: r.a, mark: S.marks.has(r.a) ? r.a : (S.marks.has(r.a - 1) ? r.a - 1 : null) }; }
    }
    if (hit) { hit.cut = !!Ranges.cutAt(hit.f) || !!Ranges.cutAt(hit.f + 1); if (!Ranges.cutAt(hit.f) && Ranges.cutAt(hit.f + 1)) hit.f = hit.f + 1; }
    return hit;
  }
  const onBadge = (x, y) => hoverCut && hoverCut.bx != null && Math.hypot(x - hoverCut.bx, y - hoverCut.by) <= 9;
  function snapPoints(skip) {
    const pts = [0, Player.total()];
    for (const r of S.ranges) if (r.id !== skip) pts.push(r.a, r.b + 1);
    for (const m of S.marks) pts.push(m);
    if (S.mode === 'sequence') pts.push(...Player.starts());
    if (skip !== 'io') { if (S.inF != null) pts.push(S.inF); if (S.outF != null) pts.push(S.outF + 1); }
    return pts;
  }
  function snapF(f, skip) {
    snapX = null; if (drag && drag.noSnap) return f;
    let best = 7, bf = null;
    for (const p of snapPoints(skip)) { const d = Math.abs(xOf(p) - xOf(f)); if (d < best) { best = d; bf = p; } }
    if (bf != null) { snapX = xOf(bf); return bf; }
    return f;
  }
  // position (frame boundary) under x, so an edge lands between frames
  const boundaryAt = (x) => clamp(Math.round(vs + (x / cv.clientWidth) * span()), 0, Player.total());
  function showTip(x, text) {
    tip.textContent = text; tip.hidden = false;
    const w = tip.offsetWidth; tip.style.left = clamp(x + 12 - w / 2, 0, cv.clientWidth - w + 12) + 'px';
  }
  const fmtLen = (n) => `${n} ${n === 1 ? 'frame' : 'frames'} (${(n / Player.fps()).toFixed(2)}s)`;
  const fmtD = (d) => (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d) + ' f';
  function setCursor(h) { cv.style.cursor = h ? (h.edge === 'a' ? 'w-resize' : 'e-resize') : 'pointer'; }

  cv.addEventListener('mousemove', (e) => {
    if (drag) return;
    const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
    const keepBadge = onBadge(mx, my);
    const hc = keepBadge ? hoverCut : cutNear(mx);
    const ck = hc ? hc.f + ':' + hc.mark + (keepBadge ? 'x' : '') : '';
    if (ck !== (hoverCut ? hoverCut.f + ':' + hoverCut.mark + (hoverCut.onX ? 'x' : '') : '')) { hoverCut = hc; if (hoverCut) hoverCut.onX = keepBadge; draw(); }
    if (keepBadge) { cv.style.cursor = 'pointer'; cv.title = 'Delete this mark'; return; }
    cv.title = hoverCut ? (hoverCut.cut ? 'Cut — right-click to remove it' : 'Mark — right-click to delete it') : '';
    const h = hitAt(mx, my);
    const k = h ? (h.id || (h.clip && h.clip.id)) + h.edge : '';
    if (k !== (hover ? (hover.id || (hover.clip && hover.clip.id)) + hover.edge : '')) { hover = h; setCursor(h); draw(); }
  });
  cv.addEventListener('mouseleave', () => { if (!drag && (hover || hoverCut)) { hover = null; hoverCut = null; setCursor(null); draw(); } });

  cv.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !Player.total()) return;
    const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    const T = Player.total();
    if (onBadge(x, y) && hoverCut.mark != null) { Ranges.deleteMark(hoverCut.mark); hoverCut = null; draw(); return; }
    const h = hitAt(x, y);
    let committed = false;
    const commitOnce = () => { if (!committed) { Player.commit(); committed = true; } };
    if (h && h.id) {
      // drag a range edge (or the In / Out edge)
      const rg = h.id === 'io' ? null : Ranges.get(h.id);
      if (rg && S.selRange !== rg.id) Ranges.select(rg.id);
      const a0 = rg ? rg.a : Player.startF(), b0 = rg ? rg.b : Player.endF();
      drag = { kind: 'edge', id: h.id, edge: h.edge, a0, b0 };
    } else if (h && h.clip) {
      const c = h.clip;
      drag = { kind: 'clip', clip: c, edge: h.edge, tin: c.tin, tout: c.tout, i: S.clips.indexOf(c), start: Player.starts()[S.clips.indexOf(c)], len0: Player.len(c),
        after: S.ranges.map((q) => ({ q, a: q.a, b: q.b })), marks: [...S.marks] };
    } else if (e.shiftKey) { const f = frameAt(x); drag = { kind: 'range', a: f, noSnap: true }; }
    else { drag = { kind: 'scrub', last: -1 }; const f = frameAt(x); drag.last = f; drag.downF = f; drag.x0 = x; Player.goto(f, true); }
    hover = h; setCursor(h);
    const move = (ev) => {
      const xx = ev.clientX - r.left; const f = frameAt(xx);
      drag.noSnap = ev.altKey || drag.kind === 'range';
      if (drag.kind === 'scrub') { if (f !== drag.last) { drag.last = f; Player.goto(f, true); } if (Math.abs(xx - drag.x0) > 3) drag.moved = true; }
      else if (drag.kind === 'range') {
        if (!drag.made && f !== drag.a) { drag.made = Ranges.add(drag.a, f); }
        if (drag.made) { const a = Math.min(drag.a, f), b = Math.max(drag.a, f); drag.made.a = a; drag.made.b = b; S.inF = a; S.outF = b; }
        Player.goto(f, true);
      } else if (drag.kind === 'edge') {
        commitOnce();
        const rg = drag.id === 'io' ? null : Ranges.get(drag.id);
        let p = snapF(boundaryAt(xx), drag.id);
        if (drag.edge === 'a') {
          const a = clamp(p, 0, drag.b0); if (rg) { rg.a = a; S.inF = a; } else S.inF = Math.min(a, T - 1);
          Player.goto(Math.min(a, T - 1), true);
          showTip(xOf(a), `In ${Player.frameText(Math.min(a, T - 1))}   ${fmtD(a - drag.a0)}   ${fmtLen(drag.b0 - a + 1)}`);
        } else {
          const b = clamp(p - 1, drag.a0, T - 1); if (rg) { rg.b = b; S.outF = b; } else S.outF = b;
          Player.goto(b, true);
          showTip(xOf(b + 1), `Out ${Player.frameText(b)}   ${fmtD(b - drag.b0)}   ${fmtLen(b - drag.a0 + 1)}`);
        }
      } else if (drag.kind === 'clip') {
        commitOnce();
        const c = drag.clip, F = Math.max(1, c.media.frames || drag.tout + 1);
        let d;
        if (drag.edge === 'a') {
          // the clip keeps its place; frames come off (or back on) its start
          const want = snapF(boundaryAt(xx), null) - drag.start;
          d = clamp(want, -drag.tin, drag.tout - drag.tin); c.tin = drag.tin + d; c.auto = false;
          Player.showFrame(drag.start);
          showTip(xOf(drag.start), `Clip start ${c.tin + 1}   ${fmtD(d)}   ${fmtLen(c.tout - c.tin + 1)}`);
        } else {
          const want = snapF(boundaryAt(xx), null) - (drag.start + drag.len0);
          d = clamp(want, drag.tin - drag.tout, F - 1 - drag.tout); c.tout = drag.tout + d; c.auto = false;
          Player.showFrame(drag.start + Player.len(c) - 1);
          showTip(xOf(drag.start + Player.len(c)), `Clip end ${c.tout + 1}   ${fmtD(d)}   ${fmtLen(c.tout - c.tin + 1)}`);
        }
        // ranges and marks after this clip move with it
        const shift = drag.edge === 'a' ? -d : d, end0 = drag.start + drag.len0;
        for (const o of drag.after) { o.q.a = o.a >= end0 ? o.a + shift : o.a; o.q.b = o.b >= end0 ? o.b + shift : o.b; }
        S.marks = new Set(drag.marks.map((m) => (m >= end0 ? m + shift : m)));
        drag.shift = shift;
        Player.layout();
      }
      if (xx < 0 && !full) { setRange(vs - span() * 0.02, ve - span() * 0.02); }
      if (xx > r.width && !full) { setRange(vs + span() * 0.02, ve + span() * 0.02); }
      draw();
    };
    const up = (ev) => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      if (drag.kind === 'scrub' && !drag.moved) {
        // a click inside a numbered range selects it
        const inside = S.ranges.filter((q) => drag.downF >= q.a && drag.downF <= q.b).sort((p, q) => (p.b - p.a) - (q.b - q.a))[0];
        if (inside && S.selRange !== inside.id) { Ranges.select(inside.id); Player.goto(drag.downF); }
      }
      if (drag.kind === 'clip') { const c = drag.clip; if (Player.len(c) !== drag.len0) { Player.fitRanges(); toast(`Clip trimmed ${drag.shift > 0 ? 'longer' : 'shorter'}: ${fmtLen(Player.len(c))}`); } if (typeof App !== 'undefined') App.sessionChanged(); }
      if (drag.kind === 'edge') Ranges.sync();
      drag = null; snapX = null; tip.hidden = true;
      const rr = cv.getBoundingClientRect(); hover = hitAt(ev.clientX - rr.left, ev.clientY - rr.top); setCursor(hover);
      draw();
    };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
    draw();
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
    const cut = cutNear(e.clientX - r.left);
    if (cut) { hoverCut = cut; draw(); if (menuCb) menuCb(f, e.clientX, e.clientY, cut); return; }
    if (menuCb) menuCb(f, e.clientX, e.clientY);
  });

  return { draw, fit, fromSlider, zoomAt, set onMenu(fn) { menuCb = fn; }, isFull: () => full, reset() { lastTotal = 0; } };
})();

'use strict';
/* Arc tracker for animators: coloured trackers follow spots frame by frame; drag to fix; export arcs */
const Tracker = (() => {
  const COLORS = ['#ff9f43', '#4c9aff', '#5fd38d', '#ff5a4f', '#c78bff', '#ffd166', '#4dd0e1', '#ff7eb6'];
  const NAMES = ['Left hand', 'Right hand', 'Waist', 'Head', 'Left foot', 'Right foot', 'Elbow', 'Knee'];
  const opts = { trail: 'all', every: 3, dot: 3 };
  let isOpen = false, sel = null, drag = null, busy = null, msg = '', panel = null, ov = null;
  const viewer = $('#viewer');

  // ---------- data (kept on the media, so it survives mode switches) ----------
  function ctx() {
    const c = Player.curClip(); if (!c) return null;
    const m = c.media;
    if (!m.trk) m.trk = { a: c.tin, b: Math.min(c.tout, c.tin + Math.round(m.fps)), list: [] };
    return { c, m, d: m.trk };
  }
  const local = () => Player.locate(S.frame).local;
  const ptsOf = (t) => Object.keys(t.pts).map(Number).sort((a, b) => a - b);
  function addTracker() {
    const x = ctx(); if (!x) return;
    const n = x.d.list.length;
    const t = { id: uid(), name: NAMES[n % NAMES.length] + (n >= NAMES.length ? ' ' + (Math.floor(n / NAMES.length) + 1) : ''), color: COLORS[n % COLORS.length], pts: {}, lost: null };
    x.d.list.push(t); sel = t.id; msg = ''; render();
  }

  // ---------- geometry: source pixels <-> viewer pixels ----------
  function geom(c) {
    const W = viewer.clientWidth, H = viewer.clientHeight;
    const vw = c.media.w || c.el.videoWidth || 1, vh = c.media.h || c.el.videoHeight || 1;
    const s0 = Math.min(W / vw, H / vh), ox = (W - vw * s0) / 2, oy = (H - vh * s0) / 2;
    return { W, H, s0, ox, oy, v: S.view };
  }
  function toScreen(c, x, y) {
    const g = geom(c); let sx = g.ox + x * g.s0, sy = g.oy + y * g.s0;
    if (g.v.flipX) sx = g.W - sx; if (g.v.flipY) sy = g.H - sy;
    return [g.v.px + sx * g.v.z, g.v.py + sy * g.v.z];
  }
  function toSource(c, X, Y) {
    const g = geom(c); let sx = (X - g.v.px) / g.v.z, sy = (Y - g.v.py) / g.v.z;
    if (g.v.flipX) sx = g.W - sx; if (g.v.flipY) sy = g.H - sy;
    return [(sx - g.ox) / g.s0, (sy - g.oy) / g.s0];
  }

  // ---------- panel ----------
  function seg(values, cur, on) {
    const s = el('div', { class: 'seg' });
    for (const [v, l] of values) { const b = el('button', { class: String(v) === String(cur) ? 'on' : '' }, l); b.addEventListener('click', () => on(v)); s.append(b); }
    return s;
  }
  function render() {
    if (!isOpen) return;
    const x = ctx();
    panel.innerHTML = '';
    const head = el('div', { class: 'panel-head' }, el('h2', {}, 'Trackers'), el('button', { class: 'xbtn', 'aria-label': 'Close trackers', html: ICONS.close, onclick: close }));
    panel.append(head);
    const body = el('div', { class: 'trk-body' });
    panel.append(body);
    if (!x) { body.append(el('div', { class: 'muted' }, 'Open a video first.')); return; }
    if (S.mode !== 'sequence') { body.append(el('div', { class: 'muted' }, 'The tracker works in Sequence mode. Switch to Sequence to track.')); return; }
    const { c, m, d } = x;
    const F = m.frames;
    const num = (v, on) => { const i = el('input', { type: 'text', class: 'field mono', value: String(v + 1), style: 'width:56px;text-align:center' }); i.addEventListener('change', () => { const n = parseInt(i.value, 10); if (isFinite(n)) on(clamp(n - 1, 0, F - 1)); render(); }); i.addEventListener('keydown', (e) => e.stopPropagation()); return i; };
    body.append(el('h3', {}, 'Frames to track'),
      el('div', { class: 'trk-row' }, el('span', { class: 'muted' }, 'From'), num(d.a, (v) => { d.a = Math.min(v, d.b); }), el('button', { class: 'chip', onclick: () => { d.a = Math.min(local(), d.b); render(); } }, 'Now'),
        el('span', { class: 'muted' }, 'To'), num(d.b, (v) => { d.b = Math.max(v, d.a); }), el('button', { class: 'chip', onclick: () => { d.b = Math.max(local(), d.a); render(); } }, 'Now')),
      el('div', { class: 'muted small' }, `${d.b - d.a + 1} frames · now on frame ${local() + 1}`));
    if (c.rot || c.fh || c.fv) body.append(el('div', { class: 'warn' }, 'This clip is rotated or flipped. Reset it (right-click → Rotate / flip) for accurate tracking.'));
    body.append(el('h3', {}, 'Trackers'));
    const list = el('div', { class: 'trk-list' });
    for (const t of d.list) {
      const n = ptsOf(t).filter((f) => f >= d.a && f <= d.b);
      const status = t.lost != null ? `Lost at frame ${t.lost + 1} – drag the dot to fix it` : !n.length ? 'No dot yet – click the picture' : n.length >= d.b - d.a + 1 ? `Tracked frames ${d.a + 1} – ${d.b + 1}` : `${n.length} of ${d.b - d.a + 1} frames`;
      const sw = el('input', { type: 'color', value: t.color, class: 'trk-color', title: 'Colour' });
      sw.addEventListener('input', () => { t.color = sw.value; App.dirty = true; });
      const name = el('input', { type: 'text', value: t.name, class: 'trk-name' });
      name.addEventListener('change', () => { t.name = name.value || t.name; });
      name.addEventListener('keydown', (e) => e.stopPropagation());
      const del = el('button', { class: 'xbtn', style: 'width:24px;height:24px', 'aria-label': 'Delete tracker', html: ICONS.close, onclick: (e) => { e.stopPropagation(); d.list = d.list.filter((q) => q !== t); if (sel === t.id) sel = d.list[0] ? d.list[0].id : null; render(); } });
      const row = el('div', { class: 'trk-item' + (sel === t.id ? ' on' : '') + (t.lost != null ? ' lost' : '') }, sw, el('div', { class: 'trk-mid' }, name, el('div', { class: 'small ' + (t.lost != null ? 'bad' : 'muted') }, status)), del);
      row.addEventListener('mousedown', (e) => { if (e.target === name || e.target === sw) return; sel = t.id; render(); });
      list.append(row);
    }
    body.append(list, el('button', { class: 'secondary', style: 'height:32px', onclick: addTracker }, '+ Add tracker'));
    const tr = d.list.find((q) => q.id === sel);
    body.append(el('h3', {}, 'Follow'),
      busy ? el('div', { class: 'trk-busy' }, el('span', {}, busy.text), el('button', { class: 'secondary', style: 'height:28px', onclick: () => { busy.cancel = true; } }, 'Stop'))
        : el('div', { style: 'display:flex;flex-direction:column;gap:6px' },
          el('button', { class: 'primary', style: 'height:34px', disabled: !d.list.length, onclick: () => trackAll() }, `Track frames ${d.a + 1} – ${d.b + 1}`),
          el('button', { class: 'secondary', style: 'height:32px', disabled: !tr || !tr.pts[local()], onclick: () => trackOn(tr) }, 'Track on from here')),
      msg ? el('div', { class: 'small ' + (/lost/i.test(msg) ? 'bad' : 'muted') }, msg) : null);
    body.append(el('h3', {}, 'Show'),
      el('div', { class: 'trk-row' }, el('span', { class: 'muted', style: 'width:90px' }, 'Arc trail'), seg([['all', 'All'], ['now', 'To now'], ['off', 'Off']], opts.trail, (v) => { opts.trail = v; render(); App.dirty = true; })),
      el('div', { class: 'trk-row' }, el('span', { class: 'muted', style: 'width:90px' }, 'Number every'), seg([[0, 'Off'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, opts.every >= 6 ? String(opts.every) : '6+']], Math.min(opts.every, 6), (v) => { opts.every = v === 6 ? (opts.every >= 6 ? (opts.every >= 12 ? 6 : opts.every + 2) : 6) : v; render(); App.dirty = true; })),
      el('div', { class: 'muted small', style: 'margin:-4px 0 0 98px' }, opts.every ? `Big numbered dot every ${opts.every} frame${opts.every > 1 ? 's' : ''}` : 'No numbers'),
      el('label', { class: 'trk-row' }, el('span', { class: 'muted', style: 'width:90px' }, 'Dot size'), (() => { const r = el('input', { type: 'range', min: 1, max: 8, value: opts.dot, style: 'flex:1' }); r.addEventListener('input', () => { opts.dot = +r.value; App.dirty = true; }); return r; })()));
    body.append(el('button', { class: 'secondary', style: 'height:34px;margin-top:4px', disabled: !d.list.some((t) => ptsOf(t).length), onclick: () => exportDialog() }, 'Export arcs…'));
    const hint = tr ? (tr.pts[local()] ? `Drag the ${tr.name} dot to fix it on frame ${local() + 1}` : `Click the picture to place the ${tr.name} dot on frame ${local() + 1}`) : 'Add a tracker, then click the picture to place its dot.';
    body.append(el('div', { class: 'trk-hint' }, hint));
  }

  function open() {
    if (!S.clips.length) { toast('Open a video first'); return; }
    if (S.playing) Player.pause();
    if (!panel) {
      panel = el('aside', { id: 'trk-panel' });
      ov = el('canvas', { id: 'trk-ov' });
      viewer.append(ov);
      $('#main').insertBefore(panel, viewer);
      ov.addEventListener('mousedown', onDown);
      ov.addEventListener('wheel', (e) => { e.preventDefault(); const r = viewer.getBoundingClientRect(); Player.zoomAbout(e.clientX - r.left, e.clientY - r.top, S.view.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
      ov.addEventListener('contextmenu', (e) => e.stopPropagation());
    }
    isOpen = true; panel.hidden = false; ov.hidden = false;
    const x = ctx(); if (x && !x.d.list.length) addTracker(); else if (x && !sel && x.d.list[0]) sel = x.d.list[0].id;
    render(); App.dirty = true;
  }
  function close() { isOpen = false; if (panel) { panel.hidden = true; ov.hidden = true; } if (busy) busy.cancel = true; App.dirty = true; }

  // ---------- overlay drawing ----------
  let lastSig = '';
  function draw() {
    if (!isOpen || !ov) return;
    const dpr = devicePixelRatio || 1, W = viewer.clientWidth, H = viewer.clientHeight;
    if (ov.width !== Math.round(W * dpr) || ov.height !== Math.round(H * dpr)) { ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr); }
    const g = ov.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const x = ctx(); if (!x || S.mode !== 'sequence') return;
    const L = Player.locate(S.frame); if (L.clip !== x.c) return;
    const cur = L.local, d = x.d;
    const sig = cur + '|' + d.a + '|' + d.b; if (sig !== lastSig) { lastSig = sig; render(); }
    for (const t of d.list) paintTracker(g, t, d, cur, (sx, sy) => toScreen(x.c, sx, sy), 1, t.id === sel);
  }
  function paintTracker(g, t, d, cur, map, scale, isSel) {
    const r = opts.dot * scale;
    let frames = ptsOf(t).filter((f) => f >= d.a && f <= d.b);
    if (opts.trail === 'now') frames = frames.filter((f) => f <= cur);
    if (opts.trail === 'off') frames = frames.filter((f) => f === cur);
    if (frames.length > 1) {
      g.beginPath(); frames.forEach((f, i) => { const [X, Y] = map(t.pts[f].x, t.pts[f].y); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      g.strokeStyle = t.color; g.globalAlpha = 0.85; g.lineWidth = Math.max(1.5, 0.8 * r); g.lineJoin = 'round'; g.stroke(); g.globalAlpha = 1;
    }
    for (const f of frames) {
      const [X, Y] = map(t.pts[f].x, t.pts[f].y);
      const big = opts.every > 0 && (f - d.a) % opts.every === 0;
      g.beginPath(); g.arc(X, Y, big ? r * 2.6 : r * 1.1, 0, Math.PI * 2);
      g.fillStyle = t.color; g.fill();
      if (t.pts[f].m) { g.lineWidth = Math.max(1, r * 0.4); g.strokeStyle = '#ffffff'; g.stroke(); }
      if (big) {
        g.font = `600 ${Math.round(Math.max(11, r * 4.2))}px Segoe UI, system-ui, sans-serif`; g.textBaseline = 'top';
        g.lineWidth = Math.max(2, r * 0.9); g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(String(f + 1), X - r * 2, Y + r * 3);
        g.fillStyle = '#f1f2f4'; g.fillText(String(f + 1), X - r * 2, Y + r * 3);
      }
    }
    const p = t.pts[cur];
    if (p) { const [X, Y] = map(p.x, p.y); g.beginPath(); g.arc(X, Y, r * 3.6 + 2, 0, Math.PI * 2); g.strokeStyle = isSel ? '#ffffff' : 'rgba(255,255,255,.55)'; g.lineWidth = isSel ? 2 : 1.2; g.stroke(); }
    if (t.lost != null && t.pts[t.lost]) { const [X, Y] = map(t.pts[t.lost].x, t.pts[t.lost].y); g.beginPath(); g.arc(X, Y, r * 5, 0, Math.PI * 2); g.strokeStyle = '#ff5a4d'; g.lineWidth = 2; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]); }
  }

  // ---------- mouse: place / drag dots ----------
  function onDown(e) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const x = ctx(); if (!x || busy) return;
    const L = Player.locate(S.frame); if (L.clip !== x.c) return;
    const cur = L.local, r = viewer.getBoundingClientRect();
    const X = e.clientX - r.left, Y = e.clientY - r.top;
    let hit = null, best = 16;
    for (const t of x.d.list) { const p = t.pts[cur]; if (!p) continue; const [sx, sy] = toScreen(x.c, p.x, p.y); const dd = Math.hypot(sx - X, sy - Y); if (dd < best) { best = dd; hit = t; } }
    let t = hit || x.d.list.find((q) => q.id === sel);
    if (!t) { addTracker(); t = x.d.list[x.d.list.length - 1]; }
    sel = t.id;
    const set = (cx, cy) => { const [sx, sy] = toSource(x.c, cx, cy); t.pts[cur] = { x: clamp(sx, 0, x.m.w - 1), y: clamp(sy, 0, x.m.h - 1), m: true }; if (t.lost === cur || t.lost != null) t.lost = null; App.dirty = true; };
    set(X, Y);
    if (cur < x.d.a) x.d.a = cur; if (cur > x.d.b) x.d.b = cur;
    const mv = (ev) => set(ev.clientX - r.left, ev.clientY - r.top);
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); render(); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
    render();
  }

  // ---------- frames for tracking (greyscale, scaled) ----------
  async function grayFrames(c, from, count, maxW = 960) {
    const m = c.media; const W0 = m.w || c.el.videoWidth, H0 = m.h || c.el.videoHeight;
    const w = Math.max(2, Math.min(maxW, W0) & ~1), h = Math.max(2, Math.round((H0 * w) / W0 / 2) * 2);
    if (API && m.path) {
      const r = await API.grayFrames({ path: m.path, startSec: frameSec(from, m.fps), count, w, h });
      if (r && r.ok) { const data = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data); return { w, h, sc: w / W0, count: r.count, get: (k) => data.subarray(k * w * h, (k + 1) * w * h) }; }
    }
    // fallback: seek a hidden copy of the video
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = m.playUrl;
    await new Promise((res) => { v.addEventListener('loadeddata', res, { once: true }); setTimeout(res, 4000); });
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d', { willReadFrequently: true });
    const out = [];
    for (let k = 0; k < count; k++) {
      v.currentTime = (from + k + 0.5) / m.fps;
      await new Promise((res) => { v.addEventListener('seeked', res, { once: true }); setTimeout(res, 2000); });
      g.drawImage(v, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data; const gr = new Uint8Array(w * h);
      for (let i = 0, j = 0; i < gr.length; i++, j += 4) gr[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
      out.push(gr);
    }
    v.removeAttribute('src'); v.load();
    return { w, h, sc: w / W0, count: out.length, get: (k) => out[k] };
  }

  // normalised template around (cx,cy)
  function tmpl(img, w, h, cx, cy, T) {
    const r = T >> 1, x0 = Math.round(cx) - r, y0 = Math.round(cy) - r;
    if (x0 < 0 || y0 < 0 || x0 + T > w || y0 + T > h) return null;
    const t = new Float32Array(T * T); let s = 0;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const v = img[(y0 + y) * w + x0 + x]; t[y * T + x] = v; s += v; }
    const mean = s / (T * T); let n = 0;
    for (let i = 0; i < t.length; i++) { t[i] -= mean; n += t[i] * t[i]; }
    n = Math.sqrt(n) || 1; for (let i = 0; i < t.length; i++) t[i] /= n;
    return t;
  }
  function nccAt(img, w, h, t, T, cx, cy) {
    const r = T >> 1, x0 = cx - r, y0 = cy - r;
    if (x0 < 0 || y0 < 0 || x0 + T > w || y0 + T > h) return -2;
    let s = 0, s2 = 0, st = 0;
    for (let y = 0; y < T; y++) { const row = (y0 + y) * w + x0, tr = y * T; for (let x = 0; x < T; x++) { const v = img[row + x]; s += v; s2 += v * v; st += t[tr + x] * v; } }
    const n = T * T, varI = s2 - (s * s) / n;
    if (varI < 1e-3) return 0;
    return st / Math.sqrt(varI);
  }
  function search(img, w, h, t, T, px, py, R) {
    let best = -2, bx = Math.round(px), by = Math.round(py);
    const cx0 = Math.round(px), cy0 = Math.round(py);
    // coarse (step 2) then fine (step 1)
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) { const s = nccAt(img, w, h, t, T, cx0 + dx, cy0 + dy); if (s > best) { best = s; bx = cx0 + dx; by = cy0 + dy; } }
    const fx = bx, fy = by;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const s = nccAt(img, w, h, t, T, fx + dx, fy + dy); if (s > best) { best = s; bx = fx + dx; by = fy + dy; } }
    // sub-pixel
    const sL = nccAt(img, w, h, t, T, bx - 1, by), sR = nccAt(img, w, h, t, T, bx + 1, by), sU = nccAt(img, w, h, t, T, bx, by - 1), sD = nccAt(img, w, h, t, T, bx, by + 1);
    const ox = sL > -2 && sR > -2 ? clamp((sL - sR) / (2 * (sL - 2 * best + sR) || 1), -0.5, 0.5) : 0;
    const oy = sU > -2 && sD > -2 ? clamp((sU - sD) / (2 * (sU - 2 * best + sD) || 1), -0.5, 0.5) : 0;
    return { x: bx + ox, y: by + oy, score: best };
  }

  // track one tracker from frame `start` (must have a point) towards `end` (either direction)
  async function trackOne(c, t, start, end, job) {
    const dir = end >= start ? 1 : -1;
    const lo = Math.min(start, end), hi = Math.max(start, end);
    for (let f = start + dir; dir > 0 ? f <= hi : f >= lo; f += dir) if (t.pts[f] && !t.pts[f].m) delete t.pts[f];
    const CH = 48;
    let k = start;
    let p = t.pts[start], prev = null, base = null, cur = null, T = 21, R = 24, sc = 1;
    while ((dir > 0 ? k < hi : k > lo) && !job.cancel) {
      const a = dir > 0 ? k : Math.max(lo, k - CH);
      const b = dir > 0 ? Math.min(hi, k + CH) : k;
      const fr = await grayFrames(c, a, b - a + 1);
      if (!fr.count) break;
      sc = fr.sc;
      T = Math.max(15, Math.round(fr.w * 0.024)) | 1; R = Math.max(12, Math.round(fr.w * 0.035));
      const at = (f) => fr.get(f - a);
      if (!base) { base = tmpl(at(k), fr.w, fr.h, p.x * sc, p.y * sc, T); cur = base; }
      if (!base) { t.lost = k; return false; }
      for (let f = k + dir; dir > 0 ? f <= b : f >= a; f += dir) {
        if (job.cancel) return true;
        const img = at(f);
        if (t.pts[f] && t.pts[f].m) { p = t.pts[f]; prev = null; cur = tmpl(img, fr.w, fr.h, p.x * sc, p.y * sc, T) || cur; base = cur; k = f; continue; }
        const vx = prev ? (p.x - prev.x) * sc : 0, vy = prev ? (p.y - prev.y) * sc : 0;
        const blend = new Float32Array(T * T); let n = 0;
        for (let i = 0; i < blend.length; i++) { blend[i] = 0.6 * cur[i] + 0.4 * base[i]; n += blend[i] * blend[i]; }
        n = Math.sqrt(n) || 1; for (let i = 0; i < blend.length; i++) blend[i] /= n;
        const r = search(img, fr.w, fr.h, blend, T, p.x * sc + vx, p.y * sc + vy, R);
        if (r.score < 0.5) { t.lost = f; t.pts[f] = { x: p.x + vx / sc, y: p.y + vy / sc, m: false, lost: true }; return false; }
        prev = p; p = { x: r.x / sc, y: r.y / sc, m: false };
        t.pts[f] = p;
        cur = tmpl(img, fr.w, fr.h, r.x, r.y, T) || cur;
        k = f;
        job.text = `Tracking ${t.name}… frame ${f + 1}`;
        if ((f - start) % 4 === 0) { App.dirty = true; Player.goto(Player.starts()[S.clips.indexOf(c)] + (f - c.tin)); render(); await new Promise((res) => setTimeout(res, 0)); }
      }
      k = dir > 0 ? b : a;
    }
    return true;
  }

  async function runJob(fn) {
    if (busy) return;
    busy = { cancel: false, text: 'Reading frames…' }; msg = ''; render();
    try { await fn(busy); } catch (e) { msg = 'Tracking stopped: ' + e.message; }
    busy = null; render(); App.dirty = true;
  }
  function trackAll() {
    const x = ctx(); if (!x) return;
    runJob(async (job) => {
      const { c, d } = x; const lost = [];
      for (const t of d.list) {
        if (job.cancel) break;
        t.lost = null;
        const fs = ptsOf(t).filter((f) => f >= d.a && f <= d.b && t.pts[f].m);
        if (!fs.length) continue;
        const first = fs[0];
        const ok1 = await trackOne(c, t, first, d.b, job);
        let ok2 = true; if (ok1 && first > d.a && !job.cancel) ok2 = await trackOne(c, t, first, d.a, job);
        if (!ok1 || !ok2) lost.push(t);
      }
      const noDot = d.list.filter((t) => !ptsOf(t).some((f) => f >= d.a && f <= d.b));
      if (lost.length) { const t = lost[0]; sel = t.id; msg = `${t.name}: lost the spot at frame ${t.lost + 1}. Drag the dot to fix it, then press Track on from here.`; Player.goto(Player.starts()[S.clips.indexOf(c)] + (t.lost - c.tin)); }
      else if (job.cancel) msg = 'Stopped.';
      else msg = noDot.length ? `Done. ${noDot.map((t) => t.name).join(', ')} still need a dot.` : `Done: frames ${d.a + 1} – ${d.b + 1} tracked.`;
    });
  }
  function trackOn(t) {
    const x = ctx(); if (!x || !t) return;
    const f = local(); if (!t.pts[f]) return;
    t.pts[f].m = true; t.lost = null;
    runJob(async (job) => {
      const ok = await trackOne(x.c, t, f, x.d.b, job);
      if (!ok) { msg = `${t.name}: lost the spot at frame ${t.lost + 1}. Drag the dot to fix it, then press Track on from here.`; Player.goto(Player.starts()[S.clips.indexOf(x.c)] + (t.lost - x.c.tin)); }
      else msg = job.cancel ? 'Stopped.' : `Done: ${t.name} tracked to frame ${x.d.b + 1}.`;
    });
  }

  // ---------- export arcs ----------
  async function frameImage(m, v, f) {
    v.currentTime = (f + 0.5) / m.fps;
    await new Promise((res) => { v.addEventListener('seeked', res, { once: true }); setTimeout(res, 3000); });
    return v;
  }
  function exportDialog() {
    const x = ctx(); if (!x) return;
    const { c, m, d } = x;
    const st = { a: d.a, b: d.b, ghosts: 5, ghostAlpha: 25, bg: 'picture', out: 'single', csv: true, show: new Set(d.list.map((t) => t.id)) };
    const body = el('div', { class: 'mb' });
    const draw = () => {
      body.innerHTML = '';
      const n = (v, on) => { const i = el('input', { type: 'text', class: 'field mono', value: String(v + 1), style: 'width:64px;text-align:center' }); i.addEventListener('change', () => { const q = parseInt(i.value, 10); if (isFinite(q)) on(clamp(q - 1, 0, m.frames - 1)); draw(); }); return i; };
      const segRow = (label, vals, cur, on) => el('div', { class: 'trk-row' }, el('span', { class: 'muted', style: 'width:130px' }, label), seg(vals, cur, (v) => { on(v); draw(); }));
      body.append(
        el('div', { class: 'trk-row' }, el('span', { class: 'muted', style: 'width:130px' }, 'Frames'), n(st.a, (v) => { st.a = Math.min(v, st.b); }), el('span', { class: 'muted' }, 'to'), n(st.b, (v) => { st.b = Math.max(v, st.a); }), el('span', { class: 'muted' }, `${st.b - st.a + 1} frames`)),
        el('div', { class: 'trk-row', style: 'flex-wrap:wrap' }, el('span', { class: 'muted', style: 'width:130px' }, 'Trackers'), ...d.list.map((t) => { const cb = el('input', { type: 'checkbox' }); cb.checked = st.show.has(t.id); cb.addEventListener('change', () => { if (cb.checked) st.show.add(t.id); else st.show.delete(t.id); }); return el('label', { class: 'check' }, cb, el('span', { style: `color:${t.color}` }, '●'), t.name); })),
        el('div', { class: 'trk-row' }, el('span', { class: 'muted', style: 'width:130px' }, 'Ghost images'), (() => { const r = el('input', { type: 'range', min: 0, max: 12, value: st.ghosts, style: 'width:160px' }); const o = el('span', { class: 'mono' }, String(st.ghosts)); r.addEventListener('input', () => { st.ghosts = +r.value; o.textContent = r.value; }); return el('span', { style: 'display:flex;gap:8px;align-items:center' }, r, o); })()),
        el('div', { class: 'trk-row' }, el('span', { class: 'muted', style: 'width:130px' }, 'Ghost opacity'), (() => { const r = el('input', { type: 'range', min: 5, max: 70, value: st.ghostAlpha, style: 'width:160px' }); const o = el('span', { class: 'mono' }, st.ghostAlpha + '%'); r.addEventListener('input', () => { st.ghostAlpha = +r.value; o.textContent = r.value + '%'; }); return el('span', { style: 'display:flex;gap:8px;align-items:center' }, r, o); })()),
        segRow('Background', [['picture', 'The picture'], ['dark', 'Dark'], ['transparent', 'Transparent']], st.bg, (v) => { st.bg = v; }),
        segRow('Save as', [['single', 'One image'], ['frames', 'PNG per frame'], ['sheet', 'Contact sheet'], ['all', 'All']], st.out, (v) => { st.out = v; }),
        (() => { const cb = el('input', { type: 'checkbox', id: 'arc-csv' }); cb.checked = st.csv; cb.addEventListener('change', () => { st.csv = cb.checked; }); return el('label', { class: 'check', for: 'arc-csv' }, cb, 'Also save positions as CSV (frame, x, y per tracker)'); })(),
        prog);
    };
    const prog = el('div', { class: 'muted' });
    const go = el('button', { class: 'primary' }, 'Save…');
    const h = Modal.open({ title: 'Export arcs', width: 640, body, footer: el('div', { class: 'mf' }, el('button', { class: 'secondary', onclick: () => h.close() }, 'Cancel'), go) });
    draw();
    go.addEventListener('click', async () => {
      const base = m.name.replace(/\.[^.]+$/, '') + `_arcs_${st.a + 1}-${st.b + 1}`;
      let dir = null;
      if (API) { dir = await API.saveDialog({ title: 'Choose a folder for the arcs', defaultPath: await API.defaultDir(), folder: true }); if (!dir) return; }
      go.disabled = true;
      try { await doExport(c, m, d, st, base, dir, (t) => { prog.textContent = t; }); prog.textContent = 'Saved.'; toast('Arcs exported'); if (API) setTimeout(() => h.close(), 600); }
      catch (e) { prog.textContent = 'Export failed: ' + e.message; }
      go.disabled = false;
    });
  }
  async function doExport(c, m, d, st, base, dir, say) {
    const trs = d.list.filter((t) => st.show.has(t.id));
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = m.playUrl;
    await new Promise((res) => { v.addEventListener('loadeddata', res, { once: true }); setTimeout(res, 5000); });
    const W = v.videoWidth || m.w, H = v.videoHeight || m.h;
    const scale = Math.max(1, W / 1280);
    const sep = API && API.platform === 'win32' ? '\\' : '/';
    const save = async (name, blob) => { if (API) await API.writeFile(dir + sep + name, new Uint8Array(await blob.arrayBuffer())); else await saveBlob(blob, name, 'File', blob.type, name.slice(name.lastIndexOf('.'))); };
    const toBlob = (cv) => new Promise((res) => cv.toBlob(res, 'image/png'));
    const ghostFrames = () => { const n = st.ghosts; if (!n) return []; const out = []; for (let i = 0; i < n; i++) out.push(Math.round(st.a + ((st.b - st.a) * i) / Math.max(1, n - 1))); return [...new Set(out)]; };
    async function paintBase(g, f, w, h, sx) {
      if (st.bg === 'dark') { g.fillStyle = '#161719'; g.fillRect(0, 0, w, h); }
      else if (st.bg === 'picture') { await frameImage(m, v, f); g.drawImage(v, 0, 0, w, h); }
    }
    async function paintGhosts(g, w, h, skip) {
      for (const f of ghostFrames()) { if (f === skip) continue; await frameImage(m, v, f); g.globalAlpha = st.ghostAlpha / 100; g.drawImage(v, 0, 0, w, h); g.globalAlpha = 1; }
    }
    const opt0 = opts.trail;
    const paint = (g, upTo, k) => { opts.trail = upTo == null ? 'all' : 'now'; for (const t of trs) paintTracker(g, t, { a: st.a, b: st.b }, upTo == null ? st.b : upTo, (sx, sy) => [sx * k, sy * k], scale * k, false); opts.trail = opt0; };
    // one image: background (first frame) + ghosts + all arcs
    if (st.out === 'single' || st.out === 'all') {
      say('Drawing the arcs…');
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
      await paintBase(g, st.a, W, H); await paintGhosts(g, W, H, st.bg === 'picture' ? st.a : null); paint(g, null, 1);
      await save(base + '.png', await toBlob(cv));
    }
    if (st.out === 'frames' || st.out === 'all') {
      for (let f = st.a; f <= st.b; f++) {
        say(`Frame ${f + 1} of ${st.b + 1}…`);
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
        if (st.bg !== 'picture') await paintGhosts(g, W, H, null);
        await paintBase(g, f, W, H); paint(g, f, 1);
        await save(`${base}_${String(f + 1).padStart(4, '0')}.png`, await toBlob(cv));
      }
    }
    if (st.out === 'sheet' || st.out === 'all') {
      const n = st.b - st.a + 1, tw = Math.min(480, W), th = Math.round((H * tw) / W);
      const cols = Math.min(n, Math.max(1, Math.ceil(Math.sqrt((n * th) / tw * 1.6)))), rows = Math.ceil(n / cols), padY = 26;
      const cv = document.createElement('canvas'); cv.width = cols * tw; cv.height = rows * (th + padY); const g = cv.getContext('2d');
      if (st.bg !== 'transparent') { g.fillStyle = '#101113'; g.fillRect(0, 0, cv.width, cv.height); }
      for (let i = 0; i < n; i++) {
        const f = st.a + i, cx = (i % cols) * tw, cy = Math.floor(i / cols) * (th + padY);
        say(`Contact sheet ${i + 1} of ${n}…`);
        g.save(); g.translate(cx, cy); g.beginPath(); g.rect(0, 0, tw, th); g.clip();
        if (st.bg === 'picture') { await frameImage(m, v, f); g.drawImage(v, 0, 0, tw, th); } else if (st.bg === 'dark') { g.fillStyle = '#161719'; g.fillRect(0, 0, tw, th); }
        paint(g, f, tw / W); g.restore();
        g.fillStyle = '#e6e7ea'; g.font = '600 14px Segoe UI, system-ui, sans-serif'; g.textBaseline = 'top'; g.fillText('Frame ' + (f + 1), cx + 6, cy + th + 5);
      }
      await save(base + '_contact_sheet.png', await toBlob(cv));
    }
    if (st.csv) {
      const rows = ['tracker,frame,x,y,set_by'];
      for (const t of trs) for (const f of ptsOf(t)) if (f >= st.a && f <= st.b) rows.push(`"${t.name.replace(/"/g, '""')}",${f + 1},${t.pts[f].x.toFixed(2)},${t.pts[f].y.toFixed(2)},${t.pts[f].m ? 'hand' : 'tracked'}`);
      await save(base + '_positions.csv', new Blob([rows.join('\r\n')], { type: 'text/csv' }));
    }
    v.removeAttribute('src'); v.load();
    if (API && dir) API.showInFolder(dir + sep + (st.out === 'frames' ? `${base}_${String(st.a + 1).padStart(4, '0')}.png` : st.out === 'sheet' ? base + '_contact_sheet.png' : st.csv && st.out === 'none' ? base + '_positions.csv' : base + '.png'));
  }

  return { open, close, toggle: () => (isOpen ? close() : open()), draw, isOpen: () => isOpen, exportDialog: () => { if (!isOpen) open(); exportDialog(); }, _ctx: ctx, _trackAll: trackAll };
})();

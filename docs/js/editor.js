'use strict';
/* Full editor (Resolve-style): media bin, layered timeline, inspector with keyframes, compositor, export */
const Editor = (() => {
  const VID = 'v', AUD = 'a', TTL = 't';
  const E = {
    tracks: [], clips: [], sel: new Set(), ph: 0, playing: false, tool: 'select', snap: true, link: true, scrub: true,
    proj: null, vs: 0, ve: 240, inF: null, outF: null, view: 'timeline', src: null, srcIn: null, srcOut: null, tab: 'media',
  };
  const hist = { undo: [], redo: [] };
  let clip = null;     // clipboard
  let isOpen = false, dirty = true, root = null, prevWin = null;
  let t0 = 0, f0 = 0, rendering = false, wantRender = null, snapX = null;
  let hov = null, trimming = null; // lit trim edge under the mouse / being dragged
  const D = {};        // DOM refs
  const mediaBox = el('div', { id: 'ed-media', 'aria-hidden': 'true' });
  document.body.append(mediaBox);

  const PROPS = { zoom: 100, x: 0, y: 0, rot: 0, opacity: 100, cropL: 0, cropR: 0, cropT: 0, cropB: 0, volume: 0 };
  const BLENDS = [['normal', 'Normal', 'source-over'], ['add', 'Add', 'lighter'], ['multiply', 'Multiply', 'multiply'], ['screen', 'Screen', 'screen'], ['overlay', 'Overlay', 'overlay'], ['difference', 'Difference', 'difference']];
  const EFFECTS = [['bw', 'Black & white', 'grayscale(1)'], ['sepia', 'Sepia', 'sepia(0.9)'], ['blur', 'Blur', 'blur(BLURpx)'], ['invert', 'Invert', 'invert(1)'], ['bright', 'Brighter', 'brightness(1.25)'], ['dark', 'Darker', 'brightness(0.8)'], ['contrast', 'More contrast', 'contrast(1.3)'], ['desat', 'Muted colours', 'saturate(0.5)']];
  const TITLES = [['title', 'Title', { size: 96, y: 0, box: false }], ['lower', 'Lower third', { size: 52, y: 0.33, box: true }], ['sub', 'Subtitle', { size: 40, y: 0.4, box: true }]];
  const TRANS = [['in', 'Fade in', 'Fades the clip in from black / the layer below.'], ['out', 'Fade out', 'Fades the clip out at its end.'], ['dip', 'Dip to black at cut', 'Fade out + fade in where two clips meet.']];

  // ---------- helpers ----------
  const fps = () => (E.proj ? E.proj.fps : 24);
  const endOf = (c) => c.start + c.len;
  const trackById = (id) => E.tracks.find((t) => t.id === id);
  const kindOf = (c) => (c.kind === AUD ? AUD : VID);
  const ratio = (c) => (c.media ? (c.speed * c.media.fps) / fps() : 1);
  const timelineEnd = () => E.clips.reduce((m, c) => Math.max(m, endOf(c)), 0);
  const linked = (c) => (c.link ? E.clips.find((o) => o !== c && o.link === c.link) : null);
  const byId = (id) => E.clips.find((c) => c.id === id);
  const selected = () => E.clips.filter((c) => E.sel.has(c.id));
  const mark = () => { dirty = true; };
  function srcFrameAt(c, f) { return c.sin + (f - c.start) * ratio(c); }
  function valueAt(c, prop, rel) {
    const k = c.keys[prop];
    if (!k || !k.length) return c.p[prop];
    if (rel <= k[0][0]) return k[0][1];
    if (rel >= k[k.length - 1][0]) return k[k.length - 1][1];
    for (let i = 1; i < k.length; i++) if (rel <= k[i][0]) { const [a, va] = k[i - 1], [b, vb] = k[i]; return va + ((vb - va) * (rel - a)) / (b - a); }
    return c.p[prop];
  }
  function fadeAt(c, rel) {
    let a = 1;
    if (c.fadeIn > 0 && rel < c.fadeIn) a *= clamp((rel + 0.5) / c.fadeIn, 0, 1);
    if (c.fadeOut > 0 && rel > c.len - c.fadeOut - 0.5) a *= clamp((c.len - rel - 0.5) / c.fadeOut, 0, 1);
    return a;
  }
  function newClip(o) {
    return { id: uid(), kind: VID, track: 'V1', media: null, start: 0, len: 1, sin: 0, speed: 1, link: null, p: { ...PROPS }, keys: {}, fx: [], fadeIn: 0, fadeOut: 0, flipH: false, flipV: false, mute: false, title: null, el: null, ...o };
  }
  function addTracks() {
    E.tracks = [['V1', VID, 'Video 1'], ['V2', VID, 'Video 2'], ['V3', VID, 'Titles'], ['A1', AUD, 'Audio 1'], ['A2', AUD, 'Music'], ['A3', AUD, 'Effects']].map(([id, kind, name]) => ({ id, kind, name, mute: false, hide: false }));
  }
  function setProject(m) {
    const w = m && m.w ? m.w : 1920, h = m && m.h ? m.h : 1080;
    E.proj = { w: w % 2 ? w + 1 : w, h: h % 2 ? h + 1 : h, fps: m && m.fps ? m.fps : 24 };
  }

  // ---------- undo ----------
  function snap() { return { clips: E.clips.map((c) => ({ ...c, p: { ...c.p }, keys: JSON.parse(JSON.stringify(c.keys)), fx: c.fx.slice(), title: c.title ? { ...c.title } : null, el: undefined })), tracks: E.tracks.map((t) => ({ ...t })) }; }
  function commit() { hist.undo.push(snap()); if (hist.undo.length > 200) hist.undo.shift(); hist.redo = []; }
  function restore(s) {
    const els = new Map(E.clips.map((c) => [c.id, c.el]));
    E.clips = s.clips.map((c) => ({ ...c, el: els.get(c.id) || null }));
    for (const [id, e] of els) if (e && !E.clips.find((c) => c.id === id)) dropEl(e);
    E.tracks = s.tracks; E.sel = new Set([...E.sel].filter((id) => byId(id)));
    refreshAll();
  }
  function undo() { if (!hist.undo.length) return; hist.redo.push(snap()); restore(hist.undo.pop()); toast('Undo'); }
  function redo() { if (!hist.redo.length) return; hist.undo.push(snap()); restore(hist.redo.pop()); toast('Redo'); }

  // ---------- media elements ----------
  function ensureEl(c) {
    if (!c.media || c.kind === TTL) return null;
    if (c.el && c.el._url === c.media.playUrl) return c.el;
    if (c.el) dropEl(c.el);
    const v = document.createElement('video');
    v.preload = 'auto'; v.playsInline = true; v.muted = c.kind !== AUD; v.preservesPitch = true; v.src = c.media.playUrl; v._url = c.media.playUrl;
    v.addEventListener('loadeddata', () => { if (!E.playing) requestRender(); });
    mediaBox.append(v); c.el = v; return v;
  }
  function dropEl(v) { try { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } catch (e) {} }
  function seekWait(v, t) {
    return new Promise((res) => {
      if (!v) return res();
      if (v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - t) < 1e-3) return res();
      const done = () => { clearTimeout(to); v.removeEventListener('seeked', done); res(); };
      const to = setTimeout(done, 2500);
      v.addEventListener('seeked', done);
      v.currentTime = t;
    });
  }

  // ---------- compositor ----------
  function videoLayersAt(f) {
    const order = E.tracks.filter((t) => t.kind === VID && !t.hide).map((t) => t.id);
    return E.clips.filter((c) => c.kind !== AUD && f >= c.start && f < endOf(c) && order.includes(c.track)).sort((a, b) => order.indexOf(a.track) - order.indexOf(b.track));
  }
  async function renderAt(f, g, W, H, wait) {
    const layers = videoLayersAt(f);
    if (wait) await Promise.all(layers.filter((c) => c.kind === VID && c.media).map((c) => { const v = ensureEl(c); const sf = Math.floor(srcFrameAt(c, f) + 1e-6); return seekWait(v, Math.min((sf + 0.5) / c.media.fps, Math.max(0, (v.duration || c.media.duration || 1e9) - 0.001))); }));
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.restore();
    for (const c of layers) drawLayer(c, f, g, W, H);
  }
  function fxFilter(c, k) { return c.fx.map((id) => { const e = EFFECTS.find((x) => x[0] === id); return e ? e[2].replace('BLUR', (6 * k).toFixed(1)) : ''; }).join(' ') || 'none'; }
  function drawLayer(c, f, g, W, H) {
    const rel = f - c.start;
    const alpha = (valueAt(c, 'opacity', rel) / 100) * fadeAt(c, rel);
    if (alpha <= 0.001) return;
    const k = W / E.proj.w;
    g.save();
    g.globalAlpha = clamp(alpha, 0, 1);
    g.globalCompositeOperation = (BLENDS.find((b) => b[0] === c.blend) || BLENDS[0])[2];
    g.filter = fxFilter(c, k);
    g.translate(W / 2 + valueAt(c, 'x', rel) * k, H / 2 + valueAt(c, 'y', rel) * k);
    g.rotate((valueAt(c, 'rot', rel) * Math.PI) / 180);
    const z = valueAt(c, 'zoom', rel) / 100;
    g.scale(z * (c.flipH ? -1 : 1), z * (c.flipV ? -1 : 1));
    if (c.kind === TTL) drawTitle(c, g, k);
    else {
      const v = c.el; if (!v || !v.videoWidth) { g.restore(); return; }
      const vw = v.videoWidth, vh = v.videoHeight, s0 = Math.min(E.proj.w / vw, E.proj.h / vh) * k;
      const cl = valueAt(c, 'cropL', rel) / 100, cr = valueAt(c, 'cropR', rel) / 100, ct = valueAt(c, 'cropT', rel) / 100, cb = valueAt(c, 'cropB', rel) / 100;
      const sx = cl * vw, sy = ct * vh, sw = Math.max(1, vw * (1 - cl - cr)), sh = Math.max(1, vh * (1 - ct - cb));
      g.drawImage(v, sx, sy, sw, sh, (-vw / 2 + sx) * s0, (-vh / 2 + sy) * s0, sw * s0, sh * s0);
    }
    g.restore();
  }
  function drawTitle(c, g, k) {
    const t = c.title; const size = t.size * k;
    g.font = `${t.bold ? 700 : 500} ${size}px "Segoe UI", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = String(t.text || '').split('\n'); const lh = size * 1.2;
    const wmax = Math.max(...lines.map((l) => g.measureText(l).width), 1);
    const top = (-lh * lines.length) / 2;
    if (t.box) { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(-wmax / 2 - size * 0.5, top - size * 0.25, wmax + size, lh * lines.length + size * 0.5); }
    g.fillStyle = t.color || '#ffffff';
    if (!t.box) { g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = size * 0.12; g.shadowOffsetY = size * 0.04; }
    lines.forEach((l, i) => g.fillText(l, 0, top + lh * (i + 0.5)));
  }

  // ---------- preview ----------
  function previewSize() {
    const box = D.viewer, bw = box.clientWidth, bh = box.clientHeight;
    const a = E.proj.w / E.proj.h; let w = bw, h = bw / a; if (h > bh) { h = bh; w = bh * a; }
    return { w: Math.max(2, Math.floor(w)), h: Math.max(2, Math.floor(h)) };
  }
  function sizeCanvas() {
    const { w, h } = previewSize(); const dpr = devicePixelRatio || 1;
    const pw = Math.min(Math.round(w * dpr), E.proj.w), ph = Math.round((pw * h) / w);
    if (D.cv.width !== pw || D.cv.height !== ph) { D.cv.width = pw; D.cv.height = ph; }
    D.cv.style.width = w + 'px'; D.cv.style.height = h + 'px';
  }
  function requestRender(f = E.ph) {
    if (!isOpen || E.view !== 'timeline') return;
    wantRender = f;
    if (rendering) return;
    rendering = true;
    (async () => {
      while (wantRender != null) {
        const ff = wantRender; wantRender = null;
        sizeCanvas();
        await renderAt(ff, D.cv.getContext('2d'), D.cv.width, D.cv.height, true);
        drawSelBox();
      }
      rendering = false;
    })();
  }
  function drawSelBox() {
    const o = D.ov; const r = D.cv.getBoundingClientRect(), vr = D.viewer.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    o.width = Math.round(vr.width * dpr); o.height = Math.round(vr.height * dpr);
    const g = o.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, vr.width, vr.height);
    const s = selected(); if (s.length !== 1 || s[0].kind === AUD || E.view !== 'timeline') return;
    const c = s[0], rel = E.ph - c.start; if (rel < 0 || rel >= c.len) return;
    const k = r.width / E.proj.w; let bw, bh;
    if (c.kind === TTL) { const ctx2 = D.cv.getContext('2d'); ctx2.save(); ctx2.font = `${c.title.bold ? 700 : 500} ${c.title.size}px "Segoe UI"`; bw = Math.max(...String(c.title.text).split('\n').map((l) => ctx2.measureText(l).width)) + c.title.size; ctx2.restore(); bh = c.title.size * 1.2 * String(c.title.text).split('\n').length + c.title.size * 0.5; }
    else { const m = c.media; if (!m || !m.w) return; const s0 = Math.min(E.proj.w / m.w, E.proj.h / m.h); bw = m.w * s0; bh = m.h * s0; }
    const z = valueAt(c, 'zoom', rel) / 100;
    g.save(); g.translate(r.left - vr.left + r.width / 2 + valueAt(c, 'x', rel) * k, r.top - vr.top + r.height / 2 + valueAt(c, 'y', rel) * k);
    g.rotate((valueAt(c, 'rot', rel) * Math.PI) / 180);
    g.strokeStyle = '#6aa6ff'; g.setLineDash([6, 4]); g.lineWidth = 1.5;
    g.strokeRect((-bw / 2) * z * k, (-bh / 2) * z * k, bw * z * k, bh * z * k); g.restore();
  }

  // ---------- playback ----------
  function play() {
    if (E.playing || !E.clips.length) return;
    if (E.ph >= timelineEnd() - 1) E.ph = E.inF != null ? E.inF : 0;
    E.playing = true; t0 = performance.now(); f0 = E.ph;
    Player.ensureAudio(); mark();
  }
  function pause() {
    if (!E.playing) return;
    E.playing = false;
    for (const c of E.clips) if (c.el && !c.el.paused) c.el.pause();
    mark(); requestRender();
  }
  function toggle() { if (E.playing) pause(); else play(); }
  function syncEls(fx) {
    const ahead = fx + fps() * 1.5;
    for (const c of E.clips) {
      if (c.kind === TTL || !c.media) continue;
      const tr = trackById(c.track); const off = !tr || (c.kind === AUD ? tr.mute : tr.hide);
      const active = fx >= c.start && fx < endOf(c) && !off;
      if (!active) {
        if (c.el && !c.el.paused) c.el.pause();
        if (!off && c.start > fx && c.start < ahead) { const v = ensureEl(c); if (v && v.paused && !v._pre) { v.currentTime = c.sin / c.media.fps; v._pre = true; } }
        continue;
      }
      const v = ensureEl(c); v._pre = false;
      const target = srcFrameAt(c, fx) / c.media.fps;
      v.playbackRate = clamp(c.speed, 0.0625, 16);
      if (c.kind === AUD) {
        const rel = fx - c.start;
        const gain = c.mute || S.muted ? 0 : Math.pow(10, valueAt(c, 'volume', rel) / 20) * fadeAt(c, rel) * clamp(S.volume, 0, 1);
        v.muted = false; v.volume = clamp(gain, 0, 1);
      }
      if (v.paused) { v.currentTime = target; v.play().catch(() => {}); }
      else if (Math.abs(v.currentTime - target) > 0.15) v.currentTime = target;
    }
  }
  function tick(now) {
    if (!isOpen) return;
    if (E.playing) {
      const fx = f0 + ((now - t0) / 1000) * fps();
      const end = E.outF != null ? E.outF + 1 : timelineEnd();
      if (fx >= end) {
        if (Settings.get('loopMode') === 'loop' || S.loopMode === 'loop') { f0 = E.inF != null ? E.inF : 0; t0 = now; for (const c of E.clips) if (c.el) c.el.pause(); }
        else { E.ph = Math.max(0, end - 1); pause(); }
      } else {
        E.ph = Math.floor(fx);
        syncEls(fx);
        sizeCanvas();
        renderAt(E.ph, D.cv.getContext('2d'), D.cv.width, D.cv.height, false);
      }
      dirty = true;
    }
    if (dirty) { dirty = false; updateUI(); drawTimeline(); if (!E.playing) drawSelBox(); }
  }
  function seek(f, scrub) {
    if (E.playing) pause();
    E.ph = clamp(Math.round(f), 0, Math.max(0, timelineEnd() + fps() * 60));
    if (scrub && E.scrub) burst(E.ph);
    mark(); requestRender();
  }
  function step(d) { seek(E.ph + d, true); }
  let burstSrc = null;
  function burst(f) {
    const c = E.clips.filter((x) => x.kind === AUD && !x.mute && f >= x.start && f < endOf(x) && !(trackById(x.track) || {}).mute).sort((a, b) => a.track.localeCompare(b.track))[0];
    if (!c || !c.media) return;
    const ctx = Player.ensureAudio(); const buf = Media.audioBuffer(c.media, ctx);
    if (!buf || !ctx) return;
    const t = srcFrameAt(c, f) / c.media.fps; if (t >= buf.duration) return;
    const now = ctx.currentTime, dur = clamp(1.6 / fps(), 0.05, 0.12);
    try { if (burstSrc) burstSrc.stop(); } catch (e) {}
    const s = ctx.createBufferSource(), gn = ctx.createGain(); s.buffer = buf;
    gn.gain.setValueAtTime(0, now); gn.gain.linearRampToValueAtTime(clamp(S.volume, 0, 1), now + 0.006); gn.gain.linearRampToValueAtTime(0, now + dur);
    s.connect(gn).connect(ctx.destination); s.start(now, t, dur + 0.01); burstSrc = s;
  }

  // ---------- editing ----------
  function placeMedia(m, trackV, trackA, at, sin = 0, sout = null) {
    if (!E.proj) setProject(m);
    const srcLen = (sout != null ? sout : m.frames - 1) - sin + 1;
    const len = Math.max(1, Math.round((srcLen * fps()) / m.fps));
    const out = [];
    const link = m.hasVideo && m.hasAudio ? uid() : null;
    if (m.hasVideo !== false) out.push(newClip({ kind: VID, track: trackV, media: m, start: at, len, sin, link }));
    if (m.hasAudio) out.push(newClip({ kind: AUD, track: trackA, media: m, start: at, len, sin, link: m.hasVideo !== false ? link : null }));
    E.clips.push(...out);
    resolveOverlaps(out);
    return out;
  }
  function split(c, f) {
    if (f <= c.start || f >= endOf(c)) return null;
    const rel = f - c.start;
    const b = newClip({ ...c, id: uid(), el: null, start: f, len: c.len - rel, sin: c.sin + rel * ratio(c), p: { ...c.p }, fx: c.fx.slice(), title: c.title ? { ...c.title } : null, fadeIn: 0, keys: {} });
    for (const [k, arr] of Object.entries(c.keys)) {
      const at = valueAt(c, k, rel);
      c.keys[k] = arr.filter(([x]) => x < rel).concat([[rel, at]]);
      b.keys[k] = [[0, at]].concat(arr.filter(([x]) => x > rel).map(([x, v]) => [x - rel, v]));
    }
    c.len = rel; c.fadeOut = 0;
    E.clips.push(b);
    return b;
  }
  function bladeAt(c, f) {
    const p = E.link ? linked(c) : null;
    const b1 = split(c, f); const b2 = p ? split(p, f) : null;
    if (b1 && b2) { const L = uid(); b1.link = L; b2.link = L; }
    else if (b1) b1.link = null;
  }
  function splitAtPlayhead() {
    const f = E.ph; let targets = selected().filter((c) => f > c.start && f < endOf(c));
    if (!targets.length) targets = E.clips.filter((c) => f > c.start && f < endOf(c) && !(trackById(c.track) || {}).lock);
    if (!targets.length) { toast('Nothing under the playhead to split'); return; }
    commit();
    const done = new Set();
    for (const c of targets) { if (done.has(c.id)) continue; const p = linked(c); if (p) done.add(p.id); done.add(c.id); bladeAt(c, f); }
    refreshAll(); toast('Split');
  }
  function removeClips(list, ripple) {
    if (!list.length) return;
    commit();
    const ids = new Set(list.map((c) => c.id));
    if (E.link) for (const c of list) { const p = linked(c); if (p) ids.add(p.id); }
    const gone = E.clips.filter((c) => ids.has(c.id));
    E.clips = E.clips.filter((c) => !ids.has(c.id));
    for (const c of gone) if (c.el) dropEl(c.el);
    if (ripple) {
      const tracks = new Set(gone.map((c) => c.track));
      for (const tr of tracks) {
        const holes = gone.filter((c) => c.track === tr).sort((a, b) => b.start - a.start);
        for (const h of holes) for (const o of E.clips) if (o.track === tr && o.start >= endOf(h)) o.start -= h.len;
      }
    }
    E.sel.clear(); refreshAll();
  }
  function resolveOverlaps(moved) {
    const set = new Set(moved.map((c) => c.id));
    for (const c of moved) {
      for (const o of E.clips.slice()) {
        if (set.has(o.id) || o.track !== c.track || o.start >= endOf(c) || endOf(o) <= c.start) continue;
        const p = linked(o); if (p && !set.has(p.id)) { o.link = null; p.link = null; }
        if (o.start >= c.start && endOf(o) <= endOf(c)) { E.clips = E.clips.filter((x) => x !== o); if (o.el) dropEl(o.el); }
        else if (o.start < c.start && endOf(o) > endOf(c)) { const b = split(o, endOf(c)); o.len = c.start - o.start; if (b) b.link = null; }
        else if (o.start < c.start) { o.len = c.start - o.start; o.fadeOut = Math.min(o.fadeOut, o.len); }
        else { const d = endOf(c) - o.start; shiftKeys(o, -d); o.sin += d * ratio(o); o.start += d; o.len -= d; o.fadeIn = Math.min(o.fadeIn, o.len); }
      }
    }
  }
  function shiftKeys(c, d) { for (const k of Object.keys(c.keys)) c.keys[k] = c.keys[k].map(([x, v]) => [x + d, v]); }
  function selectClip(c, add) {
    if (!add) E.sel.clear();
    const on = add && E.sel.has(c.id);
    const group = [c]; if (E.link) { const p = linked(c); if (p) group.push(p); }
    for (const g of group) if (on) E.sel.delete(g.id); else E.sel.add(g.id);
    renderInspector(); mark(); requestRender();
  }
  function copySel() { const s = selected(); if (!s.length) return; const base = Math.min(...s.map((c) => c.start)); clip = s.map((c) => ({ ...c, el: null, p: { ...c.p }, keys: JSON.parse(JSON.stringify(c.keys)), fx: c.fx.slice(), title: c.title ? { ...c.title } : null, start: c.start - base })); toast(`${s.length} clip${s.length > 1 ? 's' : ''} copied`); }
  function paste() {
    if (!clip) { toast('Nothing to paste'); return; }
    commit();
    const links = new Map();
    const out = clip.map((c) => { let L = null; if (c.link) { if (!links.has(c.link)) links.set(c.link, uid()); L = links.get(c.link); } return newClip({ ...c, id: uid(), el: null, start: c.start + E.ph, link: L, p: { ...c.p }, keys: JSON.parse(JSON.stringify(c.keys)), fx: c.fx.slice(), title: c.title ? { ...c.title } : null }); });
    E.clips.push(...out); resolveOverlaps(out);
    E.sel = new Set(out.map((c) => c.id)); refreshAll(); toast('Pasted');
  }
  function setSpeed(c, s) {
    s = clamp(s, 0.1, 16);
    const srcFrames = c.len * ratio(c);
    c.speed = s; c.len = Math.max(1, Math.round(srcFrames / ratio(c)));
  }
  function applySpeed(s) {
    const list = selected().filter((c) => c.media); if (!list.length) return;
    commit();
    for (const c of list) setSpeed(c, s);
    resolveOverlaps(list); refreshAll(); toast(`Speed ${Math.round(s * 100)}%`);
  }
  function addTitle(tpl, at, track) {
    const t = TITLES.find((x) => x[0] === tpl) || TITLES[0];
    if (!E.proj) setProject(null);
    commit();
    const c = newClip({ kind: TTL, track: track || 'V3', start: at, len: Math.round(fps() * 4), title: { text: t[0] === 'title' ? 'Your title' : t[0] === 'lower' ? 'Name Surname\nRole' : 'Subtitle text', size: t[2].size, color: '#ffffff', bold: t[0] !== 'sub', box: t[2].box }, p: { ...PROPS, y: Math.round(t[2].y * E.proj.h) } });
    E.clips.push(c); resolveOverlaps([c]); E.sel = new Set([c.id]); refreshAll();
  }
  function applyTransition(kind, c, atEnd) {
    commit();
    const n = Math.round(fps() / 2);
    if (kind === 'in') c.fadeIn = Math.min(c.len, n);
    else if (kind === 'out') c.fadeOut = Math.min(c.len, n);
    else {
      const nb = E.clips.find((o) => o.track === c.track && o !== c && (atEnd ? o.start === endOf(c) : endOf(o) === c.start));
      if (atEnd) { c.fadeOut = Math.min(c.len, n); if (nb) nb.fadeIn = Math.min(nb.len, n); } else { c.fadeIn = Math.min(c.len, n); if (nb) nb.fadeOut = Math.min(nb.len, n); }
    }
    const p = linked(c); if (p && kind !== 'dip') { p.fadeIn = c.fadeIn; p.fadeOut = c.fadeOut; }
    refreshAll();
  }
  function applyEffect(id, list) {
    list = (list || selected()).filter((c) => c.kind !== AUD);
    if (!list.length) { toast('Select a video or title clip first'); return; }
    commit(); for (const c of list) if (!c.fx.includes(id)) c.fx.push(id);
    refreshAll();
  }

  // ---------- timeline geometry ----------
  const RULER = 24, HV = 46, HA = 40, GAP = 6;
  function rows() {
    const vids = E.tracks.filter((t) => t.kind === VID).slice().reverse(), auds = E.tracks.filter((t) => t.kind === AUD);
    const out = []; let y = RULER;
    for (const t of vids) { out.push({ t, y, h: HV }); y += HV; }
    y += GAP;
    for (const t of auds) { out.push({ t, y, h: HA }); y += HA; }
    return { rows: out, height: y };
  }
  const ppf = () => D.tl.clientWidth / Math.max(1e-6, E.ve - E.vs);
  const xOf = (f) => (f - E.vs) * ppf();
  const fAt = (x) => E.vs + x / ppf();
  function fitView() { const end = Math.max(timelineEnd(), fps() * 10); E.vs = 0; E.ve = end * 1.05; mark(); }

  function drawTimeline() {
    const cv = D.tl, dpr = devicePixelRatio || 1;
    const { rows: R, height } = rows();
    const W = cv.clientWidth;
    if (cv.style.height !== height + 'px') { cv.style.height = height + 'px'; renderHeads(); }
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(height * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(height * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, height);
    const p = ppf();
    // track backgrounds
    for (const r of R) { g.fillStyle = '#141518'; g.fillRect(0, r.y, W, r.h); g.fillStyle = '#24262a'; g.fillRect(0, r.y + r.h - 1, W, 1); }
    g.fillStyle = '#111214'; g.fillRect(0, R.find((r) => r.t.kind === AUD).y - GAP, W, GAP);
    // ruler
    g.fillStyle = '#1c1d21'; g.fillRect(0, 0, W, RULER);
    const NICE = [1, 2, 5, 10, 12, 24, 25, 48, 50, 100, 120, 240, 250, 500, 1000, 1200, 2400, 5000, 10000];
    const stepF = NICE.find((n) => n * p >= 90) || 20000;
    g.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--mono'); g.textBaseline = 'top';
    for (let f = Math.ceil(E.vs / stepF) * stepF; f < E.ve; f += stepF) {
      const x = Math.round(xOf(f)); g.fillStyle = '#3b3e45'; g.fillRect(x, 10, 1, RULER - 10);
      g.fillStyle = '#9a9ea6'; g.fillText(S.display === 'timecode' || S.display === 'source' ? fmtTC(f, fps()) : String(f + 1), x + 3, 3);
    }
    if (E.inF != null || E.outF != null) {
      const a = xOf(E.inF != null ? E.inF : 0), b = xOf(E.outF != null ? E.outF + 1 : timelineEnd());
      g.fillStyle = '#3d8bfd40'; g.fillRect(a, RULER - 6, b - a, 6);
    }
    // clips
    for (const c of E.clips) {
      const r = R.find((q) => q.t.id === c.track); if (!r) continue;
      const x0 = xOf(c.start), x1 = xOf(endOf(c)); if (x1 < 0 || x0 > W) continue;
      const y = r.y + 3, h = r.h - 6, sel = E.sel.has(c.id);
      const tr = r.t; const dim = c.kind === AUD ? tr.mute || c.mute : tr.hide;
      g.fillStyle = c.kind === AUD ? '#2f5e48' : c.kind === TTL ? '#5a4680' : (c.media && c.media.status !== 'ready' && c.media.status !== 'loading' ? '#6a4a2a' : '#345a80');
      if (sel) g.fillStyle = c.kind === AUD ? '#3d7a5d' : c.kind === TTL ? '#7058a0' : '#4a7cb0';
      g.globalAlpha = dim ? 0.45 : 1;
      rr(g, x0 + 0.5, y, Math.max(2, x1 - x0 - 1), h, 4); g.fill();
      if (c.kind === AUD && c.media && c.media.peaks) {
        g.fillStyle = '#7fd6a6'; const pk = c.media.peaks; const mid = y + h / 2 + 4, amp = h / 2 - 8;
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, x1); x++) {
          const fa = fAt(x), fb = fAt(x + 1); const sa = srcFrameAt(c, fa) / c.media.fps * 100, sb = srcFrameAt(c, fb) / c.media.fps * 100;
          let m = 0; for (let i = Math.floor(sa); i < Math.max(Math.floor(sa) + 1, Math.ceil(sb)) && i < pk.length; i++) if (pk[i] > m) m = pk[i];
          const hh = Math.max(0.5, m * amp * Math.pow(10, valueAt(c, 'volume', fa - c.start) / 20)); g.fillRect(x, mid - hh, 1, hh * 2);
        }
      }
      // fades
      g.fillStyle = 'rgba(0,0,0,0.35)';
      if (c.fadeIn > 0) { const fx = xOf(c.start + c.fadeIn); g.beginPath(); g.moveTo(x0, y); g.lineTo(fx, y); g.lineTo(x0, y + h); g.fill(); }
      if (c.fadeOut > 0) { const fx = xOf(endOf(c) - c.fadeOut); g.beginPath(); g.moveTo(x1, y); g.lineTo(fx, y); g.lineTo(x1, y + h); g.fill(); }
      g.globalAlpha = 1;
      if (sel) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; rr(g, x0 + 0.5, y, Math.max(2, x1 - x0 - 1), h, 4); g.stroke(); }
      // label
      const label = (c.kind === TTL ? 'T  ' + String(c.title.text).split('\n')[0] : c.media.name) + (c.speed !== 1 ? `  ${Math.round(c.speed * 100)}%` : '') + (c.fx.length ? '  fx' : '') + (c.link ? '' : c.media && c.media.hasVideo && c.media.hasAudio ? '  (unlinked)' : '');
      if (x1 - x0 > 24) { g.save(); g.beginPath(); g.rect(x0 + 2, y, x1 - x0 - 4, h); g.clip(); g.fillStyle = '#fff'; g.font = '12px ' + getComputedStyle(document.body).getPropertyValue('--font'); g.textBaseline = 'top'; g.fillText(label, Math.max(x0, 0) + 7, y + 5); g.restore(); }
      // keyframes
      const ks = new Set(); for (const arr of Object.values(c.keys)) for (const [k] of arr) ks.add(k);
      g.fillStyle = '#e8c27a';
      for (const k of ks) { const kx = xOf(c.start + k + 0.5); if (kx < x0 || kx > x1) continue; g.save(); g.translate(kx, y + h - 6); g.rotate(Math.PI / 4); g.fillRect(-3, -3, 6, 6); g.restore(); }
    }
    // lit trim edges (the edge under the mouse, the one being dragged, and its linked partner)
    const hot = trimming || hov;
    if (hot) {
      const lit = [E.clips.find((c) => c.id === hot.id)].filter(Boolean);
      if (lit[0] && E.link) { const pr = linked(lit[0]); if (pr) lit.push(pr); }
      for (const c of lit) {
        const r = R.find((q) => q.t.id === c.track); if (!r) continue;
        const x = hot.edge === 'l' ? xOf(c.start) : xOf(endOf(c)), dir = hot.edge === 'l' ? 1 : -1, y = r.y + 1, h = r.h - 2;
        const gr = g.createLinearGradient(x, 0, x + 18 * dir, 0); gr.addColorStop(0, trimming ? '#6aa6ffcc' : '#6aa6ff88'); gr.addColorStop(1, '#6aa6ff00');
        g.fillStyle = gr; g.fillRect(dir > 0 ? x : x - 18, y, 18, h);
        g.fillStyle = trimming ? '#ffffff' : '#cfe0ff';
        const bw = trimming ? 4 : 3;
        g.fillRect(Math.round(x) - (dir > 0 ? 0 : bw), y, bw, h);
        g.fillRect(dir > 0 ? x : x - 10, y, 10, 3); g.fillRect(dir > 0 ? x : x - 10, y + h - 3, 10, 3);
      }
    }
    if (snapX != null) { g.fillStyle = '#ffd166'; g.fillRect(Math.round(snapX), 0, 2, height); }
    // playhead
    const px = xOf(E.ph); g.fillStyle = '#ff5a4d'; g.fillRect(Math.round(px) - 1, 0, 2, height);
    g.beginPath(); g.moveTo(px - 6, 0); g.lineTo(px + 6, 0); g.lineTo(px, 8); g.fill();
  }
  function rr(g, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function hit(x, y) {
    const { rows: R } = rows();
    const r = R.find((q) => y >= q.y && y < q.y + q.h); if (!r) return { row: null };
    const f = fAt(x);
    const cands = E.clips.filter((c) => c.track === r.t.id && f >= c.start - 6 / ppf() && f < endOf(c) + 6 / ppf());
    let c = cands.find((q) => f >= q.start && f < endOf(q)) || cands[0] || null;
    let edge = null;
    if (c) { const x0 = xOf(c.start), x1 = xOf(endOf(c)); if (Math.abs(x - x0) <= 6 && x1 - x0 > 14) edge = 'l'; else if (Math.abs(x - x1) <= 6 && x1 - x0 > 14) edge = 'r'; else if (f < c.start || f >= endOf(c)) c = null; }
    return { row: r, clip: c, edge, f };
  }
  function snapPoints(exclude) {
    const pts = [0, E.ph]; for (const c of E.clips) if (!exclude.has(c.id)) { pts.push(c.start, endOf(c)); }
    if (E.inF != null) pts.push(E.inF); if (E.outF != null) pts.push(E.outF + 1);
    return pts;
  }

  function tlMouseDown(e) {
    if (e.button === 2) return;
    const rect = D.tl.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (y < RULER) { const sc = (ev) => seek(fAt(ev.clientX - rect.left), true); sc(e); dragLoop(sc); return; }
    const h = hit(x, y);
    if (!h.clip) { if (!e.shiftKey && !e.ctrlKey) { E.sel.clear(); renderInspector(); } seek(Math.round(h.f || fAt(x)), true); const sc = (ev) => seek(fAt(ev.clientX - rect.left), true); dragLoop(sc); return; }
    const c = h.clip;
    if (E.tool === 'blade') { commit(); bladeAt(c, Math.round(fAt(x))); refreshAll(); return; }
    if (!E.sel.has(c.id) || e.shiftKey || e.ctrlKey) selectClip(c, e.shiftKey || e.ctrlKey);
    const before = snap(); let changed = false;
    if (h.edge) {
      const group = [c]; if (E.link) { const p = linked(c); if (p) group.push(p); }
      const orig = group.map((g) => ({ g, start: g.start, len: g.len, sin: g.sin, keys: JSON.parse(JSON.stringify(g.keys)) }));
      const ripple = E.tool === 'trim';
      trimming = { id: c.id, edge: h.edge };
      const len0 = c.len;
      const tracks = new Set(group.map((g) => g.track));
      const after = E.clips.filter((o) => tracks.has(o.track) && !group.includes(o) && o.start >= endOf(c)).map((o) => ({ o, start: o.start }));
      dragLoop((ev) => {
        let df = Math.round((ev.clientX - rect.left - x) / ppf());
        // limits from every clip in the group
        for (const o of orig) {
          const r = ratio(o.g), F = o.g.media ? o.g.media.frames : 1e9;
          if (h.edge === 'l') { df = Math.max(df, -Math.floor(o.sin / r)); df = Math.min(df, o.len - 1); if (!ripple) df = Math.max(df, -o.start); }
          else { df = Math.max(df, 1 - o.len); df = Math.min(df, Math.floor((F - o.sin) / r) - o.len); }
        }
        snapX = null;
        if (E.snap && !ripple) {
          const edgeF = h.edge === 'l' ? orig[0].start + df : orig[0].start + orig[0].len + df;
          let best = 8 / ppf(), bd = null; for (const pnt of snapPoints(new Set(group.map((g) => g.id)))) { const d = pnt - edgeF; if (Math.abs(d) < best) { best = Math.abs(d); bd = d; } }
          if (bd != null) { df += bd; snapX = xOf(edgeF + bd); }
        }
        for (const o of orig) {
          const r = ratio(o.g);
          if (h.edge === 'l') { o.g.sin = o.sin + df * r; o.g.len = o.len - df; o.g.keys = JSON.parse(JSON.stringify(o.keys)); shiftKeys(o.g, -df); o.g.start = ripple ? o.start : o.start + df; }
          else o.g.len = o.len + df;
        }
        if (ripple) { const d = h.edge === 'l' ? -df : df; for (const a of after) a.o.start = a.start + d; }
        // the viewer shows the frame at the edge; the tip shows how much was trimmed
        const edgeF = h.edge === 'l' ? c.start : endOf(c) - 1;
        E.ph = Math.max(0, edgeF); requestRender();
        const dd = h.edge === 'l' ? -df : df;
        showTrimTip(xOf(h.edge === 'l' ? c.start : endOf(c)), `${h.edge === 'l' ? 'Start' : 'End'}  ${dd > 0 ? '+' : dd < 0 ? '−' : '±'}${Math.abs(dd)} f   ${c.len} frames (${(c.len / fps()).toFixed(2)}s)${snapX != null ? '   snapped' : ''}${ripple ? '   ripple' : ''}`);
        changed = true; mark();
      }, () => { snapX = null; trimming = null; D.trimTip.hidden = true; if (changed) { hist.undo.push(before); hist.redo = []; if (!ripple) resolveOverlaps(group); refreshAll(); if (c.len !== len0) toast(`Trimmed to ${c.len} frames`); } });
      return;
    }
    // move
    const moving = selected();
    const orig = moving.map((m) => ({ m, start: m.start, track: m.track }));
    const kindTracks = (k) => E.tracks.filter((t) => t.kind === k).map((t) => t.id);
    const grabIdx = kindTracks(kindOf(c)).indexOf(c.track);
    dragLoop((ev) => {
      let df = Math.round((ev.clientX - rect.left - x) / ppf());
      const minStart = Math.min(...orig.map((o) => o.start)); df = Math.max(df, -minStart);
      const hr = hit(ev.clientX - rect.left, ev.clientY - rect.top).row;
      let dt = 0; if (hr && hr.t.kind === kindOf(c)) dt = kindTracks(kindOf(c)).indexOf(hr.t.id) - grabIdx;
      snapX = null;
      if (E.snap) {
        let best = 8 / ppf(), bd = null; const ex = new Set(moving.map((m) => m.id));
        const pts = snapPoints(ex);
        for (const o of orig) for (const edgeF of [o.start + df, o.start + o.m.len + df]) for (const pnt of pts) { const d = pnt - edgeF; if (Math.abs(d) < best) { best = Math.abs(d); bd = d; } }
        if (bd != null && minStart + df + bd >= 0) { df += bd; snapX = xOf(orig[0].start + df + (pts.includes(orig[0].start + df) ? 0 : 0)); const e0 = orig.flatMap((o) => [o.start + df, o.start + o.m.len + df]).find((ef) => pts.some((pp) => Math.abs(pp - ef) < 1e-6)); snapX = e0 != null ? xOf(e0) : null; }
      }
      for (const o of orig) {
        o.m.start = o.start + df;
        if (kindOf(o.m) === kindOf(c) && dt) { const ks = kindTracks(kindOf(o.m)); const i = clamp(ks.indexOf(o.track) + dt, 0, ks.length - 1); o.m.track = ks[i]; } else o.m.track = o.track;
      }
      changed = true; mark(); requestRender();
    }, () => { snapX = null; if (changed) { hist.undo.push(before); hist.redo = []; resolveOverlaps(moving); refreshAll(); } });
  }
  function showTrimTip(x, text) {
    const t = D.trimTip; t.textContent = text; t.hidden = false;
    const ox = D.heads.offsetWidth, sy = D.tl.parentElement.parentElement.scrollTop;
    t.style.left = clamp(ox + x - t.offsetWidth / 2, ox, ox + D.tl.clientWidth - t.offsetWidth) + 'px'; t.style.top = (sy + 2) + 'px';
  }
  function dragLoop(move, up) {
    const mv = (ev) => move(ev);
    const u = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', u); if (up) up(); mark(); };
    addEventListener('mousemove', mv); addEventListener('mouseup', u);
  }

  // ---------- DOM ----------
  function build() {
    root = el('div', { id: 'editor', hidden: true });
    $('#app').insertBefore(root, $('#main'));
    // left
    const tabs = el('div', { class: 'ed-tabs' }, ...[['media', 'Media'], ['effects', 'Effects'], ['titles', 'Titles'], ['transitions', 'Transitions']].map(([k, l]) => el('button', { 'data-tab': k, onclick: () => { E.tab = k; renderLeft(); } }, l)));
    D.leftBody = el('div', { class: 'ed-left-body' });
    const left = el('aside', { class: 'ed-left' }, tabs, D.leftBody);
    // centre
    D.viewer = el('div', { class: 'ed-viewer' });
    D.cv = el('canvas', { class: 'ed-cv' }); D.ov = el('canvas', { class: 'ed-ov' });
    D.srcVideo = el('video', { class: 'ed-src', playsinline: true, preload: 'auto', hidden: true });
    D.viewer.append(D.cv, D.srcVideo, D.ov);
    D.viewBtns = el('div', { class: 'ed-viewbtns' }, el('button', { 'data-v': 'source', onclick: () => setView('source') }, 'Source'), el('button', { 'data-v': 'timeline', onclick: () => setView('timeline') }, 'Timeline'));
    D.srcActions = el('div', { class: 'ed-srcact' }, el('button', { class: 'chip', onclick: () => sourceAdd(false) }, 'Add at playhead'), el('button', { class: 'chip', onclick: () => sourceAdd(true) }, 'Add to end'));
    D.zoomTxt = el('span', { class: 'muted' }, '');
    const chead = el('div', { class: 'ed-chead' }, D.viewBtns, D.srcActions, D.zoomTxt);
    D.tc = el('span', { class: 'ed-tc mono' }, '00:00:00:00');
    D.tcRight = el('span', { class: 'muted ed-tcr' }, '');
    const tb = (lab, ic, fn) => el('button', { class: 'icon', 'aria-label': lab, html: ICONS[ic], onclick: fn });
    D.playBtn = el('button', { class: 'icon play', 'aria-label': 'Play', html: ICONS.play, onclick: () => (E.view === 'source' ? srcToggle() : toggle()) });
    const trans = el('div', { class: 'ed-trans' }, D.tc, el('div', { class: 'center' }, tb('Go to start', 'start', () => seek(E.inF != null && E.ph !== E.inF ? E.inF : 0)), tb('Previous frame', 'prev', () => (E.view === 'source' ? srcStep(-1) : step(-1))), D.playBtn, tb('Next frame', 'next', () => (E.view === 'source' ? srcStep(1) : step(1))), tb('Go to end', 'end', () => seek(Math.max(0, timelineEnd() - 1)))), D.tcRight);
    const center = el('section', { class: 'ed-center' }, chead, D.viewer, trans);
    // right
    D.insp = el('div', { class: 'ed-insp-body' });
    const right = el('aside', { class: 'ed-right' }, el('div', { class: 'panel-head' }, el('h2', {}, 'Inspector'), D.inspName = el('span', { class: 'muted ed-iname' }, '')), D.insp);
    const top = el('div', { class: 'ed-top' }, left, center, right);
    // tools
    const tool = (k, lab, svg) => el('button', { class: 'ed-tool', 'data-tool': k, title: lab, 'aria-label': lab, html: svg, onclick: () => { E.tool = k; mark(); updateUI(); } });
    D.tools = el('div', { class: 'ed-tools' },
      tool('select', 'Select (A)', '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l13 8-6 1.5L9 19z"/></svg>'),
      tool('blade', 'Blade (B)', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 8L20 18M8.5 16L20 6"/></svg>'),
      tool('trim', 'Ripple trim (T)', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 4H5v16h3M16 4h3v16h-3"/></svg>'),
      el('button', { class: 'ed-tool', title: 'Ripple delete (Shift+Del)', 'aria-label': 'Ripple delete', html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h10M10 8l4 4-4 4M18 5v14"/></svg>', onclick: () => removeClips(selected(), true) }),
      el('div', { class: 'ed-sep' }),
      D.snapB = el('button', { class: 'chip toggle', onclick: () => { E.snap = !E.snap; updateUI(); } }, 'Snap'),
      D.linkB = el('button', { class: 'chip toggle', onclick: () => { E.link = !E.link; updateUI(); } }, 'Link'),
      D.scrubB = el('button', { class: 'chip toggle', onclick: () => { E.scrub = !E.scrub; updateUI(); } }, 'Audio scrub'),
      el('div', { style: 'flex:1' }),
      el('button', { class: 'chip', onclick: () => { addTrack(VID); } }, '+ Video track'), el('button', { class: 'chip', onclick: () => { addTrack(AUD); } }, '+ Audio track'),
      el('span', { class: 'muted' }, 'Zoom'),
      D.zoom = el('input', { type: 'range', min: 0, max: 1000, value: 0, style: 'width:140px' }),
      el('button', { class: 'chip', onclick: () => fitView() }, 'Fit'));
    D.zoom.addEventListener('input', () => { const T = Math.max(timelineEnd(), fps() * 10) * 1.05; const minS = 20; const s = T * Math.pow(minS / T, +D.zoom.value / 1000); const c = E.ph; E.vs = Math.max(0, c - s / 2); E.ve = E.vs + s; mark(); });
    // timeline
    D.heads = el('div', { class: 'ed-heads' });
    D.tl = el('canvas', { class: 'ed-tl' });
    const tlWrap = el('div', { class: 'ed-tlwrap' }, D.heads, el('div', { class: 'ed-tlc' }, D.tl));
    root.append(top, D.tools, tlWrap);
    // events
    D.tl.addEventListener('mousedown', tlMouseDown);
    D.trimTip = el('div', { class: 'ed-trimtip', hidden: true }); tlWrap.append(D.trimTip);
    D.tl.addEventListener('mousemove', (e) => {
      if (e.buttons || trimming) return;
      const r = D.tl.getBoundingClientRect(); const h = hit(e.clientX - r.left, e.clientY - r.top);
      const nh = h.clip && h.edge && E.tool !== 'blade' ? { id: h.clip.id, edge: h.edge } : null;
      if ((nh && nh.id + nh.edge) !== (hov && hov.id + hov.edge)) { hov = nh; mark(); }
      D.tl.style.cursor = nh ? (nh.edge === 'l' ? 'w-resize' : 'e-resize') : E.tool === 'blade' ? 'crosshair' : 'default';
    });
    D.tl.addEventListener('mouseleave', () => { if (hov && !trimming) { hov = null; mark(); } });
    D.tl.addEventListener('dblclick', (e) => { const r = D.tl.getBoundingClientRect(); const h = hit(e.clientX - r.left, e.clientY - r.top); if (h.clip && h.clip.kind === TTL) { const t = D.insp.querySelector('textarea'); if (t) t.focus(); } });
    D.tl.addEventListener('wheel', (e) => {
      e.preventDefault(); const r = D.tl.getBoundingClientRect(); const x = e.clientX - r.left;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const d = ((e.deltaX || e.deltaY) / r.width) * (E.ve - E.vs); E.vs = Math.max(0, E.vs + d); E.ve = E.vs + (E.ve - E.vs) - 0; E.ve = E.vs + (E.ve - E.vs); }
      else { const f = fAt(x), s = (E.ve - E.vs) * (e.deltaY > 0 ? 1.2 : 1 / 1.2); const ns = clamp(s, 10, Math.max(timelineEnd(), fps() * 10) * 3); E.vs = Math.max(0, f - (x / r.width) * ns); E.ve = E.vs + ns; }
      mark();
    }, { passive: false });
    D.tl.addEventListener('contextmenu', (e) => { e.preventDefault(); const r = D.tl.getBoundingClientRect(); const h = hit(e.clientX - r.left, e.clientY - r.top); if (h.clip && !E.sel.has(h.clip.id)) selectClip(h.clip, false); clipMenu(e.clientX, e.clientY, h); });
    D.tl.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('cp/item')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    D.tl.addEventListener('drop', onTlDrop);
    D.viewer.addEventListener('mousedown', viewerDrag);
    D.viewer.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('cp/item')) e.preventDefault(); });
    new ResizeObserver(() => { mark(); requestRender(); }).observe(D.viewer);
    new ResizeObserver(() => mark()).observe(D.tl);
    // title bar buttons
    D.titleBtns = el('div', { id: 'title-actions', hidden: true },
      el('button', { class: 'primary small-btn', onclick: () => exportDialog() }, 'Export'),
      el('button', { class: 'chip', onclick: () => leave() }, 'Compact'));
    $('#titlebar').insertBefore(D.titleBtns, $('#title-text').nextSibling);
  }
  function renderHeads() {
    const { rows: R } = rows();
    D.heads.innerHTML = ''; D.heads.style.height = rows().height + 'px';
    D.heads.append(el('div', { class: 'ed-hrul', style: `height:${RULER}px` }));
    let lastKind = VID;
    for (const r of R) {
      if (r.t.kind !== lastKind) { D.heads.append(el('div', { style: `height:${GAP}px;background:#111214` })); lastKind = r.t.kind; }
      const t = r.t;
      const tog = t.kind === VID
        ? el('button', { class: 'ed-hb' + (t.hide ? ' off' : ''), title: t.hide ? 'Show track' : 'Hide track', onclick: () => { t.hide = !t.hide; renderHeads(); mark(); requestRender(); } }, t.hide ? 'Off' : 'On')
        : el('button', { class: 'ed-hb' + (t.mute ? ' off' : ''), title: t.mute ? 'Unmute track' : 'Mute track', onclick: () => { t.mute = !t.mute; renderHeads(); mark(); } }, 'M');
      const name = el('input', { class: 'ed-hname', value: t.name, 'aria-label': 'Track name' });
      name.addEventListener('change', () => { t.name = name.value; }); name.addEventListener('keydown', (e) => e.stopPropagation());
      D.heads.append(el('div', { class: 'ed-head', style: `height:${r.h}px` }, el('b', {}, t.id), name, tog));
    }
  }
  function addTrack(kind) {
    const n = E.tracks.filter((t) => t.kind === kind).length + 1;
    if (n > 8) { toast('That\'s the maximum number of tracks'); return; }
    commit();
    const t = { id: (kind === VID ? 'V' : 'A') + n, kind, name: (kind === VID ? 'Video ' : 'Audio ') + n, mute: false, hide: false };
    const last = E.tracks.map((x) => x.kind).lastIndexOf(kind);
    E.tracks.splice(last + 1, 0, t); renderHeads(); mark();
  }

  // ---------- left panel ----------
  function poolMedia() {
    const set = new Set();
    for (const c of S.clips) set.add(c.media);
    for (const c of E.clips) if (c.media) set.add(c.media);
    for (const m of E.bin || []) set.add(m);
    return [...set];
  }
  function thumb(m, img) {
    if (m.thumb) { img.src = m.thumb; return; }
    if (!m.hasVideo || m.status === 'convert' || m.status === 'error') return;
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = m.playUrl;
    v.addEventListener('loadeddata', () => { v.currentTime = Math.min(1, (v.duration || 2) * 0.1); }, { once: true });
    v.addEventListener('seeked', () => {
      try { const c = document.createElement('canvas'); c.width = 160; c.height = Math.round((160 * v.videoHeight) / v.videoWidth) || 90; c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); m.thumb = c.toDataURL('image/jpeg', 0.8); img.src = m.thumb; } catch (e) {}
      v.removeAttribute('src'); v.load();
    }, { once: true });
  }
  function renderLeft() {
    for (const b of root.querySelectorAll('.ed-tabs button')) b.classList.toggle('on', b.dataset.tab === E.tab);
    const B = D.leftBody; B.innerHTML = '';
    const draggable = (node, payload) => { node.draggable = true; node.addEventListener('dragstart', (e) => { e.dataTransfer.setData('cp/item', JSON.stringify(payload)); e.dataTransfer.effectAllowed = 'copy'; }); };
    if (E.tab === 'media') {
      const grid = el('div', { class: 'ed-bin' });
      for (const m of poolMedia()) {
        const img = el('img', { alt: '' });
        const st = m.status === 'convert' ? 'needs converting' : m.status === 'converting' ? Math.round(m.convertPct * 100) + '%' : m.status === 'error' ? 'error' : '';
        const tile = el('div', { class: 'ed-tile' + (E.src === m ? ' on' : ''), title: m.path || m.name },
          el('div', { class: 'ed-thumb' + (m.hasVideo ? '' : ' audio') }, m.hasVideo ? img : el('span', {}, '♪')),
          el('div', { class: 'ed-tname' }, m.name), el('div', { class: 'muted small' }, fmtDur(m.duration) + (st ? ' · ' + st : '')));
        thumb(m, img);
        draggable(tile, { type: 'media', id: m.id });
        tile.addEventListener('click', () => { E.src = m; renderLeft(); if (E.view === 'source') loadSource(); });
        tile.addEventListener('dblclick', () => { E.src = m; setView('source'); });
        tile.addEventListener('contextmenu', (e) => { e.preventDefault(); Menu.open([{ header: m.name }, { label: 'Open in Source viewer', action: () => { E.src = m; setView('source'); } }, { label: 'Add at playhead', action: () => { E.src = m; E.srcIn = E.srcOut = null; sourceAdd(false); } }, { label: 'Add to end', action: () => { E.src = m; E.srcIn = E.srcOut = null; sourceAdd(true); } }, m.status === 'convert' ? { label: 'Convert', action: () => Media.convert(m) } : null, { sep: true }, { label: 'Show in folder', disabled: !API, action: () => API.showInFolder(m.path) }], e.clientX, e.clientY); });
        grid.append(tile);
      }
      grid.append(el('button', { class: 'ed-tile ed-import', onclick: importMedia }, el('div', { class: 'ed-thumb' }, el('span', {}, '+')), el('div', { class: 'ed-tname' }, 'Import'), el('div', { class: 'muted small' }, 'or drop files here')));
      B.append(grid);
    } else if (E.tab === 'effects') {
      B.append(el('div', { class: 'muted small ed-hint' }, 'Drag onto a clip, or select clips and click Add.'));
      for (const [id, name] of EFFECTS) { const r = el('div', { class: 'ed-item' }, el('span', {}, name), el('button', { class: 'chip', onclick: () => applyEffect(id) }, 'Add')); draggable(r, { type: 'fx', id }); B.append(r); }
    } else if (E.tab === 'titles') {
      B.append(el('div', { class: 'muted small ed-hint' }, 'Drag onto a video track, or click Add to put it at the playhead on V3.'));
      for (const [id, name] of TITLES) { const r = el('div', { class: 'ed-item' }, el('span', {}, name), el('button', { class: 'chip', onclick: () => addTitle(id, E.ph, 'V3') }, 'Add')); draggable(r, { type: 'title', id }); B.append(r); }
    } else {
      B.append(el('div', { class: 'muted small ed-hint' }, 'Drag onto a clip (near its start or end), or select a clip and click.'));
      for (const [id, name, desc] of TRANS) {
        const r = el('div', { class: 'ed-item col' }, el('div', { class: 'row' }, el('span', { style: 'color:#e6e7ea' }, name), el('button', { class: 'chip', onclick: () => { const s = selected().filter((c) => c.kind !== AUD); if (!s.length) { toast('Select a clip first'); return; } for (const c of s) applyTransition(id, c, id !== 'in'); } }, 'Apply')), el('div', { class: 'muted small' }, desc));
        draggable(r, { type: 'trans', id }); B.append(r);
      }
    }
  }
  async function importMedia() {
    if (!API) { App.run('addFiles'); return; }
    const files = await API.openDialog({ multi: true, title: 'Import media' });
    if (files.length) { Player.addFiles(files, { add: true }); setTimeout(renderLeft, 300); }
  }
  function onTlDrop(e) {
    const raw = e.dataTransfer.getData('cp/item'); if (!raw) return;
    e.preventDefault();
    const it = JSON.parse(raw); const r = D.tl.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    const h = hit(x, y); const f = Math.max(0, Math.round(fAt(x)));
    if (it.type === 'media') {
      const m = poolMedia().find((q) => q.id === it.id); if (!m) return;
      commit();
      let tv = 'V1', ta = 'A1';
      if (h.row) { const idx = E.tracks.filter((t) => t.kind === h.row.t.kind).indexOf(h.row.t); const vs = E.tracks.filter((t) => t.kind === VID), as = E.tracks.filter((t) => t.kind === AUD); if (h.row.t.kind === VID) { tv = h.row.t.id; ta = (as[idx] || as[0]).id; } else { ta = h.row.t.id; tv = (vs[idx] || vs[0]).id; } }
      const out = placeMedia(m, tv, ta, f); E.sel = new Set(out.map((c) => c.id)); refreshAll();
    } else if (it.type === 'title') { addTitle(it.id, f, h.row && h.row.t.kind === VID ? h.row.t.id : 'V3'); }
    else if (it.type === 'fx') { if (h.clip) applyEffect(it.id, [h.clip]); else toast('Drop effects onto a clip'); }
    else if (it.type === 'trans') { if (h.clip) { const mid = h.clip.start + h.clip.len / 2; applyTransition(it.id, h.clip, fAt(x) > mid); } else toast('Drop transitions onto a clip'); }
  }

  // ---------- source viewer ----------
  function setView(v) {
    E.view = v; if (E.playing) pause(); if (!D.srcVideo.paused) D.srcVideo.pause();
    D.cv.hidden = v !== 'timeline'; D.ov.hidden = v !== 'timeline'; D.srcVideo.hidden = v !== 'source';
    if (v === 'source') loadSource(); else requestRender();
    mark(); updateUI();
  }
  function loadSource() {
    const m = E.src || poolMedia()[0]; E.src = m;
    if (!m) return;
    if (D.srcVideo._m !== m) { D.srcVideo.src = m.playUrl; D.srcVideo._m = m; E.srcIn = E.srcOut = null; }
    renderLeft();
  }
  function srcToggle() { const v = D.srcVideo; if (v.paused) v.play().catch(() => {}); else v.pause(); mark(); }
  function srcFrame() { return E.src ? Math.floor(D.srcVideo.currentTime * E.src.fps + 1e-3) : 0; }
  function srcStep(d) { const v = D.srcVideo, m = E.src; if (!m) return; v.pause(); v.currentTime = Math.max(0, (srcFrame() + d + 0.5) / m.fps); mark(); }
  function sourceAdd(toEnd) {
    const m = E.src || poolMedia()[0]; if (!m) { toast('Import media first'); return; }
    if (m.status === 'convert' || m.status === 'error') { toast('Convert this file first (right-click it in Media)'); return; }
    commit();
    const at = toEnd ? E.clips.filter((c) => c.track === 'V1' || c.track === 'A1').reduce((a, c) => Math.max(a, endOf(c)), 0) : E.ph;
    const out = placeMedia(m, 'V1', 'A1', at, E.srcIn != null ? E.srcIn : 0, E.srcOut != null ? E.srcOut : null);
    E.sel = new Set(out.map((c) => c.id));
    if (toEnd) E.ph = at;
    refreshAll(); toast('Added to the timeline');
  }

  // ---------- drag in viewer to move the selected clip ----------
  function viewerDrag(e) {
    if (e.button !== 0 || E.view !== 'timeline') return;
    const s = selected().filter((c) => c.kind !== AUD); if (s.length !== 1) return;
    const c = s[0], rel = E.ph - c.start; if (rel < 0 || rel >= c.len) return;
    const k = D.cv.getBoundingClientRect().width / E.proj.w; const x0 = e.clientX, y0 = e.clientY;
    const ox = valueAt(c, 'x', rel), oy = valueAt(c, 'y', rel); const before = snap(); let moved = false;
    dragLoop((ev) => { moved = true; setProp(c, 'x', Math.round(ox + (ev.clientX - x0) / k), true); setProp(c, 'y', Math.round(oy + (ev.clientY - y0) / k), true); requestRender(); renderInspectorValues(); }, () => { if (moved) { hist.undo.push(before); hist.redo = []; } });
  }

  // ---------- inspector ----------
  function setProp(c, prop, v, noCommit) {
    const rel = E.ph - c.start;
    const k = c.keys[prop];
    if (k && k.length) { const i = k.findIndex(([x]) => x === rel); if (i >= 0) k[i][1] = v; else { k.push([rel, v]); k.sort((a, b) => a[0] - b[0]); } }
    else c.p[prop] = v;
    const p = E.link ? linked(c) : null;
    if (prop === 'volume' && p && p.kind === AUD) { /* volume lives on the audio clip only */ }
    mark();
  }
  function toggleKey(c, prop) {
    commit();
    const rel = clamp(E.ph - c.start, 0, c.len - 1);
    const k = c.keys[prop] || (c.keys[prop] = []);
    const i = k.findIndex(([x]) => x === rel);
    if (i >= 0) { k.splice(i, 1); if (!k.length) { c.p[prop] = valueAt(c, prop, rel); delete c.keys[prop]; } }
    else { k.push([rel, valueAt(c, prop, rel)]); k.sort((a, b) => a[0] - b[0]); }
    renderInspector(); mark(); requestRender();
  }
  function keyNav(d) {
    const s = selected(); if (!s.length) return;
    const frames = new Set(); for (const c of s) for (const arr of Object.values(c.keys)) for (const [k] of arr) frames.add(c.start + k);
    const list = [...frames].sort((a, b) => a - b);
    const t = d > 0 ? list.find((f) => f > E.ph) : list.reverse().find((f) => f < E.ph);
    if (t != null) seek(t);
  }
  let inspRows = [];
  function renderInspector() {
    const B = D.insp; B.innerHTML = ''; inspRows = [];
    const s = selected();
    const vis = s.filter((c) => c.kind !== AUD), aud = s.filter((c) => c.kind === AUD);
    if (!s.length) { D.inspName.textContent = ''; B.append(el('div', { class: 'muted ed-hint' }, 'Select a clip on the timeline to change its position, size, opacity, speed, crop and keyframes.'), projectSection()); return; }
    if (vis.length > 1 || aud.length > 1) { D.inspName.textContent = `${s.length} clips`; B.append(el('div', { class: 'muted ed-hint' }, `${s.length} clips selected. Select one clip to edit its settings.`), speedSection(s)); return; }
    const c = vis[0] || aud[0];
    D.inspName.textContent = c.kind === TTL ? 'Title' : c.media.name;
    B.append(el('div', { class: 'ed-keynav' }, el('span', { class: 'muted' }, 'Keyframes'), el('button', { class: 'chip', onclick: () => keyNav(-1), title: 'Previous keyframe' }, '◀'), el('button', { class: 'chip', onclick: () => keyNav(1), title: 'Next keyframe' }, '▶')));
    if (vis[0]) {
      const v = vis[0];
      if (v.kind === TTL) B.append(titleSection(v));
      B.append(section('Transform', [numRow(v, 'zoom', 'Zoom', '%', 1, 1, 1000), numRow(v, 'x', 'Position X', 'px', 1), numRow(v, 'y', 'Position Y', 'px', 1), numRow(v, 'rot', 'Rotation', '°', 0.5),
        el('div', { class: 'ed-row' }, el('span', { class: 'muted' }, 'Flip'), el('label', { class: 'check' }, chk(v.flipH, (x) => { commit(); v.flipH = x; requestRender(); }), 'Horizontal'), el('label', { class: 'check' }, chk(v.flipV, (x) => { commit(); v.flipV = x; requestRender(); }), 'Vertical')),
        el('button', { class: 'chip', onclick: () => { commit(); for (const p of ['zoom', 'x', 'y', 'rot']) { delete v.keys[p]; v.p[p] = PROPS[p]; } v.flipH = v.flipV = false; renderInspector(); requestRender(); } }, 'Reset transform')]));
      if (v.kind === VID) B.append(section('Crop', [numRow(v, 'cropL', 'Left', '%', 0.5, 0, 95), numRow(v, 'cropR', 'Right', '%', 0.5, 0, 95), numRow(v, 'cropT', 'Top', '%', 0.5, 0, 95), numRow(v, 'cropB', 'Bottom', '%', 0.5, 0, 95)]));
      const bl = el('select', {}, BLENDS.map(([k, l]) => el('option', { value: k }, l))); bl.value = v.blend || 'normal';
      bl.addEventListener('change', () => { commit(); v.blend = bl.value; requestRender(); mark(); });
      B.append(section('Composite', [el('div', { class: 'ed-row' }, el('span', { class: 'muted' }, 'Blend'), bl), numRow(v, 'opacity', 'Opacity', '%', 1, 0, 100)]));
      if (v.fx.length) B.append(section('Effects', v.fx.map((id) => { const fx = EFFECTS.find((q) => q[0] === id); return el('div', { class: 'ed-row' }, el('span', {}, fx ? fx[1] : id), el('button', { class: 'xbtn', style: 'width:24px;height:24px', html: ICONS.close, 'aria-label': 'Remove effect', onclick: () => { commit(); v.fx = v.fx.filter((q) => q !== id); renderInspector(); requestRender(); mark(); } })); })));
    }
    if (aud[0]) {
      const a = aud[0];
      B.append(section('Audio', [numRow(a, 'volume', 'Volume', 'dB', 0.5, -60, 12), el('div', { class: 'ed-row' }, el('span', { class: 'muted' }, 'Mute clip'), chk(a.mute, (x) => { commit(); a.mute = x; mark(); }))]));
    }
    B.append(speedSection(s), fadeSection(c));
  }
  function chk(v, on) { const i = el('input', { type: 'checkbox' }); i.checked = !!v; i.addEventListener('change', () => on(i.checked)); return i; }
  function section(t, kids) { return el('div', { class: 'ed-sec' }, el('h3', {}, t), ...kids); }
  function numRow(c, prop, label, unit, stepv, min = -1e6, max = 1e6) {
    const rel = clamp(E.ph - c.start, 0, c.len - 1);
    const inp = el('input', { type: 'number', class: 'field mono', step: stepv, value: String(Math.round(valueAt(c, prop, rel) * 100) / 100) });
    const has = c.keys[prop] && c.keys[prop].length, at = has && c.keys[prop].some(([x]) => x === rel);
    const kb = el('button', { class: 'ed-key' + (at ? ' on' : has ? ' some' : ''), title: at ? 'Remove keyframe here' : 'Add keyframe here', 'aria-label': 'Keyframe ' + label, onclick: () => toggleKey(c, prop) }, '◆');
    let before = null;
    inp.addEventListener('focus', () => { before = snap(); });
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (!isFinite(v)) return; setProp(c, prop, clamp(v, min, max), true); requestRender(); });
    inp.addEventListener('change', () => { if (before) { hist.undo.push(before); hist.redo = []; before = null; } renderInspector(); });
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    const lab = el('span', { class: 'muted ed-scrub', title: 'Drag left / right to change' }, label);
    lab.addEventListener('mousedown', (e) => {
      e.preventDefault(); const x0 = e.clientX, v0 = valueAt(c, prop, rel); const b = snap(); let moved = false;
      dragLoop((ev) => { moved = true; const v = clamp(Math.round((v0 + (ev.clientX - x0) * stepv) * 100) / 100, min, max); setProp(c, prop, v, true); inp.value = String(v); requestRender(); }, () => { if (moved) { hist.undo.push(b); hist.redo = []; renderInspector(); } });
    });
    inspRows.push({ c, prop, inp });
    return el('div', { class: 'ed-row' }, lab, el('span', { class: 'ed-numwrap' }, inp, el('span', { class: 'muted small' }, unit)), kb);
  }
  function renderInspectorValues() { for (const r of inspRows) if (document.activeElement !== r.inp) { const rel = clamp(E.ph - r.c.start, 0, r.c.len - 1); r.inp.value = String(Math.round(valueAt(r.c, r.prop, rel) * 100) / 100); } }
  function speedSection(s) {
    const withMedia = s.filter((c) => c.media); if (!withMedia.length) return el('div');
    const cur = Math.round(withMedia[0].speed * 100);
    const inp = el('input', { type: 'number', class: 'field mono', value: String(cur), min: 10, max: 1600, step: 5 });
    inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v)) applySpeed(v / 100); });
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    return section('Speed', [el('div', { class: 'ed-row' }, el('span', { class: 'muted' }, 'Speed'), el('span', { class: 'ed-numwrap' }, inp, el('span', { class: 'muted small' }, '%'))),
      el('div', { class: 'ed-presets' }, ...[25, 50, 100, 200, 400].map((p) => el('button', { class: 'chip' + (p === cur ? ' toggle on' : ''), onclick: () => applySpeed(p / 100) }, p + '%'))),
      el('div', { class: 'muted small' }, 'Changing speed changes the clip length; the same part of the source is kept.')]);
  }
  function fadeSection(c) {
    const mk = (k, label) => { const i = el('input', { type: 'number', class: 'field mono', value: String(c[k]), min: 0, max: c.len, step: 1 }); i.addEventListener('change', () => { commit(); c[k] = clamp(parseInt(i.value, 10) || 0, 0, c.len); const p = E.link ? linked(c) : null; if (p) p[k] = c[k]; mark(); requestRender(); }); i.addEventListener('keydown', (e) => e.stopPropagation()); return el('div', { class: 'ed-row' }, el('span', { class: 'muted' }, label), el('span', { class: 'ed-numwrap' }, i, el('span', { class: 'muted small' }, 'frames'))); };
    return section('Fades', [mk('fadeIn', 'Fade in'), mk('fadeOut', 'Fade out')]);
  }
  function titleSection(c) {
    const t = c.title;
    const ta = el('textarea', { class: 'field', rows: 3, style: 'width:100%;resize:vertical' }); ta.value = t.text;
    let before = null;
    ta.addEventListener('focus', () => { before = snap(); }); ta.addEventListener('input', () => { t.text = ta.value; requestRender(); mark(); }); ta.addEventListener('change', () => { if (before) { hist.undo.push(before); hist.redo = []; before = null; } });
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    const size = el('input', { type: 'number', class: 'field mono', value: String(t.size), min: 8, max: 600 }); size.addEventListener('input', () => { t.size = clamp(+size.value || 48, 8, 600); requestRender(); }); size.addEventListener('keydown', (e) => e.stopPropagation());
    const col = el('input', { type: 'color', value: t.color }); col.addEventListener('input', () => { t.color = col.value; requestRender(); });
    return section('Title', [ta, el('div', { class: 'ed-row' }, el('span', { class: 'muted' }, 'Size'), el('span', { class: 'ed-numwrap' }, size, el('span', { class: 'muted small' }, 'px'))),
      el('div', { class: 'ed-row' }, el('span', { class: 'muted' }, 'Colour'), col),
      el('div', { class: 'ed-row' }, el('label', { class: 'check' }, chk(t.bold, (x) => { t.bold = x; requestRender(); }), 'Bold'), el('label', { class: 'check' }, chk(t.box, (x) => { t.box = x; requestRender(); }), 'Background box'))]);
  }
  function projectSection() {
    if (!E.proj) return el('div');
    return section('Timeline', [el('div', { class: 'ed-row' }, el('span', { class: 'muted' }, 'Size'), el('span', {}, `${E.proj.w} × ${E.proj.h}`)), el('div', { class: 'ed-row' }, el('span', { class: 'muted' }, 'Frame rate'), el('span', {}, `${fmtFps(E.proj.fps)} fps`)), el('div', { class: 'ed-row' }, el('span', { class: 'muted' }, 'Length'), el('span', { class: 'mono' }, fmtTC(timelineEnd(), fps())))]);
  }

  // ---------- menus ----------
  function clipMenu(x, y, h) {
    const s = selected();
    Menu.open([
      { label: 'Cut', kb: 'Ctrl+X', disabled: !s.length, action: () => { copySel(); removeClips(selected(), false); } },
      { label: 'Copy', kb: 'Ctrl+C', disabled: !s.length, action: copySel },
      { label: 'Paste at playhead', kb: 'Ctrl+V', disabled: !clip, action: paste },
      { label: 'Delete', kb: 'Del', disabled: !s.length, action: () => removeClips(selected(), false) },
      { label: 'Ripple delete', kb: 'Shift+Del', disabled: !s.length, action: () => removeClips(selected(), true) },
      { sep: true },
      { label: 'Split at playhead', kb: 'Ctrl+B', action: splitAtPlayhead },
      { label: s.some((c) => c.link) ? 'Unlink video and audio' : 'Link video and audio', disabled: !s.length, action: () => { commit(); if (s.some((c) => c.link)) for (const c of s) { const p = linked(c); c.link = null; if (p) p.link = null; } else { const v = s.find((c) => c.kind === VID), a = s.find((c) => c.kind === AUD); if (v && a) { const L = uid(); v.link = L; a.link = L; } } mark(); } },
      { label: 'Speed', disabled: !s.some((c) => c.media), sub: () => [25, 50, 75, 100, 150, 200, 400].map((p) => ({ label: p + '%', checked: () => s[0] && Math.round(s[0].speed * 100) === p, action: () => applySpeed(p / 100) })) },
      { label: 'Effects', disabled: !s.some((c) => c.kind !== AUD), sub: () => EFFECTS.map(([id, n]) => ({ label: n, checked: () => s.some((c) => c.fx.includes(id)), action: () => applyEffect(id) })) },
      { label: 'Remove effects', disabled: !s.some((c) => c.fx.length), action: () => { commit(); for (const c of s) c.fx = []; refreshAll(); } },
      { label: 'Remove fades', disabled: !s.some((c) => c.fadeIn || c.fadeOut), action: () => { commit(); for (const c of s) c.fadeIn = c.fadeOut = 0; refreshAll(); } },
      { label: 'Remove keyframes', disabled: !s.some((c) => Object.keys(c.keys).length), action: () => { commit(); for (const c of s) { for (const k of Object.keys(c.keys)) c.p[k] = valueAt(c, k, E.ph - c.start); c.keys = {}; } refreshAll(); } },
    ], x, y);
  }
  function setMenus() {
    Menu.bar([
      ['File', () => [
        { label: 'Import media…', kb: 'Ctrl+I', action: importMedia },
        { label: 'Export…', kb: 'Ctrl+E', disabled: () => !E.clips.length, action: exportDialog },
        { sep: true },
        { label: 'Back to compact player', kb: 'E', action: leave },
        { label: 'Exit', kb: 'Alt+F4', action: () => (API ? API.windowCmd('close') : window.close()) },
      ]],
      ['Edit', () => [
        { label: 'Undo', kb: 'Ctrl+Z', disabled: () => !hist.undo.length, action: undo },
        { label: 'Redo', kb: 'Ctrl+Y', disabled: () => !hist.redo.length, action: redo },
        { sep: true },
        { label: 'Cut', kb: 'Ctrl+X', disabled: () => !E.sel.size, action: () => { copySel(); removeClips(selected(), false); } },
        { label: 'Copy', kb: 'Ctrl+C', disabled: () => !E.sel.size, action: copySel },
        { label: 'Paste at playhead', kb: 'Ctrl+V', disabled: () => !clip, action: paste },
        { label: 'Delete', kb: 'Del', disabled: () => !E.sel.size, action: () => removeClips(selected(), false) },
        { label: 'Ripple delete', kb: 'Shift+Del', disabled: () => !E.sel.size, action: () => removeClips(selected(), true) },
        { sep: true },
        { label: 'Select all', kb: 'Ctrl+A', action: () => { E.sel = new Set(E.clips.map((c) => c.id)); renderInspector(); mark(); } },
        { label: 'Split at playhead', kb: 'Ctrl+B', action: splitAtPlayhead },
        { sep: true },
        { label: 'Settings…', kb: 'Ctrl+,', action: () => Dialogs.settingsDialog() },
      ]],
      ['View', () => [
        { label: 'Source viewer', checked: () => E.view === 'source', action: () => setView('source') },
        { label: 'Timeline viewer', checked: () => E.view === 'timeline', action: () => setView('timeline') },
        { sep: true },
        { label: 'Zoom timeline to fit', kb: 'Shift+Z', action: fitView },
        { label: 'Full screen', kb: 'F', action: () => App.run('fullscreen') },
      ]],
      ['Clip', () => [
        { label: 'Speed', disabled: () => !selected().some((c) => c.media), sub: () => [25, 50, 75, 100, 150, 200, 400].map((p) => ({ label: p + '%', action: () => applySpeed(p / 100) })) },
        { label: 'Effects', disabled: () => !selected().some((c) => c.kind !== AUD), sub: () => EFFECTS.map(([id, n]) => ({ label: n, action: () => applyEffect(id) })) },
        { label: 'Fade in', action: () => { for (const c of selected()) applyTransition('in', c); } },
        { label: 'Fade out', action: () => { for (const c of selected()) applyTransition('out', c, true); } },
        { sep: true },
        { label: 'Add title at playhead', action: () => addTitle('title', E.ph, 'V3') },
      ]],
      ['Timeline', () => [
        { label: 'Select tool', kb: 'A', checked: () => E.tool === 'select', action: () => { E.tool = 'select'; updateUI(); } },
        { label: 'Blade tool', kb: 'B', checked: () => E.tool === 'blade', action: () => { E.tool = 'blade'; updateUI(); } },
        { label: 'Ripple trim tool', kb: 'T', checked: () => E.tool === 'trim', action: () => { E.tool = 'trim'; updateUI(); } },
        { sep: true },
        { label: 'Snap', kb: 'N', checked: () => E.snap, action: () => { E.snap = !E.snap; updateUI(); } },
        { label: 'Link video and audio', kb: 'Ctrl+L', checked: () => E.link, action: () => { E.link = !E.link; updateUI(); } },
        { label: 'Audio scrub', kb: 'Shift+S', checked: () => E.scrub, action: () => { E.scrub = !E.scrub; updateUI(); } },
        { sep: true },
        { label: 'Set In', kb: '[', action: () => { E.inF = E.ph; mark(); } },
        { label: 'Set Out', kb: ']', action: () => { E.outF = E.ph; mark(); } },
        { label: 'Clear In / Out', kb: '\\', action: () => { E.inF = E.outF = null; mark(); } },
        { sep: true },
        { label: 'Add video track', action: () => addTrack(VID) },
        { label: 'Add audio track', action: () => addTrack(AUD) },
        { label: 'Rebuild timeline from compact player', action: () => { commit(); E.clips = []; populate(true); refreshAll(); } },
      ]],
      ['Window', () => [
        { label: 'Always on top', checked: () => !!S.onTop, disabled: !API, action: () => { S.onTop = !S.onTop; API.setOnTop(S.onTop); } },
        { label: 'Minimise', disabled: !API, action: () => API.windowCmd('minimize') },
      ]],
      ['Help', () => [
        { label: 'Editor shortcuts…', action: shortcutsHelp },
        { sep: true },
        { label: 'Check for updates…', disabled: !API, action: () => Dialogs.checkUpdates() },
        { label: 'Install update from file…', disabled: !API, action: () => Dialogs.installFromFile() },
        { sep: true }, { label: 'About Clips Pro', action: () => Dialogs.about() },
      ]],
    ]);
  }
  function shortcutsHelp() {
    const L = [['Space', 'Play / pause'], ['← / →', 'Previous / next frame'], ['Shift+← / →', '1 second back / forward'], ['Home / End', 'Start / end'], ['J / K / L', 'Play back / stop / play'], ['A / B / T', 'Select / Blade / Ripple trim tool'], ['Ctrl+B', 'Split at playhead'], ['Del / Shift+Del', 'Delete / ripple delete'], ['Ctrl+X / C / V', 'Cut / copy / paste'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+A', 'Select all'], ['N', 'Snap on / off'], ['Ctrl+L', 'Link on / off'], ['Shift+S', 'Audio scrub on / off'], ['[ / ] / \\', 'Set In / Out / clear'], ['Shift+Z', 'Zoom timeline to fit'], ['= / -', 'Zoom timeline in / out'], ['Ctrl+E', 'Export'], ['Ctrl+I', 'Import media'], ['E or Esc', 'Back to compact player'], ['F', 'Full screen']];
    const h = Modal.open({ title: 'Editor shortcuts', width: 520, body: el('div', { class: 'mb' }, el('div', { class: 'keys-table' }, ...L.map(([k, d]) => el('div', { class: 'kr' }, el('span', {}, d), el('span', {}, k.split(' / ').map((x) => el('kbd', {}, x))), el('span'))))), footer: el('div', { class: 'mf' }, el('button', { class: 'primary', onclick: () => h.close() }, 'OK')) });
  }

  // ---------- keyboard ----------
  function key(e) {
    if (Modal.isOpen() || Menu.isOpen()) return false;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
    const k = Keys.fromEvent(e); if (!k) return false;
    const map = {
      'Space': () => (E.view === 'source' ? srcToggle() : toggle()), '←': () => (E.view === 'source' ? srcStep(-1) : step(-1)), '→': () => (E.view === 'source' ? srcStep(1) : step(1)),
      'Shift+←': () => step(-Math.round(fps())), 'Shift+→': () => step(Math.round(fps())), 'Home': () => seek(0), 'End': () => seek(Math.max(0, timelineEnd() - 1)),
      'J': () => { pause(); toast('Reverse play is in the compact player'); }, 'K': pause, 'L': play,
      'A': () => { E.tool = 'select'; updateUI(); }, 'B': () => { E.tool = 'blade'; updateUI(); }, 'T': () => { E.tool = 'trim'; updateUI(); },
      'Ctrl+B': splitAtPlayhead, 'Del': () => removeClips(selected(), false), 'Backspace': () => removeClips(selected(), false), 'Shift+Del': () => removeClips(selected(), true),
      'Ctrl+X': () => { copySel(); removeClips(selected(), false); }, 'Ctrl+C': copySel, 'Ctrl+V': paste, 'Ctrl+Z': undo, 'Ctrl+Y': redo, 'Ctrl+Shift+Z': redo,
      'Ctrl+A': () => { E.sel = new Set(E.clips.map((c) => c.id)); renderInspector(); mark(); },
      'N': () => { E.snap = !E.snap; updateUI(); toast('Snap ' + (E.snap ? 'on' : 'off')); }, 'Ctrl+L': () => { E.link = !E.link; updateUI(); toast('Link ' + (E.link ? 'on' : 'off')); },
      'Shift+S': () => { E.scrub = !E.scrub; updateUI(); toast('Audio scrub ' + (E.scrub ? 'on' : 'off')); },
      '[': () => { if (E.view === 'source') { E.srcIn = srcFrame(); toast('Source In'); } else E.inF = E.ph; mark(); },
      ']': () => { if (E.view === 'source') { E.srcOut = srcFrame(); toast('Source Out'); } else E.outF = E.ph; mark(); },
      '\\': () => { E.inF = E.outF = null; E.srcIn = E.srcOut = null; mark(); },
      'Shift+Z': fitView, '=': () => zoomBy(1 / 1.25), '-': () => zoomBy(1.25),
      'Ctrl+E': exportDialog, 'Ctrl+I': importMedia, 'E': leave, 'Esc': leave, 'F': () => App.run('fullscreen'), '`': () => App.run('fullscreen'), 'Ctrl+,': () => Dialogs.settingsDialog(),
    };
    const fn = map[k]; if (!fn) return false;
    if (e.repeat && !['←', '→', 'Shift+←', 'Shift+→', '=', '-'].includes(k)) { e.preventDefault(); return true; }
    e.preventDefault(); fn(); return true;
  }
  function zoomBy(f) { const s = clamp((E.ve - E.vs) * f, 10, Math.max(timelineEnd(), fps() * 10) * 3); E.vs = Math.max(0, E.ph - s / 2); E.ve = E.vs + s; mark(); }

  // ---------- UI refresh ----------
  function updateUI() {
    if (!root) return;
    for (const b of root.querySelectorAll('.ed-tool[data-tool]')) b.classList.toggle('on', b.dataset.tool === E.tool);
    D.snapB.classList.toggle('on', E.snap); D.linkB.classList.toggle('on', E.link); D.scrubB.classList.toggle('on', E.scrub);
    if (!hov && !trimming) D.tl.style.cursor = E.tool === 'blade' ? 'crosshair' : 'default';
    for (const b of D.viewBtns.querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === E.view);
    D.srcActions.hidden = E.view !== 'source';
    const playing = E.view === 'source' ? !D.srcVideo.paused : E.playing;
    setIcon(D.playBtn, playing ? ICONS.pause : ICONS.play);
    if (E.view === 'source' && E.src) {
      D.tc.textContent = fmtTC(srcFrame(), E.src.fps);
      D.tcRight.textContent = `${E.src.name}${E.srcIn != null ? ' · In ' + (E.srcIn + 1) : ''}${E.srcOut != null ? ' · Out ' + (E.srcOut + 1) : ''}`;
    } else {
      D.tc.textContent = fmtTC(E.ph, fps());
      D.tcRight.textContent = E.proj ? `${E.proj.w}×${E.proj.h} · ${fmtFps(fps())} fps · ${fmtTC(timelineEnd(), fps())}` : '';
    }
    const T = Math.max(timelineEnd(), fps() * 10) * 1.05, s = E.ve - E.vs;
    if (document.activeElement !== D.zoom) D.zoom.value = String(Math.round(clamp(Math.log(T / s) / Math.log(T / 20), 0, 1) * 1000));
    if (E.playing && (E.ph < E.vs || E.ph > E.ve)) { const span = E.ve - E.vs; E.vs = Math.max(0, E.ph - span * 0.1); E.ve = E.vs + span; }
    renderInspectorValues();
    $('#title-text').textContent = `Editor — ${E.clips.length} clip${E.clips.length === 1 ? '' : 's'}${E.proj ? ` · ${E.proj.w}×${E.proj.h} · ${fmtFps(fps())} fps` : ''}`;
  }
  function refreshAll() { renderHeads(); renderInspector(); renderLeft(); mark(); requestRender(); }

  // ---------- enter / leave ----------
  function populate(force) {
    if (E.clips.length && !force) return;
    const first = S.clips.find((c) => c.media.hasVideo) || S.clips[0];
    if (!E.proj || force) setProject(first ? first.media : null);
    let at = 0;
    for (const c of S.clips) {
      const m = c.media;
      const out = placeMedia(m, 'V1', 'A1', at, c.tin, c.tout);
      for (const o of out) { if (o.kind === VID) { o.p.rot = c.rot || 0; o.flipH = !!c.fh; o.flipV = !!c.fv; } if (o.kind === AUD) o.mute = !!c.mute; }
      at += out[0] ? out[0].len : 0;
    }
  }
  async function enter() {
    if (isOpen) return;
    if (!root) build();
    if (S.playing) Player.pause();
    if (Tracker.isOpen()) Tracker.close();
    if (!E.tracks.length) addTracks();
    populate(false);
    if (!E.proj) setProject(null);
    isOpen = true;
    $('#main').hidden = true; $('#bottom').hidden = true; root.hidden = false; D.titleBtns.hidden = false;
    document.body.classList.add('editing');
    setMenus();
    if (API) { prevWin = { w: innerWidth, h: innerHeight }; API.maximize(); }
    fitView(); setView('timeline'); refreshAll();
  }
  function leave() {
    if (!isOpen) return;
    pause(); if (!D.srcVideo.paused) D.srcVideo.pause();
    for (const c of E.clips) if (c.el && !c.el.paused) c.el.pause();
    isOpen = false; root.hidden = true; D.titleBtns.hidden = true;
    $('#main').hidden = false; $('#bottom').hidden = false;
    document.body.classList.remove('editing');
    App.setCompactMenus(); Player.layout(); App.sessionChanged();
    if (API && prevWin) { API.unmaximize().then(() => API.setSize(prevWin)); }
  }

  // ---------- export ----------
  async function exportDialog() {
    if (!E.clips.length) { toast('The timeline is empty'); return; }
    const CHROME = !API && typeof WebExport !== 'undefined' && WebExport.supported();
    if (!API && !CHROME) { toast('Exporting from the editor needs an up-to-date Chrome or Edge'); return; }
    pause();
    const PRE = CHROME ? [['h264', 'MP4 · H.264', 'High quality MP4 that plays everywhere. Uses your graphics card to encode when it can.'], ['small', 'Small file (share)', 'Smaller MP4 for sending and uploading.'], ['webm', 'WebM · VP9', 'Open format for the web.']] : [['h264', 'MP4 · H.264', 'High quality MP4 that plays everywhere.'], ['small', 'Small file (share)', 'Smaller MP4 for sending and uploading.'], ['prores', 'ProRes 422 (.mov)', 'Editing-friendly master file. Large.'], ['webm', 'WebM · VP9', 'Open format for the web.']];
    const EXT = { h264: '.mp4', small: '.mp4', prores: '.mov', webm: '.webm' };
    let preset = 'h264';
    const name = el('input', { type: 'text', value: 'timeline_export' });
    const dir = el('input', { type: 'text', value: Settings.get('exportDir') || (API ? await API.defaultDir() : ''), style: 'flex:1;min-width:0' });
    const xo = CHROME ? WebExport.optionsUI({ srcFps: fps(), marks: false, onChange: () => sync() }) : null;
    const info = el('div', { class: 'muted small' });
    const res = el('select', {}, el('option', { value: 'proj' }, `Timeline (${E.proj.w}×${E.proj.h})`), el('option', { value: '2160' }, '2160p'), el('option', { value: '1080' }, '1080p'), el('option', { value: '720' }, '720p'));
    const q = el('select', {}, el('option', { value: 'high' }, 'High'), el('option', { value: 'medium' }, 'Medium'), el('option', { value: 'low' }, 'Low'));
    const hasIO = E.inF != null || E.outF != null;
    const r1 = el('input', { type: 'radio', name: 'edr', checked: !hasIO }), r2 = el('input', { type: 'radio', name: 'edr', checked: hasIO, disabled: !hasIO });
    const list = el('div', { class: 'preset-list' }, el('h2', { style: 'margin:0 0 6px' }, 'Presets'));
    const desc = el('div', { class: 'muted' });
    const prog = el('div', { hidden: true, style: 'display:flex;flex-direction:column;gap:6px' }, el('div', { class: 'bar' }, el('div')), el('div', { class: 'row' }, el('span', { class: 'pct mono' }, '0%'), el('span')));
    const err = el('div', { class: 'err', hidden: true });
    const sync = () => {
      for (const b of $$('button', list)) b.classList.toggle('on', b.dataset.p === preset); desc.textContent = PRE.find((p) => p[0] === preset)[2]; q.disabled = preset === 'prores';
      if (xo) { const pl = chromePlan(); const sz = pl.mb * (pl.N / fps2(pl)) / 8; info.textContent = `${pl.parts.length > 1 ? pl.parts.length + ' files · ' : ''}${WebExport.niceFps(pl.F)} fps · ${fmtTC(pl.N, pl.F)} · ≈ ${sz > 1024 ? (sz / 1024).toFixed(1) + ' GB' : Math.max(1, Math.round(sz)) + ' MB'}${pl.parts.length > 1 ? ' in all' : ''}`; go.textContent = pl.parts.length > 1 ? `Export ${pl.parts.length} files` : 'Export now'; }
    };
    const fps2 = (pl) => pl.F;
    const range = () => { const a = r2.checked ? (E.inF != null ? E.inF : 0) : 0; const b = r2.checked && E.outF != null ? E.outF : timelineEnd() - 1; return [a, b]; };
    const dims = () => { let W = E.proj.w, H = E.proj.h; if (res.value !== 'proj') { H = +res.value; W = Math.round((H * E.proj.w) / E.proj.h / 2) * 2; } return [W + (W % 2), H + (H % 2)]; };
    const chromePlan = () => {
      const [a, b] = range(), [W, H] = dims(), F = xo.fps(), P = fps();
      const N = Math.max(1, Math.round(((b - a + 1) * F) / P));
      const mb = WebExport.mbpsFor(preset, W, H, F, q.value);
      return { a, b, W, H, F, P, N, mb, parts: WebExport.parts(N, F, xo.split(), [], mb) };
    };
    for (const [k, l] of PRE) list.append(el('button', { 'data-p': k, onclick: () => { preset = k; sync(); } }, l));
    const browse = el('button', { class: 'secondary', style: 'height:32px', onclick: async () => { const d = await API.saveDialog({ title: 'Export to folder', defaultPath: dir.value, folder: true }); if (d) dir.value = d; } }, 'Browse');
    const body = el('div', { style: 'display:flex;min-height:330px' }, list, el('div', { class: 'mb', style: 'flex:1' }, desc,
      el('div', { class: 'kv-grid' }, el('label', { class: 'fieldset' }, el('span', {}, 'File name'), name), el('div', { class: 'fieldset' }, el('span', {}, 'Save to'), el('div', { style: 'display:flex;gap:6px' }, dir, browse)), el('label', { class: 'fieldset' }, el('span', {}, 'Resolution'), res), el('label', { class: 'fieldset' }, el('span', {}, 'Quality'), q)),
      el('div', { class: 'fieldset' }, el('span', {}, 'Range'), el('div', { style: 'display:flex;gap:16px' }, el('label', { class: 'check' }, r1, 'Whole timeline'), el('label', { class: 'check' }, r2, hasIO ? 'In to Out' : 'In to Out (set [ and ] first)'))),
      xo ? xo.node : null, xo ? info : null,
      el('div', { class: 'muted small' }, 'Every frame is drawn exactly as in the viewer, then encoded with your PC\'s video encoder.'), prog, err));
    if (CHROME) dir.closest('.fieldset').hidden = true;
    for (const x of [res, q, r1, r2]) x.addEventListener('change', () => sync());
    const job = { cancel: false, id: null };
    const go = el('button', { class: 'primary' }, 'Export now');
    const cancel = el('button', { class: 'secondary', onclick: () => { if (job.id) job.cancel = true; else h.close(); } }, 'Cancel');
    const h = Modal.open({ title: 'Export timeline', width: 900, body, footer: el('div', { class: 'mf' }, cancel, go), onClose: () => { job.cancel = true; } });
    sync();
    go.addEventListener('click', async () => {
      if (CHROME) { await chromeGo(); return; }
      Settings.set('exportDir', dir.value);
      const a = r2.checked ? (E.inF != null ? E.inF : 0) : 0;
      const b = r2.checked && E.outF != null ? E.outF : timelineEnd() - 1;
      let W = E.proj.w, H = E.proj.h;
      if (res.value !== 'proj') { H = +res.value; W = Math.round((H * E.proj.w) / E.proj.h / 2) * 2; }
      const sep = API.platform === 'win32' ? '\\' : '/';
      const output = dir.value.replace(/[\\/]+$/, '') + sep + (name.value.trim().replace(/[\\/:*?"<>|]/g, '_') || 'export') + EXT[preset];
      const audio = [];
      for (const c of E.clips) {
        if (c.kind !== AUD || c.mute || !c.media || !c.media.path || (trackById(c.track) || {}).mute) continue;
        const s0 = Math.max(c.start, a), s1 = Math.min(endOf(c), b + 1); if (s1 <= s0) continue;
        const keys = c.keys.volume;
        audio.push({ path: c.media.path, in: frameSec(srcFrameAt(c, s0), c.media.fps), srcDur: ((s1 - s0) * c.speed) / fps(), dur: (s1 - s0) / fps(), start: (s0 - a) / fps(), speed: c.speed, gain: Math.pow(10, (keys && keys.length ? valueAt(c, 'volume', s0 - c.start) : c.p.volume) / 20), fadeIn: c.start >= a ? c.fadeIn / fps() : 0, fadeOut: endOf(c) <= b + 1 ? c.fadeOut / fps() : 0 });
      }
      job.id = 'ed-' + Date.now(); job.cancel = false;
      go.disabled = true; cancel.textContent = 'Stop'; prog.hidden = false; err.hidden = true;
      const bar = prog.querySelector('.bar>div'), pct = prog.querySelector('.pct');
      const total = b - a + 1;
      const st = await API.renderStart({ id: job.id, output, preset, width: W, height: H, fps: fps(), quality: q.value, audio, totalSec: total / fps() });
      if (!st.ok) { err.hidden = false; err.textContent = 'Could not start the export.'; go.disabled = false; return; }
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
      const t0 = performance.now();
      for (let f = a; f <= b; f++) {
        if (job.cancel) break;
        await renderAt(f, g, W, H, true);
        const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q.value === 'low' ? 0.85 : 0.94));
        await API.renderFrame(job.id, new Uint8Array(await blob.arrayBuffer()));
        const done = f - a + 1;
        if (done % 4 === 0 || f === b) { const el2 = (performance.now() - t0) / 1000; bar.style.width = ((done / total) * 100).toFixed(1) + '%'; pct.textContent = `${Math.round((done / total) * 100)}% · frame ${done} of ${total} · about ${fmtDur(((total - done) * el2) / done)} left`; }
      }
      if (job.cancel) { await API.renderCancel(job.id); await API.renderEnd(job.id).catch(() => {}); pct.textContent = 'Stopped'; }
      else {
        const r = await API.renderEnd(job.id);
        if (r.ok) { bar.style.width = '100%'; pct.textContent = 'Done'; const sp = prog.querySelector('.row span:last-child'); sp.innerHTML = ''; sp.append(el('button', { class: 'secondary', style: 'height:30px', onclick: () => API.showInFolder(output) }, 'Show in folder')); toast('Exported ' + output.split(/[\\/]/).pop()); }
        else { err.hidden = false; err.textContent = 'Export failed.\n' + (r.error || ''); pct.textContent = 'Failed'; }
      }
      job.id = null; go.disabled = false; cancel.textContent = 'Close';
      requestRender();
    });

    async function chromeGo() {
      const pl = chromePlan(); const base = name.value.trim().replace(/[\\/:*?"<>|]/g, '_') || 'export'; const ext = EXT[preset];
      const files = pl.parts.map(([k0, k1], i) => ({ name: WebExport.partName(base, i, pl.parts.length), k0, k1 }));
      let out = { kind: 'download' };
      try {
        if (files.length === 1 && window.showSaveFilePicker) out = { kind: 'file', handle: await showSaveFilePicker({ suggestedName: files[0].name + ext, id: 'clipspro-export', types: [{ description: 'Video', accept: { [preset === 'webm' ? 'video/webm' : 'video/mp4']: [ext] } }] }) };
        else if (files.length > 1 && window.showDirectoryPicker) out = { kind: 'dir', handle: await showDirectoryPicker({ id: 'clipspro-export', mode: 'readwrite' }) };
      } catch (e) { if (e && e.name === 'AbortError') return; out = { kind: 'download' }; }
      if (out.kind === 'file') files[0].name = out.handle.name.replace(/\.[^.]+$/, '');
      const { a, b, W, H, F, P } = pl;
      // sound: every audio clip on the timeline, in seconds from the export start
      const items = [];
      for (const c of E.clips) {
        if (c.kind !== AUD || c.mute || !c.media || (trackById(c.track) || {}).mute) continue;
        const s0 = Math.max(c.start, a), s1 = Math.min(endOf(c), b + 1); if (s1 <= s0) continue;
        const keys = c.keys.volume;
        items.push({ media: c.media, at: (s0 - a) / P, offset: srcFrameAt(c, s0) / (c.media.fps || 24), dur: (s1 - s0) / P, speed: c.speed,
          gain: Math.pow(10, (keys && keys.length ? valueAt(c, 'volume', s0 - c.start) : c.p.volume) / 20),
          fadeIn: c.start >= a ? c.fadeIn / P : 0, fadeInAt: (c.start - a) / P, fadeOut: endOf(c) <= b + 1 ? c.fadeOut / P : 0, fadeOutAt: (endOf(c) - c.fadeOut - a) / P });
      }
      job.id = 'ed-web'; job.cancel = false;
      go.disabled = true; cancel.textContent = 'Stop'; prog.hidden = false; err.hidden = true;
      const bar = prog.querySelector('.bar>div'), pct = prog.querySelector('.pct');
      const fails = []; let done = 0;
      for (let i = 0; i < files.length && !job.cancel; i++) {
        const f = files[i]; const off = f.k0 / F;
        const its = items.map((x) => ({ ...x, at: x.at - off, fadeInAt: x.fadeInAt - off, fadeOutAt: x.fadeOutAt - off }));
        let writable = null;
        try {
          if (out.kind === 'file') writable = await out.handle.createWritable();
          else if (out.kind === 'dir') writable = await (await out.handle.getFileHandle(f.name + ext, { create: true })).createWritable();
          const r = await WebExport.encodeFile({
            preset, width: W, height: H, fps: F, quality: q.value, frames: f.k1 - f.k0, cancel: job, writable, hasAudio: its.length > 0,
            audio: (t0, d) => WebExport.mixAudio(its, t0, d),
            drawFrame: async (k, g) => { const tf = Math.min(b, a + Math.floor(((f.k0 + k) * P) / F + 1e-6)); await renderAt(tf, g, W, H, true); },
            onPct: (p, txt) => { const t = (i + p) / files.length; bar.style.width = (t * 100).toFixed(1) + '%'; pct.textContent = (files.length > 1 ? `Part ${i + 1} of ${files.length} · ` : '') + `${Math.round(t * 100)}%` + (txt ? ' · ' + txt : ''); },
          });
          if (r === null) break;
          if (r instanceof Blob) await saveBlob(r, f.name + ext, 'Video', r.type, ext);
          done++;
        } catch (e) { if (writable) { try { await writable.abort(); } catch (e2) {} } fails.push(`${f.name}${ext}: ${e && e.message ? e.message : e}`); }
      }
      const noSound = WebExport.takeAudioFailures(); WebExport.release();
      if (job.cancel) pct.textContent = `Stopped after ${done} of ${files.length}`;
      else { bar.style.width = '100%'; pct.textContent = files.length > 1 ? `Done: ${done} of ${files.length} files` : done ? 'Done' : 'Failed'; if (done) toast(files.length > 1 ? `Exported ${done} files` : 'Exported ' + files[0].name + ext); }
      const msgs = []; if (fails.length) msgs.push((done ? 'Some files did not export.\n' : 'Export failed.\n') + fails.join('\n')); if (noSound.length) msgs.push('Chrome could not read the sound of: ' + noSound.join(', ') + ' (exported without its sound).');
      if (msgs.length) { err.hidden = false; err.textContent = msgs.join('\n\n'); }
      job.id = null; go.disabled = false; cancel.textContent = 'Close';
      requestRender();
    }
  }

  Media.onUpdate((m, what) => {
    if (!isOpen) return;
    if (what === 'converted') for (const c of E.clips) if (c.media === m && c.el) { dropEl(c.el); c.el = null; }
    if (what === 'probe' || what === 'converted' || what === 'status' || what === 'audio') { renderLeft(); mark(); requestRender(); }
  });

  return { enter, leave, toggle: () => (isOpen ? leave() : enter()), isOpen: () => isOpen, tick, key, _E: E, _renderAt: renderAt, _split: splitAtPlayhead, _commit: commit, _undo: undo };
})();

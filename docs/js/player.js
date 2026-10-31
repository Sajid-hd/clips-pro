'use strict';
/* Playback engine, viewer layout, session editing */
const Player = (() => {
  const stage = $('#stage'), viewer = $('#viewer');
  let actx = null, burstSrc = null;
  let manual = false, lastStep = 0, master = null;
  let qT = 0, qDropped = 0, steadyT = 0, vfcFrames = 0, vfcT = 0, stepsCount = 0, stepsT = 0;
  const hist = { undo: [], redo: [] };
  let clipboard = null;
  let changed = () => {};

  // ---------- clip helpers ----------
  const len = (c) => Math.max(1, c.tout - c.tin + 1);
  const fps = () => (S.clips[0] ? S.clips[0].media.fps : 24) || 24;
  const byId = (id) => S.clips.find((c) => c.id === id) || null;
  function total() {
    if (!S.clips.length) return 0;
    return S.mode === 'sequence' ? S.clips.reduce((s, c) => s + len(c), 0) : Math.max(...S.clips.map(len));
  }
  function starts() { const a = []; let s = 0; for (const c of S.clips) { a.push(s); s += len(c); } return a; }
  function locate(g) {
    if (!S.clips.length) return null;
    if (S.mode === 'sequence') {
      let s = 0;
      for (let i = 0; i < S.clips.length; i++) { const c = S.clips[i], L = len(c); if (g < s + L || i === S.clips.length - 1) return { i, clip: c, start: s, local: c.tin + clamp(g - s, 0, L - 1) }; s += L; }
    }
    const c = curClip();
    return { i: S.clips.indexOf(c), clip: c, start: 0, local: c.tin + clamp(g, 0, len(c) - 1) };
  }
  function curClip() {
    if (!S.clips.length) return null;
    if (S.mode === 'sequence') return locate(S.frame).clip;
    return byId(S.cur) || stackTop() || S.clips[0];
  }
  function stackTop() { return byId(S.stackOrder[0]); }
  const startF = () => (S.inF != null ? S.inF : 0);
  const endF = () => (S.outF != null ? S.outF : Math.max(0, total() - 1));
  const timeFor = (c, local) => {
    let t = (local + 0.5) / c.media.fps;
    const d = c.el && isFinite(c.el.duration) && c.el.duration > 0 ? c.el.duration : c.media.duration;
    if (d > 0) t = Math.min(t, Math.max(0, d - 0.0005));
    return t;
  };
  const frameOfEl = (c) => Math.floor(c.el.currentTime * c.media.fps + 1e-3);

  // ---------- video elements ----------
  function makeEl(c) {
    const v = document.createElement('video');
    v.preload = 'auto'; v.playsInline = true; v.disablePictureInPicture = true; v.muted = true;
    v.preservesPitch = true;
    v._clip = c;
    v.addEventListener('loadedmetadata', () => { Media.fromElement(c.media, v); fixOut(c); layout(); changed(); });
    v.addEventListener('loadeddata', () => {
      const m = c.media;
      if (m.probed && m.info && m.info.video && v.videoWidth === 0) Media.markUnplayable(m, 'This video codec can\'t play directly.');
      if (!S.playing) showFrame(S.frame);
    });
    v.addEventListener('error', () => { if (v.getAttribute('src')) Media.markUnplayable(c.media, 'This format can\'t play directly.'); });
    v.addEventListener('seeked', () => { if (v._want != null) { const t = v._want; v._want = null; v.currentTime = t; } });
    v.addEventListener('progress', () => changed());
    v.src = c.media.playUrl;
    stage.append(v);
    return v;
  }
  function seekEl(v, t) {
    if (!isFinite(t)) return;
    if (v.seeking) { v._want = t; return; }
    if (Math.abs(v.currentTime - t) < 1e-4) return;
    v.currentTime = t;
  }
  function makeClip(media, opt = {}) {
    const c = { id: uid(), media, tin: 0, tout: Math.max(0, media.frames - 1), rot: 0, fh: false, fv: false, mute: false, auto: true, el: null, ...opt };
    c.el = makeEl(c);
    return c;
  }
  function fixOut(c) { if (c.auto && c.media.frames) c.tout = Math.max(c.tin, c.media.frames - 1); }

  Media.onUpdate((m, what) => {
    for (const c of S.clips) if (c.media === m) {
      if (what === 'probe' || what === 'meta') fixOut(c);
      if (what === 'converted') { c.el.src = m.playUrl; c.el.load(); }
    }
    if ((what === 'probe' || what === 'meta') && S._fitPending === m && m.w > 0) { S._fitPending = null; fitWindowTo(m); }
    S.frame = clamp(S.frame, 0, Math.max(0, total() - 1));
    layout(); changed();
  });

  // ---------- audio ----------
  function ensureAudio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function hearClip() { return S.mode === 'sequence' ? curClip() : (byId(S.audioClip) || S.clips[0]); }
  function setAudio() {
    const h = hearClip();
    for (const c of S.clips) {
      const on = !S.muted && !c.mute && c === h;
      c.el.muted = !on; c.el.volume = clamp(S.volume, 0, 1);
    }
  }
  function scrubBurst(g) {
    if (!S.audioScrub || S.muted) return;
    let c, local;
    if (S.mode === 'sequence') { const L = locate(g); c = L.clip; local = L.local; }
    else { c = hearClip(); if (!c) return; local = c.tin + clamp(g, 0, len(c) - 1); }
    if (!c || c.mute) return;
    const m = c.media; const f = m.fps;
    const ctx = ensureAudio();
    const buf = Media.audioBuffer(m, ctx);
    if (buf && ctx) {
      const now = ctx.currentTime, dur = clamp(1.6 / f, 0.05, 0.12), t = local / f;
      if (t >= buf.duration) return;
      try { if (burstSrc) burstSrc.stop(); } catch (e) {}
      const src = ctx.createBufferSource(); const gain = ctx.createGain();
      src.buffer = buf;
      const vol = clamp(S.volume, 0, 1);
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(vol, now + 0.006);
      gain.gain.setValueAtTime(vol, now + dur - 0.012); gain.gain.linearRampToValueAtTime(0, now + dur);
      src.connect(gain).connect(ctx.destination);
      src.start(now, t, dur + 0.01); burstSrc = src;
    } else if (!API && c.el && m.hasAudio) {
      // browser fallback: play the element for a moment
      const v = c.el; v.muted = false; v.volume = clamp(S.volume, 0, 1);
      v.play().then(() => setTimeout(() => { if (!S.playing) { v.pause(); v.muted = true; showFrame(S.frame); } }, 70)).catch(() => {});
    }
  }

  // ---------- show a frame (paused / scrubbing) ----------
  function showFrame(g, { scrub = false } = {}) {
    const T = total();
    if (!T) { S.frame = 0; changed(); return; }
    S.frame = clamp(Math.round(g), 0, T - 1);
    if (S.mode === 'sequence') {
      const L = locate(S.frame);
      seekEl(L.clip.el, timeFor(L.clip, L.local));
      for (const c of S.clips) c.el.classList.toggle('vis', c === L.clip);
    } else {
      for (const c of S.clips) {
        const local = c.tin + Math.min(S.frame, len(c) - 1);
        seekEl(c.el, timeFor(c, local));
      }
    }
    if (scrub) scrubBurst(S.frame);
    changed();
  }

  // ---------- playback ----------
  function applyRate() {
    const r = clamp(S.speed * (S.allFrames ? S.rateFactor : 1), 0.0625, 16);
    for (const c of S.clips) { c.el.playbackRate = r; c.el.defaultPlaybackRate = r; }
  }
  function pauseEls() { for (const c of S.clips) if (!c.el.paused) c.el.pause(); }
  function longest() { let b = S.clips[0]; for (const c of S.clips) if (len(c) > len(b)) b = c; return b; }

  function startNative() {
    manual = false; S.rateFactor = 1; applyRate(); setAudio();
    if (S.mode === 'sequence') {
      const L = locate(S.frame);
      const c = L.clip;
      for (const o of S.clips) { o.el.classList.toggle('vis', o === c); o.el._prepped = false; }
      const t = L.local / c.media.fps;
      if (Math.abs(c.el.currentTime - t) > 0.5 / c.media.fps) c.el.currentTime = t;
      c.el.play().catch(() => {});
      master = c;
    } else {
      master = longest();
      for (const c of S.clips) {
        const g = Math.min(S.frame, len(c) - 1);
        const t = (c.tin + g) / c.media.fps;
        if (Math.abs(c.el.currentTime - t) > 0.5 / c.media.fps) c.el.currentTime = t;
        if (S.frame < len(c)) c.el.play().catch(() => {});
      }
    }
    resetMeasure();
    watchFrames(master);
  }
  function startManual() { pauseEls(); manual = true; lastStep = performance.now(); resetMeasure(); }
  function resetMeasure() {
    const now = performance.now();
    qT = now; steadyT = now; vfcT = now; vfcFrames = 0; stepsT = now; stepsCount = 0; S.dropped = 0;
    qDropped = master && master.el.getVideoPlaybackQuality ? master.el.getVideoPlaybackQuality().droppedVideoFrames : 0;
  }
  function watchFrames(c) {
    if (!c || !c.el.requestVideoFrameCallback) return;
    const v = c.el;
    const cb = () => { if (!S.playing || manual || master !== c) return; vfcFrames++; v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
  }

  function play(dir = 1) {
    if (!total()) return;
    ensureAudio();
    if (S.playing) stopInternal();
    S.playing = true; S.dir = dir;
    if (dir > 0 && S.frame >= endF()) S.frame = startF();
    if (dir < 0 && S.frame <= startF()) S.frame = endF();
    if (dir > 0) startNative(); else startManual();
    changed();
  }
  function stopInternal() { pauseEls(); manual = false; }
  function pause() {
    if (!S.playing) return;
    S.playing = false; stopInternal();
    S.measuredFps = 0;
    showFrame(S.frame);
  }
  function toggle() { if (S.playing) pause(); else play(S.dir < 0 ? -1 : 1); }
  function toggleDir() { const d = -S.dir; if (S.playing) play(d); else S.dir = d; changed(); }
  function shuttle(d) {
    if (S.playing && S.dir === d) S.speed = Math.min(8, S.speed * 2);
    else S.speed = 1;
    play(d);
  }
  function stop() { pause(); S.speed = 1; applyRate(); changed(); }

  function handleEnd() {
    const mode = S.loopMode;
    if (S.dir > 0) {
      if (mode === 'loop') { stopInternal(); S.frame = startF(); startNative(); }
      else if (mode === 'pingpong') { stopInternal(); S.dir = -1; S.frame = endF(); showFrame(S.frame); startManual(); }
      else { S.playing = false; stopInternal(); showFrame(endF()); }
    } else {
      if (mode === 'loop') { S.frame = endF(); showFrame(S.frame); lastStep = performance.now(); }
      else if (mode === 'pingpong') { S.dir = 1; S.frame = startF(); startNative(); }
      else { S.playing = false; stopInternal(); showFrame(startF()); }
    }
    changed();
  }

  function tick(now) {
    if (!S.playing || !S.clips.length) return;
    if (manual) {
      const interval = 1000 / (fps() * S.speed);
      const busy = S.clips.some((c) => c.el.seeking);
      if (now - lastStep >= interval && !(S.allFrames && busy)) {
        if (now - lastStep > interval * 4) lastStep = now; else lastStep += interval;
        const n = S.frame + S.dir;
        if ((S.dir < 0 && n < startF()) || (S.dir > 0 && n > endF())) { handleEnd(); return; }
        showFrame(n);
        stepsCount++;
      }
      if (now - stepsT >= 500) { S.measuredFps = (stepsCount * 1000) / (now - stepsT); stepsCount = 0; stepsT = now; }
      return;
    }
    if (S.mode === 'sequence') {
      const L = locate(S.frame); const c = L.clip; const i = L.i;
      if (master !== c) { master = c; watchFrames(c); }
      const lf = frameOfEl(c);
      const st = starts();
      if (c.el.ended || lf > c.tout) {
        if (i + 1 < S.clips.length && st[i + 1] <= endF()) {
          c.el.pause();
          const nx = S.clips[i + 1];
          S.frame = st[i + 1];
          if (Math.abs(nx.el.currentTime - nx.tin / nx.media.fps) > 0.5 / nx.media.fps) nx.el.currentTime = nx.tin / nx.media.fps;
          for (const o of S.clips) o.el.classList.toggle('vis', o === nx);
          setAudio(); nx.el.play().catch(() => {});
          master = nx; watchFrames(nx);
        } else { handleEnd(); return; }
      } else {
        S.frame = st[i] + clamp(lf - c.tin, 0, len(c) - 1);
        if (S.frame > endF()) { handleEnd(); return; }
        const nx = S.clips[i + 1];
        if (nx && !nx.el._prepped && c.tout - lf < c.media.fps) { seekEl(nx.el, nx.tin / nx.media.fps); nx.el._prepped = true; }
      }
    } else {
      const m = master || longest();
      const g = frameOfEl(m) - m.tin;
      if (m.el.ended || g > endF() || g >= total()) { handleEnd(); return; }
      S.frame = clamp(g, 0, total() - 1);
      const f = m.media.fps;
      for (const c of S.clips) {
        if (c === m) continue;
        if (S.frame >= len(c)) { if (!c.el.paused) { c.el.pause(); seekEl(c.el, timeFor(c, c.tout)); } continue; }
        const target = (c.tin + S.frame) / c.media.fps + (m.el.currentTime * f - Math.floor(m.el.currentTime * f + 1e-3)) / f;
        if (c.el.paused) { c.el.currentTime = target; c.el.play().catch(() => {}); }
        else if (Math.abs(c.el.currentTime - target) > 1.5 / c.media.fps) c.el.currentTime = target;
      }
    }
    // measurement + all-frames rate control
    if (now - qT >= 500 && master) {
      const q = master.el.getVideoPlaybackQuality ? master.el.getVideoPlaybackQuality() : null;
      const dropped = q ? q.droppedVideoFrames : 0;
      const dd = Math.max(0, dropped - qDropped); qDropped = dropped;
      S.measuredFps = (vfcFrames * 1000) / (now - vfcT);
      vfcFrames = 0; vfcT = now;
      if (S.allFrames) {
        if (dd > 0) { S.rateFactor = Math.max(0.2, S.rateFactor * 0.85); steadyT = now; applyRate(); }
        else if (S.rateFactor < 1 && now - steadyT > 2000) { S.rateFactor = Math.min(1, S.rateFactor * 1.08); steadyT = now; applyRate(); }
      } else S.dropped += dd;
      qT = now;
    }
    changed();
  }

  // ---------- stepping & navigation ----------
  function step(d) {
    if (!total()) return;
    ensureAudio();
    if (S.playing) pause();
    let n = S.frame + d;
    if (Settings.get('stepWraps') && (S.inF != null || S.outF != null)) {
      if (n > endF()) n = startF(); else if (n < startF()) n = endF();
    }
    showFrame(clamp(n, 0, total() - 1), { scrub: true });
  }
  function goto(g, scrub = false) { if (S.playing) pause(); showFrame(g, { scrub }); }
  function goStart() { goto(S.frame > startF() || S.inF == null ? startF() : 0); }
  function goEnd() { goto(S.frame < endF() || S.outF == null ? endF() : total() - 1); }

  // ---------- marks, in/out ----------
  function boundaries() {
    if (S.marks.size) return [...S.marks].sort((a, b) => a - b);
    return S.mode === 'sequence' ? starts().slice(1) : [];
  }
  function prevMark() { const b = boundaries().filter((x) => x < S.frame); if (b.length) goto(b[b.length - 1]); else goto(0); }
  function nextMark() { const b = boundaries().filter((x) => x > S.frame); if (b.length) goto(b[0]); else goto(total() - 1); }
  function toggleMark(g = S.frame) { commit(); if (S.marks.has(g)) S.marks.delete(g); else S.marks.add(g); changed(); }
  function ranges() {
    const T = total(); const b = [0, ...boundaries().filter((x) => x > 0 && x < T), T];
    const r = []; for (let i = 0; i < b.length - 1; i++) if (b[i + 1] > b[i]) r.push([b[i], b[i + 1] - 1]);
    return r;
  }
  function rangeStep(d) {
    const r = ranges(); if (!r.length) return;
    const ref = S.inF != null ? S.inF : S.frame;
    let i = r.findIndex(([a, b]) => ref >= a && ref <= b); if (i < 0) i = 0;
    const isSet = S.inF === r[i][0] && S.outF === r[i][1];
    const j = clamp(isSet ? i + d : (d > 0 ? i : i), 0, r.length - 1);
    S.inF = r[j][0]; S.outF = r[j][1]; goto(S.inF);
  }
  function setIn(g = S.frame) { S.inF = g; if (S.outF != null && S.outF < g) S.outF = null; changed(); }
  function setOut(g = S.frame) { S.outF = g; if (S.inF != null && S.inF > g) S.inF = null; changed(); }
  function clearInOut() { S.inF = S.outF = null; changed(); }

  // ---------- view ----------
  function layout() {
    const n = S.clips.length;
    stage.className = S.mode + (S.mode === 'stack' && S.combine === 'invdiff' ? ' invdiff' : '');
    stage.style.gridTemplateColumns = ''; stage.style.gridTemplateRows = '';
    if (S.mode === 'layout') { stage.style.gridTemplateColumns = `repeat(${Math.max(1, n)}, minmax(0,1fr))`; stage.style.gridTemplateRows = 'minmax(0,1fr)'; }
    if (S.mode === 'tile') { const cols = Math.ceil(Math.sqrt(n || 1)); stage.style.gridTemplateColumns = `repeat(${cols}, minmax(0,1fr))`; stage.style.gridTemplateRows = `repeat(${Math.ceil(n / cols) || 1}, minmax(0,1fr))`; }
    const W = viewer.clientWidth, H = viewer.clientHeight;
    const top = stackTop();
    const order = S.stackOrder.map(byId).filter(Boolean);
    S.clips.forEach((c, i) => {
      const v = c.el;
      v.style.order = i;
      v.style.mixBlendMode = ''; v.style.clipPath = ''; v.style.zIndex = '';
      v.style.width = v.style.height = v.style.left = v.style.top = '';
      const r = ((c.rot % 360) + 360) % 360;
      v.style.transform = (r ? `rotate(${r}deg) ` : '') + ((c.fh || c.fv) ? `scale(${c.fh ? -1 : 1},${c.fv ? -1 : 1})` : '');
      if ((r === 90 || r === 270) && (S.mode === 'sequence' || S.mode === 'stack')) {
        v.style.width = H + 'px'; v.style.height = W + 'px'; v.style.left = (W - H) / 2 + 'px'; v.style.top = (H - W) / 2 + 'px';
      }
      if (S.mode === 'stack') {
        const k = order.indexOf(c);
        v.style.zIndex = String(n - k);
        const vis = S.combine === 'replace' ? c === top : true;
        v.classList.toggle('vis', vis);
        if (c === top && n > 1) {
          if (S.combine === 'add') v.style.mixBlendMode = 'plus-lighter';
          else if (S.combine === 'difference' || S.combine === 'invdiff') v.style.mixBlendMode = 'difference';
          else if (S.combine === 'over' && S.wipes) v.style.clipPath = `inset(0 ${(1 - S.wipeX) * 100}% 0 0)`;
        }
      }
    });
    if (S.mode === 'sequence' && S.clips.length) { const c = locate(S.frame).clip; for (const o of S.clips) o.el.classList.toggle('vis', o === c); }
    applyView();
  }
  function applyView() {
    const W = viewer.clientWidth, H = viewer.clientHeight, v = S.view;
    stage.style.transform = `translate(${v.px}px,${v.py}px) scale(${v.z}) translate(${W / 2}px,${H / 2}px) scale(${v.flipX ? -1 : 1},${v.flipY ? -1 : 1}) translate(${-W / 2}px,${-H / 2}px)`;
    const wl = $('#wipe-line');
    const showWipe = S.mode === 'stack' && S.wipes && S.combine === 'over' && S.clips.length > 1;
    wl.hidden = !showWipe;
    if (showWipe) wl.style.left = (v.px + S.wipeX * W * v.z) + 'px';
  }
  function fitView() { S.view.z = 1; S.view.px = 0; S.view.py = 0; applyView(); changed(); }
  function zoomAbout(cx, cy, nz) {
    const v = S.view; nz = clamp(nz, 0.1, 64);
    const wx = (cx - v.px) / v.z, wy = (cy - v.py) / v.z;
    v.px = cx - wx * nz; v.py = cy - wy * nz; v.z = nz; applyView(); changed();
  }
  function pixelScale(n) {
    const c = curClip(); if (!c || !c.media.w) return;
    const W = viewer.clientWidth, H = viewer.clientHeight;
    const s0 = Math.min(W / c.media.w, H / c.media.h);
    zoomAbout(W / 2, H / 2, (n / (window.devicePixelRatio || 1)) / s0);
  }
  function fitWindowTo(m) {
    if (!Settings.get('resizeToVideo') || !m.w || !m.h) return;
    const extra = $('#titlebar').offsetHeight + $('#bottom').offsetHeight;
    if (API) { API.fitWindow({ w: m.w, h: m.h, extraH: extra }); return; }
    // installed web app window
    const standalone = matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches;
    if (!standalone || document.fullscreenElement) return;
    try {
      const chromeW = outerWidth - innerWidth, chromeH = outerHeight - innerHeight;
      const maxW = screen.availWidth * 0.85, maxH = screen.availHeight * 0.85 - extra - chromeH;
      const s = Math.min(1, maxW / m.w, maxH / m.h);
      const w = Math.max(640, Math.round(m.w * s)) + chromeW, h = Math.max(420, Math.round(m.h * s) + extra) + chromeH;
      resizeTo(w, h);
      moveTo(Math.round((screen.availWidth - w) / 2) + (screen.availLeft || 0), Math.round((screen.availHeight - h) / 2) + (screen.availTop || 0));
    } catch (e) {}
  }

  // ---------- session ----------
  function snapshot() {
    return { clips: S.clips.map((c) => ({ id: c.id, media: c.media, tin: c.tin, tout: c.tout, rot: c.rot, fh: c.fh, fv: c.fv, mute: c.mute, auto: c.auto })), marks: [...S.marks], inF: S.inF, outF: S.outF, stackOrder: S.stackOrder.slice(), audioClip: S.audioClip, frame: S.frame };
  }
  function restore(s) {
    const keep = new Map(S.clips.map((c) => [c.id, c]));
    const next = [];
    for (const d of s.clips) {
      let c = keep.get(d.id);
      if (c) { keep.delete(d.id); Object.assign(c, { tin: d.tin, tout: d.tout, rot: d.rot, fh: d.fh, fv: d.fv, mute: d.mute, auto: d.auto }); }
      else { c = { ...d, el: null }; c.el = makeEl(c); }
      next.push(c);
    }
    for (const c of keep.values()) { c.el.pause(); c.el.removeAttribute('src'); c.el.load(); c.el.remove(); }
    S.clips = next; S.marks = new Set(s.marks); S.inF = s.inF; S.outF = s.outF; S.stackOrder = s.stackOrder.filter((id) => byId(id)); S.audioClip = s.audioClip;
    syncOrder(); layout(); showFrame(clamp(s.frame, 0, Math.max(0, total() - 1)));
  }
  function commit() { hist.undo.push(snapshot()); if (hist.undo.length > 200) hist.undo.shift(); hist.redo = []; }
  function undo() { if (!hist.undo.length) return; if (S.playing) pause(); hist.redo.push(snapshot()); restore(hist.undo.pop()); toast('Undo'); }
  function redo() { if (!hist.redo.length) return; if (S.playing) pause(); hist.undo.push(snapshot()); restore(hist.redo.pop()); toast('Redo'); }
  function syncOrder() {
    const ids = S.clips.map((c) => c.id);
    S.stackOrder = S.stackOrder.filter((id) => ids.includes(id));
    for (const id of ids) if (!S.stackOrder.includes(id)) S.stackOrder.push(id);
    if (!byId(S.audioClip)) S.audioClip = ids[0] || null;
    if (!byId(S.cur)) S.cur = ids[0] || null;
  }

  function addFiles(files, { add = false, mode = null } = {}) {
    if (!files.length) return;
    if (S.playing) pause();
    const wasEmpty = !add || !S.clips.length;
    if (!add) clearSession(true);
    else commit();
    let first = null;
    for (const f of files) {
      const m = Media.create(f);
      const c = makeClip(m);
      S.clips.push(c);
      if (!first) first = m;
      Media.load(m);
      Recent.add(f.path);
    }
    if (wasEmpty && first) S._fitPending = first;
    if (mode) S.mode = mode;
    syncOrder(); layout();
    if (wasEmpty) { S.frame = 0; fitView(); }
    showFrame(S.frame);
    if (typeof App !== 'undefined') App.sessionChanged();
  }
  function clearSession(silent) {
    if (S.playing) pause();
    for (const c of S.clips) { c.el.pause(); c.el.removeAttribute('src'); c.el.load(); c.el.remove(); }
    S.clips = []; S.stackOrder = []; S.audioClip = null; S.cur = null;
    S.frame = 0; S.inF = S.outF = null; S.marks = new Set(); hist.undo = []; hist.redo = [];
    layout();
    if (!silent && typeof App !== 'undefined') App.sessionChanged();
    changed();
  }

  // ---------- editing ----------
  function split() {
    if (S.mode !== 'sequence') { toast('Split works in Sequence mode'); return; }
    const L = locate(S.frame); const c = L.clip;
    if (L.local <= c.tin) { toast('Already at the start of a clip'); return; }
    commit();
    const nc = makeClip(c.media, { tin: L.local, tout: c.tout, rot: c.rot, fh: c.fh, fv: c.fv, mute: c.mute, auto: false });
    c.tout = L.local - 1; c.auto = false;
    S.clips.splice(L.i + 1, 0, nc);
    syncOrder(); layout(); showFrame(S.frame); toast('Split');
  }
  function removeClip(c) {
    if (!c) return;
    commit();
    const i = S.clips.indexOf(c);
    S.clips.splice(i, 1);
    c.el.pause(); c.el.removeAttribute('src'); c.el.load(); c.el.remove();
    syncOrder(); layout();
    S.frame = clamp(S.frame, 0, Math.max(0, total() - 1));
    S.inF = S.inF != null && S.inF < total() ? S.inF : null; S.outF = S.outF != null && S.outF < total() ? S.outF : null;
    showFrame(S.frame);
    if (typeof App !== 'undefined') App.sessionChanged();
  }
  function copyClip(c = curClip()) { if (!c) return; clipboard = { media: c.media, tin: c.tin, tout: c.tout, rot: c.rot, fh: c.fh, fv: c.fv, mute: c.mute }; toast('Clip copied'); }
  function cutClip() { const c = curClip(); if (!c) return; copyClip(c); removeClip(c); toast('Clip cut'); }
  function pasteClip() {
    if (!clipboard) { toast('Nothing to paste'); return; }
    commit();
    const c = makeClip(clipboard.media, { ...clipboard, auto: false });
    const cur = curClip();
    const i = cur ? S.clips.indexOf(cur) + 1 : S.clips.length;
    S.clips.splice(i, 0, c);
    syncOrder(); layout();
    if (S.mode === 'sequence') showFrame(starts()[i]); else showFrame(S.frame);
    toast('Clip pasted'); if (typeof App !== 'undefined') App.sessionChanged();
  }
  function moveClip(from, to) {
    if (from === to || from < 0 || to < 0 || from >= S.clips.length || to >= S.clips.length) return;
    commit();
    const c = S.clips.splice(from, 1)[0]; S.clips.splice(to, 0, c);
    syncOrder(); layout(); showFrame(S.frame);
    if (typeof App !== 'undefined') App.sessionChanged();
  }
  function trimClip(c, tin, tout) {
    commit();
    c.tin = clamp(Math.round(tin), 0, c.media.frames - 1); c.tout = clamp(Math.round(tout), c.tin, c.media.frames - 1); c.auto = false;
    S.inF = S.outF = null; layout(); showFrame(Math.min(S.frame, total() - 1)); toast('Trimmed');
  }
  function trimToInOut() {
    if (S.inF == null && S.outF == null) { toast('Set an In or Out point first ( [ and ] )'); return; }
    const a = startF(), b = endF();
    commit();
    if (S.mode === 'sequence') {
      const st = starts(); const keep = [];
      S.clips.forEach((c, i) => {
        const s = st[i], e = s + len(c) - 1;
        if (e < a || s > b) { c.el.pause(); c.el.removeAttribute('src'); c.el.load(); c.el.remove(); return; }
        const ntin = c.tin + Math.max(0, a - s), ntout = c.tout - Math.max(0, e - b);
        c.tin = ntin; c.tout = ntout; c.auto = false; keep.push(c);
      });
      S.clips = keep;
    } else {
      for (const c of S.clips) { const L = len(c); c.tin = c.tin + Math.min(a, L - 1); c.tout = Math.min(c.tout, c.tin + (b - a)); c.auto = false; }
    }
    S.inF = S.outF = null;
    const nm = new Set(); for (const m of S.marks) if (m >= a && m <= b) nm.add(m - a); S.marks = nm;
    syncOrder(); layout(); showFrame(0); toast('Trimmed to In / Out');
    if (typeof App !== 'undefined') App.sessionChanged();
  }
  function modClip(fn, msg) { const c = curClip(); if (!c) return; commit(); fn(c); layout(); showFrame(S.frame); if (msg) toast(msg); }

  function setMode(m) {
    if (S.mode === m) return;
    const wasPlaying = S.playing; if (wasPlaying) pause();
    const T0 = total();
    // keep the same source frame when switching
    let keepClip = null, keepLocal = 0;
    if (S.clips.length) { const L = locate(S.frame); keepClip = L.clip; keepLocal = L.local; }
    S.mode = m;
    if (keepClip) {
      if (m === 'sequence') { const i = S.clips.indexOf(keepClip); S.frame = starts()[i] + (keepLocal - keepClip.tin); }
      else { S.cur = keepClip.id; S.frame = keepLocal - keepClip.tin; }
    }
    S.frame = clamp(S.frame, 0, Math.max(0, total() - 1));
    if (total() !== T0) { S.inF = S.outF = null; S.marks = new Set(); }
    layout(); showFrame(S.frame);
    if (wasPlaying) play(1);
    if (typeof App !== 'undefined') App.sessionChanged();
  }
  function cycleStack(d) {
    if (S.stackOrder.length < 2) return;
    if (d > 0) S.stackOrder.push(S.stackOrder.shift()); else S.stackOrder.unshift(S.stackOrder.pop());
    S.cur = S.stackOrder[0]; layout(); changed();
  }

  // ---------- frame display ----------
  function frameText(g, kind = S.display) {
    if (!S.clips.length || g == null) return '–';
    const f = fps();
    switch (kind) {
      case 'session': return String(g + 1);
      case 'timecode': return fmtTC(g, f);
      case 'seconds': return (g / f).toFixed(2) + 's';
      case 'footage': return `${Math.floor(g / 16)}+${pad(g % 16)}`;
      default: {
        if (S.mode !== 'sequence') return String(g + 1);
        const L = locate(clamp(g, 0, total() - 1)); return String(L.local + 1);
      }
    }
  }
  function parseFrameText(t) {
    t = String(t).trim(); if (!t) return null;
    const f = fps();
    if (t.includes(':')) { const p = t.split(':').map(Number); while (p.length < 4) p.unshift(0); return ((p[0] * 3600 + p[1] * 60 + p[2]) * Math.round(f)) + p[3]; }
    if (t.includes('+')) { const [a, b] = t.split('+').map(Number); return a * 16 + (b || 0); }
    if (/s$/i.test(t) || t.includes('.')) return Math.round(parseFloat(t) * f);
    const n = parseInt(t, 10); if (!isFinite(n)) return null;
    if (S.display === 'source' && S.clips.length) { const L = locate(S.frame); return L.start + (n - 1 - L.clip.tin); }
    return n - 1;
  }

  // public
  return {
    set onChange(fn) { changed = fn; },
    total, starts, locate, curClip, byId, len, fps, startF, endF, stackTop, hearClip,
    showFrame, play, pause, toggle, toggleDir, shuttle, stop, step, goto, goStart, goEnd, tick, setAudio, applyRate,
    prevMark, nextMark, toggleMark, rangeStep, setIn, setOut, clearInOut, ranges,
    layout, applyView, fitView, zoomAbout, pixelScale,
    addFiles, clearSession, split, removeClip, copyClip, cutClip, pasteClip, moveClip, trimClip, trimToInOut, modClip,
    setMode, cycleStack, undo, redo, commit, canUndo: () => hist.undo.length > 0, canRedo: () => hist.redo.length > 0, hasClipboard: () => !!clipboard,
    frameText, parseFrameText, ensureAudio, timeFor, fitWindowTo,
  };
})();

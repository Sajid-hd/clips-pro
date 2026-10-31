'use strict';
/* Media files: probing, "needs converting" checks, audio for scrubbing/waveform, conversion */
const Media = (() => {
  const NATIVE_V = new Set(['h264', 'vp8', 'vp9', 'av1', 'theora', 'hevc']);
  const NATIVE_A = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
  const CONVERT_EXT = new Set(['avi', 'wmv', 'asf', 'mpg', 'mpeg', 'm2v', 'ts', 'mts', 'm2ts', 'mxf', 'flv', 'vob', 'dv', 'f4v', 'rm', 'rmvb', 'divx', 'xvid', '3g2']);
  const listeners = [];
  const byJob = new Map();
  const onUpdate = (fn) => listeners.push(fn);
  const emit = (m, what) => listeners.forEach((f) => f(m, what));

  const nice = (s) => String(s || '').split(' / ')[0].replace(/\s*\(.*?\)\s*/g, ' ').trim();
  function ext(name) { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i + 1).toLowerCase() : ''; }

  function create(fi) {
    return {
      id: uid(), path: fi.path || '', name: fi.name || 'video', url: fi.url, size: fi.size || 0, playUrl: fi.url, file: fi.file || null,
      info: null, fps: 24, frames: 0, duration: 0, w: 0, h: 0, hasVideo: true, hasAudio: true,
      status: 'loading', reason: '', convertPct: 0, peaks: null, pcm: null, pcmRate: 0, abuf: null, probed: false,
    };
  }

  function convertReason(m) {
    const e = ext(m.name);
    const i = m.info;
    if (CONVERT_EXT.has(e)) return `${e.toUpperCase()} files can't play directly.`;
    if (i && i.video && !NATIVE_V.has(i.video.codec)) return `${nice(i.video.codecLong || i.video.codec) || 'This'} video can't play directly.`;
    if (i && i.audio && !NATIVE_A.has(i.audio.codec) && !(e === 'wav' && /^pcm_/.test(i.audio.codec))) {
      if (i.video || !/^pcm_/.test(i.audio.codec)) return `${nice(i.audio.codecLong || i.audio.codec)} audio can't play directly.`;
    }
    return '';
  }

  async function load(m) {
    if (API && m.path) {
      const p = await API.probe(m.path).catch(() => null);
      if (p && p.ok) {
        m.info = p; m.probed = true;
        m.hasVideo = !!p.video; m.hasAudio = !!p.audio;
        if (p.video) {
          m.fps = p.video.fps || 24; m.frames = Math.max(1, p.video.frames || Math.round(p.video.duration * m.fps));
          m.duration = p.video.duration || p.duration; m.w = p.video.width; m.h = p.video.height;
          if (Math.abs(p.video.rotation) === 90) { const t = m.w; m.w = m.h; m.h = t; }
        } else { m.duration = p.duration; m.frames = Math.max(1, Math.round(p.duration * m.fps)); }
        const r = convertReason(m);
        if (r) { m.status = 'convert'; m.reason = r; } else if (m.status === 'loading') m.status = 'ready';
      }
      emit(m, 'probe');
      if (m.status === 'convert' && Settings.get('autoConvert')) convert(m);
      if (m.hasAudio) loadAudio(m);
    } else {
      emit(m, 'probe');
    }
  }

  // called by the player from the <video> element when there's no probe data (browser mode)
  function fromElement(m, v) {
    if (m.probed || m._metaDone) return;
    m._metaDone = true;
    m.duration = v.duration || 0; m.w = v.videoWidth; m.h = v.videoHeight; m.hasVideo = v.videoWidth > 0;
    m.frames = Math.max(1, Math.round(m.duration * m.fps));
    if (m.status === 'loading') m.status = 'ready';
    m.fpsDetected = false;
    emit(m, 'meta');
    if (m.hasVideo) detectFps(m);
    if (m.file) loadAudioWeb(m);
  }

  // Browser version: measure the frame rate by watching a few decoded frames on a hidden copy
  const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 119.88, 120];
  function detectFps(m) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = m.playUrl;
    const times = [];
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
      const d = [];
      for (let i = 1; i < times.length; i++) { const x = times[i] - times[i - 1]; if (x > 0.003 && x < 0.2) d.push(x); }
      if (d.length < 4) return;
      d.sort((a, b) => a - b);
      // the smallest common spacing is one frame (playback may present every 1 or 2 frames)
      const base = d[Math.floor(d.length * 0.25)];
      let f = 1 / base;
      let snap = null, best = 1;
      for (const c of COMMON_FPS) { const e = Math.abs(c - f) / c; if (e < 0.02 && e < best) { best = e; snap = c; } }
      if (snap) f = snap;
      if (f < 5 || f > 240) return;
      m.fps = f; m.fpsDetected = true;
      m.frames = Math.max(1, Math.round(m.duration * f));
      emit(m, 'meta');
    };
    if (!v.requestVideoFrameCallback) return;
    const cb = (now, meta) => { if (done) return; times.push(meta.mediaTime); if (times.length >= 16) finish(); else v.requestVideoFrameCallback(cb); };
    v.addEventListener('loadeddata', () => {
      try { v.currentTime = Math.min(1, (v.duration || 2) / 3); } catch (e) {}
      v.addEventListener('seeked', () => { v.requestVideoFrameCallback(cb); v.play().catch(finish); }, { once: true });
    }, { once: true });
    setTimeout(finish, 4000);
  }

  // Browser version: decode the sound in the page for the waveform and audio scrub
  async function loadAudioWeb(m) {
    if (!m.file || m.size > 800 * 1024 * 1024) return;
    try {
      const ab = await m.file.arrayBuffer();
      const tmp = new OfflineAudioContext(1, 1, 16000);
      const dec = await tmp.decodeAudioData(ab);
      const rate = dec.duration > 2400 ? 8000 : 16000;
      const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(dec.duration * rate)), rate);
      const src = off.createBufferSource(); src.buffer = dec; src.connect(off.destination); src.start();
      const out = await off.startRendering();
      const f = out.getChannelData(0);
      const pcm = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
      m.hasAudio = true;
      setPcm(m, pcm, rate);
    } catch (e) { m.hasAudio = false; emit(m, 'meta'); }
  }
  function markUnplayable(m, why) {
    if (m.status === 'convert' || m.status === 'converting') return;
    if (m.playUrl !== m.url) { m.status = 'error'; m.reason = 'The converted copy could not play either.'; emit(m, 'status'); return; }
    m.status = 'convert'; m.reason = why || 'This format can\'t play directly.';
    emit(m, 'status');
    if (Settings.get('autoConvert') && API) convert(m);
  }

  async function loadAudio(m) {
    const r = await API.audioPcm(m.path, m.duration).catch(() => null);
    if (!r || !r.ok) return;
    const bytes = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
    const pcm = new Int16Array(bytes.byteLength >> 1);
    new Uint8Array(pcm.buffer).set(bytes.subarray(0, pcm.length * 2));
    setPcm(m, pcm, r.rate);
  }
  function setPcm(m, pcm, rate) {
    m.pcm = pcm; m.pcmRate = rate; m.abuf = null;
    const win = Math.max(1, Math.round(rate / 100)); // 10 ms windows
    const peaks = new Float32Array(Math.ceil(pcm.length / win));
    let mx = 0;
    for (let i = 0; i < peaks.length; i++) {
      let p = 0; const end = Math.min(pcm.length, (i + 1) * win);
      for (let j = i * win; j < end; j++) { const a = pcm[j] < 0 ? -pcm[j] : pcm[j]; if (a > p) p = a; }
      peaks[i] = p / 32768; if (peaks[i] > mx) mx = peaks[i];
    }
    if (mx > 0.05) for (let i = 0; i < peaks.length; i++) peaks[i] = Math.min(1, peaks[i] / mx);
    m.peaks = peaks;
    emit(m, 'audio');
  }

  function audioBuffer(m, ctx) {
    if (m.abuf || !m.pcm || !ctx) return m.abuf;
    const b = ctx.createBuffer(1, m.pcm.length, m.pcmRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < m.pcm.length; i++) d[i] = m.pcm[i] / 32768;
    m.abuf = b; return b;
  }

  async function convert(m) {
    if (!API || m.status === 'converting') return;
    m.status = 'converting'; m.convertPct = 0; emit(m, 'status');
    byJob.set(m.id, m);
    const v = m.info && m.info.video;
    const r = await API.convert({ id: m.id, path: m.path, width: v ? v.width : 1280, height: v ? v.height : 720, fps: m.fps, duration: m.duration }).catch((e) => ({ ok: false, error: String(e) }));
    byJob.delete(m.id);
    if (r && r.ok) { m.playUrl = r.url; m.status = 'ready'; m.reason = ''; m.convertedPath = r.path; emit(m, 'converted'); }
    else if (r && r.cancelled) { m.status = 'convert'; emit(m, 'status'); }
    else { m.status = 'error'; m.reason = 'Conversion failed.'; m.error = r && r.error; emit(m, 'status'); }
  }
  function cancel(m) { if (API) API.cancelJob(m.id); }
  if (API) API.onJobProgress(({ id, pct }) => { const m = byJob.get(id); if (m) { m.convertPct = pct; emit(m, 'progress'); } });

  return { create, load, fromElement, markUnplayable, convert, cancel, audioBuffer, onUpdate, ext, NATIVE_V };
})();

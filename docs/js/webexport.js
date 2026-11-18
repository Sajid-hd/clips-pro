'use strict';
/* Clips Pro — exporting inside Chrome (no ffmpeg needed).
   Frames are drawn exactly (seek per frame), encoded with Chrome's own video encoder
   (uses the PC's graphics card when it can), sound is mixed offline, and the result is
   written straight to disk as MP4 (H.264) or WebM (VP9). Handles a chosen frame rate
   and splitting into several parts. */
const WebExport = (() => {
  const supported = () => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && window.isSecureContext;

  // ---------- frame rate ----------
  const FPS_LIST = [['23.976', 24000 / 1001], ['24', 24], ['25', 25], ['29.97', 30000 / 1001], ['30', 30], ['50', 50], ['59.94', 60000 / 1001], ['60', 60]];
  const niceFps = (x) => { for (const [t, v] of FPS_LIST) if (Math.abs(v - x) < 0.002) return t; return String(Math.round(x * 1000) / 1000); };
  const snapFps = (x) => { for (const [, v] of FPS_LIST) if (Math.abs(v - x) < 0.01) return v; return x; };

  // ---------- options shown in the export dialogs ----------
  // opts: { srcFps, marks: bool (offer "at marks"), onChange }
  function optionsUI(opts) {
    const fpsSel = el('select', { id: 'ex-fps', style: 'flex:1;min-width:0' }, el('option', { value: 'source' }, `Same as source (${niceFps(opts.srcFps)})`), FPS_LIST.map(([t]) => el('option', { value: t }, t + ' fps')), el('option', { value: 'custom' }, 'Custom…'));
    const fpsCustom = el('input', { type: 'number', min: '1', max: '240', step: '0.001', value: String(Math.round(opts.srcFps * 1000) / 1000), style: 'width:84px;flex:none', hidden: true, title: 'Frames per second' });
    const splitSel = el('select', { id: 'ex-split', style: 'flex:1;min-width:0' },
      el('option', { value: 'off' }, 'Off: one file'),
      el('option', { value: 'secs' }, 'Every N seconds'),
      el('option', { value: 'count' }, 'Into N equal parts'),
      opts.marks ? el('option', { value: 'marks' }, 'At the marks') : null,
      el('option', { value: 'size' }, 'Max size per part (MB)'));
    const splitNum = el('input', { type: 'number', min: '1', step: '1', style: 'width:76px;flex:none', hidden: true });
    const DEF = { secs: 60, count: 2, size: 500 };
    fpsSel.value = Settings.get('exportFpsSel') || 'source'; if (fpsSel.value === '') fpsSel.value = 'source';
    if (fpsSel.value === 'custom') fpsCustom.value = Settings.get('exportFpsCustom') || fpsCustom.value;
    splitSel.value = 'off';
    const sync = (fire = true) => {
      fpsCustom.hidden = fpsSel.value !== 'custom';
      splitNum.hidden = splitSel.value === 'off' || splitSel.value === 'marks';
      if (fire && opts.onChange) opts.onChange();
    };
    fpsSel.addEventListener('change', () => { Settings.set('exportFpsSel', fpsSel.value); sync(); });
    fpsCustom.addEventListener('input', () => { Settings.set('exportFpsCustom', fpsCustom.value); if (opts.onChange) opts.onChange(); });
    splitSel.addEventListener('change', () => { if (DEF[splitSel.value]) splitNum.value = String(DEF[splitSel.value]); sync(); });
    splitNum.addEventListener('input', () => { if (opts.onChange) opts.onChange(); });
    const node = el('div', { class: 'kv-grid' },
      el('label', { class: 'fieldset', for: 'ex-fps' }, el('span', {}, 'Frame rate'), el('div', { style: 'display:flex;gap:6px;align-items:center' }, fpsSel, fpsCustom)),
      el('label', { class: 'fieldset', for: 'ex-split' }, el('span', {}, 'Split into parts'), el('div', { style: 'display:flex;gap:6px;align-items:center' }, splitSel, splitNum)));
    sync(false);
    return {
      node,
      fps: () => {
        if (fpsSel.value === 'source') return opts.srcFps;
        if (fpsSel.value === 'custom') { const v = parseFloat(fpsCustom.value); return v > 0 && v <= 240 ? snapFps(v) : opts.srcFps; }
        return FPS_LIST.find((x) => x[0] === fpsSel.value)[1];
      },
      split: () => ({ mode: splitSel.value, n: Math.max(1, parseFloat(splitNum.value) || 0) }),
      setDisabled: (fpsOff, splitOff) => { fpsSel.disabled = fpsCustom.disabled = !!fpsOff; splitSel.disabled = splitNum.disabled = !!splitOff; },
    };
  }

  // ---------- parts ----------
  // N output frames at fps -> [[k0, k1), ...]. cutsK: cut points (output frames) for 'marks'. mbps: estimated bitrate for 'size'.
  function parts(N, fps, split, cutsK, mbps) {
    if (!split || split.mode === 'off' || N < 2) return [[0, N]];
    let cuts = [];
    if (split.mode === 'secs') { const step = Math.max(1, Math.round(split.n * fps)); for (let k = step; k < N; k += step) cuts.push(k); }
    else if (split.mode === 'count') { const c = Math.min(Math.round(split.n), N); for (let i = 1; i < c; i++) cuts.push(Math.round((i * N) / c)); }
    else if (split.mode === 'marks') cuts = (cutsK || []).filter((k) => k > 0 && k < N);
    else if (split.mode === 'size') {
      const secs = mbps > 0 ? (split.n * 8 * 0.94) / mbps : 0; // 6% headroom: sizes are estimates
      if (secs > 0) { const step = Math.max(1, Math.floor(secs * fps)); for (let k = step; k < N; k += step) cuts.push(k); }
    }
    cuts = [...new Set(cuts.map(Math.round))].sort((a, b) => a - b);
    const out = []; let k0 = 0;
    for (const c of cuts) { if (c > k0) { out.push([k0, c]); k0 = c; } }
    if (k0 < N) out.push([k0, N]);
    return out;
  }
  const partName = (base, i, n) => (n > 1 ? `${base}_part${pad(i + 1, 2)}` : base);

  // MP4 timescale that holds every frame time exactly (30000 for 29.97 …)
  const mp4Timescale = (f) => { if (Math.abs(f - Math.round(f)) < 1e-6) return Math.round(f); const n = f * 1.001; if (Math.abs(n - Math.round(n)) < 1e-3) return Math.round(n) * 1000; return Math.round(f * 1000); };

  // ---------- bitrate ----------
  const mbpsFor = (preset, W, H, fps, quality) => {
    const q = quality === 'low' ? 0.06 : quality === 'medium' ? 0.1 : 0.16;
    if (preset === 'audio') return 0.192;
    if (preset === 'small') return (W * H * fps * 0.05) / 1e6 + 0.128;
    return (W * H * fps * (preset === 'webm' ? q * 0.85 : q)) / 1e6 + 0.192;
  };
  const avcLevel = (W, H, fps) => {
    const mbs = Math.ceil(W / 16) * Math.ceil(H / 16), rate = mbs * fps;
    const L = [[1620, 40500, '1e'], [3600, 108000, '1f'], [5120, 216000, '20'], [8192, 245760, '28'], [8192, 522240, '2a'], [22080, 589824, '32'], [36864, 983040, '33'], [36864, 2073600, '34'], [139264, 4177920, '3c'], [139264, 8355840, '3d'], [139264, 16711680, '3e']];
    for (const [maxFs, maxRate, hex] of L) if (mbs <= maxFs && rate <= maxRate) return hex;
    return '3e';
  };

  // ---------- sound ----------
  const SR = 48000;
  const audioCache = new Map();
  async function decodeAudio(media) {
    const key = media.id || media.url;
    if (audioCache.has(key)) return audioCache.get(key);
    const p = (async () => {
      try {
        const buf = media.file ? await media.file.arrayBuffer() : await (await fetch(media.playUrl || media.url)).arrayBuffer();
        const oc = new OfflineAudioContext(2, 1, SR);
        return await oc.decodeAudioData(buf);
      } catch (e) { return null; }
    })();
    audioCache.set(key, p);
    return p;
  }
  // items: [{ media, at (sec in the part), offset (sec in source), dur (sec of part time), speed, gain, fadeIn, fadeInAt, fadeOut, fadeOutAt }]
  // renders only the window [t0, t0 + durSec) of the part, so long exports never hold all the sound at once
  let audioFailed = [];
  async function mixAudio(items, t0, durSec) {
    const len = Math.max(1, Math.ceil(durSec * SR));
    const oc = new OfflineAudioContext(2, len, SR);
    let any = false;
    for (const it of items) {
      let at = it.at - t0, off = it.offset, d = it.dur; const sp = it.speed || 1;
      if (at + d <= 0 || at >= durSec) continue;
      if (at < 0) { off += -at * sp; d += at; at = 0; }
      const buf = await decodeAudio(it.media); if (!buf) { if (!audioFailed.includes(it.media.name)) audioFailed.push(it.media.name); continue; }
      if (d <= 0 || off >= buf.duration) continue;
      const src = oc.createBufferSource(); src.buffer = buf; src.playbackRate.value = sp;
      const g = oc.createGain(); const gv = it.gain == null ? 1 : it.gain;
      const a = it.fadeIn > 0 && it.fadeInAt != null ? it.fadeInAt - t0 : null, b = a != null ? a + it.fadeIn : null;
      const c = it.fadeOut > 0 && it.fadeOutAt != null ? it.fadeOutAt - t0 : null, e = c != null ? c + it.fadeOut : null;
      const env = (t) => { let v = gv; if (a != null) v *= clamp((t - a) / (b - a), 0, 1); if (c != null) v *= 1 - clamp((t - c) / (e - c), 0, 1); return v; };
      g.gain.setValueAtTime(env(0), 0);
      for (const p of [a, b, c, e].filter((x) => x != null && x > 0).sort((x, y) => x - y)) g.gain.linearRampToValueAtTime(env(p), p);
      src.connect(g).connect(oc.destination);
      src.start(at, off, Math.min(d * sp, buf.duration - off));
      any = true;
    }
    return any ? oc.startRendering() : null;
  }

  // ---------- seeking a video element to an exact frame ----------
  const vids = new Map();
  async function videoFor(media) {
    const key = media.id || media.url;
    if (vids.has(key)) return vids.get(key);
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = media.playUrl || media.url;
    const p = new Promise((res, rej) => { v.addEventListener('loadeddata', () => res(v), { once: true }); v.addEventListener('error', () => rej(new Error('Could not read ' + (media.name || 'a video'))), { once: true }); });
    vids.set(key, p);
    return p;
  }
  function seekFrame(v, sf, mfps) {
    const t = Math.min((sf + 0.5) / mfps, Math.max(0, (v.duration || 1e9) - 0.001));
    if (v._sf === sf && v.readyState >= 2) return Promise.resolve();
    v._sf = sf;
    return new Promise((res) => {
      let done = false;
      const fin = () => { if (done) return; done = true; clearTimeout(to); res(); };
      const to = setTimeout(fin, 4000);
      if (v.requestVideoFrameCallback) { v.requestVideoFrameCallback(() => fin()); v.addEventListener('seeked', () => setTimeout(fin, 50), { once: true }); }
      else v.addEventListener('seeked', fin, { once: true });
      v.currentTime = t;
    });
  }
  function release() {
    for (const p of vids.values()) p.then((v) => { v.removeAttribute('src'); v.load(); }).catch(() => {});
    vids.clear(); audioCache.clear();
  }

  // ---------- one file ----------
  // job: { preset: h264|small|webm|audio, width, height, fps, quality, frames, drawFrame(k, g, W, H), hasAudio, audio: async (t0, dur) => AudioBuffer|null,
  //        writable (FileSystemWritableFileStream) | null, onPct(p), cancel: { cancel } }
  async function encodeFile(job) {
    const { preset } = job;
    const webm = preset === 'webm', audioOnly = preset === 'audio';
    const W = job.width + (job.width % 2), H = job.height + (job.height % 2), fps = job.fps;
    const N = job.frames, durSec = N / fps;
    const hasAudio = !!job.hasAudio;
    let aCodec = null, aCfg = null;
    if (hasAudio) {
      const tries = webm ? [['opus', 'opus']] : [['mp4a.40.2', 'aac'], ['opus', 'opus']];
      for (const [c, m] of tries) {
        const cfg = { codec: c, sampleRate: SR, numberOfChannels: 2, bitrate: preset === 'small' ? 128000 : 192000 };
        try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) { aCodec = m; aCfg = cfg; break; } } catch (e) {}
      }
    }
    if (audioOnly && !aCfg) throw new Error('There is no sound in this range.');
    let vCfg = null;
    if (!audioOnly) {
      const mbps = mbpsFor(preset, W, H, fps, job.quality) - (preset === 'small' ? 0.128 : 0.192);
      const bitrate = Math.max(500000, Math.round(mbps * 1e6));
      const cands = webm ? ['vp09.00.' + (W * H > 2228224 ? '50' : '40') + '.08'] : ['avc1.6400' + avcLevel(W, H, fps), 'avc1.4d00' + avcLevel(W, H, fps), 'avc1.4200' + avcLevel(W, H, fps)];
      for (const hw of ['prefer-hardware', 'no-preference']) {
        for (const c of cands) {
          const cfg = { codec: c, width: W, height: H, bitrate, framerate: fps, hardwareAcceleration: hw, latencyMode: 'quality', bitrateMode: 'variable' };
          if (!webm) cfg.avc = { format: 'avc' };
          try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { vCfg = cfg; break; } } catch (e) {}
        }
        if (vCfg) break;
      }
      if (!vCfg) throw new Error(`Chrome on this PC can't encode ${webm ? 'VP9' : 'H.264'} video at ${W}×${H}. Try a smaller resolution or another preset.`);
    }
    const Lib = webm ? WebMMuxer : Mp4Muxer;
    const target = job.writable ? new Lib.FileSystemWritableFileStreamTarget(job.writable) : new Lib.ArrayBufferTarget();
    const mopts = { target, firstTimestampBehavior: 'offset' };
    if (!webm) mopts.fastStart = job.writable ? false : 'in-memory';
    if (vCfg) mopts.video = webm ? { codec: 'V_VP9', width: W, height: H, frameRate: fps } : { codec: 'avc', width: W, height: H, frameRate: mp4Timescale(fps) };
    if (aCfg) mopts.audio = webm ? { codec: 'A_OPUS', sampleRate: SR, numberOfChannels: 2 } : { codec: aCodec, sampleRate: SR, numberOfChannels: 2 };
    const muxer = new Lib.Muxer(mopts);
    let err = null;
    const fail = (e) => { if (!err) err = e; };
    const aenc = aCfg ? new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: fail }) : null;
    if (aenc) aenc.configure(aCfg);
    const venc = vCfg ? new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: fail }) : null;
    if (venc) venc.configure(vCfg);
    const cv = vCfg ? new OffscreenCanvas(W, H) : null; const g = cv ? cv.getContext('2d', { alpha: false }) : null;
    const gop = Math.max(1, Math.round(fps * 2)); const t0 = performance.now();
    const WIN = 20; // seconds of sound mixed at a time
    const totalSamples = Math.round(durSec * SR); let aPos = 0;
    const pushAudio = async (uptoSec) => {
      if (!aenc) return;
      const upto = Math.min(totalSamples, Math.round(uptoSec * SR));
      while (aPos < upto && !err && !job.cancel.cancel) {
        const n0 = Math.min(WIN * SR, totalSamples - aPos);
        const ab = await job.audio(aPos / SR, n0 / SR);
        const L = ab ? ab.getChannelData(0) : null, R = ab ? (ab.numberOfChannels > 1 ? ab.getChannelData(1) : L) : null;
        const CH = 4800;
        for (let i = 0; i < n0; i += CH) {
          const n = Math.min(CH, n0 - i); const data = new Float32Array(n * 2);
          if (L) { data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n); }
          const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(((aPos + i) / SR) * 1e6), data });
          aenc.encode(ad); ad.close();
        }
        aPos += n0;
        while (aenc.encodeQueueSize > 40) await new Promise((r) => setTimeout(r, 2));
      }
    };
    if (audioOnly) {
      const step = WIN;
      for (let t = 0; t < durSec && !job.cancel.cancel && !err; t += step) { await pushAudio(t + step); job.onPct && job.onPct(Math.min(1, (t + step) / durSec), ''); }
    } else {
      for (let k = 0; k < N; k++) {
        if (job.cancel.cancel || err) break;
        if (aenc && (k / fps) + 1 >= aPos / SR) await pushAudio(aPos / SR + WIN);
        await job.drawFrame(k, g, W, H);
        const ts = Math.round((k * 1e6) / fps), dur = Math.round(((k + 1) * 1e6) / fps) - ts;
        const vf = new VideoFrame(cv, { timestamp: ts, duration: dur });
        venc.encode(vf, { keyFrame: k % gop === 0 }); vf.close();
        while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
        if (job.onPct && (k % 3 === 0 || k === N - 1)) { const el2 = (performance.now() - t0) / 1000; job.onPct((k + 1) / N, `frame ${k + 1} of ${N} · about ${fmtDur(((N - k - 1) * el2) / (k + 1))} left`); }
      }
      if (aenc) await pushAudio(durSec);
    }
    if (!job.cancel.cancel && !err) { if (venc) await venc.flush(); if (aenc) await aenc.flush(); }
    try { if (venc) venc.close(); } catch (e) {}
    try { if (aenc) aenc.close(); } catch (e) {}
    if (err) throw err;
    if (job.cancel.cancel) { if (job.writable) { try { await job.writable.abort(); } catch (e) {} } return null; }
    muxer.finalize();
    if (job.writable) { await job.writable.close(); return true; }
    return new Blob([target.buffer], { type: webm ? 'video/webm' : audioOnly ? 'audio/mp4' : 'video/mp4' });
  }

  return { supported, optionsUI, parts, partName, mbpsFor, encodeFile, mixAudio, decodeAudio, videoFor, seekFrame, release, niceFps, FPS_LIST, takeAudioFailures: () => { const a = audioFailed; audioFailed = []; return a; } };
})();

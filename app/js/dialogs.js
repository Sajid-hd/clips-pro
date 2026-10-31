'use strict';
/* Dialogs and panels */
const Modal = (() => {
  const stack = [];
  function open({ title, width = 640, body, footer, onClose, cls = '' }) {
    const back = el('div', { class: 'modal-back' });
    const x = el('button', { class: 'xbtn', 'aria-label': 'Close', html: ICONS.close });
    const box = el('div', { class: 'modal ' + cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: `width:${width}px` },
      el('div', { class: 'mh' }, el('h1', {}, title), x), body, footer || null);
    back.append(box);
    $('#modal-layer').append(back);
    const h = { close() { const i = stack.indexOf(h); if (i >= 0) stack.splice(i, 1); back.remove(); if (onClose) onClose(); }, box, back };
    x.addEventListener('click', () => h.close());
    back.addEventListener('mousedown', (e) => { if (e.target === back) h.close(); });
    stack.push(h);
    setTimeout(() => { const f = box.querySelector('[data-autofocus]') || box.querySelector('button.primary'); if (f) f.focus(); }, 0);
    return h;
  }
  return { open, isOpen: () => stack.length > 0, top: () => stack[stack.length - 1], closeTop() { const t = stack[stack.length - 1]; if (t) t.close(); } };
})();

const Dialogs = (() => {
  const MODE_ART = {
    sequence: '<svg width="100%" height="40" viewBox="0 0 120 40"><rect x="2" y="9" width="34" height="22" rx="3" fill="#345a80"/><rect x="40" y="9" width="34" height="22" rx="3" fill="#4a7cb0"/><rect x="78" y="9" width="40" height="22" rx="3" fill="#345a80"/></svg>',
    stack: '<svg width="100%" height="40" viewBox="0 0 120 40"><rect x="30" y="3" width="58" height="30" rx="3" fill="#345a80"/><rect x="38" y="8" width="58" height="30" rx="3" fill="#4a7cb0"/></svg>',
    layout: '<svg width="100%" height="40" viewBox="0 0 120 40"><rect x="2" y="7" width="34" height="26" rx="3" fill="#345a80"/><rect x="43" y="7" width="34" height="26" rx="3" fill="#4a7cb0"/><rect x="84" y="7" width="34" height="26" rx="3" fill="#345a80"/></svg>',
    tile: '<svg width="100%" height="40" viewBox="0 0 120 40"><rect x="22" y="2" width="34" height="17" rx="3" fill="#345a80"/><rect x="62" y="2" width="34" height="17" rx="3" fill="#4a7cb0"/><rect x="22" y="22" width="34" height="17" rx="3" fill="#4a7cb0"/><rect x="62" y="22" width="34" height="17" rx="3" fill="#345a80"/></svg>',
  };
  const MODE_TXT = { sequence: ['Sequence', 'One after another on a single timeline'], stack: ['Stack', 'On top of each other, wipe or flip between'], layout: ['Layout', 'Side by side, playing in sync'], tile: ['Tile', 'Grid of all clips at once'] };

  // ---------- drop / open choice ----------
  function chooseOpen(files) {
    return new Promise((resolve) => {
      let mode = S.clips.length ? S.mode : 'sequence';
      const hasSession = S.clips.length > 0;
      const cards = {};
      const grid = el('div', { class: 'choice-grid' });
      for (const k of ['sequence', 'stack', 'layout', 'tile']) {
        const b = el('button', { class: 'choice' + (k === mode ? ' on' : ''), type: 'button', html: MODE_ART[k] }, el('b', {}, MODE_TXT[k][0]), el('span', {}, MODE_TXT[k][1]));
        b.addEventListener('click', () => { mode = k; for (const [kk, bb] of Object.entries(cards)) bb.classList.toggle('on', kk === k); });
        b.addEventListener('dblclick', () => done());
        cards[k] = b; grid.append(b);
      }
      const addCk = el('input', { type: 'checkbox', id: 'dd-add' }); addCk.checked = hasSession && Settings.get('dropAdd'); addCk.disabled = !hasSession;
      const remCk = el('input', { type: 'checkbox', id: 'dd-rem' });
      const body = el('div', { class: 'mb' },
        el('div', { class: 'row' }, el('span', {}, ''), el('span', { class: 'muted' }, 'Change it any time from the bar below the player')),
        el('div', { class: 'filechips' }, files.slice(0, 8).map((f) => el('span', {}, f.name)), files.length > 8 ? el('span', {}, `+${files.length - 8} more`) : null),
        grid,
        el('div', { style: 'display:flex;flex-direction:column;gap:6px' },
          el('label', { class: 'check', for: 'dd-add' }, addCk, 'Add to the current session instead of replacing it'),
          el('label', { class: 'check', for: 'dd-rem' }, remCk, 'Remember my choice (change it in Settings)')));
      let result = null;
      const done = () => {
        result = { mode, add: addCk.checked };
        if (remCk.checked) { Settings.set('dropMode', mode); Settings.set('dropAdd', addCk.checked); }
        h.close();
      };
      const foot = el('div', { class: 'mf' }, el('button', { class: 'secondary', onclick: () => h.close() }, 'Cancel'), el('button', { class: 'primary', onclick: done }, 'Open'));
      const h = Modal.open({ title: `${files.length} ${files.length === 1 ? 'video' : 'videos'} dropped`, width: 780, body, footer: foot, onClose: () => resolve(result) });
    });
  }

  // ---------- trim panel (compact, QuickTime style) ----------
  const Trim = (() => {
    let st = null;
    function open() {
      const c = Player.curClip(); if (!c) return;
      if (S.playing) Player.pause();
      const F = c.media.frames;
      st = { c, a: c.tin, b: c.tout, ph: Player.locate(S.frame).local, loop: false, raf: 0 };
      $('#timeline-wrap').hidden = true; $('#readout-row').hidden = true;
      const p = $('#trim-panel'); p.hidden = false; p.innerHTML = '';
      const tl = el('span', { class: 't' }), tr = el('span', { class: 't r' });
      const sel = el('div', { class: 'sel' }), hl = el('div', { class: 'h l', title: 'Start' }), hr = el('div', { class: 'h r', title: 'End' }), ph = el('div', { class: 'ph' });
      const bar = el('div', { class: 'trimbar' }, sel, hl, hr, ph);
      const info = el('span', { class: 'muted' });
      const playB = el('button', { class: 'icon', 'aria-label': 'Play selection', html: ICONS.play, style: 'background:#2a2c31;border:1px solid #3b3e45;width:36px;height:36px' });
      p.append(
        el('div', { class: 'head' }, el('h2', {}, 'Trim — ' + c.media.name), el('span', { class: 'muted' }, 'Drag the blue handles · Shift+drag moves the whole selection · ←/→ nudge the last handle')),
        el('div', { class: 'trim-row' }, tl, bar, tr),
        el('div', { class: 'trim-actions' }, playB, info, el('div', { style: 'flex:1' }),
          el('button', { class: 'secondary', onclick: close }, 'Cancel'),
          el('button', { class: 'primary', onclick: apply }, 'Trim')));
      const fx = (f) => (f / Math.max(1, F)) * 100;
      const render = () => {
        sel.style.left = fx(st.a) + '%'; sel.style.width = (fx(st.b + 1) - fx(st.a)) + '%';
        hl.style.left = fx(st.a) + '%'; hr.style.left = fx(st.b + 1) + '%'; ph.style.left = fx(st.ph + 0.5) + '%';
        const f = c.media.fps;
        const fmt = (fr) => S.display === 'timecode' ? fmtTC(fr, f) : S.display === 'seconds' ? (fr / f).toFixed(2) + 's' : String(fr + 1);
        tl.textContent = fmt(st.a); tr.textContent = fmt(st.b);
        info.textContent = `Selection ${fmtTC(st.b - st.a + 1, f)} · ${st.b - st.a + 1} frames`;
      };
      const show = (local) => { st.ph = local; const t = Player.timeFor(c, local); if (c.el.seeking) c.el._want = t; else c.el.currentTime = t; for (const o of S.clips) o.el.classList.toggle('vis', o === c || S.mode !== 'sequence'); render(); };
      st.show = show; st.render = render; st.last = 'b';
      const frameAtX = (x) => clamp(Math.floor((x / bar.clientWidth) * F), 0, F - 1);
      const startDrag = (kind) => (e) => {
        e.preventDefault(); e.stopPropagation(); stopLoop();
        const r = bar.getBoundingClientRect(); const f0 = frameAtX(e.clientX - r.left); const a0 = st.a, b0 = st.b;
        const mv = (ev) => {
          const f = frameAtX(ev.clientX - r.left);
          if (kind === 'a') { st.a = clamp(f, 0, st.b); st.last = 'a'; show(st.a); }
          else if (kind === 'b') { st.b = clamp(f, st.a, F - 1); st.last = 'b'; show(st.b); }
          else if (kind === 'move') { const d = clamp(f - f0, -a0, F - 1 - b0); st.a = a0 + d; st.b = b0 + d; show(st.a); }
          else show(f);
        };
        const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
        addEventListener('mousemove', mv); addEventListener('mouseup', up); mv(e);
      };
      hl.addEventListener('mousedown', startDrag('a'));
      hr.addEventListener('mousedown', startDrag('b'));
      bar.addEventListener('mousedown', (e) => startDrag(e.shiftKey ? 'move' : 'ph')(e));
      playB.addEventListener('click', () => (st.loop ? stopLoop() : startLoop(playB)));
      st.playB = playB;
      show(clamp(st.ph, st.a, st.b));
    }
    function startLoop(btn) {
      const c = st.c; st.loop = true; btn.innerHTML = ICONS.pause;
      c.el.currentTime = st.a / c.media.fps; c.el.muted = S.muted; c.el.play().catch(() => {});
      const f = () => {
        if (!st || !st.loop) return;
        const lf = Math.floor(c.el.currentTime * c.media.fps + 1e-3);
        if (lf > st.b || c.el.ended) { c.el.currentTime = st.a / c.media.fps; if (c.el.paused) c.el.play().catch(() => {}); }
        st.ph = clamp(lf, st.a, st.b); st.render();
        st.raf = requestAnimationFrame(f);
      };
      st.raf = requestAnimationFrame(f);
    }
    function stopLoop() { if (!st || !st.loop) return; st.loop = false; cancelAnimationFrame(st.raf); st.c.el.pause(); Player.setAudio(); st.playB.innerHTML = ICONS.play; }
    function close() {
      if (!st) return; stopLoop();
      st = null; $('#trim-panel').hidden = true; $('#timeline-wrap').hidden = false; $('#readout-row').hidden = false;
      Player.layout(); Player.showFrame(S.frame);
    }
    function apply() { if (!st) return; const { c, a, b } = st; close(); Player.trimClip(c, a, b); }
    function key(e, act) {
      if (!st) return false;
      if (e.key === 'Escape') { close(); return true; }
      if (e.key === 'Enter') { apply(); return true; }
      if (act === 'stepBack' || act === 'stepFwd') {
        const d = act === 'stepBack' ? -1 : 1; stopLoop();
        if (st.last === 'a') { st.a = clamp(st.a + d, 0, st.b); st.show(st.a); } else { st.b = clamp(st.b + d, st.a, st.c.media.frames - 1); st.show(st.b); }
        return true;
      }
      if (act === 'playPause') { st.loop ? stopLoop() : startLoop(st.playB); return true; }
      return act !== 'fullscreen';
    }
    return { open, close, key, isOpen: () => !!st };
  })();

  // ---------- image info ----------
  function renderInfo() {
    const box = $('#image-info');
    if (box.hidden) return;
    const c = Player.curClip();
    box.innerHTML = '';
    const kv = (k, v) => v ? el('div', { class: 'kv' }, el('span', {}, k), el('span', {}, v)) : null;
    const head = el('div', { class: 'head' }, el('b', {}, 'Image info'), el('button', { class: 'xbtn', style: 'width:22px;height:22px', 'aria-label': 'Close', html: ICONS.close, onclick: () => { box.hidden = true; } }));
    if (!c) { box.append(head, el('div', { class: 'muted' }, 'Nothing open')); return; }
    const m = c.media, i = m.info || {}, v = i.video, a = i.audio;
    const folder = m.path ? m.path.replace(/[\\/][^\\/]*$/, '') : '';
    box.append(head,
      kv('File', m.name), kv('Folder', folder),
      kv('Size', m.w ? `${m.w} × ${m.h}` : ''),
      kv('Codec', v ? `${(v.codecLong || v.codec).split(' / ')[0]}${v.profile ? ' · ' + v.profile : ''}` : (m.hasVideo ? '' : 'Audio only')),
      kv('Pixel format', v && v.pixFmt),
      kv('Frame rate', `${fmtFps(m.fps)} fps${m.probed ? '' : m.fpsDetected ? ' (measured)' : ' (assumed)'}`),
      kv('Frames', `${c.tin + 1} – ${c.tout + 1} of ${m.frames}`),
      kv('Duration', fmtDur(m.duration)),
      kv('Timecode', v && v.timecode),
      kv('Bit rate', i.bitRate ? (i.bitRate / 1e6).toFixed(1) + ' Mb/s' : ''),
      kv('Audio', a ? `${(a.codecLong || a.codec).split(' / ')[0]} · ${(a.sampleRate / 1000).toFixed(1)} kHz · ${a.layout || a.channels + ' ch'}` : (m.probed ? 'None' : '')),
      kv('Container', i.format), kv('File size', m.size ? fmtBytes(m.size) : ''),
      kv('Playing from', m.playUrl === m.url ? 'Original file' : 'Converted copy'));
  }

  // ---------- convert card ----------
  function renderConvert() {
    const card = $('#convert-card');
    const c = Player.curClip();
    const m = c && c.media;
    if (!m || !['convert', 'converting', 'error'].includes(m.status)) { card.hidden = true; return; }
    card.hidden = false;
    const key = m.id + m.status + (m.status === 'converting' ? '' : m.reason);
    if (card._key === key && m.status === 'converting') { const b = card.querySelector('.bar>div'); if (b) b.style.width = (m.convertPct * 100).toFixed(1) + '%'; const p = card.querySelector('.pct'); if (p) p.textContent = Math.round(m.convertPct * 100) + '%'; return; }
    if (card._key === key) return;
    card._key = key; card.innerHTML = '';
    if (m.status === 'converting') {
      card.append(el('h2', {}, 'Converting ' + m.name), el('div', { class: 'muted' }, 'Making a playable copy on your PC. The original file isn\'t changed.'),
        el('div', { class: 'bar' }, el('div', { style: `width:${(m.convertPct * 100).toFixed(1)}%` })),
        el('div', { class: 'row' }, el('span', { class: 'pct mono' }, Math.round(m.convertPct * 100) + '%'), el('button', { class: 'secondary', onclick: () => Media.cancel(m) }, 'Cancel')));
      return;
    }
    if (m.status === 'error') {
      card.append(el('h2', {}, 'Can\'t play ' + m.name), el('div', { class: 'muted' }, m.reason || 'Something went wrong.'),
        m.error ? el('div', { class: 'err' }, m.error) : null,
        el('div', { class: 'row' }, el('span'), el('button', { class: 'secondary', onclick: () => Media.convert(m) }, 'Try converting again')));
      return;
    }
    const auto = el('input', { type: 'checkbox', id: 'cv-auto' }); auto.checked = !!Settings.get('autoConvert');
    auto.addEventListener('change', () => Settings.set('autoConvert', auto.checked));
    card.append(el('h2', {}, API ? 'This format needs converting' : 'This format can\'t play in this version'),
      el('div', {}, m.reason),
      el('div', { class: 'muted' }, API ? 'Clips Pro will make a playable copy on your PC. The original file isn\'t changed, and exports still use the original.' : 'This version of Clips Pro can\'t convert files. Files like this will play in the full (Store) version, which converts them automatically.'),
      API ? el('label', { class: 'check', for: 'cv-auto' }, auto, 'Convert files like this automatically') : null,
      el('div', { class: 'row' }, el('span'), API ? el('button', { class: 'primary', onclick: () => Media.convert(m), 'data-autofocus': true }, 'Convert') : null));
  }

  // ---------- export ----------
  const PRESETS = [
    ['same', 'Same as source (fast)', 'Copies the original streams without re-encoding. One clip only; cuts land on the nearest keyframe.'],
    ['h264', 'MP4 · H.264', 'High quality MP4 that plays everywhere.'],
    ['small', 'Small file (share)', 'Smaller MP4 for sending and uploading.'],
    ['prores', 'ProRes 422 (.mov)', 'Editing-friendly master file. Large.'],
    ['webm', 'WebM · VP9', 'Open format for the web.'],
    ['gif', 'Animated GIF', 'Looping GIF, up to 640 px wide at 15 fps.'],
    ['audio', 'Audio only (.m4a)', 'Just the sound, AAC.'],
    ['png', 'PNG image sequence', 'One PNG per frame, into a folder.'],
    ['frame', 'Current frame (PNG)', 'The frame under the playhead at full quality.'],
  ];
  const PRESETS_WEB = [
    ['webmrt', 'WebM video', 'Plays the range and records it (takes as long as the video). VP9 video with sound.'],
    ['frame', 'Current frame (PNG)', 'The frame under the playhead at full quality.'],
  ];
  const EXT = { same: '', h264: '.mp4', small: '.mp4', prores: '.mov', webm: '.webm', gif: '.gif', audio: '.m4a', png: '', frame: '.png', webmrt: '.webm' };

  // Web version: record the range to WebM by playing it into a canvas
  async function recordWebm({ segments, width, height, fps, quality, onPct, job }) {
    const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
    const g = cv.getContext('2d');
    const actx = new AudioContext(); await actx.resume();
    const dest = actx.createMediaStreamDestination();
    const stream = new MediaStream([...cv.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const q = quality === 'low' ? 0.05 : quality === 'medium' ? 0.09 : 0.14;
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(width * height * fps * q), audioBitsPerSecond: 160000 });
    const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const total = segments.reduce((s, x) => s + (x.end - x.start), 0); let doneSec = 0;
    const once = (t, ev) => new Promise((r) => t.addEventListener(ev, r, { once: true }));
    const draw = (v, s) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, width, height);
      const r = ((s.rotate % 360) + 360) % 360, swap = r === 90 || r === 270;
      const vw = v.videoWidth, vh = v.videoHeight; if (!vw) return;
      const k = Math.min(width / (swap ? vh : vw), height / (swap ? vw : vh));
      g.save(); g.translate(width / 2, height / 2); g.rotate((r * Math.PI) / 180); g.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);
      g.drawImage(v, (-vw * k) / 2, (-vh * k) / 2, vw * k, vh * k); g.restore();
    };
    let started = false;
    for (const s of segments) {
      if (job.cancel) break;
      const v = document.createElement('video'); v.preload = 'auto'; v.playsInline = true; v.src = s.url;
      await once(v, 'loadeddata');
      const node = actx.createMediaElementSource(v); if (!s.mute) node.connect(dest);
      v.currentTime = s.start + 0.0001; await once(v, 'seeked');
      draw(v, s);
      if (!started) { rec.start(1000); started = true; } else rec.resume();
      await new Promise((resolve) => {
        const fin = () => { v.pause(); resolve(); };
        const step = () => {
          draw(v, s); onPct(Math.min(1, (doneSec + (v.currentTime - s.start)) / total));
          if (job.cancel || v.ended || v.currentTime >= s.end - 0.5 / fps) fin(); else v.requestVideoFrameCallback(step);
        };
        v.requestVideoFrameCallback(step); v.addEventListener('ended', fin, { once: true });
        v.play().catch(fin);
      });
      rec.pause();
      doneSec += s.end - s.start;
      node.disconnect(); v.removeAttribute('src'); v.load();
    }
    if (started) { rec.resume(); rec.stop(); await once(rec, 'stop'); }
    actx.close();
    return job.cancel || !started ? null : new Blob(chunks, { type: 'video/webm' });
  }

  function exportSegments(rangeKind) {
    const T = Player.total(); const out = [];
    const a = rangeKind === 'inout' ? Player.startF() : 0, b = rangeKind === 'inout' ? Player.endF() : T - 1;
    const seg = (c, l0, l1) => ({ path: c.media.path, start: l0 / c.media.fps, end: (l1 + 1) / c.media.fps, rotate: c.rot, flipH: c.fh, flipV: c.fv, mute: c.mute, hasAudio: c.media.hasAudio, media: c.media });
    if (S.mode === 'sequence') {
      const st = Player.starts();
      S.clips.forEach((c, i) => {
        const s = st[i], e = s + Player.len(c) - 1;
        if (e < a || s > b) return;
        out.push(seg(c, c.tin + Math.max(0, a - s), c.tout - Math.max(0, e - b)));
      });
    } else {
      const c = Player.curClip(); if (c) out.push(seg(c, c.tin + Math.min(a, Player.len(c) - 1), Math.min(c.tout, c.tin + b)));
    }
    return out;
  }

  async function exportDialog() {
    if (!S.clips.length) { toast('Open a video first'); return; }
    if (S.playing) Player.pause();
    const LIST = API ? PRESETS : PRESETS_WEB;
    let preset = Settings.get('exportPreset') || 'h264';
    if (!LIST.find((p) => p[0] === preset)) preset = LIST[0][0];
    let dir = Settings.get('exportDir') || (API ? await API.defaultDir() : '');
    const base = (Player.curClip().media.name || 'clip').replace(/\.[^.]+$/, '');
    const hasIO = S.inF != null || S.outF != null;
    const presetList = el('div', { class: 'preset-list' }, el('h2', { style: 'margin:0 0 6px' }, 'Presets'));
    const nameIn = el('input', { type: 'text', id: 'ex-name', value: base + '_export' });
    const dirIn = el('input', { type: 'text', id: 'ex-dir', value: dir, style: 'flex:1;min-width:0' });
    const resSel = el('select', { id: 'ex-res' }, ['source:Same as source', '2160:2160p (4K)', '1080:1080p', '720:720p', '480:480p'].map((o) => { const [v, t] = o.split(':'); return el('option', { value: v }, t); }));
    resSel.value = Settings.get('exportRes') || 'source';
    const qSel = el('select', { id: 'ex-q' }, el('option', { value: 'high' }, 'High'), el('option', { value: 'medium' }, 'Medium'), el('option', { value: 'low' }, 'Low'));
    qSel.value = Settings.get('exportQuality') || 'high';
    const rWhole = el('input', { type: 'radio', name: 'ex-range', id: 'ex-r1', value: 'whole' }); const rIO = el('input', { type: 'radio', name: 'ex-range', id: 'ex-r2', value: 'inout' });
    rWhole.checked = !hasIO; rIO.checked = hasIO; rIO.disabled = !hasIO;
    const desc = el('div', { class: 'muted' });
    const summary = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    const note = el('div', { class: 'muted small' });
    const prog = el('div', { hidden: true, style: 'display:flex;flex-direction:column;gap:6px' }, el('div', { class: 'bar' }, el('div')), el('div', { class: 'row' }, el('span', { class: 'pct mono' }, '0%'), el('span')));
    const errBox = el('div', { class: 'err', hidden: true });
    const browse = el('button', { class: 'secondary', style: 'height:32px', onclick: async () => { const d = await API.saveDialog({ title: 'Export to folder', defaultPath: dirIn.value, folder: true }); if (d) dirIn.value = d; } }, 'Browse');
    const range = () => (rIO.checked ? 'inout' : 'whole');
    function refresh() {
      for (const b of $$('button', presetList)) b.classList.toggle('on', b.dataset.p === preset);
      const p = LIST.find((x) => x[0] === preset);
      desc.textContent = p[2];
      const segs = exportSegments(range());
      const secs = segs.reduce((s, g) => s + (g.end - g.start), 0);
      const c0 = Player.curClip();
      const m0 = c0.media;
      const sizeMB = (() => {
        const H = resSel.value === 'source' ? m0.h : +resSel.value; const W = m0.w && m0.h ? Math.round(H * m0.w / m0.h) : H * 16 / 9;
        const q = qSel.value === 'low' ? 0.06 : qSel.value === 'medium' ? 0.1 : 0.16;
        let mbps = (W * H * Player.fps() * q) / 1e6;
        if (preset === 'small') mbps = (W * H * Player.fps() * 0.05) / 1e6; if (preset === 'prores') mbps = W * H * Player.fps() * 1.2 / 1e6;
        if (preset === 'audio') mbps = 0.256; if (preset === 'same') mbps = (m0.info && m0.info.bitRate) ? m0.info.bitRate / 1e6 : mbps;
        if (preset === 'webmrt') mbps = (W * H * Player.fps() * (qSel.value === 'low' ? 0.05 : qSel.value === 'medium' ? 0.09 : 0.14)) / 1e6;
        if (preset === 'frame' || preset === 'png' || preset === 'gif') return null;
        return (mbps * secs) / 8;
      })();
      summary.innerHTML = '';
      summary.append(
        el('div', { class: 'row' }, el('span', {}, 'Length'), el('span', { class: 'mono', style: 'color:#e6e7ea' }, preset === 'frame' ? '1 frame' : fmtTC(Math.round(secs * Player.fps()), Player.fps()))),
        el('div', { class: 'row' }, el('span', {}, 'Clips'), el('span', { style: 'color:#e6e7ea' }, preset === 'frame' ? '1' : String(segs.length))),
        sizeMB != null ? el('div', { class: 'row' }, el('span', {}, 'Estimated size'), el('span', { style: 'color:#e6e7ea' }, '≈ ' + (sizeMB > 1024 ? (sizeMB / 1024).toFixed(1) + ' GB' : Math.max(1, Math.round(sizeMB)) + ' MB'))) : null);
      note.textContent = (S.mode !== 'sequence' ? `${MODE_TXT[S.mode][0]} mode: exports the selected clip (${c0.media.name}). ` : '') + (API ? '' : 'MP4, ProRes, GIF and fast trimmed copies come with the full (Store) version.');
      resSel.disabled = ['same', 'audio', 'frame'].includes(preset);
      qSel.disabled = !['h264', 'webm', 'webmrt'].includes(preset);
      rWhole.disabled = rIO.disabled = preset === 'frame'; if (hasIO && preset !== 'frame') rIO.disabled = false;
    }
    for (const [k, t] of LIST) presetList.append(el('button', { 'data-p': k, onclick: () => { preset = k; refresh(); } }, t));
    [resSel, qSel, rWhole, rIO].forEach((x) => x.addEventListener('change', refresh));
    const center = el('div', { class: 'mb', style: 'flex:1;min-width:0' },
      desc,
      el('div', { class: 'kv-grid' },
        el('label', { class: 'fieldset', for: 'ex-name' }, el('span', {}, 'File name'), nameIn),
        API ? el('div', { class: 'fieldset' }, el('span', {}, 'Save to'), el('div', { style: 'display:flex;gap:6px' }, dirIn, browse)) : el('div', { class: 'fieldset' }, el('span', {}, 'Save to'), el('span', { class: 'muted', style: 'padding-top:7px' }, 'You choose where when you click Export now')),
        el('label', { class: 'fieldset', for: 'ex-res' }, el('span', {}, 'Resolution'), resSel),
        el('label', { class: 'fieldset', for: 'ex-q' }, el('span', {}, 'Quality'), qSel)),
      el('div', { class: 'fieldset' }, el('span', {}, 'Range'),
        el('div', { style: 'display:flex;gap:16px' }, el('label', { class: 'check', for: 'ex-r1' }, rWhole, 'Whole session'), el('label', { class: 'check', for: 'ex-r2' }, rIO, hasIO ? 'In to Out' : 'In to Out (set [ and ] first)'))),
      note, prog, errBox);
    const right = el('div', { style: 'width:220px;flex:none;border-left:1px solid #2a2c31;padding:16px;display:flex;flex-direction:column;gap:10px;background:#19191d' }, el('h2', {}, 'Summary'), summary);
    const body = el('div', { style: 'display:flex;min-height:380px' }, presetList, center, right);
    let running = null;
    const goBtn = el('button', { class: 'primary' }, 'Export now');
    const cancelBtn = el('button', { class: 'secondary', onclick: () => { if (running) { if (API) API.cancelJob(running); } else h.close(); } }, 'Cancel');
    const foot = el('div', { class: 'mf' }, cancelBtn, goBtn);
    const h = Modal.open({ title: 'Export', width: 1000, body, footer: foot, onClose: () => { if (running) { if (API) API.cancelJob(running); webJob.cancel = true; } } });
    refresh();
    const webJob = { cancel: false };
    cancelBtn.addEventListener('click', () => { webJob.cancel = true; });
    goBtn.addEventListener('click', async () => {
      if (!API) {
        Settings.set('exportPreset', preset); Settings.set('exportRes', resSel.value); Settings.set('exportQuality', qSel.value);
        const nm = nameIn.value.trim().replace(/[\\/:*?"<>|]/g, '_') || 'export';
        if (preset === 'frame') {
          const L = Player.locate(S.frame); const c = L.clip; const v = c.el;
          const cvs = document.createElement('canvas'); const r = ((c.rot % 360) + 360) % 360, sw = r === 90 || r === 270;
          cvs.width = sw ? v.videoHeight : v.videoWidth; cvs.height = sw ? v.videoWidth : v.videoHeight;
          const g = cvs.getContext('2d'); g.translate(cvs.width / 2, cvs.height / 2); g.rotate(r * Math.PI / 180); g.scale(c.fh ? -1 : 1, c.fv ? -1 : 1); g.drawImage(v, -v.videoWidth / 2, -v.videoHeight / 2);
          const blob = await new Promise((res) => cvs.toBlob(res, 'image/png'));
          if (await saveBlob(blob, nm + '.png', 'PNG image', 'image/png', '.png')) { toast('Frame saved'); h.close(); }
          return;
        }
        // choose where to save first (needs the click), then record
        let handle = null;
        if (window.showSaveFilePicker) {
          try { handle = await showSaveFilePicker({ suggestedName: nm + '.webm', types: [{ description: 'WebM video', accept: { 'video/webm': ['.webm'] } }] }); }
          catch (e) { if (e && e.name === 'AbortError') return; }
        }
        const segs = exportSegments(range()).map((s) => ({ ...s, url: s.media.playUrl }));
        if (!segs.length) { toast('Nothing to export'); return; }
        const m0 = segs[0].media; let w = m0.w || 1280, hh = m0.h || 720;
        const r0 = ((segs[0].rotate || 0) % 360 + 360) % 360; if (r0 === 90 || r0 === 270) { const t = w; w = hh; hh = t; }
        if (resSel.value !== 'source') { const H = +resSel.value; w = Math.round((H * w) / hh / 2) * 2; hh = H; }
        prog.hidden = false; errBox.hidden = true; goBtn.disabled = true; cancelBtn.textContent = 'Stop'; webJob.cancel = false;
        const bar = prog.querySelector('.bar>div'), pct = prog.querySelector('.pct');
        running = 'web';
        try {
          const blob = await recordWebm({ segments: segs, width: w, height: hh, fps: Math.min(60, Math.round(Player.fps())), quality: qSel.value, job: webJob, onPct: (p) => { bar.style.width = (p * 100).toFixed(1) + '%'; pct.textContent = Math.round(p * 100) + '%'; } });
          running = null; goBtn.disabled = false; cancelBtn.textContent = 'Close';
          if (!blob) { pct.textContent = 'Stopped'; return; }
          if (handle) { const wr = await handle.createWritable(); await wr.write(blob); await wr.close(); }
          else await saveBlob(blob, nm + '.webm', 'WebM video', 'video/webm', '.webm');
          bar.style.width = '100%'; pct.textContent = 'Done'; toast('Exported ' + nm + '.webm');
        } catch (e) {
          running = null; goBtn.disabled = false; cancelBtn.textContent = 'Close';
          errBox.hidden = false; errBox.textContent = 'Export failed.\n' + (e && e.message ? e.message : e); pct.textContent = 'Failed';
        }
        return;
      }
      Settings.set('exportPreset', preset); Settings.set('exportRes', resSel.value); Settings.set('exportQuality', qSel.value); Settings.set('exportDir', dirIn.value);
      let segs = exportSegments(range());
      if (preset === 'frame') { const L = Player.locate(S.frame); const c = L.clip; segs = [{ path: c.media.path, start: (L.local + 0.5) / c.media.fps, end: (L.local + 1) / c.media.fps, rotate: c.rot, flipH: c.fh, flipV: c.fv }]; }
      if (!segs.length) { toast('Nothing to export'); return; }
      const sep = API.platform === 'win32' ? '\\' : '/';
      let ext = EXT[preset];
      if (preset === 'same') { const n = segs[0].media ? segs[0].media.name : ''; ext = n.includes('.') ? n.slice(n.lastIndexOf('.')) : '.mp4'; }
      const output = dirIn.value.replace(/[\\/]+$/, '') + sep + nameIn.value.trim().replace(/[\\/:*?"<>|]/g, '_') + ext;
      const m0 = segs[0].media || Player.curClip().media;
      let w = m0.w || 1920, hgt = m0.h || 1080;
      const r0 = ((segs[0].rotate || 0) % 360 + 360) % 360; if (r0 === 90 || r0 === 270) { const t = w; w = hgt; hgt = t; }
      if (resSel.value !== 'source') { const H = +resSel.value; w = Math.round((H * w) / hgt / 2) * 2; hgt = H; }
      const id = 'export-' + Date.now(); running = id;
      prog.hidden = false; errBox.hidden = true; goBtn.disabled = true; cancelBtn.textContent = 'Stop';
      const bar = prog.querySelector('.bar>div'), pct = prog.querySelector('.pct');
      const off = (p) => { if (p.id === id) { bar.style.width = (p.pct * 100).toFixed(1) + '%'; pct.textContent = Math.round(p.pct * 100) + '%'; } };
      Dialogs._progress = off;
      const r = await API.exportJob({ id, segments: segs.map(({ media, ...s }) => s), output, preset, width: w, height: hgt, fps: Player.fps(), quality: qSel.value });
      running = null; Dialogs._progress = null; goBtn.disabled = false; cancelBtn.textContent = 'Close';
      if (r.ok) {
        bar.style.width = '100%'; pct.textContent = 'Done';
        const sp = prog.querySelector('.row span:last-child'); sp.innerHTML = '';
        sp.append(el('button', { class: 'secondary', style: 'height:30px', onclick: () => API.showInFolder(preset === 'png' ? output + sep + 'frame_000001.png' : output) }, 'Show in folder'));
        toast('Exported ' + output.split(/[\\/]/).pop());
      } else if (r.cancelled) { pct.textContent = 'Stopped'; }
      else { errBox.hidden = false; errBox.textContent = 'Export failed.\n' + (r.error || ''); pct.textContent = 'Failed'; }
    });
  }

  // ---------- settings ----------
  function settingsDialog(tab = 'general') {
    const tabs = el('div', { class: 'tabs' });
    const pane = el('div', { class: 'mb', style: 'flex:1;min-width:0' });
    const T = [['general', 'General'], ['playback', 'Playback'], ['keys', 'Shortcuts'], ['formats', 'File formats'], ['default', 'Default player']];
    const ck = (key, label, after) => { const i = el('input', { type: 'checkbox', id: 'st-' + key }); i.checked = !!Settings.get(key); i.addEventListener('change', () => { Settings.set(key, i.checked); if (after) after(i.checked); }); return el('label', { class: 'check', for: 'st-' + key }, i, label); };
    const sel = (key, label, opts, after) => { const s = el('select', { id: 'st-' + key }, opts.map(([v, t]) => el('option', { value: v }, t))); s.value = Settings.get(key); s.addEventListener('change', () => { Settings.set(key, s.value); if (after) after(s.value); }); return el('label', { class: 'fieldset', for: 'st-' + key, style: 'max-width:340px' }, el('span', {}, label), s); };
    let capture = null;
    function show(t) {
      tab = t; capture = null;
      for (const b of $$('button', tabs)) b.classList.toggle('on', b.dataset.t === t);
      pane.innerHTML = '';
      if (t === 'general') {
        pane.append(el('h2', {}, 'General'),
          sel('dropMode', 'When you drop several videos', [['ask', 'Ask each time'], ['sequence', 'Sequence'], ['stack', 'Stack'], ['layout', 'Layout'], ['tile', 'Tile']]),
          ck('dropAdd', 'Dropped videos are added to the session (instead of replacing it)'),
          ck('openWithAdds', 'Videos opened from Windows (double-click / Open with) are added to the session'),
          ck('resizeToVideo', 'Resize the window to fit a newly opened video'),
          ck('showInfo', 'Show the info overlay on the video', () => App.refreshAll()),
          ck('timelineTop', 'Timeline at top of the window', () => App.refreshAll()));
      } else if (t === 'playback') {
        pane.append(el('h2', {}, 'Playback'),
          ck('allFrames', 'Play all frames by default (slows down instead of skipping frames)', (v) => { S.allFrames = v; App.refreshAll(); }),
          ck('audioScrub', 'Audio scrub by default (hear sound while stepping and dragging)', (v) => { S.audioScrub = v; App.refreshAll(); }),
          ck('stepWraps', 'Stepping wraps around at In / Out'),
          ck('showCache', 'Show the cache stripe under the timeline', () => App.refreshAll()),
          ck('showControls', 'Show the play controls', () => App.refreshAll()),
          sel('loopMode', 'Loop mode', [['loop', 'Loop'], ['once', 'Play once'], ['pingpong', 'Ping-pong']], (v) => { S.loopMode = v; App.refreshAll(); }),
          sel('display', 'Frame display', [['source', 'Source frame'], ['session', 'Session frame'], ['timecode', 'Timecode'], ['seconds', 'Seconds'], ['footage', 'Footage (16 frames per foot)']], (v) => { S.display = v; App.refreshAll(); }));
      } else if (t === 'keys') {
        const psel = el('select', { id: 'st-preset' }, Object.entries(Keys.PRESETS).map(([k, p]) => el('option', { value: k }, p.name)));
        psel.value = Settings.get('keyPreset');
        const search = el('input', { type: 'text', placeholder: 'Search actions or keys', style: 'height:30px;background:#141518;border:1px solid #2f3136;border-radius:6px;padding:0 9px;width:220px' });
        const table = el('div', { class: 'keys-table' });
        const draw = () => {
          table.innerHTML = '';
          table.append(el('div', { class: 'kr' }, el('span', {}, 'Action'), el('span', {}, 'Shortcut'), el('span')));
          const q = search.value.trim().toLowerCase();
          for (const [id, label, group] of Keys.DEFS) {
            const ks = Keys.keysFor(id);
            if (q && !(label.toLowerCase().includes(q) || group.toLowerCase().includes(q) || ks.join(' ').toLowerCase().includes(q))) continue;
            const isCap = capture === id;
            const kb = el('button', { class: 'keybtn', title: 'Click, then press the new keys' }, isCap ? el('kbd', {}, 'Press new keys…') : (ks.length ? ks.map((k) => el('kbd', {}, k)) : el('span', { class: 'dim' }, 'none')));
            kb.addEventListener('click', () => { capture = id; draw(); });
            const clr = el('button', { class: 'xbtn', style: 'width:24px;height:24px', 'aria-label': 'Remove shortcut', html: ICONS.close, onclick: () => { Keys.clear(id); draw(); } });
            table.append(el('div', { class: 'kr' + (isCap ? ' capturing' : '') }, el('span', {}, label, el('span', { class: 'dim small' }, '  ' + group)), kb, ks.length ? clr : el('span')));
          }
        };
        psel.addEventListener('change', () => { Keys.usePreset(psel.value); draw(); });
        search.addEventListener('input', draw);
        pane.append(el('div', { class: 'row' }, el('h2', {}, 'Keyboard shortcuts'), el('div', { style: 'display:flex;gap:8px;align-items:center' }, el('label', { for: 'st-preset', class: 'muted' }, 'Preset'), psel, search)),
          el('div', { class: 'muted' }, 'Click a shortcut, then press the new keys. Esc cancels. A key used elsewhere moves to this action.'),
          table, el('div', {}, el('button', { class: 'secondary', onclick: () => { Keys.usePreset(psel.value); draw(); toast('Shortcuts reset'); } }, 'Reset to preset')));
        draw();
        pane._capture = (e) => {
          if (!capture) return false;
          if (e.key === 'Escape') { capture = null; draw(); return true; }
          const k = Keys.fromEvent(e); if (!k) return true;
          const prev = Keys.actionFor(k);
          Keys.setKey(capture, k);
          if (prev && prev !== capture) toast(`${k} moved from "${Keys.LABEL[prev]}"`);
          capture = null; draw(); return true;
        };
      } else if (t === 'formats' && !API) {
        pane.append(el('h2', {}, 'File formats'),
          el('div', {}, el('b', {}, 'Plays: '), 'MP4, MOV, M4V, MKV and WebM with H.264, H.265 (HEVC, if your PC supports it), VP9 or AV1 video; AAC, MP3, Opus, FLAC audio; WAV and MP3 files.'),
          el('div', {}, el('b', {}, 'Doesn\'t play in this version: '), 'ProRes, DNxHD / DNxHR, AVI, WMV, MPEG-2, MXF, MTS / M2TS and similar. The full (Store) version converts these automatically.'),
          el('div', { class: 'muted' }, 'Frame rate is measured from the video when it opens.'));
      } else if (t === 'formats') {
        const sizeTxt = el('span', { class: 'mono' }, '…');
        if (API) API.convertedSize().then((b) => { sizeTxt.textContent = fmtBytes(b); });
        pane.append(el('h2', {}, 'File formats'),
          el('div', {}, el('b', {}, 'Play directly: '), 'MP4, MOV, M4V, MKV, WebM with H.264, H.265 (HEVC, if your PC supports it), VP9, AV1 video; AAC, MP3, Opus, FLAC audio; WAV.'),
          el('div', {}, el('b', {}, 'Converted when opened: '), 'ProRes, DNxHD / DNxHR, AVI, WMV, MPEG-1 / MPEG-2, MXF, MTS / M2TS / TS, FLV, DV, and other formats. Clips Pro makes a playable copy on your PC; the original isn\'t changed and exports use the original.'),
          ck('autoConvert', 'Convert automatically without asking'),
          el('div', { class: 'row', style: 'max-width:420px' }, el('span', {}, 'Converted copies use '), sizeTxt,
            API ? el('button', { class: 'secondary', style: 'height:30px', onclick: async () => { await API.clearConverted(); sizeTxt.textContent = '0 MB'; toast('Converted copies cleared'); } }, 'Clear') : null));
      } else if (t === 'default') {
        pane.append(defaultPlayerBody());
      }
    }
    for (const [k, l] of T) tabs.append(el('button', { 'data-t': k, onclick: () => show(k) }, l));
    const body = el('div', { style: 'display:flex;min-height:440px' }, tabs, pane);
    const h = Modal.open({ title: 'Settings', width: 860, body, footer: el('div', { class: 'mf' }, el('button', { class: 'primary', onclick: () => h.close() }, 'Done')), onClose: () => { App.refreshAll(); } });
    h.capture = (e) => (pane._capture && tab === 'keys' ? pane._capture(e) : false);
    show(tab);
    return h;
  }

  function defaultPlayerBody() {
    if (!API) {
      return el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
        el('h2', {}, 'Make Clips Pro your default video player'),
        el('ol', { class: 'steps' },
          el('li', {}, 'In File Explorer, right-click any video (for example an .mp4).'),
          el('li', {}, 'Choose ', el('b', {}, 'Open with'), ' → ', el('b', {}, 'Choose another app'), '.'),
          el('li', {}, 'Pick ', el('b', {}, 'Clips Pro'), ' and click ', el('b', {}, 'Always'), '.'),
          el('li', {}, 'The first time, Edge asks to let Clips Pro open that file type. Tick "Don\'t ask again" and click ', el('b', {}, 'Allow'), '.'),
          el('li', {}, 'Repeat once for each type you use (.mov, .mkv, .webm…).')),
        el('div', { class: 'muted' }, 'You can also set it in Windows Settings → Apps → Default apps → Clips Pro.'));
    }
    return el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      el('h2', {}, 'Make Clips Pro your default video player'),
      el('ol', { class: 'steps' },
        el('li', {}, 'Click ', el('b', {}, 'Open Windows Default apps'), ' below.'),
        el('li', {}, 'In the search box under "Set defaults for applications", type ', el('b', {}, 'Clips Pro'), ' and click it.'),
        el('li', {}, 'Click ', el('b', {}, 'Set default'), ' at the top, or choose Clips Pro for each video type you want (.mp4, .mov, .mkv…).')),
      el('div', { class: 'muted' }, 'Or: right-click any video in File Explorer → Open with → Choose another app → Clips Pro → Always.'),
      API ? el('div', {}, el('button', { class: 'primary', onclick: () => API.openDefaultApps() }, 'Open Windows Default apps')) : null);
  }

  function firstRun() {
    const h = Modal.open({
      title: 'Welcome to Clips Pro', width: 560,
      body: el('div', { class: 'mb' }, defaultPlayerBody()),
      footer: el('div', { class: 'mf' }, el('button', { class: 'secondary', onclick: () => h.close() }, 'Later')),
      onClose: () => Settings.set('firstRunDone', true),
    });
  }

  function about() {
    const v = el('span', {}, '1.0.0'); if (API) API.version().then((x) => { v.textContent = x; });
    const h = Modal.open({ title: 'About Clips Pro', width: 460, body: el('div', { class: 'mb' },
      el('div', { style: 'display:flex;align-items:center;gap:14px' }, el('div', { class: 'big-logo' }, el('span', {}, 'C'), el('b', {}, 'P')), el('div', {}, el('h2', {}, 'Clips Pro'), el('div', { class: 'muted' }, 'Version ', v))),
      el('div', { class: 'muted' }, 'Video player and editor. Uses FFmpeg (LGPL) for reading, converting and exporting files. Your videos never leave your PC.')),
      footer: el('div', { class: 'mf' }, el('button', { class: 'primary', onclick: () => h.close() }, 'OK')) });
  }

  function shortcutsSheet() { return settingsDialog('keys'); }

  // Web version opened in a normal Edge tab: offer to install
  let installEvt = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; const b = document.querySelector('#install-now'); if (b) b.disabled = false; });
  addEventListener('appinstalled', () => { Modal.closeTop(); toast('Clips Pro installed. Open it from the Start menu.'); });
  function installTip() {
    if (Modal.isOpen()) return;
    const btn = el('button', { class: 'primary', id: 'install-now', disabled: !installEvt, onclick: async () => { if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; } } }, 'Install Clips Pro');
    const h = Modal.open({
      title: 'Install Clips Pro', width: 560,
      body: el('div', { class: 'mb' },
        el('div', {}, 'Install Clips Pro as an app on this PC. It gets its own window and Start menu icon, works offline, and can be your default video player. Your videos never leave your PC.'),
        el('ol', { class: 'steps' },
          el('li', {}, 'Click ', el('b', {}, 'Install Clips Pro'), ' below (or the app icon at the right end of Edge\'s address bar).'),
          el('li', {}, 'Click ', el('b', {}, 'Install'), ' in Edge\'s box. Clips Pro opens in its own window.'),
          el('li', {}, 'Allow it to be pinned to Start / taskbar if Edge asks.')),
        el('div', { class: 'muted small' }, 'If the button stays grey, use Edge\'s ⋯ menu → Apps → Install Clips Pro.')),
      footer: el('div', { class: 'mf' }, el('button', { class: 'secondary', onclick: () => h.close() }, 'Use in the browser'), btn),
    });
  }

  return { chooseOpen, Trim, renderInfo, renderConvert, exportDialog, settingsDialog, firstRun, about, shortcutsSheet, installTip, MODE_TXT };
})();
if (API) API.onJobProgress((p) => { if (Dialogs._progress) Dialogs._progress(p); });

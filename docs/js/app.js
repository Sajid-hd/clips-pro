'use strict';
/* App wiring: menus, shortcuts, drag & drop, panels, render loop */
const App = (() => {
  let dirty = true;
  Player.onChange = () => { dirty = true; };
  const DISPLAY = [['source', 'Source frame'], ['session', 'Session frame'], ['timecode', 'Timecode'], ['seconds', 'Seconds'], ['footage', 'Footage (16 frames per foot)']];
  const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
  const LOOPS = [['loop', 'Loop'], ['once', 'Play once'], ['pingpong', 'Ping-pong']];
  const has = () => S.clips.length > 0;
  const cur = () => Player.curClip();

  // ---------- actions ----------
  const A = {
    playPause: () => Player.toggle(),
    toggleDir: () => Player.toggleDir(),
    playRev: () => Player.play(-1),
    stepBack: () => Player.step(-1),
    stepFwd: () => Player.step(1),
    shuttleBack: () => Player.shuttle(-1),
    stop: () => { Player.pause(); S.speed = 1; Player.applyRate(); dirty = true; },
    shuttleFwd: () => Player.shuttle(1),
    goStart: () => Player.goStart(),
    goEnd: () => Player.goEnd(),
    gotoFrame: () => { const f = $('#frame-field'); f.focus(); f.select(); },
    allFrames: () => { S.allFrames = !S.allFrames; S.rateFactor = 1; Player.applyRate(); toast(S.allFrames ? 'Play all frames' : 'Real-time playback (may skip frames)'); dirty = true; },
    audioScrub: () => { S.audioScrub = !S.audioScrub; toast('Audio scrub ' + (S.audioScrub ? 'on' : 'off')); dirty = true; },
    loopMode: () => { const i = LOOPS.findIndex((l) => l[0] === S.loopMode); S.loopMode = LOOPS[(i + 1) % LOOPS.length][0]; toast(LOOPS.find((l) => l[0] === S.loopMode)[1]); dirty = true; },
    mute: () => { S.muted = !S.muted; Settings.set('muted', S.muted); Player.setAudio(); dirty = true; },
    volUp: () => setVolume(S.volume + 0.1),
    volDown: () => setVolume(S.volume - 0.1),
    setIn: () => Player.setIn(),
    setOut: () => Player.setOut(),
    clearInOut: () => Player.clearInOut(),
    mark: () => Player.toggleMark(),
    prevMark: () => Player.prevMark(),
    nextMark: () => Player.nextMark(),
    prevRange: () => Player.rangeStep(-1),
    nextRange: () => Player.rangeStep(1),
    modeSequence: () => Player.setMode('sequence'),
    modeStack: () => Player.setMode('stack'),
    modeLayout: () => Player.setMode('layout'),
    modeTile: () => Player.setMode('tile'),
    cycleBack: () => Player.cycleStack(-1),
    cycleFwd: () => Player.cycleStack(1),
    wipes: () => { S.wipes = !S.wipes; Player.layout(); if (S.mode !== 'stack') toast('Wipes work in Stack mode'); dirty = true; },
    fit: () => Player.fitView(),
    scale1: () => Player.pixelScale(1),
    scale2: () => Player.pixelScale(2),
    zoomIn: () => { const v = $('#viewer'); Player.zoomAbout(v.clientWidth / 2, v.clientHeight / 2, S.view.z * 1.25); },
    zoomOut: () => { const v = $('#viewer'); Player.zoomAbout(v.clientWidth / 2, v.clientHeight / 2, S.view.z / 1.25); },
    flipX: () => { S.view.flipX = !S.view.flipX; Player.applyView(); },
    flipY: () => { S.view.flipY = !S.view.flipY; Player.applyView(); },
    fullscreen: () => toggleFullscreen(),
    info: () => { const b = $('#image-info'); b.hidden = !b.hidden; Dialogs.renderInfo(); },
    overlay: () => { Settings.set('showInfo', !Settings.get('showInfo')); dirty = true; },
    timeline: () => { const b = $('#bottom'); b.hidden = !b.hidden; Player.layout(); },
    sources: () => { const s = $('#sources'); s.hidden = !s.hidden; renderSources(); requestAnimationFrame(() => Player.layout()); dirty = true; },
    open: () => openDialog(false),
    addFiles: () => openDialog(true),
    export: () => Dialogs.exportDialog(),
    saveFrame: () => frameOp('save'),
    copyFrame: () => frameOp('copy'),
    closeSession: () => { Player.clearSession(); },
    undo: () => Player.undo(),
    redo: () => Player.redo(),
    cut: () => Player.cutClip(),
    copy: () => Player.copyClip(),
    paste: () => Player.pasteClip(),
    del: () => { const c = cur(); if (c) { Player.removeClip(c); toast('Clip removed'); } },
    trim: () => { if (has()) Dialogs.Trim.open(); },
    trimInOut: () => Player.trimToInOut(),
    split: () => Player.split(),
    rotL: () => Player.modClip((c) => { c.rot = (c.rot + 270) % 360; }, 'Rotated left'),
    rotR: () => Player.modClip((c) => { c.rot = (c.rot + 90) % 360; }, 'Rotated right'),
    flipH: () => Player.modClip((c) => { c.fh = !c.fh; }, 'Flipped horizontally'),
    flipV: () => Player.modClip((c) => { c.fv = !c.fv; }, 'Flipped vertically'),
    clipMute: () => Player.modClip((c) => { c.mute = !c.mute; Player.setAudio(); }, null),
    settings: () => Dialogs.settingsDialog(),
  };
  const NEEDS_MEDIA = new Set(['playPause', 'toggleDir', 'playRev', 'stepBack', 'stepFwd', 'shuttleBack', 'shuttleFwd', 'goStart', 'goEnd', 'setIn', 'setOut', 'mark', 'trim', 'trimInOut', 'split', 'export', 'saveFrame', 'copyFrame', 'cut', 'copy', 'del', 'rotL', 'rotR']);
  function run(id) {
    if (NEEDS_MEDIA.has(id) && !has()) return;
    const f = A[id]; if (f) f(); dirty = true;
  }

  function setVolume(v) { S.volume = clamp(Math.round(v * 100) / 100, 0, 1); S.muted = false; Settings.set('volume', S.volume); Settings.set('muted', false); Player.setAudio(); dirty = true; toast('Volume ' + Math.round(S.volume * 100) + '%', 900); }
  function toggleFullscreen() {
    if (API) API.toggleFullscreen();
    else if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
  }
  async function frameBlobWeb(c) {
    const v = c.el;
    if (v.seeking) await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    const w = v.videoWidth, h = v.videoHeight; if (!w) return null;
    const r = ((c.rot % 360) + 360) % 360; const swap = r === 90 || r === 270;
    const cv = document.createElement('canvas'); cv.width = swap ? h : w; cv.height = swap ? w : h;
    const g = cv.getContext('2d');
    g.translate(cv.width / 2, cv.height / 2); g.rotate((r * Math.PI) / 180); g.scale(c.fh ? -1 : 1, c.fv ? -1 : 1);
    g.drawImage(v, -w / 2, -h / 2, w, h);
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  }
  async function frameOp(kind) {
    if (S.playing) Player.pause();
    const L = Player.locate(S.frame); const c = L.clip;
    if (!API) {
      const blob = await frameBlobWeb(c);
      if (!blob) { toast('No picture to save'); return; }
      const name = c.media.name.replace(/\.[^.]+$/, '') + `_frame${L.local + 1}.png`;
      if (kind === 'save') { if (await saveBlob(blob, name, 'PNG image', 'image/png', '.png')) toast('Frame saved'); }
      else { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Frame copied'); } catch (e) { toast('Could not copy the frame'); } }
      return;
    }
    const sec = (L.local + 0.5) / c.media.fps;
    const tf = []; const r = ((c.rot % 360) + 360) % 360;
    if (r === 90) tf.push('transpose=1'); else if (r === 180) tf.push('transpose=1,transpose=1'); else if (r === 270) tf.push('transpose=2');
    if (c.fh) tf.push('hflip'); if (c.fv) tf.push('vflip');
    const name = c.media.name.replace(/\.[^.]+$/, '') + `_frame${L.local + 1}.png`;
    if (kind === 'save') { const res = await API.saveFrame({ path: c.media.path, sec, name, transform: tf }); if (res.ok) toast('Frame saved'); else if (!res.cancelled) toast('Could not save the frame'); }
    else { const res = await API.copyFrame({ path: c.media.path, sec, transform: tf }); toast(res.ok ? 'Frame copied' : 'Could not copy the frame'); }
  }

  // ---------- opening files ----------
  async function openDialog(add) {
    if (!API) {
      if (window.showOpenFilePicker) {
        try {
          const hs = await showOpenFilePicker({ multiple: true, types: [{ description: 'Video and audio', accept: { 'video/*': ['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.ogv', '.avi', '.wmv', '.mpg', '.mpeg', '.ts', '.mts', '.m2ts', '.3gp'], 'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'] } }] });
          const fs = await Promise.all(hs.map((h) => h.getFile()));
          incoming(browserFiles(fs), add ? 'add' : 'open');
        } catch (e) {}
        return;
      }
      const i = el('input', { type: 'file', multiple: true, accept: 'video/*,audio/*' }); i.onchange = () => incoming(browserFiles(i.files), add ? 'add' : 'open'); i.click(); return;
    }
    const files = await API.openDialog({ multi: true, title: add ? 'Add to session' : 'Open' });
    if (files.length) incoming(files, add ? 'add' : 'open');
  }
  function browserFiles(list) { return Array.from(list).map((f) => ({ path: API ? API.pathForFile(f) : '', name: f.name, url: API ? '' : URL.createObjectURL(f), size: f.size, file: API ? null : f })); }
  async function incoming(files, how) {
    if (!files.length) return;
    if (API) files = await Promise.all(files.map(async (f) => (f.url ? f : (f.path ? API.fileInfo(f.path) : f))));
    files = files.filter((f) => f.url);
    if (!files.length) return;
    if (how === 'add') { Player.addFiles(files, { add: true }); return; }
    if (how === 'openwith') { Player.addFiles(files, { add: Settings.get('openWithAdds') && has() }); return; }
    // drop / open dialog
    if (!has() && files.length === 1) { Player.addFiles(files); return; }
    const dm = Settings.get('dropMode');
    if (dm !== 'ask') { Player.addFiles(files, { add: Settings.get('dropAdd') && has(), mode: files.length > 1 || has() ? dm : null }); return; }
    const choice = await Dialogs.chooseOpen(files);
    if (!choice) return;
    Player.addFiles(files, { add: choice.add, mode: choice.mode });
  }
  async function openRecent(p) {
    if (!API) return;
    const f = await API.fileInfo(p);
    if (!f.size) { toast('File not found'); return; }
    Player.addFiles([f]);
  }

  // drag & drop anywhere
  let dragDepth = 0;
  addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#drop-hint').hidden = false; } e.preventDefault(); });
  addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-hint').hidden = true; });
  addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
  addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('#drop-hint').hidden = true;
    if (e.target.closest && e.target.closest('#src-list') && !(e.dataTransfer.files && e.dataTransfer.files.length)) return;
    const files = browserFiles(e.dataTransfer.files || []);
    if (files.length) incoming(files, 'drop');
  });

  // ---------- menus ----------
  const speedItems = () => SPEEDS.map((s) => ({ label: s + '×' + (s === 1 ? ' Normal' : ''), checked: () => S.speed === s, action: () => { S.speed = s; Player.applyRate(); dirty = true; } }));
  const loopItems = () => LOOPS.map(([k, l]) => ({ label: l, checked: () => S.loopMode === k, action: () => { S.loopMode = k; dirty = true; } }));
  const displayItems = () => DISPLAY.map(([k, l]) => ({ label: l, checked: () => S.display === k, action: () => { S.display = k; Settings.set('display', k); dirty = true; } }));
  const rotItems = () => [
    { label: 'Rotate left', key: 'rotL', action: () => run('rotL') }, { label: 'Rotate right', key: 'rotR', action: () => run('rotR') },
    { label: 'Flip horizontal', action: () => run('flipH'), checked: () => cur() && cur().fh }, { label: 'Flip vertical', action: () => run('flipV'), checked: () => cur() && cur().fv },
    { sep: true }, { label: 'Reset rotation and flip', action: () => Player.modClip((c) => { c.rot = 0; c.fh = c.fv = false; }, 'Reset') }];
  const stackItems = () => [
    ...[['over', 'Over'], ['replace', 'Replace'], ['add', 'Add'], ['difference', 'Difference'], ['invdiff', 'Inverted Difference']].map(([k, l]) => ({ label: l, checked: () => S.combine === k, action: () => { S.combine = k; Player.layout(); dirty = true; } })),
    { sep: true }, { label: 'Wipes', key: 'wipes', checked: () => S.wipes, action: () => run('wipes') },
    { label: 'Cycle forward', key: 'cycleFwd', action: () => run('cycleFwd') }, { label: 'Cycle backward', key: 'cycleBack', action: () => run('cycleBack') }];
  const noMedia = () => !has();
  const soon = { label: 'Open in full editor (next update)', disabled: true };

  Menu.bar([
    ['File', () => [
      { label: 'Open…', key: 'open', action: () => run('open') },
      { label: 'Add to session…', key: 'addFiles', action: () => run('addFiles') },
      !API ? null : { label: 'Open recent', sub: () => { const l = Recent.list(); return l.length ? [...l.map((p) => ({ label: p.split(/[\\/]/).pop(), action: () => openRecent(p) })), { sep: true }, { label: 'Clear list', action: () => Recent.clear() }] : [{ label: 'No recent files', disabled: true }]; } },
      { sep: true },
      { label: 'Export…', key: 'export', disabled: noMedia, action: () => run('export') },
      { label: 'Save frame as image…', key: 'saveFrame', disabled: noMedia, action: () => run('saveFrame') },
      { label: 'Copy frame', key: 'copyFrame', disabled: noMedia, action: () => run('copyFrame') },
      { sep: true },
      { label: 'Show in folder', disabled: () => !has() || !API, action: () => API.showInFolder(cur().media.path) },
      { label: 'Close session', key: 'closeSession', disabled: noMedia, action: () => run('closeSession') },
      { sep: true },
      { label: 'Exit', kb: 'Alt+F4', action: () => (API ? API.windowCmd('close') : window.close()) },
    ]],
    ['Edit', () => [
      { label: 'Undo', key: 'undo', disabled: () => !Player.canUndo(), action: () => run('undo') },
      { label: 'Redo', key: 'redo', disabled: () => !Player.canRedo(), action: () => run('redo') },
      { sep: true },
      { label: 'Cut clip', key: 'cut', disabled: noMedia, action: () => run('cut') },
      { label: 'Copy clip', key: 'copy', disabled: noMedia, action: () => run('copy') },
      { label: 'Paste clip', key: 'paste', disabled: () => !Player.hasClipboard(), action: () => run('paste') },
      { label: 'Delete clip', key: 'del', disabled: noMedia, action: () => run('del') },
      { sep: true },
      { label: 'Trim…', key: 'trim', disabled: noMedia, action: () => run('trim') },
      { label: 'Trim to In / Out', key: 'trimInOut', disabled: () => S.inF == null && S.outF == null, action: () => run('trimInOut') },
      { label: 'Split at playhead', key: 'split', disabled: () => !has() || S.mode !== 'sequence', action: () => run('split') },
      { label: 'Add clip to end…', action: () => run('addFiles') },
      { label: 'Remove audio from clip', checked: () => cur() && cur().mute, disabled: noMedia, action: () => run('clipMute') },
      { sep: true }, ...rotItems().slice(0, 4), { sep: true },
      { label: 'Settings…', key: 'settings', action: () => run('settings') },
    ]],
    ['View', () => [
      ...[['sequence', 'Sequence', 'modeSequence'], ['stack', 'Stack', 'modeStack'], ['layout', 'Layout', 'modeLayout'], ['tile', 'Tile', 'modeTile']].map(([m, l, k]) => ({ label: l, key: k, checked: () => S.mode === m, action: () => run(k) })),
      { label: 'Stack options', sub: stackItems },
      { sep: true },
      { label: 'Fit', key: 'fit', action: () => run('fit') }, { label: 'Actual size (1:1)', key: 'scale1', action: () => run('scale1') }, { label: 'Zoom 2:1', key: 'scale2', action: () => run('scale2') },
      { label: 'Zoom in', key: 'zoomIn', action: () => run('zoomIn') }, { label: 'Zoom out', key: 'zoomOut', action: () => run('zoomOut') },
      { label: 'Flop view (mirror)', key: 'flipX', checked: () => S.view.flipX, action: () => run('flipX') }, { label: 'Flip view (upside down)', key: 'flipY', checked: () => S.view.flipY, action: () => run('flipY') },
      { sep: true },
      { label: 'Sources panel', key: 'sources', checked: () => !$('#sources').hidden, action: () => run('sources') },
      { label: 'Info overlay', key: 'overlay', checked: () => Settings.get('showInfo'), action: () => run('overlay') },
      { label: 'Image info', key: 'info', checked: () => !$('#image-info').hidden, action: () => run('info') },
      { label: 'Timeline', key: 'timeline', checked: () => !$('#bottom').hidden, action: () => run('timeline') },
      { label: 'Full screen', key: 'fullscreen', action: () => run('fullscreen') },
      { sep: true }, { label: 'Frame display', sub: displayItems }, { sep: true }, soon,
    ]],
    ['Playback', () => [
      { label: S.playing ? 'Pause' : 'Play', key: 'playPause', disabled: noMedia, action: () => run('playPause') },
      { label: 'Play reverse', key: 'playRev', disabled: noMedia, action: () => run('playRev') },
      { label: 'Stop', key: 'stop', disabled: noMedia, action: () => run('stop') },
      { label: 'Next frame', key: 'stepFwd', disabled: noMedia, action: () => run('stepFwd') },
      { label: 'Previous frame', key: 'stepBack', disabled: noMedia, action: () => run('stepBack') },
      { label: 'Go to frame…', key: 'gotoFrame', disabled: noMedia, action: () => run('gotoFrame') },
      { label: 'Go to start', key: 'goStart', disabled: noMedia, action: () => run('goStart') },
      { label: 'Go to end', key: 'goEnd', disabled: noMedia, action: () => run('goEnd') },
      { sep: true },
      { label: 'Loop mode', sub: loopItems }, { label: 'Speed', sub: speedItems },
      { label: 'Play all frames', key: 'allFrames', checked: () => S.allFrames, action: () => run('allFrames') },
      { label: 'Audio scrub', key: 'audioScrub', checked: () => S.audioScrub, action: () => run('audioScrub') },
      { label: 'Step wraps at In / Out', checked: () => Settings.get('stepWraps'), action: () => Settings.set('stepWraps', !Settings.get('stepWraps')) },
      { sep: true },
      { label: 'Mute', key: 'mute', checked: () => S.muted, action: () => run('mute') },
      { label: 'Volume up', key: 'volUp', action: () => run('volUp') }, { label: 'Volume down', key: 'volDown', action: () => run('volDown') },
    ]],
    ['Mark', () => [
      { label: 'Add / remove mark', key: 'mark', disabled: noMedia, action: () => run('mark') },
      { label: 'Previous mark', key: 'prevMark', disabled: noMedia, action: () => run('prevMark') },
      { label: 'Next mark', key: 'nextMark', disabled: noMedia, action: () => run('nextMark') },
      { sep: true },
      { label: 'Set In', key: 'setIn', disabled: noMedia, action: () => run('setIn') },
      { label: 'Set Out', key: 'setOut', disabled: noMedia, action: () => run('setOut') },
      { label: 'Reset In / Out', key: 'clearInOut', disabled: () => S.inF == null && S.outF == null, action: () => run('clearInOut') },
      { label: 'In / Out to previous marked shot', key: 'prevRange', disabled: noMedia, action: () => run('prevRange') },
      { label: 'In / Out to next marked shot', key: 'nextRange', disabled: noMedia, action: () => run('nextRange') },
      { sep: true },
      { label: 'Clear all marks', disabled: () => !S.marks.size, action: () => { Player.commit(); S.marks = new Set(); dirty = true; } },
    ]],
    ['Window', () => [
      { label: 'Always on top', checked: () => !!S.onTop, disabled: !API, action: () => { S.onTop = !S.onTop; API.setOnTop(S.onTop); } },
      { label: 'Minimise', disabled: !API, action: () => API.windowCmd('minimize') },
      { sep: true },
      { label: 'Sources panel', key: 'sources', checked: () => !$('#sources').hidden, action: () => run('sources') },
      { label: 'Image info', key: 'info', checked: () => !$('#image-info').hidden, action: () => run('info') },
    ]],
    ['Help', () => [
      { label: 'Make Clips Pro your default player…', action: () => Dialogs.settingsDialog('default') },
      { label: 'Keyboard shortcuts…', action: () => Dialogs.shortcutsSheet() },
      { sep: true }, { label: 'About Clips Pro', action: () => Dialogs.about() },
    ]],
  ]);

  function viewerMenu(x, y) {
    const items = has() ? [
      { label: 'Trim…', key: 'trim', action: () => run('trim') },
      { label: 'Split at playhead', key: 'split', disabled: () => S.mode !== 'sequence', action: () => run('split') },
      { label: 'Set In point here', key: 'setIn', action: () => run('setIn') },
      { label: 'Set Out point here', key: 'setOut', action: () => run('setOut') },
      { sep: true },
      { label: S.marks.has(S.frame) ? 'Remove mark' : 'Add mark', key: 'mark', action: () => run('mark') },
      { label: 'Save this frame as image…', key: 'saveFrame', action: () => run('saveFrame') },
      { label: 'Copy frame', key: 'copyFrame', action: () => run('copyFrame') },
      { sep: true },
      { label: 'Speed', sub: speedItems }, { label: 'Rotate / flip', sub: rotItems }, { label: 'Loop mode', sub: loopItems },
      { label: 'Play all frames', key: 'allFrames', checked: () => S.allFrames, action: () => run('allFrames') },
      { label: 'Audio scrub', key: 'audioScrub', checked: () => S.audioScrub, action: () => run('audioScrub') },
      S.mode === 'stack' ? { label: 'Stack options', sub: stackItems } : null,
      { sep: true },
      { label: 'Compare with…', action: async () => { if (!API) return; const f = await API.openDialog({ multi: true, title: 'Compare with' }); if (f.length) { Player.addFiles(f, { add: true }); Player.setMode('layout'); } } },
      soon,
      { label: 'Export…', key: 'export', action: () => run('export') },
      { sep: true },
      { label: 'Show in folder', disabled: !API, action: () => API.showInFolder(cur().media.path) },
      { label: 'Image info', key: 'info', action: () => run('info') },
    ] : [
      { label: 'Open…', key: 'open', action: () => run('open') },
      { label: 'Settings…', key: 'settings', action: () => run('settings') },
    ];
    Menu.open(items, x, y);
  }
  Timeline.onMenu = (f, x, y) => {
    const L = Player.locate(f);
    Menu.open([
      { header: `Frame ${Player.frameText(f)} · ${L.clip.media.name}` },
      { label: 'Set In here', key: 'setIn', action: () => Player.setIn(f) },
      { label: 'Set Out here', key: 'setOut', action: () => Player.setOut(f) },
      { label: 'Reset In / Out', key: 'clearInOut', disabled: () => S.inF == null && S.outF == null, action: () => run('clearInOut') },
      { sep: true },
      { label: S.marks.has(f) ? 'Remove mark here' : 'Add mark here', key: 'mark', action: () => Player.toggleMark(f) },
      { label: 'Previous mark', key: 'prevMark', action: () => run('prevMark') },
      { label: 'Next mark', key: 'nextMark', action: () => run('nextMark') },
      { label: 'Loop this marked shot', key: 'nextRange', action: () => { const r = Player.ranges().find(([a, b]) => f >= a && f <= b); if (r) { S.inF = r[0]; S.outF = r[1]; S.loopMode = 'loop'; Player.goto(r[0]); Player.play(1); } } },
      { sep: true },
      { label: 'Frame display', sub: displayItems },
      { label: 'Step wraps at In / Out', checked: () => Settings.get('stepWraps'), action: () => Settings.set('stepWraps', !Settings.get('stepWraps')) },
      { label: 'Show cache stripe', checked: () => Settings.get('showCache'), action: () => { Settings.set('showCache', !Settings.get('showCache')); dirty = true; } },
      { label: 'Show play controls', checked: () => Settings.get('showControls'), action: () => { Settings.set('showControls', !Settings.get('showControls')); refreshAll(); } },
      { label: 'Timeline at top', checked: () => Settings.get('timelineTop'), action: () => { Settings.set('timelineTop', !Settings.get('timelineTop')); refreshAll(); } },
      { sep: true },
      { label: 'Zoom to fit', action: () => Timeline.fit() },
    ], x, y);
  };
  function sourceMenu(c, x, y) {
    const i = S.clips.indexOf(c);
    Menu.open([
      { header: c.media.name },
      { label: 'Go to this clip', action: () => selectClip(c) },
      { label: 'Make top of stack', disabled: () => S.mode !== 'stack', action: () => { S.stackOrder = [c.id, ...S.stackOrder.filter((x) => x !== c.id)]; S.cur = c.id; Player.layout(); dirty = true; } },
      { label: 'Use this clip\'s audio', checked: () => S.audioClip === c.id, disabled: () => S.mode === 'sequence', action: () => { S.audioClip = c.id; Player.setAudio(); renderSources(); } },
      { label: 'Mute this clip', checked: () => c.mute, action: () => { Player.commit(); c.mute = !c.mute; Player.setAudio(); renderSources(); dirty = true; } },
      { label: 'Trim…', action: () => { selectClip(c); run('trim'); } },
      { label: 'Image info', action: () => { selectClip(c); $('#image-info').hidden = false; Dialogs.renderInfo(); } },
      { label: 'Show in folder', disabled: !API, action: () => API.showInFolder(c.media.path) },
      { sep: true },
      { label: 'Move up', disabled: i === 0, action: () => Player.moveClip(i, i - 1) },
      { label: 'Move down', disabled: i === S.clips.length - 1, action: () => Player.moveClip(i, i + 1) },
      { label: 'Remove from session', action: () => Player.removeClip(c) },
    ], x, y);
  }
  function selectClip(c) {
    if (S.mode === 'sequence') Player.goto(Player.starts()[S.clips.indexOf(c)]);
    else { S.cur = c.id; Player.layout(); dirty = true; }
    renderSources();
  }

  // ---------- sources panel ----------
  let dragIdx = -1;
  function renderSources() {
    const list = $('#src-list'); list.innerHTML = '';
    $('#src-count').textContent = S.clips.length ? `${S.clips.length} ${S.clips.length === 1 ? 'clip' : 'clips'}` : '';
    const curc = cur();
    S.clips.forEach((c, i) => {
      const audioOn = S.mode === 'sequence' ? !c.mute : (S.audioClip === c.id && !c.mute);
      const noAudio = c.media.probed && !c.media.hasAudio;
      const spk = el('button', { class: 'spk' + (audioOn && !noAudio ? ' on' : ''), title: noAudio ? 'No audio in this file' : S.mode === 'sequence' ? 'Mute / unmute this clip' : 'Play this clip\'s audio', html: c.mute ? ICONS.mute : ICONS.spk, disabled: noAudio });
      spk.addEventListener('click', (e) => { e.stopPropagation(); if (S.mode === 'sequence') { Player.commit(); c.mute = !c.mute; } else { S.audioClip = c.id; } Player.setAudio(); renderSources(); dirty = true; });
      const st = c.media.status === 'converting' ? `${Math.round(c.media.convertPct * 100)}%` : c.media.status === 'convert' ? 'needs converting' : c.media.status === 'error' ? 'error' : '';
      const row = el('div', { class: 'src' + (c === curc ? ' cur' : ''), role: 'listitem', draggable: 'true', title: c.media.path || c.media.name },
        el('span', { class: 'name' }, c.media.name), st ? el('span', { class: 'st' }, st) : null,
        el('span', { class: 'dur' }, fmtDur(Player.len(c) / c.media.fps)), spk);
      row.addEventListener('click', () => selectClip(c));
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); sourceMenu(c, e.clientX, e.clientY); });
      row.addEventListener('dragstart', (e) => { dragIdx = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
      row.addEventListener('dragover', (e) => { if (dragIdx >= 0) { e.preventDefault(); row.classList.add('drag-over'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => { if (dragIdx < 0) return; e.preventDefault(); e.stopPropagation(); row.classList.remove('drag-over'); const from = dragIdx; dragIdx = -1; Player.moveClip(from, i); });
      row.addEventListener('dragend', () => { dragIdx = -1; });
      list.append(row);
    });
    $('#stack-opts').hidden = S.mode !== 'stack';
    $('#combine').value = S.combine; $('#wipes-toggle').checked = S.wipes;
  }
  $('#combine').addEventListener('change', (e) => { S.combine = e.target.value; Player.layout(); dirty = true; });
  $('#wipes-toggle').addEventListener('change', (e) => { S.wipes = e.target.checked; Player.layout(); dirty = true; });
  $('#src-list').addEventListener('keydown', (e) => {
    const i = S.clips.indexOf(cur());
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); e.stopPropagation(); Player.moveClip(i, i + (e.key === 'ArrowUp' ? -1 : 1)); }
  });

  // ---------- transport & controls ----------
  $('#btn-start').innerHTML = ICONS.start; $('#btn-end').innerHTML = ICONS.end;
  $('#btn-prev').innerHTML = ICONS.prev; $('#btn-next').innerHTML = ICONS.next;
  $('#btn-rev').innerHTML = ICONS.rev;
  const click = (id, fn) => $(id).addEventListener('click', fn);
  click('#btn-start', () => run('goStart')); click('#btn-end', () => run('goEnd'));
  click('#btn-prev', () => run('stepBack')); click('#btn-next', () => run('stepFwd'));
  click('#btn-rev', () => { if (S.playing && S.dir < 0) Player.pause(); else run('playRev'); });
  click('#btn-play', () => { if (S.playing && S.dir > 0) Player.pause(); else if (has()) Player.play(1); });
  click('#btn-loop', () => run('loopMode'));
  click('#btn-allframes', () => run('allFrames'));
  click('#btn-scrub', () => run('audioScrub'));
  click('#btn-vol', () => run('mute'));
  click('#btn-open', () => run('open'));
  click('#btn-fit', () => run('fit'));
  click('#btn-sources', () => run('sources'));
  click('#btn-zoom-fit', () => Timeline.fit());
  click('#btn-edit', () => toast('The full editor (Resolve-style) arrives in the next update'));
  click('#btn-display', (e) => { const r = e.currentTarget.getBoundingClientRect(); Menu.open(displayItems(), r.left, r.top - 170); });
  click('#btn-speed', (e) => { const r = e.currentTarget.getBoundingClientRect(); Menu.open(speedItems(), r.left, r.top - 200); });
  $('#volume').addEventListener('input', (e) => { S.volume = +e.target.value / 100; S.muted = false; Settings.set('volume', S.volume); Settings.set('muted', false); Player.setAudio(); dirty = true; });
  $('#zoom').addEventListener('input', (e) => Timeline.fromSlider(+e.target.value));
  $$('#mode-seg button').forEach((b) => b.addEventListener('click', () => Player.setMode(b.dataset.mode)));
  const ff = $('#frame-field');
  ff.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const g = Player.parseFrameText(ff.value); if (g != null) Player.goto(clamp(g, 0, Player.total() - 1)); ff.blur(); e.preventDefault(); }
    if (e.key === 'Escape') { ff.blur(); e.preventDefault(); }
    e.stopPropagation();
  });
  ff.addEventListener('blur', () => { dirty = true; });

  // ---------- viewer interactions ----------
  const viewer = $('#viewer');
  viewer.addEventListener('wheel', (e) => {
    if (!has()) return; e.preventDefault();
    const r = viewer.getBoundingClientRect();
    Player.zoomAbout(e.clientX - r.left, e.clientY - r.top, S.view.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  viewer.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !has() || e.target.closest('#viewer-tools,#image-info,#convert-card,#wipe-line,.empty')) return;
    const sx = e.clientX, sy = e.clientY, px = S.view.px, py = S.view.py; let moved = false;
    const mv = (ev) => { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (!moved && Math.hypot(dx, dy) < 4) return; moved = true; S.view.px = px + dx; S.view.py = py + dy; Player.applyView(); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
  viewer.addEventListener('dblclick', (e) => { if (!e.target.closest('#viewer-tools,#image-info,#convert-card,.empty')) toggleFullscreen(); });
  viewer.addEventListener('contextmenu', (e) => { e.preventDefault(); viewerMenu(e.clientX, e.clientY); });
  $('#wipe-line').addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const r = viewer.getBoundingClientRect();
    const mv = (ev) => { S.wipeX = clamp((ev.clientX - r.left - S.view.px) / (r.width * S.view.z), 0, 1); Player.layout(); };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
  new ResizeObserver(() => { Player.layout(); dirty = true; }).observe(viewer);

  // ---------- keyboard ----------
  const REPEATABLE = new Set(['stepBack', 'stepFwd', 'zoomIn', 'zoomOut', 'volUp', 'volDown']);
  addEventListener('keydown', (e) => {
    if (Modal.isOpen()) {
      const t = Modal.top();
      if (t.capture && t.capture(e)) { e.preventDefault(); return; }
      if (e.key === 'Escape') { e.preventDefault(); Modal.closeTop(); }
      return;
    }
    if (Menu.isOpen()) { if (Menu.key(e)) e.preventDefault(); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if ((tag === 'input' && !['checkbox', 'radio', 'range'].includes(e.target.type)) || tag === 'select' || tag === 'textarea') return;
    const k = Keys.fromEvent(e); if (!k) return;
    const act = Keys.actionFor(k);
    if (Dialogs.Trim.isOpen()) { if (Dialogs.Trim.key(e, act)) { e.preventDefault(); return; } }
    if (e.key === 'Escape') { if (document.body.classList.contains('fs')) toggleFullscreen(); return; }
    if (!act) return;
    e.preventDefault();
    if (e.repeat && !REPEATABLE.has(act)) return;
    run(act);
  });
  if (API) API.onFullscreen((v) => { document.body.classList.toggle('fs', v); $('#titlebar').hidden = v; setTimeout(() => Player.layout(), 50); });
  document.addEventListener('fullscreenchange', () => { const v = !!document.fullscreenElement; document.body.classList.toggle('fs', v); $('#titlebar').hidden = v; setTimeout(() => Player.layout(), 50); });

  // ---------- render ----------
  function updateUI() {
    const T = Player.total(); const c = cur();
    $('#empty').hidden = has();
    // play button
    const pb = $('#btn-play'); const playingFwd = S.playing && S.dir > 0;
    pb.innerHTML = playingFwd ? ICONS.pause : ICONS.play; pb.setAttribute('aria-label', playingFwd ? 'Pause' : 'Play');
    const rb = $('#btn-rev'); const playingRev = S.playing && S.dir < 0;
    rb.innerHTML = playingRev ? ICONS.pause : ICONS.rev; rb.classList.toggle('on', playingRev);
    const lb = $('#btn-loop'); lb.innerHTML = ICONS[S.loopMode]; lb.title = 'Loop mode: ' + LOOPS.find((l) => l[0] === S.loopMode)[1]; lb.classList.add('on');
    $('#btn-allframes').classList.toggle('on', S.allFrames);
    $('#btn-scrub').classList.toggle('on', S.audioScrub);
    $('#btn-vol').innerHTML = S.muted || S.volume === 0 ? ICONS.mute : ICONS.vol;
    $('#volume').value = String(Math.round((S.muted ? 0 : S.volume) * 100));
    $('#btn-display').textContent = ({ source: 'Frames', session: 'Session', timecode: 'Timecode', seconds: 'Seconds', footage: 'Feet' }[S.display] || 'Frames') + ' ▾';
    $('#btn-display').title = 'Frame display: ' + (DISPLAY.find((d) => d[0] === S.display) || DISPLAY[0])[1];
    $('#btn-speed').textContent = (S.speed === 1 ? '1' : S.speed) + '×';
    $$('#mode-seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
    $('#btn-edit').classList.add('soon');
    // frame field
    if (document.activeElement !== $('#frame-field')) $('#frame-field').value = T ? Player.frameText(S.frame) : '';
    $('#frame-total').textContent = T ? '/ ' + (S.display === 'source' && c ? String(c.tout + 1) : Player.frameText(T - 1)) : '';
    // readouts
    const ro = $('#readouts');
    if (T) {
      const a = Player.startF(), b = Player.endF();
      const meas = S.playing && S.measuredFps ? S.measuredFps.toFixed(1) : '–';
      const slowed = S.playing && S.allFrames && S.rateFactor < 0.999 ? ` · slowed to ${Math.round(S.rateFactor * 100)}% to keep every frame` : '';
      ro.innerHTML = '';
      const kind = S.display === 'source' ? 'session' : S.display;
      ro.append(el('span', {}, 'In ' + Player.frameText(a, kind)), el('span', {}, 'Out ' + Player.frameText(b, kind)), el('span', {}, (b - a + 1) + ' frames'),
        el('span', {}, `${fmtFps(Player.fps())} fps target · ${meas} measured${slowed}`));
      if (!S.allFrames) ro.append(el('span', { class: 'drop' + (S.dropped ? ' bad' : '') }, `● ${S.dropped} dropped`));
    } else ro.textContent = '';
    // overlay
    const ov = $('#overlay-info');
    if (T && Settings.get('showInfo') && c) {
      const m = c.media;
      const lines = [];
      if (S.mode === 'sequence') {
        const L = Player.locate(S.frame);
        lines.push(m.name, m.hasVideo ? `${m.w || '?'}×${m.h || '?'} · ${fmtFps(m.fps)} fps` : 'Audio only', `Source ${L.i + 1} of ${S.clips.length} · Frame ${Player.frameText(S.frame)}`);
      } else {
        const top = Player.stackTop();
        lines.push(S.mode === 'stack' ? `Stack · top: ${top ? top.media.name : ''}` : `${Dialogs.MODE_TXT[S.mode][0]} · ${S.clips.length} clips`, `Selected: ${m.name}`, `Frame ${Player.frameText(S.frame)}`);
        if (S.mode === 'stack' && S.wipes && S.combine === 'over' && S.clips.length > 1) lines.push('Drag the white line to wipe');
      }
      if (S.speed !== 1) lines.push(`Speed ${S.speed}×`);
      if (m.playUrl !== m.url) lines.push('Playing converted copy');
      ov.textContent = lines.join('\n'); ov.hidden = false;
    } else ov.hidden = true;
    // title
    const title = c ? (S.clips.length > 1 ? `Session — ${S.clips.length} sources · ${Dialogs.MODE_TXT[S.mode][0]}` : `${c.media.name}${c.media.w ? ` — ${c.media.w}×${c.media.h} · ${fmtFps(c.media.fps)} fps` : ''}`) : 'Clips Pro';
    if ($('#title-text').textContent !== title) { $('#title-text').textContent = title; if (API) API.setTitle(c ? c.media.name + ' — Clips Pro' : 'Clips Pro'); document.title = c ? c.media.name + ' — Clips Pro' : 'Clips Pro'; }
    Dialogs.renderConvert();
    if (!$('#image-info').hidden) Dialogs.renderInfo();
    if (!$('#sources').hidden && (renderSources._n !== srcSig())) { renderSources(); renderSources._n = srcSig(); }
  }
  function srcSig() { return S.clips.map((c) => c.id + c.media.status + Math.round(c.media.convertPct * 100) + c.mute + c.tin + c.tout).join('|') + S.mode + S.audioClip + (cur() && cur().id); }
  function refreshAll() {
    $('#bottom').classList.toggle('top-timeline', !!Settings.get('timelineTop'));
    $('#transport').hidden = !Settings.get('showControls');
    renderSources(); Player.layout(); dirty = true;
  }
  function sessionChanged() { Timeline.reset(); renderSources(); dirty = true; }
  Media.onUpdate(() => { dirty = true; });

  let lastDraw = 0;
  function frame(now) {
    Player.tick(now);
    if (dirty || S.playing || now - lastDraw > 250) { updateUI(); Timeline.draw(); dirty = false; lastDraw = now; }
    requestAnimationFrame(frame);
  }

  // ---------- start ----------
  async function start() {
    document.body.classList.toggle('electron', !!API);
    refreshAll();
    requestAnimationFrame(frame);
    if (!API) {
      // installed web app: files double-clicked in Windows / "Open with" arrive here
      if ('launchQueue' in window) {
        launchQueue.setConsumer(async (params) => {
          if (!params.files || !params.files.length) return;
          const fs = await Promise.all(params.files.map((h) => h.getFile()));
          incoming(browserFiles(fs), 'openwith');
        });
      }
      if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
      const installed = matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches;
      if (installed && !Settings.get('firstRunDone')) setTimeout(() => Dialogs.firstRun(), 600);
      if (!installed) setTimeout(() => Dialogs.installTip(), 800);
    }
    if (API) {
      API.onOpenFiles((files) => incoming(files, 'openwith'));
      const files = await API.initialFiles();
      if (files.length) incoming(files, 'openwith');
      if (!Settings.get('firstRunDone')) setTimeout(() => Dialogs.firstRun(), files.length ? 1500 : 300);
    }
  }
  start();
  return { sessionChanged, refreshAll, run, incoming, get dirty() { return dirty; }, set dirty(v) { dirty = v; } };
})();

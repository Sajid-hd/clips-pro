'use strict';
// Clips Pro - main process
const { app, BrowserWindow, ipcMain, dialog, shell, screen, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

app.setAppUserModelId('ClipsPro');

let win = null;
let initialFiles = [];
const jobs = new Map(); // running ffmpeg jobs by id

// ---------- ffmpeg location ----------
function binPath(name) {
  const exe = process.platform === 'win32' ? name + '.exe' : name;
  const candidates = [
    path.join(process.resourcesPath || '', 'ffmpeg', exe),
    path.join(__dirname, '..', 'ffmpeg', exe),
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return name; // fall back to PATH
}
const FFMPEG = () => binPath('ffmpeg');
const FFPROBE = () => binPath('ffprobe');

// ---------- helpers ----------
function fileInfo(p) {
  let size = 0;
  try { size = fs.statSync(p).size; } catch (e) {}
  return { path: p, name: path.basename(p), url: pathToFileURL(p).href, size };
}
function filesFromArgv(argv) {
  const out = [];
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('-')) continue;
    try { if (fs.statSync(a).isFile() && path.resolve(a) !== path.resolve(process.execPath)) out.push(path.resolve(a)); } catch (e) {}
  }
  return out;
}
function run(cmd, args, { collect = true, onStderr, id } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { windowsHide: true }); }
    catch (e) { resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(e) }); return; }
    if (id) jobs.set(id, child);
    const out = []; let err = '';
    child.stdout.on('data', (d) => { if (collect) out.push(d); });
    child.stderr.on('data', (d) => { const s = d.toString(); err = (err + s).slice(-20000); if (onStderr) onStderr(s); });
    child.on('error', (e) => { err += String(e); });
    child.on('close', (code) => { if (id) jobs.delete(id); resolve({ code, stdout: Buffer.concat(out), stderr: err, killed: child.killed }); });
  });
}
function proxyDir() {
  const d = path.join(app.getPath('userData'), 'converted');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function keyFor(p) {
  let st = { size: 0, mtimeMs: 0 };
  try { st = fs.statSync(p); } catch (e) {}
  return crypto.createHash('sha1').update(p + '|' + st.size + '|' + st.mtimeMs).digest('hex').slice(0, 16);
}
function parseRate(r) {
  if (!r || r === '0/0') return 0;
  const [a, b] = String(r).split('/').map(Number);
  return b ? a / b : a;
}
function timeToSec(t) { const m = /(\d+):(\d+):([\d.]+)/.exec(t); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0; }

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 720, minWidth: 640, minHeight: 420,
    backgroundColor: '#000000',
    title: 'Clips Pro',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#111214', symbolColor: '#c9ccd2', height: 36 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
  win.on('closed', () => { win = null; for (const c of jobs.values()) { try { c.kill(); } catch (e) {} } });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  initialFiles = filesFromArgv(process.argv);
  app.on('second-instance', (e, argv) => {
    const files = filesFromArgv(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show(); win.focus();
      if (files.length) win.webContents.send('open-files', files.map(fileInfo));
    }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}

// ---------- IPC ----------
ipcMain.handle('initial-files', () => { const f = initialFiles.map(fileInfo); initialFiles = []; return f; });
ipcMain.handle('file-info', (e, p) => fileInfo(p));
ipcMain.handle('app-version', () => app.getVersion());

ipcMain.handle('probe', async (e, p) => {
  const r = await run(FFPROBE(), ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', p]);
  if (r.code !== 0) return { ok: false, error: r.stderr.slice(-500) };
  let j; try { j = JSON.parse(r.stdout.toString()); } catch (err) { return { ok: false, error: 'probe parse failed' }; }
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find((s) => s.codec_type === 'audio');
  const fmt = j.format || {};
  const out = { ok: true, format: fmt.format_long_name || fmt.format_name || '', duration: parseFloat(fmt.duration) || 0, bitRate: +fmt.bit_rate || 0, size: +fmt.size || 0 };
  if (v) {
    let rot = 0;
    for (const sd of v.side_data_list || []) if (sd.rotation != null) rot = +sd.rotation;
    if (v.tags && v.tags.rotate) rot = -(+v.tags.rotate);
    const fps = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || 24;
    const vdur = parseFloat(v.duration) || out.duration;
    out.video = {
      codec: v.codec_name, codecLong: v.codec_long_name, profile: v.profile || '', width: v.width, height: v.height,
      pixFmt: v.pix_fmt, fps, rFps: parseRate(v.r_frame_rate), frames: +v.nb_frames || Math.round(vdur * fps), duration: vdur,
      rotation: rot, bitRate: +v.bit_rate || 0, fieldOrder: v.field_order || '',
      timecode: (v.tags && v.tags.timecode) || (fmt.tags && fmt.tags.timecode) || '',
    };
  }
  if (a) out.audio = { codec: a.codec_name, codecLong: a.codec_long_name, sampleRate: +a.sample_rate, channels: a.channels, layout: a.channel_layout || '' };
  return out;
});

// Low-rate mono PCM for audio scrubbing and waveform
ipcMain.handle('audio-pcm', async (e, p, durationSec) => {
  const rate = durationSec > 2400 ? 8000 : 16000;
  if (durationSec > 4 * 3600) return { ok: false, error: 'too long' };
  const r = await run(FFMPEG(), ['-v', 'error', '-nostdin', '-i', p, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', 'pipe:1']);
  if (r.code !== 0 || !r.stdout.length) return { ok: false, error: r.stderr.slice(-300) };
  return { ok: true, rate, data: new Uint8Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length) };
});

// Encoder chains (first one that works is used)
function h264Chains(bitrateK) {
  const b = String(bitrateK) + 'k';
  return [
    ['-c:v', 'h264_mf', '-b:v', b, '-g', '12', '-pix_fmt', 'nv12'],
    ['-c:v', 'h264_nvenc', '-preset', 'p4', '-b:v', b, '-g', '12', '-pix_fmt', 'yuv420p'],
    ['-c:v', 'h264_qsv', '-b:v', b, '-g', '12', '-pix_fmt', 'nv12'],
    ['-c:v', 'h264_amf', '-b:v', b, '-g', '12', '-pix_fmt', 'yuv420p'],
    ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-g', '12', '-pix_fmt', 'yuv420p'],
  ];
}
function guessBitrateK(w, h, fps, factor = 0.14) {
  const k = Math.round(((w || 1920) * (h || 1080) * (fps || 24) * factor) / 1000);
  return Math.max(1500, Math.min(k, 120000));
}

function progressParser(totalSec, onPct) {
  return (s) => {
    const m = s.match(/time=(\d+:\d+:[\d.]+)/g);
    if (m && totalSec > 0) {
      const t = timeToSec(m[m.length - 1].slice(5));
      onPct(Math.max(0, Math.min(1, t / totalSec)));
    }
  };
}

ipcMain.handle('convert', async (e, { id, path: p, width, height, fps, duration }) => {
  const key = keyFor(p);
  const dir = proxyDir();
  for (const ext of ['.mp4', '.webm']) {
    const existing = path.join(dir, key + ext);
    if (fs.existsSync(existing) && fs.statSync(existing).size > 1000) return { ok: true, ...fileInfo(existing), cached: true };
  }
  const send = (pct) => { if (win) win.webContents.send('job-progress', { id, pct }); };
  const vf = ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
  const br = guessBitrateK(width, height, fps, 0.16);
  const tries = h264Chains(br).map((c) => ({ ext: '.mp4', args: [...c, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] }));
  tries.push({ ext: '.webm', args: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', br + 'k', '-g', '12', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '160k'] });
  let lastErr = '';
  for (const t of tries) {
    const tmp = path.join(dir, key + '.part' + t.ext);
    const final = path.join(dir, key + t.ext);
    const args = ['-v', 'error', '-stats', '-nostdin', '-y', '-i', p, '-map', '0:v:0', '-map', '0:a:0?', ...vf, ...t.args, tmp];
    const r = await run(FFMPEG(), args, { collect: false, id, onStderr: progressParser(duration, send) });
    if (r.killed) { try { fs.unlinkSync(tmp); } catch (err) {} return { ok: false, cancelled: true }; }
    if (r.code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 1000) {
      fs.renameSync(tmp, final);
      return { ok: true, ...fileInfo(final) };
    }
    lastErr = r.stderr.slice(-400);
    try { fs.unlinkSync(tmp); } catch (err) {}
  }
  return { ok: false, error: lastErr || 'No encoder worked' };
});

ipcMain.handle('cancel-job', (e, id) => { const c = jobs.get(id); if (c) { try { c.kill(); } catch (err) {} } return true; });

ipcMain.handle('converted-size', () => {
  let total = 0;
  try { for (const f of fs.readdirSync(proxyDir())) total += fs.statSync(path.join(proxyDir(), f)).size; } catch (e) {}
  return total;
});
ipcMain.handle('clear-converted', () => {
  try { for (const f of fs.readdirSync(proxyDir())) fs.unlinkSync(path.join(proxyDir(), f)); } catch (e) {}
  return true;
});

// Grab one exact frame from the original file
async function grabFrame(p, sec, out, transform) {
  const vf = transform && transform.length ? ['-vf', transform.join(',')] : [];
  const r = await run(FFMPEG(), ['-v', 'error', '-nostdin', '-y', '-ss', String(Math.max(0, sec)), '-i', p, '-frames:v', '1', ...vf, out]);
  return r.code === 0 && fs.existsSync(out);
}
ipcMain.handle('save-frame', async (e, { path: p, sec, name, transform }) => {
  const res = await dialog.showSaveDialog(win, { title: 'Save frame as image', defaultPath: name, filters: [{ name: 'PNG image', extensions: ['png'] }, { name: 'JPEG image', extensions: ['jpg'] }] });
  if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
  const ok = await grabFrame(p, sec, res.filePath, transform);
  return { ok, path: res.filePath };
});
ipcMain.handle('copy-frame', async (e, { path: p, sec, transform }) => {
  const tmp = path.join(os.tmpdir(), 'clipspro-frame-' + Date.now() + '.png');
  const ok = await grabFrame(p, sec, tmp, transform);
  if (ok) { clipboard.writeImage(nativeImage.createFromPath(tmp)); try { fs.unlinkSync(tmp); } catch (err) {} }
  return { ok };
});

// ---------- Export ----------
function transformFilters(seg) {
  const f = [];
  const r = ((seg.rotate || 0) % 360 + 360) % 360;
  if (r === 90) f.push('transpose=1');
  else if (r === 180) f.push('transpose=1,transpose=1');
  else if (r === 270) f.push('transpose=2');
  if (seg.flipH) f.push('hflip');
  if (seg.flipV) f.push('vflip');
  return f;
}
function presetVideoArgs(preset, w, h, fps, quality) {
  const factor = quality === 'low' ? 0.06 : quality === 'medium' ? 0.1 : 0.16;
  switch (preset) {
    case 'prores': return { ext: '.mov', chains: [['-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le']], audio: ['-c:a', 'pcm_s16le'] };
    case 'small': return { ext: '.mp4', chains: h264Chains(guessBitrateK(w, h, fps, 0.05)), audio: ['-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'] };
    case 'webm': return { ext: '.webm', chains: [['-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-b:v', guessBitrateK(w, h, fps, factor) + 'k', '-pix_fmt', 'yuv420p']], audio: ['-c:a', 'libopus', '-b:a', '160k'] };
    default: return { ext: '.mp4', chains: h264Chains(guessBitrateK(w, h, fps, factor)), audio: ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'] };
  }
}

ipcMain.handle('export', async (e, job) => {
  const { id, segments, output, preset, width, height, fps, quality } = job;
  const send = (pct) => { if (win) win.webContents.send('job-progress', { id, pct }); };
  const total = segments.reduce((s, g) => s + (g.end - g.start), 0);
  const prog = progressParser(total, send);

  if (preset === 'frame') {
    const g = segments[0];
    const ok = await grabFrame(g.path, g.start, output, transformFilters(g));
    return { ok, path: output };
  }
  if (preset === 'same') {
    if (segments.length !== 1) return { ok: false, error: '"Same as source" works with one clip only. Choose another preset for a sequence.' };
    const g = segments[0];
    const r = await run(FFMPEG(), ['-v', 'error', '-stats', '-nostdin', '-y', '-ss', String(g.start), '-to', String(g.end), '-i', g.path, '-map', '0', '-c', 'copy', ...(g.mute ? ['-an'] : []), output], { collect: false, id, onStderr: prog });
    return r.killed ? { ok: false, cancelled: true } : { ok: r.code === 0, path: output, error: r.stderr.slice(-400) };
  }

  // Build inputs + filter graph (trim, transform, scale, concat)
  const W = width % 2 ? width + 1 : width, H = height % 2 ? height + 1 : height;
  const inputs = []; const parts = []; let n = 0;
  const audioOnly = preset === 'audio';
  const gif = preset === 'gif';
  const seq = preset === 'png';
  segments.forEach((g, i) => {
    inputs.push('-ss', String(g.start), '-t', String(Math.max(0.01, g.end - g.start)), '-i', g.path);
    const d = (g.end - g.start).toFixed(4);
    if (!audioOnly) {
      const tf = transformFilters(g);
      parts.push(`[${i}:v:0]${tf.length ? tf.join(',') + ',' : ''}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`);
    }
    if (!gif && !seq) {
      if (g.hasAudio && !g.mute) parts.push(`[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=whole_dur=${d}[a${i}]`);
      else parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${d}[a${i}]`);
    }
    n++;
  });
  let concat = '';
  if (audioOnly) concat = segments.map((g, i) => `[a${i}]`).join('') + `concat=n=${n}:v=0:a=1[ao]`;
  else if (gif || seq) concat = segments.map((g, i) => `[v${i}]`).join('') + `concat=n=${n}:v=1:a=0[vo]`;
  else concat = segments.map((g, i) => `[v${i}][a${i}]`).join('') + `concat=n=${n}:v=1:a=1[vo][ao]`;
  let graph = parts.concat([concat]).join(';');

  let attempts;
  if (audioOnly) attempts = [['-map', '[ao]', '-c:a', 'aac', '-b:a', '256k']];
  else if (gif) {
    graph += `;[vo]fps=${Math.min(fps, 15)},scale=${Math.min(W, 640)}:-2:flags=lanczos,split[g1][g2];[g1]palettegen[p];[g2][p]paletteuse[go]`;
    attempts = [['-map', '[go]', '-loop', '0']];
  } else if (seq) attempts = [['-map', '[vo]', '-c:v', 'png']];
  else {
    const pv = presetVideoArgs(preset, W, H, fps, quality);
    attempts = pv.chains.map((c) => ['-map', '[vo]', '-map', '[ao]', ...c, ...pv.audio]);
  }
  let outPath = output;
  if (seq) { fs.mkdirSync(output, { recursive: true }); outPath = path.join(output, 'frame_%06d.png'); }
  let last = '';
  for (const a of attempts) {
    const args = ['-v', 'error', '-stats', '-nostdin', '-y', ...inputs, '-filter_complex', graph, ...a, outPath];
    const r = await run(FFMPEG(), args, { collect: false, id, onStderr: prog });
    if (r.killed) return { ok: false, cancelled: true };
    if (r.code === 0) return { ok: true, path: output };
    last = r.stderr.slice(-600);
  }
  return { ok: false, error: last };
});

// ---------- dialogs & shell ----------
const VIDEO_FILTER = { name: 'Video and audio', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'mpg', 'mpeg', 'mts', 'm2ts', 'ts', 'mxf', '3gp', 'flv', 'ogv', 'gif', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] };
ipcMain.handle('open-dialog', async (e, { multi = true, title } = {}) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Open', properties: multi ? ['openFile', 'multiSelections'] : ['openFile'], filters: [VIDEO_FILTER, { name: 'All files', extensions: ['*'] }] });
  return r.canceled ? [] : r.filePaths.map(fileInfo);
});
ipcMain.handle('save-dialog', async (e, { title, defaultPath, filters, folder }) => {
  if (folder) {
    const r = await dialog.showOpenDialog(win, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  }
  const r = await dialog.showSaveDialog(win, { title, defaultPath, filters });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('default-dir', () => { try { return app.getPath('videos'); } catch (e) { return app.getPath('home'); } });
ipcMain.handle('show-in-folder', (e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('open-default-apps', () => { shell.openExternal('ms-settings:defaultapps'); return true; });

ipcMain.handle('fit-window', (e, { w, h, extraH }) => {
  if (!win || win.isMaximized() || win.isFullScreen()) return false;
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const maxW = Math.floor(area.width * 0.85), maxH = Math.floor(area.height * 0.85) - extraH;
  let s = Math.min(1, maxW / w, maxH / h);
  let cw = Math.max(640, Math.round(w * s)), ch = Math.max(420, Math.round(h * s) + extraH);
  win.setContentSize(cw, ch);
  const b = win.getBounds();
  win.setPosition(Math.round(area.x + (area.width - b.width) / 2), Math.round(area.y + (area.height - b.height) / 2));
  return true;
});
ipcMain.handle('toggle-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); return win ? win.isFullScreen() : false; });
ipcMain.handle('set-fullscreen', (e, on) => { if (win) win.setFullScreen(!!on); return true; });
ipcMain.handle('set-on-top', (e, on) => { if (win) win.setAlwaysOnTop(!!on); return true; });
ipcMain.handle('set-title', (e, t) => { if (win) win.setTitle(t); return true; });
ipcMain.handle('window-cmd', (e, cmd) => { if (!win) return; if (cmd === 'close') win.close(); else if (cmd === 'minimize') win.minimize(); return true; });

'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('cp', {
  isApp: true,
  platform: process.platform,
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } },
  initialFiles: () => inv('initial-files'),
  fileInfo: (p) => inv('file-info', p),
  version: () => inv('app-version'),
  probe: (p) => inv('probe', p),
  audioPcm: (p, d) => inv('audio-pcm', p, d),
  convert: (o) => inv('convert', o),
  exportJob: (o) => inv('export', o),
  cancelJob: (id) => inv('cancel-job', id),
  convertedSize: () => inv('converted-size'),
  clearConverted: () => inv('clear-converted'),
  saveFrame: (o) => inv('save-frame', o),
  copyFrame: (o) => inv('copy-frame', o),
  openDialog: (o) => inv('open-dialog', o),
  saveDialog: (o) => inv('save-dialog', o),
  defaultDir: () => inv('default-dir'),
  showInFolder: (p) => inv('show-in-folder', p),
  openDefaultApps: () => inv('open-default-apps'),
  fitWindow: (o) => inv('fit-window', o),
  toggleFullscreen: () => inv('toggle-fullscreen'),
  setFullscreen: (on) => inv('set-fullscreen', on),
  setOnTop: (on) => inv('set-on-top', on),
  setTitle: (t) => inv('set-title', t),
  windowCmd: (c) => inv('window-cmd', c),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (e, f) => cb(f)),
  onJobProgress: (cb) => ipcRenderer.on('job-progress', (e, p) => cb(p)),
  onFullscreen: (cb) => ipcRenderer.on('fullscreen', (e, v) => cb(v)),
});

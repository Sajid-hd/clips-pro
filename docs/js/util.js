'use strict';
/* Shared helpers, settings and app state */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const API = window.cp || null; // null when running in a plain browser
let _uid = 1;
const uid = () => 'id' + (_uid++);

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

const ICONS = {
  start: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="2" height="14"/><polygon points="19,5 9,12 19,19"/></svg>',
  end: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,5 15,12 5,19"/><rect x="17" y="5" width="2" height="14"/></svg>',
  prev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
  rev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="18,5 6,12 18,19"/></svg>',
  play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="7,4 20,12 7,20"/></svg>',
  pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  loop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 3l3 3-3 3"/><path d="M4 12V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/></svg>',
  once: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h14"/><path d="M14 7l5 5-5 5"/><path d="M21 5v14"/></svg>',
  pingpong: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9h16"/><path d="M16 5l4 4-4 4"/><path d="M20 15H4"/><path d="M8 11l-4 4 4 4"/></svg>',
  vol: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  mute: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  spk: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>',
  close: '<svg width="12" height="12" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg>',
};

// ---------- settings (persisted per app) ----------
const DEFAULT_SETTINGS = {
  dropMode: 'ask',            // ask | sequence | stack | layout | tile
  dropAdd: false,             // add dropped files to the session instead of replacing
  openWithAdds: false,        // double-clicked files add to the session
  allFrames: true, audioScrub: true, loopMode: 'loop', stepWraps: true,
  display: 'source', showInfo: true, showCache: true, showControls: true, timelineTop: false,
  resizeToVideo: true, autoConvert: false, volume: 1, muted: false,
  keys: null, keyPreset: 'clipspro', firstRunDone: false,
  exportPreset: 'h264', exportQuality: 'high', exportRes: 'source', exportDir: '', exportHow: '',
  cutSens: 'medium', cutGradual: true, cutMarks: false, cutMin: 0.4,
};
const Settings = (() => {
  let s = { ...DEFAULT_SETTINGS };
  try { Object.assign(s, JSON.parse(localStorage.getItem('cp.settings') || '{}')); } catch (e) {}
  return {
    get: (k) => s[k],
    set(k, v) { s[k] = v; try { localStorage.setItem('cp.settings', JSON.stringify(s)); } catch (e) {} },
    all: () => s,
  };
})();
const Recent = {
  list() { try { return JSON.parse(localStorage.getItem('cp.recent') || '[]'); } catch (e) { return []; } },
  add(p) { if (!p || !API) return; const l = this.list().filter((x) => x !== p); l.unshift(p); try { localStorage.setItem('cp.recent', JSON.stringify(l.slice(0, 12))); } catch (e) {} },
  clear() { try { localStorage.removeItem('cp.recent'); } catch (e) {} },
};

// ---------- the session state ----------
const S = {
  clips: [],            // in sequence order
  mode: 'sequence',     // sequence | stack | layout | tile
  stackOrder: [],       // clip ids, top first
  audioClip: null,      // clip id whose audio plays in stack/layout/tile
  cur: null,            // selected clip id (stack/layout/tile)
  frame: 0,             // global frame (0-based)
  playing: false, dir: 1, speed: 1,
  loopMode: Settings.get('loopMode'),
  inF: null, outF: null, marks: new Set(),
  ranges: [], selRange: null,  // numbered In/Out ranges 1, 2, 3 … ; selRange is the one In/Out shows
  allFrames: Settings.get('allFrames'), audioScrub: Settings.get('audioScrub'),
  display: Settings.get('display'),
  combine: 'over', wipes: true, wipeX: 0.5,
  view: { z: 1, px: 0, py: 0, flipX: false, flipY: false },
  volume: Settings.get('volume'), muted: Settings.get('muted'),
  measuredFps: 0, dropped: 0, rateFactor: 1,
};

// ---------- formatting ----------
// Time to ask ffmpeg for so it returns exactly source frame f (it keeps frames whose time is >= this)
const frameSec = (f, fps) => Math.max(0, (f - 0.02) / (fps || 24));
function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function fmtDur(sec) {
  if (!isFinite(sec)) return '--:--';
  sec = Math.max(0, sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
function fmtTC(frame, fps) {
  const nf = Math.round(fps) || 24; const f = Math.max(0, Math.round(frame));
  const ff = f % nf, ts = Math.floor(f / nf);
  return `${pad(Math.floor(ts / 3600))}:${pad(Math.floor(ts / 60) % 60)}:${pad(ts % 60)}:${pad(ff)}`;
}
function fmtBytes(b) { if (!b) return '0 MB'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i > 1 ? 1 : 0) + ' ' + u[i]; }
function fmtFps(f) { return (Math.round(f * 1000) / 1000).toString(); }

// Save a blob (web version): native "Save as" when available, otherwise a download
async function saveBlob(blob, name, desc, mime, ext) {
  if (window.showSaveFilePicker) {
    try {
      const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: [ext] } }] });
      const w = await h.createWritable(); await w.write(blob); await w.close();
      return true;
    } catch (e) { if (e && e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return true;
}

let toastT = 0;
// set a button's icon only when it changes: replacing it while the mouse is pressed cancels the click
function setIcon(b, html) { if (b._icon !== html) { b._icon = html; b.innerHTML = html; } }
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

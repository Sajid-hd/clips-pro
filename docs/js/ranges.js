'use strict';
/* Numbered In/Out ranges (1, 2, 3 …), the Ranges panel, cut lists and cut detection */
const Ranges = (() => {
  let rid = 1;
  const changed = () => { if (typeof App !== 'undefined') App.dirty = true; };
  const get = (id) => S.ranges.find((r) => r.id === id) || null;
  const sel = () => get(S.selRange);
  const num = (r) => S.ranges.indexOf(r) + 1;
  const label = (r) => r.name || String(num(r));
  const fileLabel = (r) => (r.name ? r.name.replace(/[\\/:*?"<>|]+/g, '_').trim() : '') || pad(num(r), 2);

  // keep the selected range and the In / Out the player loops in step
  function sync() {
    const r = sel();
    if (!r) { if (S.selRange) S.selRange = null; return; }
    if (S.inF == null || S.outF == null) { S.selRange = null; return; }
    r.a = Math.min(S.inF, S.outF); r.b = Math.max(S.inF, S.outF);
  }
  function select(id) {
    const r = get(id); if (!r) { deselect(); return; }
    S.selRange = id; S.inF = r.a; S.outF = r.b; changed();
  }
  function deselect() { S.selRange = null; S.inF = S.outF = null; changed(); }
  function add(a, b, opt = {}) {
    if (b < a) [a, b] = [b, a];
    const T = Player.total(); a = clamp(a, 0, Math.max(0, T - 1)); b = clamp(b, a, Math.max(0, T - 1));
    if (!opt.noCommit) Player.commit();
    const r = { id: 'r' + (rid++), a, b, name: opt.name || '', on: true, kind: opt.kind || '' };
    let i = S.ranges.findIndex((x) => x.a > a); if (i < 0) i = S.ranges.length;
    S.ranges.splice(i, 0, r);
    if (opt.select !== false) select(r.id);
    changed();
    return r;
  }
  function remove(id) {
    const r = get(id); if (!r) return;
    Player.commit();
    S.ranges.splice(S.ranges.indexOf(r), 1);
    if (S.selRange === id) deselect();
    toast(`Range ${r.name || ''} removed`.replace('  ', ' ')); changed();
  }
  function clearAll() {
    if (!S.ranges.length && S.inF == null && S.outF == null) return;
    Player.commit();
    S.ranges = []; S.selRange = null; S.inF = S.outF = null;
    toast('All ranges cleared'); changed();
  }
  function clearSelection() {
    const r = sel();
    if (r) { remove(r.id); return; }
    if (S.inF != null || S.outF != null) { Player.commit(); S.inF = S.outF = null; toast('Selection cleared'); changed(); }
  }
  // ---------- editing cuts ----------
  // the cut at frame f: the In of one range that starts right where another ends
  function cutAt(f) {
    const r2 = S.ranges.find((q) => q.a === f), r1 = r2 && S.ranges.find((q) => q !== r2 && q.b === f - 1);
    return r1 && r2 ? { r1, r2 } : null;
  }
  function dropMarksNear(f, d = 1) { let n = 0; for (const m of [...S.marks]) if (Math.abs(m - f) <= d) { S.marks.delete(m); n++; } return n; }
  function deleteMark(f) {
    if (!dropMarksNearCheck(f)) return;
    Player.commit(); dropMarksNear(f, 0); toast('Mark deleted'); changed();
  }
  const dropMarksNearCheck = (f) => S.marks.has(f);
  // a false cut: join the two shots into one range and take its mark away too
  function removeCut(f) {
    const c = cutAt(f);
    if (!c) { if (S.marks.has(f)) { deleteMark(f); } return; }
    Player.commit();
    const { r1, r2 } = c;
    r1.b = Math.max(r1.b, r2.b);
    if (!r1.name && r2.name) r1.name = r2.name;
    S.ranges.splice(S.ranges.indexOf(r2), 1);
    dropMarksNear(f);
    if (S.selRange === r2.id || S.selRange === r1.id) select(r1.id);
    multi.delete(r2.id);
    toast(`Cut removed — shots joined into range ${label(r1)}`); changed();
  }
  // a missed cut: split the range under frame f
  function addCut(f) {
    const r = S.ranges.filter((q) => f > q.a && f <= q.b).sort((p, q) => (p.b - p.a) - (q.b - q.a))[0];
    if (!r) { Player.commit(); S.marks.add(f); toast('Mark added'); changed(); return; }
    Player.commit();
    const n = { id: 'r' + (rid++), a: f, b: r.b, name: '', on: r.on, kind: 'cut' };
    r.b = f - 1;
    S.ranges.splice(S.ranges.indexOf(r) + 1, 0, n);
    if (S.marks.size) S.marks.add(f);
    if (S.selRange === r.id) select(r.id);
    toast(`Cut added — range ${label(r)} split in two`); changed();
  }
  // join several ranges into one (from the first In to the last Out)
  function merge(ids) {
    const list = S.ranges.filter((r) => ids.includes(r.id));
    if (list.length < 2) return;
    Player.commit();
    const first = list[0];
    first.a = Math.min(...list.map((r) => r.a)); first.b = Math.max(...list.map((r) => r.b));
    if (!first.name) first.name = (list.find((r) => r.name) || {}).name || '';
    for (const r of list.slice(1)) { S.ranges.splice(S.ranges.indexOf(r), 1); for (const m of [...S.marks]) if (m > first.a && m <= first.b) S.marks.delete(m); }
    multi.clear(); select(first.id);
    toast(`${list.length} ranges merged into range ${label(first)}`); changed();
  }
  function removeMany(ids) {
    Player.commit();
    S.ranges = S.ranges.filter((r) => !ids.includes(r.id));
    if (ids.includes(S.selRange)) deselect();
    multi.clear(); toast(`${ids.length} ranges cleared`); changed();
  }
  const multi = new Set(); let anchor = null;
  function rename(id, name) { const r = get(id); if (!r) return; Player.commit(); r.name = String(name || '').trim().slice(0, 60); changed(); }
  function move(id, d) {
    const r = get(id); if (!r) return; const i = S.ranges.indexOf(r), j = i + d;
    if (j < 0 || j >= S.ranges.length) return;
    Player.commit(); S.ranges.splice(i, 1); S.ranges.splice(j, 0, r); changed();
  }
  function renumber() { Player.commit(); S.ranges.sort((x, y) => x.a - y.a || x.b - y.b); changed(); toast('Numbered in timeline order'); }

  // [ : inside the selected range it moves that range's In; anywhere else it starts a new range
  function markIn(g = S.frame) {
    const r = sel();
    if (r && g >= r.a && g <= r.b) { Player.commit(); r.a = g; S.inF = g; changed(); return; }
    S.selRange = null; S.inF = g; S.outF = null; changed();
  }
  // ] : inside the selected range it moves that range's Out; after an In it makes the next numbered range
  function markOut(g = S.frame) {
    const r = sel();
    if (r && g >= r.a && g <= r.b) { Player.commit(); r.b = g; S.outF = g; changed(); return; }
    if (!r && S.inF != null) { add(S.inF, g); toast(`Range ${label(sel())} added`); return; }
    let a = 0; for (const x of S.ranges) if (x.b < g && x.b + 1 > a) a = x.b + 1;
    if (r && r.b < g) a = Math.max(a, r.b + 1);
    add(a, g); toast(`Range ${label(sel())} added`);
  }

  // ---------- frames → pieces of source clips ----------
  function pieces(a, b) {
    const out = [];
    if (S.mode === 'sequence') {
      const st = Player.starts();
      S.clips.forEach((c, i) => {
        const s = st[i], e = s + Player.len(c) - 1;
        if (e < a || s > b) return;
        const g0 = Math.max(a, s);
        out.push({ clip: c, l0: c.tin + (g0 - s), l1: c.tout - Math.max(0, e - b), g0 });
      });
    } else {
      const c = Player.curClip(); if (c) out.push({ clip: c, l0: c.tin + Math.min(a, Player.len(c) - 1), l1: Math.min(c.tout, c.tin + b), g0: a });
    }
    return out;
  }
  const exportable = () => S.ranges.filter((r) => r.on !== false);

  // ---------- cut lists ----------
  const tc = (f) => fmtTC(f, Player.fps());
  const baseName = () => ((Player.curClip() && Player.curClip().media.name) || 'clips').replace(/\.[^.]+$/, '');
  async function saveText(text, name, desc, ext) {
    const bytes = new TextEncoder().encode(text);
    if (!API) { await saveBlob(new Blob([bytes], { type: 'text/plain' }), name + ext, desc, 'text/plain', ext); return; }
    const dir = Settings.get('exportDir') || await API.defaultDir();
    const sep = API.platform === 'win32' ? '\\' : '/';
    const p = await API.saveDialog({ title: 'Save ' + desc, defaultPath: dir.replace(/[\\/]+$/, '') + sep + name + ext, filters: [{ name: desc, extensions: [ext.slice(1)] }] });
    if (!p) return;
    await API.writeFile(p, bytes); toast('Saved ' + p.split(/[\\/]/).pop());
  }
  function csv() {
    const f = Player.fps(); const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const rows = [['Range', 'Name', 'In (timecode)', 'Out (timecode)', 'In frame', 'Out frame', 'Duration (frames)', 'Duration (seconds)', 'Detected as', 'Source file', 'Source In frame', 'Source Out frame'].join(',')];
    for (const r of S.ranges) {
      const p = pieces(r.a, r.b);
      const src = p.map((x) => x.clip.media.name).filter((v, i, a) => a.indexOf(v) === i).join(' + ');
      rows.push([num(r), q(r.name), tc(r.a), tc(r.b + 1), r.a + 1, r.b + 1, r.b - r.a + 1, ((r.b - r.a + 1) / f).toFixed(3), r.kind || 'manual', q(src), p.length ? p[0].l0 + 1 : '', p.length ? p[p.length - 1].l1 + 1 : ''].join(','));
    }
    return rows.join('\r\n') + '\r\n';
  }
  function edl() {
    const f = Player.fps(); const nf = Math.round(f) || 24;
    const L = [`TITLE: ${baseName()}`, 'FCM: NON-DROP FRAME', ''];
    let ev = 1, rec = nf * 3600; // record starts at 01:00:00:00
    for (const r of exportable()) {
      for (const p of pieces(r.a, r.b)) {
        const d = p.l1 - p.l0 + 1;
        const line = `${pad(ev, 3)}  AX       AA/V  C        ${fmtTC(p.l0, f)} ${fmtTC(p.l1 + 1, f)} ${fmtTC(rec, f)} ${fmtTC(rec + d, f)}`;
        L.push(line, `* FROM CLIP NAME: ${p.clip.media.name}`, `* COMMENT: RANGE ${label(r)}`, '');
        ev++; rec += d;
      }
    }
    return L.join('\r\n');
  }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pathUrl(p) {
    if (!p) return '';
    const s = p.replace(/\\/g, '/');
    const enc = s.split('/').map((x, i) => (i === 0 && /^[A-Za-z]:$/.test(x) ? x : encodeURIComponent(x))).join('/');
    return 'file://localhost/' + enc.replace(/^\/+/, '');
  }
  function xml() {
    const f = Player.fps(); const tb = Math.round(f) || 24; const ntsc = Math.abs(f - tb) > 0.01 ? 'TRUE' : 'FALSE';
    const rate = `<rate><timebase>${tb}</timebase><ntsc>${ntsc}</ntsc></rate>`;
    const files = new Map(); let fid = 1;
    const fileXml = (m) => {
      if (files.has(m)) return `<file id="file-${files.get(m)}"/>`;
      files.set(m, fid++);
      return `<file id="file-${files.get(m)}"><name>${xmlEsc(m.name)}</name><pathurl>${xmlEsc(pathUrl(m.path))}</pathurl>${rate}<duration>${m.frames || 0}</duration><media><video><samplecharacteristics><width>${m.w || 1920}</width><height>${m.h || 1080}</height></samplecharacteristics></video>${m.hasAudio ? '<audio><channelcount>2</channelcount></audio>' : ''}</media></file>`;
    };
    const vItems = [], aItems = []; let pos = 0, n = 1;
    for (const r of exportable()) {
      for (const p of pieces(r.a, r.b)) {
        const d = p.l1 - p.l0 + 1; const m = p.clip.media;
        const common = `<name>${xmlEsc(r.name || m.name)}</name><duration>${m.frames || d}</duration>${rate}<start>${pos}</start><end>${pos + d}</end><in>${p.l0}</in><out>${p.l1 + 1}</out>`;
        vItems.push(`<clipitem id="clipitem-v${n}">${common}${fileXml(m)}<labels><label2>Range ${xmlEsc(label(r))}</label2></labels></clipitem>`);
        if (m.hasAudio && !p.clip.mute) aItems.push(`<clipitem id="clipitem-a${n}">${common}<file id="file-${files.get(m)}"/><sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack></clipitem>`);
        pos += d; n++;
      }
    }
    const m0 = (Player.curClip() || {}).media || {};
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5">\n<sequence id="sequence-1"><name>${xmlEsc(baseName())} ranges</name><duration>${pos}</duration>${rate}<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>\n<media>\n<video><format><samplecharacteristics>${rate}<width>${m0.w || 1920}</width><height>${m0.h || 1080}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>\n<track>\n${vItems.join('\n')}\n</track></video>\n<audio><track>\n${aItems.join('\n')}\n</track></audio>\n</media>\n</sequence>\n</xmeml>\n`;
  }
  async function exportList(kind) {
    if (!S.ranges.length) { toast('No ranges yet: set [ and ] or use Detect cuts'); return; }
    const b = baseName();
    if (kind === 'csv') await saveText(csv(), b + '_cuts', 'Cut list (CSV)', '.csv');
    else if (kind === 'txt') await saveText(S.ranges.map((r) => `${pad(num(r), 3)}  ${tc(r.a)} - ${tc(r.b + 1)}  ${r.b - r.a + 1} frames${r.name ? '  ' + r.name : ''}`).join('\r\n') + '\r\n', b + '_cuts', 'Cut list (text)', '.txt');
    else if (kind === 'edl') await saveText(edl(), b + '_ranges', 'EDL for Resolve / Premiere', '.edl');
    else if (kind === 'xml') await saveText(xml(), b + '_ranges', 'XML for Premiere / Resolve', '.xml');
    else if (kind === 'sheet') await contactSheet();
  }

  // ---------- contact sheet: one picture per range ----------
  async function contactSheet() {
    if (!API) { toast('The contact sheet needs the installed app'); return; }
    const list = exportable(); if (!list.length) { toast('No ranges to put on a sheet'); return; }
    const dir = Settings.get('exportDir') || await API.defaultDir();
    const sep = API.platform === 'win32' ? '\\' : '/';
    const p = await API.saveDialog({ title: 'Save contact sheet', defaultPath: dir.replace(/[\\/]+$/, '') + sep + baseName() + '_contact.png', filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (!p) return;
    const COLS = 5, TW = 320, PER = 60;
    const m0 = list.length && pieces(list[0].a, list[0].a)[0];
    const ar = m0 && m0.clip.media.w ? m0.clip.media.h / m0.clip.media.w : 9 / 16;
    const TH = Math.round(TW * ar), LAB = 26, GAP = 10, HEAD = 44;
    const pages = Math.ceil(list.length / PER);
    toast('Making contact sheet…', 60000);
    for (let pg = 0; pg < pages; pg++) {
      const part = list.slice(pg * PER, pg * PER + PER);
      const rows = Math.ceil(part.length / COLS);
      const cv = document.createElement('canvas'); cv.width = GAP + COLS * (TW + GAP); cv.height = HEAD + rows * (TH + LAB + GAP) + GAP;
      const g = cv.getContext('2d'); g.fillStyle = '#111214'; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = '#fff'; g.font = 'bold 18px "Segoe UI", sans-serif'; g.textBaseline = 'middle';
      g.fillText(`${baseName()} — ${list.length} ranges${pages > 1 ? ` (page ${pg + 1} of ${pages})` : ''}`, GAP + 4, HEAD / 2);
      let k = 0;
      const jobs = part.map((r, i) => async () => {
        const pc = pieces(r.a, r.b)[0]; if (!pc) return;
        const x = GAP + (i % COLS) * (TW + GAP), y = HEAD + Math.floor(i / COLS) * (TH + LAB + GAP);
        g.fillStyle = '#000'; g.fillRect(x, y, TW, TH);
        try {
          const res = await API.thumb({ path: pc.clip.media.path, sec: frameSec(pc.l0 + Math.min(2, pc.l1 - pc.l0), pc.clip.media.fps), w: TW * 2 });
          if (res && res.ok) { const bm = await createImageBitmap(new Blob([res.data], { type: 'image/png' })); const s = Math.min(TW / bm.width, TH / bm.height); const w = bm.width * s, h = bm.height * s; g.drawImage(bm, x + (TW - w) / 2, y + (TH - h) / 2, w, h); }
        } catch (e) {}
        g.fillStyle = '#3d8bfd'; g.fillRect(x, y + TH, 34, LAB);
        g.fillStyle = '#fff'; g.font = 'bold 13px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.fillText(String(label(r)).slice(0, 4), x + 17, y + TH + LAB / 2);
        g.textAlign = 'left'; g.fillStyle = '#e6e7ea'; g.font = '12px Consolas, monospace';
        g.fillText(`${tc(r.a)}  ${((r.b - r.a + 1) / Player.fps()).toFixed(1)}s${r.name ? '  ' + r.name : ''}`.slice(0, 40), x + 42, y + TH + LAB / 2);
        k++;
      });
      const queue = jobs.slice(); const workers = [];
      for (let w = 0; w < 4; w++) workers.push((async () => { while (queue.length) await queue.shift()(); })());
      await Promise.all(workers);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
      const out = pages > 1 ? p.replace(/(\.png)?$/i, `_${pad(pg + 1, 2)}.png`) : p;
      await API.writeFile(out, new Uint8Array(await blob.arrayBuffer()));
    }
    toast(pages > 1 ? `Saved ${pages} contact sheets` : 'Contact sheet saved');
  }

  // ---------- panel ----------
  const panel = el('aside', { id: 'ranges', hidden: true });
  $('#main').append(panel);
  let sig = '';
  function build() {}
  function isOpen() { return !panel.hidden; }
  function toggle(on = panel.hidden) { panel.hidden = !on; sig = ''; render(); requestAnimationFrame(() => Player.layout()); changed(); }
  function rowMenu(r, x, y) {
    const i = S.ranges.indexOf(r);
    Menu.open([
      { header: `Range ${label(r)} · ${tc(r.a)} – ${tc(r.b + 1)}` },
      { label: S.selRange === r.id ? 'Deselect' : 'Select (loop it)', action: () => (S.selRange === r.id ? deselect() : select(r.id)) },
      { label: 'Go to In', action: () => Player.goto(r.a) }, { label: 'Go to Out', action: () => Player.goto(r.b) },
      { label: 'Play this range', action: () => { select(r.id); Player.goto(r.a); Player.play(1); } },
      { sep: true },
      { label: 'Rename…', action: () => startRename(r) },
      { label: 'Include in export', checked: () => r.on !== false, action: () => { r.on = r.on === false; changed(); } },
      { label: `Join with range ${i > 0 ? label(S.ranges[i - 1]) : ''} before (remove the cut)`, disabled: !cutAt(r.a), action: () => removeCut(r.a) },
      { label: `Join with range ${i < S.ranges.length - 1 ? label(S.ranges[i + 1]) : ''} after`, disabled: !(S.ranges[i + 1] && cutAt(S.ranges[i + 1].a) && cutAt(S.ranges[i + 1].a).r1 === r), action: () => removeCut(S.ranges[i + 1].a) },
      { label: 'Move up (lower number)', disabled: i === 0, action: () => move(r.id, -1) },
      { label: 'Move down (higher number)', disabled: i === S.ranges.length - 1, action: () => move(r.id, 1) },
      { sep: true },
      { label: 'Clear this range', kb: 'Del', action: () => remove(r.id) },
      { label: 'Clear all ranges', key: 'clearRanges', action: () => clearAll() },
    ], x, y);
  }
  function groupMenu(x, y) {
    const ids = S.ranges.filter((r) => multi.has(r.id)).map((r) => r.id);
    const names = ids.map((id) => label(get(id))).join(', ');
    Menu.open([
      { header: `${ids.length} ranges: ${names.length > 40 ? names.slice(0, 40) + '…' : names}` },
      { label: `Merge into one range`, action: () => merge(ids) },
      { label: 'Include in export', action: () => { ids.forEach((id) => { get(id).on = true; }); changed(); render(true); } },
      { label: 'Leave out of export', action: () => { ids.forEach((id) => { get(id).on = false; }); changed(); render(true); } },
      { sep: true },
      { label: `Clear these ${ids.length} ranges`, kb: 'Del', action: () => removeMany(ids) },
      { label: 'Select none', action: () => { multi.clear(); render(true); } },
    ], x, y);
  }
  function startRename(r) {
    if (panel.hidden) toggle(true);
    render(true);
    const inp = panel.querySelector(`[data-rid="${r.id}"] .rg-name`);
    if (inp) { inp.readOnly = false; inp.focus(); inp.select(); }
  }
  function listMenu(x, y) {
    Menu.open([
      { header: 'Export cut list' },
      { label: 'Cut list (CSV for Excel)…', action: () => exportList('csv') },
      { label: 'Cut list (text)…', action: () => exportList('txt') },
      { label: 'EDL for DaVinci Resolve / Premiere…', action: () => exportList('edl') },
      { label: 'XML for Premiere / Resolve…', action: () => exportList('xml') },
      { label: 'Contact sheet (PNG)…', disabled: !API, action: () => exportList('sheet') },
      { sep: true },
      { label: 'Number in timeline order', disabled: S.ranges.length < 2, action: () => renumber() },
      { label: 'Include all in export', action: () => { S.ranges.forEach((r) => { r.on = true; }); changed(); } },
      { label: 'Clear all ranges', key: 'clearRanges', disabled: !S.ranges.length, action: () => clearAll() },
    ], x, y);
  }
  let dragId = null;
  function render(force) {
    if (panel.hidden) return;
    const s = S.ranges.map((r) => r.id + r.a + '-' + r.b + r.name + r.on).join('|') + [...multi].join() + S.selRange + S.display + (S.inF != null && !S.selRange ? 'p' + S.inF : '');
    if (!force && s === sig) return; sig = s;
    panel.innerHTML = '';
    const head = el('div', { class: 'panel-head' }, el('h2', {}, 'Ranges'), el('span', { class: 'muted' }, S.ranges.length ? String(S.ranges.length) : ''),
      el('button', { class: 'xbtn', title: 'Close', 'aria-label': 'Close ranges panel', html: ICONS.close, onclick: () => toggle(false) }));
    const list = el('div', { class: 'rg-list', role: 'list' });
    const f = Player.fps();
    S.ranges.forEach((r) => {
      const ck = el('input', { type: 'checkbox', title: 'Include in export', 'aria-label': 'Include range ' + label(r) + ' in export' }); ck.checked = r.on !== false;
      ck.addEventListener('click', (e) => e.stopPropagation());
      ck.addEventListener('change', () => { r.on = ck.checked; changed(); });
      const nm = el('input', { class: 'rg-name', value: r.name, placeholder: 'Range ' + num(r), readonly: true, spellcheck: 'false' });
      nm.addEventListener('dblclick', (e) => { e.stopPropagation(); nm.readOnly = false; nm.focus(); nm.select(); });
      nm.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') nm.blur(); if (e.key === 'Escape') { nm.value = r.name; nm.blur(); } });
      nm.addEventListener('blur', () => { if (!nm.readOnly) { nm.readOnly = true; if (nm.value.trim() !== r.name) rename(r.id, nm.value); } });
      const row = el('div', { class: 'rg-row' + (S.selRange === r.id ? ' on' : '') + (r.on === false ? ' off' : ''), role: 'listitem', draggable: 'true', 'data-rid': r.id, title: 'Click to select · Ctrl/Shift+click to pick several (then right-click > Merge) · double-click the name to rename · drag to change the number · right-click for more' },
        ck, el('span', { class: 'rg-num' }, String(num(r))),
        el('div', { class: 'rg-mid' }, nm, el('span', { class: 'rg-tc mono' }, `${Player.frameText(r.a)} – ${Player.frameText(r.b)}`)),
        el('span', { class: 'rg-dur mono' }, ((r.b - r.a + 1) / f).toFixed(2) + 's'),
        r.kind === 'dissolve' ? el('span', { class: 'rg-kind', title: 'Starts with a dissolve or fade' }, 'fade') : null);
      if (multi.has(r.id)) row.classList.add('multi');
      row.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          if (!multi.size && S.selRange && S.selRange !== r.id) multi.add(S.selRange);
          if (multi.has(r.id)) multi.delete(r.id); else multi.add(r.id);
          anchor = r.id; render(true); return;
        }
        if (e.shiftKey && (anchor || S.selRange)) {
          const i0 = S.ranges.indexOf(get(anchor || S.selRange)), i1 = S.ranges.indexOf(r);
          multi.clear(); for (let k = Math.min(i0, i1); k <= Math.max(i0, i1); k++) multi.add(S.ranges[k].id);
          render(true); return;
        }
        multi.clear(); anchor = r.id;
        if (S.selRange === r.id) Player.goto(r.a); else { select(r.id); Player.goto(r.a); }
        render(true);
      });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); if (multi.size > 1 && multi.has(r.id)) groupMenu(e.clientX, e.clientY); else { multi.clear(); rowMenu(r, e.clientX, e.clientY); } });
      row.addEventListener('dragstart', (e) => { dragId = r.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.id); });
      row.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); row.classList.add('drag-over'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => { if (!dragId) return; e.preventDefault(); e.stopPropagation(); row.classList.remove('drag-over'); const from = S.ranges.indexOf(get(dragId)), to = S.ranges.indexOf(r); dragId = null; if (from >= 0 && to >= 0 && from !== to) { Player.commit(); const [x] = S.ranges.splice(from, 1); S.ranges.splice(to, 0, x); changed(); } });
      row.addEventListener('dragend', () => { dragId = null; });
      list.append(row);
    });
    if (S.inF != null && !S.selRange) list.append(el('div', { class: 'rg-row pending' }, el('span'), el('span', { class: 'rg-num' }, String(S.ranges.length + 1)), el('div', { class: 'rg-mid' }, el('span', {}, S.outF == null ? 'In set — press ] for the Out' : 'In / Out (not numbered)'), el('span', { class: 'rg-tc mono' }, Player.frameText(S.inF) + (S.outF != null ? ' – ' + Player.frameText(S.outF) : ' – …')))));
    if (!S.ranges.length && S.inF == null) list.append(el('div', { class: 'rg-empty muted' }, el('p', {}, 'No ranges yet.'), el('p', {}, 'Press [ for an In and ] for an Out. Every pair becomes the next number: 1, 2, 3 …'), el('p', {}, 'Or let Clips Pro find the shots:'), el('button', { class: 'secondary', style: 'height:30px', onclick: () => detectDialog() }, 'Detect cuts…')));
    const foot = el('div', { class: 'rg-foot' },
      el('button', { class: 'chip', disabled: !S.ranges.length, onclick: () => Dialogs.exportDialog({ ranges: true }) }, 'Export…'),
      el('button', { class: 'chip', onclick: (e) => { const b = e.currentTarget.getBoundingClientRect(); listMenu(b.left, b.top - 250); } }, 'Cut list ▾'),
      el('button', { class: 'chip', onclick: () => detectDialog() }, 'Detect cuts…'),
      el('button', { class: 'chip', disabled: !S.ranges.length, title: 'Clear all ranges (' + (Keys.label('clearRanges') || 'Alt+X') + ')', onclick: () => clearAll() }, 'Clear all'));
    panel.append(head, list, foot);
  }

  // ---------- cut detection ----------
  let scanning = null;
  async function scanClip(c, onPct) {
    const key = c.tin + '-' + c.tout;
    c.media._scans = c.media._scans || {};
    if (c.media._scans[key]) return c.media._scans[key];
    const id = 'scan-' + Date.now() + Math.random().toString(36).slice(2, 6);
    scanning = id;
    const off = (p) => { if (p.id === id) onPct(p.pct); };
    RangesProgress.fn = off;
    const r = await API.scanCuts({ id, path: c.media.path, startSec: c.tin > 0 ? frameSec(c.tin, c.media.fps) : 0, count: Player.len(c), fps: c.media.fps });
    RangesProgress.fn = null; scanning = null;
    if (r && r.ok) c.media._scans[key] = r;
    return r;
  }
  function detectDialog() {
    if (!S.clips.length) { toast('Open a video first'); return; }
    if (!API) { toast('Detect cuts needs the installed Clips Pro app'); return; }
    if (S.playing) Player.pause();
    const seq = S.mode === 'sequence' && S.clips.length > 1;
    let sens = Settings.get('cutSens') || 'medium';
    const sensSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Sensitivity' }, ...['low', 'medium', 'high'].map((k) => el('button', { type: 'button', 'data-s': k, onclick: () => { sens = k; paint(); } }, k[0].toUpperCase() + k.slice(1))));
    const paint = () => $$('button', sensSeg).forEach((b) => b.classList.toggle('on', b.dataset.s === sens));
    const gr = el('input', { type: 'checkbox', id: 'cd-gr' }); gr.checked = Settings.get('cutGradual') !== false;
    const mk = el('input', { type: 'checkbox', id: 'cd-mk' }); mk.checked = !!Settings.get('cutMarks');
    const rp = el('input', { type: 'checkbox', id: 'cd-rp' }); rp.checked = true;
    const minSel = el('select', { id: 'cd-min' }, ['0.25:¼ second', '0.4:0.4 second', '1:1 second', '2:2 seconds'].map((o) => { const [v, t] = o.split(':'); return el('option', { value: v }, t); }));
    minSel.value = String(Settings.get('cutMin') || 0.4);
    const scope1 = el('input', { type: 'radio', name: 'cd-scope', id: 'cd-s1' }), scope2 = el('input', { type: 'radio', name: 'cd-scope', id: 'cd-s2' });
    scope1.checked = !seq; scope2.checked = seq;
    const prog = el('div', { hidden: true, style: 'display:flex;flex-direction:column;gap:6px' }, el('div', { class: 'bar' }, el('div')), el('div', { class: 'row' }, el('span', { class: 'pct mono' }, '0%'), el('span', { class: 'what muted' })));
    const result = el('div', { hidden: true, class: 'cd-result' });
    const body = el('div', { class: 'mb' },
      el('p', { class: 'muted', style: 'margin:0' }, 'Clips Pro reads every frame and finds where one shot changes to the next. It runs on your PC and nothing is uploaded.'),
      seq ? el('div', { class: 'fieldset' }, el('span', {}, 'Look in'), el('div', { style: 'display:flex;gap:16px' }, el('label', { class: 'check', for: 'cd-s1' }, scope1, 'This clip only'), el('label', { class: 'check', for: 'cd-s2' }, scope2, `All ${S.clips.length} clips`))) : null,
      el('div', { class: 'kv-grid' },
        el('div', { class: 'fieldset' }, el('span', {}, 'Sensitivity'), sensSeg, el('span', { class: 'muted small' }, 'Higher finds more cuts (and more mistakes)')),
        el('label', { class: 'fieldset', for: 'cd-min' }, el('span', {}, 'Shortest shot'), minSel)),
      el('label', { class: 'check', for: 'cd-gr' }, gr, 'Also find dissolves and fades (not only hard cuts)'),
      el('div', { class: 'fieldset' }, el('span', {}, 'Then'),
        el('label', { class: 'check', for: 'cd-rp' }, rp, S.ranges.length ? `Make numbered ranges, one per shot (replaces the ${S.ranges.length} you have)` : 'Make numbered ranges, one per shot'),
        el('label', { class: 'check', for: 'cd-mk' }, mk, 'Also add a mark at every cut')),
      prog, result);
    paint();
    const go = el('button', { class: 'primary' }, 'Detect cuts');
    const cancel = el('button', { class: 'secondary' }, 'Cancel');
    const foot = el('div', { class: 'mf' }, cancel, go);
    let running = false, stop = false;
    const h = Modal.open({ title: 'Detect cuts', width: 620, body, footer: foot, onClose: () => { if (running) { stop = true; if (scanning) API.cancelJob(scanning); } } });
    cancel.addEventListener('click', () => { if (running) { stop = true; if (scanning) API.cancelJob(scanning); } else h.close(); });
    go.addEventListener('click', async () => {
      if (go.dataset.done) { h.close(); return; }
      Settings.set('cutSens', sens); Settings.set('cutGradual', gr.checked); Settings.set('cutMarks', mk.checked); Settings.set('cutMin', +minSel.value);
      const clips = scope2.checked ? S.clips.slice() : [Player.curClip()];
      const st = Player.starts();
      running = true; stop = false; go.disabled = true; cancel.textContent = 'Stop'; prog.hidden = false; result.hidden = true;
      const bar = prog.querySelector('.bar>div'), pct = prog.querySelector('.pct'), what = prog.querySelector('.what');
      const cuts = []; // global frames where a new shot starts
      const shotsByClip = [];
      let failed = '';
      for (let k = 0; k < clips.length && !stop; k++) {
        const c = clips[k];
        what.textContent = clips.length > 1 ? `Clip ${k + 1} of ${clips.length}: ${c.media.name}` : c.media.name;
        const res = await scanClip(c, (p) => { const t = (k + p) / clips.length; bar.style.width = (t * 100).toFixed(1) + '%'; pct.textContent = Math.round(t * 100) + '%'; });
        if (!res || !res.ok) { if (res && res.cancelled) break; failed = (res && res.error) || 'Could not read the video'; continue; }
        const found = CutDetect.detect(res, { sens, gradual: gr.checked, minShotSec: +minSel.value });
        const g0 = S.mode === 'sequence' ? st[S.clips.indexOf(c)] : 0;
        const len = Math.min(Player.len(c), res.n);
        const b = [0, ...found.map((x) => x.f).filter((x) => x > 0 && x < len)];
        const kinds = ['', ...found.filter((x) => x.f > 0 && x.f < len).map((x) => x.kind)];
        for (let i = 0; i < b.length; i++) shotsByClip.push({ a: g0 + b[i], b: g0 + (i + 1 < b.length ? b[i + 1] : Player.len(c)) - 1, kind: kinds[i] || (i === 0 && k > 0 ? 'cut' : '') });
        for (const x of found) if (x.f > 0 && x.f < len) cuts.push({ g: g0 + x.f, kind: x.kind });
      }
      running = false; go.disabled = false; cancel.textContent = 'Close';
      if (stop) { pct.textContent = 'Stopped'; return; }
      bar.style.width = '100%'; pct.textContent = 'Done';
      if (failed && !shotsByClip.length) { result.hidden = false; result.innerHTML = ''; result.append(el('div', { class: 'err' }, 'Cut detection failed.\n' + failed)); return; }
      Player.commit();
      if (rp.checked) {
        S.ranges = []; S.selRange = null; S.inF = S.outF = null;
        for (const s of shotsByClip) add(s.a, s.b, { noCommit: true, select: false, kind: s.kind || '' });
      }
      if (mk.checked) for (const c of cuts) S.marks.add(c.g);
      changed();
      const nd = cuts.filter((c) => c.kind === 'dissolve').length;
      result.hidden = false; result.innerHTML = '';
      result.append(...[
        el('h2', {}, cuts.length ? `Found ${cuts.length} ${cuts.length === 1 ? 'cut' : 'cuts'} — ${shotsByClip.length} shots` : 'No cuts found — it looks like one continuous shot'),
        nd ? el('div', { class: 'muted' }, `${cuts.length - nd} hard cuts, ${nd} dissolves or fades`) : null,
        failed ? el('div', { class: 'warn' }, 'Some clips could not be read: ' + failed.split('\n')[0]) : null,
        el('div', { class: 'row-btns', style: 'flex-wrap:wrap' },
          el('button', { class: 'secondary', onclick: () => { h.close(); toggle(true); } }, 'Show ranges'),
          el('button', { class: 'secondary', disabled: !S.ranges.length, onclick: () => { h.close(); Dialogs.exportDialog({ ranges: true, how: 'multi' }); } }, 'Split into clips…'),
          el('button', { class: 'secondary', disabled: !S.ranges.length, onclick: (e) => { const b = e.currentTarget.getBoundingClientRect(); listMenu(b.left, b.bottom + 4); } }, 'Save cut list ▾'))].filter(Boolean));
      go.textContent = 'Done'; go.dataset.done = '1';
      if (rp.checked && !isOpen()) toggle(true);
    });
  }

  const multiIds = () => S.ranges.filter((r) => multi.has(r.id)).map((r) => r.id);
  return { cutAt, deleteMark, removeCut, addCut, merge, removeMany, multiIds, get, sel, num, label, fileLabel, sync, select, deselect, add, remove, clearAll, clearSelection, rename, move, markIn, markOut, pieces, exportable, exportList, toggle, isOpen, render, build, detectDialog, rowMenu, startRename };
})();
const RangesProgress = { fn: null };
if (API) API.onJobProgress((p) => { if (RangesProgress.fn) RangesProgress.fn(p); });

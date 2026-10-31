'use strict';
/* Menus: menubar dropdowns, context menus, submenus */
const Menu = (() => {
  const layer = () => $('#menu-layer');
  let stack = []; // open menu elements (root first)
  let onCloseCb = null;
  let barOpen = null;

  function closeFrom(level) {
    while (stack.length > level) { const m = stack.pop(); m.remove(); }
    if (!stack.length) {
      if (barOpen) { barOpen.classList.remove('open'); barOpen = null; }
      if (onCloseCb) { const c = onCloseCb; onCloseCb = null; c(); }
    }
  }
  const closeAll = () => closeFrom(0);
  const val = (v) => (typeof v === 'function' ? v() : v);

  function build(items, level) {
    const m = el('div', { class: 'menu', role: 'menu' });
    let hl = -1;
    const rows = [];
    for (const it of items) {
      if (!it) continue;
      if (it.sep) { m.append(el('div', { class: 'sep' })); continue; }
      if (it.header) { m.append(el('div', { class: 'hd' }, val(it.header))); continue; }
      const dis = !!val(it.disabled);
      const checked = val(it.checked);
      const kb = it.kb || (it.key ? Keys.label(it.key) : '');
      const row = el('div', { class: 'mi' + (dis ? ' dis' : ''), role: 'menuitem', 'aria-disabled': dis ? 'true' : null },
        el('span', { class: 'ck' }, checked ? '✓' : ''),
        el('span', { class: 'lb' }, val(it.label)),
        el('span', { class: 'kb' }, it.sub ? '▸' : kb));
      row._it = it;
      const openSub = () => {
        closeFrom(level + 1);
        if (!it.sub || dis) return;
        const r = row.getBoundingClientRect();
        show(val(it.sub), r.right - 4, r.top - 6, level + 1, r.left + 4);
      };
      row.addEventListener('mouseenter', () => { rows.forEach((x) => x.classList.remove('hl')); hl = rows.indexOf(row); if (it.sub) openSub(); else closeFrom(level + 1); });
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dis) return;
        if (it.sub) { openSub(); return; }
        closeAll();
        if (it.action) setTimeout(() => it.action(), 0);
      });
      rows.push(row); m.append(row);
    }
    m._rows = rows; m._hl = () => hl; m._setHl = (i) => { hl = i; rows.forEach((x, j) => x.classList.toggle('hl', j === i)); };
    return m;
  }

  function show(items, x, y, level = 0, altX = null) {
    const m = build(items, level);
    m.style.left = '0px'; m.style.top = '0px'; m.style.visibility = 'hidden';
    layer().append(m); stack.push(m);
    const r = m.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    let left = x, top = y;
    if (left + r.width > W - 4) left = altX != null ? altX - r.width : W - r.width - 4;
    if (top + r.height > H - 4) top = Math.max(4, H - r.height - 4);
    m.style.left = Math.max(4, left) + 'px'; m.style.top = top + 'px'; m.style.visibility = '';
    return m;
  }

  function open(items, x, y, opts = {}) {
    closeAll();
    onCloseCb = opts.onClose || null;
    return show(items, x, y, 0);
  }

  // menubar
  function bar(defs) {
    const nav = $('#menubar'); nav.innerHTML = '';
    for (const [name, itemsFn] of defs) {
      const b = el('button', { type: 'button' }, name);
      const openIt = () => {
        const r = b.getBoundingClientRect();
        closeAll();
        show(itemsFn(), r.left, r.bottom + 2, 0);
        barOpen = b; b.classList.add('open');
      };
      b.addEventListener('mousedown', (e) => { e.preventDefault(); if (barOpen === b) closeAll(); else openIt(); });
      b.addEventListener('mouseenter', () => { if (barOpen && barOpen !== b) openIt(); });
      nav.append(b);
    }
  }

  document.addEventListener('mousedown', (e) => {
    if (!stack.length) return;
    if (e.target.closest('.menu') || e.target.closest('#menubar')) return;
    closeAll();
  }, true);
  window.addEventListener('blur', () => closeAll());
  window.addEventListener('resize', () => closeAll());

  function key(e) {
    if (!stack.length) return false;
    const m = stack[stack.length - 1];
    const rows = m._rows.filter((r) => !r.classList.contains('dis'));
    let i = m._hl();
    const idx = (r) => m._rows.indexOf(r);
    if (e.key === 'Escape') { if (stack.length > 1) closeFrom(stack.length - 1); else closeAll(); return true; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const cur = rows.findIndex((r) => idx(r) === i);
      const n = e.key === 'ArrowDown' ? (cur + 1) % rows.length : (cur - 1 + rows.length) % rows.length;
      if (rows[n]) m._setHl(idx(rows[n]));
      return true;
    }
    if (e.key === 'ArrowRight') { const r = m._rows[i]; if (r && r._it.sub) r.dispatchEvent(new MouseEvent('click')); return true; }
    if (e.key === 'ArrowLeft') { if (stack.length > 1) closeFrom(stack.length - 1); return true; }
    if (e.key === 'Enter') { const r = m._rows[i]; if (r) r.dispatchEvent(new MouseEvent('click')); return true; }
    return true; // swallow other keys while a menu is open
  }

  return { open, closeAll, bar, key, isOpen: () => stack.length > 0 };
})();

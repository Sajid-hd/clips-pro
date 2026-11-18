'use strict';
/* Keyboard shortcuts: normalisation, defaults, presets, editable bindings */
const Keys = (() => {
  const NAMES = { ' ': 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Delete: 'Del', Backspace: 'Backspace', PageUp: 'PgUp', PageDown: 'PgDn' };
  function fromEvent(e) {
    let k = e.key;
    if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(k)) return null;
    if (e.code === 'Space') k = ' ';
    let shiftCounts = true;
    if (k.length === 1) {
      if (/[a-z]/i.test(k)) k = k.toUpperCase();
      else if (e.code && /^Digit\d$/.test(e.code) && (e.ctrlKey || e.altKey)) k = e.code.slice(5); // Ctrl+1 etc.
      else shiftCounts = false; // symbols already include shift, e.g. "("
    }
    const name = NAMES[k] || k;
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey && shiftCounts) parts.push('Shift');
    parts.push(name);
    return parts.join('+');
  }

  // id: [label, group, default keys]
  const DEFS = [
    ['playPause', 'Play / pause', 'Playback', ['Space', '↓']],
    ['toggleDir', 'Reverse playback direction', 'Playback', ['↑']],
    ['playRev', 'Play reverse', 'Playback', []],
    ['stepBack', 'Previous frame', 'Playback', ['←']],
    ['stepFwd', 'Next frame', 'Playback', ['→']],
    ['shuttleBack', 'Shuttle reverse (J)', 'Playback', ['J']],
    ['stop', 'Stop (K)', 'Playback', ['K']],
    ['shuttleFwd', 'Shuttle forward (L)', 'Playback', ['L']],
    ['goStart', 'Go to start / In', 'Playback', ['Home']],
    ['goEnd', 'Go to end / Out', 'Playback', ['End']],
    ['gotoFrame', 'Go to frame', 'Playback', ['G']],
    ['allFrames', 'Play all frames / real-time', 'Playback', ['A']],
    ['audioScrub', 'Audio scrub on / off', 'Playback', ['Shift+A']],
    ['loopMode', 'Loop mode (loop / once / ping-pong)', 'Playback', ['P']],
    ['mute', 'Mute', 'Playback', ['Shift+M']],
    ['volUp', 'Volume up', 'Playback', ['=']],
    ['volDown', 'Volume down', 'Playback', ['-']],
    ['setIn', 'Set In (starts the next numbered range)', 'Marks', ['[']],
    ['setOut', 'Set Out (makes the numbered range)', 'Marks', [']']],
    ['clearInOut', 'Deselect range / reset In / Out', 'Marks', ['\\']],
    ['clearSel', 'Clear the selected range', 'Marks', ['Ctrl+Del']],
    ['clearRanges', 'Clear all ranges', 'Marks', ['Alt+X']],
    ['prevRangeN', 'Select previous numbered range', 'Marks', ['{']],
    ['nextRangeN', 'Select next numbered range', 'Marks', ['}']],
    ['rangesPanel', 'Ranges panel', 'Marks', ['R']],
    ['detectCuts', 'Detect cuts…', 'Marks', ['Ctrl+Shift+D']],
    ['mark', 'Add / remove mark', 'Marks', ['M']],
    ['prevMark', 'Previous mark', 'Marks', ['Alt+←']],
    ['nextMark', 'Next mark', 'Marks', ['Alt+→']],
    ['prevRange', 'In / Out to previous marked shot', 'Marks', ['Ctrl+←']],
    ['nextRange', 'In / Out to next marked shot (loop it)', 'Marks', ['Ctrl+→']],
    ['tracker', 'Tracker', 'Marks', ['X']],
    ['editMode', 'Switch compact / full editor', 'View', ['E']],
    ['modeSequence', 'Sequence', 'View', ['Ctrl+1']],
    ['modeStack', 'Stack', 'View', ['Ctrl+2']],
    ['modeLayout', 'Layout', 'View', ['Ctrl+3']],
    ['modeTile', 'Tile', 'View', ['Ctrl+4']],
    ['cycleBack', 'Cycle stack backward', 'View', ['(']],
    ['cycleFwd', 'Cycle stack forward', 'View', [')']],
    ['wipes', 'Toggle wipes (Stack)', 'View', ['F6']],
    ['fit', 'Fit image to view', 'View', ['0']],
    ['scale1', 'Actual size (1:1)', 'View', ['1']],
    ['scale2', 'Zoom 2:1', 'View', ['2']],
    ['zoomIn', 'Zoom in', 'View', ['Ctrl+=']],
    ['zoomOut', 'Zoom out', 'View', ['Ctrl+-']],
    ['flipX', 'Flop view (mirror)', 'View', ['Shift+X']],
    ['flipY', 'Flip view (upside down)', 'View', ['Shift+Y']],
    ['fullscreen', 'Full screen', 'View', ['F', '`']],
    ['info', 'Image info', 'View', ['I']],
    ['overlay', 'Info overlay on / off', 'View', ['Shift+I']],
    ['timeline', 'Show / hide timeline', 'View', ['Tab']],
    ['sources', 'Sources panel', 'View', ['S']],
    ['open', 'Open…', 'File', ['Ctrl+O']],
    ['addFiles', 'Add to session…', 'File', ['Ctrl+Shift+O']],
    ['export', 'Export…', 'File', ['Ctrl+E']],
    ['saveFrame', 'Save frame as image…', 'File', ['Ctrl+Shift+S']],
    ['copyFrame', 'Copy frame', 'File', ['Ctrl+Shift+C']],
    ['closeSession', 'Close session', 'File', ['Ctrl+W']],
    ['undo', 'Undo', 'Edit', ['Ctrl+Z']],
    ['redo', 'Redo', 'Edit', ['Ctrl+Y', 'Ctrl+Shift+Z']],
    ['cut', 'Cut clip', 'Edit', ['Ctrl+X']],
    ['copy', 'Copy clip', 'Edit', ['Ctrl+C']],
    ['paste', 'Paste clip after current', 'Edit', ['Ctrl+V']],
    ['del', 'Delete clip', 'Edit', ['Del']],
    ['trim', 'Trim…', 'Edit', ['Ctrl+T']],
    ['trimInOut', 'Trim to In / Out', 'Edit', ['Ctrl+Shift+T']],
    ['split', 'Split at playhead', 'Edit', ['Ctrl+B']],
    ['rotL', 'Rotate left', 'Edit', ['Ctrl+Shift+L']],
    ['rotR', 'Rotate right', 'Edit', ['Ctrl+Shift+R']],
    ['settings', 'Settings', 'Edit', ['Ctrl+,']],
  ];
  const PRESETS = {
    clipspro: { name: 'Clips Pro (RV style)', over: {} },
    quicktime: { name: 'QuickTime', over: { setIn: ['I'], setOut: ['O'], info: ['Ctrl+I'], fullscreen: ['Ctrl+F', '`'], mark: ['Shift+M'], mute: ['Ctrl+↓'], playPause: ['Space'], toggleDir: [] } },
    resolve: { name: 'DaVinci Resolve', over: { setIn: ['I'], setOut: ['O'], clearRanges: ['Alt+X'], clearInOut: ['\\'], info: ['Shift+I'], overlay: [], split: ['Ctrl+\\', 'Ctrl+B'], mark: ['M'], fullscreen: ['Ctrl+F', '`'], playPause: ['Space'], toggleDir: [] } },
  };
  const LABEL = Object.fromEntries(DEFS.map((d) => [d[0], d[1]]));
  let map = {}; // action -> [keys]
  let lookup = {}; // key -> action
  function presetMap(p) {
    const m = Object.fromEntries(DEFS.map((d) => [d[0], d[3].slice()]));
    const over = (PRESETS[p] || PRESETS.clipspro).over;
    for (const [a, ks] of Object.entries(over)) {
      for (const k of ks) for (const b of Object.keys(m)) m[b] = m[b].filter((x) => x !== k);
      m[a] = ks.slice();
    }
    return m;
  }
  function rebuild() { lookup = {}; for (const [a, ks] of Object.entries(map)) for (const k of ks) lookup[k] = a; }
  function load() {
    const saved = Settings.get('keys');
    map = saved && typeof saved === 'object' ? { ...presetMap(Settings.get('keyPreset')), ...saved } : presetMap(Settings.get('keyPreset'));
    rebuild();
  }
  function save() { Settings.set('keys', map); rebuild(); }
  load();
  return {
    DEFS, PRESETS, LABEL, fromEvent,
    actionFor: (k) => lookup[k],
    keysFor: (a) => map[a] || [],
    label: (a) => (map[a] && map[a][0]) || '',
    setKey(a, k) { for (const b of Object.keys(map)) map[b] = map[b].filter((x) => x !== k); map[a] = [k]; save(); },
    clear(a) { map[a] = []; save(); },
    usePreset(p) { Settings.set('keyPreset', p); map = presetMap(p); save(); },
  };
})();

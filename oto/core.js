/* Pure pattern/state helpers. No browser or audio side effects. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OTO = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STEPS = 16;
  const TRACKS = [
    { name: 'Bell', hint: 'きらめき', color: '#d7eaa2', notes: [72, 76, 79, 83, 79, 76, 74, 79, 72, 76, 79, 86, 83, 79, 76, 74] },
    { name: 'Keys', hint: 'やわらかさ', color: '#bdb1db', notes: [60, 64, 67, 71, 64, 67, 71, 72, 57, 60, 64, 67, 59, 62, 67, 71] },
    { name: 'Bass', hint: 'あたたかさ', color: '#efb18b', notes: [36, 36, 36, 43, 36, 36, 43, 43, 33, 33, 33, 40, 35, 35, 35, 43] },
    { name: 'Beat', hint: 'リズム', color: '#a9c9d6', notes: [] }
  ];
  const PRESETS = {
    daydream: { name: 'Daydream', subtitle: '昼下がりの、ひとやすみ。', bpm: 96, transpose: 0, pattern: ['1000100100101000', '0010001001000010', '1000000010001000', '1010100010101001'] },
    afterglow: { name: 'Afterglow', subtitle: '夕暮れに、もう少しだけ。', bpm: 76, transpose: -5, pattern: ['1000001000010000', '1000100010100010', '1000000010000001', '1000100010001010'] },
    nightwalk: { name: 'Nightwalk', subtitle: '帰り道に、遠回りしよう。', bpm: 122, transpose: -2, pattern: ['0010001000100101', '1001010010010100', '1001001010010010', '1011101110111011'] }
  };
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function getPreset(id, volume = 0.38) {
    if (!Object.hasOwn(PRESETS, id)) throw new Error('Unknown preset');
    return { version: 1, preset: id, bpm: PRESETS[id].bpm, volume, custom: false, muted: [false, false, false, false], pattern: PRESETS[id].pattern.map(row => [...row].map(v => v === '1')) };
  }
  function validateState(value) {
    if (!value || value.version !== 1 || !Object.hasOwn(PRESETS, value.preset)) return null;
    if (!Number.isInteger(value.bpm) || value.bpm < 60 || value.bpm > 160) return null;
    if (!Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) return null;
    if (!Array.isArray(value.muted) || value.muted.length !== 4 || value.muted.some(v => typeof v !== 'boolean')) return null;
    if (!Array.isArray(value.pattern) || value.pattern.length !== 4 || value.pattern.some(row => !Array.isArray(row) || row.length !== STEPS || row.some(v => typeof v !== 'boolean'))) return null;
    return { version: 1, preset: value.preset, bpm: value.bpm, volume: value.volume, custom: Boolean(value.custom), muted: [...value.muted], pattern: value.pattern.map(row => [...row]) };
  }
  function encodeState(state) {
    const valid = validateState(state);
    if (!valid) throw new Error('Invalid pattern');
    // Do not share device-specific listening volume.
    return JSON.stringify({ v: 1, p: valid.preset, b: valid.bpm, g: valid.pattern.map(row => row.map(Number).join('')), m: valid.muted.map(Number).join(''), c: valid.custom });
  }
  function decodeState(text, volume = 0.38) {
    if (typeof text !== 'string' || text.length > 1024) return null;
    try {
      const v = JSON.parse(text);
      if (!v || v.v !== 1 || !Array.isArray(v.g) || v.g.length !== 4 || v.g.some(row => typeof row !== 'string' || !/^[01]{16}$/.test(row)) || typeof v.m !== 'string' || !/^[01]{4}$/.test(v.m)) return null;
      return validateState({ version: 1, preset: v.p, bpm: v.b, pattern: v.g.map(row => [...row].map(n => n === '1')), muted: [...v.m].map(n => n === '1'), custom: Boolean(v.c), volume });
    } catch { return null; }
  }
  function randomPattern(random = Math.random) {
    const density = [0.25, 0.27, 0.28, 0.5];
    const pattern = density.map(chance => Array.from({ length: STEPS }, () => random() < chance));
    pattern[0][Math.floor(random() * STEPS)] = true;
    pattern[1][Math.floor(random() * STEPS)] = true;
    pattern[2][0] = true;
    [0, 4, 8, 12].forEach(step => { pattern[3][step] = true; });
    return pattern;
  }
  function countNotes(state) { return state.pattern.reduce((sum, row) => sum + row.filter(Boolean).length, 0); }
  function noteFrequency(note) { return 440 * 2 ** ((note - 69) / 12); }
  return { STEPS, TRACKS, PRESETS, clone, getPreset, validateState, encodeState, decodeState, randomPattern, countNotes, noteFrequency };
});

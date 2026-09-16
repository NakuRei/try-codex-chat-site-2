'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getPreset, validateState, encodeState, decodeState, randomPattern, countNotes, noteFrequency } = require('../core.js');

test('all three presets are valid independent 4 × 16 patterns', () => {
  for (const id of ['daydream', 'afterglow', 'nightwalk']) {
    const state = getPreset(id);
    assert.deepEqual(validateState(state), state);
    assert.ok(countNotes(state) > 0);
    const other = getPreset(id);
    state.pattern[0][0] = !state.pattern[0][0];
    assert.notDeepEqual(state.pattern, other.pattern);
  }
});
test('share round-trip preserves composition, but not device volume', () => {
  const original = getPreset('afterglow', 0.9);
  original.bpm = 155; original.custom = true; original.muted[2] = true;
  assert.deepEqual(decodeState(encodeState(original), 0.2), { ...original, volume: 0.2 });
});
test('reject malformed and untrusted states without throwing', () => {
  const state = getPreset('daydream');
  for (const invalid of [null, {}, { ...state, version: 2 }, { ...state, bpm: NaN }, { ...state, bpm: 0 }, { ...state, bpm: 161 }, { ...state, bpm: 96.5 }, { ...state, volume: -1 }, { ...state, volume: Infinity }, { ...state, preset: '__proto__' }, { ...state, muted: [] }, { ...state, muted: [0, 0, 0, 0] }, { ...state, pattern: [] }, { ...state, pattern: [[true]] }]) assert.equal(validateState(invalid), null);
  for (const invalid of ['', 'null', 'undefined', '{}', '[]', 'x'.repeat(1100), '{"v":1,"g":[1,2,3,4]}']) assert.equal(decodeState(invalid), null);
  assert.throws(() => encodeState({}), /Invalid/);
  assert.throws(() => getPreset('missing'), /Unknown/);
});
test('strictly reject corrupt shared rows, version, preset and mute mask', () => {
  const shared = JSON.parse(encodeState(getPreset('nightwalk')));
  for (const bad of [{ ...shared, v: 2 }, { ...shared, p: 'constructor' }, { ...shared, b: 200 }, { ...shared, m: '000x' }, { ...shared, g: ['0'.repeat(15), ...shared.g.slice(1)] }, { ...shared, g: ['2'.repeat(16), ...shared.g.slice(1)] }]) assert.equal(decodeState(JSON.stringify(bad)), null);
});
test('random generator guarantees audible rows and a rhythmic foundation', () => {
  for (const random of [() => 0, () => 0.9999, Math.random]) {
    const pattern = randomPattern(random);
    assert.equal(pattern.length, 4);
    pattern.forEach(row => { assert.equal(row.length, 16); assert.ok(row.some(Boolean)); assert.ok(row.every(v => typeof v === 'boolean')); });
    [0, 4, 8, 12].forEach(step => assert.equal(pattern[3][step], true));
  }
});
test('equal temperament reference frequencies', () => {
  assert.equal(noteFrequency(69), 440);
  assert.equal(noteFrequency(81), 880);
  assert.ok(Math.abs(noteFrequency(60) - 261.625565) < 0.00001);
});
test('validation clones arrays and strips unexpected fields', () => {
  const state = getPreset('daydream');
  const valid = validateState({ ...state, injected: '<script>' });
  valid.pattern[0][0] = !valid.pattern[0][0];
  valid.muted[0] = true;
  assert.equal(state.muted[0], false);
  assert.notEqual(state.pattern[0][0], valid.pattern[0][0]);
  assert.equal(valid.injected, undefined);
});

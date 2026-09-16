/* OTO: a dependency-free, local-first Web Audio playground. */
(() => {
  'use strict';
  const { STEPS, TRACKS, PRESETS, clone, getPreset, validateState, encodeState, decodeState, randomPattern, countNotes, noteFrequency } = window.OTO;
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'oto:loop:v1';
  let state = getPreset('daydream');
  let startupMessage = '';
  let canStore = true;
  let undoStack = [];
  let playing = false;
  let starting = false;
  let timer = null;
  let animation = null;
  let currentStep = -1;
  let nextStep = 0;
  let nextTime = 0;
  let visualQueue = [];
  let toastTimer;
  let saveTimer;
  let dragged = null;
  let dragMoved = false;
  let suppressClick = false;
  let suppressTimer;
  let tempoEditing = false;
  let startToken = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const restored = validateState(JSON.parse(saved));
        if (restored) state = restored;
        else startupMessage = '保存データを読み込めなかったため、初期パターンを開きました。';
      } catch { startupMessage = '保存データを読み込めなかったため、初期パターンを開きました。'; }
    }
  } catch { canStore = false; }
  function readSharedLoop() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('loop')) return false;
    const shared = decodeState(params.get('loop'), state.volume);
    if (!shared) { startupMessage = '共有URLが正しくありません。手元のパターンを表示します。'; return false; }
    state = shared;
    startupMessage = '共有されたループを開きました。再生してみよう。';
    return true;
  }
  readSharedLoop();

  class AudioEngine {
    constructor() { this.context = null; this.sources = new Set(); }
    async unlock() {
      if (!this.context) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) throw new Error('このブラウザは音声合成に対応していません。');
        this.context = new Context();
        const ctx = this.context;
        this.master = ctx.createGain();
        this.master.gain.value = state.volume * 0.5;
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -16;
        this.compressor.knee.value = 18;
        this.compressor.ratio.value = 5;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.18;
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.data = new Uint8Array(this.analyser.frequencyBinCount);
        this.master.connect(this.compressor).connect(this.analyser).connect(ctx.destination);
        this.delay = ctx.createDelay(1);
        this.delay.delayTime.value = 0.23;
        this.echo = ctx.createGain();
        this.echo.gain.value = 0.17;
        this.feedback = ctx.createGain();
        this.feedback.gain.value = 0.2;
        this.delay.connect(this.echo).connect(this.master);
        this.delay.connect(this.feedback).connect(this.delay);
        this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
        const buffer = this.noise.getChannelData(0);
        for (let i = 0; i < buffer.length; i++) buffer[i] = Math.random() * 2 - 1;
        ctx.addEventListener('statechange', () => {
          if (playing && ctx.state !== 'running') { stop(); toast('音声の再生が中断されました。再生ボタンで再開できます。'); }
        });
      }
      if (this.context.state !== 'running') await this.context.resume();
      if (this.context.state !== 'running') throw new Error('音声を開始できませんでした。もう一度再生を押してください。');
      this.setVolume();
    }
    setVolume() {
      if (!this.context) return;
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(state.volume * 0.5, now, 0.015);
    }
    register(source, nodes) {
      this.sources.add(source);
      source.onended = () => { this.sources.delete(source); source.disconnect(); nodes.forEach(node => node.disconnect()); };
    }
    tone(frequency, time, type, length, level, detune = 0, echo = true) {
      const ctx = this.context;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, time);
      osc.detune.value = detune;
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(level, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
      osc.connect(gain).connect(this.master);
      if (echo) gain.connect(this.delay);
      this.register(osc, [gain]);
      osc.start(time);
      osc.stop(time + length + 0.02);
    }
    percussion(step, time) {
      const ctx = this.context;
      if (step % 8 === 0) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.setValueAtTime(130, time);
        osc.frequency.exponentialRampToValueAtTime(43, time + 0.14);
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(0.6, time + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
        osc.connect(gain).connect(this.master);
        this.register(osc, [gain]);
        osc.start(time); osc.stop(time + 0.32);
      } else {
        const isSnare = step % 8 === 4;
        const source = ctx.createBufferSource();
        source.buffer = this.noise;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass'; filter.frequency.value = isSnare ? 1300 : 7000;
        const gain = ctx.createGain();
        const duration = isSnare ? 0.14 : 0.055;
        gain.gain.setValueAtTime(0, time);
        gain.gain.linearRampToValueAtTime(isSnare ? 0.28 : 0.14, time + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        source.connect(filter).connect(gain).connect(this.master);
        this.register(source, [filter, gain]);
        source.start(time); source.stop(time + duration + 0.01);
        if (isSnare) this.tone(170, time, 'triangle', 0.09, 0.13, 0, false);
      }
    }
    note(track, step, time) {
      if (track === 3) { this.percussion(step, time); return; }
      const f = noteFrequency(TRACKS[track].notes[step] + PRESETS[state.preset].transpose);
      if (track === 0) {
        this.tone(f, time, 'sine', 0.65, 0.28);
        this.tone(f * 2.001, time, 'sine', 0.23, 0.06);
      } else if (track === 1) {
        this.tone(f, time, 'triangle', 0.37, 0.2);
        this.tone(f * 2, time, 'sine', 0.3, 0.06, -4);
      } else this.tone(f, time, 'sine', 0.38, 0.48, 0, false);
    }
    silence() {
      if (!this.context) return;
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0, now, 0.008);
      this.sources.forEach(source => { try { source.stop(now + 0.035); } catch { /* already stopped */ } });
    }
    energy() {
      if (!this.analyser || !playing) return 0;
      this.analyser.getByteFrequencyData(this.data);
      return this.data.reduce((sum, n) => sum + n, 0) / (this.data.length * 255);
    }
  }
  const audio = new AudioEngine();

  function toast(text) {
    clearTimeout(toastTimer);
    $('toast').textContent = text;
    $('toast').classList.add('visible');
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3400);
  }
  function save() {
    clearTimeout(saveTimer);
    if (!canStore) { $('save-status').textContent = '自動保存不可 · 共有で保存できます'; return; }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $('save-status').textContent = '保存しました';
      saveTimer = setTimeout(() => { $('save-status').textContent = 'このブラウザに自動保存'; }, 1600);
    } catch { canStore = false; $('save-status').textContent = '自動保存不可 · 共有で保存できます'; }
  }
  function remember() { undoStack.push(clone(state)); if (undoStack.length > 30) undoStack.shift(); }
  function detachSharedURL() {
    if (new URLSearchParams(location.hash.slice(1)).has('loop')) {
      try {
        const clean = new URL(location.href); clean.hash = '';
        history.replaceState(null, '', clean.href);
      } catch { /* file:// or restricted history */ }
    }
  }
  function changed(custom = true) {
    if (custom) state.custom = true;
    detachSharedURL(); render(); save();
  }
  function createGrid() {
    const spacer = document.createElement('span');
    $('step-numbers').append(spacer);
    for (let i = 0; i < STEPS; i++) {
      const number = document.createElement('span');
      number.className = 'step-number' + (i % 4 === 0 ? ' beat-start' : '');
      number.textContent = String(i + 1).padStart(2, '0');
      $('step-numbers').append(number);
    }
    TRACKS.forEach((track, row) => {
      const el = document.createElement('div');
      el.className = 'track'; el.dataset.row = row;
      el.style.setProperty('--track', track.color);
      const label = document.createElement('button');
      label.type = 'button'; label.className = 'track-label'; label.dataset.mute = row;
      label.innerHTML = `<span class="track-dot"></span><span class="track-text"><strong>${track.name}</strong><small>${track.hint}</small></span>`;
      label.addEventListener('click', () => { remember(); state.muted[row] = !state.muted[row]; changed(); });
      el.append(label);
      for (let col = 0; col < STEPS; col++) {
        const cell = document.createElement('button');
        cell.type = 'button'; cell.className = 'step'; cell.dataset.row = row; cell.dataset.col = col;
        cell.tabIndex = row === 0 && col === 0 ? 0 : -1;
        cell.addEventListener('click', () => {
          if (suppressClick) return;
          remember(); toggleCell(cell, !state.pattern[row][col]); changed();
        });
        cell.addEventListener('pointerdown', event => {
          // Touch users retain horizontal scrolling; tapping still toggles a cell.
          if (event.pointerType === 'touch' || event.button !== 0) return;
          dragged = { row, col, value: !state.pattern[row][col], cell, visited: new Set([`${row}:${col}`]) };
          dragMoved = false;
        });
        cell.addEventListener('pointerenter', event => {
          if (!dragged || !(event.buttons & 1)) return;
          if (!dragMoved) { remember(); toggleCell(dragged.cell, dragged.value); dragMoved = true; }
          const key = `${row}:${col}`;
          if (!dragged.visited.has(key)) { dragged.visited.add(key); toggleCell(cell, dragged.value); }
          changed();
        });
        cell.addEventListener('keydown', event => {
          const direction = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key];
          if (!direction) return;
          event.preventDefault();
          const r = (row + direction[0] + 4) % 4, c = (col + direction[1] + STEPS) % STEPS;
          focusCell(r, c);
        });
        cell.addEventListener('focus', () => {
          document.querySelectorAll('.step[tabindex="0"]').forEach(other => { other.tabIndex = -1; });
          cell.tabIndex = 0;
        });
        el.append(cell);
      }
      $('tracks').append(el);
    });
  }
  function focusCell(row, col) { document.querySelector(`.step[data-row="${row}"][data-col="${col}"]`).focus(); }
  async function audition(row, col) {
    try { await audio.unlock(); if (!playing && !starting && !document.hidden) audio.note(row, col, audio.context.currentTime + 0.008); }
    catch { toast('試聴できませんでした。再生ボタンを押してみてください。'); }
  }
  function toggleCell(cell, value) {
    const row = Number(cell.dataset.row), col = Number(cell.dataset.col);
    state.pattern[row][col] = value;
    if (value && !playing && !state.muted[row]) audition(row, col);
  }
  function finishDrag() {
    if (dragged && dragMoved) {
      suppressClick = true; clearTimeout(suppressTimer);
      suppressTimer = setTimeout(() => { suppressClick = false; }, 0);
    }
    dragged = null; dragMoved = false;
  }
  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('pointercancel', finishDrag);
  window.addEventListener('blur', finishDrag);

  function render() {
    $('loop-title').textContent = state.custom ? 'Your loop' : PRESETS[state.preset].name;
    $('loop-subtitle').textContent = state.custom ? 'いい感じ。その音は、あなただけのもの。' : PRESETS[state.preset].subtitle;
    $('tempo').value = state.bpm; $('tempo-value').value = state.bpm;
    $('tempo').style.setProperty('--range', `${state.bpm - 60}%`);
    $('volume').value = Math.round(state.volume * 100);
    $('volume-value').value = `${Math.round(state.volume * 100)}%`;
    $('volume').style.setProperty('--range', `${state.volume * 100}%`);
    $('note-count').textContent = `${countNotes(state)} NOTES / 16 STEPS`;
    $('undo-button').disabled = undoStack.length === 0;
    document.querySelectorAll('.track').forEach((el, row) => {
      el.classList.toggle('is-muted', state.muted[row]);
      const label = el.querySelector('.track-label');
      label.setAttribute('aria-pressed', String(state.muted[row]));
      label.setAttribute('aria-label', `${TRACKS[row].name}を${state.muted[row] ? 'ミュート解除' : 'ミュート'}`);
      el.querySelectorAll('.step').forEach((cell, col) => {
        cell.setAttribute('aria-pressed', String(state.pattern[row][col]));
        cell.setAttribute('aria-label', `${TRACKS[row].name} ステップ${col + 1} ${state.pattern[row][col] ? 'オン' : 'オフ'}`);
      });
    });
    document.querySelectorAll('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === state.preset && !state.custom)));
    if (audio.context && playing) audio.setVolume();
    if (!playing) drawArt(0);
  }
  function highlight(step) {
    if (currentStep === step) return;
    currentStep = step;
    document.querySelectorAll('.step-number').forEach((el, index) => el.classList.toggle('is-current', index === step));
    document.querySelectorAll('.step').forEach(el => el.classList.toggle('is-current', Number(el.dataset.col) === step));
  }
  function schedule() {
    if (!playing) return;
    const now = audio.context.currentTime;
    // Never emit a burst of late notes after a stalled/backgrounded event loop.
    if (nextTime < now - 0.1) { nextTime = now + 0.03; visualQueue = []; }
    while (nextTime < now + 0.1) {
      state.pattern.forEach((row, track) => { if (row[nextStep] && !state.muted[track]) audio.note(track, nextStep, nextTime); });
      visualQueue.push({ step: nextStep, time: nextTime });
      nextTime += 60 / state.bpm / 4;
      nextStep = (nextStep + 1) % STEPS;
    }
  }
  function frame(timestamp) {
    if (!playing) return;
    while (visualQueue.length && visualQueue[0].time <= audio.context.currentTime) highlight(visualQueue.shift().step);
    if (!reducedMotion.matches) drawArt(timestamp);
    animation = requestAnimationFrame(frame);
  }
  async function start() {
    if (playing || starting) return;
    const token = ++startToken;
    starting = true; $('play-button').disabled = true;
    try {
      await audio.unlock();
      if (token !== startToken || document.hidden) { audio.silence(); return; }
      playing = true; nextStep = 0; nextTime = audio.context.currentTime + 0.045; visualQueue = [];
      document.body.classList.add('is-playing');
      $('play-button').setAttribute('aria-pressed', 'true'); $('play-button').setAttribute('aria-label', 'ループを停止');
      $('play-label').textContent = 'とめる'; document.querySelector('.play-icon').textContent = 'Ⅱ';
      $('playback-status').textContent = 'NOW PLAYING'; $('visual-state').textContent = 'A LITTLE NOISE, ALL YOURS';
      schedule(); timer = setInterval(schedule, 25); animation = requestAnimationFrame(frame);
    } catch (error) { toast(error.message || '音声を開始できませんでした。'); }
    finally { starting = false; $('play-button').disabled = false; }
  }
  function stop() {
    ++startToken; playing = false;
    clearInterval(timer); cancelAnimationFrame(animation); timer = null; animation = null; visualQueue = [];
    audio.silence(); highlight(-1);
    document.body.classList.remove('is-playing');
    $('play-button').setAttribute('aria-pressed', 'false'); $('play-button').setAttribute('aria-label', 'ループを再生');
    $('play-label').textContent = '再生する'; document.querySelector('.play-icon').textContent = '▶';
    $('playback-status').textContent = 'READY TO PLAY'; $('visual-state').textContent = 'WAITING FOR YOUR FIRST NOTE';
    drawArt(0);
  }
  function togglePlay() { if (playing || starting) stop(); else start(); }

  const canvas = $('visualizer');
  const ctx = canvas.getContext('2d');
  function drawArt(timestamp) {
    if (!ctx) return;
    const width = 640, height = 440;
    ctx.clearRect(0, 0, width, height);
    const energy = audio.energy();
    const t = playing && !reducedMotion.matches ? timestamp / 2200 : 0;
    ctx.save(); ctx.translate(width / 2, height / 2); ctx.rotate(-0.32);
    const radius = 171 + energy * 40;
    ctx.fillStyle = '#d7ed9c'; ctx.beginPath();
    ctx.ellipse(0, 0, radius, radius * 0.96, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#586440'; ctx.lineWidth = 1.15;
    for (let ring = 0; ring < 23; ring++) {
      const r = 13 + ring * 7;
      ctx.beginPath();
      for (let point = 0; point <= 160; point++) {
        const a = point / 160 * Math.PI * 2;
        const wobble = Math.sin(a * 3 + t + ring * 0.16) * (3.5 + energy * 16) + Math.cos(a * 2 - t * 0.7) * 3;
        const x = Math.cos(a) * (r + wobble), y = Math.sin(a) * (r + wobble) * 0.96;
        if (point === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
  }

  $('play-button').addEventListener('click', togglePlay);
  $('random-button').addEventListener('click', () => { remember(); state.pattern = randomPattern(); state.muted.fill(false); changed(); toast('新しい偶然ができました。'); });
  $('clear-button').addEventListener('click', () => {
    if (!countNotes(state)) return;
    remember(); state.pattern = TRACKS.map(() => Array(STEPS).fill(false)); changed(); toast('まっさらになりました。「戻す」で取り消せます。');
  });
  $('undo-button').addEventListener('click', () => {
    if (!undoStack.length) return;
    const volume = state.volume; state = undoStack.pop(); state.volume = volume; changed(false); toast('ひとつ前のループに戻しました。');
  });
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
    remember(); state = getPreset(button.dataset.preset, state.volume); changed(false);
    toast(`${PRESETS[state.preset].name} に切り替えました。`);
  }));
  $('tempo').addEventListener('input', event => {
    if (!tempoEditing) { remember(); tempoEditing = true; }
    state.bpm = Number(event.target.value); changed();
  });
  ['change', 'blur'].forEach(type => $('tempo').addEventListener(type, () => { tempoEditing = false; }));
  $('volume').addEventListener('input', event => {
    state.volume = Number(event.target.value) / 100; render(); audio.setVolume(); save();
  });
  document.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
    const tag = event.target.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.target.isContentEditable) return;
    // Native button Space/Enter activation is preserved for keyboard accessibility.
    if (event.code === 'Space' && !['BUTTON', 'A'].includes(tag)) { event.preventDefault(); togglePlay(); }
    else if (event.key.toLowerCase() === 'r') { event.preventDefault(); $('random-button').click(); }
    else if (event.key === '?') { $('help-dialog').showModal(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); save(); } });
  window.addEventListener('pagehide', () => { stop(); save(); });
  window.addEventListener('hashchange', () => {
    const before = clone(state);
    if (readSharedLoop()) { undoStack.push(before); stop(); render(); save(); toast(startupMessage); }
    else if (new URLSearchParams(location.hash.slice(1)).has('loop')) toast(startupMessage);
  });

  async function share() {
    const url = new URL(location.href);
    url.hash = new URLSearchParams({ loop: encodeState(state) }).toString();
    $('share-url').value = url.href;
    const isLocal = ['file:'].includes(location.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    $('share-note').textContent = isLocal ? '現在はローカル表示です。別の端末へ共有するには、公開したサイトからこの操作を行ってください。' : 'リンク先では、再生ボタンを押すと音が鳴ります。';
    if (!isLocal && navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(url.href); toast('ループのURLをコピーしました。'); return; }
      catch { /* Permission denied: retain an explicit, selectable fallback. */ }
    }
    $('share-dialog').showModal(); $('share-url').focus(); $('share-url').select();
  }
  $('share-button').addEventListener('click', share);
  [$('help-button'), $('footer-help')].forEach(button => button.addEventListener('click', () => $('help-dialog').showModal()));
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  }));
  createGrid(); render();
  if (!canStore) $('save-status').textContent = '自動保存不可 · 共有で保存できます';
  if (startupMessage) toast(startupMessage);
})();

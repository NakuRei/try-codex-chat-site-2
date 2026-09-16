'use strict';

(() => {
  // Keep sibling GitHub Pages projects on the same origin isolated.
  const scope = new URL('.', window.location.href).pathname;
  const DATA_KEY = `yohaku:${scope}:notes:v1`;
  const SETTINGS_KEY = `yohaku:${scope}:settings:v1`;
  const MAX_NOTES = 1000;
  const $ = (selector) => document.querySelector(selector);
  const categories = {
    ideas: { label: 'アイデアの種', icon: 'spark' },
    reading: { label: '読書の余韻', icon: 'book' },
    work: { label: '仕事の気づき', icon: 'work' },
    life: { label: '日々のかけら', icon: 'leaf' },
  };
  const prompts = [
    '最近、つい誰かに\n話したくなったことは？',
    'いつもの一日から\nひとつだけ変えるなら？',
    '読み終えても、まだ\n心に残っている言葉は？',
    '「ちょっと不便」に\n隠れているアイデアは？',
    '去年の自分に\n教えてあげたいことは？',
    '役には立たないけど\n好きなものは？',
    '当たり前だと思っていた\nことを疑ってみるなら？',
    '今日、少しだけ\n心が動いた瞬間は？',
  ];
  const state = {
    notes: [], filter: 'all', tag: '', query: '', view: 'grid', sort: 'updated',
    theme: 'light', persistent: true, editing: null, original: '', baseUpdated: '',
    promptIndex: Math.floor(Date.now() / 86400000) % prompts.length,
  };
  let toastTimer;
  let confirming = false;
  const uuid = () => globalThis.crypto?.randomUUID?.() || `n-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const normalize = (text) => text.normalize('NFKC').toLocaleLowerCase('ja');

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(svg.namespaceURI, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
  }
  function storageWarning(message) {
    state.persistent = false;
    $('#storage-warning').textContent = message;
    $('#storage-warning').hidden = false;
    $('#storage-status').textContent = '一時保存のみ';
  }
  function sampleNotes() {
    return [
      ['「余白」を、予定に入れる。', 'なにもしない時間は、なにも生まない時間じゃない。\n\n予定を詰める代わりに、今日は30分だけ空けてみる。そのとき思いついたことを、ここに置いておこう。', 'ideas', ['アイデア', '余白'], true],
      ['本を閉じたあとの、あの時間。', '読み終えた直後の、まだ物語の中にいるような感覚。\n\nあらすじよりも、自分がどこで立ち止まったかを書き残したい。次に読むときは、違うところが気になるかもしれない。', 'reading', ['読書', 'ことば'], true],
      ['今日の発見は、帰り道に。', 'ひとつ手前の角を曲がったら、小さな喫茶店を見つけた。\n\nいつもの道にも、まだ知らない景色がある。次は本を一冊持って寄ってみよう。', 'life', ['日常', '発見'], false],
      ['「なぜ？」をひとつ増やす。', '答えを急ぐ前に、問いを確かめる。\n\n「どうすれば速くなる？」ではなく、「そもそも、なぜこの作業が必要なんだろう？」から考えてみる。明日の打ち合わせで試したい。', 'work', ['仕事', '学び'], false],
      ['いつかつくりたい、小さなもの。', '使うたびに、少しだけ気分がよくなる道具。\n\n・読んだ本を並べる小さな本棚\n・雨の日だけ開く日記\n・散歩で見つけた色のコレクション\n\nまずは、自分のためにつくってみよう。', 'ideas', ['アイデア', 'つくる'], false],
    ].map(([title, body, category, tags, favorite], index) => {
      const date = new Date(Date.now() - index * 86400000 - 3600000).toISOString();
      return { id: uuid(), title, body, category, tags, favorite, createdAt: date, updatedAt: date, sample: true };
    });
  }
  // Strict, bounded decoding also protects rendering and backup imports from malformed data.
  function decode(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.notes) || value.notes.length > MAX_NOTES) {
      throw new Error('対応する余白のバックアップではありません。');
    }
    const ids = new Set();
    return value.notes.map((note) => {
      if (!note || typeof note.id !== 'string' || !/^[\w-]{1,100}$/.test(note.id) || ids.has(note.id)
        || typeof note.title !== 'string' || !note.title.trim() || note.title.length > 120
        || typeof note.body !== 'string' || note.body.length > 30000
        || !Object.hasOwn(categories, note.category)
        || !Array.isArray(note.tags) || note.tags.length > 8
        || note.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 24)
        || typeof note.favorite !== 'boolean'
        || typeof note.createdAt !== 'string' || !Number.isFinite(Date.parse(note.createdAt))
        || typeof note.updatedAt !== 'string' || !Number.isFinite(Date.parse(note.updatedAt))) {
        throw new Error('ノートの形式が正しくないため、読み込みませんでした。');
      }
      ids.add(note.id);
      return {
        id: note.id, title: note.title.trim(), body: note.body, category: note.category,
        tags: [...new Set(note.tags.map((tag) => tag.trim()))], favorite: note.favorite,
        createdAt: new Date(note.createdAt).toISOString(), updatedAt: new Date(note.updatedAt).toISOString(),
        sample: note.sample === true,
      };
    });
  }
  function load() {
    let raw;
    try { raw = localStorage.getItem(DATA_KEY); }
    catch { storageWarning('保存領域を利用できません。ノートはこのタブを閉じると失われます。必要な内容はバックアップしてください。'); }
    if (raw == null) {
      state.notes = sampleNotes();
      persist();
    } else {
      try { state.notes = decode(JSON.parse(raw)); }
      catch {
        state.notes = [];
        storageWarning('保存データを読み取れません。元のデータは上書きしていません。ここでの編集は一時保存です。ブラウザのサイトデータを消す前に、元データを保全してください。');
      }
    }
    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (settings && typeof settings === 'object') {
        if (['light', 'dark'].includes(settings.theme)) state.theme = settings.theme;
        if (['grid', 'list'].includes(settings.view)) state.view = settings.view;
        if (['updated', 'created', 'title'].includes(settings.sort)) state.sort = settings.sort;
      }
    } catch { /* Display preferences are optional; malformed settings do not affect notes. */ }
  }
  function persist() {
    if (!state.persistent) return;
    try { localStorage.setItem(DATA_KEY, JSON.stringify({ version: 1, notes: state.notes })); }
    catch { storageWarning('保存容量が不足しているか、保存が許可されていません。変更はこのタブ内だけに保持されています。バックアップを書き出してください。'); }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: state.theme, view: state.view, sort: state.sort })); }
    catch { /* Notes persistence has its own, explicit error state. */ }
  }
  function refreshFromStorage() {
    if (!state.persistent) return;
    try {
      const raw = localStorage.getItem(DATA_KEY);
      state.notes = raw === null ? [] : decode(JSON.parse(raw));
    } catch { storageWarning('保存データへのアクセスに失敗しました。以後の変更は一時保存です。バックアップを書き出してください。'); }
  }
  function commit() { persist(); render(); }
  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    const dark = state.theme === 'dark';
    $('#theme-toggle').setAttribute('aria-pressed', String(dark));
    $('#theme-toggle').setAttribute('aria-label', `${dark ? 'ライト' : 'ダーク'}テーマに切り替える`);
    $('#theme-toggle').replaceChildren(icon(dark ? 'sun' : 'moon'));
    $('meta[name="theme-color"]').content = dark ? '#1e2420' : '#f7f7f2';
  }
  function dateLabel(value) {
    return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)).replaceAll('/', '.');
  }
  function filteredNotes() {
    const terms = normalize(state.query.trim()).split(/\s+/).filter(Boolean);
    return state.notes.filter((note) => {
      if (state.filter === 'favorites' && !note.favorite) return false;
      if (Object.hasOwn(categories, state.filter) && note.category !== state.filter) return false;
      if (state.tag && !note.tags.includes(state.tag)) return false;
      const text = normalize([note.title, note.body, ...note.tags].join(' '));
      return terms.every((term) => text.includes(term));
    }).sort((a, b) => {
      if (state.sort === 'title') return a.title.localeCompare(b.title, 'ja');
      const key = state.sort === 'created' ? 'createdAt' : 'updatedAt';
      return b[key].localeCompare(a[key]) || a.id.localeCompare(b.id);
    });
  }
  function makeCard(note) {
    const article = element('article', 'note-card');
    article.dataset.category = note.category;
    article.dataset.id = note.id;
    const top = element('div', 'card-top');
    const category = element('span', 'card-category');
    category.append(icon(categories[note.category].icon), document.createTextNode(categories[note.category].label));
    const star = element('button', 'icon-button card-star');
    star.type = 'button';
    star.setAttribute('aria-label', `${note.title}：お気に入り${note.favorite ? 'から外す' : 'に追加'}`);
    star.setAttribute('aria-pressed', String(note.favorite));
    star.append(icon('star'));
    star.addEventListener('click', () => {
      refreshFromStorage();
      const current = state.notes.find((item) => item.id === note.id);
      if (!current) { render(); toast('このノートは別のタブで削除されています。'); return; }
      current.favorite = !current.favorite;
      current.updatedAt = new Date().toISOString();
      commit();
      [...document.querySelectorAll('.note-card')].find((card) => card.dataset.id === note.id)?.querySelector('.card-star').focus();
    });
    top.append(category, star);
    const content = element('div', 'card-content');
    const heading = element('h3', 'card-title');
    const open = element('button', 'card-open', note.title);
    open.type = 'button';
    open.addEventListener('click', () => openEditor(note.id));
    heading.append(open);
    content.append(heading, element('p', 'card-preview', note.body || 'まだ本文のない、小さな考え。'));
    const tags = element('div', 'card-tags');
    note.tags.slice(0, 3).forEach((tag) => tags.append(element('span', '', `# ${tag}`)));
    const bottom = element('div', 'card-bottom');
    const left = element('span');
    const date = element('time', '', dateLabel(note.updatedAt));
    date.dateTime = note.updatedAt;
    left.append(date);
    if (note.sample) left.append(element('span', 'sample-label', 'SAMPLE'));
    bottom.append(left, icon('arrow'));
    article.append(top, content, tags, bottom);
    return article;
  }
  function render() {
    const visible = filteredNotes();
    const total = state.notes.length;
    $('#library-title').textContent = state.filter === 'all' ? 'すべてのノート' : state.filter === 'favorites' ? 'お気に入り' : categories[state.filter].label;
    $('#result-count').textContent = `${visible.length} ${visible.length === 1 ? 'note' : 'notes'}`;
    document.querySelectorAll('[data-filter]').forEach((button) => {
      const active = button.dataset.filter === state.filter;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-count]').forEach((node) => {
      const category = node.dataset.count;
      node.textContent = category === 'all' ? total : state.notes.filter((note) => category === 'favorites' ? note.favorite : note.category === category).length;
    });
    const tagCounts = new Map();
    state.notes.forEach((note) => note.tags.forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)));
    const tags = [...tagCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).slice(0, 8).map(([tag]) => tag);
    if (state.tag && !tags.includes(state.tag)) tags.push(state.tag);
    $('#tag-filters').replaceChildren(...tags.map((tag) => {
      const button = element('button', `tag-chip${state.tag === tag ? ' active' : ''}`, `# ${tag}`);
      button.setAttribute('aria-pressed', String(state.tag === tag));
      button.addEventListener('click', () => { state.tag = state.tag === tag ? '' : tag; render(); });
      return button;
    }));
    const filtering = Boolean(state.query.trim() || state.tag || state.filter !== 'all');
    $('#reset-filter').hidden = !filtering;
    const list = $('#notes');
    list.classList.toggle('list-view', state.view === 'list');
    list.replaceChildren(...visible.map(makeCard));
    if (visible.length && !filtering) {
      const add = element('button', 'new-card');
      add.append(icon('plus'), element('span', '', 'まだ、名前のないアイデア。'), element('small', '', '新しいノートを、ひとつ。'));
      add.addEventListener('click', () => openEditor());
      list.append(add);
    }
    $('#empty-state').hidden = visible.length !== 0;
    $('#empty-title').textContent = filtering ? 'まだ、見つからないみたいです。' : 'まっさらな余白です。';
    $('#empty-description').textContent = filtering ? '言葉を変えるか、絞り込みをはずしてみましょう。' : '最初のひとことから、はじめてみましょう。';
    $('#empty-action').textContent = filtering ? '絞り込みを解除' : 'ノートを書く';
    ['grid', 'list'].forEach((view) => {
      $(`#${view}-view`).classList.toggle('selected', state.view === view);
      $(`#${view}-view`).setAttribute('aria-pressed', String(state.view === view));
    });
    $('#sort').value = state.sort;
  }
  function resetFilters() { state.filter = 'all'; state.tag = ''; state.query = ''; $('#search').value = ''; render(); }
  function formSnapshot() {
    return JSON.stringify({ title: $('#note-title').value, body: $('#note-body').value, category: $('#note-category').value, tags: $('#note-tags').value, favorite: $('#note-favorite').checked });
  }
  function isDirty() { return $('#editor').open && state.original !== formSnapshot(); }
  function openEditor(id = null, prompt = '') {
    if ($('#editor').open) return;
    closeMenu();
    refreshFromStorage();
    const note = id ? state.notes.find((item) => item.id === id) : null;
    if (id && !note) { render(); toast('このノートは別のタブで削除されています。'); return; }
    state.editing = id;
    state.baseUpdated = note?.updatedAt || '';
    $('#note-title').value = note?.title || prompt;
    $('#note-body').value = note?.body || '';
    $('#note-category').value = note?.category || (Object.hasOwn(categories, state.filter) ? state.filter : 'ideas');
    $('#note-tags').value = note?.tags.join(', ') || '';
    $('#note-favorite').checked = note?.favorite || false;
    $('#delete-note').hidden = !note;
    $('#editor-error').hidden = true;
    $('#char-count').textContent = `${$('#note-body').value.length.toLocaleString('ja-JP')} 文字`;
    state.original = formSnapshot();
    $('#editor').showModal();
    (prompt ? $('#note-body') : $('#note-title')).focus();
  }
  function ask(title, description, action = '続ける') {
    if (confirming) return Promise.resolve(false);
    confirming = true;
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-description').textContent = description;
    $('#confirm-ok').textContent = action;
    dialog.returnValue = 'cancel';
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener('close', () => {
      confirming = false;
      resolve(dialog.returnValue === 'ok');
    }, { once: true }));
  }
  function finishEditing() {
    $('#editor').close();
    state.editing = null;
    state.original = '';
    $('#new-note').focus();
  }
  async function requestClose() {
    if (!isDirty() || await ask('変更を保存せずに閉じますか？', '保存していない変更は失われます。', '保存せずに閉じる')) finishEditing();
  }
  function formError(message) { $('#editor-error').textContent = message; $('#editor-error').hidden = false; }
  function saveNote(event) {
    event.preventDefault();
    if (confirming) return;
    const title = $('#note-title').value.trim();
    if (!title) { formError('タイトルを入力してください。'); $('#note-title').focus(); return; }
    const tags = [...new Set($('#note-tags').value.split(/[,、，\n]/).map((tag) => tag.trim().replace(/^#+\s*/, '')).filter(Boolean))];
    if (tags.length > 8 || tags.some((tag) => tag.length > 24)) { formError('タグは8個まで、1個あたり24文字以内で入力してください。'); return; }
    refreshFromStorage();
    const current = state.notes.find((note) => note.id === state.editing);
    if (state.editing && (!current || current.updatedAt !== state.baseUpdated)) {
      formError('別のタブでこのノートが変更されています。上書きはしていません。入力内容をコピーしてから開き直してください。'); return;
    }
    if (!current && state.notes.length >= MAX_NOTES) { formError('ノートは1,000件までです。不要なノートを整理してください。'); return; }
    const now = new Date().toISOString();
    const note = {
      id: current?.id || uuid(), title, body: $('#note-body').value,
      category: $('#note-category').value, tags, favorite: $('#note-favorite').checked,
      createdAt: current?.createdAt || now, updatedAt: now, sample: false,
    };
    if (current) state.notes = state.notes.map((item) => item.id === current.id ? note : item);
    else { state.notes.unshift(note); resetFilters(); }
    commit();
    finishEditing();
    toast(state.persistent ? '小さな考えを、保存しました。' : 'このタブ内に一時保存しました。バックアップをおすすめします。');
  }
  async function deleteNote() {
    const id = state.editing;
    if (!id || !await ask('このノートを削除しますか？', '削除したノートは元に戻せません。必要な場合は先にバックアップしてください。', '削除する')) return;
    refreshFromStorage();
    const current = state.notes.find((note) => note.id === id);
    if (current && current.updatedAt !== state.baseUpdated) { formError('別のタブで変更されたため削除していません。開き直して内容を確認してください。'); return; }
    state.notes = state.notes.filter((note) => note.id !== id);
    commit();
    finishEditing();
    toast('ノートを削除しました。');
  }
  function exportBackup() {
    refreshFromStorage();
    const data = { version: 1, exportedAt: new Date().toISOString(), notes: state.notes };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = element('a');
    link.href = url;
    link.download = `yohaku-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    toast('バックアップを書き出しました。');
  }
  async function importBackup(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('10 MB以下のJSONファイルを選んでください。'); return; }
    try {
      const incoming = decode(JSON.parse(await file.text()));
      if (!incoming.length) { toast('このバックアップにはノートがありません。'); return; }
      if (!await ask('バックアップを読み込みますか？', `${incoming.length}件のノートを読み込みます。既存のノートは残し、同じIDのノートは更新日が新しい方を採用します。`, '読み込む')) return;
      refreshFromStorage();
      const merged = new Map(state.notes.map((note) => [note.id, note]));
      let changed = 0;
      incoming.forEach((note) => {
        const old = merged.get(note.id);
        if (!old || old.updatedAt < note.updatedAt) { merged.set(note.id, note); changed++; }
      });
      if (merged.size > MAX_NOTES) { toast('合計1,000件を超えるため読み込みませんでした。'); return; }
      state.notes = [...merged.values()];
      resetFilters();
      commit();
      toast(`${changed}件のノートを追加・更新しました。${state.persistent ? '' : 'このタブ内だけの一時保存です。'}`);
    } catch (error) { toast(error instanceof SyntaxError ? 'JSONファイルを読み取れません。既存のノートは変更していません。' : error.message || 'ファイルを読み取れません。'); }
    finally { $('#import-file').value = ''; }
  }
  function renderPrompt() {
    $('#prompt-text').textContent = prompts[state.promptIndex];
    $('#prompt-number').textContent = `NO. ${String(state.promptIndex + 1).padStart(2, '0')} / 08`;
  }
  function closeMenu() {
    $('#sidebar').classList.remove('open');
    $('#sidebar-shade').hidden = true;
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
  }

  load();
  applyTheme();
  render();
  renderPrompt();
  const today = new Date();
  $('#today').dateTime = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  $('#today').textContent = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(today).toUpperCase();
  $('#new-note').addEventListener('click', () => openEditor());
  $('#close-editor').addEventListener('click', requestClose);
  $('#editor').addEventListener('cancel', (event) => { event.preventDefault(); requestClose(); });
  $('#note-form').addEventListener('submit', saveNote);
  $('#delete-note').addEventListener('click', deleteNote);
  $('#note-body').addEventListener('input', () => { $('#char-count').textContent = `${$('#note-body').value.length.toLocaleString('ja-JP')} 文字`; });
  $('#search').addEventListener('input', (event) => { state.query = event.target.value; render(); });
  $('#sort').addEventListener('change', (event) => { state.sort = event.target.value; saveSettings(); render(); });
  $('#reset-filter').addEventListener('click', resetFilters);
  $('#empty-action').addEventListener('click', () => { if (state.query.trim() || state.tag || state.filter !== 'all') resetFilters(); else openEditor(); });
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    state.tag = '';
    state.query = '';
    $('#search').value = '';
    closeMenu();
    render();
  }));
  ['grid', 'list'].forEach((view) => $(`#${view}-view`).addEventListener('click', () => { state.view = view; saveSettings(); render(); }));
  $('#theme-toggle').addEventListener('click', () => { state.theme = state.theme === 'light' ? 'dark' : 'light'; applyTheme(); saveSettings(); });
  $('#shuffle-prompt').addEventListener('click', () => { state.promptIndex = (state.promptIndex + 1) % prompts.length; renderPrompt(); });
  $('#use-prompt').addEventListener('click', () => openEditor(null, prompts[state.promptIndex].replace('\n', '')));
  $('#export').addEventListener('click', exportBackup);
  $('#import').addEventListener('click', () => { $('#import-file').value = ''; $('#import-file').click(); });
  $('#import-file').addEventListener('change', (event) => importBackup(event.target.files[0]));
  $('#menu-toggle').addEventListener('click', () => {
    const open = !$('#sidebar').classList.contains('open');
    $('#sidebar').classList.toggle('open', open);
    $('#sidebar-shade').hidden = !open;
    $('#menu-toggle').setAttribute('aria-expanded', String(open));
    menuAccessibility();
    if (open) $('#sidebar .nav-item').focus();
  });
  $('#sidebar-shade').addEventListener('click', closeMenu);
  const mobile = matchMedia('(max-width: 680px)');
  function menuAccessibility() { $('#sidebar').inert = mobile.matches && !$('#sidebar').classList.contains('open'); }
  new MutationObserver(menuAccessibility).observe($('#sidebar'), { attributes: true, attributeFilter: ['class'] });
  mobile.addEventListener('change', () => { closeMenu(); menuAccessibility(); });
  menuAccessibility();
  document.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if ($('#confirm-dialog').open) return;
    if ($('#editor').open) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); $('#note-form').requestSubmit(); }
      return;
    }
    if (event.key === 'Escape') { closeMenu(); return; }
    const typing = event.target.closest('input, textarea, select, [contenteditable="true"]');
    if (typing) return;
    if (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
      event.preventDefault(); closeMenu(); $('#search').focus();
    } else if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); openEditor();
    }
  });
  window.addEventListener('beforeunload', (event) => { if (isDirty()) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('storage', (event) => {
    if (event.key === DATA_KEY || event.key === null) { refreshFromStorage(); render(); }
  });
})();

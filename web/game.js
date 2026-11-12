/* HangPeeps — an offline, kid-friendly Hangman game.
 * Peep floats on balloons; each wrong guess pops one and Peep drifts lower.
 * Guess the word to send Peep flying home. Everything is stored locally.
 */
(() => {
  'use strict';

  const VERSION = '1.0';
  const KEYS = {
    words: 'hp.words.v1',       // imported word list (null = built-in list)
    progress: 'hp.progress.v1', // per-word stats, kept separate from the list
    history: 'hp.history.v1',   // recent rounds
    settings: 'hp.settings.v1',
  };
  const DEFAULT_SETTINGS = { maxMisses: 6, shortWords: true, caps: false, sound: true, speak: true, sayFirst: false };
  const MIN_BALLOONS = 3, MAX_BALLOONS = 10, HISTORY_CAP = 500;
  const BALLOON_COLORS = ['#ff6b6b', '#ffb347', '#ffd93d', '#6bcB77', '#4d96ff', '#b983ff', '#ff8fd8', '#38c6c6', '#ff9f68', '#8ad1ff'];
  const ALL = '__all__', PRACTICE = '__practice__';

  // ---------- storage ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: play on */ }
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const rows = []; let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(f => f.trim() !== ''));
  }

  function yesNo(v) {
    v = String(v || '').trim().toLowerCase();
    if (['yes', 'y', 'true', '1', 'x', '✓'].includes(v)) return true;
    if (['no', 'n', 'false', '0'].includes(v)) return false;
    return null; // blank = not assessed
  }

  /** Returns { words: [{word, source, bonus, reading, writing}], skipped: [] }. */
  function wordsFromCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { words: [], skipped: [] };
    const head = rows[0].map(h => h.trim().toLowerCase());
    let col = { word: head.indexOf('word'), source: head.indexOf('source_list'), bonus: head.indexOf('bonus_word'),
      reading: head.indexOf('reading_mastered'), writing: head.indexOf('writing_mastered') };
    let body = rows.slice(1);
    if (col.word < 0) { col = { word: 0, source: -1, bonus: -1, reading: -1, writing: -1 }; body = rows; } // headerless list
    const words = [], skipped = [], seen = new Set();
    for (const r of body) {
      const raw = (r[col.word] || '').trim();
      const word = raw.toLowerCase();
      if (!/^[a-z][a-z' -]*$/.test(word) || !/[a-z]/.test(word)) { if (raw) skipped.push(raw); continue; }
      const source = (col.source >= 0 && (r[col.source] || '').trim()) || 'My Words';
      const key = source + '|' + word;
      if (seen.has(key)) continue;
      seen.add(key);
      words.push({ word, source, bonus: col.bonus >= 0 && yesNo(r[col.bonus]) === true,
        reading: col.reading >= 0 ? yesNo(r[col.reading]) : null, writing: col.writing >= 0 ? yesNo(r[col.writing]) : null });
    }
    return { words, skipped };
  }

  // ---------- state ----------
  let settings = Object.assign({}, DEFAULT_SETTINGS, load(KEYS.settings, {}));
  let progress = load(KEYS.progress, {});
  let history = load(KEYS.history, []);
  let wordList = load(KEYS.words, null) || wordsFromCSV(window.HP_BUILTIN_CSV).words;
  let recent = [];
  let game = null;

  const $ = id => document.getElementById(id);
  const isLetter = ch => ch >= 'a' && ch <= 'z';
  const prog = w => progress[w] || (progress[w] = { played: 0, won: 0, lost: 0, hits: 0, misses: 0, last: null, lastAt: null, reading: null, writing: null });
  const needsPractice = p => !!p && (p.last === 'lost' || p.lost > p.won);
  const sources = () => [...new Set(wordList.map(w => w.source))];
  const displayWord = w => (w === 'i' ? 'I' : w);

  function mastered(entry, kind) {
    const p = progress[entry.word];
    return p && p[kind] !== null && p[kind] !== undefined ? p[kind] : entry[kind];
  }

  // ---------- sound & speech ----------
  let audio = null;
  function tone(freq, dur, type = 'sine', when = 0, vol = 0.18) {
    if (!settings.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime + when, o = audio.createOscillator(), g = audio.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
    } catch { /* no audio */ }
  }
  const sfx = {
    hit: () => { tone(660, 0.12, 'triangle'); tone(880, 0.16, 'triangle', 0.08); },
    pop: () => { tone(180, 0.08, 'square', 0, 0.12); tone(90, 0.12, 'sine', 0.02, 0.2); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', i * 0.12)),
    lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'sine', i * 0.18)),
  };
  function speak(text) {
    try {
      if (window.Android && window.Android.speak) { window.Android.speak(text); return; }
      if (window.speechSynthesis) {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text); u.rate = 0.8; u.lang = 'en-US';
        speechSynthesis.speak(u);
      }
    } catch { /* no speech */ }
  }

  // ---------- screens ----------
  function show(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    current = name;
  }
  let current = 'home';

  // ---------- SVG helpers ----------
  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /** Draws Peep centred on (0,0) into parent; returns handles for the face. */
  function drawPeep(parent) {
    const g = el('g', { class: 'peep' }, parent);
    el('ellipse', { cx: -16, cy: 44, rx: 10, ry: 4, fill: '#f29a2e' }, g); // feet
    el('ellipse', { cx: 16, cy: 44, rx: 10, ry: 4, fill: '#f29a2e' }, g);
    el('path', { d: 'M-16 36 v8 M16 36 v8', stroke: '#f29a2e', 'stroke-width': 4, 'stroke-linecap': 'round' }, g);
    el('ellipse', { cx: 0, cy: 0, rx: 42, ry: 40, fill: '#ffd84d' }, g); // body
    el('ellipse', { cx: 0, cy: 12, rx: 28, ry: 22, fill: '#ffe98f' }, g); // tummy
    el('path', { d: 'M-40 4 q-18 6 -10 22 q10 -4 14 -12z', fill: '#f5c431' }, g); // wings
    el('path', { d: 'M40 4 q18 6 10 22 q-10 -4 -14 -12z', fill: '#f5c431' }, g);
    el('path', { d: 'M-6 -40 q2 -14 10 -12 q-6 4 -2 12 M2 -40 q8 -12 14 -6 q-8 0 -8 6', fill: '#f5c431' }, g); // tuft
    const face = el('g', {}, g);
    el('ellipse', { cx: -22, cy: 2, rx: 7, ry: 4, fill: '#ffaaa5', opacity: .8 }, face); // cheeks
    el('ellipse', { cx: 22, cy: 2, rx: 7, ry: 4, fill: '#ffaaa5', opacity: .8 }, face);
    const eyes = el('g', {}, face);
    const beak = el('path', { d: 'M-7 -2 L7 -2 L0 8 Z', fill: '#f29a2e', 'stroke-linejoin': 'round' }, face);
    setEyes(eyes, 'open');
    return { g, eyes, beak };
  }
  function setEyes(eyes, mood) {
    eyes.innerHTML = '';
    if (mood === 'happy') {
      el('path', { d: 'M-20 -10 q6 -8 12 0 M8 -10 q6 -8 12 0', stroke: '#23324a', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }, eyes);
    } else if (mood === 'dizzy') {
      el('path', { d: 'M-19 -16 l10 10 M-9 -16 l-10 10 M9 -16 l10 10 M19 -16 l-10 10', stroke: '#23324a', 'stroke-width': 3.5, 'stroke-linecap': 'round' }, eyes);
    } else {
      const worried = mood === 'worried';
      for (const x of [-14, 14]) {
        el('circle', { cx: x, cy: -11, r: 7, fill: '#23324a' }, eyes);
        el('circle', { cx: x + 2.5, cy: -13.5, r: 2.4, fill: '#fff' }, eyes);
      }
      if (worried) el('path', { d: 'M-22 -24 l12 4 M22 -24 l-12 4', stroke: '#23324a', 'stroke-width': 3, 'stroke-linecap': 'round' }, eyes);
    }
  }

  function balloonLayout(n) {
    const out = [], spread = Math.min(70, 18 + n * 6);
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? 0 : (-spread + (2 * spread * i) / (n - 1)) * Math.PI / 180;
      const L = 112 + (i % 2) * 26;
      out.push({ x: Math.sin(a) * L, y: -46 - Math.cos(a) * L });
    }
    return out;
  }

  function drawBalloons(parent, n, startIndex = 0) {
    const strings = el('g', {}, parent), balloons = el('g', {}, parent), list = [];
    balloonLayout(n).forEach((p, i) => {
      const color = BALLOON_COLORS[(i + startIndex) % BALLOON_COLORS.length];
      const s = el('path', { class: 'string', d: `M0 -40 Q${p.x * 0.4} ${(p.y - 40) / 2 + 10} ${p.x} ${p.y + 34}`, stroke: '#7a8798', 'stroke-width': 1.6, fill: 'none' }, strings);
      const b = el('g', { class: 'balloon sway', style: `animation-delay:${-i * 0.37}s` }, balloons);
      el('ellipse', { cx: p.x, cy: p.y, rx: 25, ry: 31, fill: color }, b);
      el('path', { d: `M${p.x - 5} ${p.y + 35} L${p.x + 5} ${p.y + 35} L${p.x} ${p.y + 29}Z`, fill: color }, b);
      el('ellipse', { cx: p.x - 9, cy: p.y - 12, rx: 6, ry: 10, fill: '#fff', opacity: .45 }, b);
      list.push({ g: b, s, x: p.x, y: p.y, color });
    });
    return list;
  }

  function drawHero() {
    const svg = $('hero-svg');
    svg.innerHTML = '';
    const bob = el('g', { class: 'peep-bob' }, svg);
    drawBalloons(bob, 5, 2);
    drawPeep(bob);
  }

  // ---------- scene ----------
  const GROUND_Y = 462, TOP_Y = 236, LANDED_Y = GROUND_Y - 46;
  let scene = null;

  function buildScene(n) {
    const svg = $('scene');
    svg.innerHTML = '';
    for (const [x, y, s] of [[60, 70, 1], [270, 120, 0.8], [-60, 190, 0.7]]) {
      const c = el('g', { class: 'cloud', style: `animation-delay:${-x / 12}s` }, svg);
      const cg = el('g', { transform: `translate(${x} ${y}) scale(${s})`, fill: '#fff', opacity: .9 }, c);
      el('ellipse', { cx: 0, cy: 0, rx: 40, ry: 18 }, cg); el('ellipse', { cx: 26, cy: -10, rx: 26, ry: 18 }, cg); el('ellipse', { cx: -22, cy: -6, rx: 20, ry: 14 }, cg);
    }
    // ground runs well past the viewBox so it fills the screen's full width (svg overflow is visible)
    el('path', { d: `M-1600 ${GROUND_Y} Q-1400 ${GROUND_Y - 18} -1200 ${GROUND_Y} T-800 ${GROUND_Y} T-400 ${GROUND_Y} T0 ${GROUND_Y} T400 ${GROUND_Y} T800 ${GROUND_Y} T1200 ${GROUND_Y} T1600 ${GROUND_Y} T2000 ${GROUND_Y} V900 H-1600Z`, fill: 'var(--grass)' }, svg);
    el('path', { d: `M-1600 ${GROUND_Y + 14} Q-1380 ${GROUND_Y} -1180 ${GROUND_Y + 12} T-780 ${GROUND_Y + 8} T-380 ${GROUND_Y + 12} T20 ${GROUND_Y + 8} T420 ${GROUND_Y + 12} T820 ${GROUND_Y + 8} T1220 ${GROUND_Y + 12} T1620 ${GROUND_Y + 8} T2020 ${GROUND_Y + 12} V900 H-1600Z`, fill: 'var(--grass-dark)' }, svg);
    for (const [x, c] of [[40, '#ff8fd8'], [340, '#ffd93d'], [372, '#ff6b6b']]) {
      el('path', { d: `M${x} ${GROUND_Y + 4} v-14`, stroke: '#3f8a35', 'stroke-width': 2 }, svg);
      el('circle', { cx: x, cy: GROUND_Y - 12, r: 5, fill: c }, svg);
    }
    const move = el('g', { class: 'peep-move' }, svg);
    const bob = el('g', { class: 'peep-bob' }, move);
    const balloons = drawBalloons(bob, n, Math.floor(Math.random() * BALLOON_COLORS.length));
    const peep = drawPeep(bob);
    const fx = el('g', {}, svg);
    scene = { svg, move, bob, balloons, peep, fx };
    placePeep(TOP_Y, true);
  }

  function placePeep(y, instant) {
    if (instant) scene.move.style.transition = 'none';
    scene.move.style.transform = `translate(200px, ${y}px)`;
    if (instant) { void scene.move.getBoundingClientRect(); scene.move.style.transition = ''; }
  }

  function popBalloon(index) {
    const b = scene.balloons[index];
    if (!b) return;
    b.g.classList.remove('sway');
    b.g.classList.add('popping');
    b.s.classList.add('cut');
    const y = parseFloat(scene.move.style.transform.split(',')[1]) || TOP_Y;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const sh = el('circle', { class: 'shard', cx: 200 + b.x, cy: y + b.y, r: 4, fill: b.color,
        style: `--dx:${Math.cos(a) * 46}px;--dy:${Math.sin(a) * 46}px` }, scene.fx);
      setTimeout(() => sh.remove(), 600);
    }
  }

  function confetti() {
    for (let i = 0; i < 40; i++) {
      const c = el('rect', { class: 'confetti', x: Math.random() * 400, y: -20 - Math.random() * 80, width: 8, height: 12, rx: 2,
        fill: BALLOON_COLORS[i % BALLOON_COLORS.length],
        style: `--dx:${(Math.random() - .5) * 120}px;animation-delay:${Math.random() * .5}s` }, scene.fx);
      setTimeout(() => c.remove(), 2600);
    }
  }

  // ---------- word picking ----------
  function poolFor(mode) {
    if (mode === PRACTICE) {
      const seen = new Set();
      return wordList.filter(w => needsPractice(progress[w.word]) && !seen.has(w.word) && seen.add(w.word));
    }
    let pool = mode === ALL ? wordList : wordList.filter(w => w.source === mode);
    if (mode === ALL) { const seen = new Set(); pool = pool.filter(w => !seen.has(w.word) && seen.add(w.word)); }
    if (!settings.shortWords) {
      const longer = pool.filter(w => w.word.replace(/[^a-z]/g, '').length > 3);
      if (longer.length) pool = longer;
    }
    return pool;
  }

  function weightOf(w) {
    const p = progress[w.word];
    if (!p) return 2; // new words a bit more likely than well-known ones
    let wt = 1 + Math.max(0, p.lost - p.won) * 2;
    if (p.last === 'lost') wt += 3;
    return wt;
  }

  function pickWord(mode) {
    const pool = poolFor(mode);
    if (!pool.length) return null;
    const avoid = new Set(recent.slice(-Math.min(6, pool.length - 1)));
    const candidates = pool.filter(w => !avoid.has(w.word));
    const list = candidates.length ? candidates : pool;
    const total = list.reduce((s, w) => s + weightOf(w), 0);
    let r = Math.random() * total;
    for (const w of list) { r -= weightOf(w); if (r <= 0) return w; }
    return list[list.length - 1];
  }

  function modeName(mode) {
    return mode === ALL ? 'All Words' : mode === PRACTICE ? 'Practice missed words' : mode;
  }

  // ---------- game ----------
  function startGame(mode) {
    const entry = pickWord(mode);
    if (!entry) { toast(mode === PRACTICE ? 'No missed words to practise. Great job!' : 'This list has no words yet.'); show('home'); renderHome(); return; }
    recent.push(entry.word); if (recent.length > 20) recent.shift();
    game = { mode, entry, word: entry.word, guessed: new Set(), wrong: [], max: settings.maxMisses, over: false };
    $('mode-label').textContent = modeName(mode);
    $('btn-say').hidden = !settings.sayFirst;
    $('result').hidden = true;
    document.body.classList.toggle('caps', settings.caps);
    buildScene(game.max);
    setEyes(scene.peep.eyes, 'open');
    renderWord();
    renderKeyboard();
    renderWrong();
    updateCount();
    show('game');
    if (settings.sayFirst) setTimeout(() => speak(displayWord(game.word)), 350);
  }

  function renderWord(revealAll = false) {
    const box = $('word');
    box.innerHTML = '';
    for (const ch of game.word) {
      const t = document.createElement('div');
      if (!isLetter(ch)) { t.className = 'tile fixed'; t.textContent = ch === ' ' ? ' ' : ch; box.appendChild(t); continue; }
      const known = game.guessed.has(ch);
      t.className = 'tile' + (known ? ' shown' : revealAll ? ' shown missed' : '');
      t.textContent = known || revealAll ? (game.word === 'i' ? 'I' : ch) : '';
      box.appendChild(t);
    }
    box.setAttribute('aria-label', [...game.word].map(c => (!isLetter(c) || game.guessed.has(c) ? c : 'blank')).join(' '));
  }

  function renderKeyboard() {
    const kb = $('keyboard');
    kb.innerHTML = '';
    for (const row of ['abcdefg', 'hijklmn', 'opqrstu', 'vwxyz']) {
      const r = document.createElement('div'); r.className = 'krow';
      for (const ch of row) {
        const k = document.createElement('button');
        k.type = 'button'; k.className = 'key'; k.textContent = ch; k.dataset.letter = ch;
        k.setAttribute('aria-label', 'Letter ' + ch);
        r.appendChild(k);
      }
      kb.appendChild(r);
    }
  }

  function renderWrong() {
    $('wrong').innerHTML = game.wrong.map(c => `<span>${c}</span>`).join('');
  }

  function updateCount() {
    const left = game.max - game.wrong.length;
    $('balloon-count').textContent = '🎈 ' + left;
    const y = TOP_Y + (LANDED_Y - TOP_Y) * (game.wrong.length / game.max);
    placePeep(y);
    if (!game.over) setEyes(scene.peep.eyes, left <= 2 ? 'worried' : 'open');
  }

  function guess(ch) {
    if (!game || game.over || !isLetter(ch) || game.guessed.has(ch)) return; // repeat guesses are free
    game.guessed.add(ch);
    const key = document.querySelector(`.key[data-letter="${ch}"]`);
    const p = prog(game.word);
    if (game.word.includes(ch)) {
      p.hits++;
      if (key) { key.classList.add('hit'); key.disabled = true; }
      sfx.hit();
      renderWord();
      if ([...game.word].every(c => !isLetter(c) || game.guessed.has(c))) finish(true);
    } else {
      p.misses++;
      game.wrong.push(ch);
      if (key) { key.classList.add('miss'); key.disabled = true; }
      popBalloon(game.wrong.length - 1);
      sfx.pop();
      renderWrong();
      updateCount();
      if (game.wrong.length >= game.max) finish(false);
    }
    save(KEYS.progress, progress);
  }

  function finish(won) {
    game.over = true;
    const p = prog(game.word);
    p.played++; if (won) p.won++; else p.lost++;
    p.last = won ? 'won' : 'lost'; p.lastAt = Date.now();
    history.push({ word: game.word, list: modeName(game.mode), result: p.last, wrong: game.wrong.join(''), at: p.lastAt });
    if (history.length > HISTORY_CAP) history = history.slice(-HISTORY_CAP);
    save(KEYS.progress, progress); save(KEYS.history, history);
    document.querySelectorAll('.key').forEach(k => (k.disabled = true));

    if (won) {
      setEyes(scene.peep.eyes, 'happy');
      sfx.win(); confetti();
      scene.move.style.transition = 'transform 1.8s ease-in';
      setTimeout(() => placePeep(-260), 700);
    } else {
      renderWord(true);
      setEyes(scene.peep.eyes, 'dizzy');
      sfx.lose();
      const stars = el('g', { class: 'dizzy' }, scene.bob);
      for (let i = 0; i < 3; i++) el('text', { x: Math.cos(i * 2.1) * 34, y: -52 + Math.sin(i * 2.1) * 8, 'font-size': 18, 'text-anchor': 'middle' }, stars).textContent = '⭐';
    }
    setTimeout(() => {
      $('result-title').textContent = won ? pickOne(['Peep is flying home!', 'You did it!', 'Super speller!', 'Hooray!']) : 'Bump! Peep landed safely.';
      $('result-word').textContent = displayWord(game.word);
      $('result-msg').textContent = won
        ? (game.wrong.length === 0 ? 'Not a single balloon popped! 🌟' : `You saved ${game.max - game.wrong.length} balloon${game.max - game.wrong.length === 1 ? '' : 's'}.`)
        : 'That was the word. Let\'s try another one!';
      $('result').hidden = false;
      if (settings.speak) speak(displayWord(game.word));
    }, won ? 1500 : 1100);
  }

  const pickOne = a => a[Math.floor(Math.random() * a.length)];

  // ---------- home ----------
  function renderHome() {
    const grid = $('mode-grid');
    grid.innerHTML = '';
    const add = (mode, name, sub, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mode-btn ' + cls; b.dataset.mode = mode;
      b.innerHTML = `<span class="mode-name"></span><span class="mode-sub"></span>`;
      b.querySelector('.mode-name').textContent = name;
      b.querySelector('.mode-sub').textContent = sub;
      grid.appendChild(b);
      return b;
    };
    const srcs = sources();
    for (const s of srcs) add(s, s, `${wordList.filter(w => w.source === s).length} words`);
    if (srcs.length > 1) add(ALL, 'All Words', `${poolFor(ALL).length} words`);
    const missed = poolFor(PRACTICE).length;
    const pb = add(PRACTICE, '🔁 Practice missed words', missed ? `${missed} word${missed === 1 ? '' : 's'} to practise` : 'Nothing missed yet!', 'practice');
    pb.disabled = missed === 0;
    const wins = Object.values(progress).reduce((s, p) => s + (p.won || 0), 0);
    $('home-stars').textContent = wins ? `⭐ ${wins} word${wins === 1 ? '' : 's'} guessed so far` : '';
  }

  // ---------- parent area ----------
  async function parentGate() {
    const a = 3 + Math.floor(Math.random() * 7), b = 3 + Math.floor(Math.random() * 7);
    const ans = await ask(`Grown-ups only:\nWhat is ${a} × ${b}?`, ['Cancel', 'OK'], true);
    if (ans && ans.button === 'OK') {
      if (parseInt(ans.value, 10) === a * b) { openParent(); } else toast('Not quite — ask a grown-up!');
    }
  }

  function openParent() {
    $('set-misses').textContent = settings.maxMisses;
    $('set-short').checked = settings.shortWords;
    $('set-caps').checked = settings.caps;
    $('set-sound').checked = settings.sound;
    $('set-speak').checked = settings.speak;
    $('set-sayfirst').checked = settings.sayFirst;
    $('version').textContent = 'v' + VERSION;
    $('export-out').hidden = true;
    const f = $('prog-filter');
    f.innerHTML = '';
    for (const [v, t] of [[ALL, 'All lists'], ...sources().map(s => [s, s])]) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; f.appendChild(o);
    }
    renderProgress(); renderHistory(); renderListSummary();
    show('parent');
  }

  function renderProgress() {
    const filter = $('prog-filter').value || ALL, sort = $('prog-sort').value;
    const seen = new Set();
    let rows = wordList.filter(w => (filter === ALL || w.source === filter) && !seen.has(w.word) && seen.add(w.word));
    const P = w => progress[w.word] || { played: 0, won: 0, lost: 0 };
    if (sort === 'alpha') rows.sort((a, b) => a.word.localeCompare(b.word));
    else if (sort === 'played') rows.sort((a, b) => P(b).played - P(a).played || a.word.localeCompare(b.word));
    else rows.sort((a, b) => (P(b).lost - P(b).won) - (P(a).lost - P(a).won) || P(b).lost - P(a).lost || a.word.localeCompare(b.word));
    const t = $('prog-table');
    t.innerHTML = '<thead><tr><th>Word</th><th class="num">Played</th><th class="num">Guessed</th><th class="num">Missed</th><th>Last</th><th>Mastered</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const w of rows) {
      const p = P(w), tr = document.createElement('tr');
      tr.innerHTML = `<td><b></b>${w.bonus ? ' ★' : ''}</td><td class="num">${p.played}</td><td class="num">${p.won}</td><td class="num">${p.lost}</td>
        <td class="${p.last ? 'res-' + p.last : ''}">${p.last ? (p.last === 'won' ? '✓' : '✗') : '–'}</td><td></td>`;
      tr.querySelector('b').textContent = displayWord(w.word);
      const cell = tr.lastElementChild;
      for (const [kind, label] of [['reading', 'R'], ['writing', 'W']]) {
        const m = document.createElement('button');
        m.type = 'button'; m.className = 'mark' + (mastered(w, kind) ? ' on' : ''); m.textContent = label;
        m.title = kind === 'reading' ? 'Reading mastered' : 'Writing mastered';
        m.onclick = () => { const pr = prog(w.word); pr[kind] = !mastered(w, kind); save(KEYS.progress, progress); m.classList.toggle('on', pr[kind]); };
        cell.appendChild(m); cell.append(' ');
      }
      tb.appendChild(tr);
    }
    t.appendChild(tb);
  }

  function renderHistory() {
    const t = $('hist-table');
    const rows = history.slice(-60).reverse();
    if (!rows.length) { t.innerHTML = '<tbody><tr><td>No rounds played yet.</td></tr></tbody>'; return; }
    t.innerHTML = '<thead><tr><th>When</th><th>Word</th><th>Result</th><th>Wrong letters</th><th>List</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const h of rows) {
      const tr = document.createElement('tr');
      const d = new Date(h.at);
      tr.innerHTML = `<td>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</td>
        <td><b></b></td><td class="res-${h.result}">${h.result === 'won' ? 'Guessed' : 'Missed'}</td><td></td><td></td>`;
      tr.querySelector('b').textContent = displayWord(h.word);
      tr.children[3].textContent = h.wrong || '–';
      tr.children[4].textContent = h.list;
      tb.appendChild(tr);
    }
    t.appendChild(tb);
  }

  function renderListSummary() {
    const usingBuiltIn = !load(KEYS.words, null);
    const parts = sources().map(s => `${s}: ${wordList.filter(w => w.source === s).length}`);
    $('list-summary').textContent = `${usingBuiltIn ? "Pippa's Power Words (built in)" : 'Imported list'} — ${parts.join(' · ')}`;
  }

  async function importCSV(text) {
    const { words, skipped } = wordsFromCSV(text);
    if (!words.length) { await ask('No words found in that file.\nIt needs a "word" column, or one word per line.', ['OK']); return; }
    const res = await ask(`Replace the word list with ${words.length} word${words.length === 1 ? '' : 's'}?${skipped.length ? `\n(${skipped.length} entr${skipped.length === 1 ? 'y' : 'ies'} skipped: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '…' : ''})` : ''}\nProgress is kept.`, ['Cancel', 'Import']);
    if (!res || res.button !== 'Import') return;
    wordList = words; save(KEYS.words, words); recent = [];
    $('csv-paste').value = '';
    openParent(); toast('Word list imported');
  }

  function exportCSV() {
    const q = v => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
    const yn = v => (v === true ? 'yes' : v === false ? 'no' : '');
    const lines = ['word,source_list,bonus_word,reading_mastered,writing_mastered,played,guessed,missed,last_result,last_played'];
    for (const w of wordList) {
      const p = progress[w.word] || {};
      lines.push([w.word, w.source, w.bonus ? 'yes' : 'no', yn(mastered(w, 'reading')), yn(mastered(w, 'writing')),
        p.played || 0, p.won || 0, p.lost || 0, p.last || '', p.lastAt ? new Date(p.lastAt).toISOString().slice(0, 10) : ''].map(v => q(String(v))).join(','));
    }
    return lines.join('\n') + '\n';
  }

  // ---------- modal & toast ----------
  function ask(msg, buttons, withInput = false) {
    return new Promise(resolve => {
      $('modal-msg').textContent = msg;
      const input = $('modal-input');
      input.hidden = !withInput; input.value = '';
      const box = $('modal-btns');
      box.innerHTML = '';
      const done = button => { $('modal').hidden = true; resolve({ button, value: input.value }); };
      buttons.forEach((label, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn' + (i < buttons.length - 1 ? ' ghost' : ''); b.textContent = label;
        b.onclick = () => done(label);
        box.appendChild(b);
      });
      input.onkeydown = e => { if (e.key === 'Enter') done(buttons[buttons.length - 1]); };
      $('modal').hidden = false;
      if (withInput) setTimeout(() => input.focus(), 50);
    });
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  // ---------- back button (called by the Android wrapper) ----------
  window.hpBack = function () {
    if (!$('modal').hidden) { $('modal').hidden = true; return true; }
    if (current === 'home') return false;
    renderHome(); show('home');
    return true;
  };

  // ---------- wiring ----------
  function saveSettings() { save(KEYS.settings, settings); }

  $('mode-grid').addEventListener('click', e => { const b = e.target.closest('.mode-btn'); if (b && !b.disabled) startGame(b.dataset.mode); });
  $('keyboard').addEventListener('click', e => { const k = e.target.closest('.key'); if (k) guess(k.dataset.letter); });
  document.addEventListener('keydown', e => {
    if (current === 'game' && $('modal').hidden && /^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey) guess(e.key.toLowerCase());
    else if (current === 'game' && e.key === 'Enter' && !$('result').hidden) startGame(game.mode);
  });
  $('btn-home').onclick = () => { renderHome(); show('home'); };
  $('btn-result-home').onclick = () => { renderHome(); show('home'); };
  $('btn-next').onclick = () => startGame(game.mode);
  $('btn-hear').onclick = () => speak(displayWord(game.word));
  $('btn-say').onclick = () => speak(displayWord(game.word));
  $('btn-parent').onclick = parentGate;
  $('btn-parent-back').onclick = () => { renderHome(); show('home'); };

  document.querySelectorAll('.stepper button').forEach(b => (b.onclick = () => {
    settings.maxMisses = Math.max(MIN_BALLOONS, Math.min(MAX_BALLOONS, settings.maxMisses + Number(b.dataset.step)));
    $('set-misses').textContent = settings.maxMisses; saveSettings();
  }));
  for (const [id, key] of [['set-short', 'shortWords'], ['set-caps', 'caps'], ['set-sound', 'sound'], ['set-speak', 'speak'], ['set-sayfirst', 'sayFirst']]) {
    $(id).onchange = e => { settings[key] = e.target.checked; saveSettings(); };
  }
  $('prog-filter').onchange = renderProgress;
  $('prog-sort').onchange = renderProgress;
  $('csv-file').onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => importCSV(r.result);
    r.onerror = () => toast('Could not read that file');
    r.readAsText(file, 'utf-8');
    e.target.value = '';
  };
  $('btn-paste').onclick = () => importCSV($('csv-paste').value);
  $('btn-restore').onclick = async () => {
    const r = await ask("Go back to Pippa's Power Words?\nProgress is kept.", ['Cancel', 'Restore']);
    if (r && r.button === 'Restore') { try { localStorage.removeItem(KEYS.words); } catch {} wordList = wordsFromCSV(window.HP_BUILTIN_CSV).words; recent = []; openParent(); toast('Restored'); }
  };
  $('btn-export').onclick = () => {
    const out = $('export-out'); out.value = exportCSV(); out.hidden = false; out.focus(); out.select();
    try { navigator.clipboard && navigator.clipboard.writeText(out.value).then(() => toast('Copied to clipboard'), () => {}); } catch {}
  };
  $('btn-reset').onclick = async () => {
    const r = await ask('Erase all progress and history?\nThis cannot be undone.', ['Cancel', 'Erase']);
    if (r && r.button === 'Erase') { progress = {}; history = []; save(KEYS.progress, progress); save(KEYS.history, history); openParent(); toast('Progress erased'); }
  };

  // test hook (harmless in production)
  window.__hp = { wordsFromCSV, parseCSV, poolFor, get game() { return game; }, get progress() { return progress; } };

  drawHero();
  renderHome();
})();

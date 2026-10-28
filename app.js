/* Singalong – stage 1: load one song, show it big, keep the current line at the focus position.
   Plain JavaScript, no libraries. Read top to bottom; each section is labelled. */

'use strict';

/* =====================================================================
   1. SONG FILE PARSING
   A song file is:  front matter (key: value lines)  ---  body
   Body lines are one of: blank, [Section label], chord line, lyric line.
   A chord line directly above a lyric line belongs to it.
   ===================================================================== */

// What counts as a chord token: root (A–G, optional # or b), a short suffix, optional /bass.
const CHORD_RE = /^[A-G][#b]?(?:maj|min|m|M|dim|aug|sus|add|\+|°|ø|[0-9])*[0-9]*(?:sus[24]|add[0-9]+|[b#][0-9]+)*(?:\/[A-G][#b]?)?$/;

function isChordLine(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0] === '') return false;
  // Allow a few non-chord markers that often appear on chord lines
  return tokens.every(t => CHORD_RE.test(t) || t === '|' || t === 'N.C.' || t === '(' || t === ')');
}

function parseChordLine(line) {
  // Returns [{col, name}] — col is the character column the chord sits over
  const chords = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line)) !== null) chords.push({ col: m.index, name: m[0] });
  return chords;
}

function parseSong(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const meta = {};
  let i = 0;

  // Front matter: "key: value" lines until a line that is just ---
  while (i < lines.length && lines[i].trim() !== '---') {
    const m = lines[i].match(/^\s*([\w-]+)\s*:\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
    i++;
  }
  i++; // skip the ---
  meta.tags = (meta.tags || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  // Body → a list of "blocks": {type:'label', text} | {type:'gap'} | {type:'line', chords, text}
  const blocks = [];
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];
    if (line.trim() === '') {
      if (blocks.length && blocks[blocks.length - 1].type !== 'gap') blocks.push({ type: 'gap' });
      i++;
    } else if (/^\s*\[.+\]\s*$/.test(line)) {
      blocks.push({ type: 'label', text: line.trim().slice(1, -1) });
      i++;
    } else if (isChordLine(line)) {
      const chords = parseChordLine(line);
      const nextIsLyric = next !== undefined && next.trim() !== '' && !isChordLine(next) && !/^\s*\[.+\]\s*$/.test(next);
      if (nextIsLyric) {
        blocks.push({ type: 'line', chords, text: next.replace(/\s+$/, '') });
        i += 2;
      } else {
        blocks.push({ type: 'line', chords, text: '' });   // chords with no lyric (intro, outro…)
        i++;
      }
    } else {
      blocks.push({ type: 'line', chords: [], text: line.replace(/\s+$/, '') });
      i++;
    }
  }
  return { meta, blocks };
}

/* =====================================================================
   2. LAYOUT
   Phones are narrow, so a long lyric line is wrapped onto several screen
   rows at word boundaries. Each chord travels with the character it sits
   over, so wrapping never breaks alignment. All widths are in "ch"
   (one monospace character), which makes the maths exact.
   ===================================================================== */

let wordCount = 0;         // total number of words (progress-pointer stops) in the song
let rowEls = [];           // one entry per screen row: {el, firstWord, lastWord}

function measureColumns() {
  // How many monospace characters fit across the song area?
  const song = document.getElementById('song');
  const probe = document.createElement('span');
  probe.textContent = 'MMMMMMMMMM';
  probe.style.visibility = 'hidden';
  probe.style.position = 'absolute';
  song.appendChild(probe);
  const chWidth = probe.getBoundingClientRect().width / 10;
  song.removeChild(probe);
  const usable = song.clientWidth - 20; // minus padding
  return Math.max(10, Math.floor(usable / chWidth));
}

function wrapLine(text, maxCols) {
  // Split a lyric line into rows [{start, end}] of at most maxCols characters, breaking at spaces.
  const rows = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= maxCols) { rows.push({ start, end: text.length }); break; }
    let brk = text.lastIndexOf(' ', start + maxCols);
    if (brk <= start) brk = start + maxCols;          // one giant word: hard break
    rows.push({ start, end: brk });
    start = brk;
    while (text[start] === ' ') start++;              // drop the space at the wrap point
  }
  if (rows.length === 0) rows.push({ start: 0, end: 0 });
  return rows;
}

function placeChords(chords, rowStart, rowEnd, rangeStart = rowStart) {
  // Chords anchored inside [rangeStart, rowEnd) go on this row, positioned relative to rowStart,
  // shifted right only when they would overlap the previous chord.
  const placed = [];
  let minLeft = 0;
  for (const c of chords) {
    if (c.col < rangeStart || c.col >= rowEnd) continue;
    const left = Math.max(c.col - rowStart, minLeft, 0);
    placed.push({ left, name: c.name });
    minLeft = left + c.name.length + 1;
  }
  return placed;
}

function renderSong(song) {
  const container = document.getElementById('song');
  container.innerHTML = '';
  rowEls = [];
  wordCount = 0;
  const maxCols = measureColumns();

  for (const b of song.blocks) {
    if (b.type === 'gap') { container.appendChild(el('div', 'gap')); continue; }
    if (b.type === 'label') { container.appendChild(el('div', 'label', b.text)); continue; }

    if (b.text === '') {
      // Chords only: an instrumental row. It counts as one "word" so the pointer can pass through it.
      const row = el('div', 'row instr');
      for (const c of placeChords(b.chords, 0, Infinity)) row.appendChild(chordEl(c));
      row.dataset.i = wordCount;
      rowEls.push({ el: row, firstWord: wordCount, lastWord: wordCount });
      wordCount++;
      container.appendChild(row);
      continue;
    }

    // Chords that sit past the end of the lyric text belong to the last row
    const rows = wrapLine(b.text, maxCols);
    for (let r = 0; r < rows.length; r++) {
      const { start } = rows[r];
      const end = (r === rows.length - 1) ? Infinity : rows[r].end;
      const row = el('div', 'row' + (b.chords.length ? '' : ' no-chords'));
      const rangeStart = (r === 0) ? 0 : rows[r - 1].end;   // chords typed over the wrap space move down too
      for (const c of placeChords(b.chords, start, end, rangeStart)) row.appendChild(chordEl(c));

      // Lyric text: each word in its own span so it can turn green
      const segment = b.text.slice(start, rows[r].end);
      const firstWord = wordCount;
      const re = /(\S+)|(\s+)/g;
      let m;
      while ((m = re.exec(segment)) !== null) {
        if (m[1]) {
          const w = el('span', 'w', m[1]);
          w.dataset.i = wordCount++;
          row.appendChild(w);
        } else {
          row.appendChild(document.createTextNode(m[2]));
        }
      }
      rowEls.push({ el: row, firstWord, lastWord: Math.max(firstWord, wordCount - 1) });
      container.appendChild(row);
    }
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function chordEl(c) {
  const e = el('span', 'chord', c.name);
  e.style.left = `calc(10px + ${c.left}ch)`;
  return e;
}

/* =====================================================================
   3. THE PROGRESS POINTER
   One number, `progress`, says how many words have been sung. Everything
   that moves through the song (taps now; slider, drag, voice later)
   changes this number and calls setProgress().
   ===================================================================== */

let progress = 0;

function setProgress(p) {
  progress = Math.max(0, Math.min(wordCount, p));
  const done = Math.floor(progress);

  // Colour words
  document.querySelectorAll('#song .w, #song .row.instr').forEach(w => {
    w.classList.toggle('done', Number(w.dataset.i) < done);
  });

  // Find the row holding the current (next unsung) word and bring it to the focus line
  const cur = Math.min(done, wordCount - 1);
  const row = rowEls.find(r => cur >= r.firstWord && cur <= r.lastWord) || rowEls[rowEls.length - 1];
  if (!row) return;
  const viewport = document.getElementById('viewport');
  const focusY = viewport.clientHeight * 0.35;
  const song = document.getElementById('song');
  const rowCenter = row.el.offsetTop + row.el.offsetHeight * 0.65; // roughly the lyric baseline
  song.style.transform = `translateY(${focusY - rowCenter}px)`;
}

function rowIndexOfProgress() {
  const cur = Math.min(Math.floor(progress), wordCount - 1);
  return rowEls.findIndex(r => cur >= r.firstWord && cur <= r.lastWord);
}
function nextLine() {
  const idx = rowIndexOfProgress();
  if (idx < rowEls.length - 1) setProgress(rowEls[idx + 1].firstWord);
  else setProgress(wordCount);
}
function prevLine() {
  const idx = rowIndexOfProgress();
  if (progress > rowEls[idx].firstWord) setProgress(rowEls[idx].firstWord);
  else if (idx > 0) setProgress(rowEls[idx - 1].firstWord);
}

/* =====================================================================
   4. SCREEN WAKE LOCK — keep the phone awake while a song is open.
   Only works on HTTPS (so on GitHub Pages, not on file:// or http://).
   ===================================================================== */

let wakeLock = null;
async function keepAwake() {
  if (!('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* denied or unsupported: ignore */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});

/* =====================================================================
   5. FONT SIZE (remembered on this device)
   ===================================================================== */

function getFontSize() {
  try { return Number(localStorage.getItem('fontSize')) || 22; } catch (e) { return 22; }
}
function setFontSize(px) {
  px = Math.max(14, Math.min(40, px));
  document.documentElement.style.setProperty('--font-size', px + 'px');
  try { localStorage.setItem('fontSize', px); } catch (e) {}
  if (currentSong) { renderSong(currentSong); setProgress(progress); }
}

/* =====================================================================
   6. START-UP: load the song, wire up taps and keys
   ===================================================================== */

let currentSong = null;

async function loadSong(filename) {
  const res = await fetch('songs/' + filename, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load ' + filename);
  currentSong = parseSong(await res.text());
  document.getElementById('title').textContent = currentSong.meta.title || filename;
  document.getElementById('artist').textContent = currentSong.meta.artist || '';
  document.title = currentSong.meta.title || 'Singalong';
  renderSong(currentSong);
  setProgress(0);
  keepAwake();
}

async function start() {
  document.documentElement.style.setProperty('--font-size', getFontSize() + 'px');

  // Which song? ?song=file.txt in the address, otherwise the first one in the index.
  const params = new URLSearchParams(location.search);
  let file = params.get('song');
  if (!file) {
    const list = await (await fetch('songs/index.json', { cache: 'no-cache' })).json();
    file = list[0];
  }
  try {
    await loadSong(file);
  } catch (e) {
    document.getElementById('title').textContent = e.message;
  }

  // Taps: lower part of the song area = next line, upper part = previous line
  document.getElementById('viewport').addEventListener('click', ev => {
    const vp = ev.currentTarget.getBoundingClientRect();
    if (ev.clientY - vp.top > vp.height * 0.35) nextLine(); else prevLine();
  });

  // Keys (desktop testing now; a Bluetooth page-turner pedal later sends the same keys)
  document.addEventListener('keydown', ev => {
    if (['ArrowDown', 'PageDown', ' ', 'ArrowRight'].includes(ev.key)) { ev.preventDefault(); nextLine(); }
    if (['ArrowUp', 'PageUp', 'ArrowLeft'].includes(ev.key)) { ev.preventDefault(); prevLine(); }
  });

  document.getElementById('font-minus').addEventListener('click', () => setFontSize(getFontSize() - 2));
  document.getElementById('font-plus').addEventListener('click', () => setFontSize(getFontSize() + 2));

  // Re-wrap when the phone rotates
  window.addEventListener('resize', () => { if (currentSong) { renderSong(currentSong); setProgress(progress); } });
}

start();

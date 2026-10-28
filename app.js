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
   1b. MUSIC: note names, keys, transposition
   Every note is a number 0–11 (C=0 … B=11); a melody note also has an
   octave, so C4 = 4*12+0 = 48. Transposing adds a number of semitones,
   then the result is spelled with sharps or flats to suit the key.
   ===================================================================== */

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// The 12 keys as offered in the dropdown, with the usual guitar-friendly spellings
const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

function noteToIndex(name) {           // "F#" → 6, "Bb" → 10
  let n = NOTE_INDEX[name[0].toUpperCase()];
  if (n === undefined) return null;
  if (name[1] === '#') n += 1;
  if (name[1] === 'b') n -= 1;
  return (n + 12) % 12;
}
function spell(index, useFlats) { return (useFlats ? FLAT_NAMES : SHARP_NAMES)[(index % 12 + 12) % 12]; }

function keyRoot(key) {                // "Am" → "A" (we only care about the tonic letter)
  const m = (key || 'C').match(/^[A-G][#b]?/);
  return m ? m[0] : 'C';
}

// Scientific pitch ("C4", "F#5") ↔ MIDI-style number
function pitchToNumber(p) {
  const m = (p || '').trim().match(/^([A-G][#b]?)(-?\d)$/i);
  if (!m) return null;
  return (Number(m[2]) + 1) * 12 + noteToIndex(m[1]);
}
function numberToPitch(n, useFlats) {
  return spell(n % 12, useFlats) + (Math.floor(n / 12) - 1);
}

// Shift one chord symbol by `semis`, spelling the result for the target key. Handles Am7, Dsus4, G/B.
function transposeChord(name, semis, useFlats) {
  const m = name.match(/^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/);
  if (!m) return name;                                   // N.C., |, etc. pass through
  let out = spell(noteToIndex(m[1]) + semis, useFlats) + m[2];
  if (m[3]) out += '/' + spell(noteToIndex(m[3]) + semis, useFlats);
  return out;
}

// Semitones from the song's key to a target key, chosen as the smallest move (−5 … +6)
function semitonesBetween(fromKey, toKey) {
  let d = (noteToIndex(keyRoot(toKey)) - noteToIndex(keyRoot(fromKey)) + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}

function rangeText(meta, semis, useFlats) {
  const lo = pitchToNumber(meta.low), hi = pitchToNumber(meta.high);
  if (lo === null || hi === null) return '';
  return numberToPitch(lo + semis, useFlats) + '–' + numberToPitch(hi + semis, useFlats);
}

/* =====================================================================
   2. LAYOUT
   Phones are narrow, so a long lyric line is wrapped onto several screen
   rows at word boundaries. Each chord travels with the character it sits
   over, so wrapping never breaks alignment. All widths are in "ch"
   (one monospace character), which makes the maths exact.
   ===================================================================== */

let currentSemis = 0;      // transposition in semitones from the song's written key
let currentFlats = false;  // spell with flats (true) or sharps (false) in the current key
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

    // Chords as displayed in the current key (columns unchanged: alignment is by column, not by text)
    const chords = b.chords.map(c => ({ col: c.col, name: transposeChord(c.name, currentSemis, currentFlats) }));

    if (b.text === '') {
      // Chords only: an instrumental row. It counts as one "word" so the pointer can pass through it.
      const row = el('div', 'row instr');
      for (const c of placeChords(chords, 0, Infinity)) row.appendChild(chordEl(c));
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
      const row = el('div', 'row' + (chords.length ? '' : ' no-chords'));
      const rangeStart = (r === 0) ? 0 : rows[r - 1].end;   // chords typed over the wrap space move down too
      for (const c of placeChords(chords, start, end, rangeStart)) row.appendChild(chordEl(c));

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
   5b. KEY DROPDOWN
   Each option shows the key and the melody range you would get in it.
   The chosen key is remembered per song on this device.
   ===================================================================== */

function buildKeyDropdown(song) {
  const sel = document.getElementById('key');
  sel.innerHTML = '';
  const home = keyRoot(song.meta.key);
  for (const k of KEYS) {
    const semis = semitonesBetween(home, k);
    const opt = document.createElement('option');
    opt.value = k;
    const range = rangeText(song.meta, semis, FLAT_KEYS.has(k));
    opt.textContent = k + (range ? ' (' + range + ')' : '');
    sel.appendChild(opt);
  }
  // Start from the remembered key for this song, else the written key
  let chosen = null;
  try { chosen = localStorage.getItem('key:' + song.file); } catch (e) {}
  sel.value = KEYS.includes(chosen) ? chosen : KEYS[noteToIndex(home)];   // KEYS is indexed by semitone
  applyKey();
}

function applyKey() {
  const sel = document.getElementById('key');
  const k = sel.value;
  currentSemis = semitonesBetween(keyRoot(currentSong.meta.key), k);
  currentFlats = FLAT_KEYS.has(k);
  document.getElementById('range').textContent = rangeText(currentSong.meta, currentSemis, currentFlats);
  try { localStorage.setItem('key:' + currentSong.file, k); } catch (e) {}
  renderSong(currentSong);
  setProgress(progress);
}

/* =====================================================================
   6. START-UP: load the song, wire up taps and keys
   ===================================================================== */

let currentSong = null;

async function loadSong(filename) {
  const res = await fetch('songs/' + filename, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load ' + filename);
  currentSong = parseSong(await res.text());
  currentSong.file = filename;
  progress = 0;
  document.getElementById('title').textContent = currentSong.meta.title || filename;
  document.getElementById('artist').textContent = currentSong.meta.artist || '';
  document.title = currentSong.meta.title || 'Singalong';
  buildKeyDropdown(currentSong);   // also renders the song and resets the pointer
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

  document.getElementById('key').addEventListener('change', applyKey);
  document.getElementById('font-minus').addEventListener('click', () => setFontSize(getFontSize() - 2));
  document.getElementById('font-plus').addEventListener('click', () => setFontSize(getFontSize() + 2));

  // Re-wrap when the phone rotates
  window.addEventListener('resize', () => { if (currentSong) { renderSong(currentSong); setProgress(progress); } });
}

start();

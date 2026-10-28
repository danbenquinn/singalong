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
let lyricWords = [];       // for each word: its text, normalised for voice matching ('' for instrumental rows)
let wordLine = [];         // for each word: which source line (as typed in the file) it is on
let lineWords = [];        // for each source line: how many words it has (auto-scroll pacing)

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
  wordLine = [];
  lineWords = [];
  lyricWords = [];
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
      wordLine.push(lineWords.length); lineWords.push(1);
      lyricWords.push('');
      wordCount++;
      container.appendChild(row);
      continue;
    }

    // Chords that sit past the end of the lyric text belong to the last row
    const rows = wrapLine(b.text, maxCols);
    const lineIdx = lineWords.length; lineWords.push(0);
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
          wordLine.push(lineIdx); lineWords[lineIdx]++;
          lyricWords.push(normalizeWord(m[1]));
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
   One number, `progress`, says how many words have been sung (it can be
   fractional: 12.4 means word 12 is being sung and is 40% through).
   Everything that moves through the song — taps, the speed slider, the
   drag bar, voice later — changes this number and calls setProgress().
   ===================================================================== */

let progress = 0;

function rowAt(wordIndex) {
  const i = Math.max(0, Math.min(wordIndex, wordCount - 1));
  return rowEls.find(r => i >= r.firstWord && i <= r.lastWord) || rowEls[rowEls.length - 1];
}
function rowAnchorY(row) {           // where the lyric text of a row sits, in song coordinates
  return row.el.offsetTop + row.el.offsetHeight * 0.65;
}

function setProgress(p) {
  progress = Math.max(0, Math.min(wordCount, p));
  if (!rowEls.length) return;
  const done = Math.floor(progress);

  // Colour the words that have been sung
  document.querySelectorAll('#song .w, #song .row.instr').forEach(w => {
    w.classList.toggle('done', Number(w.dataset.i) < done);
  });

  // Position: glide from the current row towards the next one as the words of this row go by
  const row = rowAt(done);
  const idx = rowEls.indexOf(row);
  const next = rowEls[idx + 1];
  const frac = Math.min(1, Math.max(0, (progress - row.firstWord) / (row.lastWord - row.firstWord + 1)));
  const y = next ? rowAnchorY(row) + frac * (rowAnchorY(next) - rowAnchorY(row)) : rowAnchorY(row);
  const focusY = document.getElementById('viewport').clientHeight * 0.35;
  document.getElementById('song').style.transform = `translateY(${focusY - y}px)`;

  updateScrollBar();
}

function nextLine() {
  const row = rowAt(Math.floor(progress));
  const idx = rowEls.indexOf(row);
  setProgress(idx < rowEls.length - 1 ? rowEls[idx + 1].firstWord : wordCount);
}
function prevLine() {
  const row = rowAt(Math.floor(progress));
  const idx = rowEls.indexOf(row);
  if (progress > row.firstWord + 0.01) setProgress(row.firstWord);
  else if (idx > 0) setProgress(rowEls[idx - 1].firstWord);
}

/* =====================================================================
   3b. MOTION — one loop moves the pointer
   Pacing: the song file's `speed` is seconds per typed line at 1×. Each
   word of a line gets an equal share of that time, so the pointer moves
   steadily and the view glides. In Manual mode the rate is the slider;
   in Voice mode it is fitted live to the words heard (section 3d).
   Dragging the lyrics or the bar overrides everything while the finger
   is down; a flick on the lyrics coasts to a stop.
   ===================================================================== */

let speedMultiplier = 1;           // 0 … 2, the slider position (Manual)
let playing = false;               // the play/pause button; the page loads paused at 1×
let lastTick = null;
let dragging = false;              // finger on the bar or the lyrics
let flingVelocity = 0;             // px/s of a lyric flick still coasting
let correction = null;             // Voice: the position a match says we should be at (approached smoothly)

function secondsPerLine() {
  const v = Number(currentSong && currentSong.meta.speed);
  return v > 0 ? v : 6;
}
function secondsPerWordAt(p) {
  const i = Math.max(0, Math.min(Math.floor(p), wordCount - 1));
  return secondsPerLine() / (lineWords[wordLine[i]] || 1);
}
function currentRate() { return mode === 'voice' ? voiceRate : speedMultiplier; }

// progress → y (song coordinates) and back; both piecewise-linear between row anchors
function yOfProgress(p) {
  const row = rowAt(Math.floor(p));
  const idx = rowEls.indexOf(row);
  const next = rowEls[idx + 1];
  const frac = Math.min(1, Math.max(0, (p - row.firstWord) / (row.lastWord - row.firstWord + 1)));
  return next ? rowAnchorY(row) + frac * (rowAnchorY(next) - rowAnchorY(row)) : rowAnchorY(row);
}
function progressOfY(y) {
  if (!rowEls.length) return 0;
  if (y <= rowAnchorY(rowEls[0])) return 0;
  for (let i = 0; i < rowEls.length - 1; i++) {
    const y0 = rowAnchorY(rowEls[i]), y1 = rowAnchorY(rowEls[i + 1]);
    if (y < y1) {
      const r = rowEls[i];
      return r.firstWord + (y - y0) / (y1 - y0) * (r.lastWord - r.firstWord + 1);
    }
  }
  return wordCount;
}

function tick(now) {
  if (lastTick !== null) {
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    if (!dragging && Math.abs(flingVelocity) > 5) {
      // Coasting after a flick: content keeps moving the way the finger went, slowing down
      setProgress(progressOfY(yOfProgress(progress) - flingVelocity * dt));
      flingVelocity *= Math.pow(0.08, dt);           // ~ gone after a second
      if (progress <= 0 || progress >= wordCount) flingVelocity = 0;
    } else if (!dragging && playing && progress < wordCount) {
      let p = progress + dt * currentRate() / secondsPerWordAt(progress);
      if (correction !== null) {                      // Voice: ease towards where the last match put us
        p += (correction - p) * Math.min(1, dt * 4);
        if (Math.abs(correction - p) < 0.05) correction = null;
      }
      setProgress(p);
      if (progress >= wordCount) setPlaying(false);
    }
  }
  lastTick = now;
  requestAnimationFrame(tick);
}

const SPEED_STEP = 0.1;             // one pedal press
function nudgeSpeed(delta) {
  if (mode === 'voice') { voiceRate = Math.max(0.5, Math.min(2, voiceRate + delta)); showRate(voiceRate); }
  else setSpeed(speedMultiplier + delta);
  flashRate();
}
function flashRate() {               // brief highlight so a pedal press is visibly acknowledged
  const v = document.getElementById('speed-value');
  v.classList.add('flash');
  setTimeout(() => v.classList.remove('flash'), 400);
}
function setSpeed(mult) {
  speedMultiplier = Math.max(0, Math.min(2, mult));
  showRate(speedMultiplier);
}
function showRate(r) {
  const slider = document.getElementById('speed');
  if (Number(slider.value) !== r) slider.value = r;
  document.getElementById('speed-value').textContent = r === 0 ? '0' : r.toFixed(2).replace(/\.?0+$/, '') + '×';
}
function setPlaying(on) {
  playing = on;
  flingVelocity = 0;
  if (playing && progress >= wordCount) setProgress(0);   // play at the end starts over
  const b = document.getElementById('play');
  b.textContent = playing ? '❚❚' : '▶';
  b.classList.toggle('paused', !playing);
  if (mode === 'voice') { if (playing) startListening(); else stopListening(); }
}
function togglePause() { setPlaying(!playing); }

// The drag bar on the right. Thumb at the BOTTOM = start of the song, so dragging it down scrolls
// back, the same direction as dragging the lyrics themselves.
function updateScrollBar() {
  const bar = document.getElementById('scrollbar');
  const thumb = document.getElementById('thumb');
  const travel = bar.clientHeight - thumb.offsetHeight;
  thumb.style.top = (1 - (wordCount ? progress / wordCount : 0)) * travel + 'px';
}
function setupScrollBar() {
  const bar = document.getElementById('scrollbar');
  const thumb = document.getElementById('thumb');
  let startY = 0, startProgress = 0;
  const wordsPerPixel = () => wordCount / (bar.clientHeight - thumb.offsetHeight);

  thumb.addEventListener('pointerdown', ev => {
    dragging = true; flingVelocity = 0; correction = null;
    startY = ev.clientY;
    startProgress = progress;
    thumb.setPointerCapture(ev.pointerId);
    thumb.classList.add('active');
    ev.preventDefault();
  });
  thumb.addEventListener('pointermove', ev => {
    if (!dragging) return;
    setProgress(startProgress - (ev.clientY - startY) * wordsPerPixel());
  });
  const release = () => { dragging = false; thumb.classList.remove('active'); };
  thumb.addEventListener('pointerup', release);
  thumb.addEventListener('pointercancel', release);
  // Tapping the bar itself (not the thumb) jumps there
  bar.addEventListener('pointerdown', ev => {
    if (ev.target === thumb) return;
    const r = bar.getBoundingClientRect();
    const frac = (ev.clientY - r.top - thumb.offsetHeight / 2) / (bar.clientHeight - thumb.offsetHeight);
    setProgress((1 - Math.max(0, Math.min(1, frac))) * wordCount);
  });
}

// Dragging the lyrics: the text follows the finger; a flick coasts.
function setupLyricDrag() {
  const vp = document.getElementById('viewport');
  let active = false, startY = 0, startSongY = 0, moved = false;
  let samples = [];                                   // recent [time, y] for the flick velocity
  vp.addEventListener('pointerdown', ev => {
    if (ev.target.closest('#sidebar')) return;
    active = true; moved = false; dragging = true; flingVelocity = 0; correction = null;
    startY = ev.clientY; startSongY = yOfProgress(progress);
    samples = [[ev.timeStamp, ev.clientY]];
    vp.setPointerCapture(ev.pointerId);
  });
  vp.addEventListener('pointermove', ev => {
    if (!active) return;
    const d = ev.clientY - startY;
    if (Math.abs(d) > 12) moved = true;                   // a fingertip wobbles; under 12px is still a tap
    if (moved) setProgress(progressOfY(startSongY - d));   // finger down → text down → earlier words
    samples.push([ev.timeStamp, ev.clientY]);
    while (samples.length > 2 && ev.timeStamp - samples[0][0] > 120) samples.shift();
  });
  const release = ev => {
    if (!active) return;
    active = false; dragging = false;
    if (!moved) return;                                   // a plain tap does nothing
    const [t0, y0] = samples[0], [t1, y1] = samples[samples.length - 1];
    if (t1 > t0) flingVelocity = (y1 - y0) / ((t1 - t0) / 1000);   // px/s, sign = finger direction
    if (Math.abs(flingVelocity) < 300) flingVelocity = 0;
  };
  vp.addEventListener('pointerup', release);
  vp.addEventListener('pointercancel', () => { active = false; dragging = false; });
}

/* =====================================================================
   3c. MODE TOGGLE — Manual or Voice
   Voice only changes what ▶ does: play then also listens, and the rate
   is fitted to the words heard instead of taken from the slider.
   ===================================================================== */

let mode = 'manual';
function setMode(m) {
  mode = m;
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  document.getElementById('voice-row').hidden = (m !== 'voice');
  document.getElementById('speed-label').hidden = (m === 'voice');
  document.getElementById('speed').disabled = (m === 'voice');
  if (m !== 'voice') document.getElementById('voice-heard').textContent = '';
  if (m === 'voice') {
    voiceRate = speedMultiplier > 0 ? speedMultiplier : 1;   // start from the slider's rate
    showRate(voiceRate);
    if (playing) startListening(); else voiceStatus('press ▶');
  } else {
    stopListening();
    correction = null;
    showRate(speedMultiplier);
  }
}

/* =====================================================================
   3d. VOICE MODE — live-fitting the speed to the words heard.
   The pointer always moves on its own at `voiceRate` (starting at 1×).
   Each recognised word is looked for near the projected position; the
   search window grows the longer it has been since the last match (a
   diffusion law: ± a few words, widening with the square root of the
   elapsed time). A hit does two things: eases the pointer towards the
   matched word, and nudges the rate so the projection drifts less next
   time. Hearing nothing changes nothing — the pointer just keeps going.
   Uses the Web Speech API; Safari stops after pauses, so we restart it.
   ===================================================================== */

let voiceRate = 1;
let recognizer = null;
let wantListening = false;
let lastMatchAt = null;
let lastMatchWord = null;         // {index, time} of the previous match, for the rate estimate
let heardSoFar = {};              // per result index: how many words we have already handled

function normalizeWord(w) {
  return w.toLowerCase().replace(/[^a-z0-9']/g, '').replace(/^'+|'+$/g, '');
}

// Loose equality: exact, or one letter off for words of 4+ letters, or one is a prefix of the other (5+ letters)
function similar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function matchHeardWord(word) {
  if (word.length < 3) return false;                      // "a", "the", "I" match everywhere; ignore them
  const since = lastMatchAt ? (Date.now() - lastMatchAt) / 1000 : 10;
  const ahead = Math.min(30, 4 + 3 * Math.sqrt(since));   // widen the search as confidence decays
  const back = Math.min(12, 1 + Math.sqrt(since));
  const centre = correction !== null ? correction : progress;
  const from = Math.max(0, Math.floor(centre - back));
  const to = Math.min(wordCount, Math.ceil(centre + ahead));
  let best = -1;
  for (let i = from; i < to; i++) {
    if (similar(word, lyricWords[i]) && (best < 0 || Math.abs(i - centre) < Math.abs(best - centre))) best = i;
  }
  if (best < 0) return false;

  const now = Date.now();
  // Rate estimate: how fast the singer actually covered the words since the previous match,
  // compared with how long the file says they take at 1×. Blended in gently.
  if (lastMatchWord && best > lastMatchWord.index && now - lastMatchWord.time > 1500) {
    let expected = 0;
    for (let i = lastMatchWord.index; i < best; i++) expected += secondsPerWordAt(i);
    const measured = (now - lastMatchWord.time) / 1000;
    const observed = Math.max(0.5, Math.min(2, expected / measured));
    voiceRate = Math.max(0.5, Math.min(2, voiceRate * 0.7 + observed * 0.3));
    showRate(voiceRate);
  }
  lastMatchWord = { index: best, time: now };
  lastMatchAt = now;
  correction = best + 1;                                   // the loop eases towards it
  return true;
}

function startListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { voiceStatus('no speech API'); return; }
  if (navigator.onLine === false) { voiceStatus('offline'); return; }   // Safari's recogniser needs the internet
  wantListening = true;
  if (recognizer) { try { recognizer.start(); } catch (e) { /* already running */ } return; }
  recognizer = new SR();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.lang = 'en-US';
  recognizer.onstart = () => { heardSoFar = {}; lastMatchWord = null; voiceStatus('listening'); document.getElementById('voice-dot').classList.add('listening'); };
  recognizer.onresult = ev => {
    for (let r = ev.resultIndex; r < ev.results.length; r++) {
      const words = ev.results[r][0].transcript.trim().split(/\s+/).map(normalizeWord).filter(Boolean);
      const seen = heardSoFar[r] || 0;
      for (let k = seen; k < words.length; k++) matchHeardWord(words[k]);
      heardSoFar[r] = words.length;
      document.getElementById('voice-heard').textContent = words.slice(-4).join(' ');
    }
  };
  recognizer.onerror = ev => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      wantListening = false;
      voiceStatus('mic blocked');
    }
    // other errors ("no-speech", "aborted", "network") are followed by onend, which restarts
  };
  recognizer.onend = () => {
    document.getElementById('voice-dot').classList.remove('listening');
    if (wantListening) setTimeout(() => { if (wantListening) { try { recognizer.start(); } catch (e) {} } }, 300);
    else voiceStatus(playing ? 'off' : 'press ▶');
  };
  try { recognizer.start(); } catch (e) { voiceStatus('failed'); }
}

function stopListening() {
  wantListening = false;
  if (recognizer) { try { recognizer.stop(); } catch (e) {} }
}

function voiceStatus(text) { document.getElementById('voice-status').textContent = text; }

// Once a second: say how long since the last matched word, and flash the dot green on a fresh match
setInterval(() => {
  if (mode !== 'voice') return;
  const dot = document.getElementById('voice-dot');
  if (lastMatchAt === null || !wantListening) return;
  const ago = Math.round((Date.now() - lastMatchAt) / 1000);
  dot.classList.toggle('matched', ago < 2);
  voiceStatus(ago < 2 ? 'match' : ago + 's');
}, 1000);

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
  try { localStorage.setItem('key:' + currentSong.file, k); } catch (e) {}
  renderSong(currentSong);
  setProgress(progress);
}

/* =====================================================================
   5c. SONG PICKER
   The library is songs/index.json (a list of filenames, regenerated by
   publish.sh). Each file's front matter is read once at start-up so the
   list can show title, artist and tags.
   ===================================================================== */

let library = [];        // [{file, title, artist, tags:[...]}], sorted by title
let currentTag = 'all';

async function loadLibrary() {
  let files = [];
  try { files = await (await fetch('songs/index.json', { cache: 'no-cache' })).json(); } catch (e) { return; }
  const entries = await Promise.all(files.map(async file => {
    try {
      const text = await (await fetch('songs/' + file, { cache: 'no-cache' })).text();
      const { meta } = parseSong(text);
      return { file, title: meta.title || file, artist: meta.artist || '', tags: meta.tags };
    } catch (e) { return null; }
  }));
  library = entries.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  buildFilters();
  renderSongList();
}

function buildFilters() {
  const tags = [...new Set(library.flatMap(s => s.tags))].sort();
  const box = document.getElementById('filters');
  box.innerHTML = '';
  for (const tag of ['all', ...tags]) {
    const label = el('label', tag === currentTag ? 'on' : '');
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'tag'; input.value = tag; input.checked = tag === currentTag;
    label.appendChild(input);
    label.appendChild(document.createTextNode(tag === 'all' ? 'All' : tag[0].toUpperCase() + tag.slice(1)));
    input.addEventListener('change', () => {
      currentTag = tag;
      box.querySelectorAll('label').forEach(l => l.classList.toggle('on', l.contains(input)));
      renderSongList();
    });
    box.appendChild(label);
  }
}

function renderSongList() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const list = document.getElementById('songlist');
  list.innerHTML = '';
  const shown = library.filter(s =>
    (currentTag === 'all' || s.tags.includes(currentTag)) &&
    (!q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)));
  if (!shown.length) { list.appendChild(el('li', 'empty', 'No songs match.')); return; }
  for (const s of shown) {
    const li = el('li', '', s.title);
    li.appendChild(el('span', 'artist', s.artist));
    li.addEventListener('click', async () => { closePicker(); await loadSong(s.file); });
    list.appendChild(li);
  }
}

function openPicker() {
  setPlaying(false);
  document.getElementById('picker').hidden = false;
  renderSongList();
}
function closePicker() { document.getElementById('picker').hidden = true; }

function setupPicker() {
  document.getElementById('open-picker').addEventListener('click', openPicker);
  document.getElementById('close-picker').addEventListener('click', closePicker);
  document.getElementById('search').addEventListener('input', renderSongList);
}

/* =====================================================================
   5d. PASSWORD GATE
   The password's SHA-256 hash lives in config.js (set-password.sh writes
   it). A correct entry is remembered on this device until the password
   changes. This keeps casual visitors out; it is not strong protection,
   since the song files themselves are still on the public site.
   ===================================================================== */

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function unlock() {
  return new Promise(resolve => {
    const hash = (typeof PASSWORD_HASH === 'string') ? PASSWORD_HASH : '';
    let saved = null;
    try { saved = localStorage.getItem('unlocked'); } catch (e) {}
    if (!hash || saved === hash) { resolve(); return; }
    const gate = document.getElementById('gate');
    const input = document.getElementById('password');
    const msg = document.getElementById('gate-msg');
    gate.hidden = false;
    setTimeout(() => input.focus(), 100);
    const attempt = async () => {
      if (await sha256(input.value) === hash) {
        try { localStorage.setItem('unlocked', hash); } catch (e) {}
        gate.hidden = true;
        resolve();
      } else {
        msg.textContent = 'Nope.';
        input.select();
      }
    };
    document.getElementById('gate-go').addEventListener('click', attempt);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') attempt(); });
  });
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
  lastMatchAt = null; lastMatchWord = null; correction = null; flingVelocity = 0;
  setSpeed(1);
  setPlaying(false);
  try { localStorage.setItem('lastSong', filename); } catch (e) {}
  document.getElementById('title').textContent = currentSong.meta.title || filename;
  document.getElementById('artist').textContent =
    (currentSong.meta.artist || '') + (currentSong.meta.capo ? ' · Capo ' + currentSong.meta.capo : '');
  document.title = currentSong.meta.title || 'Singalong';
  buildKeyDropdown(currentSong);   // also renders the song and resets the pointer
  keepAwake();
}

async function start() {
  document.documentElement.style.setProperty('--font-size', getFontSize() + 'px');
  // Offline support: the service worker (sw.js) keeps a copy of the site and every song on the phone
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  await unlock();

  // Which song? ?song=file.txt in the address, otherwise the first one in the index.
  const params = new URLSearchParams(location.search);
  let file = params.get('song');
  await loadLibrary();
  if (!file) { try { file = localStorage.getItem('lastSong'); } catch (e) {} }
  if (!file || !library.some(s => s.file === file)) file = library.length ? library[0].file : null;
  if (!file) { document.getElementById('title').textContent = 'No songs in songs/index.json'; return; }
  try {
    await loadSong(file);
  } catch (e) {
    document.getElementById('title').textContent = e.message;
  }

  setupLyricDrag();   // drag / flick / tap on the lyrics

  // Keys (desktop testing now; a Bluetooth page-turner pedal later sends the same keys)
  // Pedal / keyboard. A Bluetooth page-turner pedal pairs as a keyboard and sends Page Down / Page Up
  // (or arrows): here those nudge the SPEED, since that is what drifts mid-song. Space pauses.
  document.addEventListener('keydown', ev => {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;   // typing in the search box
    if (['ArrowDown', 'PageDown', 'ArrowRight'].includes(ev.key)) { ev.preventDefault(); nudgeSpeed(+SPEED_STEP); }
    if (['ArrowUp', 'PageUp', 'ArrowLeft'].includes(ev.key)) { ev.preventDefault(); nudgeSpeed(-SPEED_STEP); }
    if (ev.key === ' ') { ev.preventDefault(); togglePause(); }
  });

  document.getElementById('key').addEventListener('change', ev => { applyKey(); ev.target.blur(); });   // blur: pedal keys must not change the key
  document.getElementById('speed').addEventListener('input', ev => setSpeed(Number(ev.target.value)));
  document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.getElementById('play').addEventListener('click', togglePause);
  setupScrollBar();
  setupPicker();
  setSpeed(1);
  setPlaying(false);
  setMode('manual');
  requestAnimationFrame(tick);
  document.getElementById('font-minus').addEventListener('click', () => setFontSize(getFontSize() - 2));
  document.getElementById('font-plus').addEventListener('click', () => setFontSize(getFontSize() + 2));

  // Re-wrap when the phone rotates
  window.addEventListener('resize', () => { if (currentSong) { renderSong(currentSong); setProgress(progress); } });
}

start();

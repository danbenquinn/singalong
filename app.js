/* Singalong – a lyrics-and-chords teleprompter: load a song, show it big, keep the current line at the focus position.
   Plain JavaScript, no libraries. Read top to bottom; each section is labelled. */

'use strict';

/* =====================================================================
   1. SONG FILE PARSING
   A song file is:  front matter (key: value lines)  ---  body
   Body lines are one of: blank, [Section label], chord line, lyric line.
   A chord line directly above a lyric line belongs to it.
   A bare section label ("[Chorus]" with nothing under it) means "sing it
   again": the lines written under the last [Chorus] are repeated there.
   A chord line with "[Instrumental]" under it is an instrumental line: the
   chords are played, "[Instrumental]" sits where the lyrics would be.
   lyric-alignment-builder/songfile.py follows the same rules; keep them in step.
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

  // Body → a list of "blocks": {type:'label', text} | {type:'gap'} | {type:'line', chords, text, repeat?}
  const blocks = [];
  const isLabel = l => /^\s*\[.+\]\s*$/.test(l);
  const sections = {};      // label (lower case) → the line blocks written under it last time
  let current = null;       // {label, lines} of the section being read, until a blank line or label
  const closeSection = () => { if (current && current.lines.length) sections[current.label] = current.lines; current = null; };
  const addLine = b => { blocks.push(b); if (current) current.lines.push(b); };
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];
    if (line.trim() === '') {
      closeSection();
      if (blocks.length && blocks[blocks.length - 1].type !== 'gap') blocks.push({ type: 'gap' });
      i++;
    } else if (isLabel(line)) {
      closeSection();
      const text = line.trim().slice(1, -1);
      const key = text.trim().toLowerCase();
      blocks.push({ type: 'label', text });
      const bare = next === undefined || next.trim() === '' || isLabel(next);
      if (bare && sections[key]) sections[key].forEach(b => blocks.push({ ...b, repeat: true }));
      else current = { label: key, lines: [] };
      i++;
    } else if (isChordLine(line) && next !== undefined && /^\s*\[instrumental\]\s*$/i.test(next)) {
      addLine({ type: 'line', chords: parseChordLine(line), text: '', instrumental: true });
      i += 2;
    } else if (isChordLine(line)) {
      const chords = parseChordLine(line);
      const nextIsLyric = next !== undefined && next.trim() !== '' && !isChordLine(next) && !isLabel(next);
      if (nextIsLyric) {
        addLine({ type: 'line', chords, text: next.replace(/\s+$/, '') });
        i += 2;
      } else {
        addLine({ type: 'line', chords, text: '' });   // chords with no lyric (intro, outro…)
        i++;
      }
    } else {
      addLine({ type: 'line', chords: [], text: line.replace(/\s+$/, '') });
      i++;
    }
  }
  closeSection();
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
let wordTexts = [];        // for each word: its text as typed ('' for instrumental rows) — checked against the timing file
let wordLine = [];         // for each word: which source line (as typed in the file) it is on
let lineWords = [];        // for each source line: how many words it has (auto-scroll pacing)
let lineChords = [];       // for each source line: how many chords sit over it, and whether it has lyrics
let leadSecs = {};         // Even pacing: word index → seconds, for the chords-only rows before the first lyric

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
  wordTexts = [];
  lineChords = [];
  const maxCols = measureColumns();

  for (const b of song.blocks) {
    if (b.type === 'gap') { container.appendChild(el('div', 'gap')); continue; }
    if (b.type === 'label') { container.appendChild(el('div', 'label', b.text)); continue; }

    // Chords as displayed in the current key (columns unchanged: alignment is by column, not by text)
    const chords = b.chords.map(c => ({ col: c.col, name: transposeChord(c.name, currentSemis, currentFlats) }));

    if (b.text === '') {
      // Chords only: an instrumental row. It counts as one "word" so the pointer can pass through it.
      const row = el('div', 'row instr' + (b.instrumental ? ' instrumental' : ''));
      for (const c of placeChords(chords, 0, Infinity)) row.appendChild(chordEl(c));
      if (b.instrumental) row.appendChild(el('span', 'instr-label', '[Instrumental]'));
      row.dataset.i = wordCount;
      rowEls.push({ el: row, firstWord: wordCount, lastWord: wordCount, line: lineWords.length });
      lineChords.push({ n: chordCount(b.chords), lyric: false });
      wordLine.push(lineWords.length); lineWords.push(1);
      wordTexts.push(b.instrumental ? '[Instrumental]' : '');
      wordCount++;
      container.appendChild(row);
      continue;
    }

    // Chords that sit past the end of the lyric text belong to the last row
    const rows = wrapLine(b.text, maxCols);
    const lineIdx = lineWords.length; lineWords.push(0);
    lineChords.push({ n: chordCount(b.chords), lyric: !isDirection(b.text) });
    for (let r = 0; r < rows.length; r++) {
      const { start } = rows[r];
      const end = (r === rows.length - 1) ? Infinity : rows[r].end;
      const row = el('div', 'row' + (chords.length ? '' : ' no-chords'));
      const rangeStart = (r === 0) ? 0 : rows[r - 1].end;   // chords typed over the wrap space move down too
      for (const c of placeChords(chords, start, end, rangeStart)) row.appendChild(chordEl(c));

      // Lyric text: each word in its own span
      const segment = b.text.slice(start, rows[r].end);
      const firstWord = wordCount;
      const re = /(\S+)|(\s+)/g;
      let m;
      while ((m = re.exec(segment)) !== null) {
        if (m[1]) {
          const w = el('span', 'w', m[1]);
          w.dataset.i = wordCount++;
          wordLine.push(lineIdx); lineWords[lineIdx]++;
          wordTexts.push(m[1]);
          row.appendChild(w);
        } else {
          row.appendChild(document.createTextNode(m[2]));
        }
      }
      rowEls.push({ el: row, firstWord, lastWord: Math.max(firstWord, wordCount - 1), line: lineIdx });
      container.appendChild(row);
    }
  }
  computeLeadIn();
  checkTiming();
  buildScrollMap();
}

// Lines on screen that aren't sung: "(piano)", "(piano + fiddle)", "Interlude:"
function isDirection(text) { const t = text.trim(); return /^\(.*\)$/.test(t) || /^[A-Za-z][\w ]*:$/.test(t); }
function chordCount(chords) { return chords.filter(c => c.name !== '|' && c.name !== '(' && c.name !== ')').length; }

/* Lead-in: instrumental / chords-only lines (and "(piano)"-style lines) before the first lyric are an intro.
   Each lasts as long as the opening lyric lines take to play the same chords: intro "G C" / "D G" over a
   verse that starts "G C" / "D G" — the first intro line lasts as long as the first lyric line, and so on.
   This is for Even pacing; timed songs get it baked into the timing file by lyric-alignment-builder,
   which uses the same rule. */
function chordTime(p, lines) {          // seconds into `lines` [{n chords, dur}] at which chord number p starts
  let t = 0, seen = 0;
  for (const L of lines) {
    if (!L.n) { t += L.dur; continue; }  // a line with no chord change: the chord carries on
    if (p <= seen + L.n) return t + L.dur * (p - seen) / L.n;
    seen += L.n; t += L.dur;
  }
  return t + (p - seen) * (seen ? t / seen : secondsPerLine() / 2);   // ran out of verse: keep the same pace
}
function computeLeadIn() {
  leadSecs = {};
  const intro = [];                                   // leading non-lyric lines: [{words, n}]
  let li = 0;
  for (; li < lineChords.length && !lineChords[li].lyric; li++) {
    const words = [];
    wordLine.forEach((l, w) => { if (l === li) words.push(w); });
    if (words.length) intro.push({ words, n: lineChords[li].n });
  }
  const verse = lineChords.slice(li).map(L => ({ n: L.n, dur: secondsPerLine() }));
  let pos = 0;
  for (const r of intro) {
    const secs = chordTime(pos + r.n, verse) - chordTime(pos, verse);
    pos += r.n;
    if (secs > 0) for (const w of r.words) leadSecs[w] = secs / r.words.length;
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
   lyric drag — changes this number and calls setProgress().
   ===================================================================== */

let progress = 0;

function rowAt(wordIndex) {
  const i = Math.max(0, Math.min(wordIndex, wordCount - 1));
  return rowEls.find(r => i >= r.firstWord && i <= r.lastWord) || rowEls[rowEls.length - 1];
}
function setProgress(p) {
  progress = Math.max(0, Math.min(wordCount, p));
}

/* Smooth scroll. Each typed line passes the middle of the screen halfway through the time it is sung;
   between those moments the text moves at a steady speed (so it never stops and jumps). What is drawn
   then eases towards that position with a quarter-second lag, which rounds off the changes of speed
   from one line to the next. A finger on the text (or a flick coasting) moves it directly. */
let scrollMap = null;      // {cum: seconds at 1× before each word, anchors: [{t, y}] one per typed line}
let shownY = null;         // the y currently drawn (song coordinates at the focus point)
const SMOOTH = 0.25;       // seconds; bigger = lazier, smoother scroll

function buildScrollMap() {
  const cum = [0];
  for (let i = 0; i < wordCount; i++) cum.push(cum[i] + secondsPerWordAt(i));
  const anchors = [];
  let cur = null;
  for (const r of rowEls) {
    if (!cur || cur.line !== r.line) { cur = { line: r.line, first: r.firstWord, last: r.lastWord, top: r.el.offsetTop, bottom: 0 }; anchors.push(cur); }
    cur.last = r.lastWord;
    cur.bottom = r.el.offsetTop + r.el.offsetHeight;
  }
  scrollMap = { cum, anchors: anchors.map(L => ({ t: (cum[L.first] + cum[L.last + 1]) / 2, y: (L.top + L.bottom) / 2 })) };
  shownY = null;            // re-laid out: jump straight to the right place
}
function songTime(p) {      // seconds into the song (at 1×) at progress p
  const c = scrollMap.cum, i = Math.max(0, Math.min(Math.floor(p), wordCount - 1));
  return c[i] + (p - i) * (c[i + 1] - c[i]);
}
function progressAtTime(t) {
  const c = scrollMap.cum;
  if (t <= 0) return 0;
  if (t >= c[wordCount]) return wordCount;
  let lo = 0, hi = wordCount;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= t) lo = m; else hi = m; }
  return lo + (t - c[lo]) / ((c[lo + 1] - c[lo]) || 1);
}
// Piecewise-linear through the anchors, extended past the ends with the first / last segment's slope
function interp(x, xs, ys) {
  const n = xs.length;
  if (n === 1) return ys[0];
  let k = 0;
  while (k < n - 2 && x > xs[k + 1]) k++;
  const dx = xs[k + 1] - xs[k];
  return dx ? ys[k] + (x - xs[k]) * (ys[k + 1] - ys[k]) / dx : ys[k + 1];
}
function yOfProgress(p) {
  if (!scrollMap || !scrollMap.anchors.length) return 0;
  const a = scrollMap.anchors;
  return interp(songTime(p), a.map(x => x.t), a.map(x => x.y));
}
function progressOfY(y) {
  if (!scrollMap || !scrollMap.anchors.length) return 0;
  const a = scrollMap.anchors;
  return Math.max(0, Math.min(wordCount, progressAtTime(interp(y, a.map(x => x.y), a.map(x => x.t)))));
}
function drawScroll(dt) {
  if (!rowEls.length || !scrollMap) return;
  const target = yOfProgress(progress);
  const direct = dragging || Math.abs(flingVelocity) > 5;
  if (shownY === null || direct) shownY = target;
  else shownY += (target - shownY) * (1 - Math.exp(-dt / SMOOTH));
  const focusY = document.getElementById('viewport').clientHeight * 0.5;
  document.getElementById('song').style.transform = `translateY(${focusY - shownY}px)`;
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
   Pacing, two kinds:
   - Timed: songs/<song>.timing.json (made by lyric-alignment-builder from
     a recording) gives every word its start time, so each word lasts as
     long as it did when sung; 1× = the recording's pace.
   - Even: no timing file (or one that no longer matches the lyrics): the
     song file's `speed` is seconds per typed line at 1×, shared equally
     among that line's words.
   The slider multiplies either one.
   Dragging the lyrics or the bar overrides everything while the finger
   is down; a flick on the lyrics coasts to a stop.
   ===================================================================== */

let speedMultiplier = 1;           // 0 … 2, the slider position
let playing = false;               // the play/pause button; the page loads paused at 1×
let lastTick = null;
let dragging = false;              // finger on the bar or the lyrics
let flingVelocity = 0;             // px/s of a lyric flick still coasting

function secondsPerLine() {
  const v = Number(currentSong && currentSong.meta.speed);
  return v > 0 ? v : 6;
}
function secondsPerWordAt(p) {
  const i = Math.max(0, Math.min(Math.floor(p), wordCount - 1));
  if (timing) {
    const s = timing.slots;
    const end = i + 1 < s.length ? s[i + 1].t : Math.max(s[i].e || 0, s[i].t + 1);
    return Math.max(0.05, end - s[i].t);
  }
  if (leadSecs[i]) return leadSecs[i];
  return secondsPerLine() / (lineWords[wordLine[i]] || 1);
}

// The timing file for the open song, used only if it matches what is on screen word for word.
let timingFile = null;   // as loaded (null: none)
let timing = null;       // timingFile when it matches the rendered words, else null
let timingUsable = false; // a timing file exists and matches the lyrics
let preferEven = false;    // you tapped the badge to switch this song to Even (remembered per song)
function checkTiming() {
  const s = timingFile && timingFile.slots;
  timingUsable = Array.isArray(s) && s.length === wordCount && s.every((x, i) => (x.w || '') === wordTexts[i]);
  timing = timingUsable && !preferEven ? timingFile : null;
  const badge = document.getElementById('pace');
  badge.textContent = timing ? 'Timed' : 'Even';
  badge.classList.toggle('timed', !!timing);
  badge.classList.toggle('can-time', timingUsable && !timing);      // Even by choice: tap to go back to Timed
  badge.classList.toggle('stale', !timingUsable && !!timingFile);
  badge.disabled = !timingUsable;
  badge.title = timing ? 'Paced by the recorded timing (1× = as recorded). Tap for even pacing.'
    : timingUsable ? 'Even pacing by choice. Tap to use the recorded timing.'
    : timingFile ? 'Timing file is out of date for these lyrics — using even pacing' : 'Even pacing (no timing file)';
}
// Tap the badge: switch between Timed and Even (only when the song has usable timing). The text keeps its place.
function togglePace() {
  if (!timingUsable) return;
  preferEven = !preferEven;
  try { localStorage.setItem('pace:' + currentSong.file, preferEven ? 'even' : 'timed'); } catch (e) {}
  const y = shownY;
  checkTiming();
  buildScrollMap();
  shownY = y;            // ease from where the text is now instead of jumping
}
async function loadTiming(filename) {
  try {
    const res = await fetch('songs/' + filename.replace(/\.txt$/, '.timing.json'), { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch (e) { return null; }
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
      setProgress(progress + dt * speedMultiplier / secondsPerWordAt(progress));
      if (progress >= wordCount) setPlaying(false);
    }
    drawScroll(dt);
  }
  lastTick = now;
  requestAnimationFrame(tick);
}

const SPEED_STEP = 0.1;             // one pedal press
function nudgeSpeed(delta) {
  setSpeed(speedMultiplier + delta);
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
}
function togglePause() { setPlaying(!playing); }

// Dragging the lyrics: the text follows the finger; a flick coasts.
function setupLyricDrag() {
  const vp = document.getElementById('viewport');
  let active = false, startY = 0, startSongY = 0, moved = false;
  let samples = [];                                   // recent [time, y] for the flick velocity
  vp.addEventListener('pointerdown', ev => {
    if (ev.target.closest('#sidebar')) return;
    active = true; moved = false; dragging = true; flingVelocity = 0;
    startY = ev.clientY; startSongY = shownY !== null ? shownY : yOfProgress(progress);   // grab the text where it is drawn
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
   5b. KEY AND CAPO
   Key: the key the song SOUNDS in, with the melody range you'd sing in it
   — the same for everyone, whatever they play. Capo: none, or 1–8; the
   chords drop by that many semitones so a guitarist reads the shapes to
   play with the capo on. The * marks the capo needing the fewest chords
   outside the basic open ones (ties go to the lower capo).
   In the song file, `key:` is the key the chords are written in and
   `capo:` the capo they're written for (so the song sounds in key + capo,
   and that capo is the starting choice); `low:`/`high:` are sounding pitches.
   Both choices are remembered per song on this device.
   ===================================================================== */

const BASIC_CHORDS = new Set(['C', 'G', 'D', 'F', 'A', 'E', 'Fm', 'Em', 'Am', 'Dm']);
const MAX_CAPO = 8;

function writtenCapo(song) { const c = parseInt(song.meta.capo, 10); return c >= 0 && c <= 11 ? c : 0; }
function soundingHome(song) {          // the key the song sounds in as written (key + capo)
  return KEYS[(noteToIndex(keyRoot(song.meta.key)) + writtenCapo(song)) % 12];
}
// Semitones to shift the written chords for sounding key k and capo c
function chordShift(song, k, c) { return writtenCapo(song) + semitonesBetween(soundingHome(song), k) - c; }
function shapeKey(song, k, c) { return KEYS[(noteToIndex(k) - c + 12) % 12]; }   // the key the shapes are in

// "Am7" → "Am", "D7" → "D", "G/B" → "G", "Dsus4" → "D": the root, and m if minor
function basicForm(name) {
  const m = name.match(/^([A-G][#b]?)(m(?!aj))?/);
  return m ? m[1] + (m[2] ? 'm' : '') : null;
}
function hardChordCount(song, k, c) {  // distinct chords outside BASIC_CHORDS at this key and capo
  const shift = chordShift(song, k, c), flats = FLAT_KEYS.has(shapeKey(song, k, c));
  const hard = new Set();
  for (const b of song.blocks) for (const ch of (b.chords || [])) {
    const f = basicForm(transposeChord(ch.name, shift, flats));
    if (f && !BASIC_CHORDS.has(f)) hard.add(f);
  }
  return hard.size;
}
function recommendedCapo(song, k) {
  let best = 0, bestN = Infinity;
  for (let c = 0; c <= MAX_CAPO; c++) {
    const n = hardChordCount(song, k, c);
    if (n < bestN) { best = c; bestN = n; }           // strictly fewer: ties keep the lower capo
  }
  return best;
}

function buildKeyDropdown(song) {
  const sel = document.getElementById('key');
  sel.innerHTML = '';
  const home = soundingHome(song);
  for (const k of KEYS) {
    const opt = document.createElement('option');
    opt.value = k;
    const range = rangeText(song.meta, semitonesBetween(home, k), FLAT_KEYS.has(k));
    opt.textContent = k + (range ? ' (' + range + ')' : '');
    sel.appendChild(opt);
  }
  let chosen = null;
  try { chosen = localStorage.getItem('soundKey:' + song.file); } catch (e) {}
  sel.value = KEYS.includes(chosen) ? chosen : home;
  let capo = null;
  try { capo = localStorage.getItem('capo:' + song.file); } catch (e) {}
  capo = capo === null ? writtenCapo(song) : Number(capo);
  buildCapoDropdown(song, Math.min(MAX_CAPO, Math.max(0, capo || 0)));
  applyKey();
}

function buildCapoDropdown(song, selected) {
  const sel = document.getElementById('capo');
  const rec = recommendedCapo(song, document.getElementById('key').value);
  sel.innerHTML = '';
  for (let c = 0; c <= MAX_CAPO; c++) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = (c ? 'Capo ' + c : 'No capo') + (c === rec ? '*' : '');
    sel.appendChild(opt);
  }
  sel.value = String(selected);
}

function applyKey() {
  const k = document.getElementById('key').value;
  const capoSel = document.getElementById('capo');
  buildCapoDropdown(currentSong, Number(capoSel.value) || 0);   // the * may move with the key
  const c = Number(capoSel.value) || 0;
  currentSemis = chordShift(currentSong, k, c);
  currentFlats = FLAT_KEYS.has(shapeKey(currentSong, k, c));
  try {
    localStorage.setItem('soundKey:' + currentSong.file, k);
    localStorage.setItem('capo:' + currentSong.file, String(c));
  } catch (e) {}
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

// Which publish this is: publish.sh stamps ?v=<unix time> on app.js. Shown at the bottom of the song picker,
// so after publishing you can see whether the phone has picked up the new version.
function showVersion() {
  const m = /[?&]v=(\d+)/.exec((document.querySelector('script[src*="app.js"]') || {}).src || '');
  const when = m ? new Date(Number(m[1]) * 1000) : null;
  document.getElementById('version').textContent = when
    ? 'Version published ' + when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Version: unpublished copy';
}

function setupPicker() {
  showVersion();
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
  timingFile = await loadTiming(filename);
  try { preferEven = localStorage.getItem('pace:' + filename) === 'even'; } catch (e) { preferEven = false; }
  progress = 0;
  flingVelocity = 0;
  setSpeed(1);
  setPlaying(false);
  try { localStorage.setItem('lastSong', filename); } catch (e) {}
  document.getElementById('title').textContent = currentSong.meta.title || filename;
  document.getElementById('artist').textContent =
    currentSong.meta.artist || '';
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
  document.getElementById('capo').addEventListener('change', ev => { applyKey(); ev.target.blur(); });
  document.getElementById('speed').addEventListener('input', ev => setSpeed(Number(ev.target.value)));
  document.getElementById('play').addEventListener('click', togglePause);
  document.getElementById('pace').addEventListener('click', ev => { togglePace(); ev.target.blur(); });   // blur: pedal keys
  setupPicker();
  setSpeed(1);
  setPlaying(false);
  requestAnimationFrame(tick);
  document.getElementById('font-minus').addEventListener('click', () => setFontSize(getFontSize() - 2));
  document.getElementById('font-plus').addEventListener('click', () => setFontSize(getFontSize() + 2));

  // Re-wrap when the phone rotates
  window.addEventListener('resize', () => { if (currentSong) { renderSong(currentSong); setProgress(progress); } });
}

start();

# Singalong

A phone-sized lyrics-and-chords teleprompter. Plain HTML, CSS and JavaScript; no build tools.

## Files

```
-singalong/
├── index.html        the one page: layout of the screen
├── style.css         colours, sizes, fonts
├── app.js            all the behaviour (parsing song files, drawing, scrolling)
├── songs/
│   ├── index.json    the list of song files — generated, do not edit by hand
│   └── *.txt         one song per file
├── make-index.sh     rebuilds songs/index.json from the files in songs/ (publish.sh runs it)
├── publish.sh        commit + push to GitHub, which republishes the site
└── README.md         this file
```

## Song file format

```
title: Amazing Grace
artist: John Newton
key: G              ← the key the chords below are written in
low: D4             ← lowest melody note, scientific pitch (middle C is C4)
high: E5            ← highest melody note
tags: xmas          ← comma-separated; any word works, the picker's filter buttons come from these
speed: 6            ← seconds per typed line when the speed slider is at 1× (slider runs 0–2×)
---
[Verse 1]
G              G7  C         G
Amazing grace, how sweet the sound
```

Rules of thumb:

- Front matter ends at the `---` line. Everything after is the song.
- A line is treated as a **chord line** when every "word" on it looks like a chord (`G`, `Am7`, `Dsus4`, `G/B`, `N.C.`, `|`). It attaches to the lyric line right below it. A chord line with nothing below it (or a blank line below) is shown on its own, for intros and outros.
- Chords sit over the character in the same column. Use spaces, not tabs, to position them (tabs are converted to 4 spaces, which is rarely what you want).
- `[Verse 1]`, `[Chorus]`, `[Bridge]` — anything in square brackets on its own line — is a section label.
- Blank lines separate sections.
- Long lines are wrapped on the phone automatically; each chord stays over its character.

## Controls

- **Tap the title** to open the song picker: search by title or artist, filter by tag (the buttons come
  from the tags in the song files), tap a song to open it. The last song opened is remembered.
- **Manual / Voice** toggle. Manual: ▶ starts the pointer moving at the slider's speed (1× = the
  song's `speed`; a song opens paused at 1×); the bar on the right edge drags through the song
  (words un-green as you drag up); tapping the lower part of the lyrics jumps to the next line, the
  upper part to the previous one.
- Keys (desktop, or a Bluetooth page-turner pedal): ↓ / Page Down = next line, ↑ / Page Up = previous
  line, Space = pause / resume at the last speed.
- **Key** dropdown transposes; each option shows the melody range in that key. Remembered per song.
- **− / +** change the text size. Remembered on the device.

## Adding a song

Drop a new `.txt` into `songs/` and run `bash publish.sh` — it rebuilds the index and pushes.

## Testing

Desktop: open a terminal in this folder, run `python3 -m http.server 8000`, then visit http://localhost:8000 in Chrome.
(Opening index.html directly from Finder does not work: browsers refuse to read the song files from a `file://` page.)

iPhone: the easiest way is GitHub Pages — see the stage-6 notes once we get there, or follow the quick instructions in the chat.

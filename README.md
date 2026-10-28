# Singalong

A phone-sized lyrics-and-chords teleprompter. Plain HTML, CSS and JavaScript; no build tools.

## Files

```
-singalong/
├── index.html        the one page: layout of the screen
├── style.css         colours, sizes, fonts
├── app.js            all the behaviour (parsing song files, drawing, scrolling)
├── songs/
│   ├── index.json    the list of song files (one filename per line)
│   └── *.txt         one song per file
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
speed: 6            ← default auto-scroll speed (worked out in stage 3; harmless for now)
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

## Testing

Desktop: open a terminal in this folder, run `python3 -m http.server 8000`, then visit http://localhost:8000 in Chrome.
(Opening index.html directly from Finder does not work: browsers refuse to read the song files from a `file://` page.)

iPhone: the easiest way is GitHub Pages — see the stage-6 notes once we get there, or follow the quick instructions in the chat.

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
- **Drag the lyrics** and they follow your finger, like a web page; a flick coasts. Finger down = earlier
  words (text moves down). The bar on the right works the same way: its thumb sits at the bottom at the
  start of the song and dragging it down scrolls back. A tap (no drag) on the lower part of the lyrics
  jumps to the next line, on the upper part to the previous one.
- **▶** (top of the right-hand column) starts the pointer moving; a song opens paused at 1×.
- **Manual**: the speed slider sets the rate (1× = the song's `speed`).
- **Voice**: the pointer still moves on its own, but ▶ also turns on the microphone (Safari asks the
  first time) and the rate is fitted live to the words heard — the slider shows the fitted rate and
  is read-only. Each recognised word is looked for near the projected position; the search widens
  with the square root of the time since the last match, so a lost singer is found again without a
  repeated chorus pulling the pointer away. A hit eases the pointer to that word and nudges the rate.
  Hearing nothing changes nothing: the pointer keeps going at the last rate. The status row shows a red
  pulsing dot while listening, green on a fresh match, the seconds since the last match, and the last
  words heard. Safari stops listening after a pause; the page restarts it.
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

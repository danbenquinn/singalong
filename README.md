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
│   ├── *.txt         one song per file
│   └── *.timing.json word timings from a recording (optional; made by lyric-alignment-builder)
├── config.js         the SHA-256 hash of the password (written by set-password.sh)
├── set-password.sh   choose a new password, then publish
├── make-index.sh     rebuilds songs/index.json from the files in songs/ (publish.sh runs it)
├── publish.sh        commit + push to GitHub, which republishes the site
├── tools/import_songs.py   the one-off importer that built the library from the docx and the originals
├── lyric-alignment-builder/  recordings → timing files; local only, not in git (see its README)
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
speed: 6            ← seconds per typed line at 1× — only used when the song has no timing file
capo: 3             ← optional; shown after the artist
# any line without a colon, like this one, is a comment
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
- A **bare** label (nothing under it before the next blank line, e.g. a second `[Chorus]`) repeats the lines
  written under the last label of that name, so the chorus is on screen each time it's sung.
- **Instrumental lines:** a chord line with `[Instrumental]` under it shows the chords with
  *[Instrumental]* where the lyrics would be, and is a line like any other (it scrolls past the middle in
  its turn). Use them for intros and mid-song breaks:
  ```
  G             C
  [Instrumental]
  D             G
  [Instrumental]
  ```
  (`[Instrumental]` on its own, with no chord line above it, is still just a section label.)
- **Lead-in:** instrumental lines (or chords-only / `(piano)` lines) before the first sung line are the
  intro. Each is timed chord-for-chord from the opening lyric lines: above, `G C` lasts as long as the first
  verse line (also `G C`), `D G` as long as the second. Timed songs have this worked out in the timing file
  by the builder; Even songs use the same rule. Press ▶ as you start the intro.
- Blank lines separate sections.
- Long lines are wrapped on the phone automatically; each chord stays over its character.

## Controls

- **Tap the title** to open the song picker: search by title or artist, filter by tag (the buttons come
  from the tags in the song files), tap a song to open it. The last song opened is remembered.
- **Smooth scroll.** The text moves steadily upward; each line crosses the middle of the screen halfway
  through the time it's sung, so the middle is the "you are here" (nothing is coloured as it's sung).
  The motion eases between lines rather than stopping, so it may run a touch ahead or behind in between.
  `SMOOTH` in app.js sets how lazy that easing is.
- **Drag the lyrics** and they follow your finger, like a web page; a flick coasts. Finger down = earlier
  words (text moves down).
- **▶** (top right) starts the pointer moving; a song opens paused at 1×. Press it as you start playing:
  the intro chords if the song file has them (see Lead-in above), otherwise the first word.
- **Pacing.** The badge left of the key says which: **Timed** — the song has `songs/<song>.timing.json`
  (made from a recording with `lyric-alignment-builder/`), so every word lasts as long as it did when you
  sang it, and 1× is the recording's pace. **Even** — no timing file: the song's `speed` is shared evenly
  over each line's words. Amber **Even** means a timing file exists but the lyrics have changed since it was
  made; re-run the builder. **Tap the badge** on a song that has timing to switch between Timed and Even
  (a dashed green **Even** means Even by choice; tap again for Timed). Remembered per song on the device.
  The **speed slider** multiplies either kind (0–2×).
- **Pedal / keys**: Page Down (or ↓ / →) = speed up by 0.1×, Page Up (or ↑ / ←) = slow down by 0.1×,
  Space = pause / resume. A Bluetooth page-turner
  pedal pairs with the phone as a keyboard (Settings › Bluetooth); set it to a mode that sends Page
  Up/Down or arrow keys and it needs nothing from the site. The speed value flashes amber on each press.
- **Key** dropdown transposes; each option shows the melody range in that key. Remembered per song.
- **− / +** change the text size. Remembered on the device.

## Adding or editing a song

Drop a new `.txt` into `songs/` (or edit one), then in Terminal:

```
cd ~/Library/CloudStorage/OneDrive-UniversityofVirginia/DQ/Life/Art/active/-singalong && bash publish.sh
```

To pace a song from a recording, see `lyric-alignment-builder/README.md`: record it, `bash align.sh <song>`,
check it with `bash review.sh <song>`, then publish as above.

It rebuilds the index, commits, and pushes; the site updates about a minute later. The imported songs
still have empty `low:` / `high:` lines and a guessed `key:` — fill those in as you get to each song.

## Password

The page asks for a password once per device (remembered until the password changes). To change it:
`bash set-password.sh`, type the new one, then `bash publish.sh`. Only the hash is published.

This is a courtesy lock, not security: the song files are still fetchable from the public site by
anyone who knows the address. The free stronger option is Cloudflare Pages + Cloudflare Access (a real
login in front of the whole site); say the word if that ever matters.

## Hosting

GitHub Pages serves the `main` branch of github.com/danbenquinn/singalong at
https://danbenquinn.github.io/singalong/. The push uses the same token as the classes site
(`Work/Teaching/github-credential.txt`, wired in with `git config credential.helper`; the token must
list this repo under its repository access). Cache-busting `?v=` stamps are added by `publish.sh` so
phones never pair a new page with an old script.

## Offline

`sw.js` is a service worker: the first time the site is opened online it stores the page and every
song on the phone, and from then on serves them when there is no signal (network first, so edits
still arrive when online). Each publish stamps a new version into `sw.js`; the phone picks it up on
its next online visit. Everything works offline, timing files included (they are cached alongside the
songs).

## Testing on the Mac

Open a terminal in this folder, run `python3 -m http.server 8000`, then visit http://localhost:8000 in
Chrome. (Opening index.html directly from Finder does not work: browsers refuse to read the song files
from a `file://` page.) Wake lock and the microphone only work on the real HTTPS site.

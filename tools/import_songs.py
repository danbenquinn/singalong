#!/usr/bin/env python3
"""import_songs.py — one-off import of Daniel's existing songs into songs/*.txt.

  python3 tools/import_songs.py docx  "<path to Sing-Along Song Chords.docx>"
  python3 tools/import_songs.py originals "<path to Life/Art/archive/songs>"

Both write one file per song into songs/ (next to this tools/ folder), skipping any
file that already exists so hand edits are never overwritten. Delete a file and
re-run to regenerate it.

The docx aligns chords with Word tab stops in Courier New 11 pt. A tab in Word jumps
to the next stop (every 0.5 inch by default, or the paragraph's own stops); one
Courier New 11 pt character is 6.6 pt wide, so a default stop is 5.45 characters.
We walk each line in points and round to the nearest character column, which is as
close as the original ever was.
"""
import re, sys, os, unicodedata
from pathlib import Path

SONGS = Path(__file__).resolve().parent.parent / "songs"
CHAR_PT = 6.6            # width of one Courier New 11 pt character
DEFAULT_TAB_PT = 36.0    # Word's default tab stop (720 twips)

CHORD_RE = re.compile(r"^[A-G][#b]?(?:maj|min|m|M|dim|aug|sus|add|\+|°|ø|[0-9])*[0-9]*(?:sus[24]|add[0-9]+|[b#][0-9]+)*(?:/[A-G][#b]?)?$")

def is_chord_line(line):
    toks = line.split()
    return bool(toks) and all(CHORD_RE.match(t) or t in ("|", "N.C.", "(", ")") for t in toks)

def slug(title):
    s = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s or "song"

def guess_key(body):
    """The last chord of the song is usually the tonic; fall back to the first."""
    chords = []
    for line in body:
        if is_chord_line(line):
            chords += [t for t in line.split() if CHORD_RE.match(t)]
    if not chords:
        return "C"
    root = re.match(r"[A-G][#b]?", chords[-1]).group(0)
    return root

def write_song(meta, body, note=None):
    SONGS.mkdir(exist_ok=True)
    path = SONGS / (slug(meta["title"]) + ".txt")
    if path.exists():
        print(f"  skip (exists): {path.name}")
        return
    lines = [f"title: {meta['title']}", f"artist: {meta.get('artist', '')}",
             f"key: {meta.get('key', 'C')}", f"low: {meta.get('low', '')}", f"high: {meta.get('high', '')}",
             f"tags: {meta.get('tags', '')}", f"speed: {meta.get('speed', 6)}"]
    if meta.get("capo"):
        lines.append(f"capo: {meta['capo']}")
    if note:
        lines.append(f"# {note}")
    lines.append("---")
    # trim leading/trailing blank lines, collapse runs of blanks
    out = []
    for l in body:
        l = l.rstrip()
        if l == "" and (not out or out[-1] == ""):
            continue
        out.append(l)
    while out and out[-1] == "":
        out.pop()
    path.write_text("\n".join(lines + out) + "\n", encoding="utf-8")
    print(f"  wrote {path.name}")

# ---------------------------------------------------------------- docx
def para_pieces(p):
    """Yield ('text', str) / ('tab',) / ('break',) in document order for one paragraph."""
    from docx.oxml.ns import qn
    for r in p._p.iter():
        tag = r.tag
        if tag == qn("w:t"):
            yield ("text", r.text or "")
        elif tag == qn("w:tab"):
            yield ("tab",)
        elif tag == qn("w:br") and r.get(qn("w:type")) == "page":
            yield ("break",)

def expand_line(pieces, stops_pt):
    """Lay the pieces out in points, then round to character columns."""
    pos = 0.0
    cells = {}
    for pc in pieces:
        if pc[0] == "tab":
            nxt = [s for s in stops_pt if s > pos + 0.5]
            if nxt:
                pos = nxt[0]
            else:
                pos = (int(pos / DEFAULT_TAB_PT) + 1) * DEFAULT_TAB_PT
        elif pc[0] == "text":
            for ch in pc[1].replace("\xa0", " "):
                col = round(pos / CHAR_PT)
                if ch != " " or col not in cells:
                    cells[col] = ch
                pos += CHAR_PT
    if not cells:
        return ""
    width = max(cells) + 1
    return "".join(cells.get(i, " ") for i in range(width)).rstrip()

def import_docx(path):
    import docx
    d = docx.Document(path)
    songs, cur = [], []
    for p in d.paragraphs:
        stops = [ts.position.pt for ts in p.paragraph_format.tab_stops]
        pieces = list(para_pieces(p))
        # a page break inside a paragraph splits it: before → this song, after → next song
        chunk = []
        for pc in pieces:
            if pc[0] == "break":
                cur.append(expand_line(chunk, stops)); chunk = []
                songs.append(cur); cur = []
            else:
                chunk.append(pc)
        cur.append(expand_line(chunk, stops))
    songs.append(cur)

    xmas_count = 12   # the first twelve songs in the document are the Christmas set
    n = 0
    for lines in songs:
        while lines and not lines[0].strip():
            lines.pop(0)
        if not lines:
            continue
        title = lines[0].strip()
        if title.lower().startswith("to add") or title.lower() == "disney":
            continue
        n += 1
        artist = lines[1].strip() if len(lines) > 1 else ""
        artist = re.sub(r"\s*\((?:[^()]*\d{4}[^()]*)\)\s*$", "", artist)   # drop "(1994)"-style years
        body = lines[2:]
        tags = "xmas" if n <= xmas_count else "pop"
        m = re.match(r"^(Hercules|Frozen):\s*(.+)$", title)
        if m:
            title = m.group(2); tags = "pop, disney"
        body = [re.sub(r"^\s*Chorus:\s*$", "[Chorus]", l) for l in body]
        write_song({"title": title, "artist": artist, "key": guess_key(body), "tags": tags}, body,
                   note="key guessed from the last chord; fill in low/high")

# ---------------------------------------------------------------- originals
def import_originals(folder):
    for f in sorted(Path(folder).glob("*.txt")):
        text = f.read_text(encoding="utf-8")
        text = text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", "\n").replace("\xa0", " ")
        lines = text.split("\n")
        title = lines[0].strip()
        meta = {"title": title, "artist": "Daniel Quinn", "tags": "original"}
        note_bits = []
        i = 1
        # header lines until the first blank line or the first chord/lyric pair
        while i < len(lines) and lines[i].strip() and not is_chord_line(lines[i].replace("(Capo", "").strip()):
            l = lines[i].strip()
            m = re.search(r"[Cc]apo\s*(\d+)", l)
            if m:
                meta["capo"] = m.group(1)
            if re.fullmatch(r"~?\d{4}", l):
                meta["year"] = l.lstrip("~")
            elif not m or len(l) > 8:
                note_bits.append(l)
            i += 1
        body = lines[i:]
        # "(Capo 4)" written on a chord line → front matter, replaced by spaces so columns hold
        for j, l in enumerate(body):
            m = re.search(r"\((?:Capo|capo)\s*(\d+)\)", l)
            if m:
                meta.setdefault("capo", m.group(1))
                body[j] = l[:m.start()] + " " * (m.end() - m.start()) + l[m.end():]
        body = [re.sub(r"^\s*(Chorus|Verse \d+|Bridge|Outro|Intro):\s*$", r"[\1]", l) for l in body]
        body = [re.sub(r"^\{(.+)\}\s*$", r"[\1]", l) for l in body]
        if meta.get("year"):
            meta["artist"] = f"Daniel Quinn ({meta['year']})"
        meta["key"] = guess_key(body)
        note = "key guessed from the last chord; fill in low/high"
        if note_bits:
            note += " · " + " / ".join(note_bits)
        write_song(meta, body, note=note)

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("docx", "originals"):
        print(__doc__); sys.exit(1)
    (import_docx if sys.argv[1] == "docx" else import_originals)(sys.argv[2])

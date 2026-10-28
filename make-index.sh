#!/usr/bin/env bash
# make-index.sh — rebuild songs/index.json from the .txt files in songs/. publish.sh runs this for you.
cd "$(dirname "$0")/songs"
{ echo "["; ls *.txt | sed 's/.*/  "&"/' | paste -sd, - | sed 's/,/,\n/g'; echo "]"; } > index.json
echo "songs/index.json: $(ls *.txt | wc -l | tr -d ' ') songs"

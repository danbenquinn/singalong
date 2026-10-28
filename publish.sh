#!/usr/bin/env bash
# publish.sh — commit everything in this folder and push it to GitHub, which republishes the site.
#
#   bash publish.sh                 commit with a dated message and push
#   bash publish.sh "message"       same, with your own commit message
#   bash publish.sh --dry           show what would change, push nothing
#
# Modelled on Work/Teaching/site-suite/push_site.sh. Same idea: the folder IS the repo, so a file
# deleted here is deleted on the site and anything unpushed shows up in `git status`.
# The push token is the one the classes site already uses (Work/Teaching/github-credential.txt),
# wired in once with `git config credential.helper`; it never lives in this folder.
set -euo pipefail
cd "$(dirname "$0")"

DRY=0; MSG=""
for a in "$@"; do
  case "$a" in
    --dry) DRY=1 ;;
    *) MSG="$a" ;;
  esac
done

# Cache-busting: stamp the ?v= on the two links in index.html with the current time, so a phone that
# cached the old app.js or style.css fetches the new ones (Safari otherwise keeps them for days).
bash make-index.sh
STAMP="$(date +%s)"
sed -i.bak -E "s/(style\.css|app\.js|config\.js)\?v=[0-9]+/\1?v=$STAMP/g" index.html && rm -f index.html.bak

git add -A
if git diff --cached --quiet; then
  echo "Nothing to publish — the site already matches this folder."
  exit 0
fi

echo "Changes going out:"
git diff --cached --stat
if [ "$DRY" = 1 ]; then echo "(dry run — nothing committed or pushed)"; exit 0; fi

[ -n "$MSG" ] || MSG="Update $(date '+%Y-%m-%d %H:%M')"
git commit -q -m "$MSG"
git push -q origin main
echo "Pushed. GitHub Pages rebuilds in about a minute: https://danbenquinn.github.io/singalong/"

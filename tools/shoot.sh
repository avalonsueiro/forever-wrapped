#!/bin/bash
# Screenshot one page of the site at three screen sizes, without opening a window.
#   tools/shoot.sh <page> <out-dir> [extra query, e.g. "year=2024"]
#   <page> is a page number (1-19, same as the web/slides/NN-*.js file), "era3" for era page 3,
#   or "title" for the title page.
# Writes <out-dir>/<page>-1512x860.png (MacBook in Chrome), -1920x1080.png and -390x844.png (phone).
set -euo pipefail
page="${1:?page number, eraN or title}"; out="${2:?output folder}"; extra="${3:-}"
web="$(cd "$(dirname "$0")/../web" && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$out"
# own throwaway profile per run: works while normal Chrome is open, and runs can happen in parallel
profile="$(mktemp -d)"; trap 'rm -rf "$profile"' EXIT
case "$page" in
  title) query="" ;;
  era*)  query="era=${page#era}" ;;
  *)     query="slide=$page" ;;
esac
if [ -n "$extra" ]; then query="${query:+$query&}$extra"; fi
query="${query:+$query&}still"     # still: animations jump to their last frame
url="file://$web/index.html?$query"
frame="file://$(cd "$(dirname "$0")" && pwd)/frame.html"
urlencode() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"; }
for size in 1512x860 1920x1080 390x844; do
  w="${size%x*}"; h="${size#*x}"
  W=$(( w > 600 ? w + 40 : 640 )); H=$(( h + 240 ))      # bigger window: headless Chrome is at least 500 wide
  file="$out/$page-$size.png"
  # ?still makes every animation jump to its last frame, so a short wait is enough (long waits make
  # headless Chrome drop the record canvas)
  rm -f "$file"
  for attempt in 1 2 3; do            # Chrome sometimes fails when many shots run at once; try again
    "$chrome" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$profile" --allow-file-access-from-files \
      --window-size="$W,$H" --force-device-scale-factor=1 --virtual-time-budget=1200 \
      --screenshot="$file" "$frame?w=$w&h=$h&W=$W&H=$H&src=$(urlencode "$url")" >/dev/null 2>&1 || true
    # the page sits in an exact w x h frame in the middle of the picture; cut the picture down to it
    [ -s "$file" ] && sips -c "$h" "$w" "$file" >/dev/null 2>&1
    [ -s "$file" ] && break
    sleep 1
  done
  [ -s "$file" ] || { echo "failed: $file" >&2; continue; }
  echo "$file"
done

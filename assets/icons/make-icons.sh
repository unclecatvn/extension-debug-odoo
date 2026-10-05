#!/bin/sh
# Renders icon.svg to the PNG sizes Chrome needs (into static/icons/), using headless Chrome (macOS path).
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for s in 16 32 48 128; do
  printf '<html><body style="margin:0"><img src="icon.svg" width="%s" height="%s"></body></html>' $s $s > _tmp.html
  "$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size=$s,$s --screenshot="$PWD/../../static/icons/icon-$s.png" "file://$PWD/_tmp.html" >/dev/null 2>&1
done
rm -f _tmp.html

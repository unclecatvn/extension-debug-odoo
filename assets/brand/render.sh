#!/bin/sh
# Renders the brand PNGs with headless Chrome (macOS path): Chrome Web Store promo images, lockups, mascot.
# The SVGs come from make-brand.py; run that first if the drawing changed.
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FONT='<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@700&display=swap" rel="stylesheet">'
mkdir -p png
shot() { # url width,height out [transparent]
  "$CHROME" --headless --disable-gpu --hide-scrollbars --virtual-time-budget=4000 --window-size="$2" \
    ${4:+--default-background-color=00000000} --screenshot="$PWD/$3" "$1" >/dev/null 2>&1
}
shot "file://$PWD/store.html#small" 440,280 store/promo-small-440x280.png
shot "file://$PWD/store.html#marquee" 1400,560 store/promo-marquee-1400x560.png
# The store wants 24-bit images (no alpha).
python3 -c "import sys; from PIL import Image; [Image.open(f).convert('RGB').save(f) for f in sys.argv[1:]]" \
  store/promo-small-440x280.png store/promo-marquee-1400x560.png
for f in lockup lockup-white; do # inline, so the SVG's text gets the web font
  printf '<html><head>%s</head><body style="margin:0">%s</body></html>' "$FONT<style>svg{display:block;width:1000px;height:256px}</style>" \
    "$(cat $f.svg)" > _tmp.html
  shot "file://$PWD/_tmp.html" 1000,256 png/$f.png 1
done
for f in bo-do bo-do-white bo-do-icon; do
  printf '<html><body style="margin:0"><img src="%s.svg" width="512" height="512"></body></html>' $f > _tmp.html
  shot "file://$PWD/_tmp.html" 512,512 png/$f-512.png 1
done
rm -f _tmp.html

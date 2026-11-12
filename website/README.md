# Website

Landing page for Odoo Debug: https://odoo-debug.unclecatvn.com/

Static files only (`index.html`, no build step). `.github/workflows/pages.yml` publishes this folder to GitHub Pages on every push to `main` that touches it, at the custom domain set in the repository's Settings → Pages (an Actions deploy ignores a `CNAME` file). Preview locally with `python3 -m http.server -d website`.

`screenshots/` is shared with the repository READMEs: regenerate an image once, both pick it up.

`panel/` is the demo of the panel the page embeds in iframes: static markup with the panel's own classes, under `panel/panel.css`, a copy of `src/ui/panel.css`. When the panel's look changes, copy it again: `cp src/ui/panel.css website/panel/panel.css`.

`i18n/` holds one JSON file per language (the extension's ten, English excepted: it is the page itself). Each key is the English text of a `data-i18n` element of `index.html`, exactly as written there, HTML included; a missing key shows the English.

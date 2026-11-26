# Website

Landing page for Odoo Debug: https://odoo-debug.unclecatvn.com/

Static files, and one step: `npm run website` (`scripts/website.ts`) writes the page in each language, `<lang>/index.html`, from `index.html` and `i18n/`. Those are not committed. `.github/workflows/pages.yml` runs the step and publishes this folder to GitHub Pages on every push to `main` that touches it, at the custom domain set in the repository's Settings → Pages (an Actions deploy ignores a `CNAME` file). Preview locally with `npm run website && python3 -m http.server -d website`. Paths in `index.html` start at `/`: the same file is served from `/` and from `/<lang>/`.

`screenshots/` is shared with the repository READMEs: regenerate an image once, both pick it up.

`panel/` is the demo of the panel the page embeds in iframes: static markup with the panel's own classes, under `panel/panel.css`, a copy of `src/ui/panel.css`. When the panel's look changes, copy it again: `cp src/ui/panel.css website/panel/panel.css`.

`i18n/` holds one JSON file per language (the extension's ten, English excepted: it is the page itself). Each key is the English text of a `data-i18n` element of `index.html`, exactly as written there, HTML included; a missing key shows the English. Two more keys are the page's `<title>` and its meta description. Each language has its own URL so that search engines index it: a new language is a JSON file here, a `hreflang` link and a line of the language list in `index.html`, and a line of `sitemap.xml`.

`site.css` is the stylesheet of every page: the landing page and the guides.

`debug-mode/` is a guide to Odoo's debug mode (English), for people who search how to turn it on. It is built from the landing page's parts: `site.css`, the same top bar (without the language list: the guide is English only) and footer, and a small script for the top bar, the theme and the stars. A change to the top bar or the footer of `index.html` is made here too.

`<key>.txt` is the IndexNow key: the Pages workflow sends the sitemap's URLs to IndexNow after each publish, which is how Bing learns of them.

`llms.txt` says what the page says, as plain text for AI assistants that read it (llmstxt.org). When the page's facts change (versions, browsers, tabs), change it too.

# Website

Landing page for Odoo Debug: https://odoo-debug.unclecatvn.com/

Static files only (`index.html`, no build step). `.github/workflows/pages.yml` publishes this folder to GitHub Pages on every push to `main` that touches it, at the custom domain set in the repository's Settings → Pages (an Actions deploy ignores a `CNAME` file). Preview locally with `python3 -m http.server -d website`.

`screenshots/` is shared with the repository READMEs: regenerate an image once, both pick it up.

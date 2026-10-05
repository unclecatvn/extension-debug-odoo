# Contributing

Issues and pull requests are welcome. Found a bug? [Open an issue](https://github.com/unclecatvn/extension-debug-odoo/issues) with the Odoo version, the page you were on and, if any, the error from the RPC tab.

## Build from source

Requirements: **Node.js 22.18 or later**.

```sh
git clone https://github.com/unclecatvn/extension-debug-odoo.git
cd extension-debug-odoo
npm install
npm run build   # → dist/: Load unpacked this folder (chrome://extensions → Developer mode)
```

After pulling new code: `npm run build`, then ⟳ in `chrome://extensions` and reload the Odoo page.

```sh
npm run watch   # rebuilds dist/ on every save (then ⟳ in chrome://extensions)
npm run check   # what CI runs: type check, unit tests, build, page-function / markup / import checks
npm run i18n    # refreshes the .pot / .po after adding a translatable string
```

How the code is organized, the rules it follows and how the Odoo versions are handled: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Every difference between Odoo 18, 19 and 20 the panel depends on lives in `src/odoo/adapters/`.

## Pull requests

1. `npm run check` passes and `npm run i18n` leaves `static/i18n/` unchanged (CI checks both).
2. New strings are translated in `static/i18n/vi.po`.
3. It was tried on at least one Odoo instance; say which version in the pull request.
4. The Contributor License Agreement box below is ticked.

## Releasing

Bump `version` in `static/manifest.json`, add its section to [CHANGELOG.md](CHANGELOG.md), push. CI checks, builds and publishes `odoo-debug-v<version>.zip` in the Releases; from `main` it is also uploaded to the Chrome Web Store and submitted for review (repository secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`; Actions › Release › Run workflow sends it again after a refused submission).

## Contributor License Agreement

Odoo Debug is released under the [Sustainable Use License](LICENSE), and only its licensor, UncleCat, may offer it on other terms. So that contributions can be accepted into it, opening a pull request means agreeing to the following, for that contribution and every later one:

> I give UncleCat permission to license my contributions on any terms they like. I am giving them this license in order to make it possible for them to accept my contributions into their project.
>
> **_As far as the law allows, my contributions come as is, without any warranty or condition, and I will not be liable to anyone for any damages related to this software or this license, under any kind of legal claim._**

The pull request template has a box for it: the CLA check passes once it is ticked, and a pull request is merged only then. Leave it unticked if you do not agree: it will not be merged, and nothing else changes.
